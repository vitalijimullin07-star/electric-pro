import type { Vec2 } from '../math/vec';
import { newId } from '../ids';
import { ensureNet, connectPad } from '../model/edit';
import type { FootprintDef, Id, Project, SchLabel, SchSymbol, SchWire, Schematic } from '../model/types';
import { SCH_GRID, symbolFor, symToWorld, type SymbolDef } from './symbols';

/*
 * Связность схемы: выводы, провода и метки → цепи. Провода соединяются концами
 * и вершинами; точка, лежащая на проводе, подключается к нему (Т-соединение);
 * одноимённые метки — одна цепь. Результат переносится на плату (padNets).
 */

const symCache = new WeakMap<FootprintDef, SymbolDef | null>();
export function symbolDef(fp: FootprintDef | undefined): SymbolDef | null {
  if (!fp) return null;
  if (!symCache.has(fp)) symCache.set(fp, symbolFor(fp));
  return symCache.get(fp)!;
}

export interface PlacedPin {
  symbol: Id;
  component: Id;
  ref: string;
  number: string;
  name: string;
  at: Vec2;
  /** Куда смотрит вывод наружу (единичный вектор). */
  dir: Vec2;
}

export function symbolOf(p: Project, s: SchSymbol): SymbolDef | null {
  const c = p.components[s.component];
  return c ? symbolDef(p.footprints[c.footprint]) : null;
}

export function placedPins(p: Project): PlacedPin[] {
  const out: PlacedPin[] = [];
  for (const s of Object.values(p.schematic?.symbols ?? {})) {
    const c = p.components[s.component];
    const def = symbolOf(p, s);
    if (!c || !def) continue;
    for (const pin of def.pins) {
      const at = symToWorld(pin.at, s.at, s.rotation, s.mirror);
      const base = symToWorld(pin.base, s.at, s.rotation, s.mirror);
      const L = Math.hypot(at.x - base.x, at.y - base.y) || 1;
      out.push({ symbol: s.id, component: c.id, ref: c.ref, number: pin.number, name: pin.name, at, dir: { x: (at.x - base.x) / L, y: (at.y - base.y) / L } });
    }
  }
  return out;
}

const key = (q: Vec2): string => `${Math.round(q.x * 1000)},${Math.round(q.y * 1000)}`;

function onSegment(q: Vec2, a: Vec2, b: Vec2): boolean {
  const cross = (b.x - a.x) * (q.y - a.y) - (b.y - a.y) * (q.x - a.x);
  if (Math.abs(cross) > 1e-4 * Math.max(1, Math.hypot(b.x - a.x, b.y - a.y))) return false;
  const t = ((q.x - a.x) * (b.x - a.x) + (q.y - a.y) * (b.y - a.y)) / ((b.x - a.x) ** 2 + (b.y - a.y) ** 2 || 1);
  return t > 1e-6 && t < 1 - 1e-6;
}

export interface SchNet {
  name: string;
  pins: PlacedPin[];
  /** Имя задано меткой. */
  labelled: boolean;
}

export interface SchNetlist {
  nets: SchNet[];
  /** "компонент#вывод" → имя цепи. */
  pinNet: Map<string, string>;
  /** Точки, где сходятся три провода и больше, — точки соединения. */
  junctions: Vec2[];
  warnings: string[];
}

const cache = new WeakMap<Project, SchNetlist>();

