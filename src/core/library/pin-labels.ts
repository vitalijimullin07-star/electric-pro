import type { FootprintDef, Graphic, PadDef } from '../model/types';
import { textWidth, unsupportedChars } from '../render/stroke-font';

/*
 * Распиновка на шелкографии: у каждого вывода с именем (GND, SDA, D13, OUT…) — подпись
 * снаружи от площадки, чтобы её было видно и после пайки детали или модуля.
 * Подпись не должна налезать на площадки и другие подписи: сначала пробуем наружу от
 * корпуса, потом в другие стороны; если места нет (мелкий шаг) — только на сборочном слое.
 */

/** Выводы, которые не подписываем: теплоотвод, крепёж, экран. */
const SKIP = new Set(['EP', 'MP', 'SH', 'SHIELD', 'PAD', 'TAB', 'NC']);
/** Наименьший шаг выводов, при котором подписи ещё читаются. */
const MIN_PITCH = 1.0;

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}
const hit = (a: Box, b: Box) => a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;

/** Имя вывода в символах штрихового шрифта. */
export function labelText(name: string): string {
  const s = name.replace(/[−–—_]/g, '-').replace(/µ/g, 'U');
  const bad = new Set(unsupportedChars(s));
  return [...s].filter((c) => !bad.has(c)).join('').trim();
}

function padHalf(p: PadDef): { hx: number; hy: number } {
  const r = (((p.rotation ?? 0) % 180) + 180) % 180;
  const [w, h] = r === 90 ? [p.size.y, p.size.x] : [p.size.x, p.size.y];
  return { hx: w / 2, hy: h / 2 };
}

function padBox(p: PadDef, m: number): Box {
  const { hx, hy } = padHalf(p);
  return { minX: p.at.x - hx - m, minY: p.at.y - hy - m, maxX: p.at.x + hx + m, maxY: p.at.y + hy + m };
}

/** Есть ли уже подписи выводов на шелкографии (у корпусов, где их нарисовали вручную). */
const hasSilkLabels = (fp: FootprintDef) => fp.graphics.some((g) => g.kind === 'text' && g.layer === 'F.Silk' && !g.text.includes('${'));

/** Корпус с подписями выводов на верхней шелкографии. */
export function withPinLabels(fp: FootprintDef): FootprintDef {
  const pads = fp.pads.filter((p) => p.type !== 'npth');
  const named = pads.filter((p) => p.name && p.name !== p.number && !SKIP.has(p.name.toUpperCase()) && labelText(p.name));
  if (!named.length || hasSilkLabels(fp)) return fp;
  const c = fp.courtyard ? { x: (fp.courtyard.min.x + fp.courtyard.max.x) / 2, y: (fp.courtyard.min.y + fp.courtyard.max.y) / 2 } : { x: 0, y: 0 };
  const obstacles = pads.map((p) => padBox(p, 0.25));
  // Отверстия крепежа — тоже препятствие.
  for (const p of fp.pads) if (p.type === 'npth') obstacles.push(padBox(p, 0.3));
  const placed: Box[] = [];
  const labels: Graphic[] = [];
  for (const p of named) {
    let pitch = Infinity;
    for (const q of pads) if (q !== p) pitch = Math.min(pitch, Math.hypot(q.at.x - p.at.x, q.at.y - p.at.y));
    if (pitch < MIN_PITCH) continue;
    const size = Math.min(1.0, pitch * 0.64);
    const thickness = +Math.max(0.12, size * 0.15).toFixed(2);
    const text = labelText(p.name!);
    const w = textWidth(text, size) + thickness;
    const { hx, hy } = padHalf(p);
    const dx = p.at.x - c.x;
    const dy = p.at.y - c.y;
    // Ряд выводов: по ближайшему соседу. Подпись — поперёк ряда, наружу от корпуса;
    // у одиночного вывода — по преобладающей оси.
    let near: PadDef | null = null;
    let nd = Infinity;
    for (const q of pads) {
      if (q === p) continue;
      const d = Math.hypot(q.at.x - p.at.x, q.at.y - p.at.y);
      if (d < nd - 1e-6) {
        nd = d;
        near = q;
      }
    }
    let axis: 'x' | 'y' = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
    if (near) {
      const ax = Math.abs(near.at.x - p.at.x);
      const ay = Math.abs(near.at.y - p.at.y);
      if (ax < 0.15 * nd) axis = 'x';
      else if (ay < 0.15 * nd) axis = 'y';
    }
    const sgn = axis === 'x' ? Math.sign(dx) || 1 : Math.sign(dy) || 1;
    const primary: [number, number] = axis === 'x' ? [sgn, 0] : [0, sgn];
    const dirs: [number, number][] = [primary, [-primary[0], -primary[1]], [primary[1], primary[0]], [-primary[1], -primary[0]]];
    for (const [ux, uy] of dirs) {
      const gap = 0.3;
      const start = ux ? hx + gap : hy + gap;
      const mid = start + w / 2;
      const at = { x: +(p.at.x + ux * mid).toFixed(3), y: +(p.at.y + uy * mid).toFixed(3) };
      const half = ux ? { x: w / 2, y: size / 2 + thickness / 2 } : { x: size / 2 + thickness / 2, y: w / 2 };
      const box = { minX: at.x - half.x, minY: at.y - half.y, maxX: at.x + half.x, maxY: at.y + half.y };
      if (obstacles.some((o) => hit(o, box)) || placed.some((o) => hit(o, box))) continue;
      placed.push({ minX: box.minX - 0.15, minY: box.minY - 0.15, maxX: box.maxX + 0.15, maxY: box.maxY + 0.15 });
      labels.push({ kind: 'text', layer: 'F.Silk', at, text, size: +size.toFixed(2), thickness, rotation: ux ? 0 : 90, align: 'center' });
      break;
    }
  }
  return labels.length ? { ...fp, graphics: [...fp.graphics, ...labels] } : fp;
}
