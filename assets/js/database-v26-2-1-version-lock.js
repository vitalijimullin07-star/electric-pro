(function () {
  "use strict";

  const VERSION = "V26.2.1";
  const FILE = "assets/js/database-v26-2-1-version-lock.js";

  function log(code, message, extra = {}) {
    try {
      window.Diagnostics?.ok?.({
        file: FILE,
        module: "DBV2621VersionLock",
        functionName: "runtime",
        place: "database",
        code,
        message,
        ...extra
      });
    } catch (e) {}
  }

  function isDbArea(el) {
    if (!el) return false;
    return !!el.closest?.(
      "#ep-db-v26-screen,#ep-db-v262-screen,#ep-db-v256-screen,#ep-db-v25-screen,#ep-db-v24-screen,#ep-db-v243-screen,#ep-db-v244-screen,#ep-database-screen,[data-screen='database']"
    );
  }

  function looksLikeVersion(text) {
    return /^v\s*\d+(\.\d+){0,3}$/i.test(String(text || "").trim());
  }

  function setTextNodeVersions(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);

    nodes.forEach(node => {
      const value = String(node.nodeValue || "");
      if (/v\s*26(\.0)?/i.test(value) || /v\s*26\.2/i.test(value)) {
        node.nodeValue = value.replace(/v\s*26(\.0)?/ig, VERSION).replace(/v\s*26\.2/ig, VERSION);
      }
    });
  }

  function fixDbHeader() {
    document.querySelectorAll(
      "#ep-db-v26-screen,#ep-db-v262-screen,#ep-db-v256-screen,#ep-db-v25-screen,#ep-db-v24-screen,#ep-db-v243-screen,#ep-db-v244-screen,#ep-database-screen,[data-screen='database']"
    ).forEach(root => {
      setTextNodeVersions(root);

      // Дополнительно страхуем типовую строку "Админ · V26.0"
      root.querySelectorAll("p,small,span,b,em,strong,div").forEach(el => {
        const txt = String(el.textContent || "").trim();
        if (/^(админ|мастер)\s*·\s*v\s*26/i.test(txt)) {
          el.textContent = txt.replace(/v\s*26(\.0)?/i, VERSION).replace(/v\s*26\.2/i, VERSION);
        }
      });
    });
  }

  function fixBurgerBadge() {
    document.querySelectorAll("button,a,li,div,[role='button']").forEach(row => {
      if (isDbArea(row)) return;

      const text = String(row.textContent || "").toLowerCase().replace(/\s+/g, " ").trim();
      const rect = row.getBoundingClientRect();
      if (!text.includes("база данных") || text.length > 180 || rect.height > 160) return;

      row.setAttribute("data-db2621-route", "1");

      let badges = Array.from(row.querySelectorAll("span,em,b,strong,small,i,div")).filter(el => {
        const t = String(el.textContent || "").trim();
        const cls = String(el.className || "").toLowerCase();
        return looksLikeVersion(t) || cls.includes("version") || cls.includes("badge");
      }).filter(el => !/база данных/i.test(el.textContent || ""));

      if (!badges.length) {
        const badge = document.createElement("span");
        row.appendChild(badge);
        badges = [badge];
      }

      badges.forEach((el, index) => {
        if (index === 0) {
          el.textContent = VERSION;
          el.classList.add("db2621-badge");
          el.classList.remove("db2621-hide-extra");
          el.style.removeProperty("display");
          el.style.removeProperty("visibility");
        } else {
          el.classList.add("db2621-hide-extra");
          el.style.setProperty("display", "none", "important");
        }
      });
    });
  }

  function exposeVersion() {
    try {
      if (window.DatabaseV26SurgicalMonolith) window.DatabaseV26SurgicalMonolith.version = VERSION;
      if (window.DatabaseV262StableUI) window.DatabaseV262StableUI.version = VERSION;
      if (window.DatabaseV261RouteV26NotOld) window.DatabaseV261RouteV26NotOld.version = VERSION;
      if (window.DatabaseV262InteractionFix) window.DatabaseV262InteractionFix.version = VERSION;
    } catch (e) {}
  }

  function injectCss() {
    if (document.getElementById("db2621-version-lock-style")) return;
    const style = document.createElement("style");
    style.id = "db2621-version-lock-style";
    style.textContent = `
[data-db2621-route="1"] .db2621-hide-extra{display:none!important}
[data-db2621-route="1"] .db2621-badge{
  min-width:64px!important;
  height:30px!important;
  display:grid!important;
  place-items:center!important;
  border-radius:999px!important;
  background:rgba(148,163,184,.22)!important;
  color:#e2e8f0!important;
  font-style:normal!important;
  font-size:12px!important;
  font-weight:950!important;
  white-space:nowrap!important;
}
`;
    document.head.appendChild(style);
  }

  function boot() {
    injectCss();
    exposeVersion();
    fixDbHeader();
    fixBurgerBadge();
  }

  function observe() {
    if (window.__db2621VersionObserver) return;
    const obs = new MutationObserver(() => {
      clearTimeout(window.__db2621VersionTimer);
      window.__db2621VersionTimer = setTimeout(boot, 80);
    });
    obs.observe(document.body, { childList: true, subtree: true, characterData: true });
    window.__db2621VersionObserver = obs;
  }

  window.DBV2621VersionLock = {
    version: VERSION,
    boot,
    fixDbHeader,
    fixBurgerBadge
  };

  window.addEventListener("DOMContentLoaded", () => {
    boot();
    observe();
    [150, 400, 900, 1800, 3500].forEach(ms => setTimeout(boot, ms));
  });

  log("ready", "V26.2.1: фикс отображения версии БД подключён.");
})();
