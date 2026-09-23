/** Точка или вектор на плоскости. Все координаты в миллиметрах, ось Y направлена вниз. */
export interface Vec2 {
  x: number;
  y: number;
}

export const vec = (x: number, y: number): Vec2 => ({ x, y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, y: a.y * k });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
export const len = (a: Vec2): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const dist2 = (a: Vec2, b: Vec2): number => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
export const mid = (a: Vec2, b: Vec2): Vec2 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const eq = (a: Vec2, b: Vec2, eps = 1e-6): boolean => Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps;

export function normalize(a: Vec2): Vec2 {
  const l = len(a);
  return l > 0 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 };
}

/**
 * Поворот на угол в градусах. Положительный угол поворачивает против часовой стрелки
 * так, как это видно на экране (ось Y вниз).
 */
export function rotate(p: Vec2, deg: number): Vec2 {
  if (deg === 0) return { x: p.x, y: p.y };
  const r = (deg * Math.PI) / 180;
  const c = cleanTrig(Math.cos(r));
  const s = cleanTrig(Math.sin(r));
  return { x: p.x * c + p.y * s, y: -p.x * s + p.y * c };
}

/** Убирает хвосты вида 6e-17 у синуса и косинуса кратных 90° углов. */
function cleanTrig(v: number): number {
  const r = Math.round(v);
  return Math.abs(v - r) < 1e-12 ? r : v;
}

/** Округление, чтобы не копились ошибки плавающей точки: 0,1 мкм. */
export const roundMm = (v: number): number => Math.round(v * 1e4) / 1e4;
export const roundVec = (p: Vec2): Vec2 => ({ x: roundMm(p.x), y: roundMm(p.y) });

/** Нормализует угол в диапазон [0, 360). */
export function normAngle(deg: number): number {
  const a = deg % 360;
  const r = a < 0 ? a + 360 : a;
  return Math.abs(r - 360) < 1e-9 ? 0 : Math.round(r * 1e6) / 1e6;
}
