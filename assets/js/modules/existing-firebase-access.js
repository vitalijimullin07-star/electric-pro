window.EP = window.EP || {};

EP.ExistingFirebaseAccess = {
  projectId: "electric-489f7",
  dayMs: 24 * 60 * 60 * 1000,
  lastPolicy: null,
  lastAdminTarget: null,
  lastUsersList: [],
  unsubscribe: null,
  clientWriteEnabled: false,

  init() {
    window.addEventListener("ep:auth-changed", () => this.reload());
    window.addEventListener("ep:route-loaded", () => this.render());

    document.addEventListener("click", (event) => {
      const toggleBtn = event.target.closest("[data-admin-section-toggle]");
      if (toggleBtn) {
        event.preventDefault();
        this.toggleSection(toggleBtn.dataset.adminSectionToggle);
        window.SoundAPI?.click?.();
        return;
      }

      const refreshBtn = event.target.closest("[data-access-refresh]");
      if (refreshBtn) {
        event.preventDefault();
        this.reload({ force: true });
        window.SoundAPI?.click?.();
        return;
      }

      const loadUsersBtn = event.target.closest("[data-admin-load-users]");
      if (loadUsersBtn) {
        event.preventDefault();
        this.loadUsersList();
        window.SoundAPI?.click?.();
        return;
      }

      const selectUserBtn = event.target.closest("[data-admin-select-user]");
      if (selectUserBtn) {
        event.preventDefault();
        const uid = String(selectUserBtn.dataset.adminSelectUser || "").trim();
        this.setWorkspaceUid(uid);
        this.loadAdminTarget(uid);
        window.SoundAPI?.click?.();
        return;
      }

      const loadUidBtn = event.target.closest("[data-admin-load-uid], [data-admin-load-user-workspace]");
      if (loadUidBtn) {
        event.preventDefault();
        const input = document.querySelector("#admin-workspace-uid") || document.querySelector("#admin-target-uid");
        this.loadAdminTarget(String(input?.value || "").trim());
        window.SoundAPI?.click?.();
        return;
      }

      const copyPayloadBtn = event.target.closest("[data-admin-copy-payload]");
      if (copyPayloadBtn) {
        event.preventDefault();
        this.copyWorkspacePayload(copyPayloadBtn.dataset.adminCopyPayload || "all", copyPayloadBtn);
        window.SoundAPI?.click?.();
        return;
      }

      const disabledWriteBtn = event.target.closest("[data-admin-disabled-write]");
      if (disabledWriteBtn) {
        event.preventDefault();
        this.showWorkspaceNotice("Запись из V29 пока отключена. Данные безопасно вносим через Firebase Console или старую админку. Позже подключим Cloud Functions.");
        this.flashButton(disabledWriteBtn, "Пока через Firebase");
        window.SoundAPI?.click?.();
        return;
      }

      const copyBtn = event.target.closest("[data-copy-text]");
      if (copyBtn) {
        event.preventDefault();
        navigator.clipboard?.writeText?.(copyBtn.dataset.copyText || "");
        window.SoundAPI?.click?.();
        this.flashButton(copyBtn, "Скопировано");
        return;
      }
    }, true);

    document.addEventListener("change", (event) => {
      if (event.target.closest("[data-admin-workspace-field]")) {
        this.updateWorkspacePreview();
      }
    }, true);

    document.addEventListener("input", (event) => {
      if (event.target.closest("[data-admin-workspace-field]")) {
        clearTimeout(this.__previewTimer);
        this.__previewTimer = setTimeout(() => this.updateWorkspacePreview(), 120);
      }
    }, true);

    setTimeout(() => this.reload(), 300);
  },

  db() {
    if (!EP.Firebase?.init?.()) return null;
    return EP.Firebase.db || null;
  },

  currentUid() {
    return EP.state?.user?.uid || EP.Firebase?.auth?.currentUser?.uid || null;
  },

  currentEmail() {
    return String(EP.state?.user?.email || EP.Firebase?.auth?.currentUser?.email || "").toLowerCase();
  },

  async reload() {
    const uid = this.currentUid();
    if (!uid) {
      this.lastPolicy = this.buildGuestPolicy();
      EP.state.accessPolicy = this.lastPolicy;
      this.render();
      return this.lastPolicy;
    }

    const db = this.db();
    if (!db) {
      this.lastPolicy = this.buildErrorPolicy("Firebase не готов");
      EP.state.accessPolicy = this.lastPolicy;
      this.render();
      return this.lastPolicy;
    }

    try {
      const [userSnap, subSnap, aiSnap] = await Promise.all([
        db.collection("users").doc(uid).get(),
        db.collection("user_subscriptions").doc(uid).get(),
        db.collection("ai_accounts").doc(uid).get()
      ]);

      const profile = userSnap.exists ? (userSnap.data() || {}) : (EP.state.profile || {});
      const subscription = subSnap.exists ? (subSnap.data() || {}) : null;
      const aiAccount = aiSnap.exists ? (aiSnap.data() || {}) : null;

      this.lastPolicy = this.buildPolicy(uid, profile, subscription, aiAccount);
      EP.state.accessPolicy = this.lastPolicy;
      window.dispatchEvent(new CustomEvent("ep:access-policy-loaded", { detail: { policy: this.lastPolicy } }));
      this.render();
      return this.lastPolicy;
    } catch (error) {
      console.warn("Existing Firebase access load error", error);
      this.lastPolicy = this.buildErrorPolicy(error.message || "Доступ не загружен");
      EP.state.accessPolicy = this.lastPolicy;
      this.render();
      return this.lastPolicy;
    }
  },

  buildGuestPolicy() {
    return {
      ok: false,
      source: "existing-firebase-read-only",
      projectId: this.projectId,
      uid: null,
      email: "",
      planId: "none",
      planTitle: "Вход",
      daysLeft: null,
      subscriptionActive: false,
      statusText: "Вход",
      aiText: "—",
      aiMode: "disabled",
      aiBalanceRub: 0,
      features: this.features("none"),
      limits: this.limits("none"),
      error: "Нет входа"
    };
  },

  buildErrorPolicy(message) {
    return {
      ok: false,
      source: "existing-firebase-read-only",
      projectId: this.projectId,
      uid: this.currentUid(),
      email: this.currentEmail(),
      planId: "unknown",
      planTitle: "Доступ",
      daysLeft: null,
      subscriptionActive: false,
      statusText: "Доступ не загружен",
      aiText: "ИИ —",
      aiMode: "disabled",
      aiBalanceRub: 0,
      features: this.features("none"),
      limits: this.limits("none"),
      error: message
    };
  },

  buildPolicy(uid, profile, subscription, aiAccount) {
    const email = String(profile?.email || EP.state?.user?.email || "").toLowerCase();
    const isAdmin = profile?.role === "admin" || profile?.isAdmin === true || email === "vits0007@gmail.com";
    const blocked = profile?.blocked === true || ["blocked", "blocked_review", "deleted"].includes(profile?.status);

    const active = this.isSubscriptionActive(subscription);
    const profilePlan = profile?.subscriptionPlan || profile?.planId || profile?.plan;
    const planId = active ? this.normalizePlan(subscription?.planId || subscription?.plan) : (isAdmin ? "admin" : this.normalizePlan(profilePlan || "none"));
    const daysLeft = active ? this.daysLeft(subscription?.expiresAt || subscription?.until || subscription?.trialEndsAt) : this.daysLeft(profile?.subscriptionUntil || profile?.expiresAt);
    const features = isAdmin ? this.features("admin") : this.features(planId);
    const limits = isAdmin ? this.limits("admin") : this.limits(planId);

    const accessMode = String(aiAccount?.accessMode || aiAccount?.mode || profile?.aiAccessMode || profile?.aiMode || "disabled");
    const balanceRub = Number(aiAccount?.balanceRub || aiAccount?.balance || profile?.aiBalanceRub || 0);
    const allowAi = aiAccount?.allowAi !== false && profile?.securityPolicy?.allowAi !== false && profile?.aiEnabled !== false;
    const canUseAi = !blocked && features.ai === true && allowAi && accessMode !== "disabled" && (accessMode === "own_api" || balanceRub > 0 || isAdmin);

    const planTitle = this.planTitle(planId, subscription?.planName || subscription?.planTitle || profile?.subscriptionTitle);
    const statusText = this.statusText(planId, daysLeft, blocked, active, isAdmin);
    const aiText = this.aiText(accessMode, canUseAi, balanceRub, features.ai, blocked);

    return {
      ok: true,
      source: "existing-firebase-read-only",
      projectId: this.projectId,
      uid,
      email,
      profile,
      subscription: subscription || null,
      aiAccount: aiAccount || null,
      isAdmin,
      blocked,
      subscriptionActive: active || isAdmin,
      planId,
      planTitle,
      daysLeft,
      statusText,
      aiText,
      aiMode: accessMode,
      aiBalanceRub: balanceRub,
      aiCanUse: canUseAi,
      features,
      limits
    };
  },

  normalizePlan(planId) {
    if (["pro_ai", "ai", "with_ai", "pro", "с ии", "с_ии"].includes(String(planId || "").toLowerCase())) return "pro_ai";
    if (["basic", "base", "базовая"].includes(String(planId || "").toLowerCase())) return "basic";
    if (String(planId || "").toLowerCase() === "trial") return "trial";
    return planId || "none";
  },

  planTitle(planId, fallback) {
    if (fallback) return String(fallback);
    if (planId === "admin") return "Админ";
    if (planId === "pro_ai") return "С ИИ";
    if (planId === "basic") return "Базовая";
    if (planId === "trial") return "Тест";
    return "Нет подписки";
  },

  features(planId) {
    if (planId === "admin" || planId === "pro_ai") {
      return { ai: true, customerEstimate: true, singleLineScheme: true, visualization: true, warehouse: true, accounting: true, fullStorage: true };
    }
    if (planId === "basic") {
      return { ai: false, customerEstimate: false, singleLineScheme: false, visualization: false, warehouse: false, accounting: false, fullStorage: false };
    }
    return { ai: false, customerEstimate: false, singleLineScheme: false, visualization: false, warehouse: false, accounting: false, fullStorage: false };
  },

  limits(planId) {
    if (planId === "admin" || planId === "pro_ai") return { shieldItemsMax: null, poolItemsMax: null };
    if (planId === "basic") return { shieldItemsMax: 60, poolItemsMax: 50 };
    return { shieldItemsMax: 0, poolItemsMax: 0 };
  },

  toDate(value) {
    if (!value) return null;
    try {
      if (typeof value.toDate === "function") return value.toDate();
      if (typeof value.seconds === "number") return new Date(value.seconds * 1000);
      const date = new Date(value);
      return Number.isFinite(date.getTime()) ? date : null;
    } catch (_) {
      return null;
    }
  },

  daysLeft(value) {
    const date = this.toDate(value);
    if (!date) return null;
    return Math.max(0, Math.ceil((date.getTime() - Date.now()) / this.dayMs));
  },

  isSubscriptionActive(subscription) {
    if (!subscription) return false;
    if (subscription.active === true) return true;
    if (!subscription.status && (subscription.expiresAt || subscription.until)) {
      const date = this.toDate(subscription.expiresAt || subscription.until);
      return Boolean(date && date.getTime() > Date.now());
    }
    if (!["active", "trial"].includes(subscription.status)) return false;
    const date = this.toDate(subscription.expiresAt || subscription.until || subscription.trialEndsAt);
    return Boolean(date && date.getTime() > Date.now());
  },

  statusText(planId, daysLeft, blocked, active, isAdmin) {
    if (blocked) return "Доступ закрыт";
    if ((active || daysLeft !== null) && daysLeft !== null) return `${this.planTitle(planId)} · ${daysLeft}д`;
    if (isAdmin) return "Админ · доступ";
    return "Нет подписки";
  },

  money(value) {
    return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(Number(value || 0)) + " ₽";
  },

  aiText(accessMode, canUseAi, balanceRub, featureAi, blocked) {
    if (blocked) return "ИИ закрыт";
    if (!featureAi || accessMode === "disabled") return "ИИ выкл.";
    if (accessMode === "own_api") return canUseAi ? "ИИ API клиента" : "ИИ клиент";
    if (canUseAi) return `ИИ вкл. · ${this.money(balanceRub)}`;
    return "ИИ 0 ₽";
  },

  render() {
    const policy = this.lastPolicy || EP.state?.accessPolicy || this.buildGuestPolicy();
    const line = document.querySelector(".ep-top-status-line");
    const left = document.querySelector("[data-subscription-summary], .ep-top-status-left");
    const right = document.querySelector("[data-ai-status], .ep-top-status-right");

    if (line) {
      const status = policy.blocked ? "none" : policy.planId === "pro_ai" || policy.planId === "admin" ? "pro" : policy.planId === "basic" ? "basic" : policy.planId === "trial" ? "trial" : "none";
      const ai = policy.aiMode === "own_api" ? "own_api" : policy.aiMode === "disabled" ? "disabled" : "admin_api";
      line.dataset.status = status;
      line.dataset.ai = ai;
    }

    if (left) left.textContent = policy.statusText || "Доступ";
    if (right) right.textContent = policy.aiText || "ИИ —";

    const adminRoot = document.querySelector("#firebase-console-access-root");
    if (adminRoot) this.renderAdminInfo(adminRoot, policy);
  },

  renderAdminInfo(root, policy) {
    const uid = this.currentUid() || "";
    const email = this.currentEmail() || policy.email || "";
    const firebaseConsoleUrl = `https://console.firebase.google.com/project/${this.projectId}/firestore/databases/-default-/data`;
    root.innerHTML = `
      <div class="admin-workspace-page">
        <section class="admin-workspace-hero">
          <div>
            <span class="admin-eyebrow">V29.20 · админ-центр</span>
            <h2>Админка Electric Pro</h2>
            <p>Верхняя кнопка — пользователи и подписка. Ниже: база данных, логи ошибок, бухгалтерия, документы, черновики и сметы.</p>
          </div>
          <div class="admin-hero-actions">
            <button class="admin-console-btn primary ep-clickable" type="button" data-admin-section-toggle="admin-section-users">Пользователи</button>
            <a class="admin-console-btn ep-clickable" href="${firebaseConsoleUrl}" target="_blank" rel="noopener">Firebase</a>
          </div>
        </section>

        <section class="admin-stat-grid">
          ${this.statCard("Профиль", email || "—", policy.isAdmin ? "Администратор" : "Мастер", policy.isAdmin ? "good" : "")}
          ${this.statCard("Подписка", policy.statusText || "—", policy.subscriptionActive ? "Активна" : "Проверить", policy.subscriptionActive ? "good" : "warn")}
          ${this.statCard("ИИ", policy.aiText || "—", policy.aiCanUse ? "Доступен" : "Ограничен", policy.aiCanUse ? "good" : "warn")}
          ${this.statCard("Запись", "Через Firebase", "Клиентская запись отключена", "safe")}
        </section>

        ${this.sectionShell({ id: "admin-section-users", title: "Пользователи, подписка и ИИ-баланс", icon: "👤", subtitle: "Открываешь пользователя, задаёшь тариф, срок, ИИ-режим и баланс. Сейчас безопасный режим: готовим данные для Firebase Console/старой админки.", open: true, body: this.usersSection(uid, email, policy) })}
        ${this.sectionShell({ id: "admin-section-database", title: "База данных", icon: "🗄️", subtitle: "Выбрать мастера, посмотреть личную базу, добавить позиции с ценой или без цены. Логику БД оставляем Claude.", body: this.placeholderSection("База данных", "Здесь будет выбор пользователя → просмотр личной БД → добавить в серверную БД с ценой/без цены.", ["users/{uid}/my_database", "user_databases/{uid}", "server_database"]) })}
        ${this.sectionShell({ id: "admin-section-logs", title: "Логи ошибок", icon: "⚠️", subtitle: "Только ошибки. Не засоряем событиями кликов, навигацией и обычной диагностикой.", body: this.logsSection() })}
        ${this.sectionShell({ id: "admin-section-accounting", title: "Бухгалтерия", icon: "💰", subtitle: "Просмотр бухгалтерии выбранного мастера без смешивания с чужими данными.", body: this.placeholderSection("Бухгалтерия", "Выбор пользователя → документы/платежи/расходы/доходы. Полноценную логику подключим позже.", ["users/{uid}/accounting", "accounting/{uid}"]) })}
        ${this.sectionShell({ id: "admin-section-documents", title: "Документы", icon: "📄", subtitle: "Договоры, акты, PDF, печати и реквизиты мастера.", body: this.placeholderSection("Документы", "Выбор пользователя → документы → просмотр/проверка/экспорт. Локальные копии позже шифруем.", ["users/{uid}/documents", "documents/{uid}"]) })}
        ${this.sectionShell({ id: "admin-section-drafts", title: "Черновики", icon: "📝", subtitle: "Черновики расчётов и промежуточных документов мастера.", body: this.placeholderSection("Черновики", "Выбор пользователя → черновики → просмотр. Без лишней записи и без засорения логов.", ["users/{uid}/drafts", "drafts/{uid}"]) })}
        ${this.sectionShell({ id: "admin-section-estimates", title: "Сметы", icon: "📊", subtitle: "Сметы мастера, последние расчёты, документы заказчику и поставщику.", body: this.placeholderSection("Сметы", "Выбор пользователя → список смет → просмотр/экспорт. Доступ привяжем к подписке.", ["users/{uid}/estimates", "estimates/{uid}"]) })}
      </div>
    `;
    setTimeout(() => this.updateWorkspacePreview(), 0);
  },

  sectionShell({ id, title, icon, subtitle, body, open }) {
    return `
      <section class="admin-accordion ${open ? "is-open" : ""}" id="${this.attr(id)}">
        <button class="admin-accordion-head ep-clickable" type="button" data-admin-section-toggle="${this.attr(id)}">
          <span class="admin-accordion-icon">${this.escape(icon)}</span>
          <span class="admin-accordion-title"><b>${this.escape(title)}</b><small>${this.escape(subtitle)}</small></span>
          <span class="admin-accordion-arrow">⌄</span>
        </button>
        <div class="admin-accordion-body">${body}</div>
      </section>
    `;
  },

  usersSection(uid, email, policy) {
    const targetUid = this.lastAdminTarget?.uid || uid || "";
    const targetUser = this.lastAdminTarget?.user || policy.profile || {};
    const targetSub = this.lastAdminTarget?.subscription || policy.subscription || {};
    const targetAi = this.lastAdminTarget?.ai || policy.aiAccount || {};
    const planId = this.normalizePlan(targetSub.planId || targetSub.plan || targetUser.subscriptionPlan || policy.planId || "pro_ai");
    const accessMode = targetAi.accessMode || targetAi.mode || targetUser.aiMode || policy.aiMode || "admin_api";
    const balance = Number(targetAi.balanceRub || targetAi.balance || targetUser.aiBalanceRub || policy.aiBalanceRub || 0);
    const role = targetUser.role || (email === "vits0007@gmail.com" ? "admin" : "master");
    const status = targetUser.status || "approved";
    const daysValue = policy.daysLeft || 30;

    return `
      <div class="admin-users-layout">
        <div class="admin-console-card admin-panel-card">
          <div class="admin-card-head">
            <div>
              <h3>Список пользователей</h3>
              <p>Если правила Firebase дадут доступ, список загрузится. Если нет — вставь UID вручную.</p>
            </div>
            <button class="admin-icon-btn ep-clickable" type="button" data-admin-load-users title="Загрузить">↻</button>
          </div>
          <div class="admin-uid-checker compact">
            <input id="admin-workspace-uid" class="admin-input" type="text" placeholder="UID мастера" value="${this.attr(targetUid)}" />
            <button class="admin-console-btn primary ep-clickable" type="button" data-admin-load-user-workspace>Открыть</button>
          </div>
          <div id="admin-users-list" class="admin-users-list">
            ${this.usersListEmpty(policy.isAdmin ? "Нажми ↻, чтобы попробовать загрузить пользователей." : "Список пользователей доступен только админу. Можно открыть свой UID.")}
          </div>
        </div>

        <div class="admin-console-card admin-panel-card">
          <div class="admin-card-head">
            <div>
              <h3>Карточка пользователя</h3>
              <p>Тариф, срок, баланс и ИИ-режим. Сейчас кнопки готовят данные для Firebase Console.</p>
            </div>
          </div>

          <div class="admin-form-grid">
            <label><span>Роль</span><select id="admin-user-role" data-admin-workspace-field><option value="master" ${role === "master" ? "selected" : ""}>Мастер</option><option value="admin" ${role === "admin" ? "selected" : ""}>Админ</option></select></label>
            <label><span>Статус</span><select id="admin-user-status" data-admin-workspace-field><option value="approved" ${status === "approved" ? "selected" : ""}>Одобрен</option><option value="active" ${status === "active" ? "selected" : ""}>Активен</option><option value="blocked" ${status === "blocked" ? "selected" : ""}>Заблокирован</option><option value="pending" ${status === "pending" ? "selected" : ""}>Ожидает</option></select></label>
            <label><span>Тариф</span><select id="admin-plan-select" data-admin-workspace-field><option value="basic" ${planId === "basic" ? "selected" : ""}>Базовая</option><option value="pro_ai" ${planId === "pro_ai" || planId === "admin" ? "selected" : ""}>С ИИ</option><option value="trial" ${planId === "trial" ? "selected" : ""}>Тест 10 дней</option><option value="none" ${planId === "none" ? "selected" : ""}>Нет подписки</option></select></label>
            <label><span>Срок</span><select id="admin-days-select" data-admin-workspace-field><option value="2" ${daysValue === 2 ? "selected" : ""}>2 дня</option><option value="30" ${daysValue === 30 ? "selected" : ""}>30 дней</option><option value="90" ${daysValue === 90 ? "selected" : ""}>90 дней</option><option value="180" ${daysValue === 180 ? "selected" : ""}>180 дней</option><option value="360" ${daysValue === 360 ? "selected" : ""}>360 дней</option><option value="491" ${daysValue === 491 ? "selected" : ""}>491 день</option></select></label>
            <label><span>ИИ-режим</span><select id="admin-ai-mode" data-admin-workspace-field><option value="admin_api" ${accessMode === "admin_api" || accessMode === "server_balance" ? "selected" : ""}>API сервера / баланс</option><option value="own_api" ${accessMode === "own_api" ? "selected" : ""}>API клиента</option><option value="disabled" ${accessMode === "disabled" ? "selected" : ""}>ИИ выключен</option></select></label>
            <label><span>Баланс ИИ, ₽</span><input id="admin-ai-balance" data-admin-workspace-field type="number" inputmode="decimal" min="0" step="1" value="${this.attr(balance)}" /></label>
            <label class="span-2"><span>Комментарий администратора</span><input id="admin-admin-comment" data-admin-workspace-field type="text" placeholder="Например: оплачено вручную, тест, долг, проверка" /></label>
          </div>

          <div class="admin-console-actions">
            <button class="admin-console-btn primary ep-clickable" type="button" data-admin-copy-payload="all">Скопировать всё для Firebase</button>
            <button class="admin-console-btn ep-clickable" type="button" data-admin-copy-payload="subscription">Подписка</button>
            <button class="admin-console-btn ep-clickable" type="button" data-admin-copy-payload="ai">ИИ-баланс</button>
            <button class="admin-console-btn danger ep-clickable" type="button" data-admin-disabled-write>Сохранить из V29 позже</button>
          </div>
          <div id="admin-workspace-notice" class="admin-console-note">Безопасный режим: V29 не пишет защищённые поля напрямую, чтобы не сломать старый проект.</div>
        </div>
      </div>

      <div class="admin-console-card admin-panel-card">
        <div class="admin-card-head"><div><h3>Предпросмотр документов</h3><p>Эти данные можно внести в Firebase Console по путям ниже.</p></div></div>
        <div id="admin-workspace-preview" class="admin-preview-grid">${this.previewEmpty()}</div>
      </div>

      <div id="admin-target-result" class="admin-target-result">
        ${this.lastAdminTarget ? this.renderAdminTarget(this.lastAdminTarget) : this.adminEmptyTarget("Открой пользователя, чтобы увидеть найденные документы.")}
      </div>
    `;
  },

  logsSection() {
    return `
      <div class="admin-console-card admin-panel-card">
        <h3>Только ошибки</h3>
        <p>В логи пишем только реальные ошибки: crash, firestore-denied, auth-error, decrypt-error, save-error. Не пишем клики, обычную навигацию и лишнюю диагностику.</p>
        <div class="admin-path-list compact-list">
          ${this.pathRow("Ошибки приложения", "error_logs", "только severity=error")}
          ${this.pathRow("Ошибки пользователя", "users/{uid}/error_logs", "если нужен разбор по мастеру")}
          ${this.pathRow("Журнал безопасности", "security_events", "блокировки, подозрительные устройства")}
        </div>
        <div class="admin-console-note warn">Правило: лог должен помогать чинить ошибку, а не превращаться в мусорную ленту событий.</div>
      </div>
    `;
  },

  placeholderSection(title, text, paths) {
    return `
      <div class="admin-console-card admin-panel-card">
        <h3>${this.escape(title)}</h3>
        <p>${this.escape(text)}</p>
        <div class="admin-path-list compact-list">
          ${(paths || []).map((path) => this.pathRow("Путь", path, "структура будет уточняться при подключении модуля")).join("")}
        </div>
        <div class="admin-console-note">Сейчас это визуальный каркас. Логику подключения делаем отдельно, чтобы не смешать БД, сметы и документы в один хаос.</div>
      </div>
    `;
  },

  previewEmpty() {
    return `<div class="admin-empty-state"><b>Заполни карточку пользователя</b><span>Предпросмотр появится автоматически.</span></div>`;
  },

  toggleSection(id) {
    if (!id) return;
    const section = document.getElementById(id);
    if (!section) return;
    section.classList.toggle("is-open");
  },

  setWorkspaceUid(uid) {
    const input = document.querySelector("#admin-workspace-uid");
    if (input) input.value = uid || "";
  },

  async loadUsersList() {
    const listRoot = document.querySelector("#admin-users-list");
    if (!listRoot) return;
    const policy = this.lastPolicy || EP.state?.accessPolicy;
    if (!policy?.isAdmin) {
      listRoot.innerHTML = this.usersListEmpty("Только администратор может пробовать загрузить список пользователей.");
      return;
    }
    const db = this.db();
    if (!db) {
      listRoot.innerHTML = this.usersListEmpty("Firebase не готов.");
      return;
    }
    listRoot.innerHTML = this.usersListEmpty("Загружаю пользователей…");
    try {
      const snap = await db.collection("users").limit(50).get();
      const users = [];
      snap.forEach((doc) => users.push({ uid: doc.id, ...(doc.data() || {}) }));
      this.lastUsersList = users;
      listRoot.innerHTML = this.renderUsersList(users);
    } catch (error) {
      listRoot.innerHTML = this.usersListEmpty("Список пользователей не прочитан. Вероятно, правила Firebase запрещают query users. Можно открыть пользователя по UID вручную.", error.message);
    }
  },

  renderUsersList(users) {
    if (!users.length) return this.usersListEmpty("Пользователи не найдены.");
    return users.map((user) => {
      const email = user.email || user.displayName || "без email";
      const role = user.role || (user.isAdmin ? "admin" : "master");
      const status = user.status || (user.blocked ? "blocked" : "—");
      return `
        <button class="admin-user-row ep-clickable" type="button" data-admin-select-user="${this.attr(user.uid)}">
          <span><b>${this.escape(email)}</b><small>${this.escape(user.uid)}</small></span>
          <em>${this.escape(role)} · ${this.escape(status)}</em>
        </button>
      `;
    }).join("");
  },

  usersListEmpty(message, detail) {
    return `<div class="admin-empty-state"><b>${this.escape(message)}</b>${detail ? `<span>${this.escape(detail)}</span>` : ""}</div>`;
  },

  async loadAdminTarget(uid) {
    const root = document.querySelector("#admin-target-result");
    if (!root) return;
    if (!uid) {
      root.innerHTML = this.adminEmptyTarget("Вставь UID мастера и нажми «Открыть».");
      return;
    }

    const policy = this.lastPolicy || EP.state?.accessPolicy;
    if (!policy?.isAdmin && uid !== this.currentUid()) {
      root.innerHTML = this.adminEmptyTarget("Чужой UID доступен только админу. Обычный мастер может открыть только свой профиль.");
      return;
    }

    const db = this.db();
    if (!db) {
      root.innerHTML = this.adminEmptyTarget("Firebase не готов.");
      return;
    }

    root.innerHTML = this.adminLoadingTarget(uid);

    try {
      const [userSnap, subSnap, aiSnap] = await Promise.all([
        db.collection("users").doc(uid).get(),
        db.collection("user_subscriptions").doc(uid).get(),
        db.collection("ai_accounts").doc(uid).get()
      ]);

      this.lastAdminTarget = {
        uid,
        user: userSnap.exists ? userSnap.data() : null,
        subscription: subSnap.exists ? subSnap.data() : null,
        ai: aiSnap.exists ? aiSnap.data() : null
      };

      root.innerHTML = this.renderAdminTarget(this.lastAdminTarget);
      this.fillWorkspaceFormFromTarget(this.lastAdminTarget);
      this.updateWorkspacePreview();
    } catch (error) {
      root.innerHTML = this.adminEmptyTarget("Не удалось прочитать карточку UID. Вероятно, текущие Firestore Rules не дают читать чужие профили напрямую. Это нормально для режима без Cloud Functions.", error.message);
    }
  },

  fillWorkspaceFormFromTarget(target) {
    if (!target) return;
    const user = target.user || {};
    const sub = target.subscription || {};
    const ai = target.ai || {};
    this.setValue("#admin-user-role", user.role || (user.isAdmin ? "admin" : "master"));
    this.setValue("#admin-user-status", user.status || (user.blocked ? "blocked" : "approved"));
    this.setValue("#admin-plan-select", this.normalizePlan(sub.planId || sub.plan || user.subscriptionPlan || "pro_ai"));
    this.setValue("#admin-ai-mode", ai.accessMode || ai.mode || user.aiMode || "admin_api");
    this.setValue("#admin-ai-balance", Number(ai.balanceRub || ai.balance || user.aiBalanceRub || 0));
  },

  setValue(selector, value) {
    const el = document.querySelector(selector);
    if (!el) return;
    el.value = value;
  },

  buildWorkspacePayloads() {
    const uid = String(document.querySelector("#admin-workspace-uid")?.value || this.currentUid() || "USER_UID").trim() || "USER_UID";
    const email = this.lastAdminTarget?.user?.email || this.currentEmail() || "master@example.com";
    const role = String(document.querySelector("#admin-user-role")?.value || "master");
    const status = String(document.querySelector("#admin-user-status")?.value || "approved");
    const planId = String(document.querySelector("#admin-plan-select")?.value || "pro_ai");
    const days = Number(document.querySelector("#admin-days-select")?.value || (planId === "trial" ? 2 : 30));
    const aiModeRaw = String(document.querySelector("#admin-ai-mode")?.value || "admin_api");
    const balanceRub = Number(document.querySelector("#admin-ai-balance")?.value || 0);
    const comment = String(document.querySelector("#admin-admin-comment")?.value || "").trim();
    const now = new Date();
    const until = new Date(now.getTime() + days * this.dayMs);
    const planName = this.planTitle(planId);
    const aiAccessMode = aiModeRaw === "admin_api" ? "admin_api" : aiModeRaw;
    const blocked = status === "blocked";

    const userDoc = {
      uid,
      email,
      role,
      status,
      isApproved: status === "approved" || status === "active",
      blocked,
      subscriptionPlan: planId,
      subscriptionTitle: planName,
      subscriptionUntil: until.toISOString(),
      aiEnabled: aiAccessMode !== "disabled" && !blocked,
      aiMode: aiAccessMode,
      aiBalanceRub: balanceRub,
      adminComment: comment || null,
      accessUpdatedAt: now.toISOString(),
      accessUpdatedBy: this.currentEmail() || "admin"
    };

    const subscriptionDoc = {
      uid,
      planId,
      planName,
      status: planId === "none" || blocked ? "inactive" : (planId === "trial" ? "trial" : "active"),
      active: planId !== "none" && !blocked,
      expiresAt: until.toISOString(),
      daysGranted: days,
      updatedAt: now.toISOString(),
      updatedBy: this.currentEmail() || "admin"
    };

    const aiDoc = {
      uid,
      accessMode: aiAccessMode,
      allowAi: aiAccessMode !== "disabled" && !blocked,
      balanceRub,
      blocked,
      updatedAt: now.toISOString(),
      updatedBy: this.currentEmail() || "admin"
    };

    return { uid, userDoc, subscriptionDoc, aiDoc };
  },

  updateWorkspacePreview() {
    const root = document.querySelector("#admin-workspace-preview");
    if (!root) return;
    const payloads = this.buildWorkspacePayloads();
    root.innerHTML = `
      ${this.previewCard(`users/${payloads.uid}`, payloads.userDoc)}
      ${this.previewCard(`user_subscriptions/${payloads.uid}`, payloads.subscriptionDoc)}
      ${this.previewCard(`ai_accounts/${payloads.uid}`, payloads.aiDoc)}
    `;
  },

  previewCard(path, data) {
    const text = JSON.stringify(data, null, 2);
    return `
      <div class="admin-preview-card">
        <div><b>${this.escape(path)}</b><button class="admin-mini-btn ep-clickable" type="button" data-copy-text="${this.attr(text)}">Копировать</button></div>
        <pre>${this.escape(text)}</pre>
      </div>
    `;
  },

  copyWorkspacePayload(kind, button) {
    const payloads = this.buildWorkspacePayloads();
    let text = "";
    if (kind === "user") text = JSON.stringify(payloads.userDoc, null, 2);
    else if (kind === "subscription") text = JSON.stringify(payloads.subscriptionDoc, null, 2);
    else if (kind === "ai") text = JSON.stringify(payloads.aiDoc, null, 2);
    else text = [
      `users/${payloads.uid}\n${JSON.stringify(payloads.userDoc, null, 2)}`,
      `user_subscriptions/${payloads.uid}\n${JSON.stringify(payloads.subscriptionDoc, null, 2)}`,
      `ai_accounts/${payloads.uid}\n${JSON.stringify(payloads.aiDoc, null, 2)}`
    ].join("\n\n---\n\n");

    navigator.clipboard?.writeText?.(text);
    if (button) this.flashButton(button, "Скопировано");
    this.showWorkspaceNotice("Данные скопированы. Внеси их через Firebase Console или старую админку. Прямая запись из клиента пока отключена.");
  },

  showWorkspaceNotice(message) {
    const root = document.querySelector("#admin-workspace-notice");
    if (root) root.textContent = message;
  },

  renderAdminTarget(target) {
    return `
      <div class="admin-target-card">
        <div class="admin-target-title">
          <b>Открытый пользователь</b>
          <code>${this.escape(target.uid)}</code>
        </div>
        <div class="admin-target-docs">
          ${this.targetDoc("users", target.user)}
          ${this.targetDoc("user_subscriptions", target.subscription)}
          ${this.targetDoc("ai_accounts", target.ai)}
        </div>
      </div>
    `;
  },

  targetDoc(name, data) {
    const exists = data !== null && data !== undefined;
    const text = exists ? JSON.stringify(this.cleanForDisplay(data), null, 2) : "Документ не найден";
    return `
      <div class="admin-target-doc ${exists ? "exists" : "missing"}">
        <div>
          <b>${this.escape(name)}</b>
          <span>${exists ? "найден" : "нет документа"}</span>
        </div>
        <pre>${this.escape(text)}</pre>
      </div>
    `;
  },

  statCard(title, value, note, tone) {
    return `
      <div class="admin-stat-card ${this.escape(tone || "")}">
        <span>${this.escape(title)}</span>
        <b>${this.escape(value)}</b>
        <small>${this.escape(note)}</small>
      </div>
    `;
  },

  pathRow(title, path, hint) {
    return `
      <div class="admin-path-row">
        <div>
          <b>${this.escape(title)}</b>
          <code>${this.escape(path)}</code>
          <span>${this.escape(hint)}</span>
        </div>
        <button class="admin-mini-btn ep-clickable" type="button" data-copy-text="${this.attr(path)}">Копировать</button>
      </div>
    `;
  },

  adminEmptyTarget(message, detail) {
    return `<div class="admin-empty-state"><b>${this.escape(message)}</b>${detail ? `<span>${this.escape(detail)}</span>` : ""}</div>`;
  },

  adminLoadingTarget(uid) {
    return `<div class="admin-empty-state loading"><b>Читаю документы для UID</b><code>${this.escape(uid)}</code></div>`;
  },

  cleanForDisplay(value) {
    if (value === null || value === undefined) return value;
    if (typeof value?.toDate === "function") return value.toDate().toISOString();
    if (Array.isArray(value)) return value.map((item) => this.cleanForDisplay(item));
    if (typeof value === "object") {
      const out = {};
      Object.keys(value).forEach((key) => { out[key] = this.cleanForDisplay(value[key]); });
      return out;
    }
    return value;
  },

  flashButton(button, text) {
    const old = button.textContent;
    button.textContent = text;
    clearTimeout(button.__epFlashTimer);
    button.__epFlashTimer = setTimeout(() => { button.textContent = old; }, 900);
  },

  attr(text) {
    return this.escape(text).replaceAll("`", "&#96;");
  },

  escape(text) {
    return String(text ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
};

window.AccessPolicy = {
  reload: () => EP.ExistingFirebaseAccess.reload(),
  current: () => EP.ExistingFirebaseAccess.lastPolicy || EP.state?.accessPolicy || null,
  check(feature) {
    const policy = this.current();
    if (!policy) return false;
    if (feature === "ai") return policy.aiCanUse === true;
    return policy.features?.[feature] === true;
  }
};

EP.ExistingFirebaseAccess.init();
