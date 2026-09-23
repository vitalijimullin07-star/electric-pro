import { type Vec2, cross, dist, sub } from './vec';

/** Прямоугольник, выровненный по осям. */
export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const emptyBox = (): Box => ({ minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
export const isEmptyBox = (b: Box): boolean => !(b.minX <= b.maxX && b.minY <= b.maxY);

export function boxOfPoints(pts: readonly Vec2[], pad = 0): Box {
  const b = emptyBox();
  for (const p of pts) {
    if (p.x < b.minX) b.minX = p.x;
    if (p.y < b.minY) b.minY = p.y;
    if (p.x > b.maxX) b.maxX = p.x;
    if (p.y > b.maxY) b.maxY = p.y;
  }
  return pad ? expandBox(b, pad) : b;
}

export function unionBox(a: Box, b: Box): Box {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

export const expandBox = (b: Box, d: number): Box => ({
  minX: b.minX - d,
  minY: b.minY - d,
  maxX: b.maxX + d,
  maxY: b.maxY + d,
});

export const boxesOverlap = (a: Box, b: Box): boolean =>
  a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;

export const boxContains = (b: Box, p: Vec2): boolean =>
  p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;

export const boxCenter = (b: Box): Vec2 => ({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 });
export const boxWidth = (b: Box): number => b.maxX - b.minX;
export const boxHeight = (b: Box): number => b.maxY - b.minY;

/** Ближайшая к p точка отрезка ab и расстояние до неё. */
export function closestOnSegment(p: Vec2, a: Vec2, b: Vec2): { q: Vec2; t: number; d: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const q = { x: a.x + t * dx, y: a.y + t * dy };
  return { q, t, d: Math.hypot(p.x - q.x, p.y - q.y) };
}

export const distPointSegment = (p: Vec2, a: Vec2, b: Vec2): number => closestOnSegment(p, a, b).d;

function orient(a: Vec2, b: Vec2, c: Vec2): number {
  const v = cross(sub(b, a), sub(c, a));
  return Math.abs(v) < 1e-12 ? 0 : Math.sign(v);
}

function onSegment(a: Vec2, b: Vec2, p: Vec2): boolean {
  return (
    Math.min(a.x, b.x) - 1e-12 <= p.x &&
    p.x <= Math.max(a.x, b.x) + 1e-12 &&
    Math.min(a.y, b.y) - 1e-12 <= p.y &&
    p.y <= Math.max(a.y, b.y) + 1e-12
  );
}

/** Пересекаются ли отрезки ab и cd, включая касание. */
export function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(a, b, c)) return true;
  if (o2 === 0 && onSegment(a, b, d)) return true;
  if (o3 === 0 && onSegment(c, d, a)) return true;
  if (o4 === 0 && onSegment(c, d, b)) return true;
  return false;
}

/** Точка пересечения прямых ab и cd, если они не параллельны. */
export function lineIntersection(a: Vec2, b: Vec2, c: Vec2, d: Vec2): Vec2 | null {
  const den = (a.x - b.x) * (c.y - d.y) - (a.y - b.y) * (c.x - d.x);
  if (Math.abs(den) < 1e-12) return null;
  const t = ((a.x - c.x) * (c.y - d.y) - (a.y - c.y) * (c.x - d.x)) / den;
  return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
}

/** Кратчайшее расстояние между отрезками и точка, где оно достигается (середина между ближайшими точками). */
export function segmentSegment(a: Vec2, b: Vec2, c: Vec2, d: Vec2): { d: number; at: Vec2 } {
  if (segmentsIntersect(a, b, c, d)) {
    const p = lineIntersection(a, b, c, d) ?? a;
    return { d: 0, at: p };
  }
  const cands = [
    { p: a, r: closestOnSegment(a, c, d) },
    { p: b, r: closestOnSegment(b, c, d) },
    { p: c, r: closestOnSegment(c, a, b) },
    { p: d, r: closestOnSegment(d, a, b) },
  ];
  let best = cands[0];
  for (const k of cands) if (k.r.d < best.r.d) best = k;
  return { d: best.r.d, at: { x: (best.p.x + best.r.q.x) / 2, y: (best.p.y + best.r.q.y) / 2 } };
}

/** Точка внутри многоугольника (правило чётности, границы считаются внутри с точностью eps). */
export function pointInPolygon(p: Vec2, poly: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y) {
      const x = ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
      if (p.x < x) inside = !inside;
    }
  }
  return inside;
}

