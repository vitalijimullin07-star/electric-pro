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


/* === Electric Pro Subscription Foundation V10 === */

function planFeatures(planId) {
  if (planId === "pro_ai") {
    return {
      fullStorage: true,
      customerEstimate: true,
      singleLineScheme: true,
      visualization: true,
      ai: true
    };
  }

  return {
    fullStorage: false,
    customerEstimate: false,
    singleLineScheme: false,
    visualization: false,
    ai: false
  };
}

function planName(planId) {
  if (planId === "pro_ai") return "С ИИ";
  return "Базовая";
}

function cleanPlanId(value) {
  const planId = cleanText(value, "basic");
  if (!["basic", "pro_ai"].includes(planId)) {
    throw new HttpsError("invalid-argument", "Неверный тариф подписки.");
  }
  return planId;
}

function cleanPeriodDays(value, fallback = 30) {
  const n = Number(value || fallback);
  if (!Number.isFinite(n) || n <= 0 || n > 370) {
    throw new HttpsError("invalid-argument", "Срок подписки должен быть от 1 до 370 дней.");
  }
  return Math.round(n);
}

function addDays(date, days) {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + days);
  return d;
}

function timestampToDate(value) {
  try {
    if (!value) return null;
    if (value.toDate) return value.toDate();
    if (value instanceof Date) return value;
    return new Date(value);
  } catch (_) {
    return null;
  }
}

async function getSubscription(uid) {
  const snap = await db.collection("user_subscriptions").doc(uid).get();
  if (!snap.exists) return null;
  return snap.data() || null;
}

function isSubscriptionActive(subscription) {
  if (!subscription) return false;
  if (!["trial", "active"].includes(subscription.status)) return false;
  const expiresAt = timestampToDate(subscription.expiresAt);
  if (!expiresAt) return false;
  return expiresAt.getTime() > Date.now();
}

exports.seedSubscriptionPlans = onCall(async (request) => {
  const adminUser = await requireAdmin(request);

  const now = FieldValue.serverTimestamp();

  await db.collection("subscription_plans").doc("basic").set({
    planId: "basic",
    name: "Базовая",
    description: "Основные функции. Данные хранятся до перезапуска, кроме последней сметы/состояния. ИИ, однолинейная схема, визуализация и полноценная смета заказчику недоступны.",
    priceRub: Number(request.data?.basicPriceRub || 0),
    periodDays: 30,
    features: planFeatures("basic"),
    storageMode: "last_only",
    isActive: true,
    updatedAt: now,
    updatedBy: adminUser.uid
  }, { merge: true });

  await db.collection("subscription_plans").doc("pro_ai").set({
    planId: "pro_ai",
    name: "С ИИ",
    description: "Все функции приложения. ИИ-запросы оплачиваются отдельно по токенам/ИИ-балансу.",
    priceRub: Number(request.data?.proAiPriceRub || 0),
    periodDays: 30,
    features: planFeatures("pro_ai"),
    storageMode: "full",
    aiBillingNote: "Подписка открывает ИИ-функции, но фактические ИИ-запросы списываются с отдельного ИИ-баланса.",
    isActive: true,
    updatedAt: now,
    updatedBy: adminUser.uid
  }, { merge: true });

  await db.collection("app_meta").doc("payment_contacts").set({
    telegramHandle: "@Pokemoni_na_svjazy",
    telegramUrl: "https://t.me/Pokemoni_na_svjazy",
    maxEnabled: false,
    manualPaymentText: "Для оплаты подписки или ИИ-баланса напишите администратору в Telegram. После оплаты администратор вручную активирует подписку или пополнит ИИ-баланс.",
    yookassaPrepared: true,
    updatedAt: now,
    updatedBy: adminUser.uid
  }, { merge: true });

  return { ok: true, plans: ["basic", "pro_ai"] };
});

