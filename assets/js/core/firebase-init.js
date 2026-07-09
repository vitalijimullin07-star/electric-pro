window.EP = window.EP || {};

EP.Firebase = {
  app: null,
  auth: null,
  db: null,
  ready: false,
  error: null,

  init() {
    if (this.ready) return true;

    try {
      if (!window.firebase) {
        throw new Error("Firebase SDK не загружен");
      }
      if (!window.EP_FIREBASE_CONFIG) {
        throw new Error("Firebase config не найден");
      }

      if (!firebase.apps || !firebase.apps.length) {
        this.app = firebase.initializeApp(window.EP_FIREBASE_CONFIG);
      } else {
        this.app = firebase.app();
      }

      this.auth = firebase.auth();
      this.db = firebase.firestore();
      this.auth.useDeviceLanguage?.();
      this.ready = true;
      this.error = null;
      return true;
    } catch (error) {
      this.ready = false;
      this.error = error;
      console.error("Firebase init error", error);
      return false;
    }
  }
};
