import { newId } from '../../ids';
import { libraryFootprint } from '../../library';
import { addComponent, addRuleArea, addTrack, addVia, addZone, connectPad, ensureNet } from '../../model/edit';
import { autoroute, type RouteOptions, type RouteResult } from '../../router/autoroute';
import { autorouteWithZones } from '../../router/zone-aware';
import { createProject } from '../../model/project';
import { getWorld } from '../../model/world';
import { MAINS_CLASS, MAINS_CLEARANCE } from '../../model/rules';
import { netWidth } from '../../model/currents';
import { applyFit, fitTrackWidthsSafe } from '../../model/track-fit';
import type { FootprintDef, Project, SchSymbol } from '../../model/types';
import type { VacPart } from './parts';
import { addPinLabels, emptySchematic, symbolDef } from '../../schematic/netlist';
import { SCH_GRID } from '../../schematic/symbols';
import { S3_DIP_FOOTPRINTS, s3DipParts } from './dip';
import { S3_BOARD, S3_FOOTPRINTS, S3_MAINS_NETS, S3_MOC_Y, S3_NET_CURRENT, S3_NET_DESCRIPTIONS, S3_PARTS, S3_POWER_NETS } from './parts';

/*
 * Проект «Пылесос S3»: двусторонняя плата 150×100 мм, медь 70 мкм (ток турбин по плате —
 * через реле). Сверху — зона 230 В: клеммники сети, симисторов и трансформатора, предохранитель,
 * варистор, конденсатор X2, контакты реле, выходы оптронов. Посередине — полоса изоляции 6 мм:
 * над ней стоят реле и оптроны (обмотки и светодиоды — ниже), под оптронами — прорезь. Снизу —
 * низковольтная часть: блок питания справа, ключи магнитов клапанов и реле розетки у правого
 * края (клеммник X7), ESP32-S3 слева (антенна к краю), расширитель кнопок и разъём пульта,
 * датчики и USB-C по нижнему краю. Розетка инструмента, её реле 30 А и автомат — на корпусе,
 * ток инструмента по плате не идёт.
 */

/** Полоса изоляции между сетью и логикой: над ней — только цепи 230 В, под ней — только логика. */
export const S3_BAND = { top: S3_MOC_Y - 3.81 + 0.8, bottom: S3_MOC_Y + 3.81 - 0.8 };

function footprintOf(id: string): FootprintDef {
  const f = S3_FOOTPRINTS.find((x) => x.id === id) ?? S3_DIP_FOOTPRINTS.find((x) => x.id === id) ?? libraryFootprint(id);
  if (!f) throw new Error(`нет корпуса ${id}`);
  return f;
}

/**
 * Сборка проекта без дорожек (разводка — routeVacuumS3). dip — вариант на выводных деталях для
 * ЛУТ: правила для домашней платы, детали разложены по блокам, без дорожек, заливок и зон —
 * расстановка и разводка вручную.
 */
