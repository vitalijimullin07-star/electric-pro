/* ============================================================
   Electric Pro — POOL ENGINE V29 (чистый расчёт, без DOM)
   Вход: блоки (комнаты/рамки) + глобальные настройки.
   Выход: штробы/подрозетники/распайки/кабель по материалам + позиции черновика.
   Коннекторы (ваго/гильзы) добавляются отдельным модулем поверх.
   ============================================================ */
(function () {
  "use strict";

  // ── материалы: нижний регистр = последнее слово в имени (для расходки) ──
  const MAT_LOWER = { "Бетон": "бетон", "Панель": "панель", "Мягкий": "мягкий", "Кирпич": "кирпич" };
  const matLower = m => MAT_LOWER[m] || String(m || "").toLowerCase();

  // ── редактируемые дефолты (логика) ──
  const DEFAULTS = {
    ceilingHeight: 270,          // см, общее на квартиру
    mode: "junction",            // "junction"=в распайках | "boxes"=в подрозетниках
    shape: "round",              // дефолтный кабель: "round"|"flat"
    crown: 68,                   // Ø коронки подрозетника, мм
    depth: { std: 45, deep: 65 },// глубины подрозетника, мм
    // ёмкость штробы: сколько кабелей влезает (по размеру × форма × сечение)
    capacity: {
      "25x30": { round: { "2.5": 2, "1.5": 3 }, flat: { "2.5": 3, "1.5": 4 } },
      "30x30": { round: { "2.5": 3, "1.5": 4 }, flat: { "2.5": 4, "1.5": 5 } }
    },
    sizeRegular: "25x30",        // обычная штроба
    sizeWarm: "50x50",           // штроба тёплого пола
    lvSize: "25x30",             // штроба слаботочки
    socketGauge: "2.5",          // розетки 3×2.5
    lightGauge: "1.5",           // свет 3×1.5
    // ── коннекторы (как в старом пуле) ──
    connectorMode: "gml",        // "wago" | "gml" | "siz"
    dropsPerSocketJunction: 2,   // спусков на 1 розеточную распайку (для расчёта соединений)
    dropsPerSwitchJunction: 2,
    shrinkCmPerJoint: 5,         // термоусадка на стык, см (ГМЛ/СИЗ)
    heatShrinkType: "12/4",
    // шаблоны: сколько соединений (по числу проводов) даёт механизм
    templates: {
      switch_1: { pin2: 4 },
      switch_2: { pin2: 3, pin4: 2 },
      switch_3: { pin2: 4, pin4: 2 },
      pass_1: { pin2: 6 },
      pass_2: { pin2: 8, pin4: 1 },
      cross_1: { pin2: 9 },
      cross_2: { pin2: 15, pin3: 1 }
    }
  };

  const n = (v, d = 0) => { const x = Number(v); return Number.isFinite(x) ? x : d; };
  const ceil = x => Math.ceil(x - 1e-9);
  const round1 = x => Math.round(x * 10) / 10;

  // ── сколько КАБЕЛЕЙ даёт каждый механизм блока ──
  // (режим распаек; в подрозетниках длина потом ×2)
  function cablesOfBlock(b) {
    const sockets = n(b.sockets);
    const sw = n(b.sw1) + n(b.sw2) + n(b.sw3);           // выключатели по клавишам
    // 1-2 кл = 1 кабель, 3 кл = 2 кабеля
    const swCables = n(b.sw1) * 1 + n(b.sw2) * 1 + n(b.sw3) * 2;
    const pass = n(b.pass), passKeys = Math.max(1, n(b.passKeys, 1));
    const cross = n(b.cross), crossKeys = Math.max(1, n(b.crossKeys, 1));
    // проходной/перекрёстный = 2 кабеля × клавиши
    const passCables = pass * 2 * passKeys;
    const crossCables = cross * 2 * crossKeys;
    const lightCables = swCables + passCables + crossCables;    // 3×1.5
    const socketCables = (sockets > 0 || b.dedicated) ? 1 : 0;   // 1 кабель на блок розеток / отдельную линию
    const lv = n(b.tv) + n(b.internet);                          // слаботочка
    return { socketCables, lightCables, lvCables: lv, sw, pass, cross };
  }

  // ── подрозетники блока по глубине ──
  function podrozOfBlock(b, mode) {
    const deep = n(b.sw1) + n(b.sw2) + n(b.sw3) + n(b.pass) + n(b.cross) + n(b.warmFloor); // выкл+проходные+перекр+тёплый пол = 65
    const socketsDeep = mode === "boxes" ? n(b.sockets) : 0;    // розетки 65 только в подрозетниках
    const std = (mode === "boxes" ? 0 : n(b.sockets)) + n(b.tv) + n(b.internet) + (b.dedicated ? 1 : 0);
    return { deep: deep + socketsDeep, std };
  }

  // ── КОННЕКТОРЫ (ваго/гильзы/СИЗ + термоусадка) — перенос со старого пула ──
  function connMatName(key) {
    const map = {
      pin2: "ВАГО 2-пин", pin3: "ВАГО 3-пин", pin4: "ВАГО 4-пин", pin5: "ВАГО 5-пин",
      pin6: "ВАГО 6-пин", pin8: "ВАГО 8-пин", pin10: "ВАГО 10-пин",
      gml4: "ГМЛ 4", gml6: "ГМЛ 6", gml8: "ГМЛ 8", gml10: "ГМЛ 10",
      siz2: "СИЗ на 2 провода", siz3: "СИЗ на 3 провода", siz4: "СИЗ на 4 провода",
      siz5: "СИЗ на 5 проводов", siz6: "СИЗ на 6 проводов", siz8: "СИЗ на 8 проводов", siz10: "СИЗ на 10 проводов"
    };
    return map[key] || key;
  }
  function sleeveByWires(w) { w = n(w); if (w <= 4) return "gml4"; if (w <= 6) return "gml6"; if (w <= 8) return "gml8"; return "gml10"; }

  function connectors(blocks, cfg, mode) {
    const tpl = cfg.templates || DEFAULTS.templates;
    const addMap = (m, k, q) => { q = n(q); if (q > 0) m[k] = (m[k] || 0) + q; };
    const applyTpl = (pm, key, mult) => { const t = tpl[key] || {}; Object.keys(t).forEach(pin => { if (/^pin\d+$/.test(pin)) addMap(pm, pin, n(t[pin]) * mult); }); };

    const pinMap = {};
    let socketDrops = 0, switchDrops = 0;
    blocks.forEach(b => {
      const sockets = n(b.sockets), pass = n(b.pass), cross = n(b.cross);
      const passKeys = Math.max(1, n(b.passKeys, 1)), crossKeys = Math.max(1, n(b.crossKeys, 1));
      // выключатели по клавишам
      applyTpl(pinMap, "switch_1", n(b.sw1));
      applyTpl(pinMap, "switch_2", n(b.sw2));
      applyTpl(pinMap, "switch_3", n(b.sw3));
      if (pass > 0) applyTpl(pinMap, passKeys >= 2 ? "pass_2" : "pass_1", pass);
      if (cross > 0) applyTpl(pinMap, crossKeys >= 2 ? "cross_2" : "cross_1", cross);
      if (sockets > 0) {
        if (mode === "boxes") { addMap(pinMap, "pin" + (2 + sockets), 3); }
        else socketDrops += 1;
      }
      if ((n(b.sw1) + n(b.sw2) + n(b.sw3) + pass + cross) > 0 && mode === "junction") switchDrops += 1;
    });

    function addJunction(totalDrops, perBox) {
      totalDrops = Math.max(0, n(totalDrops)); perBox = Math.max(1, n(perBox, 2));
      const boxes = ceil(totalDrops / perBox); let left = totalDrops;
      for (let i = 0; i < boxes; i++) { const here = Math.min(perBox, left); left -= here; if (here > 0) addMap(pinMap, "pin" + (2 + here), 3); }
    }
    if (mode === "junction") { addJunction(socketDrops, cfg.dropsPerSocketJunction); addJunction(switchDrops, cfg.dropsPerSwitchJunction); }

    const materials = {}; let shrinkCount = 0;
    Object.keys(pinMap).forEach(pin => {
      const w = n(pin.replace("pin", "")), q = pinMap[pin];
      if (cfg.connectorMode === "wago") addMap(materials, pin, q);
      else if (cfg.connectorMode === "siz") { addMap(materials, "siz" + w, q); shrinkCount += q; }
      else { addMap(materials, sleeveByWires(w), q); shrinkCount += q; }
    });
    const shrinkM = Math.round((shrinkCount * n(cfg.shrinkCmPerJoint, 5) / 100) * 100) / 100;
    return { materials, shrinkM, mode: cfg.connectorMode };
  }

  // ── основной расчёт ──
  function calc(input) {
    const cfg = Object.assign({}, DEFAULTS, input || {});
    cfg.capacity = Object.assign({}, DEFAULTS.capacity, (input && input.capacity) || {});
    cfg.depth = Object.assign({}, DEFAULTS.depth, (input && input.depth) || {});
    const C = n(cfg.ceilingHeight, 270);
    const mode = cfg.mode === "boxes" ? "boxes" : "junction";
    const blocks = Array.isArray(cfg.blocks) ? cfg.blocks : [];

    // ёмкость по размеру (считаем всё по 2.5 — с запасом)
    const cap = (size) => {
      const t = cfg.capacity[size] || cfg.capacity[cfg.sizeRegular] || { round: { "2.5": 2 } };
      const byShape = t[cfg.shape] || t.round || { "2.5": 2 };
      return Math.max(1, n(byShape[cfg.socketGauge] || byShape["2.5"], 2));
    };

    const byMat = {};                 // материал → агрегаты
    const M = (m) => (byMat[m] = byMat[m] || {
      strobe: {}, podrozStd: 0, podrozDeep: 0, drillStd: 0, drillDeep: 0
    });
    const addStrobe = (m, size, cm) => { if (cm > 0) M(m).strobe[size] = round1((M(m).strobe[size] || 0) + cm / 100); }; // см → м

    let cableSocket = 0, cableLight = 0, cableLV = 0, cableWarm = 0;  // метры по типам
    let socketDrops = 0, switchCount = 0;                             // для распаек

    blocks.forEach(b => {
      const mat = b.material || "Бетон";
      const route = b.route === "floor" ? "floor" : "ceiling";
      const H = n(b.height, 30);
      const size = b.chaseSize || cfg.sizeRegular;
      const down = Math.max(0, C - H);   // короб → потолок
      const up = Math.max(0, H);         // пол → короб
      const k2 = mode === "boxes" ? 2 : 1;

      const c = cablesOfBlock(b);
      const powerCables = c.socketCables + c.lightCables;

      // ── ШТРОБЫ (силовые) ──
      if (powerCables > 0) {
        const chPower = ceil(powerCables / cap(size));
        const chLight = ceil(c.lightCables / cap(size));
        if (route === "ceiling") {
          // всё короб→потолок
          addStrobe(mat, size, chPower * down);
        } else {
          // пол→короб несёт всё; короб→потолок несёт только свет
          addStrobe(mat, size, chPower * up);
          addStrobe(mat, size, chLight * down);
        }
      }
      // ── ШТРОБА слаботочки (1 на блок, отдельно) ──
      if (c.lvCables > 0) {
        const lvLen = route === "ceiling" ? down : up;
        addStrobe(mat, cfg.lvSize, lvLen);
      }
      // ── ТЁПЛЫЙ ПОЛ (50×50: короб→пол; потолочный маршрут ещё 25×30 короб→потолок) ──
      const wf = n(b.warmFloor);
      if (wf > 0) {
        addStrobe(mat, cfg.sizeWarm, wf * up);                  // короб→пол 50×50
        if (route === "ceiling") addStrobe(mat, cfg.sizeRegular, wf * down); // питание с потолка 25×30
      }

      // ── КАБЕЛЬ по типам (метры ≈ штробы; силовые ×2 в подрозетниках) ──
      if (route === "ceiling") {
        cableSocket += c.socketCables * down * k2;
        cableLight += c.lightCables * down * k2;
      } else {
        cableSocket += c.socketCables * up * k2;               // розетки пол→короб
        cableLight += c.lightCables * C * k2;                  // свет пол→потолок (вся высота)
      }
      cableLV += c.lvCables * (route === "ceiling" ? down : up);
      cableWarm += wf * (up + (route === "ceiling" ? down : 0));

      // ── ПОДРОЗЕТНИКИ ──
      const p = podrozOfBlock(b, mode);
      M(mat).podrozStd += p.std; M(mat).drillStd += p.std;
      M(mat).podrozDeep += p.deep; M(mat).drillDeep += p.deep;

      // ── РАСПАЙКИ (только распаечный режим): 1 на блок розеток + 1 на каждый выключатель ──
      if (mode === "junction") {
        if (n(b.sockets) > 0) socketDrops += 1;                // 1 распайка на блок розеток (1-5)
        switchCount += (n(b.sw1) + n(b.sw2) + n(b.sw3) + n(b.pass) + n(b.cross)); // 1 на каждый выключатель
      }
    });

    const junctions = mode === "junction"
      ? { socket: socketDrops, switch: switchCount, total: socketDrops + switchCount }
      : { socket: 0, switch: 0, total: 0 };

    const cable = {
      ["3x" + cfg.socketGauge]: round1(cableSocket / 100),     // см → м
      ["3x" + cfg.lightGauge]: round1(cableLight / 100),
      LV: round1(cableLV / 100),
      warm: round1(cableWarm / 100)
    };

    const conn = connectors(blocks, cfg, mode);

    return { cfg, byMat, junctions, cable, conn, draftItems: buildDraftItems(byMat, junctions, cable, conn, cfg) };
  }

  // ── позиции черновика (имена под расходку/смету) ──
  function buildDraftItems(byMat, junctions, cable, conn, cfg) {
    const items = [];
    const add = (type, name, qty, unit) => { qty = round1(qty); if (qty > 0) items.push({ type, name, qty, unit }); };

    Object.keys(byMat).forEach(mat => {
      const d = byMat[mat], low = matLower(mat);
      // штробы по размеру
      Object.keys(d.strobe).forEach(size => add("work", `Штробление ${size} ${low}`, d.strobe[size], "м"));
      // высверливание подрозетников (по глубине)
      if (d.drillStd > 0) add("work", `Высверливание подрозетников обычных ${low}`, d.drillStd, "шт");
      if (d.drillDeep > 0) add("work", `Высверливание подрозетников глубоких ${low}`, d.drillDeep, "шт");
    });
    // подрозетники-товар (по глубине, материал не важен — суммируем)
    let pStd = 0, pDeep = 0;
    Object.keys(byMat).forEach(m => { pStd += byMat[m].podrozStd; pDeep += byMat[m].podrozDeep; });
    if (pStd > 0) add("material", `Подрозетник Ø${cfg.crown} 40-50 мм`, pStd, "шт");
    if (pDeep > 0) add("material", `Подрозетник Ø${cfg.crown} 65 мм глубокий`, pDeep, "шт");
    // распайки
    if (junctions.total > 0) add("material", `Распаечная коробка (потолок)`, junctions.total, "шт");
    // кабель НЕ кладём в черновик (считается в result.cable для будущих расчётов материала)
    // коннекторы (ваго/гильзы/СИЗ)
    if (conn && conn.materials) {
      Object.keys(conn.materials).forEach(k => add("material", connMatName(k), conn.materials[k], "шт"));
      if (conn.shrinkM > 0) add("material", `Термоусадка ${cfg.heatShrinkType}`, conn.shrinkM, "м");
    }
    return items;
  }

  window.EP = window.EP || {};
  window.EP.PoolEngine = { calc, DEFAULTS, version: "V29.engine.1" };
})();
