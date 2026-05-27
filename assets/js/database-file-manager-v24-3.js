(function () {
  const VERSION = "V24.3.1";
  const FILE = "assets/js/database-file-manager-v24-3.js";

  const KEYS = {
    activeView: "ep_db_v24_3_active_view",
    my: "ep_db_v24_my",
    server: "ep_db_v24_server",
    masters: "ep_db_v24_masters_demo",
    editorOpen: "ep_db_v24_3_editor_open"
  };

  const state = {
    view: "my",              // server / my / masters
    section: "work",         // work / material
    selected: new Set(),
    serverImportSelected: new Set(),
    openCats: new Set(),
    openSubs: new Set(),
    search: "",
    selectedMaster: ""
  };

  const n = (v, f = 0) => Number.isFinite(Number(v)) ? Number(v) : f;
  const uid = () => "db_" + Date.now().toString(36) + "_" + Math.random().toString(16).slice(2);
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[c]));

  function diag(code, message, extra = {}) {
    try {
      window.Diagnostics?.ok?.({
        file: FILE,
        module: "DatabaseFileManagerV243",
        functionName: "runtime",
        place: "database",
        code,
        message,
        ...extra
      });
    } catch (e) {}
  }

  function toast(text) {
    let box = document.getElementById("ep-db-v243-toast");
    if (!box) {
      box = document.createElement("div");
      box.id = "ep-db-v243-toast";
      document.body.appendChild(box);
    }
    box.textContent = text;
    box.classList.add("show");
    clearTimeout(window.__dbV243Toast);
    window.__dbV243Toast = setTimeout(() => box.classList.remove("show"), 1800);
  }

  function readJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || ""); } catch (e) { return fallback; }
  }

  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }

  function normalizeText(v) {
    return String(v ?? "")
      .toLowerCase()
      .replace(/ё/g, "е")
      .replace(/[×хx]/g, "x")
      .replace(/[^a-zа-я0-9x.,\s/-]/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function currentEmail() {
    try { return window.firebase?.auth?.().currentUser?.email || ""; } catch (e) {}
    try { return window.auth?.currentUser?.email || ""; } catch (e) {}
    try { return window.AppState?.user?.email || window.AppState?.profile?.email || ""; } catch (e) {}
    return "";
  }

  function isAdmin() {
    const email = String(currentEmail() || "").toLowerCase();
    if (email === "vits0007@gmail.com") return true;
    try {
      const p = window.AppState?.profile || {};
      if (p.role === "admin" || p.isAdmin === true) return true;
    } catch (e) {}
    return false;
  }

  function normalizeItem(x, typeHint, baseType) {
    const now = new Date().toISOString();
    const type = typeHint || x.type || x.t || "material";

    return {
      id: x.id || uid(),
      baseType: baseType || x.baseType || "my",
      ownerUid: x.ownerUid || (baseType === "server" ? "server" : currentEmail()),
      type: type === "work" || type === "Работа" || type === "работа" ? "work" : "material",
      name: String(x.name || x.n || x.title || "Позиция").trim(),
      category: String(x.category || x.c || x.cat || (type === "work" ? "Работы" : "Материалы")).trim(),
      subcategory: String(x.subcategory || x.sc || x.sub || x.g || "Без подкатегории").trim(),
      group: String(x.group || x.g || x.sc || "Без группы").trim(),
      unit: x.unit || x.u || "шт",
      price: n(x.price ?? x.p ?? x.cost, 0),
      aliases: Array.isArray(x.aliases) ? x.aliases : [],
      specs: x.specs && typeof x.specs === "object" ? x.specs : {},
      source: x.source || x.src || "manual",
      sourceItemId: x.sourceItemId || "",
      active: x.active !== false,
      createdAt: x.createdAt || now,
      updatedAt: now
    };
  }

  function importFormatToItems(data, baseType) {
    if (Array.isArray(data)) {
      return data.map(x => normalizeItem(x, x.type, baseType));
    }

    const rows = [];

    if (Array.isArray(data.workDB)) {
      data.workDB.forEach(x => rows.push(normalizeItem(x, "work", baseType)));
    }

    if (Array.isArray(data.matDB)) {
      data.matDB.forEach(x => rows.push(normalizeItem(x, "material", baseType)));
    }

    if (!rows.length && Array.isArray(data.items)) {
      data.items.forEach(x => rows.push(normalizeItem(x, x.type, baseType)));
    }

    if (!rows.length && Array.isArray(data.rows)) {
      data.rows.forEach(x => rows.push(normalizeItem(x, x.type, baseType)));
    }

    return rows;
  }

  function exportItemsFormat(items, source = state.view) {
    return {
      source,
      matDB: items.filter(x => x.type === "material").map(toShortFormat),
      workDB: items.filter(x => x.type === "work").map(toShortFormat),
      exportedAt: new Date().toISOString(),
      version: VERSION
    };
  }

  function toShortFormat(x) {
    return {
      id: x.id,
      g: x.group || x.subcategory,
      c: x.category,
      sc: x.subcategory,
      n: x.name,
      u: x.unit,
      p: x.price
    };
  }

  function getBase(base) {
    if (base === "server") return readJson(KEYS.server, []);
    if (base === "masters") {
      const all = readJson(KEYS.masters, {});
      if (!state.selectedMaster) return [];
      return all[state.selectedMaster] || [];
    }
    return readJson(KEYS.my, []);
  }

  function setBase(base, items) {
    if (base === "server") writeJson(KEYS.server, items);
    else if (base === "masters") {
      const all = readJson(KEYS.masters, {});
      if (state.selectedMaster) all[state.selectedMaster] = items;
      writeJson(KEYS.masters, all);
    } else writeJson(KEYS.my, items);
  }

  function viewItems() {
    const q = normalizeText(state.search);
    return getBase(state.view)
      .filter(x => x.active !== false)
      .filter(x => x.type === state.section)
      .filter(x => {
        if (!q) return true;
        return normalizeText([x.name, x.category, x.subcategory, x.group, x.unit, x.price].join(" ")).includes(q);
      });
  }

  function allItemsInView() {
    return getBase(state.view).filter(x => x.active !== false);
  }

  function seedServerIfEmpty() {
    const server = getBase("server");
    if (server.length) return;

    const seed = [
      { type:"work", n:"Штробление 20x30 бетон", c:"Штробление", sc:"Бетон", g:"Штробление", u:"м", p:550 },
      { type:"work", n:"Штробление 25x30 бетон", c:"Штробление", sc:"Бетон", g:"Штробление", u:"м", p:600 },
      { type:"work", n:"Высверливание подрозетников глубоких бетон", c:"Высверливание подрозетников", sc:"Глубокие", g:"Высверливание", u:"шт", p:650 },
      { type:"material", n:"Подрозетник глубокий 68x65", c:"Подрозетники", sc:"Глубокие", g:"Подрозетники", u:"шт", p:55 },
      { type:"material", n:"ГМЛ 4", c:"Соединители", sc:"ГМЛ", g:"ГМЛ", u:"шт", p:12 },
      { type:"material", n:"ГМЛ 6", c:"Соединители", sc:"ГМЛ", g:"ГМЛ", u:"шт", p:16 },
      { type:"material", n:"Термоусадка 12/4", c:"Расходники", sc:"Термоусадка", g:"Термоусадка", u:"м", p:80 }
    ].map(x => normalizeItem(x, x.type, "server"));

    setBase("server", seed);
  }

  function canEditCurrent() {
    if (state.view === "my") return true;
    if (state.view === "server") return isAdmin();
    return false; // базу мастера смотрим, не ломаем напрямую
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

    return Array.from(map.entries()).map(([cat, subMap]) => ({
      category: cat,
      subgroups: Array.from(subMap.entries()).map(([sub, rows]) => ({
        subcategory: sub,
        rows: rows.sort((a,b) => a.name.localeCompare(b.name))
      })).sort((a,b) => a.subcategory.localeCompare(b.subcategory))
    })).sort((a,b) => a.category.localeCompare(b.category));
  }

  function setView(view) {
    if (view === "masters" && !isAdmin()) return;
    state.view = view;
    state.selected.clear();
    state.serverImportSelected.clear();
    localStorage.setItem(KEYS.activeView, view);
    render();
  }

  function setSection(section) {
    state.section = section === "material" ? "material" : "work";
    state.selected.clear();
    render();
  }

  function toggleCat(key) {
    if (state.openCats.has(key)) state.openCats.delete(key);
    else state.openCats.add(key);
    render();
  }

  function toggleSub(key) {
    if (state.openSubs.has(key)) state.openSubs.delete(key);
    else state.openSubs.add(key);
    render();
  }

  function addItem() {
    if (!canEditCurrent()) {
      toast("Эту базу нельзя редактировать напрямую.");
      return;
    }

    const name = prompt("Название позиции", "");
    if (!name) return;

    const category = prompt("Категория", "") || (state.section === "work" ? "Работы" : "Материалы");
    const subcategory = prompt("Подкатегория", "Без подкатегории") || "Без подкатегории";
    const unit = prompt("Единица", state.section === "work" ? "шт" : "шт") || "шт";
    const price = n(prompt("Цена", "0"), 0);

    const items = getBase(state.view);
    items.push(normalizeItem({ name, category, subcategory, group: subcategory, unit, price }, state.section, state.view));
    setBase(state.view, items);
    toast("Позиция добавлена.");
    render();
  }

  function editItem(id) {
    if (!canEditCurrent()) {
      toast("Редактировать можно только свою БД. БД сервера — только админ.");
      return;
    }

    const items = getBase(state.view);
    const item = items.find(x => x.id === id);
    if (!item) return;

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

    Object.assign(item, {
      name, category, subcategory, group: subcategory, unit,
      price: n(price, 0),
      updatedAt: new Date().toISOString()
    });

    setBase(state.view, items);
    closeCard();
    toast("Позиция обновлена.");
    render();
  }

  function deleteSelected() {
    if (!canEditCurrent()) {
      toast("Эту базу нельзя удалять напрямую.");
      return;
    }

    const ids = Array.from(state.selected);
    if (!ids.length) {
      toast("Ничего не выбрано.");
      return;
    }

    if (!confirm(`Удалить выбранные позиции: ${ids.length}?`)) return;

    const items = getBase(state.view).filter(x => !state.selected.has(x.id));
    setBase(state.view, items);
    state.selected.clear();
    render();
  }

  function moveSelected() {
    if (!canEditCurrent()) {
      toast("Эту базу нельзя перемещать напрямую.");
      return;
    }

    const ids = Array.from(state.selected);
    if (!ids.length) {
      toast("Ничего не выбрано.");
      return;
    }

    const category = prompt("Новая категория", "");
    if (!category) return;
    const subcategory = prompt("Новая подкатегория", "Без подкатегории") || "Без подкатегории";

    const items = getBase(state.view);
    items.forEach(item => {
      if (state.selected.has(item.id)) {
        item.category = category;
        item.subcategory = subcategory;
        item.group = subcategory;
        item.updatedAt = new Date().toISOString();
      }
    });

    setBase(state.view, items);
    render();
  }

  function importFile(file) {
    if (!file) return;

    const ext = String(file.name || "").split(".").pop().toLowerCase();

    if (["png","jpg","jpeg","webp"].includes(ext)) {
      toast("Картинка: ИИ-импорт будет подключён позже.");
      return;
    }
    if (["xlsx","xls"].includes(ext)) {
      toast("Excel: подключим отдельным внутренним импортом.");
      return;
    }
    if (ext === "pdf") {
      toast("PDF: подключим отдельным внутренним импортом.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      try {
        let imported = [];

        if (ext === "json") {
          const data = JSON.parse(String(reader.result || "{}"));
          imported = importFormatToItems(data, state.view === "server" ? "server" : "my");
        } else {
          const lines = String(reader.result || "").split(/\r?\n/).map(x => x.trim()).filter(Boolean);
          imported = lines.map(line => {
            const parts = line.split(/[;\t]/).map(x => x.trim());
            return normalizeItem({
              n: parts[0],
              c: parts[1] || "Импорт",
              sc: parts[2] || "Без подкатегории",
              u: parts[3] || "шт",
              p: n(parts[4], 0)
            }, state.section, state.view);
          });
        }

        if (!imported.length) {
          toast("В файле не найдено позиций.");
          return;
        }

        if (!canEditCurrent()) {
          toast("Импорт сюда запрещён. Переключись на Мою БД или войди админом для БД сервера.");
          return;
        }

        const items = getBase(state.view);
        setBase(state.view, items.concat(imported));
        toast(`Импортировано: ${imported.length}`);
        render();
      } catch (e) {
        console.error(e);
        toast("Ошибка импорта JSON/текста.");
      }
    };

    reader.readAsText(file);
  }

  function exportJson() {
    const items = getBase(state.view);
    const data = exportItemsFormat(items, state.view);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `electric-pro-${state.view}-db-v24-3.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 600);
  }

  function copySelectedFromServerToMy() {
    const ids = Array.from(state.serverImportSelected);
    if (!ids.length) {
      toast("Выбери позиции из БД сервера.");
      return;
    }

    const server = getBase("server");
    const my = getBase("my");

    let added = 0;
    let skipped = 0;

    ids.forEach(id => {
      const src = server.find(x => x.id === id);
      if (!src) return;

      const sig = normalizeText(src.type + "|" + src.name + "|" + src.unit);
      const exists = my.some(x => normalizeText(x.type + "|" + x.name + "|" + x.unit) === sig);
      if (exists) {
        skipped += 1;
        return;
      }

      my.push(normalizeItem({
        ...src,
        id: uid(),
        source: "server_copy",
        sourceItemId: src.id
      }, src.type, "my"));
      added += 1;
    });

    setBase("my", my);
    state.serverImportSelected.clear();
    toast(`Добавлено в Мою БД: ${added}. Дубли: ${skipped}.`);
    render();
  }

  function copySelectedFromMasterToServer() {
    if (!isAdmin() || state.view !== "masters") return;

    const ids = Array.from(state.selected);
    if (!ids.length) {
      toast("Выбери позиции мастера.");
      return;
    }

    const masterRows = getBase("masters");
    const server = getBase("server");

    let added = 0;
    ids.forEach(id => {
      const src = masterRows.find(x => x.id === id);
      if (!src) return;

      server.push(normalizeItem({
        ...src,
        id: uid(),
        source: "master_copy",
        sourceItemId: src.id,
        ownerUid: "server"
      }, src.type, "server"));

      added += 1;
    });

    setBase("server", server);
    toast(`В БД сервера добавлено из базы мастера: ${added}`);
    state.selected.clear();
    render();
  }

  function selectAllCurrent() {
    viewItems().forEach(x => state.selected.add(x.id));
    render();
  }

  function clearSelection() {
    state.selected.clear();
    render();
  }

  function selectAllServerImport(sectionOnly = true) {
    getBase("server")
      .filter(x => x.active !== false)
      .filter(x => !sectionOnly || x.type === state.section)
      .forEach(x => state.serverImportSelected.add(x.id));
    render();
  }

  function mastersList() {
    const all = readJson(KEYS.masters, {});
    return Object.keys(all);
  }

  function openCard(id) {
    const item = getBase(state.view).find(x => x.id === id);
    if (!item) return;

    let modal = document.getElementById("db-v243-card-modal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "db-v243-card-modal";
      modal.className = "db-v243-card-modal hidden";
      document.body.appendChild(modal);
    }

    const specs = Object.entries(item.specs || {}).map(([k, v]) => `<span>${esc(k)}: ${esc(v)}</span>`).join("");
    const aliases = (item.aliases || []).map(a => `<span>${esc(a)}</span>`).join("");

    modal.innerHTML = `
      <div class="db243-backdrop" data-db243-card-close></div>
      <div class="db243-card-sheet">
        <div class="db243-card-head">
          <div>
            <h3>${esc(item.name)}</h3>
            <p>${item.type === "work" ? "Работа" : "Материал"} · ${esc(item.category)} / ${esc(item.subcategory)}</p>
          </div>
          <button type="button" data-db243-card-close>×</button>
        </div>

        <div class="db243-price">
          <span>Цена</span>
          <b>${esc(item.price)} ₽ / ${esc(item.unit)}</b>
        </div>

        <div class="db243-info-grid">
          <div><span>Папка</span><b>${esc(item.category)}</b></div>
          <div><span>Подпапка</span><b>${esc(item.subcategory)}</b></div>
          <div><span>Источник</span><b>${esc(item.source || "manual")}</b></div>
          <div><span>ID</span><b>${esc(item.id)}</b></div>
        </div>

        <div class="db243-tags">
          <h4>Характеристики</h4>
          <div>${specs || "<span>Нет</span>"}</div>
        </div>

        <div class="db243-tags">
          <h4>Псевдонимы</h4>
          <div>${aliases || "<span>Нет</span>"}</div>
        </div>

        <div class="db243-card-actions">
          ${canEditCurrent() ? `<button type="button" data-db243-edit="${esc(item.id)}">Редактировать</button>` : ""}
          <button type="button" data-db243-card-close>Закрыть</button>
        </div>
      </div>
    `;

    modal.classList.remove("hidden");
  }

  function closeCard() {
    document.getElementById("db-v243-card-modal")?.classList.add("hidden");
  }

  function ensureScreen() {
    let screen = document.getElementById("ep-db-v243-screen");
    if (screen) return screen;

    screen = document.createElement("div");
    screen.id = "ep-db-v243-screen";
    screen.className = "db243-screen hidden";
    document.body.appendChild(screen);
    return screen;
  }

  function open() {
    seedServerIfEmpty();
    state.view = localStorage.getItem(KEYS.activeView) || "my";
    if (state.view === "masters" && !isAdmin()) state.view = "my";
    render();
    ensureScreen().classList.remove("hidden");
    diag("database-v24-3-open", "Database V24.3 opened.", { view: state.view });
  }

  function close() {
    ensureScreen().classList.add("hidden");
  }

  function editorOpen() {
    return localStorage.getItem(KEYS.editorOpen) === "1";
  }

  function setEditorOpen(value) {
    localStorage.setItem(KEYS.editorOpen, value ? "1" : "0");
    render();
  }

  function renderGroupedList(items, mode) {
    const groups = grouped(items);

    if (!groups.length) {
      return `<div class="db243-empty">Позиции не найдены.</div>`;
    }

    return groups.map(cat => {
      const catKey = mode + "|" + state.section + "|" + cat.category;
      const catOpen = state.openCats.has(catKey);

      return `
        <div class="db243-folder ${catOpen ? "open" : ""}">
          <button type="button" class="db243-folder-head" data-db243-cat="${esc(catKey)}">
            <span>${catOpen ? "📂" : "📁"}</span>
            <b>${esc(cat.category)}</b>
            <em>${cat.subgroups.reduce((s,g)=>s+g.rows.length,0)}</em>
          </button>

          <div class="db243-folder-body">
            ${cat.subgroups.map(sub => {
              const subKey = catKey + "|" + sub.subcategory;
              const subOpen = state.openSubs.has(subKey);
              return `
                <div class="db243-subfolder ${subOpen ? "open" : ""}">
                  <button type="button" class="db243-sub-head" data-db243-sub="${esc(subKey)}">
                    <span>${subOpen ? "▾" : "▸"}</span>
                    <b>${esc(sub.subcategory)}</b>
                    <em>${sub.rows.length}</em>
                  </button>

                  <div class="db243-cards">
                    ${sub.rows.map(item => renderItemCard(item, mode)).join("")}
                  </div>
                </div>
              `;
            }).join("")}
          </div>
        </div>
      `;
    }).join("");
  }

  function renderItemCard(item, mode) {
    const selected = mode === "serverImport"
      ? state.serverImportSelected.has(item.id)
      : state.selected.has(item.id);

    const checkAttr = mode === "serverImport" ? "data-db243-server-check" : "data-db243-check";

    return `
      <div class="db243-item-card ${selected ? "selected" : ""}">
        <label>
          <input type="checkbox" ${checkAttr}="${esc(item.id)}" ${selected ? "checked" : ""}>
        </label>
        <button type="button" class="db243-card-main" data-db243-card="${esc(item.id)}">
          <b>${esc(item.name)}</b>
          <p>${esc(item.price)} ₽ / ${esc(item.unit)} · ${item.type === "work" ? "Работа" : "Материал"}</p>
        </button>
      </div>
    `;
  }

  function renderEditor() {
    const openEd = editorOpen();

    if (!openEd) {
      return `
        <section class="db243-card">
          <button type="button" class="db243-editor-toggle" data-db243-editor-open>
            <span>▸</span>
            <b>Редактор БД</b>
            <em>свернут</em>
          </button>
        </section>
      `;
    }

    const canEdit = canEditCurrent();

    let serverImportHtml = "";
    if (state.view === "my") {
      const serverRows = getBase("server").filter(x => x.active !== false).filter(x => x.type === state.section);
      serverImportHtml = `
        <div class="db243-editor-block">
          <h4>Импорт из БД сервера</h4>
          <p>Открой папки сервера, выбери позиции или выдели всё и добавь в свою БД.</p>
          <div class="db243-action-row">
            <button type="button" data-db243-server-select-all>Выделить всё ${state.section === "work" ? "работы" : "материалы"}</button>
            <button type="button" data-db243-copy-server>Добавить в Мою БД</button>
          </div>
          <div class="db243-server-import-tree">
            ${renderGroupedList(serverRows, "serverImport")}
          </div>
        </div>
      `;
    }

    let masterHtml = "";
    if (state.view === "masters" && isAdmin()) {
      const masters = mastersList();
      masterHtml = `
        <div class="db243-editor-block">
          <h4>БД мастеров</h4>
          <p>Админ просматривает личную БД мастера и может забрать выбранные позиции в БД сервера.</p>
          <select data-db243-master-select>
            <option value="">Выбрать мастера</option>
            ${masters.map(m => `<option value="${esc(m)}" ${state.selectedMaster === m ? "selected" : ""}>${esc(m)}</option>`).join("")}
          </select>
          <div class="db243-action-row">
            <button type="button" data-db243-master-to-server>Добавить выбранное в БД сервера</button>
          </div>
        </div>
      `;
    }

    return `
      <section class="db243-card">
        <button type="button" class="db243-editor-toggle open" data-db243-editor-close>
          <span>▾</span>
          <b>Редактор БД</b>
          <em>открыт</em>
        </button>

        ${serverImportHtml}
        ${masterHtml}

        <div class="db243-editor-block">
          <h4>Управление выбранной БД</h4>
          <div class="db243-action-row">
            ${canEdit ? `<button type="button" data-db243-add>Добавить позицию</button>` : ""}
            ${canEdit ? `<button type="button" data-db243-move>Переместить</button>` : ""}
            ${canEdit ? `<button type="button" data-db243-delete>Удалить</button>` : ""}
            <button type="button" data-db243-select-all>Выделить всё на экране</button>
            <button type="button" data-db243-clear-selection>Снять выделение</button>
          </div>
        </div>
      </section>
    `;
  }

  function renderImportExport() {
    return `
      <section class="db243-card">
        <h3>Экспорт / импорт</h3>
        <div class="db243-action-row">
          <button type="button" data-db243-export>Экспорт JSON</button>
          <label class="db243-file-btn">
            Импорт JSON / текст
            <input type="file" data-db243-import accept=".json,.txt,.csv,.pdf,.xlsx,.xls,.png,.jpg,.jpeg,.webp">
          </label>
        </div>
        <p class="db243-note">JSON уже готов: понимает твой формат workDB/matDB. Картинка — позже через ИИ. Excel/PDF — отдельными внутренними логиками.</p>
      </section>
    `;
  }

  function renderWarehouse() {
    return `
      <section class="db243-card">
        <h3>Склад</h3>
        <p class="db243-note">Следующий раздел. Склад будет брать позиции из БД: остатки, приход, списание, резерв на объект.</p>
      </section>
    `;
  }

  function render() {
    const screen = ensureScreen();
    const admin = isAdmin();
    const rows = viewItems();

    const viewLabel = state.view === "server" ? "БД сервера" : state.view === "masters" ? "БД мастеров" : "БД моя";
    const canEdit = canEditCurrent();

    screen.innerHTML = `
      <div class="db243-head">
        <button type="button" data-db243-close>←</button>
        <div>
          <h2>База данных</h2>
          <p>${admin ? "Админ" : "Мастер"} · ${VERSION}</p>
        </div>
        <b>${esc(viewLabel)}</b>
      </div>

      <main class="db243-shell">
        <section class="db243-card">
          <div class="db243-view-switch">
            <button type="button" data-db243-view="server" class="${state.view === "server" ? "active" : ""}">БД сервера</button>
            <button type="button" data-db243-view="my" class="${state.view === "my" ? "active" : ""}">БД моя</button>
            ${admin ? `<button type="button" data-db243-view="masters" class="${state.view === "masters" ? "active" : ""}">БД мастеров</button>` : ""}
          </div>
          <p class="db243-note">
            ${state.view === "server"
              ? (admin ? "Вы редактируете серверную БД." : "Мастер смотрит серверную БД и добавляет позиции в свою.")
              : state.view === "masters"
                ? "Админ смотрит личные базы мастеров и забирает нужные позиции в БД сервера."
                : "Личная база мастера. Здесь мастер редактирует свои цены и структуру."}
          </p>
        </section>

        ${renderEditor()}

        <section class="db243-card">
          <div class="db243-section-tabs">
            <button type="button" data-db243-section="work" class="${state.section === "work" ? "active" : ""}">Работа</button>
            <button type="button" data-db243-section="material" class="${state.section === "material" ? "active" : ""}">Материал</button>
          </div>
          <input class="db243-search" type="search" data-db243-search placeholder="Поиск по ${state.section === "work" ? "работам" : "материалам"}..." value="${esc(state.search)}">

          <div class="db243-list-head">
            <h3>${state.section === "work" ? "Работы" : "Материалы"}</h3>
            <span>${rows.length} поз. · ${canEdit ? "редактирование доступно" : "только просмотр"}</span>
          </div>

          <div class="db243-file-tree">
            ${state.view === "masters" && !state.selectedMaster
              ? `<div class="db243-empty">Выбери мастера в редакторе БД.</div>`
              : renderGroupedList(rows, "main")}
          </div>
        </section>

        ${renderImportExport()}
        ${renderWarehouse()}
      </main>
    `;
  }

  function addMenuButton() {
    const menus = [
      document.querySelector("#side-menu"),
      document.querySelector("#drawer"),
      document.querySelector(".side-menu"),
      document.querySelector(".sidebar"),
      document.querySelector(".drawer"),
      document.querySelector(".burger-menu"),
      document.querySelector("[data-menu]")
    ].filter(Boolean);

    menus.forEach(menu => {
      if (menu.querySelector("[data-db243-open]")) return;

      const btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("data-db243-open", "1");
      btn.className = "db243-menu-btn";
      btn.textContent = "🗂️ База данных";

      const homeBtn = menu.querySelector("[data-v223-home]");
      if (homeBtn && homeBtn.parentElement) {
        homeBtn.parentElement.insertBefore(btn, homeBtn.nextSibling);
      } else {
        menu.insertBefore(btn, menu.firstChild);
      }
    });
  }

  function patchOldDb() {
    if (window.DatabaseCoreV241 && !window.DatabaseCoreV241.__v243Overridden) {
      window.DatabaseCoreV241.open = open;
      window.DatabaseCoreV241.__v243Overridden = true;
    }

    if (window.Router && typeof window.Router.load === "function" && !window.Router.__dbV243Patched) {
      const oldLoad = window.Router.load.bind(window.Router);
      window.Router.load = function (route, ...args) {
        const r = String(route || "").toLowerCase();
        if (r === "database" || r === "db" || r === "base") {
          open();
          return true;
        }
        return oldLoad(route, ...args);
      };
      window.Router.__dbV243Patched = true;
    }
  }

  function bind() {
    if (window.__dbV243Bound) return;
    window.__dbV243Bound = true;

    document.addEventListener("click", event => {
      if (event.target.closest("[data-db243-open]")) {
        event.preventDefault();
        open();
        return;
      }

      const modalRoot = event.target.closest("#db-v243-card-modal");
      if (modalRoot) {
        if (event.target.closest("[data-db243-card-close]")) {
          event.preventDefault();
          closeCard();
          return;
        }

        const modalEdit = event.target.closest("[data-db243-edit]");
        if (modalEdit) {
          event.preventDefault();
          editItem(modalEdit.getAttribute("data-db243-edit"));
          return;
        }
      }

      const root = event.target.closest("#ep-db-v243-screen");
      if (!root) return;

      if (event.target.closest("[data-db243-close]")) {
        event.preventDefault();
        close();
        return;
      }

      const viewBtn = event.target.closest("[data-db243-view]");
      if (viewBtn) {
        event.preventDefault();
        setView(viewBtn.getAttribute("data-db243-view"));
        return;
      }

      const sectionBtn = event.target.closest("[data-db243-section]");
      if (sectionBtn) {
        event.preventDefault();
        setSection(sectionBtn.getAttribute("data-db243-section"));
        return;
      }

      if (event.target.closest("[data-db243-editor-open]")) {
        event.preventDefault();
        setEditorOpen(true);
        return;
      }

      if (event.target.closest("[data-db243-editor-close]")) {
        event.preventDefault();
        setEditorOpen(false);
        return;
      }

      const cat = event.target.closest("[data-db243-cat]");
      if (cat) {
        event.preventDefault();
        toggleCat(cat.getAttribute("data-db243-cat"));
        return;
      }

      const sub = event.target.closest("[data-db243-sub]");
      if (sub) {
        event.preventDefault();
        toggleSub(sub.getAttribute("data-db243-sub"));
        return;
      }

      const card = event.target.closest("[data-db243-card]");
      if (card) {
        event.preventDefault();
        openCard(card.getAttribute("data-db243-card"));
        return;
      }

      if (event.target.closest("[data-db243-card-close]")) {
        event.preventDefault();
        closeCard();
        return;
      }

      const edit = event.target.closest("[data-db243-edit]");
      if (edit) {
        event.preventDefault();
        editItem(edit.getAttribute("data-db243-edit"));
        return;
      }

      if (event.target.closest("[data-db243-add]")) {
        event.preventDefault();
        addItem();
        return;
      }

      if (event.target.closest("[data-db243-delete]")) {
        event.preventDefault();
        deleteSelected();
        return;
      }

      if (event.target.closest("[data-db243-move]")) {
        event.preventDefault();
        moveSelected();
        return;
      }

      if (event.target.closest("[data-db243-export]")) {
        event.preventDefault();
        exportJson();
        return;
      }

      if (event.target.closest("[data-db243-copy-server]")) {
        event.preventDefault();
        copySelectedFromServerToMy();
        return;
      }

      if (event.target.closest("[data-db243-server-select-all]")) {
        event.preventDefault();
        selectAllServerImport(true);
        return;
      }

      if (event.target.closest("[data-db243-select-all]")) {
        event.preventDefault();
        selectAllCurrent();
        return;
      }

      if (event.target.closest("[data-db243-clear-selection]")) {
        event.preventDefault();
        clearSelection();
        return;
      }

      if (event.target.closest("[data-db243-master-to-server]")) {
        event.preventDefault();
        copySelectedFromMasterToServer();
        return;
      }
    }, true);

    document.addEventListener("change", event => {
      const root = event.target.closest("#ep-db-v243-screen");
      if (!root) return;

      const check = event.target.closest("[data-db243-check]");
      if (check) {
        const id = check.getAttribute("data-db243-check");
        if (check.checked) state.selected.add(id);
        else state.selected.delete(id);
        render();
        return;
      }

      const serverCheck = event.target.closest("[data-db243-server-check]");
      if (serverCheck) {
        const id = serverCheck.getAttribute("data-db243-server-check");
        if (serverCheck.checked) state.serverImportSelected.add(id);
        else state.serverImportSelected.delete(id);
        render();
        return;
      }

      const importInput = event.target.closest("[data-db243-import]");
      if (importInput) {
        importFile(importInput.files && importInput.files[0]);
        importInput.value = "";
        return;
      }

      const master = event.target.closest("[data-db243-master-select]");
      if (master) {
        state.selectedMaster = master.value;
        state.selected.clear();
        render();
      }
    }, true);

    document.addEventListener("input", event => {
      const root = event.target.closest("#ep-db-v243-screen");
      if (!root) return;

      const search = event.target.closest("[data-db243-search]");
      if (search) {
        state.search = search.value;
        render();
      }
    }, true);
  }

  function boot() {
    seedServerIfEmpty();
    ensureScreen();
    bind();
    patchOldDb();
    addMenuButton();

    try {
      window.ModuleVersionBadgesV212?.setVersion?.("database", VERSION);
      window.ModuleVersionBadgesV212?.apply?.();
    } catch (e) {}
  }

  window.addEventListener("DOMContentLoaded", function () {
    boot();
    [500, 1500, 3000].forEach(ms => setTimeout(boot, ms));
  });

  window.DatabaseFileManagerV243 = {
    version: VERSION,
    open,
    close,
    getBase,
    setBase,
    importFormatToItems,
    exportItemsFormat,
    normalizeItem
  };

  diag("database-file-manager-v24-3-ready", "Database File Manager V24.3 ready.");
})();