export function buildVacuumS3(firmware?: { name: string; wasm: string }, panel?: { name: string; wasm: string }, opts: { dip?: boolean } = {}): Project {
  if (opts.dip) return buildDip(firmware, panel);
  const { w, h } = S3_BOARD;
  const p = createProject({ name: 'Пылесос S3 (контроллер)', width: w, height: h, copperLayers: 2, cornerRadius: 1.5 });
  p.meta.author = 'Plata';
  p.meta.description =
    'Контроллер строительного пылесоса на ESP32-S3: две турбины Domel 1600 Вт с плавным пуском и фазовым управлением (MOC3023 + BTA24 на радиаторе), реле 16 А на каждую турбину (отключение и защита от пробитого симистора), один фильтр 180×320 в камере 2,2 л и два клапана продувки Ø40 на электромагнитах 12 В (удар 30–60 мс обоими, фильтр клапанов на входе), розетка инструмента через реле 30 А (автозапуск, предел тока, выбег и удары после инструмента), трансформаторы тока турбин и инструмента, термисторы двигателей, датчики разрежения MPX5050DP, перепада и расхода SDP810, электроды уровня и перелива в баке, поплавок. Пульт — экран 7″ 800×480 на своей плате ESP32-S3 с шестью кнопками по бокам, энкодером и кнопками «Турбина 1», «Турбина 2», «Выкл»; кнопки читает TCA9555. Bluetooth-пульт и метки на инструмент, USB-C, Wi-Fi для телефона (страница, обновление, резервная копия).';
  // Ток турбин (до 7,5 А каждая) идёт по плате через реле: медь 70 мкм, ширина по IPC-2221.
  p.rules.copperThickness = 70;
  p.rules.tempRise = 20;
  // Внутри сети — 0,7 мм (выводы TO-220 и DIP-6 стоят ближе); дорожки разводятся с запасом
  // 1,3 мм (IPC-2221 B2 для 250 В — 1,25 мм), до логики — 6 мм. Поджиг и трансформатор — 0,5 мм.
  p.netClasses.Mains = { ...MAINS_CLASS, clearance: 0.7, trackWidth: 0.5, viaDiameter: 1.6, viaDrill: 0.8 };
  p.netClasses.Power.trackWidth = 0.4;
  p.rules.classClearances = [{ a: 'Mains', b: '*', clearance: MAINS_CLEARANCE }];
  p.rules.edgeClearance = 0.4;

  // Прорезь под оптронами: путь утечки между 230 В и логикой — вокруг неё.
  p.board.cutouts = [
    [
      { x: 29.5, y: S3_MOC_Y - 0.6 },
      { x: 54.5, y: S3_MOC_Y - 0.6 },
      { x: 54.5, y: S3_MOC_Y + 0.6 },
      { x: 29.5, y: S3_MOC_Y + 0.6 },
    ],
  ];

  addParts(p, S3_PARTS);

  // Земля с обеих сторон низковольтной части (под антенной её не будет: там запрет меди).
  const gnd = ensureNet(p, 'GND').id;
  const zoneOutline = [
    { x: 0.6, y: S3_BAND.bottom + 0.6 },
    { x: w - 0.6, y: S3_BAND.bottom + 0.6 },
    { x: w - 0.6, y: h - 0.6 },
    { x: 0.6, y: h - 0.6 },
  ];
  addZone(p, { name: 'Земля снизу', layer: 'B.Cu', net: gnd, outline: zoneOutline, clearance: 0.3, minWidth: 0.25, priority: 0 });
  addZone(p, { name: 'Земля сверху', layer: 'F.Cu', net: gnd, outline: zoneOutline, clearance: 0.3, minWidth: 0.25, priority: 0 });

  // Землю у USB-C (шаг 0,5 мм) и среднюю ножку USBLC6 заливка не достаёт: короткие отводы —
  // к ближнему выводу экрана разъёма и к переходному под защитой.
  const wd = getWorld(p);
  const padsOf = (ref: string, name: string) => wd.pads.filter((q) => q.component.ref === ref && (q.pad.name || q.pad.number) === name);
  const shields = padsOf('X6', 'SHIELD').map((q) => q.center);
  for (const g of padsOf('X6', 'GND')) {
    const s = shields.reduce((a, b) => (Math.hypot(b.x - g.center.x, b.y - g.center.y) < Math.hypot(a.x - g.center.x, a.y - g.center.y) ? b : a));
    addTrack(p, { layer: 'F.Cu', width: 0.3, points: [g.center, s] });
  }
  // Средняя ножка USBLC6 — переходное прямо под ней; земля PCA9555 (угол корпуса, вокруг —
  // дорожки кнопок) — переходное под корпусом, между рядами выводов.
  const gndVia = (ref: string, pin: string, dy: number) => {
    const c = padsOf(ref, pin)[0].center;
    const v = { x: c.x, y: +(c.y + dy).toFixed(3) };
    addTrack(p, { layer: 'F.Cu', width: 0.3, points: [c, v] });
    addVia(p, { at: v, diameter: 0.6, drill: 0.3 });
  };
  gndVia('VD5', '2', 1.3);
  gndVia('DD1', 'GND', -2.45);

  // Изоляция 6 мм: в верхнюю зону — только цепи 230 В, в нижнюю — только логика.
  const band = (y0: number, y1: number) => [
    { x: 0, y: y0 },
    { x: w, y: y0 },
    { x: w, y: y1 },
    { x: 0, y: y1 },
  ];
  addRuleArea(p, { name: 'Сеть 230 В', outline: band(0, S3_BAND.top), onlyClasses: ['Mains'], showLabel: true });
  addRuleArea(p, { name: 'Изоляция 6 мм', outline: band(S3_BAND.top, S3_BAND.bottom), keepoutTracks: true, keepoutVias: true, showLabel: false });
  addRuleArea(p, { name: 'Низковольтная часть', outline: band(S3_BAND.bottom, h), onlyClasses: ['Default', 'Power'], showLabel: false });
  // Антенна ESP32-S3 — у левого края: под ней и рядом нет меди.
  addRuleArea(p, {
    name: 'Антенна ESP32-S3',
    outline: [
      { x: 0, y: 46.5 },
      { x: 7.0, y: 46.5 },
      { x: 7.0, y: 69.5 },
      { x: 0, y: 69.5 },
    ],
    keepoutTracks: true,
    keepoutVias: true,
    showLabel: false,
  });
  // Под брюхом модуля — без меди сверху и без переходных; снизу дорожки можно.
  addRuleArea(p, {
    name: 'Под модулем ESP32-S3',
    outline: [
      { x: 7.0, y: 50.2 },
      { x: 24.6, y: 50.2 },
      { x: 24.6, y: 65.8 },
      { x: 7.0, y: 65.8 },
    ],
    keepoutTracks: true,
    keepoutVias: true,
    layers: ['F.Cu'],
    showLabel: false,
  });
  layoutSchematic(p);
  if (firmware) {
    p.firmware = { name: firmware.name, hex: '', mcu: 'esp32', wasm: firmware.wasm };
    if (panel) p.firmware.modules = { HG1: { name: panel.name, wasm: panel.wasm } };
  }
  return structuredClone(p);
}