exports.grantSubscription = onCall(async (request) => {
  const adminUser = await requireAdmin(request);

  const uid = cleanText(request.data.uid);
  const planId = cleanPlanId(request.data.planId);
  const periodDays = cleanPeriodDays(request.data.periodDays, 30);
  const amountRub = Number(request.data.amountRub || 0);
  const paymentProvider = cleanText(request.data.paymentProvider, "manual_qr");
  const reason = cleanText(request.data.reason, "manual_subscription_grant");

  if (!uid) {
    throw new HttpsError("invalid-argument", "Не указан uid пользователя.");
  }

  await getUser(uid);

  const subRef = db.collection("user_subscriptions").doc(uid);
  const txRef = db.collection("subscription_transactions").doc();

  let result = null;

  await db.runTransaction(async (tx) => {
    const subSnap = await tx.get(subRef);
    const current = subSnap.exists ? subSnap.data() : {};

    const nowDate = new Date();
    const currentExpires = timestampToDate(current.expiresAt);
    const baseDate = currentExpires && currentExpires.getTime() > nowDate.getTime()
      ? currentExpires
      : nowDate;

    const beforeExpiresAt = currentExpires || null;
    const afterExpiresAt = addDays(baseDate, periodDays);
    const status = planId === "basic" && amountRub === 0 ? "trial" : "active";

    tx.set(subRef, {
      uid,
      planId,
      planName: planName(planId),
      status,
      features: planFeatures(planId),
      storageMode: planId === "pro_ai" ? "full" : "last_only",
      startedAt: current.startedAt || FieldValue.serverTimestamp(),
      expiresAt: admin.firestore.Timestamp.fromDate(afterExpiresAt),
      trialEndsAt: status === "trial" ? admin.firestore.Timestamp.fromDate(afterExpiresAt) : current.trialEndsAt || null,
      autoRenew: false,
      paymentProvider,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: adminUser.uid
    }, { merge: true });

    tx.set(txRef, {
      uid,
      type: status === "trial" ? "trial" : "manual_payment",
      planId,
      planName: planName(planId),
      amountRub: Number.isFinite(amountRub) ? amountRub : 0,
      periodDays,
      beforeExpiresAt: beforeExpiresAt ? admin.firestore.Timestamp.fromDate(beforeExpiresAt) : null,
      afterExpiresAt: admin.firestore.Timestamp.fromDate(afterExpiresAt),
      paymentProvider,
      paymentStatus: "paid",
      reason,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: adminUser.uid,
      serverSigned: true,
      source: "cloud_function"
    });

    result = {
      uid,
      planId,
      status,
      expiresAt: afterExpiresAt.toISOString(),
      transactionId: txRef.id
    };
  });

  await db.collection("admin_logs").doc().set({
    type: "subscription_granted",
    uid,
    planId,
    periodDays,
    amountRub,
    createdBy: adminUser.uid,
    createdAt: FieldValue.serverTimestamp(),
    transactionId: txRef.id
  });

  return { ok: true, ...result };
});

exports.cancelSubscription = onCall(async (request) => {
  const adminUser = await requireAdmin(request);

  const uid = cleanText(request.data.uid);
  const reason = cleanText(request.data.reason, "admin_cancel_subscription");

  if (!uid) {
    throw new HttpsError("invalid-argument", "Не указан uid пользователя.");
  }

  const subRef = db.collection("user_subscriptions").doc(uid);
  const txRef = db.collection("subscription_transactions").doc();

  const subSnap = await subRef.get();
  const current = subSnap.exists ? subSnap.data() : {};
  const expiresAt = timestampToDate(current.expiresAt);

  await subRef.set({
    uid,
    status: "canceled",
    canceledAt: FieldValue.serverTimestamp(),
    canceledBy: adminUser.uid,
    cancelReason: reason,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: adminUser.uid
  }, { merge: true });

  await txRef.set({
    uid,
    type: "cancel",
    planId: current.planId || "unknown",
    amountRub: 0,
    periodDays: 0,
    beforeExpiresAt: expiresAt ? admin.firestore.Timestamp.fromDate(expiresAt) : null,
    afterExpiresAt: expiresAt ? admin.firestore.Timestamp.fromDate(expiresAt) : null,
    paymentProvider: "admin",
    paymentStatus: "canceled",
    reason,
    createdAt: FieldValue.serverTimestamp(),
    createdBy: adminUser.uid,
    serverSigned: true,
    source: "cloud_function"
  });

  return { ok: true, uid, status: "canceled", transactionId: txRef.id };
});

