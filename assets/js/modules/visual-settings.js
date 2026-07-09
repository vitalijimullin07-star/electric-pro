(function () {
  window.EP = window.EP || {};

  const KEY = "ep_visual_settings_clean_v5_3";
  const NEXT_KEY = "ep.visual.v29";

  const themes = [
    ["aurora", "Аврора", "#07111f", "#13213a", "#0f766e", "#22c55e", "#f8fafc", "#a7b0c0", "#0f172a"],
    ["graphite", "Графит", "#09090b", "#18181b", "#3f3f46", "#eab308", "#f8fafc", "#b4b4b8", "#18181b"],
    ["emerald", "Изумруд", "#052e2b", "#064e3b", "#022c22", "#34d399", "#ecfdf5", "#a7f3d0", "#052e2b"],
    ["sunset", "Закат", "#1f1020", "#431407", "#7c2d12", "#fb923c", "#fff7ed", "#fed7aa", "#1f1020"],
    ["ocean", "Океан", "#061526", "#0f2747", "#075985", "#38bdf8", "#f0f9ff", "#bae6fd", "#0f172a"],
    ["violet", "Фиолет", "#140b2d", "#2e1065", "#581c87", "#c084fc", "#faf5ff", "#ddd6fe", "#1e123d"],
    ["carbon", "Карбон", "#020617", "#111827", "#1e293b", "#94a3b8", "#f8fafc", "#cbd5e1", "#020617"],
    ["ice", "Лёд", "#0f172a", "#1e3a8a", "#0369a1", "#67e8f9", "#f0f9ff", "#bae6fd", "#0f172a"],
    ["rose", "Роза", "#2a0f1f", "#831843", "#9f1239", "#fb7185", "#fff1f2", "#fecdd3", "#2a0f1f"],
    ["mono", "Моно", "#111111", "#262626", "#404040", "#ffffff", "#ffffff", "#d4d4d4", "#171717"],
    ["midnight", "Полночь", "#0a0f1f", "#111a33", "#1e2a4a", "#3b82f6", "#f8fafc", "#9aa6c0", "#0d1428"],
    ["sakura", "Сакура", "#1a0f17", "#2d1521", "#3f1d2e", "#f472b6", "#fdf2f8", "#d8b4c8", "#1a0f17"],
    ["pine", "Хвоя", "#0a1410", "#0f2419", "#16301f", "#34d399", "#ecfdf5", "#9fc4b0", "#0a1410"],
    ["amber", "Янтарь", "#1a1206", "#2d1f0a", "#3f2d10", "#f59e0b", "#fffbeb", "#d8c4a0", "#1a1206"],
    ["slate", "Сланец", "#0f1419", "#1a2129", "#252f3a", "#64748b", "#f1f5f9", "#94a3b8", "#131922"],
    ["cyber", "Кибер", "#0a0a12", "#14081f", "#1f0a2e", "#d946ef", "#faf5ff", "#c4a0d8", "#0a0a12"],
    ["mocha", "Мокко", "#15100c", "#241a12", "#33271a", "#d2a679", "#faf5f0", "#c8b49a", "#15100c"],
    ["arctic", "Арктика", "#06101c", "#0c1f33", "#103047", "#67e8f9", "#f0f9ff", "#a0c4d8", "#06101c"],
    ["gold", "Золото", "#0f0f0a", "#1a1a10", "#262616", "#eab308", "#fffef0", "#cfc89a", "#0f0f0a"],
    ["ruby", "Рубин", "#1a0a0f", "#2d0f17", "#3f1520", "#fb7185", "#fff1f3", "#d8a0aa", "#1a0a0f"],
    ["glass-indigo", "Индиго-стекло ◆", "#0b1026", "#161d3d", "#232a52", "#818cf8", "#f8fafc", "#a5b0d0", "#10162e"],
    ["aurora-glow", "Аврора-глоу ◆", "#04140f", "#06241c", "#0a3528", "#2dd4bf", "#ecfffb", "#9fd8cc", "#06140f"],
    ["paper-light", "Бумага ▭", "#eef1f6", "#e3e8f0", "#d7dde8", "#2563eb", "#0f172a", "#475569", "#ffffff"],
    ["graphite-flat", "Графит-флэт ▭", "#15171c", "#1d2026", "#262a31", "#f59e0b", "#f3f4f6", "#9ca3af", "#1a1d23"]
  ].map(([id, name, bgA, bgB, bgC, accent, text, muted, card]) => ({ id, name, bgA, bgB, bgC, accent, text, muted, card }));

  // Пресеты эффектов для дизайнерских тем: ◆ для мощных (насыщенное стекло), ▭ для слабых (плоско/быстро)
  const themePresets = {
    "glass-indigo":  { mode: "night", perfMode: "rich", backgroundStyle: "glass", blur: 26, opacity: 0.58, radius: 24, buttonRadius: 16, animationStyle: "premium", animationSpeed: 1.1 },
    "aurora-glow":   { mode: "night", perfMode: "rich", backgroundStyle: "glass", blur: 24, opacity: 0.60, radius: 22, buttonRadius: 15, animationStyle: "premium", animationSpeed: 1.1 },
    "paper-light":   { mode: "day",   perfMode: "lite", backgroundStyle: "light", blur: 0,  opacity: 0.96, radius: 16, buttonRadius: 12, animationStyle: "minimal", animationSpeed: 0.7 },
    "graphite-flat": { mode: "night", perfMode: "lite", backgroundStyle: "solid", blur: 0,  opacity: 0.98, radius: 14, buttonRadius: 12, animationStyle: "minimal", animationSpeed: 0.7 }
  };

  const base = {
    themeId: "aurora",
    mode: "night",
    profile: "night",
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
    textScale: 1,
    cardTextScale: 1,
    iconPack: "emoji",
    buttonShape: "soft",
    backgroundStyle: "glass",
    animationStyle: "soft",
    animationSpeed: 1,
    reduceMotion: false,
    perfLite: false,
    perfMode: "auto",
    perfLevelLearned: null,
    electricPulse: false,
    soundEnabled: false,
    hapticEnabled: true,
    hapticPattern: "medium",
    soundVolume: 0.28,
    soundStyle: "glass",
    advancedOpen: true
  };

  let settings = load();

  function load() {
    try {
      const fromOld = JSON.parse(localStorage.getItem(KEY) || "{}");
      const fromNew = JSON.parse(localStorage.getItem(NEXT_KEY) || "{}");
      const value = Object.assign({}, base, fromOld, fromNew);
      return normalizeValue(value);
    } catch (error) {
      return Object.assign({}, base);
    }
  }

  function normalizeValue(value) {
    const next = Object.assign({}, base, value || {});
    if (next.backgroundStyle === "static") next.backgroundStyle = "glass";
    if (next.backgroundStyle === "live") next.backgroundStyle = "glass";
    if (next.soundStyle === "electric") next.soundStyle = "electric-soft";
    if (next.soundStyle === "click") next.soundStyle = "short";
    return next;
  }

  function save() {
    settings = normalizeValue(settings);
    try {
      const s = JSON.stringify(settings);
      localStorage.setItem(KEY, s);
      localStorage.setItem(NEXT_KEY, s);
    } catch (e) {}
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
      opacity: Math.max(Number(settings.opacity || 0), 0.68)
    };
  }

  let _weakCache = null;
  function isWeakDevice() {
    if (_weakCache !== null) return _weakCache;
    try {
      const cores = Number(navigator.hardwareConcurrency) || 8;
      const mem = Number(navigator.deviceMemory) || 8;
      const noBlur = !(window.CSS && CSS.supports && (CSS.supports("backdrop-filter", "blur(2px)") || CSS.supports("-webkit-backdrop-filter", "blur(2px)")));
      _weakCache = cores <= 4 || mem <= 3 || noBlur;
    } catch (e) { _weakCache = false; }
    return _weakCache;
  }
  function liteActive() {
    const m = settings.perfMode || "auto";
    if (m === "lite") return true;
    if (m === "rich") return false;
    return isWeakDevice(); // auto
  }

  /* ── Адаптивная деградация: лесенка уровней (наименьшая потеря визуала первой) ──
     0 — всё включено
     1 — убрать backdrop-filter (дорогой blur, минимальная потеря)
     2 — + лёгкие тени
     3 — + без анимаций и плоский фон (максимум скорости) */
  const PERF_MAX = 3;
  let perfLevel = 0;
  function computeStartLevel() {
    const m = settings.perfMode || "auto";
    if (m === "rich") return 0;
    if (m === "lite") return PERF_MAX;
    if (settings.perfLevelLearned != null) return Math.max(0, Math.min(PERF_MAX, Number(settings.perfLevelLearned) || 0));
    return isWeakDevice() ? 2 : 0; // auto, ещё не училось — прикидка по устройству
  }
  function applyPerfLevel(n) {
    perfLevel = Math.max(0, Math.min(PERF_MAX, Number(n) || 0));
    const b = document.body; if (!b) return;
    b.dataset.perfLevel = String(perfLevel);
    b.dataset.noblur = perfLevel >= 1 ? "1" : "";
    b.dataset.flatshadow = perfLevel >= 2 ? "1" : "";
    b.dataset.noanim = perfLevel >= 3 ? "1" : "";
  }
  let _monitorOn = false;
  function startPerfMonitor() {
    if (_monitorOn || typeof requestAnimationFrame !== "function") return;
    _monitorOn = true;
    const nowMs = () => (window.performance && performance.now ? performance.now() : Date.now());
    let sampling = false, frames = 0, dropped = 0, last = 0, until = 0;
    function frame(now) {
      if (last) { const dt = now - last; frames++; if (dt > 34) dropped++; } // >34мс ≈ ниже 30 fps
      last = now;
      if (now < until) requestAnimationFrame(frame);
      else { judge(); sampling = false; last = 0; }
    }
    function judge() {
      if ((settings.perfMode || "auto") === "auto" && frames >= 18 && dropped / frames > 0.28 && perfLevel < PERF_MAX) {
        applyPerfLevel(perfLevel + 1);
        settings.perfLevelLearned = perfLevel;
        save();
      }
      frames = 0; dropped = 0;
    }
    function kick(ms) {
      until = nowMs() + (ms || 600);
      if (!sampling) { sampling = true; frames = 0; dropped = 0; last = 0; requestAnimationFrame(frame); }
    }
    try {
      window.addEventListener("scroll", () => kick(600), { passive: true, capture: true });
      window.addEventListener("ep:route-loaded", () => kick(500));
    } catch (e) {}
  }

  function apply(value) {
    settings = normalizeValue(value || settings);
    const theme = themes.find((item) => item.id === settings.themeId) || themes[0];
    const day = dayOverride();
    const root = document.documentElement;
    const body = document.body;

    root.style.setProperty("--bg-a", day.backgroundColor || settings.backgroundColor || theme.bgA);
    root.style.setProperty("--bg-b", activeMode() === "day" ? "#cbdaf0" : theme.bgB);
    root.style.setProperty("--bg-c", activeMode() === "day" ? "#d9f4ef" : theme.bgC);
    root.style.setProperty("--accent", settings.accent || theme.accent);
    root.style.setProperty("--button-bg", settings.buttonColor || settings.accent || theme.accent);
    root.style.setProperty("--text", day.textColor || settings.textColor || theme.text);
    root.style.setProperty("--muted", day.mutedColor || settings.mutedColor || theme.muted);
    root.style.setProperty("--card-opacity", String(day.opacity || settings.opacity));
    root.style.setProperty("--button-opacity", String(settings.buttonOpacity));
    root.style.setProperty("--radius", `${Number(settings.radius || base.radius)}px`);
    root.style.setProperty("--button-radius", `${Number(settings.buttonRadius || base.buttonRadius)}px`);
    root.style.setProperty("--blur", `${Number(settings.blur || base.blur)}px`);
    root.style.setProperty("--font-scale", String(settings.fontScale || 1));
    root.style.setProperty("--text-scale", String(settings.textScale || 1));
    root.style.setProperty("--card-text-scale", String(settings.cardTextScale || 1));
    try { if (window.EP && EP.Icon && EP.Icon.use) EP.Icon.use(settings.iconPack || "emoji"); } catch (e) {}
    root.style.setProperty("--anim-speed", String(settings.animationSpeed || 1));

    const cardRgb = rgb(day.cardColor || settings.cardColor || theme.card);
    if (cardRgb) root.style.setProperty("--card-bg-rgb", `${cardRgb.r}, ${cardRgb.g}, ${cardRgb.b}`);

    if (body) {
      body.dataset.density = settings.density;
      body.dataset.visualMode = activeMode();
      body.dataset.buttonShape = settings.buttonShape;
      body.dataset.animation = settings.animationStyle;
      body.dataset.reduceMotion = settings.reduceMotion ? "true" : "false";
      applyPerfLevel(computeStartLevel());
      body.dataset.electricPulse = settings.electricPulse ? "true" : "false";
      body.dataset.bgStyle = settings.backgroundStyle;
      body.dataset.soundEnabled = settings.soundEnabled ? "true" : "false";
      body.dataset.hapticEnabled = settings.hapticEnabled ? "true" : "false";
    }

    window.SoundAPI?.setSettings?.({
      soundEnabled: settings.soundEnabled,
      hapticEnabled: settings.hapticEnabled,
      volume: settings.soundVolume,
      soundVolume: settings.soundVolume,
      style: settings.soundStyle,
      soundStyle: settings.soundStyle,
      hapticPattern: settings.hapticPattern
    });
  }

  function themeButton(theme) {
    const active = settings.themeId === theme.id ? "active" : "";
    return `
      <button class="theme-btn ep-clickable ${active}" type="button" data-theme="${theme.id}" style="background:linear-gradient(135deg,${theme.bgA},${theme.bgB},${theme.bgC})">
        <strong>${theme.name}</strong>
        <small>${theme.id}</small>
      </button>
    `;
  }

  function modeButton(id, label) {
    const active = settings.mode === id ? "active" : "";
    return `<button class="${active}" type="button" data-visual-mode="${id}">${label}</button>`;
  }

  function profileButton(id, label) {
    const active = settings.profile === id ? "active" : "";
    return `<button class="${active}" type="button" data-profile="${id}">${label}</button>`;
  }

  function switchControl(id, key, label) {
    const checked = settings[key] ? "checked" : "";
    return `
      <label class="switch-row" for="${id}">
        <span>${label}</span>
        <input id="${id}" type="checkbox" data-visual-key="${key}" ${checked} />
        <i aria-hidden="true"></i>
      </label>
    `;
  }

  function colorControl(id, key, label) {
    return `<label>${label}<input id="${id}" type="color" data-visual-key="${key}" value="${settings[key] || base[key]}" /></label>`;
  }

  function rangeControl(id, key, label, min, max, step) {
    return `
      <label>${label}
        <input id="${id}" type="range" data-visual-key="${key}" min="${min}" max="${max}" step="${step}" value="${settings[key]}" />
        <small data-range-value="${key}">${settings[key]}</small>
      </label>
    `;
  }

  function selectControl(id, key, label, options) {
    const items = options.map(([value, text]) => `<option value="${value}" ${settings[key] === value ? "selected" : ""}>${text}</option>`).join("");
    return `<label>${label}<select id="${id}" data-visual-key="${key}">${items}</select></label>`;
  }

  function setThemeColors(id) {
    const t = themes.find((x) => x.id === id) || themes[0];
    Object.assign(settings, { themeId: t.id, accent: t.accent, buttonColor: t.accent, backgroundColor: t.bgA, cardColor: t.card, textColor: t.text, mutedColor: t.muted });
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

    if (profile === "flagship") { // мощные: максимум стекла
      setThemeColors("midnight");
      Object.assign(settings, { mode: "night", perfMode: "rich", backgroundStyle: "glass", blur: 20, opacity: 0.68, buttonShape: "soft", animationStyle: "premium", animationSpeed: 1.1, radius: 24, buttonRadius: 16, fontScale: 1, textScale: 1, cardTextScale: 1, reduceMotion: false, electricPulse: false, perfLevelLearned: null });
    }
    if (profile === "neonpro") { // мощные: неон
      setThemeColors("cyber");
      Object.assign(settings, { mode: "night", perfMode: "rich", backgroundStyle: "neon", blur: 18, opacity: 0.66, buttonShape: "pill", animationStyle: "spring", animationSpeed: 1.0, radius: 20, buttonRadius: 18, electricPulse: true, reduceMotion: false, perfLevelLearned: null });
    }
    if (profile === "paper") { // слабые: чистая «бумага»
      setThemeColors("mono");
      Object.assign(settings, { mode: "day", perfMode: "lite", backgroundStyle: "light", blur: 0, opacity: 0.95, buttonShape: "round", animationStyle: "minimal", animationSpeed: 0.6, radius: 16, textColor: "#0f172a", mutedColor: "#475569", cardColor: "#ffffff", reduceMotion: true, electricPulse: false });
    }
    if (profile === "minimal") { // слабые: плоский тёмный минимал
      setThemeColors("slate");
      Object.assign(settings, { mode: "night", perfMode: "lite", backgroundStyle: "solid", blur: 0, opacity: 0.96, buttonShape: "minimal", animationStyle: "off", animationSpeed: 0.6, radius: 14, reduceMotion: true, electricPulse: false });
    }

    commit();
  }

  function commit() {
    save();
    apply();
    render();
    window.SoundAPI?.click?.();
  }

  function resetKeepTheme() {
    const themeId = settings.themeId;
    const mode = settings.mode;
    settings = Object.assign({}, base, { themeId, mode });
    const theme = themes.find((item) => item.id === themeId) || themes[0];
    Object.assign(settings, {
      accent: theme.accent,
      buttonColor: theme.accent,
      backgroundColor: theme.bgA,
      cardColor: theme.card,
      textColor: theme.text,
      mutedColor: theme.muted
    });
    commit();
  }

  function baseReset() {
    settings = Object.assign({}, base);
    commit();
  }

  function render() {
    const root = document.getElementById("visual-settings-root");
    if (!root) return;

    root.innerHTML = `
      <section class="page visual-settings-page">
        <div class="page-head">
          <h1>Настройки визуала</h1>
          <p>Перенесённый модуль из основного проекта: темы, режимы, профили, цвета, прозрачность, скругления, анимации, звук и отклик.</p>
        </div>

        <div class="card visual-card">
          <div class="visual-section">
            <p class="visual-section-title">Готовые темы</p>
            <div class="theme-grid">${themes.map(themeButton).join("")}</div>
          </div>

          <div class="visual-section">
            <p class="visual-section-title">Режим отображения</p>
            <div class="segmented-control">
              ${modeButton("night", "Ночь")}
              ${modeButton("day", "День")}
              ${modeButton("auto", "Авто")}
            </div>
          </div>

          <div class="visual-section">
            <p class="visual-section-title">Быстрые профили</p>
            <div class="quick-profile-grid">
              ${profileButton("night", "Ночной")}
              ${profileButton("object", "На объекте")}
              ${profileButton("day", "Дневной")}
              ${profileButton("battery", "Эконом")}
              ${profileButton("premium", "Премиум")}
              ${profileButton("readable", "Читабельно")}
            </div>
          </div>

          <button id="toggleAdvancedVisualBtn" class="btn btn-ghost btn-wide ep-clickable" type="button">
            ${settings.advancedOpen ? "Скрыть расширенную настройку" : "Расширенная настройка"}
          </button>

          <div id="advancedVisualPanel" class="advanced-visual-panel ${settings.advancedOpen ? "" : "hidden"}">
            <div class="visual-section">
              <p class="visual-section-title">Цвета</p>
              <div class="settings-grid grid-2">
                ${colorControl("accentColorInput", "accent", "Акцентный цвет")}
                ${colorControl("buttonColorInput", "buttonColor", "Цвет кнопок")}
                ${colorControl("textColorInput", "textColor", "Текст")}
                ${colorControl("mutedColorInput", "mutedColor", "Вторичный текст")}
                ${colorControl("backgroundColorInput", "backgroundColor", "Фон")}
                ${colorControl("cardColorInput", "cardColor", "Карточки")}
              </div>
            </div>

            <div class="visual-section">
              <p class="visual-section-title">Стекло и размеры</p>
              <div class="settings-grid grid-2">
                ${rangeControl("glassOpacityInput", "opacity", "Прозрачность карточек", 0.35, 0.95, 0.01)}
                ${rangeControl("buttonOpacityInput", "buttonOpacity", "Плотность кнопок", 0.35, 1, 0.01)}
                ${rangeControl("radiusInput", "radius", "Скругление карточек", 8, 34, 1)}
                ${rangeControl("buttonRadiusInput", "buttonRadius", "Скругление кнопок", 6, 30, 1)}
                ${rangeControl("blurInput", "blur", "Размытие стекла", 0, 28, 1)}
                ${rangeControl("fontScaleInput", "fontScale", "Масштаб интерфейса", 0.85, 1.35, 0.05)}
                ${rangeControl("textScaleInput", "textScale", "Размер текста", 0.8, 1.4, 0.05)}
                ${rangeControl("cardTextScaleInput", "cardTextScale", "Размер текста в карточках", 0.8, 1.4, 0.05)}
              </div>
            </div>

            <div class="visual-section">
              <p class="visual-section-title">Поведение интерфейса</p>
              <div class="settings-grid grid-2">
                ${selectControl("perfModeInput", "perfMode", "Производительность", [["auto", "Авто (адаптивно)"], ["lite", "Лёгкий (быстро)"], ["rich", "Красиво (стекло)"]])}
                ${selectControl("iconPackInput", "iconPack", "Набор значков", [["emoji", "Эмодзи"], ["line", "Контур"], ["mono", "Минимал"]])}
                ${selectControl("densityInput", "density", "Плотность", [["compact", "Компактно"], ["normal", "Обычно"], ["large", "Крупнее"]])}
                ${selectControl("buttonShapeInput", "buttonShape", "Форма кнопок", [["soft", "Мягкая"], ["round", "Круглая"], ["pill", "Пилюля"], ["square", "Квадратнее"], ["minimal", "Минимальная"]])}
                ${selectControl("backgroundStyleInput", "backgroundStyle", "Стиль фона", [["glass", "Стекло"], ["gradient", "Градиент"], ["blueprint", "Чертёж"], ["dark", "Тёмный"], ["light", "Светлый"], ["solid", "Сплошной"], ["minimal", "Минимальный"], ["neon", "Неон"]])}
                ${selectControl("animationStyleInput", "animationStyle", "Анимация", [["soft", "Мягкая"], ["fast", "Быстрая"], ["spring", "Пружина"], ["premium", "Премиум"], ["minimal", "Минимальная"], ["off", "Без анимации"]])}
                ${rangeControl("animationSpeedInput", "animationSpeed", "Скорость анимации", 0.4, 1.6, 0.05)}
                ${selectControl("soundStyleInput", "soundStyle", "Звуковой эффект", [
                  ["glass", "Стекло"],
                  ["soft", "Мягкий"],
                  ["short", "Короткий"],
                  ["tick", "Тик"],
                  ["switch", "Выключатель"],
                  ["relay", "Реле"],
                  ["breaker", "Автомат"],
                  ["electric-soft", "Электро мягкий"],
                  ["electric-sharp", "Электро резкий"],
                  ["spark", "Искра"],
                  ["chime", "Звонок"],
                  ["double", "Двойной"],
                  ["deep", "Глубокий"],
                  ["sci-fi", "Техно"],
                  ["silent", "Без звука"]
                ])}
                ${selectControl("hapticPatternInput", "hapticPattern", "Вибро-рисунок", [["light", "Лёгкий"], ["medium", "Средний"], ["strong", "Сильный"], ["double", "Двойной"], ["pulse", "Импульс"]])}
                ${rangeControl("soundVolumeInput", "soundVolume", "Громкость", 0, 1, 0.01)}
              </div>
            </div>

            <div class="visual-section">
              <p class="visual-section-title">Отклик</p>
              <div class="settings-grid">
                ${switchControl("reduceMotionInput", "reduceMotion", "Уменьшить анимации")}
                ${switchControl("electricPulseInput", "electricPulse", "Электро-импульс на кнопках")}
                ${switchControl("soundEnabledInput", "soundEnabled", "Звуки интерфейса")}
                ${switchControl("hapticEnabledInput", "hapticEnabled", "Виброотклик")}
              </div>
            </div>

            <div class="modal-actions">
              <button id="testSoundBtn" class="btn btn-ghost ep-clickable" type="button">Проверить звук и вибро</button>
              <button id="resetVisualBtn" class="btn btn-ghost ep-clickable" type="button">Сбросить текущую тему</button>
              <button id="baseVisualBtn" class="btn btn-danger ep-clickable" type="button">Вернуть базовый визуал</button>
            </div>
          </div>
        </div>
      </section>
    `;

    bind(root);
  }

  function bind(root) {
    root.querySelectorAll("[data-theme]").forEach((button) => {
      button.addEventListener("click", () => {
        const theme = themes.find((item) => item.id === button.dataset.theme) || themes[0];
        settings = Object.assign({}, settings, {
          themeId: theme.id,
          accent: theme.accent,
          buttonColor: theme.accent,
          backgroundColor: theme.bgA,
          cardColor: theme.card,
          textColor: theme.text,
          mutedColor: theme.muted
        });
        const preset = themePresets[theme.id];
        if (preset) settings = Object.assign({}, settings, preset);
        commit();
      });
    });

    root.querySelectorAll("[data-visual-mode]").forEach((button) => {
      button.addEventListener("click", () => {
        settings.mode = button.dataset.visualMode;
        commit();
      });
    });

    root.querySelectorAll("[data-profile]").forEach((button) => {
      button.addEventListener("click", () => applyProfile(button.dataset.profile));
    });

    root.querySelectorAll("[data-visual-key]").forEach((input) => {
      const handler = () => {
        try {
          let value = input.type === "checkbox" ? input.checked : input.value;
          if (input.type === "range") value = Number(value);
          settings[input.dataset.visualKey] = value;
          save();
          apply();
          const valueNode = root.querySelector(`[data-range-value="${input.dataset.visualKey}"]`);
          if (valueNode) valueNode.textContent = String(value);
        } catch (e) {}
      };
      input.addEventListener("input", handler);
      input.addEventListener("change", handler);
    });

    root.querySelector("#toggleAdvancedVisualBtn")?.addEventListener("click", () => {
      settings.advancedOpen = !settings.advancedOpen;
      commit();
    });

    root.querySelector("#testSoundBtn")?.addEventListener("click", async () => {
      await window.SoundAPI?.unlock?.();
      const wasEnabled = settings.soundEnabled;
      settings.soundEnabled = true;
      window.SoundAPI?.setSettings?.({ soundEnabled: true, hapticEnabled: settings.hapticEnabled, volume: settings.soundVolume, soundVolume: settings.soundVolume, style: settings.soundStyle, soundStyle: settings.soundStyle, hapticPattern: settings.hapticPattern });
      window.SoundAPI?.test?.(settings.soundStyle, settings.hapticPattern);
      setTimeout(() => {
        settings.soundEnabled = wasEnabled;
        apply();
      }, 500);
    });

    root.querySelector("#resetVisualBtn")?.addEventListener("click", resetKeepTheme);
    root.querySelector("#baseVisualBtn")?.addEventListener("click", baseReset);
  }

  function init() {
    apply();
    startPerfMonitor();
    window.addEventListener("ep:route-loaded", (event) => {
      if (event.detail?.route === "settings") render();
      else apply();
    });
  }

  EP.VisualSettings = { init, apply, render, getSettings: () => Object.assign({}, settings) };
  window.VisualSettings = EP.VisualSettings;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
