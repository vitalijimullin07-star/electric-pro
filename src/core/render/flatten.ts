import { arcPoints, circlePoints } from '../math/geom';
import { type Shape, shapeOutline } from '../math/shape';
import { rotate, type Vec2 } from '../math/vec';
import { sideLayer } from '../model/layers';
import { dirToWorld, padLocalShape, placementOf, shapeToWorld, toWorld, type Placement } from '../model/placement';
import { boardPolygon } from '../model/project';
import type { Component, Graphic, LayerId, Project } from '../model/types';
import { getWorld } from '../model/world';
import { textStrokes } from './stroke-font';

/*
 * Разворачивает проект в примитивы по слоям в координатах платы.
 * Этим пользуются экспорт в Gerber и SVG и отрисовка графики на экране.
 */

export type Prim =
  | { kind: 'path'; pts: Vec2[]; width: number; closed?: boolean }
  | { kind: 'region'; pts: Vec2[] }
  | { kind: 'flash'; shape: Shape };

export type LayerPrims = Partial<Record<LayerId, Prim[]>>;

function push(out: LayerPrims, layer: LayerId, prim: Prim): void {
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


