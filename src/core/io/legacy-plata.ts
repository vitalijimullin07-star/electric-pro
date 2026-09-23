import { libraryFootprint, mountingHole } from '../library';
import { dist, type Vec2 } from '../math/vec';
import { addComponent, addRuleArea, addTrack, addVia, addWire, connectPad, ensureFootprint, ensureNet } from '../model/edit';
import { dirToWorld, toWorld, type Placement } from '../model/placement';
import { createProject, rectOutline } from '../model/project';
import { MAINS_CLASS, MAINS_CLEARANCE } from '../model/rules';
import type { Component, FootprintDef, PadDef, Project, Side } from '../model/types';
import { CRT_THT, courtyardAround, crtGraphic, fp as makeFp, rect, refText, tht, valueText } from '../library/generators/util';

/*
 * Импорт плат первой версии Plata: координаты в единицах 0,254 мм, один слой меди,
 * компоненты описаны кодом, разводка — списком дорожек с концами трёх видов.
 */

export const LEGACY_UNIT = 0.254;

export interface LegacyPin {
  id: string;
  t: string;
  dx: number;
  dy: number;
  side: 't' | 'b' | 'l' | 'r' | null;
  i: number;
}

export interface LegacyComp {
  ref: string;
  name: string;
  short: string;
  x: number;
  y: number;
  kind: 'mod' | 'pass';
  pins?: LegacyPin[];
  pad?: 'hdr' | 'term' | 'hlk' | 'to92';
  fp?: string;
  val?: string;
  alt?: string[];
  pol?: [string, string];
  /** Корпус из новой библиотеки, на который заменяется описание. */
  lib?: string;
}

export type LegacyEndpoint = string | { t: number; x: number; y: number } | { x: number; y: number };
export interface LegacyTrace {
  id: number;
  a: LegacyEndpoint;
  b: LegacyEndpoint;
  pts: [number, number][];
  w: number;
  layer: 'cu' | 'jw';
}

export interface LegacyBoard {
  id: string;
  title: string;
  description?: string;
  w: number;
  h: number;
  mainsY: number;
  powerNets: string[];
  comps: LegacyComp[];
  nets: [string, string, string, 'm'?][];
  routing: { traces: LegacyTrace[]; nid: number };
}

/** Сохранённый проект старой версии (localStorage или файл). */
export interface LegacyProjectFile {
  bw: number;
  bh: number;
  grid?: number;
  comps: Record<string, [number, number, number, number, string | null]>;
  traces: LegacyTrace[];
  nid?: number;
}

export function isLegacyProjectFile(o: unknown): o is LegacyProjectFile {
  return !!o && typeof o === 'object' && 'comps' in o && 'traces' in o && !('format' in o);
}

/* Старые корпуса двухвыводных деталей → новая библиотека. */
const PASS_FP: Record<string, string> = {
  r1206: 'R_1206_3216Metric',
  c1206: 'C_1206_3216Metric',
  rTH: 'R_Axial_0.25W_L6.3mm_D2.5mm_P10.16mm_Horizontal',
  r1W: 'R_Axial_1W_L11mm_D4mm_P15.24mm_Horizontal',
  cTH: 'C_Rect_L7.2mm_W2.5mm_P5.08mm',
  elec: 'CP_Radial_D8mm_P3.5mm',
  varist: 'RV_Disc_D14mm_P7.5mm',
  fuse: 'Fuseholder_Clip-5x20mm_P22.6mm_Horizontal',
  buz: 'Buzzer_12x9.5RM7.6',
};
const PASS_PITCH: Record<string, number> = { r1206: 12, c1206: 12, rTH: 40, r1W: 60, cTH: 20, elec: 14, varist: 30, fuse: 90, buz: 30 };
const PAD_SIZE: Record<string, { pad: number; drill: number }> = {
  hdr: { pad: 1.8, drill: 1.0 },
  term: { pad: 2.8, drill: 1.3 },
  hlk: { pad: 2.5, drill: 1.2 },
  to92: { pad: 1.7, drill: 0.8 },
};

