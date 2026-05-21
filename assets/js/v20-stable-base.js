(function () {
  const FILE = "assets/js/v20-stable-base.js";
  const VERSION = "v20-clean-stable-base";

  let routeStack = [];
  let handlingBack = false;
  let statusRenderedAt = 0;

  const HOME_ROUTES = ["home", "main", "dashboard"];
  const SAFE_ROUTES = new Set([
    "home", "main", "dashboard",
    "subscription", "subscribe",
    "admin", "settings", "profile",
    "database", "db", "materials", "works",
    "estimate", "supplier", "drafts",
    "shield", "pool",
    "accounting", "warehouse",
    "ai", "scheme", "visualization", "documents"
  ]);

  function diag(level, code, message, extra = {}) {
    const api = window.Diagnostics;
    const payload = {
      file: FILE,
      module: "V20StableBase",
      functionName: extra.functionName || "runtime",
      place: extra.place || "stable-base",
      code,
      message
    };

    if (level === "error") api?.error?.(payload);
    else api?.ok?.(payload);
  }

  function normalizeRoute(route) {
    const raw = String(route || "")
      .replace(/^#\/?/, "")
      .replace(/^\//, "")
      .trim();

    return raw.split("?")[0].split("/")[0] || "home";
  }

  function currentRoute() {
    const hash = String(location.hash || "");
    if (hash) return normalizeRoute(hash);

    const bodyRoute =
      document.body?.dataset?.route ||
      document.body?.dataset?.page ||
      document.querySelector("[data-current-route]")?.dataset?.currentRoute ||
      "";

    return normalizeRoute(bodyRoute || "home");
  }

  function isHome(route = currentRoute()) {
    return HOME_ROUTES.includes(normalizeRoute(route));
  }

  function pushRoute(route) {
    const r = normalizeRoute(route);
    if (!r || !SAFE_ROUTES.has(r)) return;

    const last = routeStack[routeStack.length - 1];
    if (last !== r) {
      routeStack.push(r);
      if (routeStack.length > 30) routeStack.shift();
    }
  }

  function goRoute(route) {
    const r = normalizeRoute(route);

    if (!SAFE_ROUTES.has(r)) return goHome();

    if (window.Router?.navigate) {
      window.Router.navigate(r);
      return true;
    }

    for (const name of ["navigate", "openPage", "showPage", "goTo", "routeTo"]) {
      if (typeof window[name] === "function") {
        window[name](r);
        return true;
      }
    }

    location.hash = "#" + r;
    return true;
  }

  function goHome() {
    if (window.Router?.navigate) {
      window.Router.navigate("home");
      return true;
    }

    for (const name of ["navigate", "openPage", "showPage", "goTo", "routeTo"]) {
      if (typeof window[name] === "function") {
        window[name]("home");
        return true;
      }
    }

    location.hash = "#home";
    return true;
  }

  function closeTopOverlay() {
    const selectors = [
      "#adminV16LogModal:not(.is-hidden)",
      ".modal:not(.is-hidden)",
      ".dialog:not(.is-hidden)",
      ".popup:not(.is-hidden)",
      ".drawer.open",
      ".drawer.is-open",
      ".side-menu.open",
      ".side-menu.is-open",
      ".menu.open",
      ".menu.is-open",
      "[data-modal].open",
      "[data-modal].is-open"
    ];

    const el = document.querySelector(selectors.join(","));
    if (!el) return false;

    const closeBtn = el.querySelector(
      "[data-v16-log-close], [data-close], .close, .modal-close, .dialog-close, .drawer-close, button[aria-label='Close'], button[aria-label='Закрыть']"
    );

    if (closeBtn) {
      closeBtn.click();
    } else {
      el.classList.add("is-hidden");
      el.classList.remove("open", "is-open", "show", "visible");
      el.setAttribute("hidden", "hidden");
    }

    diag("ok", "overlay-closed-by-back", "Кнопка Назад закрыла модалку/меню.", { functionName: "closeTopOverlay" });
    return true;
  }

  function handleBack() {
    if (handlingBack) return;
    handlingBack = true;

    try {
      if (closeTopOverlay()) return;

      const current = currentRoute();

      if (routeStack[routeStack.length - 1] === current) {
        routeStack.pop();
      }

      const previous = routeStack.pop();

      if (previous && previous !== current) {
        goRoute(previous);
        diag("ok", "back-to-previous-route", "Назад внутри приложения: " + previous, { functionName: "handleBack" });
        return;
      }

      if (!isHome(current)) {
        goHome();
        diag("ok", "back-to-home", "Назад вернул на главный экран.", { functionName: "handleBack" });
        return;
      }

      // На главном экране не выходим сразу.
      goHome();
      diag("ok", "back-kept-home", "Назад удержан на главном экране.", { functionName: "handleBack" });
    } finally {
      setTimeout(() => {
        handlingBack = false;
      }, 250);
    }
  }

  function patchNavigationFunction(name, owner = window) {
    const fn = owner?.[name];
    if (typeof fn !== "function" || fn.__v20Patched) return;

    const patched = function (...args) {
      const before = currentRoute();
      const result = fn.apply(this, args);
      const target = normalizeRoute(args[0] || currentRoute());

      if (target && target !== before) {
        pushRoute(before);
      }

      setTimeout(renderSubscriptionStatusIfNeeded, 500);
      return result;
    };

    patched.__v20Patched = true;
    owner[name] = patched;
  }

  function patchNavigation() {
    ["navigate", "openPage", "showPage", "goTo", "routeTo"].forEach(name => patchNavigationFunction(name, window));

    if (window.Router) {
      patchNavigationFunction("navigate", window.Router);
    }
  }

  function ensureHistoryTrap() {
    try {
      if (!history.state || !history.state.__epBackGuard) {
        history.replaceState({ ...(history.state || {}), __epBackGuard: true }, "", location.href);
      }

      history.pushState({ __epBackGuard: true, epRoute: currentRoute() }, "", location.href);
    } catch (error) {
      // Некоторые WebView могут ограничивать history API.
    }
  }

  function bindRouteClicks() {
    document.addEventListener("click", event => {
      const el = event.target.closest("[data-route], [data-page], [data-target], [data-section], a[href^='#']");
      if (!el) return;

      const route =
        el.dataset?.route ||
        el.dataset?.page ||
        el.dataset?.target ||
        el.dataset?.section ||
        el.getAttribute("href") ||
        "";

      const target = normalizeRoute(route);
      const current = currentRoute();

      if (target && SAFE_ROUTES.has(target) && target !== current) {
        pushRoute(current);
      }

      setTimeout(renderSubscriptionStatusIfNeeded, 600);
    }, true);
  }

  function isSubscriptionPage() {
    const hash = String(location.hash || "").toLowerCase();

    if (hash.includes("subscription") || hash.includes("subscribe") || hash.includes("podpis")) return true;

    const heads = Array.from(document.querySelectorAll("h1, h2, .page-head, .page-title"))
      .map(el => (el.textContent || "").replace(/\s+/g, " ").trim())
      .join(" ");

    return heads.includes("Моя подписка") || heads.includes("Подписка");
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

    return d.toLocaleDateString("ru-RU") + " " + d.toLocaleTimeString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function storageText(policy) {
    if (!policy || policy.planId === "none") return "нет доступа";
    if (policy.planId === "basic") return "ограниченное";
    if (policy.planId === "pro_ai" || policy.planId === "admin") return "полное";
    return policy.features?.fullStorage ? "полное" : "ограниченное";
  }

  function removeBigStatusOutsideSubscription() {
    if (isSubscriptionPage()) return;

    document.querySelectorAll(
      "#subscriptionStatusStable, #subscriptionStatusV20, #subscriptionStatusV16Scoped, #subscriptionStatusV15Fix, .subscription-status-v15-card, .subscription-status-v16-card, .subscription-status-stable-card"
    ).forEach(el => {
      const host =
        el.id === "subscriptionStatusV20" ||
        el.id === "subscriptionStatusStable" ||
        el.id === "subscriptionStatusV16Scoped" ||
        el.id === "subscriptionStatusV15Fix"
          ? el
          : el.closest("#subscriptionStatusV20, #subscriptionStatusStable, #subscriptionStatusV16Scoped, #subscriptionStatusV15Fix");

      (host || el).remove();
    });
  }

  function restorePlanChoiceBlocks() {
    document.querySelectorAll(
      ".v16-hide-old-subscription-status, .v16-2-hide-old-status-only, .v16-4-hide-dark-status, .v16-7-hide-current-access-duplicate, [data-v16-hidden-old-status], [data-v16-4-hidden-dark-status], [data-v16-7-hidden-current-access]"
    ).forEach(el => {
      el.classList.remove(
        "v16-hide-old-subscription-status",
        "v16-2-hide-old-status-only",
        "v16-4-hide-dark-status",
        "v16-7-hide-current-access-duplicate"
      );
      el.removeAttribute("data-v16-hidden-old-status");
      el.removeAttribute("data-v16-4-hidden-dark-status");
      el.removeAttribute("data-v16-7-hidden-current-access");
      el.style.display = "";
      el.style.visibility = "";
      el.style.height = "";
      el.style.minHeight = "";
      el.style.maxHeight = "";
      el.style.margin = "";
      el.style.padding = "";
      el.style.overflow = "";
    });
  }

  function isOldCurrentAccessBlock(el) {
    if (!el) return false;

    if (el.closest("#subscriptionStatusV20")) return false;
    if (el.querySelector("#subscriptionStatusV20")) return false;

    const t = (el.textContent || "").replace(/\s+/g, " ").trim();

    const isWhiteWorking =
      t.includes("Текущая подписка") &&
      t.includes("ИИ-баланс") &&
      t.includes("ИИ-режим");

    if (isWhiteWorking) return false;

    const isPlanChoice =
      t.includes("Выберите тариф") ||
      t.includes("Запросить") ||
      t.includes("Базовая подписка") ||
      t.includes("Подписка С ИИ") ||
      t.includes("30 дней") ||
      t.includes("90 дней") ||
      t.includes("Пробный период");

    if (isPlanChoice) return false;

    const hasOldTitle = t.includes("Текущий доступ");
    const hasOldFields = t.includes("Тариф") && t.includes("Статус") && t.includes("Активна до") && t.includes("Хранение");
    const hasOldFeatures = t.includes("Полноценная смета заказчику") && t.includes("Однолинейная схема") && t.includes("ИИ-функции");

    return hasOldTitle && (hasOldFields || hasOldFeatures);
  }

  function hideOldCurrentAccessDuplicate(root) {
    const candidates = Array.from(root.querySelectorAll(".card, .panel, .subscription-card, section, article, div"))
      .sort((a, b) => (a.textContent || "").length - (b.textContent || "").length);

    for (const el of candidates) {
      if (isOldCurrentAccessBlock(el)) {
        el.classList.add("v20-hide-old-current-access");
        break;
      }
    }
  }

  function findSubscriptionRoot() {
    return document.querySelector("#subscriptionPage, .subscription-page")
      || Array.from(document.querySelectorAll("section, main, .page, .screen")).find(el => {
        const t = el.textContent || "";
        return t.includes("Моя подписка") || t.includes("Выберите тариф") || t.includes("Запросить");
      })
      || document.querySelector("main")
      || document.body;
  }

  function renderStatusHtml(policy) {
    const aiBalance = Number(policy?.ai?.balanceRub || 0);
    const aiMode =
      policy?.ai?.accessMode === "own_api"
        ? "API клиента"
        : policy?.ai?.accessMode === "admin_api"
          ? "API сервера"
          : "выключен";

    return `
      <div class="subscription-status-v20-card">
        <div class="subscription-status-v20-title">Текущая подписка</div>
        <div class="subscription-status-v20-grid">
          <div><span>Тариф</span><b>${planName(policy?.planId)}</b></div>
          <div><span>Статус</span><b>${statusName(policy?.status)}</b></div>
          <div><span>Активна до</span><b>${dateText(policy?.expiresAtMillis || policy?.trialEndsAtMillis)}</b></div>
          <div><span>Хранение</span><b>${storageText(policy)}</b></div>
          <div><span>ИИ-баланс</span><b>${aiBalance.toLocaleString("ru-RU")} ₽</b></div>
          <div><span>ИИ-режим</span><b>${aiMode}</b></div>
        </div>
      </div>
    `;
  }

  async function renderSubscriptionStatusIfNeeded(force = false) {
    removeBigStatusOutsideSubscription();
    restorePlanChoiceBlocks();

    if (!isSubscriptionPage()) return;
    if (!window.SubscriptionAPI?.getAccessPolicy) return;

    const now = Date.now();
    if (!force && now - statusRenderedAt < 1200) return;
    statusRenderedAt = now;

    try {
      const policy = await window.SubscriptionAPI.getAccessPolicy();
      const root = findSubscriptionRoot();

      let host = document.getElementById("subscriptionStatusV20");
      if (!host) {
        host = document.createElement("div");
        host.id = "subscriptionStatusV20";

        const head = root.querySelector(".page-head, h1, h2");
        if (head && head.parentNode) head.parentNode.insertBefore(host, head.nextSibling);
        else root.prepend(host);
      }

      host.innerHTML = renderStatusHtml(policy);
      hideOldCurrentAccessDuplicate(root);

      diag("ok", "subscription-status-v20-rendered", "Статус подписки V20 отрисован только в разделе Подписка.", { functionName: "renderSubscriptionStatusIfNeeded" });
    } catch (error) {
      diag("error", error.code || "subscription-status-v20-error", error.message, { functionName: "renderSubscriptionStatusIfNeeded" });
    }
  }

  function init() {
    patchNavigation();
    bindRouteClicks();
    ensureHistoryTrap();
    pushRoute(currentRoute());

    window.addEventListener("popstate", event => {
      event.preventDefault?.();
      setTimeout(ensureHistoryTrap, 50);
      handleBack();
    });

    window.addEventListener("hashchange", () => {
      if (!handlingBack) pushRoute(currentRoute());
      setTimeout(() => renderSubscriptionStatusIfNeeded(true), 600);
    });

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        patchNavigation();
        ensureHistoryTrap();
        setTimeout(() => renderSubscriptionStatusIfNeeded(false), 600);
      }
    });

    document.addEventListener("click", event => {
      const t = event.target?.textContent || "";
      if (t.includes("Подпис") || t.includes("Обновить") || t.includes("Подробнее") || t.includes("Запросить")) {
        setTimeout(() => renderSubscriptionStatusIfNeeded(true), 700);
      }
    });

    setTimeout(() => renderSubscriptionStatusIfNeeded(true), 900);
    setTimeout(() => renderSubscriptionStatusIfNeeded(false), 2600);

    window.V20StableBase = {
      version: VERSION,
      handleBack,
      renderSubscriptionStatus: renderSubscriptionStatusIfNeeded,
      currentRoute,
      stack: () => routeStack.slice()
    };

    diag("ok", "v20-stable-base-ready", "V20 Clean Stable Base загружен.", { functionName: "init" });
  }

  window.addEventListener("DOMContentLoaded", init);
})();
