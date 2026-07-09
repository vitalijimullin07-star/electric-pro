/* ============================================================
   Electric Pro V29 — Database / Storage
   Низкоуровневый слой: чтение/запись JSON в localStorage.
   Совместим со старым проектом: ключи epdb26_my / epdb26_server.
   Здесь НЕТ бизнес-логики и НЕТ DOM — только хранилище.
   ============================================================ */
(() => {
  "use strict";
  window.EP = window.EP || {};
  EP.Database = EP.Database || {};

  // Ключи берём 1-в-1 из старого проекта — данные мастера сохраняются.
  const KEYS = {
    my: "epdb26_my",
    server: "epdb26_server",
    active: "epdb26_active_base"
  };

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) return fallback;
      const val = JSON.parse(raw);
      return val == null ? fallback : val;
    } catch (e) {
      console.warn("[EP.Database.Storage] read fail:", key, e);
      return fallback;
    }
  }

  function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.error("[EP.Database.Storage] write fail:", key, e);
      return false;
    }
  }

  function readString(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : raw;
    } catch (e) {
      return fallback;
    }
  }

  function writeString(key, value) {
    try {
      localStorage.setItem(key, String(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  EP.Database.Storage = { KEYS, readJson, writeJson, readString, writeString };
})();
