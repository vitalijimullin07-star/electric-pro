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
/** Подпись размера: длина в мм с запятой, два знака. */
export const dimensionLabel = (a: Vec2, b: Vec2): string => Math.hypot(b.x - a.x, b.y - a.y).toFixed(2).replace('.', ',');

/**
 * Штрихи размерной линии: выносные линии от точек a и b, сама линия со стрелками
 * на расстоянии offset (влево от направления a→b на экране) и число над ней.
 */
export function dimensionStrokes(a: Vec2, b: Vec2, offset: number, size: number): Vec2[][] {
  const L = Math.hypot(b.x - a.x, b.y - a.y);
  if (L < 1e-6) return [];
  const u = { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
  const nrm = { x: u.y, y: -u.x };
  const sg = offset < 0 ? -1 : 1;
  const P = (q: Vec2, s: number, t = 0): Vec2 => ({ x: q.x + nrm.x * s + u.x * t, y: q.y + nrm.y * s + u.y * t });
  const A = P(a, offset);
  const B = P(b, offset);
  const gap = Math.abs(offset) > 1 ? 0.5 * sg : 0;
  const over = 0.8 * sg;
  const arrow = Math.min(1.2, L / 4);
  const out: Vec2[][] = [
    [P(a, gap), P(a, offset + over)],
    [P(b, gap), P(b, offset + over)],
    [A, B],
    [P(A, arrow * 0.35, arrow), A, P(A, -arrow * 0.35, arrow)],
    [P(B, arrow * 0.35, -arrow), B, P(B, -arrow * 0.35, -arrow)],
  ];
  // Надпись над линией, читаемая (не вверх ногами).
  let rot = (Math.atan2(-u.y, u.x) * 180) / Math.PI;
  rot = ((rot % 360) + 360) % 360;
  if (rot > 90 && rot <= 270) rot = (rot + 180) % 360;
  const mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
  const at = P(mid, sg * size * 0.9);
  for (const s of textStrokes({ text: dimensionLabel(a, b), at, size, rotation: rot, align: 'center' })) out.push(s);
  return out;
}

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
    case 'dimension': {
      for (const pts of dimensionStrokes(T(g.a), T(g.b), g.offset, g.size)) push(out, layer, { kind: 'path', pts, width: g.width });
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
