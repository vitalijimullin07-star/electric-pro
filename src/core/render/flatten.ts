import { type Shape, shapeOutline } from '../math/shape';
import type { Vec2 } from '../math/vec';
import { sideLayer } from '../model/layers';
import { padLocalShape, placementOf, shapeToWorld } from '../model/placement';
import { boardPolygon } from '../model/project';
import type { LayerId, Project } from '../model/types';
import { getWorld } from '../model/world';
import { getTeardrops, getZoneFills } from '../model/connectivity';
import { graphicPrims, push, type LayerPrims } from './graphic';
import { textStrokes } from './stroke-font';

export { graphicPrims, type LayerPrims, type Prim } from './graphic';

/*
 * Разворачивает проект в примитивы по слоям в координатах платы.
 * Этим пользуются экспорт в Gerber и SVG и отрисовка графики на экране.
 */

export interface FlattenOptions {
  /** Показывать позиционные обозначения и номиналы. */
  refs?: boolean;
  values?: boolean;
  /** Отступ маски (для слоёв маски). */
  maskMargin?: number;
  /** Включать габариты и сборочные слои. */
  fab?: boolean;
}

/** Все примитивы проекта по слоям. */
export function flattenProject(p: Project, o: FlattenOptions = {}): LayerPrims {
  const out: LayerPrims = {};
  const w = getWorld(p);
  const maskMargin = o.maskMargin ?? p.rules.maskMargin;

  // Заливка полигонов — первой: медь, выводимая следом, ложится поверх вырезов.
  for (const zf of getZoneFills(p)) if (zf.loops.length) push(out, zf.zone.layer, { kind: 'fill', loops: zf.loops, holes: zf.holes });
  for (const td of getTeardrops(p)) push(out, td.layer, { kind: 'region', pts: td.pts });

  for (const wc of w.components) {
    const c = wc.component;
    const fp = wc.footprint;
    if (!fp) continue;
    const pl = placementOf(c);
    for (const g of fp.graphics) {
      if (!o.fab && (g.layer.endsWith('Fab') || g.layer.endsWith('Courtyard'))) continue;
      graphicPrims(g, pl, c, out, { hideRef: o.refs === false, hideValue: o.values === false });
    }
    for (const pad of fp.pads) {
      if (pad.type === 'npth') continue;
      const layers = pad.type === 'tht' ? (['F.Cu', 'B.Cu'] as LayerId[]) : ([sideLayer('F.Cu', c.side)] as LayerId[]);
      const shape = shapeToWorld(pl, padLocalShape(pad));
      for (const l of layers) push(out, l, { kind: 'flash', shape });
      const mm = pad.maskMargin ?? maskMargin;
      const maskShape = shapeToWorld(pl, padLocalShape(pad, mm));
      for (const l of layers) push(out, l === 'F.Cu' ? 'F.Mask' : 'B.Mask', { kind: 'flash', shape: maskShape });
      if (pad.type === 'smd') push(out, layers[0] === 'F.Cu' ? 'F.Paste' : 'B.Paste', { kind: 'flash', shape });
    }
  }
  for (const t of Object.values(p.tracks)) if (t.points.length >= 2) push(out, t.layer, { kind: 'path', pts: t.points, width: t.width });
  for (const v of w.vias) {
    push(out, 'F.Cu', { kind: 'flash', shape: v.shape });
    push(out, 'B.Cu', { kind: 'flash', shape: v.shape });
    if (!p.rules.tentVias) {
      const m = { ...v.shape, r: v.shape.r + maskMargin };
      push(out, 'F.Mask', { kind: 'flash', shape: m });
      push(out, 'B.Mask', { kind: 'flash', shape: m });
    }
  }
  for (const d of Object.values(p.drawings)) graphicPrims(d, null, null, out);
  for (const ra of Object.values(p.ruleAreas))
    if (ra.showLabel) {
      const top = Math.min(...ra.outline.map((q) => q.y));
      const left = Math.min(...ra.outline.map((q) => q.x));
      for (const s of textStrokes({ text: ra.name, at: { x: left + 1.5, y: top + 1.6 }, size: 1.2, align: 'left' })) push(out, 'F.Silk', { kind: 'path', pts: s, width: 0.18 });
      push(out, 'F.Silk', { kind: 'path', pts: ra.outline, width: 0.15, closed: true });
    }
  push(out, 'Edge.Cuts', { kind: 'path', pts: boardPolygon(p.board), width: 0.1, closed: true });
  for (const cut of p.board.cutouts) push(out, 'Edge.Cuts', { kind: 'path', pts: cut, width: 0.1, closed: true });
  return out;
}

/** Контур примитива-вспышки как многоугольник. */
export const flashOutline = (s: Shape, maxSeg = 0.05): Vec2[] => shapeOutline(s, maxSeg);