/** Детали, цепи и классы — общее для обоих вариантов. */
function addParts(p: Project, parts: VacPart[]): void {
  for (const name of S3_MAINS_NETS) ensureNet(p, name, { netClass: 'Mains', description: S3_NET_DESCRIPTIONS[name] });
  for (const name of S3_POWER_NETS) ensureNet(p, name, { netClass: 'Power', description: S3_NET_DESCRIPTIONS[name] });
  for (const part of parts) {
    const fp = footprintOf(part.fp);
    const at = part.at ?? [0, 0, 0];
    const c = addComponent(p, fp, { x: at[0], y: at[1] }, { ref: part.ref, value: part.value, description: part.description, rotation: at[2] ?? 0 });
    if (part.offBoard) {
      c.offBoard = true;
      c.at = { x: 0, y: 0 };
    }
    if (part.fields) c.fields = { ...part.fields };
    if (!part.value) c.hideValue = true;
    const f = p.footprints[c.footprint];
    for (const [pin, net] of Object.entries(part.pins)) {
      const pads = f.pads.filter((q) => q.type !== 'npth' && q.name === pin);
      const byNum = pads.length ? pads : f.pads.filter((q) => q.number === pin);
      if (!byNum.length) throw new Error(`${part.ref}: нет вывода ${pin}`);
      const n = ensureNet(p, net, { description: S3_NET_DESCRIPTIONS[net] });
      for (const q of byNum) connectPad(p, c.id, q.number, n.id);
    }
  }
  for (const [name, amps] of Object.entries(S3_NET_CURRENT)) {
    const n = Object.values(p.nets).find((x) => x.name === name);
    if (n) n.current = amps;
  }
  let x = 0;
  for (const c of Object.values(p.components))
    if (c.offBoard) {
      c.at = { x, y: -30 };
      x += 12;
    }
}

