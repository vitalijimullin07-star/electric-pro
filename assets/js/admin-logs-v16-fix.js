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
    return !!btn || title.includes("Журнал") || title.includes("Диагност");
  }

  function setLogsActiveButton() {
    document.querySelectorAll("[data-admin-v15-section]").forEach(btn => {
      btn.classList.toggle("is-selected", btn.dataset.adminV15Section === "logs");
    });
  }

  function getValue(data, keys, fallback = "—") {
    for (const key of keys) {
      const value = key.split(".").reduce((obj, part) => obj && obj[part], data);
      if (value !== undefined && value !== null && value !== "") return value;
    }
    return fallback;
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
      data.date ||
      "—";

    return String(value);
  }

  function normalizeEvent(item) {
    const d = item.data || {};
    const level = getValue(d, ["level", "status", "severity"], d.type || "event");
    const code = getValue(d, ["code", "event", "action", "type"], item.id || "event");

    return {
      id: item.id || "—",
      path: item.path || "—",
      time: timeText(d),
      level,
      file: getValue(d, ["file", "sourceFile", "src"], item.path || "—"),
      module: getValue(d, ["module", "moduleName", "component"], "—"),
      functionName: getValue(d, ["functionName", "function", "fn"], "—"),
      place: getValue(d, ["place", "location", "screen", "section"], item.path || "—"),
      code,
      text: getValue(d, ["message", "text", "reason", "error", "details"], JSON.stringify(d).slice(0, 360)),
      user: getValue(d, ["user", "email", "userEmail", "uid", "targetUid"], selectedUid() || "—"),
      session: getValue(d, ["session", "sessionId"], "—"),
      raw: d
    };
  }

  function isNoise(item) {
    const e = normalizeEvent(item);
    const code = String(e.code || "");
    const text = String(e.text || "");
    const path = String(e.path || "");

    // Эти записи появляются каждый раз при чтении журнала и засоряют список.
    if (code === "admin_read_logs_v16") return true;
    if (text.includes("admin_read_logs_v16")) return true;
    if (path === "admin_logs" && code === "admin_read_section") return true;

    return false;
  }

  function sortDiagnosticsFirst(items) {
    return (items || [])
      .filter(item => !isNoise(item))
      .sort((a, b) => {
        const ea = normalizeEvent(a);
        const eb = normalizeEvent(b);

        const ad = Date.parse(ea.time) || Number(ea.raw?.createdAt?.millis || ea.raw?.time?.millis || 0);
        const bd = Date.parse(eb.time) || Number(eb.raw?.createdAt?.millis || eb.raw?.time?.millis || 0);

        return bd - ad;
      });
  }

  function compact(text, max = 180) {
    const s = String(text || "—").replace(/\s+/g, " ").trim();
    return s.length > max ? s.slice(0, max) + "..." : s;
  }

  function levelClass(level) {
    const l = String(level || "").toLowerCase();
    if (l.includes("error") || l.includes("ошиб") || l.includes("denied")) return "error";
    if (l.includes("ok") || l.includes("success")) return "ok";
    if (l.includes("warn") || l.includes("wait")) return "warn";
    if (l.includes("sync")) return "sync";
    return "event";
  }

  function renderDiagnosticsCard(item, index) {
    const e = normalizeEvent(item);
    const cls = levelClass(e.level);

    return `
      <button class="admin-v16-diagnostic-item ${cls}" type="button" data-v16-log-index="${index}">
        <div class="admin-v16-diagnostic-head">
          <b>${esc(e.code)}</b>
          <span>${esc(e.level)}</span>
        </div>

        <div class="admin-v16-diagnostic-lines">
          <div><span>Время</span><b>${esc(e.time)}</b></div>
          <div><span>Файл</span><b>${esc(compact(e.file, 70))}</b></div>
          <div><span>Модуль</span><b>${esc(compact(e.module, 70))}</b></div>
          <div><span>Функция</span><b>${esc(compact(e.functionName, 70))}</b></div>
          <div><span>Место</span><b>${esc(compact(e.place, 90))}</b></div>
          <div><span>Текст</span><b>${esc(compact(e.text, 130))}</b></div>
        </div>

        <small>Пользователь: ${esc(compact(e.user, 70))} · Сессия: ${esc(compact(e.session, 40))}</small>
      </button>
    `;
  }

  function renderItems(items) {
    lastItems = sortDiagnosticsFirst(items || []);

    if (!lastItems.length) {
      return `<div class="admin-empty">Диагностика пуста или ещё не создана.</div>`;
    }

    return `
      <div class="admin-v16-diagnostics-list">
        ${lastItems.map((item, index) => renderDiagnosticsCard(item, index)).join("")}
      </div>
    `;
  }

  function prettyDiagnostics(item) {
    const e = normalizeEvent(item);
    return [
      "Electric Pro diagnostics event",
      "",
      `Время: ${e.time}`,
      `Уровень: ${e.level}`,
      `Файл: ${e.file}`,
      `Модуль: ${e.module}`,
      `Функция: ${e.functionName}`,
      `Место: ${e.place}`,
      `Код: ${e.code}`,
      `Текст: ${e.text}`,
      `Пользователь: ${e.user}`,
      `Сессия: ${e.session}`,
      `Источник: ${e.path}`,
      `ID: ${e.id}`,
      "",
      "RAW:",
      JSON.stringify(e.raw, null, 2)
    ].join("\n");
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
            <h3 id="adminV16LogModalTitle">Диагностика</h3>
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
    const e = normalizeEvent(item);

    if (title) title.textContent = "Диагностика: " + e.code;
    if (sub) sub.textContent = `${e.time} · ${e.level}`;
    if (text) text.textContent = prettyDiagnostics(item);

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
    alert("Событие диагностики скопировано.");
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
      if (title) title.textContent = "Диагностика / журнал событий";
      if (hint) hint.textContent = "Выбери мастера.";
      content.innerHTML = `<div class="admin-empty">Выбери мастера для просмотра диагностики.</div>`;
      return;
    }

    try {
      if (title) title.textContent = "Диагностика / журнал событий";
      if (hint) hint.textContent = "Здесь показываются события как в окне «Диагностика». Нажми на событие, чтобы открыть детали.";

      if (!force && lastItems.length && lastLoadedUid === uid) {
        content.innerHTML = renderItems(lastItems);
        return;
      }

      content.innerHTML = `<div class="admin-empty">Читаю диагностику...</div>`;

      const result = await callFunction("adminReadLogsV16", { uid, limit: 100 });
      lastLoadedUid = uid;
      content.innerHTML = renderItems(result.items || []);

      window.Diagnostics?.ok?.({
        file: FILE,
        module: "AdminLogsV16Fix",
        functionName: "renderLogs()",
        place: "admin logs",
        code: "admin-diagnostics-loaded",
        message: "Диагностика загружена: " + lastItems.length
      });
    } catch (error) {
      content.innerHTML = `
        <div class="admin-empty">
          Ошибка чтения диагностики: ${esc(error.message)}
          <br><br>
          Если функция не найдена — задеплой V16.4 functions через Ubuntu.
        </div>
      `;

      window.Diagnostics?.error?.({
        file: FILE,
        module: "AdminLogsV16Fix",
        functionName: "renderLogs()",
        place: "admin logs",
        code: error.code || "admin-diagnostics-error",
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
