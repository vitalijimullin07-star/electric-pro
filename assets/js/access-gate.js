(function () {
  const FILE = "assets/js/access-gate.js";

  let accessState = {
    loaded: false,
    uid: null,
    planId: "none",
    status: "none",
    features: {
      ai: false,
      fullStorage: false,
      customerEstimate: false,
      singleLineScheme: false,
      visualization: false
    },
    ai: {
      balanceRub: 0,
      accessMode: "disabled",
      canUseAi: false
    },
    raw: null
  };

  const featureMap = {
    ai: {
      title: "ИИ-функции",
      message: "ИИ-функции доступны только в подписке «С ИИ». Сами ИИ-запросы оплачиваются отдельно по ИИ-балансу."
    },
    singleLineScheme: {
      title: "Однолинейная схема",
      message: "Однолинейная схема недоступна в тарифе «Базовая». Для доступа нужна подписка «С ИИ»."
    },
    visualization: {
      title: "Визуализация",
      message: "Визуализация недоступна в тарифе «Базовая». Для доступа нужна подписка «С ИИ»."
    },
    customerEstimate: {
      title: "Полноценная смета заказчику",
      message: "Полноценная смета заказчику недоступна в тарифе «Базовая». Для доступа нужна подписка «С ИИ»."
    },
    fullStorage: {
      title: "Полное хранение данных",
      message: "В тарифе «Базовая» хранится только последнее состояние/последняя смета. Полное хранение доступно в подписке «С ИИ»."
    }
  };

  const routeFeatures = {
    ai: "ai",
    scheme: "singleLineScheme",
    documents: "customerEstimate",
    estimate: "customerEstimate"
  };

  function user() {
    return window.Auth?.getUser?.() || null;
  }

  function isAdmin() {
    const u = user();
    return !!u && (
      u.role === "admin" ||
      u.profile?.role === "admin" ||
      u.profile?.isAdmin === true ||
      u.email === "vits0007@gmail.com"
    );
  }

  function planText(planId) {
    if (planId === "pro_ai") return "С ИИ";
    if (planId === "basic") return "Базовая";
    return "нет подписки";
  }

  function normalizeFromServer(data) {
    const d = data || {};
    const features = d.features || d.access?.features || {};

    const planId = d.planId || d.subscription?.planId || "none";
    const status = d.status || d.subscription?.status || "none";

    const aiBalance = Number(
      d.aiBalanceRub ??
      d.ai?.balanceRub ??
      d.aiAccount?.balanceRub ??
      0
    );

    const aiAccessMode =
      d.aiAccessMode ||
      d.ai?.accessMode ||
      d.aiAccount?.accessMode ||
      "disabled";

    const allowAiBySub = features.ai === true || planId === "pro_ai";
    const canUseAi = allowAiBySub && (
      aiAccessMode === "own_api" ||
      (aiAccessMode === "admin_api" && aiBalance > 0)
    );

    return {
      loaded: true,
      uid: user()?.uid || null,
      planId,
      status,
      features: {
        ai: allowAiBySub,
        fullStorage: features.fullStorage === true || planId === "pro_ai",
        customerEstimate: features.customerEstimate === true || planId === "pro_ai",
        singleLineScheme: features.singleLineScheme === true || planId === "pro_ai",
        visualization: features.visualization === true || planId === "pro_ai"
      },
      ai: {
        balanceRub: aiBalance,
        accessMode: aiAccessMode,
        canUseAi
      },
      raw: d
    };
  }

  async function loadAccess() {
    try {
      const u = user();
      if (!u?.uid) {
        accessState.loaded = false;
        return accessState;
      }

      if (isAdmin()) {
        accessState = {
          loaded: true,
          uid: u.uid,
          planId: "admin",
          status: "active",
          features: {
            ai: true,
            fullStorage: true,
            customerEstimate: true,
            singleLineScheme: true,
            visualization: true
          },
          ai: {
            balanceRub: 999999,
            accessMode: "admin_api",
            canUseAi: true
          },
          raw: { adminBypass: true }
        };
        applyLocks();
        return accessState;
      }

      if (!window.SubscriptionAPI?.checkAccess) {
        throw new Error("SubscriptionAPI.checkAccess не найден.");
      }

      const data = await window.SubscriptionAPI.checkAccess(u.uid);
      accessState = normalizeFromServer(data);
      applyLocks();

      window.Diagnostics?.ok?.({
        file: FILE,
        module: "AccessGate",
        functionName: "loadAccess()",
        place: "subscription access",
        code: "access-loaded",
        message: "Доступ загружен: " + planText(accessState.planId)
      });

      return accessState;
    } catch (error) {
      window.Diagnostics?.error?.({
        file: FILE,
        module: "AccessGate",
        functionName: "loadAccess()",
        place: "subscription access",
        code: error.code || "access-load-error",
        message: error.message
      });

      accessState.loaded = false;
      applyLocks();
      return accessState;
    }
  }

  function can(feature) {
    if (isAdmin()) return true;
    if (!accessState.loaded) return false;

    if (feature === "ai") {
      return accessState.ai.canUseAi === true;
    }

    return accessState.features?.[feature] === true;
  }

  function explain(feature) {
    const info = featureMap[feature] || {
      title: "Функция недоступна",
      message: "Эта функция недоступна в текущем тарифе."
    };

    if (feature === "ai" && accessState.features.ai === true && accessState.ai.accessMode === "admin_api" && accessState.ai.balanceRub <= 0) {
      return {
        title: "ИИ-баланс закончился",
        message: "Подписка «С ИИ» активна, но ИИ-запросы требуют положительный ИИ-баланс. Пополните баланс через администратора."
      };
    }

    if (feature === "ai" && accessState.features.ai === true && accessState.ai.accessMode === "disabled") {
      return {
        title: "ИИ выключен",
        message: "ИИ-доступ выключен в настройках пользователя. Администратор может включить режим API мастера или админский API."
      };
    }

    return info;
  }

  function showLocked(feature) {
    const info = explain(feature);
    const text =
      `${info.title}\n\n${info.message}\n\nТекущий тариф: ${planText(accessState.planId)}.`;

    if (window.AppShell?.toast) {
      window.AppShell.toast(info.message);
    }

    alert(text);
    window.SoundAPI?.error?.();
  }

  function guard(feature) {
    if (can(feature)) return true;
    showLocked(feature);
    return false;
  }

  function labelLocked(el, feature) {
    if (!el || el.dataset.accessDecorated === "1") return;
    el.dataset.accessDecorated = "1";
    el.dataset.accessFeature = feature;
    el.classList.add("access-locked");

    const badge = document.createElement("span");
    badge.className = "access-lock-badge";
    badge.textContent = "🔒 С ИИ";
    el.appendChild(badge);
  }

  function unlockLabel(el) {
    if (!el) return;
    el.classList.remove("access-locked");
    el.querySelectorAll(".access-lock-badge").forEach(x => x.remove());
    el.dataset.accessDecorated = "0";
  }

  function applyLocks() {
    const selectors = [
      ['[data-route="ai"], [data-page="ai"], [href="#ai"], [onclick*="ai"]', "ai"],
      ['[data-route="scheme"], [data-page="scheme"], [href="#scheme"]', "singleLineScheme"],
      ['[data-route="documents"], [data-page="documents"], [href="#documents"]', "customerEstimate"],
      ['[data-route="visualization"], [data-page="visualization"], [href="#visualization"]', "visualization"],
      ['[data-feature-lock]', null]
    ];

    selectors.forEach(([selector, forcedFeature]) => {
      document.querySelectorAll(selector).forEach(el => {
        const feature = forcedFeature || el.dataset.featureLock;
        if (!feature) return;

        if (can(feature)) {
          unlockLabel(el);
        } else {
          labelLocked(el, feature);
        }
      });
    });

    // Подстраховка по текстам карточек главного экрана.
    const textRules = [
      ["ИИ", "ai"],
      ["Однолинейка", "singleLineScheme"],
      ["Однолинейная", "singleLineScheme"],
      ["Визуализация", "visualization"],
      ["Документы", "customerEstimate"]
    ];

    document.querySelectorAll(".card, .menu-item, .tile, button, a").forEach(el => {
      const text = (el.textContent || "").trim();
      if (!text) return;

      for (const [needle, feature] of textRules) {
        if (text.includes(needle) && !can(feature)) {
          labelLocked(el, feature);
          break;
        }
      }
    });
  }

  function bindGlobalGuards() {
    document.addEventListener("click", event => {
      const locked = event.target.closest("[data-feature-lock], .access-locked");
      if (!locked) return;

      const feature = locked.dataset.featureLock || locked.dataset.accessFeature;
      if (!feature) return;

      if (!can(feature)) {
        event.preventDefault();
        event.stopPropagation();
        showLocked(feature);
      }
    }, true);

    document.addEventListener("click", event => {
      const routeEl = event.target.closest("[data-route], [data-page]");
      if (!routeEl) return;

      const route = routeEl.dataset.route || routeEl.dataset.page;
      const feature = routeFeatures[route];

      if (feature && !can(feature)) {
        event.preventDefault();
        event.stopPropagation();
        showLocked(feature);
      }
    }, true);
  }

  function patchRouter() {
    const router = window.Router || window.AppRouter || null;
    if (!router || router.__accessGatePatched) return;

    const originalGo = router.go || router.navigate || router.open;
    if (typeof originalGo !== "function") return;

    const wrapped = function (route, ...args) {
      const feature = routeFeatures[route];
      if (feature && !guard(feature)) return false;
      return originalGo.call(this, route, ...args);
    };

    if (router.go) router.go = wrapped;
    if (router.navigate) router.navigate = wrapped;
    if (router.open) router.open = wrapped;

    router.__accessGatePatched = true;
  }

  function init() {
    bindGlobalGuards();

    const timer = setInterval(() => {
      patchRouter();

      const u = user();
      if (u?.uid) {
        loadAccess();
        clearInterval(timer);
      }
    }, 1200);

    setTimeout(() => clearInterval(timer), 30000);

    const observer = new MutationObserver(() => {
      if (accessState.loaded) applyLocks();
    });

    window.addEventListener("DOMContentLoaded", () => {
      observer.observe(document.body, { childList: true, subtree: true });
    });
  }

  window.AccessGate = {
    init,
    loadAccess,
    can,
    guard,
    explain,
    showLocked,
    applyLocks,
    getState: () => accessState
  };

  window.addEventListener("DOMContentLoaded", () => {
    setTimeout(init, 700);
  });
})();