/** Вариант на выводных деталях: детали по блокам схемы рядами, плата — по их площади. */
function buildDip(firmware?: { name: string; wasm: string }, panel?: { name: string; wasm: string }): Project {
  const W = 190;
  const p = createProject({ name: 'Пылесос S3 (выводные детали, ЛУТ)', width: W, height: 150, copperLayers: 2, cornerRadius: 1.5, homemade: true });
  p.meta.author = 'Plata';
  p.meta.description =
    'Пылесос S3 на выводных деталях для ЛУТ: схема та же, что у «Пылесос S3 (контроллер)», корпуса выводные; ESP32-S3-DevKitC-1 вместо модуля, модуль MP1584 вместо AP63205, PCA9555 на переходнике SO-24 → DIP-24. Детали разложены по блокам — расстановка и дорожки вручную. Сетевая часть (230 В) — держите 6 мм до низковольтной.';
  p.netClasses.Mains = { ...MAINS_CLASS, clearance: 0.7, trackWidth: 1.0, viaDiameter: 1.8, viaDrill: 0.8 };
  p.rules.classClearances = [{ a: 'Mains', b: '*', clearance: MAINS_CLEARANCE }];
  addParts(p, s3DipParts());
  // Раскладка: по порядку блоков схемы, слева направо рядами, зазор 3 мм.
  const byRef = new Map(Object.values(p.components).map((c) => [c.ref, c]));
  const order: string[] = [];
  for (const b of BLOCKS) for (const it of b.parts) order.push(typeof it === 'string' ? it : it[0]);
  for (const c of Object.values(p.components)) if (!order.includes(c.ref)) order.push(c.ref);
  const box = (fp: FootprintDef) => {
    if (fp.courtyard) return fp.courtyard;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const q of fp.pads) {
      x0 = Math.min(x0, q.at.x - q.size.x / 2);
      y0 = Math.min(y0, q.at.y - q.size.y / 2);
      x1 = Math.max(x1, q.at.x + q.size.x / 2);
      y1 = Math.max(y1, q.at.y + q.size.y / 2);
    }
    return { min: { x: x0 - 1, y: y0 - 1 }, max: { x: x1 + 1, y: y1 + 1 } };
  };
  // Сначала всё, что касается 230 В (между ними 7 мм — не меньше 6 мм до чужих выводов), ниже
  // через полосу 10 мм — низковольтная часть.
  const mainsNet = (id: string) => p.nets[id]?.netClass === 'Mains';
  const isMains = (ref: string) => Object.values(byRef.get(ref)?.padNets ?? {}).some(mainsNet);
  let x = 5;
  let y = 5;
  let rowH = 0;
  const place = (refs: string[], gap: number) => {
    for (const ref of refs) {
      const c = byRef.get(ref);
      if (!c || c.offBoard) continue;
      const b = box(p.footprints[c.footprint]);
      const w = b.max.x - b.min.x;
      const h = b.max.y - b.min.y;
      if (x + w > W - 5 && x > 5) {
        x = 5;
        y += rowH + gap;
        rowH = 0;
      }
      c.at = { x: +(x - b.min.x).toFixed(2), y: +(y - b.min.y).toFixed(2) };
      c.rotation = 0;
      x += w + gap;
      rowH = Math.max(rowH, h);
    }
  };
  place(order.filter(isMains), 7);
  x = 5;
  y += rowH + 10;
  rowH = 0;
  place(order.filter((r) => !isMains(r)), 3);
  const H = Math.ceil(y + rowH + 5);
  p.board.outline = [
    { x: 0, y: 0 },
    { x: W, y: 0 },
    { x: W, y: H },
    { x: 0, y: H },
  ];
  layoutSchematic(p, true);
  if (firmware) {
    p.firmware = { name: firmware.name, hex: '', mcu: 'esp32', wasm: firmware.wasm };
    if (panel) p.firmware.modules = { HG1: { name: panel.name, wasm: panel.wasm } };
  }
  return structuredClone(p);
}

