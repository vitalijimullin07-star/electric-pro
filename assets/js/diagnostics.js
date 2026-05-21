(function () {
  const FILE = "assets/js/diagnostics.js";
  const LOG_KEY = "ep_diagnostics_log_v5";
  const SESSION_KEY = "ep_last_session_v5";

  const sessionId =
    (crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : "session_" + Date.now() + "_" + Math.random().toString(16).slice(2);

  const state = {
    level: "wait",
    entries: [],
    firebase: "проверка",
    cache: "готов",
    sync: "ожидание",
    version: "unknown",
    startedAt: new Date().toLocaleString("ru-RU"),
    sessionId
  };

  function now() {
    return new Date().toLocaleString("ru-RU");
  }

  function shortSession() {
    return String(state.sessionId || "").slice(0, 8);
  }

  function getUserLabel() {
    try {
      return window.Auth?.getUserLabel?.() || "не вошёл";
    } catch {
      return "неизвестно";
    }
  }

  function loadStoredLog() {
    try {
      const old = JSON.parse(localStorage.getItem(LOG_KEY) || "[]");
      return Array.isArray(old) ? old.slice(0, 50) : [];
    } catch {
      return [];
    }
  }

  function saveStoredLog() {
    try {
      localStorage.setItem(LOG_KEY, JSON.stringify(state.entries.slice(0, 80)));
    } catch {}
  }

  function rememberSession() {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({
        sessionId: state.sessionId,
        startedAt: state.startedAt,
        user: getUserLabel(),
        version: state.version
      }));
    } catch {}
  }

  function normalizeEvent(payload) {
    return {
      time: payload.time || now(),
      level: payload.level || "info",
      file: payload.file || FILE,
      module: payload.module || "Diagnostics",
      functionName: payload.functionName || payload.function || "unknown",
      place: payload.place || "unknown",
      code: payload.code || "no-code",
      message: payload.message || payload.error || "Без описания",
      user: payload.user || getUserLabel(),
      sessionId: state.sessionId
    };
  }

  function setDot(cls) {
    ["firebaseDot", "loginFirebaseDot"].forEach(id => {
      const dot = document.getElementById(id);
      if (dot) dot.className = "status-dot " + cls;
    });
  }

  function renderDot() {
    if (state.level === "ok") return setDot("status-ok");
    if (state.level === "error") return setDot("status-error");
    if (state.level === "cache") return setDot("status-cache");
    setDot("status-wait");
  }

  function renderStatusTexts() {
    const loginText = document.getElementById("loginStatusText");
    if (loginText) loginText.textContent = state.firebase;

    const f = document.getElementById("smartFirebaseText");
    const c = document.getElementById("smartCacheText");
    const s = document.getElementById("smartSyncText");

    if (f) f.textContent = state.firebase;
    if (c) c.textContent = state.cache;
    if (s) s.textContent = state.sync;
  }

  function eventText(event, index) {
    return [
      "---- Событие #" + (index + 1) + " ----",
      "Время: " + event.time,
      "Уровень: " + event.level,
      "Файл: " + event.file,
      "Модуль: " + event.module,
      "Функция: " + event.functionName,
      "Место: " + event.place,
      "Код: " + event.code,
      "Текст: " + event.message,
      "Пользователь: " + event.user,
      "Сессия: " + String(event.sessionId || "").slice(0, 8)
    ].join("\n");
  }

  function getText() {
    const header = [
      "Electric Pro diagnostics",
      "Версия: " + state.version,
      "Запуск: " + state.startedAt,
      "Сессия: " + shortSession(),
      "Пользователь: " + getUserLabel(),
      "",
      "Firebase: " + state.firebase,
      "Кэш: " + state.cache,
      "Синхронизация: " + state.sync,
      ""
    ].join("\n");

    if (!state.entries.length) {
      return header + [
        "Событий пока нет.",
        "Файл: " + FILE,
        "Время: " + now()
      ].join("\n");
    }

    return header + state.entries.map(eventText).join("\n\n");
  }

  function render() {
    renderDot();
    renderStatusTexts();

    const box = document.getElementById("diagnosticsText");
    if (box) box.textContent = getText();
  }

  function add(payload) {
    const event = normalizeEvent(payload);
    state.entries.unshift(event);
    state.entries = state.entries.slice(0, 80);
    saveStoredLog();
    render();
  }

  async function loadVersion() {
    try {
      const res = await fetch("version.json?v=" + Date.now(), { cache: "no-store" });
      if (!res.ok) return;

      const data = await res.json();
      if (data && data.version) {
        state.version = data.version;
        rememberSession();
        render();
      }
    } catch {}
  }

  function startNewSession() {
    state.entries = [];

    rememberSession();

    add({
      level: "start",
      file: FILE,
      module: "Diagnostics",
      functionName: "startNewSession()",
      place: "app-start",
      code: "new-session",
      message: "Новый запуск приложения. Журнал диагностики обновлён."
    });

    loadVersion();
  }

  window.Diagnostics = {
    startNewSession,

    ok(payload = {}) {
      state.level = "ok";
      state.firebase = payload.firebaseText || state.firebase || "онлайн";
      add({
        level: "ok",
        ...payload,
        code: payload.code || "ok",
        message: payload.message || "Работает нормально"
      });
    },

    wait(payload = {}) {
      state.level = "wait";
      state.firebase = payload.firebaseText || state.firebase || "ожидание";
      add({
        level: "wait",
        ...payload,
        code: payload.code || "wait",
        message: payload.message || "Ожидание"
      });
    },

    cache(payload = {}) {
      state.level = "cache";
      state.firebase = payload.firebaseText || "кэш";
      state.cache = payload.cacheText || "активен";
      add({
        level: "cache",
        ...payload,
        code: payload.code || "cache",
        message: payload.message || "Работа из кэша"
      });
    },

    sync(text) {
      state.sync = text || "синхронизация";
      add({
        level: "sync",
        file: FILE,
        module: "Diagnostics",
        functionName: "sync()",
        place: "sync-status",
        code: "sync-update",
        message: state.sync
      });
    },

    error(payload = {}) {
      state.level = "error";
      state.firebase = payload.firebaseText || "ошибка";
      add({
        level: "error",
        ...payload,
        code: payload.code || "error",
        message: payload.message || payload.error || "Ошибка без описания"
      });

      window.SoundAPI?.error?.();

      try {
        console.error("[Electric Pro Diagnostics]", payload);
      } catch {}
    },

    info(payload = {}) {
      add({
        level: "info",
        ...payload,
        code: payload.code || "info",
        message: payload.message || "Информация"
      });
    },

    clear() {
      state.entries = [];
      try {
        localStorage.removeItem(LOG_KEY);
      } catch {}
      add({
        level: "clear",
        file: FILE,
        module: "Diagnostics",
        functionName: "clear()",
        place: "diagnostics-panel",
        code: "log-cleared",
        message: "Журнал диагностики очищен."
      });
    },

    text: getText,
    render,
    getSession: () => ({
      sessionId: state.sessionId,
      startedAt: state.startedAt,
      version: state.version,
      entries: [...state.entries]
    }),
    loadStoredLog
  };
})();
