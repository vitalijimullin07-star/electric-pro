/* ============================================================
   Electric Pro V29 — Database / Core
   Публичный контракт EP.Database. Чистая бизнес-логика, без DOM.
   Модель позиции и нормализация перенесены из старого проекта:
     { id, type:"material"|"work", name, category, subcategory,
       unit, price:Number, active:Boolean }
   Две базы: "my" (epdb26_my), "server" (epdb26_server).
   Активная база хранится в epdb26_active_base. Смешивать нельзя:
   все выборки идут из ОДНОЙ активной базы.
   ============================================================ */
(() => {
  "use strict";
  window.EP = window.EP || {};
  EP.Database = EP.Database || {};
  const A = EP.Database.Adapter;
  const S = EP.Database.Storage;

  const TYPES = ["material", "work"];
  let _seq = 0;

  function uid() {
    _seq += 1;
    return "ep_" + Date.now().toString(36) + "_" + _seq.toString(36);
  }

  function num(v) {
    if (typeof v === "number") return isFinite(v) ? v : 0;
    if (v == null) return 0;
    // допускаем запятую как десятичный разделитель и пробелы-разделители тысяч
    const s = String(v).replace(/\s+/g, "").replace(",", ".").replace(/[^0-9.\-]/g, "");
    const n = parseFloat(s);
    return isFinite(n) ? n : 0;
  }

  function str(v) {
    return v == null ? "" : String(v).trim();
  }

  function normalizeType(t, hint) {
    const v = str(t).toLowerCase();
    if (v === "work" || v === "работа" || v === "услуга" || v === "раб") return "work";
    if (v === "material" || v === "материал" || v === "mat" || v === "мат") return "material";
    if (hint === "work" || hint === "material") return hint;
    return "material";
  }

  function normalizeItem(raw, typeHint) {
    raw = raw || {};
    const cur = (window.EP.Currency && EP.Currency.code) ? EP.Currency.code() : "RUB";
    return {
      id: str(raw.id) || uid(),
      type: normalizeType(raw.type != null ? raw.type : (raw.t || raw.kind || raw["Тип"] || raw["тип"]), typeHint),
      name: str(raw.name || raw.title || raw.n || raw["Наименование"] || raw["наименование"] || raw["Название"] || raw["название"] || raw["имя"]),
      category: str(raw.category || raw.cat || raw.c || raw["Категория"] || raw["категория"] || raw["Раздел"] || raw["раздел"] || raw["Группа"]),
      subcategory: str(raw.subcategory || raw.subcat || raw.sub || raw.sc || raw.g || raw["Подкатегория"] || raw["подкатегория"] || raw["Подраздел"]),
      unit: str(raw.unit || raw.ed || raw.measure || raw.u || raw["Единица"] || raw["единица"] || raw["Ед"] || raw["ед"] || raw["ед.изм"]) || "шт",
      price: num(raw.price != null ? raw.price : (raw.p != null ? raw.p : (raw["Цена"] != null ? raw["Цена"] : (raw["цена"] != null ? raw["цена"] : raw["Стоимость"])))),
      currency: str(raw.currency) || cur,
      active: raw.active === false ? false : true,
      deleted: raw.deleted === true ? true : false
    };
  }

  function byCatSubName(a, b) {
    return (
      a.category.localeCompare(b.category, "ru") ||
      a.subcategory.localeCompare(b.subcategory, "ru") ||
      a.name.localeCompare(b.name, "ru")
    );
  }

  function sortItems(items) {
    return items
      .map((x) => normalizeItem(x, x && x.type))
      .sort(byCatSubName);
  }

  // ---- активная база -------------------------------------------------
  function getActiveDb() {
    const v = S.readString(S.KEYS.active, "my");
    return v === "server" ? "server" : "my";
  }

  function setActiveDb(base) {
    const v = base === "server" ? "server" : "my";
    S.writeString(S.KEYS.active, v);
    window.dispatchEvent(new CustomEvent("ep:db-active-changed", { detail: { base: v } }));
    return v;
  }

  function baseTitle(base) {
    return base === "server" ? "БД сервера" : "Моя БД";
  }

  // ---- чтение --------------------------------------------------------
  function getItems(base) {
    base = base || getActiveDb();
    return sortItems(A.loadBase(base)).filter((x) => !x.deleted);
  }

  function getItemsByType(type, base) {
    const t = normalizeType(type);
    return getItems(base).filter((x) => x.type === t);
  }

  function categories(type, base) {
    const set = new Set();
    getItemsByType(type, base).forEach((x) => { if (x.category) set.add(x.category); });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ru"));
  }

  function subcategories(type, category, base) {
    const set = new Set();
    getItemsByType(type, base)
      .filter((x) => x.category === category)
      .forEach((x) => { if (x.subcategory) set.add(x.subcategory); });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ru"));
  }

  function counts(base) {
    const items = getItems(base);
    return {
      total: items.length,
      material: items.filter((x) => x.type === "material").length,
      work: items.filter((x) => x.type === "work").length
    };
  }

  // ---- запись (только Моя БД редактируется мастером) -----------------
  function saveMy(items) {
    return A.saveBase("my", items);
  }

  function emitChanged(base) {
    window.dispatchEvent(new CustomEvent("ep:db-changed", { detail: { base: base || "my" } }));
  }

  function addMyItem(item) {
    const items = A.loadBase("my");
    const it = normalizeItem(item);
    items.push(it);
    saveMy(items);
    emitChanged("my");
    return it;
  }

  function updateMyItem(itemId, patch) {
    const items = A.loadBase("my").map((x) => normalizeItem(x, x && x.type));
    const i = items.findIndex((x) => x.id === itemId);
    if (i < 0) return null;
    items[i] = normalizeItem({ ...items[i], ...patch, id: items[i].id }, items[i].type);
    saveMy(items);
    emitChanged("my");
    return items[i];
  }

  function deleteMyItems(ids) {
    const set = new Set(Array.isArray(ids) ? ids : [ids]);
    const items = A.loadBase("my").filter((x) => !set.has(str(x.id)));
    saveMy(items);
    emitChanged("my");
    return set.size;
  }

  function moveMyItems(ids, target) {
    const set = new Set(Array.isArray(ids) ? ids : [ids]);
    const patch = {};
    if (target && "category" in target) patch.category = str(target.category);
    if (target && "subcategory" in target) patch.subcategory = str(target.subcategory);
    const items = A.loadBase("my").map((x) => {
      const it = normalizeItem(x, x && x.type);
      return set.has(it.id) ? { ...it, ...patch } : it;
    });
    saveMy(items);
    emitChanged("my");
    return set.size;
  }

  // Копирование из БД сервера в Мою БД (дедуп по name+type+category).
  function copyServerItemsToMyDb(itemsOrIds, options) {
    options = options || {};
    const server = getItems("server");
    let picked;
    if (Array.isArray(itemsOrIds) && itemsOrIds.length && typeof itemsOrIds[0] === "object") {
      picked = itemsOrIds.map((x) => normalizeItem(x, x && x.type));
    } else {
      const set = new Set((itemsOrIds || []).map(String));
      picked = server.filter((x) => set.has(x.id));
    }
    const mine = A.loadBase("my").map((x) => normalizeItem(x, x && x.type));
    const sig = (x) => (x.type + "|" + x.category + "|" + x.subcategory + "|" + x.name).toLowerCase();
    const seen = new Set(mine.map(sig));
    let added = 0;
    picked.forEach((src) => {
      const copy = normalizeItem({ ...src, id: uid() }, src.type);
      if (!options.allowDuplicates && seen.has(sig(copy))) return;
      seen.add(sig(copy));
      mine.push(copy);
      added += 1;
    });
    saveMy(mine);
    emitChanged("my");
    return added;
  }

  // ---- импорт / экспорт ---------------------------------------------
  function exportJson(base) {
    base = base || getActiveDb();
    const payload = {
      format: "electric-pro-db",
      version: 1,
      base,
      exportedAt: new Date().toISOString(),
      items: getItems(base)
    };
    return JSON.stringify(payload, null, 2);
  }

  function importJson(text, options) {
    options = options || {};
    const base = options.base === "server" ? "server" : "my";
    let data;
    try { data = JSON.parse(text); } catch (e) { return { ok: false, error: "Некорректный JSON" }; }
    let norm = [];
    const pick = (keys) => { for (const k of keys) if (data && Array.isArray(data[k])) return data[k]; return null; };
    if (Array.isArray(data)) {
      norm = data.map((x) => normalizeItem(x, x && x.type));
    } else if (data && typeof data === "object") {
      const work = pick(["workDB", "worksDB", "works", "work"]);
      const mat = pick(["matDB", "materialDB", "materialsDB", "materials", "material"]);
      if (work || mat) {
        (work || []).forEach((x) => norm.push(normalizeItem(x, "work")));
        (mat || []).forEach((x) => norm.push(normalizeItem(x, "material")));
      } else {
        const items = pick(["items", "db", "data", "positions", "rows", "База", "база", "каталог", "list"]);
        if (items) norm = items.map((x) => normalizeItem(x, x && x.type));
        if (!norm.length) {
          // объект вида { "Категория": [ ... ], "Другая": [ ... ] } — ключ как категория
          const arrKeys = Object.keys(data).filter((k) => Array.isArray(data[k]));
          if (arrKeys.length) arrKeys.forEach((k) => data[k].forEach((x) => { const it = normalizeItem(x, x && x.type); if (!it.category) it.category = k; norm.push(it); }));
        }
      }
    }
    if (!norm.length) return { ok: false, error: "Не найден массив позиций (нужен items, либо workDB/matDB)" };
    let result;
    if (options.mode === "replace") {
      result = norm;
    } else {
      result = A.loadBase(base).map((x) => normalizeItem(x, x && x.type)).concat(norm);
    }
    A.saveBase(base, result);
    emitChanged(base);
    return { ok: true, added: norm.length, total: result.length };
  }

  // Простой CSV: заголовок с колонками name,type,category,subcategory,unit,price
  // Разделитель ; или ,. Кавычки поддерживаются базово.
  function parseCsv(text) {
    const rows = [];
    const lines = String(text).replace(/\r\n?/g, "\n").split("\n").filter((l) => l.trim() !== "");
    if (!lines.length) return rows;
    const delim = (lines[0].match(/;/g) || []).length >= (lines[0].match(/,/g) || []).length ? ";" : ",";
    const splitLine = (line) => {
      const out = []; let cur = ""; let q = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
        else if (ch === delim && !q) { out.push(cur); cur = ""; }
        else cur += ch;
      }
      out.push(cur);
      return out.map((s) => s.trim());
    };
    const header = splitLine(lines[0]).map((h) => h.toLowerCase());
    const idx = (names) => header.findIndex((h) => names.includes(h));
    const cName = idx(["name", "название", "наименование"]);
    const cType = idx(["type", "тип"]);
    const cCat = idx(["category", "категория"]);
    const cSub = idx(["subcategory", "подкатегория", "subcat"]);
    const cUnit = idx(["unit", "ед", "единица"]);
    const cPrice = idx(["price", "цена"]);
    for (let i = 1; i < lines.length; i++) {
      const c = splitLine(lines[i]);
      rows.push({
        name: cName >= 0 ? c[cName] : c[0],
        type: cType >= 0 ? c[cType] : "",
        category: cCat >= 0 ? c[cCat] : "",
        subcategory: cSub >= 0 ? c[cSub] : "",
        unit: cUnit >= 0 ? c[cUnit] : "",
        price: cPrice >= 0 ? c[cPrice] : 0
      });
    }
    return rows;
  }

  function importCsv(text, options) {
    options = options || {};
    const base = options.base === "server" ? "server" : "my";
    const rows = parseCsv(text);
    if (!rows.length) return { ok: false, error: "Пустой CSV или нет строк" };
    const norm = rows.map((x) => normalizeItem(x, options.type));
    const result = A.loadBase(base).map((x) => normalizeItem(x, x && x.type)).concat(norm);
    A.saveBase(base, result);
    emitChanged(base);
    return { ok: true, added: norm.length, total: result.length };
  }

  // ---- ПОЛНЫЙ бэкап всего приложения (БД, документы/сметы, клиенты, инструмент, склад, расходка, затраты, реквизиты, визуал) ----
  function isAppKey(k) { return /^ep[_.]/.test(k) || /^epdb/.test(k) || k === "user_db"; }
  function exportAllData() {
    const data = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && isAppKey(k)) data[k] = localStorage.getItem(k);
      }
    } catch (e) {}
    return JSON.stringify({ format: "electric-pro-full", version: 1, exportedAt: new Date().toISOString(), keys: Object.keys(data).length, data: data }, null, 2);
  }
  function importAllData(text) {
    let obj;
    try { obj = JSON.parse(text); } catch (e) { return { ok: false, error: "Некорректный файл" }; }
    let data = null;
    if (obj && obj.data && typeof obj.data === "object") data = obj.data;
    else if (obj && typeof obj === "object" && obj.format !== "electric-pro-db" && !Array.isArray(obj)) data = obj;
    if (!data || typeof data !== "object") return { ok: false, error: "Это не полный бэкап (используй обычный импорт для одной БД)" };
    let n = 0;
    try {
      Object.keys(data).forEach((k) => {
        if (!isAppKey(k)) return;
        const v = data[k];
        if (typeof v === "string") { localStorage.setItem(k, v); n++; }
        else if (v != null) { localStorage.setItem(k, JSON.stringify(v)); n++; }
      });
    } catch (e) { return { ok: false, error: "Не удалось записать (хранилище переполнено?)" }; }
    return { ok: true, keys: n };
  }

  // ---- алиасы и делегаты синхронизации (Firestore) -------------------
  function getLocalItems(base) { return getItems(base); }
  function saveLocalItems(base, items) {
    const b = base === "server" ? "server" : "my";
    const norm = (Array.isArray(items) ? items : []).map((x) => normalizeItem(x, x && x.type));
    A.saveBase(b, norm);
    emitChanged(b);
    return norm.length;
  }
  function syncFromFirestore() {
    return window.EP.DatabaseSync ? EP.DatabaseSync.syncAll() : Promise.resolve({ ok: false, error: "sync-module-missing" });
  }
  function uploadMyDbToFirestore() {
    return window.EP.DatabaseSync ? EP.DatabaseSync.uploadMyDbCurrent() : Promise.resolve({ ok: false, error: "sync-module-missing" });
  }
  function uploadServerDbToFirestore() {
    return window.EP.DatabaseSync ? EP.DatabaseSync.uploadServerDbCurrent() : Promise.resolve({ ok: false, error: "sync-module-missing" });
  }
  function getFirestoreStatus() {
    return window.EP.DatabaseSync ? EP.DatabaseSync.getStatus() : { state: "offline", reason: "no-sync-module" };
  }

  // ---- публичный контракт -------------------------------------------
  Object.assign(EP.Database, {
    version: "V29.db.2",
    TYPES,
    normalizeItem,
    sortItems,
    getActiveDb,
    setActiveDb,
    baseTitle,
    getItems,
    getItemsByType,
    categories,
    subcategories,
    counts,
    addMyItem,
    updateMyItem,
    deleteMyItems,
    moveMyItems,
    copyServerItemsToMyDb,
    exportJson,
    importJson,
    importCsv,
    exportAllData,
    importAllData,
    getLocalItems,
    saveLocalItems,
    syncFromFirestore,
    uploadMyDbToFirestore,
    uploadServerDbToFirestore,
    getFirestoreStatus
  });
})();
