import { newId } from '../../ids';
import { libraryFootprint } from '../../library';
import { addComponent, addRuleArea, addTrack, addVia, addZone, connectPad, ensureNet } from '../../model/edit';
import { autoroute, type RouteResult } from '../../router/autoroute';
import { autorouteWithZones } from '../../router/zone-aware';
import { createProject } from '../../model/project';
import { MAINS_CLASS, MAINS_CLEARANCE } from '../../model/rules';
import type { FootprintDef, Project, SchSymbol } from '../../model/types';
import { addPinLabels, emptySchematic, symbolDef } from '../../schematic/netlist';
import { SCH_GRID } from '../../schematic/symbols';
import { MAINS_NETS, POWER_NETS, VAC_FOOTPRINTS, VAC_NET_DESCRIPTIONS, VAC_PARTS } from './parts';

/*
 * Проект «Пылесос ESP32»: компактная двусторонняя плата 110×74 мм под заводское
 * изготовление. Сверху — зона 230 В (клеммники, предохранитель, варистор, первичная
 * обмотка трансформатора, выходы оптронов, симисторы клапанов), под оптронами —
 * прорезь для пути утечки, снизу — низковольтная часть (питание, ESP32, датчики,
 * разъёмы). Между сетью и логикой — 6 мм (класс цепей Mains).
 */

export const VAC_BOARD = { w: 110, h: 74 };

function footprintOf(id: string): FootprintDef {
  const f = VAC_FOOTPRINTS.find((x) => x.id === id) ?? libraryFootprint(id);
  if (!f) throw new Error(`нет корпуса ${id}`);
  return f;
}

/** Сборка проекта без дорожек (разводит автотрассировка — см. тест). */
export function buildVacuumEsp32(firmware?: { name: string; wasm: string }): Project {
  const { w, h } = VAC_BOARD;
  const p = createProject({ name: 'Пылесос ESP32 (контроллер)', width: w, height: h, copperLayers: 2, cornerRadius: 1.5 });
  p.meta.author = 'Plata';
  p.meta.description =
    'Контроллер строительного пылесоса на ESP32-WROOM-32E без готовых модулей (кроме ESP32 и датчиков): две турбины с плавным пуском и фазовым управлением (MOC3023 + BTA41), розетка инструмента с автозапуском (MOC3063 + BTA41), два клапана продувки фильтра (MOC3063 + BT134W), трансформатор 230/9 В, AP63205 и AMS1117, детектор нуля со вторичной обмотки, трансформаторы тока, термисторы двигателей, датчики разрежения MPX5050DP и SDP810, экран OLED, энкодер и кнопки на панели.';
  p.netClasses.Mains = { ...MAINS_CLASS, clearance: 0.9, trackWidth: 0.8, viaDiameter: 1.6, viaDrill: 0.8 };
  p.netClasses.Power.trackWidth = 0.4;
  p.rules.classClearances = [{ a: 'Mains', b: '*', clearance: MAINS_CLEARANCE }];
  p.rules.edgeClearance = 0.4;

  // Прорезь под оптронами: путь утечки между 230 В и логикой — вокруг неё.
  p.board.cutouts = [
    [
      { x: 41.5, y: 30.4 },
      { x: 98.5, y: 30.4 },
      { x: 98.5, y: 31.6 },
      { x: 41.5, y: 31.6 },
    ],
  ];

  for (const name of MAINS_NETS) ensureNet(p, name, { netClass: 'Mains', description: VAC_NET_DESCRIPTIONS[name] });
  for (const name of POWER_NETS) ensureNet(p, name, { netClass: 'Power', description: VAC_NET_DESCRIPTIONS[name] });

  for (const part of VAC_PARTS) {
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
      const n = ensureNet(p, net, { description: VAC_NET_DESCRIPTIONS[net] });
      for (const q of byNum) connectPad(p, c.id, q.number, n.id);
    }
  }
  // Выносные — рядком над платой (на плате их нет, место — только для порядка).
  let x = 0;
  for (const c of Object.values(p.components))
    if (c.offBoard) {
      c.at = { x, y: -30 };
      x += 12;
    }

  // Земля на обеих сторонах низковольтной части, кроме места под антенной ESP32.
  const logic = [
    { x: 0.6, y: 33.4 },
    { x: 102.8, y: 33.4 },
    { x: 102.8, y: 63.5 },
    { x: w - 0.6, y: 63.5 },
    { x: w - 0.6, y: h - 0.6 },
    { x: 0.6, y: h - 0.6 },
  ];
  const gnd = ensureNet(p, 'GND').id;
  addZone(p, { name: 'Земля снизу', layer: 'B.Cu', net: gnd, outline: logic, clearance: 0.3, minWidth: 0.25, priority: 0 });
  addZone(p, { name: 'Земля сверху', layer: 'F.Cu', net: gnd, outline: logic, clearance: 0.3, minWidth: 0.25, priority: 0 });
  // Изоляция 6 мм: в верхнюю зону — только цепи 230 В, в нижнюю — только логика, между ними
  // полоса без дорожек и переходных (над ней — только выводы оптронов и прорезь).
  const band = (y0: number, y1: number, y2: number, y3: number) => [
    { x: 0, y: y0 },
    { x: 36, y: y0 },
    { x: 36, y: y1 },
    { x: w, y: y1 },
    { x: w, y: y3 },
    { x: 36, y: y3 },
    { x: 36, y: y2 },
    { x: 0, y: y2 },
  ];
  addRuleArea(p, { name: 'Сеть 230 В', outline: band(0, 0, 26.4, 28.0), onlyClasses: ['Mains'], showLabel: true });
  addRuleArea(p, { name: 'Изоляция 6 мм', outline: band(26.4, 28.0, 32.4, 34.2), keepoutTracks: true, keepoutVias: true, showLabel: false });
  addRuleArea(p, { name: 'Низковольтная часть', outline: band(32.4, 34.2, h, h), onlyClasses: ['Default', 'Power'], showLabel: false });

  // Последней: у трассировщика в пересечении областей действует последняя.
  addRuleArea(p, {
    name: 'Антенна ESP32',
    outline: [
      { x: 103.2, y: 36.0 },
      { x: w, y: 36.0 },
      { x: w, y: 63.2 },
      { x: 103.2, y: 63.2 },
    ],
    keepoutTracks: true,
    keepoutVias: true,
    showLabel: false,
  });
  layoutSchematic(p);
  if (firmware) p.firmware = { name: firmware.name, hex: '', mcu: 'esp32', wasm: firmware.wasm };
  return structuredClone(p);
}