/** Старое преобразование: зеркало по X, затем rot поворотов на 90° по часовой (на экране). */
function legacyT(c: { x: number; y: number; rot: number; mir: number }, lx: number, ly: number): Vec2 {
  let x = c.mir ? -lx : lx;
  let y = ly;
  for (let i = 0; i < c.rot; i++) {
    const t = x;
    x = -y;
    y = t;
  }
  return { x: c.x + x, y: c.y + y };
}

const mm = (u: number): number => Math.round((u - 10) * LEGACY_UNIT * 1e4) / 1e4;
const mmLen = (u: number): number => Math.round(u * LEGACY_UNIT * 1e4) / 1e4;

/** Пины старого компонента с их положением на плате (в мм). */
function legacyPins(c: LegacyComp, st: { x: number; y: number; rot: number; mir: number; fp?: string | null }): { id: string; name: string; at: Vec2 }[] {
  if (c.kind === 'pass') {
    const pitch = PASS_PITCH[st.fp || c.fp || 'r1206'] ?? 12;
    const [a, b] = c.pol ?? ['1', '2'];
    return [
      { id: a, name: a, at: legacyT(st, 0, 0) },
      { id: b, name: b, at: legacyT(st, pitch, 0) },
    ].map((p) => ({ ...p, at: { x: mm(p.at.x), y: mm(p.at.y) } }));
  }
  return (c.pins ?? []).map((p) => {
    const q = legacyT(st, p.dx, p.dy);
    return { id: p.id, name: p.t, at: { x: mm(q.x), y: mm(q.y) } };
  });
}

/** Корпус «как было»: круглые площадки по старым координатам пинов. */
function customFootprint(c: LegacyComp): FootprintDef {
  const sz = PAD_SIZE[c.pad ?? 'hdr'];
  const pins = c.pins ?? [];
  const cx = pins.reduce((s, p) => s + p.dx, 0) / pins.length;
  const cy = pins.reduce((s, p) => s + p.dy, 0) / pins.length;
  const pads: PadDef[] = pins.map((p, i) => tht(p.id, mmLen(p.dx - cx), mmLen(p.dy - cy), sz.pad, sz.pad, sz.drill, i === 0 ? 'rect' : 'circle', p.t !== p.id ? { name: p.t } : {}));
  const xs = pads.map((p) => p.at.x);
  const ys = pads.map((p) => p.at.y);
  const body = { x0: Math.min(...xs) - 1.3, y0: Math.min(...ys) - 1.3, x1: Math.max(...xs) + 1.3, y1: Math.max(...ys) + 1.3 };
  const crt = courtyardAround(pads, body, CRT_THT);
  return makeFp({
    id: `Legacy_${c.ref}_${pins.length}pin`,
    name: `${c.short} (${pins.length})`,
    description: `${c.name}: корпус перенесён из старой платы как есть`,
    category: 'Проект',
    tags: ['legacy'],
    refPrefix: c.ref.replace(/\d+$/, ''),
    pads,
    graphics: [rect('F.Fab', body.x0, body.y0, body.x1, body.y1), rect('F.Silk', body.x0 - 0.06, body.y0 - 0.06, body.x1 + 0.06, body.y1 + 0.06), crtGraphic(crt), refText(crt.min.y - 0.7), valueText(crt.max.y + 0.7)],
    courtyard: crt,
    source: 'Plata v1',
    verified: false,
  });
}

/** Однорядный разъём по старым пинам: PinHeader_1xN. */
function headerFor(c: LegacyComp): FootprintDef | undefined {
  const pins = c.pins ?? [];
  if (pins.length < 1) return undefined;
  const pitch = pins.length > 1 ? Math.hypot(pins[1].dx - pins[0].dx, pins[1].dy - pins[0].dy) : 10;
  if (Math.abs(pitch - 10) > 0.01) return undefined;
  const inLine = pins.every((p, i) => Math.abs(p.dx - pins[0].dx - (pins[0].dy === pins[1]?.dy ? i * 10 : 0)) < 0.01 || Math.abs(p.dy - pins[0].dy - (pins[0].dx === pins[1]?.dx ? i * 10 : 0)) < 0.01);
  if (!inLine) return undefined;
  const base = libraryFootprint(`PinHeader_1x${String(pins.length).padStart(2, '0')}_P2.54mm`);
  if (!base) return undefined;
  // Копия с именами выводов из старого описания.
  const pads = base.pads.map((pd, i) => ({ ...pd, name: pins[i]?.t && pins[i].t !== pd.number ? pins[i].t : undefined }));
  return { ...base, id: `${base.id}__${c.ref}`, name: `${c.short}`, description: `${c.name} (${base.description})`, pads, category: 'Разъёмы' };
}

