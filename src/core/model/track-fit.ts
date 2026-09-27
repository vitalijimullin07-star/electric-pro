import { expandBox, segmentSegment } from '../math/geom';
import { capsuleShape, shapeGap, type Shape } from '../math/shape';
import { SpatialHash } from '../math/spatial-hash';
import type { Vec2 } from '../math/vec';
import { computeConnectivity } from './connectivity';
import { netWidth } from './currents';
import { addTrack } from './edit';
import { boardCopperLayers } from './layers';
import { boardPolygon } from './project';
import { maxClearance, netClassOf, requiredClearance } from './rules';
import type { CopperLayer, Id, NetClass, Project, Track } from './types';

/*
 * Ширина дорожек по токам. Дорожка режется на куски по полмиллиметра; каждому куску —
 * наибольшая ширина, при которой соблюдается зазор до чужой меди и края платы, но не
 * больше нужной цепи (класс и ток, см. currents.ts). Короткие «выпуклости» сглаживаются,
 * сужения у тонких выводов остаются (так дорожка входит в площадку микросхемы).
 * Соседние куски одной ширины снова собираются в одну дорожку.
 */

export interface FitOptions {
  /** Только эти дорожки; иначе — все незакреплённые дорожки цепей, которым нужно шире. */
  tracks?: Id[];
  /** Нужная ширина по цепям вместо расчёта. */
  widths?: Map<Id, number>;
}

export interface FitNet {
  net: Id;
  remove: Id[];
  add: Omit<Track, 'id'>[];
  /** Нужно, мм. */
  need: number;
  /** Самое узкое место вне сужений у выводов, мм. */
  got: number;
  /** Длина дорожек уже нужного (вне сужений у выводов), мм. */
  narrowLen: number;
}

export interface FitResult {
  remove: Id[];
  add: Omit<Track, 'id'>[];
  /** Цепи, дорожки которых поменялись. */
  nets: FitNet[];
  /** Цепи, где на части длины не хватило места. */
  short: FitNet[];
}

const PIECE = 0.5;
const STEP = 0.05;
/** Кусок у своей площадки ближе этого — сужение у вывода, в «не хватило места» не считается. */
const NECK = 2.0;
/** Выпуклость короче этого сглаживается до соседей. */
const MIN_RUN = 1.0;

interface Obstacle {
  shape: Shape;
  net: Id | null;
  cls: NetClass | null;
  owner: string;
}

