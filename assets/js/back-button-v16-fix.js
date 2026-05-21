(function () {
  const FILE = "assets/js/back-button-v16-fix.js";

  const HOME_ROUTES = ["home", "main", "dashboard"];
  const SAFE_ROUTES = new Set([
    "home",
    "main",
    "dashboard",
    "subscription",
    "admin",
    "settings",
    "profile",
    "database",
    "materials",
    "works",
    "estimate",
    "supplier",
    "drafts",
    "shield",
    "pool",
    "accounting",
    "warehouse"
  ]);

  let routeStack = [];
  let handlingBack = false;
  let initialized = false;

  function logOk(message) {
    window.Diagnostics?.ok?.({
      file: FILE,
      module: "BackButtonV16Fix",
      functionName: "handleBack()",
      place: "navigation",
      code: "back-button-handled",
      message
    });
  }

  function currentRoute() {
    const hash = String(location.hash || "").replace(/^#\/?/, "").trim();
    if (hash) return hash.split("?")[0].split("/")[0] || "home";

    const bodyRoute =
      document.body?.dataset?.route ||
      document.body?.dataset?.page ||
      document.querySelector("[data-current-route]")?.dataset?.currentRoute ||
      "";

    return bodyRoute || "home";
  }

  function normalizeRoute(route) {
    const r = String(route || "home").replace(/^#\/?/, "").trim();
    return r.split("?")[0].split("/")[0] || "home";
  }

  function isHome(route = currentRoute()) {
    return HOME_ROUTES.includes(normalizeRoute(route));
  }

  function closeTopModalOrMenu() {
    const selectors = [
      "#adminV16LogModal:not(.is-hidden)",
      ".modal:not(.is-hidden)",
      ".dialog:not(.is-hidden)",
      ".popup:not(.is-hidden)",
      ".drawer.open",
      ".drawer.is-open",
      ".side-menu.open",
      ".side-menu.is-open",
      ".menu.open",
      ".menu.is-open",
      "[data-modal].open",
      "[data-modal].is-open"
    ];

    const el = document.querySelector(selectors.join(","));
    if (!el) return false;

    const closeBtn = el.querySelector(
      "[data-v16-log-close], [data-close], .close, .modal-close, .dialog-close, .drawer-close, button[aria-label='Close'], button[aria-label='Закрыть']"
    );

    if (closeBtn) {
      closeBtn.click();
    } else {
      el.classList.add("is-hidden");
      el.classList.remove("open", "is-open", "show", "visible");
      el.setAttribute("hidden", "hidden");
    }

    logOk("Закрыта модалка/меню вместо выхода.");
    return true;
  }

  function goHome() {
    if (window.Router?.navigate) {
      window.Router.navigate("home");
      return true;
    }

    for (const name of ["navigate", "openPage", "showPage", "goTo", "routeTo"]) {
      if (typeof window[name] === "function") {
        window[name]("home");
        return true;
      }
    }

    location.hash = "#home";
    return true;
  }

  function goRoute(route) {
    const r = normalizeRoute(route);

    if (!SAFE_ROUTES.has(r)) {
      return goHome();
    }

    if (window.Router?.navigate) {
      window.Router.navigate(r);
      return true;
    }

    for (const name of ["navigate", "openPage", "showPage", "goTo", "routeTo"]) {
      if (typeof window[name] === "function") {
        window[name](r);
        return true;
      }
    }

    location.hash = "#" + r;
    return true;
  }

  function pushRoute(route) {
    const r = normalizeRoute(route);
    if (!r) return;

    const last = routeStack[routeStack.length - 1];
    if (last !== r) {
      routeStack.push(r);
      if (routeStack.length > 30) routeStack.shift();
    }
  }

  function rememberCurrentRoute() {
    pushRoute(currentRoute());
  }

  function handleBack() {
    if (handlingBack) return;
    handlingBack = true;

    try {
      if (closeTopModalOrMenu()) return;

      const current = currentRoute();

      // Удаляем текущий экран из внутреннего стека, если он сверху.
      if (routeStack[routeStack.length - 1] === current) {
        routeStack.pop();
      }

      const previous = routeStack.pop();

      if (previous && previous !== current) {
        goRoute(previous);
        logOk("Назад внутри приложения: " + previous);
        return;
      }

      if (!isHome(current)) {
        goHome();
        logOk("Назад на главный экран вместо выхода.");
        return;
      }

      // Если уже главный экран — не даём браузеру сразу выйти.
      // Можно позже добавить двойное нажатие для выхода.
      goHome();
      logOk("Кнопка Назад удержана на главном экране.");
    } finally {
      setTimeout(() => {
        handlingBack = false;
      }, 250);
    }
  }

  function patchNavigationFunction(name, owner = window) {
    const fn = owner?.[name];
    if (typeof fn !== "function" || fn.__backV16Patched) return;

    const patched = function (...args) {
      const before = currentRoute();
      const result = fn.apply(this, args);
      const after = normalizeRoute(args[0] || currentRoute());

      if (after && after !== before) {
        pushRoute(before);
      }

      return result;
    };

    patched.__backV16Patched = true;
    owner[name] = patched;
  }

  function patchNavigation() {
    ["navigate", "openPage", "showPage", "goTo", "routeTo"].forEach(name => patchNavigationFunction(name, window));

    if (window.Router) {
      patchNavigationFunction("navigate", window.Router);
    }
  }

  function ensureHistoryTrap() {
    try {
      if (!history.state || !history.state.__epBackGuard) {
        history.replaceState({ ...(history.state || {}), __epBackGuard: true }, "", location.href);
      }

      history.pushState({ __epBackGuard: true, epRoute: currentRoute() }, "", location.href);
    } catch (error) {
      // На некоторых WebView pushState может быть ограничен, тогда работаем хотя бы через hash/router.
    }
  }

  function bindClicksForStack() {
    document.addEventListener("click", event => {
      const el = event.target.closest("[data-route], [data-page], [data-target], [data-section], a[href^='#']");
      if (!el) return;

      const route =
        el.dataset?.route ||
        el.dataset?.page ||
        el.dataset?.target ||
        el.dataset?.section ||
        el.getAttribute("href") ||
        "";

      const r = normalizeRoute(route);
      if (!r || !SAFE_ROUTES.has(r)) return;

      const current = currentRoute();
      if (r !== current) pushRoute(current);
    }, true);
  }

  function init() {
    if (initialized) return;
    initialized = true;

    rememberCurrentRoute();
    patchNavigation();
    bindClicksForStack();
    ensureHistoryTrap();

    window.addEventListener("popstate", event => {
      event.preventDefault?.();

      // Сразу возвращаем ловушку, иначе Android/браузер может выйти из приложения.
      setTimeout(ensureHistoryTrap, 50);
      handleBack();
    });

    window.addEventListener("hashchange", () => {
      if (!handlingBack) {
        rememberCurrentRoute();
      }
    });

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        patchNavigation();
        ensureHistoryTrap();
      }
    });

    window.BackButtonV16Fix = {
      handleBack,
      pushRoute,
      currentRoute,
      stack: () => routeStack.slice()
    };

    window.Diagnostics?.ok?.({
      file: FILE,
      module: "BackButtonV16Fix",
      functionName: "init()",
      place: "navigation",
      code: "back-button-fix-ready",
      message: "Кнопка Назад защищена от выхода из приложения."
    });
  }

  window.addEventListener("DOMContentLoaded", init);
})();
