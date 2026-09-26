import { newId } from '../ids';
import { boxOfPoints, pointInPolygon } from '../math/geom';
import { shapesTouch, makeShape, type Shape } from '../math/shape';
import { SpatialHash } from '../math/spatial-hash';
import type { Vec2 } from '../math/vec';
import { addTrack, addVia, addZone, addDrawing, ensureNet } from '../model/edit';
import { createProject } from '../model/project';
import { getWorld } from '../model/world';
import type { CopperLayer, FootprintDef, Graphic, LayerId, PadDef, Project } from '../model/types';

/*
 * Файлы Sprint Layout 5 и 6 (.lay, .lay6): двоичный формат программы на Delphi.
 * Разбор по описанию проекта xlay (github.com/sergey-raevskiy/xlay) и по файлам
 * пятой версии. Координаты: у версии 5 — сотые доли миллиметра, у 6 — десятитысячные;
 * ось Y направлена вверх. Слои: 1 — медь сверху (C1), 2 — шелкография сверху (S1),
 * 3 — медь снизу (C2), 4 — шелкография снизу (S2), 5 и 6 — внутренние, 7 — контур (O).
 */

export const LAY = { THT: 2, POLY: 4, CIRCLE: 5, LINE: 6, TEXT: 7, SMD: 8 } as const;

export interface LayComponentInfo {
  offX: number;
  offY: number;
  rotation: number;
  package: string;
  comment: string;
}

export interface LayObject {
  type: number;
  /** Номер объекта на плате (с нуля). */
  index: number;
  x: number;
  y: number;
  /** Площадка: внешний радиус; дуга: внешний радиус; текст: высота. */
  out: number;
  /** Площадка: радиус отверстия; дуга: внутренний радиус. */
  inn: number;
  /** Линия: ширина; дуга: конечный угол. */
  width: number;
  layer: number;
  /** Форма площадки: 1 — круг, 2 — восьмиугольник, 3 — квадрат. У текста 1 — есть данные компонента. */
  shape: number;
  startAngle: number;
  groundDistance: number;
  text: string;
  groups: number[];
  points: Vec2[];
  children: LayObject[];
  component?: LayComponentInfo;
  /** Связи площадки (номера объектов), если на плате нарисованы «резинки». */
  connections: number[];
}

export interface LayBoard {
  name: string;
  multilayer: boolean;
  objects: LayObject[];
}

export interface LayFile {
  version: number;
  /** Миллиметров в единице координат файла. */
  unit: number;
  boards: LayBoard[];
  projectName: string;
  author: string;
  comment: string;
}

