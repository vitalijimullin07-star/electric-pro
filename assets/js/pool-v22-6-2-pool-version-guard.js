(function () {
  const VERSION = "V22.6.2";
  const FILE = "assets/js/pool-v22-6-2-pool-version-guard.js";

  const POOL_SELECTORS = [
    "#ep-pool-v22-screen",
    "#p224-db-result"
  ];

  function diag(code, message, extra = {}) {
    try {
      window.Diagnostics?.ok?.({
        file: FILE,
        module: "PoolV2262VersionGuard",
        functionName: "runtime",
        place: "pool",
        code,
        message,
        ...extra
      });
    } catch (e) {}
  }

  function isPoolOpen() {
    const screen = document.getElementById("ep-pool-v22-screen");
    if (!screen) return false;
    return !screen.classList.contains("hidden") && screen.style.display !== "none";
  }

  function forceVersion() {
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
        const t = el.textContent || "";
        if (t.startsWith("V22.") || t.includes("V22.")) el.textContent = VERSION;
      });
    }

    // Иногда в карточках/бейджах версия текстом лежит отдельно.
    document.querySelectorAll("[data-module='pool'] .version, [data-route='pool'] .version, .pool-version, .module-version").forEach(el => {
      if ((el.textContent || "").includes("V22.")) el.textContent = VERSION;
    });
  }

  function decorateManualRows() {
    try { window.PoolV226ManualDbCandidatePicker?.decorateRows?.(); } catch (e) {}
    try { window.PoolV2261VersionLockFix?.markVersion?.(); } catch (e) {}
  }

  function afterPoolMutation(reason) {
    // Старые слои часто рисуют экран повторно с таймерами.
    [0, 60, 180, 420, 900, 1600, 2600].forEach(ms => {
      setTimeout(function () {
        forceVersion();
        decorateManualRows();
      }, ms);
    });

    diag("pool-v22-6-2-version-guard", "Версия пула зафиксирована после действия: " + reason);
  }

  function patchPoolOpen() {
    if (!window.PoolV22CleanMonolith || window.PoolV22CleanMonolith.__v2262VersionGuardPatched) return;

    const oldOpen = window.PoolV22CleanMonolith.open.bind(window.PoolV22CleanMonolith);

    window.PoolV22CleanMonolith.open = function () {
      const result = oldOpen();
      afterPoolMutation("open");
      return result;
    };

    window.PoolV22CleanMonolith.__v2262VersionGuardPatched = true;
  }

  function patchKnownPoolMethods() {
    const pool = window.PoolV22CleanMonolith;
    if (!pool || pool.__v2262MethodsPatched) return;

    [
      "render",
      "renderPool",
      "renderDraft",
      "removeGroup",
      "deleteGroup",
      "clearPool",
      "resetPool",
      "calculate",
      "calculateDraft",
      "addGroup"
    ].forEach(name => {
      if (typeof pool[name] !== "function") return;
      const old = pool[name].bind(pool);
      pool[name] = function (...args) {
        const result = old(...args);
        afterPoolMutation(name);
        return result;
      };
    });

    pool.__v2262MethodsPatched = true;
  }

  function patchClicks() {
    if (window.__v2262PoolClickGuard) return;
    window.__v2262PoolClickGuard = true;

    document.addEventListener("click", function (event) {
      if (!event.target.closest("#ep-pool-v22-screen")) return;

      const text = (event.target.textContent || "") + " " + (event.target.closest("button")?.textContent || "");
      const attr = [
        event.target.getAttribute?.("data-action"),
        event.target.getAttribute?.("data-p22-action"),
        event.target.closest("button")?.getAttribute?.("data-action"),
        event.target.closest("button")?.getAttribute?.("data-p22-action")
      ].filter(Boolean).join(" ");

      if (
        /удал|очист|рассчит|подобр|добав/i.test(text) ||
        /delete|remove|clear|calc|pick|add|reset/i.test(attr)
      ) {
        afterPoolMutation("click");
      }
    }, true);
  }

  function observePool() {
    if (window.__v2262PoolObserver) return;

    const target = document.body;
    if (!target) return;

    let timer = null;
    const observer = new MutationObserver(function (mutations) {
      if (!isPoolOpen()) return;

      const important = mutations.some(m => {
        if (!m.target) return false;
        const el = m.target.nodeType === 1 ? m.target : m.target.parentElement;
        if (!el) return false;
        return POOL_SELECTORS.some(sel => el.closest?.(sel) || el.matches?.(sel));
      });

      if (!important) return;

      clearTimeout(timer);
      timer = setTimeout(function () {
        forceVersion();
        decorateManualRows();
      }, 40);
    });

    observer.observe(target, {
      childList: true,
      subtree: true,
      characterData: true
    });

    window.__v2262PoolObserver = observer;
  }

  function boot() {
    patchPoolOpen();
    patchKnownPoolMethods();
    patchClicks();
    observePool();
    forceVersion();
    decorateManualRows();
  }

  window.addEventListener("DOMContentLoaded", function () {
    boot();

    // Финальный страховочный проход после всех старых setTimeout.
    [250, 700, 1300, 2400, 4200, 7000].forEach(ms => setTimeout(boot, ms));
  });

  window.PoolV2262VersionGuard = {
    version: VERSION,
    forceVersion,
    afterPoolMutation,
    boot
  };

  diag("pool-v22-6-2-ready", "Pool V22.6.2 version guard ready.");
})();
