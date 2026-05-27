(function () {
  const VERSION = "V25.5";
  const FILE = "assets/js/v25-5-home-burger-unlock.js";

  let bootUntil = Date.now() + 6500;
  let dbIntentUntil = 0;
  let patched = false;

  function log(code, message, extra = {}) {
    try {
      window.Diagnostics?.ok?.({
        file: FILE,
        module: "HomeBurgerUnlockV255",
        functionName: "runtime",
        place: "shell",
        code,
        message,
        ...extra
      });
    } catch (e) {}
  }

  function now() {
    return Date.now();
  }

  function markDbIntent() {
    dbIntentUntil = now() + 6000;
    sessionStorage.setItem("ep_v255_db_user_intent", String(dbIntentUntil));
  }

  function hasDbIntent() {
    const saved = Number(sessionStorage.getItem("ep_v255_db_user_intent") || 0);
    return now() < dbIntentUntil || now() < saved;
  }

  function dbScreen() {
    return document.getElementById("ep-db-v25-screen");
  }

  function isVisible(el) {
    if (!el) return false;
    const st = getComputedStyle(el);
    return !el.classList.contains("hidden") && st.display !== "none" && st.visibility !== "hidden" && Number(st.opacity) !== 0;
  }

  function closeDb(reason = "auto") {
    const db = dbScreen();
    if (db) db.classList.add("hidden");

    document.body.classList.remove("main-v253-db-open", "db25-open", "database-open");
    document.querySelectorAll(".db25-modal,#db25-card-modal,#db25-edit-modal,#db25-server-import,#db25-diag-modal").forEach(el => {
      el.classList.add("hidden");
    });

    if (reason) log("db-closed-" + reason, "Экран БД закрыт защитой V25.5.");
  }

  function shouldBlockAutoDbOpen() {
    return now() < bootUntil && !hasDbIntent();
  }

  function patchDbOpen() {
    const mod = window.DatabaseV25HardMonolith;
    if (!mod || typeof mod.open !== "function" || mod.__v255HomeUnlockPatched) return;

    const oldOpen = mod.open.bind(mod);
    mod.__v255RawOpen = oldOpen;

    mod.open = function (...args) {
      if (shouldBlockAutoDbOpen()) {
        setTimeout(() => closeDb("startup-block"), 0);
        log("db-auto-open-blocked", "Автоматическое открытие БД заблокировано на старте.");
        return false;
      }

      return oldOpen(...args);
    };

    mod.__v255HomeUnlockPatched = true;
    patched = true;
  }

  function isBurgerButton(el) {
    if (!el) return false;

    const data = [
      el.id,
      el.className,
      el.getAttribute?.("aria-label"),
      el.getAttribute?.("data-burger"),
      el.getAttribute?.("data-menu-open"),
      el.textContent
    ].filter(Boolean).join(" ").toLowerCase();

    return /☰|burger|hamburger|menu|меню/.test(data);
  }

  function isDbTrigger(el) {
    if (!el || el.closest?.("#ep-db-v25-screen")) return false;
    if (isBurgerButton(el)) return false;

    const attrs = [
      el.getAttribute?.("data-burger-v2541-route"),
      el.getAttribute?.("data-burger-v254-route"),
      el.getAttribute?.("data-ep-shell-route"),
      el.getAttribute?.("data-route"),
      el.getAttribute?.("onclick"),
      el.id,
      el.className
    ].filter(Boolean).join(" ").toLowerCase();

    const text = String(el.textContent || "").toLowerCase().replace(/\s+/g, " ").trim();

    return attrs.includes("database") ||
      attrs.includes("db25") ||
      attrs.includes("db24") ||
      (text.includes("база данных") && text.length < 80);
  }

  function findTrigger(event, predicate) {
    const path = event.composedPath ? event.composedPath() : [];
    for (const node of path) {
      if (!(node instanceof Element)) continue;
      if (node === document.body || node === document.documentElement) break;
      if (predicate(node)) return node;
    }

    let el = event.target instanceof Element ? event.target : null;
    let depth = 0;
    while (el && depth < 8 && el !== document.body) {
      if (predicate(el)) return el;
      el = el.parentElement;
      depth++;
    }
    return null;
  }

  function hardOpenDb() {
    markDbIntent();

    const mod = window.DatabaseV25HardMonolith;
    if (mod?.__v255RawOpen) {
      mod.__v255RawOpen();
      return true;
    }

    if (mod?.open) {
      mod.open();
      return true;
    }

    try {
      window.ShellV252StableDbOpen?.openDbHard?.();
      return true;
    } catch (e) {}

    try {
      window.DatabaseV24CleanMonolith?.open?.();
      return true;
    } catch (e) {}

    alert("Не найден модуль открытия БД.");
    return false;
  }

  function closeDrawerSoft() {
    document.body.classList.remove("menu-open", "drawer-open", "sidebar-open");
    document.querySelectorAll("#side-menu,#drawer,.side-menu,.sidebar,.drawer,.burger-menu,aside,nav").forEach(el => {
      const t = (el.textContent || "").toLowerCase();
      if (t.includes("главный экран") || t.includes("база данных") || t.includes("выйти")) {
        el.classList.remove("open", "active", "show", "visible");
      }
    });
  }

  function visibleDrawer() {
    return Array.from(document.querySelectorAll("#side-menu,#drawer,.side-menu,.sidebar,.drawer,.burger-menu,aside,nav,.burger-v255-emergency"))
      .find(el => {
        const st = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        const t = (el.textContent || "").toLowerCase();
        return st.display !== "none" && st.visibility !== "hidden" && r.width > 180 && r.height > 220 &&
          (t.includes("главный экран") || t.includes("база данных") || t.includes("выйти"));
      });
  }

  function userName() {
    try {
      const u = window.firebase?.auth?.().currentUser || window.auth?.currentUser;
      if (u?.displayName) return u.displayName;
      if (u?.email === "vits0007@gmail.com") return "Виталий Имуллин";
      if (u?.email) return u.email.split("@")[0];
    } catch (e) {}
    return "Виталий Имуллин";
  }

  function userRole() {
    try {
      const email = String(window.firebase?.auth?.().currentUser?.email || window.auth?.currentUser?.email || "").toLowerCase();
      if (email === "vits0007@gmail.com") return "admin";
    } catch (e) {}
    return /admin/i.test(document.body.textContent || "") ? "admin" : "master";
  }

  function routeGeneric(route) {
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
    }[route] || [route];

    for (const r of aliases) {
      try { if (window.Router?.load?.(r)) return true; } catch (e) {}
      try { if (window.AppRouter?.load?.(r)) return true; } catch (e) {}
      try { if (window.AppRouter?.navigate?.(r)) return true; } catch (e) {}
      try { if (window.navigateTo?.(r)) return true; } catch (e) {}
      try { if (window.showScreen?.(r)) return true; } catch (e) {}
    }
    return false;
  }

  function emergencyMenuHtml() {
    const items = [
      ["home", "🏠", "Главный экран", ""],
      ["database", "📁", "База данных", VERSION],
      ["estimate", "🧾", "Черновик сметы", "V23.1"],
      ["customer", "👤", "О заказчике", "V10"],
      ["ai", "🤖", "ИИ функции", "V16"],
      ["singleline", "📈", "Однолинейка и визуализация щита", "V11"],
      ["documents", "📄", "Документы", "V10"],
      ["accounting", "💰", "Бухгалтерия", "V10"],
      ["warehouse", "📦", "Склад", "V10"],
      ["drafts", "📝", "Черновики", "V10"],
      ["visual", "🎨", "Настройка визуала", "V10"]
    ];

    return `
      <div class="burger-v255-backdrop" data-v255-close-menu></div>
      <aside class="burger-v255-panel">
        <div class="burger-v255-profile">
          <div class="burger-v255-avatar">⚡</div>
          <div><strong>${userName()}</strong><small>${userRole()}</small></div>
        </div>
        <div class="burger-v255-list">
          ${items.map(([key, icon, title, ver]) => `
            <button type="button" class="burger-v255-row" data-v255-route="${key}">
              <span>${icon}</span><b>${title}</b>${ver ? `<em>${ver}</em>` : `<em class="empty"></em>`}
            </button>
          `).join("")}
        </div>
        <div class="burger-v255-line"></div>
        <button type="button" class="burger-v255-exit" data-v255-route="logout">Выйти</button>
      </aside>
    `;
  }

  function openEmergencyMenu() {
    let wrap = document.getElementById("burger-v255-emergency");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.id = "burger-v255-emergency";
      wrap.className = "burger-v255-emergency hidden";
      document.body.appendChild(wrap);
    }

    wrap.innerHTML = emergencyMenuHtml();
    wrap.classList.remove("hidden");
  }

  function closeEmergencyMenu() {
    document.getElementById("burger-v255-emergency")?.classList.add("hidden");
  }

  function ensureBurgerWorks() {
    const root = visibleDrawer();
    if (!root) openEmergencyMenu();
  }

  function bind() {
    if (window.__v255HomeBurgerBound) return;
    window.__v255HomeBurgerBound = true;

    document.addEventListener("pointerdown", event => {
      const db = findTrigger(event, isDbTrigger);
      if (db) markDbIntent();
    }, true);

    document.addEventListener("click", event => {
      const emergencyRoute = event.target.closest("[data-v255-route]");
      if (emergencyRoute) {
        event.preventDefault();
        event.stopPropagation();

        const route = emergencyRoute.getAttribute("data-v255-route");
        if (route === "database") hardOpenDb();
        else if (route === "logout") {
          try { window.firebase?.auth?.().signOut?.(); } catch (e) {}
          try { window.Auth?.logout?.(); } catch (e) {}
        } else {
          routeGeneric(route);
        }

        closeEmergencyMenu();
        return;
      }

      if (event.target.closest("[data-v255-close-menu]")) {
        event.preventDefault();
        closeEmergencyMenu();
        return;
      }

      const db = findTrigger(event, isDbTrigger);
      if (db) {
        event.preventDefault();
        event.stopPropagation();
        if (event.stopImmediatePropagation) event.stopImmediatePropagation();
        hardOpenDb();
        closeDrawerSoft();
        return;
      }

      const burger = findTrigger(event, isBurgerButton);
      if (burger && !isVisible(dbScreen())) {
        setTimeout(ensureBurgerWorks, 260);
      }
    }, true);
  }

  function boot() {
    patchDbOpen();
    bind();

    if (shouldBlockAutoDbOpen() && isVisible(dbScreen())) {
      closeDb("startup-visible");
    }
  }

  function observe() {
    if (window.__v255HomeBurgerObserver) return;

    const obs = new MutationObserver(() => {
      clearTimeout(window.__v255HomeBurgerTimer);
      window.__v255HomeBurgerTimer = setTimeout(boot, 90);
    });

    obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style"] });
    window.__v255HomeBurgerObserver = obs;
  }

  window.addEventListener("DOMContentLoaded", () => {
    boot();
    observe();

    [100, 300, 700, 1400, 2600, 5200].forEach(ms => {
      setTimeout(() => {
        patchDbOpen();
        if (shouldBlockAutoDbOpen()) closeDb("startup-timer");
      }, ms);
    });
  });

  window.HomeBurgerUnlockV255 = {
    version: VERSION,
    closeDb,
    openEmergencyMenu,
    hardOpenDb,
    boot
  };

  log("home-burger-unlock-v25-5-ready", "V25.5 блокирует автозапуск БД и страхует бургер.");
})();
