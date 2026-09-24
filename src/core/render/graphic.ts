import { arcPoints, circlePoints } from '../math/geom';
import type { Shape } from '../math/shape';
import { rotate, type Vec2 } from '../math/vec';
import { sideLayer } from '../model/layers';
import { dirToWorld, toWorld, type Placement } from '../model/placement';
import type { Component, Graphic, LayerId } from '../model/types';
import { textStrokes } from './stroke-font';

/* Графические примитивы по слоям: из них собираются экспорт и отрисовка. */

export type Prim =
  | { kind: 'path'; pts: Vec2[]; width: number; closed?: boolean }
  | { kind: 'region'; pts: Vec2[] }
  | { kind: 'flash'; shape: Shape }
  /** Заливка полигона: контуры по правилу чётности, holes[i] — контур-вырез. */
  | { kind: 'fill'; loops: Vec2[][]; holes: boolean[] };

export type LayerPrims = Partial<Record<LayerId, Prim[]>>;

export function push(out: LayerPrims, layer: LayerId, prim: Prim): void {
  (out[layer] ??= []).push(prim);
}

function substitute(text: string, c: Component | null): string {
  if (!c) return text;
  return text.replace(/\$\{REF\}/g, c.ref).replace(/\$\{VALUE\}/g, c.value || '');
}

/** Примитивы одного графического элемента корпуса или платы. */
export function graphicPrims(g: Graphic, pl: Placement | null, comp: Component | null, out: LayerPrims, o: { hideRef?: boolean; hideValue?: boolean } = {}): void {
  const layer = pl ? sideLayer(g.layer, pl.side) : g.layer;
  const T = (p: Vec2): Vec2 => (pl ? toWorld(pl, p) : p);
  switch (g.kind) {
    case 'line':
      push(out, layer, { kind: 'path', pts: [T(g.a), T(g.b)], width: g.width });
      return;
    case 'rect': {
      const pts = [g.a, { x: g.b.x, y: g.a.y }, g.b, { x: g.a.x, y: g.b.y }].map(T);
      push(out, layer, g.fill ? { kind: 'region', pts } : { kind: 'path', pts, width: g.width, closed: true });
      return;
    }
    case 'circle': {
      const pts = circlePoints(g.c, g.r, Math.max(24, Math.ceil(g.r * 24))).map(T);
      push(out, layer, g.fill ? { kind: 'region', pts } : { kind: 'path', pts, width: g.width, closed: true });
      return;
    }
    case 'arc': {
      // Дуга задана против часовой на экране; при установке снизу направление меняется само через T.
      const pts = arcPoints(g.c, g.r, g.start, g.sweep, 0.15).map(T);
      push(out, layer, { kind: 'path', pts, width: g.width });
      return;
    }
    case 'poly': {
      const pts = g.pts.map(T);
      push(out, layer, g.fill ? { kind: 'region', pts } : { kind: 'path', pts, width: g.width, closed: g.closed ?? true });
      return;
    }
    case 'text': {
      if (comp && g.text.includes('${REF}') && (o.hideRef || comp.hideRef)) return;
      if (comp && g.text.includes('${VALUE}') && (o.hideValue || comp.hideValue)) return;
      const text = substitute(g.text, comp);
      if (!text.trim()) return;
      const at = T(g.at);
      let rotation = g.rotation ?? 0;
      let mirror = false;
      if (pl) {
        const d = dirToWorld(pl, rotate({ x: 1, y: 0 }, rotation));
        rotation = (Math.atan2(-d.y, d.x) * 180) / Math.PI;
        mirror = pl.side === 'bottom';
      }
      // Надписи читаемыми: не вверх ногами.
      let r = ((rotation % 360) + 360) % 360;
      if (r > 90 && r < 270) r = (r + 180) % 360;
      const width = g.thickness ?? Math.max(0.1, g.size * 0.15);
      for (const s of textStrokes({ text, at, size: g.size, rotation: r, align: g.align ?? 'center', mirror })) push(out, layer, { kind: 'path', pts: s, width });
      return;
    }
  }
}
