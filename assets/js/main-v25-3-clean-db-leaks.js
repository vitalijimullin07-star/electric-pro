(function () {
  const VERSION = "V25.3";
  const FILE = "assets/js/main-v25-3-clean-db-leaks.js";

  function log(code, message, extra = {}) {
    try {
      window.Diagnostics?.ok?.({
        file: FILE,
        module: "MainV253CleanDbLeaks",
        functionName: "runtime",
        place: "main-screen",
        code,
        message,
        ...extra
      });
    } catch (e) {}
  }

  function isVisible(el) {
    if (!el) return false;
    const st = getComputedStyle(el);
    if (st.display === "none" || st.visibility === "hidden") return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function db25Screen() {
    return document.getElementById("ep-db-v25-screen");
  }

  function isDb25Open() {
    const s = db25Screen();
    return !!(s && !s.classList.contains("hidden") && isVisible(s));
  }

  function isInsideAllowedDb(el) {
    return !!(
      el.closest("#ep-db-v25-screen") ||
      el.closest(".db25-modal") ||
      el.closest("#db25-card-modal") ||
      el.closest("#db25-edit-modal") ||
      el.closest("#db25-server-import") ||
      el.closest("#db25-diag-modal")
    );
  }

  function looksLikeOldDbContainer(el) {
    if (!el || isInsideAllowedDb(el)) return false;

    const idClass = [
      el.id || "",
      el.className || "",
      el.getAttribute?.("data-screen") || ""
    ].join(" ").toLowerCase();

    if (
      /ep-db-v24|db244|db243|database-screen|db-screen|database-v24|database-file|db-file|db-manager/.test(idClass)
    ) {
      return true;
    }

    const text = (el.textContent || "").replace(/\s+/g, " ").trim();
    if (!text) return false;

    // Старая заглушка.
    if (/База данных/i.test(text) && /Database API|прослойк|Firebase/i.test(text)) return true;

    // Старый редактор БД.
    if (/Редактор БД/i.test(text) && /БД сервера|БД моя|БД мастеров|Экспорт \/ импорт/i.test(text)) return true;

    // Старый список БД, который вылез на главный экран.
    if (/редактирование доступно/i.test(text) && /Работы|Материалы/i.test(text) && /₽\s*\/\s*(шт|м|м\.п|ед)/i.test(text)) return true;

    // Отдельные карточки позиций БД с чекбоксами.
    const hasCheckbox = !!el.querySelector?.("input[type='checkbox']");
    if (hasCheckbox && /₽\s*\/\s*(шт|м|м\.п|ед)\s*·\s*(Работа|Материал)/i.test(text)) return true;

    // Папки/подпапки старой БД.
    if (hasCheckbox && /Высверливание|Монтаж|Освещение|Штробление|Подрозетник|ГМЛ|Термоусадка/i.test(text) && /V20|V24|V25/i.test(text)) {
      return true;
    }

    return false;
  }

  function hideOldDbScreens() {
    const selectors = [
      "#ep-db-v244-screen",
      "#ep-db-v243-screen",
      "#ep-db-v24-screen",
      "#ep-database-screen",
      "[data-screen='database']",
      "[data-route='database']",
      ".database-screen",
      ".db244-screen",
      ".db243-screen",
      ".db24-screen"
    ];

    document.querySelectorAll(selectors.join(",")).forEach(el => {
      if (el.id === "ep-db-v25-screen") return;
      if (isInsideAllowedDb(el)) return;
      el.classList.add("main-v253-hide-db-leak");
      el.setAttribute("data-main-v253-hidden", "old-db-screen");
    });
  }

  function hideOrphanDbCards() {
    if (isDb25Open()) {
      document.body.classList.add("main-v253-db-open");
      return;
    }

    document.body.classList.remove("main-v253-db-open");

    const candidates = Array.from(document.querySelectorAll(
      "section,main,article,div,ul,li,button,label"
    ));

    let hidden = 0;

    candidates.forEach(el => {
      if (el === document.body || el === document.documentElement) return;
      if (isInsideAllowedDb(el)) return;
      if (el.closest(".side-menu,.sidebar,.drawer,.burger-menu,#side-menu,#drawer,nav,aside")) return;

      // Не трогаем верхнюю шапку и карточки главного экрана.
      const r = el.getBoundingClientRect();
      if (r.top < 90 && r.height < 140) return;

      if (looksLikeOldDbContainer(el)) {
        el.classList.add("main-v253-hide-db-leak");
        el.setAttribute("data-main-v253-hidden", "orphan-db");
        hidden++;
      }
    });

    if (hidden) {
      log("main-v25-3-db-leaks-hidden", "Скрыты старые элементы БД на главном экране.", { hidden });
    }
  }

  function restoreWhenDbOpens() {
    if (!isDb25Open()) return;
    document.querySelectorAll("[data-main-v253-hidden='orphan-db']").forEach(el => {
      el.classList.remove("main-v253-hide-db-leak");
      el.removeAttribute("data-main-v253-hidden");
    });
  }

  function patchDbOpenClose() {
    const mod = window.DatabaseV25HardMonolith;
    if (mod && !mod.__mainV253Patched) {
      if (typeof mod.open === "function") {
        const oldOpen = mod.open.bind(mod);
        mod.open = function (...args) {
          const result = oldOpen(...args);
          setTimeout(() => {
            document.body.classList.add("main-v253-db-open");
            restoreWhenDbOpens();
          }, 50);
          return result;
        };
      }

      if (typeof mod.close === "function") {
        const oldClose = mod.close.bind(mod);
        mod.close = function (...args) {
          const result = oldClose(...args);
          setTimeout(() => {
            document.body.classList.remove("main-v253-db-open");
            hideOldDbScreens();
            hideOrphanDbCards();
          }, 80);
          return result;
        };
      }

      mod.__mainV253Patched = true;
    }
  }

  function cleanHardMenuVisual() {
    // На всякий случай гасим следы тяжёлого визуала V24.5,
    // но не перерисовываем бургер-панель.
    document.querySelectorAll(".ep-shell-v245-root").forEach(el => {
      el.classList.remove("ep-shell-v245-root");
      el.classList.add("shell-v252-visual-restored");
    });
  }

  function boot() {
    patchDbOpenClose();
    cleanHardMenuVisual();
    hideOldDbScreens();

    if (isDb25Open()) {
      document.body.classList.add("main-v253-db-open");
      restoreWhenDbOpens();
    } else {
      document.body.classList.remove("main-v253-db-open");
      hideOrphanDbCards();
    }
  }

  function observe() {
    if (window.__mainV253Observer) return;

    const obs = new MutationObserver(() => {
      clearTimeout(window.__mainV253Timer);
      window.__mainV253Timer = setTimeout(boot, 120);
    });

    obs.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style"]
    });

    window.__mainV253Observer = obs;
  }

  window.addEventListener("DOMContentLoaded", function () {
    boot();
    observe();
    [300, 900, 1800, 3200].forEach(ms => setTimeout(boot, ms));
  });

  window.MainV253CleanDbLeaks = {
    version: VERSION,
    boot,
    hideOldDbScreens,
    hideOrphanDbCards
  };

  log("main-v25-3-clean-db-leaks-ready", "Чистка старых элементов БД на главном экране готова.");
})();