class Reader {
  pos = 0;
  private dv: DataView;
  private dec = new TextDecoder('windows-1251');
  constructor(private buf: Uint8Array) {
    this.dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  need(n: number): void {
    if (this.pos + n > this.buf.length) throw new Error('файл обрывается раньше времени — он повреждён или не из Sprint Layout');
  }
  u8(): number {
    this.need(1);
    return this.buf[this.pos++];
  }
  u32(): number {
    this.need(4);
    const v = this.dv.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }
  f32(): number {
    this.need(4);
    const v = this.dv.getFloat32(this.pos, true);
    this.pos += 4;
    return v;
  }
  f64(): number {
    this.need(8);
    const v = this.dv.getFloat64(this.pos, true);
    this.pos += 8;
    return v;
  }
  skip(n: number): void {
    this.need(n);
    this.pos += n;
  }
  /** Строка фиксированной длины: байт длины + max байт. */
  fixstr(max: number): string {
    const len = Math.min(this.u8(), max);
    this.need(max);
    const s = this.dec.decode(this.buf.subarray(this.pos, this.pos + len));
    this.pos += max;
    return s;
  }
  /** Строка с длиной u32. */
  varstr(): string {
    const len = this.u32();
    if (len > 1 << 20) throw new Error('неверная длина строки в файле');
    this.need(len);
    const s = this.dec.decode(this.buf.subarray(this.pos, this.pos + len));
    this.pos += len;
    return s;
  }
  u32list(): number[] {
    const n = this.u32();
    if (n > 1 << 20) throw new Error('неверная длина списка в файле');
    const out: number[] = [];
    for (let i = 0; i < n; i++) out.push(this.u32());
    return out;
  }
}

const OBJ_HEADER = 77;

function readObject(r: Reader, index: number, child: boolean): LayObject {
  const start = r.pos;
  r.need(OBJ_HEADER);
  const type = r.u8();
  const x = r.f32();
  const y = r.f32();
  const out = r.f32();
  const inn = r.f32();
  const width = r.u32();
  r.skip(1);
  const layer = r.u8();
  const shape = r.u8();
  r.pos = start + 0x1f;
  const startAngle = r.u32();
  r.pos = start + 0x29;
  const groundDistance = r.u32();
  r.pos = start + OBJ_HEADER;
  const o: LayObject = { type, index, x, y, out, inn, width, layer, shape, startAngle, groundDistance, text: '', groups: [], points: [], children: [], connections: [] };
  if (!child) {
    o.text = r.varstr();
    r.varstr(); // метка (marker)
    o.groups = r.u32list();
  }
  if (type === LAY.CIRCLE) return o;
  if (type === LAY.TEXT) {
    const n = r.u32();
    if (n > 100000) throw new Error('неверное число штрихов текста');
    for (let i = 0; i < n; i++) o.children.push(readObject(r, index, true));
    if (shape === 1) {
      const offX = r.f32();
      const offY = r.f32();
      r.u8();
      const rotation = r.f64();
      const pkg = r.varstr();
      const comment = r.varstr();
      r.u8();
      o.component = { offX, offY, rotation, package: pkg, comment };
    }
    return o;
  }
  const n = r.u32();
  if (n > 1 << 20) throw new Error('неверное число точек');
  for (let i = 0; i < n; i++) o.points.push({ x: r.f32(), y: r.f32() });
  return o;
}

/** Разбор файла Sprint Layout 5/6. */
export function parseLay(buf: Uint8Array): LayFile {
  if (buf.length < 8 || buf[1] !== 0x33 || buf[2] !== 0xaa || buf[3] !== 0xff) throw new Error('это не файл Sprint Layout (.lay): не тот заголовок');
  const version = buf[0];
  if (version < 5 || version > 6) throw new Error(`версия файла ${version} не поддерживается (умею 5 и 6)`);
  const r = new Reader(buf);
  r.pos = 4;
  const nb = r.u32();
  if (nb < 1 || nb > 100) throw new Error('в файле нет плат');
  const boards: LayBoard[] = [];
  for (let b = 0; b < nb; b++) {
    const start = r.pos;
    const name = r.fixstr(30);
    r.pos = start + 0x211;
    const multilayer = r.u8() !== 0;
    const count = r.u32();
    if (count > 1 << 20) throw new Error('неверное число объектов на плате');
    const objects: LayObject[] = [];
    for (let i = 0; i < count; i++) objects.push(readObject(r, i, false));
    // Связи («резинки») — по одной записи на каждую площадку.
    for (const o of objects) if (o.type === LAY.THT || o.type === LAY.SMD) o.connections = r.u32list();
    boards.push({ name, multilayer, objects });
  }
  let projectName = '';
  let author = '';
  let comment = '';
  if (r.pos + 4 + 303 <= buf.length) {
    r.u32();
    projectName = r.fixstr(100);
    author = r.fixstr(100);
    r.fixstr(100);
    try {
      comment = r.varstr();
    } catch {
      comment = '';
    }
  }
  return { version, unit: version >= 6 ? 1e-4 : 1e-2, boards, projectName, author, comment };
}

/* ---------------- геометрия в миллиметрах ---------------- */

const r3 = (v: number) => Math.round(v * 1000) / 1000;

export interface LayPad {
  obj: LayObject;
  center: Vec2;
  def: Omit<PadDef, 'number' | 'at'>;
  layer: CopperLayer | 'both';
}

export interface LayGraphic {
  obj: LayObject;
  g: Graphic;
}

export interface LayGeometry {
  /** Точка файла → миллиметры Plata (ось Y вниз). */
  pt: (x: number, y: number) => Vec2;
  pads: LayPad[];
  tracks: { obj: LayObject; layer: CopperLayer; width: number; points: Vec2[] }[];
  zones: { obj: LayObject; layer: CopperLayer; outline: Vec2[]; clearance: number }[];
  graphics: LayGraphic[];
  outline: Vec2[] | null;
  cutouts: Vec2[][];
  /** Объекты, из которых получился контур (не переносить как медь). */
  outlineObjects: Set<LayObject>;
  warnings: string[];
  copperTop: boolean;
  copperBottom: boolean;
}

const COPPER: Record<number, CopperLayer | undefined> = { 1: 'F.Cu', 3: 'B.Cu' };
const SILK: Record<number, LayerId | undefined> = { 2: 'F.Silk', 4: 'B.Silk', 7: 'Edge.Cuts' };

/** Соединяет отрезки в замкнутые контуры. */
function chainLoops(segs: [Vec2, Vec2][], eps: number): Vec2[][] {
  const left = segs.slice();
  const loops: Vec2[][] = [];
  const same = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y) < eps;
  while (left.length) {
    const [a, b] = left.shift()!;
    const loop = [a, b];
    let grown = true;
    while (grown && !same(loop[0], loop[loop.length - 1])) {
      grown = false;
      for (let i = 0; i < left.length; i++) {
        const [p, q] = left[i];
        const end = loop[loop.length - 1];
        if (same(p, end)) loop.push(q);
        else if (same(q, end)) loop.push(p);
        else continue;
        left.splice(i, 1);
        grown = true;
        break;
      }
    }
    if (loop.length >= 4 && same(loop[0], loop[loop.length - 1])) loops.push(loop.slice(0, -1));
  }
  return loops;
}

