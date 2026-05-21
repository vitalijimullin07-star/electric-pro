(function () {
  const FILE = "assets/js/sound-api.js";

  let ctx = null;
  let unlocked = false;

  let settings = {
    soundEnabled: false,
    hapticEnabled: true,
    volume: 0.28,
    style: "soft"
  };

  function ensure() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return ctx;
  }

  async function unlock() {
    try {
      const audio = ensure();
      if (audio.state === "suspended") {
        await audio.resume();
      }

      unlocked = true;

      window.Diagnostics?.ok?.({
        file: FILE,
        module: "SoundAPI",
        functionName: "unlock()",
        place: "Web Audio API",
        code: "sound-unlocked",
        message: "Звук активирован после нажатия пользователя."
      });

      return true;
    } catch (error) {
      window.Diagnostics?.error?.({
        file: FILE,
        module: "SoundAPI",
        functionName: "unlock()",
        place: "Web Audio API",
        code: "sound-unlock-error",
        message: error.message
      });

      return false;
    }
  }

  function setSettings(next) {
    settings = { ...settings, ...next };
  }

  function vibrate(pattern = 12) {
    if (!settings.hapticEnabled) return;
    try {
      navigator.vibrate?.(pattern);
    } catch {}
  }

  function tone(freq, duration, type = "sine", gain = settings.volume, force = false, delay = 0) {
    if ((!settings.soundEnabled && !force) || settings.style === "none") return;

    try {
      const audio = ensure();
      if (audio.state === "suspended" && !force) return;

      const startAt = audio.currentTime + delay;
      const osc = audio.createOscillator();
      const g = audio.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, startAt);

      g.gain.setValueAtTime(0.0001, startAt);
      g.gain.exponentialRampToValueAtTime(Math.max(0.001, gain), startAt + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

      osc.connect(g);
      g.connect(audio.destination);

      osc.start(startAt);
      osc.stop(startAt + duration + 0.025);
    } catch (error) {
      window.Diagnostics?.error?.({
        file: FILE,
        module: "SoundAPI",
        functionName: "tone()",
        place: "Web Audio API",
        code: "sound-error",
        message: error.message
      });
    }
  }

  function playByStyle(force = false) {
    const v = Number(settings.volume || 0.28);

    if (settings.style === "none") {
      vibrate(8);
      return;
    }

    if (settings.style === "electric") {
      vibrate([8, 18, 8]);
      tone(880, 0.045, "sawtooth", v * 0.22, force, 0);
      tone(1320, 0.04, "triangle", v * 0.18, force, 0.035);
      tone(1760, 0.035, "sine", v * 0.12, force, 0.07);
      return;
    }

    if (settings.style === "click") {
      vibrate(7);
      tone(980, 0.025, "square", v * 0.16, force, 0);
      tone(520, 0.018, "square", v * 0.08, force, 0.026);
      return;
    }

    // soft
    vibrate(10);
    tone(420, 0.055, "sine", v * 0.20, force, 0);
    tone(640, 0.065, "sine", v * 0.16, force, 0.055);
  }

  function click() {
    if (!unlocked) {
      vibrate(8);
      return;
    }
    playByStyle(false);
  }

  function success(force = false) {
    const v = Number(settings.volume || 0.28);
    vibrate([10, 30, 10]);

    if (!unlocked && !force) return;

    tone(520, 0.06, "sine", v * 0.24, force, 0);
    tone(780, 0.07, "sine", v * 0.22, force, 0.075);
    tone(1040, 0.055, "triangle", v * 0.16, force, 0.15);
  }

  function error() {
    const v = Number(settings.volume || 0.28);
    vibrate([25, 40, 25]);

    if (!unlocked) return;

    tone(180, 0.12, "sawtooth", v * 0.20, false, 0);
    tone(120, 0.10, "sawtooth", v * 0.16, false, 0.12);
  }

  async function test() {
    const ok = await unlock();
    if (!ok) return;

    const wasEnabled = settings.soundEnabled;
    settings.soundEnabled = true;

    playByStyle(true);

    setTimeout(() => {
      settings.soundEnabled = wasEnabled;
    }, 450);
  }

  window.SoundAPI = {
    setSettings,
    click,
    success,
    error,
    vibrate,
    unlock,
    test,
    isUnlocked: () => unlocked
  };
})();
