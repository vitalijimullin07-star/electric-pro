(function () {
  const VERSION = "V24.4.3";
  const FILE = "assets/js/db-v24-4-3-diagnostics-dot.js";
  const LOG_KEY = "ep_db_v24_4_3_diag_logs";
  const MAX_LOGS = 80;

  function safeJsonParse(v, fallback) {
    try { return JSON.parse(v || ""); } catch (e) { return fallback; }
  }

  function readLogs() {
    return safeJsonParse(localStorage.getItem(LOG_KEY), []);
  }

  function writeLogs(logs) {
    try { localStorage.setItem(LOG_KEY, JSON.stringify(logs.slice(-MAX_LOGS))); } catch (e) {}
  }

  function addLog(level, code, message, extra) {
    const item = {
      time: new Date().toLocaleString("ru-RU"),
      iso: new Date().toISOString(),
      level: level || "info",
      code: code || "db-info",
      message: String(message || ""),
      extra: extra || {}
    };
    const logs = readLogs();
    logs.push(item);
    writeLogs(logs);

    try {
      window.Diagnostics?.ok?.({
        file: FILE,
        module: "DbDiagnosticsDotV2443",
        functionName: "runtime",
        place: "database",
        code: item.code,
        message: item.message
      });
    } catch (e) {}

    refreshDotState();
  }

  function esc(v) {
    return String(v ?? "").replace(/[&<>"']/g, c => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[c]));
  }

  function activeDbScreen() {
    return document.getElementById("ep-db-v244-screen") ||
           document.getElementById("ep-db-v243-screen") ||
           document.querySelector("[id*='db'][id*='screen']");
  }

  function dbVisible() {
    const s = activeDbScreen();
    return !!(s && !s.classList.contains("hidden") && getComputedStyle(s).display !== "none");
  }

  function getCurrentUser() {
    try {
      const u = window.firebase?.auth?.().currentUser;
      if (u) return { uid: u.uid || "", email: u.email || "" };
    } catch (e) {}

    try {
      const u = window.auth?.currentUser;
      if (u) return { uid: u.uid || "", email: u.email || "" };
    } catch (e) {}

    return { uid: "", email: "" };
  }

  function dbCounts() {
    const out = {};
    const keys = {
      my: "ep_db_v24_my",
      server: "ep_db_v24_server",
      masters: "ep_db_v24_masters_demo"
    };

    for (const [name, key] of Object.entries(keys)) {
      const data = safeJsonParse(localStorage.getItem(key), name === "masters" ? {} : []);
      if (Array.isArray(data)) {
        out[name] = {
          total: data.length,
          work: data.filter(x => x && x.type === "work").length,
          material: data.filter(x => x && x.type === "material").length
        };
      } else if (data && typeof data === "object") {
        out[name] = {
          masters: Object.keys(data).length,
          total: Object.values(data).reduce((sum, rows) => sum + (Array.isArray(rows) ? rows.length : 0), 0)
        };
      }
    }

    return out;
  }

  function collectDiagnostics() {
    const s = activeDbScreen();
    const user = getCurrentUser();

    let header = "";
    let activeBase = "";
    let status = "";
    let section = "";

    try { header = s?.querySelector("h2")?.textContent?.trim() || ""; } catch (e) {}
    try { activeBase = s?.querySelector(".db244-head b,.db243-head b")?.textContent?.trim() || ""; } catch (e) {}
    try { status = s?.querySelector("#db244-save-status,.db244-save-status,#db2433-save-status,.db2433-save-status")?.textContent?.trim() || ""; } catch (e) {}
    try { section = s?.querySelector(".db244-tabs .active,.db243-section-tabs .active")?.textContent?.trim() || ""; } catch (e) {}

    const storage = {};
    [
      "ep_db_v24_4_active_view",
      "ep_db_v24_3_active_view",
      "ep_db_v24_4_editor_open",
      "ep_db_v24_4_last_save",
      "ep_db_v24_4_cloud_status",
      "ep_db_v24_4_1_cloud_path",
      "ep_db_v24_my",
      "ep_db_v24_server",
      "ep_db_v24_masters_demo"
    ].forEach(key => {
      try {
        const raw = localStorage.getItem(key);
        if (raw == null) return;
        if (raw.length > 1200) storage[key] = raw.slice(0, 1200) + "...(обрезано)";
        else storage[key] = raw;
      } catch (e) {}
    });

    return {
      title: "Electric Pro DB diagnostics",
      version: VERSION,
      databaseModuleVersion: window.DatabaseV24CleanMonolith?.version || window.DatabaseFileManagerV243?.version || "",
      pageVersion: safeJsonParse(localStorage.getItem("version"), null),
      exportedAt: new Date().toISOString(),
      url: location.href,
      user,
      screen: {
        visible: dbVisible(),
        header,
        activeBase,
        section,
        status
      },
      counts: dbCounts(),
      storage,
      logs: readLogs()
    };
  }

  function diagnosticsText() {
    const d = collectDiagnostics();
    const lines = [];

    lines.push("Electric Pro DB diagnostics");
    lines.push("Версия точки: " + d.version);
    lines.push("Версия модуля БД: " + (d.databaseModuleVersion || "не определена"));
    lines.push("Время: " + new Date().toLocaleString("ru-RU"));
    lines.push("URL: " + d.url);
    lines.push("Пользователь: " + (d.user.email || "не определён"));
    lines.push("");
    lines.push("Экран БД:");
    lines.push("- открыт: " + (d.screen.visible ? "да" : "нет"));
    lines.push("- активная БД: " + (d.screen.activeBase || "не определена"));
    lines.push("- раздел: " + (d.screen.section || "не определён"));
    lines.push("- статус: " + (d.screen.status || "нет"));
    lines.push("");
    lines.push("Количество:");
    lines.push(JSON.stringify(d.counts, null, 2));
    lines.push("");
    lines.push("Storage:");
    lines.push(JSON.stringify(d.storage, null, 2));
    lines.push("");
    lines.push("Логи БД:");
    if (!d.logs.length) lines.push("Логов нет.");
    d.logs.forEach((log, i) => {
      lines.push(`---- DB событие #${i + 1} ----`);
      lines.push("Время: " + log.time);
      lines.push("Уровень: " + log.level);
      lines.push("Код: " + log.code);
      lines.push("Текст: " + log.message);
      if (log.extra && Object.keys(log.extra).length) {
        lines.push("Детали: " + JSON.stringify(log.extra, null, 2));
      }
    });

    return lines.join("\n");
  }

  function ensureDot() {
    const s = activeDbScreen();
    if (!s) return;

    let dot = document.getElementById("db2443-diag-dot");
    if (!dot) {
      dot = document.createElement("button");
      dot.id = "db2443-diag-dot";
      dot.type = "button";
      dot.title = "Диагностика БД";
      dot.setAttribute("aria-label", "Диагностика БД");
      dot.innerHTML = "●";
      document.body.appendChild(dot);
    }

    dot.classList.toggle("hidden", !dbVisible());
    refreshDotState();
  }

  function refreshDotState() {
    const dot = document.getElementById("db2443-diag-dot");
    if (!dot) return;

    const logs = readLogs();
    const hasError = logs.some(x => x.level === "error" || x.level === "warn");
    const status = collectDiagnostics().screen.status || "";

    dot.dataset.state = hasError || /ошибка|недоступ|не удалось/i.test(status) ? "error" : "ok";
  }

  function openPanel() {
    renderPanel();
    document.getElementById("db2443-diag-panel")?.classList.remove("hidden");
  }

  function closePanel() {
    document.getElementById("db2443-diag-panel")?.classList.add("hidden");
  }

  function renderPanel() {
    let panel = document.getElementById("db2443-diag-panel");
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "db2443-diag-panel";
      panel.className = "db2443-diag-panel hidden";
      document.body.appendChild(panel);
    }

    const d = collectDiagnostics();
    const text = diagnosticsText();

    panel.innerHTML = `
      <div class="db2443-diag-backdrop" data-db2443-diag-close></div>
      <div class="db2443-diag-sheet">
        <div class="db2443-diag-head">
          <div>
            <h3>Диагностика БД</h3>
            <p>${esc(d.screen.activeBase || "База не определена")} · ${esc(d.databaseModuleVersion || "версия не найдена")}</p>
          </div>
          <button type="button" data-db2443-diag-close>×</button>
        </div>

        <div class="db2443-diag-pills">
          <span>${d.screen.visible ? "БД открыта" : "БД не открыта"}</span>
          <span>${esc(d.screen.status || "статус пуст")}</span>
          <span>Логи: ${d.logs.length}</span>
        </div>

        <div class="db2443-diag-actions">
          <button type="button" data-db2443-diag-refresh>Обновить</button>
          <button type="button" data-db2443-diag-copy>Копировать</button>
          <button type="button" data-db2443-diag-export>Экспорт JSON</button>
          <button type="button" data-db2443-diag-clear>Очистить</button>
        </div>

        <textarea readonly class="db2443-diag-text">${esc(text)}</textarea>
      </div>
    `;
  }

  async function copyDiagnostics() {
    const text = diagnosticsText();
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand("copy");
        ta.remove();
      }
      addLog("ok", "db-diagnostics-copied", "Диагностика БД скопирована.");
    } catch (e) {
      addLog("error", "db-diagnostics-copy-failed", "Не удалось скопировать диагностику.", { error: String(e.message || e) });
    }
    renderPanel();
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(collectDiagnostics(), null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "electric-pro-db-diagnostics-" + new Date().toISOString().replace(/[:.]/g, "-") + ".json";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 500);
    addLog("ok", "db-diagnostics-exported", "Диагностика БД экспортирована JSON.");
    renderPanel();
  }

  function clearLogs() {
    writeLogs([]);
    addLog("ok", "db-diagnostics-cleared", "Логи диагностики БД очищены.");
    renderPanel();
  }

  function hookErrors() {
    if (window.__db2443DiagErrorsHooked) return;
    window.__db2443DiagErrorsHooked = true;

    window.addEventListener("error", function (event) {
      const filename = String(event.filename || "");
      const message = String(event.message || "");
      if (/database|db244|db243|firestore|firebase/i.test(filename + " " + message)) {
        addLog("error", "db-window-error", message, {
          filename,
          line: event.lineno || "",
          column: event.colno || ""
        });
      }
    });

    window.addEventListener("unhandledrejection", function (event) {
      const reason = event.reason;
      const message = reason?.message || reason || "";
      if (/database|db244|db243|firestore|firebase|permission|denied|server/i.test(String(message))) {
        addLog("error", "db-unhandled-rejection", String(message), {
          stack: reason?.stack ? String(reason.stack).slice(0, 1500) : ""
        });
      }
    });
  }

  function patchDbModule() {
    const mod = window.DatabaseV24CleanMonolith;
    if (!mod || mod.__db2443DiagPatched) return;

    const oldOpen = typeof mod.open === "function" ? mod.open.bind(mod) : null;
    if (oldOpen) {
      mod.open = function (...args) {
        addLog("info", "db-open", "Открыт экран БД.");
        const result = oldOpen(...args);
        setTimeout(ensureDot, 80);
        setTimeout(ensureDot, 300);
        return result;
      };
    }

    const oldSetBase = typeof mod.setBase === "function" ? mod.setBase.bind(mod) : null;
    if (oldSetBase) {
      mod.setBase = function (base, items) {
        addLog("info", "db-set-base", "Сохранение базы: " + base, {
          count: Array.isArray(items) ? items.length : 0
        });
        return oldSetBase(base, items);
      };
    }

    mod.__db2443DiagPatched = true;
  }

  function bind() {
    if (window.__db2443DiagBound) return;
    window.__db2443DiagBound = true;

    document.addEventListener("click", function (event) {
      if (event.target.closest("#db2443-diag-dot")) {
        event.preventDefault();
        openPanel();
        return;
      }

      if (event.target.closest("[data-db2443-diag-close]")) {
        event.preventDefault();
        closePanel();
        return;
      }

      if (event.target.closest("[data-db2443-diag-refresh]")) {
        event.preventDefault();
        addLog("info", "db-diagnostics-refresh", "Диагностика БД обновлена.");
        renderPanel();
        return;
      }

      if (event.target.closest("[data-db2443-diag-copy]")) {
        event.preventDefault();
        copyDiagnostics();
        return;
      }

      if (event.target.closest("[data-db2443-diag-export]")) {
        event.preventDefault();
        exportJson();
        return;
      }

      if (event.target.closest("[data-db2443-diag-clear]")) {
        event.preventDefault();
        clearLogs();
      }
    }, true);
  }

  function observe() {
    if (window.__db2443DiagObserver) return;
    const obs = new MutationObserver(function () {
      clearTimeout(window.__db2443DiagObserverTimer);
      window.__db2443DiagObserverTimer = setTimeout(function () {
        patchDbModule();
        ensureDot();
      }, 120);
    });
    obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style"] });
    window.__db2443DiagObserver = obs;
  }

  function boot() {
    bind();
    hookErrors();
    patchDbModule();
    ensureDot();
    observe();
  }

  window.addEventListener("DOMContentLoaded", function () {
    boot();
    [300, 900, 1800, 3500].forEach(ms => setTimeout(boot, ms));
  });

  window.DbDiagnosticsDotV2443 = {
    version: VERSION,
    openPanel,
    collectDiagnostics,
    addLog,
    clearLogs
  };

  addLog("ok", "db-diagnostics-dot-ready", "Точка диагностики БД готова.");
})();
