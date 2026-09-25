import type { Vec2 } from '../math/vec';
import type { FootprintDef, Graphic, PadDef, PadShape, PadType } from '../model/types';
import { CRT_SMD, CRT_THT, FAB_W, courtyardAround, crtGraphic, r2, rect, refText, silkOutline, valueText, circle } from './generators/util';

/*
 * Конструктор своих корпусов: ряды площадок, автоматический контур и проверка.
 * Им пользуется редактор корпусов; ядро не знает, где хранится «моя библиотека».
 */

export const MY_CATEGORY = 'Мои корпуса';

export interface PadStyle {
  type: PadType;
  shape: PadShape;
  size: Vec2;
  drill?: number;
}

const pad = (number: number | string, at: Vec2, st: PadStyle): PadDef => ({
  number: String(number),
  type: st.type,
  shape: st.shape,
  at: { x: r2(at.x), y: r2(at.y) },
  size: { x: st.size.x, y: st.size.y },
  ...(st.type !== 'smd' && st.drill ? { drill: st.drill } : {}),
  ...(st.shape === 'roundrect' ? { roundness: 0.25 } : {}),
});

/** Ряд из count площадок с шагом pitch, по центру начала координат. dir — вдоль какой оси. */
export function padRow(o: { count: number; pitch: number; dir: 'x' | 'y'; first?: number; style: PadStyle; offset?: Vec2 }): PadDef[] {
  const first = o.first ?? 1;
  const off = o.offset ?? { x: 0, y: 0 };
  const len = (o.count - 1) * o.pitch;
  return Array.from({ length: o.count }, (_, i) => {
    const t = -len / 2 + i * o.pitch;
    return pad(first + i, o.dir === 'x' ? { x: off.x + t, y: off.y } : { x: off.x, y: off.y + t }, o.style);
  });
}

/**
 * Два ряда по perSide площадок (DIP, SOIC): нумерация против часовой, как у микросхем —
 * слева сверху вниз 1…n, справа снизу вверх n+1…2n. span — расстояние между рядами.
 */
export function dualRow(o: { perSide: number; pitch: number; span: number; style: PadStyle }): PadDef[] {
  const n = o.perSide;
  const len = (n - 1) * o.pitch;
  const out: PadDef[] = [];
  for (let i = 0; i < n; i++) out.push(pad(i + 1, { x: -o.span / 2, y: -len / 2 + i * o.pitch }, o.style));
  for (let i = 0; i < n; i++) out.push(pad(n + i + 1, { x: o.span / 2, y: len / 2 - i * o.pitch }, o.style));
  return out;
}

/** Четыре стороны (QFP, QFN): по perSide на сторону, span — расстояние между противоположными рядами. */
export function quadRow(o: { perSide: number; pitch: number; span: number; style: PadStyle }): PadDef[] {
  const n = o.perSide;
  const len = (n - 1) * o.pitch;
  const h = o.span / 2;
  const across: PadStyle = { ...o.style, size: { x: o.style.size.y, y: o.style.size.x } };
  const out: PadDef[] = [];
  let k = 1;
  for (let i = 0; i < n; i++) out.push(pad(k++, { x: -h, y: -len / 2 + i * o.pitch }, o.style)); // слева вниз
  for (let i = 0; i < n; i++) out.push(pad(k++, { x: -len / 2 + i * o.pitch, y: h }, across)); // снизу вправо
  for (let i = 0; i < n; i++) out.push(pad(k++, { x: h, y: len / 2 - i * o.pitch }, o.style)); // справа вверх
  for (let i = 0; i < n; i++) out.push(pad(k++, { x: len / 2 - i * o.pitch, y: -h }, across)); // сверху влево
  return out;
}

/** Габарит площадок. */
export function padsBox(pads: PadDef[]): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pads) {
    const rot = Math.abs(((p.rotation ?? 0) % 180) - 90) < 1e-6;
    const w = (rot ? p.size.y : p.size.x) / 2;
    const h = (rot ? p.size.x : p.size.y) / 2;
    x0 = Math.min(x0, p.at.x - w);
    x1 = Math.max(x1, p.at.x + w);
    y0 = Math.min(y0, p.at.y - h);
    y1 = Math.max(y1, p.at.y + h);
  }
  return Number.isFinite(x0) ? { x0, y0, x1, y1 } : { x0: -1, y0: -1, x1: 1, y1: 1 };
}

