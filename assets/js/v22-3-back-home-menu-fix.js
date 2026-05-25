(function () {
  const VERSION = "V22.3";

  function isPoolOpen() {
    const pool = document.getElementById("ep-pool-v22-screen");
    return pool && !pool.classList.contains("hidden") && pool.style.display !== "none";
  }

  function closePoolToHome() {
    const pool = document.getElementById("ep-pool-v22-screen");
    if (pool) {
      pool.classList.add("hidden");
      pool.style.display = "none";
    }

    document.body.classList.remove("ep-pool-open");

    if (window.Router && typeof window.Router.load === "function") {
      try {
        window.Router.load("home");
        return true;
      } catch (e) {}
    }

    const homeSelectors = [
      "#home-screen",
      "#main-screen",
      "#dashboard-screen",
      ".home-screen",
      ".main-screen",
      "[data-screen='home']",
      "[data-route='home']"
    ];

    homeSelectors.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => {
        el.classList.remove("hidden");
        if (el.style.display === "none") el.style.display = "";
      });
    });

    return true;
  }

  function pushPoolHistory() {
    if (!isPoolOpen()) return;

    if (history.state && history.state.epPoolV22) return;

    try {
      history.pushState(
        { epPoolV22: true, screen: "pool" },
        "",
        location.href
      );
    } catch (e) {}
  }

  function patchPoolOpen() {
    if (!window.PoolV22CleanMonolith || window.PoolV22CleanMonolith.__backHomePatched) return;

    const oldOpen = window.PoolV22CleanMonolith.open.bind(window.PoolV22CleanMonolith);

    window.PoolV22CleanMonolith.open = function () {
      const result = oldOpen();
      document.body.classList.add("ep-pool-open");
      setTimeout(pushPoolHistory, 50);
      setTimeout(pushPoolHistory, 300);
      return result;
    };

    window.PoolV22CleanMonolith.__backHomePatched = true;
  }

  function handleBackButton() {
    window.addEventListener("popstate", function () {
      if (isPoolOpen()) {
        closePoolToHome();
      }
    });
  }

  function openHome() {
    const oldPool = document.getElementById("ep-pool-v22-screen");
    if (oldPool) {
      oldPool.classList.add("hidden");
      oldPool.style.display = "none";
    }

    if (window.Router && typeof window.Router.load === "function") {
      try {
        window.Router.load("home");
      } catch (e) {}
    }

    const menu = document.querySelector(".sidebar, .side-menu, .drawer, .burger-menu, #side-menu, #drawer, [data-menu]");
    if (menu) {
      menu.classList.remove("open", "active", "show");
    }

    document.body.classList.remove("menu-open", "drawer-open", "ep-pool-open");
  }

  function addHomeButtonToBurger() {
    const candidates = [
      document.querySelector("#side-menu"),
      document.querySelector("#drawer"),
      document.querySelector(".side-menu"),
      document.querySelector(".sidebar"),
      document.querySelector(".drawer"),
      document.querySelector(".burger-menu"),
      document.querySelector("[data-menu]")
    ].filter(Boolean);

    candidates.forEach(menu => {
      if (menu.querySelector("[data-v223-home]")) return;

      const btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("data-v223-home", "1");
      btn.className = "v223-home-btn";
      btn.innerHTML = "🏠 Главный экран";

      btn.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        openHome();
      }, true);

      const firstButton = menu.querySelector("button, a, [role='button']");
      if (firstButton && firstButton.parentElement) {
        firstButton.parentElement.insertBefore(btn, firstButton);
      } else {
        menu.insertBefore(btn, menu.firstChild);
      }
    });
  }

  function patchMainCardsVersion() {
    try {
      window.ModuleVersionBadgesV212?.setVersion?.("pool", VERSION);
      window.ModuleVersionBadgesV212?.setVersion?.("rough", VERSION);
      window.ModuleVersionBadgesV212?.apply?.();
    } catch (e) {}

    document.querySelectorAll("#ep-pool-v22-screen .p22-head b").forEach(el => {
      el.textContent = VERSION;
    });
  }

  function boot() {
    patchPoolOpen();
    addHomeButtonToBurger();
    patchMainCardsVersion();
  }

  window.addEventListener("DOMContentLoaded", function () {
    handleBackButton();
    boot();

    setTimeout(boot, 300);
    setTimeout(boot, 1000);
    setTimeout(boot, 2500);
    setTimeout(boot, 5000);
  });

  window.V223BackHomeMenuFix = {
    version: VERSION,
    closePoolToHome,
    openHome,
    addHomeButtonToBurger
  };
})();
