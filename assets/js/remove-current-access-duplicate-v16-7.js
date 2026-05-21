(function () {
  const FILE = "assets/js/remove-current-access-duplicate-v16-7.js";

  function txt(el) {
    return (el?.textContent || "").replace(/\s+/g, " ").trim();
  }

  function isSubscriptionPage() {
    const h = String(location.hash || "").toLowerCase();
    if (h.includes("subscription") || h.includes("podpis")) return true;

    const heads = Array.from(document.querySelectorAll("h1, h2, .page-head, .page-title"))
      .map(el => txt(el))
      .join(" ");

    return heads.includes("Моя подписка") || heads.includes("Подписка");
  }

  function isWhiteWorkingSubscription(el) {
    const t = txt(el);
    return (
      t.includes("Текущая подписка") &&
      t.includes("ИИ-баланс") &&
      t.includes("ИИ-режим")
    );
  }

  function isPlanChoice(el) {
    const t = txt(el);
    return (
      t.includes("Выберите тариф") ||
      t.includes("Запросить") ||
      t.includes("Базовая") && t.includes("С ИИ") ||
      t.includes("30 дней") ||
      t.includes("90 дней") ||
      t.includes("180 дней") ||
      t.includes("Пробный период")
    );
  }

  function isOldDarkCurrentAccess(el) {
    if (!el) return false;
    if (el.closest("#subscriptionStatusStable, #subscriptionStatusV16Scoped, #subscriptionStatusV15Fix")) return false;
    if (el.querySelector("#subscriptionStatusStable, #subscriptionStatusV16Scoped, #subscriptionStatusV15Fix")) return false;
    if (isWhiteWorkingSubscription(el)) return false;
    if (isPlanChoice(el)) return false;

    const t = txt(el);

    const hasTitle = t.includes("Текущий доступ");
    const hasOldFields =
      t.includes("Тариф") &&
      t.includes("Статус") &&
      t.includes("Активна до") &&
      t.includes("Хранение");

    const hasOldFeatureList =
      t.includes("Полноценная смета заказчику") &&
      t.includes("Однолинейная схема") &&
      t.includes("Визуализация") &&
      t.includes("ИИ-функции") &&
      t.includes("Полное хранение данных");

    return hasTitle && (hasOldFields || hasOldFeatureList);
  }

  function hideDuplicate() {
    if (!isSubscriptionPage()) return;

    const candidates = Array.from(document.querySelectorAll(
      ".card, .panel, .subscription-card, section, article, div"
    ));

    let hidden = 0;

    // Сначала скрываем самые маленькие подходящие контейнеры, чтобы не спрятать всю страницу.
    candidates
      .sort((a, b) => txt(a).length - txt(b).length)
      .forEach(el => {
        if (hidden > 0) return;
        if (!isOldDarkCurrentAccess(el)) return;

        el.classList.add("v16-7-hide-current-access-duplicate");
        el.setAttribute("data-v16-7-hidden-current-access", "1");
        hidden += 1;
      });

    if (hidden) {
      window.Diagnostics?.ok?.({
        file: FILE,
        module: "RemoveCurrentAccessDuplicateV167",
        functionName: "hideDuplicate()",
        place: "subscription",
        code: "current-access-duplicate-hidden",
        message: "Старый тёмный блок 'Текущий доступ' скрыт."
      });
    }
  }

  function init() {
    setTimeout(hideDuplicate, 500);
    setTimeout(hideDuplicate, 1200);
    setTimeout(hideDuplicate, 2600);

    document.addEventListener("click", event => {
      const t = event.target?.textContent || "";
      if (t.includes("Подпис") || t.includes("Обновить") || t.includes("Подробнее")) {
        setTimeout(hideDuplicate, 500);
      }
    });

    window.addEventListener("hashchange", () => setTimeout(hideDuplicate, 600));
    window.addEventListener("focus", () => setTimeout(hideDuplicate, 600));
  }

  window.RemoveCurrentAccessDuplicateV167 = { hideDuplicate };
  window.addEventListener("DOMContentLoaded", init);
})();
