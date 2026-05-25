(function () {
  const VERSION = "V24.3.3";
  const FILE = "assets/js/database-v24-3-3-import-autosave.js";
  const AUTOSAVE_KEY = "ep_db_v24_3_3_last_autosave";
  const CLOUD_SYNC_FLAG = "ep_db_v24_3_3_last_cloud_status";

  const ui = {
    modal: null,
    importSection: "work",
    selected: new Set(),
    openCats: new Set(),
    openSubs: new Set()
  };

  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[c]));

  const norm = v => String(v ?? "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[×хx]/g, "x")
    .replace(/[^a-zа-я0-9x.,\s/-]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  function diag(code, message, extra = {}) {
    try {
      window.Diagnostics?.ok?.({
        file: FILE,
        module: "DatabaseV2433ImportAutosave",
        functionName: "runtime",
        place: "database",
        code,
        message,
        ...extra
      });
    } catch (e) {}
  }

  function toast(text) {
    let box = document.getElementById("ep-db-v2433-toast");
    if (!box) {
      box = document.createElement("div");
      box.id = "ep-db-v2433-toast";
      document.body.appendChild(box);
    }
    box.textContent = text;
    box.classList.add("show");
    clearTimeout(window.__dbV2433Toast);
    window.__dbV2433Toast = setTimeout(() => box.classList.remove("show"), 1800);
  }

  function db() {
    return window.DatabaseFileManagerV243;
  }

  function getBase(name) {
    try { return db()?.getBase?.(name) || []; } catch (e) { return []; }
  }

  function setBase(name, items) {
    try { return db()?.setBase?.(name, items); } catch (e) {}
  }

  function screen() {
    return document.getElementById("ep-db-v243-screen");
  }

  function isDbOpen() {
    const s = screen();
    return s && !s.classList.contains("hidden");
  }

  function currentView() {
    const txt = (screen()?.querySelector(".db243-head b")?.textContent || "").toLowerCase();
    if (txt.includes("сервер")) return "server";
    if (txt.includes("мастер")) return "masters";
    return "my";
  }

  function currentSection() {
    const active = screen()?.querySelector("[data-db243-section].active");
    return active?.getAttribute("data-db243-section") === "material" ? "material" : "work";
  }

  function money(v) {
    return Math.round(Number(v || 0)).toLocaleString("ru-RU") + " ₽";
  }

  function autosaveStatusText() {
    let saved = "";
    let cloud = "";
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      if (raw) {
        const d = new Date(raw);
        saved = "Сохранено: " + d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      }
    } catch (e) {}
    try {
      cloud = localStorage.getItem(CLOUD_SYNC_FLAG) || "";
    } catch (e) {}
    return saved || cloud || "Автосохранение готово";
  }

  function setSavingStatus(status, detail = "") {
    let pill = document.getElementById("db2433-save-status");
    if (!pill && screen()) {
      pill = document.createElement("div");
      pill.id = "db2433-save-status";
      pill.className = "db2433-save-status";
      const head = screen().querySelector(".db243-head");
      head?.insertAdjacentElement("afterend", pill);
    }
    if (!pill) return;

    pill.dataset.status = status;
    pill.innerHTML = `
      <span>${status === "saving" ? "⏳" : status === "cloud-error" ? "⚠️" : "✅"}</span>
      <b>${esc(detail || autosaveStatusText())}</b>
    `;
  }

  async function tryCloudSync(baseName, items) {
    const firebase = window.firebase;
    try {
      if (!firebase?.auth || !firebase?.firestore) {
        localStorage.setItem(CLOUD_SYNC_FLAG, "Локально сохранено");
        return false;
      }

      const user = firebase.auth().currentUser;
      if (!user) {
        localStorage.setItem(CLOUD_SYNC_FLAG, "Локально сохранено, вход не найден");
        return false;
      }

      const fs = firebase.firestore();
      const payload = {
        updatedAt: new Date().toISOString(),
        ownerUid: user.uid,
        ownerEmail: user.email || "",
        baseName,
        items
      };

      if (baseName === "server") {
        await fs.collection("ep_database_v24").doc("server").set(payload, { merge: true });
      } else if (baseName === "my") {
        await fs.collection("ep_user_database_v24").doc(user.uid).set(payload, { merge: true });
      }

      localStorage.setItem(CLOUD_SYNC_FLAG, "Сервер: сохранено");
      return true;
    } catch (e) {
      console.warn("DB cloud sync failed", e);
      localStorage.setItem(CLOUD_SYNC_FLAG, "Сервер недоступен, сохранено локально");
      return false;
    }
  }

  function patchSetBaseForAutosave() {
    if (!db() || db().__v2433AutosavePatched) return;

    const oldSetBase = db().setBase?.bind(db());
    if (typeof oldSetBase !== "function") return;

    db().setBase = function (baseName, items) {
      setSavingStatus("saving", "Сохраняю...");
      const result = oldSetBase(baseName, items);

      try {
        localStorage.setItem(AUTOSAVE_KEY, new Date().toISOString());
      } catch (e) {}

      setTimeout(async () => {
        await tryCloudSync(baseName, items || []);
        setSavingStatus("saved", autosaveStatusText());
        toast("БД сохранена.");
      }, 80);

      return result;
    };

    db().__v2433AutosavePatched = true;
  }

  function forceVersion() {
    const s = screen();
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

  function syncActiveHighlights() {
    const s = screen();
    if (!s) return;

    const view = currentView();
    s.querySelectorAll("[data-db243-view]").forEach(btn => {
      const v = btn.getAttribute("data-db243-view");
      btn.classList.toggle("active", v === view);
      btn.classList.toggle("db2433-active", v === view);
    });

    const section = currentSection();
    s.querySelectorAll("[data-db243-section]").forEach(btn => {
      const v = btn.getAttribute("data-db243-section");
      btn.classList.toggle("active", v === section);
      btn.classList.toggle("db2433-active", v === section);
    });

    setSavingStatus("saved", autosaveStatusText());
  }

  function hideOldServerImportInsideEditor() {
    const s = screen();
    if (!s) return;

    s.querySelectorAll(".db243-editor-block").forEach(block => {
      const h = (block.querySelector("h4")?.textContent || "").toLowerCase();
      if (h.includes("импорт из бд сервера")) {
        block.classList.add("db2433-old-import-hidden");
      }
    });
  }

  function ensureServerImportButton() {
    const s = screen();
    if (!s) return;

    let old = document.getElementById("db2433-server-import-card");
    if (currentView() !== "my") {
      old?.remove();
      return;
    }

    if (old) return;

    const card = document.createElement("section");
    card.id = "db2433-server-import-card";
    card.className = "db243-card db2433-import-card";
    card.innerHTML = `
      <button type="button" class="db2433-import-toggle" data-db2433-open-import>
        <span>▸</span>
        <b>Импорт из БД сервера</b>
        <em>выбор папок, подпапок и позиций</em>
      </button>
    `;

    const editorCard = Array.from(s.querySelectorAll(".db243-card")).find(el =>
      /Редактор БД/i.test(el.textContent || "")
    );

    if (editorCard) editorCard.insertAdjacentElement("afterend", card);
    else s.querySelector(".db243-shell")?.prepend(card);
  }

  function grouped(items) {
    const map = new Map();
    items.forEach(item => {
      const cat = item.category || "Без категории";
      const sub = item.subcategory || "Без подкатегории";
      if (!map.has(cat)) map.set(cat, new Map());
      const subMap = map.get(cat);
      if (!subMap.has(sub)) subMap.set(sub, []);
      subMap.get(sub).push(item);
    });

    return Array.from(map.entries()).map(([category, subMap]) => ({
      category,
      subgroups: Array.from(subMap.entries()).map(([subcategory, rows]) => ({
        subcategory,
        rows: rows.sort((a,b) => String(a.name).localeCompare(String(b.name)))
      })).sort((a,b) => a.subcategory.localeCompare(b.subcategory))
    })).sort((a,b) => a.category.localeCompare(b.category));
  }

  function importItems() {
    return getBase("server")
      .filter(x => x && x.active !== false)
      .filter(x => x.type === ui.importSection);
  }

  function openImportModal() {
    ui.importSection = currentSection();
    ui.selected.clear();
    renderImportModal();
  }

  function closeImportModal() {
    document.getElementById("db2433-import-modal")?.classList.add("hidden");
  }

  function renderImportModal() {
    let modal = document.getElementById("db2433-import-modal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "db2433-import-modal";
      modal.className = "db2433-import-modal hidden";
      document.body.appendChild(modal);
    }

    const items = importItems();
    const groups = grouped(items);
    const selectedCount = ui.selected.size;

    modal.innerHTML = `
      <div class="db2433-backdrop" data-db2433-close-import></div>
      <div class="db2433-import-sheet">
        <div class="db2433-import-head">
          <div>
            <h3>Импорт из БД сервера</h3>
            <p>Выбери папки, подпапки или отдельные позиции</p>
          </div>
          <button type="button" data-db2433-close-import>×</button>
        </div>

        <div class="db2433-import-tabs">
          <button type="button" data-db2433-import-section="work" class="${ui.importSection === "work" ? "active" : ""}">Работа</button>
          <button type="button" data-db2433-import-section="material" class="${ui.importSection === "material" ? "active" : ""}">Материал</button>
        </div>

        <div class="db2433-import-summary">
          <span>Сервер: ${items.length} поз.</span>
          <span>Выбрано: ${selectedCount}</span>
        </div>

        <div class="db2433-import-actions">
          <button type="button" data-db2433-select-all-import>Выделить всё</button>
          <button type="button" data-db2433-clear-import>Снять</button>
          <button type="button" data-db2433-add-with-price>Добавить с ценой</button>
          <button type="button" data-db2433-add-no-price>Добавить без цены</button>
        </div>

        <div class="db2433-import-tree">
          ${groups.length ? groups.map(renderGroup).join("") : `<div class="db2433-empty">В БД сервера нет позиций этого типа.</div>`}
        </div>
      </div>
    `;

    modal.classList.remove("hidden");
  }

  function renderGroup(group) {
    const catKey = "cat|" + ui.importSection + "|" + group.category;
    const open = ui.openCats.has(catKey);
    const allCatIds = group.subgroups.flatMap(s => s.rows.map(r => r.id));
    const allCatSelected = allCatIds.length && allCatIds.every(id => ui.selected.has(id));

    return `
      <div class="db2433-folder ${open ? "open" : ""}">
        <div class="db2433-folder-head">
          <label>
            <input type="checkbox" data-db2433-cat-check="${esc(catKey)}" ${allCatSelected ? "checked" : ""}>
          </label>
          <button type="button" data-db2433-toggle-cat="${esc(catKey)}">
            <span>${open ? "📂" : "📁"}</span>
            <b>${esc(group.category)}</b>
            <em>${allCatIds.length}</em>
          </button>
        </div>

        <div class="db2433-folder-body">
          ${group.subgroups.map(sub => renderSubgroup(catKey, sub)).join("")}
        </div>
      </div>
    `;
  }

  function renderSubgroup(catKey, sub) {
    const subKey = catKey + "|" + sub.subcategory;
    const open = ui.openSubs.has(subKey);
    const ids = sub.rows.map(r => r.id);
    const selected = ids.length && ids.every(id => ui.selected.has(id));

    return `
      <div class="db2433-sub ${open ? "open" : ""}">
        <div class="db2433-sub-head">
          <label>
            <input type="checkbox" data-db2433-sub-check="${esc(subKey)}" ${selected ? "checked" : ""}>
          </label>
          <button type="button" data-db2433-toggle-sub="${esc(subKey)}">
            <span>${open ? "▾" : "▸"}</span>
            <b>${esc(sub.subcategory)}</b>
            <em>${ids.length}</em>
          </button>
        </div>

        <div class="db2433-items">
          ${sub.rows.map(renderImportItem).join("")}
        </div>
      </div>
    `;
  }

  function renderImportItem(item) {
    const selected = ui.selected.has(item.id);

    return `
      <div class="db2433-import-item ${selected ? "selected" : ""}">
        <label>
          <input type="checkbox" data-db2433-item-check="${esc(item.id)}" ${selected ? "checked" : ""}>
        </label>
        <div>
          <b>${esc(item.name)}</b>
          <p>${money(item.price)} / ${esc(item.unit)} · ${item.type === "work" ? "Работа" : "Материал"}</p>
        </div>
      </div>
    `;
  }

  function idsInCategory(catKey) {
    const category = catKey.split("|").slice(2).join("|");
    return importItems().filter(x => x.category === category).map(x => x.id);
  }

  function idsInSubcategory(subKey) {
    const parts = subKey.split("|");
    const category = parts[2];
    const subcategory = parts.slice(3).join("|");
    return importItems()
      .filter(x => x.category === category && x.subcategory === subcategory)
      .map(x => x.id);
  }

  function setMany(ids, checked) {
    ids.forEach(id => {
      if (checked) ui.selected.add(id);
      else ui.selected.delete(id);
    });
  }

  function cloneForMy(src, withPrice) {
    const normalized = db()?.normalizeItem
      ? db().normalizeItem({
          ...src,
          id: undefined,
          baseType: "my",
          source: "server_copy",
          sourceItemId: src.id,
          price: withPrice ? src.price : 0
        }, src.type, "my")
      : {
          ...src,
          id: "db_" + Date.now().toString(36) + "_" + Math.random().toString(16).slice(2),
          baseType: "my",
          source: "server_copy",
          sourceItemId: src.id,
          price: withPrice ? src.price : 0
        };

    normalized.id = "db_" + Date.now().toString(36) + "_" + Math.random().toString(16).slice(2);
    normalized.baseType = "my";
    normalized.source = "server_copy";
    normalized.sourceItemId = src.id;
    normalized.price = withPrice ? Number(src.price || 0) : 0;
    normalized.updatedAt = new Date().toISOString();
    return normalized;
  }

  function addSelectedToMy(withPrice) {
    const ids = Array.from(ui.selected);
    if (!ids.length) {
      toast("Ничего не выбрано.");
      return;
    }

    const server = getBase("server");
    const my = getBase("my");

    let added = 0;
    let skipped = 0;

    ids.forEach(id => {
      const src = server.find(x => x.id === id);
      if (!src) return;

      const sig = norm(src.type + "|" + src.name + "|" + src.unit);
      const exists = my.some(x => norm(x.type + "|" + x.name + "|" + x.unit) === sig);

      if (exists) {
        skipped++;
        return;
      }

      my.push(cloneForMy(src, withPrice));
      added++;
    });

    setBase("my", my);
    ui.selected.clear();
    closeImportModal();

    try { db()?.open?.(); } catch (e) {}
    toast(`Добавлено: ${added}. Дубли: ${skipped}.`);
  }

  function dedupeMenuDbButtons() {
    const menus = Array.from(document.querySelectorAll("#side-menu,#drawer,.side-menu,.sidebar,.drawer,.burger-menu,[data-menu],nav"));
    menus.forEach(menu => {
      const buttons = Array.from(menu.querySelectorAll("button,a,[role='button'],.menu-item,.nav-item"))
        .filter(el => {
          const text = (el.textContent || "").toLowerCase();
          const attrs = [
            el.getAttribute?.("data-db243-open"),
            el.getAttribute?.("data-db-v24-open"),
            el.getAttribute?.("onclick"),
            el.className
          ].filter(Boolean).join(" ").toLowerCase();
          return text.includes("база данных") || attrs.includes("database") || attrs.includes("data-db243-open") || attrs.includes("data-db-v24-open");
        });

      if (buttons.length <= 1) return;

      const keep = buttons.find(b => b.hasAttribute("data-db243-open")) || buttons[buttons.length - 1];
      buttons.forEach(btn => {
        if (btn !== keep) (btn.closest("li") || btn).remove();
      });
      keep.setAttribute("data-db243-open", "1");
    });
  }

  function bind() {
    if (window.__dbV2433Bound) return;
    window.__dbV2433Bound = true;

    document.addEventListener("click", function (e) {
      if (e.target.closest("[data-db2433-open-import]")) {
        e.preventDefault();
        openImportModal();
        return;
      }

      if (e.target.closest("[data-db2433-close-import]")) {
        e.preventDefault();
        closeImportModal();
        return;
      }

      const tab = e.target.closest("[data-db2433-import-section]");
      if (tab) {
        e.preventDefault();
        ui.importSection = tab.getAttribute("data-db2433-import-section") === "material" ? "material" : "work";
        ui.selected.clear();
        renderImportModal();
        return;
      }

      const catToggle = e.target.closest("[data-db2433-toggle-cat]");
      if (catToggle) {
        e.preventDefault();
        const key = catToggle.getAttribute("data-db2433-toggle-cat");
        ui.openCats.has(key) ? ui.openCats.delete(key) : ui.openCats.add(key);
        renderImportModal();
        return;
      }

      const subToggle = e.target.closest("[data-db2433-toggle-sub]");
      if (subToggle) {
        e.preventDefault();
        const key = subToggle.getAttribute("data-db2433-toggle-sub");
        ui.openSubs.has(key) ? ui.openSubs.delete(key) : ui.openSubs.add(key);
        renderImportModal();
        return;
      }

      if (e.target.closest("[data-db2433-select-all-import]")) {
        e.preventDefault();
        importItems().forEach(x => ui.selected.add(x.id));
        renderImportModal();
        return;
      }

      if (e.target.closest("[data-db2433-clear-import]")) {
        e.preventDefault();
        ui.selected.clear();
        renderImportModal();
        return;
      }

      if (e.target.closest("[data-db2433-add-with-price]")) {
        e.preventDefault();
        addSelectedToMy(true);
        return;
      }

      if (e.target.closest("[data-db2433-add-no-price]")) {
        e.preventDefault();
        addSelectedToMy(false);
        return;
      }
    }, true);

    document.addEventListener("change", function (e) {
      const item = e.target.closest("[data-db2433-item-check]");
      if (item) {
        const id = item.getAttribute("data-db2433-item-check");
        item.checked ? ui.selected.add(id) : ui.selected.delete(id);
        renderImportModal();
        return;
      }

      const cat = e.target.closest("[data-db2433-cat-check]");
      if (cat) {
        setMany(idsInCategory(cat.getAttribute("data-db2433-cat-check")), cat.checked);
        renderImportModal();
        return;
      }

      const sub = e.target.closest("[data-db2433-sub-check]");
      if (sub) {
        setMany(idsInSubcategory(sub.getAttribute("data-db2433-sub-check")), sub.checked);
        renderImportModal();
      }
    }, true);
  }

  function patchDbOpen() {
    if (!db() || db().__v2433OpenPatched) return;

    const oldOpen = db().open?.bind(db());
    if (typeof oldOpen === "function") {
      db().open = function (...args) {
        const result = oldOpen(...args);
        [60, 180, 450, 900].forEach(ms => setTimeout(bootUiOnly, ms));
        return result;
      };
      db().__v2433OpenPatched = true;
    }
  }

  function bootUiOnly() {
    if (!isDbOpen()) return;
    forceVersion();
    syncActiveHighlights();
    hideOldServerImportInsideEditor();
    ensureServerImportButton();
  }

  function boot() {
    bind();
    patchSetBaseForAutosave();
    patchDbOpen();
    dedupeMenuDbButtons();
    bootUiOnly();
  }

  window.addEventListener("DOMContentLoaded", function () {
    boot();
    [300, 900, 1800, 3500].forEach(ms => setTimeout(boot, ms));
  });

  window.DatabaseImportAutosaveV2433 = {
    version: VERSION,
    openImportModal,
    addSelectedToMy,
    forceVersion,
    syncActiveHighlights,
    boot
  };

  diag("database-v24-3-3-ready", "Database V24.3.3 import/autosave ready.");
})();
