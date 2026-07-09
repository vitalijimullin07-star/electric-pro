/* Electric Pro V29 — Логика расходников по кабелю/штробам (движок).
   EP.CableConsum: get/set конфиг (нормы) + calc(inputs) -> [{name, qty, unit}].
   Хранилище: ep_cable_consum_logic_v29. Все нормы редактируются на экране «Логика расходников». */
(() => {
  "use strict";
  const KEY = "ep_cable_consum_logic_v29";
  const n = (v, f = 0) => (Number.isFinite(Number(v)) ? Number(v) : f);

  const DEFAULTS = {
    // Прямой монтаж по потолку — на метр поверхностного кабеля (кабель − штроба)
    direct: { pads: 3, ties: 3, perM: 3 },            // площадки/стяжки/(гвоздь+выстрел) на метр
    // Гофра по потолку — на метр; каждая клипса = 1 гвоздь + 1 выстрел
    gofraCeil: { clips: 3 },
    // По полу — на метр полового кабеля; всегда гофра ПНД
    floor: { tapePerM: 0.6, tapeRollM: 20, perM: 4 },  // лента м/м, рулон, (гвоздь+выстрел)/м
    junction: { perBox: 4 },                           // распайка: 4 гвоздя + 4 выстрела
    gofraRoundM: 100,
    wetFactor: 1.5,  // ресурс дисков/коронок при резе с водой (×). 1 = как насухо
    packs: { nails: 1000, nailsTol: 200, shots: 1000, shotsTol: 200, ties: 100, pads: 100 },
    discs: { pair: 2 },
    drills: { d6: 2, d8: 3 },
    pikes: 1,
    pencil: 1,
    // Мешки: тв = бетон/кирпич/панель, мягкий = газоблок и т.п.
    trashBags: { hardStrobeM: 10, softStrobeM: 20, hardBox: 30, softBox: 50 },
    vacBags: { strobeM: 30, box: 40 },
    // Инструмент списком: коронки/диски, привязка к функции, ресурс по материалам. Диск — depth (под размер штробы).
    tools: [
      { id: "t76", kind: "crown", size: 76, fn: "podroz", life: { "Бетон": 15, "Кирпич": 40, "Панель": 12, "Мягкий": 120 } },
      { id: "t82", kind: "crown", size: 82, fn: "boxes",  life: { "Бетон": 12, "Кирпич": 30, "Панель": 10, "Мягкий": 90 } },
      { id: "t52", kind: "crown", size: 52, fn: "other",  life: { "Бетон": 20, "Кирпич": 50, "Панель": 16, "Мягкий": 150 } },
      { id: "d125", kind: "disc", size: 125, depth: "small", fn: "strobe", life: { "Бетон": 60,  "Кирпич": 120, "Панель": 50, "Мягкий": 300 } },
      { id: "d150", kind: "disc", size: 150, depth: "big",   fn: "strobe", life: { "Бетон": 50,  "Кирпич": 100, "Панель": 40, "Мягкий": 250 } }
    ],
    // Материалы: hard (мешки) + ресурс дисков (м/шт по размеру 125/150) + ресурс коронок (отв/шт по 52/76/82). Правишь сам.
    materials: {
      "Бетон":  { hard: true,  disc: { "125": 60,  "150": 50 },  crown: { "52": 20,  "76": 15,  "82": 12 } },
      "Кирпич": { hard: true,  disc: { "125": 120, "150": 100 }, crown: { "52": 50,  "76": 40,  "82": 30 } },
      "Панель": { hard: true,  disc: { "125": 50,  "150": 40 },  crown: { "52": 16,  "76": 12,  "82": 10 } },
      "Мягкий": { hard: false, disc: { "125": 300, "150": 250 }, crown: { "52": 150, "76": 120, "82": 90 } }
    }
  };

  function deepMerge(base, over) {
    const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
    if (!over || typeof over !== "object") return out;
    Object.keys(over).forEach(k => {
      if (over[k] && typeof over[k] === "object" && !Array.isArray(over[k]) && base[k] && typeof base[k] === "object") {
        out[k] = deepMerge(base[k], over[k]);
      } else {
        out[k] = over[k];
      }
    });
    return out;
  }

  function get() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) {}
    const cfg = deepMerge(DEFAULTS, saved);
    if (Array.isArray(saved.tools)) cfg.tools = saved.tools;
    Object.keys(cfg.materials || {}).forEach(m => {
      const o = cfg.materials[m]; if (!o) return;
      if (o.discM != null && !o.disc) o.disc = { "125": n(o.discM, 60), "150": Math.max(1, Math.round(n(o.discM, 60) * 0.85)) };
      if (o.coreN != null && !o.crown) o.crown = { "52": Math.round(n(o.coreN, 15) * 1.3), "76": n(o.coreN, 15), "82": Math.max(1, Math.round(n(o.coreN, 15) * 0.8)) };
      if (!o.disc) o.disc = { "125": 60, "150": 50 };
      if (!o.crown) o.crown = { "52": 20, "76": 15, "82": 12 };
    });
    return cfg;
  }
  function set(cfg) {
    try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) {}
  }
  function reset() {
    try { localStorage.removeItem(KEY); } catch (e) {}
  }
  function materials() { return ["Бетон", "Кирпич", "Панель", "Мягкий"]; }
  function defaults() { return JSON.parse(JSON.stringify(DEFAULTS)); }

  const FUNCTIONS = { podroz: "Подрозетники", boxes: "Распайки", strobe: "Штроба (диск)", shield: "Ниша щита", breezer: "Отверстие под бризер", sewer: "Канализация", other: "Иное" };

  const roundUpTo = (x, step) => (step > 0 ? Math.ceil(x / step) * step : Math.ceil(x));
  // Пачки гвоздей/выстрелов: до (pack+tol) — одна пачка, дальше +пачка
  const packCount = (count, pack, tol) => Math.max(1, Math.ceil((count - tol) / pack));

  // подбор инструмента (коронки) по Ø — точное совпадение, иначе ближайший по размеру
  function crownToolBySize(L, size) {
    const cr = (L.tools || []).filter(t => t && t.kind === "crown" && !t.off);
    if (!cr.length) return null;
    const exact = cr.find(t => n(t.size) === n(size));
    if (exact) return exact;
    return cr.slice().sort((a, b) => Math.abs(n(a.size) - n(size)) - Math.abs(n(b.size) - n(size)))[0];
  }
  function discToolByDepth(L, depth) {
    const ds = (L.tools || []).filter(t => t && t.kind === "disc" && !t.off);
    if (!ds.length) return null;
    return ds.find(t => t.depth === depth) || ds[0];
  }
  function podrozDefaultSize(L) { const t = (L.tools || []).find(x => x && x.fn === "podroz" && !x.off); return t ? n(t.size, 76) : 76; }
  function boxDefaultSize(L) { const t = (L.tools || []).find(x => x && x.fn === "boxes" && !x.off); return t ? n(t.size, 82) : 82; }

  // inputs: { mode:"single"|"mount"|"materials", cableM, strobeM, sockets, boxes, surface, gofra, material, depth, wet,
  //           matRows:[{material,sockets,strobeM}], crownPodroz, crownBox, shield, breezer, sewer, otherCounts }
  function calc(inp) {
    inp = inp || {};
    const L = get();
    const mode = inp.mode || "single";
    const cableM = n(inp.cableM), strobeM = n(inp.strobeM), sockets = n(inp.sockets), boxes = n(inp.boxes);
    // суммарно подрозетники/штроба (из matRows либо одиночных полей)
    const totalSockets = (inp.matRows && inp.matRows.length) ? inp.matRows.reduce((s, r) => s + n(r.sockets), 0) : sockets;
    const totalStrobe = (inp.matRows && inp.matRows.length) ? inp.matRows.reduce((s, r) => s + n(r.strobeM), 0) : strobeM;
    // поверхностный кабель = весь кабель − штроба (в штробе крепёж не нужен)
    const surfaceCable = Math.max(0, cableM - totalStrobe);
    const matName = inp.material && L.materials[inp.material] ? inp.material : materials()[0];
    const mat = L.materials[matName] || { hard: true };
    const wf = inp.wet ? n(L.wetFactor, 1.5) : 1;

    const items = [];
    const add = (name, qty, unit, wear) => { const q = Math.ceil(n(qty)); if (q > 0) { const it = { name, qty: q, unit: unit || "шт" }; if (wear != null) it.wear = wear; items.push(it); } };

    // ── MOUNT: крепёж кабеля + распайки + буры (один раз) ──
    if (mode === "mount" || mode === "single") {
      // гвозди/баллон/площадки/стяжки/гофра — ТОЛЬКО при поверхностном кабеле (нет кабеля → ничего этого)
      if (surfaceCable > 0) {
        const resMul = 1 + Math.max(0, n(inp.fastenerReserve)) / 100; // запас на крепёж (до округления)
        const sc = surfaceCable * resMul;
        let nails = 0, shots = 0;
        if (inp.surface === "floor") {
          add("Гофра ПНД", roundUpTo(sc, L.gofraRoundM), "м");
          add(`Лента монтажная (рулон ${L.floor.tapeRollM} м)`, Math.ceil(sc * n(L.floor.tapePerM) / n(L.floor.tapeRollM, 20)), "рулон");
          nails += sc * n(L.floor.perM); shots += sc * n(L.floor.perM);
        } else if (inp.gofra) {
          add("Гофра", roundUpTo(sc, L.gofraRoundM), "м");
          const clips = Math.ceil(sc * n(L.gofraCeil.clips));
          add("Клипсы для гофры", clips, "шт"); nails += clips; shots += clips;
        } else {
          add("Площадки под стяжку (прямой монтаж)", roundUpTo(sc * n(L.direct.pads), L.packs.pads), "шт");
          add("Стяжки кабельные", roundUpTo(sc * n(L.direct.ties), L.packs.ties), "шт");
          nails += sc * n(L.direct.perM); shots += sc * n(L.direct.perM);
        }
        nails += boxes * n(L.junction.perBox) * resMul; shots += boxes * n(L.junction.perBox) * resMul;
        nails = Math.ceil(nails); shots = Math.ceil(shots);
        if (nails > 0) add(`Гвозди для пистолета (упак. ${L.packs.nails})`, packCount(nails, n(L.packs.nails, 1000), n(L.packs.nailsTol)) * n(L.packs.nails, 1000), "шт");
        if (shots > 0) add(`Газовый баллон (≈${L.packs.shots} выстр.)`, packCount(shots, n(L.packs.shots, 1000), n(L.packs.shotsTol)), "баллон");
      }
      // буры/пика/карандаш — для сверления подрозетников и штробления (нужны и без кабеля)
      if (totalSockets > 0 || boxes > 0) { add("Бур 6 мм", L.drills.d6, "шт"); add("Бур 8 мм", L.drills.d8, "шт"); }
      if (totalSockets > 0 || totalStrobe > 0) { add("Пика", L.pikes, "шт"); add("Карандаш", L.pencil, "шт"); }
      // объектный инструмент (ниша щита / бризер / канализация / иное) — по счётчикам
      (L.tools || []).forEach(tool => {
        if (!tool || tool.off) return;
        if (tool.fn === "podroz" || tool.fn === "strobe" || tool.fn === "boxes") return; // эти — в materials
        const src = (tool.fn === "other") ? n((inp.otherCounts || {})[tool.id]) : n({ shield: inp.shield, breezer: inp.breezer, sewer: inp.sewer }[tool.fn]);
        const life = n(tool.life && tool.life[matName], 0) * wf;
        if (src <= 0 || life <= 0) return;
        const pair = (tool.kind === "disc") ? n(L.discs.pair, 2) : 1;
        add((tool.kind === "disc" ? "Диск " : "Коронка ") + tool.size + " мм" + (tool.work ? " (" + tool.work + ")" : ""), Math.ceil(src / life) * pair, "шт");
      });
    }

    // ── MATERIALS: коронки/диски/мешки по материалам (агрегация ДО округления, износ %) ──
    if (mode === "materials" || mode === "single") {
      const rows = (inp.matRows && inp.matRows.length) ? inp.matRows : [{ material: matName, sockets: sockets, strobeM: strobeM }];
      const crownP = n(inp.crownPodroz) || podrozDefaultSize(L);
      const crownB = n(inp.crownBox) || boxDefaultSize(L);
      const podrozCrown = crownToolBySize(L, crownP);
      const boxCrown = (boxes > 0) ? crownToolBySize(L, crownB) : null;
      // доминирующий материал для распаек (по числу подрозетников)
      let domMat = rows[0] ? rows[0].material : matName, domN = -1;
      rows.forEach(r => { if (n(r.sockets) > domN) { domN = n(r.sockets); domMat = r.material; } });
      // доли расхода коронок по материалам
      let fracP = 0;
      if (podrozCrown) rows.forEach(r => { const life = n(podrozCrown.life && podrozCrown.life[r.material], 0) * wf; if (n(r.sockets) > 0 && life > 0) fracP += n(r.sockets) / life; });
      let fracB = 0;
      if (boxCrown) { const life = n(boxCrown.life && boxCrown.life[domMat], 0) * wf; if (life > 0) fracB = boxes / life; }
      // вывод коронок (если Ø совпали — одна позиция)
      if (podrozCrown && boxCrown && n(podrozCrown.size) === n(boxCrown.size)) {
        const tot = fracP + fracB; if (tot > 0) add(`Коронка ${podrozCrown.size} мм`, Math.ceil(tot), "шт", tot / Math.ceil(tot));
      } else {
        if (podrozCrown && fracP > 0) add(`Коронка ${podrozCrown.size} мм`, Math.ceil(fracP), "шт", fracP / Math.ceil(fracP));
        if (boxCrown && fracB > 0) add(`Коронка ${boxCrown.size} мм`, Math.ceil(fracB), "шт", fracB / Math.ceil(fracB));
      }
      // диски штробы (агрегат по материалам)
      const discTool = discToolByDepth(L, inp.depth || "small");
      let fracD = 0;
      if (discTool) rows.forEach(r => { const life = n(discTool.life && discTool.life[r.material], 0) * wf; if (n(r.strobeM) > 0 && life > 0) fracD += n(r.strobeM) / life; });
      if (discTool && fracD > 0) add(`Диск ${discTool.size} мм`, Math.ceil(fracD) * n(L.discs.pair, 2), "шт", fracD / Math.ceil(fracD));
      // мешки (агрегат по материалам)
      let trash = 0, vac = 0;
      rows.forEach(r => { const mc = L.materials[r.material] || { hard: true }; trash += n(r.strobeM) / (mc.hard ? n(L.trashBags.hardStrobeM, 10) : n(L.trashBags.softStrobeM, 20)) + n(r.sockets) / (mc.hard ? n(L.trashBags.hardBox, 30) : n(L.trashBags.softBox, 50)); vac += n(r.strobeM) / n(L.vacBags.strobeM, 30) + n(r.sockets) / n(L.vacBags.box, 40); });
      if (trash > 0) add("Мешки для строительного мусора", Math.ceil(trash), "шт");
      if (vac > 0) add("Мешки для пылесоса", Math.ceil(vac), "шт");
    }

    return items;
  }

  window.EP = window.EP || {};
  window.EP.CableConsum = { get, set, reset, calc, materials, defaults, functions: () => FUNCTIONS, KEY };
})();
