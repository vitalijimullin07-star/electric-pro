(function () {
  const KEY = "ep_visual_settings_clean_v5_3";

  const themes = [
    ["aurora","Аврора","#07111f","#13213a","#0f766e","#22c55e","#f8fafc","#a7b0c0","#0f172a"],
    ["graphite","Графит","#09090b","#18181b","#3f3f46","#eab308","#f8fafc","#b4b4b8","#18181b"],
    ["emerald","Изумруд","#052e2b","#064e3b","#022c22","#34d399","#ecfdf5","#a7f3d0","#052e2b"],
    ["sunset","Закат","#1f1020","#431407","#7c2d12","#fb923c","#fff7ed","#fed7aa","#1f1020"],
    ["ocean","Океан","#061526","#0f2747","#075985","#38bdf8","#f0f9ff","#bae6fd","#0f172a"],
    ["violet","Фиолет","#140b2d","#2e1065","#581c87","#c084fc","#faf5ff","#ddd6fe","#1e123d"],
    ["carbon","Карбон","#020617","#111827","#1e293b","#94a3b8","#f8fafc","#cbd5e1","#020617"],
    ["ice","Лёд","#0f172a","#1e3a8a","#0369a1","#67e8f9","#f0f9ff","#bae6fd","#0f172a"],
    ["rose","Роза","#2a0f1f","#831843","#9f1239","#fb7185","#fff1f2","#fecdd3","#2a0f1f"],
    ["mono","Моно","#111111","#262626","#404040","#ffffff","#ffffff","#d4d4d4","#171717"]
  ].map(([id,name,bgA,bgB,bgC,accent,text,muted,card]) => ({id,name,bgA,bgB,bgC,accent,text,muted,card}));

  const base = {
    themeId: "aurora",
    mode: "night",
    accent: "#22c55e",
    buttonColor: "#22c55e",
    textColor: "#f8fafc",
    mutedColor: "#a7b0c0",
    backgroundColor: "#07111f",
    cardColor: "#0f172a",
    opacity: 0.72,
    buttonOpacity: 0.82,
    radius: 22,
    buttonRadius: 15,
    blur: 16,
    density: "normal",
    fontScale: 1,
    buttonShape: "soft",
    backgroundStyle: "glass",
    animationStyle: "soft",
    animationSpeed: 1,
    reduceMotion: false,
    electricPulse: false,
    soundEnabled: false,
    hapticEnabled: true,
    soundVolume: 0.28,
    soundStyle: "soft",
    advancedOpen: true
  };

  let settings = load();

  function load() {
    try {
      const old = JSON.parse(localStorage.getItem(KEY) || "{}");
      return { ...base, ...old };
    } catch {
      return { ...base };
    }
  }

  function save() {
    localStorage.setItem(KEY, JSON.stringify(settings));
  }

  function autoMode() {
    const h = new Date().getHours();
    return h >= 7 && h < 20 ? "day" : "night";
  }

  function activeMode() {
    return settings.mode === "auto" ? autoMode() : settings.mode;
  }

  function rgb(hex) {
    const s = String(hex || "").replace("#", "");
    if (!/^[0-9a-f]{6}$/i.test(s)) return null;
    return {
      r: parseInt(s.slice(0, 2), 16),
      g: parseInt(s.slice(2, 4), 16),
      b: parseInt(s.slice(4, 6), 16)
    };
  }

  function dayOverride() {
    if (activeMode() !== "day") return {};
    return {
      textColor: "#0f172a",
      mutedColor: "#475569",
      cardColor: "#ffffff",
      backgroundColor: "#e7eef8",
      opacity: Math.max(settings.opacity, 0.68)
    };
  }

  function normalize() {
    if (settings.backgroundStyle === "live" || settings.backgroundStyle === "static") {
      settings.backgroundStyle = "glass";
    }
    if (settings.soundStyle === "electric") settings.soundStyle = "electric-soft";
    if (settings.soundStyle === "click") settings.soundStyle = "short";
  }

  function apply() {
    normalize();

    const theme = themes.find(x => x.id === settings.themeId) || themes[0];
    const d = dayOverride();
    const r = document.documentElement;

    r.style.setProperty("--bg-a", d.backgroundColor || settings.backgroundColor || theme.bgA);
    r.style.setProperty("--bg-b", activeMode() === "day" ? "#cbdaf0" : theme.bgB);
    r.style.setProperty("--bg-c", activeMode() === "day" ? "#d9f4ef" : theme.bgC);
    r.style.setProperty("--accent", settings.accent || theme.accent);
    r.style.setProperty("--button-bg", settings.buttonColor || settings.accent || theme.accent);
    r.style.setProperty("--text", d.textColor || settings.textColor || theme.text);
    r.style.setProperty("--muted", d.mutedColor || settings.mutedColor || theme.muted);
    r.style.setProperty("--card-opacity", String(d.opacity || settings.opacity));
    r.style.setProperty("--button-opacity", String(settings.buttonOpacity));
    r.style.setProperty("--radius", settings.radius + "px");
    r.style.setProperty("--button-radius", settings.buttonRadius + "px");
    r.style.setProperty("--blur", settings.blur + "px");
    r.style.setProperty("--font-scale", String(settings.fontScale));
    r.style.setProperty("--anim-speed", String(settings.animationSpeed));

    const cr = rgb(d.cardColor || settings.cardColor || theme.card);
    if (cr) r.style.setProperty("--card-bg-rgb", `${cr.r}, ${cr.g}, ${cr.b}`);

    document.body.dataset.density = settings.density;
    document.body.dataset.visualMode = activeMode();
    document.body.dataset.buttonShape = settings.buttonShape;
    document.body.dataset.animation = settings.animationStyle;
    document.body.dataset.reduceMotion = settings.reduceMotion ? "true" : "false";
    document.body.dataset.electricPulse = settings.electricPulse ? "true" : "false";
    document.body.dataset.bgStyle = settings.backgroundStyle;

    window.SoundAPI?.setSettings?.({
      soundEnabled: settings.soundEnabled,
      hapticEnabled: settings.hapticEnabled,
      volume: settings.soundVolume,
      style: settings.soundStyle
    });

    syncControls();
  }

  function setValue(id, value, prop = "value") {
    const el = document.getElementById(id);
    if (el) el[prop] = value;
  }

  function setSwitch(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle("is-on", !!value);
    el.setAttribute("aria-pressed", value ? "true" : "false");
  }

  function syncControls() {
    [
      ["accentColorInput","accent"],
      ["buttonColorInput","buttonColor"],
      ["textColorInput","textColor"],
      ["mutedColorInput","mutedColor"],
      ["backgroundColorInput","backgroundColor"],
      ["cardColorInput","cardColor"],
      ["glassOpacityInput","opacity"],
      ["buttonOpacityInput","buttonOpacity"],
      ["radiusInput","radius"],
      ["buttonRadiusInput","buttonRadius"],
      ["blurInput","blur"],
      ["fontScaleInput","fontScale"],
      ["densityInput","density"],
      ["buttonShapeInput","buttonShape"],
      ["backgroundStyleInput","backgroundStyle"],
      ["animationStyleInput","animationStyle"],
      ["animationSpeedInput","animationSpeed"],
      ["soundVolumeInput","soundVolume"],
      ["soundStyleInput","soundStyle"]
    ].forEach(([id,key]) => setValue(id, settings[key]));

    setSwitch("reduceMotionInput", settings.reduceMotion);
    setSwitch("electricPulseInput", settings.electricPulse);
    setSwitch("soundEnabledInput", settings.soundEnabled);
    setSwitch("hapticEnabledInput", settings.hapticEnabled);

    const advanced = document.getElementById("advancedVisualPanel");
    if (advanced) advanced.classList.toggle("hidden", !settings.advancedOpen);

    const b = document.getElementById("toggleAdvancedVisualBtn");
    if (b) b.textContent = settings.advancedOpen ? "Скрыть расширенную настройку" : "Расширенная настройка";

    document.querySelectorAll(".theme-btn").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.theme === settings.themeId);
    });

    document.querySelectorAll("[data-visual-mode]").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.visualMode === settings.mode);
    });

    document.querySelectorAll("[data-profile]").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.profile === settings.profile);
    });
  }

  function renderThemes() {
    const grid = document.getElementById("themeGrid");
    if (!grid) return;

    grid.innerHTML = themes.map(t => `
      <button class="theme-btn ep-clickable" data-theme="${t.id}" style="background:linear-gradient(135deg,${t.bgA},${t.bgB},${t.bgC})">
        <strong>${t.name}</strong><br><small>${t.id}</small>
      </button>
    `).join("");

    grid.querySelectorAll(".theme-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const t = themes.find(x => x.id === btn.dataset.theme) || themes[0];
        settings = {
          ...settings,
          themeId: t.id,
          accent: t.accent,
          buttonColor: t.accent,
          backgroundColor: t.bgA,
          cardColor: t.card,
          textColor: t.text,
          mutedColor: t.muted
        };
        save();
        apply();
        window.SoundAPI?.click?.();
      });
    });
  }

  function bindInput(id, key, numeric = false) {
    const el = document.getElementById(id);
    if (!el) return;

    el.addEventListener("input", () => {
      let v = el.value;
      if (numeric) v = Number(v);
      settings[key] = v;
      save();
      apply();
    });

    el.addEventListener("change", () => {
      let v = el.value;
      if (numeric) v = Number(v);
      settings[key] = v;
      save();
      apply();
    });
  }

  function bindSwitch(id, key) {
    const el = document.getElementById(id);
    if (!el) return;

    el.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();

      settings[key] = !settings[key];

      if (key === "soundEnabled" && settings[key]) {
        window.SoundAPI?.unlock?.();
      }

      save();
      apply();
      window.SoundAPI?.click?.();
    });
  }

  function applyProfile(profile) {
    settings.profile = profile;

    if (profile === "object") {
      Object.assign(settings, {
        mode: "day",
        density: "large",
        fontScale: 1.06,
        animationStyle: "fast",
        animationSpeed: 0.75,
        buttonShape: "round",
        opacity: 0.78,
        backgroundStyle: "glass"
      });
    }

    if (profile === "night") {
      Object.assign(settings, {
        mode: "night",
        animationStyle: "soft",
        backgroundStyle: "glass",
        opacity: 0.72
      });
    }

    if (profile === "day") {
      Object.assign(settings, {
        mode: "day",
        opacity: 0.72,
        backgroundStyle: "light",
        textColor: "#0f172a",
        mutedColor: "#475569",
        cardColor: "#ffffff"
      });
    }

    if (profile === "battery") {
      Object.assign(settings, {
        animationStyle: "minimal",
        animationSpeed: 0.6,
        reduceMotion: true,
        backgroundStyle: "minimal",
        electricPulse: false,
        soundEnabled: false
      });
    }

    if (profile === "premium") {
      Object.assign(settings, {
        animationStyle: "premium",
        animationSpeed: 1.15,
        backgroundStyle: "glass",
        electricPulse: false,
        buttonShape: "soft",
        opacity: 0.74
      });
    }

    if (profile === "readable") {
      Object.assign(settings, {
        mode: "day",
        fontScale: 1.1,
        density: "large",
        buttonShape: "round",
        opacity: 0.86,
        textColor: "#020617",
        mutedColor: "#334155",
        backgroundStyle: "light"
      });
    }

    save();
    apply();
    window.SoundAPI?.success?.();
  }

  function bindControls() {
    [
      ["accentColorInput","accent"],
      ["buttonColorInput","buttonColor"],
      ["textColorInput","textColor"],
      ["mutedColorInput","mutedColor"],
      ["backgroundColorInput","backgroundColor"],
      ["cardColorInput","cardColor"],
      ["densityInput","density"],
      ["buttonShapeInput","buttonShape"],
      ["backgroundStyleInput","backgroundStyle"],
      ["animationStyleInput","animationStyle"],
      ["soundStyleInput","soundStyle"]
    ].forEach(a => bindInput(a[0], a[1]));

    [
      ["glassOpacityInput","opacity"],
      ["buttonOpacityInput","buttonOpacity"],
      ["radiusInput","radius"],
      ["buttonRadiusInput","buttonRadius"],
      ["blurInput","blur"],
      ["fontScaleInput","fontScale"],
      ["animationSpeedInput","animationSpeed"],
      ["soundVolumeInput","soundVolume"]
    ].forEach(a => bindInput(a[0], a[1], true));

    bindSwitch("reduceMotionInput", "reduceMotion");
    bindSwitch("electricPulseInput", "electricPulse");
    bindSwitch("soundEnabledInput", "soundEnabled");
    bindSwitch("hapticEnabledInput", "hapticEnabled");

    document.querySelectorAll("[data-visual-mode]").forEach(btn => {
      btn.addEventListener("click", () => {
        settings.mode = btn.dataset.visualMode;
        save();
        apply();
        window.SoundAPI?.click?.();
      });
    });

    document.querySelectorAll("[data-profile]").forEach(btn => {
      btn.addEventListener("click", () => applyProfile(btn.dataset.profile));
    });

    document.getElementById("toggleAdvancedVisualBtn")?.addEventListener("click", () => {
      settings.advancedOpen = !settings.advancedOpen;
      save();
      apply();
      window.SoundAPI?.click?.();
    });

    document.getElementById("testSoundBtn")?.addEventListener("click", async () => {
      await window.SoundAPI?.unlock?.();
      const wasEnabled = settings.soundEnabled;
      settings.soundEnabled = true;
      window.SoundAPI?.setSettings?.({
        soundEnabled: true,
        hapticEnabled: settings.hapticEnabled,
        volume: settings.soundVolume,
        style: settings.soundStyle
      });
      window.SoundAPI?.test?.();
      setTimeout(() => {
        settings.soundEnabled = wasEnabled;
        apply();
      }, 500);
    });

    document.getElementById("resetVisualBtn")?.addEventListener("click", () => {
      const themeId = settings.themeId;
      const mode = settings.mode;
      settings = { ...base, themeId, mode };
      const t = themes.find(x => x.id === themeId) || themes[0];
      Object.assign(settings, {
        accent: t.accent,
        buttonColor: t.accent,
        backgroundColor: t.bgA,
        cardColor: t.card,
        textColor: t.text,
        mutedColor: t.muted
      });
      save();
      apply();
      window.SoundAPI?.success?.();
    });

    document.getElementById("baseVisualBtn")?.addEventListener("click", () => {
      settings = { ...base };
      save();
      apply();
      window.SoundAPI?.success?.();
    });
  }

  window.VisualSettings = {
    init() {
      renderThemes();
      bindControls();
      apply();
    },
    open() {
      document.getElementById("visualPanel")?.classList.remove("hidden");
      window.AppShell?.pushOverlay?.("visual");
      syncControls();
    },
    close() {
      document.getElementById("visualPanel")?.classList.add("hidden");
      window.AppShell?.removeOverlay?.("visual");
    },
    getSettings: () => ({ ...settings })
  };
})();
