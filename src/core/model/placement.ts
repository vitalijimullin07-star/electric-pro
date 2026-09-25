import { type Vec2, rotate, add } from '../math/vec';
import { type Shape, makeShape, circleShape, capsuleShape } from '../math/shape';
import type { Component, CopperLayer, FootprintDef, PadDef, Side } from './types';

/** Положение корпуса на плате. */
export interface Placement {
  at: Vec2;
  rotation: number;
  side: Side;
}

/**
 * Координаты корпуса → координаты платы. Для нижней стороны корпус
 * сначала зеркалится по X (как если перевернуть плату), затем поворачивается.
 */
export function toWorld(pl: Placement, p: Vec2): Vec2 {
  const q = pl.side === 'bottom' ? { x: -p.x, y: p.y } : p;
  return add(rotate(q, pl.rotation), pl.at);
}

/** Обратное преобразование: координаты платы → координаты корпуса. */
export function toLocal(pl: Placement, p: Vec2): Vec2 {
  const q = rotate({ x: p.x - pl.at.x, y: p.y - pl.at.y }, -pl.rotation);
  return pl.side === 'bottom' ? { x: -q.x, y: q.y } : q;
}

/** Направление (вектор без переноса) из корпуса на плату. */
export function dirToWorld(pl: Placement, v: Vec2): Vec2 {
  const q = pl.side === 'bottom' ? { x: -v.x, y: v.y } : v;
  return rotate(q, pl.rotation);
}

/** Слои меди, на которых есть площадка. */
export function padCopperLayers(pad: PadDef, side: Side): CopperLayer[] {
  if (pad.type === 'npth') return [];
  if (pad.type === 'tht') return ['F.Cu', 'B.Cu'];
  // Площадка на обратной стороне корпуса оказывается на противоположном слое.
  const top = (side === 'top') !== (pad.layer === 'B.Cu');
  return [top ? 'F.Cu' : 'B.Cu'];
}

/** Фигура площадки в координатах корпуса, раздутая на delta ≥ 0 (для маски и зазоров). */
export function padLocalShape(pad: PadDef, delta = 0): Shape {
  const { x: w, y: h } = pad.size;
  const c = pad.at;
  const rot = pad.rotation ?? 0;
  const R = (x: number, y: number): Vec2 => add(rotate({ x, y }, rot), c);
  const box = (hw: number, hh: number, r: number): Shape => {
    if (hw <= 1e-9 && hh <= 1e-9) return circleShape(c, r);
    if (hw <= 1e-9) return capsuleShape(R(0, -hh), R(0, hh), r);
    if (hh <= 1e-9) return capsuleShape(R(-hw, 0), R(hw, 0), r);
    return makeShape([R(-hw, -hh), R(hw, -hh), R(hw, hh), R(-hw, hh)], r);
  };
  switch (pad.shape) {
    case 'circle':
      return circleShape(c, Math.max(w, h) / 2 + delta);
    case 'oval': {
      const r = Math.min(w, h) / 2;
      return box(w / 2 - r, h / 2 - r, r + delta);
    }
    case 'roundrect': {
      const r = Math.min(w, h) * Math.min(0.5, Math.max(0, pad.roundness ?? 0.25));
      return box(w / 2 - r, h / 2 - r, r + delta);
    }
    case 'rect':
    default:
      return box(w / 2, h / 2, delta);
  }
}

/** Переносит фигуру из координат корпуса на плату. */
export function shapeToWorld(pl: Placement, s: Shape): Shape {
  return makeShape(
    s.pts.map((p) => toWorld(pl, p)),
    s.r,
  );
}

export const placementOf = (c: Component): Placement => ({ at: c.at, rotation: c.rotation, side: c.side });

/** Габарит корпуса в его координатах: courtyard, а если не задан — площадки и графика. */
export function footprintBounds(fp: FootprintDef): { min: Vec2; max: Vec2 } {
  if (fp.courtyard) return fp.courtyard;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const addP = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  for (const p of fp.pads) {
    const s = padLocalShape(p);
    addP(s.box.minX, s.box.minY);
    addP(s.box.maxX, s.box.maxY);
  }
  for (const g of fp.graphics) {
    if (g.kind === 'line' || g.kind === 'rect' || g.kind === 'dimension') {
      addP(g.a.x, g.a.y);
      addP(g.b.x, g.b.y);
    } else if (g.kind === 'circle' || g.kind === 'arc') {
      addP(g.c.x - g.r, g.c.y - g.r);
      addP(g.c.x + g.r, g.c.y + g.r);
    } else if (g.kind === 'poly') for (const q of g.pts) addP(q.x, q.y);
  }
  if (minX > maxX) return { min: { x: -1, y: -1 }, max: { x: 1, y: 1 } };
  return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } };
}
