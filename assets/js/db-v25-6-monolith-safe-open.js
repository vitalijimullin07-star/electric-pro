(function () {
  const VERSION = "V25.6";
  const FILE = "assets/js/db-v25-6-monolith-safe-open.js";

  const KEYS = {
    view: "ep_db_v256_view",
    section: "ep_db_v256_section",
    my: "ep_db_v25_my",
    server: "ep_db_v25_server",
    masters: "ep_db_v25_masters",
    oldMy: "ep_db_v24_my",
    oldServer: "ep_db_v24_server",
    oldMasters: "ep_db_v24_masters_demo",
    editor: "ep_db_v256_editor_open",
    save: "ep_db_v256_last_save",
    diag: "ep_db_v256_diag"
  };

  const state = {
    view: localStorage.getItem(KEYS.view) || "my",
    section: localStorage.getItem(KEYS.section) || "work",
    search: "",
    selected: new Set(),
    openCats: new Set(),
    openSubs: new Set(),
    selectedMaster: ""
  };

  function esc(v) {
    return String(v ?? "").replace(/[&<>"']/g, c => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[c]));
  }

  function uid() {
    return "v256_" + Date.now().toString(36) + "_" + Math.random().toString(16).slice(2);
  }

  function norm(v) {
    return String(v ?? "")
      .toLowerCase()
      .replace(/ё/g, "е")
      .replace(/[×хx]/g, "x")
      .replace(/[^a-zа-я0-9x.,\s/-]/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function money(v) {
    return Math.round(Number(v || 0)).toLocaleString("ru-RU") + " ₽";
  }

  function readJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || ""); } catch (e) { return fallback; }
  }

  function writeJson(key, data) {
    try { localStorage.setItem(key, JSON.stringify(data)); } catch (e) {}
  }

  function addDiag(level, code, text, extra = {}) {
    const rows = readJson(KEYS.diag, []);
    rows.push({
      time: new Date().toLocaleString("ru-RU"),
      iso: new Date().toISOString(),
      level,
      code,
      text,
      extra
    });
    writeJson(KEYS.diag, rows.slice(-80));

    try {
      window.Diagnostics?.ok?.({
        file: FILE,
        module: "DBV256SafeMonolith",
        functionName: "runtime",
        place: "database",
        code,
        message: text,
        ...extra
      });
    } catch (e) {}
  }

  function currentEmail() {
    try { return window.firebase?.auth?.().currentUser?.email || ""; } catch (e) {}
    try { return window.auth?.currentUser?.email || ""; } catch (e) {}
    try { return window.AppState?.user?.email || window.AppState?.profile?.email || ""; } catch (e) {}
    return "";
  }

  function currentUid() {
    try { return window.firebase?.auth?.().currentUser?.uid || ""; } catch (e) {}
    try { return window.auth?.currentUser?.uid || ""; } catch (e) {}
    try { return window.AppState?.user?.uid || window.AppState?.profile?.uid || ""; } catch (e) {}
    return currentEmail() || "local";
  }

  function isAdmin() {
    const email = String(currentEmail() || "").toLowerCase();
    if (email === "vits0007@gmail.com") return true;
    try {
      const p = window.AppState?.profile || {};
      if (p.role === "admin" || p.isAdmin === true) return true;
    } catch (e) {}
    if (/admin/i.test(document.body.textContent || "")) return true;
    return false;
  }

  function normalizeItem(x, typeHint = "", baseType = "my") {
    const typeRaw = String(typeHint || x.type || x.kind || "").toLowerCase();
    const type = typeRaw.includes("mat") || typeRaw.includes("мат") ? "material" : "work";
    const name = String(x.name || x.title || x.n || x.naimenovanie || "Позиция").trim();
    const category = String(x.category || x.cat || x.folder || (type === "work" ? "Работы" : "Материалы")).trim();
    const subcategory = String(x.subcategory || x.sub || x.group || "Без подкатегории").trim();

    return {
      id: x.id || uid(),
      type,
      baseType,
      ownerUid: x.ownerUid || (baseType === "server" ? "server" : currentUid()),
      name,
      category,
      subcategory,
      group: x.group || subcategory,
      unit: String(x.unit || x.u || x.ed || "шт").trim(),
      price: Number(x.price ?? x.p ?? x.cost ?? 0) || 0,
      aliases: Array.isArray(x.aliases) ? x.aliases : [],
      specs: x.specs && typeof x.specs === "object" ? x.specs : {},
      source: x.source || "manual",
      active: x.active !== false,
      createdAt: x.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  function seedServer() {
    return [
      { type:"work", name:"Штробление 20x30 бетон", category:"Штробление", subcategory:"Бетон", unit:"м", price:550 },
      { type:"work", name:"Штробление 25x30 бетон", category:"Штробление", subcategory:"Бетон", unit:"м", price:600 },
      { type:"work", name:"Высверливание подрозетников бетон", category:"Высверливание", subcategory:"Бетон", unit:"шт", price:650 },
      { type:"work", name:"Монтаж подрозетника", category:"Монтаж", subcategory:"Подрозетники", unit:"шт", price:250 },
      { type:"material", name:"Подрозетник глубокий 60-75 мм", category:"Подрозетники", subcategory:"Глубокие", unit:"шт", price:55 },
      { type:"material", name:"ГМЛ 4", category:"Соединители", subcategory:"ГМЛ", unit:"шт", price:12 },
      { type:"material", name:"ГМЛ 6", category:"Соединители", subcategory:"ГМЛ", unit:"шт", price:16 },
      { type:"material", name:"Термоусадка 12/4", category:"Расходники", subcategory:"Термоусадка", unit:"м", price:80 },
      { type:"material", name:"WAGO 2-пин", category:"Соединители", subcategory:"WAGO", unit:"шт", price:35 }
    ].map(x => normalizeItem(x, x.type, "server"));
  }

  function migrateOnce() {
    if (!localStorage.getItem(KEYS.my)) {
      const old = readJson(KEYS.oldMy, []);
      writeJson(KEYS.my, Array.isArray(old) ? old.map(x => normalizeItem(x, x.type, "my")) : []);
    }

    if (!localStorage.getItem(KEYS.server)) {
      const old = readJson(KEYS.oldServer, []);
      const rows = Array.isArray(old) ? old.map(x => normalizeItem(x, x.type, "server")) : [];
      writeJson(KEYS.server, rows.length ? rows : seedServer());
    }

    if (!localStorage.getItem(KEYS.masters)) {
      const old = readJson(KEYS.oldMasters, {});
      writeJson(KEYS.masters, old && typeof old === "object" ? old : {});
    }
  }

  function getBase(name = state.view) {
    migrateOnce();
    if (name === "server") return readJson(KEYS.server, []);
    if (name === "masters") {
      const all = readJson(KEYS.masters, {});
      return state.selectedMaster ? (all[state.selectedMaster] || []) : [];
    }
    return readJson(KEYS.my, []);
  }

  function setBase(name, rows) {
    if (name === "server") {
      if (!isAdmin()) {
        alert("БД сервера редактирует только админ.");
        return;
      }
      writeJson(KEYS.server, rows);
    } else if (name === "masters") {
      alert("БД мастеров здесь только для просмотра/копирования.");
      return;
    } else {
      writeJson(KEYS.my, rows);
    }

    localStorage.setItem(KEYS.save, new Date().toISOString());
    addDiag("ok", "local-save", "БД сохранена локально.", { base: name, count: rows.length });
    render();
  }

  function screen() {
    let el = document.getElementById("ep-db-v256-screen");
    if (!el) {
      el = document.createElement("div");
      el.id = "ep-db-v256-screen";
      el.className = "db256-screen hidden";
      document.body.appendChild(el);
    }
    return el;
  }

  function hideOldDbScreens() {
    document.querySelectorAll("#ep-db-v25-screen,#ep-db-v244-screen,#ep-db-v243-screen,#ep-db-v24-screen,#ep-database-screen,[data-screen='database']").forEach(el => {
      if (el.id !== "ep-db-v256-screen") el.classList.add("hidden");
    });
  }

  function roleLabel() {
    return isAdmin() ? "Админ" : "Мастер";
  }

  function viewLabel() {
    if (state.view === "server") return "БД сервера";
    if (state.view === "masters") return "БД мастеров";
    return "БД моя";
  }

  function canEdit() {
    if (state.view === "my") return true;
    if (state.view === "server") return isAdmin();
    return false;
  }

  function currentRows() {
    const q = norm(state.search);
    return getBase(state.view)
      .filter(x => x && x.active !== false)
      .filter(x => x.type === state.section)
      .filter(x => !q || norm([x.name, x.category, x.subcategory, x.unit, x.price, (x.aliases || []).join(" ")].join(" ")).includes(q));
  }

  function grouped(rows) {
    const map = new Map();
    rows.forEach(item => {
      const cat = item.category || "Без категории";
      const sub = item.subcategory || "Без подкатегории";
      if (!map.has(cat)) map.set(cat, new Map());
      if (!map.get(cat).has(sub)) map.get(cat).set(sub, []);
      map.get(cat).get(sub).push(item);
    });

    return Array.from(map.entries()).map(([category, subs]) => ({
      category,
      subs: Array.from(subs.entries()).map(([subcategory, rows]) => ({
        subcategory,
        rows: rows.sort((a, b) => String(a.name).localeCompare(String(b.name)))
      })).sort((a, b) => a.subcategory.localeCompare(b.subcategory))
    })).sort((a, b) => a.category.localeCompare(b.category));
  }

  function render() {
    migrateOnce();
    hideOldDbScreens();

    const rows = currentRows();
    const editorOpen = localStorage.getItem(KEYS.editor) === "1";
    const el = screen();

    el.innerHTML = `
      <div class="db256-head">
        <button type="button" data-db256-close>←</button>
        <div>
          <h2>База данных</h2>
          <p>${esc(roleLabel())} · ${VERSION}</p>
        </div>
        <b>${esc(viewLabel())}</b>
        <button type="button" class="db256-dot" data-db256-diag title="Диагностика"></button>
      </div>

      <div class="db256-status">
        ✅ Локально: ${esc(lastSaveText())} · Сервер: позже подключим аккуратно
      </div>

      <main class="db256-shell">
        <section class="db256-card">
          <div class="db256-switch">
            <button type="button" data-db256-view="server" class="${state.view === "server" ? "active" : ""}">БД сервера</button>
            <button type="button" data-db256-view="my" class="${state.view === "my" ? "active" : ""}">БД моя</button>
            ${isAdmin() ? `<button type="button" data-db256-view="masters" class="${state.view === "masters" ? "active" : ""}">БД мастеров</button>` : ""}
          </div>
          <p>${noteText()}</p>
        </section>

        <section class="db256-card">
          <button type="button" class="db256-editor-toggle" data-db256-editor-toggle>
            <span>${editorOpen ? "▾" : "▸"}</span>
            <b>Редактор БД</b>
            <em>${editorOpen ? "открыт" : "свернут"}</em>
          </button>

          ${editorOpen ? renderEditor() : ""}
        </section>

        <section class="db256-card">
          <div class="db256-tabs">
            <button type="button" data-db256-section="work" class="${state.section === "work" ? "active" : ""}">Работа</button>
            <button type="button" data-db256-section="material" class="${state.section === "material" ? "active" : ""}">Материал</button>
          </div>

          <input class="db256-search" type="search" data-db256-search placeholder="Поиск..." value="${esc(state.search)}">

          <div class="db256-list-head">
            <h3>${state.section === "work" ? "Работы" : "Материалы"}</h3>
            <span>${rows.length} поз. · ${canEdit() ? "редактирование доступно" : "только просмотр"}</span>
            <button type="button" data-db256-toggle-all>${state.openCats.size ? "Свернуть" : "Развернуть"}</button>
          </div>

          <div class="db256-tree">${renderGroups(rows)}</div>
        </section>

        <section class="db256-card">
          <h3>Экспорт / импорт</h3>
          <div class="db256-actions">
            <button type="button" data-db256-export>Экспорт JSON</button>
            <label class="db256-file">Импорт JSON / текст<input type="file" data-db256-import accept=".json,.txt,.csv"></label>
          </div>
        </section>

        <section class="db256-card">
          <h3>Склад</h3>
          <p>Следующий этап — связать склад с этой БД.</p>
        </section>
      </main>
    `;
  }

  function lastSaveText() {
    const last = localStorage.getItem(KEYS.save);
    return last ? new Date(last).toLocaleTimeString("ru-RU") : "готово";
  }

  function noteText() {
    if (state.view === "server") return isAdmin() ? "Серверная база: редактирование доступно админу." : "Серверная база: только просмотр и копирование в свою БД.";
    if (state.view === "masters") return "Просмотр личных баз мастеров. Напрямую не ломаем.";
    return "Личная БД мастера: цены, папки, позиции.";
  }

  function renderEditor() {
    return `
      <div class="db256-editor-block">
        ${state.view === "my" ? `
          <h4>Импорт из БД сервера</h4>
          <p>Выбери позиции из серверной базы и добавь в свою.</p>
          <button type="button" data-db256-copy-from-server>Добавить выбранное с сервера в мою БД</button>
        ` : ""}
        ${state.view === "masters" ? renderMastersEditor() : ""}
        <h4>Управление выбранной БД</h4>
        <div class="db256-actions">
          ${canEdit() ? `<button type="button" data-db256-add>Добавить позицию</button>` : ""}
          ${canEdit() ? `<button type="button" data-db256-move>Переместить</button>` : ""}
          ${canEdit() ? `<button type="button" data-db256-delete>Удалить</button>` : ""}
          <button type="button" data-db256-select-all>Выделить всё</button>
          <button type="button" data-db256-clear-selection>Снять выделение</button>
        </div>
      </div>
    `;
  }

  function renderMastersEditor() {
    const masters = Object.keys(readJson(KEYS.masters, {}));
    return `
      <h4>БД мастеров</h4>
      <select data-db256-master-select>
        <option value="">Выбрать мастера</option>
        ${masters.map(m => `<option value="${esc(m)}" ${state.selectedMaster === m ? "selected" : ""}>${esc(m)}</option>`).join("")}
      </select>
      <button type="button" data-db256-master-copy>Добавить выбранное в БД сервера</button>
    `;
  }

  function renderGroups(rows) {
    const groups = grouped(rows);
    if (!groups.length) return `<div class="db256-empty">Позиции не найдены.</div>`;

    return groups.map(cat => {
      const catKey = `${state.view}|${state.section}|${cat.category}`;
      const open = state.openCats.has(catKey);
      const ids = cat.subs.flatMap(s => s.rows.map(r => r.id));
      const checked = ids.length && ids.every(id => state.selected.has(id));
      return `
        <div class="db256-folder ${open ? "open" : ""}">
          <div class="db256-check-head">
            <label><input type="checkbox" data-db256-cat-check="${esc(catKey)}" ${checked ? "checked" : ""}></label>
            <button type="button" class="db256-folder-head" data-db256-cat="${esc(catKey)}">
              <span>${open ? "📂" : "📁"}</span><b>${esc(cat.category)}</b><em>${ids.length}</em>
            </button>
          </div>
          <div class="db256-folder-body">${cat.subs.map(sub => renderSub(catKey, sub)).join("")}</div>
        </div>
      `;
    }).join("");
  }

  function renderSub(catKey, sub) {
    const subKey = `${catKey}|${sub.subcategory}`;
    const open = state.openSubs.has(subKey);
    const ids = sub.rows.map(r => r.id);
    const checked = ids.length && ids.every(id => state.selected.has(id));
    return `
      <div class="db256-sub ${open ? "open" : ""}">
        <div class="db256-check-head">
          <label><input type="checkbox" data-db256-sub-check="${esc(subKey)}" ${checked ? "checked" : ""}></label>
          <button type="button" class="db256-sub-head" data-db256-sub="${esc(subKey)}">
            <span>${open ? "▾" : "▸"}</span><b>${esc(sub.subcategory)}</b><em>${ids.length}</em>
          </button>
        </div>
        <div class="db256-items">${sub.rows.map(renderItem).join("")}</div>
      </div>
    `;
  }

  function renderItem(item) {
    const selected = state.selected.has(item.id);
    return `
      <div class="db256-item ${selected ? "selected" : ""}">
        <label><input type="checkbox" data-db256-item-check="${esc(item.id)}" ${selected ? "checked" : ""}></label>
        <button type="button" class="db256-item-main" data-db256-card="${esc(item.id)}">
          <b>${esc(item.name)}</b>
          <p>${money(item.price)} / ${esc(item.unit)} · ${item.type === "work" ? "Работа" : "Материал"}</p>
        </button>
      </div>
    `;
  }

  function open() {
    state.view = localStorage.getItem(KEYS.view) || "my";
    state.section = localStorage.getItem(KEYS.section) || "work";
    state.selected.clear();
    state.openCats.clear();
    state.openSubs.clear();
    render();
    screen().classList.remove("hidden");
    addDiag("ok", "db-open", "Открыт безопасный монолит БД V25.6.");
  }

  function close() {
    screen().classList.add("hidden");
  }

  function setView(view) {
    if (view === "masters" && !isAdmin()) return;
    state.view = view;
    localStorage.setItem(KEYS.view, view);
    state.selected.clear();
    state.openCats.clear();
    state.openSubs.clear();
    render();
  }

  function setSection(section) {
    state.section = section === "material" ? "material" : "work";
    localStorage.setItem(KEYS.section, state.section);
    state.selected.clear();
    state.openCats.clear();
    state.openSubs.clear();
    render();
  }

  function idsByCat(key) {
    const category = key.split("|").slice(2).join("|");
    return currentRows().filter(x => x.category === category).map(x => x.id);
  }

  function idsBySub(key) {
    const parts = key.split("|");
    const category = parts[2];
    const subcategory = parts.slice(3).join("|");
    return currentRows().filter(x => x.category === category && x.subcategory === subcategory).map(x => x.id);
  }

  function toggleAll() {
    const shouldOpen = state.openCats.size === 0;
    state.openCats.clear();
    state.openSubs.clear();

    if (shouldOpen) {
      grouped(currentRows()).forEach(cat => {
        const catKey = `${state.view}|${state.section}|${cat.category}`;
        state.openCats.add(catKey);
        cat.subs.forEach(sub => state.openSubs.add(`${catKey}|${sub.subcategory}`));
      });
    }
    render();
  }

  function selectedRows(baseName = state.view) {
    return getBase(baseName).filter(x => state.selected.has(x.id));
  }

  function deleteSelected() {
    if (!canEdit()) return alert("Эту БД нельзя редактировать.");
    if (!state.selected.size) return alert("Ничего не выбрано.");
    if (!confirm("Удалить выбранные позиции: " + state.selected.size + "?")) return;
    setBase(state.view, getBase(state.view).filter(x => !state.selected.has(x.id)));
    state.selected.clear();
  }

  function moveSelected() {
    if (!canEdit()) return alert("Эту БД нельзя редактировать.");
    if (!state.selected.size) return alert("Ничего не выбрано.");
    const category = prompt("Новая папка / категория", "");
    if (!category) return;
    const subcategory = prompt("Новая подпапка", "Без подкатегории") || "Без подкатегории";
    const rows = getBase(state.view);
    rows.forEach(x => {
      if (state.selected.has(x.id)) {
        x.category = category;
        x.subcategory = subcategory;
        x.group = subcategory;
        x.updatedAt = new Date().toISOString();
      }
    });
    setBase(state.view, rows);
  }

  function copyFromServer() {
    const ids = Array.from(state.selected);
    if (!ids.length) return alert("Сначала выбери позиции в БД сервера.");
    const server = getBase("server");
    const my = getBase("my");
    let added = 0, skipped = 0;
    ids.forEach(id => {
      const src = server.find(x => x.id === id);
      if (!src) return;
      const sig = norm(src.type + "|" + src.name + "|" + src.unit);
      if (my.some(x => norm(x.type + "|" + x.name + "|" + x.unit) === sig)) {
        skipped++;
        return;
      }
      my.push(normalizeItem({ ...src, id: undefined, source: "server_copy" }, src.type, "my"));
      added++;
    });
    writeJson(KEYS.my, my);
    localStorage.setItem(KEYS.save, new Date().toISOString());
    alert("Добавлено: " + added + ", дубли: " + skipped);
    state.selected.clear();
    setView("my");
  }

  function addItem() {
    if (!canEdit()) return;
    const name = prompt("Название позиции", "");
    if (!name) return;
    const price = Number(prompt("Цена", "0") || 0);
    const unit = prompt("Единица", "шт") || "шт";
    const category = prompt("Папка / категория", state.section === "work" ? "Работы" : "Материалы") || "Без категории";
    const subcategory = prompt("Подпапка", "Без подкатегории") || "Без подкатегории";
    const rows = getBase(state.view);
    rows.push(normalizeItem({ type: state.section, name, price, unit, category, subcategory }, state.section, state.view === "server" ? "server" : "my"));
    setBase(state.view, rows);
  }

  function exportJson() {
    const rows = getBase(state.view);
    const payload = {
      version: VERSION,
      source: state.view,
      exportedAt: new Date().toISOString(),
      workDB: rows.filter(x => x.type === "work"),
      matDB: rows.filter(x => x.type === "material")
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "electric-pro-db-" + VERSION.toLowerCase() + "-" + state.view + ".json";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  function parseImport(data) {
    const out = [];
    if (Array.isArray(data)) data.forEach(x => out.push(normalizeItem(x, x.type || state.section, state.view)));
    if (Array.isArray(data.workDB)) data.workDB.forEach(x => out.push(normalizeItem(x, "work", state.view)));
    if (Array.isArray(data.matDB)) data.matDB.forEach(x => out.push(normalizeItem(x, "material", state.view)));
    if (Array.isArray(data.items)) data.items.forEach(x => out.push(normalizeItem(x, x.type || state.section, state.view)));
    return out;
  }

  function importFile(file) {
    if (!file) return;
    if (!canEdit()) return alert("Импорт в эту БД запрещён.");
    const reader = new FileReader();
    reader.onload = () => {
      try {
        let rows = [];
        if (/\.json$/i.test(file.name)) {
          rows = parseImport(JSON.parse(String(reader.result || "{}")));
        } else {
          rows = String(reader.result || "").split(/\r?\n/).filter(Boolean).map(line => {
            const p = line.split(/[;\t]/).map(x => x.trim());
            return normalizeItem({ name: p[0], category: p[1] || "Импорт", subcategory: p[2] || "Без подкатегории", unit: p[3] || "шт", price: p[4] || 0 }, state.section, state.view);
          });
        }

        const base = getBase(state.view);
        let added = 0, skipped = 0;
        rows.forEach(row => {
          const sig = norm(row.type + "|" + row.name + "|" + row.unit);
          if (base.some(x => norm(x.type + "|" + x.name + "|" + x.unit) === sig)) {
            skipped++;
            return;
          }
          base.push({ ...row, id: uid() });
          added++;
        });
        setBase(state.view, base);
        alert("Импорт: добавлено " + added + ", дубли: " + skipped);
      } catch (e) {
        alert("Ошибка импорта: " + String(e.message || e));
      }
    };
    reader.readAsText(file);
  }

  function openCard(id) {
    const item = getBase(state.view).find(x => x.id === id);
    if (!item) return;
    alert(`${item.name}\n\n${money(item.price)} / ${item.unit}\n${item.type === "work" ? "Работа" : "Материал"}\n${item.category} / ${item.subcategory}`);
  }

  function diagnosticsText() {
    return JSON.stringify({
      title: "Electric Pro DB V25.6 diagnostics",
      version: VERSION,
      time: new Date().toISOString(),
      view: state.view,
      section: state.section,
      counts: {
        my: getBase("my").length,
        server: getBase("server").length,
        masters: Object.keys(readJson(KEYS.masters, {})).length
      },
      logs: readJson(KEYS.diag, [])
    }, null, 2);
  }

  function openDiag() {
    const txt = diagnosticsText();
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(txt).then(() => alert("Диагностика БД скопирована."));
    } else {
      alert(txt);
    }
  }

  function bind() {
    if (window.__dbV256Bound) return;
    window.__dbV256Bound = true;

    document.addEventListener("click", e => {
      if (e.target.closest("[data-db256-close]")) { e.preventDefault(); close(); return; }
      if (e.target.closest("[data-db256-diag]")) { e.preventDefault(); openDiag(); return; }

      const view = e.target.closest("[data-db256-view]");
      if (view) { e.preventDefault(); setView(view.getAttribute("data-db256-view")); return; }

      const section = e.target.closest("[data-db256-section]");
      if (section) { e.preventDefault(); setSection(section.getAttribute("data-db256-section")); return; }

      if (e.target.closest("[data-db256-editor-toggle]")) {
        e.preventDefault();
        localStorage.setItem(KEYS.editor, localStorage.getItem(KEYS.editor) === "1" ? "0" : "1");
        render();
        return;
      }

      const cat = e.target.closest("[data-db256-cat]");
      if (cat) { e.preventDefault(); const k = cat.getAttribute("data-db256-cat"); state.openCats.has(k) ? state.openCats.delete(k) : state.openCats.add(k); render(); return; }

      const sub = e.target.closest("[data-db256-sub]");
      if (sub) { e.preventDefault(); const k = sub.getAttribute("data-db256-sub"); state.openSubs.has(k) ? state.openSubs.delete(k) : state.openSubs.add(k); render(); return; }

      const card = e.target.closest("[data-db256-card]");
      if (card) { e.preventDefault(); openCard(card.getAttribute("data-db256-card")); return; }

      if (e.target.closest("[data-db256-toggle-all]")) { e.preventDefault(); toggleAll(); return; }
      if (e.target.closest("[data-db256-select-all]")) { e.preventDefault(); currentRows().forEach(x => state.selected.add(x.id)); render(); return; }
      if (e.target.closest("[data-db256-clear-selection]")) { e.preventDefault(); state.selected.clear(); render(); return; }
      if (e.target.closest("[data-db256-delete]")) { e.preventDefault(); deleteSelected(); return; }
      if (e.target.closest("[data-db256-move]")) { e.preventDefault(); moveSelected(); return; }
      if (e.target.closest("[data-db256-add]")) { e.preventDefault(); addItem(); return; }
      if (e.target.closest("[data-db256-export]")) { e.preventDefault(); exportJson(); return; }
      if (e.target.closest("[data-db256-copy-from-server]")) { e.preventDefault(); copyFromServer(); return; }
    }, true);

    document.addEventListener("change", e => {
      const item = e.target.closest("[data-db256-item-check]");
      if (item) { item.checked ? state.selected.add(item.getAttribute("data-db256-item-check")) : state.selected.delete(item.getAttribute("data-db256-item-check")); render(); return; }

      const cat = e.target.closest("[data-db256-cat-check]");
      if (cat) { idsByCat(cat.getAttribute("data-db256-cat-check")).forEach(id => cat.checked ? state.selected.add(id) : state.selected.delete(id)); render(); return; }

      const sub = e.target.closest("[data-db256-sub-check]");
      if (sub) { idsBySub(sub.getAttribute("data-db256-sub-check")).forEach(id => sub.checked ? state.selected.add(id) : state.selected.delete(id)); render(); return; }

      const file = e.target.closest("[data-db256-import]");
      if (file) { importFile(file.files && file.files[0]); file.value = ""; return; }

      const master = e.target.closest("[data-db256-master-select]");
      if (master) { state.selectedMaster = master.value; state.selected.clear(); render(); return; }
    }, true);

    document.addEventListener("input", e => {
      const search = e.target.closest("[data-db256-search]");
      if (search) {
        state.search = search.value;
        render();
      }
    }, true);
  }

  function boot() {
    migrateOnce();
    bind();
  }

  window.DatabaseV256SafeMonolith = {
    version: VERSION,
    open,
    close,
    getBase,
    setBase,
    diagnosticsText
  };

  window.DatabaseV25HardMonolith = window.DatabaseV25HardMonolith || window.DatabaseV256SafeMonolith;
  window.DatabaseV24CleanMonolith = window.DatabaseV24CleanMonolith || {};
  window.DatabaseV24CleanMonolith.open = open;

  window.addEventListener("DOMContentLoaded", function () {
    boot();
    [300, 900, 1800].forEach(ms => setTimeout(boot, ms));
  });

  addDiag("ok", "ready", "Безопасный монолит БД V25.6 готов. Автоматически не открывается.");
})();