/**
 * Подбирает положение нового корпуса так, чтобы его площадки легли на старые пины.
 * Возвращает размещение и соответствие «старый пин → номер площадки».
 */
function fitFootprint(fp: FootprintDef, pins: { id: string; at: Vec2 }[], firstPad: string, tol = 0.35): { pl: Placement; map: Record<string, string> } | null {
  const first = fp.pads.find((p) => p.number === firstPad);
  if (!first) return null;
  const real = fp.pads.filter((p) => p.type !== 'npth');
  // Планарные детали на односторонней плате стоят со стороны меди, то есть снизу.
  const sides: Side[] = real.every((p) => p.type === 'smd') ? ['bottom'] : ['top', 'bottom'];
  for (const side of sides)
    for (const rotation of [0, 270, 180, 90]) {
      const pl0: Placement = { at: { x: 0, y: 0 }, rotation, side };
      const d = dirToWorld(pl0, first.at);
      const pl: Placement = { at: { x: pins[0].at.x - d.x, y: pins[0].at.y - d.y }, rotation, side };
      const map: Record<string, string> = {};
      const used = new Set<string>();
      let ok = true;
      for (const pin of pins) {
        let best: { n: string; d: number } | null = null;
        for (const pd of real) {
          if (used.has(pd.number)) continue;
          const dd = dist(toWorld(pl, pd.at), pin.at);
          if (!best || dd < best.d) best = { n: pd.number, d: dd };
        }
        if (!best || best.d > tol) {
          ok = false;
          break;
        }
        used.add(best.n);
        map[pin.id] = best.n;
      }
      if (ok) {
        pl.at = { x: Math.round(pl.at.x * 1e3) / 1e3, y: Math.round(pl.at.y * 1e3) / 1e3 };
        return { pl, map };
      }
    }
  return null;
}

export interface LegacyImportResult {
  project: Project;
  /** Компоненты, для которых пришлось оставить старый корпус. */
  customFootprints: string[];
}

