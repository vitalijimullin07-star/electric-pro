window.EP = window.EP || {};

EP.routes = {
  main: "pages/main.html",
  login: "pages/login.html",
  admin: "pages/admin.html",
  settings: "pages/settings.html",
  subscription: "pages/subscription.html",
  database: "pages/database.html",
  clients: "pages/clients.html",
  materials: "pages/materials.html",
  work: "pages/work.html",
  shield: "pages/shield.html",
  scheme: "pages/scheme.html",
  pool: "pages/pool.html",
  estimate: "pages/estimate.html",
  details: "pages/details.html",
  consumables: "pages/consumables.html",
  profile: "pages/profile.html",
  documents: "pages/documents.html",
  stock: "pages/stock.html",
  costs: "pages/costs.html",
  tools: "pages/tools.html",
  guide: "pages/guide.html",
  whatsnew: "pages/whatsnew.html",
  ai: "pages/ai.html"
};

EP.Router = {
  publicRoutes: new Set(["login"]),

  normalize(route) {
    return EP.routes[route] ? route : "main";
  },

  canOpen(route) {
    if (this.publicRoutes.has(route)) return true;
    if (!EP.Auth?.isReady?.()) return true;
    return EP.Auth?.isAuthenticated?.() === true;
  },

  async go(route, options = {}) {
    route = this.normalize(route);

    if (!this.canOpen(route)) {
      route = "login";
      options.replace = true;
    }

    if (route === "admin" && EP.Auth?.isReady?.() && !EP.Auth?.isAdmin?.()) {
      route = "main";
      options.replace = true;
    }

    if (!options.replace && EP.state.currentRoute && EP.state.currentRoute !== route) {
      EP.state.history.push(EP.state.currentRoute);
    }

    EP.state.currentRoute = route;

    const nextHash = "#/" + route;
    if (location.hash !== nextHash) {
      if (options.replace) history.replaceState({ route }, "", nextHash);
      else history.pushState({ route }, "", nextHash);
    }

    const target = document.querySelector("#pageContent");
    if (!target) return;

    EP.AppShell?.closeDrawer?.();
    window.dispatchEvent(new CustomEvent("ep:route-loading", { detail: { route } }));

    try {
      const __b = (document.querySelector('meta[name="app-build"]') || {}).content || Date.now();
      const res = await fetch(EP.routes[route] + "?v=" + __b, {});
      target.innerHTML = await res.text();
      try { window.scrollTo(0, 0); if (document.scrollingElement) document.scrollingElement.scrollTop = 0; } catch (e) {}
      window.dispatchEvent(new CustomEvent("ep:route-loaded", { detail: { route } }));
    } catch (err) {
      target.innerHTML = `<div class="card"><h2>Ошибка загрузки</h2><p>${route}</p></div>`;
      console.error(err);
      window.dispatchEvent(new CustomEvent("ep:route-error", { detail: { route, error: err } }));
    }
  },

  back() {
    if (EP.AppShell?.isDrawerOpen?.()) {
      EP.AppShell.closeDrawer();
      return;
    }

    const prev = EP.state.history.pop();
    if (prev) {
      this.go(prev, { replace: true });
      return;
    }

    if (EP.state.currentRoute !== "main" && EP.state.currentRoute !== "login") {
      this.go("main", { replace: true });
    }
  },

  init() {
    window.addEventListener("popstate", (event) => {
      event.preventDefault();
      EP.Router.back();
    });

    document.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-route]");
      if (!btn) return;
      event.preventDefault();
      event.stopPropagation();
      EP.Router.go(btn.dataset.route);
    });

    const route = (location.hash || "#/main").replace("#/", "") || "main";
    this.go(route, { replace: true });
  }
};

window.Router = {
  load: (route, options) => EP.Router.go(route, options || {}),
  go: (route, options) => EP.Router.go(route, options || {}),
  navigate: (route, options) => EP.Router.go(route, options || {}),
  back: () => EP.Router.back()
};
