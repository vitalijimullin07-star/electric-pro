(function () {
  const VERSION = "V25.4.1";
  const FILE = "assets/js/shell-v25-2-stable-db-open.js";

  function log(code, message, extra = {}) {
    try {
      window.Diagnostics?.ok?.({
        file: FILE,
        module: "ShellV252StableDbOpen",
        functionName: "runtime",
        place: "app-shell",
        code,
        message,
        ...extra
      });
    } catch (e) {}
  }

  function normText(v) {
    return String(v || "").toLowerCase().replace(/\s+/g, " ").trim();
  }

  function restorePreviousVisualIfHardShellRendered() {
    document.querySelectorAll(".ep-shell-v245-root").forEach(el => {
      el.classList.remove("ep-shell-v245-root");
      el.classList.add("shell-v252-visual-restored");
    });
  }

  function dbRootVisible() {
    const db = document.getElementById("ep-db-v25-screen");
    if (!db) return false;
    const st = getComputedStyle(db);
    return !db.classList.contains("hidden") && st.display !== "none" && st.visibility !== "hidden";
  }

  function hideOldDatabasePlaceholders() {
    document.querySelectorAll("#ep-db-v244-screen,#ep-db-v243-screen,#ep-db-v24-screen,#ep-database-screen,[data-screen='database']").forEach(el => {
      if (el.id !== "ep-db-v25-screen") el.classList.add("hidden");
    });

    Array.from(document.querySelectorAll("section,main,div")).forEach(el => {
      if (el.closest("#ep-db-v25-screen")) return;
      const text = (el.textContent || "").slice(0, 500);
      if (/База данных/i.test(text) && /Database API|прослойк|Firebase/i.test(text)) {
        el.classList.add("db25-force-hide-old-placeholder");
      }
    });
  }

  function openDbHard() {
    hideOldDatabasePlaceholders();

    let ok = false;

    try {
      if (window.DatabaseV25HardMonolith?.open) {
        window.DatabaseV25HardMonolith.open();
        ok = true;
      }
    } catch (e) {
      log("db-v25-open-error", "Ошибка при открытии DatabaseV25HardMonolith.open()", { error: String(e.message || e) });
    }

    if (!ok) {
      try {
        if (window.DatabaseV24CleanMonolith?.open) {
          window.DatabaseV24CleanMonolith.open();
          ok = true;
        }
      } catch (e) {}
    }

    [60, 180, 400, 900].forEach(ms => setTimeout(() => {
      hideOldDatabasePlaceholders();
      if (!dbRootVisible() && window.DatabaseV25HardMonolith?.open) {
        try { window.DatabaseV25HardMonolith.open(); } catch (e) {}
      }
    }, ms));

    if (ok) log("db-v25-opened", "БД V25.4.1 открыта стабильным маршрутом.");
    return ok;
  }

  function isDatabaseTrigger(el) {
    if (!el) return false;

    const attrs = [
      el.getAttribute?.("data-ep-shell-route"),
      el.getAttribute?.("data-route"),
      el.getAttribute?.("data-screen"),
      el.getAttribute?.("data-db244-open"),
      el.getAttribute?.("data-db243-open"),
      el.getAttribute?.("data-db-v24-open"),
      el.getAttribute?.("onclick"),
      el.className,
      el.id,
      el.href
    ].filter(Boolean).join(" ").toLowerCase();

    const text = normText(el.textContent);

    if (attrs.includes("database") || attrs.includes("db244") || attrs.includes("db243") || attrs.includes("db25")) return true;
    if (text.includes("база данных")) return true;

    return false;
  }

  function findDbTriggerFromEvent(event) {
    const path = event.composedPath ? event.composedPath() : [];
    for (const node of path) {
      if (!(node instanceof Element)) continue;
      if (node === document.body || node === document.documentElement) break;
      if (isDatabaseTrigger(node)) return node;
    }

    let el = event.target instanceof Element ? event.target : null;
    let depth = 0;
    while (el && depth < 10 && el !== document.body) {
      if (isDatabaseTrigger(el)) return el;
      el = el.parentElement;
      depth++;
    }

    return null;
  }

  function stableDbClickHandler(event) {
    const trigger = findDbTriggerFromEvent(event);
    if (!trigger) return;

    const text = normText(trigger.textContent);
    const attrs = [
      trigger.getAttribute?.("data-ep-shell-route"),
      trigger.getAttribute?.("data-route"),
      trigger.getAttribute?.("onclick"),
      trigger.className,
      trigger.id
    ].filter(Boolean).join(" ").toLowerCase();

    if (trigger.closest?.("#ep-db-v25-screen")) return;
    if (!text.includes("база данных") && !attrs.includes("database") && !attrs.includes("db25") && !attrs.includes("db24")) return;

    event.preventDefault();
    event.stopPropagation();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();

    openDbHard();
  }

  function markDbRows() {
    const possible = Array.from(document.querySelectorAll("button,a,[role='button'],.menu-item,.nav-item,li,div"));
    possible.forEach(el => {
      if (el.closest("#ep-db-v25-screen")) return;
      if (!isDatabaseTrigger(el)) return;

      const r = el.getBoundingClientRect();
      const txt = normText(el.textContent);
      if (r.height > 150 && txt.length > 100) return;

      el.setAttribute("data-db25-stable-trigger", "1");

      const badges = el.querySelectorAll("em,.db244-menu-badge,.module-version-badge,.version-badge,.v2432-db-badge,[class*='badge']");
      badges.forEach((b, i) => {
        if (i === 0) {
          b.textContent = "V25.4.1";
          b.style.display = "";
          b.style.visibility = "visible";
        } else {
          b.style.display = "none";
        }
      });
    });
  }

  function patchRouterObject(obj) {
    if (!obj || typeof obj.load !== "function" || obj.__db252Patched) return;
    const old = obj.load.bind(obj);
    obj.load = function (route, ...args) {
      if (/^(database|db|base|data)$/i.test(String(route || ""))) {
        openDbHard();
        return true;
      }
      return old(route, ...args);
    };
    obj.__db252Patched = true;
  }

  function patchRouters() {
    patchRouterObject(window.Router);
    patchRouterObject(window.AppRouter);

    if (window.DatabaseV25HardMonolith) window.DatabaseV25HardMonolith.version = "V25.4.1";

    if (!window.DatabaseV24CleanMonolith) window.DatabaseV24CleanMonolith = {};
    window.DatabaseV24CleanMonolith.open = openDbHard;
    window.DatabaseV24CleanMonolith.version = "V25.4.1";

    if (!window.DatabaseFileManagerV243) window.DatabaseFileManagerV243 = {};
    window.DatabaseFileManagerV243.open = openDbHard;
    window.DatabaseFileManagerV243.version = "V25.4.1";

    try { window.ModuleVersionBadgesV212?.setVersion?.("database", "V25.4.1"); } catch (e) {}
  }

  function bind() {
    if (window.__shellV252StableDbOpenBound) return;
    window.__shellV252StableDbOpenBound = true;

    ["pointerdown", "touchstart", "mousedown", "click"].forEach(type => {
      document.addEventListener(type, stableDbClickHandler, true);
    });
  }

  function boot() {
    bind();
    patchRouters();
    restorePreviousVisualIfHardShellRendered();
    markDbRows();
    hideOldDatabasePlaceholders();
  }

  function observe() {
    if (window.__shellV252StableDbOpenObserver) return;
    const obs = new MutationObserver(() => {
      clearTimeout(window.__shellV252StableDbOpenTimer);
      window.__shellV252StableDbOpenTimer = setTimeout(boot, 120);
    });
    obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style"] });
    window.__shellV252StableDbOpenObserver = obs;
  }

  window.addEventListener("DOMContentLoaded", function () {
    boot();
    observe();
    [250, 800, 1600, 3200].forEach(ms => setTimeout(boot, ms));
  });

  window.ShellV252StableDbOpen = {
    version: VERSION,
    openDbHard,
    boot
  };

  log("shell-v25-2-stable-db-open-ready", "Стабильный маршрут БД V25.4.1 готов, визуал меню не перерисовывается.");
})();
