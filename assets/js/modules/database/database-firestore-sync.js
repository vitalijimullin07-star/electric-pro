/* ============================================================
   Electric Pro V29 — Database / Firestore Sync  (ПРАВИЛЬНЫЕ ПУТИ)
   Структура — как в РАБОЧЕМ старом приложении, чтобы БД была ОБЩЕЙ
   для двух проектов на одном Firebase:
     Моя БД     -> документ  user_db/{uid}     { items:[...] , ... }
     БД сервера -> документ  server_db/main    { items:[...] , ... }
   Совпадает с firestore.rules (user_db/{uid}, server_db/**) — запись
   разрешена, без изменения правил и без deploy.
   localStorage (epdb26_my/epdb26_server) остаётся быстрым кэшем.
   Защита от потери данных: пустой Firebase не затирает локальное;
   слияние по id (remote перекрывает, локальные-только сохраняются).
   Ключи openaiKey/geminiKey не читаются (берём только user_db/server_db).
   ============================================================ */
(() => {
  "use strict";
  window.EP = window.EP || {};

  const PATHS = { userDb: "user_db", serverDb: "server_db", serverDoc: "main" };
  const VERSION = "v29";
  const status = {
    state: "init",   // init|connected|signed-out|error|permission-denied|cache
    lastSync: null, serverCount: null, myCount: null,
    serverEmptyRemote: null, myEmptyRemote: null, message: ""
  };

  function db() {
    try { if (window.EP.Firebase) { if (!EP.Firebase.ready && EP.Firebase.init) EP.Firebase.init(); return EP.Firebase.db || null; } } catch (e) {}
    return null;
  }
  function me() { try { return (EP.Auth && EP.Auth.currentUser && EP.Auth.currentUser()) || (EP.state && EP.state.user) || {}; } catch (e) { return {}; } }
  function uid() { return me().uid || null; }
  function email() { return me().email || ""; }
  function uname() { const u = me(); return u.displayName || u.name || u.email || ""; }
  function isAdmin() { try { return !!(EP.Auth && EP.Auth.isAdmin && EP.Auth.isAdmin()); } catch (e) { return false; } }
  function nowISO() { return new Date().toISOString(); }
  function ts() { try { return firebase.firestore.FieldValue.serverTimestamp(); } catch (e) { return nowISO(); } }
  function logErr(tag, e) { try { console.warn("[" + tag + "]", (e && (e.code || e.message)) || e); } catch (_) {} }

  function setState(st, msg) {
    status.state = st; if (msg != null) status.message = msg;
    window.dispatchEvent(new CustomEvent("ep:db-sync-status", { detail: Object.assign({}, status) }));
  }
  function getStatus() { return Object.assign({}, status); }
  function handleErr(tag, e) {
    logErr(tag, e);
    if (e && e.code === "permission-denied") { setState("permission-denied", "Нет прав Firestore (permission-denied)"); return { ok: false, error: "permission-denied" }; }
    setState("error", "Ошибка синхронизации: " + ((e && (e.code || e.message)) || e));
    return { ok: false, error: String((e && (e.code || e.message)) || e) };
  }

  function mergeById(local, remote) {
    const map = new Map();
    (local || []).forEach((x) => map.set(String(x.id), x));
    (remote || []).forEach((x) => map.set(String(x.id), x));
    return Array.from(map.values());
  }
  // позиции из документа: понимаем и старый короткий формат (n/c/g/u/p)
  function extractItems(data) {
    const arr = data && Array.isArray(data.items) ? data.items : [];
    return arr.map((x) => EP.Database.normalizeItem(x, x && x.type));
  }
  function rowsOut(items) {
    // нормализуем для записи (общий формат, который читает и старое приложение)
    return (items || []).map((x) => EP.Database.normalizeItem(x, x && x.type));
  }

  function buildMyDoc(u, rows) {
    return {
      uid: u, email: email(), displayName: uname(),
      role: isAdmin() ? "admin" : "master",
      items: rows,
      workCount: rows.filter((x) => x.type === "work").length,
      materialCount: rows.filter((x) => x.type === "material").length,
      version: VERSION, updatedAt: ts(), updatedAtClient: nowISO()
    };
  }
  function buildServerDoc(rows) {
    return {
      items: rows,
      workCount: rows.filter((x) => x.type === "work").length,
      materialCount: rows.filter((x) => x.type === "material").length,
      updatedByUid: uid(), updatedByEmail: email(),
      version: VERSION, updatedAt: ts(), updatedAtClient: nowISO()
    };
  }

  let busy = false, upTimer = null;
  function scheduleMyUpload() {
    if (busy || !db() || !uid()) return;
    clearTimeout(upTimer);
    upTimer = setTimeout(async () => { const r = await uploadMyDbCurrent(); if (r && r.ok) setState("connected", "Сохранено в Firebase"); }, 800);
  }

  // ---- чтение ----
  async function downloadServerDb() {
    const d = db(); if (!d) return null;
    const snap = await d.collection(PATHS.serverDb).doc(PATHS.serverDoc).get();
    return snap.exists ? extractItems(snap.data()) : [];
  }
  async function downloadMyDb(forUid) {
    const d = db(); const u = forUid || uid(); if (!d || !u) return null;
    const snap = await d.collection(PATHS.userDb).doc(u).get();
    return snap.exists ? extractItems(snap.data()) : [];
  }

  // ---- запись (один документ с массивом items) ----
  async function uploadMyDb(forUid, items) {
    const d = db(); const u = forUid || uid(); if (!d || !u) throw new Error("no-uid");
    const rows = rowsOut(items);
    await d.collection(PATHS.userDb).doc(u).set(buildMyDoc(u, rows), { merge: true });
    return rows.length;
  }
  async function uploadServerDb(items) {
    const d = db(); if (!d) throw new Error("no-db");
    const rows = rowsOut(items);
    await d.collection(PATHS.serverDb).doc(PATHS.serverDoc).set(buildServerDoc(rows), { merge: true });
    return rows.length;
  }

  async function uploadMyDbCurrent() {
    const u = uid(); if (!u) { setState("signed-out", "Нет входа"); return { ok: false, error: "no-uid" }; }
    try { const n = await uploadMyDb(u, EP.Database.getLocalItems("my")); status.lastSync = nowISO(); status.myEmptyRemote = (n === 0); setState("connected", "Моя БД сохранена в Firebase: " + n); return { ok: true, count: n }; }
    catch (e) { return handleErr("db-save-error", e); }
  }
  async function uploadServerDbCurrent() {
    if (!isAdmin()) return { ok: false, error: "not-admin" };
    try { const n = await uploadServerDb(EP.Database.getLocalItems("server")); status.lastSync = nowISO(); setState("connected", "БД сервера сохранена в Firebase: " + n); return { ok: true, count: n }; }
    catch (e) { return handleErr("db-save-error", e); }
  }

  // ПУЛЛ Firestore -> локальный кэш (слияние; пустой remote не трёт)
  async function pullToLocal(which) {
    if (!db()) { setState("cache", "Firebase недоступен — кэш"); return { ok: false, error: "no-db" }; }
    if (!uid()) { setState("signed-out", "Нет входа"); return { ok: false, error: "no-uid" }; }
    busy = true; const res = {};
    try {
      if (which !== "my") { const r = await downloadServerDb(); if (r && r.length) { EP.Database.saveLocalItems("server", mergeById(EP.Database.getLocalItems("server"), r)); res.server = r.length; } else res.server = 0; }
      if (which !== "server") { const r = await downloadMyDb(); if (r && r.length) { EP.Database.saveLocalItems("my", mergeById(EP.Database.getLocalItems("my"), r)); res.my = r.length; } else res.my = 0; }
      status.lastSync = nowISO(); status.serverCount = EP.Database.getLocalItems("server").length; status.myCount = EP.Database.getLocalItems("my").length;
      setState("connected", "БД загружена с сервера");
      window.dispatchEvent(new CustomEvent("ep:db-changed", { detail: { base: "my" } }));
      return Object.assign({ ok: true }, res);
    } catch (e) { return handleErr("db-load-error", e); } finally { busy = false; }
  }

  // АВТО при входе: слияние + засев локальных-только в облако
  async function syncAll() {
    if (!db()) { setState("cache", "Работаем из локального кэша"); return getStatus(); }
    const u = uid(); if (!u) { setState("signed-out", "Нет входа — кэш"); return getStatus(); }
    busy = true;
    try {
      const remoteServer = await downloadServerDb();
      const remoteMy = await downloadMyDb(u);
      const localServer = EP.Database.getLocalItems("server");
      const localMy = EP.Database.getLocalItems("my");
      if ((remoteServer && remoteServer.length) || localServer.length) EP.Database.saveLocalItems("server", mergeById(localServer, remoteServer));
      const myEmptyRemote = !(remoteMy && remoteMy.length);
      const myMerged = mergeById(localMy, remoteMy);
      if (myMerged.length) EP.Database.saveLocalItems("my", myMerged);
      const remoteIds = new Set((remoteMy || []).map((x) => String(x.id)));
      const localOnly = myMerged.filter((x) => !remoteIds.has(String(x.id))).length;
      if (localOnly) { try { await uploadMyDb(u, myMerged); } catch (e) { handleErr("db-save-error", e); } }
      status.lastSync = nowISO();
      status.serverCount = EP.Database.getLocalItems("server").length;
      status.myCount = EP.Database.getLocalItems("my").length;
      status.serverEmptyRemote = !(remoteServer && remoteServer.length);
      status.myEmptyRemote = myEmptyRemote;
      setState("connected", localOnly ? "Локальная БД сохранена в Firebase" : "БД загружена с сервера");
      window.dispatchEvent(new CustomEvent("ep:db-changed", { detail: { base: "my" } }));
      return getStatus();
    } catch (e) { handleErr("db-sync-error", e); return getStatus(); } finally { busy = false; }
  }

  function init() { if (uid() && db()) { setTimeout(() => { try { syncAll(); } catch (_) {} }, 200); } return getStatus(); }

  EP.DatabaseSync = {
    PATHS, init, getStatus,
    downloadServerDb, downloadMyDb, uploadMyDb, uploadServerDb,
    uploadMyDbCurrent, uploadServerDbCurrent, pullToLocal, syncAll, isAdmin, uid
  };

  window.addEventListener("ep:auth-changed", (e) => {
    if (e && e.detail && e.detail.user) { setTimeout(() => { try { syncAll(); } catch (_) {} }, 300); }
    else setState("signed-out", "Нет входа");
  });
  window.addEventListener("ep:db-changed", (e) => { if (e && e.detail && e.detail.base === "my") scheduleMyUpload(); });
})();
