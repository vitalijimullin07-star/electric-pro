(function () {
  "use strict";

  const VERSION = "V26.1";
  const FILE = "assets/js/database-v26-1-route-v26-not-old.js";
  let lastDbIntentAt = 0;

  function log(code, message, extra = {}) {
    try {
      window.Diagnostics?.ok?.({
        file: FILE,
        module: "DatabaseV261RouteV26NotOld",
        functionName: "runtime",
        place: "database-route",
        code,
        message,
        ...extra
      });
    } catch (e) {}
  }

  function norm(v) {
    return String(v || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function isInsideAnyDb(el) {
    return !!el?.closest?.(
      "#ep-db-v26-screen,#ep-db-v256-screen,#ep-db-v25-screen,#ep-db-v24-screen,#ep-db-v243-screen,#ep-db-v244-screen,#ep-database-screen,[data-screen='database']"
    );
  }

  function visible(el) {
    if (!el) return false;
    const st = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return st.display !== "none" && st.visibility !== "hidden" && r.width > 20 && r.height > 20;
  }

  function isDbButtonLike(el) {
    if (!el || isInsideAnyDb(el)) return false;

    const attrs = [
      el.id,
      el.className,
      el.getAttribute?.("data-route"),
      el.getAttribute?.("data-screen"),
      el.getAttribute?.("data-ep-shell-route"),
      el.getAttribute?.("onclick"),
      el.getAttribute?.("href"),
      el.getAttribute?.("aria-label")
    ].filter(Boolean).join(" ").toLowerCase();

    const t = norm(el.textContent);

    if (attrs.includes("database") || attrs.includes("db") || attrs.includes("база")) return true;

    // Только короткие элементы меню/кнопки, а не вся страница.
    if (t.includes("база данных") && t.length < 160) return true;

    return false;
  }

  function findDbTrigger(event) {
    const path = event.composedPath ? event.composedPath() : [];
    for (const node of path) {
      if (!(node instanceof Element)) continue;
      if (node === document.body || node === document.documentElement) break;
      if (isDbButtonLike(node)) return node;
    }

    let el = event.target instanceof Element ? event.target : null;
    let depth = 0;
    while (el && el !== document.body && depth < 8) {
      if (isDbButtonLike(el)) return el;
      el = el.parentElement;
      depth++;
    }

    return null;
  }

  function hideOldDbScreens() {
    const selectors = [
      "#ep-db-v25-screen",
      "#ep-db-v256-screen",
      "#ep-db-v244-screen",
      "#ep-db-v243-screen",
      "#ep-db-v24-screen",
      "#ep-database-screen",
      "[data-screen='database']",
      ".db243-screen",
      ".db244-screen",
      ".db24-screen",
      ".db25-screen",
      ".database-screen"
    ];

    document.querySelectorAll(selectors.join(",")).forEach(el => {
      if (el.id === "ep-db-v26-screen") return;
      el.classList.add("hidden");
      el.style.setProperty("display", "none", "important");
    });
  }

  function ensureV26Exists() {
    if (window.DatabaseV26SurgicalMonolith?.open) return true;
    const script = Array.from(document.scripts).find(s => String(s.src || "").includes("database-v26-surgical-monolith.js"));
    if (script) return !!window.DatabaseV26SurgicalMonolith?.open;
    return false;
  }

  function openV26() {
    lastDbIntentAt = Date.now();
    sessionStorage.setItem("ep_db_v26_intent", String(lastDbIntentAt));

    hideOldDbScreens();

    if (window.DatabaseV26SurgicalMonolith?.open) {
      window.DatabaseV26SurgicalMonolith.open();
      setTimeout(hideOldDbScreens, 80);
      setTimeout(fixBurgerBadges, 180);
      log("open-v26", "Открыта БД V26 вместо старой V24.3.1.");
      return true;
    }

    alert("V26 не найден: файл database-v26-surgical-monolith.js не подключился.");
    log("v26-missing", "Не найден window.DatabaseV26SurgicalMonolith.open.");
    return false;
  }

  function shouldOverrideRoute(route) {
    const r = norm(route);
    return r === "database" || r === "db" || r === "base" || r.includes("database") || r.includes("база");
  }

  function patchFunction(obj, name, label) {
    if (!obj || typeof obj[name] !== "function") return false;
    const fn = obj[name];
    if (fn.__db261Patched) return true;

    const wrapped = function (...args) {
      if (shouldOverrideRoute(args[0])) {
        openV26();
        return true;
      }
      return fn.apply(this, args);
    };

    wrapped.__db261Patched = true;
    wrapped.__db261Original = fn;

    try {
      obj[name] = wrapped;
      log("patched-" + label, "Перехвачен маршрут БД: " + label);
      return true;
    } catch (e) {
      return false;
    }
  }

  function patchRouters() {
    patchFunction(window.Router, "load", "Router.load");
    patchFunction(window.Router, "navigate", "Router.navigate");
    patchFunction(window.AppRouter, "load", "AppRouter.load");
    patchFunction(window.AppRouter, "navigate", "AppRouter.navigate");

    if (typeof window.navigateTo === "function" && !window.navigateTo.__db261Patched) {
      const old = window.navigateTo;
      const wrapped = function (...args) {
        if (shouldOverrideRoute(args[0])) {
          openV26();
          return true;
        }
        return old.apply(this, args);
      };
      wrapped.__db261Patched = true;
      window.navigateTo = wrapped;
    }

    if (typeof window.showScreen === "function" && !window.showScreen.__db261Patched) {
      const old = window.showScreen;
      const wrapped = function (...args) {
        if (shouldOverrideRoute(args[0])) {
          openV26();
          return true;
        }
        return old.apply(this, args);
      };
      wrapped.__db261Patched = true;
      window.showScreen = wrapped;
    }
  }

  function versionEls(row) {
    return Array.from(row.querySelectorAll("span,em,b,strong,small,i,div")).filter(el => {
      const txt = String(el.textContent || "").trim();
      const cls = String(el.className || "").toLowerCase();
      return /^v\d+(\.\d+){0,3}$/i.test(txt) || cls.includes("version") || cls.includes("badge");
    }).filter(el => !/база данных/i.test(el.textContent || ""));
  }

  function findDbRows() {
    const candidates = [];
    document.querySelectorAll("button,a,li,div,[role='button']").forEach(el => {
      if (!visible(el) || isInsideAnyDb(el)) return;
      const t = norm(el.textContent);
      const r = el.getBoundingClientRect();
      if (t.includes("база данных") && t.length < 180 && r.height < 140) candidates.push(el);
    });
    return candidates;
  }

  function fixBurgerBadges() {
    findDbRows().forEach(row => {
      row.setAttribute("data-db261-route", "1");

      let badges = versionEls(row);
      if (!badges.length) {
        const b = document.createElement("span");
        row.appendChild(b);
        badges = [b];
      }

      badges.forEach((el, index) => {
        if (index === 0) {
          el.textContent = VERSION;
          el.classList.add("db261-badge");
          el.classList.remove("db261-hide-extra");
          el.style.removeProperty("display");
          el.style.removeProperty("visibility");
        } else {
          el.classList.add("db261-hide-extra");
          el.style.setProperty("display", "none", "important");
        }
      });
    });
  }

  function injectCss() {
    if (document.getElementById("db261-route-style")) return;

    const style = document.createElement("style");
    style.id = "db261-route-style";
    style.textContent = `
[data-db261-route="1"] .db261-hide-extra{display:none!important}
[data-db261-route="1"] .db261-badge{
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

  function bindClicks() {
    if (window.__db261ClickBound) return;
    window.__db261ClickBound = true;

    document.addEventListener("pointerdown", event => {
      if (findDbTrigger(event)) {
        lastDbIntentAt = Date.now();
        sessionStorage.setItem("ep_db_v26_intent", String(lastDbIntentAt));
      }
    }, true);

    document.addEventListener("click", event => {
      const trigger = findDbTrigger(event);
      if (!trigger) return;

      event.preventDefault();
      event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();

      openV26();
    }, true);
  }

  function boot() {
    injectCss();
    patchRouters();
    fixBurgerBadges();

    // Если старый модуль успел открыться сразу после клика — закрываем его и показываем V26.
    const intent = Number(sessionStorage.getItem("ep_db_v26_intent") || lastDbIntentAt || 0);
    if (Date.now() - intent < 4000) {
      hideOldDbScreens();
      if (!document.getElementById("ep-db-v26-screen") || document.getElementById("ep-db-v26-screen")?.classList.contains("hidden")) {
        if (window.DatabaseV26SurgicalMonolith?.open) window.DatabaseV26SurgicalMonolith.open();
      }
    }
  }

  function observe() {
    if (window.__db261Observer) return;

    const obs = new MutationObserver(() => {
      clearTimeout(window.__db261Timer);
      window.__db261Timer = setTimeout(boot, 120);
    });

    obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style"] });
    window.__db261Observer = obs;
  }

  window.DatabaseV261RouteV26NotOld = {
    version: VERSION,
    openV26,
    hideOldDbScreens,
    fixBurgerBadges,
    boot
  };

  window.addEventListener("DOMContentLoaded", () => {
    bindClicks();
    boot();
    observe();
    [250, 700, 1500, 3000].forEach(ms => setTimeout(boot, ms));
  });

  log("ready", "V26.1 готов: маршрут «База данных» ведёт в V26, не в старую V24.3.1.");
})();
