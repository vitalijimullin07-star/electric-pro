(function () {
  const FILE = "assets/js/admin-api.js";

  function user() {
    return window.Auth?.getUser?.() || null;
  }

  function isAdmin() {
    const u = user();
    return !!u && (
      u.role === "admin" ||
      u.profile?.role === "admin" ||
      u.profile?.isAdmin === true
    );
  }

  async function requireAdmin() {
    if (!isAdmin()) {
      throw new Error("Доступ только для администратора");
    }

    if (!window.ServerAPI?.isReady?.()) {
      await window.ServerAPI.initFirebase();
    }

    const db = window.ServerAPI.db();
    if (!db) throw new Error("Firestore не инициализирован");

    return db;
  }

  function formatDate(value) {
    try {
      if (!value) return "—";
      if (value.toDate) return value.toDate().toLocaleString("ru-RU");
      if (typeof value === "string") return new Date(value).toLocaleString("ru-RU");
      return "—";
    } catch {
      return "—";
    }
  }

  function statusLabel(profile) {
    if (profile.status === "blocked" || profile.blocked === true) return "blocked";
    if (profile.status === "approved" || profile.isApproved === true) return "approved";
    return "pending";
  }

  function statusText(status) {
    if (status === "approved") return "одобрен";
    if (status === "blocked") return "заблокирован";
    return "ожидает";
  }

  function roleText(role) {
    return role === "admin" ? "admin" : "master";
  }

  function esc(text) {
    return String(text ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function renderUserCard(doc) {
    const p = doc.data || {};
    const status = statusLabel(p);
    const role = roleText(p.role);

    const safeName = esc(p.name || p.displayName || "Без имени");
    const safeEmail = esc(p.email || "без email");

    return `
      <div class="admin-user-card" data-uid="${esc(doc.id)}">
        <div class="admin-user-top">
          <div>
            <div class="admin-user-name">${safeName}</div>
            <div class="admin-user-email">${safeEmail}</div>
          </div>
          <span class="admin-chip ${status === "approved" ? "ok" : status === "blocked" ? "blocked" : "wait"}">${statusText(status)}</span>
        </div>

        <div class="admin-user-meta">
          <span class="admin-chip">${role}</span>
          <span class="admin-chip">uid: ${esc(doc.id.slice(0, 8))}</span>
          <span class="admin-chip">вход: ${esc(formatDate(p.lastLoginAt))}</span>
        </div>

        <div class="admin-actions">
          <button class="btn btn-primary ep-clickable" data-admin-action="approve" data-uid="${esc(doc.id)}">Одобрить</button>
          <button class="btn btn-ghost ep-clickable" data-admin-action="block" data-uid="${esc(doc.id)}">Заблокировать</button>
          <button class="btn btn-ghost ep-clickable" data-admin-action="unblock" data-uid="${esc(doc.id)}">Разблокировать</button>
          <button class="btn btn-ghost ep-clickable" data-admin-action="make-master" data-uid="${esc(doc.id)}">Сделать мастером</button>
          <button class="btn btn-primary ep-clickable" data-admin-action="make-admin" data-uid="${esc(doc.id)}">Назначить админом</button>
        </div>
      </div>
    `;
  }

  async function loadUsers() {
    const list = document.getElementById("adminUsersList");
    if (!list) return;

    try {
      const db = await requireAdmin();

      list.innerHTML = `<div class="admin-empty">Загрузка пользователей...</div>`;

      const snap = await db.collection("users").get();

      if (snap.empty) {
        list.innerHTML = `<div class="admin-empty">Пользователей пока нет.</div>`;
        return;
      }

      const docs = [];
      snap.forEach(doc => docs.push({ id: doc.id, data: doc.data() || {} }));

      docs.sort((a, b) => {
        const order = { pending: 0, approved: 1, blocked: 2 };
        const sa = statusLabel(a.data);
        const sb = statusLabel(b.data);
        return (order[sa] ?? 9) - (order[sb] ?? 9);
      });

      list.innerHTML = docs.map(renderUserCard).join("");

      window.Diagnostics?.ok?.({
        file: FILE,
        module: "AdminAPI",
        functionName: "loadUsers()",
        place: "users",
        code: "users-loaded",
        message: "Пользователи загружены: " + docs.length
      });
    } catch (error) {
      list.innerHTML = `<div class="admin-empty">Ошибка загрузки: ${esc(error.message)}</div>`;

      window.Diagnostics?.error?.({
        file: FILE,
        module: "AdminAPI",
        functionName: "loadUsers()",
        place: "users",
        code: error.code || "users-load-error",
        message: error.message
      });
    }
  }

  async function updateUser(uid, patch, actionName) {
    try {
      const db = await requireAdmin();

      await db.collection("users").doc(uid).set({
        ...patch,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedBy: user()?.uid || "admin"
      }, { merge: true });

      window.Diagnostics?.ok?.({
        file: FILE,
        module: "AdminAPI",
        functionName: "updateUser()",
        place: "users/" + uid,
        code: "user-updated",
        message: "Пользователь обновлён: " + actionName
      });

      window.SoundAPI?.success?.();
      await loadUsers();
    } catch (error) {
      window.Diagnostics?.error?.({
        file: FILE,
        module: "AdminAPI",
        functionName: "updateUser()",
        place: "users/" + uid,
        code: error.code || "user-update-error",
        message: error.message
      });

      window.AppShell?.openDiagnostics?.();
    }
  }

  async function handleAction(action, uid) {
    if (!action || !uid) return;

    if (action === "approve") {
      return updateUser(uid, {
        status: "approved",
        isApproved: true,
        blocked: false
      }, "approve");
    }

    if (action === "block") {
      if (!confirm("Заблокировать пользователя?")) return;
      return updateUser(uid, {
        status: "blocked",
        isApproved: false,
        blocked: true
      }, "block");
    }

    if (action === "unblock") {
      return updateUser(uid, {
        status: "approved",
        isApproved: true,
        blocked: false
      }, "unblock");
    }

    if (action === "make-master") {
      if (!confirm("Сделать пользователя мастером?")) return;
      return updateUser(uid, {
        role: "master",
        isAdmin: false,
        status: "approved",
        isApproved: true
      }, "make-master");
    }

    if (action === "make-admin") {
      if (!confirm("Назначить пользователя администратором?")) return;
      return updateUser(uid, {
        role: "admin",
        isAdmin: true,
        status: "approved",
        isApproved: true
      }, "make-admin");
    }
  }

  function bindPage() {
    document.getElementById("refreshUsersBtn")?.addEventListener("click", loadUsers);

    document.getElementById("adminUsersList")?.addEventListener("click", event => {
      const btn = event.target.closest("[data-admin-action]");
      if (!btn) return;
      handleAction(btn.dataset.adminAction, btn.dataset.uid);
    });

    loadUsers();
  }

  window.AdminAPI = {
    isAdmin,
    loadUsers,
    bindPage,
    handleAction
  };
})();
