(function () {
  const FILE = "assets/js/auth.js";

  let currentUser = null;
  let authReady = false;

  function showLogin() {
    document.getElementById("appShell")?.classList.add("hidden");
    document.getElementById("loginScreen")?.classList.remove("hidden");
  }

  function showApp(user) {
    currentUser = user || { displayName: "Мастер", role: "demo", uid: "demo" };

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
  }

  async function loadProfileOrCreate(user) {
    try {
      if (!window.ServerAPI?.isReady?.()) {
        await window.ServerAPI.initFirebase();
      }

      const db = window.ServerAPI.db();
      if (!db) throw new Error("Firestore не инициализирован");

      const ref = db.collection("users").doc(user.uid);
      const snap = await ref.get();

      if (!snap.exists) {
        const profile = {
          name: user.displayName || "Мастер",
          email: user.email || "",
          role: "master",
          isApproved: false,
          status: "pending",
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        await ref.set(profile);

        window.Diagnostics?.wait({
          file: FILE,
          module: "Auth",
          functionName: "loadProfileOrCreate()",
          place: "users/" + user.uid,
          code: "user-pending",
          message: "Профиль создан. Пользователь ожидает одобрения."
        });

        alert("Профиль создан. Доступ ожидает одобрения администратора.");
        showLogin();
        return;
      }

      const profile = snap.data() || {};
      const isAdmin =
        profile.role === "admin" ||
        profile.isAdmin === true ||
        profile.admin === true;

      const approved =
        isAdmin ||
        profile.isApproved === true ||
        profile.status === "approved";

      if (!approved) {
        window.Diagnostics?.wait({
          file: FILE,
          module: "Auth",
          functionName: "loadProfileOrCreate()",
          place: "users/" + user.uid,
          code: "user-not-approved",
          message: "Пользователь найден, но ещё не одобрен."
        });

        alert("Пользователь найден, но доступ ещё не одобрен администратором.");
        showLogin();
        return;
      }

      showApp({
        uid: user.uid,
        email: user.email || "",
        displayName: profile.name || user.displayName || "Мастер",
        role: isAdmin ? "admin" : (profile.role || "master"),
        profile
      });

      window.Diagnostics?.ok({
        file: FILE,
        module: "Auth",
        functionName: "loadProfileOrCreate()",
        place: "users/" + user.uid,
        code: "profile-approved",
        message: "Пользователь вошёл и одобрен."
      });
    } catch (error) {
      window.Diagnostics?.error({
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

          window.Diagnostics?.wait({
            file: FILE,
            module: "Auth",
            functionName: "onAuthStateChanged()",
            place: "Firebase Auth LOCAL persistence",
            code: "no-user",
            message: "Пользователь не найден. Нужно войти."
          });

          return;
        }

        window.Diagnostics?.ok({
          file: FILE,
          module: "Auth",
          functionName: "onAuthStateChanged()",
          place: "Firebase Auth LOCAL persistence",
          code: "saved-login-found",
          message: "Найден сохранённый вход: " + (user.email || user.uid)
        });

        await loadProfileOrCreate(user);
      });
    } catch (error) {
      window.Diagnostics?.error({
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

  async function loginGoogle() {
    try {
      if (!window.firebase || !window.EP_FIREBASE_CONFIG || window.EP_FIREBASE_CONFIG.apiKey.includes("PASTE_")) {
        throw new Error("Firebase config ещё не заполнен. Для визуального теста используй режим проверки визуала.");
      }

      await window.ServerAPI.initFirebase();
      await firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL);

      const provider = new firebase.auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });

      const result = await firebase.auth().signInWithPopup(provider);

      if (result?.user) {
        await loadProfileOrCreate(result.user);
      }

      window.Diagnostics?.ok({
        file: FILE,
        module: "Auth",
        functionName: "loginGoogle()",
        place: "Firebase Google Auth",
        code: "login-ok",
        message: "Вход выполнен и сохранён локально."
      });
    } catch (error) {
      window.Diagnostics?.error({
        file: FILE,
        module: "Auth",
        functionName: "loginGoogle()",
        place: "Firebase Google Auth",
        code: error.code || "auth-error",
        message: error.message
      });

      window.AppShell?.openDiagnostics?.();
    }
  }

  function demoLogin() {
    showApp({ displayName: "Виталий Имуллин", role: "visual-demo", uid: "demo" });

    window.Diagnostics?.ok({
      file: FILE,
      module: "Auth",
      functionName: "demoLogin()",
      place: "visual-test",
      code: "demo-mode",
      message: "Включён режим проверки визуала без Firebase"
    });
  }

  async function logout() {
    try {
      window.SyncAPI?.stop?.();

      if (window.firebase?.auth) {
        await firebase.auth().signOut();
      }

      currentUser = null;
      showLogin();

      window.Diagnostics?.wait({
        file: FILE,
        module: "Auth",
        functionName: "logout()",
        place: "firebase.auth().signOut",
        code: "logout-ok",
        message: "Пользователь вышел. Сохранённый вход очищен."
      });
    } catch (error) {
      window.Diagnostics?.error({
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
    document.getElementById("googleLoginBtn")?.addEventListener("click", loginGoogle);
    document.getElementById("demoLoginBtn")?.addEventListener("click", demoLogin);

    if (window.EP_FIREBASE_CONFIG && !window.EP_FIREBASE_CONFIG.apiKey.includes("PASTE_")) {
      initFirebaseAuthListener();
    } else {
      showLogin();
    }
  }

  window.Auth = {
    init,
    loginGoogle,
    demoLogin,
    logout,
    getUser: () => currentUser,
    getUserLabel: () => currentUser ? (currentUser.email || currentUser.displayName || currentUser.uid) : "не вошёл"
  };
})();
