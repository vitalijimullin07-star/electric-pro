(() => {
  "use strict";

  if (window.__EP_ADMIN_V267_SUB_RESTORE__) return;
  window.__EP_ADMIN_V267_SUB_RESTORE__ = true;

  const VERSION = "V26.7";
  const FILE = "assets/js/admin-v26-7-subscription-panel-restore.js";
  const ADMIN_EMAIL = "vits0007@gmail.com";

  const state = {
    uid: "",
    email: "",
    isAdmin: false,
    users: [],
    selectedUid: "",
    selectedUser: null,
    currentSub: {},
    currentAi: {},
    lastError: "",
    loading: false
  };

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  function log(code, text, extra = {}) {
    try {
      const key = "ep_admin_v267_log";
      const arr = JSON.parse(localStorage.getItem(key) || "[]");
      arr.push({ time: new Date().toLocaleString("ru-RU"), iso: new Date().toISOString(), code, text, extra, file: FILE });
      localStorage.setItem(key, JSON.stringify(arr.slice(-150)));
    } catch (e) {}

    try {
      window.Diagnostics?.ok?.({
        file: FILE,
        module: "AdminV267SubscriptionRestore",
        functionName: "runtime",
        place: "admin-subscription",
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

  function escapeHtml(v) {
    return String(v ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" }[c]));
  }

  function addDays(days) {
    return new Date(Date.now() + Number(days || 0) * 86400000);
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
    return Math.max(0, Math.ceil((date.getTime() - Date.now()) / 86400000));
  }

  function currentUser() {
    try { return firebase.auth().currentUser; } catch (e) { return null; }
  }

  function setAdminState(user) {
    state.uid = user?.uid || "";
    state.email = user?.email || "";
    state.isAdmin = String(state.email).toLowerCase() === ADMIN_EMAIL.toLowerCase();
  }

  function injectCss() {
    if ($("#admin-v267-style")) return;

    const st = document.createElement("style");
    st.id = "admin-v267-style";
    st.textContent = `
#admin-v267-panel{
  margin:14px 0!important;
  padding:14px!important;
  border-radius:24px!important;
  background:rgba(248,250,252,.96)!important;
  color:#0f172a!important;
  box-shadow:0 18px 44px rgba(0,0,0,.22)!important;
  font-family:system-ui,-apple-system,"Segoe UI",sans-serif!important;
}
#admin-v267-panel h3{
  margin:0 0 8px!important;
  color:#0f172a!important;
  font-size:20px!important;
  line-height:1.15!important;
  font-weight:950!important;
}
#admin-v267-panel p{
  margin:6px 0 10px!important;
  color:#64748b!important;
  font-size:13px!important;
  line-height:1.35!important;
  font-weight:750!important;
}
.admin267-grid{
  display:grid!important;
  gap:10px!important;
}
.admin267-row{
  display:grid!important;
  grid-template-columns:1fr!important;
  gap:8px!important;
}
.admin267-row.two{
  grid-template-columns:1fr 1fr!important;
}
.admin267-row.three{
  grid-template-columns:repeat(3,1fr)!important;
}
.admin267-label{
  display:grid!important;
  gap:5px!important;
  color:#64748b!important;
  font-size:12px!important;
  font-weight:900!important;
}
#admin-v267-panel select,
#admin-v267-panel input{
  width:100%!important;
  min-height:48px!important;
  border:1px solid rgba(15,23,42,.15)!important;
  border-radius:16px!important;
  background:#fff!important;
  color:#0f172a!important;
  padding:0 12px!important;
  font-size:15px!important;
  font-weight:850!important;
}
#admin-v267-panel button{
  min-height:48px!important;
  border:1px solid rgba(15,23,42,.10)!important;
  border-radius:16px!important;
  background:#eef2f7!important;
  color:#334155!important;
  font-size:14px!important;
  font-weight:950!important;
}
#admin-v267-panel button.green{
  background:linear-gradient(135deg,rgba(34,197,94,.28),rgba(20,184,166,.22))!important;
  color:#064e3b!important;
  border-color:rgba(34,197,94,.45)!important;
}
#admin-v267-panel button.red{
  background:rgba(239,68,68,.12)!important;
  color:#991b1b!important;
}
#admin-v267-panel .pill{
  display:inline-grid!important;
  place-items:center!important;
  min-height:28px!important;
  padding:3px 10px!important;
  border-radius:999px!important;
  background:rgba(34,197,94,.16)!important;
  color:#14532d!important;
  font-size:12px!important;
  font-weight:950!important;
  margin:2px 4px 2px 0!important;
}
#admin-v267-status{
  margin-top:10px!important;
  padding:10px 12px!important;
  border-radius:18px!important;
  background:rgba(219,234,254,.92)!important;
  color:#1e3a8a!important;
  font-size:13px!important;
  line-height:1.35!important;
  font-weight:850!important;
}
#admin-v267-status.err{
  background:rgba(254,226,226,.92)!important;
  color:#991b1b!important;
}
@media(max-width:720px){
  .admin267-row.two,.admin267-row.three{grid-template-columns:1fr!important}
}`;
    document.head.appendChild(st);
  }

  function findAdminSubscriptionBlock() {
    const textNodes = [];
    $$("h1,h2,h3,h4,div,section,article").forEach(el => {
      const t = String(el.textContent || "").trim().toLowerCase();
      if (t.includes("управление подпиской") || t.includes("тариф, срок") || t.includes("api клиента")) {
        const r = el.getBoundingClientRect();
        if (r.width > 100 && r.height > 40) textNodes.push(el);
      }
    });

    if (!textNodes.length) return null;

    let el = textNodes[0];
    for (let i = 0; i < 6 && el.parentElement; i++) {
      const t = String(el.parentElement.textContent || "").toLowerCase();
      const r = el.parentElement.getBoundingClientRect();
      if (t.includes("управление подпиской") && r.width > 250 && r.height > 120) el = el.parentElement;
      else break;
    }
    return el;
  }

  function status(text, isError = false) {
    const box = $("#admin-v267-status");
    if (box) {
      box.classList.toggle("err", !!isError);
      box.textContent = text;
    }
    log(isError ? "status-error" : "status", text);
  }

  function renderPanel(target) {
    injectCss();

    let panel = $("#admin-v267-panel");
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "admin-v267-panel";
    }

    panel.innerHTML = `
      <h3>Управление подпиской</h3>
      <p>Восстановленный блок V26.7: тариф, срок, режим ИИ и баланс. Данные пишутся в Firestore.</p>

      <div class="admin267-grid">
        <label class="admin267-label">
          Мастер
          <select id="admin267-user"></select>
        </label>

        <div id="admin267-current">
          <span class="pill">Тариф: —</span>
          <span class="pill">Осталось: —</span>
          <span class="pill">ИИ: —</span>
          <span class="pill">Баланс: —</span>
        </div>

        <div class="admin267-row three">
          <button data-admin267-plan="basic">Базовая</button>
          <button data-admin267-plan="with_ai" class="green">С ИИ</button>
          <button data-admin267-plan="trial">Тест 2 дня</button>
        </div>

        <div class="admin267-row">
          <label class="admin267-label">
            Срок подписки
            <select id="admin267-days">
              <option value="2">2 дня</option>
              <option value="30" selected>30 дней</option>
              <option value="90">90 дней</option>
              <option value="180">180 дней</option>
              <option value="360">360 дней</option>
            </select>
          </label>
          <button class="green" id="admin267-save-days">Сохранить выбранный тариф и срок</button>
        </div>

        <div class="admin267-row two">
          <label class="admin267-label">
            Режим ИИ
            <select id="admin267-ai-mode">
              <option value="server_api">API сервера / баланс</option>
              <option value="client_api">API клиента</option>
              <option value="disabled">ИИ выключен</option>
            </select>
          </label>
          <label class="admin267-label">
            Баланс ИИ, ₽
            <input id="admin267-ai-balance" type="number" step="1" value="0">
          </label>
        </div>

        <div class="admin267-row two">
          <button class="green" id="admin267-save-ai">Сохранить ИИ режим и баланс</button>
          <button id="admin267-refresh">Обновить</button>
        </div>

        <div class="admin267-row two">
          <button id="admin267-create-demo">Создать/обновить мой тест</button>
          <button class="red" id="admin267-disable">Отключить подписку</button>
        </div>

        <div id="admin-v267-status">Ожидание Firebase...</div>
      </div>
    `;

    if (target) {
      target.innerHTML = "";
      target.appendChild(panel);
    } else {
      document.body.appendChild(panel);
    }

    bindPanel();
    renderUsers();
  }

  function bindPanel() {
    $("#admin267-user")?.addEventListener("change", e => {
      state.selectedUid = e.target.value;
      state.selectedUser = state.users.find(u => u.uid === state.selectedUid) || null;
      loadSelectedAccess();
    });

    $$("[data-admin267-plan]").forEach(btn => {
      btn.addEventListener("click", () => {
        const plan = btn.getAttribute("data-admin267-plan");
        if (plan === "trial") $("#admin267-days").value = "2";
        saveSubscription(plan, Number($("#admin267-days")?.value || (plan === "trial" ? 2 : 30)));
      });
    });

    $("#admin267-save-days")?.addEventListener("click", () => {
      const plan = state.currentSub.plan || "basic";
      saveSubscription(plan, Number($("#admin267-days")?.value || 30));
    });

    $("#admin267-save-ai")?.addEventListener("click", () => {
      saveAi();
    });

    $("#admin267-refresh")?.addEventListener("click", () => {
      loadUsers(true);
    });

    $("#admin267-create-demo")?.addEventListener("click", () => {
      const uid = state.selectedUid || state.uid;
      const user = state.users.find(u => u.uid === uid) || { uid, email: state.email, displayName: "Админ" };
      state.selectedUid = uid;
      state.selectedUser = user;
      saveSubscription("with_ai", 30).then(() => saveAi());
    });

    $("#admin267-disable")?.addEventListener("click", () => {
      saveSubscription("none", 0);
    });
  }

  function userLabel(u) {
    return [u.displayName || u.name || "", u.email || "", u.uid || ""].filter(Boolean).join(" · ");
  }

  function renderUsers() {
    const sel = $("#admin267-user");
    if (!sel) return;

    const value = state.selectedUid || state.uid;
    const users = state.users.length ? state.users : [{ uid: state.uid, email: state.email, displayName: "Админ" }];

    sel.innerHTML = users.map(u => `<option value="${escapeHtml(u.uid)}">${escapeHtml(userLabel(u))}</option>`).join("");
    sel.value = value;
    state.selectedUid = sel.value;
    state.selectedUser = users.find(u => u.uid === state.selectedUid) || users[0];
  }

  async function collectUsersFrom(col) {
    const firestore = db();
    const out = [];
    try {
      const snap = await firestore.collection(col).limit(300).get();
      snap.forEach(doc => {
        const d = doc.data() || {};
        out.push({
          uid: d.uid || doc.id,
          email: d.email || "",
          displayName: d.displayName || d.name || d.masterName || "",
          source: col
        });
      });
      log("users-loaded", "Пользователи прочитаны.", { collection: col, count: out.length });
    } catch (e) {
      log("users-denied", "Не удалось прочитать пользователей.", { collection: col, error: e.message || String(e) });
    }
    return out;
  }

  async function loadUsers(force = false) {
    if (!hasFirebase()) {
      status("Firebase SDK не найден.", true);
      return;
    }

    const user = currentUser();
    setAdminState(user);

    if (!state.isAdmin) {
      status("Этот блок доступен только админу.", true);
      return;
    }

    if (state.loading && !force) return;
    state.loading = true;
    status("Загружаю список мастеров...");

    const all = [
      { uid: state.uid, email: state.email, displayName: "Виталий Имуллин", source: "auth" }
    ];

    for (const col of ["users", "user_db", "masters", "app_users", "user_profiles"]) {
      const rows = await collectUsersFrom(col);
      all.push(...rows);
    }

    const map = new Map();
    all.forEach(u => {
      if (!u.uid) return;
      const old = map.get(u.uid) || {};
      map.set(u.uid, { ...old, ...u });
    });

    state.users = Array.from(map.values())
      .sort((a, b) => String(a.displayName || a.email || a.uid).localeCompare(String(b.displayName || b.email || b.uid), "ru"));

    if (!state.selectedUid || !state.users.some(u => u.uid === state.selectedUid)) {
      state.selectedUid = state.uid;
    }

    renderUsers();
    state.loading = false;
    await loadSelectedAccess();
    status(`Мастеров загружено: ${state.users.length}`);
  }

  async function getDoc(col, uid) {
    try {
      const snap = await db().collection(col).doc(uid).get();
      return snap.exists ? snap.data() : {};
    } catch (e) {
      log("doc-read-denied", "Не удалось прочитать документ.", { col, uid, error: e.message || String(e) });
      return {};
    }
  }

  async function loadSelectedAccess() {
    const uid = state.selectedUid;
    if (!uid || !hasFirebase()) return;

    status("Читаю подписку и баланс...");

    const subDocs = [];
    for (const col of ["user_subscriptions", "subscriptions", "access", "user_access", "access_control", "users"]) {
      const d = await getDoc(col, uid);
      if (Object.keys(d).length) subDocs.push({ ...d, __col: col });
    }

    const aiDocs = [];
    for (const col of ["ai_balances", "ai_wallets", "token_balances", "wallets", "user_ai_balances"]) {
      const d = await getDoc(col, uid);
      if (Object.keys(d).length) aiDocs.push({ ...d, __col: col });
    }

    state.currentSub = mergeObjects(subDocs);
    state.currentAi = mergeObjects(aiDocs);

    updateCurrentInfo();
    status("Данные мастера загружены.");
  }

  function mergeObjects(list) {
    return Object.assign({}, ...list.filter(Boolean));
  }

  function getExpire(d) {
    return firebaseDate(d.expiresAt || d.validUntil || d.paidUntil || d.endAt || d.subscriptionExpiresAt);
  }

  function updateCurrentInfo() {
    const box = $("#admin267-current");
    if (!box) return;

    const sub = state.currentSub || {};
    const ai = state.currentAi || {};
    const exp = getExpire(sub);
    const left = daysLeft(exp);

    const plan = sub.plan || sub.planId || sub.tariff || sub.type || "—";
    const status = sub.status || (sub.active ? "active" : "—");
    const mode = ai.aiMode || ai.mode || sub.aiMode || "—";
    const balance = Number(ai.aiBalance ?? ai.balance ?? ai.amount ?? ai.rubBalance ?? 0) || 0;

    box.innerHTML = `
      <span class="pill">Тариф: ${escapeHtml(plan)}</span>
      <span class="pill">Статус: ${escapeHtml(status)}</span>
      <span class="pill">Осталось: ${left === null ? "—" : left + "д"}</span>
      <span class="pill">ИИ: ${escapeHtml(mode)}</span>
      <span class="pill">Баланс: ${Math.round(balance)}₽</span>
    `;

    const bal = $("#admin267-ai-balance");
    if (bal) bal.value = String(Math.round(balance));

    const modeSel = $("#admin267-ai-mode");
    if (modeSel && mode) {
      const m = String(mode).toLowerCase();
      if (m.includes("client")) modeSel.value = "client_api";
      else if (m.includes("disabled")) modeSel.value = "disabled";
      else modeSel.value = "server_api";
    }
  }

  async function saveSubscription(plan, days) {
    if (!state.isAdmin) return status("Нет прав администратора.", true);

    const uid = state.selectedUid || state.uid;
    const user = state.users.find(u => u.uid === uid) || {};
    const active = plan !== "none" && days > 0;
    const expiresAt = active ? addDays(days) : new Date(Date.now() - 86400000);

    const payload = {
      uid,
      email: user.email || "",
      displayName: user.displayName || user.name || "",
      plan,
      planId: plan,
      tariff: plan,
      status: active ? (plan === "trial" ? "trialing" : "active") : "inactive",
      active,
      subscriptionActive: active,
      expiresAt,
      validUntil: expiresAt,
      paidUntil: expiresAt,
      days,
      aiEnabled: plan === "with_ai" || plan === "trial",
      updatedBy: state.email,
      updatedAt: ts(),
      updatedAtClient: new Date().toISOString(),
      version: VERSION
    };

    status("Сохраняю подписку...");

    try {
      const firestore = db();
      await firestore.collection("user_subscriptions").doc(uid).set(payload, { merge: true });
      await firestore.collection("subscriptions").doc(uid).set(payload, { merge: true });
      await firestore.collection("users").doc(uid).set({
        uid,
        email: user.email || "",
        displayName: user.displayName || user.name || "",
        subscription: payload,
        subscriptionActive: payload.active,
        subscriptionStatus: payload.status,
        subscriptionPlan: payload.plan,
        subscriptionExpiresAt: expiresAt,
        updatedAt: ts()
      }, { merge: true });

      state.currentSub = { ...state.currentSub, ...payload };
      updateCurrentInfo();
      status("Подписка сохранена.");
      log("subscription-saved", "Подписка сохранена.", { uid, plan, days });
    } catch (e) {
      state.lastError = e.message || String(e);
      status("Ошибка сохранения подписки: " + state.lastError, true);
      log("subscription-save-error", "Ошибка сохранения подписки.", { uid, error: state.lastError });
    }
  }

  async function saveAi() {
    if (!state.isAdmin) return status("Нет прав администратора.", true);

    const uid = state.selectedUid || state.uid;
    const mode = $("#admin267-ai-mode")?.value || "server_api";
    const balance = Number($("#admin267-ai-balance")?.value || 0) || 0;
    const user = state.users.find(u => u.uid === uid) || {};

    const payload = {
      uid,
      email: user.email || "",
      displayName: user.displayName || user.name || "",
      aiMode: mode,
      mode,
      aiEnabled: mode !== "disabled",
      aiBalance: balance,
      balance,
      rubBalance: balance,
      amount: balance,
      updatedBy: state.email,
      updatedAt: ts(),
      updatedAtClient: new Date().toISOString(),
      version: VERSION
    };

    status("Сохраняю ИИ режим и баланс...");

    try {
      const firestore = db();
      await firestore.collection("ai_balances").doc(uid).set(payload, { merge: true });
      await firestore.collection("ai_wallets").doc(uid).set(payload, { merge: true });
      await firestore.collection("token_balances").doc(uid).set(payload, { merge: true });
      await firestore.collection("users").doc(uid).set({
        uid,
        email: user.email || "",
        displayName: user.displayName || user.name || "",
        ai: payload,
        aiMode: mode,
        aiEnabled: mode !== "disabled",
        aiBalance: balance,
        updatedAt: ts()
      }, { merge: true });

      state.currentAi = { ...state.currentAi, ...payload };
      updateCurrentInfo();
      status("ИИ режим и баланс сохранены.");
      log("ai-saved", "ИИ режим и баланс сохранены.", { uid, mode, balance });
    } catch (e) {
      state.lastError = e.message || String(e);
      status("Ошибка сохранения ИИ: " + state.lastError, true);
      log("ai-save-error", "Ошибка сохранения ИИ.", { uid, error: state.lastError });
    }
  }

  function boot() {
    injectCss();

    const user = hasFirebase() ? currentUser() : null;
    setAdminState(user);

    const block = findAdminSubscriptionBlock();
    if (block) {
      renderPanel(block);
    }

    if (hasFirebase() && !state.unsubAuth) {
      state.unsubAuth = firebase.auth().onAuthStateChanged(u => {
        setAdminState(u);
        const b = findAdminSubscriptionBlock();
        if (b) renderPanel(b);
        if (state.isAdmin) loadUsers(true);
      });
    }

    if (state.isAdmin) loadUsers();
  }

  function observe() {
    if (window.__adminV267Observer) return;

    const obs = new MutationObserver(() => {
      clearTimeout(window.__adminV267Timer);
      window.__adminV267Timer = setTimeout(() => {
        const block = findAdminSubscriptionBlock();
        if (block && !$("#admin-v267-panel")) boot();
      }, 250);
    });

    obs.observe(document.body, { childList: true, subtree: true });
    window.__adminV267Observer = obs;
  }

  window.AdminV267SubscriptionRestore = {
    version: VERSION,
    state,
    boot,
    loadUsers,
    loadSelectedAccess,
    saveSubscription,
    saveAi,
    findAdminSubscriptionBlock
  };

  window.addEventListener("DOMContentLoaded", () => {
    boot();
    observe();
    [500, 1200, 2500, 5000].forEach(ms => setTimeout(boot, ms));
  });

  log("script-loaded", "Админ-панель подписки V26.7 восстановлена.");
})();
