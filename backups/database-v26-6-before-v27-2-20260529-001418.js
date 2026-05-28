(() => {
  "use strict";

  if (window.__EP_DB_V266_SUB_BAL_SYNC_LOADED__) return;
  window.__EP_DB_V266_SUB_BAL_SYNC_LOADED__ = true;

  const VERSION = "V26.10";
  const FILE = "assets/js/database-v26-6-subscription-balance-sync-ui.js";
  const ADMIN_EMAIL = "vits0007@gmail.com";

  const KEYS = {
    my: "epdb26_my",
    server: "epdb26_server",
    masters: "epdb26_masters",
    log: "epdb26_log",
    sync: "epdb26_sync_state",
    access: "ep_access_v26_state",
    clear: "epdb26_clear_meta"
  };

  const state = {
    uid: "",
    email: "",
    name: "",
    isAdmin: false,
    started: false,
    ready: false,
    syncing: false,
    saving: false,
    loading: false,
    lastMyHash: "",
    lastServerHash: "",
    lastAccessHash: "",
    unsubAuth: null,
    unsubMy: null,
    unsubServer: null,
    unsubMasters: null,
    unsubAccess: [],
    pushTimer: null,
    watchTimer: null,
    lastError: "",
    access: {
      subscriptionLabel: "Проверка...",
      aiLabel: "ИИ ...",
      plan: "",
      active: false,
      daysLeft: null,
      aiEnabled: false,
      aiBalance: null,
      aiMode: "",
      source: "init"
    }
  };

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

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

  function clearMeta() {
    const meta = readJson(KEYS.clear, {});
    return meta && typeof meta === "object" ? meta : {};
  }

  function writeClearMeta(meta) {
    writeJson(KEYS.clear, meta || {});
  }

  function scopeByKey(key) {
    if (key === KEYS.my) return "my";
    if (key === KEYS.server) return "server";
    return "";
  }

  function isCleared(scope) {
    const meta = clearMeta();
    return !!(scope && meta[scope] && meta[scope].cleared);
  }

  function markCleared(scope, reason = "manual-clear") {
    if (!scope) return;
    const meta = clearMeta();
    meta[scope] = {
      cleared: true,
      clearedAt: meta[scope]?.clearedAt || new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      reason,
      version: VERSION
    };
    writeClearMeta(meta);
    log("clear-mark", `Флаг очистки БД сохранён: ${scope}`, meta[scope]);
  }

  function unmarkCleared(scope) {
    if (!scope) return;
    const meta = clearMeta();
    if (meta[scope]) {
      delete meta[scope];
      writeClearMeta(meta);
      log("clear-unmark", `Флаг очистки БД снят: ${scope}`);
    }
  }

  function remoteCleared(data) {
    if (!data || typeof data !== "object") return false;
    if (data.dbCleared === true || data.cleared === true) return true;
    const items = extractItems(data);
    const reason = norm(data.reason || data.clearReason || "");
    return Array.isArray(items) && !items.length && (reason.includes("clear") || reason.includes("очист"));
  }



  function dateMs(v) {
    try {
      if (!v) return 0;
      if (typeof v.toDate === "function") return v.toDate().getTime() || 0;
      if (typeof v.seconds === "number") return Number(v.seconds || 0) * 1000;
      if (typeof v === "number") return v > 9999999999 ? v : v * 1000;
      if (typeof v === "string") {
        const d = new Date(v);
        return isNaN(d.getTime()) ? 0 : d.getTime();
      }
    } catch (e) {}
    return 0;
  }

  function remoteUpdatedMs(data) {
    if (!data || typeof data !== "object") return 0;
    return Math.max(
      dateMs(data.updatedAtClient),
      dateMs(data.updatedAt),
      dateMs(data.createdAtClient),
      dateMs(data.createdAt)
    );
  }

  function clearMetaMs(scope) {
    try {
      const meta = clearMeta()[scope] || {};
      return dateMs(meta.clearedAt || meta.time || meta.updatedAtClient || meta.updatedAt);
    } catch (e) {
      return 0;
    }
  }

  function shouldAcceptRemoteAfterLocalClear(scope, data, remoteRows) {
    if (!isCleared(scope)) return false;
    if (!Array.isArray(remoteRows) || !remoteRows.length) return false;
    if (remoteCleared(data)) return false;

    const remoteMs = remoteUpdatedMs(data);
    const clearMs = clearMetaMs(scope);

    // Если удаление было позже серверной БД — не воскресить старую БД.
    // Если серверная БД обновлена после удаления — это новая загрузка, её надо принять на другом устройстве.
    return remoteMs > 0 && clearMs > 0 && remoteMs > clearMs;
  }

  function clearPayload(scope, rows) {
    const meta = clearMeta()[scope] || {};
    const cleared = rows.length === 0 && isCleared(scope);
    return cleared ? {
      dbCleared: true,
      clearedAtClient: meta.clearedAt || new Date().toISOString(),
      clearedByUid: state.uid || "",
      clearedByEmail: state.email || "",
      clearReason: meta.reason || "manual-clear"
    } : {
      dbCleared: false,
      clearedAtClient: null,
      clearReason: ""
    };
  }

  function hash(value) {
    try {
      const text = JSON.stringify(value ?? null);
      let h = 0;
      for (let i = 0; i < text.length; i++) h = ((h << 5) - h + text.charCodeAt(i)) | 0;
      return `${h}:${text.length}`;
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

  function uid() {
    return "db26_" + Date.now().toString(36) + "_" + Math.random().toString(16).slice(2);
  }

  function normalizeItem(raw = {}, typeHint = "") {
    const typeText = norm(typeHint || raw.type || raw.kind || raw.categoryType || "");
    const type = typeText.includes("мат") || typeText.includes("material") ? "material" : "work";
    const name = String(raw.name || raw.n || raw.title || raw.Наименование || "Позиция").trim();
    const category = String(raw.category || raw.c || raw.cat || raw.folder || raw.Папка || (type === "work" ? "Работы" : "Материалы")).trim();
    const subcategory = String(raw.subcategory || raw.sc || raw.sub || raw.g || raw.group || raw.Подпапка || "Без подкатегории").trim();
    const unit = String(raw.unit || raw.u || raw.ed || raw.Ед || "шт").trim();
    const price = Number(raw.price ?? raw.p ?? raw.cost ?? raw.Цена ?? 0) || 0;

    return {
      ...raw,
      id: String(raw.id || uid()),
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

  function signature(item) {
    return norm([item.type, item.name || item.n, item.unit || item.u].join("|"));
  }

  function mergeRows(localRows, remoteRows) {
    const map = new Map();

    sortRows(remoteRows).forEach(row => {
      map.set(signature(row) || row.id, row);
    });

    sortRows(localRows).forEach(row => {
      const sig = signature(row) || row.id;
      const old = map.get(sig);
      if (!old) {
        map.set(sig, row);
        return;
      }

      const oldTime = Date.parse(old.updatedAt || 0) || 0;
      const newTime = Date.parse(row.updatedAt || 0) || 0;
      map.set(sig, newTime >= oldTime ? { ...old, ...row } : old);
    });

    return sortRows(Array.from(map.values()));
  }

  function log(code, text, extra = {}) {
    const rows = readJson(KEYS.log, []);
    rows.push({
      time: new Date().toLocaleString("ru-RU"),
      iso: new Date().toISOString(),
      code,
      text,
      extra,
      file: FILE
    });
    writeJson(KEYS.log, rows.slice(-220));

    try {
      window.Diagnostics?.ok?.({
        file: FILE,
        module: "DBV266SubBalanceSyncUI",
        functionName: "runtime",
        place: "database-access-sync",
        code,
        message: text,
        ...extra
      });
    } catch (e) {}
  }

  function hasFirebase() {
    return !!(window.firebase && firebase.auth && firebase.firestore);
  }

  function db() {
    return hasFirebase() ? firebase.firestore() : null;
  }

  function ts() {
    try { return firebase.firestore.FieldValue.serverTimestamp(); }
    catch (e) { return new Date(); }
  }

  function firebaseDate(v) {
    if (!v) return null;
    try {
      if (typeof v.toDate === "function") return v.toDate();
      if (typeof v.seconds === "number") return new Date(v.seconds * 1000);
      if (typeof v === "number") return new Date(v > 9999999999 ? v : v * 1000);
      if (typeof v === "string") {
        const d = new Date(v);
        return isNaN(d.getTime()) ? null : d;
      }
    } catch (e) {}
    return null;
  }

  function daysLeft(date) {
    if (!date) return null;
    const ms = date.getTime() - Date.now();
    return Math.max(0, Math.ceil(ms / 86400000));
  }

  function pick(obj, paths) {
    for (const path of paths) {
      let cur = obj;
      let ok = true;
      for (const part of path.split(".")) {
        if (cur && Object.prototype.hasOwnProperty.call(cur, part)) cur = cur[part];
        else { ok = false; break; }
      }
      if (ok && cur !== undefined && cur !== null && cur !== "") return cur;
    }
    return undefined;
  }

  function parseAccess(docs = []) {
    const merged = {};
    docs.forEach(d => {
      if (d && typeof d === "object") Object.assign(merged, d);
    });

    const planRaw = String(pick(merged, [
      "plan", "planId", "tariff", "tier", "type", "subscriptionPlan",
      "subscription.plan", "subscription.planId", "subscription.tariff",
      "access.plan", "access.tier"
    ]) || "").trim();

    const statusRaw = String(pick(merged, [
      "status", "subscriptionStatus", "subscription.status", "access.status"
    ]) || "").toLowerCase();

    const activeRaw = pick(merged, [
      "active", "isActive", "subscriptionActive", "subscription.active", "access.active"
    ]);

    const expiresRaw = pick(merged, [
      "expiresAt", "validUntil", "until", "endAt", "endDate", "paidUntil",
      "subscriptionExpiresAt", "subscription.expiresAt", "subscription.validUntil",
      "access.expiresAt", "access.validUntil"
    ]);

    const expires = firebaseDate(expiresRaw);
    const days = daysLeft(expires);

    let active = false;
    if (activeRaw === true) active = true;
    if (["active", "trialing", "trial", "paid", "enabled"].includes(statusRaw)) active = true;
    if (days !== null && days > 0) active = true;

    const planNorm = norm(planRaw);
    const isTrial = statusRaw.includes("trial") || planNorm.includes("test") || planNorm.includes("тест");
    const hasAIPlan = planNorm.includes("ai") || planNorm.includes("ии") || planNorm.includes("pro") || planNorm.includes("with_ai") || planNorm.includes("с ии");
    const isBasic = planNorm.includes("basic") || planNorm.includes("баз");

    let subscriptionLabel = "Нет подписки";
    if (active) {
      let name = hasAIPlan ? "С ИИ" : isTrial ? "Тест" : isBasic ? "Базовая" : (planRaw || "Подписка");
      subscriptionLabel = days !== null ? `${name} · ${days}д` : name;
    }

    const aiMode = String(pick(merged, [
      "aiMode", "ai.mode", "aiProvider", "apiMode", "api.mode", "ai.apiMode"
    ]) || "").trim();

    const balRaw = pick(merged, [
      "aiBalance", "ai.balance", "balance", "rubBalance", "amount", "tokensBalance",
      "ai.tokensBalance", "wallet.balance", "wallet.amount"
    ]);

    const balance = balRaw === undefined ? null : Number(balRaw) || 0;
    const aiEnabledRaw = pick(merged, [
      "aiEnabled", "ai.enabled", "hasAi", "access.ai", "features.ai"
    ]);

    const userApi = norm(aiMode).includes("client") || norm(aiMode).includes("user") || norm(aiMode).includes("клиент");
    const serverApi = norm(aiMode).includes("server") || norm(aiMode).includes("admin") || norm(aiMode).includes("сервер");

    const aiEnabled = aiEnabledRaw === true || userApi || serverApi || (active && hasAIPlan);
    let aiLabel = "ИИ выкл.";

    if (aiEnabled) {
      if (userApi) aiLabel = "ИИ API";
      else if (balance !== null) aiLabel = `ИИ ${Math.round(balance)}₽`;
      else aiLabel = "ИИ вкл.";
    }

    return {
      subscriptionLabel,
      aiLabel,
      plan: planRaw,
      status: statusRaw,
      active,
      daysLeft: days,
      aiEnabled,
      aiBalance: balance,
      aiMode,
      raw: merged,
      source: "firebase/local"
    };
  }

  function localAccessFallback() {
    const keys = [
      "ep_access_v26_state",
      "ep_subscription",
      "subscription",
      "user_subscription",
      "ep_user_subscription",
      "ai_balance",
      "ep_ai_balance",
      "ep_user_profile",
      "user_profile"
    ];
    return keys.map(k => readJson(k, null)).filter(Boolean);
  }

  function setAccess(access) {
    state.access = { ...state.access, ...access };
    writeJson(KEYS.access, state.access);
    state.lastAccessHash = hash(state.access);
    updateAccessUI();
  }

  function visibleSmall(el) {
    if (!el) return false;
    const st = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return st.display !== "none" && st.visibility !== "hidden" && r.width > 10 && r.height > 8 && r.top < 180;
  }

  function setChipText(kind, text) {
    const patterns = kind === "sub"
      ? [/нет подписки/i, /подписк/i, /с ии/i, /базовая/i, /тест/i]
      : [/ии выкл/i, /^ии\b/i, /баланс/i];

    const candidates = [];
    $$("span,b,strong,em,small,div,button").forEach(el => {
      if (!visibleSmall(el)) return;
      const t = String(el.textContent || "").trim();
      if (!t || t.length > 80) return;
      if (patterns.some(rx => rx.test(t))) candidates.push(el);
    });

    const picked = candidates
      .filter(el => {
        const r = el.getBoundingClientRect();
        return r.height < 42 && r.width < 260;
      })
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];

    if (picked) {
      picked.textContent = text;
      picked.setAttribute(`data-ep266-${kind}`, "1");
      return true;
    }

    return false;
  }

  function ensureAccessBar() {
    let bar = $("#ep266-access-bar");
    if (bar) return bar;

    bar = document.createElement("div");
    bar.id = "ep266-access-bar";
    bar.innerHTML = `<span data-ep266-sub-chip></span><span data-ep266-ai-chip></span>`;

    const anchor =
      $("header") ||
      $(".app-header") ||
      $(".topbar") ||
      $(".app-top") ||
      document.body.firstElementChild;

    if (anchor && anchor.parentElement) anchor.parentElement.insertBefore(bar, anchor.nextSibling);
    else document.body.prepend(bar);

    injectCss();
    return bar;
  }


  function ensureTopAccessLine() {
    injectTopStatusLockCss();

    let line = $("#epTopStatusLine");
    const topbar = $(".topbar") || $("header");

    if (!line) {
      line = document.createElement("div");
      line.id = "epTopStatusLine";
      line.className = "ep-top-status-line";
      line.innerHTML = '<div class="ep-top-status-left">Нет подписки</div><div class="ep-top-status-right">ИИ выкл.</div>';
    } else {
      line.className = "ep-top-status-line";

      // Если старый скрипт уже превратил строку в одно большое поле,
      // восстанавливаем две маленькие плашки: подписка слева, ИИ справа.
      if (!line.querySelector(".ep-top-status-left") || !line.querySelector(".ep-top-status-right")) {
        line.innerHTML = '<div class="ep-top-status-left">Нет подписки</div><div class="ep-top-status-right">ИИ выкл.</div>';
      }
    }

    // Строка статуса должна быть строго под верхней шапкой.
    if (topbar && topbar.parentElement && topbar.nextElementSibling !== line) {
      topbar.parentElement.insertBefore(line, topbar.nextSibling);
    } else if (!line.parentElement) {
      const app = $("#appShell") || $(".app-shell") || document.body;
      app.prepend(line);
    }

    return line;
  }

  function injectTopStatusLockCss() {
    if ($("#ep269-top-status-lock-style")) return;

    const st = document.createElement("style");
    st.id = "ep269-top-status-lock-style";
    st.textContent = `
#ep266-access-bar{
  display:none!important;
  visibility:hidden!important;
  opacity:0!important;
  pointer-events:none!important;
}

#epTopStatusLine.ep-top-status-line{
  position:relative!important;
  top:auto!important;
  left:auto!important;
  right:auto!important;
  z-index:70!important;
  height:7mm!important;
  min-height:7mm!important;
  max-height:7mm!important;
  display:grid!important;
  grid-template-columns:minmax(0,1fr) auto!important;
  gap:6px!important;
  align-items:center!important;
  margin:0 8px 5px!important;
  padding:0 8px!important;
  border-radius:0 0 16px 16px!important;
  background:rgba(241,245,249,.94)!important;
  border:1px solid rgba(15,23,42,.08)!important;
  border-top:0!important;
  box-shadow:0 8px 24px rgba(15,23,42,.12)!important;
  backdrop-filter:blur(16px)!important;
  overflow:hidden!important;
}

#epTopStatusLine .ep-top-status-left,
#epTopStatusLine .ep-top-status-right{
  min-width:0!important;
  height:4.6mm!important;
  display:inline-flex!important;
  align-items:center!important;
  justify-content:center!important;
  padding:0 7px!important;
  border-radius:999px!important;
  font:950 9px/1 system-ui,-apple-system,"Segoe UI",sans-serif!important;
  white-space:nowrap!important;
  overflow:hidden!important;
  text-overflow:ellipsis!important;
  background:rgba(226,232,240,.92)!important;
}

#epTopStatusLine .ep-top-status-left{
  justify-content:flex-start!important;
}

#epTopStatusLine[data-status="pro"] .ep-top-status-left{
  background:rgba(34,197,94,.20)!important;
  color:#064e3b!important;
}

#epTopStatusLine[data-status="basic"] .ep-top-status-left{
  background:rgba(59,130,246,.17)!important;
  color:#1e3a8a!important;
}

#epTopStatusLine[data-status="trial"] .ep-top-status-left{
  background:rgba(245,158,11,.22)!important;
  color:#78350f!important;
}

#epTopStatusLine[data-status="none"] .ep-top-status-left{
  background:rgba(239,68,68,.13)!important;
  color:#7f1d1d!important;
}

#epTopStatusLine[data-ai="own_api"] .ep-top-status-right{
  background:rgba(168,85,247,.16)!important;
  color:#581c87!important;
}

#epTopStatusLine[data-ai="admin_api"] .ep-top-status-right{
  background:rgba(34,197,94,.18)!important;
  color:#064e3b!important;
}

#epTopStatusLine[data-ai="disabled"] .ep-top-status-right{
  background:rgba(239,68,68,.13)!important;
  color:#7f1d1d!important;
}

#epTopStatusLine .ep-top-status-right{
  max-width:33vw!important;
}
`;
    document.head.appendChild(st);
  }

  function accessStatusKind(a) {
    const label = String(a.subscriptionLabel || "").toLowerCase();
    if (label.includes("с ии")) return "pro";
    if (label.includes("баз")) return "basic";
    if (label.includes("тест") || label.includes("проб")) return "trial";
    return "none";
  }

  function accessAiKind(a) {
    const mode = norm(a.aiMode || "");
    const label = norm(a.aiLabel || "");

    if (mode.includes("own") || mode.includes("client") || mode.includes("клиент") || label.includes("api")) {
      return "own_api";
    }

    if (a.aiEnabled || label.includes("ии ") || label.includes("руб") || label.includes("₽")) {
      return "admin_api";
    }

    return "disabled";
  }


  function updateAccessUI() {
    const a = state.access || {};

    if (window.EPTopStatusV27 && typeof window.EPTopStatusV27.render === "function") {
      const oldFloating = document.getElementById("ep266-access-bar");
      if (oldFloating) oldFloating.remove();
      window.EPTopStatusV27.render(a);
      return;
    }

    try {
      window.EPTopStatusCompact?.apply?.(a);
    } catch (e) {}
    try {
      const bar = document.getElementById("ep266-access-bar");
      if (bar) bar.remove();
    } catch (e) {}
  }

  function syncState(status, text, extra = {}) {
    const payload = {
      version: VERSION,
      status,
      text,
      time: new Date().toLocaleString("ru-RU"),
      iso: new Date().toISOString(),
      uid: state.uid,
      email: state.email,
      isAdmin: state.isAdmin,
      saving: state.saving,
      loading: state.loading,
      error: state.lastError,
      ...extra
    };
    writeJson(KEYS.sync, payload);
    updateDbSyncUI(payload);
  }

  function updateDbSyncUI(payload = readJson(KEYS.sync, {})) {
    const root = $("#ep-db-v26");
    if (!root || root.classList.contains("hidden")) return;

    let line = $("#ep266-db-sync-line", root);
    if (!line) {
      line = document.createElement("div");
      line.id = "ep266-db-sync-line";
      const head = $(".db26h", root);
      if (head && head.parentElement) head.parentElement.insertBefore(line, head.nextSibling);
      else root.prepend(line);
    }

    const icon = payload.status === "ok" ? "✅" :
      payload.status === "syncing" ? "🔄" :
      payload.status === "saving" ? "⬆️" :
      payload.status === "loading" ? "⬇️" :
      payload.status === "offline" ? "⚠️" : "❌";

    line.innerHTML = `
      <b>${icon} Firebase:</b>
      <span>${escapeHtml(payload.text || "ожидание")}</span>
      <em>${escapeHtml(payload.time || "")}</em>
    `;

    const st = $(".db26status", root);
    if (st) {
      st.setAttribute("data-ep266-last-status", payload.status || "");
      st.textContent = `${payload.status === "ok" ? "✅" : "🔄"} Локально: готово · Firebase: ${payload.text || "ожидание"}`;
    }
  }

  function escapeHtml(v) {
    return String(v ?? "").replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    }[c]));
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

  function localMy() { return sortRows(readJson(KEYS.my, [])); }
  function localServer() { return sortRows(readJson(KEYS.server, [])); }

  function writeLocal(key, rows, source) {
    const fixed = sortRows(rows);
    writeJson(key, fixed);
    localStorage.setItem("epdb26_save", new Date().toISOString());
    log("local-write", "БД записана локально.", { key, source, count: fixed.length });
    return fixed;
  }

  async function saveMy(reason = "change") {
    const firestore = db();
    if (!firestore || !state.uid) return false;

    state.saving = true;
    syncState("saving", "выгружаю мою БД...");
    const rows = localMy();
    if (rows.length === 0 && (isCleared("my") || norm(reason).includes("clear") || norm(reason).includes("очист"))) markCleared("my", reason);
    if (rows.length > 0) unmarkCleared("my");
    const clearInfo = clearPayload("my", rows);

    await firestore.collection("user_db").doc(state.uid).set({
      ...clearInfo,
      uid: state.uid,
      email: state.email,
      displayName: state.name,
      role: state.isAdmin ? "admin" : "master",
      items: rows,
      workCount: rows.filter(x => x.type === "work").length,
      materialCount: rows.filter(x => x.type === "material").length,
      version: VERSION,
      reason,
      updatedAt: ts(),
      updatedAtClient: new Date().toISOString()
    }, { merge: true });

    state.lastMyHash = hash(rows);
    state.saving = false;
    syncState("ok", `моя БД выгружена: ${rows.length}`);
    log("push-my", "Моя БД сохранена в Firebase.", { count: rows.length, reason });
    return true;
  }

  async function saveServer(reason = "change") {
    const firestore = db();
    if (!firestore || !state.uid || !state.isAdmin) return false;

    state.saving = true;
    syncState("saving", "выгружаю БД сервера...");
    const rows = localServer();
    if (rows.length === 0 && (isCleared("server") || norm(reason).includes("clear") || norm(reason).includes("очист"))) markCleared("server", reason);
    if (rows.length > 0) unmarkCleared("server");
    const clearInfo = clearPayload("server", rows);

    await firestore.collection("server_db").doc("main").set({
      ...clearInfo,
      items: rows,
      workCount: rows.filter(x => x.type === "work").length,
      materialCount: rows.filter(x => x.type === "material").length,
      version: VERSION,
      reason,
      updatedByUid: state.uid,
      updatedByEmail: state.email,
      updatedAt: ts(),
      updatedAtClient: new Date().toISOString()
    }, { merge: true });

    state.lastServerHash = hash(rows);
    state.saving = false;
    syncState("ok", `БД сервера выгружена: ${rows.length}`);
    log("push-server", "БД сервера сохранена в Firebase.", { count: rows.length, reason });
    return true;
  }

  async function pullMy() {
    const firestore = db();
    if (!firestore || !state.uid) return;

    state.loading = true;
    syncState("loading", "загружаю мою БД...");
    const ref = firestore.collection("user_db").doc(state.uid);
    const snap = await ref.get();
    const data = snap.exists ? (snap.data() || {}) : {};

    const local = localMy();
    const remote = snap.exists ? sortRows(extractItems(data)) : [];

    if (shouldAcceptRemoteAfterLocalClear("my", data, remote)) {
      unmarkCleared("my");
      log("remote-after-clear-my", "Принята новая Моя БД с сервера после локальной очистки.", { remoteCount: remote.length });
    }

    if (isCleared("my")) {
      writeLocal(KEYS.my, [], "local-clear-wins-my");
      state.lastMyHash = hash([]);
      await saveMy("hard-clear-my");
      state.loading = false;
      syncState("ok", "моя БД очищена и закреплена на сервере");
      return;
    }

    if (remoteCleared(data)) {
      markCleared("my", "remote-clear-my");
      writeLocal(KEYS.my, [], "remote-clear-my");
      state.lastMyHash = hash([]);
      state.loading = false;
      syncState("ok", "моя БД пустая");
      return;
    }

    if (!snap.exists || !remote.length) {
      if (local.length) await saveMy("first-upload-local-my");
      else await ref.set({
        uid: state.uid,
        email: state.email,
        displayName: state.name,
        role: state.isAdmin ? "admin" : "master",
        items: [],
        dbCleared: false,
        version: VERSION,
        updatedAt: ts(),
        updatedAtClient: new Date().toISOString()
      }, { merge: true });
      state.lastMyHash = hash(local);
      state.loading = false;
      syncState("ok", local.length ? `моя БД создана на сервере: ${local.length}` : "моя БД создана пустой");
      return;
    }

    const merged = mergeRows(local, remote);
    writeLocal(KEYS.my, merged, "firebase-my");
    state.lastMyHash = hash(merged);

    if (hash(merged) !== hash(remote)) await saveMy("merge-my");
    state.loading = false;
    syncState("ok", `моя БД загружена: ${merged.length}`);
  }

  async function pullServer() {
    const firestore = db();
    if (!firestore) return;

    state.loading = true;
    syncState("loading", "загружаю БД сервера...");
    const ref = firestore.collection("server_db").doc("main");
    const snap = await ref.get();
    const data = snap.exists ? (snap.data() || {}) : {};

    const local = localServer();
    const remote = snap.exists ? sortRows(extractItems(data)) : [];

    if (shouldAcceptRemoteAfterLocalClear("server", data, remote)) {
      unmarkCleared("server");
      log("remote-after-clear-server", "Принята новая БД сервера после локальной очистки.", { remoteCount: remote.length });
    }

    if (isCleared("server")) {
      writeLocal(KEYS.server, [], "local-clear-wins-server");
      state.lastServerHash = hash([]);
      if (state.isAdmin) await saveServer("hard-clear-server");
      state.loading = false;
      syncState("ok", state.isAdmin ? "БД сервера очищена и закреплена" : "БД сервера очищена локально");
      return;
    }

    if (remoteCleared(data)) {
      markCleared("server", "remote-clear-server");
      writeLocal(KEYS.server, [], "remote-clear-server");
      state.lastServerHash = hash([]);
      state.loading = false;
      syncState("ok", "БД сервера пустая");
      return;
    }

    if (!snap.exists || !remote.length) {
      if (state.isAdmin && local.length) await saveServer("first-upload-local-server");
      state.lastServerHash = hash(local);
      state.loading = false;
      syncState("ok", local.length ? `серверная БД локально: ${local.length}` : "серверная БД пустая");
      return;
    }

    const merged = state.isAdmin ? mergeRows(local, remote) : remote;
    writeLocal(KEYS.server, merged, "firebase-server");
    state.lastServerHash = hash(merged);

    if (state.isAdmin && hash(merged) !== hash(remote)) await saveServer("merge-server");
    state.loading = false;
    syncState("ok", `БД сервера загружена: ${merged.length}`);
  }

  async function pullMasters() {
    const firestore = db();
    if (!firestore || !state.isAdmin) return;

    try {
      syncState("loading", "загружаю БД мастеров...");
      const snap = await firestore.collection("user_db").limit(300).get();
      const map = {};
      snap.forEach(doc => {
        const d = doc.data() || {};
        const label = d.displayName || d.email || doc.id;
        map[label] = sortRows(extractItems(d));
      });
      writeJson(KEYS.masters, map);
      syncState("ok", `БД мастеров загружены: ${Object.keys(map).length}`);
      log("masters-loaded", "БД мастеров загружены.", { count: Object.keys(map).length });
    } catch (e) {
      state.lastError = e.message || String(e);
      syncState("error", "БД мастеров: нет доступа");
      log("masters-error", "Ошибка загрузки БД мастеров.", { error: state.lastError });
    }
  }

  function stopSnapshots() {
    try { state.unsubMy?.(); } catch (e) {}
    try { state.unsubServer?.(); } catch (e) {}
    try { state.unsubMasters?.(); } catch (e) {}
    state.unsubMy = state.unsubServer = state.unsubMasters = null;
  }

  function startSnapshots() {
    const firestore = db();
    if (!firestore || !state.uid) return;

    stopSnapshots();

    state.unsubMy = firestore.collection("user_db").doc(state.uid).onSnapshot(snap => {
      if (!snap.exists || state.loading || state.saving) return;
      const data = snap.data() || {};
      const remote = sortRows(extractItems(data));
      if (shouldAcceptRemoteAfterLocalClear("my", data, remote)) {
        unmarkCleared("my");
        log("snapshot-remote-after-clear-my", "Snapshot: принята новая Моя БД после локальной очистки.", { remoteCount: remote.length });
      } else if (isCleared("my")) {
        if (remote.length) saveMy("snapshot-hard-clear-my");
        return;
      }
      if (remoteCleared(data)) {
        markCleared("my", "snapshot-remote-clear-my");
        writeLocal(KEYS.my, [], "snapshot-remote-clear-my");
        state.lastMyHash = hash([]);
        syncState("ok", "моя БД пустая");
        return;
      }
      if (hash(remote) === state.lastMyHash) return;
      const merged = mergeRows(localMy(), remote);
      writeLocal(KEYS.my, merged, "snapshot-my");
      state.lastMyHash = hash(merged);
      syncState("ok", `моя БД обновлена: ${merged.length}`);
    }, e => {
      state.lastError = e.message || String(e);
      syncState("error", "моя БД: нет доступа");
      log("snapshot-my-error", "Ошибка snapshot моей БД.", { error: state.lastError });
    });

    state.unsubServer = firestore.collection("server_db").doc("main").onSnapshot(snap => {
      if (!snap.exists || state.loading || state.saving) return;
      const data = snap.data() || {};
      const remote = sortRows(extractItems(data));
      if (shouldAcceptRemoteAfterLocalClear("server", data, remote)) {
        unmarkCleared("server");
        log("snapshot-remote-after-clear-server", "Snapshot: принята новая БД сервера после локальной очистки.", { remoteCount: remote.length });
      } else if (isCleared("server")) {
        if (state.isAdmin && remote.length) saveServer("snapshot-hard-clear-server");
        return;
      }
      if (remoteCleared(data)) {
        markCleared("server", "snapshot-remote-clear-server");
        writeLocal(KEYS.server, [], "snapshot-remote-clear-server");
        state.lastServerHash = hash([]);
        syncState("ok", "БД сервера пустая");
        return;
      }
      if (hash(remote) === state.lastServerHash) return;
      const rows = state.isAdmin ? mergeRows(localServer(), remote) : remote;
      writeLocal(KEYS.server, rows, "snapshot-server");
      state.lastServerHash = hash(rows);
      syncState("ok", `серверная БД обновлена: ${rows.length}`);
    }, e => {
      state.lastError = e.message || String(e);
      syncState("error", "БД сервера: нет доступа");
      log("snapshot-server-error", "Ошибка snapshot БД сервера.", { error: state.lastError });
    });
  }

  function debouncePush(reason) {
    clearTimeout(state.pushTimer);
    state.pushTimer = setTimeout(() => pushChanged(reason), 2200);
  }

  async function pushChanged(reason = "watch") {
    if (!state.ready || state.loading || state.saving || !state.uid) return;

    try {
      const my = localMy();
      const server = localServer();
      const myHash = hash(my);
      const serverHash = hash(server);

      let did = false;
      if (myHash !== state.lastMyHash) {
        await saveMy(reason + "-my");
        did = true;
      }
      if (state.isAdmin && serverHash !== state.lastServerHash) {
        await saveServer(reason + "-server");
        did = true;
      }
      if (!did) syncState("ok", "данные синхронизированы");
    } catch (e) {
      state.saving = false;
      state.lastError = e.message || String(e);
      syncState("error", "выгрузка не удалась");
      log("push-error", "Ошибка выгрузки БД.", { error: state.lastError });
    }
  }

  function startLocalWatch() {
    clearInterval(state.watchTimer);

    state.lastMyHash = hash(localMy());
    state.lastServerHash = hash(localServer());

    state.watchTimer = setInterval(() => {
      if (!state.ready || state.loading || state.saving) return;

      const myHash = hash(localMy());
      const srvHash = hash(localServer());

      if (myHash !== state.lastMyHash) {
        syncState("saving", "обнаружены изменения моей БД...");
        debouncePush("local-change");
      }

      if (state.isAdmin && srvHash !== state.lastServerHash) {
        syncState("saving", "обнаружены изменения БД сервера...");
        debouncePush("local-change");
      }
    }, 2500);
  }

  async function loadAccessDocs() {
    const firestore = db();
    if (!firestore || !state.uid) {
      setAccess(parseAccess(localAccessFallback()));
      return;
    }

    const refs = [
      firestore.collection("users").doc(state.uid),
      firestore.collection("user_subscriptions").doc(state.uid),
      firestore.collection("subscriptions").doc(state.uid),
      firestore.collection("ai_balances").doc(state.uid),
      firestore.collection("ai_wallets").doc(state.uid),
      firestore.collection("token_balances").doc(state.uid)
    ];

    const docs = [];
    for (const ref of refs) {
      try {
        const snap = await ref.get();
        if (snap.exists) docs.push(snap.data());
      } catch (e) {
        log("access-doc-error", "Не удалось прочитать документ подписки/баланса.", { path: ref.path, error: e.message || String(e) });
      }
    }

    docs.push(...localAccessFallback());
    setAccess(parseAccess(docs));
  }

  function startAccessSnapshots() {
    const firestore = db();
    if (!firestore || !state.uid) return;

    state.unsubAccess.forEach(fn => { try { fn(); } catch (e) {} });
    state.unsubAccess = [];

    const paths = [
      ["users", state.uid],
      ["user_subscriptions", state.uid],
      ["subscriptions", state.uid],
      ["ai_balances", state.uid],
      ["ai_wallets", state.uid],
      ["token_balances", state.uid]
    ];

    paths.forEach(([col, doc]) => {
      try {
        const unsub = firestore.collection(col).doc(doc).onSnapshot(() => {
          loadAccessDocs();
        }, e => {
          log("access-snapshot-error", "Нет доступа к подписке/балансу.", { path: `${col}/${doc}`, error: e.message || String(e) });
        });
        state.unsubAccess.push(unsub);
      } catch (e) {}
    });
  }

  async function initialSync(user) {
    if (!user) {
      state.uid = "";
      state.email = "";
      state.name = "";
      state.isAdmin = false;
      state.ready = false;
      stopSnapshots();
      syncState("offline", "нужно войти");
      setAccess(parseAccess(localAccessFallback()));
      return;
    }

    state.uid = user.uid || "";
    state.email = user.email || "";
    state.name = user.displayName || (state.email ? state.email.split("@")[0] : "");
    state.isAdmin = String(state.email).toLowerCase() === ADMIN_EMAIL.toLowerCase();

    if (state.syncing) return;
    state.syncing = true;
    state.loading = true;

    try {
      syncState("syncing", "подключаю Firebase...");
      await loadAccessDocs();
      await pullServer();
      await pullMy();
      await pullMasters();

      state.ready = true;
      state.loading = false;
      state.syncing = false;

      startSnapshots();
      startAccessSnapshots();
      startLocalWatch();

      syncState("ok", "Firebase подключен");
      log("sync-ready", "V26.6 синхронизация готова.", { email: state.email, admin: state.isAdmin });
    } catch (e) {
      state.ready = false;
      state.loading = false;
      state.syncing = false;
      state.lastError = e.message || String(e);
      syncState("error", "Firebase: " + state.lastError.slice(0, 70));
      log("initial-sync-error", "Первичная синхронизация не удалась.", { error: state.lastError });
    }
  }

  function injectCss() {
    if ($("#ep266-style")) return;
    const st = document.createElement("style");
    st.id = "ep266-style";
    st.textContent = `
#ep266-access-bar.hidden{display:none!important}
#ep266-access-bar{
  position:fixed!important;
  top:72px!important;
  left:28px!important;
  right:28px!important;
  z-index:2147482500!important;
  display:grid!important;
  grid-template-columns:1fr auto!important;
  gap:8px!important;
  pointer-events:none!important;
}
#ep266-access-bar span{
  min-height:30px!important;
  display:grid!important;
  place-items:center!important;
  padding:4px 12px!important;
  border-radius:999px!important;
  font:900 13px/1.1 system-ui,-apple-system,"Segoe UI",sans-serif!important;
  white-space:nowrap!important;
}
#ep266-access-bar [data-ep266-sub-chip]{background:rgba(254,226,226,.96)!important;color:#991b1b!important}
#ep266-access-bar [data-ep266-ai-chip]{background:rgba(220,252,231,.96)!important;color:#14532d!important;min-width:86px!important}

#ep266-db-sync-line{
  max-width:960px!important;
  min-height:34px!important;
  margin:0 auto 8px!important;
  padding:7px 12px!important;
  display:grid!important;
  grid-template-columns:auto 1fr auto!important;
  gap:8px!important;
  align-items:center!important;
  border-radius:999px!important;
  background:rgba(219,234,254,.96)!important;
  color:#1e3a8a!important;
  font:850 12px/1.2 system-ui,-apple-system,"Segoe UI",sans-serif!important;
  box-shadow:0 8px 20px rgba(0,0,0,.12)!important;
  overflow:hidden!important;
}
#ep266-db-sync-line span{
  overflow:hidden!important;
  text-overflow:ellipsis!important;
  white-space:nowrap!important;
}
#ep266-db-sync-line em{
  color:#64748b!important;
  font-style:normal!important;
  font-size:11px!important;
  white-space:nowrap!important;
}
[data-ep266-sub="1"],[data-ep266-ai="1"]{
  opacity:1!important;
  visibility:visible!important;
}
@media(max-width:720px){
  #ep266-access-bar{top:70px!important;left:28px!important;right:28px!important}
  #ep266-db-sync-line{grid-template-columns:auto 1fr!important}
  #ep266-db-sync-line em{display:none!important}
}`;
    document.head.appendChild(st);
  }

  function patchOpenStatus() {
    if (window.__ep266DbOpenPatched) return;
    window.__ep266DbOpenPatched = true;

    const api = window.DatabaseV26SurgicalMonolith;
    if (!api || typeof api.open !== "function") {
      window.__ep266DbOpenPatched = false;
      return;
    }

    const oldOpen = api.open;
    api.open = function(...args) {
      const out = oldOpen.apply(this, args);
      setTimeout(() => updateDbSyncUI(), 120);
      return out;
    };
  }

  function startAuth() {
    if (!hasFirebase()) {
      syncState("offline", "Firebase SDK не найден");
      setAccess(parseAccess(localAccessFallback()));
      setTimeout(startAuth, 1200);
      return;
    }

    try {
      if (state.unsubAuth) return;

      state.unsubAuth = firebase.auth().onAuthStateChanged(user => {
        initialSync(user);
      });

      if (firebase.auth().currentUser) initialSync(firebase.auth().currentUser);

      log("firebase-sdk", "Firebase SDK найден, auth listener подключён.");
    } catch (e) {
      state.lastError = e.message || String(e);
      syncState("error", "Firebase auth ошибка");
      log("firebase-auth-error", "Ошибка запуска Firebase auth.", { error: state.lastError });
    }
  }

  function boot() {
    injectCss();
    updateAccessUI();
    updateDbSyncUI();
    patchOpenStatus();
    startAuth();
  }

  function observe() {
    if (window.__ep266Observer) return;
    const obs = new MutationObserver(() => {
      clearTimeout(window.__ep266Timer);
      window.__ep266Timer = setTimeout(() => {
        updateAccessUI();
        updateDbSyncUI();
        patchOpenStatus();
      }, 120);
    });
    obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style"] });
    window.__ep266Observer = obs;
  }

  window.DBV266SubBalanceSyncUI = {
    version: VERSION,
    state,
    syncNow: () => hasFirebase() ? initialSync(firebase.auth().currentUser) : null,
    pushNow: () => pushChanged("manual"),
    saveMy,
    saveServer,
    pullMy,
    pullServer,
    pullMasters,
    loadAccessDocs,
    updateAccessUI,
    updateDbSyncUI,
    markCleared,
    unmarkCleared,
    isCleared,
    keys: KEYS
  };

  window.addEventListener("epdb26:changed", ev => {
    const d = ev.detail || {};
    if (d.cleared) markCleared(d.base, "ui-clear-event");
    else if (d.count > 0) unmarkCleared(d.base);
    if (state.ready && !state.loading && !state.saving) debouncePush(d.cleared ? "ui-clear" : "ui-change");
  });

  window.addEventListener("DOMContentLoaded", () => {
    boot();
    observe();
    [300, 900, 1800, 3500].forEach(ms => setTimeout(boot, ms));
  });

  log("script-loaded", "V26.10 синхронизация БД/подписки/баланса загружена.");
})();
