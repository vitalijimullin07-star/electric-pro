(function () {
  const VERSION = "V24.4";
  const FILE = "assets/js/database-v24-clean-monolith.js";

  const KEYS = {
    my: "ep_db_v24_my",
    server: "ep_db_v24_server",
    masters: "ep_db_v24_masters_demo",
    activeView: "ep_db_v24_4_active_view",
    editorOpen: "ep_db_v24_4_editor_open",
    lastSave: "ep_db_v24_4_last_save",
    cloudStatus: "ep_db_v24_4_cloud_status"
  };

  const state = {
    view: "my",
    section: "work",
    selected: new Set(),
    openCats: new Set(),
    openSubs: new Set(),
    search: "",
    selectedMaster: "",
    importModal: {
      section: "work",
      selected: new Set(),
      openCats: new Set(),
      openSubs: new Set()
    },
    previewImport: {
      rows: [],
      duplicateMode: "skip"
    }
  };

  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[c]));

  const num = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;

  const uid = () => "db_" + Date.now().toString(36) + "_" + Math.random().toString(16).slice(2);

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
        module: "DatabaseV24CleanMonolith",
        functionName: "runtime",
        place: "database",
        code,
        message,
        ...extra
      });
    } catch (e) {}
  }

  function toast(text) {
    let box = document.getElementById("ep-db-v244-toast");
    if (!box) {
      box = document.createElement("div");
      box.id = "ep-db-v244-toast";
      document.body.appendChild(box);
    }
    box.textContent = text;
    box.classList.add("show");
    clearTimeout(window.__dbV244Toast);
    window.__dbV244Toast = setTimeout(() => box.classList.remove("show"), 1800);
  }

  function readJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || ""); } catch (e) { return fallback; }
  }

  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
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

  function setStatus(kind, text) {
    let pill = document.getElementById("db244-save-status");
    if (!pill) return;
    pill.dataset.kind = kind || "saved";
    pill.innerHTML = `<span>${kind === "loading" ? "⏳" : kind === "saving" ? "💾" : kind === "error" ? "⚠️" : "✅"}</span><b>${esc(text || saveStatusText())}</b>`;
  }

  function saveStatusText() {
    let last = "";
    let cloud = "";
    try {
      const raw = localStorage.getItem(KEYS.lastSave);
      if (raw) last = "Локально: " + new Date(raw).toLocaleTimeString("ru-RU", { hour:"2-digit", minute:"2-digit", second:"2-digit" });
    } catch (e) {}
    try { cloud = localStorage.getItem(KEYS.cloudStatus) || ""; } catch (e) {}
    return [last, cloud].filter(Boolean).join(" · ") || "Автосохранение готово";
  }

  function normalizeItem(x, typeHint = "", baseType = "my") {
    const now = new Date().toISOString();
    const t = String(typeHint || x.type || x.t || "").toLowerCase();
    const type = t.includes("work") || t.includes("работ") ? "work" : "material";

    return {
      id: x.id || uid(),
      baseType: baseType || x.baseType || "my",
      ownerUid: x.ownerUid || (baseType === "server" ? "server" : (currentUid() || currentEmail() || "local")),
      type,
      name: String(x.name || x.n || x.title || "Позиция").trim(),
      category: String(x.category || x.c || x.cat || (type === "work" ? "Работы" : "Материалы")).trim(),
      subcategory: String(x.subcategory || x.sc || x.sub || x.g || "Без подкатегории").trim(),
      group: String(x.group || x.g || x.sc || "Без группы").trim(),
      unit: String(x.unit || x.u || "шт").trim(),
      price: num(x.price ?? x.p ?? x.cost, 0),
      aliases: Array.isArray(x.aliases) ? x.aliases : [],
      specs: x.specs && typeof x.specs === "object" ? x.specs : {},
      source: x.source || x.src || "manual",
      sourceItemId: x.sourceItemId || "",
      active: x.active !== false,
      createdAt: x.createdAt || now,
      updatedAt: now
    };
  }

  function getBase(base = state.view) {
    if (base === "server") return readJson(KEYS.server, []);
    if (base === "masters") {
      const all = readJson(KEYS.masters, {});
      return state.selectedMaster ? (all[state.selectedMaster] || []) : [];
    }
    return readJson(KEYS.my, []);
  }

  async function tryCloudSave(base, items) {
    try {
      const firebase = window.firebase;
      if (!firebase?.auth || !firebase?.firestore) {
        localStorage.setItem(KEYS.cloudStatus, "Сервер: не подключён");
        return false;
      }

      const user = firebase.auth().currentUser;
      if (!user) {
        localStorage.setItem(KEYS.cloudStatus, "Сервер: вход не найден");
        return false;
      }

      const fs = firebase.firestore();
      const payload = {
        base,
        items,
        updatedAt: new Date().toISOString(),
        ownerUid: user.uid,
        ownerEmail: user.email || ""
      };

      if (base === "server") {
        await fs.collection("ep_database_v24").doc("server").set(payload, { merge: true });
      } else if (base === "my") {
        await fs.collection("ep_user_database_v24").doc(user.uid).set(payload, { merge: true });
      } else {
        return false;
      }

      localStorage.setItem(KEYS.cloudStatus, "Сервер: сохранено");
      return true;
    } catch (e) {
      console.warn("DB cloud save failed", e);
      localStorage.setItem(KEYS.cloudStatus, "Сервер: ошибка, локально сохранено");
      return false;
    }
  }

  async function tryCloudLoad() {
    try {
      const firebase = window.firebase;
      if (!firebase?.auth || !firebase?.firestore) return false;

      const user = firebase.auth().currentUser;
      if (!user) return false;

      setStatus("loading", "Загрузка базы с сервера...");
      const fs = firebase.firestore();

      if (state.view === "my") {
        const doc = await fs.collection("ep_user_database_v24").doc(user.uid).get();
        const data = doc.exists ? doc.data() : null;
        if (data && Array.isArray(data.items) && data.items.length) {
          writeJson(KEYS.my, data.items);
          localStorage.setItem(KEYS.cloudStatus, "Сервер: загружено");
          return true;
        }
      }

      if (state.view === "server") {
        const doc = await fs.collection("ep_database_v24").doc("server").get();
        const data = doc.exists ? doc.data() : null;
        if (data && Array.isArray(data.items) && data.items.length) {
          writeJson(KEYS.server, data.items);
          localStorage.setItem(KEYS.cloudStatus, "Сервер: загружено");
          return true;
        }
      }
    } catch (e) {
      console.warn("DB cloud load failed", e);
      localStorage.setItem(KEYS.cloudStatus, "Сервер: загрузка недоступна");
    } finally {
      setStatus("saved", saveStatusText());
    }

    return false;
  }

  function setBase(base, items) {
    if (base === "server") writeJson(KEYS.server, items);
    else if (base === "masters") {
      const all = readJson(KEYS.masters, {});
      if (state.selectedMaster) all[state.selectedMaster] = items;
      writeJson(KEYS.masters, all);
    } else writeJson(KEYS.my, items);

    try { localStorage.setItem(KEYS.lastSave, new Date().toISOString()); } catch (e) {}
    setStatus("saving", "Сохраняю...");
    setTimeout(async () => {
      await tryCloudSave(base, items);
      setStatus("saved", saveStatusText());
      toast("БД сохранена.");
    }, 60);
  }

  function seedServerIfEmpty() {
    if (getBase("server").length) return;
    const seed = [
      { type:"work", n:"Штробление 20x30 бетон", c:"Штробление", sc:"Бетон", g:"Штробление", u:"м", p:550 },
      { type:"work", n:"Штробление 25x30 бетон", c:"Штробление", sc:"Бетон", g:"Штробление", u:"м", p:600 },
      { type:"work", n:"Штробление 30x30 бетон", c:"Штробление", sc:"Бетон", g:"Штробление", u:"м", p:700 },
      { type:"work", n:"Высверливание подрозетников глубоких бетон", c:"Высверливание подрозетников", sc:"Глубокие", g:"Высверливание", u:"шт", p:650 },
      { type:"material", n:"Подрозетник глубокий 68x65", c:"Подрозетники", sc:"Глубокие", g:"Подрозетники", u:"шт", p:55 },
      { type:"material", n:"ГМЛ 4", c:"Соединители", sc:"ГМЛ", g:"ГМЛ", u:"шт", p:12 },
      { type:"material", n:"ГМЛ 6", c:"Соединители", sc:"ГМЛ", g:"ГМЛ", u:"шт", p:16 },
      { type:"material", n:"WAGO 2-пин", c:"Соединители", sc:"WAGO", g:"WAGO", u:"шт", p:35 },
      { type:"material", n:"Термоусадка 12/4", c:"Расходники", sc:"Термоусадка", g:"Термоусадка", u:"м", p:80 }
    ].map(x => normalizeItem(x, x.type, "server"));
    writeJson(KEYS.server, seed);
  }

  function canEditCurrent() {
    if (state.view === "my") return true;
    if (state.view === "server") return isAdmin();
    return false;
  }

  function viewItems() {
    const q = norm(state.search);
    return getBase(state.view)
      .filter(x => x && x.active !== false)
      .filter(x => x.type === state.section)
      .filter(x => {
        if (!q) return true;
        return norm([x.name, x.category, x.subcategory, x.group, x.unit, x.price, (x.aliases || []).join(" ")].join(" ")).includes(q);
      });
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
        rows: rows.sort((a, b) => String(a.name).localeCompare(String(b.name)))
      })).sort((a, b) => a.subcategory.localeCompare(b.subcategory))
    })).sort((a, b) => a.category.localeCompare(b.category));
  }

  function shortFormat(x) {
    return { id:x.id, g:x.group || x.subcategory, c:x.category, sc:x.subcategory, n:x.name, u:x.unit, p:x.price };
  }

  function exportFormat(items, source = state.view) {
    return {
      source,
      version: VERSION,
      exportedAt: new Date().toISOString(),
      matDB: items.filter(x => x.type === "material").map(shortFormat),
      workDB: items.filter(x => x.type === "work").map(shortFormat)
    };
  }

  function parseImportData(data, baseType) {
    const rows = [];
    if (Array.isArray(data)) data.forEach(x => rows.push(normalizeItem(x, x.type, baseType)));
    if (Array.isArray(data.workDB)) data.workDB.forEach(x => rows.push(normalizeItem(x, "work", baseType)));
    if (Array.isArray(data.matDB)) data.matDB.forEach(x => rows.push(normalizeItem(x, "material", baseType)));
    if (!rows.length && Array.isArray(data.items)) data.items.forEach(x => rows.push(normalizeItem(x, x.type, baseType)));
    if (!rows.length && Array.isArray(data.rows)) data.rows.forEach(x => rows.push(normalizeItem(x, x.type, baseType)));
    return rows;
  }

  function duplicateStats(rows, baseRows = getBase(state.view)) {
    let duplicates = 0;
    rows.forEach(row => {
      const sig = norm(row.type + "|" + row.name + "|" + row.unit);
      if (baseRows.some(x => norm(x.type + "|" + x.name + "|" + x.unit) === sig)) duplicates++;
    });
    return duplicates;
  }

  function setView(view) {
    if (view === "masters" && !isAdmin()) return;
    state.view = view;
    state.selected.clear();
    state.search = "";
    localStorage.setItem(KEYS.activeView, view);
    render();
    tryCloudLoad().then(() => render());
  }

  function setSection(section) {
    state.section = section === "material" ? "material" : "work";
    state.selected.clear();
    render();
  }

  function toggleCat(key) {
    state.openCats.has(key) ? state.openCats.delete(key) : state.openCats.add(key);
    render();
  }

  function toggleSub(key) {
    state.openSubs.has(key) ? state.openSubs.delete(key) : state.openSubs.add(key);
    render();
  }

  function setEditorOpen(value) {
    localStorage.setItem(KEYS.editorOpen, value ? "1" : "0");
    render();
  }

  function editorOpen() {
    return localStorage.getItem(KEYS.editorOpen) === "1";
  }

  function selectAllCurrent() {
    viewItems().forEach(x => state.selected.add(x.id));
    render();
  }

  function clearSelection() {
    state.selected.clear();
    render();
  }

  function deleteSelected() {
    if (!canEditCurrent()) return toast("Эту базу нельзя редактировать напрямую.");
    const ids = Array.from(state.selected);
    if (!ids.length) return toast("Ничего не выбрано.");
    if (!confirm(`Удалить выбранные позиции: ${ids.length}?`)) return;
    setBase(state.view, getBase(state.view).filter(x => !state.selected.has(x.id)));
    state.selected.clear();
    render();
  }

  function moveSelected() {
    if (!canEditCurrent()) return toast("Эту базу нельзя редактировать напрямую.");
    const ids = Array.from(state.selected);
    if (!ids.length) return toast("Ничего не выбрано.");
    const category = prompt("Новая папка / категория", "");
    if (!category) return;
    const subcategory = prompt("Новая подпапка", "Без подкатегории") || "Без подкатегории";
    const items = getBase(state.view);
    items.forEach(x => {
      if (state.selected.has(x.id)) {
        x.category = category;
        x.subcategory = subcategory;
        x.group = subcategory;
        x.updatedAt = new Date().toISOString();
      }
    });
    setBase(state.view, items);
    render();
  }

  function addItem() {
    if (!canEditCurrent()) return toast("Эту базу нельзя редактировать напрямую.");
    openEditModal(null);
  }

  function exportJson() {
    const data = exportFormat(getBase(state.view), state.view);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type:"application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `electric-pro-${state.view}-db-v24-4.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  function handleImportFile(file) {
    if (!file) return;
    const ext = String(file.name || "").split(".").pop().toLowerCase();

    if (["png","jpg","jpeg","webp"].includes(ext)) return toast("Картинка: ИИ-импорт будет подключён позже.");
    if (["xlsx","xls"].includes(ext)) return toast("Excel: внутренний импорт следующим шагом.");
    if (ext === "pdf") return toast("PDF: внутренний импорт следующим шагом.");

    const reader = new FileReader();
    reader.onload = () => {
      try {
        let rows = [];
        if (ext === "json") {
          rows = parseImportData(JSON.parse(String(reader.result || "{}")), state.view === "server" ? "server" : "my");
        } else {
          rows = String(reader.result || "").split(/\r?\n/)
            .map(x => x.trim())
            .filter(Boolean)
            .map(line => {
              const p = line.split(/[;\t]/).map(x => x.trim());
              return normalizeItem({ n:p[0], c:p[1] || "Импорт", sc:p[2] || "Без подкатегории", u:p[3] || "шт", p:p[4] || 0 }, state.section, state.view);
            });
        }

        if (!rows.length) return toast("Позиции не найдены.");
        openImportPreview(rows);
      } catch (e) {
        console.error(e);
        toast("Ошибка импорта.");
      }
    };
    reader.readAsText(file);
  }

  function applyImportRows(filterType = "all") {
    if (!canEditCurrent()) return toast("Импорт сюда запрещён.");
    let rows = state.previewImport.rows;
    if (filterType !== "all") rows = rows.filter(x => x.type === filterType);

    const items = getBase(state.view);
    let added = 0, replaced = 0, skipped = 0;

    rows.forEach(row => {
      const sig = norm(row.type + "|" + row.name + "|" + row.unit);
      const idx = items.findIndex(x => norm(x.type + "|" + x.name + "|" + x.unit) === sig);

      if (idx >= 0 && state.previewImport.duplicateMode === "skip") {
        skipped++;
        return;
      }

      if (idx >= 0 && state.previewImport.duplicateMode === "replace") {
        items[idx] = { ...row, id: items[idx].id, createdAt: items[idx].createdAt || row.createdAt, updatedAt: new Date().toISOString() };
        replaced++;
        return;
      }

      items.push({ ...row, id: uid(), baseType: state.view === "server" ? "server" : "my", updatedAt: new Date().toISOString() });
      added++;
    });

    setBase(state.view, items);
    closePreviewImport();
    render();
    toast(`Импорт: добавлено ${added}, заменено ${replaced}, пропущено ${skipped}.`);
  }

  function copyMasterToServer() {
    if (!isAdmin() || state.view !== "masters") return;
    const ids = Array.from(state.selected);
    if (!ids.length) return toast("Ничего не выбрано.");
    const source = getBase("masters");
    const server = getBase("server");
    let added = 0;
    ids.forEach(id => {
      const src = source.find(x => x.id === id);
      if (!src) return;
      server.push(normalizeItem({ ...src, id: undefined, source:"master_copy", sourceItemId: src.id }, src.type, "server"));
      added++;
    });
    setBase("server", server);
    state.selected.clear();
    render();
    toast(`В БД сервера добавлено: ${added}`);
  }

  function addServerSelectionToMy(withPrice) {
    const ids = Array.from(state.importModal.selected);
    if (!ids.length) return toast("Ничего не выбрано.");
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
      my.push(normalizeItem({
        ...src,
        id: undefined,
        price: withPrice ? src.price : 0,
        source: "server_copy",
        sourceItemId: src.id
      }, src.type, "my"));
      added++;
    });

    setBase("my", my);
    state.importModal.selected.clear();
    closeServerImport();
    render();
    toast(`Добавлено в Мою БД: ${added}. Дубли: ${skipped}.`);
  }

  function mastersList() {
    return Object.keys(readJson(KEYS.masters, {}));
  }

  function render() {
    seedServerIfEmpty();

    const s = ensureScreen();
    const admin = isAdmin();
    const rows = viewItems();
    const viewLabel = state.view === "server" ? "БД сервера" : state.view === "masters" ? "БД мастеров" : "БД моя";
    const edit = canEditCurrent();

    s.innerHTML = `
      <div class="db244-head">
        <button type="button" data-db244-close>←</button>
        <div>
          <h2>База данных</h2>
          <p>${admin ? "Админ" : "Мастер"} · ${VERSION}</p>
        </div>
        <b>${esc(viewLabel)}</b>
      </div>

      <div id="db244-save-status" class="db244-save-status" data-kind="saved">
        <span>✅</span><b>${esc(saveStatusText())}</b>
      </div>

      <main class="db244-shell">
        <section class="db244-card">
          <div class="db244-view-switch">
            <button type="button" data-db244-view="server" class="${state.view === "server" ? "active" : ""}">БД сервера</button>
            <button type="button" data-db244-view="my" class="${state.view === "my" ? "active" : ""}">БД моя</button>
            ${admin ? `<button type="button" data-db244-view="masters" class="${state.view === "masters" ? "active" : ""}">БД мастеров</button>` : ""}
          </div>
          <p class="db244-note">${state.view === "server" ? (admin ? "Вы редактируете серверную БД." : "Серверная БД только для просмотра и копирования к себе.") : state.view === "masters" ? "Просмотр личных баз мастеров. Напрямую не ломаем." : "Личная БД мастера: цены, папки, позиции."}</p>
        </section>

        ${renderEditor()}

        <section class="db244-card">
          <div class="db244-tabs">
            <button type="button" data-db244-section="work" class="${state.section === "work" ? "active" : ""}">Работа</button>
            <button type="button" data-db244-section="material" class="${state.section === "material" ? "active" : ""}">Материал</button>
          </div>

          <input class="db244-search" type="search" data-db244-search placeholder="Поиск..." value="${esc(state.search)}">

          <div class="db244-list-head">
            <h3>${state.section === "work" ? "Работы" : "Материалы"}</h3>
            <span>${rows.length} поз. · ${edit ? "редактирование доступно" : "только просмотр"}</span>
          </div>

          <div class="db244-tree">
            ${state.view === "masters" && !state.selectedMaster ? `<div class="db244-empty">Выбери мастера в редакторе БД.</div>` : renderGrouped(rows, "main")}
          </div>
        </section>

        <section class="db244-card">
          <h3>Экспорт / импорт</h3>
          <div class="db244-actions">
            <button type="button" data-db244-export>Экспорт JSON</button>
            <label class="db244-file">
              Импорт JSON / текст
              <input type="file" data-db244-import accept=".json,.txt,.csv,.pdf,.xlsx,.xls,.png,.jpg,.jpeg,.webp">
            </label>
          </div>
          <p class="db244-note">JSON импортируется с предпросмотром: работы, материалы, дубли, режим замены.</p>
        </section>

        <section class="db244-card">
          <h3>Склад</h3>
          <p class="db244-note">Следующий слой. Склад будет брать позиции из БД: остатки, приход, списание, резерв.</p>
        </section>
      </main>
    `;

    setStatus("saved", saveStatusText());
  }

  function renderEditor() {
    const open = localStorage.getItem(KEYS.editorOpen) === "1";
    if (!open) {
      return `
        <section class="db244-card">
          <button type="button" class="db244-editor-toggle" data-db244-editor-open>
            <span>▸</span><b>Редактор БД</b><em>свернут</em>
          </button>
        </section>
      `;
    }

    const edit = canEditCurrent();
    return `
      <section class="db244-card">
        <button type="button" class="db244-editor-toggle open" data-db244-editor-close>
          <span>▾</span><b>Редактор БД</b><em>открыт</em>
        </button>

        ${state.view === "my" ? `
          <div class="db244-editor-block">
            <h4>Импорт из БД сервера</h4>
            <p>Открывается отдельным окном. Можно выбрать папку, подпапку, позицию или всё сразу.</p>
            <button type="button" class="db244-server-import-btn" data-db244-open-server-import>Открыть импорт из БД сервера</button>
          </div>
        ` : ""}

        ${state.view === "masters" && isAdmin() ? `
          <div class="db244-editor-block">
            <h4>БД мастеров</h4>
            <p>Выбери мастера и забери нужные позиции в БД сервера.</p>
            <select data-db244-master-select>
              <option value="">Выбрать мастера</option>
              ${mastersList().map(m => `<option value="${esc(m)}" ${state.selectedMaster === m ? "selected" : ""}>${esc(m)}</option>`).join("")}
            </select>
            <button type="button" data-db244-master-copy>Добавить выбранное в БД сервера</button>
          </div>
        ` : ""}

        <div class="db244-editor-block">
          <h4>Управление выбранной БД</h4>
          <div class="db244-actions">
            ${edit ? `<button type="button" data-db244-add>Добавить позицию</button>` : ""}
            ${edit ? `<button type="button" data-db244-move>Переместить</button>` : ""}
            ${edit ? `<button type="button" data-db244-delete>Удалить</button>` : ""}
            <button type="button" data-db244-select-all>Выделить всё</button>
            <button type="button" data-db244-clear-selection>Снять выделение</button>
          </div>
        </div>
      </section>
    `;
  }

  function renderGrouped(rows, mode) {
    const groups = grouped(rows);
    if (!groups.length) return `<div class="db244-empty">Позиции не найдены.</div>`;

    return groups.map(cat => {
      const catKey = `${mode}|${state.view}|${state.section}|${cat.category}`;
      const isOpen = state.openCats.has(catKey);
      return `
        <div class="db244-folder ${isOpen ? "open" : ""}">
          <button type="button" class="db244-folder-head" data-db244-cat="${esc(catKey)}">
            <span>${isOpen ? "📂" : "📁"}</span>
            <b>${esc(cat.category)}</b>
            <em>${cat.subgroups.reduce((s,g)=>s+g.rows.length,0)}</em>
          </button>
          <div class="db244-folder-body">
            ${cat.subgroups.map(sub => {
              const subKey = `${catKey}|${sub.subcategory}`;
              const subOpen = state.openSubs.has(subKey);
              return `
                <div class="db244-sub ${subOpen ? "open" : ""}">
                  <button type="button" class="db244-sub-head" data-db244-sub="${esc(subKey)}">
                    <span>${subOpen ? "▾" : "▸"}</span>
                    <b>${esc(sub.subcategory)}</b>
                    <em>${sub.rows.length}</em>
                  </button>
                  <div class="db244-items">
                    ${sub.rows.map(renderItem).join("")}
                  </div>
                </div>
              `;
            }).join("")}
          </div>
        </div>
      `;
    }).join("");
  }

  function renderItem(item) {
    const selected = state.selected.has(item.id);
    return `
      <div class="db244-item ${selected ? "selected" : ""}">
        <label><input type="checkbox" data-db244-check="${esc(item.id)}" ${selected ? "checked" : ""}></label>
        <button type="button" class="db244-item-main" data-db244-card="${esc(item.id)}">
          <b>${esc(item.name)}</b>
          <p>${num(item.price).toLocaleString("ru-RU")} ₽ / ${esc(item.unit)} · ${item.type === "work" ? "Работа" : "Материал"}</p>
        </button>
      </div>
    `;
  }

  function ensureScreen() {
    let s = document.getElementById("ep-db-v244-screen");
    if (s) return s;
    s = document.createElement("div");
    s.id = "ep-db-v244-screen";
    s.className = "db244-screen hidden";
    document.body.appendChild(s);
    return s;
  }

  function hideOldDbScreens() {
    ["ep-db-v24-screen","ep-db-v243-screen"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.add("hidden");
    });
  }

  function open() {
    seedServerIfEmpty();
    hideOldDbScreens();
    state.view = localStorage.getItem(KEYS.activeView) || "my";
    if (state.view === "masters" && !isAdmin()) state.view = "my";
    render();
    ensureScreen().classList.remove("hidden");
    tryCloudLoad().then(() => render());
    diag("database-v24-4-open", "Database V24.4 opened.", { view: state.view });
  }

  function close() {
    ensureScreen().classList.add("hidden");
  }

  function openCard(id) {
    const item = getBase(state.view).find(x => x.id === id);
    if (!item) return;

    let modal = document.getElementById("db244-card-modal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "db244-card-modal";
      modal.className = "db244-modal hidden";
      document.body.appendChild(modal);
    }

    const specs = Object.entries(item.specs || {}).map(([k,v]) => `<span>${esc(k)}: ${esc(v)}</span>`).join("");
    const aliases = (item.aliases || []).map(a => `<span>${esc(a)}</span>`).join("");

    modal.innerHTML = `
      <div class="db244-backdrop" data-db244-card-close></div>
      <div class="db244-sheet">
        <div class="db244-sheet-head">
          <div><h3>${esc(item.name)}</h3><p>${item.type === "work" ? "Работа" : "Материал"} · ${esc(item.category)} / ${esc(item.subcategory)}</p></div>
          <button type="button" data-db244-card-close>×</button>
        </div>
        <div class="db244-price"><span>Цена</span><b>${num(item.price).toLocaleString("ru-RU")} ₽ / ${esc(item.unit)}</b></div>
        <div class="db244-info-grid">
          <div><span>Папка</span><b>${esc(item.category)}</b></div>
          <div><span>Подпапка</span><b>${esc(item.subcategory)}</b></div>
          <div><span>Источник</span><b>${esc(item.source || "manual")}</b></div>
          <div><span>ID</span><b>${esc(item.id)}</b></div>
        </div>
        <div class="db244-tags"><h4>Характеристики</h4><div>${specs || "<span>Нет</span>"}</div></div>
        <div class="db244-tags"><h4>Псевдонимы</h4><div>${aliases || "<span>Нет</span>"}</div></div>
        <div class="db244-modal-actions">
          ${canEditCurrent() ? `<button type="button" data-db244-edit="${esc(item.id)}">Редактировать</button>` : ""}
          <button type="button" data-db244-card-close>Закрыть</button>
        </div>
      </div>
    `;

    modal.classList.remove("hidden");
  }

  function closeCard() {
    document.getElementById("db244-card-modal")?.classList.add("hidden");
  }

  function openEditModal(id) {
    if (!canEditCurrent()) return toast("Редактирование недоступно.");
    const existing = id ? getBase(state.view).find(x => x.id === id) : null;
    const item = existing || normalizeItem({ type: state.section, n:"", c:"", sc:"", u:"шт", p:0 }, state.section, state.view);

    let modal = document.getElementById("db244-edit-modal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "db244-edit-modal";
      modal.className = "db244-modal hidden";
      document.body.appendChild(modal);
    }

    modal.innerHTML = `
      <div class="db244-backdrop" data-db244-edit-close></div>
      <div class="db244-sheet">
        <div class="db244-sheet-head">
          <div><h3>${existing ? "Редактировать позицию" : "Добавить позицию"}</h3><p>${state.view === "server" ? "БД сервера" : "БД моя"}</p></div>
          <button type="button" data-db244-edit-close>×</button>
        </div>

        <form class="db244-form" data-db244-edit-form data-id="${esc(existing?.id || "")}">
          <label>Тип
            <select name="type">
              <option value="work" ${item.type === "work" ? "selected" : ""}>Работа</option>
              <option value="material" ${item.type === "material" ? "selected" : ""}>Материал</option>
            </select>
          </label>
          <label>Название <input name="name" value="${esc(item.name)}" required></label>
          <label>Цена <input name="price" type="number" step="0.01" value="${esc(item.price)}"></label>
          <label>Единица <input name="unit" value="${esc(item.unit)}"></label>
          <label>Папка / категория <input name="category" value="${esc(item.category)}"></label>
          <label>Подпапка <input name="subcategory" value="${esc(item.subcategory)}"></label>
          <label>Псевдонимы, через запятую <textarea name="aliases">${esc((item.aliases || []).join(", "))}</textarea></label>
          <label>Характеристики JSON <textarea name="specs">${esc(JSON.stringify(item.specs || {}, null, 2))}</textarea></label>
          <div class="db244-modal-actions">
            <button type="submit">Сохранить</button>
            <button type="button" data-db244-edit-close>Отмена</button>
          </div>
        </form>
      </div>
    `;

    modal.classList.remove("hidden");
  }

  function closeEditModal() {
    document.getElementById("db244-edit-modal")?.classList.add("hidden");
  }

  function saveEditForm(form) {
    const id = form.getAttribute("data-id");
    const fd = new FormData(form);
    let specs = {};
    try { specs = JSON.parse(String(fd.get("specs") || "{}")); } catch (e) { return toast("Характеристики должны быть JSON."); }

    const item = normalizeItem({
      id: id || undefined,
      type: fd.get("type"),
      name: fd.get("name"),
      price: fd.get("price"),
      unit: fd.get("unit"),
      category: fd.get("category"),
      subcategory: fd.get("subcategory"),
      group: fd.get("subcategory"),
      aliases: String(fd.get("aliases") || "").split(",").map(x => x.trim()).filter(Boolean),
      specs
    }, fd.get("type"), state.view);

    const items = getBase(state.view);
    if (id) {
      const idx = items.findIndex(x => x.id === id);
      if (idx >= 0) items[idx] = { ...items[idx], ...item, id, createdAt: items[idx].createdAt || item.createdAt, updatedAt: new Date().toISOString() };
    } else {
      items.push(item);
    }

    setBase(state.view, items);
    closeEditModal();
    closeCard();
    render();
  }

  function openServerImport() {
    state.importModal.section = state.section;
    state.importModal.selected.clear();
    renderServerImport();
  }

  function closeServerImport() {
    document.getElementById("db244-server-import")?.classList.add("hidden");
  }

  function serverImportItems() {
    return getBase("server").filter(x => x.active !== false && x.type === state.importModal.section);
  }

  function renderServerImport() {
    let modal = document.getElementById("db244-server-import");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "db244-server-import";
      modal.className = "db244-modal hidden";
      document.body.appendChild(modal);
    }

    const items = serverImportItems();
    const groups = grouped(items);

    modal.innerHTML = `
      <div class="db244-backdrop" data-db244-server-import-close></div>
      <div class="db244-sheet">
        <div class="db244-sheet-head">
          <div><h3>Импорт из БД сервера</h3><p>Выбери папку, подпапку, позицию или всё</p></div>
          <button type="button" data-db244-server-import-close>×</button>
        </div>
        <div class="db244-tabs">
          <button type="button" data-db244-import-section="work" class="${state.importModal.section === "work" ? "active" : ""}">Работа</button>
          <button type="button" data-db244-import-section="material" class="${state.importModal.section === "material" ? "active" : ""}">Материал</button>
        </div>
        <div class="db244-summary"><span>Позиций: ${items.length}</span><span>Выбрано: ${state.importModal.selected.size}</span></div>
        <div class="db244-actions">
          <button type="button" data-db244-import-select-all>Выделить всё</button>
          <button type="button" data-db244-import-clear>Снять</button>
          <button type="button" data-db244-import-with-price>Добавить с ценой</button>
          <button type="button" data-db244-import-no-price>Добавить без цены</button>
        </div>
        <div class="db244-tree">${groups.length ? groups.map(renderServerGroup).join("") : `<div class="db244-empty">В серверной БД нет позиций этого типа.</div>`}</div>
      </div>
    `;

    modal.classList.remove("hidden");
  }

  function renderServerGroup(group) {
    const catKey = `server|${state.importModal.section}|${group.category}`;
    const open = state.importModal.openCats.has(catKey);
    const ids = group.subgroups.flatMap(s => s.rows.map(r => r.id));
    const checked = ids.length && ids.every(id => state.importModal.selected.has(id));

    return `
      <div class="db244-folder ${open ? "open" : ""}">
        <div class="db244-check-head">
          <label><input type="checkbox" data-db244-import-cat="${esc(catKey)}" ${checked ? "checked" : ""}></label>
          <button type="button" class="db244-folder-head" data-db244-import-cat-toggle="${esc(catKey)}">
            <span>${open ? "📂" : "📁"}</span><b>${esc(group.category)}</b><em>${ids.length}</em>
          </button>
        </div>
        <div class="db244-folder-body">
          ${group.subgroups.map(sub => renderServerSub(catKey, sub)).join("")}
        </div>
      </div>
    `;
  }

  function renderServerSub(catKey, sub) {
    const subKey = `${catKey}|${sub.subcategory}`;
    const open = state.importModal.openSubs.has(subKey);
    const ids = sub.rows.map(r => r.id);
    const checked = ids.length && ids.every(id => state.importModal.selected.has(id));

    return `
      <div class="db244-sub ${open ? "open" : ""}">
        <div class="db244-check-head">
          <label><input type="checkbox" data-db244-import-sub="${esc(subKey)}" ${checked ? "checked" : ""}></label>
          <button type="button" class="db244-sub-head" data-db244-import-sub-toggle="${esc(subKey)}">
            <span>${open ? "▾" : "▸"}</span><b>${esc(sub.subcategory)}</b><em>${ids.length}</em>
          </button>
        </div>
        <div class="db244-items">
          ${sub.rows.map(renderServerItem).join("")}
        </div>
      </div>
    `;
  }

  function renderServerItem(item) {
    const checked = state.importModal.selected.has(item.id);
    return `
      <div class="db244-item ${checked ? "selected" : ""}">
        <label><input type="checkbox" data-db244-import-item="${esc(item.id)}" ${checked ? "checked" : ""}></label>
        <div class="db244-item-main static">
          <b>${esc(item.name)}</b>
          <p>${num(item.price).toLocaleString("ru-RU")} ₽ / ${esc(item.unit)} · ${item.type === "work" ? "Работа" : "Материал"}</p>
        </div>
      </div>
    `;
  }

  function idsByImportCat(key) {
    const category = key.split("|").slice(2).join("|");
    return serverImportItems().filter(x => x.category === category).map(x => x.id);
  }

  function idsByImportSub(key) {
    const parts = key.split("|");
    const category = parts[2];
    const subcategory = parts.slice(3).join("|");
    return serverImportItems().filter(x => x.category === category && x.subcategory === subcategory).map(x => x.id);
  }

  function setImportSelection(ids, checked) {
    ids.forEach(id => checked ? state.importModal.selected.add(id) : state.importModal.selected.delete(id));
  }

  function openImportPreview(rows) {
    state.previewImport.rows = rows;
    state.previewImport.duplicateMode = "skip";

    let modal = document.getElementById("db244-preview-import");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "db244-preview-import";
      modal.className = "db244-modal hidden";
      document.body.appendChild(modal);
    }

    renderPreviewImport();
  }

  function renderPreviewImport() {
    const rows = state.previewImport.rows || [];
    const works = rows.filter(x => x.type === "work").length;
    const mats = rows.filter(x => x.type === "material").length;
    const dups = duplicateStats(rows);

    const modal = document.getElementById("db244-preview-import");
    if (!modal) return;

    modal.innerHTML = `
      <div class="db244-backdrop" data-db244-preview-close></div>
      <div class="db244-sheet">
        <div class="db244-sheet-head">
          <div><h3>Предпросмотр импорта</h3><p>Проверь, что будет добавлено в выбранную БД</p></div>
          <button type="button" data-db244-preview-close>×</button>
        </div>
        <div class="db244-summary">
          <span>Всего: ${rows.length}</span>
          <span>Работ: ${works}</span>
          <span>Материалов: ${mats}</span>
          <span>Дубли: ${dups}</span>
        </div>
        <div class="db244-duplicate-mode">
          <button type="button" data-db244-dup-mode="skip" class="${state.previewImport.duplicateMode === "skip" ? "active" : ""}">Пропустить дубли</button>
          <button type="button" data-db244-dup-mode="replace" class="${state.previewImport.duplicateMode === "replace" ? "active" : ""}">Заменить дубли</button>
          <button type="button" data-db244-dup-mode="copy" class="${state.previewImport.duplicateMode === "copy" ? "active" : ""}">Добавить копии</button>
        </div>
        <div class="db244-actions">
          <button type="button" data-db244-import-apply="all">Импортировать всё</button>
          <button type="button" data-db244-import-apply="work">Только работы</button>
          <button type="button" data-db244-import-apply="material">Только материалы</button>
          <button type="button" data-db244-preview-close>Отмена</button>
        </div>
        <div class="db244-preview-list">
          ${rows.slice(0, 80).map(x => `<div><b>${esc(x.name)}</b><span>${x.type === "work" ? "Работа" : "Материал"} · ${num(x.price).toLocaleString("ru-RU")} ₽ / ${esc(x.unit)}</span></div>`).join("")}
          ${rows.length > 80 ? `<div><b>...</b><span>Показаны первые 80 позиций</span></div>` : ""}
        </div>
      </div>
    `;
    modal.classList.remove("hidden");
  }

  function closePreviewImport() {
    document.getElementById("db244-preview-import")?.classList.add("hidden");
  }

  function dedupeMenu() {
    const menus = Array.from(document.querySelectorAll("#side-menu,#drawer,.side-menu,.sidebar,.drawer,.burger-menu,[data-menu],nav"));
    menus.forEach(menu => {
      const buttons = Array.from(menu.querySelectorAll("button,a,[role='button'],.menu-item,.nav-item")).filter(el => {
        const text = (el.textContent || "").toLowerCase();
        const attrs = [el.getAttribute?.("data-db244-open"), el.getAttribute?.("data-db243-open"), el.getAttribute?.("data-db-v24-open"), el.getAttribute?.("onclick"), el.className].filter(Boolean).join(" ").toLowerCase();
        return text.includes("база данных") || attrs.includes("database") || attrs.includes("data-db24");
      });

      if (!buttons.length) return;

      const keep = buttons.find(x => x.hasAttribute("data-db244-open")) || buttons[buttons.length - 1];
      buttons.forEach(btn => { if (btn !== keep) (btn.closest("li") || btn).remove(); });
      keep.setAttribute("data-db244-open", "1");
      keep.removeAttribute("data-db243-open");
      keep.removeAttribute("data-db-v24-open");
      keep.innerHTML = `<span>📁 База данных</span><span class="db244-menu-badge">${VERSION}</span>`;
    });
  }

  function addMenuButton() {
    const menus = Array.from(document.querySelectorAll("#side-menu,#drawer,.side-menu,.sidebar,.drawer,.burger-menu,[data-menu],nav"));
    menus.forEach(menu => {
      if (menu.querySelector("[data-db244-open]")) return;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "db244-menu-btn";
      btn.setAttribute("data-db244-open", "1");
      btn.innerHTML = `<span>📁 База данных</span><span class="db244-menu-badge">${VERSION}</span>`;
      const home = menu.querySelector("[data-v223-home]");
      if (home?.parentElement) home.parentElement.insertBefore(btn, home.nextSibling);
      else menu.insertBefore(btn, menu.firstChild);
    });
    dedupeMenu();
  }

  function addDiagnosticsToolbar() {
    const root = findDiagnosticsRoot();
    if (!root || root.querySelector(".db244-diagnostics-toolbar")) return;
    const bar = document.createElement("div");
    bar.className = "db244-diagnostics-toolbar";
    bar.innerHTML = `
      <button type="button" data-db244-diag-clear>Очистить</button>
      <button type="button" data-db244-diag-refresh>Обновить</button>
      <button type="button" data-db244-diag-copy>Копировать</button>
      <button type="button" data-db244-diag-export>Экспорт JSON</button>
    `;
    root.insertBefore(bar, root.firstElementChild);
  }

  function findDiagnosticsRoot() {
    const byId = ["diagnostics-panel","ep-diagnostics-panel","diagnostics","diag-panel","ep-diagnostics"];
    for (const id of byId) {
      const el = document.getElementById(id);
      if (el) return el;
    }
    return Array.from(document.querySelectorAll("section,div,main,aside")).filter(el => {
      const t = (el.textContent || "").slice(0, 2000).toLowerCase();
      return t.includes("electric pro diagnostics") || (t.includes("версия:") && t.includes("сессия:") && t.includes("событие"));
    }).sort((a,b)=>(a.textContent||"").length-(b.textContent||"").length)[0] || null;
  }

  function diagnosticsText(root) {
    if (!root) return "";
    const clone = root.cloneNode(true);
    clone.querySelectorAll(".db244-diagnostics-toolbar,button,input,select,textarea").forEach(el => el.remove());
    return (clone.innerText || clone.textContent || "").trim();
  }

  function copyText(text) {
    if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text).then(()=>toast("Скопировано."));
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try { document.execCommand("copy"); toast("Скопировано."); } catch(e) { toast("Не удалось скопировать."); }
    ta.remove();
  }

  function exportDiagnostics() {
    const root = findDiagnosticsRoot();
    const payload = { version: VERSION, exportedAt: new Date().toISOString(), page: location.href, text: diagnosticsText(root) };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type:"application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "electric-pro-diagnostics-" + new Date().toISOString().replace(/[:.]/g, "-") + ".json";
    document.body.appendChild(a);
    a.click();
    setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  function bind() {
    if (window.__db244Bound) return;
    window.__db244Bound = true;

    document.addEventListener("click", e => {
      if (e.target.closest("[data-db244-open]")) { e.preventDefault(); open(); return; }

      if (e.target.closest("[data-db244-diag-clear]")) { e.preventDefault(); try{window.Diagnostics?.clear?.();}catch(_){} toast("Диагностика очищена."); setTimeout(addDiagnosticsToolbar,120); return; }
      if (e.target.closest("[data-db244-diag-refresh]")) { e.preventDefault(); try{window.Diagnostics?.render?.();window.Diagnostics?.sync?.();}catch(_){} setTimeout(addDiagnosticsToolbar,120); return; }
      if (e.target.closest("[data-db244-diag-copy]")) { e.preventDefault(); copyText(diagnosticsText(findDiagnosticsRoot())); return; }
      if (e.target.closest("[data-db244-diag-export]")) { e.preventDefault(); exportDiagnostics(); return; }

      const root = e.target.closest("#ep-db-v244-screen");
      if (root) {
        if (e.target.closest("[data-db244-close]")) { e.preventDefault(); close(); return; }

        const view = e.target.closest("[data-db244-view]");
        if (view) { e.preventDefault(); setView(view.getAttribute("data-db244-view")); return; }

        const section = e.target.closest("[data-db244-section]");
        if (section) { e.preventDefault(); setSection(section.getAttribute("data-db244-section")); return; }

        if (e.target.closest("[data-db244-editor-open]")) { e.preventDefault(); setEditorOpen(true); return; }
        if (e.target.closest("[data-db244-editor-close]")) { e.preventDefault(); setEditorOpen(false); return; }

        const cat = e.target.closest("[data-db244-cat]");
        if (cat) { e.preventDefault(); toggleCat(cat.getAttribute("data-db244-cat")); return; }

        const sub = e.target.closest("[data-db244-sub]");
        if (sub) { e.preventDefault(); toggleSub(sub.getAttribute("data-db244-sub")); return; }

        const card = e.target.closest("[data-db244-card]");
        if (card) { e.preventDefault(); openCard(card.getAttribute("data-db244-card")); return; }

        if (e.target.closest("[data-db244-add]")) { e.preventDefault(); addItem(); return; }
        if (e.target.closest("[data-db244-delete]")) { e.preventDefault(); deleteSelected(); return; }
        if (e.target.closest("[data-db244-move]")) { e.preventDefault(); moveSelected(); return; }
        if (e.target.closest("[data-db244-select-all]")) { e.preventDefault(); selectAllCurrent(); return; }
        if (e.target.closest("[data-db244-clear-selection]")) { e.preventDefault(); clearSelection(); return; }
        if (e.target.closest("[data-db244-export]")) { e.preventDefault(); exportJson(); return; }
        if (e.target.closest("[data-db244-open-server-import]")) { e.preventDefault(); openServerImport(); return; }
        if (e.target.closest("[data-db244-master-copy]")) { e.preventDefault(); copyMasterToServer(); return; }
      }

      if (e.target.closest("[data-db244-card-close]")) { e.preventDefault(); closeCard(); return; }

      const edit = e.target.closest("[data-db244-edit]");
      if (edit) { e.preventDefault(); openEditModal(edit.getAttribute("data-db244-edit")); return; }

      if (e.target.closest("[data-db244-edit-close]")) { e.preventDefault(); closeEditModal(); return; }

      if (e.target.closest("[data-db244-server-import-close]")) { e.preventDefault(); closeServerImport(); return; }

      const importSection = e.target.closest("[data-db244-import-section]");
      if (importSection) { e.preventDefault(); state.importModal.section = importSection.getAttribute("data-db244-import-section") === "material" ? "material" : "work"; state.importModal.selected.clear(); renderServerImport(); return; }

      const importCat = e.target.closest("[data-db244-import-cat-toggle]");
      if (importCat) { e.preventDefault(); const k = importCat.getAttribute("data-db244-import-cat-toggle"); state.importModal.openCats.has(k) ? state.importModal.openCats.delete(k) : state.importModal.openCats.add(k); renderServerImport(); return; }

      const importSub = e.target.closest("[data-db244-import-sub-toggle]");
      if (importSub) { e.preventDefault(); const k = importSub.getAttribute("data-db244-import-sub-toggle"); state.importModal.openSubs.has(k) ? state.importModal.openSubs.delete(k) : state.importModal.openSubs.add(k); renderServerImport(); return; }

      if (e.target.closest("[data-db244-import-select-all]")) { e.preventDefault(); serverImportItems().forEach(x=>state.importModal.selected.add(x.id)); renderServerImport(); return; }
      if (e.target.closest("[data-db244-import-clear]")) { e.preventDefault(); state.importModal.selected.clear(); renderServerImport(); return; }
      if (e.target.closest("[data-db244-import-with-price]")) { e.preventDefault(); addServerSelectionToMy(true); return; }
      if (e.target.closest("[data-db244-import-no-price]")) { e.preventDefault(); addServerSelectionToMy(false); return; }

      if (e.target.closest("[data-db244-preview-close]")) { e.preventDefault(); closePreviewImport(); return; }

      const dup = e.target.closest("[data-db244-dup-mode]");
      if (dup) { e.preventDefault(); state.previewImport.duplicateMode = dup.getAttribute("data-db244-dup-mode"); renderPreviewImport(); return; }

      const apply = e.target.closest("[data-db244-import-apply]");
      if (apply) { e.preventDefault(); applyImportRows(apply.getAttribute("data-db244-import-apply")); }
    }, true);

    document.addEventListener("change", e => {
      const check = e.target.closest("[data-db244-check]");
      if (check) { check.checked ? state.selected.add(check.getAttribute("data-db244-check")) : state.selected.delete(check.getAttribute("data-db244-check")); render(); return; }

      const file = e.target.closest("[data-db244-import]");
      if (file) { handleImportFile(file.files && file.files[0]); file.value = ""; return; }

      const master = e.target.closest("[data-db244-master-select]");
      if (master) { state.selectedMaster = master.value; state.selected.clear(); render(); return; }

      const importItem = e.target.closest("[data-db244-import-item]");
      if (importItem) { importItem.checked ? state.importModal.selected.add(importItem.getAttribute("data-db244-import-item")) : state.importModal.selected.delete(importItem.getAttribute("data-db244-import-item")); renderServerImport(); return; }

      const importCat = e.target.closest("[data-db244-import-cat]");
      if (importCat) { setImportSelection(idsByImportCat(importCat.getAttribute("data-db244-import-cat")), importCat.checked); renderServerImport(); return; }

      const importSub = e.target.closest("[data-db244-import-sub]");
      if (importSub) { setImportSelection(idsByImportSub(importSub.getAttribute("data-db244-import-sub")), importSub.checked); renderServerImport(); }
    }, true);

    document.addEventListener("input", e => {
      const search = e.target.closest("[data-db244-search]");
      if (search) { state.search = search.value; render(); }
    }, true);

    document.addEventListener("submit", e => {
      const form = e.target.closest("[data-db244-edit-form]");
      if (form) { e.preventDefault(); saveEditForm(form); }
    }, true);
  }

  function setImportSelection(ids, checked) {
    ids.forEach(id => checked ? state.importModal.selected.add(id) : state.importModal.selected.delete(id));
  }

  function idsByImportCat(key) {
    const category = key.split("|").slice(2).join("|");
    return serverImportItems().filter(x => x.category === category).map(x => x.id);
  }

  function idsByImportSub(key) {
    const parts = key.split("|");
    const category = parts[2];
    const subcategory = parts.slice(3).join("|");
    return serverImportItems().filter(x => x.category === category && x.subcategory === subcategory).map(x => x.id);
  }

  function patchRoutes() {
    if (window.DatabaseCoreV241) window.DatabaseCoreV241.open = open;
    if (window.DatabaseFileManagerV243) window.DatabaseFileManagerV243.open = open;

    if (window.Router && typeof window.Router.load === "function" && !window.Router.__db244Patched) {
      const oldLoad = window.Router.load.bind(window.Router);
      window.Router.load = function(route, ...args) {
        const r = String(route || "").toLowerCase();
        if (r === "database" || r === "db" || r === "base") {
          open();
          return true;
        }
        return oldLoad(route, ...args);
      };
      window.Router.__db244Patched = true;
    }
  }

  function observe() {
    if (window.__db244Obs) return;
    const obs = new MutationObserver(() => {
      clearTimeout(window.__db244ObsT);
      window.__db244ObsT = setTimeout(() => {
        addMenuButton();
        addDiagnosticsToolbar();
      }, 100);
    });
    obs.observe(document.body, { childList:true, subtree:true });
    window.__db244Obs = obs;
  }

  function boot() {
    bind();
    patchRoutes();
    addMenuButton();
    addDiagnosticsToolbar();
    observe();

    try {
      window.ModuleVersionBadgesV212?.setVersion?.("database", VERSION);
      window.ModuleVersionBadgesV212?.apply?.();
    } catch(e) {}
  }

  window.addEventListener("DOMContentLoaded", function() {
    boot();
    [300, 900, 1800, 3500].forEach(ms => setTimeout(boot, ms));
  });

  window.DatabaseV24CleanMonolith = {
    version: VERSION,
    open,
    close,
    getBase,
    setBase,
    normalizeItem,
    parseImportData,
    exportFormat
  };

  diag("database-v24-clean-monolith-ready", "Database V24.4 clean monolith ready.");
})();
