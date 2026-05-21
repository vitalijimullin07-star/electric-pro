(function () {
  const FILE = "assets/js/admin-logs-v16-fix.js";

  function esc(text) {
    return String(text ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function isAdmin() {
    const u = window.Auth?.getUser?.();
    return !!u && (
      u.role === "admin" ||
      u.profile?.role === "admin" ||
      u.profile?.isAdmin === true ||
      u.email === "vits0007@gmail.com"
    );
  }

  async function callFunction(name, payload = {}) {
    if (!window.ServerAPI?.isReady?.()) await window.ServerAPI.initFirebase();
    if (!window.firebase?.functions) throw new Error("Firebase Functions SDK не подключён.");
    const fn = firebase.app().functions("europe-west1").httpsCallable(name);
    const result = await fn(payload);
    return result.data || {};
  }

  function selectedUid() {
    return document.getElementById("adminV15MasterSelect")?.value || "";
  }

  function isLogsActive() {
    const btn = document.querySelector('[data-admin-v15-section="logs"].is-selected');
    const title = document.getElementById("adminV15SectionTitle")?.textContent || "";
    return !!btn || title.includes("Журнал");
  }

  function timeText(data) {
    const value =
      data.createdAt?.text ||
      data.updatedAt?.text ||
      data.time?.text ||
      data.timestamp?.text ||
      data.createdAt?.iso ||
      data.updatedAt?.iso ||
      data.time?.iso ||
      data.timestamp?.iso ||
      data.createdAt ||
      data.updatedAt ||
      data.time ||
      data.timestamp ||
      "—";

    return String(value);
  }

  function titleText(item) {
    const d = item.data || {};
    return (
      d.title ||
      d.code ||
      d.type ||
      d.event ||
      d.action ||
      d.module ||
      item.path ||
      item.id ||
      "Событие"
    );
  }

  function bodyText(item) {
    const d = item.data || {};
    return (
      d.message ||
      d.text ||
      d.reason ||
      d.error ||
      d.place ||
      d.functionName ||
      JSON.stringify(d).slice(0, 260)
    );
  }

  function renderItems(items) {
    if (!items.length) {
      return `<div class="admin-empty">Журнал событий пуст или ещё не создан.</div>`;
    }

    return `
      <div class="admin-v16-logs-list">
        ${items.map(item => {
          const d = item.data || {};
          const level = d.level || d.status || d.type || "event";

          return `
            <div class="admin-v16-log-item">
              <div class="admin-v16-log-top">
                <b>${esc(titleText(item))}</b>
                <span>${esc(level)}</span>
              </div>
              <p>${esc(bodyText(item))}</p>
              <small>${esc(timeText(d))} · ${esc(item.path || "")}</small>
            </div>
          `;
        }).join("")}
      </div>
    `;
  }

  async function renderLogs() {
    const content = document.getElementById("adminV15Content");
    const title = document.getElementById("adminV15SectionTitle");
    const hint = document.getElementById("adminV15SectionHint");
    const uid = selectedUid();

    if (!content || !isLogsActive()) return;
    if (!isAdmin()) return;

    if (!uid) {
      content.innerHTML = `<div class="admin-empty">Выбери мастера для просмотра журнала событий.</div>`;
      return;
    }

    try {
      if (title) title.textContent = "Журнал событий после входа";
      if (hint) hint.textContent = "Чтение через серверную функцию, без permission-denied от клиента.";
      content.innerHTML = `<div class="admin-empty">Читаю журнал событий...</div>`;

      const result = await callFunction("adminReadLogsV16", { uid, limit: 80 });
      content.innerHTML = renderItems(result.items || []);

      window.Diagnostics?.ok?.({
        file: FILE,
        module: "AdminLogsV16Fix",
        functionName: "renderLogs()",
        place: "admin logs",
        code: "admin-logs-loaded",
        message: "Журнал событий загружен: " + (result.items || []).length
      });
    } catch (error) {
      content.innerHTML = `
        <div class="admin-empty">
          Ошибка чтения журнала: ${esc(error.message)}
          <br><br>
          Если функция не найдена — задеплой V16.4 functions через Ubuntu.
        </div>
      `;

      window.Diagnostics?.error?.({
        file: FILE,
        module: "AdminLogsV16Fix",
        functionName: "renderLogs()",
        place: "admin logs",
        code: error.code || "admin-logs-v16-error",
        message: error.message
      });
    }
  }

  function bind() {
    document.addEventListener("click", event => {
      const btn = event.target.closest('[data-admin-v15-section="logs"]');
      if (!btn) return;

      setTimeout(renderLogs, 150);
      setTimeout(renderLogs, 800);
    });

    document.addEventListener("change", event => {
      if (event.target?.id === "adminV15MasterSelect" && isLogsActive()) {
        setTimeout(renderLogs, 300);
      }
    });

    window.addEventListener("hashchange", () => {
      setTimeout(() => {
        if (isLogsActive()) renderLogs();
      }, 600);
    });
  }

  window.AdminLogsV16Fix = { renderLogs };
  window.addEventListener("DOMContentLoaded", bind);
})();