/* ---------------- разводка ---------------- */

/** Дорожки и переходные в проект. Перемычки на двусторонней плате — это не проведённые связи: их не ставим. */
function apply(p: Project, r: Pick<RouteResult, 'tracks' | 'vias' | 'wires'>): Project {
  for (const t of r.tracks) addTrack(p, t);
  for (const v of r.vias) addVia(p, v);
  return structuredClone(p);
}

/**
 * Разводка в три прохода: цепи 230 В (крупная сетка, широкие дорожки), питание,
 * затем сигналы с учётом заливки земли. Возвращает новый проект и отчёт.
 */
export async function routeVacuumEsp32(p0: Project, o: { iterations?: number } = {}): Promise<{ project: Project; report: string[] }> {
  let p = structuredClone(p0);
  const report: string[] = [];
  const it = o.iterations ?? 40;
  const ids = (f: (cls: string, name: string) => boolean) => Object.values(p.nets).filter((n) => f(n.netClass, n.name)).map((n) => n.id);
  const r1 = await autoroute(p, { iterations: it, hopCost: 20, yieldEvery: 1e9, grid: 1.27, nets: ids((c) => c === 'Mains') });
  report.push(`230 В: дорожек ${r1.tracks.length}, не проведено ${r1.failed}`);
  p = apply(p, r1);
  // Логику разводим на копии, где у класса 230 В обычные ширина и зазор: иначе трассировщик
  // держит у каждой площадки запас по самому широкому классу и не подходит к выводам ESP32.
  // 6 мм до сети обеспечивают зоны правил (дорожки логики туда не заходят).
  const narrow = (q: Project): Project => {
    const c = structuredClone(q);
    c.netClasses.Mains = { ...c.netClasses.Mains, clearance: 0.2, trackWidth: 0.25 };
    return c;
  };
  const r2 = await autoroute(narrow(p), { iterations: it, hopCost: 20, yieldEvery: 1e9, grid: 0.635, keepExisting: true, nets: ids((c, n) => c === 'Power' && n !== 'GND') });
  report.push(`питание: дорожек ${r2.tracks.length}, переходных ${r2.vias.length}, не проведено ${r2.failed}`);
  p = apply(p, r2);
  const r3 = await autorouteWithZones(narrow(p), { iterations: it, hopCost: 20, yieldEvery: 1e9, grid: 0.635, keepExisting: true, nets: ids((c, n) => c !== 'Mains' && (c !== 'Power' || n === 'GND')) });
  report.push(`сигналы: дорожек ${r3.tracks.length}, переходных ${r3.vias.length}, сшивок ${r3.stitches}, не проведено ${r3.failed}`);
  p = apply(p, r3);
  return { project: p, report };
}

