(function () {
  const FILE = "assets/js/access-gate.js";
  let accessState = { loaded: false, uid: null, planId: "none", status: "none", features: {}, limits: { shieldItemsMax: 0, poolItemsMax: 0 }, ai: { balanceRub: 0, accessMode: "disabled", canUseAi: false }, raw: null };
  const featureMap = {
    database: { title: "База", message: "База доступна только при активной подписке." },
    estimate: { title: "Смета", message: "Смета доступна только при активной подписке." },
    supplier: { title: "Поставщику", message: "Раздел «Поставщику» доступен только при активной подписке." },
    drafts: { title: "Черновик", message: "Черновик доступен только при активной подписке." },
    shield: { title: "Конфигуратор щита", message: "Конфигуратор щита доступен только при активной подписке." },
    pool: { title: "Пул розеток/штроб", message: "Пул доступен только при активной подписке." },
    ai: { title: "ИИ-функции", message: "ИИ-функции доступны только в подписке «С ИИ». ИИ-запросы оплачиваются отдельно." },
    singleLineScheme: { title: "Однолинейная схема", message: "Однолинейная схема доступна только в подписке «С ИИ»." },
    visualization: { title: "Визуализация", message: "Визуализация доступна только в подписке «С ИИ»." },
    customerEstimate: { title: "Полноценная смета заказчику", message: "Полноценная смета заказчику доступна только в подписке «С ИИ»." },
    warehouse: { title: "Склад", message: "Склад доступен только в подписке «С ИИ»." },
    accounting: { title: "Бухгалтерия", message: "Бухгалтерия доступна только в подписке «С ИИ»." },
    fullStorage: { title: "Полное хранение", message: "Полное хранение доступно только в подписке «С ИИ»." }
  };
  const routeFeatures = { db: "database", database: "database", materials: "database", works: "database", estimate: "estimate", supplier: "supplier", drafts: "drafts", shield: "shield", pool: "pool", ai: "ai", scheme: "singleLineScheme", visualization: "visualization", documents: "customerEstimate", customerEstimate: "customerEstimate", warehouse: "warehouse", accounting: "accounting" };
  function user() { return window.Auth?.getUser?.() || null; }
  function isAdmin() { const u = user(); return !!u && (u.role === "admin" || u.profile?.role === "admin" || u.profile?.isAdmin === true || u.email === "vits0007@gmail.com"); }
  function planText(planId) { if (planId === "pro_ai") return "С ИИ"; if (planId === "basic") return "Базовая"; if (planId === "admin") return "Админ"; return "нет подписки"; }
  function adminBypass() { const all = {}; Object.keys(featureMap).forEach(k => all[k] = true); return { loaded: true, uid: user()?.uid || null, planId: "admin", status: "active", features: all, limits: { shieldItemsMax: null, poolItemsMax: null }, ai: { balanceRub: 999999, accessMode: "admin_api", canUseAi: true }, raw: { adminBypass: true } }; }
  function normalizePolicy(data) { const d = data || {}; return { loaded: true, uid: d.uid || user()?.uid || null, planId: d.planId || "none", status: d.status || "none", features: d.features || {}, limits: d.limits || { shieldItemsMax: 0, poolItemsMax: 0 }, ai: { balanceRub: Number(d.ai?.balanceRub || 0), accessMode: d.ai?.accessMode || "disabled", canUseAi: d.ai?.canUseAi === true }, raw: d }; }
  async function loadAccess() {
    try {
      const u = user();
      if (!u?.uid) { accessState.loaded = false; return accessState; }
      if (isAdmin()) { accessState = adminBypass(); applyLocks(); return accessState; }
      const data = await window.SubscriptionAPI.getAccessPolicy();
      accessState = normalizePolicy(data); applyLocks();
      window.Diagnostics?.ok?.({ file: FILE, module: "AccessGate", functionName: "loadAccess()", place: "server access policy", code: "access-loaded", message: "Доступ загружен: " + planText(accessState.planId) });
      return accessState;
    } catch (error) {
      window.Diagnostics?.error?.({ file: FILE, module: "AccessGate", functionName: "loadAccess()", place: "server access policy", code: error.code || "access-load-error", message: error.message });
      accessState.loaded = false; applyLocks(); return accessState;
    }
  }
  function can(feature) { if (isAdmin()) return true; if (!accessState.loaded) return false; if (feature === "ai") return accessState.ai.canUseAi === true; return accessState.features?.[feature] === true; }
  function explain(feature) { if (accessState.planId === "none") return { title: "Нужна подписка", message: "Без активной подписки доступны только вход, экран подписки и запрос оплаты." }; if (feature === "ai" && accessState.features.ai === true && accessState.ai.accessMode === "admin_api" && accessState.ai.balanceRub <= 0) return { title: "ИИ-баланс закончился", message: "Пополните ИИ-баланс или используйте API клиента." }; if (feature === "ai" && accessState.features.ai === true && accessState.ai.accessMode === "disabled") return { title: "ИИ выключен", message: "ИИ-доступ выключен администратором." }; return featureMap[feature] || { title: "Функция недоступна", message: "Эта функция недоступна в текущей подписке." }; }
  function showLocked(feature) { const info = explain(feature); alert(`${info.title}\n\n${info.message}\n\nТекущий тариф: ${planText(accessState.planId)}.`); window.SoundAPI?.error?.(); }
  function guard(feature) { if (can(feature)) return true; showLocked(feature); return false; }
  async function checkServerFeature(feature) { if (isAdmin()) return { allowed: true, admin: true }; const result = await window.SubscriptionAPI.checkFeatureAccess(feature); if (result?.policy) { accessState = normalizePolicy(result.policy); applyLocks(); } if (!result.allowed) { alert(`${result.title || "Функция недоступна"}\n\n${result.reason || explain(feature).message}`); window.SoundAPI?.error?.(); } return result; }
  async function checkLimit(limitType, currentCount = 0, addCount = 1, nextCount = null) { if (isAdmin()) return { allowed: true, admin: true }; const result = await window.SubscriptionAPI.checkUsageLimit(limitType, currentCount, addCount, nextCount); if (!result.allowed) { alert(`${result.title || "Лимит тарифа"}\n\n${result.reason}`); window.SoundAPI?.error?.(); } return result; }
  function labelLocked(el, feature) { if (!el || el.dataset.accessDecorated === "1") return; el.dataset.accessDecorated = "1"; el.dataset.accessFeature = feature; el.classList.add("access-locked"); const badge = document.createElement("span"); badge.className = "access-lock-badge"; badge.textContent = accessState.planId === "none" ? "🔒 подписка" : "🔒 С ИИ"; el.appendChild(badge); }
  function unlockLabel(el) { if (!el) return; el.classList.remove("access-locked"); el.querySelectorAll(".access-lock-badge").forEach(x => x.remove()); el.dataset.accessDecorated = "0"; }
  function applyLocks() {
    const selectors = [
      ['[data-route="db"], [data-page="db"], [data-route="database"], [data-page="database"]', "database"],
      ['[data-route="materials"], [data-page="materials"]', "database"],
      ['[data-route="works"], [data-page="works"]', "database"],
      ['[data-route="estimate"], [data-page="estimate"], [href="#estimate"]', "estimate"],
      ['[data-route="supplier"], [data-page="supplier"], [href="#supplier"]', "supplier"],
      ['[data-route="drafts"], [data-page="drafts"], [href="#drafts"]', "drafts"],
      ['[data-route="shield"], [data-page="shield"], [href="#shield"]', "shield"],
      ['[data-route="pool"], [data-page="pool"], [href="#pool"]', "pool"],
      ['[data-route="ai"], [data-page="ai"], [href="#ai"], [onclick*="ai"]', "ai"],
      ['[data-route="scheme"], [data-page="scheme"], [href="#scheme"]', "singleLineScheme"],
      ['[data-route="visualization"], [data-page="visualization"], [href="#visualization"]', "visualization"],
      ['[data-route="documents"], [data-page="documents"], [href="#documents"]', "customerEstimate"],
      ['[data-route="warehouse"], [data-page="warehouse"], [href="#warehouse"]', "warehouse"],
      ['[data-route="accounting"], [data-page="accounting"], [href="#accounting"]', "accounting"],
      ['[data-feature-lock]', null]
    ];
    selectors.forEach(([selector, forcedFeature]) => { document.querySelectorAll(selector).forEach(el => { const feature = forcedFeature || el.dataset.featureLock; if (!feature) return; if (can(feature)) unlockLabel(el); else labelLocked(el, feature); }); });
  }
  function bindGlobalGuards() {
    document.addEventListener("click", event => { const locked = event.target.closest("[data-feature-lock], .access-locked"); if (!locked) return; const feature = locked.dataset.featureLock || locked.dataset.accessFeature; if (!feature) return; if (!can(feature)) { event.preventDefault(); event.stopPropagation(); showLocked(feature); } }, true);
    document.addEventListener("click", event => { const routeEl = event.target.closest("[data-route], [data-page]"); if (!routeEl) return; const route = routeEl.dataset.route || routeEl.dataset.page; const feature = routeFeatures[route]; if (feature && !can(feature)) { event.preventDefault(); event.stopPropagation(); showLocked(feature); } }, true);
  }
  function init() { bindGlobalGuards(); const timer = setInterval(() => { const u = user(); if (u?.uid) { loadAccess(); clearInterval(timer); } }, 1200); setTimeout(() => clearInterval(timer), 30000); const observer = new MutationObserver(() => { if (accessState.loaded) applyLocks(); }); window.addEventListener("DOMContentLoaded", () => observer.observe(document.body, { childList: true, subtree: true })); }
  window.AccessGate = { init, loadAccess, can, guard, explain, showLocked, applyLocks, checkServerFeature, checkLimit, checkShieldLimit: (currentCount, addCount = 1, nextCount = null) => checkLimit("shieldItems", currentCount, addCount, nextCount), checkPoolLimit: (currentCount, addCount = 1, nextCount = null) => checkLimit("poolItems", currentCount, addCount, nextCount), getState: () => accessState };
  window.addEventListener("DOMContentLoaded", () => setTimeout(init, 700));
})();
