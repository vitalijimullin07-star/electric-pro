/* ============================================================
   Electric Pro — POOL UI V29 (черновой визуал, с нуля)
   Использует чистый движок EP.PoolEngine. Без MutationObserver.
   Экспорт: EP.Pool (+ алиас PoolV22CleanMonolith для монтажа/сметы/расходки).
   ============================================================ */
(function () {
  "use strict";
  const VERSION = "V29.pool.ui.4";
  const ENGINE = () => (window.EP && window.EP.PoolEngine) || null;

  const K_BLOCKS = "ep_pool_v29_blocks";
  const K_SET = "ep_pool_v29_settings";
  const K_PRICES = "ep_pool_v29_prices";
  const K_TPL = "ep_pool_v29_templates";

  const MATS = ["Бетон", "Панель", "Мягкий", "Кирпич"];
  const HEIGHTS = [30, 60, 90, 110, 150];
  const COUNTERS = [
    { k: "sockets", t: "Розетки", i: "🔌" },
    { k: "switches", t: "Выключатели", i: "💡", keys: "switchKeys", keyOpts: [1, 2, 3] },
    { k: "pass", t: "Проходной", i: "🔁", keys: "passKeys", keyOpts: [1, 2] },
    { k: "cross", t: "Перекрёстный", i: "🔀", keys: "crossKeys", keyOpts: [1, 2] },
    { k: "tv", t: "ТВ", i: "📺" },
    { k: "internet", t: "Интернет", i: "🌐" },
    { k: "warmFloor", t: "Тёплый пол", i: "♨️" }
  ];
  const DEDICATED = ["Кондей", "Стиралка", "Сушилка", "Нептун", "Плита"];
  const MAX_POSTS = 6;
  const CELL_ICON = { sockets: "🔌", sw1: "💡", sw2: "💡", sw3: "💡", pass: "🔁", cross: "🔀", tv: "📺", internet: "🌐", warmFloor: "♨️" };
  const TPL_LABELS = { switch_1: "Выкл 1кл", switch_2: "Выкл 2кл", switch_3: "Выкл 3кл", pass_1: "Проходной", pass_2: "Двойной проходной", cross_1: "Перекрёстный", cross_2: "Двойной перекрёстный" };
  const PIN_ORDER = ["pin2", "pin3", "pin4", "pin5", "pin6", "pin8", "pin10"];

  const n = (v, d = 0) => { const x = Number(String(v).replace(",", ".").replace(/[^\d.\-]/g, "")); return Number.isFinite(x) ? x : d; };
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const money = v => (Math.round(n(v) * 100) / 100).toLocaleString("ru-RU") + " ₽";

  let settings, blocks, builder, priceMap, templates, dbModal = { open: false }, folds = { set: false, conn: false };

  function defSettings() {
    const D = (ENGINE() && ENGINE().DEFAULTS) || {};
    return { ceilingHeight: D.ceilingHeight || 270, mode: D.mode || "junction", connectorMode: D.connectorMode || "gml", shape: D.shape || "round", crown: D.crown || 68, shrinkCmPerJoint: D.shrinkCmPerJoint || 5, heatShrinkType: D.heatShrinkType || "12/4", dropsPerSocketJunction: D.dropsPerSocketJunction || 2, dropsPerSwitchJunction: D.dropsPerSwitchJunction || 2 };
  }
  function defBuilder() { return { material: "Бетон", route: "ceiling", height: 30, sockets: 0, sw1: 0, sw2: 0, sw3: 0, switchKeys: 1, pass: 0, passKeys: 1, cross: 0, crossKeys: 1, tv: 0, internet: 0, warmFloor: 0 }; }
  function defTemplates() { const D = (ENGINE() && ENGINE().DEFAULTS && ENGINE().DEFAULTS.templates) || {}; return JSON.parse(JSON.stringify(D)); }

  function load() {
    try { settings = Object.assign(defSettings(), JSON.parse(localStorage.getItem(K_SET) || "{}")); } catch { settings = defSettings(); }
    try { blocks = JSON.parse(localStorage.getItem(K_BLOCKS) || "[]") || []; } catch { blocks = []; }
    try { priceMap = JSON.parse(localStorage.getItem(K_PRICES) || "{}") || {}; } catch { priceMap = {}; }
    try { templates = Object.assign(defTemplates(), JSON.parse(localStorage.getItem(K_TPL) || "{}")); } catch { templates = defTemplates(); }
    builder = defBuilder();
  }
  function save() {
    try { localStorage.setItem(K_SET, JSON.stringify(settings)); } catch {}
    try { localStorage.setItem(K_BLOCKS, JSON.stringify(blocks)); } catch {}
    try { localStorage.setItem(K_PRICES, JSON.stringify(priceMap)); } catch {}
    try { localStorage.setItem(K_TPL, JSON.stringify(templates)); } catch {}
  }

  // ── расчёт через движок ──
  function engineInput() { return Object.assign({}, settings, { templates, blocks }); }
  function compute() { const E = ENGINE(); if (!E) return { draftItems: [], byMat: {}, junctions: {}, cable: {}, conn: {} }; return E.calc(engineInput()); }
  function draftItemsWithPrices() {
    const r = compute();
    let db = []; try { if (window.EP && EP.Database && EP.Database.getItems) db = EP.Database.getItems("my") || []; } catch (e) {}
    return (r.draftItems || []).map(it => {
      const p = priceMap[it.name]; let price = 0, dbName = "";
      if (p) {
        price = n(p.price); dbName = p.dbName || "";
        if (p.dbItemId) { const f = db.find(x => x && String(x.id) === String(p.dbItemId) && !x.deleted); if (f) { price = n(f.price); dbName = f.name; } }
      }
      return Object.assign({}, it, { price: price, dbName: dbName });
    });
  }

  // ── helpers UI ──
  // суммарное число постов в наборе механизмов
  function postsOf(o) { return n(o.sockets) + n(o.sw1) + n(o.sw2) + n(o.sw3) + n(o.pass) + n(o.cross) + n(o.tv) + n(o.internet) + n(o.warmFloor); }
  // отображаемое значение счётчика (выключатели = сумма по клавишам)
  function counterVal(o, k) { return k === "switches" ? (n(o.sw1) + n(o.sw2) + n(o.sw3)) : n(o[k]); }

  function counterTile(c) {
    const v = counterVal(builder, c.k);
    const keysSel = c.keys ? `<div class="pv29-keys">${c.keyOpts.map(kk => `<button type="button" data-pv-keys="${c.keys}" data-val="${kk}" class="${n(builder[c.keys], 1) === kk ? "on" : ""}">${kk}кл</button>`).join("")}</div>` : "";
    return `<div class="pv29-counter"><div class="pv29-counter-top"><span>${c.i} ${c.t}</span><b>${v}</b></div>
      <div class="pv29-counter-btns"><button type="button" data-pv-dec="${c.k}">−</button><button type="button" data-pv-inc="${c.k}">+</button></div>${keysSel}</div>`;
  }

  // визуализация блока «рамкой» с механизмами
  function frameCells(b) {
    const cells = [];
    const push = (key, badge) => cells.push({ icon: CELL_ICON[key], badge: badge || "" });
    for (let i = 0; i < n(b.sockets); i++) push("sockets");
    for (let i = 0; i < n(b.sw1); i++) push("sw1", "1");
    for (let i = 0; i < n(b.sw2); i++) push("sw2", "2");
    for (let i = 0; i < n(b.sw3); i++) push("sw3", "3");
    for (let i = 0; i < n(b.pass); i++) push("pass", "⇄" + (n(b.passKeys, 1) > 1 ? n(b.passKeys) : ""));
    for (let i = 0; i < n(b.cross); i++) push("cross", "✕" + (n(b.crossKeys, 1) > 1 ? n(b.crossKeys) : ""));
    for (let i = 0; i < n(b.tv); i++) push("tv");
    for (let i = 0; i < n(b.internet); i++) push("internet");
    for (let i = 0; i < n(b.warmFloor); i++) push("warmFloor");
    return cells;
  }
  function frameViz(b, opts) {
    opts = opts || {};
    const cells = frameCells(b);
    const posts = cells.length;
    const inner = cells.length
      ? cells.map(c => `<div class="pv29-cell">${c.icon}${c.badge ? `<i>${esc(c.badge)}</i>` : ""}</div>`).join("")
      : `<div class="pv29-cell pv29-cell-empty">+</div>`;
    const meta = opts.meta ? `<div class="pv29-frame-meta">${esc(opts.meta)}</div>` : "";
    return `<div class="pv29-frameview"><div class="pv29-frame">${inner}</div><div class="pv29-frame-cap">${meta}<span class="pv29-posts ${posts > MAX_POSTS ? "over" : ""}">${posts}/${MAX_POSTS} постов</span></div></div>`;
  }

  function blockSummary(b) {
    if (b.dedicated) return `${esc(b.dedicated)} · ${b.route === "floor" ? "пол" : "потолок"} · h${b.height}`;
    return `${esc(b.material)} · ${b.route === "floor" ? "пол" : "потолок"} · h${b.height}`;
  }

  function render() {
    const root = document.getElementById("ep-pool-root");
    if (!root) return;
    const r = compute();
    const items = draftItemsWithPrices();
    const total = items.reduce((s, it) => s + n(it.price) * n(it.qty), 0);

    // итоги по материалам
    const matRows = Object.keys(r.byMat || {}).map(m => {
      const d = r.byMat[m];
      const st = Object.keys(d.strobe || {}).map(s => `${s}: ${d.strobe[s]}м`).join(", ");
      return `<div class="pv29-matrow"><b>${esc(m)}</b><span>штробы ${st || "—"} · подроз. ${d.podrozStd + d.podrozDeep} (глуб. ${d.podrozDeep})</span></div>`;
    }).join("") || `<div class="pv29-hint">Добавь блоки — здесь появятся итоги по материалам.</div>`;

    // позиции черновика
    const rows = items.map((it, idx) => {
      const priced = n(it.price) > 0;
      const right = priced
        ? `<div class="pv29-priced"><b>${money(it.price)}</b><small>${it.dbName ? "БД" : "вручную"}</small></div><button type="button" class="pv29-dbbtn" data-pv-rowdb="${idx}">изм.</button>`
        : `<button type="button" class="pv29-dbbtn pv29-fill" data-pv-rowdb="${idx}">вписать ₽</button>`;
      return `<div class="pv29-draftrow"><div class="pv29-draftname"><span>${esc(it.name)}</span><small>${it.type === "work" ? "работа" : "материал"} · ${it.qty} ${esc(it.unit)}</small></div>${right}</div>`;
    }).join("") || `<div class="pv29-hint">Черновик пуст.</div>`;

    const seg = (attr, val, opts, collapse) => opts.map(([v, l]) => `<button type="button" data-pv-set="${attr}" data-val="${v}"${collapse ? ` data-pv-collapse="${collapse}"` : ""} class="${val === v ? "on" : ""}">${l}</button>`).join("");

    root.innerHTML = `
    <div class="pv29">
      <div class="pv29-head"><h2>Пул розеток</h2><span class="pv29-ver">${VERSION}</span></div>

      <details class="pv29-card" data-fold="set" ${folds.set ? "open" : ""}>
        <summary>⚙ Настройки квартиры</summary>
        <div class="pv29-set">
          <label class="pv29-field"><span>Высота потолка, см</span><input type="number" inputmode="numeric" data-pv-ceil value="${n(settings.ceilingHeight, 270)}" /></label>
          <div class="pv29-field"><span>Соединения</span><div class="pv29-seg">${seg("mode", settings.mode, [["junction", "В распайках"], ["boxes", "В подрозетниках"]])}</div></div>
          <div class="pv29-field"><span>Кабель</span><div class="pv29-seg">${seg("shape", settings.shape, [["round", "Круглый"], ["flat", "Плоский"]])}</div></div>
          <label class="pv29-field"><span>Ø коронки, мм</span><input type="number" inputmode="numeric" data-pv-crown value="${n(settings.crown, 68)}" /></label>
        </div>
      </details>

      <details class="pv29-card" data-fold="conn" ${folds.conn ? "open" : ""}>
        <summary>🔧 Редактор ваго / гильз <small>(${({ gml: "Гильзы", wago: "ВАГО", siz: "СИЗ" })[settings.connectorMode] || ""})</small></summary>
        <div class="pv29-set">
          <div class="pv29-field"><span>Тип коннектора (свернётся после выбора)</span><div class="pv29-seg">${seg("connectorMode", settings.connectorMode, [["gml", "Гильзы"], ["wago", "ВАГО"], ["siz", "СИЗ"]], "conn")}</div></div>
          <label class="pv29-field"><span>Термоусадка, см/стык</span><input type="number" inputmode="decimal" data-pv-shrink value="${n(settings.shrinkCmPerJoint, 5)}" /></label>
          <label class="pv29-field"><span>Тип термоусадки</span><input type="text" data-pv-shrinktype value="${esc(settings.heatShrinkType)}" /></label>
          <label class="pv29-field"><span>Спусков на розет. распайку</span><input type="number" inputmode="numeric" data-pv-dps value="${n(settings.dropsPerSocketJunction, 2)}" /></label>
          <label class="pv29-field"><span>Спусков на выкл. распайку</span><input type="number" inputmode="numeric" data-pv-dpw value="${n(settings.dropsPerSwitchJunction, 2)}" /></label>
        </div>
        <div class="pv29-tpls"><div class="pv29-tplhead">Соединения на механизм (число проводов × кол-во):</div>
        ${Object.keys(TPL_LABELS).map(key => {
          const t = templates[key] || {};
          return `<div class="pv29-tpl"><div class="pv29-tpltitle">${esc(TPL_LABELS[key])}</div><div class="pv29-tplpins">${PIN_ORDER.map(pin => `<label class="pv29-pin"><span>${pin.replace("pin", "")}пр</span><input type="number" inputmode="numeric" data-pv-tpl="${key}" data-pin="${pin}" value="${n(t[pin], 0) || ""}" placeholder="0" /></label>`).join("")}</div></div>`;
        }).join("")}</div>
      </details>

      <div class="pv29-card pv29-builder">
        <div class="pv29-row2"><div class="pv29-seg pv29-mats">${MATS.map(m => `<button type="button" data-pv-mat="${m}" class="${builder.material === m ? "on" : ""}">${m}</button>`).join("")}</div></div>
        <div class="pv29-row2"><div class="pv29-seg">${seg("route", builder.route, [["ceiling", "С потолка"], ["floor", "С пола"]])}</div></div>
        <div class="pv29-row2"><span class="pv29-lab">Высота, см</span><div class="pv29-seg pv29-heights">${HEIGHTS.map(h => `<button type="button" data-pv-h="${h}" class="${n(builder.height) === h ? "on" : ""}">${h}</button>`).join("")}<input type="number" inputmode="numeric" class="pv29-hcustom" data-pv-hcustom value="${HEIGHTS.indexOf(n(builder.height)) < 0 ? n(builder.height) : ""}" placeholder="своя" /></div></div>

        ${frameViz(builder, { meta: "Сборка блока" })}

        <div class="pv29-counters">${COUNTERS.map(counterTile).join("")}</div>

        <div class="pv29-ded"><span class="pv29-lab">Отдельные линии (своя высота):</span><div class="pv29-dedbtns">${DEDICATED.map(d => `<button type="button" class="pv29-dedbtn" data-pv-ded="${d}">+ ${d}</button>`).join("")}</div></div>

        <button type="button" class="pv29-add" data-pv-addblock>➕ Добавить блок</button>
      </div>

      <div class="pv29-card">
        <div class="pv29-blockshead">Блоки (${blocks.length})</div>
        ${blocks.length ? blocks.map((b, i) => `<div class="pv29-blockitem"><div class="pv29-blocktop"><span>${esc(blockSummary(b))}</span><button type="button" class="pv29-del" data-pv-delblock="${i}">✕</button></div>${b.dedicated || n(b.warmFloor) && postsOf(b) === n(b.warmFloor) ? "" : frameViz(b, {})}</div>`).join("") : `<div class="pv29-hint">Пока нет блоков.</div>`}
      </div>

      <div class="pv29-card">
        <div class="pv29-blockshead">Черновик · по материалам</div>
        ${matRows}
        <div class="pv29-drafthead">Позиции (${items.length})</div>
        ${rows}
        <div class="pv29-total"><span>Итого по ценам:</span><b>${money(total)}</b></div>
        <div class="pv29-actions"><button type="button" class="pv29-est" data-pv-estimate>➕ В смету (предварительную)</button><button type="button" class="pv29-clear" data-pv-clear>Очистить</button></div>
      </div>
    </div>`;
    if (dbModal.open) renderDbModal();
  }

  // ── счётчики / билдер ──
  function clampH(v) { return Math.max(0, n(v, 0)); }
  function applyBuilderChange() { save(); render(); }

  function addBlock() {
    if (postsOf(builder) > MAX_POSTS) { toast("Максимум " + MAX_POSTS + " постов в блоке"); return; }
    const b = { material: builder.material, route: builder.route, height: clampH(builder.height) };
    let any = false;
    ["sockets", "sw1", "sw2", "sw3", "pass", "cross", "tv", "internet", "warmFloor"].forEach(k => { if (n(builder[k]) > 0) { b[k] = n(builder[k]); any = true; } });
    if (n(builder.pass) > 0) b.passKeys = n(builder.passKeys, 1);
    if (n(builder.cross) > 0) b.crossKeys = n(builder.crossKeys, 1);
    if (!any) { toast("Блок пустой — добавь механизмы"); return; }
    blocks.push(b);
    builder = defBuilder();   // сбрасываем счётчики, материал/маршрут к дефолту
    applyBuilderChange();
    toast("Блок добавлен");
  }
  function addDedicated(name) {
    const h = window.prompt(`Высота для «${name}», см:`, name === "Плита" ? "60" : name === "Кондей" ? "220" : "110");
    if (h === null) return;
    blocks.push({ material: builder.material, route: builder.route, height: clampH(h), dedicated: name });
    save(); render(); toast(name + " добавлен");
  }

  // ── цена → БД (вписать ₽) ──
  // ключевые слова поиска по типу позиции (широкие — находят все варианты; имена в БД могут отличаться)
  function searchKeywords(name) {
    const s = String(name || "").toLowerCase();
    if (/штроблен|штроб/.test(s)) return "штроб";
    if (/высверливан/.test(s)) return "подрозетник";          // работа высверливания
    if (/подрозетник/.test(s)) return "подрозетник";
    if (/распаечн|распайк|распаеч/.test(s)) return "распаеч";
    if (/ваго/.test(s)) return "ваго";
    if (/гмл|гильз/.test(s)) return "гильз";
    if (/сиз/.test(s)) return "сиз";
    if (/термоусадк/.test(s)) return "термоусад";
    if (/кабель|ввг|nym/.test(s)) return "кабель";
    if (/коробк/.test(s)) return "коробк";
    return (s.split(/\s+/)[0] || "");
  }
  function dbItemsForRow(row) {
    let items = []; try { if (window.EP && EP.Database && EP.Database.getItems) items = EP.Database.getItems("my") || []; } catch (e) {}
    const q = String(dbModal.q || "").toLowerCase().trim();
    return items.filter(it => it && !it.deleted && (!row.type || it.type === row.type) && (!q || String(it.name || "").toLowerCase().includes(q))).slice(0, 50);
  }
  function dbListHtml(row) {
    const items = dbItemsForRow(row);
    if (!items.length) return `<div class="pv29-dbempty">${dbModal.q ? `По запросу «${esc(dbModal.q)}» ничего. Измени слово или очисти поиск, чтобы видеть всю базу.` : "В «Моей БД» пусто — впиши цену выше"}</div>`;
    return items.map(it => `<button type="button" class="pv29-dbitem" data-pv-dbpick="${esc(it.id)}"><span>${esc(it.name)}</span><b>${money(it.price)}${it.unit ? " / " + esc(it.unit) : ""}</b></button>`).join("");
  }
  function renderDbModal() {
    const root = document.getElementById("ep-pool-root"); if (!root) return;
    const items = draftItemsWithPrices(); const row = items[dbModal.idx]; if (!row) return;
    let o = document.getElementById("pv29-dbmodal");
    if (!o) { o = document.createElement("div"); o.id = "pv29-dbmodal"; o.className = "pv29-dbmodal"; root.appendChild(o); }
    o.innerHTML = `<div class="pv29-dbcard"><div class="pv29-dbtop"><b>${esc(row.name)}</b><button type="button" data-pv-dbclose>✕</button></div>
      <div class="pv29-dbmanual"><input type="number" inputmode="decimal" class="pv29-dbprice" data-pv-dbmanual value="${n(row.price) ? n(row.price) : ""}" placeholder="своя цена ₽" /><button type="button" class="pv29-dbsave" data-pv-dbsave>✓ Вписать (создать в БД)</button></div>
      <div class="pv29-dbor">или выбрать из базы:</div>
      <input type="text" class="pv29-dbsearch" data-pv-dbsearch value="${esc(dbModal.q || "")}" placeholder="поиск по базе" />
      <div class="pv29-dblist">${dbListHtml(row)}</div></div>`;
  }
  function updateDbList() { const box = document.querySelector("#pv29-dbmodal .pv29-dblist"); if (!box) return; const items = draftItemsWithPrices(); const row = items[dbModal.idx]; if (row) box.innerHTML = dbListHtml(row); }
  function openDbRow(idx) { const row = draftItemsWithPrices()[idx]; dbModal = { open: true, idx: idx, q: row ? searchKeywords(row.name) : "" }; renderDbModal(); }
  function closeDbModal() { dbModal.open = false; const o = document.getElementById("pv29-dbmodal"); if (o) o.remove(); }
  function upsertDb(name, type, unit, price) {
    try {
      if (!(window.EP && EP.Database)) return "";
      const items = (EP.Database.getItems ? EP.Database.getItems("my") : []) || [];
      const ex = items.find(x => x && x.type === type && String(x.name).toLowerCase() === String(name).toLowerCase());
      if (ex) { if (EP.Database.updateMyItem) EP.Database.updateMyItem(ex.id, { price: price }); return ex.id; }
      if (EP.Database.addMyItem) { const c = EP.Database.addMyItem({ type: type, name: name, unit: unit || "шт", price: price, category: "Пул" }); return (c && c.id) || ""; }
    } catch (e) {}
    return "";
  }
  function saveManualPrice() {
    const items = draftItemsWithPrices(); const row = items[dbModal.idx]; if (!row) return;
    const inp = document.querySelector("#pv29-dbmodal .pv29-dbprice");
    const val = inp ? Math.max(0, n(inp.value)) : 0;
    if (val <= 0) { toast("Впиши цену"); return; }
    const id = upsertDb(row.name, row.type, row.unit, val);
    priceMap[row.name] = { price: val, dbName: id ? row.name : "", dbItemId: id || "" };
    save(); closeDbModal(); render(); toast(id ? "Цена вписана и создана в Моей БД" : "Цена вписана");
  }
  function pickDbRow(itemId) {
    const items = draftItemsWithPrices(); const row = items[dbModal.idx]; if (!row) return;
    let dbItems = []; try { dbItems = EP.Database.getItems("my") || []; } catch (e) {}
    const it = dbItems.find(x => String(x.id) === String(itemId)); if (!it) return;
    priceMap[row.name] = { price: n(it.price), dbName: it.name, dbItemId: it.id };
    save(); closeDbModal(); render();
  }

  // ── в смету ──
  function pushToEstimate() {
    if (window.EP && EP.Collector && EP.Collector.pushPool) { EP.Collector.pushPool(); toast("Отправлено в предварительную"); }
    else toast("Модуль сметы недоступен");
  }
  function clearPool() { if (!window.confirm("Очистить блоки пула? Привязки цен из БД сохранятся.")) return; blocks = []; builder = defBuilder(); save(); render(); }

  // ── toast ──
  function toast(text) {
    let b = document.getElementById("pv29-toast");
    if (!b) { b = document.createElement("div"); b.id = "pv29-toast"; b.className = "pv29-toast"; document.body.appendChild(b); }
    b.textContent = text; b.classList.add("show");
    clearTimeout(window.__pv29Toast); window.__pv29Toast = setTimeout(() => b.classList.remove("show"), 1600);
  }

  // ── события ──
  function onClick(e) {
    const t = e.target; if (!t || !t.closest) return;
    if (!t.closest("#ep-pool-root")) return;
    let el;
    if (el = t.closest("[data-pv-inc]")) {
      const k = el.dataset.pvInc;
      if (postsOf(builder) >= MAX_POSTS) { toast("Максимум " + MAX_POSTS + " постов в блоке"); return; }
      const tgt = k === "switches" ? "sw" + n(builder.switchKeys, 1) : k;
      builder[tgt] = n(builder[tgt]) + 1; return applyBuilderChange();
    }
    if (el = t.closest("[data-pv-dec]")) {
      const k = el.dataset.pvDec;
      const tgt = k === "switches" ? "sw" + n(builder.switchKeys, 1) : k;
      builder[tgt] = Math.max(0, n(builder[tgt]) - 1); return applyBuilderChange();
    }
    if (el = t.closest("[data-pv-keys]")) { builder[el.dataset.pvKeys] = n(el.dataset.val, 1); return applyBuilderChange(); }
    if (el = t.closest("[data-pv-mat]")) { builder.material = el.dataset.pvMat; return applyBuilderChange(); }
    if (el = t.closest("[data-pv-h]")) { builder.height = n(el.dataset.pvH); return applyBuilderChange(); }
    if (el = t.closest("[data-pv-set]")) { settings[el.dataset.pvSet] = el.dataset.val; if (el.dataset.pvSet === "route") builder.route = el.dataset.val; if (el.dataset.pvCollapse) folds[el.dataset.pvCollapse] = false; return applyBuilderChange(); }
    if (el = t.closest("[data-pv-ded]")) { return addDedicated(el.dataset.pvDed); }
    if (t.closest("[data-pv-addblock]")) { return addBlock(); }
    if (el = t.closest("[data-pv-delblock]")) { blocks.splice(n(el.dataset.pvDelblock), 1); save(); return render(); }
    if (t.closest("[data-pv-estimate]")) { return pushToEstimate(); }
    if (t.closest("[data-pv-clear]")) { return clearPool(); }
    // модалка цены
    if (el = t.closest("[data-pv-rowdb]")) { return openDbRow(n(el.dataset.pvRowdb)); }
    if (el = t.closest("[data-pv-dbpick]")) { return pickDbRow(el.dataset.pvDbpick); }
    if (t.closest("[data-pv-dbsave]")) { return saveManualPrice(); }
    if (t.closest("[data-pv-dbclose]")) { return closeDbModal(); }
  }
  function onInput(e) {
    const t = e.target; if (!t || !t.closest || !t.closest("#ep-pool-root")) return;
    if (t.matches("[data-pv-ceil]")) { settings.ceilingHeight = clampH(t.value); return save(); }
    if (t.matches("[data-pv-crown]")) { settings.crown = n(t.value, 68); return save(); }
    if (t.matches("[data-pv-hcustom]")) { if (t.value !== "") builder.height = clampH(t.value); return; }
    if (t.matches("[data-pv-shrink]")) { settings.shrinkCmPerJoint = n(t.value, 5); return save(); }
    if (t.matches("[data-pv-shrinktype]")) { settings.heatShrinkType = t.value; return save(); }
    if (t.matches("[data-pv-dps]")) { settings.dropsPerSocketJunction = Math.max(1, n(t.value, 2)); return save(); }
    if (t.matches("[data-pv-dpw]")) { settings.dropsPerSwitchJunction = Math.max(1, n(t.value, 2)); return save(); }
    if (t.matches("[data-pv-tpl]")) { const key = t.dataset.pvTpl, pin = t.dataset.pin; templates[key] = templates[key] || {}; const v = n(t.value, 0); if (v > 0) templates[key][pin] = v; else delete templates[key][pin]; return save(); }
    if (t.matches("[data-pv-dbsearch]")) { dbModal.q = t.value || ""; return updateDbList(); }
  }
  function onChange(e) {
    const t = e.target; if (!t || !t.closest || !t.closest("#ep-pool-root")) return;
    if (t.matches("[data-pv-ceil],[data-pv-crown],[data-pv-shrink],[data-pv-shrinktype],[data-pv-dps],[data-pv-dpw],[data-pv-tpl],[data-pv-hcustom]")) render();
  }

  function onToggle(e) { const d = e.target; if (d && d.dataset && d.dataset.fold && (d.dataset.fold in folds)) folds[d.dataset.fold] = !!d.open; }

  let bound = false;
  function bindOnce() { if (bound) return; bound = true; document.addEventListener("click", onClick); document.addEventListener("input", onInput); document.addEventListener("change", onChange); document.addEventListener("toggle", onToggle, true); }

  // ── API ──
  function open() { bindOnce(); load(); render(); }
  function close() { const o = document.getElementById("pv29-dbmodal"); if (o) o.remove(); }
  function buildDraft() { /* расчёт ленивый — ничего не нужно, draft() считает сам */ }
  function draft() { return draftItemsWithPrices(); }
  function state() { const m = (blocks[0] && blocks[0].material) || "Бетон"; return { wallMaterial: m, mode: settings.mode, ceilingHeight: settings.ceilingHeight }; }

  load();
  const api = { open, close, buildDraft, draft, state, version: VERSION, blocks: () => blocks.slice(), settings: () => Object.assign({}, settings) };
  window.EP = window.EP || {};
  window.EP.Pool = api;
  window.PoolV22CleanMonolith = api;  // алиас: монтаж/сборщик/расходка
})();
