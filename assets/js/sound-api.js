(function(){
  const FILE = "assets/js/sound-api.js";
  let ctx = null;
  let unlocked = false;
  let settings = { soundEnabled:false, hapticEnabled:true, volume:.28, style:"soft" };

  function ensure(){
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    return ctx;
  }

  async function unlock(){
    try {
      const audio = ensure();
      if (audio.state === "suspended") await audio.resume();
      unlocked = true;
      success(true);
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

  function setSettings(next){ settings = { ...settings, ...next }; }

  function vibrate(pattern=12){
    if (!settings.hapticEnabled) return;
    try { navigator.vibrate?.(pattern); } catch {}
  }

  function tone(freq, dur, type="sine", gain=settings.volume, force=false){
    if ((!settings.soundEnabled && !force) || settings.style === "none") return;
    try {
      const audio = ensure();
      if (audio.state === "suspended" && !force) return;
      const osc = audio.createOscillator();
      const g = audio.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, audio.currentTime);
      g.gain.exponentialRampToValueAtTime(Math.max(0.001, gain), audio.currentTime + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + dur);
      osc.connect(g);
      g.connect(audio.destination);
      osc.start();
      osc.stop(audio.currentTime + dur + 0.02);
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

  function click(){
    vibrate(10);
    if (!unlocked) return;
    if (settings.style === "electric") {
      tone(660,.055,"triangle",settings.volume*.55);
      setTimeout(()=>tone(990,.045,"sine",settings.volume*.38),35);
    } else if (settings.style === "click") {
      tone(520,.035,"square",settings.volume*.30);
    } else {
      tone(440,.045,"sine",settings.volume*.25);
    }
  }

  function success(force=false){
    vibrate([10,30,10]);
    if (!unlocked && !force) return;
    tone(520,.06,"sine",settings.volume*.35,force);
    setTimeout(()=>tone(780,.08,"sine",settings.volume*.35,force),70);
  }

  function error(){
    vibrate([25,40,25]);
    if (!unlocked) return;
    tone(180,.12,"sawtooth",settings.volume*.25);
  }

  window.SoundAPI = { setSettings, click, success, error, vibrate, unlock, isUnlocked:()=>unlocked };
})();
