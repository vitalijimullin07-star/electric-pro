(function () {
  const FILE = "assets/js/admin-logs-v16-fix.js";
  let lastItems = [];
  let lastLoadedUid = "";

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

  function setLogsActiveButton() {
    document.querySelectorAll("[data-admin-v15-section]").forEach(btn => {
      btn.classList.toggle("is-selected", btn.dataset.adminV15Section === "logs");
    });
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

  function shortBody(item) {
    const text = bodyText(item);
    return text.length > 135 ? text.slice(0, 135) + "..." : text;
  }

  function prettyJson(obj) {
    try {
      return JSON.stringify(obj, null, 2);
    } catch {
      return String(obj);
    }
  }

  function renderItems(items) {
    lastItems = items || [];

    if (!lastItems.length) {
      return `<div class="admin-empty">Журнал событий пуст или ещё не создан.</div>`;
    }

    return `
      <div class="admin-v16-logs-list">
        ${lastItems.map((item, index) => {
          const d = item.data || {};
          const level = d.level || d.status || d.type || "event";

          return `
            <button class="admin-v16-log-item" type="button" data-v16-log-index="${index}">
              <div class="admin-v16-log-top">
                <b>${esc(titleText(item))}</b>
                <span>${esc(level)}</span>
              </div>
              <p>${esc(shortBody(item))}</p>
              <small>${esc(timeText(d))} · ${esc(item.path || "")}</small>
            </button>
          `;
        }).join("")}
      </div>
    `;
  }

  function ensureModal() {
    let modal = document.getElementById("adminV16LogModal");
    if (modal) return modal;

    modal = document.createElement("div");
    modal.id = "adminV16LogModal";
    modal.className = "admin-v16-log-modal is-hidden";
    modal.innerHTML = `
      <div class="admin-v16-log-modal-card">
        <div class="admin-v16-log-modal-head">
          <div>
            <h3 id="adminV16LogModalTitle">Событие</h3>
            <p id="adminV16LogModalSub">Детали события</p>
          </div>
          <button class="admin-v16-log-modal-close" type="button" data-v16-log-close>×</button>
        </div>

        <div class="admin-v16-log-modal-body">
          <pre id="adminV16LogModalText"></pre>
        </div>

        <div class="admin-v16-log-modal-actions">
          <button class="btn btn-primary ep-clickable" type="button" data-v16-log-copy>Копировать</button>
          <button class="btn btn-ghost ep-clickable" type="button" data-v16-log-close>Закрыть</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    return modal;
  }

  function openLog(index) {
    const item = lastItems[Number(index)];
    if (!item) return;

    const modal = ensureModal();
    const title = document.getElementById("adminV16LogModalTitle");
    const sub = document.getElementById("adminV16LogModalSub");
    const text = document.getElementById("adminV16LogModalText");

    const d = item.data || {};
    if (title) title.textContent = titleText(item);
    if (sub) sub.textContent = `${timeText(d)} · ${item.path || ""}`;
    if (text) {
      text.textContent = prettyJson({
        id: item.id,
        path: item.path,
        data: d
      });
    }

    modal.classList.remove("is-hidden");
    window.SoundAPI?.click?.();
  }

  async function copyModalText() {
    const text = document.getElementById("adminV16LogModalText")?.textContent || "";
    if (!text) return;

    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }

    window.SoundAPI?.success?.();
    alert("Событие скопировано.");
  }

  function closeModal() {
    document.getElementById("adminV16LogModal")?.classList.add("is-hidden");
  }

  async function renderLogs(force = false) {
    const content = document.getElementById("adminV15Content");
    const title = document.getElementById("adminV15SectionTitle");
    const hint = document.getElementById("adminV15SectionHint");
    const uid = selectedUid();

    if (!content) return;
    if (!isAdmin()) return;

    setLogsActiveButton();

    if (!uid) {
      if (title) title.textContent = "Журнал событий после входа";
      if (hint) hint.textContent = "Выбери мастера.";
      content.innerHTML = `<div class="admin-empty">Выбери мастера для просмотра журнала событий.</div>`;
      return;
    }

    try {
      if (title) title.textContent = "Журнал событий после входа";
      if (hint) hint.textContent = "Нажми на событие, чтобы открыть детали. Копирование — только кнопкой внутри карточки.";

      if (!force && lastItems.length && lastLoadedUid === uid) {
        content.innerHTML = renderItems(lastItems);
        return;
      }

      content.innerHTML = `<div class="admin-empty">Читаю журнал событий...</div>`;

      const result = await callFunction("adminReadLogsV16", { uid, limit: 80 });
      lastLoadedUid = uid;
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
          Если функция не найдена — задеплой V16.4/V16.5 functions через Ubuntu.
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
      const item = event.target.closest("[data-v16-log-index]");
      if (item) {
        event.preventDefault();
        event.stopPropagation();
        openLog(item.dataset.v16LogIndex);
        return;
      }

      if (event.target.closest("[data-v16-log-close]")) {
        event.preventDefault();
        closeModal();
        return;
      }

      if (event.target.closest("[data-v16-log-copy]")) {
        event.preventDefault();
        copyModalText();
        return;
      }

      const logsBtn = event.target.closest('[data-admin-v15-section="logs"]');
      if (logsBtn) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        setTimeout(() => renderLogs(true), 80);
        return;
      }

      const refreshBtn = event.target.closest("#adminV15RefreshBtn");
      if (refreshBtn && isLogsActive()) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        setTimeout(() => renderLogs(true), 80);
        return;
      }
    }, true);

    document.addEventListener("change", event => {
      if (event.target?.id === "adminV15MasterSelect" && isLogsActive()) {
        lastItems = [];
        lastLoadedUid = "";
        setTimeout(() => renderLogs(true), 250);
      }
    });

    window.addEventListener("hashchange", () => {
      setTimeout(() => {
        if (isLogsActive()) renderLogs(false);
      }, 600);
    });
  }

  window.AdminLogsV16Fix = { renderLogs, openLog };
  window.addEventListener("DOMContentLoaded", bind);
})();