exports.checkUserAccess = onCall(async (request) => {
  const actor = await requireApprovedUser(request);
  const uid = actor.uid;

  const profile = actor.profile || {};
  const subscription = await getSubscription(uid);
  const subscriptionActive = isSubscriptionActive(subscription);

  const planId = subscriptionActive ? (subscription.planId || "basic") : "none";
  const features = subscriptionActive ? (subscription.features || planFeatures(planId)) : {
    fullStorage: false,
    customerEstimate: false,
    singleLineScheme: false,
    visualization: false,
    ai: false
  };

  const accountSnap = await db.collection("ai_accounts").doc(uid).get();
  const aiAccount = accountSnap.exists ? accountSnap.data() || {} : {};
  const balanceRub = Number(aiAccount.balanceRub || 0);

  const policy = profile.securityPolicy || {};
  const canUseAi =
    features.ai === true &&
    balanceRub > 0 &&
    aiAccount.allowAi !== false &&
    aiAccount.accessMode !== "disabled" &&
    policy.allowAi !== false;

  return {
    ok: true,
    uid,
    subscriptionActive,
    subscription: subscription || null,
    planId,
    features,
    ai: {
      balanceRub,
      accessMode: aiAccount.accessMode || "disabled",
      allowAi: aiAccount.allowAi !== false,
      canUseAi
    },
    securityPolicy: {
      allowLogin: policy.allowLogin !== false,
      allowReadData: policy.allowReadData !== false,
      allowLocalCache: policy.allowLocalCache === true,
      allowAi: policy.allowAi === true || policy.allowAi === undefined,
      allowOfflineMode: policy.allowOfflineMode === true,
      reason: policy.reason || ""
    }
  };
});

exports.requestSubscriptionPayment = onCall(async (request) => {
  const actor = await requireApprovedUser(request);
  const uid = actor.uid;

  const planId = cleanPlanId(request.data.planId);
  const periodDays = cleanPeriodDays(request.data.periodDays, 30);
  const paymentProvider = cleanText(request.data.paymentProvider, "manual_qr");
  const comment = cleanText(request.data.comment, "");

  const ref = db.collection("subscription_payment_requests").doc();

  await ref.set({
    uid,
    planId,
    planName: planName(planId),
    periodDays,
    status: "pending",
    paymentProvider,
    paymentMethod: paymentProvider === "yookassa" ? "yookassa" : "manual_qr",
    paymentPurpose: "subscription",
    telegramHandle: "@Pokemoni_na_svjazy",
    telegramUrl: "https://t.me/Pokemoni_na_svjazy",
    comment,
    createdAt: FieldValue.serverTimestamp(),
    serverSigned: true
  });

  return {
    ok: true,
    requestId: ref.id,
    telegramUrl: "https://t.me/Pokemoni_na_svjazy",
    message: "Для оплаты напишите администратору в Telegram."
  };
});

exports.createYooKassaPaymentDraft = onCall(async (request) => {
  const actor = await requireApprovedUser(request);
  const uid = actor.uid;

  const purpose = cleanText(request.data.paymentPurpose, "subscription");
  const planId = purpose === "subscription" ? cleanPlanId(request.data.planId) : "";
  const amountRub = cleanAmountRub(request.data.amountRub);
  const idempotenceKey = cleanText(request.data.idempotenceKey, `${uid}_${Date.now()}`);

  const ref = db.collection("payment_requests").doc();

  await ref.set({
    uid,
    paymentProvider: "yookassa",
    paymentPurpose: purpose,
    planId,
    amountRub,
    currency: "RUB",
    paymentStatus: "draft",
    paymentId: "",
    confirmationUrl: "",
    idempotenceKey,
    note: "ЮKassa подготовлена архитектурно. Для реальной оплаты нужно добавить shopId/secretKey в Cloud Functions secrets и реализовать API-запрос.",
    createdAt: FieldValue.serverTimestamp(),
    serverSigned: true
  });

  return {
    ok: true,
    requestId: ref.id,
    provider: "yookassa",
    status: "draft",
    message: "Заготовка ЮKassa создана. Реальное создание платежа будет подключено позже через серверные секреты."
  };
});

exports.handleYooKassaWebhookPlaceholder = onCall(async (request) => {
  await requireAdmin(request);

  return {
    ok: true,
    message: "Webhook placeholder. Реальный webhook ЮKassa будет отдельной HTTPS-функцией после подключения shopId/secretKey и проверки webhook."
  };
});








