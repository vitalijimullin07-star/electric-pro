/* Electric Pro V29.17 Secure Access Policy Core */
(function () {
  "use strict";

  window.EP = window.EP || {};

  const DEFAULT_POLICY = {
    uid: null,
    role: "guest",
    accessStatus: "guest",
    subscription: {
      plan: "none",
      title: "Нет подписки",
      active: false,
      expiresAt: null,
      daysLeft: 0
    },
    ai: {
      enabled: false,
      mode: "off",
      balanceRub: 0
    },
    features: {
      app: false,
      database: false,
      materials: false,
      work: false,
      shield: false,
      pool: false,
      estimate: false,
      admin: false,
      ai: false
    },
    source: "default"
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function getFirebase() {
    return window.firebase || null;
  }

  function getCurrentUser() {
    const fb = getFirebase();
    try {
      if (fb && fb.auth && fb.auth().currentUser) return fb.auth().currentUser;
    } catch (error) {}
    if (window.EP && window.EP.state && window.EP.state.user) return window.EP.state.user;
    return null;
  }

  function normalizeDaysLeft(expiresAt) {
    if (!expiresAt) return 0;
    let date = null;
    if (typeof expiresAt.toDate === "function") date = expiresAt.toDate();
    else if (expiresAt.seconds) date = new Date(expiresAt.seconds * 1000);
    else date = new Date(expiresAt);
    if (!date || Number.isNaN(date.getTime())) return 0;
    return Math.max(0, Math.ceil((date.getTime() - Date.now()) / 86400000));
  }

  function normalizePolicy(raw) {
    const policy = Object.assign(clone(DEFAULT_POLICY), raw || {});
    policy.subscription = Object.assign(clone(DEFAULT_POLICY.subscription), policy.subscription || {});
    policy.ai = Object.assign(clone(DEFAULT_POLICY.ai), policy.ai || {});
    policy.features = Object.assign(clone(DEFAULT_POLICY.features), policy.features || {});

    if (!policy.subscription.daysLeft) {
      policy.subscription.daysLeft = normalizeDaysLeft(policy.subscription.expiresAt);
    }

    if (!policy.subscription.title) {
      if (policy.subscription.plan === "ai") policy.subscription.title = "С ИИ";
      else if (policy.subscription.plan === "basic") policy.subscription.title = "Базовая";
      else if (policy.subscription.plan === "trial") policy.subscription.title = "Тест";
      else policy.subscription.title = "Нет подписки";
    }

    return policy;
  }

  function renderPolicy(policy) {
    const p = normalizePolicy(policy);
    const subTitle = p.subscription.active
      ? `${p.subscription.title} · ${p.subscription.daysLeft || 0}д`
      : "Нет подписки";

    const aiTitle = p.ai.enabled
      ? (Number(p.ai.balanceRub || 0) > 0 ? `ИИ вкл. · ${Number(p.ai.balanceRub || 0).toFixed(0)}₽` : "ИИ вкл.")
      : "ИИ выкл.";

    document.querySelectorAll("[data-subscription-summary]").forEach((node) => {
      node.textContent = subTitle;
      node.dataset.plan = p.subscription.plan || "none";
      node.dataset.active = String(Boolean(p.subscription.active));
    });

    document.querySelectorAll("[data-ai-status]").forEach((node) => {
      node.textContent = aiTitle;
      node.dataset.aiMode = p.ai.mode || "off";
      node.dataset.aiEnabled = String(Boolean(p.ai.enabled));
    });

    document.querySelectorAll("[data-ai-balance]").forEach((node) => {
      node.textContent = `${Number(p.ai.balanceRub || 0).toFixed(0)} ₽`;
    });

    document.documentElement.dataset.epAccessRole = p.role || "guest";
    document.documentElement.dataset.epSubscriptionPlan = p.subscription.plan || "none";
    document.documentElement.dataset.epAiEnabled = String(Boolean(p.ai.enabled));
  }

  async function callFunction(name, payload) {
    const fb = getFirebase();
    if (!fb || !fb.functions) throw new Error("Firebase Functions unavailable");
    return fb.functions().httpsCallable(name)(payload || {});
  }

  async function readUserDoc(uid) {
    const fb = getFirebase();
    if (!fb || !fb.firestore) throw new Error("Firestore unavailable");
    const snap = await fb.firestore().collection("users").doc(uid).get();
    return snap.exists ? snap.data() : null;
  }

  window.EP.AccessPolicy = {
    current: clone(DEFAULT_POLICY),

    async load() {
      const user = getCurrentUser();
      if (!user || !user.uid) {
        this.current = normalizePolicy(DEFAULT_POLICY);
        renderPolicy(this.current);
        return this.current;
      }

      try {
        const result = await callFunction("getAccessPolicy", {});
        this.current = normalizePolicy(Object.assign({}, result.data || {}, { source: "cloud-function" }));
      } catch (error) {
        console.warn("AccessPolicy: Cloud Function unavailable, read-only fallback", error);
        try {
          const doc = await readUserDoc(user.uid);
          this.current = normalizePolicy(Object.assign({}, doc || {}, { uid: user.uid, source: "firestore-readonly" }));
        } catch (fallbackError) {
          console.warn("AccessPolicy: fallback failed", fallbackError);
          this.current = normalizePolicy(Object.assign({}, DEFAULT_POLICY, { uid: user.uid, source: "fallback" }));
        }
      }

      renderPolicy(this.current);
      window.dispatchEvent(new CustomEvent("ep:access-policy", { detail: { policy: this.current } }));
      return this.current;
    },

    can(feature) {
      return Boolean(this.current && this.current.features && this.current.features[feature]);
    },

    isAdmin() {
      return this.current && this.current.role === "admin";
    },

    render() {
      renderPolicy(this.current);
    },

    init() {
      window.addEventListener("ep:auth-changed", () => this.load());
      window.addEventListener("ep:route-loaded", () => this.render());
      setTimeout(() => this.load(), 300);
    }
  };

  window.EP.AccessPolicy.init();
})();
