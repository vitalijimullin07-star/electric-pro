(function () {
  "use strict";

  window.EP = window.EP || {};

  const STORAGE_KEYS = [
    "ep_visual_settings_clean_v5_3",
    "ep.visual.v29",
    "ep_visual_settings",
    "electric_pro_visual_settings"
  ];

  function parseStorage(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const value = JSON.parse(raw);
      return value && typeof value === "object" ? value : null;
    } catch (error) {
      return null;
    }
  }

  function readStoredSettings() {
    let merged = {};
    STORAGE_KEYS.forEach((key) => {
      const value = parseStorage(key);
      if (value) merged = Object.assign(merged, value);
    });
    return merged;
  }

  function asBool(value, fallback) {
    if (value === true || value === "true" || value === "on" || value === "enabled" || value === 1 || value === "1") return true;
    if (value === false || value === "false" || value === "off" || value === "disabled" || value === 0 || value === "0") return false;
    return fallback;
  }

  function clampNumber(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  function firstText(source, names, fallback) {
    for (const name of names) {
      if (source[name] !== undefined && source[name] !== null && source[name] !== "") return String(source[name]);
    }
    return fallback;
  }

  const SoundFeedback = {
    context: null,
    unlocked: false,
    override: {},
    lastPlayAt: 0,

    effects: {
      glass: { type: "sine", notes: [720, 1080], times: [0, 0.032], duration: 0.105, gain: 0.30 },
      soft: { type: "sine", notes: [520], times: [0], duration: 0.075, gain: 0.24 },
      short: { type: "square", notes: [680], times: [0], duration: 0.038, gain: 0.18 },
      tick: { type: "triangle", notes: [920], times: [0], duration: 0.026, gain: 0.14 },
      switch: { type: "square", notes: [360, 540], times: [0, 0.035], duration: 0.11, gain: 0.22 },
      relay: { type: "square", notes: [260, 420, 260], times: [0, 0.034, 0.074], duration: 0.13, gain: 0.20 },
      breaker: { type: "sawtooth", notes: [180, 90], times: [0, 0.045], duration: 0.13, gain: 0.18 },
      "electric-soft": { type: "triangle", notes: [440, 740, 620], times: [0, 0.036, 0.072], duration: 0.14, gain: 0.24 },
      "electric-sharp": { type: "sawtooth", notes: [900, 1320, 760], times: [0, 0.025, 0.052], duration: 0.10, gain: 0.16 },
      spark: { type: "square", notes: [1500, 900, 1300], times: [0, 0.018, 0.04], duration: 0.085, gain: 0.13 },
      chime: { type: "sine", notes: [660, 990, 1320], times: [0, 0.06, 0.12], duration: 0.26, gain: 0.21 },
      double: { type: "sine", notes: [560, 560], times: [0, 0.09], duration: 0.18, gain: 0.22 },
      deep: { type: "triangle", notes: [220, 330], times: [0, 0.05], duration: 0.16, gain: 0.28 },
      "sci-fi": { type: "sine", notes: [480, 960, 1440, 720], times: [0, 0.035, 0.07, 0.115], duration: 0.21, gain: 0.20 },
      silent: { type: "sine", notes: [], times: [], duration: 0, gain: 0 }
    },

    haptics: {
      light: 14,
      medium: 32,
      strong: 70,
      double: [25, 45, 25],
      pulse: [18, 25, 18, 25, 35]
    },

    getSettings() {
      const stored = Object.assign({}, readStoredSettings(), this.override || {});
      const style = firstText(stored, ["soundStyle", "style", "clickSound", "uiSoundStyle"], "glass");
      const pattern = firstText(stored, ["hapticPattern", "vibrationPattern", "vibroPattern"], "medium");
      return {
        soundEnabled: asBool(stored.soundEnabled ?? stored.soundsEnabled ?? stored.sound ?? stored.uiSound ?? stored.soundOn, true),
        hapticEnabled: asBool(stored.hapticEnabled ?? stored.vibrationEnabled ?? stored.vibrateEnabled ?? stored.haptic ?? stored.vibration ?? stored.vibro ?? stored.vibroEnabled, true),
        soundVolume: clampNumber(stored.soundVolume ?? stored.volume ?? stored.uiSoundVolume, 0, 1, 0.38),
        soundStyle: this.effects[style] ? style : "glass",
        hapticPattern: this.haptics[pattern] ? pattern : "medium"
      };
    },

    ensureContext() {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return null;
      if (!this.context) this.context = new AudioContextClass();
      return this.context;
    },

    async unlock() {
      const ctx = this.ensureContext();
      if (!ctx) return false;
      try {
        if (ctx.state === "suspended" && typeof ctx.resume === "function") await ctx.resume();
        this.unlocked = true;
        return true;
      } catch (error) {
        return false;
      }
    },

    playTone(frequency, offset, duration, type, volume) {
      const ctx = this.ensureContext();
      if (!ctx || !frequency || !duration) return;
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = ctx.currentTime + offset;
      const safeVolume = Math.max(0.0001, volume);

      oscillator.type = type || "sine";
      oscillator.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(safeVolume, start + 0.009);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start(start);
      oscillator.stop(start + duration + 0.03);
    },

    play(style, force) {
      const settings = this.getSettings();
      const soundStyle = style && this.effects[style] ? style : settings.soundStyle;
      if (!force && !settings.soundEnabled) return;
      if (soundStyle === "silent") return;

      const now = performance.now();
      if (!force && now - this.lastPlayAt < 50) return;
      this.lastPlayAt = now;

      const effect = this.effects[soundStyle] || this.effects.glass;
      const noteDuration = Math.max(0.018, effect.duration / Math.max(1, effect.notes.length + 0.6));
      const volume = Math.max(0.0001, settings.soundVolume * effect.gain);

      this.unlock();
      effect.notes.forEach((frequency, index) => {
        this.playTone(frequency, effect.times[index] || 0, noteDuration, effect.type, volume);
      });
    },

    vibrate(pattern, force) {
      const settings = this.getSettings();
      if (!force && !settings.hapticEnabled) return false;
      if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return false;
      const key = pattern && this.haptics[pattern] ? pattern : settings.hapticPattern;
      const value = this.haptics[key] || this.haptics.medium;
      try {
        return Boolean(navigator.vibrate(value));
      } catch (error) {
        return false;
      }
    },

    click() {
      this.play(null, false);
      this.vibrate(null, false);
    },

    nav() {
      this.play("switch", false);
      this.vibrate("medium", false);
    },

    success() {
      this.play("chime", false);
      this.vibrate("double", false);
    },

    test(style, pattern) {
      this.unlock().then(() => {
        this.play(style, true);
        this.vibrate(pattern, true);
      });
    },

    setSettings(next) {
      this.override = Object.assign({}, this.override || {}, next || {});
      if (next && next.style && !next.soundStyle) this.override.soundStyle = next.style;
      if (next && next.volume !== undefined && next.soundVolume === undefined) this.override.soundVolume = next.volume;
      return this.getSettings();
    },

    bind() {
      const unlockOnce = () => {
        this.unlock();
        window.removeEventListener("pointerdown", unlockOnce, true);
        window.removeEventListener("touchstart", unlockOnce, true);
      };

      window.addEventListener("pointerdown", unlockOnce, true);
      window.addEventListener("touchstart", unlockOnce, true);

      document.addEventListener("pointerdown", (event) => {
        const target = event.target && event.target.closest ? event.target.closest("button,[role='button'],[data-route],.tile,.nav-link,.ep-clickable") : null;
        if (!target) return;
        if (target.id === "testSoundBtn" || target.hasAttribute("data-sound-test")) return;
        this.click();
      }, true);

      window.addEventListener("ep:route-loaded", () => {
        // Route sound is intentionally quiet to avoid noise while pages render.
      });
    },

    init() {
      window.SoundAPI = {
        unlock: () => this.unlock(),
        setSettings: (next) => this.setSettings(next),
        click: () => this.click(),
        nav: () => this.nav(),
        success: () => this.success(),
        test: (style, pattern) => this.test(style, pattern),
        vibrate: (pattern, force) => this.vibrate(pattern, force),
        getSettings: () => this.getSettings(),
        getEffects: () => Object.keys(this.effects),
        canVibrate: () => typeof navigator !== "undefined" && typeof navigator.vibrate === "function"
      };
      window.EP.SoundFeedback = this;
      this.bind();
    }
  };

  SoundFeedback.init();
})();
