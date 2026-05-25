(function () {
  const VERSION = "V22.5.1";
  const FILE = "assets/js/pool-v22-5-1-force-safe-picker.js";
  const RESULT_KEY = "ep_pool_v22_db_pick_result";

  function diag(code, message, extra = {}) {
    try {
      window.Diagnostics?.ok?.({
        file: FILE,
        module: "PoolV2251ForceSafePicker",
        functionName: "runtime",
        place: "pool-db-picker",
        code,
        message,
        ...extra
      });
    } catch (e) {}
  }

  function clearOldPickResult() {
    try {
      localStorage.removeItem(RESULT_KEY);
    } catch (e) {}
  }

  function removeOldV224Panel() {
    const panel = document.getElementById("p224-db-result");
    if (!panel) return;
    const txt = panel.textContent || "";
    if (txt.includes("V22.4") || txt.includes("ep_pool_v22_db_pick_result")) {
      panel.remove();
    }
  }

  function markVersion() {
    if (window.PoolV226ManualDbCandidatePicker || window.PoolV2261VersionLockFix) return;
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

      const h3 = panel.querySelector("h3");
      if (h3) h3.textContent = "Безопасный подбор из БД";

      panel.querySelectorAll("small").forEach(sm => {
        sm.textContent = (sm.textContent || "").replace(/ep_pool_v22_db_pick_result/g, "safe_db_picker_v22_5_1");
      });
    }
  }

  function runSafePicker() {
    clearOldPickResult();
    removeOldV224Panel();

    if (window.PoolV225SafeDbPicker && typeof window.PoolV225SafeDbPicker.pickDb === "function") {
      window.PoolV225SafeDbPicker.pickDb();
      setTimeout(markVersion, 100);
      setTimeout(markVersion, 400);
      setTimeout(markVersion, 900);
      diag("pool-v22-5-1-safe-picker-run", "Запущен безопасный подбор V22.5.1.");
      return true;
    }

    console.warn("[V22.5.1] PoolV225SafeDbPicker.pickDb не найден");
    diag("pool-v22-5-1-safe-picker-missing", "PoolV225SafeDbPicker.pickDb не найден.");
    return false;
  }

  function interceptPickButtons() {
    if (window.__poolV2251InterceptInstalled) return;
    window.__poolV2251InterceptInstalled = true;

    document.addEventListener("click", function (event) {
      const root = event.target.closest("#ep-pool-v22-screen");
      if (!root) return;

      const btn = event.target.closest("[data-p22-pick-db], [data-p224-pick], [data-p225-pick]");
      if (!btn) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      runSafePicker();
    }, true);
  }

  function patchOldPicker() {
    if (window.PoolV224DbPicker) {
      try {
        window.PoolV224DbPicker.pickDb = runSafePicker;
        window.PoolV224DbPicker.renderResult = function () {};
      } catch (e) {}
    }
  }

  function patchOpen() {
    if (!window.PoolV22CleanMonolith || window.PoolV22CleanMonolith.__v2251Patched) return;

    const oldOpen = window.PoolV22CleanMonolith.open.bind(window.PoolV22CleanMonolith);

    window.PoolV22CleanMonolith.open = function () {
      const result = oldOpen();
      setTimeout(function () {
        removeOldV224Panel();
        markVersion();
      }, 150);
      setTimeout(markVersion, 700);
      return result;
    };

    window.PoolV22CleanMonolith.__v2251Patched = true;
  }

  function boot() {
    clearOldPickResult();
    removeOldV224Panel();
    interceptPickButtons();
    patchOldPicker();
    patchOpen();
    markVersion();
  }

  window.addEventListener("DOMContentLoaded", function () {
    boot();
    setTimeout(boot, 300);
    setTimeout(boot, 1000);
    setTimeout(boot, 2500);
  });

  window.PoolV2251ForceSafePicker = {
    version: VERSION,
    runSafePicker,
    clearOldPickResult,
    removeOldV224Panel
  };
})();
