import { expandBox, pointInPolygon, segmentSegment, type Box } from '../math/geom';
import { capsuleShape, shapeGap, type Shape } from '../math/shape';
import { SpatialHash } from '../math/spatial-hash';
import { dist, type Vec2 } from '../math/vec';
import { computeConnectivity } from '../model/connectivity';
import { runDrc } from '../model/drc';
import { boardCopperLayers, sideLayer } from '../model/layers';
import { padLocalShape, placementOf, shapeToWorld } from '../model/placement';
import { boardBox, boardPolygon, rectSize } from '../model/project';
import type { CopperLayer, Id, ItemRef, LayerId, Project } from '../model/types';
import { padLabel } from '../model/world';
import { graphicPrims, type LayerPrims } from '../render/graphic';

/*
 * Проверка платы на технологичность (DFM): меряет реальную геометрию и сравнивает
 * с возможностями выбранного производства, независимо от правил проекта.
 * Заодно собирает параметры, которые спрашивают в форме заказа на заводе.
 * Цен здесь нет: они зависят от завода и меняются.
 */

export interface FabProfile {
  id: string;
  name: string;
  note: string;
  /** Минимальная ширина дорожки. */
  track: number;
  /** Минимальный зазор между медью разных цепей. */
  space: number;
  /** Минимальный диаметр отверстия. */
  drill: number;
  /** Отношение наименьшего металлизированного отверстия к толщине платы (γ по ГОСТ). */
  aspect?: number;
  /** Отверстия крупнее обычно фрезеруют. */
  maxDrill: number;
  /** Гарантийный поясок: медь вокруг отверстия. */
  ring: number;
  /** Медь до края платы. */
  edge: number;
  /** Между краями отверстий. */
  holeToHole: number;
  /** Шелкография: толщина линии и высота текста; 0 — не проверять. */
  silkWidth: number;
  silkText: number;
  /** Наименьшая перемычка маски между площадками; 0 — не проверять. */
  maskDam: number;
  /** Самодельная плата: другие советы. */
  home?: boolean;
}

/** Общие для заводов значения; линии шелкографии 0,12 мм (как в KiCad) печатают почти все. */
const TYPICAL = { maxDrill: 6.3, edge: 0.3, holeToHole: 0.5, silkWidth: 0.1, silkText: 0.8, maskDam: 0.1 };

export const FAB_PROFILES: FabProfile[] = [
  {
    id: 'typical',
    name: 'Типовой завод, 2 слоя',
    note: 'Возможности недорогих заводов для 1–2 слоёв с запасом. Точные цифры сверьте на сайте завода.',
    track: 0.15,
    space: 0.15,
    drill: 0.3,
    ring: 0.13,
    ...TYPICAL,
  },
  {
    id: 'gost3',
    name: 'ГОСТ Р 53429, класс точности 3',
    note: 'Дорожка и зазор 0,25 мм, поясок 0,1 мм, отверстие не меньше 0,33 толщины платы.',
    track: 0.25,
    space: 0.25,
    drill: 0.3,
    aspect: 0.33,
    ring: 0.1,
    ...TYPICAL,
  },
  {
    id: 'gost4',
    name: 'ГОСТ Р 53429, класс точности 4',
    note: 'Дорожка и зазор 0,15 мм, поясок 0,05 мм, отверстие не меньше 0,25 толщины платы.',
    track: 0.15,
    space: 0.15,
    drill: 0.3,
    aspect: 0.25,
    ring: 0.05,
    ...TYPICAL,
  },
  {
    id: 'gost5',
    name: 'ГОСТ Р 53429, класс точности 5',
    note: 'Дорожка и зазор 0,1 мм, поясок 0,025 мм, отверстие не меньше 0,2 толщины платы.',
    track: 0.1,
    space: 0.1,
    drill: 0.2,
    aspect: 0.2,
    ring: 0.025,
    ...TYPICAL,
  },
  {
    id: 'home',
    name: 'Дома: ЛУТ или фоторезист',
    note: 'Всё крупнее: тонер растекается, травление подъедает края, сверлят вручную.',
    track: 0.4,
    space: 0.3,
    drill: 0.6,
    maxDrill: 6,
    ring: 0.3,
    edge: 1.0,
    holeToHole: 0.3,
    silkWidth: 0,
    silkText: 0,
    maskDam: 0,
    home: true,
  },
];

