(function () {
  const VERSION = "V25.4.1";
  const FILE = "assets/js/burger-v25-4-1-old-visual-lock.js";

  const ITEMS = [
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
    { key: "visual", icon: "🎨", title: "Настройка визуала", version: "V10" }
  ];

  function log(code, message, extra = {}) {
    try {
      window.Diagnostics?.ok?.({
        file: FILE,
        module: "BurgerV2541OldVisualLock",
        functionName: "runtime",
        place: "burger",
        code,
        message,
        ...extra
      });
    } catch (e) {}
  }

  function esc(v) {
    return String(v ?? "").replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    }[c]));
  }

  function text(el) {
    return String(el?.textContent || "").replace(/\s+/g, " ").trim();
  }

  function visible(el) {
    if (!el) return false;
    const st = getComputedStyle(el);
    if (st.display === "none" || st.visibility === "hidden" || Number(st.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 180 && r.height > 220;
  }

  function findDrawer() {
    const selectors = [
      ".burger-v2541-root", "#side-menu", "#drawer", ".side-menu", ".sidebar",
      ".drawer", ".burger-menu", "[data-menu]", "aside", "nav"
    ];

    return Array.from(document.querySelectorAll(selectors.join(",")))
      .filter(visible)
      .filter(el => {
        const t = text(el).toLowerCase();
        const idc = [el.id, el.className, el.getAttribute?.("data-menu")].filter(Boolean).join(" ").toLowerCase();
        return idc.includes("drawer") || idc.includes("side") || idc.includes("burger") ||
          t.includes("главный экран") || t.includes("база данных") || t.includes("выйти");
      })
      .sort((a, b) => {
        const ar = a.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        return (Math.abs(ar.left) + Math.abs(ar.top)) - (Math.abs(br.left) + Math.abs(br.top));
      })[0] || null;
  }

  function currentName() {
    try {
      const u = window.firebase?.auth?.().currentUser || window.auth?.currentUser;
      if (u?.displayName) return u.displayName;
      if (u?.email === "vits0007@gmail.com") return "Виталий Имуллин";
      if (u?.email) return u.email.split("@")[0];
    } catch (e) {}
    return "Виталий Имуллин";
  }

  function currentRole() {
    try {
      const email = String(window.firebase?.auth?.().currentUser?.email || window.auth?.currentUser?.email || "").toLowerCase();
      if (email === "vits0007@gmail.com") return "admin";
    } catch (e) {}
    if (/admin/i.test(document.body.textContent || "")) return "admin";
    return "master";
  }

  function html() {
    const rows = ITEMS.map(item => `
      <button type="button" class="burger-v2541-row" data-burger-v2541-route="${esc(item.key)}">
        <span class="burger-v2541-icon">${esc(item.icon)}</span>
        <span class="burger-v2541-title">${esc(item.title)}</span>
        ${item.version ? `<span class="burger-v2541-badge">${esc(item.version)}</span>` : `<span class="burger-v2541-badge empty"></span>`}
      </button>
    `).join("");

    return `
      <div class="burger-v2541-profile">
        <div class="burger-v2541-avatar">⚡</div>
        <div class="burger-v2541-profile-text">
          <strong>${esc(currentName())}</strong>
          <small>${esc(currentRole())}</small>
        </div>
      </div>
      <div class="burger-v2541-list">${rows}</div>
      <div class="burger-v2541-line"></div>
      <button type="button" class="burger-v2541-exit" data-burger-v2541-route="logout">Выйти</button>
    `;
  }

  function renderOldVisual(root) {
    if (!root) return false;
    root.classList.remove("ep-shell-v245-root", "shell-v252-visual-restored", "ep-shell-previous-visual-restored");
    root.classList.add("burger-v2541-root");
    if (root.getAttribute("data-burger-v2541-rendered") === "1") return true;
    root.innerHTML = html();
    root.setAttribute("data-burger-v2541-rendered", "1");
    log("burger-v25-4-1-rendered", "Бургер-панель перерисована под старый визуал.");
    return true;
  }

  function closeDrawer() {
    document.body.classList.remove("menu-open", "drawer-open", "sidebar-open");
    const root = findDrawer();
    if (root) root.classList.remove("open", "active", "show", "visible");
    document.querySelectorAll(".drawer-backdrop,.menu-backdrop,.sidebar-backdrop,.overlay").forEach(el => {
      el.classList.remove("open", "active", "show", "visible");
    });
  }

  function callFn(paths, ...args) {
    for (const path of paths) {
      try {
        const fn = path.split(".").reduce((obj, key) => obj && obj[key], window);
        if (typeof fn === "function") {
          fn(...args);
          return true;
        }
      } catch (e) {}
    }
    return false;
  }

  function routeDatabase() {
    const ok =
      callFn(["DatabaseV25HardMonolith.open"]) ||
      callFn(["ShellV252StableDbOpen.openDbHard"]) ||
      callFn(["DatabaseV24CleanMonolith.open"]) ||
      callFn(["DatabaseFileManagerV243.open"]) ||
      callFn(["Router.load"], "database");
    closeDrawer();
    setTimeout(() => {
      const db = document.getElementById("ep-db-v25-screen");
      if (db && db.classList.contains("hidden")) {
        try { window.DatabaseV25HardMonolith?.open?.(); } catch (e) {}
      }
    }, 180);
    if (!ok) alert("Не найден обработчик открытия БД.");
    return ok;
  }

  function routeGeneric(key) {
    const aliases = {
      home: ["home", "main", "dashboard"],
      estimate: ["estimate", "draft-estimate", "estimateCore"],
      customer: ["customer", "client"],
      ai: ["ai", "ai-functions"],
      singleline: ["singleline", "single-line", "visualization"],
      documents: ["documents", "docs"],
      accounting: ["accounting", "finance"],
      warehouse: ["warehouse", "stock"],
      drafts: ["drafts"],
      visual: ["visual", "visual-settings"]
    }[key] || [key];

    for (const route of aliases) {
      if (callFn(["Router.load"], route) || callFn(["AppRouter.load"], route) ||
          callFn(["AppRouter.navigate"], route) || callFn(["navigateTo"], route) ||
          callFn(["showScreen"], route)) {
        closeDrawer();
        return true;
      }
    }
    closeDrawer();
    return false;
  }

  function logout() {
    const ok = callFn(["Auth.logout"]) || callFn(["AppAuth.logout"]) || callFn(["logout"]) || callFn(["signOut"]);
    if (!ok) {
      try { window.firebase?.auth?.().signOut?.(); } catch (e) {}
    }
  }

  function openRoute(key) {
    if (key === "database") return routeDatabase();
    if (key === "logout") return logout();
    return routeGeneric(key);
  }

  function isBurgerButton(el) {
    if (!el) return false;
    const data = [
      el.id, el.className, el.getAttribute?.("aria-label"), el.getAttribute?.("data-burger"),
      el.getAttribute?.("data-menu-open"), text(el)
    ].filter(Boolean).join(" ").toLowerCase();
    return /☰|burger|menu|меню|hamburger/.test(data);
  }

  function bind() {
    if (window.__burgerV2541Bound) return;
    window.__burgerV2541Bound = true;

    document.addEventListener("click", event => {
      const route = event.target.closest("[data-burger-v2541-route]");
      if (route) {
        event.preventDefault();
        event.stopPropagation();
        openRoute(route.getAttribute("data-burger-v2541-route"));
        return;
      }

      const maybeBurger = event.target.closest("button,.hamburger,.burger,#burger,.menu-button,[data-burger],[data-menu-open]");
      if (isBurgerButton(maybeBurger)) {
        [50, 140, 320, 700].forEach(ms => setTimeout(() => renderOldVisual(findDrawer()), ms));
      }
    }, true);
  }

  function cleanBadBurger() {
    const root = findDrawer();
    if (!root) return;
    const t = text(root);
    const bad =
      (t.match(/Виталий Имуллин/g) || []).length > 1 ||
      (t.match(/V24\.5/g) || []).length > 1 ||
      root.classList.contains("ep-shell-v245-root") ||
      !!root.querySelector(".ep-shell-v245-panel") ||
      root.getAttribute("data-burger-v2541-rendered") === "1";
    if (bad) renderOldVisual(root);
  }

  function boot() {
    bind();
    cleanBadBurger();
  }

  function observe() {
    if (window.__burgerV2541Observer) return;
    const obs = new MutationObserver(() => {
      clearTimeout(window.__burgerV2541Timer);
      window.__burgerV2541Timer = setTimeout(boot, 90);
    });
    obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style"] });
    window.__burgerV2541Observer = obs;
  }

  window.addEventListener("DOMContentLoaded", () => {
    boot();
    observe();
    [300, 900, 1800, 3200].forEach(ms => setTimeout(boot, ms));
  });

  window.BurgerV2541OldVisualLock = {
    version: VERSION,
    render: () => renderOldVisual(findDrawer()),
    openRoute,
    routeDatabase
  };

  log("burger-v25-4-1-old-visual-ready", "Старый визуал бургер-панели V25.4.1 готов.");
})();
