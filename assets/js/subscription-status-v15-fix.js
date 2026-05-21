(function () {
  const FILE = "assets/js/subscription-status-v15-fix.js";

  function text(value, fallback = "—") {
    if (value === null || value === undefined || value === "") return fallback;
    return String(value);
  }

  function planName(planId) {
    if (planId === "pro_ai") return "С ИИ";
    if (planId === "basic") return "Базовая";
    if (planId === "admin") return "Админ";
    if (planId === "trial") return "Тест";
    return "нет подписки";
  }

  function statusName(status) {
    if (status === "active") return "активна";
    if (status === "trial") return "пробный период";
    if (status === "blocked") return "заблокирована";
    if (status === "cancelled") return "отменена";
    if (status === "expired") return "истекла";
    return "нет подписки";
  }

  function formatDateFromMillis(value) {
    if (!value) return "—";
    try {
      const date = new Date(Number(value));
      if (Number.isNaN(date.getTime())) return "—";
      return date.toLocaleDateString("ru-RU") + " " + date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
    } catch {
      return "—";
    }
  }

  function storageText(policy) {
    if (!policy || policy.planId === "none") return "нет доступа";
    if (policy.planId === "basic") return "только последнее состояние / до перезапуска";
    if (policy.planId === "pro_ai" || policy.planId === "admin") return "полное хранение";
    if (policy.features?.fullStorage === true) return "полное хранение";
    return "ограниченное хранение";
  }

  function accessList(policy) {
    const features = policy?.features || {};
    return [
      ["customerEstimate", "Полноценная смета заказчику"],
      ["singleLineScheme", "Однолинейная схема"],
      ["visualization", "Визуализация"],
      ["ai", "ИИ-функции"],
      ["fullStorage", "Полное хранение данных"]
    ].map(([key, label]) => {
      const ok = key === "ai" ? policy?.ai?.canUseAi === true : features[key] === true;
      return `<div class="sub-v15-access-row ${ok ? "ok" : "no"}">
        <span>${ok ? "✓" : "×"}</span>
        <b>${label}</b>
      </div>`;
    }).join("");
  }

  function buildCard(policy) {
    const plan = planName(policy?.planId);
    const status = statusName(policy?.status);
    const activeUntil = formatDateFromMillis(policy?.expiresAtMillis || policy?.trialEndsAtMillis || policy?.expiresAt || policy?.trialEndsAt);
    const storage = storageText(policy);

    const aiBalance = Number(policy?.ai?.balanceRub || 0);
    const aiMode = policy?.ai?.accessMode === "own_api"
      ? "API клиента"
      : policy?.ai?.accessMode === "admin_api"
        ? "API сервера"
        : "выключен";

    return `
      <div class="subscription-status-v15-card">
        <h2>Текущий доступ</h2>

        <div class="subscription-status-v15-grid">
          <div class="subscription-status-v15-field">
            <span>Тариф</span>
            <b>${plan}</b>
          </div>
          <div class="subscription-status-v15-field">
            <span>Статус</span>
            <b>${status}</b>
          </div>
          <div class="subscription-status-v15-field">
            <span>Активна до</span>
            <b>${activeUntil}</b>
          </div>
          <div class="subscription-status-v15-field">
            <span>Хранение</span>
            <b>${storage}</b>
          </div>
          <div class="subscription-status-v15-field">
            <span>ИИ-баланс</span>
            <b>${aiBalance.toLocaleString("ru-RU")} ₽</b>
          </div>
          <div class="subscription-status-v15-field">
            <span>ИИ-режим</span>
            <b>${aiMode}</b>
          </div>
        </div>

        <div class="subscription-status-v15-access">
          ${accessList(policy)}
        </div>
      </div>
    `;
  }

  function findStatusHost() {
    const candidates = Array.from(document.querySelectorAll(".card, section, div"));
    return candidates.find(el => {
      const t = (el.textContent || "").trim();
      return t.includes("Текущий доступ") && (t.includes("Тариф") || t.includes("Хранение"));
    });
  }

  async function render() {
    try {
      if (!window.SubscriptionAPI?.getAccessPolicy) return;

      const policy = await window.SubscriptionAPI.getAccessPolicy();
      const html = buildCard(policy);

      let host = document.getElementById("subscriptionStatusV15Fix");
      if (!host) {
        const old = findStatusHost();
        host = document.createElement("div");
        host.id = "subscriptionStatusV15Fix";
        if (old) {
          old.replaceWith(host);
        } else {
          const page = document.querySelector("#subscriptionPage, .subscription-page, main, .app-content") || document.body;
          page.prepend(host);
        }
      }

      host.innerHTML = html;

      window.Diagnostics?.ok?.({
        file: FILE,
        module: "SubscriptionStatusV15Fix",
        functionName: "render()",
        place: "subscription status",
        code: "subscription-status-rendered",
        message: "Статус подписки отрисован: " + planName(policy.planId)
      });
    } catch (error) {
      window.Diagnostics?.error?.({
        file: FILE,
        module: "SubscriptionStatusV15Fix",
        functionName: "render()",
        place: "subscription status",
        code: error.code || "subscription-status-v15-fix-error",
        message: error.message
      });
    }
  }

  function init() {
    setTimeout(render, 800);
    setTimeout(render, 1800);
    setTimeout(render, 3500);

    document.addEventListener("click", (event) => {
      const text = event.target?.textContent || "";
      if (text.includes("Подпис") || text.includes("Обновить") || text.includes("Запросить")) {
        setTimeout(render, 700);
        setTimeout(render, 2000);
      }
    });
  }

  window.SubscriptionStatusV15Fix = { render };

  window.addEventListener("DOMContentLoaded", init);
})();
