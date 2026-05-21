(function () {
  const FILE = "assets/js/admin-subscription-ui.js";
  let currentUid = null;

  function esc(text) {
    return String(text ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function money(value) {
    const n = Number(value || 0);
    return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(n) + " ₽";
  }

  function formatDate(value) {
    try {
      if (!value) return "—";
      if (value.toDate) return value.toDate().toLocaleString("ru-RU");
      return new Date(value).toLocaleString("ru-RU");
    } catch { return "—"; }
  }

  function planName(planId) {
    return planId === "pro_ai" ? "С ИИ" : "Базовая";
  }

  function yesNo(v) { return v ? "доступно" : "недоступно"; }

  async function injectAdminSubscriptionBlock(uid) {
    currentUid = uid;
    const details = document.getElementById("adminUserDetails");
    const grid = details?.querySelector(".admin-detail-grid") || details;
    if (!grid || document.getElementById("adminSubscriptionBlock")) return;

    const placeholder = document.createElement("div");
    placeholder.id = "adminSubscriptionBlock";
    placeholder.className = "admin-detail-card";
    placeholder.innerHTML = `<h3>Подписка</h3><div class="admin-empty">Загрузка подписки...</div>`;
    grid.insertBefore(placeholder, grid.children[1] || null);

    try {
      const sub = await window.SubscriptionAPI.readSubscription(uid) || {};
      const txs = await window.SubscriptionAPI.listTransactions(uid, 10);
      const reqs = await window.SubscriptionAPI.listPaymentRequests(uid, 10);
      const features = sub.features || {};

      placeholder.innerHTML = `
        <h3>Подписка</h3>
        <div class="admin-kv">
          <div class="admin-kv-row"><b>Тариф</b><span>${esc(sub.planName || planName(sub.planId))}</span></div>
          <div class="admin-kv-row"><b>Статус</b><span>${esc(sub.status || "нет подписки")}</span></div>
          <div class="admin-kv-row"><b>Активна до</b><span>${esc(formatDate(sub.expiresAt))}</span></div>
          <div class="admin-kv-row"><b>Хранение</b><span>${sub.storageMode === "full" ? "полное" : "до перезапуска / последняя смета"}</span></div>
          <div class="admin-kv-row"><b>ИИ</b><span>${yesNo(features.ai)}</span></div>
          <div class="admin-kv-row"><b>Смета заказчику</b><span>${yesNo(features.customerEstimate)}</span></div>
          <div class="admin-kv-row"><b>Однолинейка</b><span>${yesNo(features.singleLineScheme)}</span></div>
          <div class="admin-kv-row"><b>Визуализация</b><span>${yesNo(features.visualization)}</span></div>
        </div>

        <div class="subscription-warning-inline">
          Подписка «С ИИ» открывает доступ к ИИ-функциям, но ИИ-запросы оплачиваются отдельно по токенам через ИИ-баланс.
        </div>

        <div class="admin-actions-3">
          <button class="btn btn-ghost ep-clickable" data-sub-admin-action="seed-plans">Создать тарифы</button>
          <button class="btn btn-primary ep-clickable" data-sub-admin-action="grant-basic-30">Базовая 30д</button>
          <button class="btn btn-primary ep-clickable" data-sub-admin-action="grant-pro-30">С ИИ 30д</button>
          <button class="btn btn-ghost ep-clickable" data-sub-admin-action="grant-pro-90">С ИИ 90д</button>
          <button class="btn btn-ghost admin-danger ep-clickable" data-sub-admin-action="cancel-subscription">Отменить</button>
        </div>

        <h3 style="margin-top:14px">Запросы оплаты</h3>
        <div class="admin-mini-list">
          ${reqs.length ? reqs.map(r => `
            <div class="admin-mini-item">
              <b>${esc(planName(r.data.planId))} · ${money(r.data.amountRub)}</b>
              <div class="admin-mini-muted">${esc(r.data.status || "pending")} · ${esc(formatDate(r.data.createdAt))}</div>
            </div>
          `).join("") : `<div class="admin-mini-item"><span class="admin-mini-muted">Запросов пока нет.</span></div>`}
        </div>

        <h3 style="margin-top:14px">История подписки</h3>
        <div class="admin-mini-list">
          ${txs.length ? txs.map(t => `
            <div class="admin-mini-item">
              <b>${esc(t.data.type || "operation")} · ${esc(planName(t.data.planId))}</b>
              <div class="admin-mini-muted">
                ${money(t.data.amountRub)} · ${esc(t.data.periodDays || 0)} дней<br>
                До: ${esc(formatDate(t.data.afterExpiresAt))}<br>
                Дата: ${esc(formatDate(t.data.createdAt))}
              </div>
            </div>
          `).join("") : `<div class="admin-mini-item"><span class="admin-mini-muted">Операций пока нет.</span></div>`}
        </div>
      `;
    } catch (error) {
      placeholder.innerHTML = `<h3>Подписка</h3><div class="admin-empty">Ошибка подписки: ${esc(error.message)}</div>`;
      window.Diagnostics?.error?.({ file: FILE, module: "AdminSubscriptionUI", functionName: "injectAdminSubscriptionBlock()", place: "admin user card", code: error.code || "admin-sub-error", message: error.message });
    }
  }

  async function runAdminAction(action) {
    if (!currentUid) return;
    try {
      if (action === "seed-plans") {
        await window.SubscriptionAPI.seedPlans();
        alert("Тарифы по умолчанию созданы/обновлены.");
      } else if (action === "grant-basic-30") {
        if (!confirm("Выдать пользователю Базовую подписку на 30 дней?")) return;
        await window.SubscriptionAPI.grant(currentUid, "basic", 30, 0, "admin_basic_30");
      } else if (action === "grant-pro-30") {
        const amount = Number(prompt("Сумма оплаты, ₽. Можно 0 для теста:", "0") || 0);
        await window.SubscriptionAPI.grant(currentUid, "pro_ai", 30, amount, "admin_pro_ai_30");
      } else if (action === "grant-pro-90") {
        const amount = Number(prompt("Сумма оплаты, ₽. Можно 0 для теста:", "0") || 0);
        await window.SubscriptionAPI.grant(currentUid, "pro_ai", 90, amount, "admin_pro_ai_90");
      } else if (action === "cancel-subscription") {
        if (!confirm("Отменить подписку пользователя?")) return;
        await window.SubscriptionAPI.cancel(currentUid, "admin_cancel");
      }

      window.SoundAPI?.success?.();
      document.getElementById("adminSubscriptionBlock")?.remove();
      await injectAdminSubscriptionBlock(currentUid);
      await window.AdminAPI?.loadUsers?.();
    } catch (error) {
      alert("Ошибка подписки: " + error.message);
      window.Diagnostics?.error?.({ file: FILE, module: "AdminSubscriptionUI", functionName: "runAdminAction()", place: "subscription cloud function", code: error.code || "admin-sub-action-error", message: error.message });
    }
  }

  function wrapAdminApi() {
    if (!window.AdminAPI || window.AdminAPI.__subscriptionWrapped) return false;
    const original = window.AdminAPI.openUserCard;
    if (typeof original !== "function") return false;

    window.AdminAPI.openUserCard = async function(uid) {
      const result = await original.apply(this, arguments);
      setTimeout(() => injectAdminSubscriptionBlock(uid), 250);
      return result;
    };
    window.AdminAPI.__subscriptionWrapped = true;
    return true;
  }

  function bind() {
    document.addEventListener("click", event => {
      const btn = event.target.closest("[data-sub-admin-action]");
      if (!btn) return;
      event.preventDefault();
      event.stopPropagation();
      runAdminAction(btn.dataset.subAdminAction);
    }, true);

    const timer = setInterval(() => {
      if (wrapAdminApi()) clearInterval(timer);
    }, 300);

    setTimeout(() => clearInterval(timer), 10000);
  }

  window.AdminSubscriptionUI = { injectAdminSubscriptionBlock, runAdminAction, wrapAdminApi };
  bind();
})();
