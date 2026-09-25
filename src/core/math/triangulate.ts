import type { Vec2 } from './vec';

/*
 * Триангуляция простого многоугольника отсечением «ушей». Для контура платы
 * (десятки–сотни вершин) быстрее не нужно. Возвращает тройки индексов вершин.
 */

const area = (p: Vec2[]): number => {
  let s = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) s += (p[j].x - p[i].x) * (p[j].y + p[i].y);
  return s / 2;
};

const cross = (a: Vec2, b: Vec2, c: Vec2): number => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

function inTri(p: Vec2, a: Vec2, b: Vec2, c: Vec2): boolean {
  const d1 = cross(a, b, p);
  const d2 = cross(b, c, p);
  const d3 = cross(c, a, p);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

export function triangulate(poly: Vec2[]): number[] {
  const n = poly.length;
  if (n < 3) return [];
  // Обход, при котором «ухо» — выпуклая вершина с cross > 0.
  let idx = Array.from({ length: n }, (_, i) => i);
  if (area(poly) < 0) idx = idx.reverse();
  const out: number[] = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < n * n) {
    let cut = false;
    for (let k = 0; k < idx.length; k++) {
      const i0 = idx[(k - 1 + idx.length) % idx.length];
      const i1 = idx[k];
      const i2 = idx[(k + 1) % idx.length];
      const a = poly[i0];
      const b = poly[i1];
      const c = poly[i2];
      if (cross(a, b, c) <= 1e-12) continue;
      let inside = false;
      for (const j of idx) {
        if (j === i0 || j === i1 || j === i2) continue;
        if (inTri(poly[j], a, b, c)) {
          inside = true;
          break;
        }
      }
      if (inside) continue;
      out.push(i0, i1, i2);
      idx.splice(k, 1);
      cut = true;
      break;
    }
    // Вырожденный остаток (совпадающие точки) — отрезаем как есть.
    if (!cut) {
      out.push(idx[0], idx[1], idx[2]);
      idx.splice(1, 1);
    }
  }
  if (idx.length === 3) out.push(idx[0], idx[1], idx[2]);
  return out;
}