export function fitTrackWidths(p: Project, o: FitOptions = {}): FitResult {
  const conn = computeConnectivity(p);
  const w = conn.world;
  const R = p.rules;
  const layers = boardCopperLayers(p.board.copperLayers);
  const clsOf = (net: Id | null) => (net ? netClassOf(p, net) : null);
  const netOfItem = (id: Id): Id | null => {
    const n = conn.itemNet.get(id);
    return n && n !== 'short' ? n : null;
  };

  // Какие дорожки и до какой ширины.
  const want = new Map<Id, { need: number }>();
  const needOf = (net: Id) => {
    const nw = netWidth(p, net);
    return { need: o.widths?.get(net) ?? nw.width };
  };
  // Без списка дорожек — только цепи, которым по току нужно шире класса (сужения сигнальных
  // дорожек у выводов, сделанные нарочно, не трогаем).
  const byCurrent = (net: Id) => o.widths?.has(net) || netWidth(p, net).width > netWidth(p, net).classWidth + 1e-6;
  const byNet = new Map<Id, Track[]>();
  const pick = o.tracks ? o.tracks.map((id) => p.tracks[id]).filter(Boolean) : Object.values(p.tracks).filter((t) => !t.locked);
  for (const t of pick) {
    const net = netOfItem(t.id);
    if (!net || !layers.includes(t.layer)) continue;
    const { need } = needOf(net);
    if (!o.tracks && !byCurrent(net)) continue;
    if (need <= t.width + 1e-6) continue;
    if (!want.has(net)) want.set(net, { need });
    (byNet.get(net) ?? byNet.set(net, []).get(net)!).push(t);
  }
  const result: FitResult = { remove: [], add: [], nets: [], short: [] };
  if (!byNet.size) return result;

  // Препятствия по слоям: площадки, дорожки, переходные.
  const hash: Record<CopperLayer, SpatialHash<Obstacle>> = { 'F.Cu': new SpatialHash(3), 'B.Cu': new SpatialHash(3) };
  const dead = new Set<string>();
  const put = (layer: CopperLayer, ob: Obstacle) => hash[layer].insert(ob, ob.shape.box);
  for (const wp of w.pads) for (const l of wp.layers) if (layers.includes(l)) put(l, { shape: wp.shape, net: wp.net, cls: clsOf(wp.net), owner: 'pad:' + wp.key });
  for (const s of w.segments) {
    const net = netOfItem(s.track.id);
    put(s.track.layer, { shape: s.shape, net, cls: clsOf(net), owner: 'track:' + s.track.id });
  }
  for (const v of w.vias) {
    const net = netOfItem(v.via.id);
    for (const l of layers) put(l, { shape: v.shape, net, cls: clsOf(net), owner: 'via:' + v.via.id });
  }
  const outline = boardPolygon(p.board);
  const edges: Vec2[][] = [outline, ...p.board.cutouts];
  const keepouts = Object.values(p.ruleAreas).filter((ra) => ra.keepoutTracks);
  const maxC = maxClearance(p);

  // Свои площадки цепи — для сужений у выводов.
  const padsOfNet = new Map<Id, Vec2[]>();
  for (const wp of w.pads) if (wp.net) (padsOfNet.get(wp.net) ?? padsOfNet.set(wp.net, []).get(wp.net)!).push(wp.center);

  const nets = [...byNet.keys()].sort((a, b) => want.get(b)!.need - want.get(a)!.need);
  for (const net of nets) {
    const { need } = want.get(net)!;
    const cls = clsOf(net);
    const myPads = padsOfNet.get(net) ?? [];
    let got = Infinity;
    let narrowLen = 0;
    const nRemove: Id[] = [];
    const nAdd: Omit<Track, 'id'>[] = [];
    const fresh: { layer: CopperLayer; shape: Shape }[] = [];
    for (const t of byNet.get(net)!) {
      const base = t.width;
      // Куски дорожки.
      const pieces: { u: Vec2; v: Vec2; seg: number; w: number; len: number }[] = [];
      for (let i = 1; i < t.points.length; i++) {
        const a = t.points[i - 1];
        const b = t.points[i];
        const L = Math.hypot(b.x - a.x, b.y - a.y);
        const n = Math.max(1, Math.ceil(L / PIECE));
        for (let k = 0; k < n; k++) {
          const u = { x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n };
          const v = { x: a.x + ((b.x - a.x) * (k + 1)) / n, y: a.y + ((b.y - a.y) * (k + 1)) / n };
          pieces.push({ u, v, seg: i, w: base, len: L / n });
        }
      }
      if (!pieces.length) continue;
      for (const pc of pieces) {
        const axis = capsuleShape(pc.u, pc.v, 0);
        let hw = need / 2;
        for (const ob of hash[t.layer].query(expandBox(axis.box, need / 2 + maxC))) {
          if (dead.has(ob.owner) || ob.owner === 'track:' + t.id) continue;
          if (ob.net && ob.net === net) continue;
          const d = shapeGap(axis, ob.shape).d - requiredClearance(R, cls, ob.cls);
          if (d < hw) hw = d;
        }
        for (const poly of edges) {
          for (let i = 0; i < poly.length; i++) {
            const d = segmentSegment(pc.u, pc.v, poly[i], poly[(i + 1) % poly.length]).d - R.edgeClearance;
            if (d < hw) hw = d;
          }
        }
        for (const ra of keepouts) {
          if (ra.layers && !ra.layers.includes(t.layer)) continue;
          for (let i = 0; i < ra.outline.length; i++) {
            const d = segmentSegment(pc.u, pc.v, ra.outline[i], ra.outline[(i + 1) % ra.outline.length]).d;
            if (d < hw) hw = d;
          }
        }
        const fit = Math.floor((2 * hw) / STEP + 1e-6) * STEP;
        pc.w = +Math.max(base, Math.min(need, fit)).toFixed(3);
      }
      // Сгладить короткие выпуклости: кусок шире обоих соседей и короче MIN_RUN — до соседа.
      for (let pass = 0; pass < 8; pass++) {
        let again = false;
        const runs: { i0: number; i1: number; w: number; len: number }[] = [];
        for (let i = 0; i < pieces.length; i++) {
          const last = runs[runs.length - 1];
          if (last && Math.abs(last.w - pieces[i].w) < 1e-9) {
            last.i1 = i;
            last.len += pieces[i].len;
          } else runs.push({ i0: i, i1: i, w: pieces[i].w, len: pieces[i].len });
        }
        for (let r = 0; r < runs.length; r++) {
          const run = runs[r];
          if (run.len >= MIN_RUN || runs.length === 1) continue;
          const prev = runs[r - 1]?.w ?? -Infinity;
          const next = runs[r + 1]?.w ?? -Infinity;
          const to = Math.max(prev, next);
          if (run.w > to && to > 0) {
            for (let i = run.i0; i <= run.i1; i++) pieces[i].w = to;
            again = true;
          }
        }
        if (!again) break;
      }
      // Узкие места вне сужений у своих выводов.
      for (const pc of pieces) {
        const m = { x: (pc.u.x + pc.v.x) / 2, y: (pc.u.y + pc.v.y) / 2 };
        const neck = myPads.some((q) => Math.hypot(q.x - m.x, q.y - m.y) < NECK + need);
        if (neck) continue;
        got = Math.min(got, pc.w);
        if (pc.w < need - 1e-6) narrowLen += pc.len;
      }
      // Собрать дорожки из кусков одной ширины.
      if (pieces.every((pc) => Math.abs(pc.w - t.width) < 1e-9)) continue;
      nRemove.push(t.id);
      dead.add('track:' + t.id);
      let cur: { w: number; pts: Vec2[] } | null = null;
      const flush = () => {
        if (!cur || cur.pts.length < 2) return;
        nAdd.push({ layer: t.layer, width: cur.w, points: cur.pts });
        for (let i = 1; i < cur.pts.length; i++) fresh.push({ layer: t.layer, shape: capsuleShape(cur.pts[i - 1], cur.pts[i], cur.w / 2) });
      };
      pieces.forEach((pc, i) => {
        if (!cur || Math.abs(cur.w - pc.w) > 1e-9) {
          flush();
          cur = { w: pc.w, pts: [pc.u] };
        }
        const nextSame = i + 1 < pieces.length && pieces[i + 1].seg === pc.seg && Math.abs(pieces[i + 1].w - pc.w) < 1e-9;
        if (!nextSame) cur!.pts.push(pc.v);
      });
      flush();
    }
    // Новые дорожки — препятствия для следующих цепей.
    for (const f of fresh) hash[f.layer].insert({ shape: f.shape, net, cls, owner: 'fit:' + net }, f.shape.box);
    const rec: FitNet = { net, remove: nRemove, add: nAdd, need, got: got === Infinity ? need : got, narrowLen: +narrowLen.toFixed(2) };
    if (nRemove.length) {
      result.nets.push(rec);
      result.remove.push(...nRemove);
      result.add.push(...nAdd);
    }
    if (narrowLen > 0.5) result.short.push(rec);
  }
  return result;
}

