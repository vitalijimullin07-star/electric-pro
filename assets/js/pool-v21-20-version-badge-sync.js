(function () {
  const FILE = "assets/js/pool-v21-20-version-badge-sync.js";
  const VERSION = "V21.20";

  function diag(level, code, message) {
    const payload = {
      file: FILE,
      module: "PoolV2120VersionBadgeSync",
      functionName: "runtime",
      place: "pool",
      code,
      message
    };
    try {
      if (level === "error") window.Diagnostics?.error?.(payload);
      else window.Diagnostics?.ok?.(payload);
    } catch {}
  }

  function setText(el, value) {
    if (!el) return;
    if ((el.textContent || "").trim() !== value) el.textContent = value;
  }

  function syncPoolHeaderBadge() {
    const screen = document.getElementById("ep-pool-v21-screen");
    if (!screen) return;

    const badges = [
      ".p2114-head b",
      ".p2113-head b",
      ".p21-7-head b",
      ".ep-pool-v21-db",
      "#ep-pool-v21-db-pill"
    ];

    badges.forEach(sel => {
      screen.querySelectorAll(sel).forEach(el => setText(el, VERSION));
    });
  }

  function syncMainCards() {
    try {
      window.ModuleVersionBadgesV212?.setVersion?.("pool", VERSION);
      window.ModuleVersionBadgesV212?.setVersion?.("rough", VERSION);
      window.ModuleVersionBadgesV212?.apply?.();
    } catch {}

    // Страховка: ищем карточки главного экрана по тексту.
    document.querySelectorAll("button, a, div, section, article").forEach(el => {
      const txt = (el.textContent || "").toLowerCase();
      if (!txt.includes("пул розеток") && !txt.includes("штроб")) return;

      const candidates = el.querySelectorAll("b, small, span, .module-version, .version, [data-module-version]");
      candidates.forEach(c => {
        const t = (c.textContent || "").trim();
        if (/^v\d+/i.test(t)) setText(c, VERSION);
      });
    });
  }

  function patchPoolOpen() {
    if (!window.PoolV21 || window.PoolV21.__v2120VersionPatched) return false;

    const oldOpen = window.PoolV21.open?.bind(window.PoolV21);
    window.PoolV21.open = function (...args) {
      const result = oldOpen ? oldOpen(...args) : undefined;
      setTimeout(syncAll, 20);
      setTimeout(syncAll, 150);
      setTimeout(syncAll, 500);
      setTimeout(syncAll, 1200);
      return result;
    };

    window.PoolV21.__v2120VersionPatched = true;
    return true;
  }

  function syncAll() {
    patchPoolOpen();
    syncPoolHeaderBadge();
    syncMainCards();

    try {
      window.EP_POOL_VERSION = VERSION;
      window.POOL_VERSION = VERSION;
    } catch {}
  }

  function init() {
    syncAll();

    // Старые модули могут перетирать версию поздней перерисовкой — несколько контрольных проходов.
    [300, 800, 1500, 3000, 5000].forEach(ms => setTimeout(syncAll, ms));

    window.PoolV2120VersionBadgeSync = {
      version: VERSION,
      syncAll,
      syncPoolHeaderBadge,
      syncMainCards
    };

    diag("ok", "pool-v21-20-ready", "Pool V21.20 version badge sync ready.");
  }

  window.addEventListener("DOMContentLoaded", init);
})();
