(() => {
  "use strict";

  const VERSION = "V26.5";
  const JS = "assets/js/database-v26-5-firebase-sync.js";
  const ADMIN_EMAIL = "vits0007@gmail.com";

  const KEY_MY = "epdb26_my";
  const KEY_SERVER = "epdb26_server";
  const KEY_MASTERS = "epdb26_masters";
  const KEY_LOG = "epdb26_log";
  const KEY_SYNC = "epdb26_sync_state";

  const PATHS = {
    serverCollection: "server_db",
    serverDoc: "main",
    userCollection: "user_db"
  };

  const state = {
    uid: "",
    email: "",
    name: "",
    admin: false,
    ready: false,
    loading: false,
    lastMyHash: "",
    lastServerHash: "",
    timer: null,
    pushTimer: null,
    unsubAuth: null,
    unsubMy: null,
    unsubServer: null,
    unsubMasters: null,
    lastError: ""
  };

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function hash(value) {
    try {
      const text = JSON.stringify(value || []);
      let h = 0;
      for (let i = 0; i < text.length; i++) h = ((h << 5) - h + text.charCodeAt(i)) | 0;
      return h + ":" + text.length;
    } catch (e) {
      return "bad";
    }
  }

  function norm(v) {
    return String(v ?? "")
      .toLowerCase()
      .replace(/ё/g, "е")
      .replace(/[×хx]/g, "x")
      .replace(/[^a-zа-я0-9x.,\s/_-]/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function makeId() {
    return "db26_" + Date.now().toString(36) + "_" + Math.random().toString(16).slice(2);
  }

  function normalizeItem(raw = {}, typeHint = "") {
    const typeText = norm(typeHint || raw.type || raw.kind || "");
    const type = typeText.includes("мат") || typeText.includes("material") ? "material" : "work";
    const name = String(raw.name || raw.n || raw.title || raw.Наименование || "Позиция").trim();
    const category = String(raw.category || raw.c || raw.cat || raw.folder || raw.Папка || (type === "work" ? "Работы" : "Материалы")).trim();
    const subcategory = String(raw.subcategory || raw.sc || raw.sub || raw.g || raw.group || raw.Подпапка || "Без подкатегории").trim();
    const unit = String(raw.unit || raw.u || raw.ed || raw.Ед || "шт").trim();
    const price = Number(raw.price ?? raw.p ?? raw.cost ?? raw.Цена ?? 0) || 0;

    return {
      ...raw,
      id: String(raw.id || makeId()),
      type,
      name,
      n: name,
      category,
      c: category,
      subcategory,
      sc: subcategory,
      g: raw.g || subcategory,
      unit,
      u: unit,
      price,
      p: price,
      active: raw.active !== false,
      updatedAt: raw.updatedAt || new Date().toISOString()
    };
  }

  function sortRows(rows) {
    return (Array.isArray(rows) ? rows : [])
      .map(x => normalizeItem(x, x?.type))
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === "work" ? -1 : 1;
        return String(a.category).localeCompare(String(b.category), "ru") ||
          String(a.subcategory).localeCompare(String(b.subcategory), "ru") ||
          String(a.name).localeCompare(String(b.name), "ru");
      });
  }

  function sig(row) {
    return norm([row.type, row.name || row.n, row.unit || row.u].join("|"));
  }

  function mergeRows(localRows, remoteRows) {
    const map = new Map();
    sortRows(remoteRows).forEach(r => map.set(sig(r) || r.id, r));
    sortRows(localRows).forEach(r => {
      const k = sig(r) || r.id;
      const old = map.get(k);
      if (!old) return map.set(k, r);
      const oldTime = Date.parse(old.updatedAt || 0) || 0;
      const newTime = Date.parse(r.updatedAt || 0) || 0;
      map.set(k, newTime >= oldTime ? { ...old, ...r } : old);
    });
    return sortRows(Array.from(map.values()));
  }

  function log(code, text, extra = {}) {
    const rows = readJson(KEY_LOG, []);
    rows.push({ time: new Date().toLocaleString("ru-RU"), iso: new Date().toISOString(), code, text, extra, file: JS });
    writeJson(KEY_LOG, rows.slice(-200));
    try {
      window.Diagnostics?.ok?.({ file: JS, module: "DBV265FirebaseSync", functionName: "runtime", place: "database", code, message: text, ...extra });
    } catch (e) {}
  }

  function setStatus(status, text) {
    const payload = {
      version: VERSION,
      status,
      text,
      uid: state.uid,
      email: state.email,
      admin: state.admin,
      error: state.lastError,
      iso: new Date().toISOString(),
      time: new Date().toLocaleString("ru-RU")
    };
    writeJson(KEY_SYNC, payload);
    updateStatusLine(payload);
  }

  function updateStatusLine(payload) {
    const root = document.getElementById("ep-db-v26");
    if (!root) return;
    const line = root.querySelector(".db26status");
    if (!line) return;

    if (!line.dataset.db265Base) line.dataset.db265Base = line.textContent || "✅ Локально: готово";
    const icon = payload.status === "ok" ? "✅" : payload.status === "syncing" ? "🔄" : payload.status === "offline" ? "⚠️" : "❌";
    line.textContent = `${line.dataset.db265Base} · Firebase: ${icon} ${payload.text}`;
  }

  function hasFirebase() {
    return !!(window.firebase && firebase.auth && firebase.firestore);
  }

  function firestore() {
    return hasFirebase() ? firebase.firestore() : null;
  }

  function serverTimestamp() {
    try { return firebase.firestore.FieldValue.serverTimestamp(); } catch (e) { return new Date(); }
  }

  function extractItems(data) {
    if (!data) return [];
    if (Array.isArray(data.items)) return data.items;
    if (Array.isArray(data.db)) return data.db;
    if (Array.isArray(data.myDb)) return data.myDb;
    if (Array.isArray(data.rows)) return data.rows;
    const out = [];
    if (Array.isArray(data.workDB)) out.push(...data.workDB.map(x => ({ ...x, type: "work" })));
    if (Array.isArray(data.matDB)) out.push(...data.matDB.map(x => ({ ...x, type: "material" })));
    return out;
  }

  function localMy() { return sortRows(readJson(KEY_MY, [])); }
  function localServer() { return sortRows(readJson(KEY_SERVER, [])); }

  function saveLocalMy(rows, source) {
    const fixed = sortRows(rows);
    writeJson(KEY_MY, fixed);
    state.lastMyHash = hash(fixed);
    log("local-my", "Моя БД записана локально.", { source, count: fixed.length });
    refreshDb();
  }

  function saveLocalServer(rows, source) {
    const fixed = sortRows(rows);
    writeJson(KEY_SERVER, fixed);
    state.lastServerHash = hash(fixed);
    log("local-server", "БД сервера записана локально.", { source, count: fixed.length });
    refreshDb();
  }

  function saveLocalMasters(map, source) {
    writeJson(KEY_MASTERS, map || {});
    log("local-masters", "БД мастеров записаны локально.", { source, count: Object.keys(map || {}).length });
    refreshDb();
  }

  function refreshDb() {
    try {
      const root = document.getElementById("ep-db-v26");
      if (!root || root.classList.contains("hidden")) return;
      const scrollTop = root.scrollTop || 0;
      setTimeout(() => {
        try {
          if (window.DatabaseV26SurgicalMonolith?.open) {
            window.DatabaseV26SurgicalMonolith.open();
            const r = document.getElementById("ep-db-v26");
            if (r) r.scrollTop = scrollTop;
          }
        } catch (e) {}
      }, 80);
    } catch (e) {}
  }

  async function pushMy(reason = "manual") {
    const db = firestore();
    if (!db || !state.uid) return false;

    const rows = localMy();
    await db.collection(PATHS.userCollection).doc(state.uid).set({
      uid: state.uid,
      email: state.email,
      displayName: state.name,
      role: state.admin ? "admin" : "master",
      items: rows,
      workCount: rows.filter(x => x.type === "work").length,
      materialCount: rows.filter(x => x.type === "material").length,
      version: VERSION,
      reason,
      updatedAt: serverTimestamp(),
      updatedAtClient: new Date().toISOString()
    }, { merge: true });

    state.lastMyHash = hash(rows);
    setStatus("ok", `моя БД сохранена: ${rows.length} поз.`);
    log("push-my", "Моя БД сохранена в Firebase.", { count: rows.length, reason });
    return true;
  }

  async function pushServer(reason = "manual") {
    const db = firestore();
    if (!db) return false;

    if (!state.admin) {
      log("server-write-blocked", "БД сервера может писать только админ.", { email: state.email });
      return false;
    }

    const rows = localServer();
    await db.collection(PATHS.serverCollection).doc(PATHS.serverDoc).set({
      items: rows,
      workCount: rows.filter(x => x.type === "work").length,
      materialCount: rows.filter(x => x.type === "material").length,
      updatedByUid: state.uid,
      updatedByEmail: state.email,
      version: VERSION,
      reason,
      updatedAt: serverTimestamp(),
      updatedAtClient: new Date().toISOString()
    }, { merge: true });

    state.lastServerHash = hash(rows);
    setStatus("ok", `серверная БД сохранена: ${rows.length} поз.`);
    log("push-server", "БД сервера сохранена в Firebase.", { count: rows.length, reason });
    return true;
  }

  async function pullMy() {
    const db = firestore();
    if (!db || !state.uid) return;

    const ref = db.collection(PATHS.userCollection).doc(state.uid);
    const snap = await ref.get();

    const local = localMy();
    const remote = snap.exists ? sortRows(extractItems(snap.data())) : [];

    if (!snap.exists || !remote.length) {
      await pushMy("first-upload");
      return;
    }

    const merged = mergeRows(local, remote);
    saveLocalMy(merged, "firebase-pull-my");

    if (hash(merged) !== hash(remote)) await pushMy("merge");
  }

  async function pullServer() {
    const db = firestore();
    if (!db) return;

    const ref = db.collection(PATHS.serverCollection).doc(PATHS.serverDoc);
    const snap = await ref.get();

    const local = localServer();
    const remote = snap.exists ? sortRows(extractItems(snap.data())) : [];

    if (!snap.exists || !remote.length) {
      if (state.admin && local.length) await pushServer("first-upload");
      return;
    }

    if (state.admin) {
      const merged = mergeRows(local, remote);
      saveLocalServer(merged, "firebase-pull-server-admin");
      if (hash(merged) !== hash(remote)) await pushServer("merge");
    } else {
      saveLocalServer(remote, "firebase-pull-server-master");
    }
  }

  async function pullMastersForAdmin() {
    const db = firestore();
    if (!db || !state.admin) return;

    const snap = await db.collection(PATHS.userCollection).limit(200).get();
    const map = {};
    snap.forEach(doc => {
      const data = doc.data() || {};
      const label = data.displayName || data.name || data.email || doc.id;
      map[label] = sortRows(extractItems(data));
    });
    saveLocalMasters(map, "firebase-admin-list");
    setStatus("ok", `БД мастеров загружены: ${Object.keys(map).length}`);
  }

  function stopListeners() {
    try { state.unsubMy?.(); } catch (e) {}
    try { state.unsubServer?.(); } catch (e) {}
    try { state.unsubMasters?.(); } catch (e) {}
    state.unsubMy = state.unsubServer = state.unsubMasters = null;
  }

  function startListeners() {
    const db = firestore();
    if (!db || !state.uid) return;

    stopListeners();

    state.unsubMy = db.collection(PATHS.userCollection).doc(state.uid).onSnapshot(snap => {
      if (!snap.exists || state.loading) return;
      const remote = sortRows(extractItems(snap.data()));
      if (hash(remote) === state.lastMyHash) return;
      const merged = mergeRows(localMy(), remote);
      saveLocalMy(merged, "snapshot-my");
      setStatus("ok", `моя БД обновлена: ${merged.length}`);
    }, err => {
      state.lastError = err.message || String(err);
      log("my-listener-error", "Ошибка слушателя моей БД.", { error: state.lastError });
      setStatus("error", "ошибка моей БД");
    });

    state.unsubServer = db.collection(PATHS.serverCollection).doc(PATHS.serverDoc).onSnapshot(snap => {
      if (!snap.exists || state.loading) return;
      const remote = sortRows(extractItems(snap.data()));
      if (hash(remote) === state.lastServerHash) return;
      if (state.admin) saveLocalServer(mergeRows(localServer(), remote), "snapshot-server-admin");
      else saveLocalServer(remote, "snapshot-server-master");
      setStatus("ok", `серверная БД обновлена: ${remote.length}`);
    }, err => {
      state.lastError = err.message || String(err);
      log("server-listener-error", "Ошибка слушателя БД сервера.", { error: state.lastError });
      setStatus("error", "ошибка БД сервера");
    });

    if (state.admin) {
      state.unsubMasters = db.collection(PATHS.userCollection).onSnapshot(snap => {
        const map = {};
        snap.forEach(doc => {
          const data = doc.data() || {};
          const label = data.displayName || data.name || data.email || doc.id;
          map[label] = sortRows(extractItems(data));
        });
        saveLocalMasters(map, "snapshot-masters");
      }, err => {
        state.lastError = err.message || String(err);
        log("masters-listener-error", "Ошибка просмотра БД мастеров.", { error: state.lastError });
      });
    }
  }

  function schedulePush(reason) {
    clearTimeout(state.pushTimer);
    state.pushTimer = setTimeout(() => pushChanges(reason), 1600);
  }

  async function pushChanges(reason = "watch") {
    if (!state.ready || state.loading || !state.uid || !hasFirebase()) return;

    try {
      const myHash = hash(localMy());
      const serverHash = hash(localServer());

      if (myHash !== state.lastMyHash) {
        setStatus("syncing", "сохраняю мою БД...");
        await pushMy(reason);
      }

      if (serverHash !== state.lastServerHash && state.admin) {
        setStatus("syncing", "сохраняю БД сервера...");
        await pushServer(reason);
      }
    } catch (e) {
      state.lastError = e.message || String(e);
      log("push-error", "Ошибка сохранения в Firebase.", { error: state.lastError });
      setStatus("error", "сохранить не удалось");
    }
  }

  function startLocalWatcher() {
    state.lastMyHash = hash(localMy());
    state.lastServerHash = hash(localServer());

    clearInterval(state.timer);
    state.timer = setInterval(() => {
      if (!state.ready || state.loading) return;

      const myHash = hash(localMy());
      const serverHash = hash(localServer());

      if (myHash !== state.lastMyHash) {
        state.lastMyHash = myHash;
        schedulePush("local-my-change");
      }

      if (serverHash !== state.lastServerHash) {
        state.lastServerHash = serverHash;
        if (state.admin) schedulePush("local-server-change");
      }
    }, 1500);
  }

  async function initialSync(user) {
    if (!user) {
      state.ready = false;
      state.uid = "";
      state.email = "";
      state.admin = false;
      stopListeners();
      setStatus("offline", "нужно войти");
      return;
    }

    state.uid = user.uid || "";
    state.email = user.email || "";
    state.name = user.displayName || (state.email ? state.email.split("@")[0] : "Мастер");
    state.admin = String(state.email).toLowerCase() === ADMIN_EMAIL.toLowerCase();

    state.loading = true;
    state.ready = false;

    try {
      setStatus("syncing", "подключение...");
      await pullServer();
      await pullMy();
      await pullMastersForAdmin();

      state.loading = false;
      state.ready = true;

      startLocalWatcher();
      startListeners();

      setStatus("ok", "подключено");
      log("ready", "Firebase-синхронизация БД готова.", { uid: state.uid, email: state.email, admin: state.admin });
    } catch (e) {
      state.loading = false;
      state.ready = false;
      state.lastError = e.message || String(e);
      log("initial-sync-error", "Первичная синхронизация не удалась.", { error: state.lastError });
      setStatus("error", state.lastError.slice(0, 90));
    }
  }

  function waitFirebase() {
    if (!hasFirebase()) {
      setStatus("offline", "Firebase SDK не найден");
      setTimeout(waitFirebase, 1200);
      return;
    }

    try {
      if (state.unsubAuth) state.unsubAuth();
      state.unsubAuth = firebase.auth().onAuthStateChanged(initialSync);
      if (firebase.auth().currentUser) initialSync(firebase.auth().currentUser);
      log("firebase-sdk", "Firebase SDK найден.");
    } catch (e) {
      state.lastError = e.message || String(e);
      setStatus("error", "Firebase auth не запустился");
      setTimeout(waitFirebase, 1500);
    }
  }

  function expose() {
    window.DBV265FirebaseSync = {
      version: VERSION,
      state,
      paths: PATHS,
      keys: { my: KEY_MY, server: KEY_SERVER, masters: KEY_MASTERS },
      syncNow: () => initialSync(firebase.auth().currentUser),
      pushNow: () => pushChanges("manual"),
      pushMy,
      pushServer,
      pullMy,
      pullServer,
      pullMastersForAdmin
    };
  }

  function boot() {
    expose();
    waitFirebase();

    setTimeout(() => {
      const saved = readJson(KEY_SYNC, null);
      if (saved) updateStatusLine(saved);
    }, 500);
  }

  window.addEventListener("DOMContentLoaded", boot);
  setTimeout(boot, 1200);
  setTimeout(boot, 3000);

  log("script-loaded", "V26.5 Firebase sync layer загружен.");
})();
