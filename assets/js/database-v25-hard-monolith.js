(function () {
  const VERSION = "V25";
  const FILE = "assets/js/database-v25-hard-monolith.js";

  const KEYS = {
    my: "ep_db_v25_my",
    server: "ep_db_v25_server",
    masters: "ep_db_v25_masters",
    oldMy: "ep_db_v24_my",
    oldServer: "ep_db_v24_server",
    oldMasters: "ep_db_v24_masters_demo",
    view: "ep_db_v25_view",
    section: "ep_db_v25_section",
    editor: "ep_db_v25_editor_open",
    save: "ep_db_v25_last_save",
    cloud: "ep_db_v25_cloud_status",
    diag: "ep_db_v25_diag"
  };

  const state = {
    view: localStorage.getItem(KEYS.view) || "my",
    section: localStorage.getItem(KEYS.section) || "work",
    search: "",
    selected: new Set(),
    openCats: new Set(),
    openSubs: new Set(),
    selectedMaster: "",
    importServer: {
      openCats: new Set(),
      openSubs: new Set(),
      selected: new Set(),
      section: "work"
    }
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
    return "v25_" + Date.now().toString(36) + "_" + Math.random().toString(16).slice(2);
  }

  function money(v) {
    return Math.round(Number(v || 0)).toLocaleString("ru-RU") + " ₽";
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

  function readJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || ""); } catch (e) { return fallback; }
  }

  function writeJson(key, data) {
    try { localStorage.setItem(key, JSON.stringify(data)); } catch (e) {}
  }

  function addDiag(level, code, text, extra = {}) {
    const logs = readJson(KEYS.diag, []);
    logs.push({
      time: new Date().toLocaleString("ru-RU"),
      iso: new Date().toISOString(),
      level,
      code,
      text,
      extra
    });
    writeJson(KEYS.diag, logs.slice(-80));

    try {
      window.Diagnostics?.ok?.({
        file: FILE,
        module: "DatabaseV25HardMonolith",
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

  function itemType(raw) {
    const t = String(raw || "").toLowerCase();
    if (t.includes("mat") || t.includes("мат")) return "material";
    return "work";
  }

  function normalizeItem(x, typeHint = "", baseType = "my") {
    const type = itemType(typeHint || x.type || x.t || x.kind || "");
    const name = String(x.name || x.n || x.title || x.naimenovanie || "Позиция").trim();
    const category = String(x.category || x.c || x.cat || x.folder || (type === "work" ? "Работы" : "Материалы")).trim();
    const subcategory = String(x.subcategory || x.sc || x.sub || x.group || x.g || "Без подкатегории").trim();
    const unit = String(x.unit || x.u || x.ed || "шт").trim();
    const price = Number(x.price ?? x.p ?? x.cost ?? x.sum ?? 0) || 0;

    return {
      id: x.id || uid(),
      type,
      baseType,
      ownerUid: x.ownerUid || (baseType === "server" ? "server" : currentUid()),
      name,
      category,
      subcategory,
      group: x.group || subcategory,
      unit,
      price,
      aliases: Array.isArray(x.aliases) ? x.aliases : [],
      specs: x.specs && typeof x.specs === "object" ? x.specs : {},
      source: x.source || "manual",
      sourceItemId: x.sourceItemId || "",
      active: x.active !== false,
      createdAt: x.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
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

  function getBase(name = state.view) {
    if (name === "server") return readJson(KEYS.server, []);
    if (name === "masters") {
      const all = readJson(KEYS.masters, {});
      return state.selectedMaster ? (all[state.selectedMaster] || []) : [];
    }
    return readJson(KEYS.my, []);
  }

  function setBase(name, rows) {
    if (name === "server") writeJson(KEYS.server, rows);
    else if (name === "masters") {
      const all = readJson(KEYS.masters, {});
      if (state.selectedMaster) all[state.selectedMaster] = rows;
      writeJson(KEYS.masters, all);
    } else writeJson(KEYS.my, rows);

    localStorage.setItem(KEYS.save, new Date().toISOString());
    setStatus("saving", "Локально сохранено · сервер проверяется...");
    tryCloudSave(name, rows).then(ok => {
      setStatus(ok ? "ok" : "warn", ok ? "Локально сохранено · сервер сохранён" : "Локально сохранено · сервер недоступен");
    });
  }

  async function tryCloudSave(name, rows) {
    try {
      const firebase = window.firebase;
      if (!firebase?.auth || !firebase?.firestore) {
        localStorage.setItem(KEYS.cloud, "Firebase compat не найден");
        addDiag("warn", "firebase-compat-missing", "Firebase compat не найден. Сохраняю локально.");
        return false;
      }

      const user = firebase.auth().currentUser;
      if (!user) {
        localStorage.setItem(KEYS.cloud, "Пользователь Firebase не найден");
        addDiag("warn", "firebase-user-missing", "Пользователь Firebase не найден.");
        return false;
      }

      const payload = {
        version: VERSION,
        base: name,
        items: rows,
        updatedAt: new Date().toISOString(),
        ownerUid: user.uid,
        ownerEmail: user.email || ""
      };

      const fs = firebase.firestore();
      if (name === "server") {
        if (!isAdmin()) throw new Error("server-db-write-admin-only");
        await fs.collection("server_db").doc("main").set(payload, { merge: true });
      } else if (name === "my") {
        await fs.collection("user_db").doc(user.uid).set(payload, { merge: true });
      } else {
        return false;
      }

      localStorage.setItem(KEYS.cloud, "Сервер сохранён");
      addDiag("ok", "cloud-save-ok", "БД сохранена на сервер.", { base: name, count: rows.length });
      return true;
    } catch (e) {
      localStorage.setItem(KEYS.cloud, "Сервер ошибка: " + String(e.message || e));
      addDiag("error", "cloud-save-error", "Ошибка сохранения на сервер.", { error: String(e.message || e), base: name });
      return false;
    }
  }

  async function tryLoadCloud(name) {
    try {
      const firebase = window.firebase;
      if (!firebase?.auth || !firebase?.firestore) return false;
      const user = firebase.auth().currentUser;
      if (!user) return false;

      const fs = firebase.firestore();
      let snap = null;

      if (name === "server") snap = await fs.collection("server_db").doc("main").get();
      if (name === "my") snap = await fs.collection("user_db").doc(user.uid).get();

      if (snap && snap.exists) {
        const data = snap.data() || {};
        const rows = Array.isArray(data.items) ? data.items : [];
        if (rows.length) {
          if (name === "server") writeJson(KEYS.server, rows.map(x => normalizeItem(x, x.type, "server")));
          if (name === "my") writeJson(KEYS.my, rows.map(x => normalizeItem(x, x.type, "my")));
          localStorage.setItem(KEYS.cloud, "Сервер загружен");
          addDiag("ok", "cloud-load-ok", "БД загружена с сервера.", { base: name, count: rows.length });
          return true;
        }
      }

      localStorage.setItem(KEYS.cloud, "Сервер: данных нет");
      return false;
    } catch (e) {
      localStorage.setItem(KEYS.cloud, "Сервер загрузка ошибка: " + String(e.message || e));
      addDiag("error", "cloud-load-error", "Ошибка загрузки с сервера.", { error: String(e.message || e), base: name });
      return false;
    }
  }

  async function loadMastersCloud() {
    if (!isAdmin()) return false;

    try {
      const firebase = window.firebase;
      if (!firebase?.auth || !firebase?.firestore) return false;

      const snap = await firebase.firestore().collection("user_db").get();
      const out = {};
      snap.forEach(doc => {
        const data = doc.data() || {};
        const rows = Array.isArray(data.items) ? data.items : [];
        if (rows.length) {
          out[data.ownerEmail || doc.id] = rows.map(x => normalizeItem(x, x.type, "my"));
        }
      });

      if (Object.keys(out).length) {
        writeJson(KEYS.masters, out);
        addDiag("ok", "masters-load-ok", "БД мастеров загружены.", { count: Object.keys(out).length });
        return true;
      }

      addDiag("warn", "masters-empty", "БД мастеров на сервере не найдены.");
      return false;
    } catch (e) {
      addDiag("error", "masters-load-error", "Ошибка загрузки БД мастеров.", { error: String(e.message || e) });
      return false;
    }
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

  function canEdit() {
    if (state.view === "my") return true;
    if (state.view === "server") return isAdmin();
    return false;
  }

  function screen() {
    let s = document.getElementById("ep-db-v25-screen");
    if (!s) {
      s = document.createElement("div");
      s.id = "ep-db-v25-screen";
      s.className = "db25-screen hidden";
      document.body.appendChild(s);
    }
    return s;
  }

  function hideOldDb() {
    document.querySelectorAll("#ep-db-v244-screen,#ep-db-v243-screen,#ep-db-v24-screen,#ep-database-screen,[data-screen='database']")
      .forEach(el => {
        if (el.id !== "ep-db-v25-screen") el.classList.add("hidden");
      });

    // Прячем старую заглушку, если она была открыта как обычный экран.
    Array.from(document.querySelectorAll("section,main,div")).forEach(el => {
      const text = (el.textContent || "").slice(0, 400);
      if (/База данных/i.test(text) && /Database API|прослойк|Firebase/i.test(text) && !el.closest("#ep-db-v25-screen")) {
        el.classList.add("db25-force-hide-old-placeholder");
      }
    });
  }

  function setStatus(kind, text) {
    const el = document.getElementById("db25-status");
    if (!el) return;
    el.dataset.kind = kind || "ok";
    el.innerHTML = `<span>${kind === "saving" ? "⏳" : kind === "warn" ? "⚠️" : kind === "error" ? "❌" : "✅"}</span><b>${esc(text || "готово")}</b>`;
    const dot = document.getElementById("db25-diag-dot");
    if (dot) dot.dataset.state = (kind === "warn" || kind === "error") ? "error" : "ok";
  }

  function roleLabel() {
    return isAdmin() ? "Админ" : "Мастер";
  }

  function viewLabel() {
    if (state.view === "server") return "БД сервера";
    if (state.view === "masters") return "БД мастеров";
    return "БД моя";
  }

  function render() {
    migrateOnce();
    hideOldDb();

    const rows = currentRows();
    const s = screen();

    s.innerHTML = `
      <div class="db25-head">
        <button type="button" data-db25-close>←</button>
        <div>
          <h2>База данных</h2>
          <p>${esc(roleLabel())} · ${VERSION}</p>
        </div>
        <b>${esc(viewLabel())}</b>
        <button type="button" id="db25-diag-dot" data-state="ok" title="Диагностика БД"><span></span></button>
      </div>

      <div id="db25-status" class="db25-status" data-kind="ok">
        <span>✅</span><b>${esc(statusText())}</b>
      </div>

      <main class="db25-shell">
        <section class="db25-card">
          <div class="db25-switch">
            <button type="button" data-db25-view="server" class="${state.view === "server" ? "active" : ""}">БД сервера</button>
            <button type="button" data-db25-view="my" class="${state.view === "my" ? "active" : ""}">БД моя</button>
            ${isAdmin() ? `<button type="button" data-db25-view="masters" class="${state.view === "masters" ? "active" : ""}">БД мастеров</button>` : ""}
          </div>
          <p class="db25-note">${noteText()}</p>
        </section>

        ${renderEditor()}

        <section class="db25-card">
          <div class="db25-tabs">
            <button type="button" data-db25-section="work" class="${state.section === "work" ? "active" : ""}">Работа</button>
            <button type="button" data-db25-section="material" class="${state.section === "material" ? "active" : ""}">Материал</button>
          </div>

          <input class="db25-search" type="search" data-db25-search placeholder="Поиск..." value="${esc(state.search)}">

          <div class="db25-list-head">
            <h3>${state.section === "work" ? "Работы" : "Материалы"}</h3>
            <span>${rows.length} поз. · ${canEdit() ? "редактирование доступно" : "только просмотр"}</span>
            <button type="button" data-db25-toggle-all>${state.openCats.size ? "Свернуть" : "Развернуть"}</button>
          </div>

          <div class="db25-tree">
            ${state.view === "masters" && !state.selectedMaster ? `<div class="db25-empty">Выбери мастера в редакторе БД.</div>` : renderGroups(rows)}
          </div>
        </section>

        <section class="db25-card">
          <h3>Экспорт / импорт</h3>
          <div class="db25-actions">
            <button type="button" data-db25-export>Экспорт JSON</button>
            <label class="db25-file">Импорт JSON / текст<input type="file" data-db25-import accept=".json,.txt,.csv"></label>
          </div>
        </section>

        <section class="db25-card">
          <h3>Склад</h3>
          <p class="db25-note">Следующий раздел будет брать позиции из этого монолита БД.</p>
        </section>
      </main>
    `;

    setStatus(statusKind(), statusText());
  }

  function statusKind() {
    const cloud = localStorage.getItem(KEYS.cloud) || "";
    if (/ошибка|не найден|недоступ/i.test(cloud)) return "warn";
    return "ok";
  }

  function statusText() {
    const last = localStorage.getItem(KEYS.save);
    const cloud = localStorage.getItem(KEYS.cloud) || "сервер не проверен";
    const local = last ? "Локально: " + new Date(last).toLocaleTimeString("ru-RU") : "Локально: готово";
    return `${local} · Сервер: ${cloud}`;
  }

  function noteText() {
    if (state.view === "server") return isAdmin() ? "Серверная база: редактирование доступно админу." : "Серверная база: только просмотр и копирование в свою БД.";
    if (state.view === "masters") return "Просмотр личных баз мастеров. Напрямую не ломаем.";
    return "Личная БД мастера: цены, папки, позиции.";
  }

  function renderEditor() {
    const open = localStorage.getItem(KEYS.editor) === "1";
    if (!open) {
      return `
        <section class="db25-card">
          <button type="button" class="db25-editor-toggle" data-db25-editor-open>
            <span>▸</span><b>Редактор БД</b><em>свернут</em>
          </button>
        </section>
      `;
    }

    return `
      <section class="db25-card">
        <button type="button" class="db25-editor-toggle open" data-db25-editor-close>
          <span>▾</span><b>Редактор БД</b><em>открыт</em>
        </button>

        ${state.view === "my" ? `
          <div class="db25-editor-block">
            <h4>Импорт из БД сервера</h4>
            <p>Выбор папки, подпапки, позиции или всего списка.</p>
            <button type="button" data-db25-server-import-open>Открыть импорт из БД сервера</button>
          </div>
        ` : ""}

        ${state.view === "masters" ? `
          <div class="db25-editor-block">
            <h4>БД мастеров</h4>
            <p>Выбери мастера и забери нужные позиции в БД сервера.</p>
            <select data-db25-master-select>
              <option value="">Выбрать мастера</option>
              ${Object.keys(readJson(KEYS.masters, {})).map(x => `<option value="${esc(x)}" ${state.selectedMaster === x ? "selected" : ""}>${esc(x)}</option>`).join("")}
            </select>
            <button type="button" data-db25-load-masters>Загрузить мастеров с сервера</button>
            <button type="button" data-db25-copy-master-server>Добавить выбранное в БД сервера</button>
          </div>
        ` : ""}

        <div class="db25-editor-block">
          <h4>Управление выбранной БД</h4>
          <div class="db25-actions">
            ${canEdit() ? `<button type="button" data-db25-add>Добавить позицию</button>` : ""}
            ${canEdit() ? `<button type="button" data-db25-move>Переместить</button>` : ""}
            ${canEdit() ? `<button type="button" data-db25-delete>Удалить</button>` : ""}
            <button type="button" data-db25-select-all>Выделить всё</button>
            <button type="button" data-db25-clear-selection>Снять выделение</button>
          </div>
        </div>
      </section>
    `;
  }

  function renderGroups(rows) {
    const groups = grouped(rows);
    if (!groups.length) return `<div class="db25-empty">Позиции не найдены.</div>`;

    return groups.map(cat => {
      const catKey = `${state.view}|${state.section}|${cat.category}`;
      const catOpen = state.openCats.has(catKey);
      const ids = cat.subs.flatMap(s => s.rows.map(r => r.id));
      const checked = ids.length && ids.every(id => state.selected.has(id));

      return `
        <div class="db25-folder ${catOpen ? "open" : ""}">
          <div class="db25-check-head">
            <label><input type="checkbox" data-db25-cat-check="${esc(catKey)}" ${checked ? "checked" : ""}></label>
            <button type="button" class="db25-folder-head" data-db25-cat="${esc(catKey)}">
              <span>${catOpen ? "📂" : "📁"}</span><b>${esc(cat.category)}</b><em>${ids.length}</em>
            </button>
          </div>
          <div class="db25-folder-body">
            ${cat.subs.map(sub => renderSub(catKey, sub)).join("")}
          </div>
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
      <div class="db25-sub ${open ? "open" : ""}">
        <div class="db25-check-head">
          <label><input type="checkbox" data-db25-sub-check="${esc(subKey)}" ${checked ? "checked" : ""}></label>
          <button type="button" class="db25-sub-head" data-db25-sub="${esc(subKey)}">
            <span>${open ? "▾" : "▸"}</span><b>${esc(sub.subcategory)}</b><em>${ids.length}</em>
          </button>
        </div>
        <div class="db25-items">
          ${sub.rows.map(renderItem).join("")}
        </div>
      </div>
    `;
  }

  function renderItem(item) {
    const selected = state.selected.has(item.id);
    return `
      <div class="db25-item ${selected ? "selected" : ""}">
        <label><input type="checkbox" data-db25-item-check="${esc(item.id)}" ${selected ? "checked" : ""}></label>
        <button type="button" class="db25-item-main" data-db25-card="${esc(item.id)}">
          <b>${esc(item.name)}</b>
          <p>${money(item.price)} / ${esc(item.unit)} · ${item.type === "work" ? "Работа" : "Материал"}</p>
        </button>
      </div>
    `;
  }

  function open() {
    migrateOnce();
    state.view = localStorage.getItem(KEYS.view) || "my";
    state.section = localStorage.getItem(KEYS.section) || "work";
    state.selected.clear();
    state.openCats.clear();
    state.openSubs.clear();

    hideOldDb();
    render();
    screen().classList.remove("hidden");
    tryLoadCloud(state.view).then(() => render());
    if (state.view === "masters") loadMastersCloud().then(() => render());

    addDiag("ok", "db-v25-open", "Открыт жёсткий монолит БД V25.");
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
    tryLoadCloud(view).then(() => render());
    if (view === "masters") loadMastersCloud().then(() => render());
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
    const parts = key.split("|");
    const category = parts.slice(2).join("|");
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

  function deleteSelected() {
    if (!canEdit()) return alert("Эту БД нельзя редактировать напрямую.");
    if (!state.selected.size) return alert("Ничего не выбрано.");
    if (!confirm("Удалить выбранные позиции: " + state.selected.size + "?")) return;
    const rows = getBase(state.view).filter(x => !state.selected.has(x.id));
    state.selected.clear();
    setBase(state.view, rows);
    render();
  }

  function moveSelected() {
    if (!canEdit()) return alert("Эту БД нельзя редактировать напрямую.");
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
    render();
  }

  function openCard(id) {
    const item = getBase(state.view).find(x => x.id === id);
    if (!item) return;

    let modal = document.getElementById("db25-card-modal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "db25-card-modal";
      modal.className = "db25-modal hidden";
      document.body.appendChild(modal);
    }

    modal.innerHTML = `
      <div class="db25-backdrop" data-db25-modal-close></div>
      <div class="db25-sheet">
        <div class="db25-sheet-head">
          <div><h3>${esc(item.name)}</h3><p>${item.type === "work" ? "Работа" : "Материал"} · ${esc(item.category)} / ${esc(item.subcategory)}</p></div>
          <button type="button" data-db25-modal-close>×</button>
        </div>
        <div class="db25-price"><span>Цена</span><b>${money(item.price)} / ${esc(item.unit)}</b></div>
        <div class="db25-info">
          <div><span>Папка</span><b>${esc(item.category)}</b></div>
          <div><span>Подпапка</span><b>${esc(item.subcategory)}</b></div>
          <div><span>Источник</span><b>${esc(item.source)}</b></div>
          <div><span>ID</span><b>${esc(item.id)}</b></div>
        </div>
        <div class="db25-modal-actions">
          ${canEdit() ? `<button type="button" data-db25-edit="${esc(item.id)}">Редактировать</button>` : ""}
          <button type="button" data-db25-modal-close>Закрыть</button>
        </div>
      </div>
    `;

    modal.classList.remove("hidden");
  }

  function closeModal() {
    document.querySelectorAll(".db25-modal").forEach(x => x.classList.add("hidden"));
  }

  function openEdit(id) {
    if (!canEdit()) return alert("Редактирование недоступно.");
    const existing = id ? getBase(state.view).find(x => x.id === id) : null;
    const item = existing || normalizeItem({ type: state.section, name: "", category: "", subcategory: "", unit: "шт", price: 0 }, state.section, state.view);

    let modal = document.getElementById("db25-edit-modal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "db25-edit-modal";
      modal.className = "db25-modal hidden";
      document.body.appendChild(modal);
    }

    modal.innerHTML = `
      <div class="db25-backdrop" data-db25-modal-close></div>
      <div class="db25-sheet">
        <div class="db25-sheet-head">
          <div><h3>${existing ? "Редактировать позицию" : "Добавить позицию"}</h3><p>${esc(viewLabel())}</p></div>
          <button type="button" data-db25-modal-close>×</button>
        </div>
        <form class="db25-form" data-db25-edit-form data-id="${esc(existing?.id || "")}">
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
          <div class="db25-modal-actions">
            <button type="submit">Сохранить</button>
            <button type="button" data-db25-modal-close>Отмена</button>
          </div>
        </form>
      </div>
    `;

    modal.classList.remove("hidden");
  }

  function saveEdit(form) {
    const id = form.getAttribute("data-id");
    const fd = new FormData(form);
    const rows = getBase(state.view);

    const item = normalizeItem({
      id: id || undefined,
      type: fd.get("type"),
      name: fd.get("name"),
      price: fd.get("price"),
      unit: fd.get("unit"),
      category: fd.get("category"),
      subcategory: fd.get("subcategory"),
      group: fd.get("subcategory")
    }, fd.get("type"), state.view === "server" ? "server" : "my");

    if (id) {
      const idx = rows.findIndex(x => x.id === id);
      if (idx >= 0) rows[idx] = { ...rows[idx], ...item, id, updatedAt: new Date().toISOString() };
    } else {
      rows.push(item);
    }

    setBase(state.view, rows);
    closeModal();
    render();
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
    a.download = "electric-pro-db-v25-" + state.view + ".json";
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

        if (!rows.length) return alert("Позиции не найдены.");
        if (!canEdit()) return alert("Импорт в эту БД запрещён.");

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
        render();
        alert("Импорт: добавлено " + added + ", дубли: " + skipped);
      } catch (e) {
        addDiag("error", "import-error", "Ошибка импорта.", { error: String(e.message || e) });
        alert("Ошибка импорта: " + String(e.message || e));
      }
    };
    reader.readAsText(file);
  }

  function serverImportOpen() {
    state.importServer.section = state.section;
    state.importServer.selected.clear();
    renderServerImport();
  }

  function renderServerImport() {
    let modal = document.getElementById("db25-server-import");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "db25-server-import";
      modal.className = "db25-modal hidden";
      document.body.appendChild(modal);
    }

    const rows = getBase("server").filter(x => x.type === state.importServer.section);
    const groups = grouped(rows);

    modal.innerHTML = `
      <div class="db25-backdrop" data-db25-modal-close></div>
      <div class="db25-sheet">
        <div class="db25-sheet-head">
          <div><h3>Импорт из БД сервера</h3><p>Выбери папку, подпапку или позицию</p></div>
          <button type="button" data-db25-modal-close>×</button>
        </div>
        <div class="db25-tabs">
          <button type="button" data-db25-server-section="work" class="${state.importServer.section === "work" ? "active" : ""}">Работа</button>
          <button type="button" data-db25-server-section="material" class="${state.importServer.section === "material" ? "active" : ""}">Материал</button>
        </div>
        <div class="db25-actions">
          <button type="button" data-db25-server-all>Выделить всё</button>
          <button type="button" data-db25-server-clear>Снять</button>
          <button type="button" data-db25-server-with-price>Добавить с ценой</button>
          <button type="button" data-db25-server-no-price>Добавить без цены</button>
        </div>
        <div class="db25-tree">${groups.map(renderServerGroup).join("") || `<div class="db25-empty">Пусто</div>`}</div>
      </div>
    `;
    modal.classList.remove("hidden");
  }

  function renderServerGroup(cat) {
    const key = `server|${state.importServer.section}|${cat.category}`;
    const open = state.importServer.openCats.has(key);
    const ids = cat.subs.flatMap(x => x.rows.map(r => r.id));
    const checked = ids.length && ids.every(id => state.importServer.selected.has(id));
    return `
      <div class="db25-folder ${open ? "open" : ""}">
        <div class="db25-check-head">
          <label><input type="checkbox" data-db25-server-cat-check="${esc(key)}" ${checked ? "checked" : ""}></label>
          <button type="button" class="db25-folder-head" data-db25-server-cat="${esc(key)}"><span>${open ? "📂" : "📁"}</span><b>${esc(cat.category)}</b><em>${ids.length}</em></button>
        </div>
        <div class="db25-folder-body">${cat.subs.map(sub => renderServerSub(key, sub)).join("")}</div>
      </div>
    `;
  }

  function renderServerSub(catKey, sub) {
    const key = `${catKey}|${sub.subcategory}`;
    const open = state.importServer.openSubs.has(key);
    const ids = sub.rows.map(r => r.id);
    const checked = ids.length && ids.every(id => state.importServer.selected.has(id));
    return `
      <div class="db25-sub ${open ? "open" : ""}">
        <div class="db25-check-head">
          <label><input type="checkbox" data-db25-server-sub-check="${esc(key)}" ${checked ? "checked" : ""}></label>
          <button type="button" class="db25-sub-head" data-db25-server-sub="${esc(key)}"><span>${open ? "▾" : "▸"}</span><b>${esc(sub.subcategory)}</b><em>${ids.length}</em></button>
        </div>
        <div class="db25-items">${sub.rows.map(renderServerItem).join("")}</div>
      </div>
    `;
  }

  function renderServerItem(item) {
    const checked = state.importServer.selected.has(item.id);
    return `
      <div class="db25-item ${checked ? "selected" : ""}">
        <label><input type="checkbox" data-db25-server-item-check="${esc(item.id)}" ${checked ? "checked" : ""}></label>
        <div class="db25-item-main static"><b>${esc(item.name)}</b><p>${money(item.price)} / ${esc(item.unit)}</p></div>
      </div>
    `;
  }

  function idsServerCat(key) {
    const category = key.split("|").slice(2).join("|");
    return getBase("server").filter(x => x.type === state.importServer.section && x.category === category).map(x => x.id);
  }

  function idsServerSub(key) {
    const parts = key.split("|");
    const category = parts[2];
    const subcategory = parts.slice(3).join("|");
    return getBase("server").filter(x => x.type === state.importServer.section && x.category === category && x.subcategory === subcategory).map(x => x.id);
  }

  function addServerToMy(withPrice) {
    const ids = Array.from(state.importServer.selected);
    if (!ids.length) return alert("Ничего не выбрано.");
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
      my.push(normalizeItem({ ...src, id: undefined, price: withPrice ? src.price : 0, source: "server_copy", sourceItemId: src.id }, src.type, "my"));
      added++;
    });

    setBase("my", my);
    state.importServer.selected.clear();
    closeModal();
    render();
    alert("Добавлено: " + added + ", дубли: " + skipped);
  }

  function diagnosticsText() {
    const data = {
      title: "Electric Pro DB V25 diagnostics",
      version: VERSION,
      time: new Date().toISOString(),
      user: currentEmail(),
      view: state.view,
      section: state.section,
      counts: {
        my: getBase("my").length,
        server: getBase("server").length,
        masters: Object.keys(readJson(KEYS.masters, {})).length
      },
      status: statusText(),
      cloud: localStorage.getItem(KEYS.cloud) || "",
      logs: readJson(KEYS.diag, [])
    };
    return JSON.stringify(data, null, 2);
  }

  function openDiagnostics() {
    let modal = document.getElementById("db25-diag-modal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "db25-diag-modal";
      modal.className = "db25-modal hidden";
      document.body.appendChild(modal);
    }

    modal.innerHTML = `
      <div class="db25-backdrop" data-db25-modal-close></div>
      <div class="db25-sheet">
        <div class="db25-sheet-head">
          <div><h3>Диагностика БД</h3><p>${esc(VERSION)} · ${esc(viewLabel())}</p></div>
          <button type="button" data-db25-modal-close>×</button>
        </div>
        <div class="db25-actions">
          <button type="button" data-db25-diag-copy>Копировать</button>
          <button type="button" data-db25-diag-clear>Очистить</button>
        </div>
        <textarea class="db25-diag-text" readonly>${esc(diagnosticsText())}</textarea>
      </div>
    `;

    modal.classList.remove("hidden");
  }

  function copyDiag() {
    const text = diagnosticsText();
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text);
    else {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    alert("Диагностика скопирована.");
  }

  function hookEvents() {
    if (window.__db25Events) return;
    window.__db25Events = true;

    document.addEventListener("click", e => {
      if (e.target.closest("[data-db25-close]")) { e.preventDefault(); close(); return; }
      if (e.target.closest("#db25-diag-dot")) { e.preventDefault(); openDiagnostics(); return; }

      const view = e.target.closest("[data-db25-view]");
      if (view) { e.preventDefault(); setView(view.getAttribute("data-db25-view")); return; }

      const section = e.target.closest("[data-db25-section]");
      if (section) { e.preventDefault(); setSection(section.getAttribute("data-db25-section")); return; }

      if (e.target.closest("[data-db25-editor-open]")) { e.preventDefault(); localStorage.setItem(KEYS.editor, "1"); render(); return; }
      if (e.target.closest("[data-db25-editor-close]")) { e.preventDefault(); localStorage.setItem(KEYS.editor, "0"); render(); return; }
      if (e.target.closest("[data-db25-toggle-all]")) { e.preventDefault(); toggleAll(); return; }

      const cat = e.target.closest("[data-db25-cat]");
      if (cat) { e.preventDefault(); const k = cat.getAttribute("data-db25-cat"); state.openCats.has(k) ? state.openCats.delete(k) : state.openCats.add(k); render(); return; }

      const sub = e.target.closest("[data-db25-sub]");
      if (sub) { e.preventDefault(); const k = sub.getAttribute("data-db25-sub"); state.openSubs.has(k) ? state.openSubs.delete(k) : state.openSubs.add(k); render(); return; }

      const card = e.target.closest("[data-db25-card]");
      if (card) { e.preventDefault(); openCard(card.getAttribute("data-db25-card")); return; }

      if (e.target.closest("[data-db25-add]")) { e.preventDefault(); openEdit(null); return; }
      if (e.target.closest("[data-db25-delete]")) { e.preventDefault(); deleteSelected(); return; }
      if (e.target.closest("[data-db25-move]")) { e.preventDefault(); moveSelected(); return; }
      if (e.target.closest("[data-db25-select-all]")) { e.preventDefault(); currentRows().forEach(x => state.selected.add(x.id)); render(); return; }
      if (e.target.closest("[data-db25-clear-selection]")) { e.preventDefault(); state.selected.clear(); render(); return; }
      if (e.target.closest("[data-db25-export]")) { e.preventDefault(); exportJson(); return; }
      if (e.target.closest("[data-db25-server-import-open]")) { e.preventDefault(); serverImportOpen(); return; }
      if (e.target.closest("[data-db25-modal-close]")) { e.preventDefault(); closeModal(); return; }
      if (e.target.closest("[data-db25-diag-copy]")) { e.preventDefault(); copyDiag(); return; }
      if (e.target.closest("[data-db25-diag-clear]")) { e.preventDefault(); writeJson(KEYS.diag, []); openDiagnostics(); return; }
      if (e.target.closest("[data-db25-load-masters]")) { e.preventDefault(); loadMastersCloud().then(() => render()); return; }

      const edit = e.target.closest("[data-db25-edit]");
      if (edit) { e.preventDefault(); openEdit(edit.getAttribute("data-db25-edit")); return; }

      const sCat = e.target.closest("[data-db25-server-cat]");
      if (sCat) { e.preventDefault(); const k = sCat.getAttribute("data-db25-server-cat"); state.importServer.openCats.has(k) ? state.importServer.openCats.delete(k) : state.importServer.openCats.add(k); renderServerImport(); return; }

      const sSub = e.target.closest("[data-db25-server-sub]");
      if (sSub) { e.preventDefault(); const k = sSub.getAttribute("data-db25-server-sub"); state.importServer.openSubs.has(k) ? state.importServer.openSubs.delete(k) : state.importServer.openSubs.add(k); renderServerImport(); return; }

      const sSection = e.target.closest("[data-db25-server-section]");
      if (sSection) { e.preventDefault(); state.importServer.section = sSection.getAttribute("data-db25-server-section"); state.importServer.selected.clear(); renderServerImport(); return; }

      if (e.target.closest("[data-db25-server-all]")) { e.preventDefault(); getBase("server").filter(x => x.type === state.importServer.section).forEach(x => state.importServer.selected.add(x.id)); renderServerImport(); return; }
      if (e.target.closest("[data-db25-server-clear]")) { e.preventDefault(); state.importServer.selected.clear(); renderServerImport(); return; }
      if (e.target.closest("[data-db25-server-with-price]")) { e.preventDefault(); addServerToMy(true); return; }
      if (e.target.closest("[data-db25-server-no-price]")) { e.preventDefault(); addServerToMy(false); return; }
    }, true);

    document.addEventListener("change", e => {
      const item = e.target.closest("[data-db25-item-check]");
      if (item) { item.checked ? state.selected.add(item.getAttribute("data-db25-item-check")) : state.selected.delete(item.getAttribute("data-db25-item-check")); render(); return; }

      const cat = e.target.closest("[data-db25-cat-check]");
      if (cat) { idsByCat(cat.getAttribute("data-db25-cat-check")).forEach(id => cat.checked ? state.selected.add(id) : state.selected.delete(id)); render(); return; }

      const sub = e.target.closest("[data-db25-sub-check]");
      if (sub) { idsBySub(sub.getAttribute("data-db25-sub-check")).forEach(id => sub.checked ? state.selected.add(id) : state.selected.delete(id)); render(); return; }

      const sItem = e.target.closest("[data-db25-server-item-check]");
      if (sItem) { sItem.checked ? state.importServer.selected.add(sItem.getAttribute("data-db25-server-item-check")) : state.importServer.selected.delete(sItem.getAttribute("data-db25-server-item-check")); renderServerImport(); return; }

      const sCat = e.target.closest("[data-db25-server-cat-check]");
      if (sCat) { idsServerCat(sCat.getAttribute("data-db25-server-cat-check")).forEach(id => sCat.checked ? state.importServer.selected.add(id) : state.importServer.selected.delete(id)); renderServerImport(); return; }

      const sSub = e.target.closest("[data-db25-server-sub-check]");
      if (sSub) { idsServerSub(sSub.getAttribute("data-db25-server-sub-check")).forEach(id => sSub.checked ? state.importServer.selected.add(id) : state.importServer.selected.delete(id)); renderServerImport(); return; }

      const file = e.target.closest("[data-db25-import]");
      if (file) { importFile(file.files && file.files[0]); file.value = ""; return; }

      const master = e.target.closest("[data-db25-master-select]");
      if (master) { state.selectedMaster = master.value; state.selected.clear(); render(); }
    }, true);

    document.addEventListener("input", e => {
      const search = e.target.closest("[data-db25-search]");
      if (search) { state.search = search.value; render(); }
    }, true);

    document.addEventListener("submit", e => {
      const form = e.target.closest("[data-db25-edit-form]");
      if (form) { e.preventDefault(); saveEdit(form); }
    }, true);
  }

  function patchRoutes() {
    window.DatabaseV25HardMonolith = api;

    if (!window.DatabaseV24CleanMonolith) window.DatabaseV24CleanMonolith = {};
    window.DatabaseV24CleanMonolith.open = open;
    window.DatabaseV24CleanMonolith.version = VERSION;

    if (!window.DatabaseFileManagerV243) window.DatabaseFileManagerV243 = {};
    window.DatabaseFileManagerV243.open = open;
    window.DatabaseFileManagerV243.version = VERSION;

    if (window.Router && typeof window.Router.load === "function" && !window.Router.__db25Patched) {
      const old = window.Router.load.bind(window.Router);
      window.Router.load = function(route, ...args) {
        if (/^(database|db|base|data)$/i.test(String(route || ""))) {
          open();
          return true;
        }
        return old(route, ...args);
      };
      window.Router.__db25Patched = true;
    }

    document.addEventListener("click", e => {
      const row = e.target.closest("button,a,[role='button'],.menu-item,.nav-item,[data-ep-shell-route]");
      if (!row) return;
      const text = (row.textContent || "").toLowerCase();
      const attrs = [
        row.getAttribute("data-ep-shell-route"),
        row.getAttribute("data-db244-open"),
        row.getAttribute("data-db243-open"),
        row.getAttribute("data-route"),
        row.getAttribute("onclick"),
        row.className
      ].filter(Boolean).join(" ").toLowerCase();

      if (text.includes("база данных") || attrs.includes("database") || attrs.includes("db244") || attrs.includes("db243")) {
        e.preventDefault();
        e.stopPropagation();
        hideOldDb();
        open();
      }
    }, true);
  }

  function fixMenuBadge() {
    document.querySelectorAll("button,a,.menu-item,.nav-item,[data-ep-shell-route]").forEach(row => {
      const t = row.textContent || "";
      if (!/база данных/i.test(t)) return;
      const badge = row.querySelector("em,.db244-menu-badge,.module-version-badge,.version-badge,[class*='badge']");
      if (badge) badge.textContent = VERSION;
    });
  }

  function watchdog() {
    if (window.__db25Watchdog) return;
    window.__db25Watchdog = setInterval(() => {
      patchRoutes();
      fixMenuBadge();

      const oldVisible = Array.from(document.querySelectorAll("section,main,div")).find(el => {
        if (el.closest("#ep-db-v25-screen")) return false;
        const text = (el.textContent || "").slice(0, 300);
        return /База данных/i.test(text) && /Database API|прослойк|Firebase/i.test(text);
      });

      if (oldVisible && !screen().classList.contains("hidden")) hideOldDb();
    }, 700);
  }

  const api = {
    version: VERSION,
    open,
    close,
    getBase,
    setBase,
    normalizeItem,
    diagnosticsText
  };

  function boot() {
    migrateOnce();
    hookEvents();
    patchRoutes();
    fixMenuBadge();
    watchdog();
  }

  window.addEventListener("DOMContentLoaded", function () {
    boot();
    [300, 900, 1800, 3500].forEach(ms => setTimeout(boot, ms));
  });

  addDiag("ok", "db-v25-ready", "Жёсткий монолит БД V25 готов.");
})();
