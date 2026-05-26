(function () {
  const VERSION = "V24.5";
  const FILE = "assets/js/app-shell-v24-5-hard-monolith.js";

  const MENU = [
    { key: "home", icon: "🏠", title: "Главный экран", version: "" },
    { key: "database", icon: "📁", title: "База данных", version: VERSION },
    { key: "estimate", icon: "🧾", title: "Черновик сметы", version: "V23.1" },
    { key: "customer", icon: "👤", title: "О заказчике", version: "V10" },
    { key: "ai", icon: "🤖", title: "ИИ функции", version: "V16" },
    { key: "singleline", icon: "📈", title: "Однолинейка и визуализация щита", version: "V11" },
    { key: "documents", icon: "📄", title: "Документы", version: "V10" },
    { key: "accounting", icon: "💰", title: "Бухгалтерия", version: "V10" },
    { key: "warehouse", icon: "📦", title: "Склад", version: "V10" },
    { key: "drafts", icon: "📝", title: "Черновики", version: "V10" },
    { key: "visual", icon: "🎨", title: "Настройка визуала", version: "V10" },
    { key: "diagnostics", icon: "🛠️", title: "Диагностика", version: VERSION }
  ];

  function log(code, message, extra = {}) {
    try {
      window.DbDiagnosticsDotV2443?.addLog?.("info", code, message, extra);
    } catch (e) {}

    try {
      window.Diagnostics?.ok?.({
        file: FILE,
        module: "AppShellV245HardMonolith",
        functionName: "runtime",
        place: "app-shell",
        code,
        message,
        ...extra
      });
    } catch (e) {}
  }

  function esc(v) {
    return String(v ?? "").replace(/[&<>"']/g, c => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[c]));
  }

  function userName() {
    try {
      const p = window.AppState?.profile || window.profile || {};
      if (p.displayName || p.name) return p.displayName || p.name;
    } catch (e) {}

    try {
      const u = window.firebase?.auth?.().currentUser || window.auth?.currentUser;
      if (u?.displayName) return u.displayName;
      if (u?.email) return u.email.split("@")[0];
    } catch (e) {}

    const old = document.querySelector(".ep-shell-v245-root")?.textContent || document.body.textContent || "";
    if (/Виталий/i.test(old)) return "Виталий Имуллин";
    return "Мастер";
  }

  function userRole() {
    try {
      const p = window.AppState?.profile || {};
      if (p.role === "admin" || p.isAdmin) return "admin";
      if (p.role) return p.role;
    } catch (e) {}

    try {
      const email = (window.firebase?.auth?.().currentUser?.email || window.auth?.currentUser?.email || "").toLowerCase();
      if (email === "vits0007@gmail.com") return "admin";
    } catch (e) {}

    if (/admin/i.test(document.body.textContent || "")) return "admin";
    return "master";
  }

  function isVisible(el) {
    if (!el) return false;
    const st = getComputedStyle(el);
    if (st.display === "none" || st.visibility === "hidden" || Number(st.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 180 && r.height > 180;
  }

  function findMenuRoot() {
    const selectors = [
      "#side-menu",
      "#drawer",
      ".side-menu",
      ".sidebar",
      ".drawer",
      ".burger-menu",
      "[data-menu]",
      "nav",
      "aside"
    ];

    const candidates = Array.from(document.querySelectorAll(selectors.join(",")))
      .filter(isVisible)
      .filter(el => {
        if (el.id === "ep-shell-v245-menu") return true;
        const text = (el.textContent || "").toLowerCase();
        return text.includes("главный экран") || text.includes("база данных") || text.includes("выйти");
      })
      .sort((a, b) => {
        const ar = a.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        return (ar.width * ar.height) - (br.width * br.height);
      });

    return candidates[0] || null;
  }

  function collectOldActions(root) {
    if (!root || root.__epShellV245OldActions) return;

    const actions = {};
    const rows = Array.from(root.querySelectorAll("button,a,[role='button'],.menu-item,.nav-item"));
    rows.forEach(el => {
      const text = (el.textContent || "").toLowerCase().replace(/\s+/g, " ").trim();
      if (!text) return;

      const put = key => {
        if (!actions[key]) actions[key] = () => {
          try { el.click(); return true; } catch (e) { return false; }
        };
      };

      if (text.includes("главный")) put("home");
      if (text.includes("база данных")) put("database");
      if (text.includes("черновик сметы")) put("estimate");
      if (text.includes("заказчик")) put("customer");
      if (text.includes("ии функ")) put("ai");
      if (text.includes("однолин")) put("singleline");
      if (text.includes("документ")) put("documents");
      if (text.includes("бухгалтер")) put("accounting");
      if (text.includes("склад")) put("warehouse");
      if (text.includes("черновики")) put("drafts");
      if (text.includes("настройка визуала")) put("visual");
      if (text.includes("диагност")) put("diagnostics");
      if (text.includes("выйти")) put("logout");
    });

    root.__epShellV245OldActions = actions;
  }

  function menuHtml() {
    const rows = MENU.map(item => `
      <button type="button" class="ep-shell-v245-row" data-ep-shell-route="${esc(item.key)}">
        <span class="ep-shell-v245-ico">${esc(item.icon)}</span>
        <b>${esc(item.title)}</b>
        <em class="${item.version ? "" : "empty"}">${esc(item.version || " ")}</em>
      </button>
    `).join("");

    return `
      <div class="ep-shell-v245-panel">
        <div class="ep-shell-v245-profile">
          <div class="ep-shell-v245-avatar">⚡</div>
          <div>
            <h3>${esc(userName())}</h3>
            <p>${esc(userRole())}</p>
          </div>
        </div>

        <div class="ep-shell-v245-list">
          ${rows}
        </div>

        <div class="ep-shell-v245-divider"></div>

        <button type="button" class="ep-shell-v245-logout" data-ep-shell-route="logout">Выйти</button>
      </div>
    `;
  }

  function renderMenu(root) {
    if (!root || root.__epShellV245Rendering) return;

    collectOldActions(root);

    root.__epShellV245Rendering = true;
    root.classList.add("ep-shell-v245-root");
    root.innerHTML = menuHtml();
    root.__epShellV245Rendering = false;

    log("ep-shell-v24-5-menu-rendered", "Бургер-меню перерисовано жёстким монолитом.");
  }

  function hideMenu() {
    const root = findMenuRoot();
    if (!root) return;

    // Не удаляем меню насильно, только пробуем стандартные классы.
    root.classList.remove("open", "active", "show", "visible");
    document.body.classList.remove("menu-open", "drawer-open", "sidebar-open");

    const overlay = document.querySelector(".drawer-backdrop,.menu-backdrop,.sidebar-backdrop,.overlay.show");
    if (overlay) overlay.classList.remove("show", "active", "open");
  }

  function callAny(names, ...args) {
    for (const name of names) {
      try {
        const fn = name.split(".").reduce((o, k) => o && o[k], window);
        if (typeof fn === "function") {
          fn(...args);
          return true;
        }
      } catch (e) {}
    }
    return false;
  }

  function routerGo(route) {
    const variants = {
      home: ["home", "main", "dashboard"],
      estimate: ["estimate", "estimate-draft", "draft-estimate", "estimateCore"],
      customer: ["customer", "client", "aboutCustomer"],
      ai: ["ai", "ai-functions", "aiFunctions"],
      singleline: ["singleline", "single-line", "visualization", "shield-visual"],
      documents: ["documents", "docs"],
      accounting: ["accounting", "finance"],
      warehouse: ["warehouse", "stock"],
      drafts: ["drafts"],
      visual: ["visual", "visual-settings", "settings-visual"],
      diagnostics: ["diagnostics", "diag"]
    }[route] || [route];

    for (const r of variants) {
      try {
        if (window.Router?.load?.(r)) return true;
      } catch (e) {}
      try {
        if (window.AppRouter?.load?.(r)) return true;
      } catch (e) {}
      try {
        if (window.AppRouter?.navigate?.(r)) return true;
      } catch (e) {}
      try {
        if (window.navigateTo?.(r)) return true;
      } catch (e) {}
      try {
        if (window.showScreen?.(r)) return true;
      } catch (e) {}
    }

    return false;
  }

  function openRoute(route) {
    if (route === "database") {
      const ok =
        callAny(["DatabaseV24CleanMonolith.open"]) ||
        callAny(["DatabaseFileManagerV243.open"]) ||
        routerGo("database");

      hideMenu();
      setTimeout(forceDbVersion, 80);
      setTimeout(forceDbVersion, 400);

      if (!ok) fallbackOld(route);
      return;
    }

    if (route === "diagnostics") {
      const ok =
        callAny(["Diagnostics.open"]) ||
        callAny(["Diagnostics.show"]) ||
        routerGo("diagnostics") ||
        fallbackOld(route);
      hideMenu();
      return;
    }

    if (route === "logout") {
      if (
        callAny(["Auth.logout"]) ||
        callAny(["AppAuth.logout"]) ||
        callAny(["logout"]) ||
        callAny(["signOut"])
      ) return;

      const root = findMenuRoot();
      const old = root?.__epShellV245OldActions?.logout;
      if (old) old();
      return;
    }

    const ok = routerGo(route) || fallbackOld(route);
    hideMenu();

    if (!ok) {
      log("ep-shell-route-fallback-missed", "Не найден обработчик маршрута: " + route);
    }
  }

  function fallbackOld(route) {
    const root = findMenuRoot();
    const fn = root?.__epShellV245OldActions?.[route];
    if (typeof fn === "function") {
      try { return !!fn(); } catch (e) {}
    }
    return false;
  }

  function forceMenuVersions() {
    const root = findMenuRoot();
    if (!root) return;

    if (!root.classList.contains("ep-shell-v245-root")) {
      renderMenu(root);
      return;
    }

    root.querySelectorAll(".ep-shell-v245-row").forEach(row => {
      const key = row.getAttribute("data-ep-shell-route");
      const item = MENU.find(x => x.key === key);
      if (!item) return;

      const badge = row.querySelector("em");
      if (badge && badge.textContent !== (item.version || " ")) {
        badge.textContent = item.version || " ";
        badge.classList.toggle("empty", !item.version);
      }
    });
  }

  function forceDbVersion() {
    const screen =
      document.getElementById("ep-db-v244-screen") ||
      document.getElementById("ep-db-v243-screen");

    if (!screen) return;

    const p = screen.querySelector(".db244-head p,.db243-head p");
    if (p) {
      const role = /админ/i.test(p.textContent || "") ? "Админ" : /мастер/i.test(p.textContent || "") ? "Мастер" : userRole();
      p.textContent = `${role} · ${VERSION}`;
    }

    const head = screen.querySelector(".db244-head,.db243-head");
    if (head) {
      let dot = head.querySelector("#ep-shell-v245-db-dot");
      if (!dot) {
        dot = document.createElement("button");
        dot.type = "button";
        dot.id = "ep-shell-v245-db-dot";
        dot.title = "Диагностика БД";
        dot.setAttribute("aria-label", "Диагностика БД");
        dot.innerHTML = "<span></span>";
        head.appendChild(dot);
      }

      const status = screen.querySelector("#db244-save-status,.db244-save-status")?.textContent || "";
      dot.dataset.state = /ошибка|не удалось|недоступ|denied|permission|failed|unavailable/i.test(status) ? "error" : "ok";
    }

    try {
      if (window.DatabaseV24CleanMonolith) window.DatabaseV24CleanMonolith.version = VERSION;
      window.ModuleVersionBadgesV212?.setVersion?.("database", VERSION);
    } catch (e) {}
  }

  function patchBurgerOpen() {
    if (window.__epShellV245BurgerPatched) return;
    window.__epShellV245BurgerPatched = true;

    document.addEventListener("click", function (event) {
      const burger = event.target.closest(
        ".hamburger,.burger,[data-burger],[data-menu-open],#burger,#menu-button,.menu-button,button"
      );

      if (burger) {
        const text = (burger.textContent || "").trim();
        const cls = String(burger.className || "");
        const attrs = [
          burger.getAttribute("aria-label"),
          burger.getAttribute("data-burger"),
          burger.getAttribute("data-menu-open"),
          burger.id
        ].filter(Boolean).join(" ");

        if (/☰|menu|burger|меню|hamburger/i.test(text + " " + cls + " " + attrs)) {
          [80, 200, 500, 1000].forEach(ms => setTimeout(forceMenuVersions, ms));
        }
      }

      const row = event.target.closest("[data-ep-shell-route]");
      if (row) {
        event.preventDefault();
        event.stopPropagation();
        openRoute(row.getAttribute("data-ep-shell-route"));
      }

      if (event.target.closest("#ep-shell-v245-db-dot,#db2445-head-diag-dot,#db2444-head-diag-dot")) {
        event.preventDefault();
        event.stopPropagation();
        if (window.DbDiagnosticsDotV2443?.openPanel) {
          window.DbDiagnosticsDotV2443.openPanel();
        } else {
          alert("Диагностика БД пока не найдена. Статус: " + (document.querySelector("#db244-save-status,.db244-save-status")?.textContent || "нет"));
        }
      }
    }, true);
  }

  function patchBadgesModule() {
    const mod = window.ModuleVersionBadgesV212;
    if (!mod || mod.__epShellV245Patched) return;

    ["apply", "applyBadges", "render"].forEach(name => {
      if (typeof mod[name] !== "function") return;
      const old = mod[name].bind(mod);
      mod[name] = function (...args) {
        const result = old(...args);
        setTimeout(forceMenuVersions, 0);
        setTimeout(forceDbVersion, 0);
        setTimeout(forceMenuVersions, 120);
        setTimeout(forceDbVersion, 120);
        return result;
      };
    });

    try { mod.setVersion?.("database", VERSION); } catch (e) {}
    mod.__epShellV245Patched = true;
  }

  function patchDatabaseOpen() {
    const mod = window.DatabaseV24CleanMonolith || window.DatabaseFileManagerV243;
    if (!mod || mod.__epShellV245DbPatched || typeof mod.open !== "function") return;

    const old = mod.open.bind(mod);
    mod.open = function (...args) {
      const result = old(...args);
      [0, 80, 200, 500, 900, 1600].forEach(ms => setTimeout(forceDbVersion, ms));
      return result;
    };

    mod.version = VERSION;
    mod.__epShellV245DbPatched = true;
  }

  function observe() {
    if (window.__epShellV245Observer) return;

    const obs = new MutationObserver(function () {
      clearTimeout(window.__epShellV245ObsTimer);
      window.__epShellV245ObsTimer = setTimeout(function () {
        patchBadgesModule();
        patchDatabaseOpen();
        forceMenuVersions();
        forceDbVersion();
      }, 120);
    });

    obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style"] });
    window.__epShellV245Observer = obs;
  }

  function lightWatchdog() {
    if (window.__epShellV245Timer) return;
    window.__epShellV245Timer = setInterval(function () {
      patchBadgesModule();
      patchDatabaseOpen();

      const root = findMenuRoot();
      if (root) forceMenuVersions();

      const db =
        document.getElementById("ep-db-v244-screen") ||
        document.getElementById("ep-db-v243-screen");
      if (db && isVisible(db)) forceDbVersion();
    }, 800);
  }

  function boot() {
    patchBurgerOpen();
    patchBadgesModule();
    patchDatabaseOpen();
    forceMenuVersions();
    forceDbVersion();
    observe();
    lightWatchdog();
  }

  window.addEventListener("DOMContentLoaded", function () {
    boot();
    [300, 900, 1800, 3500].forEach(ms => setTimeout(boot, ms));
  });

  window.AppShellV245HardMonolith = {
    version: VERSION,
    boot,
    renderMenu,
    forceMenuVersions,
    forceDbVersion,
    openRoute
  };

  log("app-shell-v24-5-hard-monolith-ready", "Жёсткий монолит бургер-панели V24.5 готов.");
})();
