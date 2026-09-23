/** Единицы отображения. Внутри проекта всё хранится в миллиметрах. */
export type DisplayUnit = 'mm' | 'mil' | 'in';

export const MM_PER_MIL = 0.0254;
export const MM_PER_INCH = 25.4;

export const mil = (v: number): number => v * MM_PER_MIL;
export const inch = (v: number): number => v * MM_PER_INCH;

export function fromMm(v: number, u: DisplayUnit): number {
  return u === 'mm' ? v : u === 'mil' ? v / MM_PER_MIL : v / MM_PER_INCH;
}

export function toMm(v: number, u: DisplayUnit): number {
  return u === 'mm' ? v : u === 'mil' ? v * MM_PER_MIL : v * MM_PER_INCH;
}

export const UNIT_LABEL: Record<DisplayUnit, string> = { mm: 'мм', mil: 'mil', in: 'дюйм' };

/** Число для показа: без лишних нулей, с запятой. */
export function fmt(v: number, digits = 3): string {
  if (!Number.isFinite(v)) return '—';
  const s = (Math.round(v * 10 ** digits) / 10 ** digits).toString();
  return s.replace('.', ',');
}

export function fmtLen(mm: number, u: DisplayUnit = 'mm', digits?: number): string {
  const d = digits ?? (u === 'mm' ? 3 : u === 'mil' ? 1 : 4);
  return `${fmt(fromMm(mm, u), d)} ${UNIT_LABEL[u]}`;
}

/** Разбор ввода: принимает запятую и точку, суффиксы mm, мм, mil, in. */
export function parseLen(s: string, defaultUnit: DisplayUnit = 'mm'): number | null {
  const t = s.trim().toLowerCase().replace(',', '.');
  const m = /^(-?\d*\.?\d+)\s*(mm|мм|mil|mils|in|дюйм|")?$/.exec(t);
  if (!m) return null;
  const v = parseFloat(m[1]);
  const u = m[2];
  if (!u) return toMm(v, defaultUnit);
  if (u === 'mm' || u === 'мм') return v;
  if (u.startsWith('mil')) return v * MM_PER_MIL;
  return v * MM_PER_INCH;
}

/** Шаги сетки, которые предлагаются в интерфейсе. */
export const GRID_STEPS: { mm: number; label: string }[] = [
  { mm: 0.05, label: '0,05 мм' },
  { mm: 0.1, label: '0,1 мм' },
  { mm: 0.25, label: '0,25 мм' },
  { mm: 0.5, label: '0,5 мм' },
  { mm: 1, label: '1 мм' },
  { mm: mil(5), label: '5 mil (0,127 мм)' },
  { mm: mil(10), label: '10 mil (0,254 мм)' },
  { mm: mil(25), label: '25 mil (0,635 мм)' },
  { mm: mil(50), label: '50 mil (1,27 мм)' },
  { mm: mil(100), label: '100 mil (2,54 мм)' },
];

export const snapTo = (v: number, step: number): number => (step > 0 ? Math.round(Math.round(v / step) * step * 1e4) / 1e4 : v);
