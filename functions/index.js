const admin = require("firebase-admin");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");

admin.initializeApp();

setGlobalOptions({
  region: "europe-west1",
  maxInstances: 10
});

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

function requireAuth(request) {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "Нужно войти в аккаунт.");
  }
  return request.auth.uid;
}

async function getUser(uid) {
  const snap = await db.collection("users").doc(uid).get();
  if (!snap.exists) {
    throw new HttpsError("permission-denied", "Профиль пользователя не найден.");
  }
  return snap.data() || {};
}

function isBlocked(profile) {
  return (
    profile.blocked === true ||
    profile.status === "blocked" ||
    profile.status === "blocked_review" ||
    profile.status === "deleted"
  );
}

async function requireAdmin(request) {
  const uid = requireAuth(request);
  const profile = await getUser(uid);

  const adminRole =
    profile.role === "admin" ||
    profile.isAdmin === true;

  const approved =
    profile.status === "approved" ||
    profile.isApproved === true;

  if (!adminRole || !approved || isBlocked(profile)) {
    throw new HttpsError("permission-denied", "Доступ только для администратора.");
  }

  return { uid, profile };
}

async function requireApprovedUser(request) {
  const uid = requireAuth(request);
  const profile = await getUser(uid);

  const approved =
    profile.status === "approved" ||
    profile.isApproved === true ||
    profile.role === "admin";

  if (!approved || isBlocked(profile)) {
    throw new HttpsError("permission-denied", "Доступ запрещён.");
  }

  if (profile.securityPolicy && profile.securityPolicy.allowLogin === false) {
    throw new HttpsError("permission-denied", "Вход запрещён политикой безопасности.");
  }

  return { uid, profile };
}

function cleanAmountRub(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new HttpsError("invalid-argument", "Сумма должна быть больше нуля.");
  }
  return Math.round(n * 100) / 100;
}

function cleanText(value, fallback = "") {
  return String(value || fallback).slice(0, 500);
}

async function createSecurityEvent(data) {
  const ref = db.collection("security_events").doc();

  await ref.set({
    ...data,
    status: data.status || "open",
    createdAt: FieldValue.serverTimestamp(),
    serverSigned: true
  });

  return ref.id;
}

