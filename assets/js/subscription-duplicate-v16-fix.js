(function () {
  const FILE = "assets/js/subscription-duplicate-v16-fix.js";

  function isSubscriptionPage() {
    const hash = String(location.hash || "").toLowerCase();
    if (hash.includes("subscription") || hash.includes("podpis")) return true;

    const text = Array.from(document.querySelectorAll("h1, h2, .page-head, .page-title"))
      .map(el => el.textContent || "")
      .join(" ");

    return text.includes("Моя подписка") || text.includes("Подписка");
  }

  function textOf(el) {
    return (el?.textContent || "").replace(/\s+/g, " ").trim();
  }

  function hideDarkDuplicate() {
    if (!isSubscriptionPage()) return;

    const candidates = Array.from(document.querySelectorAll(".card, section, article, .panel, .subscription-card"));

    candidates.forEach(el => {
      if (el.closest("#subscriptionStatusStable")) return;
      if (el.querySelector("#subscriptionStatusStable")) return;

      const text = textOf(el);

      const oldStatus =
        text.includes("Текущий доступ") &&
        text.includes("Тариф") &&
        text.includes("Статус") &&
        text.includes("Активна до") &&
        text.includes("Хранение");

      const whiteWorkingStatus =
        text.includes("Текущая подписка") &&
        text.includes("ИИ-баланс") &&
        text.includes("ИИ-режим");

      const planChoice =
        text.includes("Запросить") ||
        text.includes("Выберите тариф") ||
        text.includes("Базовая подписка") ||
        text.includes("Подписка С ИИ") ||
        text.includes("Подробнее");

      if (oldStatus && !whiteWorkingStatus && !planChoice) {
        el.classList.add("v16-4-hide-dark-status");
        el.setAttribute("data-v16-4-hidden-dark-status", "1");
      }
    });

    window.Diagnostics?.ok?.({
      file: FILE,
      module: "SubscriptionDuplicateV16Fix",
      functionName: "hideDarkDuplicate()",
      place: "subscription",
      code: "dark-duplicate-hidden",
      message: "Старый тёмный дубль текущей подписки скрыт."
    });
  }

  function init() {
    setTimeout(hideDarkDuplicate, 500);
    setTimeout(hideDarkDuplicate, 1400);
    setTimeout(hideDarkDuplicate, 3000);

    document.addEventListener("click", event => {
      const t = event.target?.textContent || "";
      if (t.includes("Подпис") || t.includes("Обновить") || t.includes("Подробнее")) {
        setTimeout(hideDarkDuplicate, 500);
      }
    });

    window.addEventListener("hashchange", () => setTimeout(hideDarkDuplicate, 500));
  }

  window.SubscriptionDuplicateV16Fix = { hideDarkDuplicate };
  window.addEventListener("DOMContentLoaded", init);
})();