export function schematicNetlist(p: Project): SchNetlist {
  const hit = cache.get(p);
  if (hit) return hit;
  const sch = p.schematic;
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    let r = k;
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!;
    let c = k;
    while (c !== r) {
      const n = parent.get(c) ?? r;
      parent.set(c, r);
      c = n;
    }
    if (!parent.has(r)) parent.set(r, r);
    return r;
  };
  const union = (a: string, b: string) => {
    const x = find(a);
    const y = find(b);
    if (x !== y) parent.set(x, y);
  };
  const pins = placedPins(p);
  const wires = Object.values(sch?.wires ?? {}).filter((w) => w.points.length >= 2);
  const labels = Object.values(sch?.labels ?? {});
  const degree = new Map<string, number>();
  const bump = (k: string, n = 1) => degree.set(k, (degree.get(k) ?? 0) + n);
  for (const w of wires) {
    for (let i = 1; i < w.points.length; i++) union(key(w.points[i - 1]), key(w.points[i]));
    w.points.forEach((q, i) => bump(key(q), i === 0 || i === w.points.length - 1 ? 1 : 2));
  }
  // Т-соединения: вывод, вершина провода или метка на середине отрезка другого провода.
  const probes: Vec2[] = [...pins.map((x) => x.at), ...labels.map((l) => l.at), ...wires.flatMap((w) => [w.points[0], w.points[w.points.length - 1]])];
  for (const q of probes)
    for (const w of wires)
      for (let i = 1; i < w.points.length; i++)
        if (onSegment(q, w.points[i - 1], w.points[i])) {
          union(key(q), key(w.points[i]));
          bump(key(q), 2);
        }
  for (const pin of pins) {
    find(key(pin.at));
    bump(key(pin.at));
  }
  // Одноимённые метки.
  const byText = new Map<string, string>();
  for (const l of labels) {
    const t = l.text.trim();
    if (!t) continue;
    const k = key(l.at);
    find(k);
    if (byText.has(t)) union(k, byText.get(t)!);
    else byText.set(t, k);
  }
  // Группы.
  const groups = new Map<string, { pins: PlacedPin[]; labels: string[] }>();
  const g = (k: string) => {
    const r = find(k);
    if (!groups.has(r)) groups.set(r, { pins: [], labels: [] });
    return groups.get(r)!;
  };
  for (const pin of pins) g(key(pin.at)).pins.push(pin);
  for (const l of labels) if (l.text.trim()) g(key(l.at)).labels.push(l.text.trim());
  const warnings: string[] = [];
  const nets: SchNet[] = [];
  const pinNet = new Map<string, string>();
  const used = new Set<string>();
  for (const grp of groups.values()) {
    if (!grp.pins.length) continue;
    const names = [...new Set(grp.labels)].sort();
    if (names.length > 1) warnings.push(`Метки ${names.join(', ')} стоят на одной цепи — взято имя ${names[0]}.`);
    let name = names[0];
    if (!name) {
      if (grp.pins.length < 2) continue;
      // Без метки: имя цепи с платы, если все выводы уже в одной цепи, иначе Net-(R1-2).
      const pcb = new Set(grp.pins.map((x) => p.components[x.component]?.padNets[x.number]).filter(Boolean));
      const only = pcb.size === 1 ? p.nets[[...pcb][0]!]?.name : undefined;
      const first = [...grp.pins].sort((a, b) => a.ref.localeCompare(b.ref, 'ru', { numeric: true }) || a.number.localeCompare(b.number, 'ru', { numeric: true }))[0];
      name = only && !used.has(only) ? only : `Net-(${first.ref}-${first.number})`;
    }
    used.add(name);
    nets.push({ name, pins: grp.pins, labelled: names.length > 0 });
    for (const pin of grp.pins) pinNet.set(pin.component + '#' + pin.number, name);
  }
  const junctions: Vec2[] = [];
  for (const [k, d] of degree)
    if (d >= 3) {
      const [x, y] = k.split(',').map((v) => +v / 1000);
      junctions.push({ x, y });
    }
  nets.sort((a, b) => a.name.localeCompare(b.name, 'ru', { numeric: true }));
  const res = { nets, pinNet, junctions, warnings };
  cache.set(p, res);
  return res;
}

export interface SyncSummary {
  /** Выводов, у которых сменилась цепь. */
  changed: number;
  added: string[];
  removed: string[];
}

/**
 * Переносит цепи схемы на плату: для компонентов с символами выводы получают
 * цепи схемы (неподключённые — без цепи). Цепи без выводов и полигонов удаляются.
 */
export function applySchematicToBoard(p: Project): SyncSummary {
  const nl = schematicNetlist(p);
  const before = new Set(Object.values(p.nets).map((n) => n.name));
  let changed = 0;
  const withSymbol = new Set(Object.values(p.schematic?.symbols ?? {}).map((s) => s.component));
  for (const c of Object.values(p.components)) {
    if (!withSymbol.has(c.id)) continue;
    const def = symbolDef(p.footprints[c.footprint]);
    if (!def) continue;
    for (const pin of def.pins) {
      const name = nl.pinNet.get(c.id + '#' + pin.number);
      const cur = c.padNets[pin.number] ? p.nets[c.padNets[pin.number]]?.name : undefined;
      if (cur === name) continue;
      changed++;
      connectPad(p, c.id, pin.number, name ? ensureNet(p, name).id : null);
    }
  }
  // Уборка цепей, на которые больше никто не ссылается.
  const referenced = new Set<Id>();
  for (const c of Object.values(p.components)) for (const n of Object.values(c.padNets)) referenced.add(n);
  for (const z of Object.values(p.zones)) if (z.net) referenced.add(z.net);
  const removed: string[] = [];
  for (const n of Object.values(p.nets))
    if (!referenced.has(n.id)) {
      removed.push(n.name);
      delete p.nets[n.id];
    }
  const added = Object.values(p.nets)
    .map((n) => n.name)
    .filter((n) => !before.has(n));
  return { changed, added, removed };
}

