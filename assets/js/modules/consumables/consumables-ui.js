/* Electric Pro V29 — Расходники: калькулятор (разбивка по материалам) + редактор инструментов (привязка к функции; «иное» — к работе). */
(() => {
  "use strict";
  const UIKEY = "ep_consum_ui_v29";
  const n = (v, f = 0) => (Number.isFinite(Number(v)) ? Number(v) : f);
  const esc = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
  const getP = (o, p) => p.split(".").reduce((a, k) => (a && a[k] != null ? a[k] : undefined), o);
  function setP(o, p, val) { const ks = p.split("."); let a = o; for (let i = 0; i < ks.length - 1; i++) { if (typeof a[ks[i]] !== "object" || a[ks[i]] == null) a[ks[i]] = {}; a = a[ks[i]]; } a[ks[ks.length - 1]] = val; }

  const DEF_UI = { surface: "ceil", gofra: false, depth: "small", wet: false, podrozTool: "", cableM: 0, boxes: 0, shield: 0, breezer: 0, sewer: 0, otherCounts: {}, matRows: [], material: "", logicOpen: false, fastenerReserve: 0 };
  let ui = null, lastItems = [];

  function CC() { return window.EP && window.EP.CableConsum ? window.EP.CableConsum : null; }
  function Draft() { return window.EP && window.EP.EstimateDraft ? window.EP.EstimateDraft : null; }
  function loadUI() { let s = {}; try { s = JSON.parse(localStorage.getItem(UIKEY) || "{}") || {}; } catch (e) {} ui = Object.assign({}, DEF_UI, s); if (!ui.otherCounts) ui.otherCounts = {}; if (!Array.isArray(ui.matRows)) ui.matRows = []; if (!ui._cm2) { ui.cableM = 0; ui._cm2 = 1; try { localStorage.setItem(UIKEY, JSON.stringify(ui)); } catch (e) {} } }
  function saveUI() { try { localStorage.setItem(UIKEY, JSON.stringify(ui)); } catch (e) {} }

  function cableFromEstimate() {
    try {
      const d = Draft(); if (!d || !d.getItems) return 0;
      // настоящий кабель/провод, но НЕ "стяжки кабельные", НЕ "кабель-канал", НЕ позиции самой расходки
      const re = /(кабель|провод|ввгнг|ввг|nym|пвс|шввп|кввг|сип|ппв|пунп)/i;
      const bad = /стяжк|канал|лоток|хомут|площадк|короб/i;
      let m = 0;
      d.getItems().forEach(it => { if (it.source === "consum") return; const nm = it.name || ""; if (re.test(nm) && !bad.test(nm)) m += n(it.qty); });
      return Math.round(m);
    } catch (e) { return 0; }
  }
  // эффективный кабель: ручной ввод приоритетнее, иначе — из добавленного в смету кабеля
  function effCable() { const man = n(ui.cableM); return man > 0 ? man : cableFromEstimate(); }
  function poolState() { try { const P = window.PoolV22CleanMonolith; return P && P.state ? P.state() : null; } catch (e) { return null; } }
  function poolMaterial() { const st = poolState(); return st && st.wallMaterial ? st.wallMaterial : ""; }
  function poolDraft() { try { const P = window.PoolV22CleanMonolith; if (!P || !P.draft) return []; if (P.buildDraft) P.buildDraft(); return P.draft() || []; } catch (e) { return []; } }
  function poolStrobe() { let m = 0; poolDraft().forEach(r => { if (/штроблен/i.test(r.name || "")) m += n(r.qty); }); return Math.round(m); }
  function poolPodroz() { let c = 0; poolDraft().forEach(r => { if (r.type === "material" && /подрозетник/i.test(r.name || "")) c += n(r.qty); }); return c; }
  function poolBoxes() { let c = 0; poolDraft().forEach(r => { if (r.type === "material" && /распа.{0,3}ч|распайк/i.test(r.name || "")) c += n(r.qty); }); return c; }
  const MAT_BY_LOWER = { "бетон": "Бетон", "кирпич": "Кирпич", "панель": "Панель", "мягкий": "Мягкий" };
  function lastMat(name) { const w = String(name || "").trim().split(/\s+/).pop().toLowerCase(); return MAT_BY_LOWER[w] || ""; }
  function poolStrobeByMat() { const m = {}; poolDraft().forEach(r => { if (/штроблен/i.test(r.name || "")) { const mat = lastMat(r.name); if (mat) m[mat] = (m[mat] || 0) + n(r.qty); } }); return m; }
  function poolPodrozByMat() { const m = {}; poolDraft().forEach(r => { if (r.type === "work" && /высверливан.*подрозетник/i.test(r.name || "")) { const mat = lastMat(r.name); if (mat) m[mat] = (m[mat] || 0) + n(r.qty); } }); return m; }
  function pullFromPool() {
    const sM = poolStrobeByMat(), pM = poolPodrozByMat();
    const set = {}; Object.keys(sM).forEach(m => set[m] = 1); Object.keys(pM).forEach(m => set[m] = 1);
    const rows = Object.keys(set).map(m => ({ material: m, sockets: pM[m] || 0, strobeM: Math.round(sM[m] || 0) }));
    if (rows.length) ui.matRows = rows;
    ui.boxes = poolBoxes();
  }
  function worksList() {
    const set = {};
    try { const d = Draft(); if (d && d.getItems) d.getItems().forEach(it => { if (it.type === "work" && it.name) set[it.name] = 1; }); } catch (e) {}
    try { const m = window.EP && window.EP.Estimate; if (m && m.getItems) m.getItems().forEach(it => { if (it.type === "work" && it.name) set[it.name] = 1; }); } catch (e) {}
    try { poolDraft().forEach(r => { if (r.type === "work" && r.name) set[r.name] = 1; }); } catch (e) {}
    return Object.keys(set);
  }
  function mergeItems(a, b) { (b || []).forEach(it => { const e = a.find(x => x.name === it.name); if (e) { e.qty += it.qty; if (it.wear != null) e.wear = it.wear; } else a.push({ name: it.name, qty: it.qty, unit: it.unit, wear: it.wear }); }); return a; }

  function seg(label, opts, attr, cur) {
    return `<div class="ep-cs-field"><span class="ep-cs-lab">${label}</span><div class="ep-cs-seg">` +
      opts.map(([v, t]) => `<button type="button" data-${attr}="${v}" class="${cur === v ? "active" : ""}">${t}</button>`).join("") + `</div></div>`;
  }
  function num(label, key, val, unit) {
    return `<div class="ep-cs-field"><span class="ep-cs-lab">${label}${unit ? ` <i>${unit}</i>` : ""}</span><input class="ep-cs-num" type="number" inputmode="decimal" min="0" data-cs-num="${key}" value="${n(val)}" /></div>`;
  }
  function cfg(L, label, path, unit) {
    return `<label class="ep-cs-cfg"><span>${label}${unit ? ` <i>${unit}</i>` : ""}</span><input type="number" min="0" step="any" data-cfg="${path}" value="${n(getP(L, path))}" /></label>`;
  }

  function ensureRows(mats) {
    if (!ui.matRows.length) ui.matRows = [{ material: poolMaterial() || mats[0] || "Бетон", sockets: poolPodroz(), strobeM: poolStrobe() }];
  }

  function render() {
    const root = document.getElementById("ep-consum-root"); if (!root) return;
    const cc = CC(); if (!cc) { root.innerHTML = `<div class="card"><p>Движок расходников не загружен.</p></div>`; return; }
    const mats = cc.materials();
    const FN = cc.functions();
    const L = cc.get();
    ensureRows(mats);
    const podrozTools = (L.tools || []).filter(t => t && t.fn === "podroz" && !t.off);
    const effPodroz = (ui.podrozTool && podrozTools.some(t => t.id === ui.podrozTool)) ? ui.podrozTool : (podrozTools[0] ? podrozTools[0].id : "");
    const podrozSel = podrozTools.length > 1
      ? `<div class="ep-cs-field"><span class="ep-cs-lab">Подрозетник Ø (коронка)</span><div class="ep-cs-seg">${podrozTools.map(t => `<button type="button" data-cs-podroz="${t.id}" class="${effPodroz === t.id ? "active" : ""}">${n(t.size)} мм</button>`).join("")}</div></div>`
      : "";
    const works = worksList();
    const worksOpts = works.map(w => `<option value="${esc(w)}">`).join("");

    // таблица материалов
    const matTable = ui.matRows.map((r, i) => `
      <div class="ep-cs-mrow">
        <select class="ep-cs-mrowsel" data-mrow-mat="${i}">${mats.map(m => `<option value="${esc(m)}" ${r.material === m ? "selected" : ""}>${esc(m)}</option>`).join("")}</select>
        <label>подроз.<input type="number" min="0" data-mrow-sockets="${i}" value="${n(r.sockets)}" /></label>
        <label>штроба<input type="number" min="0" data-mrow-strobe="${i}" value="${n(r.strobeM)}" /></label>
        ${ui.matRows.length > 1 ? `<button type="button" class="ep-cs-mrowdel" data-mrow-del="${i}">✕</button>` : ""}
      </div>`).join("");

    // доп. отверстия: общие (ниша/бризер/канализация) + по «иному» инструменту
    const manualLabels = { shield: "Ниши щита", breezer: "Бризеры", sewer: "Канализация" };
    const parts = [];
    ["shield", "breezer", "sewer"].forEach(f => { if ((L.tools || []).some(t => t && t.fn === f && !t.off)) parts.push(`<label class="ep-cs-cfg"><span>${manualLabels[f]}</span><input type="number" min="0" data-cs-num="${f}" value="${n(ui[f])}" /></label>`); });
    (L.tools || []).filter(t => t && t.fn === "other" && !t.off).forEach(t => { parts.push(`<label class="ep-cs-cfg"><span>${esc(t.work || ("Иное " + t.size + "мм"))}</span><input type="number" min="0" data-other-count="${t.id}" value="${n(ui.otherCounts[t.id])}" /></label>`); });
    const manualBlock = parts.length ? `<div class="ep-cs-field"><span class="ep-cs-lab">Доп. отверстия (для коронок)</span><div class="ep-cs-grid">${parts.join("")}</div></div>` : "";

    const result = lastItems.length
      ? `<div class="ep-cs-result"><div class="ep-cs-rhead">Расходка (${lastItems.length} поз.) — в предварительной ✓</div>` +
        lastItems.map(it => `<div class="ep-cs-row"><span>${esc(it.name)}${it.wear != null ? ` <i class="ep-cs-wear">износ ~${Math.round(it.wear * 100)}%${it.wear <= 1 ? ", хватает" : ""}</i>` : ""}</span><b>${it.qty} ${esc(it.unit)}</b></div>`).join("") + `</div>`
      : `<div class="ep-cs-hint">Параметры подтянуты из пула. Нажми «Рассчитать и добавить».</div>`;

    // редактор инструментов
    const fnOpts = (cur) => Object.keys(FN).map(k => `<option value="${k}" ${cur === k ? "selected" : ""}>${esc(FN[k])}</option>`).join("");
    const toolRows = (L.tools || []).map(t => {
      const lifeInputs = mats.map(m => `<label>${esc(m).slice(0, 4)}<input type="number" min="0" data-tool-life="${t.id}|${m}" value="${n(t.life && t.life[m])}" /></label>`).join("");
      return `<div class="ep-cs-tool">
        <div class="ep-cs-ttop">
          <b>${t.kind === "disc" ? "Диск" : "Коронка"}</b>
          <input class="ep-cs-tsize" type="number" min="0" data-tool-size="${t.id}" value="${n(t.size)}" /><span class="ep-cs-mm">мм</span>
          <select class="ep-cs-tfn" data-tool-fn="${t.id}">${fnOpts(t.fn)}</select>
          ${t.kind === "disc" ? `<select class="ep-cs-tdepth" data-tool-depth="${t.id}"><option value="small" ${t.depth === "small" ? "selected" : ""}>≤30</option><option value="big" ${t.depth === "big" ? "selected" : ""}>30–55</option></select>` : ""}
          <button type="button" class="ep-cs-tdel" data-tool-del="${t.id}">✕</button>
        </div>
        ${t.fn === "other" ? `<div class="ep-cs-twork"><span>работа:</span><input list="ep-cs-works" data-tool-work="${t.id}" value="${esc(t.work || "")}" placeholder="выбери или впиши" /></div>` : ""}
        <div class="ep-cs-tlife"><span>ресурс${t.kind === "disc" ? " (м/шт, ×2)" : " (отв/шт)"}:</span>${lifeInputs}</div>
      </div>`;
    }).join("");

    const matHard = mats.map(m => { const o = (L.materials && L.materials[m]) || {}; return `<button type="button" class="ep-cs-hard ${o.hard ? "active" : ""}" data-cs-hard="${esc(m)}">${esc(m)}: ${o.hard ? "твёрдый" : "мягкий"}</button>`; }).join("");

    root.innerHTML = `
      <div class="ep-cs-shell">
        <datalist id="ep-cs-works">${worksOpts}</datalist>
        <section class="card ep-cs-card">
          ${seg("Поверхность", [["ceil", "Потолок"], ["floor", "Пол"]], "cs-surface", ui.surface)}
          ${ui.surface === "ceil" ? seg("Гофра", [["0", "Нет"], ["1", "Да"]], "cs-gofra", ui.gofra ? "1" : "0") : `<div class="ep-cs-note">По полу — всегда гофра ПНД, лента, без клипс.</div>`}
          ${seg("Размер штробы (диск)", [["small", "≤30 → 125"], ["big", "30–55 → 150"]], "cs-depth", ui.depth)}
          ${seg("Рез", [["0", "Насухо"], ["1", "С водой"]], "cs-wet", ui.wet ? "1" : "0")}
          ${podrozSel}
        </section>

        <section class="card ep-cs-card">
          ${num("Кабель (всего), ручной ввод", "cableM", ui.cableM, "м")}
          <div class="ep-cs-cable-hint">${cableFromEstimate() > 0 ? `В смете кабеля: ${cableFromEstimate()} м${n(ui.cableM) > 0 ? " (перекрыт ручным вводом выше)" : " — крепёж считается от него"}` : "Кабеля в смете нет. Крепёж (площадки/стяжки/гвозди) не считается, пока не добавишь кабель в смету или не впишешь метры вручную."}</div>
          ${num("Распайки", "boxes", ui.boxes, "шт")}
          <div class="ep-cs-field"><span class="ep-cs-lab">Подрозетники и штроба по материалам <span class="ep-cs-frompool">материал 1 — из пула</span></span>
            <div class="ep-cs-mtable">${matTable}</div>
            <button type="button" class="ep-cs-madd" data-mrow-add>+ материал</button>
          </div>
          ${manualBlock}
          <div class="ep-cs-pulls">
            <button type="button" class="ep-cs-pull" data-cs-pull-cable>⤵ Кабель из материалов</button>
            <button type="button" class="ep-cs-pull" data-cs-pull-pool>⤵ Из пула (в строку 1)</button>
          </div>
          <button type="button" class="btn btn-primary ep-clickable ep-cs-calc" data-cs-calcadd>✅ Рассчитать и добавить</button>
        </section>

        ${result}

        <section class="card ep-cs-card">
          <button type="button" class="ep-cs-logic-toggle" data-cs-logic-toggle>${ui.logicOpen ? "▾" : "▸"} ⚙ Логика расходников</button>
          <div class="ep-cs-logic ${ui.logicOpen ? "" : "hidden"}">
            <div class="ep-cs-sub">Инструмент — коронки и диски (привязка к функции)</div>
            ${toolRows}
            <div class="ep-cs-tadd"><button type="button" data-tool-add="crown">+ коронка</button><button type="button" data-tool-add="disc">+ диск</button></div>

            <div class="ep-cs-sub">Материалы — мешки (твёрдый/мягкий)</div>
            <div class="ep-cs-hardrow">${matHard}</div>

            <div class="ep-cs-sub">Крепёж (на метр кабеля)</div>
            <div class="ep-cs-grid">
              ${cfg(L, "Площадки/м", "direct.pads")}${cfg(L, "Стяжки/м", "direct.ties")}
              ${cfg(L, "Прямой: гв+выстр /м", "direct.perM")}${cfg(L, "Гофра: клипсы /м", "gofraCeil.clips")}
              ${cfg(L, "Пол: гв+выстр /м", "floor.perM")}${cfg(L, "Пол: лента /м", "floor.tapePerM", "м")}
              ${cfg(L, "Лента: рулон", "floor.tapeRollM", "м")}${cfg(L, "Распайка: гв+выстр", "junction.perBox")}
            </div>
            <div class="ep-cs-sub">Упаковки</div>
            <div class="ep-cs-grid">
              ${cfg(L, "Гвозди: пачка", "packs.nails")}${cfg(L, "Гвозди: допуск", "packs.nailsTol")}
              ${cfg(L, "Выстрелы: баллон", "packs.shots")}${cfg(L, "Выстрелы: допуск", "packs.shotsTol")}
              ${cfg(L, "Стяжки: пачка", "packs.ties")}${cfg(L, "Площадки: пачка", "packs.pads")}
              ${cfg(L, "Гофра: округл.", "gofraRoundM", "м")}${cfg(L, "Рез с водой: ресурс ×", "wetFactor")}
            </div>
            <div class="ep-cs-sub">Мешки</div>
            <div class="ep-cs-grid">
              ${cfg(L, "Мусор: штроба тв.", "trashBags.hardStrobeM", "м")}${cfg(L, "Мусор: штроба мягк.", "trashBags.softStrobeM", "м")}
              ${cfg(L, "Мусор: подроз. тв.", "trashBags.hardBox", "шт")}${cfg(L, "Мусор: подроз. мягк.", "trashBags.softBox", "шт")}
              ${cfg(L, "Пылесос: штроба", "vacBags.strobeM", "м")}${cfg(L, "Пылесос: подроз.", "vacBags.box", "шт")}
            </div>
            <div class="ep-cs-sub">Прочее (фикс на объект)</div>
            <div class="ep-cs-grid">
              ${cfg(L, "Бур 6 мм", "drills.d6")}${cfg(L, "Бур 8 мм", "drills.d8")}
              ${cfg(L, "Пика", "pikes")}${cfg(L, "Карандаш", "pencil")}
            </div>
            <div class="ep-cs-logic-actions"><button type="button" class="ep-cs-reset" data-cs-reset>Сбросить все нормы к стандарту</button></div>
          </div>
        </section>
      </div>`;
  }

  // Ø коронки подрозетников из пула (парсим "Подрозетник Ø82 ...")
  function poolCrownSize() { let sz = 0; poolDraft().forEach(r => { if (/подрозетник/i.test(r.name || "")) { const m = String(r.name).match(/Ø\s*(\d{2,3})/); if (m) sz = n(m[1]); } }); return sz; }

  function computeItems() {
    const cc = CC(); if (!cc) { lastItems = []; return; }
    const mats = cc.materials();
    let rows = (ui.matRows || []).filter(r => r && r.material && (n(r.sockets) || n(r.strobeM)));
    if (!rows.length) rows = [{ material: (ui.matRows[0] && ui.matRows[0].material) || mats[0], sockets: 0, strobeM: 0 }];
    const crownP = poolCrownSize();
    // крепёж/буры (один раз) + коронки/диски/мешки по материалам (агрегировано)
    let items = cc.calc({ mode: "mount", cableM: effCable(), boxes: ui.boxes, surface: ui.surface, gofra: !!ui.gofra, depth: ui.depth, wet: !!ui.wet, shield: ui.shield, breezer: ui.breezer, sewer: ui.sewer, otherCounts: ui.otherCounts, matRows: rows, fastenerReserve: n(ui.fastenerReserve) });
    items = mergeItems(items, cc.calc({ mode: "materials", matRows: rows, boxes: ui.boxes, depth: ui.depth, wet: !!ui.wet, crownPodroz: crownP, crownBox: n(ui.crownBox) }));
    lastItems = items;
  }
  function pushToEstimate() {
    const d = Draft(); if (!d || !lastItems.length) return false;
    const list = lastItems.map((it, i) => ({ id: "consum_" + i, sourceId: "consum_" + i, type: "material", name: it.name, unit: it.unit || "шт", price: 0, qty: n(it.qty, 1), base: "consum", source: "consum" }));
    if (d.setSourceItems) d.setSourceItems("consum", list); else list.forEach(x => d.addItem && d.addItem(x));
    return true;
  }
  function doCalcAdd() { computeItems(); pushToEstimate(); render(); }
  // Быстрый расчёт с главной: подтянуть всё из пула/материалов, посчитать и добавить за один тап
  function quickCalc() {
    const cc = CC(), d = Draft(); if (!cc || !d) return 0;
    loadUI();
    pullFromPool();
    saveUI();
    computeItems();
    pushToEstimate();
    return lastItems.length;
  }
  function saveCfg(path, value) { const cc = CC(); if (!cc) return; const L = cc.get(); setP(L, path, Math.max(0, n(value))); cc.set(L); }
  function toggleHard(name) { const cc = CC(); if (!cc) return; const L = cc.get(); if (!L.materials[name]) L.materials[name] = {}; L.materials[name].hard = !L.materials[name].hard; cc.set(L); render(); }

  function tools() { const cc = CC(); return cc ? (cc.get().tools || []) : []; }
  function saveTools(arr) { const cc = CC(); if (!cc) return; const L = cc.get(); L.tools = arr; cc.set(L); }
  function patchTool(id, fn) { const arr = tools().slice(); const i = arr.findIndex(t => t && t.id === id); if (i < 0) return; arr[i] = Object.assign({}, arr[i]); fn(arr[i]); saveTools(arr); }
  function addTool(kind) {
    const arr = tools().slice();
    const id = (kind === "disc" ? "d" : "t") + Date.now().toString(36);
    const life = {}; CC().materials().forEach(m => life[m] = kind === "disc" ? 60 : 15);
    arr.push(kind === "disc" ? { id, kind: "disc", size: 125, depth: "small", fn: "strobe", life } : { id, kind: "crown", size: 68, fn: "podroz", life });
    saveTools(arr); render();
  }
  function delTool(id) { saveTools(tools().filter(t => t && t.id !== id)); render(); }

  function onClick(e) {
    const t = e.target; if (!t || !t.closest) return;
    const quick = t.closest("[data-consum-quick]");
    if (quick) { const cnt = quickCalc(); quick.textContent = "✓ Добавлено: " + cnt + " поз."; setTimeout(() => { quick.textContent = "🧮 Рассчитать расходку"; }, 1800); return; }
    if (!t.closest("#ep-consum-root")) return;
    let el;
    if (el = t.closest("[data-cs-surface]")) { ui.surface = el.dataset.csSurface; if (ui.surface === "floor") ui.gofra = true; saveUI(); render(); return; }
    if (el = t.closest("[data-cs-gofra]")) { ui.gofra = el.dataset.csGofra === "1"; saveUI(); render(); return; }
    if (el = t.closest("[data-cs-depth]")) { ui.depth = el.dataset.csDepth; saveUI(); render(); return; }
    if (el = t.closest("[data-cs-wet]")) { ui.wet = el.dataset.csWet === "1"; saveUI(); render(); return; }
    if (el = t.closest("[data-cs-podroz]")) { ui.podrozTool = el.dataset.csPodroz; saveUI(); render(); return; }
    if (t.closest("[data-cs-calcadd]")) { doCalcAdd(); return; }
    if (t.closest("[data-cs-pull-cable]")) { ui.cableM = cableFromEstimate(); saveUI(); render(); return; }
    if (t.closest("[data-cs-pull-pool]")) { pullFromPool(); saveUI(); render(); return; }
    if (t.closest("[data-mrow-add]")) { ui.matRows.push({ material: CC().materials()[0], sockets: 0, strobeM: 0 }); saveUI(); render(); return; }
    if (el = t.closest("[data-mrow-del]")) { ui.matRows.splice(n(el.dataset.mrowDel), 1); saveUI(); render(); return; }
    if (t.closest("[data-cs-logic-toggle]")) { ui.logicOpen = !ui.logicOpen; saveUI(); render(); return; }
    if (el = t.closest("[data-cs-hard]")) { toggleHard(el.dataset.csHard); return; }
    if (el = t.closest("[data-tool-add]")) { addTool(el.dataset.toolAdd); return; }
    if (el = t.closest("[data-tool-del]")) { delTool(el.dataset.toolDel); return; }
    if (t.closest("[data-cs-reset]")) { const cc = CC(); if (cc) { cc.reset(); render(); } return; }
  }
  function onChange(e) {
    const t = e.target; if (!t || !t.closest || !t.closest("#ep-consum-root")) return;
    const d = t.dataset || {};
    if (d.csNum) { ui[d.csNum] = Math.max(0, n(t.value)); saveUI(); return; }
    if (d.otherCount) { ui.otherCounts[d.otherCount] = Math.max(0, n(t.value)); saveUI(); return; }
    if (d.mrowMat != null) { const i = n(d.mrowMat); if (ui.matRows[i]) ui.matRows[i].material = t.value; saveUI(); return; }
    if (d.mrowSockets != null) { const i = n(d.mrowSockets); if (ui.matRows[i]) ui.matRows[i].sockets = Math.max(0, n(t.value)); saveUI(); return; }
    if (d.mrowStrobe != null) { const i = n(d.mrowStrobe); if (ui.matRows[i]) ui.matRows[i].strobeM = Math.max(0, n(t.value)); saveUI(); return; }
    if (d.cfg) { saveCfg(d.cfg, t.value); return; }
    if (d.toolSize) { patchTool(d.toolSize, tt => tt.size = Math.max(0, n(t.value))); return; }
    if (d.toolFn) { patchTool(d.toolFn, tt => tt.fn = t.value); render(); return; }
    if (d.toolDepth) { patchTool(d.toolDepth, tt => tt.depth = t.value); return; }
    if (d.toolWork) { patchTool(d.toolWork, tt => tt.work = t.value); return; }
    if (d.toolLife) { const [id, m] = d.toolLife.split("|"); patchTool(id, tt => { tt.life = Object.assign({}, tt.life); tt.life[m] = Math.max(0, n(t.value)); }); return; }
  }

  document.addEventListener("click", onClick);
  document.addEventListener("change", onChange);
  window.addEventListener("ep:route-loaded", (e) => {
    if (!e || !e.detail || e.detail.route !== "consumables") return;
    loadUI();
    if (!ui.matRows.length) pullFromPool();
    if (!ui.boxes) ui.boxes = poolBoxes();
    lastItems = [];
    setTimeout(render, 30);
  });

  window.EP = window.EP || {};
  // запас на крепёж — управляется из предварительной, применяется в расчёте крепежа
  function getReserve() { try { const s = JSON.parse(localStorage.getItem(UIKEY) || "{}"); return Math.max(0, n(s.fastenerReserve)); } catch (e) { return 0; } }
  function setReserve(pct) {
    loadUI(); ui.fastenerReserve = Math.max(0, n(pct)); saveUI();
    // пересчитать только из текущего состояния (без повторного подтягивания из пула), обновить крепёж в смете
    computeItems(); pushToEstimate();
    if (document.getElementById("ep-consum-root")) render();
  }
  window.EP.ConsumablesUI = { render, calc: doCalcAdd, quickCalc, getReserve, setReserve };
})();
