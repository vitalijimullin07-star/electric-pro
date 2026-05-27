(function () {
  const VERSION = "V24.3.1";
  const FILE = "assets/js/database-file-manager-v24-3-1-card-modal-fix.js";

  function diag(code, message, extra = {}) {
    try {
      window.Diagnostics?.ok?.({
        file: FILE,
        module: "DatabaseCardModalFixV2431",
        functionName: "runtime",
        place: "database",
        code,
        message,
        ...extra
      });
    } catch (e) {}
  }

  function forceVersion() {
    const s = document.getElementById("ep-db-v243-screen");
    if (!s) return;

    const p = s.querySelector(".db243-head p");
    if (p) {
      p.textContent = (p.textContent || "").replace(/V24\.\d+(?:\.\d+)?/g, VERSION);
      if (!p.textContent.includes(VERSION)) p.textContent += " · " + VERSION;
    }

    try {
      window.ModuleVersionBadgesV212?.setVersion?.("database", VERSION);
      window.ModuleVersionBadgesV212?.apply?.();
    } catch (e) {}
  }

  function closeCard() {
    document.getElementById("db-v243-card-modal")?.classList.add("hidden");
  }

  function fallbackEdit(id) {
    if (!id || !window.DatabaseFileManagerV243) return;

    const db = window.DatabaseFileManagerV243;
    const bases = ["my", "server", "masters"];
    let foundBase = "";
    let items = [];
    let item = null;

    for (const base of bases) {
      try {
        const arr = db.getBase?.(base) || [];
        const hit = arr.find(x => x.id === id);
        if (hit) {
          foundBase = base;
          items = arr;
          item = hit;
          break;
        }
      } catch (e) {}
    }

    if (!item) return;

    if (foundBase === "masters") {
      alert("БД мастера открыта только для просмотра. Можно выбрать позиции и добавить их в БД сервера.");
      return;
    }

    if (foundBase === "server") {
      const email =
        (window.firebase?.auth?.().currentUser?.email || window.auth?.currentUser?.email || "").toLowerCase();
      if (email !== "vits0007@gmail.com") {
        alert("БД сервера редактирует только админ.");
        return;
      }
    }

    const name = prompt("Название", item.name);
    if (name === null) return;
    const category = prompt("Категория", item.category);
    if (category === null) return;
    const subcategory = prompt("Подкатегория", item.subcategory);
    if (subcategory === null) return;
    const unit = prompt("Единица", item.unit);
    if (unit === null) return;
    const price = prompt("Цена", String(item.price));
    if (price === null) return;

    item.name = name;
    item.category = category;
    item.subcategory = subcategory;
    item.group = subcategory;
    item.unit = unit;
    item.price = Number.isFinite(Number(price)) ? Number(price) : 0;
    item.updatedAt = new Date().toISOString();

    try { db.setBase?.(foundBase, items); } catch (e) {}

    closeCard();
    try { db.open?.(); } catch (e) {}
  }

  function bind() {
    if (window.__dbV2431ModalFixBound) return;
    window.__dbV2431ModalFixBound = true;

    document.addEventListener("click", function (event) {
      const modal = event.target.closest("#db-v243-card-modal");
      if (!modal) return;

      if (event.target.closest("[data-db243-card-close]")) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        closeCard();
        return;
      }

      const edit = event.target.closest("[data-db243-edit]");
      if (edit) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        fallbackEdit(edit.getAttribute("data-db243-edit"));
      }
    }, true);
  }

  function patchOpen() {
    if (!window.DatabaseFileManagerV243 || window.DatabaseFileManagerV243.__v2431ModalFixPatched) return;
    const oldOpen = window.DatabaseFileManagerV243.open?.bind(window.DatabaseFileManagerV243);
    if (typeof oldOpen === "function") {
      window.DatabaseFileManagerV243.open = function (...args) {
        const result = oldOpen(...args);
        [80, 250, 700].forEach(ms => setTimeout(forceVersion, ms));
        return result;
      };
      window.DatabaseFileManagerV243.__v2431ModalFixPatched = true;
    }
  }

  function boot() {
    bind();
    patchOpen();
    forceVersion();
  }

  window.addEventListener("DOMContentLoaded", function () {
    boot();
    [500, 1500, 3000].forEach(ms => setTimeout(boot, ms));
  });

  window.DatabaseCardModalFixV2431 = { version: VERSION, boot, forceVersion };
  diag("database-card-modal-fix-v24-3-1-ready", "Database card modal fix V24.3.1 ready.");
})();