const polyArea = (pts: Vec2[]) => {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s / 2);
};

/** Переводит объекты платы в миллиметры и фигуры Plata. */
export function layGeometry(lay: LayFile, board = 0): LayGeometry {
  const b = lay.boards[board];
  if (!b) throw new Error('в файле нет такой платы');
  const u = lay.unit;
  const pt = (x: number, y: number): Vec2 => ({ x: r3(x * u), y: r3(-y * u) });
  const warnings: string[] = [];
  const pads: LayPad[] = [];
  const tracks: LayGeometry['tracks'] = [];
  const zones: LayGeometry['zones'] = [];
  const graphics: LayGraphic[] = [];
  let inner = 0;
  const angleUnit = lay.version >= 6 ? 1000 : 1;
  let copperTop = false;
  let copperBottom = false;

  for (const o of b.objects) {
    if (o.layer === 5 || o.layer === 6) {
      inner++;
      continue;
    }
    if (o.type === LAY.THT || o.type === LAY.SMD) {
      const c = pt(o.x, o.y);
      const pts = o.points.map((q) => pt(q.x, q.y));
      if (o.type === LAY.THT) {
        const d = r3(2 * o.out * u);
        const drill = r3(2 * o.inn * u);
        let def: LayPad['def'] = { type: 'tht', shape: 'circle', size: { x: d, y: d }, drill: drill > 0 ? drill : undefined };
        if (o.shape === 3 || o.shape === 2) {
          const bx = pts.length ? boxOfPoints(pts) : { minX: c.x - d / 2, minY: c.y - d / 2, maxX: c.x + d / 2, maxY: c.y + d / 2 };
          def = { ...def, shape: o.shape === 3 ? 'rect' : 'roundrect', roundness: o.shape === 2 ? 0.3 : undefined, size: { x: r3(bx.maxX - bx.minX), y: r3(bx.maxY - bx.minY) } };
        } else if (pts.length === 2) {
          // Две точки — концы площадки: у круглой они на расстоянии диаметра, у вытянутой — дальше.
          const len = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
          if (len > d + 0.01) {
            const rot = r3((Math.atan2(-(pts[1].y - pts[0].y), pts[1].x - pts[0].x) * 180) / Math.PI);
            def = { ...def, shape: 'oval', size: { x: r3(len), y: d }, rotation: ((rot % 180) + 180) % 180 || undefined };
          }
        }
        if (!def.drill) def = { ...def, drill: Math.min(0.8, d / 2) };
        pads.push({ obj: o, center: c, def, layer: 'both' });
        copperBottom = copperBottom || o.layer === 3;
        copperTop = copperTop || o.layer === 1;
      } else {
        const layer = COPPER[o.layer];
        if (!layer || pts.length < 4) continue;
        const w = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        const h = Math.hypot(pts[2].x - pts[1].x, pts[2].y - pts[1].y);
        const rot = (Math.atan2(-(pts[1].y - pts[0].y), pts[1].x - pts[0].x) * 180) / Math.PI;
        const cx = pts.reduce((s, q) => s + q.x, 0) / pts.length;
        const cy = pts.reduce((s, q) => s + q.y, 0) / pts.length;
        pads.push({ obj: o, center: { x: r3(cx), y: r3(cy) }, def: { type: 'smd', shape: 'rect', size: { x: r3(w), y: r3(h) }, rotation: Math.round(rot) % 360 || undefined }, layer });
        if (layer === 'F.Cu') copperTop = true;
        else copperBottom = true;
      }
      continue;
    }
    const cu = COPPER[o.layer];
    const silk = SILK[o.layer];
    if (o.type === LAY.LINE) {
      const pts = o.points.map((q) => pt(q.x, q.y));
      if (pts.length < 2) continue;
      const w = r3(o.width * u);
      if (cu) {
        tracks.push({ obj: o, layer: cu, width: w, points: pts });
        if (cu === 'F.Cu') copperTop = true;
        else copperBottom = true;
      } else if (silk) graphics.push({ obj: o, g: { kind: 'poly', layer: silk, pts, width: Math.max(0.05, w), closed: false } });
    } else if (o.type === LAY.POLY) {
      const pts = o.points.map((q) => pt(q.x, q.y));
      if (pts.length >= 2 && Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) < 1e-3) pts.pop();
      if (pts.length < 3) continue;
      if (cu) {
        zones.push({ obj: o, layer: cu, outline: pts, clearance: r3(Math.max(0.2, o.groundDistance * u)) });
        if (cu === 'F.Cu') copperTop = true;
        else copperBottom = true;
      } else if (silk) graphics.push({ obj: o, g: { kind: 'poly', layer: silk, pts, width: 0.1, fill: o.layer !== 7, closed: true } });
    } else if (o.type === LAY.CIRCLE) {
      const c = pt(o.x, o.y);
      const r = r3(((o.out + o.inn) / 2) * u);
      const w = r3(Math.max(0.05, (o.out - o.inn) * u));
      const a0 = o.startAngle / angleUnit;
      const a1 = o.width / angleUnit;
      const sweep = r3((((a1 - a0) % 360) + 360) % 360);
      const layer = silk ?? cu;
      if (!layer) continue;
      if (sweep === 0) graphics.push({ obj: o, g: { kind: 'circle', layer, c, r, width: w } });
      else graphics.push({ obj: o, g: { kind: 'arc', layer, c, r, start: a0, sweep, width: w } });
    } else if (o.type === LAY.TEXT) {
      const layer = silk ?? cu;
      if (!layer) continue;
      // Текст хранится готовыми штрихами — переносим их как есть.
      for (const ch of o.children) {
        const pts = ch.points.map((q) => pt(q.x, q.y));
        if (ch.type === LAY.LINE && pts.length >= 2) graphics.push({ obj: o, g: { kind: 'poly', layer: silk ?? 'F.Silk', pts, width: Math.max(0.05, r3(ch.width * u)), closed: false } });
      }
    }
  }
  if (inner) warnings.push(`Объекты на внутренних слоях (${inner}) пропущены: Plata делает платы с одним и двумя слоями.`);

  // Контур: слой O, иначе — тонкая замкнутая линия вокруг всего остального.
  const outlineObjects = new Set<LayObject>();
  let outline: Vec2[] | null = null;
  const cutouts: Vec2[][] = [];
  const edgeSegs: [Vec2, Vec2][] = [];
  for (const g of graphics)
    if (g.g.layer === 'Edge.Cuts') {
      outlineObjects.add(g.obj);
      if (g.g.kind === 'poly') {
        const p = g.g.pts;
        for (let i = 0; i < p.length - 1; i++) edgeSegs.push([p[i], p[i + 1]]);
        if (g.g.closed) edgeSegs.push([p[p.length - 1], p[0]]);
      }
    }
  let loops = chainLoops(edgeSegs, 0.05);
  if (!loops.length) {
    const all: Vec2[] = [...pads.map((p) => p.center), ...tracks.flatMap((t) => t.points)];
    if (all.length) {
      const box = boxOfPoints(all);
      // Тонкая замкнутая линия, внутри которой всё остальное, — это контур, нарисованный медью или шелкографией.
      for (const t of [...tracks.map((t) => ({ obj: t.obj, pts: t.points, w: t.width })), ...graphics.filter((g) => g.g.kind === 'poly').map((g) => ({ obj: g.obj, pts: (g.g as { pts: Vec2[] }).pts, w: (g.g as { width: number }).width }))]) {
        if (t.w > 0.35 || t.pts.length < 4) continue;
        const lb = boxOfPoints(t.pts);
        if (lb.minX > box.minX + 0.01 || lb.minY > box.minY + 0.01 || lb.maxX < box.maxX - 0.01 || lb.maxY < box.maxY - 0.01) continue;
        const segs: [Vec2, Vec2][] = [];
        for (let i = 0; i < t.pts.length - 1; i++) segs.push([t.pts[i], t.pts[i + 1]]);
        const l = chainLoops(segs, 0.05);
        if (l.length) {
          loops = l;
          outlineObjects.add(t.obj);
          break;
        }
      }
    }
  }
  if (loops.length) {
    loops.sort((a, b) => polyArea(b) - polyArea(a));
    outline = loops[0];
    for (const l of loops.slice(1)) if (pointInPolygon(l[0], outline)) cutouts.push(l);
  }
  return {
    pt,
    pads,
    tracks: tracks.filter((t) => !outlineObjects.has(t.obj)),
    zones,
    graphics: graphics.filter((g) => !outlineObjects.has(g.obj) && g.g.layer !== 'Edge.Cuts'),
    outline,
    cutouts,
    outlineObjects,
    warnings,
    copperTop,
    copperBottom,
  };
}