// V15_1_ACCESS_POLICY_FINAL_START
const ACCESS_LIMITS_V151 = {
  none: { shieldItemsMax: 0, poolItemsMax: 0 },
  basic: { shieldItemsMax: 60, poolItemsMax: 50 },
  pro_ai: { shieldItemsMax: null, poolItemsMax: null },
  admin: { shieldItemsMax: null, poolItemsMax: null }
};

const ACCESS_FEATURES_V151 = {
  database: "База",
  estimate: "Смета",
  supplier: "Поставщику",
  drafts: "Черновик",
  shield: "Конфигуратор щита",
  pool: "Пул розеток/штроб",
  ai: "ИИ-функции",
  singleLineScheme: "Однолинейная схема",
  visualization: "Визуализация",
  customerEstimate: "Полноценная смета заказчику",
  warehouse: "Склад",
  accounting: "Бухгалтерия",
  fullStorage: "Полное хранение данных"
};

function isDateActiveV151(value) {
  if (!value) return false;
  try {
    const date = value.toDate ? value.toDate() : new Date(value);
    return date.getTime() > Date.now();
  } catch (error) {
    return false;
  }
}

async function getSubscriptionV151(uid) {
  const snap = await db.collection("user_subscriptions").doc(uid).get();
  return snap.exists ? (snap.data() || {}) : null;
}

async function getAiAccountV151(uid) {
  const snap = await db.collection("ai_accounts").doc(uid).get();
  return snap.exists ? (snap.data() || {}) : null;
}


function tsToMillisV154(value) {
  if (!value) return 0;
  try {
    if (typeof value.toMillis === "function") return value.toMillis();
    if (typeof value.toDate === "function") return value.toDate().getTime();
    return new Date(value).getTime();
  } catch (error) {
    return 0;
  }
}

function buildAccessPolicyV151(uid, profile, subscription, aiAccount) {
  const isAdminUser =
    profile.role === "admin" ||
    profile.isAdmin === true ||
    profile.email === "vits0007@gmail.com";

  if (isAdminUser) {
    const all = {};
    Object.keys(ACCESS_FEATURES_V151).forEach((key) => all[key] = true);
    return {
      uid,
      planId: "admin",
      status: "active",
      active: true,
      features: all,
      limits: ACCESS_LIMITS_V151.admin,
      ai: {
        balanceRub: Number(aiAccount?.balanceRub || 0),
        accessMode: aiAccount?.accessMode || "admin_api",
        canUseAi: true
      },
      serverChecked: true
    };
  }

  const sub = subscription || {};
  const active =
    (sub.status === "active" || sub.status === "trial") &&
    isDateActiveV151(sub.expiresAt || sub.trialEndsAt);

  const planId = active ? (sub.planId || "none") : "none";
  const isBasic = planId === "basic";
  const isProAi = planId === "pro_ai";

  const aiBalance = Number(aiAccount?.balanceRub || 0);
  const aiAccessMode = aiAccount?.accessMode || "disabled";

  const noneFeatures = {};
  Object.keys(ACCESS_FEATURES_V151).forEach((key) => noneFeatures[key] = false);

  const basicFeatures = {
    ...noneFeatures,
    database: true,
    estimate: true,
    supplier: true,
    drafts: true,
    shield: true,
    pool: true
  };

  const proFeatures = {};
  Object.keys(ACCESS_FEATURES_V151).forEach((key) => proFeatures[key] = true);

  const features = isProAi ? proFeatures : isBasic ? basicFeatures : noneFeatures;
  const limits = isProAi
    ? ACCESS_LIMITS_V151.pro_ai
    : isBasic
      ? ACCESS_LIMITS_V151.basic
      : ACCESS_LIMITS_V151.none;

  const canUseAi =
    features.ai === true &&
    (
      aiAccessMode === "own_api" ||
      (aiAccessMode === "admin_api" && aiBalance > 0)
    );

  return {
    uid,
    planId,
    status: active ? (sub.status || "active") : "none",
    active,
    expiresAtMillis: tsToMillisV154(sub.expiresAt || sub.trialEndsAt),
    trialEndsAtMillis: tsToMillisV154(sub.trialEndsAt),
    features,
    limits,
    ai: {
      balanceRub: aiBalance,
      accessMode: aiAccessMode,
      canUseAi
    },
    serverChecked: true
  };
}

