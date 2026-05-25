(function () {
  const VERSION = "V24.3.2";
  const FILE = "assets/js/v24-3-2-menu-diagnostics-fix.js";

  function diag(code, message, extra = {}) {
    try {
      window.Diagnostics?.ok?.({
        file: FILE,
        module: "MenuDiagnosticsFixV2432",
        functionName: "runtime",
        place: "ui",
        code,
        message,
        ...extra
      });
    } catch (e) {}
  }

  function toast(text) {
    let box = document.getElementById("ep-v2432-toast");
    if (!box) {
      box = document.createElement("div");
      box.id = "ep-v2432-toast";
      document.body.appendChild(box);
    }
    box.textContent = text;
    box.classList.add("show");
    clearTimeout(window.__v2432Toast);
    window.__v2432Toast = setTimeout(() => box.classList.remove("show"), 1700);
  }

  function isDbButton(el) {
    if (!el) return false;

    const text = (el.textContent || "").trim().toLowerCase();
    const attrs = [
      el.getAttribute?.("data-db243-open"),
      el.getAttribute?.("data-db-v24-open"),
      el.getAttribute?.("data-db-v242-open"),
      el.getAttribute?.("data-route"),
      el.getAttribute?.("onclick"),
      el.className
    ].filter(Boolean).join(" ").toLowerCase();

    return (
      text.includes("база данных") ||
      attrs.includes("data-db243-open") ||
      attrs.includes("data-db-v24-open") ||
      attrs.includes("database") ||
      attrs.includes("db")
    ) && !text.includes("черновик");
  }

  function badgeText(v) {
    return `<span class="v2432-db-badge">${v}</span>`;
  }

  function normalizeDbButton(btn) {
    if (!btn) return;
    btn.setAttribute("data-db243-open", "1");
    btn.removeAttribute("data-db-v24-open");
    btn.removeAttribute("data-db-v242-open");
    btn.classList.add("v2432-main-db-button");

    const txt = "📁 База данных";
    const current = btn.innerHTML || "";
    if (!current.includes("V24.3.2")) {
      btn.innerHTML = `<span>${txt}</span>${badgeText("V24.3.2")}`;
    }

    btn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      try {
        window.DatabaseFileManagerV243?.open?.();
      } catch (err) {}
    }, true);
  }

  function dedupeDbMenuButtons() {
    const menuCandidates = [
      "#side-menu",
      "#drawer",
      ".side-menu",
      ".sidebar",
      ".drawer",
      ".burger-menu",
      "[data-menu]",
      "nav"
    ];

    const menus = Array.from(document.querySelectorAll(menuCandidates.join(",")));
    if (!menus.length) return;

    menus.forEach(menu => {
      const buttons = Array.from(menu.querySelectorAll("button, a, [role='button'], .menu-item, .nav-item"))
        .filter(isDbButton);

      if (!buttons.length) return;

      // Оставляем последнюю актуальную кнопку, потому что V24.3 обычно добавлялся позже старых V24.1/V24.2.
      const keep = buttons.find(b => b.hasAttribute("data-db243-open")) || buttons[buttons.length - 1];

      buttons.forEach(btn => {
        if (btn !== keep) {
          const row = btn.closest("li") || btn.closest(".menu-row") || btn.closest(".nav-row") || btn;
          row.remove();
        }
      });

      normalizeDbButton(keep);
    });
  }

  function forceDbVersion() {
    const s = document.getElementById("ep-db-v243-screen");
    if (s) {
      const p = s.querySelector(".db243-head p");
      if (p) {
        p.textContent = (p.textContent || "").replace(/V24\.\d+(?:\.\d+)?/g, VERSION);
        if (!p.textContent.includes(VERSION)) p.textContent += " · " + VERSION;
      }
    }

    try {
      window.ModuleVersionBadgesV212?.setVersion?.("database", VERSION);
      window.ModuleVersionBadgesV212?.apply?.();
    } catch (e) {}
  }

  function findDiagnosticsRoot() {
    const ids = [
      "diagnostics-panel",
      "ep-diagnostics-panel",
      "diagnostics",
      "diag-panel",
      "ep-diagnostics"
    ];

    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) return el;
    }

    const candidates = Array.from(document.querySelectorAll("section, div, main, aside"))
      .filter(el => {
        const text = (el.textContent || "").slice(0, 2000).toLowerCase();
        return text.includes("electric pro diagnostics") ||
               text.includes("версия:") && text.includes("сессия:") && text.includes("событие");
      })
      .sort((a, b) => (a.textContent || "").length - (b.textContent || "").length);

    return candidates[0] || null;
  }

  function diagnosticsText(root) {
    if (!root) return "";

    const clone = root.cloneNode(true);
    clone.querySelectorAll(".diag-v2432-toolbar, button, input, textarea, select").forEach(el => el.remove());

    return (clone.innerText || clone.textContent || "").trim();
  }

  function localStorageDiagnostics() {
    const out = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;
        const lk = key.toLowerCase();
        if (lk.includes("diag") || lk.includes("log") || lk.includes("event")) {
          const raw = localStorage.getItem(key);
          try { out[key] = JSON.parse(raw); }
          catch (e) { out[key] = raw; }
        }
      }
    } catch (e) {}
    return out;
  }

  function copyDiagnostics() {
    const root = findDiagnosticsRoot();
    const text = diagnosticsText(root) || "Диагностика не найдена.";

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => toast("Диагностика скопирована."))
        .catch(() => fallbackCopy(text));
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try {
      document.execCommand("copy");
      toast("Диагностика скопирована.");
    } catch (e) {
      toast("Не удалось скопировать.");
    }
    ta.remove();
  }

  function exportDiagnosticsJson() {
    const root = findDiagnosticsRoot();
    const payload = {
      version: VERSION,
      exportedAt: new Date().toISOString(),
      page: location.href,
      text: diagnosticsText(root),
      localStorageDiagnostics: localStorageDiagnostics()
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "electric-pro-diagnostics-" + new Date().toISOString().replace(/[:.]/g, "-") + ".json";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 500);

    toast("Диагностика экспортирована JSON.");
  }

  function clearDiagnostics() {
    try {
      window.Diagnostics?.clear?.();
    } catch (e) {}

    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        const lk = String(key || "").toLowerCase();
        if (lk.includes("diag") || lk.includes("diagnostic")) localStorage.removeItem(key);
      }
    } catch (e) {}

    const root = findDiagnosticsRoot();
    if (root) {
      const events = Array.from(root.querySelectorAll("*"))
        .filter(el => /событие\s*#|----\s*событие/i.test(el.textContent || ""));
      events.forEach(el => el.remove());
    }

    toast("Диагностика очищена.");
    setTimeout(refreshDiagnostics, 150);
  }

  function refreshDiagnostics() {
    try {
      window.Diagnostics?.render?.();
      window.Diagnostics?.sync?.();
      window.Diagnostics?.refresh?.();
    } catch (e) {}

    setTimeout(placeDiagnosticsToolbar, 80);
    toast("Диагностика обновлена.");
  }

  function placeDiagnosticsToolbar() {
    const root = findDiagnosticsRoot();
    if (!root) return;

    if (root.querySelector(".diag-v2432-toolbar")) return;

    const toolbar = document.createElement("div");
    toolbar.className = "diag-v2432-toolbar";
    toolbar.innerHTML = `
      <button type="button" data-diag-v2432-clear>Очистить</button>
      <button type="button" data-diag-v2432-refresh>Обновить</button>
      <button type="button" data-diag-v2432-copy>Копировать</button>
      <button type="button" data-diag-v2432-export>Экспорт JSON</button>
    `;

    const firstBlock = root.firstElementChild;
    if (firstBlock) root.insertBefore(toolbar, firstBlock);
    else root.appendChild(toolbar);
  }

  function bindDiagnosticsToolbar() {
    if (window.__diagV2432ToolbarBound) return;
    window.__diagV2432ToolbarBound = true;

    document.addEventListener("click", function (e) {
      if (e.target.closest("[data-diag-v2432-clear]")) {
        e.preventDefault();
        clearDiagnostics();
        return;
      }
      if (e.target.closest("[data-diag-v2432-refresh]")) {
        e.preventDefault();
        refreshDiagnostics();
        return;
      }
      if (e.target.closest("[data-diag-v2432-copy]")) {
        e.preventDefault();
        copyDiagnostics();
        return;
      }
      if (e.target.closest("[data-diag-v2432-export]")) {
        e.preventDefault();
        exportDiagnosticsJson();
      }
    }, true);
  }

  function patchDbOpen() {
    if (!window.DatabaseFileManagerV243 || window.DatabaseFileManagerV243.__v2432Patched) return;

    const oldOpen = window.DatabaseFileManagerV243.open?.bind(window.DatabaseFileManagerV243);
    if (typeof oldOpen === "function") {
      window.DatabaseFileManagerV243.open = function (...args) {
        const result = oldOpen(...args);
        [80, 250, 700, 1200].forEach(ms => setTimeout(function () {
          dedupeDbMenuButtons();
          forceDbVersion();
        }, ms));
        return result;
      };
      window.DatabaseFileManagerV243.__v2432Patched = true;
    }
  }

  function observe() {
    if (window.__v2432Observer) return;

    const obs = new MutationObserver(function () {
      clearTimeout(window.__v2432ObsTimer);
      window.__v2432ObsTimer = setTimeout(function () {
        dedupeDbMenuButtons();
        forceDbVersion();
        placeDiagnosticsToolbar();
      }, 80);
    });

    obs.observe(document.body, { childList: true, subtree: true });
    window.__v2432Observer = obs;
  }

  function boot() {
    patchDbOpen();
    bindDiagnosticsToolbar();
    dedupeDbMenuButtons();
    forceDbVersion();
    placeDiagnosticsToolbar();
    observe();
  }

  window.addEventListener("DOMContentLoaded", function () {
    boot();
    [300, 900, 1800, 3500].forEach(ms => setTimeout(boot, ms));
  });

  window.MenuDiagnosticsFixV2432 = {
    version: VERSION,
    boot,
    dedupeDbMenuButtons,
    placeDiagnosticsToolbar,
    exportDiagnosticsJson
  };

  diag("menu-diagnostics-fix-v24-3-2-ready", "Menu and diagnostics fix V24.3.2 ready.");
})();
