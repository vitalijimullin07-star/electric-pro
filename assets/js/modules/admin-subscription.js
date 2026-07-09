/* Electric Pro V29.17 Admin Subscription Core */
(function () {
  "use strict";

  window.EP = window.EP || {};

  function getFirebase() {
    return window.firebase || null;
  }

  function currentUser() {
    try {
      const fb = getFirebase();
      return fb && fb.auth ? fb.auth().currentUser : null;
    } catch (error) {
      return null;
    }
  }

  async function callFunction(name, payload) {
    const fb = getFirebase();
    if (!fb || !fb.functions) throw new Error("Firebase Functions unavailable");
    return fb.functions().httpsCallable(name)(payload || {});
  }

  function money(value) {
    const n = Number(value || 0);
    return `${n.toFixed(0)} ₽`;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function planTitle(plan) {
    return ({ none: "Нет", basic: "Базовая", ai: "С ИИ", trial: "Тест 10 дней" })[plan] || "Нет";
  }

  const AdminSubscription = {
    users: [],
    selected: null,

    async loadUsers() {
      const root = document.querySelector("#admin-subscription-root");
      if (root) root.innerHTML = `<div class="card"><h2>Админка</h2><p>Загружаю пользователей...</p></div>`;

      try {
        const result = await callFunction("adminListUsers", {});
        this.users = Array.isArray(result.data && result.data.users) ? result.data.users : [];
      } catch (error) {
        console.warn("AdminSubscription: function unavailable", error);
        this.users = [];
      }

      this.render();
    },

    select(uid) {
      this.selected = this.users.find((user) => user.uid === uid) || null;
      this.render();
    },

    async save() {
      if (!this.selected) return;
      const form = document.querySelector("#admin-access-form");
      if (!form) return;

      const data = new FormData(form);
      const payload = {
        targetUid: this.selected.uid,
        role: data.get("role"),
        accessStatus: data.get("accessStatus"),
        plan: data.get("plan"),
        days: Number(data.get("days") || 0),
        aiMode: data.get("aiMode"),
        aiEnabled: data.get("aiEnabled") === "on",
        aiBalanceRub: Number(data.get("aiBalanceRub") || 0),
        note: String(data.get("note") || "")
      };

      const status = document.querySelector("#admin-save-status");
      if (status) status.textContent = "Сохраняю через серверную прокладку...";

      try {
        await callFunction("adminSetUserAccess", payload);
        if (status) status.textContent = "Сохранено серверной функцией.";
        await this.loadUsers();
        this.selected = this.users.find((user) => user.uid === payload.targetUid) || this.selected;
        this.render();
      } catch (error) {
        console.error(error);
        if (status) status.textContent = "Не сохранено: Cloud Functions не задеплоены или нет прав админа.";
      }
    },

    userCard(user) {
      const sub = user.subscription || {};
      const ai = user.ai || {};
      return `
        <button class="admin-user-row" type="button" data-admin-user="${escapeHtml(user.uid)}">
          <span><b>${escapeHtml(user.displayName || user.email || user.uid)}</b><small>${escapeHtml(user.email || "без email")}</small></span>
          <span>${escapeHtml(planTitle(sub.plan))}</span>
          <span>${escapeHtml(user.role || "master")}</span>
          <span>${money(ai.balanceRub)}</span>
        </button>
      `;
    },

    selectedCard() {
      const user = this.selected;
      if (!user) {
        return `<div class="card"><h2>Карточка мастера</h2><p>Выбери пользователя слева.</p></div>`;
      }
      const sub = user.subscription || {};
      const ai = user.ai || {};
      return `
        <div class="card admin-card">
          <h2>Карточка мастера</h2>
          <p class="muted">${escapeHtml(user.email || user.uid)}</p>
          <form id="admin-access-form">
            <label>Роль
              <select name="role">
                <option value="master" ${user.role === "master" ? "selected" : ""}>Мастер</option>
                <option value="admin" ${user.role === "admin" ? "selected" : ""}>Админ</option>
              </select>
            </label>
            <label>Доступ
              <select name="accessStatus">
                <option value="approved" ${user.accessStatus === "approved" ? "selected" : ""}>Разрешён</option>
                <option value="pending" ${user.accessStatus === "pending" ? "selected" : ""}>Ожидает</option>
                <option value="blocked" ${user.accessStatus === "blocked" ? "selected" : ""}>Закрыт</option>
              </select>
            </label>
            <label>Тариф
              <select name="plan">
                <option value="none" ${sub.plan === "none" ? "selected" : ""}>Нет</option>
                <option value="basic" ${sub.plan === "basic" ? "selected" : ""}>Базовая</option>
                <option value="ai" ${sub.plan === "ai" ? "selected" : ""}>С ИИ</option>
                <option value="trial" ${sub.plan === "trial" ? "selected" : ""}>Тест 10 дней</option>
              </select>
            </label>
            <label>Срок
              <select name="days">
                <option value="2">2 дня</option>
                <option value="30" selected>30 дней</option>
                <option value="90">90 дней</option>
                <option value="180">180 дней</option>
                <option value="360">360 дней</option>
              </select>
            </label>
            <label>ИИ-режим
              <select name="aiMode">
                <option value="server" ${ai.mode === "server" ? "selected" : ""}>API сервера / баланс</option>
                <option value="client" ${ai.mode === "client" ? "selected" : ""}>API клиента</option>
                <option value="off" ${ai.mode === "off" ? "selected" : ""}>Выключен</option>
              </select>
            </label>
            <label class="admin-check"><input type="checkbox" name="aiEnabled" ${ai.enabled ? "checked" : ""}> ИИ включён</label>
            <label>Баланс ИИ, ₽
              <input name="aiBalanceRub" type="number" step="1" min="0" value="${Number(ai.balanceRub || 0)}">
            </label>
            <label>Комментарий
              <textarea name="note" rows="3">${escapeHtml(user.adminNote || "")}</textarea>
            </label>
            <button class="tile admin-save" type="button" id="admin-save-access">Сохранить параметры</button>
            <p id="admin-save-status" class="muted"></p>
          </form>
        </div>
      `;
    },

    render() {
      const root = document.querySelector("#admin-subscription-root");
      if (!root) return;

      const policy = window.EP && window.EP.AccessPolicy ? window.EP.AccessPolicy.current : null;
      const user = currentUser();
      const isAdmin = Boolean(policy && policy.role === "admin") || (user && user.email === "vits0007@gmail.com");

      if (!isAdmin) {
        root.innerHTML = `<div class="card"><h2>Админка</h2><p>Доступ только администратору.</p></div>`;
        return;
      }

      root.innerHTML = `
        <div class="admin-layout">
          <section class="card admin-list">
            <h2>Пользователи</h2>
            <p class="muted">Подписка и ИИ-баланс сохраняются только через Cloud Functions.</p>
            <button class="tile" type="button" id="admin-refresh-users">Обновить список</button>
            <div class="admin-user-list">
              ${this.users.length ? this.users.map((user) => this.userCard(user)).join("") : `<p class="muted">Пользователи не загружены. Проверь Cloud Functions.</p>`}
            </div>
          </section>
          ${this.selectedCard()}
        </div>
      `;

      root.querySelectorAll("[data-admin-user]").forEach((button) => {
        button.addEventListener("click", () => this.select(button.dataset.adminUser));
      });
      root.querySelector("#admin-refresh-users")?.addEventListener("click", () => this.loadUsers());
      root.querySelector("#admin-save-access")?.addEventListener("click", () => this.save());
    },

    init() {
      window.addEventListener("ep:route-loaded", (event) => {
        if (event.detail && event.detail.route === "admin") this.loadUsers();
      });
      window.addEventListener("ep:access-policy", () => this.render());
    }
  };

  window.EP.AdminSubscription = AdminSubscription;
  AdminSubscription.init();
})();