/* ---------------- цепи по меди ---------------- */

/**
 * Раздаёт цепи по связности меди: площадки, которых касается одна и та же медь,
 * получают общую цепь. Нужна, когда в файле нет списка цепей (как у Sprint Layout).
 * name(pads) — имя цепи по её площадкам; по умолчанию «Net-(R1-Pad2)».
 */
export function netsFromCopper(p: Project, name?: (pads: { ref: string; pad: string }[]) => string | null): number {
  const w = getWorld(p);
  type Item = { key: string; shape: Shape; layers: CopperLayer[]; pad?: { comp: string; ref: string; pad: string } };
  const items: Item[] = [];
  for (const wp of w.pads) if (wp.layers.length && wp.pad.type !== 'npth') items.push({ key: 'P' + wp.key, shape: wp.shape, layers: wp.layers, pad: { comp: wp.component.id, ref: wp.component.ref, pad: wp.pad.number } });
  for (const s of w.segments) items.push({ key: `T${s.track.id}:${s.index}`, shape: s.shape, layers: [s.track.layer] });
  for (const v of w.vias) items.push({ key: 'V' + v.via.id, shape: v.shape, layers: ['F.Cu', 'B.Cu'] });
  for (const z of Object.values(p.zones)) items.push({ key: 'Z' + z.id, shape: makeShape(z.outline, 0), layers: [z.layer] });
  const parent = items.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  const hash = new SpatialHash<number>(2);
  items.forEach((it, i) => hash.insert(i, it.shape.box));
  items.forEach((it, i) => {
    for (const j of hash.query(it.shape.box)) {
      if (j <= i) continue;
      const other = items[j];
      if (!it.layers.some((l) => other.layers.includes(l))) continue;
      if (find(i) === find(j)) continue;
      if (shapesTouch(it.shape, other.shape, 1e-3)) parent[find(i)] = find(j);
    }
  });
  // Перемычки соединяют площадки на концах.
  for (const wire of w.wires) {
    const at = (q: Vec2) => items.findIndex((it) => it.pad && Math.hypot(it.shape.pts[0].x - q.x, it.shape.pts[0].y - q.y) < 0.05);
    const a = at(wire.a);
    const b = at(wire.b);
    if (a >= 0 && b >= 0) parent[find(a)] = find(b);
  }
  const groups = new Map<number, Item[]>();
  items.forEach((it, i) => {
    const r = find(i);
    groups.set(r, [...(groups.get(r) ?? []), it]);
  });
  let n = 0;
  const used = new Set<string>();
  for (const members of groups.values()) {
    const padsIn = members.filter((m) => m.pad).map((m) => m.pad!);
    if (padsIn.length < 2 && !members.some((m) => m.key.startsWith('Z'))) continue;
    if (!padsIn.length) continue;
    padsIn.sort((a, b) => a.ref.localeCompare(b.ref, 'ru', { numeric: true }) || a.pad.localeCompare(b.pad, 'ru', { numeric: true }));
    let nm = name?.(padsIn) ?? `Net-(${padsIn[0].ref}-Pad${padsIn[0].pad})`;
    if (used.has(nm)) nm = `${nm}_${n}`;
    used.add(nm);
    const net = ensureNet(p, nm);
    for (const m of padsIn) p.components[m.comp].padNets[m.pad] = net.id;
    for (const m of members) if (m.key.startsWith('Z')) p.zones[m.key.slice(1)].net = net.id;
    n++;
  }
  return n;
}