/* ---------------- схема ---------------- */

/** Блок схемы: заголовок, левый верхний угол, ширина; детали — обозначения (с поворотом 90 — вертикально). */
export interface SchBlock {
  title: string;
  at: [number, number];
  width: number;
  parts: (string | [string, number])[];
}

const BLOCKS: SchBlock[] = [
  { title: 'Сеть и питание', at: [10, 10], width: 240, parts: ['XP1', 'SA1', 'XT1', ['FU1', 90], ['RU1', 90], ['CX1', 90], 'XT4', 'TV1', 'XT5', 'VDS1', 'VD1', ['C1', 90], 'DA1', ['C2', 90], 'C3', 'L1', ['C4', 90], ['C5', 90], ['C7', 90], 'DA2', ['C6', 90]] },
  { title: 'Детектор нуля', at: [260, 10], width: 110, parts: ['R1', ['R2', 90], 'VT1', ['R3', 90]] },
  { title: 'ESP32-S3 и USB', at: [260, 70], width: 190, parts: ['A1', ['C8', 90], ['C9', 90], ['R4', 90], ['C15', 90], 'SB10', 'SB11', 'R5', 'HL1', 'X6', 'VD5', ['R6', 90], ['R7', 90], 'VD6'] },
  { title: 'Реле и турбины (230 В)', at: [10, 120], width: 240, parts: ['K1', 'VT3', 'VD3', 'R50', ['R51', 90], 'K2', 'VT4', 'VD4', 'R52', ['R53', 90], 'R10', 'U1', 'R14', 'R11', 'U2', 'R15', 'XT3', 'VS3', 'VS4', 'TA1', 'TA2', 'M1', 'M2'] },
  { title: 'Клапаны на магнитах и розетка инструмента', at: [10, 235], width: 240, parts: ['X7', ['F2', 90], 'R61', ['R62', 90], 'VT5', ['VD7', 90], 'R63', ['R64', 90], 'VT6', ['VD8', 90], ['R65', 90], ['C19', 90], 'YA1', 'YA2', 'R66', ['R67', 90], 'VT7', ['VD9', 90], 'K3', 'QF1', 'TA3', 'XS1'] },
  { title: 'Датчики', at: [460, 10], width: 210, parts: ['X4', ['R20', 90], ['R21', 90], ['R22', 90], ['R23', 90], ['R24', 90], ['C10', 90], ['R25', 90], ['R26', 90], ['C11', 90], ['C12', 90], 'RK1', 'RK2', 'B1', 'R27', ['R28', 90], ['C13', 90], ['C14', 90], 'X2', 'X3', ['R29', 90], ['R30', 90], 'B2', 'B3'] },
  { title: 'Вода в баке', at: [460, 190], width: 210, parts: ['X5', 'R40', ['C40', 90], 'R41', ['R42', 90], ['C41', 90], 'R43', ['R44', 90], ['C42', 90], 'E0', 'E1', 'E2', 'SL1'] },
  { title: 'Пульт: экран, кнопки, энкодер, звук', at: [260, 230], width: 190, parts: ['X1', 'HG1', 'DD1', ['C16', 90], ['R35', 90], ['R34', 90], ['C17', 90], ['C18', 90], 'SB1', 'SB2', 'SB3', 'SB4', 'SB5', 'SB6', 'SB7', 'SB8', 'SB9', 'SA2', 'BA1', 'HG2', 'VT2', ['R33', 90], ['VD2', 90]] },
];

function layoutSchematic(p: Project, skipMissing = false): void {
  layoutBlocks(p, BLOCKS, skipMissing);
}

