import { type Shape, capsuleShape, circleShape } from '../math/shape';
import type { Vec2 } from '../math/vec';
import { padCopperLayers, padLocalShape, placementOf, shapeToWorld, toWorld, footprintBounds } from './placement';
import type { Component, CopperLayer, FootprintDef, Id, PadDef, Project, Track, Via, Wire } from './types';
import { padKey } from './types';

/*
 * Геометрия проекта в координатах платы. Считается лениво и кешируется по
 * ссылкам на объекты: после изменения проекта через immer пересчитываются
 * только изменившиеся компоненты и дорожки.
 */

export interface WorldPad {
  key: string;
  component: Component;
  footprint: FootprintDef;
  pad: PadDef;
  net: Id | null;
  center: Vec2;
  shape: Shape;
  layers: CopperLayer[];
  /** Диаметр отверстия или null для планарной площадки. */
  drill: number | null;
  plated: boolean;
}

export interface WorldSegment {
  track: Track;
  index: number;
  a: Vec2;
  b: Vec2;
  shape: Shape;
}

export interface WorldVia {
  via: Via;
  shape: Shape;
}

export interface WorldComponent {
  component: Component;
  footprint: FootprintDef | undefined;
  pads: WorldPad[];
  /** Габарит (courtyard) в координатах платы — четыре угла. */
  outline: Vec2[];
}

export interface World {
  project: Project;
  components: WorldComponent[];
  componentById: Map<Id, WorldComponent>;
  pads: WorldPad[];
  padByKey: Map<string, WorldPad>;
  segments: WorldSegment[];
  segmentsByTrack: Map<Id, WorldSegment[]>;
  vias: WorldVia[];
  wires: Wire[];
}

const compCache = new WeakMap<Component, { fp: FootprintDef | undefined; wc: WorldComponent }>();
const trackCache = new WeakMap<Track, WorldSegment[]>();
const viaCache = new WeakMap<Via, WorldVia>();
const worldCache = new WeakMap<Project, World>();

export function worldComponent(c: Component, fp: FootprintDef | undefined): WorldComponent {
  const hit = compCache.get(c);
  if (hit && hit.fp === fp) return hit.wc;
  const pl = placementOf(c);
  const pads: WorldPad[] = [];
  if (fp)
    for (const pad of fp.pads) {
      const shape = shapeToWorld(pl, padLocalShape(pad));
      pads.push({
        key: padKey(c.id, pad.number),
        component: c,
        footprint: fp,
        pad,
        net: pad.type === 'npth' ? null : (c.padNets[pad.number] ?? null),
        center: toWorld(pl, pad.at),
        shape,
        layers: padCopperLayers(pad, c.side),
        drill: pad.drill ?? null,
        plated: pad.type === 'tht',
      });
    }
  const b = fp ? footprintBounds(fp) : { min: { x: -1, y: -1 }, max: { x: 1, y: 1 } };
  const outline = [
    { x: b.min.x, y: b.min.y },
    { x: b.max.x, y: b.min.y },
    { x: b.max.x, y: b.max.y },
    { x: b.min.x, y: b.max.y },
  ].map((p) => toWorld(pl, p));
  const wc = { component: c, footprint: fp, pads, outline };
  compCache.set(c, { fp, wc });
  return wc;
}

export function trackSegments(t: Track): WorldSegment[] {
  const hit = trackCache.get(t);
  if (hit) return hit;
  const out: WorldSegment[] = [];
  for (let i = 0; i < t.points.length - 1; i++) {
    const a = t.points[i];
    const b = t.points[i + 1];
    out.push({ track: t, index: i, a, b, shape: capsuleShape(a, b, t.width / 2) });
  }
  trackCache.set(t, out);
  return out;
}

export function worldVia(v: Via): WorldVia {
  const hit = viaCache.get(v);
  if (hit) return hit;
  const wv = { via: v, shape: circleShape(v.at, v.diameter / 2) };
  viaCache.set(v, wv);
  return wv;
}

export function getWorld(p: Project): World {
  const hit = worldCache.get(p);
  if (hit) return hit;
  const components: WorldComponent[] = [];
  const componentById = new Map<Id, WorldComponent>();
  const pads: WorldPad[] = [];
  const padByKey = new Map<string, WorldPad>();
  for (const c of Object.values(p.components)) {
    // Выносные детали (дисплей, кнопки на корпусе) на плате не стоят.
    if (c.offBoard) continue;
    const wc = worldComponent(c, p.footprints[c.footprint]);
    components.push(wc);
    componentById.set(c.id, wc);
    for (const wp of wc.pads) {
      pads.push(wp);
      padByKey.set(wp.key, wp);
    }
  }
  const segments: WorldSegment[] = [];
  const segmentsByTrack = new Map<Id, WorldSegment[]>();
  for (const t of Object.values(p.tracks)) {
    const s = trackSegments(t);
    segmentsByTrack.set(t.id, s);
    segments.push(...s);
  }
  const vias = Object.values(p.vias).map(worldVia);
  const w: World = { project: p, components, componentById, pads, padByKey, segments, segmentsByTrack, vias, wires: Object.values(p.wires) };
  worldCache.set(p, w);
  return w;
}

/** Имя вывода для сообщений: "U1.SDA" или "R5.1". */
export function padLabel(wp: WorldPad): string {
  const n = wp.pad.name && wp.pad.name !== wp.pad.number ? wp.pad.name : wp.pad.number;
  return `${wp.component.ref}.${n}`;
}
