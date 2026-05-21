(function () {
  const FILE = "assets/js/admin-api.js";
  let usersCache = [];
  let currentUid = null;

  function injectStyles() {
    if (document.getElementById("admin-user-card-v9-css")) return;
    const style = document.createElement("style");
    style.id = "admin-user-card-v9-css";
    style.textContent = `
.admin-user-card{cursor:pointer;transition:transform .16s ease,background .16s ease,border-color .16s ease}.admin-user-card:active{transform:scale(.985)}.admin-user-card:hover{border-color:color-mix(in srgb,var(--accent) 45%,transparent)}.admin-modal.hidden{display:none}.admin-modal{position:fixed;inset:0;z-index:90;display:grid;place-items:center;padding:16px}.admin-modal-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.48);backdrop-filter:blur(10px)}.admin-modal-card{position:relative;width:min(760px,100%);max-height:88vh;overflow:auto;border-radius:28px;background:color-mix(in srgb,var(--card) 92%,white 8%);border:1px solid rgba(255,255,255,.18);box-shadow:0 24px 80px rgba(0,0,0,.32);padding:16px}.admin-modal-head{display:grid;grid-template-columns:1fr auto;gap:12px;align-items:start;margin-bottom:12px}.admin-modal-head h2{margin:0;font-size:24px}.admin-modal-head p{margin:4px 0 0;color:var(--muted);font-size:13px}.admin-modal-close{width:42px;height:42px;border:0;border-radius:999px;font-size:28px;font-weight:800;background:rgba(255,255,255,.12);color:var(--text)}.admin-user-details{display:grid;gap:12px}.admin-detail-grid{display:grid;gap:12px}.admin-detail-card{padding:12px;border-radius:var(--radius);background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12)}.admin-detail-card h3{margin:0 0 10px;font-size:16px}.admin-kv{display:grid;gap:8px}.admin-kv-row{display:grid;grid-template-columns:150px 1fr;gap:10px;font-size:13px}.admin-kv-row b{color:var(--muted)}.admin-kv-row span{word-break:break-word;font-weight:700}.admin-balance-big{font-size:30px;font-weight:950;letter-spacing:-.04em;margin:4px 0 8px}.admin-mini-list{display:grid;gap:7px;margin-top:8px}.admin-mini-item{padding:9px;border-radius:16px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.08);font-size:13px}.admin-mini-item b{display:block;margin-bottom:3px}.admin-mini-muted{color:var(--muted);font-size:12px}.admin-danger{background:rgba(239,68,68,.16)!important;border-color:rgba(239,68,68,.28)!important}.admin-warning{background:rgba(245,158,11,.15)!important;border-color:rgba(245,158,11,.26)!important}.admin-actions-3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:10px}.admin-actions-2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:10px}.admin-detail-card .btn{margin:0;padding:10px;font-size:13px}.admin-input-row{display:grid;grid-template-columns:1fr auto;gap:8px;margin-top:8px}.admin-input-row input,.admin-input-row select{width:100%;min-height:42px;border:1px solid rgba(255,255,255,.16);border-radius:16px;background:rgba(255,255,255,.09);color:var(--text);padding:0 12px;outline:none}.admin-section-title{display:flex;align-items:center;justify-content:space-between;gap:8px}@media(max-width:520px){.admin-modal{padding:10px;align-items:end}.admin-modal-card{max-height:92vh;border-radius:24px 24px 0 0}.admin-kv-row,.admin-actions-3,.admin-actions-2,.admin-input-row{grid-template-columns:1fr}.admin-kv-row{gap:2px}}
`;
    document.head.appendChild(style);
  }

  function user() { return window.Auth?.getUser?.() || null; }
  function isAdmin() {
    const u = user();
    return !!u && (u.role === "admin" || u.profile?.role === "admin" || u.profile?.isAdmin === true);
  }
  async function requireAdmin() {
    if (!isAdmin()) throw new Error("Доступ только для администратора");
    if (!window.ServerAPI?.isReady?.()) await window.ServerAPI.initFirebase();
    const db = window.ServerAPI.db();
    if (!db) throw new Error("Firestore не инициализирован");
    return db;
  }
  function esc(text) { return String(text ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;"); }
  function formatDate(value) { try { if (!value) return "—"; if (value.toDate) return value.toDate().toLocaleString("ru-RU"); if (typeof value === "string") return new Date(value).toLocaleString("ru-RU"); return "—"; } catch { return "—"; } }
  function money(value) { const n = Number(value || 0); return new Intl.NumberFormat("ru-RU",{minimumFractionDigits:0,maximumFractionDigits:2}).format(n)+" ₽"; }
  function statusLabel(p) { if (p.status === "deleted" || p.deleted === true) return "deleted"; if (p.status === "blocked_review") return "blocked_review"; if (p.status === "blocked" || p.blocked === true) return "blocked"; if (p.status === "approved" || p.isApproved === true) return "approved"; return "pending"; }
  function statusText(s) { return s === "approved" ? "одобрен" : s === "blocked" ? "заблокирован" : s === "blocked_review" ? "проверка" : s === "deleted" ? "удалён" : "ожидает"; }
  function roleText(role) { return role === "admin" ? "admin" : "master"; }
  function chip(status) { return status === "approved" ? "ok" : ["blocked","blocked_review","deleted"].includes(status) ? "blocked" : "wait"; }
  function getUserFromCache(uid) { return usersCache.find(x => x.id === uid) || null; }

  function renderUserCard(doc) {
    const p = doc.data || {}, status = statusLabel(p), role = roleText(p.role);
    return `<div class="admin-user-card" data-admin-open-user="${esc(doc.id)}"><div class="admin-user-top"><div><div class="admin-user-name">${esc(p.name || p.displayName || "Без имени")}</div><div class="admin-user-email">${esc(p.email || "без email")}</div></div><span class="admin-chip ${chip(status)}">${statusText(status)}</span></div><div class="admin-user-meta"><span class="admin-chip">${role}</span><span class="admin-chip">uid: ${esc(doc.id.slice(0,8))}</span><span class="admin-chip">вход: ${esc(formatDate(p.lastLoginAt))}</span></div></div>`;
  }

  async function loadUsers() {
    injectStyles();
    const list = document.getElementById("adminUsersList");
    if (!list) return;
    try {
      const db = await requireAdmin();
      list.innerHTML = `<div class="admin-empty">Загрузка пользователей...</div>`;
      const snap = await db.collection("users").get();
      const docs = [];
      snap.forEach(doc => docs.push({ id: doc.id, data: doc.data() || {} }));
      docs.sort((a,b) => ({pending:0,blocked_review:1,approved:2,blocked:3,deleted:4}[statusLabel(a.data)] ?? 9) - ({pending:0,blocked_review:1,approved:2,blocked:3,deleted:4}[statusLabel(b.data)] ?? 9));
      usersCache = docs;
      list.innerHTML = docs.length ? docs.map(renderUserCard).join("") : `<div class="admin-empty">Пользователей пока нет.</div>`;
      window.Diagnostics?.ok?.({file:FILE,module:"AdminAPI",functionName:"loadUsers()",place:"users",code:"users-loaded",message:"Пользователи загружены: "+docs.length});
    } catch (error) {
      list.innerHTML = `<div class="admin-empty">Ошибка загрузки: ${esc(error.message)}</div>`;
      window.Diagnostics?.error?.({file:FILE,module:"AdminAPI",functionName:"loadUsers()",place:"users",code:error.code||"users-load-error",message:error.message});
    }
  }

  async function getDoc(path) { const db = await requireAdmin(); const snap = await db.doc(path).get(); return snap.exists ? snap.data() || {} : null; }
  async function listCollection(path, limit=20) { const db = await requireAdmin(); const snap = await db.collection(path).limit(limit).get(); const arr=[]; snap.forEach(doc=>arr.push({id:doc.id,data:doc.data()||{}})); return arr; }
  async function listWhere(collection, uid, limit=15) { const db = await requireAdmin(); try { const snap = await db.collection(collection).where("uid","==",uid).limit(limit).get(); const arr=[]; snap.forEach(doc=>arr.push({id:doc.id,data:doc.data()||{}})); arr.sort((a,b)=>(b.data.createdAt?.toDate?.()?.getTime?.()||0)-(a.data.createdAt?.toDate?.()?.getTime?.()||0)); return arr; } catch { return []; } }
  function miniItems(items, emptyText, renderer) { return (!items || !items.length) ? `<div class="admin-mini-item"><span class="admin-mini-muted">${esc(emptyText)}</span></div>` : items.map(renderer).join(""); }
  function accessModeText(mode) { return mode === "admin_api" ? "через админский API" : mode === "own_api" ? "свой API мастера" : "выключен"; }
  function policyValue(v) { return v === false ? "запрещено" : "разрешено"; }

  async function openUserCard(uid) {
    injectStyles();
    currentUid = uid;
    const modal = document.getElementById("adminUserModal"), details = document.getElementById("adminUserDetails"), title = document.getElementById("adminUserTitle"), subtitle = document.getElementById("adminUserSubtitle");
    if (!modal || !details) return;
    modal.classList.remove("hidden");
    details.innerHTML = `<div class="admin-empty">Загрузка карточки пользователя...</div>`;
    try {
      const cached = getUserFromCache(uid);
      const profile = (await getDoc("users/"+uid)) || cached?.data || {};
      const account = (await getDoc("ai_accounts/"+uid)) || {};
      const baseItems = await listCollection("user_db/"+uid+"/items", 12);
      const transactions = await listWhere("ai_transactions", uid, 15);
      const securityEvents = await listWhere("security_events", uid, 10);
      const status = statusLabel(profile), role = roleText(profile.role), name = profile.name || profile.displayName || "Без имени", email = profile.email || "без email", policy = profile.securityPolicy || {};
      if (title) title.textContent = name;
      if (subtitle) subtitle.textContent = `${email} · ${role} · ${statusText(status)}`;
      details.innerHTML = `<div class="admin-detail-grid">
        <div class="admin-detail-card"><div class="admin-section-title"><h3>Профиль</h3><span class="admin-chip ${chip(status)}">${statusText(status)}</span></div><div class="admin-kv"><div class="admin-kv-row"><b>Имя</b><span>${esc(name)}</span></div><div class="admin-kv-row"><b>Email</b><span>${esc(email)}</span></div><div class="admin-kv-row"><b>UID</b><span>${esc(uid)}</span></div><div class="admin-kv-row"><b>Роль</b><span>${esc(role)}</span></div><div class="admin-kv-row"><b>Статус</b><span>${esc(statusText(status))}</span></div><div class="admin-kv-row"><b>Создан</b><span>${esc(formatDate(profile.createdAt))}</span></div><div class="admin-kv-row"><b>Последний вход</b><span>${esc(formatDate(profile.lastLoginAt))}</span></div></div><div class="admin-actions-3"><button class="btn btn-primary ep-clickable" data-card-action="approve">Одобрить</button><button class="btn btn-ghost ep-clickable" data-card-action="make-master">Сделать мастером</button><button class="btn btn-primary ep-clickable" data-card-action="make-admin">Назначить админом</button><button class="btn btn-ghost ep-clickable" data-card-action="block">Заблокировать</button><button class="btn btn-ghost ep-clickable" data-card-action="unblock">Разблокировать</button><button class="btn btn-ghost admin-danger ep-clickable" data-card-action="soft-delete">Удалить мягко</button></div></div>
        <div class="admin-detail-card"><h3>ИИ-баланс</h3><div class="admin-balance-big">${money(account.balanceRub)}</div><div class="admin-kv"><div class="admin-kv-row"><b>Режим</b><span>${esc(accessModeText(account.accessMode))}</span></div><div class="admin-kv-row"><b>ИИ доступ</b><span>${account.allowAi === false ? "выключен" : "разрешён"}</span></div><div class="admin-kv-row"><b>Пополнено всего</b><span>${money(account.totalTopupRub)}</span></div><div class="admin-kv-row"><b>Потрачено всего</b><span>${money(account.totalSpendRub)}</span></div><div class="admin-kv-row"><b>Дневной лимит</b><span>${money(account.dailyLimitRub || 100)}</span></div><div class="admin-kv-row"><b>Месячный лимит</b><span>${money(account.monthlyLimitRub || 2000)}</span></div></div><div class="admin-input-row"><input id="aiTopupAmountInput" type="number" min="1" step="1" placeholder="Сумма пополнения, ₽"><button class="btn btn-primary ep-clickable" data-card-action="topup-balance">Пополнить</button></div><div class="admin-input-row"><input id="aiRefundAmountInput" type="number" min="1" step="1" placeholder="Сумма возврата, ₽"><button class="btn btn-ghost ep-clickable" data-card-action="refund-balance">Вернуть</button></div><div class="admin-input-row"><select id="aiAccessModeSelect"><option value="admin_api" ${account.accessMode === "admin_api" ? "selected" : ""}>Через админский API</option><option value="own_api" ${account.accessMode === "own_api" ? "selected" : ""}>Свой API мастера</option><option value="disabled" ${account.accessMode === "disabled" ? "selected" : ""}>Выключен</option></select><button class="btn btn-primary ep-clickable" data-card-action="set-ai-mode">Сохранить режим</button></div></div>
        <div class="admin-detail-card ${status === "blocked_review" ? "admin-warning" : ""}"><h3>Безопасность</h3><div class="admin-kv"><div class="admin-kv-row"><b>Вход</b><span>${esc(policyValue(policy.allowLogin))}</span></div><div class="admin-kv-row"><b>Получение данных</b><span>${esc(policyValue(policy.allowReadData))}</span></div><div class="admin-kv-row"><b>Локальный кэш</b><span>${esc(policy.allowLocalCache === true ? "разрешён" : "запрещён")}</span></div><div class="admin-kv-row"><b>ИИ</b><span>${esc(policy.allowAi === true ? "разрешён" : "запрещён")}</span></div><div class="admin-kv-row"><b>Офлайн</b><span>${esc(policy.allowOfflineMode === true ? "разрешён" : "запрещён")}</span></div><div class="admin-kv-row"><b>Причина</b><span>${esc(policy.reason || profile.blockedReason || "—")}</span></div></div><div class="admin-actions-2"><button class="btn btn-ghost ep-clickable" data-card-action="safe-policy">Безопасный режим</button><button class="btn btn-ghost admin-warning ep-clickable" data-card-action="online-only-policy">Только онлайн</button><button class="btn btn-ghost admin-danger ep-clickable" data-card-action="lock-data-policy">Запретить данные/ИИ</button><button class="btn btn-primary ep-clickable" data-card-action="clear-policy">Разрешить после проверки</button></div></div>
        <div class="admin-detail-card"><h3>Личная база мастера</h3><div class="admin-mini-list">${miniItems(baseItems,"В личной базе пока нет позиций или доступ ограничен.",item=>`<div class="admin-mini-item"><b>${esc(item.data.name || "Без названия")}</b><div class="admin-mini-muted">${esc(item.data.type || "item")} · ${esc(item.data.category || "без категории")} · ${money(item.data.price)}</div></div>`)}</div></div>
        <div class="admin-detail-card"><h3>История ИИ-операций</h3><div class="admin-mini-list">${miniItems(transactions,"Операций пока нет.",item=>`<div class="admin-mini-item"><b>${esc(item.data.type || "operation")} · ${money(item.data.amountRub)}</b><div class="admin-mini-muted">Баланс: ${money(item.data.beforeBalanceRub)} → ${money(item.data.afterBalanceRub)}<br>Причина: ${esc(item.data.reason || "—")}<br>Дата: ${esc(formatDate(item.data.createdAt))}</div></div>`)}</div></div>
        <div class="admin-detail-card"><h3>События безопасности</h3><div class="admin-mini-list">${miniItems(securityEvents,"Событий безопасности нет.",item=>`<div class="admin-mini-item"><b>${esc(item.data.type || "security_event")} · ${esc(item.data.severity || "info")}</b><div class="admin-mini-muted">Статус: ${esc(item.data.status || "open")}<br>Дата: ${esc(formatDate(item.data.createdAt))}</div></div>`)}</div></div>
      </div>`;
    } catch (error) {
      details.innerHTML = `<div class="admin-empty">Ошибка карточки: ${esc(error.message)}</div>`;
      window.Diagnostics?.error?.({file:FILE,module:"AdminAPI",functionName:"openUserCard()",place:"admin user card",code:error.code||"user-card-error",message:error.message});
    }
  }

  function closeUserCard() { document.getElementById("adminUserModal")?.classList.add("hidden"); currentUid = null; }
  async function updateUser(uid, patch, actionName) {
    try {
      const db = await requireAdmin();
      await db.collection("users").doc(uid).set({...patch, updatedAt: firebase.firestore.FieldValue.serverTimestamp(), updatedBy: user()?.uid || "admin"}, {merge:true});
      window.SoundAPI?.success?.(); await loadUsers(); await openUserCard(uid);
    } catch (error) { window.Diagnostics?.error?.({file:FILE,module:"AdminAPI",functionName:"updateUser()",place:"users/"+uid,code:error.code||"user-update-error",message:error.message}); window.AppShell?.openDiagnostics?.(); }
  }
  async function callAi(actionName, fn) { if (!currentUid) return; try { await fn(); window.SoundAPI?.success?.(); await openUserCard(currentUid); } catch (error) { alert("Ошибка: " + error.message); window.Diagnostics?.error?.({file:FILE,module:"AdminAPI",functionName:"callAi()",place:"Cloud Functions",code:error.code||"ai-admin-action-error",message:error.message}); } }
  function numberFromInput(id) { const v = Number(document.getElementById(id)?.value || 0); if (!Number.isFinite(v) || v <= 0) { alert("Введите сумму больше нуля."); return null; } return Math.round(v*100)/100; }

  async function handleCardAction(action) {
    const uid = currentUid; if (!uid) return;
    const cached = getUserFromCache(uid), email = cached?.data?.email || "";
    if (action === "approve") return updateUser(uid,{status:"approved",isApproved:true,blocked:false},"approve");
    if (action === "block") { if (!confirm("Заблокировать пользователя?")) return; return updateUser(uid,{status:"blocked",isApproved:false,blocked:true,blockedReason:"blocked_by_admin"},"block"); }
    if (action === "unblock") return updateUser(uid,{status:"approved",isApproved:true,blocked:false,blockedReason:"",securityPolicy:{allowLogin:true,allowReadData:true,allowLocalCache:false,allowAi:true,allowOfflineMode:false,reason:"admin_unblocked"}},"unblock");
    if (action === "make-master") { if (!confirm("Сделать пользователя мастером?")) return; return updateUser(uid,{role:"master",isAdmin:false,status:"approved",isApproved:true},"make-master"); }
    if (action === "make-admin") { if (!confirm("Назначить пользователя администратором?")) return; return updateUser(uid,{role:"admin",isAdmin:true,status:"approved",isApproved:true},"make-admin"); }
    if (action === "soft-delete") { const t = prompt("Мягко удалить пользователя? Данные не сотрутся, но доступ будет закрыт.\n\nДля подтверждения введи email пользователя:\n"+email); if (t !== email) return alert("Удаление отменено. Email не совпал."); return updateUser(uid,{status:"deleted",deleted:true,blocked:true,isApproved:false,deletedAt:firebase.firestore.FieldValue.serverTimestamp(),deletedBy:user()?.uid||"admin",securityPolicy:{allowLogin:false,allowReadData:false,allowLocalCache:false,allowAi:false,allowOfflineMode:false,reason:"soft_deleted_by_admin"}},"soft-delete"); }
    if (action === "topup-balance") { const amount = numberFromInput("aiTopupAmountInput"); if (!amount) return; const repeat = prompt("Пополнить баланс на "+amount+" ₽?\nДля подтверждения введи сумму ещё раз:"); if (Number(repeat) !== amount) return alert("Пополнение отменено."); return callAi("topup-balance",()=>window.AiSecurityAPI.topUpBalance(uid,amount,"manual_qr_topup")); }
    if (action === "refund-balance") { const amount = numberFromInput("aiRefundAmountInput"); if (!amount) return; const repeat = prompt("Вернуть/начислить корректировку на "+amount+" ₽?\nДля подтверждения введи сумму ещё раз:"); if (Number(repeat) !== amount) return alert("Операция отменена."); return callAi("refund-balance",()=>window.AiSecurityAPI.refundBalance(uid,amount,"admin_refund")); }
    if (action === "set-ai-mode") { const mode = document.getElementById("aiAccessModeSelect")?.value || "disabled"; if (!confirm("Сменить режим ИИ на: "+accessModeText(mode)+"?")) return; return callAi("set-ai-mode",()=>window.AiSecurityAPI.setAccessMode(uid,mode)); }
    if (action === "safe-policy") return callAi("safe-policy",()=>window.AiSecurityAPI.setUserSecurityPolicy({uid,allowLogin:true,allowReadData:true,allowLocalCache:false,allowAi:true,allowOfflineMode:false,reason:"admin_safe_policy"}));
    if (action === "online-only-policy") return callAi("online-only-policy",()=>window.AiSecurityAPI.setUserSecurityPolicy({uid,allowLogin:true,allowReadData:true,allowLocalCache:false,allowAi:false,allowOfflineMode:false,reason:"admin_online_only_no_cache"}));
    if (action === "lock-data-policy") { if (!confirm("Запретить пользователю получение данных, кэш и ИИ?")) return; return callAi("lock-data-policy",()=>window.AiSecurityAPI.setUserSecurityPolicy({uid,allowLogin:true,allowReadData:false,allowLocalCache:false,allowAi:false,allowOfflineMode:false,reason:"admin_locked_data_ai_cache"})); }
    if (action === "clear-policy") { if (!confirm("Разрешить после проверки? Локальный кэш всё равно останется запрещён по умолчанию.")) return; return callAi("clear-policy",()=>window.AiSecurityAPI.setUserSecurityPolicy({uid,allowLogin:true,allowReadData:true,allowLocalCache:false,allowAi:true,allowOfflineMode:false,reason:"admin_review_passed"})); }
  }

  function bindPage() {
    injectStyles();
    document.getElementById("refreshUsersBtn")?.addEventListener("click", loadUsers);
    document.getElementById("adminUsersList")?.addEventListener("click", event => { const card = event.target.closest("[data-admin-open-user]"); if (card) openUserCard(card.dataset.adminOpenUser); });
    document.getElementById("adminUserModal")?.addEventListener("click", event => { if (event.target.closest("[data-admin-close]")) return closeUserCard(); const btn = event.target.closest("[data-card-action]"); if (btn) handleCardAction(btn.dataset.cardAction); });
    loadUsers();
  }

  window.AdminAPI = { isAdmin, loadUsers, bindPage, openUserCard, closeUserCard };
})();
