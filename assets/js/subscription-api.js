(function () {
  const FILE = "assets/js/subscription-api.js";

  async function ensureFunctions() {
    if (!window.ServerAPI?.isReady?.()) {
      await window.ServerAPI.initFirebase();
    }

    if (!window.firebase?.functions) {
      throw new Error("Firebase Functions SDK не подключён.");
    }

    return firebase.app().functions("europe-west1");
  }

  async function callFunction(name, payload = {}) {
    try {
      const functions = await ensureFunctions();
      const fn = functions.httpsCallable(name);
      const result = await fn(payload);
      return result.data || {};
    } catch (error) {
      window.Diagnostics?.error?.({
        file: FILE,
        module: "SubscriptionAPI",
        functionName: "callFunction(" + name + ")",
        place: "Firebase Functions",
        code: error.code || "function-error",
        message: error.message
      });
      throw error;
    }
  }

  window.SubscriptionAPI = {
    seedPlans: () => callFunction("seedSubscriptionPlans", {}),

    grant: (uid, planId, periodDays = 30, amountRub = 0) =>
      callFunction("grantSubscription", {
        uid,
        planId,
        periodDays,
        amountRub,
        paymentProvider: "manual_qr",
        reason: "manual_subscription_grant"
      }),

    cancel: (uid, reason = "admin_cancel_subscription") =>
      callFunction("cancelSubscription", { uid, reason }),

    checkAccess: () =>
      callFunction("checkUserAccess", {}),

    requestPayment: (planId, periodDays = 30, comment = "") =>
      callFunction("requestSubscriptionPayment", {
        planId,
        periodDays,
        paymentProvider: "manual_qr",
        comment
      }),

    createYooKassaDraft: (payload) =>
      callFunction("createYooKassaPaymentDraft", payload)
  };
})();
