(function () {
  const VERSION = "V22.6.2";
  const FILE = "assets/js/pool-v22-6-1-version-lock-fix.js";

  function diag(code, message, extra = {}) {
    try {
      window.Diagnostics?.ok?.({
        file: FILE,
        module: "PoolV2261VersionLockFix",
        functionName: "runtime",
        place: "pool-db-picker",
        code,
        message,
        ...extra
      });
    } catch (e) {}
  }

  function markVersion() {
    try {
      window.ModuleVersionBadgesV212?.setVersion?.("pool", VERSION);
      window.ModuleVersionBadgesV212?.setVersion?.("rough", VERSION);
      window.ModuleVersionBadgesV212?.apply?.();
    } catch (e) {}

    document.querySelectorAll("#ep-pool-v22-screen .p22-head b").forEach(el => {
      el.textContent = VERSION;
    });

    const panel = document.getElementById("p224-db-result");
    if (panel) {
      panel.querySelectorAll(".p224-summary span").forEach(el => {
        if ((el.textContent || "").startsWith("V22.")) el.textContent = VERSION;
      });
    }
  }

  function decorateRowsAgain() {
    try {
      window.PoolV226ManualDbCandidatePicker?.decorateRows?.();
    } catch (e) {}
  }

  function patchOpen() {
    if (!window.PoolV22CleanMonolith || window.PoolV22CleanMonolith.__v2261VersionLockPatched) return;

    const oldOpen = window.PoolV22CleanMonolith.open.bind(window.PoolV22CleanMonolith);

    window.PoolV22CleanMonolith.open = function () {
      const result = oldOpen();
      [80, 250, 700, 1200, 2200].forEach(ms => {
        setTimeout(function () {
          markVersion();
          decorateRowsAgain();
        }, ms);
      });
      return result;
    };

    window.PoolV22CleanMonolith.__v2261VersionLockPatched = true;
  }

  function patchPickerClicks() {
    if (window.__v2261PickerClickLock) return;
    window.__v2261PickerClickLock = true;

    document.addEventListener("click", function (event) {
      if (!event.target.closest("#ep-pool-v22-screen")) return;
      if (!event.target.closest("[data-p22-pick-db], [data-p224-pick], [data-p225-pick]")) return;

      [100, 350, 850, 1400, 2400].forEach(ms => {
        setTimeout(function () {
          markVersion();
          decorateRowsAgain();
        }, ms);
      });
    }, true);
  }

  function boot() {
    patchOpen();
    patchPickerClicks();
    markVersion();
    decorateRowsAgain();
  }

  window.addEventListener("DOMContentLoaded", function () {
    boot();
    [300, 800, 1500, 2500, 4000].forEach(ms => setTimeout(boot, ms));
  });

  window.PoolV2261VersionLockFix = {
    version: VERSION,
    markVersion,
    boot
  };

  diag("pool-v22-6-1-ready", "V22.6.1 version lock ready.");
})();
