(function () {
  const FILE = "assets/js/subscription-api.js";

  async function ensureFunctions() {
    if (!window.ServerAPI?.isReady?.()) {
      await window.ServerAPI.initFirebase();
    }

    if (!window.firebase?.functions) {
      throw new Error("Firebase Functions SDK не подключён. Обновите страницу без кэша.");
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
        code: error.code || "subscription-function-error",
        message: error.message
      });
      throw error;
    }
  }

  function normalizePlanId(planId) {
    if (planId === "ai" || planId === "with_ai" || planId === "pro") return "pro_ai";
    if (planId === "base") return "basic";
    return planId || "basic";
  }

  window.SubscriptionAPI = {
    callFunction,

    seedSubscriptionPlans() {
      return callFunction("seedSubscriptionPlans", {});
    },

    grantSubscription(uid, planId = "basic", days = 30, trial = false) {
      return callFunction("grantSubscription", {
        uid,
        planId: normalizePlanId(planId),
        days: Number(days || 30),
        trial: trial === true
      });
    },

    cancelSubscription(uid, reason = "admin_cancel") {
      return callFunction("cancelSubscription", {
        uid,
        reason
      });
    },

    checkUserAccess(uid) {
      return callFunction("checkUserAccess", uid ? { uid } : {});
    },

    requestSubscriptionPayment(planId = "basic", days = 30, comment = "") {
      return callFunction("requestSubscriptionPayment", {
        planId: normalizePlanId(planId),
        days: Number(days || 30),
        comment
      });
    },

    createYooKassaPaymentDraft(payload = {}) {
      return callFunction("createYooKassaPaymentDraft", payload);
    },

    handleYooKassaWebhookPlaceholder(payload = {}) {
      return callFunction("handleYooKassaWebhookPlaceholder", payload);
    }
  };
})();
