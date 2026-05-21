(function () {
  const FILE = "assets/js/remove-duplicate-subscription-status-v16.js";

  function txt(el) {
    return (el?.textContent || "").replace(/\s+/g, " ").trim();
  }

  function isNewGoodStatus(el) {
    return !!el.closest?.("#subscriptionStatusV15Fix, .subscription-status-v15-card");
  }

  function looksLikeOldStatus(el) {
    if (!el || isNewGoodStatus(el)) return false;

    const t = txt(el);
    if (!t.includes("Текущий доступ")) return false;

    const hasOldFields =
      t.includes("Тариф") &&
      t.includes("Статус") &&
      t.includes("Активна до") &&
      t.includes("Хранение");

    const hasFeatureList =
      t.includes("Полноценная смета заказчику") ||
      t.includes("Однолинейная схема") ||
      t.includes("Визуализация") ||
      t.includes("Полное хранение данных");

    return hasOldFields || hasFeatureList;
  }

  function hideOldStatusBlocks() {
    document.querySelectorAll(".card, section, article, div").forEach(el => {
      if (!looksLikeOldStatus(el)) return;

      const parentStatusFix = el.querySelector?.("#subscriptionStatusV15Fix, .subscription-status-v15-card");
      if (parentStatusFix) return;

      el.classList.add("v16-hide-old-subscription-status");
      el.setAttribute("data-v16-hidden-old-status", "1");
    });
  }

  function removeOldStatusFromHome() {
    const path = location.hash || location.pathname || "";
    const isSubscriptionPage =
      path.includes("subscription") ||
      txt(document.body).includes("Моя подписка");

    document.querySelectorAll(".card, section, article, div").forEach(el => {
      if (!looksLikeOldStatus(el)) return;

      const t = txt(el);

      // На странице подписки старый блок полностью скрываем.
      // На главном экране тоже скрываем, чтобы не было дублирования под верхней полоской.
      if (
        isSubscriptionPage ||
        t.includes("Полноценная смета заказчику") ||
        t.includes("ИИ-функции") ||
        t.includes("Полное хранение данных")
      ) {
        el.classList.add("v16-hide-old-subscription-status");
        el.setAttribute("data-v16-hidden-old-status", "1");
      }
    });
  }

  function fixSubscriptionPageSpacing() {
    const page = document.querySelector("#subscriptionPage, .subscription-page, main, .app-content");
    if (!page) return;
    page.classList.add("v16-subscription-clean-page");
  }

  function run() {
    try {
      hideOldStatusBlocks();
      removeOldStatusFromHome();
      fixSubscriptionPageSpacing();

      window.Diagnostics?.ok?.({
        file: FILE,
        module: "RemoveDuplicateSubscriptionStatusV16",
        functionName: "run()",
        place: "subscription status",
        code: "old-status-hidden",
        message: "Старый дублирующийся блок текущего доступа скрыт."
      });
    } catch (error) {
      window.Diagnostics?.error?.({
        file: FILE,
        module: "RemoveDuplicateSubscriptionStatusV16",
        functionName: "run()",
        place: "subscription status",
        code: error.code || "hide-old-status-error",
        message: error.message
      });
    }
  }

  function init() {
    run();
    setTimeout(run, 500);
    setTimeout(run, 1200);
    setTimeout(run, 2500);
    setTimeout(run, 4500);

    const observer = new MutationObserver(() => run());
    observer.observe(document.body, { childList: true, subtree: true });

    window.addEventListener("hashchange", () => setTimeout(run, 300));
    window.addEventListener("focus", () => setTimeout(run, 300));
  }

  window.RemoveDuplicateSubscriptionStatusV16 = { run };
  window.addEventListener("DOMContentLoaded", init);
})();
