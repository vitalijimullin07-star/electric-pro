window.EP = window.EP || {};

EP.Auth = {
  adminEmail: "vits0007@gmail.com",
  lastMode: "login",

  init() {
    window.addEventListener("ep:route-loaded", (event) => {
      if (event.detail?.route === "login") this.bindLoginPage();
    });

    if (!EP.Firebase?.init?.()) {
      EP.state.authReady = true;
      this.updateShell(null, null);
      return;
    }

    EP.Firebase.auth.onAuthStateChanged(async (firebaseUser) => {
      EP.state.authReady = true;

      if (!firebaseUser) {
        EP.state.user = null;
        EP.state.profile = null;
        this.updateShell(null, null);
        window.dispatchEvent(new CustomEvent("ep:auth-changed", { detail: { user: null, profile: null } }));
        if (EP.state.currentRoute !== "login") EP.Router.go("login", { replace: true });
        return;
      }

      await this.loadProfile(firebaseUser, "auto");
    });
  },

  isAdminEmail(user) {
    return String(user?.email || "").toLowerCase() === this.adminEmail.toLowerCase();
  },

  isAuthenticated() {
    return Boolean(EP.state.user);
  },

  isReady() {
    return Boolean(EP.state.authReady);
  },

  isAdmin() {
    const user = EP.state.user;
    const profile = EP.state.profile;
    return this.isAdminEmail(user) || profile?.role === "admin" || profile?.isAdmin === true || user?.role === "admin";
  },

  currentUser() {
    return EP.state.user;
  },

  async signIn(mode) {
    this.lastMode = mode || "login";

    if (!EP.Firebase?.init?.()) {
      this.setLoginStatus("Firebase не готов. Проверь config/firebase-config.js", "error");
      return;
    }

    try {
      this.setLoginStatus("Открываю Google вход...", "wait");
      const provider = new firebase.auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      const result = await EP.Firebase.auth.signInWithPopup(provider);
      await this.loadProfile(result.user, this.lastMode);
    } catch (error) {
      console.error("Google auth error", error);
      this.setLoginStatus(error.message || "Ошибка входа", "error");
    }
  },

  async signOut() {
    try {
      await EP.Firebase?.auth?.signOut?.();
    } finally {
      EP.state.user = null;
      EP.state.profile = null;
      this.updateShell(null, null);
      window.dispatchEvent(new CustomEvent("ep:auth-changed", { detail: { user: null, profile: null } }));
      EP.Router.go("login", { replace: true });
    }
  },

  async loadProfile(firebaseUser, mode) {
    const db = EP.Firebase.db;
    if (!db) {
      this.setLoginStatus("Firestore не готов", "error");
      return;
    }

    try {
      this.setLoginStatus("Проверяю профиль...", "wait");

      const ref = db.collection("users").doc(firebaseUser.uid);
      const snap = await ref.get();
      const adminByEmail = this.isAdminEmail(firebaseUser);

      if (!snap.exists) {
        if (!adminByEmail && mode !== "register") {
          this.setLoginStatus("Профиль не найден. Нажми регистрацию мастера.", "error");
          await EP.Firebase.auth.signOut();
          return;
        }

        const profile = adminByEmail
          ? this.makeAdminProfile(firebaseUser)
          : this.makePendingMasterProfile(firebaseUser);

        await ref.set(profile, { merge: true });

        if (!adminByEmail) {
          this.setLoginStatus("Регистрация отправлена. Ожидайте подтверждения администратора.", "wait");
          await EP.Firebase.auth.signOut();
          return;
        }
      }

      const freshSnap = await ref.get();
      const profile = freshSnap.exists ? freshSnap.data() : this.makeAdminProfile(firebaseUser);

      if (!this.canEnter(profile, firebaseUser)) {
        this.setLoginStatus("Аккаунт ожидает подтверждения администратора.", "wait");
        await EP.Firebase.auth.signOut();
        return;
      }

      // одобренному мастеру без подписки выдаём тест 10 дней (отсчёт с первого входа после одобрения)
      if (!adminByEmail && !(profile && (profile.isAdmin === true || profile.role === "admin")) && !this.hasSubscriptionInfo(profile)) {
        const tf = this.trialFields();
        try { await ref.set(tf, { merge: true }); } catch (e) {}
        Object.assign(profile, tf);
      }

      await ref.set({
        lastLoginAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      EP.state.user = {
        uid: firebaseUser.uid,
        email: firebaseUser.email || "",
        displayName: profile.name || profile.displayName || firebaseUser.displayName || firebaseUser.email || "Мастер",
        role: profile.role || (adminByEmail ? "admin" : "master")
      };
      EP.state.profile = profile;

      this.updateShell(EP.state.user, profile);
      window.dispatchEvent(new CustomEvent("ep:auth-changed", { detail: { user: EP.state.user, profile } }));
      this.setLoginStatus("Вход выполнен", "ok");

      if (EP.state.currentRoute === "login") {
        EP.Router.go("main", { replace: true });
      }
    } catch (error) {
      console.error("Profile load error", error);
      this.setLoginStatus(error.message || "Ошибка профиля", "error");
    }
  },

  makeAdminProfile(user) {
    return {
      uid: user.uid,
      name: user.displayName || "Виталий Имуллин",
      displayName: user.displayName || "Виталий Имуллин",
      email: user.email || this.adminEmail,
      role: "admin",
      isAdmin: true,
      approved: true,
      isApproved: true,
      status: "approved",
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
  },

  trialDays: 10,
  trialFields() {
    const ms = Date.now() + this.trialDays * 86400000;
    const ts = (window.firebase && firebase.firestore && firebase.firestore.Timestamp)
      ? firebase.firestore.Timestamp.fromDate(new Date(ms)) : new Date(ms).toISOString();
    const now = (window.firebase && firebase.firestore && firebase.firestore.FieldValue)
      ? firebase.firestore.FieldValue.serverTimestamp() : new Date().toISOString();
    return { subscriptionPlan: "trial", subscriptionStatus: "active", trialStartedAt: now, trialEndsAt: ts, subscriptionExpiresAt: ts };
  },
  hasSubscriptionInfo(p) {
    if (!p) return false;
    if (p.subscriptionExpiresAt || p.trialEndsAt || p.subscriptionUntil || p.expiresAt) return true;
    const plan = p.subscriptionPlan || p.plan;
    return !!(plan && plan !== "none");
  },

  makePendingMasterProfile(user) {
    return {
      uid: user.uid,
      name: user.displayName || "Мастер",
      displayName: user.displayName || "Мастер",
      email: user.email || "",
      role: "master",
      isAdmin: false,
      approved: false,
      isApproved: false,
      status: "pending",
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
  },

  canEnter(profile, user) {
    if (this.isAdminEmail(user)) return true;
    if (profile?.isAdmin === true) return true;
    if (profile?.approved === true) return true;
    if (profile?.isApproved === true) return true;
    return profile?.status === "approved" || profile?.status === "active";
  },

  bindLoginPage() {
    document.querySelector("#googleLoginBtn")?.addEventListener("click", () => this.signIn("login"));
    document.querySelector("#registerGoogleBtn")?.addEventListener("click", () => this.signIn("register"));

    let reason = "";
    try { reason = sessionStorage.getItem("ep_block_reason") || ""; if (reason) sessionStorage.removeItem("ep_block_reason"); } catch (e) {}
    if (reason) { this.setLoginStatus(reason, "error"); return; }

    if (EP.Firebase?.ready) {
      this.setLoginStatus("Firebase готов", "ok");
    } else {
      this.setLoginStatus(EP.Firebase?.error?.message || "Firebase не готов", "error");
    }
  },

  setLoginStatus(text, type) {
    const status = document.querySelector("#loginStatusText");
    const dot = document.querySelector("#loginFirebaseDot");
    if (status) status.textContent = text || "";
    if (dot) {
      dot.classList.remove("status-ok", "status-wait", "status-error");
      dot.classList.add(type === "ok" ? "status-ok" : type === "error" ? "status-error" : "status-wait");
    }
  },

  updateShell(user, profile) {
    const name = user?.displayName || user?.email || (EP.state.currentRoute === "login" ? "Вход" : "Мастер");
    const role = profile?.role || user?.role || "guest";
    const isAdmin = this.isAdminEmail(user) || role === "admin" || profile?.isAdmin === true;

    document.querySelector("#masterName") && (document.querySelector("#masterName").textContent = name);
    document.querySelector("#sideMasterName") && (document.querySelector("#sideMasterName").textContent = name);
    document.querySelector("#sideMasterRole") && (document.querySelector("#sideMasterRole").textContent = role);

    const adminBtn = document.querySelector("#adminMenuBtn");
    if (adminBtn) adminBtn.style.display = isAdmin ? "" : "none";

    const logoutBtn = document.querySelector("#logoutBtn");
    if (logoutBtn) logoutBtn.style.display = user ? "" : "none";

    const dot = document.querySelector("#firebaseStatusDot");
    if (dot) {
      dot.classList.remove("status-ok", "status-wait", "status-error");
      dot.classList.add(EP.Firebase?.ready ? "status-ok" : "status-error");
    }

    EP.AppShell?.syncAccess?.();
  }
};