async function blockUserForReview(uid, reason, extra = {}) {
  await db.collection("users").doc(uid).set({
    status: "blocked_review",
    blocked: true,
    blockedReason: reason,
    aiAccessMode: "disabled",
    securityPolicy: {
      allowLogin: true,
      allowReadData: false,
      allowLocalCache: false,
      allowAi: false,
      allowOfflineMode: false,
      reason
    },
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  await db.collection("ai_accounts").doc(uid).set({
    uid,
    accessMode: "disabled",
    allowAi: false,
    blockedReason: reason,
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  return createSecurityEvent({
    uid,
    type: reason,
    severity: "high",
    ...extra
  });
}

async function getAccountRef(uid) {
  return db.collection("ai_accounts").doc(uid);
}

exports.topUpAiBalance = onCall(async (request) => {
  const adminUser = await requireAdmin(request);

  const uid = cleanText(request.data.uid);
  const amountRub = cleanAmountRub(request.data.amountRub);
  const reason = cleanText(request.data.reason, "manual_qr_topup");
  const paymentMethod = cleanText(request.data.paymentMethod, "manual_qr");

  if (!uid) {
    throw new HttpsError("invalid-argument", "Не указан uid пользователя.");
  }

  const targetProfile = await getUser(uid);
  if (targetProfile.status === "deleted") {
    throw new HttpsError("failed-precondition", "Пользователь удалён.");
  }

  const accountRef = await getAccountRef(uid);
  const txRef = db.collection("ai_transactions").doc();

  let result = null;

  await db.runTransaction(async (tx) => {
    const accountSnap = await tx.get(accountRef);
    const account = accountSnap.exists ? accountSnap.data() : {};

    const before = Number(account.balanceRub || 0);
    const after = Math.round((before + amountRub) * 100) / 100;

    tx.set(accountRef, {
      uid,
      balanceRub: after,
      balanceTokens: Number(account.balanceTokens || 0),
      accessMode: account.accessMode || "admin_api",
      allowAi: true,
      totalTopupRub: Math.round((Number(account.totalTopupRub || 0) + amountRub) * 100) / 100,
      totalSpendRub: Number(account.totalSpendRub || 0),
      dailyLimitRub: Number(account.dailyLimitRub || 100),
      monthlyLimitRub: Number(account.monthlyLimitRub || 2000),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: adminUser.uid
    }, { merge: true });

    tx.set(txRef, {
      uid,
      type: "topup",
      amountRub,
      tokens: 0,
      beforeBalanceRub: before,
      afterBalanceRub: after,
      reason,
      paymentMethod,
      paymentStatus: "paid",
      createdAt: FieldValue.serverTimestamp(),
      createdBy: adminUser.uid,
      serverSigned: true,
      source: "cloud_function"
    });

    result = { uid, beforeBalanceRub: before, afterBalanceRub: after, transactionId: txRef.id };
  });

  await db.collection("admin_logs").doc().set({
    type: "ai_balance_topup",
    uid,
    amountRub,
    createdBy: adminUser.uid,
    createdAt: FieldValue.serverTimestamp(),
    transactionId: txRef.id
  });

  return { ok: true, ...result };
});

exports.spendAiBalance = onCall(async (request) => {
  const actor = await requireApprovedUser(request);
  const uid = actor.uid;

  const amountRub = cleanAmountRub(request.data.amountRub);
  const feature = cleanText(request.data.feature, "unknown_ai_feature");
  const model = cleanText(request.data.model, "unknown_model");
  const tokensInput = Number(request.data.tokensInput || 0);
  const tokensOutput = Number(request.data.tokensOutput || 0);
  const totalTokens = Number(request.data.totalTokens || tokensInput + tokensOutput || 0);
  const requestHash = cleanText(request.data.requestHash, "");
  const idempotencyKey = cleanText(request.data.idempotencyKey, "");

  const profile = actor.profile || {};
  if (profile.securityPolicy && profile.securityPolicy.allowAi === false) {
    throw new HttpsError("permission-denied", "ИИ-функции запрещены политикой безопасности.");
  }

  const accountRef = await getAccountRef(uid);
  const txRef = db.collection("ai_transactions").doc();
  const usageRef = db.collection("ai_usage").doc();

  let result = null;

  await db.runTransaction(async (tx) => {
    const accountSnap = await tx.get(accountRef);
    const account = accountSnap.exists ? accountSnap.data() : {};

    const before = Number(account.balanceRub || 0);
    const accessMode = account.accessMode || "disabled";

    if (accessMode === "disabled" || account.allowAi === false) {
      throw new HttpsError("permission-denied", "ИИ-доступ отключён.");
    }

    if (before <= 0) {
      throw new HttpsError("failed-precondition", "Нулевой баланс. Запрос будет заблокирован.");
    }

    if (before < amountRub) {
      throw new HttpsError("resource-exhausted", "Недостаточно средств на ИИ-балансе.");
    }

    const after = Math.round((before - amountRub) * 100) / 100;

    tx.set(accountRef, {
      uid,
      balanceRub: after,
      totalSpendRub: Math.round((Number(account.totalSpendRub || 0) + amountRub) * 100) / 100,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: uid
    }, { merge: true });

    tx.set(txRef, {
      uid,
      type: "spend",
      amountRub: -amountRub,
      tokens: totalTokens,
      beforeBalanceRub: before,
      afterBalanceRub: after,
      reason: feature,
      paymentMethod: "ai_usage",
      paymentStatus: "spent",
      createdAt: FieldValue.serverTimestamp(),
      createdBy: uid,
      serverSigned: true,
      source: "cloud_function",
      requestHash,
      idempotencyKey
    });

    tx.set(usageRef, {
      uid,
      feature,
      model,
      tokensInput,
      tokensOutput,
      totalTokens,
      costRub: amountRub,
      createdAt: FieldValue.serverTimestamp(),
      requestHash,
      transactionId: txRef.id,
      serverSigned: true
    });

    result = {
      uid,
      beforeBalanceRub: before,
      afterBalanceRub: after,
      transactionId: txRef.id,
      usageId: usageRef.id
    };
  });

  return { ok: true, ...result };
});

exports.suspiciousAiUsageZeroBalance = onCall(async (request) => {
  const actor = await requireApprovedUser(request);
  const uid = actor.uid;

  const accountSnap = await db.collection("ai_accounts").doc(uid).get();
  const account = accountSnap.exists ? accountSnap.data() : {};
  const balanceRub = Number(account.balanceRub || 0);

  if (balanceRub <= 0) {
    const eventId = await blockUserForReview(uid, "suspicious_ai_usage_zero_balance", {
      balanceRubBefore: balanceRub,
      attemptedFeature: cleanText(request.data.feature, "unknown"),
      attemptedCostRub: Number(request.data.amountRub || 0),
      attemptedTokens: Number(request.data.totalTokens || 0),
      appVersion: cleanText(request.data.appVersion, "unknown"),
      userAgent: cleanText(request.rawRequest?.headers?.["user-agent"], "unknown")
    });

    throw new HttpsError(
      "permission-denied",
      "Подозрительное использование ИИ при нулевом балансе. Аккаунт заблокирован до проверки.",
      { eventId }
    );
  }

  return { ok: true, blocked: false, balanceRub };
});

exports.refundAiBalance = onCall(async (request) => {
  const adminUser = await requireAdmin(request);

  const uid = cleanText(request.data.uid);
  const amountRub = cleanAmountRub(request.data.amountRub);
  const reason = cleanText(request.data.reason, "admin_refund");

  if (!uid) {
    throw new HttpsError("invalid-argument", "Не указан uid пользователя.");
  }

  const accountRef = await getAccountRef(uid);
  const txRef = db.collection("ai_transactions").doc();

  let result = null;

  await db.runTransaction(async (tx) => {
    const accountSnap = await tx.get(accountRef);
    const account = accountSnap.exists ? accountSnap.data() : {};

    const before = Number(account.balanceRub || 0);
    const after = Math.round((before + amountRub) * 100) / 100;

    tx.set(accountRef, {
      uid,
      balanceRub: after,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: adminUser.uid
    }, { merge: true });

    tx.set(txRef, {
      uid,
      type: "refund",
      amountRub,
      tokens: 0,
      beforeBalanceRub: before,
      afterBalanceRub: after,
      reason,
      paymentMethod: "admin_refund",
      paymentStatus: "refunded",
      createdAt: FieldValue.serverTimestamp(),
      createdBy: adminUser.uid,
      serverSigned: true,
      source: "cloud_function"
    });

    result = { uid, beforeBalanceRub: before, afterBalanceRub: after, transactionId: txRef.id };
  });

  return { ok: true, ...result };
});

exports.setAiAccessMode = onCall(async (request) => {
  const adminUser = await requireAdmin(request);

  const uid = cleanText(request.data.uid);
  const accessMode = cleanText(request.data.accessMode, "disabled");

  if (!["admin_api", "own_api", "disabled"].includes(accessMode)) {
    throw new HttpsError("invalid-argument", "Неверный режим ИИ-доступа.");
  }

  await db.collection("ai_accounts").doc(uid).set({
    uid,
    accessMode,
    allowAi: accessMode !== "disabled",
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: adminUser.uid
  }, { merge: true });

  await db.collection("admin_logs").doc().set({
    type: "ai_access_mode_changed",
    uid,
    accessMode,
    createdBy: adminUser.uid,
    createdAt: FieldValue.serverTimestamp()
  });

  return { ok: true, uid, accessMode };
});

exports.reportDeviceIntegrity = onCall(async (request) => {
  const actor = await requireApprovedUser(request);
  const uid = actor.uid;

  const deviceId = cleanText(request.data.deviceId, "unknown_device");
  const rootDetected = request.data.rootDetected === true;
  const emulatorDetected = request.data.emulatorDetected === true;
  const apkTampered = request.data.apkTampered === true;
  const bootloaderUnlocked = request.data.bootloaderUnlocked === true;
  const playIntegrityVerdict = cleanText(request.data.playIntegrityVerdict, "unknown");
  const appVersion = cleanText(request.data.appVersion, "unknown");

  let riskLevel = "low";

  if (emulatorDetected || bootloaderUnlocked) riskLevel = "medium";
  if (rootDetected || apkTampered) riskLevel = "high";
  if (rootDetected && apkTampered) riskLevel = "critical";

  const allowLogin = riskLevel !== "critical";
  const allowReadData = riskLevel === "low" || riskLevel === "medium";
  const allowLocalCache = riskLevel === "low";
  const allowAi = riskLevel === "low";
  const allowOfflineMode = riskLevel === "low";

  await db.collection("device_integrity").doc(`${uid}_${deviceId}`).set({
    uid,
    deviceId,
    platform: "android",
    rootDetected,
    emulatorDetected,
    apkTampered,
    bootloaderUnlocked,
    playIntegrityVerdict,
    appVersion,
    riskLevel,
    allowLogin,
    allowReadData,
    allowLocalCache,
    allowAi,
    allowOfflineMode,
    userAgent: cleanText(request.rawRequest?.headers?.["user-agent"], "unknown"),
    lastCheckAt: FieldValue.serverTimestamp(),
    serverSigned: true
  }, { merge: true });

  await db.collection("users").doc(uid).set({
    securityPolicy: {
      allowLogin,
      allowReadData,
      allowLocalCache,
      allowAi,
      allowOfflineMode,
      reason: `device_integrity_${riskLevel}`
    },
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  if (riskLevel === "high" || riskLevel === "critical") {
    await createSecurityEvent({
      uid,
      type: "suspicious_device_integrity",
      severity: riskLevel === "critical" ? "critical" : "high",
      deviceId,
      rootDetected,
      emulatorDetected,
      apkTampered,
      bootloaderUnlocked,
      playIntegrityVerdict,
      appVersion,
      riskLevel
    });

    await db.collection("ai_accounts").doc(uid).set({
      uid,
      accessMode: "disabled",
      allowAi: false,
      blockedReason: `device_integrity_${riskLevel}`,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
  }

  return {
    ok: true,
    uid,
    deviceId,
    riskLevel,
    policy: {
      allowLogin,
      allowReadData,
      allowLocalCache,
      allowAi,
      allowOfflineMode
    }
  };
});

exports.setUserSecurityPolicy = onCall(async (request) => {
  const adminUser = await requireAdmin(request);

  const uid = cleanText(request.data.uid);
  if (!uid) {
    throw new HttpsError("invalid-argument", "Не указан uid пользователя.");
  }

  const policy = {
    allowLogin: request.data.allowLogin !== false,
    allowReadData: request.data.allowReadData !== false,
    allowLocalCache: request.data.allowLocalCache === true,
    allowAi: request.data.allowAi === true,
    allowOfflineMode: request.data.allowOfflineMode === true,
    reason: cleanText(request.data.reason, "admin_security_policy")
  };

  await db.collection("users").doc(uid).set({
    securityPolicy: policy,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: adminUser.uid
  }, { merge: true });

  await createSecurityEvent({
    uid,
    type: "admin_security_policy_changed",
    severity: "medium",
    policy,
    changedBy: adminUser.uid
  });

  return { ok: true, uid, policy };
});

exports.requestAiPayment = onCall(async (request) => {
  const actor = await requireApprovedUser(request);
  const uid = actor.uid;

  const amountRub = cleanAmountRub(request.data.amountRub);
  const comment = cleanText(request.data.comment, "");

  const ref = db.collection("ai_payment_requests").doc();

  await ref.set({
    uid,
    amountRub,
    status: "pending",
    paymentMethod: "manual_qr",
    comment,
    createdAt: FieldValue.serverTimestamp(),
    serverSigned: true
  });

  return { ok: true, requestId: ref.id };
});
