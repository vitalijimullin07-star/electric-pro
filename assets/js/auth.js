(function () {
  const FILE = "assets/js/auth.js";
  const ADMIN_EMAIL = "vits0007@gmail.com";

  let currentUser = null;
  let authReady = false;

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

    window.Router?.load("main", { replace: true });
    window.SyncAPI?.start?.();
    setTimeout(() => window.EP_UPDATE_ADMIN_BUTTON?.(), 150);
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

      await db.collection("sync_versions").doc("global").set({
        serverDbVersion: 0,
        logicVersion: 0,
        templatesVersion: 0,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
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

  async function loadProfileOrCreate(user, mode = "login") {
    try {
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
          await seedAdminMeta(db);

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

          return;
        }

        if (mode !== "register") {
          alert("Пользователь не зарегистрирован. Нажми «Регистрация».");
          await firebase.auth().signOut();
          showLogin();
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
        return;
      }

      const profile = snap.data() || {};

      if (adminByEmail && profile.role !== "admin") {
        await ref.set({
          uid: user.uid,
          email: user.email || ADMIN_EMAIL,
          name: profile.name || user.displayName || "Виталий Имуллин",
          role: "admin",
          isAdmin: true,
          isApproved: true,
          status: "approved",
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          lastLoginAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      } else {
        await ref.set({
          lastLoginAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      }

      const freshSnap = await ref.get();
      const fresh = freshSnap.data() || profile;

      const isAdmin =
        fresh.role === "admin" ||
        fresh.isAdmin === true ||
        adminByEmail;

      const blocked =
        fresh.status === "blocked" ||
        fresh.blocked === true;

      const approved =
        isAdmin ||
        fresh.isApproved === true ||
        fresh.status === "approved";

      if (blocked) {
        alert("Доступ заблокирован.");
        await firebase.auth().signOut();
        showLogin();
        return;
      }

      if (!approved) {
        alert("Пользователь найден, но доступ ещё не одобрен администратором.");
        await firebase.auth().signOut();
        showLogin();
        return;
      }

      if (isAdmin) {
        await seedAdminMeta(db);
      }

      showApp({
        uid: user.uid,
        email: user.email || "",
        displayName: fresh.name || user.displayName || "Мастер",
        role: isAdmin ? "admin" : (fresh.role || "master"),
        profile: fresh
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