/** Схема по блокам: детали рядами внутри блока, метки цепей на выводах. */
export function layoutBlocks(p: Project, blocks: SchBlock[], skipMissing = false): void {
  p.schematic = emptySchematic();
  const byRef = new Map(Object.values(p.components).map((c) => [c.ref, c]));
  const snap = (v: number) => Math.round(v / SCH_GRID) * SCH_GRID;
  const placed = new Set<string>();
  for (const b of blocks) {
    let x = b.at[0];
    let y = b.at[1] + 8;
    let rowH = 0;
    for (const item of b.parts) {
      const [ref, rotation] = typeof item === 'string' ? [item, 0] : item;
      const c = byRef.get(ref);
      if (!c) {
        if (skipMissing) continue;
        throw new Error(`на схеме нет ${ref}`);
      }
      const def = symbolDef(p.footprints[c.footprint]);
      if (!def) continue;
      const rot = rotation === 90;
      const w0 = def.box.max.x - def.box.min.x;
      const h0 = def.box.max.y - def.box.min.y;
      const w = (rot ? h0 : w0) + (rot ? 8 : 30);
      const h = (rot ? w0 : h0) + (rot ? 26 : 12);
      if (x + w > b.at[0] + b.width && x > b.at[0]) {
        x = b.at[0];
        y += rowH;
        rowH = 0;
      }
      const cx = rot ? x + w / 2 : x + 15 - def.box.min.x;
      const cy = rot ? y + 13 + (def.box.max.x - def.box.min.x) / 2 : y + 6 - def.box.min.y;
      const sym: SchSymbol = { id: newId('sy'), component: c.id, at: { x: snap(cx), y: snap(cy) }, rotation };
      p.schematic.symbols[sym.id] = sym;
      addPinLabels(p, sym);
      placed.add(ref);
      x += w;
      rowH = Math.max(rowH, h);
    }
  }
  // Без выводов (крепёж, беспроводной пульт) символа на схеме нет.
  const missing = Object.values(p.components).filter((c) => !placed.has(c.ref) && !/^H\d/.test(c.ref) && (p.footprints[c.footprint]?.pads.length ?? 0) > 0);
  if (missing.length) throw new Error(`не на схеме: ${missing.map((c) => c.ref).join(', ')}`);
}


/* ---------------- разводка ---------------- */

/** Дорожки и переходные в проект (перемычки на двусторонней плате — непроведённые связи, их не ставим). */
function apply(p: Project, r: Pick<RouteResult, 'tracks' | 'vias'>): Project {
  for (const t of r.tracks) addTrack(p, t);
  for (const v of r.vias) addVia(p, v);
  return structuredClone(p);
}

/** Копия с другим классом 230 В для трассировщика: ширина и запас зазора. */
function mainsAs(q: Project, width: number, clearance: number, others?: number): Project {
  const c = structuredClone(q);
  c.netClasses.Mains = { ...c.netClasses.Mains, trackWidth: width, clearance };
  if (others) for (const k of Object.keys(c.netClasses)) if (k !== 'Mains') c.netClasses[k] = { ...c.netClasses[k], trackWidth: others };
  return c;
}

/**
 * Разводка по этапам: ток турбин (фаза и выходы реле) — дорожками 2 мм; остальная сеть —
 * 0,5 мм с запасом 1,3 мм; выпрямитель — 0,4 мм на сетке 0,635; вся остальная логика —
 * одним согласованием на мелкой сетке дорожками 0,2 мм (земля — заливкой).
 */