/**
 * Графика корпуса по площадкам и размерам тела: контур на сборочном слое, шелкография
 * с разрывами у площадок, метка первого вывода, обозначение и номинал, габарит установки.
 */
export function autoGraphics(pads: PadDef[], body?: { w: number; h: number }): { graphics: Graphic[]; courtyard: { min: Vec2; max: Vec2 } } {
  const pb = padsBox(pads);
  const bw = body && body.w > 0 ? body.w : pb.x1 - pb.x0;
  const bh = body && body.h > 0 ? body.h : pb.y1 - pb.y0;
  const cx = (pb.x0 + pb.x1) / 2;
  const cy = (pb.y0 + pb.y1) / 2;
  const b = { x0: r2(cx - bw / 2), y0: r2(cy - bh / 2), x1: r2(cx + bw / 2), y1: r2(cy + bh / 2) };
  const tht = pads.some((p) => p.type === 'tht');
  const crt = courtyardAround(pads, b, tht ? CRT_THT : CRT_SMD);
  const g: Graphic[] = [rect('F.Fab', b.x0, b.y0, b.x1, b.y1, FAB_W), ...silkOutline(b.x0, b.y0, b.x1, b.y1, pads), crtGraphic(crt)];
  // Метка первого вывода — точка снаружи у площадки 1.
  const p1 = pads.find((p) => p.number === '1');
  if (p1) {
    const dx = p1.at.x - cx;
    const dy = p1.at.y - cy;
    const horiz = Math.abs(dx) / Math.max(bw, 0.01) >= Math.abs(dy) / Math.max(bh, 0.01);
    const off = (horiz ? p1.size.x : p1.size.y) / 2 + 0.45;
    const at = horiz ? { x: r2(p1.at.x + Math.sign(dx || -1) * off), y: p1.at.y } : { x: p1.at.x, y: r2(p1.at.y + Math.sign(dy || -1) * off) };
    g.push(circle('F.Silk', at, 0.15, 0.12, true));
  }
  g.push(refText(crt.min.y - 0.8, cx), valueText(cy, cx, Math.min(1, Math.max(0.5, bh / 3))));
  return { graphics: g, courtyard: crt };
}

/** Замечания к корпусу: ошибки мешают сохранить, остальное — предупреждения. */
export function checkFootprint(fp: FootprintDef): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!fp.name.trim()) errors.push('Нет имени корпуса.');
  if (!fp.pads.length) errors.push('Нет ни одной площадки.');
  fp.pads.forEach((p, i) => {
    const nm = p.type === 'npth' ? `отверстие ${i + 1}` : `площадка ${p.number || i + 1}`;
    if (p.type !== 'npth' && !p.number.trim()) errors.push(`У площадки ${i + 1} нет номера.`);
    if (!(p.size.x > 0 && p.size.y > 0)) errors.push(`${nm}: размер должен быть больше нуля.`);
    if (p.type !== 'smd') {
      if (!(p.drill && p.drill > 0)) errors.push(`${nm}: не задано отверстие.`);
      else if (p.type === 'tht' && p.drill >= Math.min(p.size.x, p.size.y) - 0.1) errors.push(`${nm}: отверстие ${p.drill} мм не оставляет пояска меди.`);
    }
  });
  const nums = fp.pads.filter((p) => p.type !== 'npth').map((p) => p.number);
  const dup = [...new Set(nums.filter((n, i) => nums.indexOf(n) !== i))];
  if (dup.length) warnings.push(`Повторяются номера ${dup.join(', ')}: такие площадки считаются одним выводом (так делают у крепёжных лапок).`);
  for (let i = 0; i < fp.pads.length; i++)
    for (let j = i + 1; j < fp.pads.length; j++) {
      const a = fp.pads[i];
      const b = fp.pads[j];
      if (Math.abs(a.at.x - b.at.x) < 1e-6 && Math.abs(a.at.y - b.at.y) < 1e-6) warnings.push(`Площадки ${a.number} и ${b.number} стоят в одной точке.`);
    }
  return { errors, warnings: [...new Set(warnings)].slice(0, 8) };
}

const TR: Record<string, string> = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };

/** Идентификатор своего корпуса из имени: латиница, без пробелов, с приставкой My_. */
export function myFootprintId(name: string, taken: (id: string) => boolean): string {
  const base =
    'My_' +
    ([...name.toLowerCase()].map((c) => TR[c] ?? c).join('').replace(/[^a-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'footprint');
  let id = base;
  for (let k = 2; taken(id); k++) id = `${base}_${k}`;
  return id;
}
