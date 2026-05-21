(function () {
  const FILE = "assets/js/admin-api.js";
  const ADMIN_EMAIL = "vits0007@gmail.com";
  let usersCache = [];
  let currentUid = null;

  const $ = (id) => document.getElementById(id);

  function user() {
    return window.Auth?.getUser?.() || null;
  }

  function isAdmin() {
    const u = user();
    return !!u && (
      u.role === "admin" ||
      u.profile?.role === "admin" ||
      u.profile?.isAdmin === true ||
      String(u.email || "").toLowerCase() === ADMIN_EMAIL
    );
  }

  async function requireAdmin() {
    if (!isAdmin()) throw new Error("Доступ только для администратора");
    if (!window.ServerAPI?.isReady?.()) await window.ServerAPI.initFirebase();
    const db = window.ServerAPI.db();
    if (!db) throw new Error("Firestore не инициализирован");
    return db;
  }

  function esc(text) {
    return String(text ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function formatDate(value) {
    try {
      if (!value) return "—";
      if (value.toDate) return value.toDate().toLocaleString("ru-RU");
      if (typeof value === "string") return new Date(value).toLocaleString("ru-RU");
      if (value instanceof Date) return value.toLocaleString("ru-RU");
      return "—";
    } catch { return "—"; }
  }

  function money(value) {
    const n = Number(value || 0);
    return new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n) + " ₽";
  }

  function statusLabel(profile) {
    if (profile.status === "deleted" || profile.deleted === true) return "deleted";
    if (profile.status === "blocked_review") return "blocked_review";
    if (profile.status === "blocked" || profile.blocked === true) return "blocked";
    if (profile.status === "approved" || profile.isApproved === true) return "approved";
    return "pending";
  }

  function statusText(status) {
    if (status === "approved") return "одобрен";
    if (status === "blocked") return "заблокирован";
    if (status === "blocked_review") return "проверка";
    if (status === "deleted") return "удалён";
    return "ожидает";
  }

  function roleText(role) { return role === "admin" ? "admin" : "master"; }

  function chip(status) {
    if (status === "approved") return "ok";
    if (["blocked", "blocked_review", "deleted"].includes(status)) return "blocked";
    return "wait";
  }

  function accessModeText(mode) {
    if (mode === "admin_api") return "через админский API";
    if (mode === "own_api") return "свой API мастера";
    return "выключен";
  }

  function planName(planId) {
    if (planId === "pro_ai") return "С ИИ";
    if (planId === "basic") return "Базовая";
    return planId || "нет";
  }

  function getUserFromCache(uid) {
    return usersCache.find(x => x.id === uid) || null;
  }

  async function getDoc(path) {
    const db = await requireAdmin();
    const snap = await db.doc(path).get();
    return snap.exists ? snap.data() || {} : null;
  }

  async function listCollection(path, limit = 20) {
    const db = await requireAdmin();
    const snap = await db.collection(path).limit(limit).get();
    const arr = [];
    snap.forEach(doc => arr.push({ id: doc.id, data: doc.data() || {} }));
    return arr;
  }

  async function listByUid(collection, uid, limit = 15) {
    const db = await requireAdmin();
    try {
      const snap = await db.collection(collection).where("uid", "==", uid).limit(limit).get();
      const arr = [];
      snap.forEach(doc => arr.push({ id: doc.id, data: doc.data() || {} }));
      arr.sort((a, b) => {
        const ad = a.data.createdAt?.toDate?.()?.getTime?.() || 0;
        const bd = b.data.createdAt?.toDate?.()?.getTime?.() || 0;
        return bd - ad;
      });
      return arr;
    } catch { return []; }
  }

  function renderUserCard(doc) {
    const p = doc.data || {};
    const status = statusLabel(p);
    const role = roleText(p.role);
    const name = esc(p.name || p.displayName || "Без имени");
    const email = esc(p.email || "без email");

    return `
      <div class="admin-user-card" data-admin-open-user="${esc(doc.id)}">
        <div class="admin-user-top">
          <div>
            <div class="admin-user-name">${name}</div>
            <div class="admin-user-email">${email}</div>
          </div>
          <span class="admin-chip ${chip(status)}">${statusText(status)}</span>
        </div>
        <div class="admin-user-meta">
          <span class="admin-chip">${role}</span>
          <span class="admin-chip">uid: ${esc(doc.id.slice(0, 8))}</span>
          <span class="admin-chip">вход: ${esc(formatDate(p.lastLoginAt))}</span>
        </div>
      </div>`;
  }

  async function loadUsers() {
    const list = $("adminUsersList");
    if (!list) return;

    try {
      const db = await requireAdmin();
      list.innerHTML = `<div class="admin-empty">Загрузка пользователей...</div>`;
      const snap = await db.collection("users").get();

      if (snap.empty) {
        usersCache = [];
        list.innerHTML = `<div class="admin-empty">Пользователей пока нет.</div>`;
        return;
      }

      const docs = [];
      snap.forEach(doc => docs.push({ id: doc.id, data: doc.data() || {} }));
      docs.sort((a, b) => {
        const order = { pending: 0, blocked_review: 1, approved: 2, blocked: 3, deleted: 4 };
        return (order[statusLabel(a.data)] ?? 9) - (order[statusLabel(b.data)] ?? 9);
      });
      usersCache = docs;
      list.innerHTML = docs.map(renderUserCard).join("");

      window.Diagnostics?.ok?.({ file: FILE, module: "AdminAPI", functionName: "loadUsers()", place: "users", code: "users-loaded", message: "Пользователи загружены: " + docs.length });
    } catch (error) {
      list.innerHTML = `<div class="admin-empty">Ошибка загрузки: ${esc(error.message)}</div>`;
      window.Diagnostics?.error?.({ file: FILE, module: "AdminAPI", functionName: "loadUsers()", place: "users", code: error.code || "users-load-error", message: error.message });
    }
  }

  function miniItems(items, emptyText, renderer) {
    if (!items || !items.length) return `<div class="admin-mini-item"><span class="admin-mini-muted">${esc(emptyText)}</span></div>`;
    return items.map(renderer).join("");
  }

  function renderSubscriptionBlock(uid, sub) {
    const planId = sub?.planId || "none";
    const status = sub?.status || "нет подписки";
    return `
      <div class="admin-detail-card" id="adminSubscriptionBlock" data-subscription-uid="${esc(uid)}">
        <h3>Подписка</h3>
        <div class="admin-kv">
          <div class="admin-kv-row"><b>Тариф</b><span>${esc(planName(planId))}</span></div>
          <div class="admin-kv-row"><b>Статус</b><span>${esc(status)}</span></div>
          <div class="admin-kv-row"><b>Активна до</b><span>${esc(formatDate(sub?.expiresAt))}</span></div>
          <div class="admin-kv-row"><b>Пробный период до</b><span>${esc(formatDate(sub?.trialEndsAt))}</span></div>
        </div>
        <button class="btn btn-primary ep-clickable subscription-trial-btn" data-sub-action="grant-trial" data-uid="${esc(uid)}">Пробный период 3 дня</button>
        <div class="subscription-period-grid">
          <div class="subscription-period-title">Базовая</div>
          <div class="subscription-period-buttons">
            <button class="btn btn-ghost ep-clickable" data-sub-action="grant" data-plan="basic" data-days="30" data-uid="${esc(uid)}">30 дней</button>
            <button class="btn btn-ghost ep-clickable" data-sub-action="grant" data-plan="basic" data-days="90" data-uid="${esc(uid)}">90 дней</button>
            <button class="btn btn-ghost ep-clickable" data-sub-action="grant" data-plan="basic" data-days="180" data-uid="${esc(uid)}">180 дней</button>
          </div>
          <div class="subscription-period-title">С ИИ</div>
          <div class="subscription-period-buttons">
            <button class="btn btn-primary ep-clickable" data-sub-action="grant" data-plan="pro_ai" data-days="30" data-uid="${esc(uid)}">30 дней</button>
            <button class="btn btn-primary ep-clickable" data-sub-action="grant" data-plan="pro_ai" data-days="90" data-uid="${esc(uid)}">90 дней</button>
            <button class="btn btn-primary ep-clickable" data-sub-action="grant" data-plan="pro_ai" data-days="180" data-uid="${esc(uid)}">180 дней</button>
          </div>
        </div>
        <div class="subscription-note-admin">Подписка «С ИИ» открывает доступ к ИИ-разделу, но ИИ-запросы всё равно оплачиваются отдельно по ИИ-балансу.</div>
        <div class="admin-actions-2">
          <button class="btn btn-ghost ep-clickable" data-sub-action="seed-plans" data-uid="${esc(uid)}">Создать тарифы</button>
          <button class="btn btn-ghost admin-danger ep-clickable" data-sub-action="cancel" data-uid="${esc(uid)}">Отменить подписку</button>
        </div>
      </div>`;
  }

  function toggle(key, title, subtitle, value) {
    return `
      <div class="security-toggle-row">
        <div><strong>${title}</strong><small>${subtitle}</small></div>
        <button class="security-toggle ${value ? "is-on" : ""}" data-policy-toggle="${key}" type="button"></button>
      </div>`;
  }

  function renderSecurityBlock(profile) {
    const policy = profile.securityPolicy || {};
    return `
      <div class="admin-detail-card ${profile.status === "blocked_review" ? "admin-warning" : ""}">
        <h3>Безопасность</h3>
        <div class="admin-kv">
          <div class="admin-kv-row"><b>Причина</b><span>${esc(policy.reason || profile.blockedReason || "—")}</span></div>
        </div>
        <div class="security-toggle-grid">
          ${toggle("allowLogin", "Вход", "Разрешить пользователю входить", policy.allowLogin !== false)}
          ${toggle("allowReadData", "Получение данных", "Доступ к серверной базе и данным", policy.allowReadData !== false)}
          ${toggle("allowLocalCache", "Локальный кэш", "Сохранять данные на устройстве", policy.allowLocalCache === true)}
          ${toggle("allowAi", "ИИ", "Разрешить ИИ-функции при балансе", policy.allowAi === true)}
          ${toggle("allowOfflineMode", "Офлайн", "Работа без постоянной проверки сервера", policy.allowOfflineMode === true)}
        </div>
        <div class="security-policy-hint">Офлайн и локальный кэш включай только для доверенного устройства. Для обычного безопасного режима кэш и офлайн лучше держать выключенными.</div>
        <div class="security-policy-actions">
          <button class="btn btn-ghost ep-clickable" data-card-action="safe-policy">Онлайн безопасный</button>
          <button class="btn btn-primary ep-clickable" data-card-action="trusted-policy">Доверенное устройство</button>
          <button class="btn btn-ghost admin-danger ep-clickable" data-card-action="lock-data-policy">Запретить данные/ИИ</button>
        </div>
        <button class="btn btn-primary ep-clickable security-policy-save" data-card-action="save-custom-policy">Сохранить выбранные тумблеры</button>
      </div>`;
  }

  async function openUserCard(uid) {
    currentUid = uid;
    const modal = $("adminUserModal");
    const details = $("adminUserDetails");
    const title = $("adminUserTitle");
    const subtitle = $("adminUserSubtitle");
    if (!modal || !details) return;

    modal.classList.remove("hidden");
    details.innerHTML = `<div class="admin-empty">Загрузка карточки пользователя...</div>`;

    try {
      const cached = getUserFromCache(uid);
      const profile = (await getDoc("users/" + uid)) || cached?.data || {};
      const account = (await getDoc("ai_accounts/" + uid)) || {};
      const subscription = (await getDoc("user_subscriptions/" + uid)) || null;
      const baseItems = await listCollection("user_db/" + uid + "/items", 12);
      const transactions = await listByUid("ai_transactions", uid, 15);
      const securityEvents = await listByUid("security_events", uid, 10);

      const status = statusLabel(profile);
      const role = roleText(profile.role);
      const name = profile.name || profile.displayName || "Без имени";
      const email = profile.email || "без email";

      if (title) title.textContent = name;
      if (subtitle) subtitle.textContent = `${email} · ${role} · ${statusText(status)}`;

      details.innerHTML = `
        <div class="admin-detail-grid">
          <div class="admin-detail-card">
            <div class="admin-section-title">
              <h3>Профиль</h3>
              <span class="admin-chip ${chip(status)}">${statusText(status)}</span>
            </div>
            <div class="admin-kv">
              <div class="admin-kv-row"><b>Имя</b><span>${esc(name)}</span></div>
              <div class="admin-kv-row"><b>Email</b><span>${esc(email)}</span></div>
              <div class="admin-kv-row"><b>UID</b><span>${esc(uid)}</span></div>
              <div class="admin-kv-row"><b>Роль</b><span>${esc(role)}</span></div>
              <div class="admin-kv-row"><b>Статус</b><span>${esc(statusText(status))}</span></div>
              <div class="admin-kv-row"><b>Создан</b><span>${esc(formatDate(profile.createdAt))}</span></div>
              <div class="admin-kv-row"><b>Последний вход</b><span>${esc(formatDate(profile.lastLoginAt))}</span></div>
            </div>
            <div class="admin-actions-3">
              <button class="btn btn-primary ep-clickable" data-card-action="approve">Одобрить</button>
              <button class="btn btn-ghost ep-clickable" data-card-action="make-master">Сделать мастером</button>
              <button class="btn btn-primary ep-clickable" data-card-action="make-admin">Назначить админом</button>
              <button class="btn btn-ghost ep-clickable" data-card-action="block">Заблокировать</button>
              <button class="btn btn-ghost ep-clickable" data-card-action="unblock">Разблокировать</button>
              <button class="btn btn-ghost admin-danger ep-clickable" data-card-action="soft-delete">Удалить мягко</button>
            </div>
          </div>

          ${renderSubscriptionBlock(uid, subscription)}

          <div class="admin-detail-card">
            <h3>ИИ-баланс</h3>
            <div class="admin-balance-big">${money(account.balanceRub)}</div>
            <div class="admin-kv">
              <div class="admin-kv-row"><b>Режим</b><span>${esc(accessModeText(account.accessMode))}</span></div>
              <div class="admin-kv-row"><b>ИИ доступ</b><span>${account.allowAi === false ? "выключен" : "разрешён"}</span></div>
              <div class="admin-kv-row"><b>Пополнено всего</b><span>${money(account.totalTopupRub)}</span></div>
              <div class="admin-kv-row"><b>Потрачено всего</b><span>${money(account.totalSpendRub)}</span></div>
              <div class="admin-kv-row"><b>Дневной лимит</b><span>${money(account.dailyLimitRub || 100)}</span></div>
              <div class="admin-kv-row"><b>Месячный лимит</b><span>${money(account.monthlyLimitRub || 2000)}</span></div>
            </div>
            <div class="admin-input-row">
              <input id="aiTopupAmountInput" type="number" min="1" step="1" placeholder="Сумма пополнения, ₽">
              <button class="btn btn-primary ep-clickable" data-card-action="topup-balance">Пополнить</button>
            </div>
            <div class="admin-input-row">
              <input id="aiRefundAmountInput" type="number" min="1" step="1" placeholder="Сумма возврата, ₽">
              <button class="btn btn-ghost ep-clickable" data-card-action="refund-balance">Вернуть</button>
            </div>
            <div class="admin-input-row">
              <select id="aiAccessModeSelect">
                <option value="admin_api" ${account.accessMode === "admin_api" ? "selected" : ""}>Через админский API</option>
                <option value="own_api" ${account.accessMode === "own_api" ? "selected" : ""}>Свой API мастера</option>
                <option value="disabled" ${account.accessMode === "disabled" ? "selected" : ""}>Выключен</option>
              </select>
              <button class="btn btn-primary ep-clickable" data-card-action="set-ai-mode">Сохранить режим</button>
            </div>
          </div>

          ${renderSecurityBlock(profile)}

          <div class="admin-detail-card">
            <h3>Личная база мастера</h3>
            <div class="admin-mini-list">
              ${miniItems(baseItems, "В личной базе пока нет позиций или доступ ограничен.", item => `
                <div class="admin-mini-item">
                  <b>${esc(item.data.name || "Без названия")}</b>
                  <div class="admin-mini-muted">${esc(item.data.type || "item")} · ${esc(item.data.category || "без категории")} · ${money(item.data.price)}</div>
                </div>`)}
            </div>
          </div>

          <div class="admin-detail-card">
            <h3>История ИИ-операций</h3>
            <div class="admin-mini-list">
              ${miniItems(transactions, "Операций пока нет.", item => `
                <div class="admin-mini-item">
                  <b>${esc(item.data.type || "operation")} · ${money(item.data.amountRub)}</b>
                  <div class="admin-mini-muted">Баланс: ${money(item.data.beforeBalanceRub)} → ${money(item.data.afterBalanceRub)}<br>Причина: ${esc(item.data.reason || "—")}<br>Дата: ${esc(formatDate(item.data.createdAt))}</div>
                </div>`)}
            </div>
          </div>

          <div class="admin-detail-card">
            <h3>События безопасности</h3>
            <div class="admin-mini-list">
              ${miniItems(securityEvents, "Событий безопасности нет.", item => `
                <div class="admin-mini-item">
                  <b>${esc(item.data.type || "security_event")} · ${esc(item.data.severity || "info")}</b>
                  <div class="admin-mini-muted">Статус: ${esc(item.data.status || "open")}<br>Дата: ${esc(formatDate(item.data.createdAt))}</div>
                </div>`)}
            </div>
          </div>
        </div>`;

      window.Diagnostics?.ok?.({ file: FILE, module: "AdminAPI", functionName: "openUserCard()", place: "admin user card", code: "user-card-opened", message: "Открыта карточка пользователя " + email });
    } catch (error) {
      details.innerHTML = `<div class="admin-empty">Ошибка карточки: ${esc(error.message)}</div>`;
      window.Diagnostics?.error?.({ file: FILE, module: "AdminAPI", functionName: "openUserCard()", place: "admin user card", code: error.code || "user-card-error", message: error.message });
    }
  }

  function closeUserCard() {
    $("adminUserModal")?.classList.add("hidden");
    currentUid = null;
  }

  async function updateUser(uid, patch, actionName) {
    try {
      const db = await requireAdmin();
      await db.collection("users").doc(uid).set({ ...patch, updatedAt: firebase.firestore.FieldValue.serverTimestamp(), updatedBy: user()?.uid || "admin" }, { merge: true });
      window.SoundAPI?.success?.();
      await loadUsers();
      await openUserCard(uid);
      window.Diagnostics?.ok?.({ file: FILE, module: "AdminAPI", functionName: "updateUser()", place: "users/" + uid, code: "user-updated", message: "Пользователь обновлён: " + actionName });
    } catch (error) {
      window.Diagnostics?.error?.({ file: FILE, module: "AdminAPI", functionName: "updateUser()", place: "users/" + uid, code: error.code || "user-update-error", message: error.message });
      window.AppShell?.openDiagnostics?.();
    }
  }

  async function callProtected(actionName, fn) {
    if (!currentUid) return;
    try {
      await fn();
      window.SoundAPI?.success?.();
      await openUserCard(currentUid);
      window.Diagnostics?.ok?.({ file: FILE, module: "AdminAPI", functionName: "callProtected()", place: "Cloud Functions", code: "admin-action-ok", message: "Операция выполнена: " + actionName });
    } catch (error) {
      alert("Ошибка: " + error.message);
      window.Diagnostics?.error?.({ file: FILE, module: "AdminAPI", functionName: "callProtected()", place: "Cloud Functions", code: error.code || "admin-action-error", message: error.message });
    }
  }

  function numberFromInput(id) {
    const v = Number($(id)?.value || 0);
    if (!Number.isFinite(v) || v <= 0) { alert("Введите сумму больше нуля."); return null; }
    return Math.round(v * 100) / 100;
  }

  function getPolicyFromToggles(uid) {
    const get = (key) => document.querySelector(`[data-policy-toggle="${key}"]`)?.classList.contains("is-on") === true;
    return {
      uid,
      allowLogin: get("allowLogin"),
      allowReadData: get("allowReadData"),
      allowLocalCache: get("allowLocalCache"),
      allowAi: get("allowAi"),
      allowOfflineMode: get("allowOfflineMode"),
      reason: "admin_custom_policy"
    };
  }

  async function handleCardAction(action) {
    const uid = currentUid;
    if (!uid) return;
    const cached = getUserFromCache(uid);
    const email = cached?.data?.email || "";

    if (action === "approve") return updateUser(uid, { status: "approved", isApproved: true, blocked: false }, "approve");
    if (action === "block") { if (!confirm("Заблокировать пользователя?")) return; return updateUser(uid, { status: "blocked", isApproved: false, blocked: true, blockedReason: "blocked_by_admin" }, "block"); }
    if (action === "unblock") return updateUser(uid, { status: "approved", isApproved: true, blocked: false, blockedReason: "", securityPolicy: { allowLogin: true, allowReadData: true, allowLocalCache: false, allowAi: true, allowOfflineMode: false, reason: "admin_unblocked" } }, "unblock");
    if (action === "make-master") { if (!confirm("Сделать пользователя мастером?")) return; return updateUser(uid, { role: "master", isAdmin: false, status: "approved", isApproved: true }, "make-master"); }
    if (action === "make-admin") { if (!confirm("Назначить пользователя администратором?")) return; return updateUser(uid, { role: "admin", isAdmin: true, status: "approved", isApproved: true }, "make-admin"); }
    if (action === "soft-delete") {
      const confirmText = prompt("Мягко удалить пользователя? Данные не сотрутся, но доступ будет закрыт.\n\nДля подтверждения введи email пользователя:\n" + email);
      if (confirmText !== email) { alert("Удаление отменено. Email не совпал."); return; }
      return updateUser(uid, { status: "deleted", deleted: true, blocked: true, isApproved: false, deletedAt: firebase.firestore.FieldValue.serverTimestamp(), deletedBy: user()?.uid || "admin", securityPolicy: { allowLogin: false, allowReadData: false, allowLocalCache: false, allowAi: false, allowOfflineMode: false, reason: "soft_deleted_by_admin" } }, "soft-delete");
    }
    if (action === "topup-balance") {
      const amount = numberFromInput("aiTopupAmountInput"); if (!amount) return;
      const repeat = prompt("Пополнить баланс на " + amount + " ₽?\nДля подтверждения введи сумму ещё раз:");
      if (Number(repeat) !== amount) { alert("Пополнение отменено."); return; }
      return callProtected("topup-balance", () => window.AiSecurityAPI.topUpBalance(uid, amount, "manual_qr_topup"));
    }
    if (action === "refund-balance") {
      const amount = numberFromInput("aiRefundAmountInput"); if (!amount) return;
      const repeat = prompt("Вернуть/начислить корректировку на " + amount + " ₽?\nДля подтверждения введи сумму ещё раз:");
      if (Number(repeat) !== amount) { alert("Операция отменена."); return; }
      return callProtected("refund-balance", () => window.AiSecurityAPI.refundBalance(uid, amount, "admin_refund"));
    }
    if (action === "set-ai-mode") {
      const mode = $("aiAccessModeSelect")?.value || "disabled";
      if (!confirm("Сменить режим ИИ на: " + accessModeText(mode) + "?")) return;
      return callProtected("set-ai-mode", () => window.AiSecurityAPI.setAccessMode(uid, mode));
    }
    if (action === "safe-policy") return callProtected("safe-policy", () => window.AiSecurityAPI.setUserSecurityPolicy({ uid, allowLogin: true, allowReadData: true, allowLocalCache: false, allowAi: true, allowOfflineMode: false, reason: "admin_safe_online_policy" }));
    if (action === "trusted-policy") { if (!confirm("Разрешить локальный кэш и офлайн? Только для доверенного устройства.")) return; return callProtected("trusted-policy", () => window.AiSecurityAPI.setUserSecurityPolicy({ uid, allowLogin: true, allowReadData: true, allowLocalCache: true, allowAi: true, allowOfflineMode: true, reason: "admin_trusted_device" })); }
    if (action === "lock-data-policy") { if (!confirm("Запретить пользователю получение данных, кэш и ИИ?")) return; return callProtected("lock-data-policy", () => window.AiSecurityAPI.setUserSecurityPolicy({ uid, allowLogin: true, allowReadData: false, allowLocalCache: false, allowAi: false, allowOfflineMode: false, reason: "admin_locked_data_ai_cache" })); }
    if (action === "save-custom-policy") {
      const payload = getPolicyFromToggles(uid);
      if (payload.allowOfflineMode && !payload.allowLocalCache) { alert("Офлайн без локального кэша не имеет смысла. Включи кэш или выключи офлайн."); return; }
      if (!confirm("Сохранить выбранную политику безопасности?")) return;
      return callProtected("save-custom-policy", () => window.AiSecurityAPI.setUserSecurityPolicy(payload));
    }
  }

  async function handleSubscriptionAction(btn) {
    const uid = btn.dataset.uid || currentUid;
    if (!uid || !window.SubscriptionAPI) return;
    const action = btn.dataset.subAction;
    try {
      if (action === "seed-plans") {
        await window.SubscriptionAPI.seedSubscriptionPlans();
        alert("Тарифы по умолчанию созданы/обновлены.");
      }
      if (action === "grant-trial") {
        if (!confirm("Выдать пробный период 3 дня?")) return;
        await window.SubscriptionAPI.grantSubscription(uid, "pro_ai", 3, true);
      }
      if (action === "grant") {
        const plan = btn.dataset.plan;
        const days = Number(btn.dataset.days);
        if (!confirm("Выдать тариф " + planName(plan) + " на " + days + " дней?")) return;
        await window.SubscriptionAPI.grantSubscription(uid, plan, days, false);
      }
      if (action === "cancel") {
        if (!confirm("Отменить подписку пользователя?")) return;
        await window.SubscriptionAPI.cancelSubscription(uid);
      }
      window.SoundAPI?.success?.();
      await openUserCard(uid);
    } catch (error) {
      alert("Ошибка подписки: " + error.message);
      window.Diagnostics?.error?.({ file: FILE, module: "AdminAPI", functionName: "handleSubscriptionAction()", place: "subscription", code: error.code || "subscription-error", message: error.message });
    }
  }

  function bindPage() {
    $("refreshUsersBtn")?.addEventListener("click", loadUsers);
    $("adminUsersList")?.addEventListener("click", event => {
      const card = event.target.closest("[data-admin-open-user]");
      if (!card) return;
      openUserCard(card.dataset.adminOpenUser);
    });
    $("adminUserModal")?.addEventListener("click", event => {
      if (event.target.closest("[data-admin-close]")) { closeUserCard(); return; }
      const toggleBtn = event.target.closest("[data-policy-toggle]");
      if (toggleBtn) { toggleBtn.classList.toggle("is-on"); window.SoundAPI?.click?.(); return; }
      const subBtn = event.target.closest("[data-sub-action]");
      if (subBtn) { handleSubscriptionAction(subBtn); return; }
      const actionBtn = event.target.closest("[data-card-action]");
      if (!actionBtn) return;
      handleCardAction(actionBtn.dataset.cardAction);
    });
    loadUsers();
  }

  window.AdminAPI = {
    isAdmin,
    loadUsers,
    bindPage,
    openUserCard,
    closeUserCard,
    get currentUid() { return currentUid; }
  };
})();
