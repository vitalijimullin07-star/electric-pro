import { closestOnSegment, pointInPolygon, distToPolygonEdge } from '@core/math/geom';
import { shapeContains } from '@core/math/shape';
import { dist, type Vec2 } from '@core/math/vec';
import { sideLayer } from '@core/model/layers';
import { placementOf, toWorld } from '@core/model/placement';
import type { CopperLayer, ItemRef, LayerId, Project } from '@core/model/types';
import { getWorld, type WorldPad } from '@core/model/world';
import { dimensionStrokes } from '@core/render/graphic';

/* Что находится под курсором. Порядок: площадки, переходные, дорожки, перемычки, компоненты, графика, области. */

export interface Hit {
  ref: ItemRef;
  /** Площадка, если попали в неё. */
  pad?: WorldPad;
  /** Номер отрезка дорожки. */
  segment?: number;
  /** Индекс вершины (дорожки, контура области). */
  vertex?: number;
  layer?: LayerId;
  distance: number;
  /** Попали внутрь полигона, а не в его край: щелчок выделяет, протяжка — рамка. */
  inside?: boolean;
}

export interface HitOptions {
  /** Допуск в мм. */
  tol: number;
  visible: Record<LayerId, boolean>;
  activeLayer: CopperLayer;
  copperLayers: CopperLayer[];
  /** Искать только медь (для трассировки). */
  copperOnly?: boolean;
}

export function hitTest(p: Project, pt: Vec2, o: HitOptions): Hit[] {
  const w = getWorld(p);
  const hits: Hit[] = [];
  const cuVisible = (l: CopperLayer) => o.visible[l] && o.copperLayers.includes(l);

  for (const wp of w.pads) {
    if (wp.pad.type === 'npth') continue;
    if (!wp.layers.some(cuVisible) && !(wp.layers.length && !o.copperOnly)) continue;
    if (Math.abs(pt.x - wp.center.x) > wp.shape.box.maxX - wp.shape.box.minX + o.tol || Math.abs(pt.y - wp.center.y) > wp.shape.box.maxY - wp.shape.box.minY + o.tol) continue;
    if (shapeContains(wp.shape, pt, o.tol * 0.5)) hits.push({ ref: { kind: 'component', id: wp.component.id }, pad: wp, layer: wp.layers[0], distance: dist(pt, wp.center) - Math.min(wp.pad.size.x, wp.pad.size.y) / 2 });
  }
  for (const v of w.vias) {
    const d = dist(pt, v.via.at) - v.via.diameter / 2;
    if (d <= o.tol) hits.push({ ref: { kind: 'via', id: v.via.id }, distance: d });
  }
  for (const s of w.segments) {
    if (!cuVisible(s.track.layer)) continue;
    const bx = s.shape.box;
    if (pt.x < bx.minX - o.tol || pt.x > bx.maxX + o.tol || pt.y < bx.minY - o.tol || pt.y > bx.maxY + o.tol) continue;
    const r = closestOnSegment(pt, s.a, s.b);
    const d = r.d - s.track.width / 2;
    if (d <= o.tol) {
      // Точнее — вершина?
      let vertex: number | undefined;
      if (dist(pt, s.a) <= Math.max(o.tol, s.track.width / 2)) vertex = s.index;
      else if (dist(pt, s.b) <= Math.max(o.tol, s.track.width / 2)) vertex = s.index + 1;
      hits.push({ ref: { kind: 'track', id: s.track.id }, segment: s.index, vertex, layer: s.track.layer, distance: d + (s.track.layer === o.activeLayer ? 0 : 0.001) });
    }
  }
  for (const wr of w.wires) {
    const r = closestOnSegment(pt, wr.a, wr.b);
    if (r.d <= o.tol + 0.3) hits.push({ ref: { kind: 'wire', id: wr.id }, distance: r.d, vertex: dist(pt, wr.a) <= o.tol ? 0 : dist(pt, wr.b) <= o.tol ? 1 : undefined });
  }
  if (o.copperOnly) return hits.sort((a, b) => a.distance - b.distance);

  for (const wc of w.components) {
    if (pointInPolygon(pt, wc.outline)) hits.push({ ref: { kind: 'component', id: wc.component.id }, distance: 0.5 + distToPolygonEdge(pt, wc.outline) * 0.01 });
    else {
      // Подпись компонента тоже считается за него.
      const fp = wc.footprint;
      if (fp) {
        const pl = placementOf(wc.component);
        for (const g of fp.graphics) {
          if (g.kind !== 'text') continue;
          const at = toWorld(pl, g.at);
          const text = g.text.replace('${REF}', wc.component.ref).replace('${VALUE}', wc.component.value);
          const hw = (text.length * g.size * 0.83) / 2;
          if (Math.abs(pt.x - at.x) <= hw && Math.abs(pt.y - at.y) <= g.size * 0.7 && o.visible[sideLayer(g.layer, wc.component.side)]) hits.push({ ref: { kind: 'component', id: wc.component.id }, distance: 0.6 });
        }
      }
    }
  }
  for (const d of Object.values(p.drawings)) {
    if (!o.visible[d.layer]) continue;
    const dd = drawingDistance(d, pt);
    if (dd !== null && dd <= o.tol) hits.push({ ref: { kind: 'drawing', id: d.id }, distance: 0.7 + dd });
  }
  for (const z of Object.values(p.zones)) {
    if (!cuVisible(z.layer)) continue;
    const de = distToPolygonEdge(pt, z.outline);
    if (de <= o.tol) hits.push({ ref: { kind: 'zone', id: z.id }, distance: 0.8 + de, vertex: vertexNear(z.outline, pt, o.tol) });
    else if (pointInPolygon(pt, z.outline)) hits.push({ ref: { kind: 'zone', id: z.id }, distance: 2, inside: true });
  }
  for (const ra of Object.values(p.ruleAreas)) {
    const de = distToPolygonEdge(pt, ra.outline);
    if (de <= o.tol) hits.push({ ref: { kind: 'ruleArea', id: ra.id }, distance: 0.9 + de, vertex: vertexNear(ra.outline, pt, o.tol) });
  }
  return hits.sort((a, b) => a.distance - b.distance);
}

