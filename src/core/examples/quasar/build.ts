import { newId } from '../../ids';
import { layGeometry, moveGraphic, netsFromCopper, parseLay, type LayPad } from '../../io/sprint-layout';
import type { Vec2 } from '../../math/vec';
import { addDrawing, addTrack, ensureNet } from '../../model/edit';
import { createProject } from '../../model/project';
import type { Component, FootprintDef, Graphic, PadDef, Project, SchSymbol } from '../../model/types';
import { addPinLabels, emptySchematic, symbolDef } from '../../schematic/netlist';
import { SCH_GRID } from '../../schematic/symbols';
import { QUASAR_NET_NAMES, QUASAR_OFFBOARD, QUASAR_PARTS, type QuasarPart } from './parts';

/*
 * Металлоискатель «Квазар» (Andy_F, fandy.ucoz.org) на плате DesAlex для ЛУТ:
 * разводка берётся из файла Sprint Layout как есть, детали и выводы — по таблице
 * parts.ts (координаты площадок и назначение выводов сверены со сборочным чертежом
 * и схемой), цепи — по связности меди. Выносные детали (дисплей, клавиатура,
 * динамик, катушка, аккумулятор) стоят вне платы и подключаются проводами.
 */

const r3 = (v: number) => Math.round(v * 1000) / 1000;

interface Spot {
  at: Vec2;
  pads: LayPad[];
  used: boolean;
}

/** Площадки файла, склеенные по месту: у DesAlex многие продублированы (две в одной точке). */
function spots(pads: LayPad[]): Spot[] {
  const out: Spot[] = [];
  for (const p of pads) {
    const s = out.find((q) => Math.hypot(q.at.x - p.center.x, q.at.y - p.center.y) < 0.35);
    if (s) s.pads.push(p);
    else out.push({ at: p.center, pads: [p], used: false });
  }
  // Точка площадки — на сетке 0,635 мм, если одна из копий на ней.
  const onGrid = (v: number) => Math.abs(v / 0.635 - Math.round(v / 0.635)) < 0.02;
  for (const s of out) {
    const g = s.pads.find((p) => onGrid(p.center.x) && onGrid(p.center.y));
    s.at = g ? g.center : s.pads[0].center;
  }
  return out;
}

const CATEGORY: Record<QuasarPart['kind'], { category: string; prefix: string; group?: string }> = {
  R: { category: 'Резисторы', prefix: 'R' },
  C: { category: 'Конденсаторы', prefix: 'C' },
  CP: { category: 'Конденсаторы', prefix: 'C', group: 'Электролитические' },
  L: { category: 'Индуктивности', prefix: 'L' },
  D: { category: 'Диоды', prefix: 'VD' },
  Q: { category: 'Транзисторы', prefix: 'VT' },
  U: { category: 'Микросхемы', prefix: 'DA' },
  Y: { category: 'Кварцы и резонаторы', prefix: 'ZQ' },
  X: { category: 'Разъёмы', prefix: 'X' },
  H: { category: 'Крепёж', prefix: 'H' },
};