/** Пустая схема. */
export const emptySchematic = (): Schematic => ({ symbols: {}, wires: {}, labels: {} });

const POWER = /^(gnd|agnd|dgnd|pgnd|vcc|avcc|vdd|vss|vee|vbat|\+?batt?|vin|[+-]?\d+(?:[.,]\d+)?v\d*|[+-]?\d+v\d*|3v3|5v|12v)$/i;

/**
 * Добавляет символы для компонентов без символа: раскладывает их рядами справа от
 * уже нарисованного и к каждому выводу с цепью ставит отвод провода с меткой цепи.
 * Так схема сразу совпадает с платой. Символы удалённых компонентов убирает.
 */
export function syncSymbolsFromBoard(p: Project): number {
  p.schematic ??= emptySchematic();
  const sch = p.schematic;
  for (const s of Object.values(sch.symbols)) if (!p.components[s.component]) delete sch.symbols[s.id];
  const have = new Set(Object.values(sch.symbols).map((s) => s.component));
  const todo = Object.values(p.components)
    .filter((c) => !have.has(c.id) && symbolDef(p.footprints[c.footprint]))
    .sort((a, b) => a.ref.localeCompare(b.ref, 'ru', { numeric: true }));
  if (!todo.length) return 0;
  // Куда ставить: правее уже нарисованного.
  let x0 = 20;
  for (const s of Object.values(sch.symbols)) {
    const def = symbolOf(p, s);
    if (def) x0 = Math.max(x0, s.at.x + def.box.max.x + 25);
  }
  const snap = (v: number) => Math.round(v / SCH_GRID) * SCH_GRID;
  let x = snap(x0);
  let y = snap(20);
  let rowH = 0;
  const rowW = 280;
  const startX = x;
  for (const c of todo) {
    const def = symbolDef(p.footprints[c.footprint])!;
    const w = def.box.max.x - def.box.min.x + 22;
    const h = def.box.max.y - def.box.min.y + 16;
    if (x + w > startX + rowW) {
      x = startX;
      y = snap(y + rowH);
      rowH = 0;
    }
    const at = { x: snap(x - def.box.min.x + 8), y: snap(y - def.box.min.y + 6) };
    const sym: SchSymbol = { id: newId('sy'), component: c.id, at, rotation: 0 };
    sch.symbols[sym.id] = sym;
    addPinLabels(p, sym);
    x += w;
    rowH = Math.max(rowH, h);
  }
  return todo.length;
}

/**
 * К каждому выводу символа с цепью — отвод провода на одну клетку и метка цепи
 * (для питания и земли — значок питания). Так схема совпадает с платой без проводов.
 */
export function addPinLabels(p: Project, sym: SchSymbol): void {
  const sch = (p.schematic ??= emptySchematic());
  const c = p.components[sym.component];
  const def = c ? symbolDef(p.footprints[c.footprint]) : null;
  if (!c || !def) return;
  for (const pin of def.pins) {
    const netId = c.padNets[pin.number];
    const net = netId ? p.nets[netId] : undefined;
    if (!net) continue;
    const pa = symToWorld(pin.at, sym.at, sym.rotation, sym.mirror);
    const pb = symToWorld(pin.base, sym.at, sym.rotation, sym.mirror);
    const L = Math.hypot(pa.x - pb.x, pa.y - pb.y) || 1;
    const d = { x: (pa.x - pb.x) / L, y: (pa.y - pb.y) / L };
    const end = { x: +(pa.x + d.x * SCH_GRID).toFixed(4), y: +(pa.y + d.y * SCH_GRID).toFixed(4) };
    const wire: SchWire = { id: newId('sw'), points: [pa, end] };
    sch.wires[wire.id] = wire;
    const rot = Math.abs(d.x) > 0.5 ? (d.x > 0 ? 0 : 180) : d.y < 0 ? 90 : 270;
    const label: SchLabel = { id: newId('sl'), at: end, text: net.name, rotation: rot, kind: POWER.test(net.name) ? 'power' : 'net' };
    sch.labels[label.id] = label;
  }
}
