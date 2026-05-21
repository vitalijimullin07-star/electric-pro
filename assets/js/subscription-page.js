(function () {
  const FILE = "assets/js/subscription-page.js";

  function esc(text) {
    return String(text ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function formatDate(value) {
    try {
      if (!value) return "—";
      if (value.toDate) return value.toDate().toLocaleString("ru-RU");
      return new Date(value).toLocaleString("ru-RU");
    } catch {
      return "—";
    }
  }

  function planName(planId) {
    return planId === "pro_ai" ? "С ИИ" : "Базовая";
  }

  function featureLine(title, enabled) {
    return `<div class="subscription-feature-line ${enabled ? "ok" : "off"}"><b>${enabled ? "✓" : "×"}</b><span>${esc(title)}</span></div>`;
  }

  async function renderStatus() {
    const box = document.getElementById("subscriptionStatusBox");
    if (!box) return;

    try {
      const access = await window.SubscriptionAPI.checkAccess();
      const sub = access.subscription || {};
      const features = access.features || {};

      box.innerHTML = `
        <h3>Текущий доступ</h3>
        <div class="admin-kv">
          <div class="admin-kv-row"><b>Тариф</b><span>${esc(sub.planName || planName(sub.planId))}</span></div>
          <div class="admin-kv-row"><b>Статус</b><span>${esc(sub.status || "нет подписки")}</span></div>
          <div class="admin-kv-row"><b>Активна до</b><span>${esc(formatDate(sub.expiresAt))}</span></div>
          <div class="admin-kv-row"><b>Хранение</b><span>${features.fullStorage ? "полное" : "до перезапуска, кроме последней сметы"}</span></div>
        </div>
        <div class="subscription-features-list">
          ${featureLine("Полноценная смета заказчику", features.customerEstimate)}
          ${featureLine("Однолинейная схема", features.singleLineScheme)}
          ${featureLine("Визуализация", features.visualization)}
          ${featureLine("ИИ-функции", features.ai)}
          ${featureLine("Полное хранение данных", features.fullStorage)}
        </div>
      `;
    } catch (error) {
      box.innerHTML = `<h3>Текущий доступ</h3><div class="admin-empty">Ошибка: ${esc(error.message)}</div>`;
      window.Diagnostics?.error?.({
        file: FILE,
        module: "SubscriptionPage",
        functionName: "renderStatus()",
        place: "subscription page",
        code: error.code || "subscription-status-error",
        message: error.message
      });
    }
  }

  async function request(planId) {
    try {
      const label = planName(planId);
      if (!confirm("Запросить оплату тарифа «" + label + "»?")) return;
      await window.SubscriptionAPI.requestPayment(planId, 30, "Запрос оплаты тарифа " + label);
      window.SoundAPI?.success?.();
      alert("Запрос создан. Напишите администратору в Telegram: @Pokemoni_na_svjazy");
      await renderStatus();
    } catch (error) {
      alert("Ошибка запроса: " + error.message);
      window.Diagnostics?.error?.({
        file: FILE,
        module: "SubscriptionPage",
        functionName: "request()",
        place: "request subscription payment",
        code: error.code || "subscription-request-error",
        message: error.message
      });
    }
  }

  function bindPage() {
    document.querySelector("[data-sub-action='request-basic']")?.addEventListener("click", () => request("basic"));
    document.querySelector("[data-sub-action='request-pro-ai']")?.addEventListener("click", () => request("pro_ai"));
    renderStatus();
  }

  window.SubscriptionPage = { bindPage, renderStatus };
})();