/** Сборка проекта «Квазар» из файла разводки DesAlex и прошивки. */
export function buildQuasar(layBytes: Uint8Array, firmware: { name: string; hex: string }): Project {
  const lay = parseLay(layBytes);
  const geo = layGeometry(lay);
  if (!geo.outline) throw new Error('в файле Квазара нет контура платы');
  const box = geo.outline.reduce((b, q) => ({ x: Math.min(b.x, q.x), y: Math.min(b.y, q.y) }), { x: Infinity, y: Infinity });
  const mv = (q: Vec2): Vec2 => ({ x: r3(q.x - box.x), y: r3(q.y - box.y) });

  const p = createProject({ name: 'Квазар AVR (плата DesAlex)', homemade: true, copperLayers: 1 });
  p.meta.author = 'Схема и прошивка — Andy_F (fandy.ucoz.org), плата — DesAlex';
  p.meta.description =
    'Металлоискатель «Квазар AVR»: ATmega32A на 11,0592 МГц, АЦП MCP3201, ОУ MCP601, ключи IRF9640/IRF840, ЖК 1602. Плата DesAlex под ЛУТ (Sprint Layout), прошивка Quasar 1.4.5. Звёздочкой в номиналах помечены детали, которые подбираются при настройке.';
  p.board.outline = geo.outline.map(mv);
  // Правила — как у исходной разводки (ЛУТ, края обрезаются вручную).
  p.rules.minClearance = 0.2;
  p.rules.edgeClearance = 0.4;
  p.rules.minTrackWidth = 0.3;
  p.rules.minViaDrill = 0.6;
  for (const nc of Object.values(p.netClasses)) nc.clearance = 0.2;
  p.board.cutouts = [];

  const all = spots(geo.pads.map((q) => ({ ...q, center: mv(q.center) })));
  const take = (at: Vec2, who: string): Spot => {
    let best: Spot | null = null;
    let bd = Infinity;
    for (const s of all) {
      const d = Math.hypot(s.at.x - at.x, s.at.y - at.y);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    if (!best || bd > 0.45) throw new Error(`${who}: нет площадки около ${at.x}, ${at.y}`);
    if (best.used) throw new Error(`${who}: площадка ${best.at.x}, ${best.at.y} уже занята`);
    best.used = true;
    return best;
  };

  // Корпуса: одинаковые по геометрии детали получают общий корпус.
  const fpByKey = new Map<string, string>();
  let fpN = 0;
  const onBoard: Component[] = [];
  for (const part of QUASAR_PARTS) {
    const cat = CATEGORY[part.kind];
    if (part.offBoard) continue;
    const sp = part.pads.map(([x, y], i) => take({ x, y }, `${part.ref}.${i + 1}`));
    const cx = r3(sp.reduce((s, q) => s + q.at.x, 0) / sp.length);
    const cy = r3(sp.reduce((s, q) => s + q.at.y, 0) / sp.length);
    const pads: PadDef[] = sp.map((s, i) => {
      const [, , name, number] = part.pads[i];
      const big = s.pads.reduce((a, b) => (b.def.size.x > a.def.size.x ? b : a));
      const drill = Math.max(...s.pads.map((q) => q.def.drill ?? 0));
      const hole = part.kind === 'H';
      return {
        number: number ?? String(i + 1),
        name: name && name !== (number ?? String(i + 1)) ? name : undefined,
        type: hole ? 'npth' : 'tht',
        shape: s.pads.some((q) => q.def.shape === 'rect') ? 'rect' : 'circle',
        at: { x: r3(s.at.x - cx), y: r3(s.at.y - cy) },
        size: hole ? { x: drill, y: drill } : { x: big.def.size.x, y: big.def.size.y },
        drill: hole ? r3(drill) : r3(Math.max(0.6, drill)),
      };
    });
    const xs = pads.flatMap((q) => [q.at.x - q.size.x / 2, q.at.x + q.size.x / 2]);
    const ys = pads.flatMap((q) => [q.at.y - q.size.y / 2, q.at.y + q.size.y / 2]);
    const body = part.body ?? { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
    const graphics: Graphic[] = [
      { kind: 'rect', layer: 'F.Fab', a: { x: r3(body.x0), y: r3(body.y0) }, b: { x: r3(body.x1), y: r3(body.y1) }, width: 0.1 },
      { kind: 'text', layer: 'F.Fab', at: { x: 0, y: 0 }, text: '${REF}', size: 1.0, thickness: 0.15, align: 'center' },
    ];
    const key = JSON.stringify([part.kind, part.fpName, part.tags, pads, body]);
    let fpId = fpByKey.get(key);
    if (!fpId) {
      fpId = `Quasar_${part.fpId ?? part.kind}_${++fpN}`;
      const fp: FootprintDef = {
        id: fpId,
        name: part.fpName,
        description: `${part.fpName}${pads.length === 2 ? `, шаг ${Math.hypot(pads[1].at.x - pads[0].at.x, pads[1].at.y - pads[0].at.y).toFixed(2).replace('.', ',')} мм` : `, ${pads.length} выв.`} — как на плате DesAlex`,
        category: cat.category,
        group: 'Квазар (DesAlex)',
        refPrefix: cat.prefix,
        tags: ['quasar', ...(part.tags ?? [])],
        pads,
        graphics,
        courtyard: { min: { x: r3(Math.min(body.x0, ...xs)), y: r3(Math.min(body.y0, ...ys)) }, max: { x: r3(Math.max(body.x1, ...xs)), y: r3(Math.max(body.y1, ...ys)) } },
        source: 'Плата DesAlex, Sprint Layout 5',
        verified: false,
      };
      p.footprints[fpId] = fp;
      fpByKey.set(key, fpId);
    }
    const c: Component = { id: newId('c'), ref: part.ref, value: part.value, description: part.description, footprint: fpId, at: { x: cx, y: cy }, rotation: 0, side: 'top', padNets: {}, excludeFromBom: part.kind === 'H' || undefined, hideValue: true };
    p.components[c.id] = c;
    onBoard.push(c);
  }
  const left = all.filter((s) => !s.used);
  if (left.length) throw new Error(`площадки без детали: ${left.map((s) => `${s.at.x},${s.at.y}`).join('; ')}`);

  for (const t of geo.tracks) addTrack(p, { layer: 'B.Cu', width: t.width, points: t.points.map(mv) });
  for (const g of geo.graphics) addDrawing(p, moveGraphic(g.g, mv));

  // Цепи по меди, имена — по назначению (как на схеме Andy_F).
  netsFromCopper(p, (pads) => {
    for (const q of pads) {
      const n = QUASAR_NET_NAMES[`${q.ref}.${q.pad}`];
      if (n) return n;
    }
    return null;
  });
  const unnamed = Object.values(p.nets).filter((n) => /^Net-/.test(n.name));
  if (unnamed.length) throw new Error(`цепи без имени: ${unnamed.map((n) => n.name).join(', ')}`);

  // Выносные детали: вне платы, выводы — в цепи по именам.
  let x = 100;
  for (const part of QUASAR_OFFBOARD) {
    if (!part.offBoard) continue;
    const fp = part.offBoard.footprint;
    p.footprints[fp.id] ??= fp;
    const c: Component = { id: newId('c'), ref: part.ref, value: part.value, description: part.description, footprint: fp.id, at: { x, y: 10 }, rotation: 0, side: 'top', padNets: {}, offBoard: true };
    x += 20;
    for (const [pin, net] of Object.entries(part.offBoard.nets)) c.padNets[pin] = ensureNet(p, net).id;
    p.components[c.id] = c;
  }
  layoutSchematic(p);
  p.firmware = { name: firmware.name, hex: firmware.hex, mcu: 'atmega32', freq: 11_059_200 };
  // Кеши геометрии привязаны к объекту — отдаём свежую копию.
  return structuredClone(p);
}

/* ---------------- схема ---------------- */

/** Блоки схемы: заголовок, место на листе, детали по порядку (поворот 90 — стоя). */
const BLOCKS: { title: string; at: [number, number]; width: number; parts: (string | [string, number])[] }[] = [
  { title: 'Питание', at: [10, 10], width: 190, parts: [['GB1', 90], 'X1', 'X10', ['C34', 90], ['C22', 90], ['C32', 90], 'U7', ['C14', 90], ['C19', 90], 'L2', ['C27', 90], 'U3', ['C11', 90], ['C15', 90]] },
  { title: 'Контроллер', at: [210, 10], width: 150, parts: ['U5', 'BQ1', ['C18', 90], ['C21', 90], ['R10', 90], ['C16', 90], ['R29', 90], ['R18', 90], ['C23', 90]] },
  { title: 'Передатчик', at: [10, 95], width: 190, parts: ['R9', ['C13', 90], ['C9', 90], 'R12', ['R15', 90], 'D4', 'R14', 'D3', 'R13', 'Q1B', 'Q1A', 'R3', 'C6', 'X5', 'L3'] },
  { title: 'Приёмник и АЦП', at: [10, 175], width: 190, parts: ['X6', ['C35', 90], 'C1', 'R1', ['D1', 90], ['R2', 90], ['R6', 90], 'U2', 'U8', 'R4', ['C2', 90], 'R7', 'C10', 'R5', ['C7', 90], 'U4', 'L1', ['C8', 90], 'R8'] },
  { title: 'Дисплей', at: [370, 10], width: 170, parts: ['HG1', 'X2', 'X7', 'X8', 'R22', 'Q4', 'R26'] },
  { title: 'Клавиатура', at: [370, 110], width: 170, parts: ['X3', 'X9', 'SW1', 'SW2', 'SW3', 'SW4', 'SW5', 'SW6', ['VD1', 90], ['VD2', 90], ['VD3', 90], ['VD4', 90]] },
  { title: 'Звук', at: [370, 190], width: 170, parts: ['R21', 'Q2', ['R25', 90], 'Q3', ['R24', 90], ['C33', 90], ['D6', 90], 'X4', 'BA1'] },
];

function layoutSchematic(p: Project): void {
  p.schematic = emptySchematic();
  const byRef = new Map(Object.values(p.components).map((c) => [c.ref, c]));
  const snap = (v: number) => Math.round(v / SCH_GRID) * SCH_GRID;
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
      // Размер с местом под отводы и метки цепей: по 14 мм с каждой стороны, где есть выводы.
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
      x += w;
      rowH = Math.max(rowH, h);
    }
  }
}
