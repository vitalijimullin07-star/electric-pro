import { pointInPolygon } from '../math/geom';
import type { Vec2 } from '../math/vec';
import { computeConnectivity } from '../model/connectivity';
import { addTrack, addVia, addWire, clearRouting } from '../model/edit';
import { boardCopperLayers } from '../model/layers';
import { boardPolygon } from '../model/project';
import { netClassOf } from '../model/rules';
import type { Id, Project, Via } from '../model/types';
import { getWorld } from '../model/world';
import type { ZoneFill } from '../model/zone-fill';
import { autoroute, type RouteOptions, type RouteResult } from './autoroute';

/*
 * Автотрассировка с учётом полигонов: цепи, которые уже соединяет заливка
 * (обычно земля), не разводятся дорожками. Если после разводки остальных цепей
 * заливку разрезало, вторым проходом дотягиваются только недостающие связи.
 * На двусторонней плате полигоны одной цепи сшиваются переходными.
 */

export interface ZoneRouteOptions extends RouteOptions {
  /** Ставить переходные-сшивки между полигонами одной цепи на двух слоях. */
  stitch?: boolean;
  /** Шаг сетки сшивки, мм. */
  stitchPitch?: number;
}

export interface ZoneRouteResult extends RouteResult {
  /** Цепи, оставленные полигонам. */
  zoneNets: number;
  /** Переходных-сшивок. */
  stitches: number;
}

function applyResult(p: Project, r: Pick<RouteResult, 'tracks' | 'vias' | 'wires'>): void {
  for (const t of r.tracks) addTrack(p, t);
  for (const v of r.vias) addVia(p, v);
  for (const w of r.wires) addWire(p, w.a, w.b);
}

/** Точка в заливке по правилу чётности. */
function inFill(zf: ZoneFill, q: Vec2): boolean {
  let k = 0;
  for (const l of zf.loops) if (pointInPolygon(q, l)) k++;
  return k % 2 === 1;
}

/** Расстояние от точки до ближайшего края заливки. */
function edgeDist(zf: ZoneFill, q: Vec2, limit: number): number {
  let m = Infinity;
  for (const l of zf.loops)
    for (let i = 0, j = l.length - 1; i < l.length; j = i++) {
      const a = l[j];
      const b = l[i];
      if (Math.min(a.x, b.x) > q.x + limit || Math.max(a.x, b.x) < q.x - limit || Math.min(a.y, b.y) > q.y + limit || Math.max(a.y, b.y) < q.y - limit) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const l2 = dx * dx + dy * dy;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / l2)) : 0;
      m = Math.min(m, Math.hypot(q.x - a.x - t * dx, q.y - a.y - t * dy));
    }
  return m;
}

/**
 * Переходные-сшивки: по сетке с шагом pitch там, где заливка одной цепи есть
 * на обоих слоях и переходное целиком помещается внутри неё, вдали от отверстий.
 */
export function stitchVias(p: Project, pitch = 8): Omit<Via, 'id'>[] {
  if (p.board.copperLayers !== 2) return [];
  const conn = computeConnectivity(p);
  const w = getWorld(p);
  const byNet = new Map<Id, { top: ZoneFill[]; bottom: ZoneFill[] }>();
  for (const zf of conn.zoneFills) {
    if (!zf.zone.net || !zf.loops.length) continue;
    const e = byNet.get(zf.zone.net) ?? { top: [], bottom: [] };
    (zf.zone.layer === 'F.Cu' ? e.top : e.bottom).push(zf);
    byNet.set(zf.zone.net, e);
  }
  const holes: { c: Vec2; r: number }[] = [];
  for (const wp of w.pads) if (wp.drill) holes.push({ c: wp.center, r: Math.max(wp.drill / 2, (wp.shape.box.maxX - wp.shape.box.minX) / 2) });
  for (const v of w.vias) holes.push({ c: v.via.at, r: v.via.diameter / 2 });
  const board = boardPolygon(p.board);
  const out: Omit<Via, 'id'>[] = [];
  for (const [net, { top, bottom }] of byNet) {
    if (!top.length || !bottom.length) continue;
    const cls = netClassOf(p, net);
    const diameter = Math.max(cls.viaDiameter, p.rules.minViaDiameter);
    const drill = Math.max(cls.viaDrill, p.rules.minViaDrill);
    const need = diameter / 2 + 0.05;
    const xs = board.map((q) => q.x);
    const ys = board.map((q) => q.y);
    const x0 = Math.min(...xs);
    const y0 = Math.min(...ys);
    for (let y = y0 + pitch / 2; y < Math.max(...ys); y += pitch)
      for (let x = x0 + pitch / 2; x < Math.max(...xs); x += pitch) {
        const q = { x: +x.toFixed(3), y: +y.toFixed(3) };
        const ok = (fs: ZoneFill[]) => fs.some((zf) => inFill(zf, q) && edgeDist(zf, q, need) >= need);
        if (!ok(top) || !ok(bottom)) continue;
        if (holes.some((h) => Math.hypot(h.c.x - q.x, h.c.y - q.y) < h.r + diameter / 2 + p.rules.holeToHole)) continue;
        out.push({ at: q, diameter, drill });
        holes.push({ c: q, r: diameter / 2 });
      }
  }
  return out;
}

export async function autorouteWithZones(p: Project, o: ZoneRouteOptions = {}): Promise<ZoneRouteResult> {
  const layers = boardCopperLayers(p.board.copperLayers);
  const zoneNets = new Set(Object.values(p.zones).filter((z) => z.net && layers.includes(z.layer)).map((z) => z.net!));
  if (!zoneNets.size) return { ...(await autoroute(p, o)), zoneNets: 0, stitches: 0 };

  // Состояние, от которого разводим: без дорожек, если их стирают.
  const base = structuredClone(p);
  if (!o.keepExisting) clearRouting(base);
  const c0 = computeConnectivity(base);
  const byZone = [...zoneNets].filter((id) => c0.nets.get(id)?.complete);
  const all = o.nets ?? Object.keys(p.nets);
  const first = all.filter((id) => !byZone.includes(id));
  const r1 = await autoroute(base, { ...o, keepExisting: o.keepExisting, nets: first });

  const q = structuredClone(base);
  applyResult(q, r1);
  // Сшивка до второго прохода: переходные соединяют острова заливки на разных слоях.
  const vias = o.stitch === false ? [] : stitchVias(structuredClone(q), o.stitchPitch);
  for (const v of vias) addVia(q, v);
  const c1 = computeConnectivity(structuredClone(q));
  const left = byZone.filter((id) => !c1.nets.get(id)?.complete);
  let r2: RouteResult | null = null;
  if (left.length) r2 = await autoroute(structuredClone(q), { ...o, keepExisting: true, nets: left });
  return {
    tracks: [...r1.tracks, ...(r2?.tracks ?? [])],
    vias: [...r1.vias, ...vias, ...(r2?.vias ?? [])],
    wires: [...r1.wires, ...(r2?.wires ?? [])],
    failed: r1.failed + (r2?.failed ?? 0),
    conflicts: r1.conflicts + (r2?.conflicts ?? 0),
    iterations: r1.iterations + (r2?.iterations ?? 0),
    grid: r1.grid,
    ms: r1.ms + (r2?.ms ?? 0),
    zoneNets: byZone.length - left.length,
    stitches: vias.length,
    hot: [...(r1.hot ?? []), ...(r2?.hot ?? [])],
  };
}