/**
 * Подгонка, которая не рвёт заливку: расширенная дорожка отжимает чужой полигон и может
 * перерезать его перешеек. Цепи, после расширения которых у какой-то цепи стало больше
 * островков, остаются прежней ширины (проверяется по одной, затем все вместе).
 */
export function fitTrackWidthsSafe(p: Project, o: FitOptions = {}): FitResult & { reverted: Id[] } {
  const r = fitTrackWidths(p, o);
  const islands = (q: Project) => {
    const m = new Map<Id, number>();
    for (const st of computeConnectivity(q).nets.values()) m.set(st.netId, st.islands.length);
    return m;
  };
  const before = islands(p);
  const breaks = (nets: FitNet[]) => {
    if (!nets.length) return false;
    const q = structuredClone(p);
    applyFit(q, { remove: nets.flatMap((n) => n.remove), add: nets.flatMap((n) => n.add), nets: [], short: [] });
    for (const [id, k] of islands(structuredClone(q))) if (k > (before.get(id) ?? 1)) return true;
    return false;
  };
  const reverted: Id[] = [];
  if (!r.nets.length || !breaks(r.nets)) return { ...r, reverted };
  let keep = r.nets.filter((n) => {
    const bad = breaks([n]);
    if (bad) reverted.push(n.net);
    return !bad;
  });
  // Вместе тоже могут перерезать: снимаем по одной, начиная с самых узких.
  while (keep.length && breaks(keep)) {
    const drop = keep.reduce((a, b) => (a.need <= b.need ? a : b));
    reverted.push(drop.net);
    keep = keep.filter((n) => n !== drop);
  }
  return {
    remove: keep.flatMap((n) => n.remove),
    add: keep.flatMap((n) => n.add),
    nets: keep,
    short: r.short.filter((n) => !reverted.includes(n.net)),
    reverted,
  };
}

/** Применить подгонку к проекту (на месте). */
export function applyFit(p: Project, r: FitResult): void {
  for (const id of r.remove) delete p.tracks[id];
  for (const t of r.add) addTrack(p, t);
}

