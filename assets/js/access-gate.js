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
      visualization: false,
      warehouse: false,
      drafts: false,
      accounting: false
    },
    limits: {
      shieldItemsMax: 0,
      poolItemsMax: 0
    },
    ai: {
      balanceRub: 0,
      accessMode: "disabled",
      canUseAi: false
    },
    raw: null
  };

  const featureMap = {
    ai: { title: "ИИ-функции", message: "ИИ-функции доступны только в подписке «С ИИ». ИИ-запросы оплачиваются отдельно по ИИ-балансу." },
    singleLineScheme: { title: "Однолинейная схема", message: "Однолинейная схема недоступна в тарифе «Базовая». Для доступа нужна подписка «С ИИ»." },
    visualization: { title: "Визуализация", message: "Визуализация недоступна в тарифе «Базовая». Для доступа нужна подписка «С ИИ»." },
    customerEstimate: { title: "Полноценная смета заказчику", message: "Полноценная смета заказчику недоступна в тарифе «Базовая». Для доступа нужна подписка «С ИИ»." },
    warehouse: { title: "Склад", message: "Склад доступен только при активной подписке «С ИИ»." },
    drafts: { title: "Черновики", message: "Черновики доступны только при активной подписке «С ИИ»." },
    accounting: { title: "Бухгалтерия", message: "Бухгалтерия доступна только при активной подписке «С ИИ»." },
    fullStorage: { title: "Полное хранение данных", message: "В тарифе «Базовая» хранится только последнее состояние/последняя смета. Полное хранение доступно в подписке «С ИИ»." }
  };

  const routeFeatures = {
    ai: "ai",
    scheme: "singleLineScheme",
    visualization: "visualization",
    documents: "customerEstimate",
    estimate: "customerEstimate",
    warehouse: "warehouse",
    drafts: "drafts",
    accounting: "accounting"
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
    if (planId === "admin") return "Админ";
    return "нет подписки";
  }

  function adminBypass() {
    const u = user();
    return {
      loaded: true,
      uid: u?.uid || null,
      planId: "admin",
      status: "active",
      features: {
        ai: true,
        fullStorage: true,
        customerEstimate: true,
        singleLineScheme: true,
        visualization: true,
        warehouse: true,
        drafts: true,
        accounting: true
      },
      limits: { shieldItemsMax: null, poolItemsMax: null },
      ai: { balanceRub: 999999, accessMode: "admin_api", canUseAi: true },
      raw: { adminBypass: true }
    };
  }

  function normalizePolicy(data) {
    const d = data || {};
    const features = d.features || {};
    const limits = d.limits || {};

    return {
      loaded: true,
      uid: d.uid || user()?.uid || null,
      planId: d.planId || "none",
      status: d.status || "none",
      features: {
        ai: features.ai === true,
        fullStorage: features.fullStorage === true,
        customerEstimate: features.customerEstimate === true,
        singleLineScheme: features.singleLineScheme === true,
        visualization: features.visualization === true,
        warehouse: features.warehouse === true,
        drafts: features.drafts === true,
        accounting: features.accounting === true
      },
      limits: {
        shieldItemsMax: typeof limits.shieldItemsMax === "number" ? limits.shieldItemsMax : null,
        poolItemsMax: typeof limits.poolItemsMax === "number" ? limits.poolItemsMax : null
      },
      ai: {
        balanceRub: Number(d.ai?.balanceRub || 0),
        accessMode: d.ai?.accessMode || "disabled",
        canUseAi: d.ai?.canUseAi === true
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
        accessState = adminBypass();
        applyLocks();
        return accessState;
      }

      let data;
      if (window.SubscriptionAPI?.getAccessPolicy) {
        data = await window.SubscriptionAPI.getAccessPolicy();
      } else if (window.SubscriptionAPI?.checkAccess) {
        data = await window.SubscriptionAPI.checkAccess(u.uid);
      } else {
        throw new Error("SubscriptionAPI не готов.");
      }

      accessState = normalizePolicy(data);
      applyLocks();

      window.Diagnostics?.ok?.({
        file: FILE,
        module: "AccessGate",
        functionName: "loadAccess()",
        place: "server access policy",
        code: "access-loaded",
        message: "Доступ загружен: " + planText(accessState.planId)
      });

      return accessState;
    } catch (error) {
      window.Diagnostics?.error?.({
        file: FILE,
        module: "AccessGate",
        functionName: "loadAccess()",
        place: "server access policy",
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
    if (feature === "ai") return accessState.ai.canUseAi === true;
    return accessState.features?.[feature] === true;
  }

  function explain(feature) {
    if (feature === "ai" && accessState.features.ai === true && accessState.ai.accessMode === "admin_api" && accessState.ai.balanceRub <= 0) {
      return { title: "ИИ-баланс закончился", message: "Подписка «С ИИ» активна, но ИИ-запросы требуют положительный ИИ-баланс." };
    }
    if (feature === "ai" && accessState.features.ai === true && accessState.ai.accessMode === "disabled") {
      return { title: "ИИ выключен", message: "ИИ-доступ выключен администратором." };
    }
    return featureMap[feature] || { title: "Функция недоступна", message: "Эта функция недоступна в текущем тарифе." };
  }

  function showLocked(feature) {
    const info = explain(feature);
    alert(`${info.title}\n\n${info.message}\n\nТекущий тариф: ${planText(accessState.planId)}.`);
    window.SoundAPI?.error?.();
  }

  function guard(feature) {
    if (can(feature)) return true;
    showLocked(feature);
    return false;
  }

  async function checkServerFeature(feature) {
    if (isAdmin()) return { allowed: true, admin: true };

    if (!window.SubscriptionAPI?.checkFeatureAccess) {
      return { allowed: can(feature), reason: explain(feature).message };
    }

    const result = await window.SubscriptionAPI.checkFeatureAccess(feature);

    if (result?.policy) {
      accessState = normalizePolicy(result.policy);
      applyLocks();
    }

    if (!result.allowed) {
      alert(`${result.title || "Функция недоступна"}\n\n${result.reason || explain(feature).message}`);
      window.SoundAPI?.error?.();
    }

    return result;
  }

  async function checkLimit(limitType, currentCount = 0, addCount = 1, nextCount = null) {
    if (isAdmin()) return { allowed: true, admin: true };

    if (!window.SubscriptionAPI?.checkUsageLimit) {
      const localMax = limitType === "shieldItems" ? accessState.limits.shieldItemsMax : accessState.limits.poolItemsMax;
      const calculatedNext = nextCount === null ? Number(currentCount || 0) + Number(addCount || 1) : Number(nextCount);

      if (localMax === null || calculatedNext <= localMax) {
        return { allowed: true, max: localMax, nextCount: calculatedNext };
      }

      const reason = limitType === "shieldItems"
        ? `В тарифе «Базовая» в конфигураторе щита доступно до ${localMax} позиций.`
        : `В тарифе «Базовая» в пуле розеток/штроб доступно до ${localMax} позиций.`;

      alert(reason + "\n\nДля снятия лимита нужна подписка «С ИИ».");
      window.SoundAPI?.error?.();
      return { allowed: false, reason };
    }

    const result = await window.SubscriptionAPI.checkUsageLimit(limitType, currentCount, addCount, nextCount);

    if (!result.allowed) {
      alert(`${result.title || "Лимит тарифа"}\n\n${result.reason}`);
      window.SoundAPI?.error?.();
    }

    return result;
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
      ['[data-route="visualization"], [data-page="visualization"], [href="#visualization"]', "visualization"],
      ['[data-route="documents"], [data-page="documents"], [href="#documents"]', "customerEstimate"],
      ['[data-route="estimate"], [data-page="estimate"], [href="#estimate"]', "customerEstimate"],
      ['[data-route="warehouse"], [data-page="warehouse"], [href="#warehouse"]', "warehouse"],
      ['[data-route="drafts"], [data-page="drafts"], [href="#drafts"]', "drafts"],
      ['[data-route="accounting"], [data-page="accounting"], [href="#accounting"]', "accounting"],
      ['[data-feature-lock]', null]
    ];

    selectors.forEach(([selector, forcedFeature]) => {
      document.querySelectorAll(selector).forEach(el => {
        const feature = forcedFeature || el.dataset.featureLock;
        if (!feature) return;
        if (can(feature)) unlockLabel(el);
        else labelLocked(el, feature);
      });
    });

    const textRules = [
      ["ИИ", "ai"],
      ["Однолинейка", "singleLineScheme"],
      ["Однолинейная", "singleLineScheme"],
      ["Визуализация", "visualization"],
      ["Документы", "customerEstimate"],
      ["Склад", "warehouse"],
      ["Черновики", "drafts"],
      ["Бухгалтерия", "accounting"]
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

  function init() {
    bindGlobalGuards();

    const timer = setInterval(() => {
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
    checkServerFeature,
    checkLimit,
    checkShieldLimit: (currentCount, addCount = 1, nextCount = null) =>
      checkLimit("shieldItems", currentCount, addCount, nextCount),
    checkPoolLimit: (currentCount, addCount = 1, nextCount = null) =>
      checkLimit("poolItems", currentCount, addCount, nextCount),
    getState: () => accessState
  };

  window.addEventListener("DOMContentLoaded", () => {
    setTimeout(init, 700);
  });
})();
