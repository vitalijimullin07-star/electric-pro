import { type Box, boxOfPoints, expandBox, pointInPolygon, segmentSegment, segmentsIntersect, closestOnSegment } from './geom';
import type { Vec2 } from './vec';

/**
 * Единая фигура для проверки правил, связности и выбора мышью:
 * выпуклое ядро (точка, отрезок или выпуклый многоугольник), раздутое на радиус r.
 *
 *  - круг: одна точка + радиус;
 *  - дорожка и овальная площадка: отрезок + радиус (капсула);
 *  - прямоугольник: четыре угла, r = 0;
 *  - скруглённый прямоугольник: углы, сдвинутые внутрь на r, + радиус r.
 */
export interface Shape {
  pts: Vec2[];
  r: number;
  box: Box;
}

export function makeShape(pts: Vec2[], r: number): Shape {
  return { pts, r, box: expandBox(boxOfPoints(pts), r) };
}

export const circleShape = (c: Vec2, r: number): Shape => makeShape([c], r);
export const capsuleShape = (a: Vec2, b: Vec2, r: number): Shape => makeShape([a, b], r);

function edges(pts: Vec2[]): [Vec2, Vec2][] {
  if (pts.length === 1) return [[pts[0], pts[0]]];
  if (pts.length === 2) return [[pts[0], pts[1]]];
  const out: [Vec2, Vec2][] = [];
  for (let i = 0; i < pts.length; i++) out.push([pts[i], pts[(i + 1) % pts.length]]);
  return out;
}

/** Расстояние между ядрами фигур (0, если пересекаются). */
function coreDistance(a: Vec2[], b: Vec2[]): { d: number; at: Vec2 } {
  if (a.length >= 3) for (const p of b) if (pointInPolygon(p, a)) return { d: 0, at: p };
  if (b.length >= 3) for (const p of a) if (pointInPolygon(p, b)) return { d: 0, at: p };
  let best = { d: Infinity, at: a[0] };
  for (const [p, q] of edges(a))
    for (const [r, s] of edges(b)) {
      const k = segmentSegment(p, q, r, s);
      if (k.d < best.d) best = k;
      if (best.d === 0) return best;
    }
  return best;
}

/** Зазор между краями фигур (0, если касаются или перекрываются) и точка, где он минимален. */
export function shapeGap(a: Shape, b: Shape): { d: number; at: Vec2 } {
  const k = coreDistance(a.pts, b.pts);
  return { d: Math.max(0, k.d - a.r - b.r), at: k.at };
}

export const shapeDistance = (a: Shape, b: Shape): number => shapeGap(a, b).d;

/** Перекрываются ли фигуры (с допуском eps на касание). */
export function shapesTouch(a: Shape, b: Shape, eps = 1e-4): boolean {
  if (a.box.maxX + eps < b.box.minX || b.box.maxX + eps < a.box.minX) return false;
  if (a.box.maxY + eps < b.box.minY || b.box.maxY + eps < a.box.minY) return false;
  return coreDistance(a.pts, b.pts).d <= a.r + b.r + eps;
}

/** Расстояние от точки до края фигуры, 0 внутри. */
export function distPointShape(p: Vec2, s: Shape): number {
  if (s.pts.length >= 3 && pointInPolygon(p, s.pts)) return 0;
  let m = Infinity;
  for (const [a, b] of edges(s.pts)) {
    const d = closestOnSegment(p, a, b).d;
    if (d < m) m = d;
  }
  return Math.max(0, m - s.r);
}

export const shapeContains = (s: Shape, p: Vec2, eps = 1e-4): boolean => distPointShape(p, s) <= eps;

/** Пересекает ли отрезок ab ядро фигуры (без учёта радиуса) — для быстрых проверок. */
export function segmentHitsCore(a: Vec2, b: Vec2, s: Shape): boolean {
  if (s.pts.length >= 3 && (pointInPolygon(a, s.pts) || pointInPolygon(b, s.pts))) return true;
  for (const [p, q] of edges(s.pts)) if (segmentsIntersect(a, b, p, q)) return true;
  return false;
}

/** Контур фигуры в виде многоугольника (для экспорта Gerber и SVG). */
export function shapeOutline(s: Shape, maxSeg = 0.1): Vec2[] {
  const { pts, r } = s;
  if (r <= 0) return pts.map((p) => ({ ...p }));
  if (pts.length === 1) {
    const n = Math.max(16, Math.ceil((2 * Math.PI * r) / maxSeg));
    const out: Vec2[] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      out.push({ x: pts[0].x + r * Math.cos(a), y: pts[0].y + r * Math.sin(a) });
    }
    return out;
  }
  // Капсула или скруглённый многоугольник: обходим вершины, к каждой добавляем дугу.
  const poly = pts.length === 2 ? [pts[0], pts[1]] : orderCCW(pts);
  const n = poly.length;
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const prev = poly[(i - 1 + n) % n];
    const cur = poly[i];
    const next = poly[(i + 1) % n];
    const a0 = n === 2 ? Math.atan2(cur.y - next.y, cur.x - next.x) - Math.PI / 2 : edgeNormalAngle(prev, cur);
    const a1 = n === 2 ? a0 + Math.PI : edgeNormalAngle(cur, next);
    let sweep = a1 - a0;
    while (sweep < 0) sweep += 2 * Math.PI;
    while (sweep > 2 * Math.PI) sweep -= 2 * Math.PI;
    const steps = Math.max(1, Math.ceil((sweep * r) / maxSeg));
    for (let k = 0; k <= steps; k++) {
      const q = a0 + (sweep * k) / steps;
      out.push({ x: cur.x + r * Math.cos(q), y: cur.y + r * Math.sin(q) });
    }
  }
  return out;
}

/** Угол внешней нормали ребра a→b для многоугольника с обходом по возрастанию угла (в координатах экрана). */
function edgeNormalAngle(a: Vec2, b: Vec2): number {
  return Math.atan2(b.y - a.y, b.x - a.x) - Math.PI / 2;
}

/** Упорядочивает вершины выпуклого многоугольника по возрастанию угла atan2 (в координатах экрана). */
function orderCCW(pts: Vec2[]): Vec2[] {
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  return [...pts].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
}
