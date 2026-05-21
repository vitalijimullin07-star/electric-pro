(function () {
  const FILE = "assets/js/subscription-api.js";

  async function ensureFirebase() {
    if (!window.ServerAPI?.isReady?.()) {
      await window.ServerAPI.initFirebase();
    }
    if (!window.firebase?.functions) {
      throw new Error("Firebase Functions SDK не подключён.");
    }
    return {
      db: window.ServerAPI.db(),
      functions: firebase.app().functions("europe-west1")
    };
  }

  async function callFunction(name, payload = {}) {
    try {
      const { functions } = await ensureFirebase();
      const fn = functions.httpsCallable(name);
      const result = await fn(payload);
      return result.data || {};
    } catch (error) {
      window.Diagnostics?.error?.({
        file: FILE,
        module: "SubscriptionAPI",
        functionName: "callFunction(" + name + ")",
        place: "Firebase Functions",
        code: error.code || "subscription-function-error",
        message: error.message
      });
      throw error;
    }
  }

  async function readDoc(path) {
    const { db } = await ensureFirebase();
    const snap = await db.doc(path).get();
    return snap.exists ? (snap.data() || {}) : null;
  }

  async function listSubscriptionTransactions(uid, limit = 15) {
    const { db } = await ensureFirebase();
    const snap = await db.collection("subscription_transactions").where("uid", "==", uid).limit(limit).get();
    const arr = [];
    snap.forEach(doc => arr.push({ id: doc.id, data: doc.data() || {} }));
    arr.sort((a, b) => {
      const ad = a.data.createdAt?.toDate?.()?.getTime?.() || 0;
      const bd = b.data.createdAt?.toDate?.()?.getTime?.() || 0;
      return bd - ad;
    });
    return arr;
  }

  async function listPaymentRequests(uid, limit = 10) {
    const { db } = await ensureFirebase();
    const snap = await db.collection("subscription_payment_requests").where("uid", "==", uid).limit(limit).get();
    const arr = [];
    snap.forEach(doc => arr.push({ id: doc.id, data: doc.data() || {} }));
    arr.sort((a, b) => {
      const ad = a.data.createdAt?.toDate?.()?.getTime?.() || 0;
      const bd = b.data.createdAt?.toDate?.()?.getTime?.() || 0;
      return bd - ad;
    });
    return arr;
  }

  function currentUid() {
    return window.Auth?.getUser?.()?.uid || firebase.auth?.().currentUser?.uid || null;
  }

  window.SubscriptionAPI = {
    seedPlans: () => callFunction("seedSubscriptionPlans", {}),
    grant: (uid, planId, periodDays = 30, amountRub = 0, reason = "manual_subscription_grant") =>
      callFunction("grantSubscription", { uid, planId, periodDays, amountRub, paymentProvider: "manual_qr", reason }),
    cancel: (uid, reason = "admin_cancel") =>
      callFunction("cancelSubscription", { uid, reason }),
    checkAccess: () => callFunction("checkUserAccess", {}),
    requestPayment: (planId, periodDays = 30, comment = "") =>
      callFunction("requestSubscriptionPayment", { planId, periodDays, paymentProvider: "manual_qr", comment }),
    createYooKassaDraft: (uid, planId, amountRub, periodDays = 30) =>
      callFunction("createYooKassaPaymentDraft", { uid, planId, amountRub, periodDays }),
    readSubscription: uid => readDoc("user_subscriptions/" + uid),
    readPlan: planId => readDoc("subscription_plans/" + planId),
    readPaymentContacts: () => readDoc("app_meta/payment_contacts"),
    listTransactions: listSubscriptionTransactions,
    listPaymentRequests,
    currentUid
  };
})();