export const fabProfile = (id: string): FabProfile => FAB_PROFILES.find((f) => f.id === id) ?? FAB_PROFILES[0];

/** Профиль по умолчанию: для самодельных правил — домашний. */
export const defaultFabProfile = (p: Project): FabProfile => fabProfile(p.rules.minTrackWidth >= 0.4 && p.rules.minViaDrill >= 0.6 ? 'home' : 'typical');

export type DfmSeverity = 'error' | 'warning' | 'info';
export type DfmGroup = 'Медь' | 'Отверстия' | 'Шелкография' | 'Маска' | 'Плата' | 'Монтаж' | 'Проект';

export interface DfmIssue {
  id: string;
  severity: DfmSeverity;
  group: DfmGroup;
  message: string;
  at?: Vec2;
  items: ItemRef[];
}

export interface DrillTool {
  d: number;
  plated: boolean;
  count: number;
}

export interface DfmReport {
  profile: FabProfile;
  issues: DfmIssue[];
  errors: number;
  warnings: number;
  /** Параметры для формы заказа. */
  order: { label: string; value: string }[];
  drills: DrillTool[];
  /** Замеры: наименьшие дорожка, зазор (или null, если все больше searched), отверстие, поясок. */
  measured: { track: number | null; space: number | null; searched: number; drill: number | null; ring: number | null; pitch: number | null };
}

interface Cu {
  owner: string;
  net: Id | null;
  shape: Shape;
  layer: CopperLayer;
  label: string;
  ref: ItemRef | null;
}

/** Сколько отдельных отметок одного вида показывать: дальше — одной строкой. */
const PER_CHECK = 25;
const STD_THICKNESS = [0.4, 0.6, 0.8, 1.0, 1.2, 1.6, 2.0];

const mm = (v: number, digits = 2) => `${+v.toFixed(digits)}`.replace('.', ',');
const round = (v: number, step = 0.01) => Math.round(v / step) * step;

function refsText(names: string[], max = 8): string {
  const u = [...new Set(names)];
  return u.slice(0, max).join(', ') + (u.length > max ? ` и ещё ${u.length - max}` : '');
}

function coreEdges(pts: Vec2[]): [Vec2, Vec2][] {
  if (pts.length === 1) return [[pts[0], pts[0]]];
  if (pts.length === 2) return [[pts[0], pts[1]]];
  return pts.map((q, i) => [q, pts[(i + 1) % pts.length]]);
}

/** Зазор от фигуры до замкнутого контура (края платы или выреза). */
function gapToLoop(s: Shape, loop: Vec2[]): { d: number; at: Vec2 } {
  let best = { d: Infinity, at: s.pts[0] };
  const core = coreEdges(s.pts);
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    for (const [p, q] of core) {
      const k = segmentSegment(p, q, a, b);
      if (k.d < best.d) best = k;
    }
  }
  return { d: Math.max(0, best.d - s.r), at: best.at };
}

