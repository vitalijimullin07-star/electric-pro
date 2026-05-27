(function () {
  const VERSION = "V24.2.1";
  const FILE = "assets/js/database-ui-v24-2-1-version-fix.js";

  function diag(code, message, extra = {}) {
    try {
      window.Diagnostics?.ok?.({
        file: FILE,
        module: "DatabaseUiV2421VersionFix",
        functionName: "runtime",
        place: "database",
        code,
        message,
        ...extra
      });
    } catch (e) {}
  }

  function screen() {
    return document.getElementById("ep-db-v24-screen");
  }

  function isOpen() {
    const s = screen();
    return s && !s.classList.contains("hidden");
  }

  function forceVersion() {
    const s = screen();
    if (!s) return;

    const p = s.querySelector(".db-v24-head p");
    if (p) {
      p.textContent = (p.textContent || "").replace(/V24\.\d+(?:\.\d+)?/g, VERSION);
      if (!p.textContent.includes(VERSION)) p.textContent += " · " + VERSION;
    }

    try {
      window.ModuleVersionBadgesV212?.setVersion?.("database", VERSION);
      window.ModuleVersionBadgesV212?.apply?.();
    } catch (e) {}
  }

  function bootV242() {
    try {
      window.DatabaseUiV242FoldersCards?.boot?.();
    } catch (e) {}
  }

  function patchDatabaseOpen() {
    if (!window.DatabaseCoreV241 || window.DatabaseCoreV241.__v2421Patched) return;

    const oldOpen = window.DatabaseCoreV241.open?.bind(window.DatabaseCoreV241);
    if (typeof oldOpen === "function") {
      window.DatabaseCoreV241.open = function (...args) {
        const result = oldOpen(...args);
        [60, 180, 450, 900, 1600].forEach(ms => {
          setTimeout(function () {
            bootV242();
            forceVersion();
          }, ms);
        });
        return result;
      };
      window.DatabaseCoreV241.__v2421Patched = true;
    }
  }

  function observeDb() {
    if (window.__dbV2421Observer) return;
    const target = document.body;
    if (!target) return;

    let timer = null;
    const obs = new MutationObserver(function () {
      if (!isOpen()) return;
      clearTimeout(timer);
      timer = setTimeout(function () {
        bootV242();
        forceVersion();
      }, 60);
    });

    obs.observe(target, { childList: true, subtree: true, characterData: true });
    window.__dbV2421Observer = obs;
  }

  function boot() {
    patchDatabaseOpen();
    observeDb();
    bootV242();
    forceVersion();
  }

  window.addEventListener("DOMContentLoaded", function () {
    boot();
    [300, 800, 1500, 3000, 5000].forEach(ms => setTimeout(boot, ms));
  });

  window.DatabaseUiV2421VersionFix = {
    version: VERSION,
    boot,
    forceVersion
  };

  diag("database-ui-v24-2-1-ready", "Database UI V24.2.1 version fix ready.");
})();