function denyReasonV151(feature, policy) {
  if (policy.planId === "none") {
    return "Без активной подписки доступны только вход, экран подписки и запрос оплаты.";
  }

  if (feature === "ai") {
    if (policy.features.ai !== true) return "ИИ-функции доступны только в подписке «С ИИ». ИИ-запросы оплачиваются отдельно.";
    if (policy.ai.accessMode === "disabled") return "ИИ-доступ выключен администратором.";
    if (policy.ai.accessMode === "admin_api" && policy.ai.balanceRub <= 0) return "ИИ-баланс закончился.";
  }

  const title = ACCESS_FEATURES_V151[feature] || "Функция";
  return `${title} недоступна в текущей подписке.`;
}

exports.getAccessPolicy = onCall(async (request) => {
  const actor = await requireApprovedUser(request);
  const uid = actor.uid;
  const profile = actor.profile || {};

  const [subscription, aiAccount] = await Promise.all([
    getSubscriptionV151(uid),
    getAiAccountV151(uid)
  ]);

  return buildAccessPolicyV151(uid, profile, subscription, aiAccount);
});

exports.checkFeatureAccess = onCall(async (request) => {
  const actor = await requireApprovedUser(request);
  const uid = actor.uid;
  const profile = actor.profile || {};
  const feature = cleanText(request.data.feature, "");

  if (!feature || !Object.prototype.hasOwnProperty.call(ACCESS_FEATURES_V151, feature)) {
    throw new HttpsError("invalid-argument", "Неизвестная функция доступа.");
  }

  const [subscription, aiAccount] = await Promise.all([
    getSubscriptionV151(uid),
    getAiAccountV151(uid)
  ]);

  const policy = buildAccessPolicyV151(uid, profile, subscription, aiAccount);
  const allowed = feature === "ai" ? policy.ai.canUseAi === true : policy.features[feature] === true;

  if (!allowed) {
    await db.collection("admin_logs").doc().set({
      type: "access_denied",
      uid,
      feature,
      planId: policy.planId,
      reason: denyReasonV151(feature, policy),
      createdAt: FieldValue.serverTimestamp(),
      serverSigned: true
    });
  }

  return { ok: true, allowed, feature, title: ACCESS_FEATURES_V151[feature], reason: allowed ? "" : denyReasonV151(feature, policy), policy };
});

exports.checkUsageLimit = onCall(async (request) => {
  const actor = await requireApprovedUser(request);
  const uid = actor.uid;
  const profile = actor.profile || {};
  const limitType = cleanText(request.data.limitType, "");
  const currentCount = Number(request.data.currentCount || 0);
  const addCount = Number(request.data.addCount || 1);
  const nextCount = Number(request.data.nextCount || (currentCount + addCount));

  if (!["shieldItems", "poolItems"].includes(limitType)) {
    throw new HttpsError("invalid-argument", "Неизвестный тип лимита.");
  }

  const [subscription, aiAccount] = await Promise.all([
    getSubscriptionV151(uid),
    getAiAccountV151(uid)
  ]);

  const policy = buildAccessPolicyV151(uid, profile, subscription, aiAccount);
  const max = limitType === "shieldItems" ? policy.limits.shieldItemsMax : policy.limits.poolItemsMax;
  const allowed = max === null || nextCount <= max;
  const title = limitType === "shieldItems" ? "Лимит конфигуратора щита" : "Лимит пула розеток/штроб";

  let reason = "";
  if (!allowed) {
    if (policy.planId === "none") reason = "Без активной подписки эта функция недоступна.";
    else {
      reason = limitType === "shieldItems"
        ? `В тарифе «Базовая» в конфигураторе щита доступно до ${max} позиций. Для снятия лимита нужна подписка «С ИИ».`
        : `В тарифе «Базовая» в пуле розеток/штроб доступно до ${max} позиций. Для снятия лимита нужна подписка «С ИИ».`;
    }

    await db.collection("admin_logs").doc().set({
      type: "usage_limit_denied",
      uid,
      limitType,
      currentCount,
      nextCount,
      max,
      planId: policy.planId,
      reason,
      createdAt: FieldValue.serverTimestamp(),
      serverSigned: true
    });
  }

  return { ok: true, allowed, limitType, title, reason, currentCount, nextCount, max, policy };
});