export function runDfm(p: Project, profile: FabProfile = defaultFabProfile(p)): DfmReport {
  const conn = computeConnectivity(p);
  const w = conn.world;
  const layers = boardCopperLayers(p.board.copperLayers);
  const issues: DfmIssue[] = [];
  let n = 0;
  const add = (severity: DfmSeverity, group: DfmGroup, message: string, at?: Vec2, items: ItemRef[] = []) =>
    issues.push({ id: 'f' + n++, severity, group, message, at: at && { x: +at.x.toFixed(3), y: +at.y.toFixed(3) }, items });
  /** Отметки одного вида: первые PER_CHECK отдельно, остальные — одной строкой. */
  const limited = (severity: DfmSeverity, group: DfmGroup, rows: { message: string; at?: Vec2; items: ItemRef[] }[], rest: (k: number) => string) => {
    for (const r of rows.slice(0, PER_CHECK)) add(severity, group, r.message, r.at, r.items);
    if (rows.length > PER_CHECK) add(severity, group, rest(rows.length - PER_CHECK), undefined, rows.slice(PER_CHECK).flatMap((r) => r.items));
  };
  const netName = (id: Id | null) => (id ? (p.nets[id]?.name ?? '?') : 'без цепи');
  const compRef = (id: Id): ItemRef => ({ kind: 'component', id });

  /* ---------- медь ---------- */
  const items: Cu[] = [];
  for (const wp of w.pads)
    for (const l of wp.layers)
      if (layers.includes(l)) items.push({ owner: 'pad:' + wp.key, net: wp.net, shape: wp.shape, layer: l, label: padLabel(wp), ref: compRef(wp.component.id) });
  const trackNet = (id: Id): Id | null => {
    const v = conn.itemNet.get(id);
    return v && v !== 'short' ? v : null;
  };
  for (const s of w.segments)
    if (layers.includes(s.track.layer))
      items.push({ owner: 'track:' + s.track.id, net: trackNet(s.track.id), shape: s.shape, layer: s.track.layer, label: `дорожка ${netName(trackNet(s.track.id))}`, ref: { kind: 'track', id: s.track.id } });
  for (const v of w.vias)
    for (const l of layers) items.push({ owner: 'via:' + v.via.id, net: trackNet(v.via.id), shape: v.shape, layer: l, label: `переходное ${netName(trackNet(v.via.id))}`, ref: { kind: 'via', id: v.via.id } });
  for (const td of conn.teardrops)
    if (layers.includes(td.layer)) items.push({ owner: 'track:' + td.trackId, net: trackNet(td.trackId), shape: td.shape, layer: td.layer, label: `капля ${netName(trackNet(td.trackId))}`, ref: { kind: 'track', id: td.trackId } });
  for (const zf of conn.zoneFills) {
    if (!layers.includes(zf.zone.layer)) continue;
    for (const loop of zf.loops)
      for (let i = 0; i < loop.length; i++)
        items.push({
          owner: 'zone:' + zf.zone.id,
          net: zf.zone.net,
          shape: capsuleShape(loop[i], loop[(i + 1) % loop.length], 0),
          layer: zf.zone.layer,
          label: `заливка ${netName(zf.zone.net)}`,
          ref: { kind: 'zone', id: zf.zone.id },
        });
  }

  // Зазоры между медью разных цепей: ищем в радиусе чуть больше требуемого, заодно меряем наименьший.
  const searched = Math.max(0.4, profile.space + 0.15);
  const hash: Record<CopperLayer, SpatialHash<Cu>> = { 'F.Cu': new SpatialHash(2), 'B.Cu': new SpatialHash(2) };
  for (const it of items) hash[it.layer].insert(it, it.shape.box);
  let minSpace: number | null = null;
  const spaceRows: { d: number; message: string; at: Vec2; items: ItemRef[] }[] = [];
  const pairSeen = new Set<string>();
  for (const a of items) {
    const q: Box = expandBox(a.shape.box, searched);
    for (const b of hash[a.layer].query(q)) {
      if (a === b || a.owner === b.owner) continue;
      if (a.net && a.net === b.net) continue;
      if (!a.net && !b.net && a.ref?.kind === 'component' && a.ref.id === b.ref?.id) continue;
      const g = shapeGap(a.shape, b.shape);
      if (g.d <= 1e-4 || g.d >= searched) continue;
      if (minSpace === null || g.d < minSpace) minSpace = g.d;
      if (g.d < profile.space - 1e-4) {
        const key = [a.owner, b.owner].sort().join('|') + a.layer;
        if (pairSeen.has(key)) continue;
        pairSeen.add(key);
        spaceRows.push({
          d: g.d,
          message: `Зазор ${mm(g.d)} мм между «${a.label}» и «${b.label}» (${a.layer}), завод: от ${mm(profile.space)} мм`,
          at: g.at,
          items: [a.ref, b.ref].filter((r): r is ItemRef => !!r && r.kind !== 'zone'),
        });
      }
    }
  }
  spaceRows.sort((x, y) => x.d - y.d);
  limited('error', 'Медь', spaceRows, (k) => `Ещё мест с зазором меньше ${mm(profile.space)} мм: ${k}`);

  // Ширина дорожек.
  const tracks = Object.values(p.tracks).filter((t) => t.points.length >= 2 && layers.includes(t.layer));
  const minTrack = tracks.length ? Math.min(...tracks.map((t) => t.width)) : null;
  const thin = new Map<number, typeof tracks>();
  for (const t of tracks) if (t.width < profile.track - 1e-4) thin.set(t.width, [...(thin.get(t.width) ?? []), t]);
  for (const [wd, ts] of [...thin].sort((x, y) => x[0] - y[0]))
    add('error', 'Медь', `Дорожки ${mm(wd, 3)} мм уже ${mm(profile.track)} мм: ${ts.length} шт.`, ts[0].points[0], ts.map((t) => ({ kind: 'track', id: t.id })));

  // Медь у края платы и вырезов.
  const outline = boardPolygon(p.board);
  const loops = [outline, ...p.board.cutouts];
  const edgeRows: { message: string; at: Vec2; items: ItemRef[] }[] = [];
  const edgeSeen = new Set<string>();
  for (const it of items) {
    if (edgeSeen.has(it.owner)) continue;
    for (const loop of loops) {
      if (loop.length < 3) continue;
      const g = gapToLoop(it.shape, loop);
      const inside = loop === outline ? it.shape.pts.every((q) => pointInPolygon(q, loop)) : !it.shape.pts.some((q) => pointInPolygon(q, loop));
      if (!inside) continue; // вне платы — это ошибка проверки правил, не технологии
      if (g.d < profile.edge - 1e-4) {
        edgeSeen.add(it.owner);
        edgeRows.push({ message: `${cap(it.label)}: до ${loop === outline ? 'края платы' : 'выреза'} ${mm(g.d)} мм, завод: от ${mm(profile.edge)} мм`, at: g.at, items: it.ref && it.ref.kind !== 'zone' ? [it.ref] : [] });
        break;
      }
    }
  }
  limited('warning', 'Медь', edgeRows, (k) => `Ещё объектов ближе ${mm(profile.edge)} мм к краю: ${k}`);

  /* ---------- отверстия ---------- */
  interface Hole {
    at: Vec2;
    d: number;
    plated: boolean;
    ring: number | null;
    ref: ItemRef;
    label: string;
    owner: string;
  }
  const holes: Hole[] = [];
  for (const wp of w.pads) {
    if (!wp.drill) continue;
    const onBoard = wp.layers.some((l) => layers.includes(l));
    const ring = onBoard && wp.pad.type !== 'npth' ? (Math.min(wp.pad.size.x, wp.pad.size.y) - wp.drill) / 2 : null;
    holes.push({ at: wp.center, d: wp.drill, plated: wp.plated && p.board.copperLayers === 2, ring, ref: compRef(wp.component.id), label: padLabel(wp), owner: 'pad:' + wp.key });
  }
  for (const v of w.vias) holes.push({ at: v.via.at, d: v.via.drill, plated: p.board.copperLayers === 2, ring: (v.via.diameter - v.via.drill) / 2, ref: { kind: 'via', id: v.via.id }, label: 'переходное', owner: 'via:' + v.via.id });

  const tools = new Map<string, DrillTool>();
  for (const h of holes) {
    const d = round(h.d);
    const k = `${d}:${h.plated}`;
    const t = tools.get(k) ?? { d: +d.toFixed(2), plated: h.plated, count: 0 };
    t.count++;
    tools.set(k, t);
  }
  const drills = [...tools.values()].sort((a, b) => a.d - b.d || +b.plated - +a.plated);
  const minPlated = profile.aspect ? Math.max(profile.drill, profile.aspect * p.board.thickness) : profile.drill;
  const small = new Map<number, Hole[]>();
  for (const h of holes) {
    const need = h.plated ? minPlated : profile.drill;
    if (h.d < need - 1e-4) small.set(round(h.d), [...(small.get(round(h.d)) ?? []), h]);
  }
  for (const [d, hs] of [...small].sort((x, y) => x[0] - y[0])) {
    const need = hs[0].plated ? minPlated : profile.drill;
    const why = hs[0].plated && profile.aspect && minPlated > profile.drill ? ` (${mm(profile.aspect)} × толщина ${mm(p.board.thickness)} мм)` : '';
    add('error', 'Отверстия', `Отверстия ${mm(d)} мм меньше ${mm(need)} мм${why}: ${hs.length} шт. — ${refsText(hs.map((h) => h.label))}`, hs[0].at, hs.map((h) => h.ref));
  }
  const big = holes.filter((h) => h.d > profile.maxDrill + 1e-4);
  if (big.length)
    add('warning', 'Отверстия', `Отверстия крупнее ${mm(profile.maxDrill)} мм (${refsText(big.map((h) => mm(h.d) + ' мм'), 4)}): ${profile.home ? 'ступенчатое сверло или фреза' : 'их фрезеруют — уточните у завода'}`, big[0].at, big.map((h) => h.ref));

  // Поясок: по наименьшему, группами.
  const thinRing = new Map<number, Hole[]>();
  let minRing: number | null = null;
  for (const h of holes) {
    if (h.ring === null) continue;
    if (minRing === null || h.ring < minRing) minRing = h.ring;
    if (h.ring < profile.ring - 1e-4) thinRing.set(round(h.ring), [...(thinRing.get(round(h.ring)) ?? []), h]);
  }
  for (const [r, hs] of [...thinRing].sort((x, y) => x[0] - y[0]))
    add(r <= 0 ? 'error' : profile.home ? 'error' : 'warning', 'Отверстия', r <= 0 ? `Отверстие больше площадки: ${refsText(hs.map((h) => h.label))}` : `Поясок ${mm(r)} мм тоньше ${mm(profile.ring)} мм: ${hs.length} шт. — ${refsText(hs.map((h) => h.label))}`, hs[0].at, hs.map((h) => h.ref));

  // Между отверстиями.
  const hh = new SpatialHash<Hole>(3);
  for (const h of holes) hh.insert(h, { minX: h.at.x - h.d / 2, minY: h.at.y - h.d / 2, maxX: h.at.x + h.d / 2, maxY: h.at.y + h.d / 2 });
  const hhRows: { message: string; at: Vec2; items: ItemRef[] }[] = [];
  const hseen = new Set<string>();
  for (const a of holes)
    for (const b of hh.query(expandBox({ minX: a.at.x, minY: a.at.y, maxX: a.at.x, maxY: a.at.y }, a.d / 2 + profile.holeToHole + 7))) {
      if (a === b) continue;
      const key = a.owner < b.owner ? a.owner + '|' + b.owner : b.owner + '|' + a.owner;
      if (hseen.has(key)) continue;
      hseen.add(key);
      const gap = dist(a.at, b.at) - a.d / 2 - b.d / 2;
      if (gap < profile.holeToHole - 1e-4)
        hhRows.push({ message: `Между отверстиями «${a.label}» и «${b.label}» ${mm(Math.max(0, gap))} мм, желательно от ${mm(profile.holeToHole)} мм`, at: { x: (a.at.x + b.at.x) / 2, y: (a.at.y + b.at.y) / 2 }, items: [a.ref, b.ref] });
    }
  limited('warning', 'Отверстия', hhRows, (k) => `Ещё пар близких отверстий: ${k}`);

  /* ---------- шелкография и маска ---------- */
  const padsBySide: Record<'F' | 'B', SpatialHash<{ shape: Shape; comp: Id }>> = { F: new SpatialHash(3), B: new SpatialHash(3) };
  for (const wc of w.components) {
    if (!wc.footprint) continue;
    const pl = placementOf(wc.component);
    for (const wp of wc.pads) {
      if (wp.pad.type === 'npth') continue;
      const mask = shapeToWorld(pl, padLocalShape(wp.pad, wp.pad.maskMargin ?? p.rules.maskMargin));
      for (const l of wp.layers) if (layers.includes(l)) padsBySide[l === 'F.Cu' ? 'F' : 'B'].insert({ shape: mask, comp: wc.component.id }, mask.box);
    }
  }
  if (!p.rules.tentVias)
    for (const v of w.vias) {
      const m = { ...v.shape, r: v.shape.r + p.rules.maskMargin, box: expandBox(v.shape.box, p.rules.maskMargin) };
      for (const side of ['F', 'B'] as const) padsBySide[side].insert({ shape: m, comp: '' }, m.box);
    }

  const silkSides = new Set<'F' | 'B'>();
  if (profile.silkWidth > 0) {
    const thinSilk: string[] = [];
    const thinSilkRefs: ItemRef[] = [];
    const smallText: { ref: string; size: number }[] = [];
    const smallTextRefs: ItemRef[] = [];
    const overPads: string[] = [];
    const overPadsRefs: ItemRef[] = [];
    let firstThin: Vec2 | undefined;
    let firstText: Vec2 | undefined;
    let firstOver: Vec2 | undefined;
    const check = (prims: LayerPrims, name: string, ref: ItemRef | null, texts: number[], at: Vec2) => {
      let isThin = false;
      let over = false;
      for (const side of ['F', 'B'] as const) {
        const list = prims[`${side}.Silk` as LayerId];
        if (!list?.length) continue;
        silkSides.add(side);
        for (const pr of list) {
          if (pr.kind !== 'path') continue;
          if (pr.width < profile.silkWidth - 1e-4 && !isThin) {
            isThin = true;
            firstThin ??= pr.pts[0];
          }
          if (over) continue;
          for (let i = 0; i + 1 < pr.pts.length + (pr.closed ? 1 : 0) && !over; i++) {
            const s = capsuleShape(pr.pts[i], pr.pts[(i + 1) % pr.pts.length], pr.width / 2);
            for (const q of padsBySide[side].query(s.box))
              if (shapeGap(s, q.shape).d <= 1e-4) {
                over = true;
                firstOver ??= s.pts[0];
                break;
              }
          }
        }
      }
      if (isThin) {
        thinSilk.push(name);
        if (ref) thinSilkRefs.push(ref);
      }
      if (over) {
        overPads.push(name);
        if (ref) overPadsRefs.push(ref);
      }
      const t = texts.filter((sz) => sz < profile.silkText - 1e-4);
      if (t.length) {
        firstText ??= at;
        smallText.push({ ref: name, size: Math.min(...t) });
        if (ref) smallTextRefs.push(ref);
      }
    };
    for (const wc of w.components) {
      if (!wc.footprint) continue;
      const c = wc.component;
      const pl = placementOf(c);
      const prims: LayerPrims = {};
      const texts: number[] = [];
      for (const g of wc.footprint.graphics) {
        const l = sideLayer(g.layer, c.side);
        if (l !== 'F.Silk' && l !== 'B.Silk') continue;
        const before = (prims[l]?.length ?? 0);
        graphicPrims(g, pl, c, prims);
        if (g.kind === 'text' && (prims[l]?.length ?? 0) > before) texts.push(g.size);
      }
      check(prims, c.ref, compRef(c.id), texts, c.at);
    }
    for (const d of Object.values(p.drawings)) {
      if (d.layer !== 'F.Silk' && d.layer !== 'B.Silk') continue;
      const prims: LayerPrims = {};
      graphicPrims(d, null, null, prims);
      check(prims, d.kind === 'text' ? `надпись «${d.text}»` : 'рисунок на плате', { kind: 'drawing', id: d.id }, d.kind === 'text' ? [d.size] : [], d.kind === 'text' ? d.at : { x: 0, y: 0 });
    }
    if (thinSilk.length) add('warning', 'Шелкография', `Линии тоньше ${mm(profile.silkWidth)} мм могут не пропечататься: ${refsText(thinSilk)}`, firstThin, thinSilkRefs);
    if (smallText.length) {
      const minSize = Math.min(...smallText.map((t) => t.size));
      add('warning', 'Шелкография', `Надписи ниже ${mm(profile.silkText)} мм (наименьшая ${mm(minSize)} мм) будут нечитаемы: ${refsText(smallText.map((t) => t.ref))}`, firstText, smallTextRefs);
    }
    if (overPads.length) add('info', 'Шелкография', `Шелкография заходит на открытую медь площадок — завод её там обрежет: ${refsText(overPads)}`, firstOver, overPadsRefs);
  }

  // Перемычки маски между соседними площадками одной детали.
  let minPitch: number | null = null;
  const noDam: { ref: string; gap: number; at: Vec2; id: Id }[] = [];
  for (const wc of w.components) {
    if (!wc.footprint) continue;
    const pads = wc.pads.filter((x) => x.pad.type !== 'npth' && x.layers.some((l) => layers.includes(l)));
    const smd = pads.filter((x) => x.pad.type === 'smd');
    if (smd.length > 400) continue;
    for (let i = 0; i < smd.length; i++)
      for (let j = i + 1; j < smd.length; j++) {
        if (smd[i].layers[0] !== smd[j].layers[0]) continue;
        const d = dist(smd[i].center, smd[j].center);
        if (d > 0.05 && (minPitch === null || d < minPitch)) minPitch = d;
      }
    if (!profile.maskDam || pads.length > 400) continue;
    let worst: { gap: number; at: Vec2 } | null = null;
    for (let i = 0; i < pads.length; i++)
      for (let j = i + 1; j < pads.length; j++) {
        const a = pads[i];
        const b = pads[j];
        if (!a.layers.some((l) => b.layers.includes(l))) continue;
        if (a.net && a.net === b.net) continue;
        const g = shapeGap(a.shape, b.shape);
        if (g.d <= 1e-4) continue;
        const mA = a.pad.maskMargin ?? p.rules.maskMargin;
        const mB = b.pad.maskMargin ?? p.rules.maskMargin;
        const dam = g.d - mA - mB;
        if (dam < profile.maskDam - 1e-4 && (!worst || dam < worst.gap)) worst = { gap: dam, at: g.at };
      }
    if (worst) noDam.push({ ref: wc.component.ref, gap: worst.gap, at: worst.at, id: wc.component.id });
  }
  if (noDam.length) {
    noDam.sort((a, b) => a.gap - b.gap);
    add(
      'info',
      'Маска',
      `Между площадками ${refsText(noDam.map((x) => x.ref))} перемычка маски уже ${mm(profile.maskDam)} мм (наименьшая ${mm(Math.max(0, noDam[0].gap))} мм): маску там снимут окном, паять аккуратнее`,
      noDam[0].at,
      noDam.map((x) => compRef(x.id)),
    );
  }

  /* ---------- плата ---------- */
  const box = boardBox(p.board);
  const W = box.maxX - box.minX;
  const H = box.maxY - box.minY;
  if (outline.length < 3) add('error', 'Плата', 'Нет контура платы: завод не поймёт, где резать');
  if (!profile.home && !STD_THICKNESS.some((t) => Math.abs(t - p.board.thickness) < 1e-3))
    add('warning', 'Плата', `Толщина ${mm(p.board.thickness)} мм нестандартная (обычно ${STD_THICKNESS.map((t) => mm(t, 1)).join(', ')} мм) — дороже и дольше`);
  if (profile.home) {
    const fits = (a: number, b: number) => (a <= 190 && b <= 277) || (a <= 277 && b <= 190);
    if (!fits(W, H)) add('warning', 'Плата', `Плата ${mm(W, 1)} × ${mm(H, 1)} мм не помещается на лист A4 для ЛУТ — печатайте на A3 или частями`);
  }
  for (const cut of p.board.cutouts) {
    const cb = cut.reduce((b, q) => ({ minX: Math.min(b.minX, q.x), minY: Math.min(b.minY, q.y), maxX: Math.max(b.maxX, q.x), maxY: Math.max(b.maxY, q.y) }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
    if (Math.min(cb.maxX - cb.minX, cb.maxY - cb.minY) < 1.0 && !profile.home)
      add('warning', 'Плата', 'Вырез уже 1 мм: фреза завода обычно от 0,8–1 мм, уточните', { x: (cb.minX + cb.maxX) / 2, y: (cb.minY + cb.maxY) / 2 });
  }

  /* ---------- монтаж и проект ---------- */
  const comps = w.components.filter((c) => c.footprint);
  const smdComps = comps.filter((c) => c.pads.some((x) => x.pad.type === 'smd'));
  const thtComps = comps.filter((c) => c.pads.some((x) => x.pad.type === 'tht'));
  const sides = new Set(comps.map((c) => c.component.side));
  if (profile.home) {
    if (minPitch !== null && minPitch < 0.65 - 1e-4) add('warning', 'Монтаж', `Шаг выводов ${mm(minPitch)} мм — тяжело для ЛУТ: тонер сливается. Проверьте первый отпечаток под лупой`);
    if (w.vias.length && p.board.copperLayers === 2) add('info', 'Монтаж', `Переходных ${w.vias.length}: каждое — проволочка, пропаянная с двух сторон, или заклёпка`);
    if (p.board.copperLayers === 2) add('info', 'Плата', 'Двусторонняя: совместите отпечатки на просвет по отверстиям, сверлите после травления');
    if (!p.rules.teardrops) add('info', 'Медь', 'Включите каплевидные переходы (Трассировка): дорожки меньше отрываются у площадок');
  } else {
    if (sides.size > 1) add('info', 'Монтаж', 'Детали стоят с двух сторон: при заказе монтажа это две стороны сборки');
  }

  const drc = runDrc(p);
  if (conn.unrouted) add('error', 'Проект', `Не разведено цепей: ${conn.unrouted}. Завод сделает плату как есть — без этих соединений`);
  const drcErr = drc.markers.filter((m) => m.severity === 'error' && m.code !== 'unrouted').length;
  if (drcErr) add('warning', 'Проект', `Проверка правил проекта: ошибок ${drcErr} — посмотрите вкладку «Проверка»`);
  if (p.rules.minClearance < profile.space - 1e-4 || p.rules.minTrackWidth < profile.track - 1e-4)
    add('info', 'Проект', `Правила проекта мягче этого производства (зазор ${mm(p.rules.minClearance)}, дорожка ${mm(p.rules.minTrackWidth)} мм) — поднимите их в настройках платы, чтобы трассировка сразу держала ${mm(profile.space)}/${mm(profile.track)} мм`);

  /* ---------- параметры заказа ---------- */
  const minDrill = holes.length ? Math.min(...holes.map((h) => h.d)) : null;
  const silkText = silkSides.size === 2 ? 'с двух сторон' : silkSides.has('F') ? 'сверху' : silkSides.has('B') ? 'снизу' : 'нет';
  const maskText = p.board.copperLayers === 2 ? 'с двух сторон' : 'снизу';
  const rect = !!rectSize(p.board.outline);
  const order = [
    { label: 'Размер', value: `${mm(W, 1)} × ${mm(H, 1)} мм` },
    { label: 'Слоёв меди', value: String(p.board.copperLayers) },
    { label: 'Толщина', value: `${mm(p.board.thickness, 1)} мм` },
    {
      label: 'Контур',
      value: (rect ? 'прямоугольник' : 'фигурный') + (p.board.cornerRadius > 0 ? `, скругление ${mm(p.board.cornerRadius, 1)} мм` : '') + (p.board.cutouts.length ? `, вырезов ${p.board.cutouts.length}` : ''),
    },
    { label: 'Мин. дорожка', value: minTrack !== null ? `${mm(minTrack, 3)} мм` : '—' },
    { label: 'Мин. зазор', value: minSpace !== null ? `${mm(minSpace, 3)} мм` : `больше ${mm(searched)} мм` },
    { label: 'Мин. отверстие', value: minDrill !== null ? `${mm(minDrill)} мм` : '—' },
    { label: 'Отверстий', value: `${holes.length}, диаметров ${drills.length}` },
    { label: 'Переходных', value: String(w.vias.length) },
    { label: 'Мин. поясок', value: minRing !== null ? `${mm(minRing, 3)} мм` : '—' },
    { label: 'Маска', value: profile.home ? 'нет (домашняя)' : maskText + (p.rules.tentVias ? ', переходные закрыты' : '') },
    { label: 'Шелкография', value: profile.home ? 'нет' : silkText },
    { label: 'Детали', value: `SMD ${smdComps.length}, выводных ${thtComps.length}; ${sides.size > 1 ? 'с двух сторон' : sides.has('bottom') ? 'снизу' : 'сверху'}` },
    { label: 'Мин. шаг SMD', value: minPitch !== null ? `${mm(minPitch)} мм` : '—' },
  ];

  issues.sort((a, b) => rank(a.severity) - rank(b.severity));
  return {
    profile,
    issues,
    errors: issues.filter((i) => i.severity === 'error').length,
    warnings: issues.filter((i) => i.severity === 'warning').length,
    order,
    drills,
    measured: { track: minTrack, space: minSpace, searched, drill: minDrill, ring: minRing, pitch: minPitch },
  };
}

const rank = (s: DfmSeverity) => (s === 'error' ? 0 : s === 'warning' ? 1 : 2);

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Текст отчёта: приложить к заказу или сохранить себе. */
export function dfmReportText(p: Project, r: DfmReport): string {
  const L: string[] = [];
  L.push(`Проверка для производства: ${p.meta.name}`);
  L.push(`Профиль: ${r.profile.name}`);
  L.push(`Дорожка от ${mm(r.profile.track)} мм, зазор от ${mm(r.profile.space)} мм, отверстие от ${mm(r.profile.drill)} мм, поясок от ${mm(r.profile.ring, 3)} мм`);
  L.push('');
  L.push('Параметры для заказа');
  for (const o of r.order) L.push(`  ${o.label}: ${o.value}`);
  L.push('');
  L.push('Свёрла');
  for (const d of r.drills) L.push(`  ${mm(d.d)} мм${d.plated ? '' : ' (без металлизации)'} — ${d.count} шт.`);
  L.push('');
  L.push(`Замечания: ошибок ${r.errors}, предупреждений ${r.warnings}`);
  const word = { error: 'ошибка', warning: 'внимание', info: 'совет' } as const;
  for (const i of r.issues) L.push(`  [${word[i.severity]}] ${i.group}: ${i.message}${i.at ? ` (${mm(i.at.x)}; ${mm(i.at.y)} мм)` : ''}`);
  if (!r.issues.length) L.push('  нет');
  return L.join('\n') + '\n';
}