/** Строит новый проект из описания старой платы; saved — сохранённое состояние старой версии, если есть. */
export function convertLegacyBoard(board: LegacyBoard, saved?: LegacyProjectFile | null): LegacyImportResult {
  const bw = saved?.bw ?? board.w;
  const bh = saved?.bh ?? board.h;
  const W = mmLen(bw - 20);
  const H = mmLen(bh - 20);
  const p = createProject({ name: board.title, width: W, height: H, copperLayers: 1, homemade: true, template: 'legacy:' + board.id });
  p.meta.description = board.description;
  p.board.outline = rectOutline(W, H);
  p.board.cornerRadius = 2;
  p.netClasses.Mains = { ...MAINS_CLASS };
  p.rules.classClearances = [{ a: 'Mains', b: '*', clearance: MAINS_CLEARANCE }];

  // Крепёжные отверстия по углам, как на старой плате (14 единиц от края).
  const hole = mountingHole(3);
  const m = mmLen(14);
  [
    [m, m],
    [W - m, m],
    [m, H - m],
    [W - m, H - m],
  ].forEach(([x, y], i) => addComponent(p, hole, { x, y }, { ref: `H${i + 1}`, excludeFromBom: true }));

  // Зона 230 В.
  const zy = mm(board.mainsY);
  addRuleArea(p, {
    name: 'Зона 230 В',
    outline: [
      { x: 0, y: zy },
      { x: W, y: zy },
      { x: W, y: H },
      { x: 0, y: H },
    ],
    onlyClasses: ['Mains'],
    showLabel: true,
  });

  const customFootprints: string[] = [];
  const padOf: Record<string, { comp: Component; pad: string }> = {};
  const mains = new Set(board.nets.filter((n) => n[3] === 'm').map((n) => n[0]));
  const power = new Set(board.powerNets);

  for (const c of board.comps) {
    const sv = saved?.comps?.[c.ref];
    const st = { x: sv?.[0] ?? c.x, y: sv?.[1] ?? c.y, rot: sv?.[2] ?? 0, mir: sv?.[3] ?? 0, fp: sv?.[4] ?? c.fp };
    const pins = legacyPins(c, st);
    let fp: FootprintDef | undefined;
    let firstPad = '1';
    let alternatives: string[] | undefined;
    if (c.kind === 'pass') {
      fp = libraryFootprint(PASS_FP[st.fp || c.fp || 'r1206']);
      alternatives = c.alt?.map((a) => PASS_FP[a]).filter((a): a is string => !!a && libraryFootprint(a) !== undefined);
    } else if (c.lib) fp = libraryFootprint(c.lib);
    if (!fp && c.kind === 'mod') fp = headerFor(c);
    let fit = fp ? fitFootprint(fp, pins, firstPad) : null;
    if (!fit && c.kind === 'mod') {
      fp = customFootprint(c);
      customFootprints.push(c.ref);
      firstPad = pins[0].id;
      fit = fitFootprint(fp, pins, firstPad, 0.05);
    }
    if (!fp || !fit) throw new Error(`Не удалось разместить ${c.ref}`);
    for (const a of alternatives ?? []) {
      const afp = libraryFootprint(a);
      if (afp) ensureFootprint(p, afp);
    }
    const comp = addComponent(p, fp, fit.pl.at, {
      rotation: fit.pl.rotation,
      side: fit.pl.side,
      ref: c.ref,
      value: c.kind === 'pass' ? (c.val ?? '') : c.short,
      description: c.name,
      alternatives: alternatives && alternatives.length > 1 ? alternatives : undefined,
    });
    for (const pin of pins) padOf[`${c.ref}.${pin.id}`] = { comp, pad: fit.map[pin.id] };
  }

  for (const [name, desc, members, flag] of board.nets) {
    const net = ensureNet(p, name, { description: desc, netClass: flag === 'm' || mains.has(name) ? 'Mains' : power.has(name) ? 'Power' : 'Default' });
    for (const k of members.split(' ').filter(Boolean)) {
      const t = padOf[k];
      if (!t) throw new Error(`Цепь ${name}: нет вывода ${k}`);
      connectPad(p, t.comp.id, t.pad, net.id);
    }
  }

  // Дорожки. Концы: вывод → центр площадки; точка на дорожке или свободная точка → координата.
  const traces = saved?.traces ?? board.routing.traces;
  const viaAt = new Map<string, Vec2>();
  const needVia = (q: Vec2) => {
    const key = `${q.x.toFixed(2)},${q.y.toFixed(2)}`;
    if (!viaAt.has(key)) viaAt.set(key, q);
  };
  const epPoint = (e: LegacyEndpoint): Vec2 | null => {
    if (typeof e === 'string') {
      const t = padOf[e];
      if (!t) return null;
      const fpDef = p.footprints[t.comp.footprint];
      const pd = fpDef.pads.find((x) => x.number === t.pad)!;
      const q = toWorld({ at: t.comp.at, rotation: t.comp.rotation, side: t.comp.side }, pd.at);
      return { x: Math.round(q.x * 1e3) / 1e3, y: Math.round(q.y * 1e3) / 1e3 };
    }
    return { x: mm(e.x), y: mm(e.y) };
  };
  for (const t of traces) {
    const a = epPoint(t.a);
    const b = epPoint(t.b);
    if (!a || !b) continue;
    const mid = (t.pts ?? []).map(([x, y]) => ({ x: mm(x), y: mm(y) }));
    if (t.layer === 'jw') {
      if (typeof t.a !== 'string') needVia(a);
      if (typeof t.b !== 'string') needVia(b);
      addWire(p, a, b);
    } else {
      if (typeof t.a === 'object' && !('t' in t.a)) needVia(a);
      if (typeof t.b === 'object' && !('t' in t.b)) needVia(b);
      const pts = [a, ...mid, b].filter((q, i, arr) => i === 0 || dist(q, arr[i - 1]) > 1e-6);
      if (pts.length >= 2) addTrack(p, { layer: 'B.Cu', width: Math.round(t.w * LEGACY_UNIT * 100) / 100, points: pts });
    }
  }
  for (const q of viaAt.values()) addVia(p, { at: q, diameter: 1.8, drill: 0.7 });

  return { project: p, customFootprints };
}
