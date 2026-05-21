(function () {
  const FILE = "assets/js/sound-api.js";

  let ctx = null;
  let unlocked = false;
  let pendingUnlock = false;

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

      unlocked = audio.state === "running";

      if (unlocked) {
        window.Diagnostics?.ok?.({
          file: FILE,
          module: "SoundAPI",
          functionName: "unlock()",
          place: "Web Audio API",
          code: "sound-unlocked",
          message: "Звук активирован."
        });
      }

      return unlocked;
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

  function vibrate(pattern = 10) {
    if (!settings.hapticEnabled) return;
    try { navigator.vibrate?.(pattern); } catch {}
  }

  function tone(freq, dur, type = "sine", gain = settings.volume, force = false, delay = 0) {
    if ((!settings.soundEnabled && !force) || settings.style === "none") return;

    try {
      const audio = ensure();

      if (audio.state === "suspended" && !force) return;

      const start = audio.currentTime + delay;
      const osc = audio.createOscillator();
      const g = audio.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, start);

      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(Math.max(0.001, gain), start + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, start + dur);

      osc.connect(g);
      g.connect(audio.destination);

      osc.start(start);
      osc.stop(start + dur + 0.025);
    } catch {}
  }

  function play(style = settings.style, force = false) {
    const v = Number(settings.volume || 0.28);

    if (style === "none") {
      vibrate(8);
      return;
    }

    if (style === "soft") {
      vibrate(8);
      tone(420, 0.055, "sine", v * 0.18, force, 0);
      tone(640, 0.065, "sine", v * 0.14, force, 0.055);
      return;
    }

    if (style === "soft2") {
      vibrate(7);
      tone(360, 0.070, "sine", v * 0.15, force, 0);
      tone(540, 0.075, "sine", v * 0.13, force, 0.070);
      return;
    }

    if (style === "soft3") {
      vibrate(6);
      tone(500, 0.045, "triangle", v * 0.13, force, 0);
      tone(760, 0.050, "sine", v * 0.10, force, 0.045);
      return;
    }

    if (style === "air") {
      vibrate(5);
      tone(700, 0.040, "sine", v * 0.09, force, 0);
      tone(980, 0.055, "sine", v * 0.07, force, 0.050);
      return;
    }

    if (style === "glass") {
      vibrate(6);
      tone(880, 0.030, "triangle", v * 0.11, force, 0);
      tone(1320, 0.045, "sine", v * 0.07, force, 0.035);
      return;
    }

    if (style === "warm") {
      vibrate(10);
      tone(300, 0.080, "sine", v * 0.16, force, 0);
      tone(450, 0.090, "sine", v * 0.12, force, 0.075);
      return;
    }

    if (style === "short") {
      vibrate(5);
      tone(620, 0.030, "sine", v * 0.12, force, 0);
      return;
    }

    if (style === "deep") {
      vibrate(12);
      tone(220, 0.075, "sine", v * 0.16, force, 0);
      tone(330, 0.060, "sine", v * 0.10, force, 0.065);
      return;
    }

    if (style === "electric-soft") {
      vibrate([6, 18, 6]);
      tone(620, 0.035, "triangle", v * 0.11, force, 0);
      tone(930, 0.035, "sine", v * 0.08, force, 0.035);
      return;
    }

    play("soft", force);
  }

  async function click() {
    if (!settings.soundEnabled) {
      vibrate(6);
      return;
    }

    if (!unlocked) {
      if (pendingUnlock) return;
      pendingUnlock = true;
      const ok = await unlock();
      pendingUnlock = false;

      if (ok) {
        play(settings.style, false);
      } else {
        vibrate(6);
      }
      return;
    }

    play(settings.style, false);
  }

  async function success(force = false) {
    vibrate([8, 24, 8]);

    if (!unlocked && !force) {
      await unlock();
    }

    if (!unlocked && !force) return;

    const v = Number(settings.volume || 0.28);
    tone(520, 0.055, "sine", v * 0.18, force, 0);
    tone(740, 0.065, "sine", v * 0.15, force, 0.065);
  }

  function error() {
    vibrate([20, 35, 20]);
    if (!unlocked) return;

    const v = Number(settings.volume || 0.28);
    tone(180, 0.10, "sine", v * 0.14, false, 0);
    tone(120, 0.09, "sine", v * 0.10, false, 0.10);
  }

  async function test() {
    const ok = await unlock();
    if (!ok) return;

    const old = settings.soundEnabled;
    settings.soundEnabled = true;
    play(settings.style, true);
    setTimeout(() => { settings.soundEnabled = old; }, 500);
  }

  function isEnabled() {
    return !!settings.soundEnabled;
  }

  window.SoundAPI = {
    setSettings,
    click,
    success,
    error,
    vibrate,
    unlock,
    test,
    isUnlocked: () => unlocked,
    isEnabled
  };
})();