/** Расстояние от точки до контура многоугольника. */
export function distToPolygonEdge(p: Vec2, poly: readonly Vec2[]): number {
  let m = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const d = distPointSegment(p, poly[i], poly[(i + 1) % poly.length]);
    if (d < m) m = d;
  }
  return m;
}

/** Площадь со знаком: > 0, если обход против часовой стрелки на экране. */
export function signedArea(poly: readonly Vec2[]): number {
  let s = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) s += (poly[j].x - poly[i].x) * (poly[j].y + poly[i].y);
  return s / 2;
}

export function polygonLength(pts: readonly Vec2[], closed = false): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += dist(pts[i - 1], pts[i]);
  if (closed && pts.length > 2) l += dist(pts[pts.length - 1], pts[0]);
  return l;
}

/** Выпуклая оболочка (монотонная цепочка Эндрю). */
export function convexHull(points: readonly Vec2[]): Vec2[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const lower: Vec2[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(sub(lower[lower.length - 1], lower[lower.length - 2]), sub(p, lower[lower.length - 1])) <= 0)
      lower.pop();
    lower.push(p);
  }
  const upper: Vec2[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(sub(upper[upper.length - 1], upper[upper.length - 2]), sub(p, upper[upper.length - 1])) <= 0)
      upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

/** Дуга окружности, разбитая на отрезки. Углы в градусах, против часовой стрелки на экране. */
export function arcPoints(c: Vec2, r: number, startDeg: number, sweepDeg: number, maxSeg = 0.25): Vec2[] {
  const steps = Math.max(2, Math.ceil((Math.abs(sweepDeg) * Math.PI * r) / 180 / maxSeg), Math.ceil(Math.abs(sweepDeg) / 10));
  const out: Vec2[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = ((startDeg + (sweepDeg * i) / steps) * Math.PI) / 180;
    out.push({ x: c.x + r * Math.cos(a), y: c.y - r * Math.sin(a) });
  }
  return out;
}

export function circlePoints(c: Vec2, r: number, n = 32): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) });
  }
  return out;
}

/**
 * Многоугольник со скруглёнными выпуклыми углами. Радиус уменьшается там,
 * где соседние рёбра слишком короткие.
 */
export function filletPolygon(poly: readonly Vec2[], radius: number, maxSeg = 0.2): Vec2[] {
  if (radius <= 0 || poly.length < 3) return [...poly];
  const out: Vec2[] = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const p0 = poly[(i - 1 + n) % n];
    const p1 = poly[i];
    const p2 = poly[(i + 1) % n];
    const l1 = dist(p0, p1);
    const l2 = dist(p1, p2);
    const u1 = { x: (p0.x - p1.x) / l1, y: (p0.y - p1.y) / l1 };
    const u2 = { x: (p2.x - p1.x) / l2, y: (p2.y - p1.y) / l2 };
    const cosA = Math.max(-1, Math.min(1, u1.x * u2.x + u1.y * u2.y));
    const ang = Math.acos(cosA);
    if (ang < 1e-3 || Math.PI - ang < 1e-3) {
      out.push(p1);
      continue;
    }
    const t = Math.min(radius / Math.tan(ang / 2), l1 / 2, l2 / 2);
    const r = t * Math.tan(ang / 2);
    const a = { x: p1.x + u1.x * t, y: p1.y + u1.y * t };
    const b = { x: p1.x + u2.x * t, y: p1.y + u2.y * t };
    const bis = { x: u1.x + u2.x, y: u1.y + u2.y };
    const bl = Math.hypot(bis.x, bis.y);
    const cd = r / Math.sin(ang / 2);
    const c = { x: p1.x + (bis.x / bl) * cd, y: p1.y + (bis.y / bl) * cd };
    const sa = Math.atan2(a.y - c.y, a.x - c.x);
    let sb = Math.atan2(b.y - c.y, b.x - c.x);
    let sweep = sb - sa;
    while (sweep > Math.PI) sweep -= 2 * Math.PI;
    while (sweep < -Math.PI) sweep += 2 * Math.PI;
    sb = sa + sweep;
    const steps = Math.max(2, Math.ceil((Math.abs(sweep) * r) / maxSeg));
    for (let k = 0; k <= steps; k++) {
      const q = sa + (sweep * k) / steps;
      out.push({ x: c.x + r * Math.cos(q), y: c.y + r * Math.sin(q) });
    }
  }
  return out;
}
