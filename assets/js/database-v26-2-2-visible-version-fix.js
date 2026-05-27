(function () {
  "use strict";

  const VERSION = "V26.2.2";
  const FILE = "assets/js/database-v26-2-2-visible-version-fix.js";

  function log(code, message, extra = {}) {
    try {
      window.Diagnostics?.ok?.({
        file: FILE,
        module: "DBV2622VisibleVersionFix",
        functionName: "runtime",
        place: "database",
        code,
        message,
        ...extra
      });
    } catch (e) {}
  }

  function isVersionText(v) {
    return /^v\s*\d+(\.\d+){0,3}$/i.test(String(v || "").trim());
  }

  function dbRoots() {
    return Array.from(document.querySelectorAll(
      "#ep-db-v26-screen,#ep-db-v262-screen,#ep-db-v256-screen,#ep-db-v25-screen,#ep-db-v24-screen,#ep-db-v243-screen,#ep-db-v244-screen,#ep-database-screen,[data-screen='database']"
    ));
  }

  function isVisible(el) {
    if (!el) return false;
    const st = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return st.display !== "none" && st.visibility !== "hidden" && r.width > 20 && r.height > 20;
  }

  function roleText() {
    const body = document.body.textContent || "";
    return /(^|\s)admin(\s|$)|Админ/i.test(body) ? "Админ" : "Мастер";
  }

  function findHeader(root) {
    const h2 = Array.from(root.querySelectorAll("h1,h2,h3")).find(h => /база данных/i.test(h.textContent || ""));
    if (!h2) return null;

    const box = h2.closest(".db26-head,.db262-head,.db256-head,.db25-head,.db24-head,header,section,div") || h2.parentElement;
    return { h2, box };
  }

  function setHeaderVersion(root) {
    const found = findHeader(root);
    if (!found) return;

    const { box } = found;

    // Основная строка под заголовком: "Админ · V..."
    let roleLine = Array.from(box.querySelectorAll("p,small,span,div"))
      .find(el => /(админ|мастер)\s*·\s*v/i.test(el.textContent || ""));

    if (!roleLine) {
      roleLine = Array.from(box.querySelectorAll("p,small,span,div"))
        .find(el => /v\s*26/i.test(el.textContent || ""));
    }

    if (roleLine) {
      roleLine.textContent = roleText() + " · " + VERSION;
      roleLine.setAttribute("data-db2622-version-role", "1");
    }

    // В случае, если версия лежит отдельным текстовым узлом.
    const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);

    nodes.forEach(node => {
      const txt = String(node.nodeValue || "");
      if (/v\s*26(\.0|\.1|\.2|\.2\.1)?/i.test(txt) && !/(админ|мастер)/i.test(txt)) {
        node.nodeValue = txt.replace(/v\s*26(\.0|\.1|\.2|\.2\.1)?/ig, VERSION);
      }
    });
  }

  function cleanGhostVersions(root) {
    // Убираем лишние "призраки" версий внутри БД, которые всплыли в серых/зелёных плашках.
    const found = findHeader(root);
    const headerBox = found?.box || null;

    root.querySelectorAll("span,em,b,strong,small,i,div,button").forEach(el => {
      if (headerBox && headerBox.contains(el)) return;

      const txt = String(el.textContent || "").trim();
      if (!isVersionText(txt)) return;

      // Не трогаем кнопки Работа/Материал целиком, только мелкий вложенный бейдж.
      const r = el.getBoundingClientRect();
      const parentText = String(el.parentElement?.textContent || "").toLowerCase();

      if (r.width < 110 && r.height < 60) {
        el.classList.add("db2622-hidden-version-ghost");
        el.style.setProperty("display", "none", "important");
        el.style.setProperty("visibility", "hidden", "important");
      } else if (!parentText.includes("база данных")) {
        el.textContent = "";
      }
    });
  }

  function findBurgerDbRows() {
    const rows = [];
    document.querySelectorAll("button,a,li,div,[role='button']").forEach(row => {
      if (row.closest("#ep-db-v26-screen,#ep-db-v262-screen,#ep-db-v256-screen,#ep-db-v25-screen,#ep-db-v24-screen,#ep-db-v243-screen,#ep-db-v244-screen,#ep-database-screen,[data-screen='database']")) return;

      const t = String(row.textContent || "").toLowerCase().replace(/\s+/g, " ").trim();
      const r = row.getBoundingClientRect();
      if (t.includes("база данных") && t.length < 180 && r.height < 160) rows.push(row);
    });
    return rows;
  }

  function fixBurgerBadge() {
    findBurgerDbRows().forEach(row => {
      row.setAttribute("data-db2622-route", "1");

      let badges = Array.from(row.querySelectorAll("span,em,b,strong,small,i,div")).filter(el => {
        const txt = String(el.textContent || "").trim();
        const cls = String(el.className || "").toLowerCase();
        return isVersionText(txt) || cls.includes("version") || cls.includes("badge");
      }).filter(el => !/база данных/i.test(el.textContent || ""));

      if (!badges.length) {
        const badge = document.createElement("span");
        row.appendChild(badge);
        badges = [badge];
      }

      badges.forEach((el, i) => {
        if (i === 0) {
          el.textContent = VERSION;
          el.classList.add("db2622-badge");
          el.classList.remove("db2622-hide-extra");
          el.style.removeProperty("display");
          el.style.removeProperty("visibility");
        } else {
          el.classList.add("db2622-hide-extra");
          el.style.setProperty("display", "none", "important");
        }
      });
    });
  }

  function exposeVersion() {
    try {
      if (window.DatabaseV26SurgicalMonolith) window.DatabaseV26SurgicalMonolith.version = VERSION;
      if (window.DatabaseV262StableUI) window.DatabaseV262StableUI.version = VERSION;
      if (window.DatabaseV262InteractionFix) window.DatabaseV262InteractionFix.version = VERSION;
      if (window.DBV2621VersionLock) window.DBV2621VersionLock.version = VERSION;
    } catch (e) {}
  }

  function injectCss() {
    if (document.getElementById("db2622-visible-version-style")) return;

    const style = document.createElement("style");
    style.id = "db2622-visible-version-style";
    style.textContent = `
.db2622-hidden-version-ghost{display:none!important;visibility:hidden!important}
[data-db2622-route="1"] .db2622-hide-extra{display:none!important}
[data-db2622-route="1"] .db2622-badge{
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
[data-db2622-version-role="1"]{
  color:#64748b!important;
  opacity:1!important;
  visibility:visible!important;
}
`;
    document.head.appendChild(style);
  }

  function boot() {
    injectCss();
    exposeVersion();

    dbRoots().forEach(root => {
      if (!isVisible(root)) return;
      setHeaderVersion(root);
      cleanGhostVersions(root);
    });

    fixBurgerBadge();
  }

  function observe() {
    if (window.__db2622VersionObserver) return;

    const obs = new MutationObserver(() => {
      clearTimeout(window.__db2622VersionTimer);
      window.__db2622VersionTimer = setTimeout(boot, 60);
    });

    obs.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class", "style"] });
    window.__db2622VersionObserver = obs;
  }

  window.DBV2622VisibleVersionFix = {
    version: VERSION,
    boot,
    setHeaderVersion,
    cleanGhostVersions,
    fixBurgerBadge
  };

  window.addEventListener("DOMContentLoaded", () => {
    boot();
    observe();
    [80, 200, 450, 900, 1600, 3000, 5000].forEach(ms => setTimeout(boot, ms));
  });

  log("ready", "V26.2.2: жёсткий фикс видимой версии БД подключён.");
})();