export async function routeVacuumS3(p0: Project, o: { iterations?: number; extra?: RouteOptions; onStage?: (name: string, p: Project) => void } = {}): Promise<{ project: Project; report: string[]; failedLinks: RouteResult['wires'] }> {
  let p = structuredClone(p0);
  const report: string[] = [];
  const it = o.iterations ?? 60;
  const x: RouteOptions = o.extra ?? { greed: 1, diagonal: false };
  const byName = (names: string[]) => Object.values(p.nets).filter((n) => names.includes(n.name)).map((n) => n.id);
  const ids = (f: (cls: string, name: string) => boolean) => Object.values(p.nets).filter((n) => f(n.netClass, n.name)).map((n) => n.id);
  const heavy = ['L', 'M1_L', 'M2_L'];

  const r0 = await autoroute(mainsAs(p, 2.2, 1.3), { iterations: it, hopCost: 30, yieldEvery: 1e9, grid: 1.27, nets: byName(heavy), ...x });
  report.push(`ток турбин: дорожек ${r0.tracks.length}, не проведено ${r0.failed}`);
  p = apply(p, r0);
  const r1 = await autoroute(mainsAs(p, 0.5, 1.3), { iterations: it, hopCost: 20, yieldEvery: 1e9, grid: 1.27, keepExisting: true, nets: ids((c, n) => c === 'Mains' && !heavy.includes(n)), ...x });
  report.push(`230 В: дорожек ${r1.tracks.length}, не проведено ${r1.failed}`);
  p = apply(p, r1);

  // Выпрямитель и накопитель — крупные выводы, сетка 0,635: дорожки 0,4 мм, чтобы соседние клетки
  // разных цепей держали зазор 0,2 (ток до 1,1 А — хватает; шире — подгонкой по току ниже).
  const power = byName(['VIN', 'VRECT', 'AC1', 'AC2']);
  const r2 = await autoroute(mainsAs(p, 0.5, 0.7, 0.4), { iterations: it, hopCost: 20, yieldEvery: 1e9, grid: 0.635, keepExisting: true, nets: power, ...x });
  report.push(`выпрямитель: дорожек ${r2.tracks.length}, переходных ${r2.vias.length}, не проведено ${r2.failed}`);
  p = apply(p, r2);

  // USB-C: шаг выводов 0,5 мм — своя мелкая сетка. Земля здесь же: её площадки у разъёма и защиты
  // заливка не достаёт, дорожка дотягивается до залитой меди (остальная земля — заливкой).
  const usb = byName(['USB_DN', 'USB_DP', 'CC1', 'CC2', 'VBUS']);
  const gndId = byName(['GND']);
  const ru = await autoroute(mainsAs(p, 0.5, 0.7, 0.2), { iterations: it, hopCost: 20, yieldEvery: 1e9, grid: 0.25, keepExisting: true, nets: [...usb, ...gndId], ...x });
  report.push(`USB: дорожек ${ru.tracks.length}, переходных ${ru.vias.length}, не проведено ${ru.failed}`);
  p = apply(p, ru);

  // Остальное (и питание 5 В / 3,3 В) — дорожками 0,2 мм, потом шире: до ширины класса и по току.
  o.onStage?.('логика', p);
  const done = new Set([...power, ...usb]);
  const r3 = await autorouteWithZones(mainsAs(p, 0.5, 0.7, 0.2), {
    iterations: it,
    hopCost: 12,
    congestionGrowth: 1.3,
    yieldEvery: 1e9,
    grid: 1.27 / 3,
    keepExisting: true,
    nets: ids((c, n) => c !== 'Mains' && !done.has(Object.values(p.nets).find((q) => q.name === n)!.id)),
    ...x,
  });
  report.push(`логика: дорожек ${r3.tracks.length}, переходных ${r3.vias.length}, сшивок ${r3.stitches}, не проведено ${r3.failed}`);
  const thin: string[] = [];
  for (const t of [...ru.tracks, ...r3.tracks]) thin.push(addTrack(p, t).id);
  for (const v of r3.vias) addVia(p, v);
  p = structuredClone(p);
  const want = new Map<string, number>();
  for (const id of Object.keys(p.nets)) want.set(id, netWidth(p, id).width);
  const f = fitTrackWidthsSafe(structuredClone(p), { tracks: thin, widths: want });
  if (f.nets.length) applyFit(p, f);
  p = structuredClone(p);
  report.push(`ширина: расширено цепей ${f.nets.length}, не везде хватило места: ${f.short.map((n) => p.nets[n.net]?.name ?? n.net).join(', ') || 'нет'}`);
  return { project: p, report, failedLinks: r3.wires };
}