/* ---------------- плата целиком ---------------- */

export interface LayImportResult {
  project: Project;
  warnings: string[];
}

/**
 * Плата Sprint Layout → проект Plata. Группы объектов с площадками становятся
 * компонентами со своими корпусами (обозначения E1, E2…), отдельные площадки —
 * переходными отверстиями, медные линии — дорожками, полигоны меди — заливкой,
 * шелкография — рисунками. Цепи восстанавливаются по связности меди.
 */
export function layToProject(lay: LayFile, o: { board?: number; name?: string } = {}): LayImportResult {
  const board = lay.boards[o.board ?? 0];
  const geo = layGeometry(lay, o.board ?? 0);
  const warnings = [...geo.warnings];
  const p = createProject({ name: o.name || lay.projectName || board.name || 'Плата из Sprint Layout', homemade: true, copperLayers: geo.copperTop && geo.copperBottom ? 2 : 1 });
  // Односторонняя плата с медью сверху: в Plata медь односторонней платы снизу.
  const flipCu = !geo.copperBottom && geo.copperTop;
  const cu = (l: CopperLayer): CopperLayer => (flipCu ? 'B.Cu' : l);

  // Сдвиг в начало координат.
  const allPts = [...(geo.outline ?? []), ...geo.pads.map((q) => q.center), ...geo.tracks.flatMap((t) => t.points)];
  if (!allPts.length) throw new Error('на плате нет ни площадок, ни дорожек');
  const box = boxOfPoints(allPts);
  const margin = geo.outline ? 0 : 2;
  const dx = -box.minX + margin;
  const dy = -box.minY + margin;
  const mv = (q: Vec2): Vec2 => ({ x: r3(q.x + dx), y: r3(q.y + dy) });
  p.board.outline = geo.outline ? geo.outline.map(mv) : [mv({ x: box.minX - margin, y: box.minY - margin }), mv({ x: box.maxX + margin, y: box.minY - margin }), mv({ x: box.maxX + margin, y: box.maxY + margin }), mv({ x: box.minX - margin, y: box.maxY + margin })];
  p.board.cutouts = geo.cutouts.map((c) => c.map(mv));
  if (!geo.outline) warnings.push('Контура платы в файле нет — взят прямоугольник вокруг всех объектов с полем 2 мм.');

  // Группы: для каждой площадки — самая маленькая группа, где площадок больше одной.
  const size = new Map<number, number>();
  const padCount = new Map<number, number>();
  for (const ob of board.objects)
    for (const g of ob.groups) {
      size.set(g, (size.get(g) ?? 0) + 1);
      if (ob.type === LAY.THT || ob.type === LAY.SMD) padCount.set(g, (padCount.get(g) ?? 0) + 1);
    }
  const groupOf = (ob: LayObject, pads: boolean) => {
    const cand = ob.groups.filter((g) => !pads || (padCount.get(g) ?? 0) >= 2).sort((a, b) => (size.get(a) ?? 0) - (size.get(b) ?? 0));
    return cand[0];
  };
  const byGroup = new Map<number, LayPad[]>();
  const single: LayPad[] = [];
  for (const pad of geo.pads) {
    const g = groupOf(pad.obj, true);
    if (g === undefined) single.push(pad);
    else byGroup.set(g, [...(byGroup.get(g) ?? []), pad]);
  }
  const compGroups = new Set(byGroup.keys());
  const gfxByGroup = new Map<number, LayGraphic[]>();
  const loose: LayGraphic[] = [];
  for (const g of geo.graphics) {
    const grp = g.obj.groups.filter((x) => compGroups.has(x)).sort((a, b) => (size.get(a) ?? 0) - (size.get(b) ?? 0))[0];
    if (grp === undefined) loose.push(g);
    else gfxByGroup.set(grp, [...(gfxByGroup.get(grp) ?? []), g]);
  }

  let k = 0;
  const toTop = (l: LayerId): LayerId => (l.startsWith('B.') ? (('F.' + l.slice(2)) as LayerId) : l);
  for (const [g, pads] of byGroup) {
    k++;
    const c = { x: 0, y: 0 };
    for (const q of pads) {
      c.x += q.center.x / pads.length;
      c.y += q.center.y / pads.length;
    }
    const at = mv({ x: r3(c.x), y: r3(c.y) });
    // Планарные площадки только снизу — деталь стоит на нижней стороне (корпус зеркалится по X).
    const bottom = !flipCu && pads.every((q) => q.layer === 'B.Cu');
    const rel = (q: Vec2): Vec2 => ({ x: r3((bottom ? -1 : 1) * (q.x + dx - at.x)), y: r3(q.y + dy - at.y) });
    const fp: FootprintDef = {
      id: `SL_${k}_${newId('fp').slice(3)}`,
      name: `Sprint Layout ${pads.length} выв.`,
      category: 'Импорт',
      group: 'Sprint Layout',
      refPrefix: 'E',
      pads: pads.map((q, i) => ({ number: String(i + 1), at: rel(q.center), ...q.def, rotation: q.def.rotation && bottom ? -q.def.rotation : q.def.rotation })),
      graphics: (gfxByGroup.get(g) ?? []).map((x) => {
        const m = moveGraphic(x.g, rel);
        return bottom ? { ...m, layer: toTop(m.layer) } : m;
      }),
      verified: false,
    };
    const b = boxOfPoints(fp.pads.flatMap((q) => [
      { x: q.at.x - q.size.x / 2, y: q.at.y - q.size.y / 2 },
      { x: q.at.x + q.size.x / 2, y: q.at.y + q.size.y / 2 },
    ]));
    fp.courtyard = { min: { x: r3(b.minX - 0.25), y: r3(b.minY - 0.25) }, max: { x: r3(b.maxX + 0.25), y: r3(b.maxY + 0.25) } };
    p.footprints[fp.id] = fp;
    const id = newId('c');
    p.components[id] = { id, ref: `E${k}`, value: '', footprint: fp.id, at, rotation: 0, side: bottom ? 'bottom' : 'top', padNets: {} };
  }
  for (const q of single) {
    if (q.def.type === 'tht') addVia(p, { at: mv(q.center), diameter: Math.max(q.def.size.x, q.def.size.y), drill: q.def.drill ?? 0.8 });
    else {
      k++;
      const fp: FootprintDef = { id: `SL_pad_${k}`, name: 'Площадка', category: 'Импорт', group: 'Sprint Layout', refPrefix: 'E', pads: [{ number: '1', at: { x: 0, y: 0 }, ...q.def }], graphics: [] };
      p.footprints[fp.id] = fp;
      const id = newId('c');
      p.components[id] = { id, ref: `E${k}`, value: '', footprint: fp.id, at: mv(q.center), rotation: 0, side: q.layer === 'B.Cu' && !flipCu ? 'bottom' : 'top', padNets: {} };
    }
  }
  for (const t of geo.tracks) {
    if (t.width <= 0) continue;
    addTrack(p, { layer: cu(t.layer), width: t.width, points: t.points.map(mv) });
  }
  for (const z of geo.zones) addZone(p, { layer: cu(z.layer), net: null, outline: z.outline.map(mv), clearance: z.clearance, minWidth: 0.2, priority: 0, padConnection: 'solid' });
  for (const g of loose) addDrawing(p, moveGraphic(g.g, mv));
  netsFromCopper(p);
  if (single.length) warnings.push(`Одиночные площадки (${single.length}) стали переходными отверстиями.`);
  // Кеши геометрии привязаны к объекту — отдаём свежую копию.
  return { project: structuredClone(p), warnings };
}

/** Графика с пересчётом точек. */
export function moveGraphic(g: Graphic, f: (q: Vec2) => Vec2): Graphic {
  switch (g.kind) {
    case 'line':
    case 'rect':
    case 'dimension':
      return { ...g, a: f(g.a), b: f(g.b) };
    case 'circle':
    case 'arc':
      return { ...g, c: f(g.c) };
    case 'poly':
      return { ...g, pts: g.pts.map(f) };
    case 'text':
      return { ...g, at: f(g.at) };
  }
}
