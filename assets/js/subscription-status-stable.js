(function () {
  const FILE = "assets/js/subscription-status-stable.js";

  function isSubscriptionPage() {
    const hash = String(location.hash || "").toLowerCase();
    if (hash.includes("subscription") || hash.includes("podpis")) return true;

    const titleText = Array.from(document.querySelectorAll("h1, h2, .page-head, .page-title"))
      .map(el => el.textContent || "")
      .join(" ");

    return titleText.includes("Моя подписка") || titleText.includes("Подписка");
  }

  function planName(planId) {
    if (planId === "pro_ai") return "С ИИ";
    if (planId === "basic") return "Базовая";
    if (planId === "admin") return "Админ";
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

  function dateText(ms) {
    const n = Number(ms || 0);
    if (!Number.isFinite(n) || n <= 0) return "—";
    const d = new Date(n);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("ru-RU") + " " + d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  }

  function storageText(policy) {
    if (!policy || policy.planId === "none") return "нет доступа";
    if (policy.planId === "basic") return "ограниченное";
    if (policy.planId === "pro_ai" || policy.planId === "admin") return "полное";
    return policy.features?.fullStorage ? "полное" : "ограниченное";
  }

  function findRoot() {
    return document.querySelector("#subscriptionPage, .subscription-page")
      || Array.from(document.querySelectorAll("section, main, .page, .screen")).find(el => {
        const t = el.textContent || "";
        return t.includes("Моя подписка") || t.includes("Выберите тариф");
      })
      || document.querySelector("main")
      || document.body;
  }

  function removeOutside() {
    if (isSubscriptionPage()) return;
    document.querySelectorAll("#subscriptionStatusStable").forEach(el => el.remove());
  }

  function restoreChoiceBlocks() {
    document.querySelectorAll(".v16-hide-old-subscription-status, .v16-2-hide-old-status-only, [data-v16-hidden-old-status='1']").forEach(el => {
      el.classList.remove("v16-hide-old-subscription-status", "v16-2-hide-old-status-only");
      el.removeAttribute("data-v16-hidden-old-status");
      el.style.display = "";
      el.style.visibility = "";
      el.style.height = "";
      el.style.minHeight = "";
      el.style.margin = "";
      el.style.padding = "";
      el.style.overflow = "";
    });
  }

  function hideOnlyOldUnreadableStatus(root) {
    Array.from(root.querySelectorAll(".card, section, article")).forEach(el => {
      if (el.closest("#subscriptionStatusStable")) return;

      const t = (el.textContent || "").replace(/\s+/g, " ").trim();
      const oldStatus =
        t.includes("Текущий доступ") &&
        t.includes("Тариф") &&
        t.includes("Статус") &&
        t.includes("Активна до") &&
        t.includes("Хранение");

      const planChoice =
        t.includes("Запросить") ||
        t.includes("Базовая") ||
        t.includes("С ИИ") ||
        t.includes("30 дней") ||
        t.includes("90 дней") ||
        t.includes("180 дней") ||
        t.includes("Пробный период");

      if (oldStatus && !planChoice) {
        el.style.display = "none";
      }
    });
  }

  async function render() {
    try {
      restoreChoiceBlocks();
      removeOutside();

      if (!isSubscriptionPage()) return;
      if (!window.SubscriptionAPI?.getAccessPolicy) return;

      const policy = await window.SubscriptionAPI.getAccessPolicy();
      const root = findRoot();

      let host = document.getElementById("subscriptionStatusStable");
      if (!host) {
        host = document.createElement("div");
        host.id = "subscriptionStatusStable";

        const head = root.querySelector(".page-head, h1, h2");
        if (head && head.parentNode) head.parentNode.insertBefore(host, head.nextSibling);
        else root.prepend(host);
      }

      const aiBalance = Number(policy?.ai?.balanceRub || 0);
      const aiMode = policy?.ai?.accessMode === "own_api"
        ? "API клиента"
        : policy?.ai?.accessMode === "admin_api"
          ? "API сервера"
          : "выключен";

      host.innerHTML = `
        <div class="subscription-status-stable-card">
          <div class="subscription-status-stable-title">Текущая подписка</div>
          <div class="subscription-status-stable-grid">
            <div><span>Тариф</span><b>${planName(policy?.planId)}</b></div>
            <div><span>Статус</span><b>${statusName(policy?.status)}</b></div>
            <div><span>Активна до</span><b>${dateText(policy?.expiresAtMillis || policy?.trialEndsAtMillis)}</b></div>
            <div><span>Хранение</span><b>${storageText(policy)}</b></div>
            <div><span>ИИ-баланс</span><b>${aiBalance.toLocaleString("ru-RU")} ₽</b></div>
            <div><span>ИИ-режим</span><b>${aiMode}</b></div>
          </div>
        </div>
      `;

      hideOnlyOldUnreadableStatus(root);
    } catch (error) {
      window.Diagnostics?.error?.({
        file: FILE,
        module: "SubscriptionStatusStable",
        functionName: "render()",
        place: "subscription",
        code: error.code || "subscription-status-stable-error",
        message: error.message
      });
    }
  }

  function init() {
    setTimeout(render, 900);
    setTimeout(render, 2500);

    window.addEventListener("hashchange", () => {
      setTimeout(render, 600);
    });

    document.addEventListener("click", event => {
      const text = event.target?.textContent || "";
      if (text.includes("Подпис") || text.includes("Обновить")) {
        setTimeout(render, 800);
      }
    });
  }

  window.SubscriptionStatusStable = { render };
  window.addEventListener("DOMContentLoaded", init);
})();
