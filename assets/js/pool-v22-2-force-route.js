(function () {
  const VERSION = "V22.2";

  function openPoolV22() {
    if (window.PoolV22CleanMonolith && typeof window.PoolV22CleanMonolith.open === "function") {
      window.PoolV22CleanMonolith.open();
      return true;
    }

    console.warn("[Pool V22.2] PoolV22CleanMonolith.open не найден");
    return false;
  }

  function isPoolTarget(el) {
    if (!el) return false;

    const text = (el.textContent || "").toLowerCase();
    const route = (
      (el.getAttribute && (
        el.getAttribute("data-route") ||
        el.getAttribute("data-module") ||
        el.getAttribute("href") ||
        el.getAttribute("onclick")
      )) || ""
    ).toLowerCase();

    return (
      text.includes("пул розеток") ||
      text.includes("пул розеток/штроб") ||
      text.includes("пул розеток / bim") ||
      text.includes("розетки, выключатели") ||
      route.includes("pool") ||
      route.includes("bim")
    );
  }

  function patchRouter() {
    if (window.Router && typeof window.Router.load === "function" && !window.Router.__poolV22ForcePatched) {
      const oldLoad = window.Router.load.bind(window.Router);

      window.Router.load = function (route, ...args) {
        if (String(route).toLowerCase() === "pool" || String(route).toLowerCase() === "bim") {
          return openPoolV22();
        }

        return oldLoad(route, ...args);
      };

      window.Router.__poolV22ForcePatched = true;
    }

    [
      "openPool",
      "openPoolScreen",
      "openSocketPool",
      "openStrobePool",
      "openBim",
      "openBIM",
      "showPool",
      "showPoolScreen"
    ].forEach(name => {
      try {
        window[name] = openPoolV22;
      } catch (e) {}
    });
  }

  function patchClicks() {
    if (window.__poolV22ForceClickPatched) return;
    window.__poolV22ForceClickPatched = true;

    document.addEventListener("click", function (event) {
      if (event.target.closest("#ep-pool-v22-screen")) return;

      const el = event.target.closest("button,a,[role='button'],[data-route],[data-module],.card,.module-card,section,div");
      if (!isPoolTarget(el)) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      openPoolV22();
    }, true);
  }

  function syncVersion() {
    try {
      if (window.ModuleVersionBadgesV212) {
        window.ModuleVersionBadgesV212.setVersion?.("pool", VERSION);
        window.ModuleVersionBadgesV212.setVersion?.("rough", VERSION);
        window.ModuleVersionBadgesV212.apply?.();
      }
    } catch (e) {}
  }

  function boot() {
    patchRouter();
    patchClicks();
    syncVersion();
  }

  window.addEventListener("DOMContentLoaded", function () {
    boot();
    setTimeout(boot, 300);
    setTimeout(boot, 1000);
    setTimeout(boot, 2500);
  });
})();