function vertexNear(poly: Vec2[], pt: Vec2, tol: number): number | undefined {
  for (let i = 0; i < poly.length; i++) if (dist(poly[i], pt) <= tol) return i;
  return undefined;
}

function drawingDistance(d: Project['drawings'][string], pt: Vec2): number | null {
  switch (d.kind) {
    case 'line':
      return closestOnSegment(pt, d.a, d.b).d - d.width / 2;
    case 'rect': {
      const pts = [d.a, { x: d.b.x, y: d.a.y }, d.b, { x: d.a.x, y: d.b.y }];
      if (d.fill && pointInPolygon(pt, pts)) return 0;
      return distToPolygonEdge(pt, pts) - d.width / 2;
    }
    case 'circle': {
      const r = dist(pt, d.c);
      return d.fill ? Math.max(0, r - d.r) : Math.abs(r - d.r) - d.width / 2;
    }
    case 'arc':
      return Math.abs(dist(pt, d.c) - d.r) - d.width / 2;
    case 'dimension': {
      let m = Infinity;
      for (const s of dimensionStrokes(d.a, d.b, d.offset, d.size).slice(0, 3)) m = Math.min(m, closestOnSegment(pt, s[0], s[1]).d);
      return m - d.width / 2;
    }
    case 'poly': {
      if (d.fill && d.pts.length > 2 && pointInPolygon(pt, d.pts)) return 0;
      let m = Infinity;
      const n = d.closed === false ? d.pts.length - 1 : d.pts.length;
      for (let i = 0; i < n; i++) m = Math.min(m, closestOnSegment(pt, d.pts[i], d.pts[(i + 1) % d.pts.length]).d);
      return m - d.width / 2;
    }
    case 'text': {
      const hw = (d.text.length * d.size * 0.83) / 2;
      const dx = d.align === 'left' ? pt.x - d.at.x - hw : d.align === 'right' ? pt.x - d.at.x + hw : pt.x - d.at.x;
      return Math.abs(dx) <= hw && Math.abs(pt.y - d.at.y) <= d.size * 0.7 ? 0 : null;
    }
  }
}