exports.setAiBalanceExact = onCall(async (request) => {
  const adminUser = await requireAdmin(request);
  const uid = cleanText(request.data.uid);
  const balanceRub = Math.round(Number(request.data.balanceRub || 0) * 100) / 100;
  const reason = cleanText(request.data.reason, "admin_set_exact_balance");

  if (!uid) throw new HttpsError("invalid-argument", "Не указан uid пользователя.");
  if (!Number.isFinite(balanceRub) || balanceRub < 0) {
    throw new HttpsError("invalid-argument", "Баланс должен быть числом от 0.");
  }

  const accountRef = db.collection("ai_accounts").doc(uid);
  const txRef = db.collection("ai_transactions").doc();
  let result = null;

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(accountRef);
    const account = snap.exists ? (snap.data() || {}) : {};
    const before = Number(account.balanceRub || 0);
    const delta = Math.round((balanceRub - before) * 100) / 100;

    tx.set(accountRef, {
      uid,
      balanceRub,
      accessMode: account.accessMode || "admin_api",
      allowAi: (account.accessMode || "admin_api") !== "disabled",
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: adminUser.uid
    }, { merge: true });

    tx.set(txRef, {
      uid,
      type: "correction",
      amountRub: delta,
      tokens: 0,
      beforeBalanceRub: before,
      afterBalanceRub: balanceRub,
      reason,
      paymentMethod: "admin_exact_balance",
      paymentStatus: "corrected",
      createdAt: FieldValue.serverTimestamp(),
      createdBy: adminUser.uid,
      serverSigned: true,
      source: "cloud_function"
    });

    result = { uid, beforeBalanceRub: before, afterBalanceRub: balanceRub, deltaRub: delta, transactionId: txRef.id };
  });

  await db.collection("admin_logs").doc().set({
    type: "ai_balance_exact_set",
    uid,
    balanceRub,
    createdBy: adminUser.uid,
    createdAt: FieldValue.serverTimestamp(),
    transactionId: txRef.id
  });

  return { ok: true, ...result };
});
// V15_1_ACCESS_POLICY_FINAL_END


// V16_4_ADMIN_LOGS_READ_START
function normalizeForClientV164(value) {
  if (value === null || value === undefined) return value;

  if (typeof value.toDate === "function") {
    const date = value.toDate();
    return {
      millis: date.getTime(),
      iso: date.toISOString(),
      text: date.toLocaleString("ru-RU")
    };
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeForClientV164(item));
  }

  if (typeof value === "object") {
    const out = {};
    Object.keys(value).forEach((key) => {
      out[key] = normalizeForClientV164(value[key]);
    });
    return out;
  }

  return value;
}

async function readCollectionSafeV164(path, limit) {
  try {
    let snap;
    try {
      snap = await db.collection(path).orderBy("createdAt", "desc").limit(limit).get();
    } catch (e1) {
      try {
        snap = await db.collection(path).orderBy("time", "desc").limit(limit).get();
      } catch (e2) {
        snap = await db.collection(path).limit(limit).get();
      }
    }

    const items = [];
    snap.forEach((doc) => {
      items.push({
        id: doc.id,
        path,
        data: normalizeForClientV164(doc.data() || {})
      });
    });

    return items;
  } catch (error) {
    return [];
  }
}

