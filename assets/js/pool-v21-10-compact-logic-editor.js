(function () {
  const FILE = "assets/js/pool-v21-10-compact-logic-editor.js";
  const VERSION = "V21.10";

  function diag(level, code, message) {
    const payload = {
      file: FILE,
      module: "PoolV2110CompactLogicEditor",
      functionName: "runtime",
      place: "pool",
      code,
      message
    };
    if (level === "error") window.Diagnostics?.error?.(payload);
    else window.Diagnostics?.ok?.(payload);
  }

  function compactLogicEditor() {
    const screen = document.getElementById("ep-pool-v21-screen");
    if (!screen) return;

    const badge =
      screen.querySelector(".p21-7-head b") ||
      screen.querySelector(".ep-pool-v21-db") ||
      screen.querySelector("#ep-pool-v21-db-pill");

    if (badge) badge.textContent = VERSION;

    const logicCard = screen.querySelector(".p21-9-logic-card");
    if (logicCard) {
      logicCard.classList.add("p21-10-logic-compact");
    }

    const logicBody = screen.querySelector(".p21-9-logic-body");
    if (logicBody) {
      logicBody.classList.add("p21-10-logic-body");
    }

    const grid = screen.querySelector(".p21-9-grid");
    if (grid) {
      grid.classList.add("p21-10-grid");
    }

    // Добавляем короткие подписи в data-title, чтобы CSS мог компактно держать поля.
    screen.querySelectorAll(".p21-9-grid label").forEach(label => {
      if (!label.dataset.shortTitle) {
        const txt = (label.childNodes[0]?.textContent || label.textContent || "").trim();
        label.dataset.shortTitle = txt;
      }
    });

    // Чуть сокращаем длинные подписи визуально, не меняя данные.
    const names = new Map([
      ["Обычный подрозетник от, мм", "Обычный от"],
      ["Обычный подрозетник до, мм", "Обычный до"],
      ["Глубокий от, мм", "Глубокий от"],
      ["Глубокий до, мм", "Глубокий до"],
      ["Обычная штроба", "Обычная"],
      ["Соед. в подрозетниках", "В подрозетн."],
      ["Тёплый пол сверху", "Т.п. сверху"],
      ["Тёплый пол вниз", "Т.п. вниз"],
      ["Распайки на розеточный спуск", "Расп. розетки"],
      ["Распайки на выключатель", "Расп. выкл."],
      ["Термоусадка", "Термоусадка"],
      ["См на соединение", "См/соед."]
    ]);

    screen.querySelectorAll(".p21-9-grid label").forEach(label => {
      const input = label.querySelector("input");
      if (!input) return;

      const raw = label.dataset.shortTitle || "";
      const short = names.get(raw) || raw;
      let textNode = Array.from(label.childNodes).find(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
      if (textNode) textNode.textContent = short;
      else label.insertBefore(document.createTextNode(short), input);
    });
  }

  function updateBadges() {
    try {
      window.ModuleVersionBadgesV212?.setVersion?.("pool", VERSION);
      window.ModuleVersionBadgesV212?.setVersion?.("rough", VERSION);
      window.ModuleVersionBadgesV212?.apply?.();
    } catch {}
  }

  function patchPoolOpen() {
    if (!window.PoolV21 || window.PoolV21.__v2110CompactPatched) return false;

    const oldOpen = window.PoolV21.open?.bind(window.PoolV21);
    window.PoolV21.open = function (...args) {
      const result = oldOpen ? oldOpen(...args) : undefined;
      setTimeout(compactLogicEditor, 60);
      setTimeout(compactLogicEditor, 350);
      setTimeout(compactLogicEditor, 900);
      return result;
    };

    window.PoolV21.__v2110CompactPatched = true;
    return true;
  }

  function init() {
    const boot = () => {
      patchPoolOpen();
      compactLogicEditor();
      updateBadges();
    };

    boot();
    setTimeout(boot, 700);
    setTimeout(boot, 1800);
    setTimeout(boot, 3500);

    window.PoolV2110CompactLogicEditor = {
      compactLogicEditor,
      updateBadges
    };

    diag("ok", "pool-v21-10-ready", "Pool V21.10 compact logic editor ready.");
  }

  window.addEventListener("DOMContentLoaded", init);
})();
