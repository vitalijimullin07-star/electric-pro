window.EP = window.EP || {};

EP.AppShell = {
  render() {
    const app = document.querySelector("#app");
    app.innerHTML = `
      <div class="app-bg"></div>
      <div class="live-lines"></div>

      <div class="app-shell">
        <header class="topbar glass">
          <button class="icon-btn burger-btn ep-clickable" id="burgerBtn" type="button" aria-label="Открыть меню">
            <span></span><span></span><span></span>
          </button>
          <div class="topbar-title">
            <strong>Электрик</strong>
            <span id="masterName">Мастер</span>
          </div>
          <button class="status-btn ep-clickable" id="firebaseStatusBtn" type="button" aria-label="Статус Firebase">
            <span class="status-dot status-wait" id="firebaseStatusDot"></span>
          </button>
        </header>

        <div class="menu-overlay" id="menuOverlay"></div>
        <aside class="side-menu glass" id="sideMenu">
          <div class="side-head">
            <div class="avatar">⚡</div>
            <div>
              <strong id="sideMasterName">Electric Pro</strong>
              <span id="sideMasterRole">guest</span>
            </div>
          </div>
          <nav class="side-nav">
            <button class="ep-clickable" type="button" data-route="main">🏠 Главная</button>
            <button class="ep-clickable" type="button" data-route="guide">📖 Гайд</button>
            <button class="ep-clickable" type="button" data-route="whatsnew">✨ Что нового <span class="menu-badge" id="whatsnewBadge" style="display:none">NEW</span></button>
            <button class="ep-clickable" type="button" data-route="database">🗂️ База данных</button>
            <button class="ep-clickable" type="button" data-route="materials">📦 Материалы</button>
            <button class="ep-clickable" type="button" data-route="work">🧰 Работа</button>
            <button class="ep-clickable" type="button" data-route="shield">🛡️ Конфигуратор щита</button>
            <button class="ep-clickable" type="button" data-route="pool">🔌 Пул розеток/штроб</button>
            <button class="ep-clickable" type="button" data-route="scheme">📐 Однолинейная схема</button>
            <button class="ep-clickable" type="button" data-route="estimate">📋 Смета</button>
            <button class="ep-clickable" type="button" data-route="clients">👥 Клиенты</button>
            <button class="ep-clickable" type="button" data-route="documents">📄 Документы</button>
            <button class="ep-clickable" type="button" data-route="stock">🏬 Склад</button>
            <button class="ep-clickable" type="button" data-route="costs">💰 Затраты</button>
            <button class="ep-clickable" type="button" data-route="tools">🛠 Инструмент</button>
            <button class="ep-clickable" type="button" data-route="profile">👤 Профиль и реквизиты</button>
            <button class="ep-clickable" type="button" data-route="settings">🎨 Настройки визуала</button>
            <button class="ep-clickable" type="button" data-route="subscription">💳 Подписка</button>
            <button class="ep-clickable" type="button" data-route="ai" id="aiMenuBtn" style="display:none">🤖 ИИ-ассистент</button>
            <button class="ep-clickable" type="button" data-route="admin" id="adminMenuBtn" style="display:none">👑 Админка</button>
          </nav>
          <button class="btn btn-ghost btn-wide ep-clickable" id="logoutBtn" type="button" style="display:none">Выйти</button>
          <button class="btn btn-ghost btn-wide ep-clickable" id="hardReloadBtn" type="button">Обновить без кэша</button>
        </aside>

        <main class="page-container" id="pageContent"></main>
      </div>
    `;

    document.querySelector("#burgerBtn")?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.openDrawer();
    });

    document.querySelector("#menuOverlay")?.addEventListener("click", (event) => {
      event.preventDefault();
      this.closeDrawer();
    });

    document.querySelector("#firebaseStatusBtn")?.addEventListener("click", () => {
      if (EP.Auth?.isAuthenticated?.()) {
        EP.Router.go(EP.Auth?.isAdmin?.() ? "admin" : "main");
      } else {
        EP.Router.go("login", { replace: true });
      }
    });

    document.querySelector("#logoutBtn")?.addEventListener("click", () => EP.Auth?.signOut?.());
    document.querySelector("#hardReloadBtn")?.addEventListener("click", () => {
      location.href = location.pathname + "?fresh=" + Date.now() + location.hash;
    });

    window.addEventListener("ep:route-loaded", () => this.syncAccess());
    window.addEventListener("ep:auth-changed", () => this.syncAccess());

    this.closeDrawer();
    this.syncAccess();
  },

  openDrawer() {
    if (EP.state?.currentRoute === "login") return;
    if (EP.Auth?.isReady?.() && !EP.Auth?.isAuthenticated?.()) return;

    EP.state.drawerOpen = true;
    document.querySelector("#sideMenu")?.classList.add("open");
    document.querySelector("#menuOverlay")?.classList.add("open");
  },

  closeDrawer() {
    EP.state.drawerOpen = false;
    document.querySelector("#sideMenu")?.classList.remove("open");
    document.querySelector("#menuOverlay")?.classList.remove("open");
  },

  isDrawerOpen() {
    return Boolean(EP.state.drawerOpen);
  },

  syncAccess() {
    const route = EP.state?.currentRoute || "main";
    const user = EP.state?.user || null;
    const profile = EP.state?.profile || null;
    const isLogin = route === "login";
    const isAuthed = Boolean(user);
    const isAdmin = EP.Auth?.isAdmin?.() || profile?.role === "admin" || profile?.isAdmin === true;

    const burger = document.querySelector("#burgerBtn");
    if (burger) {
      burger.disabled = isLogin || !isAuthed;
      burger.style.visibility = (isLogin || !isAuthed) ? "hidden" : "visible";
    }

    if (isLogin || !isAuthed) this.closeDrawer();

    const adminBtn = document.querySelector("#adminMenuBtn");
    if (adminBtn) adminBtn.style.display = isAdmin ? "" : "none";
    const aiBtn = document.querySelector("#aiMenuBtn");
    if (aiBtn) aiBtn.style.display = isAdmin ? "" : "none";

    const logoutBtn = document.querySelector("#logoutBtn");
    if (logoutBtn) logoutBtn.style.display = isAuthed ? "" : "none";

    const name = user?.displayName || user?.email || (isLogin ? "Вход" : "Мастер");
    const role = profile?.role || user?.role || (isLogin ? "auth" : "guest");

    const masterName = document.querySelector("#masterName");
    const sideMasterName = document.querySelector("#sideMasterName");
    const sideMasterRole = document.querySelector("#sideMasterRole");
    if (masterName) masterName.textContent = name;
    if (sideMasterName) sideMasterName.textContent = name;
    if (sideMasterRole) sideMasterRole.textContent = role;

    const dot = document.querySelector("#firebaseStatusDot");
    if (dot) {
      dot.classList.remove("status-ok", "status-wait", "status-error");
      dot.classList.add(EP.Firebase?.ready ? "status-ok" : "status-error");
    }
  }
};
