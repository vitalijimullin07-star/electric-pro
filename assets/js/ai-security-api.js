(function () {
  const FILE = "assets/js/ai-security-api.js";

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
        module: "AiSecurityAPI",
        functionName: "callFunction(" + name + ")",
        place: "Firebase Functions",
        code: error.code || "function-error",
        message: error.message
      });
      throw error;
    }
  }

  window.AiSecurityAPI = {
    topUpBalance: (uid, amountRub, reason = "manual_qr_topup") =>
      callFunction("topUpAiBalance", { uid, amountRub, reason, paymentMethod: "manual_qr" }),

    refundBalance: (uid, amountRub, reason = "admin_refund") =>
      callFunction("refundAiBalance", { uid, amountRub, reason }),

    setAccessMode: (uid, accessMode) =>
      callFunction("setAiAccessMode", { uid, accessMode }),

    spendBalance: (payload) =>
      callFunction("spendAiBalance", payload),

    reportZeroBalanceBypass: (payload) =>
      callFunction("suspiciousAiUsageZeroBalance", payload),

    reportDeviceIntegrity: (payload) =>
      callFunction("reportDeviceIntegrity", payload),

    setUserSecurityPolicy: (payload) =>
      callFunction("setUserSecurityPolicy", payload),

    requestPayment: (amountRub, comment = "") =>
      callFunction("requestAiPayment", { amountRub, comment })
  };
})();