exports.adminReadLogsV16 = onCall(async (request) => {
  const adminUser = await requireAdmin(request);

  const uid = cleanText(request.data.uid);
  const limitRaw = Number(request.data.limit || 60);
  const limit = Math.max(1, Math.min(100, Number.isFinite(limitRaw) ? limitRaw : 60));

  if (!uid) {
    throw new HttpsError("invalid-argument", "Не выбран мастер.");
  }

  const paths = [
    "admin_logs",
    "logs",
    `diagnostics/${uid}/items`,
    `login_logs/${uid}/items`,
    `users/${uid}/logs`,
    `users/${uid}/events`
  ];

  const groups = await Promise.all(paths.map((path) => readCollectionSafeV164(path, limit)));
  const items = groups.flat();

  items.sort((a, b) => {
    const ad = a.data || {};
    const bd = b.data || {};

    const am =
      ad.createdAt?.millis ||
      ad.updatedAt?.millis ||
      ad.time?.millis ||
      ad.timestamp?.millis ||
      Number(ad.createdAt || ad.updatedAt || ad.time || ad.timestamp || 0);

    const bm =
      bd.createdAt?.millis ||
      bd.updatedAt?.millis ||
      bd.time?.millis ||
      bd.timestamp?.millis ||
      Number(bd.createdAt || bd.updatedAt || bd.time || bd.timestamp || 0);

    return Number(bm || 0) - Number(am || 0);
  });

  const sliced = items.slice(0, limit);

  await db.collection("admin_logs").doc().set(withExpiresAtV169({
    type: "admin_read_logs_v16",
    targetUid: uid,
    adminUid: adminUser.uid,
    count: sliced.length,
    createdAt: FieldValue.serverTimestamp(),
    serverSigned: true
  }, "admin_read_logs_v16"));

  return {
    ok: true,
    uid,
    count: sliced.length,
    items: sliced
  };
});
// V16_4_ADMIN_LOGS_READ_END


// V16_9_LOG_TTL_START
function daysFromNowV169(days) {
  const d = new Date(Date.now() + Number(days || 30) * 24 * 60 * 60 * 1000);
  return Timestamp.fromDate(d);
}

function logRetentionDaysV169(type) {
  const t = String(type || "").toLowerCase();

  // Финансовые/подписочные события держим дольше.
  if (
    t.includes("subscription") ||
    t.includes("payment") ||
    t.includes("balance") ||
    t.includes("transaction") ||
    t.includes("refund") ||
    t.includes("ai_spend") ||
    t.includes("ai_topup")
  ) return 365;

  // Ошибки держим дольше, чтобы можно было разбирать проблемы.
  if (
    t.includes("error") ||
    t.includes("denied") ||
    t.includes("blocked") ||
    t.includes("security") ||
    t.includes("suspicious")
  ) return 90;

  // Обычная техническая диагностика.
  if (
    t.includes("sync") ||
    t.includes("sound") ||
    t.includes("start") ||
    t.includes("clear") ||
    t.includes("diagnostics")
  ) return 30;

  // Обычный админский журнал.
  return 180;
}

function withExpiresAtV169(data, fallbackType) {
  const payload = data || {};
  if (payload.expiresAt) return payload;

  const type = payload.type || payload.code || fallbackType || "event";
  return {
    ...payload,
    expiresAt: daysFromNowV169(logRetentionDaysV169(type))
  };
}

async function setLogV169(collectionName, data, fallbackType) {
  return db.collection(collectionName).doc().set(withExpiresAtV169(data, fallbackType));
}

async function cleanupCollectionV169(collectionPath, now, limit) {
  const snap = await db.collection(collectionPath)
    .where("expiresAt", "<=", now)
    .limit(limit)
    .get();

  if (snap.empty) return 0;

  const batch = db.batch();
  snap.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();

  return snap.size;
}

exports.cleanupOldLogsV16 = onCall(async (request) => {
  const adminUser = await requireAdmin(request);

  const uid = cleanText(request.data.uid, "");
  const limitRaw = Number(request.data.limit || 300);
  const limit = Math.max(1, Math.min(500, Number.isFinite(limitRaw) ? limitRaw : 300));
  const now = Timestamp.now();

  const targets = [
    "admin_logs",
    "logs"
  ];

  if (uid) {
    targets.push(`diagnostics/${uid}/items`);
    targets.push(`login_logs/${uid}/items`);
    targets.push(`users/${uid}/logs`);
    targets.push(`users/${uid}/events`);
  }

  const result = {};
  let totalDeleted = 0;

  for (const path of targets) {
    const deleted = await cleanupCollectionV169(path, now, limit);
    result[path] = deleted;
    totalDeleted += deleted;
  }

  await db.collection("admin_logs").doc().set(withExpiresAtV169({
    type: "cleanup_old_logs_v16",
    adminUid: adminUser.uid,
    targetUid: uid || "all",
    totalDeleted,
    result,
    createdAt: FieldValue.serverTimestamp(),
    serverSigned: true
  }, "cleanup_old_logs_v16"));

  return {
    ok: true,
    uid: uid || "",
    totalDeleted,
    result
  };
});
// V16_9_LOG_TTL_END
