const crypto = require("crypto");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

const OWNER_EMAILS = new Set(["vits0007@gmail.com"]);

function now() {
  return admin.firestore.Timestamp.now();
}

function assertSignedIn(request) {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "Требуется вход в аккаунт.");
  }
}

async function getUser(uid) {
  const snap = await db.collection("users").doc(uid).get();
  return snap.exists ? { uid, ...snap.data() } : null;
}

async function isAdmin(request) {
  assertSignedIn(request);
  const email = request.auth.token.email || "";
  if (OWNER_EMAILS.has(email)) return true;
  const user = await getUser(request.auth.uid);
  return Boolean(user && user.role === "admin" && user.accessStatus !== "blocked");
}

async function assertAdmin(request) {
  if (!(await isAdmin(request))) {
    throw new HttpsError("permission-denied", "Доступ только администратору.");
  }
}

function signingSecret() {
  const secret = process.env.ACCESS_SIGNING_SECRET || process.env.EP_ACCESS_SIGNING_SECRET || "";
  if (!secret) {
    logger.warn("ACCESS_SIGNING_SECRET is not configured. Signature is disabled until server secret is set.");
  }
  return secret;
}

function safeAccessPayload(data) {
  return {
    uid: data.uid || "",
    role: data.role || "master",
    accessStatus: data.accessStatus || "pending",
    subscription: data.subscription || {},
    ai: data.ai || {},
    version: "v29-secure-access"
  };
}

function signAccess(data) {
  const secret = signingSecret();
  if (!secret) return "server-secret-not-configured";
  return crypto
    .createHmac("sha256", secret)
    .update(JSON.stringify(safeAccessPayload(data)))
    .digest("hex");
}

function daysFromNow(days) {
  return admin.firestore.Timestamp.fromMillis(Date.now() + Number(days || 0) * 86400000);
}

function planTitle(plan) {
  return ({ none: "Нет подписки", basic: "Базовая", ai: "С ИИ", trial: "Тест 2 дня" })[plan] || "Нет подписки";
}

function buildFeatures(data) {
  const statusOk = data.accessStatus === "approved";
  const sub = data.subscription || {};
  const ai = data.ai || {};
  const active = Boolean(statusOk && sub.active && sub.plan !== "none");
  const hasAiPlan = active && (sub.plan === "ai" || sub.plan === "trial");
  const aiAllowed = Boolean(hasAiPlan && ai.enabled && (ai.mode === "client" || Number(ai.balanceRub || 0) > 0));

  return {
    app: active,
    database: active,
    materials: active,
    work: active,
    estimate: active,
    shield: active,
    pool: active,
    scheme: hasAiPlan,
    visualization: hasAiPlan,
    admin: data.role === "admin",
    ai: aiAllowed,
    warehouse: hasAiPlan,
    accounting: hasAiPlan,
    documents: hasAiPlan
  };
}

function normalizeAccessDoc(uid, data) {
  const subscription = data.subscription || {};
  const ai = data.ai || {};
  const expiresAt = subscription.expiresAt || null;
  const daysLeft = expiresAt && expiresAt.toMillis ? Math.max(0, Math.ceil((expiresAt.toMillis() - Date.now()) / 86400000)) : 0;

  const normalized = {
    uid,
    email: data.email || "",
    displayName: data.displayName || "",
    role: data.role || "master",
    accessStatus: data.accessStatus || "pending",
    subscription: {
      plan: subscription.plan || "none",
      title: subscription.title || planTitle(subscription.plan || "none"),
      active: Boolean(subscription.active),
      expiresAt,
      daysLeft
    },
    ai: {
      mode: ai.mode || "off",
      enabled: Boolean(ai.enabled),
      balanceRub: Number(ai.balanceRub || 0)
    }
  };

  normalized.features = buildFeatures(normalized);
  return normalized;
}

exports.ensureUserProfile = onCall(async (request) => {
  assertSignedIn(request);
  const uid = request.auth.uid;
  const email = request.auth.token.email || "";
  const ref = db.collection("users").doc(uid);
  const existing = await ref.get();
  const base = {
    uid,
    email,
    displayName: request.auth.token.name || email,
    photoURL: request.auth.token.picture || "",
    updatedAt: now()
  };

  if (!existing.exists) {
    const role = OWNER_EMAILS.has(email) ? "admin" : "master";
    const accessStatus = OWNER_EMAILS.has(email) ? "approved" : "pending";
    const doc = {
      ...base,
      role,
      accessStatus,
      subscription: { plan: "none", title: "Нет подписки", active: false, expiresAt: null },
      ai: { mode: "off", enabled: false, balanceRub: 0 },
      createdAt: now()
    };
    doc.accessSignature = signAccess({ ...doc, uid });
    await ref.set(doc);
  } else {
    await ref.set(base, { merge: true });
  }

  const fresh = await ref.get();
  return normalizeAccessDoc(uid, fresh.data() || {});
});

exports.getAccessPolicy = onCall(async (request) => {
  assertSignedIn(request);
  const uid = request.auth.uid;
  const email = request.auth.token.email || "";
  const ref = db.collection("users").doc(uid);
  let snap = await ref.get();

  if (!snap.exists) {
    await exports.ensureUserProfile.run(request);
    snap = await ref.get();
  }

  const data = snap.data() || {};
  if (OWNER_EMAILS.has(email) && data.role !== "admin") {
    await ref.set({ role: "admin", accessStatus: "approved", updatedAt: now() }, { merge: true });
    const fresh = await ref.get();
    return normalizeAccessDoc(uid, fresh.data() || {});
  }

  return normalizeAccessDoc(uid, data);
});

exports.adminListUsers = onCall(async (request) => {
  await assertAdmin(request);
  const snap = await db.collection("users").orderBy("updatedAt", "desc").limit(100).get();
  const users = snap.docs.map((doc) => normalizeAccessDoc(doc.id, doc.data() || {}));
  return { users };
});

exports.adminSetUserAccess = onCall(async (request) => {
  await assertAdmin(request);
  const input = request.data || {};
  const targetUid = String(input.targetUid || "");
  if (!targetUid) throw new HttpsError("invalid-argument", "Не указан пользователь.");

  const plan = String(input.plan || "none");
  const days = Number(input.days || 0);
  const aiBalanceRub = Number(input.aiBalanceRub || 0);

  const accessDoc = {
    role: String(input.role || "master"),
    accessStatus: String(input.accessStatus || "approved"),
    subscription: {
      plan,
      title: planTitle(plan),
      active: plan !== "none" && days > 0,
      expiresAt: plan !== "none" && days > 0 ? daysFromNow(days) : null,
      updatedAt: now()
    },
    ai: {
      mode: String(input.aiMode || "off"),
      enabled: Boolean(input.aiEnabled),
      balanceRub: Math.max(0, aiBalanceRub),
      updatedAt: now()
    },
    adminNote: String(input.note || ""),
    updatedAt: now(),
    updatedBy: request.auth.uid
  };

  accessDoc.accessSignature = signAccess({ ...accessDoc, uid: targetUid });

  await db.collection("users").doc(targetUid).set(accessDoc, { merge: true });
  await db.collection("admin_logs").add({
    type: "adminSetUserAccess",
    actorUid: request.auth.uid,
    actorEmail: request.auth.token.email || "",
    targetUid,
    plan,
    aiMode: accessDoc.ai.mode,
    aiBalanceRub: accessDoc.ai.balanceRub,
    createdAt: now()
  });

  const fresh = await getUser(targetUid);
  return { ok: true, user: normalizeAccessDoc(targetUid, fresh || {}) };
});