/* ---------------- схема ---------------- */

const BLOCKS: { title: string; at: [number, number]; width: number; parts: (string | [string, number])[] }[] = [
  { title: 'Сеть и питание', at: [10, 10], width: 230, parts: ['XP1', 'XT1', ['FU1', 90], ['RU1', 90], 'TV1', 'VDS1', 'VD1', ['C1', 90], 'DA1', ['C2', 90], 'C3', 'L1', ['C4', 90], ['C5', 90], 'DA2', ['C6', 90]] },
  { title: 'Детектор нуля', at: [250, 10], width: 110, parts: ['R1', ['R2', 90], 'VT1', ['R3', 90]] },
  { title: 'ESP32', at: [250, 70], width: 170, parts: ['A1', ['R4', 90], ['C7', 90], ['R5', 90], ['C8', 90], ['C9', 90], 'SB1', 'SB2', 'X6'] },
  { title: 'Турбины и розетка (230 В)', at: [10, 110], width: 230, parts: ['R6', 'U1', 'R11', 'R7', 'U2', 'R12', 'R8', 'U3', 'R13', 'XT3', 'VS3', 'VS4', 'VS5', 'TA1', 'TA2', 'TA3', 'M1', 'M2', 'XS1'] },
  { title: 'Клапаны продувки', at: [10, 215], width: 230, parts: ['R9', 'U4', 'R14', 'VS1', 'R10', 'U5', 'R15', 'VS2', 'XT2', 'YA1', 'YA2'] },
  { title: 'Датчики', at: [430, 10], width: 200, parts: ['X4', ['R20', 90], ['R21', 90], ['C10', 90], ['R22', 90], ['R23', 90], ['R24', 90], ['R25', 90], ['R26', 90], ['C11', 90], ['C12', 90], 'RK1', 'RK2', 'B1', 'R27', ['R28', 90], ['C13', 90], ['C14', 90]] },
  { title: 'Давление и расход (I²C)', at: [430, 150], width: 200, parts: ['X2', 'X3', ['R29', 90], ['R30', 90], ['R31', 90], ['R32', 90], 'B2', 'B3'] },
  { title: 'Панель и звук', at: [250, 200], width: 170, parts: ['X1', 'HG1', 'SA1', 'SB3', 'SB4', 'SB5', 'BA1', 'VT2', ['R33', 90], ['VD2', 90]] },
];

function layoutSchematic(p: Project): void {
  p.schematic = emptySchematic();
  const byRef = new Map(Object.values(p.components).map((c) => [c.ref, c]));
  const snap = (v: number) => Math.round(v / SCH_GRID) * SCH_GRID;
  const placed = new Set<string>();
  for (const b of BLOCKS) {
    let x = b.at[0];
    let y = b.at[1] + 8;
    let rowH = 0;
    for (const item of b.parts) {
      const [ref, rotation] = typeof item === 'string' ? [item, 0] : item;
      const c = byRef.get(ref);
      if (!c) throw new Error(`на схеме нет ${ref}`);
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
  const missing = Object.values(p.components).filter((c) => !placed.has(c.ref) && !/^H\d/.test(c.ref));
  if (missing.length) throw new Error(`не на схеме: ${missing.map((c) => c.ref).join(', ')}`);
}
