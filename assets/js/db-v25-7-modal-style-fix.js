(function () {
  const VERSION = "V25.7";
  const FILE = "assets/js/db-v25-7-modal-style-fix.js";
  let userOpenIntentUntil = 0;

  function log(code, message, extra = {}) {
    try {
      window.Diagnostics?.ok?.({
        file: FILE,
        module: "DBV257ModalStyleFix",
        functionName: "runtime",
        place: "database",
        code,
        message,
        ...extra
      });
    } catch (e) {}
  }

  function styleText() {
    return `
/* === V25.7 force database modal style === */
#ep-db-v256-screen,
#ep-db-v257-screen {
  position: fixed !important;
  inset: 0 !important;
  z-index: 2147483000 !important;
  display: block !important;
  box-sizing: border-box !important;
  width: 100vw !important;
  height: 100vh !important;
  max-width: none !important;
  max-height: none !important;
  margin: 0 !important;
  padding: 14px !important;
  overflow: auto !important;
  background: linear-gradient(135deg,#06141f,#052e2b 55%,#111827) !important;
  color: #0f172a !important;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
}

#ep-db-v256-screen.hidden,
#ep-db-v257-screen.hidden {
  display: none !important;
}

#ep-db-v256-screen *,
#ep-db-v257-screen * {
  box-sizing: border-box !important;
}

#ep-db-v256-screen .db256-head,
#ep-db-v257-screen .db256-head {
  position: sticky !important;
  top: 6px !important;
  z-index: 2147483001 !important;
  max-width: 940px !important;
  min-height: 58px !important;
  margin: 0 auto 8px !important;
  padding: 8px 10px !important;
  display: grid !important;
  grid-template-columns: 42px 1fr auto 24px !important;
  gap: 8px !important;
  align-items: center !important;
  border-radius: 22px !important;
  background: rgba(248,250,252,.98) !important;
  box-shadow: 0 14px 38px rgba(0,0,0,.24) !important;
}

#ep-db-v256-screen .db256-head button[data-db256-close],
#ep-db-v257-screen .db256-head button[data-db256-close] {
  width: 40px !important;
  height: 40px !important;
  border: 0 !important;
  border-radius: 999px !important;
  background: rgba(15,23,42,.08) !important;
  color: #0f172a !important;
  font-size: 20px !important;
  font-weight: 950 !important;
}

#ep-db-v256-screen .db256-head h2,
#ep-db-v257-screen .db256-head h2 {
  margin: 0 !important;
  color: #0f172a !important;
  font-size: 20px !important;
  line-height: 1.1 !important;
  font-weight: 950 !important;
}

#ep-db-v256-screen .db256-head p,
#ep-db-v257-screen .db256-head p {
  margin: 2px 0 0 !important;
  color: #64748b !important;
  font-size: 12px !important;
  font-weight: 850 !important;
}

#ep-db-v256-screen .db256-head b,
#ep-db-v257-screen .db256-head b {
  min-width: 92px !important;
  height: 34px !important;
  display: grid !important;
  place-items: center !important;
  padding: 0 12px !important;
  border-radius: 999px !important;
  background: rgba(34,197,94,.16) !important;
  color: #14532d !important;
  font-size: 13px !important;
  font-weight: 950 !important;
}

#ep-db-v256-screen .db256-dot,
#ep-db-v257-screen .db256-dot {
  width: 20px !important;
  height: 20px !important;
  padding: 0 !important;
  border: 2px solid rgba(255,255,255,.95) !important;
  border-radius: 999px !important;
  background: #ef4444 !important;
  box-shadow: 0 4px 12px rgba(0,0,0,.18), 0 0 0 4px rgba(239,68,68,.14) !important;
}

#ep-db-v256-screen .db256-status,
#ep-db-v257-screen .db256-status {
  max-width: 940px !important;
  min-height: 36px !important;
  margin: -3px auto 8px !important;
  padding: 8px 13px !important;
  border-radius: 999px !important;
  overflow: hidden !important;
  text-overflow: ellipsis !important;
  white-space: nowrap !important;
  background: rgba(220,252,231,.94) !important;
  color: #14532d !important;
  font-size: 13px !important;
  font-weight: 950 !important;
  box-shadow: 0 8px 20px rgba(0,0,0,.12) !important;
}

#ep-db-v256-screen .db256-shell,
#ep-db-v257-screen .db256-shell {
  max-width: 940px !important;
  margin: 0 auto !important;
  padding-bottom: 120px !important;
  display: grid !important;
  gap: 10px !important;
}

#ep-db-v256-screen .db256-card,
#ep-db-v257-screen .db256-card {
  width: 100% !important;
  padding: 12px !important;
  border-radius: 22px !important;
  background: rgba(248,250,252,.96) !important;
  border: 1px solid rgba(255,255,255,.32) !important;
  box-shadow: 0 14px 38px rgba(0,0,0,.16) !important;
}

#ep-db-v256-screen .db256-card h3,
#ep-db-v256-screen .db256-card h4,
#ep-db-v256-screen .db256-list-head h3,
#ep-db-v257-screen .db256-card h3,
#ep-db-v257-screen .db256-card h4,
#ep-db-v257-screen .db256-list-head h3 {
  margin: 0 0 7px !important;
  color: #0f172a !important;
  font-size: 16px !important;
  line-height: 1.2 !important;
  font-weight: 950 !important;
}

#ep-db-v256-screen .db256-card p,
#ep-db-v257-screen .db256-card p {
  margin: 8px 0 0 !important;
  color: #64748b !important;
  font-size: 13px !important;
  line-height: 1.35 !important;
  font-weight: 850 !important;
}

#ep-db-v256-screen .db256-switch,
#ep-db-v257-screen .db256-switch {
  display: grid !important;
  grid-template-columns: repeat(3, minmax(0,1fr)) !important;
  gap: 8px !important;
}

#ep-db-v256-screen .db256-tabs,
#ep-db-v256-screen .db256-actions,
#ep-db-v257-screen .db256-tabs,
#ep-db-v257-screen .db256-actions {
  display: grid !important;
  grid-template-columns: 1fr 1fr !important;
  gap: 8px !important;
}

#ep-db-v256-screen .db256-switch button,
#ep-db-v256-screen .db256-tabs button,
#ep-db-v256-screen .db256-actions button,
#ep-db-v256-screen .db256-file,
#ep-db-v256-screen .db256-editor-block button,
#ep-db-v257-screen .db256-switch button,
#ep-db-v257-screen .db256-tabs button,
#ep-db-v257-screen .db256-actions button,
#ep-db-v257-screen .db256-file,
#ep-db-v257-screen .db256-editor-block button {
  min-height: 46px !important;
  border: 1px solid rgba(15,23,42,.08) !important;
  border-radius: 16px !important;
  background: #eef2f7 !important;
  color: #475569 !important;
  font-size: 14px !important;
  font-weight: 950 !important;
}

#ep-db-v256-screen .db256-switch button.active,
#ep-db-v256-screen .db256-tabs button.active,
#ep-db-v257-screen .db256-switch button.active,
#ep-db-v257-screen .db256-tabs button.active {
  background: linear-gradient(135deg, rgba(34,197,94,.24), rgba(20,184,166,.18)) !important;
  color: #064e3b !important;
  border-color: rgba(34,197,94,.42) !important;
  box-shadow: inset 0 0 0 1px rgba(34,197,94,.25), 0 8px 18px rgba(34,197,94,.12) !important;
}

#ep-db-v256-screen .db256-editor-toggle,
#ep-db-v257-screen .db256-editor-toggle {
  width: 100% !important;
  min-height: 48px !important;
  display: grid !important;
  grid-template-columns: 26px 1fr auto !important;
  gap: 8px !important;
  align-items: center !important;
  border: 0 !important;
  border-radius: 18px !important;
  background: rgba(15,23,42,.06) !important;
  color: #0f172a !important;
  text-align: left !important;
  padding: 0 12px !important;
}

#ep-db-v256-screen .db256-editor-toggle b,
#ep-db-v257-screen .db256-editor-toggle b {
  font-size: 16px !important;
  font-weight: 950 !important;
}

#ep-db-v256-screen .db256-editor-toggle em,
#ep-db-v257-screen .db256-editor-toggle em {
  color: #64748b !important;
  font-style: normal !important;
  font-size: 12px !important;
  font-weight: 900 !important;
}

#ep-db-v256-screen .db256-editor-block,
#ep-db-v257-screen .db256-editor-block {
  margin-top: 10px !important;
  padding: 10px !important;
  border-radius: 18px !important;
  background: rgba(15,23,42,.045) !important;
}

#ep-db-v256-screen .db256-search,
#ep-db-v257-screen .db256-search {
  width: 100% !important;
  min-height: 46px !important;
  margin: 8px 0 !important;
  border: 1px solid rgba(15,23,42,.10) !important;
  border-radius: 16px !important;
  background: #fff !important;
  color: #0f172a !important;
  padding: 0 13px !important;
  font-size: 15px !important;
  font-weight: 850 !important;
}

#ep-db-v256-screen .db256-list-head,
#ep-db-v257-screen .db256-list-head {
  display: grid !important;
  grid-template-columns: 1fr auto auto !important;
  gap: 8px !important;
  align-items: center !important;
  margin-bottom: 8px !important;
}

#ep-db-v256-screen .db256-list-head span,
#ep-db-v257-screen .db256-list-head span {
  padding: 6px 9px !important;
  border-radius: 999px !important;
  background: rgba(15,23,42,.06) !important;
  color: #64748b !important;
  font-size: 12px !important;
  font-weight: 900 !important;
}

#ep-db-v256-screen .db256-list-head button,
#ep-db-v257-screen .db256-list-head button {
  min-height: 32px !important;
  padding: 0 12px !important;
  border: 0 !important;
  border-radius: 999px !important;
  background: rgba(20,184,166,.14) !important;
  color: #0f766e !important;
  font-size: 12px !important;
  font-weight: 950 !important;
}

#ep-db-v256-screen .db256-tree,
#ep-db-v257-screen .db256-tree {
  display: grid !important;
  gap: 8px !important;
}

#ep-db-v256-screen .db256-folder,
#ep-db-v257-screen .db256-folder {
  border-radius: 18px !important;
  background: rgba(15,23,42,.045) !important;
  padding: 8px !important;
}

#ep-db-v256-screen .db256-check-head,
#ep-db-v257-screen .db256-check-head {
  display: grid !important;
  grid-template-columns: 30px 1fr !important;
  gap: 8px !important;
  align-items: center !important;
}

#ep-db-v256-screen .db256-check-head input,
#ep-db-v256-screen .db256-item input[type="checkbox"],
#ep-db-v257-screen .db256-check-head input,
#ep-db-v257-screen .db256-item input[type="checkbox"] {
  width: 22px !important;
  height: 22px !important;
  accent-color: #22c55e !important;
}

#ep-db-v256-screen .db256-folder-head,
#ep-db-v256-screen .db256-sub-head,
#ep-db-v257-screen .db256-folder-head,
#ep-db-v257-screen .db256-sub-head {
  width: 100% !important;
  min-height: 46px !important;
  display: grid !important;
  grid-template-columns: 30px 1fr auto !important;
  gap: 8px !important;
  align-items: center !important;
  border: 0 !important;
  border-radius: 16px !important;
  background: #fff !important;
  color: #0f172a !important;
  text-align: left !important;
  padding: 0 10px !important;
}

#ep-db-v256-screen .db256-folder-head b,
#ep-db-v256-screen .db256-sub-head b,
#ep-db-v257-screen .db256-folder-head b,
#ep-db-v257-screen .db256-sub-head b {
  font-size: 14px !important;
  font-weight: 950 !important;
}

#ep-db-v256-screen .db256-folder-head em,
#ep-db-v256-screen .db256-sub-head em,
#ep-db-v257-screen .db256-folder-head em,
#ep-db-v257-screen .db256-sub-head em {
  min-width: 30px !important;
  height: 26px !important;
  display: grid !important;
  place-items: center !important;
  border-radius: 999px !important;
  background: rgba(34,197,94,.16) !important;
  color: #14532d !important;
  font-style: normal !important;
  font-size: 12px !important;
  font-weight: 950 !important;
}

#ep-db-v256-screen .db256-folder-body,
#ep-db-v256-screen .db256-items,
#ep-db-v257-screen .db256-folder-body,
#ep-db-v257-screen .db256-items {
  display: none !important;
  padding-top: 7px !important;
}

#ep-db-v256-screen .db256-folder.open > .db256-folder-body,
#ep-db-v256-screen .db256-sub.open > .db256-items,
#ep-db-v257-screen .db256-folder.open > .db256-folder-body,
#ep-db-v257-screen .db256-sub.open > .db256-items {
  display: grid !important;
  gap: 7px !important;
}

#ep-db-v256-screen .db256-sub,
#ep-db-v257-screen .db256-sub {
  padding-left: 12px !important;
  display: grid !important;
  gap: 7px !important;
}

#ep-db-v256-screen .db256-item,
#ep-db-v257-screen .db256-item {
  display: grid !important;
  grid-template-columns: 30px 1fr !important;
  gap: 8px !important;
  align-items: center !important;
  padding: 10px !important;
  border-radius: 16px !important;
  background: #fff !important;
  border: 1px solid rgba(15,23,42,.08) !important;
}

#ep-db-v256-screen .db256-item.selected,
#ep-db-v257-screen .db256-item.selected {
  border-color: rgba(34,197,94,.36) !important;
  background: rgba(240,253,244,.96) !important;
}

#ep-db-v256-screen .db256-item-main,
#ep-db-v257-screen .db256-item-main {
  border: 0 !important;
  background: transparent !important;
  text-align: left !important;
  padding: 0 !important;
}

#ep-db-v256-screen .db256-item-main b,
#ep-db-v257-screen .db256-item-main b {
  display: block !important;
  color: #0f172a !important;
  font-size: 14px !important;
  font-weight: 950 !important;
}

#ep-db-v256-screen .db256-item-main p,
#ep-db-v257-screen .db256-item-main p {
  margin: 3px 0 0 !important;
  color: #64748b !important;
  font-size: 12px !important;
  font-weight: 850 !important;
}

#ep-db-v256-screen .db256-empty,
#ep-db-v257-screen .db256-empty {
  padding: 14px !important;
  border-radius: 16px !important;
  background: rgba(15,23,42,.06) !important;
  color: #64748b !important;
  font-weight: 900 !important;
}

#ep-db-v256-screen .db256-file,
#ep-db-v257-screen .db256-file {
  display: grid !important;
  place-items: center !important;
  cursor: pointer !important;
}

#ep-db-v256-screen .db256-file input,
#ep-db-v257-screen .db256-file input {
  display: none !important;
}

@media(max-width:720px) {
  #ep-db-v256-screen,
  #ep-db-v257-screen {
    padding: 10px !important;
  }

  #ep-db-v256-screen .db256-head,
  #ep-db-v257-screen .db256-head {
    grid-template-columns: 40px 1fr auto 22px !important;
  }

  #ep-db-v256-screen .db256-switch,
  #ep-db-v257-screen .db256-switch {
    grid-template-columns: 1fr 1fr !important;
  }

  #ep-db-v256-screen .db256-list-head,
  #ep-db-v257-screen .db256-list-head {
    grid-template-columns: 1fr !important;
    align-items: stretch !important;
  }

  #ep-db-v256-screen .db256-actions,
  #ep-db-v257-screen .db256-actions {
    grid-template-columns: 1fr 1fr !important;
  }
}
    `;
  }

  function injectCss() {
    let tag = document.getElementById("db-v25-7-force-style");
    if (!tag) {
      tag = document.createElement("style");
      tag.id = "db-v25-7-force-style";
      document.head.appendChild(tag);
    }
    tag.textContent = styleText();
  }

  function screen() {
    return document.getElementById("ep-db-v256-screen") || document.getElementById("ep-db-v257-screen");
  }

  function forceModal(el) {
    if (!el) return;
    injectCss();

    if (el.parentElement !== document.body) {
      document.body.appendChild(el);
    }

    el.classList.remove("hidden");

    const s = el.style;
    s.setProperty("position", "fixed", "important");
    s.setProperty("inset", "0", "important");
    s.setProperty("z-index", "2147483000", "important");
    s.setProperty("display", "block", "important");
    s.setProperty("width", "100vw", "important");
    s.setProperty("height", "100vh", "important");
    s.setProperty("max-width", "none", "important");
    s.setProperty("max-height", "none", "important");
    s.setProperty("margin", "0", "important");
    s.setProperty("padding", "14px", "important");
    s.setProperty("overflow", "auto", "important");
    s.setProperty("background", "linear-gradient(135deg,#06141f,#052e2b 55%,#111827)", "important");
    s.setProperty("color", "#0f172a", "important");
  }

  function closeDb() {
    const el = screen();
    if (el) el.classList.add("hidden");
  }

  function markIntent() {
    userOpenIntentUntil = Date.now() + 8000;
  }

  function hasIntent() {
    return Date.now() < userOpenIntentUntil;
  }

  function patchOpen() {
    const mod = window.DatabaseV256SafeMonolith || window.DatabaseV25HardMonolith || window.DatabaseV24CleanMonolith;
    if (!mod || typeof mod.open !== "function" || mod.__db257StylePatched) return false;

    const oldOpen = mod.open.bind(mod);
    mod.__db257RawOpen = oldOpen;

    mod.open = function (...args) {
      injectCss();
      const result = oldOpen(...args);
      setTimeout(() => forceModal(screen()), 30);
      setTimeout(() => forceModal(screen()), 180);
      setTimeout(() => forceModal(screen()), 550);
      return result;
    };

    mod.__db257StylePatched = true;

    if (window.DatabaseV256SafeMonolith) window.DatabaseV256SafeMonolith.open = mod.open;
    if (window.DatabaseV25HardMonolith) window.DatabaseV25HardMonolith.open = mod.open;
    if (window.DatabaseV24CleanMonolith) window.DatabaseV24CleanMonolith.open = mod.open;

    return true;
  }

  function openDb() {
    markIntent();
    injectCss();

    const mod = window.DatabaseV256SafeMonolith || window.DatabaseV25HardMonolith || window.DatabaseV24CleanMonolith;
    if (mod?.__db257RawOpen) {
      mod.__db257RawOpen();
    } else if (mod?.open) {
      mod.open();
    } else {
      alert("Модуль БД не найден.");
      return false;
    }

    setTimeout(() => forceModal(screen()), 20);
    setTimeout(() => forceModal(screen()), 160);
    setTimeout(() => forceModal(screen()), 480);
    return true;
  }

  function isDbTrigger(el) {
    if (!el || el.closest?.("#ep-db-v256-screen") || el.closest?.("#ep-db-v257-screen")) return false;

    const text = String(el.textContent || "").toLowerCase().replace(/\s+/g, " ").trim();
    const attrs = [
      el.getAttribute?.("data-ep-shell-route"),
      el.getAttribute?.("data-route"),
      el.getAttribute?.("onclick"),
      el.id,
      el.className
    ].filter(Boolean).join(" ").toLowerCase();

    if (attrs.includes("database") || attrs.includes("db24") || attrs.includes("db25")) return true;
    if (text.includes("база данных") && text.length < 140) return true;
    return false;
  }

  function findDbTrigger(event) {
    const path = event.composedPath ? event.composedPath() : [];
    for (const node of path) {
      if (!(node instanceof Element)) continue;
      if (node === document.body || node === document.documentElement) break;
      if (isDbTrigger(node)) return node;
    }

    let el = event.target instanceof Element ? event.target : null;
    let depth = 0;
    while (el && depth < 8 && el !== document.body) {
      if (isDbTrigger(el)) return el;
      el = el.parentElement;
      depth++;
    }

    return null;
  }

  function isDbScreenVisible() {
    const el = screen();
    if (!el || el.classList.contains("hidden")) return false;
    const st = getComputedStyle(el);
    return st.display !== "none" && st.visibility !== "hidden";
  }

  function protectStartup() {
    const el = screen();
    if (el && isDbScreenVisible() && !hasIntent()) {
      el.classList.add("hidden");
    }
  }

  function bind() {
    if (window.__dbV257Bound) return;
    window.__dbV257Bound = true;

    document.addEventListener("click", function (event) {
      const trigger = findDbTrigger(event);
      if (!trigger) return;

      event.preventDefault();
      event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();

      openDb();
    }, true);

    document.addEventListener("click", function (event) {
      if (event.target.closest("[data-db256-close]")) {
        setTimeout(closeDb, 0);
      }
    }, true);
  }

  function boot() {
    injectCss();
    patchOpen();
    protectStartup();
  }

  function observe() {
    if (window.__dbV257Observer) return;

    const obs = new MutationObserver(() => {
      clearTimeout(window.__dbV257Timer);
      window.__dbV257Timer = setTimeout(boot, 80);
    });

    obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style"] });
    window.__dbV257Observer = obs;
  }

  window.addEventListener("DOMContentLoaded", function () {
    bind();
    boot();
    observe();
    [120, 320, 800, 1600, 3200].forEach(ms => setTimeout(boot, ms));
  });

  window.DBV257ModalStyleFix = {
    version: VERSION,
    injectCss,
    forceModal: () => forceModal(screen()),
    openDb,
    closeDb,
    boot
  };

  log("ready", "V25.7 фиксирует БД как модальное окно поверх приложения.");
})();
