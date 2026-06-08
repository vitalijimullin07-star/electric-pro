(function () {
  const FILE = "assets/js/auth.js";
  const ADMIN_EMAIL = "vits0007@gmail.com";

  let currentUser = null;
  let authReady = false;
  let isRestoring = false;
  let restoreTimeout = null;

  function showLogin() {
    document.getElementById("appShell")?.classList.add("hidden");
    document.getElementById("loginScreen")?.classList.remove("hidden");
  }

  function showApp(user) {
    currentUser = user || { displayName: "Мастер", role: "master", uid: "unknown" };

    document.getElementById("loginScreen")?.classList.add("hidden");
    document.getElementById("appShell")?.classList.remove("hidden");

    const name =
      currentUser.displayName ||
      currentUser.email ||
      currentUser.name ||
      "Мастер";

    document.getElementById("masterName").textContent = name;
    document.getElementById("sideMasterName").textContent = name;
    document.getElementById("sideMasterRole").textContent = currentUser.role || "master";

    requestAnimationFrame(() => {
      window.Router?.load("main", { replace: true });
    });

    requestAnimationFrame(() => {
      window.SyncAPI?.start?.();
      setTimeout(() => window.EP_UPDATE_ADMIN_BUTTON?.(), 150);
    });
  }

  function isAdminEmail(user) {
    return String(user?.email || "").toLowerCase() === ADMIN_EMAIL.toLowerCase();
  }

  async function seedAdminMeta(db) {
    try {
      await db.collection("app_meta").doc("app").set({
        appName: "Electric Pro",
        status: "active",
        foundationVersion: "v6-firebase-foundation",
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      const syncRef = db.collection("sync_versions").doc("global");
      const syncSnap = await syncRef.get();

      if (!syncSnap.exists) {
        await syncRef.set({
          serverDbVersion: 0,
          logicVersion: 0,
          templatesVersion: 0,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        window.Diagnostics?.ok?.({
          file: FILE,
          module: "Auth",
          functionName: "seedAdminMeta()",
          place: "sync_versions",
          code: "sync-versions-created",
          message: "sync_versions инициализирована первый раз."
        });
      } else {
        window.Diagnostics?.ok?.({
          file: FILE,
          module: "Auth",
          functionName: "seedAdminMeta()",
          place: "sync_versions",
          code: "sync-versions-exists",
          message: "sync_versions уже существует, не перезаписываем."
        });
      }
    } catch (error) {
      window.Diagnostics?.error?.({
        file: FILE,
        module: "Auth",
        functionName: "seedAdminMeta()",
        place: "app_meta / sync_versions",
        code: error.code || "seed-meta-error",
        message: error.message
      });
    }
  }

  async function seedAdminMetaDeferred(db, uid) {
    if (window.RequestIdleCallback && typeof requestIdleCallback === "function") {
      requestIdleCallback(() => seedAdminMeta(db), { timeout: 8000 });
    } else {
      setTimeout(() => seedAdminMeta(db), 2000);
    }
  }

  async function loadProfileOrCreate(user, mode = "login") {
    try {
      if (isRestoring) {
        return;
      }

      if (window.__authRestoreLock) {
        return;
      }

      isRestoring = true;
      window.__authRestoreLock = true;

      restoreTimeout = setTimeout(() => {
        if (isRestoring) {
          isRestoring = false;
          window.__authRestoreLock = false;
          clearTimeout(restoreTimeout);

          window.Diagnostics?.error?.({
            file: FILE,
            module: "Auth",
            functionName: "loadProfileOrCreate()",
            place: "Firestore timeout",
            code: "firestore-timeout",
            message: "Firestore операция заняла > 10 сек. Вход отменён."
          });

          showLogin();
        }
      }, 10000);

      if (!window.ServerAPI?.isReady?.()) {
        await window.ServerAPI.initFirebase();
      }

      const db = window.ServerAPI.db();
      if (!db) throw new Error("Firestore не инициализирован");

      const ref = db.collection("users").doc(user.uid);
      const snap = await ref.get();
      const adminByEmail = isAdminEmail(user);

      if (!snap.exists) {
        if (adminByEmail) {
          const adminProfile = {
            uid: user.uid,
            name: user.displayName || "Виталий Имуллин",
            email: user.email || ADMIN_EMAIL,
            role: "admin",
            isAdmin: true,
            isApproved: true,
            status: "approved",
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            lastLoginAt: firebase.firestore.FieldValue.serverTimestamp()
          };

          await ref.set(adminProfile);
          seedAdminMetaDeferred(db, user.uid);

          window.Diagnostics?.ok?.({
            file: FILE,
            module: "Auth",
            functionName: "loadProfileOrCreate()",
            place: "users/" + user.uid,
            code: "admin-created",
            message: "Админ-профиль создан автоматически.",
            firebaseText: "онлайн"
          });

          showApp({
            uid: user.uid,
            email: user.email || ADMIN_EMAIL,
            displayName: adminProfile.name,
            role: "admin",
            profile: adminProfile
          });

          clearTimeout(restoreTimeout);
          isRestoring = false;
          window.__authRestoreLock = false;
          return;
        }

        if (mode !== "register") {
          alert("Пользователь не зарегистрирован. Нажми «Регистрация».");
          await firebase.auth().signOut();
          showLogin();
          clearTimeout(restoreTimeout);
          isRestoring = false;
          window.__authRestoreLock = false;
          return;
        }

        const masterProfile = {
          uid: user.uid,
          name: user.displayName || "Мастер",
          email: user.email || "",
          role: "master",
          isAdmin: false,
          isApproved: false,
          status: "pending",
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          lastLoginAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        await ref.set(masterProfile);

        window.Diagnostics?.wait?.({
          file: FILE,
          module: "Auth",
          functionName: "loadProfileOrCreate()",
          place: "users/" + user.uid,
          code: "registration-pending",
          message: "Регистрация создана. Пользователь ожидает одобрения.",
          firebaseText: "ожидает одобрения"
        });

        alert("Регистрация отправлена. Доступ ожидает одобрения администратора.");
        await firebase.auth().signOut();
        showLogin();
        clearTimeout(restoreTimeout);
        isRestoring = false;
        window.__authRestoreLock = false;
        return;
      }

      const profile = snap.data() || {};

      if (adminByEmail && profile.role !== "admin") {
        const updatePayload = {
          uid: user.uid,
          email: user.email || ADMIN_EMAIL,
          name: profile.name || user.displayName || "Виталий Имуллин",
          role: "admin",
          isAdmin: true,
          isApproved: true,
          status: "approved",
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          lastLoginAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        await ref.set(updatePayload, { merge: true });
        profile.role = "admin";
        profile.isAdmin = true;
        profile.isApproved = true;
        profile.status = "approved";
        profile.name = updatePayload.name;
        profile.email = updatePayload.email;
      } else {
        await ref.set({
          lastLoginAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      }

      const isAdmin =
        profile.role === "admin" ||
        profile.isAdmin === true ||
        adminByEmail;

      const blocked =
        profile.status === "blocked" ||
        profile.blocked === true;

      const approved =
        isAdmin ||
        profile.isApproved === true ||
        profile.status === "approved";

      if (blocked) {
        alert("Доступ заблокирован.");
        await firebase.auth().signOut();
        showLogin();
        clearTimeout(restoreTimeout);
        isRestoring = false;
        window.__authRestoreLock = false;
        return;
      }

      if (!approved) {
        alert("Пользователь найден, но доступ ещё не одобрен администратором.");
        await firebase.auth().signOut();
        showLogin();
        clearTimeout(restoreTimeout);
        isRestoring = false;
        window.__authRestoreLock = false;
        return;
      }

      if (isAdmin) {
        seedAdminMetaDeferred(db, user.uid);
      }

      showApp({
        uid: user.uid,
        email: user.email || "",
        displayName: profile.name || user.displayName || "Мастер",
        role: isAdmin ? "admin" : (profile.role || "master"),
        profile: profile
      });

      window.Diagnostics?.ok?.({
        file: FILE,
        module: "Auth",
        functionName: "loadProfileOrCreate()",
        place: "users/" + user.uid,
        code: isAdmin ? "admin-login-ok" : "master-login-ok",
        message: isAdmin ? "Администратор вошёл." : "Мастер вошёл и одобрен.",
        firebaseText: "онлайн"
      });

      clearTimeout(restoreTimeout);
      isRestoring = false;
      window.__authRestoreLock = false;
    } catch (error) {
      window.Diagnostics?.error?.({
        file: FILE,
        module: "Auth",
        functionName: "loadProfileOrCreate()",
        place: "Firestore users profile",
        code: error.code || "profile-load-error",
        message: error.message
      });

      window.AppShell?.openDiagnostics?.();
      showLogin();
      clearTimeout(restoreTimeout);
      isRestoring = false;
      window.__authRestoreLock = false;
    }
  }

  async function initFirebaseAuthListener() {
    try {
      if (authReady) return;
      authReady = true;

      await window.ServerAPI.initFirebase();
      await firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL);

      firebase.auth().onAuthStateChanged(async user => {
        if (!user) {
          currentUser = null;
          showLogin();

          window.Diagnostics?.wait?.({
            file: FILE,
            module: "Auth",
            functionName: "onAuthStateChanged()",
            place: "Firebase Auth LOCAL persistence",
            code: "no-user",
            message: "Пользователь не найден. Нужно войти.",
            firebaseText: "ожидание входа"
          });

          return;
        }

        await loadProfileOrCreate(user, "login");
      });
    } catch (error) {
      window.Diagnostics?.error?.({
        file: FILE,
        module: "Auth",
        functionName: "initFirebaseAuthListener()",
        place: "Firebase Auth init",
        code: error.code || "auth-init-error",
        message: error.message
      });

      showLogin();
    }
  }

  async function googleFlow(mode) {
    try {
      if (!window.firebase || !window.EP_FIREBASE_CONFIG || window.EP_FIREBASE_CONFIG.apiKey.includes("PASTE_")) {
        throw new Error("Firebase config ещё не заполнен.");
      }

      await window.ServerAPI.initFirebase();
      await firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL);

      const provider = new firebase.auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });

      const result = await firebase.auth().signInWithPopup(provider);

      if (result?.user) {
        await loadProfileOrCreate(result.user, mode);
      }

      window.SoundAPI?.success?.();
    } catch (error) {
      window.Diagnostics?.error?.({
        file: FILE,
        module: "Auth",
        functionName: mode === "register" ? "registerGoogle()" : "loginGoogle()",
        place: "Firebase Google Auth",
        code: error.code || "auth-error",
        message: error.message
      });

      window.AppShell?.openDiagnostics?.();
    }
  }

  async function logout() {
    try {
      window.SyncAPI?.stop?.();

      if (window.firebase?.auth) {
        await firebase.auth().signOut();
      }

      currentUser = null;
      isRestoring = false;
      window.__authRestoreLock = false;
      clearTimeout(restoreTimeout);

      showLogin();

      window.Diagnostics?.wait?.({
        file: FILE,
        module: "Auth",
        functionName: "logout()",
        place: "firebase.auth().signOut",
        code: "logout-ok",
        message: "Пользователь вышел.",
        firebaseText: "ожидание входа"
      });
    } catch (error) {
      window.Diagnostics?.error?.({
        file: FILE,
        module: "Auth",
        functionName: "logout()",
        place: "firebase.auth().signOut",
        code: error.code || "logout-error",
        message: error.message
      });
    }
  }

  function init() {
    window.__authRestoreLock = window.__authRestoreLock || false;

    document.getElementById("googleLoginBtn")?.addEventListener("click", () => googleFlow("login"));
    document.getElementById("registerGoogleBtn")?.addEventListener("click", () => googleFlow("register"));

    if (window.EP_FIREBASE_CONFIG && !window.EP_FIREBASE_CONFIG.apiKey.includes("PASTE_")) {
      initFirebaseAuthListener();
    } else {
      showLogin();
    }
  }

  window.Auth = {
    init,
    loginGoogle: () => googleFlow("login"),
    registerGoogle: () => googleFlow("register"),
    logout,
    getUser: () => currentUser,
    getUserLabel: () => currentUser
      ? (currentUser.email || currentUser.displayName || currentUser.uid)
      : "не вошёл"
  };
})();
