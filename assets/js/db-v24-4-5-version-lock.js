(function () {
  const VERSION = "V24.4.5";
  const FILE = "assets/js/db-v24-4-5-version-lock.js";

  function log(code, message, extra = {}) {
    try {
      window.DbDiagnosticsDotV2443?.addLog?.("info", code, message, extra);
    } catch (e) {}

    try {
      window.Diagnostics?.ok?.({
        file: FILE,
        module: "DbVersionLockV2445",
        functionName: "runtime",
        place: "database",
        code,
        message,
        ...extra
      });
    } catch (e) {}
  }

  function dbScreen() {
    return document.getElementById("ep-db-v244-screen") ||
           document.getElementById("ep-db-v243-screen");
  }

  function visible(el) {
    return !!(el && !el.classList.contains("hidden") && getComputedStyle(el).display !== "none");
  }

  function dbVisible() {
    return visible(dbScreen());
  }

  function statusText() {
    const s = dbScreen();
    return s?.querySelector("#db244-save-status,.db244-save-status,#db2433-save-status,.db2433-save-status")?.textContent?.trim() || "";
  }

  function hasDbError() {
    return /ошибка|не удалось|недоступ|denied|permission|failed|unavailable/i.test(statusText());
  }

  function normalizeHeaderText(txt) {
    txt = String(txt || "").trim();

    let role = "БД";
    if (/админ/i.test(txt)) role = "Админ";
    else if (/мастер/i.test(txt)) role = "Мастер";
    else if (/admin/i.test(txt)) role = "Админ";

    return role + " · " + VERSION;
  }

  function forceVersionEverywhere() {
    const s = dbScreen();
    if (!s) return;

    const p = s.querySelector(".db244-head p,.db243-head p");
    if (p && p.textContent !== normalizeHeaderText(p.textContent)) {
      p.textContent = normalizeHeaderText(p.textContent);
    }

    const head = s.querySelector(".db244-head,.db243-head");
    if (head) {
      let dot = head.querySelector("#db2445-head-diag-dot") || head.querySelector("#db2444-head-diag-dot");
      if (!dot) {
        dot = document.createElement("button");
        dot.id = "db2445-head-diag-dot";
        dot.type = "button";
        dot.title = "Диагностика БД";
        dot.setAttribute("aria-label", "Диагностика БД");
        dot.innerHTML = "<span></span>";
        head.appendChild(dot);
      }
      dot.dataset.state = hasDbError() ? "error" : "ok";
    }

    // Чистим плавающую точку V24.4.3, если она перекрывает экран.
    const oldFloating = document.getElementById("db2443-diag-dot");
    if (oldFloating) oldFloating.classList.add("db2445-hide-floating-dot");

    // Обновляем бейдж БД в меню, но только у строки "База данных".
    document.querySelectorAll("button,a,.menu-item,.nav-item").forEach(row => {
      const t = row.textContent || "";
      if (!/база данных/i.test(t)) return;
      const badge = row.querySelector(".db244-menu-badge,.v2432-db-badge,.module-version-badge,.version-badge,[class*='badge']");
      if (badge) badge.textContent = VERSION;
    });

    try {
      if (window.DatabaseV24CleanMonolith) window.DatabaseV24CleanMonolith.version = VERSION;
      if (window.DatabaseFileManagerV243) window.DatabaseFileManagerV243.version = VERSION;
      window.ModuleVersionBadgesV212?.setVersion?.("database", VERSION);
    } catch (e) {}
  }

  function openDiagnostics() {
    if (window.DbDiagnosticsDotV2443?.openPanel) {
      window.DbDiagnosticsDotV2443.openPanel();
      return;
    }

    alert(
      "Диагностика БД не найдена.\n\n" +
      "Видимая версия: " + VERSION + "\n" +
      "Статус БД: " + (statusText() || "нет статуса") + "\n\n" +
      "Проверь подключение db-v24-4-3-diagnostics-dot.js."
    );
  }

  function patchDbOpen() {
    const mods = [
      window.DatabaseV24CleanMonolith,
      window.DatabaseFileManagerV243
    ].filter(Boolean);

    mods.forEach(mod => {
      if (!mod || mod.__v2445VersionLockPatched || typeof mod.open !== "function") return;

      const oldOpen = mod.open.bind(mod);
      mod.open = function (...args) {
        const result = oldOpen(...args);
        [0, 80, 180, 400, 800, 1400, 2400].forEach(ms => setTimeout(forceVersionEverywhere, ms));
        return result;
      };

      mod.version = VERSION;
      mod.__v2445VersionLockPatched = true;
    });
  }

  function patchBadges() {
    const b = window.ModuleVersionBadgesV212;
    if (!b || b.__v2445VersionLockPatched) return;

    ["apply", "applyBadges", "render"].forEach(name => {
      if (typeof b[name] !== "function") return;
      const old = b[name].bind(b);
      b[name] = function (...args) {
        const result = old(...args);
        setTimeout(forceVersionEverywhere, 0);
        setTimeout(forceVersionEverywhere, 120);
        return result;
      };
    });

    try { b.setVersion?.("database", VERSION); } catch (e) {}
    b.__v2445VersionLockPatched = true;
  }

  function bind() {
    if (window.__db2445VersionLockBound) return;
    window.__db2445VersionLockBound = true;

    document.addEventListener("click", function (event) {
      if (event.target.closest("#db2445-head-diag-dot,#db2444-head-diag-dot")) {
        event.preventDefault();
        event.stopPropagation();
        openDiagnostics();
        return;
      }

      if (event.target.closest("[data-db244-open],[data-db243-open],[data-db-v24-open]")) {
        [80, 250, 700, 1300].forEach(ms => setTimeout(forceVersionEverywhere, ms));
      }
    }, true);
  }

  function startLightWatchdog() {
    if (window.__db2445VersionLockTimer) return;

    // Лёгкая проверка только нескольких элементов шапки БД.
    // Нужна потому, что старый слой иногда перерисовывает шапку уже после открытия.
    window.__db2445VersionLockTimer = setInterval(function () {
      patchDbOpen();
      patchBadges();
      if (dbVisible()) forceVersionEverywhere();
    }, 700);
  }

  function observe() {
    if (window.__db2445VersionLockObserver) return;

    const obs = new MutationObserver(function () {
      clearTimeout(window.__db2445VersionLockDebounce);
      window.__db2445VersionLockDebounce = setTimeout(function () {
        patchDbOpen();
        patchBadges();
        if (dbVisible()) forceVersionEverywhere();
      }, 90);
    });

    obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style"] });
    window.__db2445VersionLockObserver = obs;
  }

  function boot() {
    bind();
    patchDbOpen();
    patchBadges();
    forceVersionEverywhere();
    observe();
    startLightWatchdog();
  }

  window.addEventListener("DOMContentLoaded", function () {
    boot();
    [300, 900, 1800, 3500].forEach(ms => setTimeout(boot, ms));
  });

  window.DbVersionLockV2445 = { version: VERSION, boot, forceVersionEverywhere, openDiagnostics };

  log("db-version-lock-v24-4-5-ready", "Сторож версии БД V24.4.5 готов.");
})();
