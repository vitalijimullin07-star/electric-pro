(function () {
  const VERSION = "V25.6";
  const FILE = "assets/js/db-v25-6-burger-route-and-badge.js";

  function log(code, message, extra = {}) {
    try {
      window.Diagnostics?.ok?.({
        file: FILE,
        module: "DBV256BurgerRouteBadge",
        functionName: "runtime",
        place: "burger",
        code,
        message,
        ...extra
      });
    } catch (e) {}
  }

  function norm(v) {
    return String(v || "").toLowerCase().replace(/\s+/g, " ").trim();
  }

  function isDbRow(el) {
    if (!el || el.closest?.("#ep-db-v256-screen")) return false;

    const text = norm(el.textContent);
    const attrs = [
      el.getAttribute?.("data-ep-shell-route"),
      el.getAttribute?.("data-route"),
      el.getAttribute?.("onclick"),
      el.id,
      el.className
    ].filter(Boolean).join(" ").toLowerCase();

    if (attrs.includes("database") || attrs.includes("db24") || attrs.includes("db25")) return true;
    if (text.includes("база данных") && text.length < 120) return true;
    return false;
  }

  function isBurgerPanel(el) {
    if (!el) return false;
    const t = norm(el.textContent);
    return t.includes("главный экран") && t.includes("база данных") && t.includes("выйти");
  }

  function findDbRows() {
    const roots = Array.from(document.querySelectorAll("#side-menu,#drawer,.side-menu,.sidebar,.drawer,.burger-menu,aside,nav,[data-menu]"))
      .filter(isBurgerPanel);

    const rows = [];
    roots.forEach(root => {
      root.querySelectorAll("button,a,li,div,[role='button']").forEach(el => {
        if (isDbRow(el)) {
          const r = el.getBoundingClientRect();
          const text = norm(el.textContent);
          if (r.height > 130 || text.length > 140) return;
          rows.push(el);
        }
      });
    });

    return rows;
  }

  function versionElements(row) {
    const els = Array.from(row.querySelectorAll("span,em,b,strong,small,i,div"));
    return els.filter(el => {
      const t = (el.textContent || "").trim();
      const cls = String(el.className || "").toLowerCase();
      return /^v\d+(\.\d+){0,3}$/i.test(t) || cls.includes("badge") || cls.includes("version");
    });
  }

  function fixDbBadge() {
    findDbRows().forEach(row => {
      row.setAttribute("data-db256-row", "1");

      let badges = versionElements(row)
        .filter(el => !/база данных/i.test(el.textContent || ""));

      if (!badges.length) {
        const badge = document.createElement("span");
        badge.className = "db256-burger-badge";
        badge.textContent = VERSION;
        row.appendChild(badge);
        badges = [badge];
      }

      badges.forEach((el, idx) => {
        if (idx === 0) {
          el.textContent = VERSION;
          el.classList.add("db256-burger-badge");
          el.style.display = "";
          el.style.visibility = "visible";
        } else {
          el.classList.add("db256-hide-extra-badge");
          el.style.display = "none";
        }
      });
    });
  }

  function findTrigger(event) {
    const path = event.composedPath ? event.composedPath() : [];
    for (const node of path) {
      if (!(node instanceof Element)) continue;
      if (node === document.body || node === document.documentElement) break;
      if (isDbRow(node)) return node;
    }

    let el = event.target instanceof Element ? event.target : null;
    let depth = 0;
    while (el && depth < 8 && el !== document.body) {
      if (isDbRow(el)) return el;
      el = el.parentElement;
      depth++;
    }
    return null;
  }

  function openDb() {
    try {
      window.DatabaseV256SafeMonolith?.open?.();
      return true;
    } catch (e) {}

    try {
      window.DatabaseV25HardMonolith?.open?.();
      return true;
    } catch (e) {}

    try {
      window.DatabaseV24CleanMonolith?.open?.();
      return true;
    } catch (e) {}

    return false;
  }

  function bind() {
    if (window.__dbV256BurgerBound) return;
    window.__dbV256BurgerBound = true;

    document.addEventListener("click", event => {
      const trigger = findTrigger(event);
      if (!trigger) return;

      event.preventDefault();
      event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();

      const ok = openDb();
      if (!ok) alert("Не найден модуль БД V25.6.");

      log("db-menu-open", "База данных открыта из бургер-меню.");
    }, true);
  }

  function boot() {
    bind();
    fixDbBadge();
  }

  function observe() {
    if (window.__dbV256BurgerObserver) return;

    const obs = new MutationObserver(() => {
      clearTimeout(window.__dbV256BurgerTimer);
      window.__dbV256BurgerTimer = setTimeout(boot, 120);
    });

    obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style"] });
    window.__dbV256BurgerObserver = obs;
  }

  window.addEventListener("DOMContentLoaded", () => {
    boot();
    observe();
    [300, 900, 1800, 3200].forEach(ms => setTimeout(boot, ms));
  });

  window.DBV256BurgerRouteBadge = {
    version: VERSION,
    boot,
    fixDbBadge,
    openDb
  };

  log("ready", "Исправление бейджа БД и открытия монолита V25.6 готово.");
})();
