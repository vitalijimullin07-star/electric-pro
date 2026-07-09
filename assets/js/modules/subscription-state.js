window.EP = window.EP || {};

EP.SubscriptionState = {
  current: null,
  unsubscribeAccess: null,
  unsubscribeProfile: null,
  lastProfile: null,

  getAuth() {
    if (window.EP?.Firebase?.auth) return EP.Firebase.auth;
    return window.firebase && firebase.auth ? firebase.auth() : null;
  },

  getDb() {
    if (window.EP?.Firebase?.db) return EP.Firebase.db;
    return window.firebase && firebase.firestore ? firebase.firestore() : null;
  },

  getFunctions() {
    if (!window.firebase || !firebase.functions) return null;
    try { return firebase.functions(); } catch (error) { return null; }
  },

  normalizeDate(value) {
    if (!value) return null;
    if (typeof value.toDate === "function") return value.toDate();
    if (value instanceof Date) return value;
    if (typeof value === "number") return new Date(value);
    if (typeof value === "string") {
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    if (typeof value === "object" && typeof value.seconds === "number") return new Date(value.seconds * 1000);
    return null;
  },

  daysLeft(value) {
    const date = this.normalizeDate(value);
    if (!date) return null;
    return Math.max(0, Math.ceil((date.getTime() - Date.now()) / 86400000));
  },

  money(value) {
    const n = Number(value || 0);
    return n.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
  },

  planLabel(plan) {
    if (plan === "ai") return "С ИИ";
    if (plan === "basic") return "Базовая";
    if (plan === "test2" || plan === "test") return "Тест";
    return "Нет подписки";
  },

  isActive(access) {
    if (!access) return false;
    if (access.status === "blocked" || access.status === "disabled") return false;
    const expires = this.normalizeDate(access.expiresAt || access.subscriptionExpiresAt || access.subscription?.expiresAt);
    if (!expires) return access.status === "active";
    return expires.getTime() > Date.now() && access.status === "active";
  },

  aiEnabled(access) {
    if (!this.isActive(access)) return false;
    const plan = access.plan || access.subscriptionPlan || access.subscription?.plan;
    const mode = access.aiMode || access.ai?.mode || "disabled";
    const balance = Number(access.aiBalanceRub ?? access.ai?.balanceRub ?? 0);
    if (mode === "disabled") return false;
    if (mode === "client_api") return plan === "ai";
    return plan === "ai" && balance > 0;
  },

  normalizeAccess(raw, user, profile) {
    const data = raw || {};
    const profileData = profile || {};
    const plan = data.plan || data.subscriptionPlan || data.subscription?.plan || profileData.subscriptionPlan || "none";
    const expiresAt = data.expiresAt || data.subscriptionExpiresAt || data.subscription?.expiresAt || profileData.subscriptionExpiresAt || null;
    const aiMode = data.aiMode || data.ai?.mode || profileData.aiMode || "disabled";
    const aiBalanceRub = Number(data.aiBalanceRub ?? data.ai?.balanceRub ?? profileData.aiBalanceRub ?? 0);
    const status = data.status || data.subscriptionStatus || (plan === "none" ? "inactive" : "active");
    return Object.assign({}, data, {
      uid: data.uid || user?.uid || profileData.uid || "",
      email: data.email || user?.email || profileData.email || "",
      displayName: data.displayName || user?.displayName || profileData.displayName || profileData.name || "Мастер",
      plan,
      status,
      expiresAt,
      aiMode,
      aiBalanceRub,
      protectedByServer: data.protectedByServer === true || data.signatureStatus === "valid",
      signatureStatus: data.signatureStatus || data.tamperStatus || "unknown"
    });
  },

  displayText(access) {
    if (!access) return { subscription: "Нет подписки", ai: "ИИ выкл.", balance: "Баланс: —" };
    const plan = access.plan || "none";
    const days = this.daysLeft(access.expiresAt);
    const active = this.isActive(access);
    let subscription = this.planLabel(plan);
    if (!active && plan !== "none") subscription = "Истекла";
    if (days !== null && active) subscription = `${subscription} · ${days}д`;
    const ai = this.aiEnabled(access) ? "ИИ вкл." : "ИИ выкл.";
    const balance = `Баланс ИИ: ${this.money(access.aiBalanceRub)} ₽`;
    return { subscription, ai, balance };
  },

  apply(access) {
    this.current = access || null;
    const text = this.displayText(access);
    document.querySelectorAll("[data-subscription-summary]").forEach((el) => { el.textContent = text.subscription; });
    document.querySelectorAll("[data-ai-status]").forEach((el) => { el.textContent = text.ai; });
    document.querySelectorAll("[data-ai-balance]").forEach((el) => { el.textContent = text.balance; });
    window.dispatchEvent(new CustomEvent("ep:subscription-changed", { detail: { access: this.current, text } }));
  },

  async getMyAccessViaServer() {
    const fns = this.getFunctions();
    if (!fns) return null;
    const callable = fns.httpsCallable("getMyAccess");
    const result = await callable({});
    return result && result.data ? result.data.access || result.data : null;
  },

  async loadProfile(user) {
    const db = this.getDb();
    if (!db || !user) return null;
    try {
      const snap = await db.collection("users").doc(user.uid).get();
      return snap.exists ? snap.data() : null;
    } catch (error) {
      console.warn("Profile read unavailable", error);
      return null;
    }
  },

  bindUser(user) {
    if (this.unsubscribeAccess) { this.unsubscribeAccess(); this.unsubscribeAccess = null; }
    if (this.unsubscribeProfile) { this.unsubscribeProfile(); this.unsubscribeProfile = null; }
    this.lastProfile = null;

    if (!user) {
      this.apply(null);
      return;
    }

    const db = this.getDb();
    if (!db) {
      this.apply(this.normalizeAccess(null, user, null));
      return;
    }

    this.loadProfile(user).then((profile) => {
      this.lastProfile = profile;
      return this.getMyAccessViaServer();
    }).then((serverAccess) => {
      if (serverAccess) this.apply(this.normalizeAccess(serverAccess, user, this.lastProfile));
    }).catch((error) => {
      console.warn("Server access read unavailable, using Firestore mirror", error);
    });

    this.unsubscribeAccess = db.collection("user_access").doc(user.uid).onSnapshot((snap) => {
      const access = snap.exists ? snap.data() : null;
      this.apply(this.normalizeAccess(access, user, this.lastProfile));
    }, (error) => {
      console.warn("Access mirror read unavailable", error);
      this.loadProfile(user).then((profile) => {
        this.lastProfile = profile;
        this.apply(this.normalizeAccess(null, user, profile));
      });
    });
  },

  init() {
    const auth = this.getAuth();
    if (auth) auth.onAuthStateChanged((user) => this.bindUser(user));
    window.addEventListener("ep:auth-changed", (event) => this.bindUser(event.detail?.user || null));
    window.addEventListener("ep:route-loaded", () => this.apply(this.current));
  }
};

EP.SubscriptionState.init();
