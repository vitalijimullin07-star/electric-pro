(function () {
  const VERSION = "V24.4.4";
  const FILE = "assets/js/db-v24-4-4-visible-version-dot.js";

  function diag(code, message, extra = {}) {
    try {
      window.Diagnostics?.ok?.({
        file: FILE,
        module: "DbVisibleVersionDotV2444",
        functionName: "runtime",
        place: "database",
        code,
        message,
        ...extra
      });
    } catch (e) {}

    try {
      window.DbDiagnosticsDotV2443?.addLog?.("info", code, message, extra);
    } catch (e) {}
  }

  function dbScreen() {
    return document.getElementById("ep-db-v244-screen") ||
           document.getElementById("ep-db-v243-screen");
  }

  function isVisible(el) {
    return !!(el && !el.classList.contains("hidden") && getComputedStyle(el).display !== "none");
  }

  function saveStatusText() {
    const s = dbScreen();
    return s?.querySelector("#db244-save-status,.db244-save-status,#db2433-save-status,.db2433-save-status")?.textContent?.trim() || "";
  }

  function hasDbError() {
    const status = saveStatusText();
    return /ошибка|не удалось|недоступ|denied|permission|failed|unavailable/i.test(status);
  }

  function forceVisibleVersion() {
    const s = dbScreen();
    if (!s) return;

    const p = s.querySelector(".db244-head p,.db243-head p");
    if (p) {
      let prefix = p.textContent || "";
      prefix = prefix.replace(/V24\.\d+(?:\.\d+)?/g, VERSION);
      if (!prefix.includes(VERSION)) {
        prefix = prefix.replace(/\s*·\s*$/, "");
        prefix = prefix ? `${prefix} · ${VERSION}` : VERSION;
      }
      p.textContent = prefix;
    }

    const menuBadges = document.querySelectorAll(".db244-menu-badge,.v2432-db-badge,.module-version-badge");
    menuBadges.forEach(badge => {
      const rowText = badge.closest("button,a,.menu-item,.nav-item")?.textContent || "";
      if (/база данных/i.test(rowText)) badge.textContent = VERSION;
    });

    try {
      window.ModuleVersionBadgesV212?.setVersion?.("database", VERSION);
      window.ModuleVersionBadgesV212?.apply?.();
    } catch (e) {}
  }

  function ensureHeaderDot() {
    const s = dbScreen();
    if (!s || !isVisible(s)) return;

    const head = s.querySelector(".db244-head,.db243-head");
    if (!head) return;

    let dot = head.querySelector("#db2444-head-diag-dot");
    if (!dot) {
      dot = document.createElement("button");
      dot.id = "db2444-head-diag-dot";
      dot.type = "button";
      dot.title = "Диагностика БД";
      dot.setAttribute("aria-label", "Диагностика БД");
      dot.innerHTML = "<span></span>";
      head.appendChild(dot);
    }

    dot.dataset.state = hasDbError() ? "error" : "ok";
  }

  function openDiagnostics() {
    if (window.DbDiagnosticsDotV2443?.openPanel) {
      window.DbDiagnosticsDotV2443.openPanel();
      return;
    }

    const status = saveStatusText() || "Статус БД не найден";
    alert(
      "Диагностика БД V24.4.3 не найдена.\n\n" +
      "Видимый слой: " + VERSION + "\n" +
      "Статус: " + status + "\n\n" +
      "Проверь подключение db-v24-4-3-diagnostics-dot.js в index.html."
    );
  }

  function patchDbOpen() {
    const mod = window.DatabaseV24CleanMonolith;
    if (!mod || mod.__v2444VisiblePatched) return;

    const oldOpen = typeof mod.open === "function" ? mod.open.bind(mod) : null;
    if (oldOpen) {
      mod.open = function (...args) {
        const result = oldOpen(...args);
        [80, 250, 700, 1200].forEach(ms => setTimeout(refresh, ms));
        return result;
      };
    }

    mod.version = VERSION;
    mod.__v2444VisiblePatched = true;
  }

  function bind() {
    if (window.__db2444VisibleBound) return;
    window.__db2444VisibleBound = true;

    document.addEventListener("click", function (event) {
      if (event.target.closest("#db2444-head-diag-dot")) {
        event.preventDefault();
        event.stopPropagation();
        openDiagnostics();
      }
    }, true);
  }

  function refresh() {
    forceVisibleVersion();
    ensureHeaderDot();

    const oldFloatingDot = document.getElementById("db2443-diag-dot");
    if (oldFloatingDot) oldFloatingDot.classList.add("db2444-hide-old-floating-dot");
  }

  function observe() {
    if (window.__db2444VisibleObserver) return;
    const obs = new MutationObserver(function () {
      clearTimeout(window.__db2444VisibleTimer);
      window.__db2444VisibleTimer = setTimeout(function () {
        patchDbOpen();
        refresh();
      }, 120);
    });
    obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style"] });
    window.__db2444VisibleObserver = obs;
  }

  function boot() {
    bind();
    patchDbOpen();
    refresh();
    observe();
  }

  window.addEventListener("DOMContentLoaded", function () {
    boot();
    [300, 900, 1800, 3500].forEach(ms => setTimeout(boot, ms));
  });

  window.DbVisibleVersionDotV2444 = { version: VERSION, refresh, openDiagnostics };

  diag("db-visible-version-dot-v24-4-4-ready", "Видимая версия и точка диагностики БД готовы.");
})();
