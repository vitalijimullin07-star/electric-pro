import type { Vec2 } from '../math/vec';
import type { FootprintDef } from '../model/types';

/*
 * Символы схемы строятся сами по корпусу: резистор, конденсатор (полярный),
 * индуктивность, диод, светодиод, предохранитель, кварц, кнопка, транзистор
 * (если известны имена выводов B/C/E или G/D/S), разъём, прочее — прямоугольник
 * с подписанными выводами. Единицы — мм, сетка 2,54, ось Y вниз.
 */

export const SCH_GRID = 2.54;

export type SymGfx =
  | { kind: 'line'; a: Vec2; b: Vec2 }
  | { kind: 'rect'; a: Vec2; b: Vec2; fill?: boolean }
  | { kind: 'circle'; c: Vec2; r: number; fill?: boolean }
  | { kind: 'poly'; pts: Vec2[]; fill?: boolean; closed?: boolean }
  | { kind: 'text'; at: Vec2; text: string; size: number; align: 'left' | 'center' | 'right' };

export interface SymPin {
  /** Номер вывода корпуса (как у площадки). */
  number: string;
  name: string;
  /** Точка подключения провода (внешний конец вывода). */
  at: Vec2;
  /** Где вывод входит в тело символа. */
  base: Vec2;
  showName: boolean;
  showNumber: boolean;
}

export interface SymbolDef {
  pins: SymPin[];
  gfx: SymGfx[];
  box: { min: Vec2; max: Vec2 };
  refAt: Vec2;
  valueAt: Vec2;
}

const P = (x: number, y: number): Vec2 => ({ x, y });
const G = SCH_GRID;

/** Электрические выводы корпуса без повторов номеров. */
export function electricalPins(fp: FootprintDef): { number: string; name: string }[] {
  const seen = new Set<string>();
  const out: { number: string; name: string }[] = [];
  for (const p of fp.pads) {
    if (p.type === 'npth' || !p.number || seen.has(p.number)) continue;
    seen.add(p.number);
    out.push({ number: p.number, name: p.name ?? '' });
  }
  return out;
}

function boxOf(g: SymGfx[], pins: SymPin[]): { min: Vec2; max: Vec2 } {
  const pts: Vec2[] = [];
  for (const x of g) {
    if (x.kind === 'line' || x.kind === 'rect') pts.push(x.a, x.b);
    else if (x.kind === 'circle') pts.push(P(x.c.x - x.r, x.c.y - x.r), P(x.c.x + x.r, x.c.y + x.r));
    else if (x.kind === 'poly') pts.push(...x.pts);
  }
  for (const p of pins) pts.push(p.at, p.base);
  const xs = pts.map((q) => q.x);
  const ys = pts.map((q) => q.y);
  return { min: P(Math.min(...xs), Math.min(...ys)), max: P(Math.max(...xs), Math.max(...ys)) };
}

function finish(pins: SymPin[], gfx: SymGfx[]): SymbolDef {
  const box = boxOf(gfx, pins);
  return { pins, gfx, box, refAt: P((box.min.x + box.max.x) / 2, box.min.y - 1.6), valueAt: P((box.min.x + box.max.x) / 2, box.max.y + 1.6) };
}

/** Двухвыводной символ: левый и правый вывод, тело между ±2,54. */
function twoPin(left: { number: string; name: string }, right: { number: string; name: string }, body: SymGfx[], leftBase = -G, rightBase = G): SymbolDef {
  const pins: SymPin[] = [
    { number: left.number, name: left.name, at: P(-2 * G, 0), base: P(leftBase, 0), showName: false, showNumber: false },
    { number: right.number, name: right.name, at: P(2 * G, 0), base: P(rightBase, 0), showName: false, showNumber: false },
  ];
  return finish(pins, body);
}

const arrow = (x: number, y: number, dx: number, dy: number): SymGfx[] => {
  const L = Math.hypot(dx, dy);
  const ux = dx / L;
  const uy = dy / L;
  const tip = P(x + dx, y + dy);
  return [
    { kind: 'line', a: P(x, y), b: tip },
    { kind: 'poly', pts: [tip, P(tip.x - ux * 0.6 - uy * 0.3, tip.y - uy * 0.6 + ux * 0.3), P(tip.x - ux * 0.6 + uy * 0.3, tip.y - uy * 0.6 - ux * 0.3)], fill: true, closed: true },
  ];
};

/** Прямоугольник с выводами слева и справа (микросхемы, модули) или только слева (разъёмы). */
function boxSymbol(pins0: { number: string; name: string }[], oneSide: boolean): SymbolDef {
  const n = pins0.length;
  const left = oneSide ? pins0 : pins0.slice(0, Math.ceil(n / 2));
  const right = oneSide ? [] : pins0.slice(Math.ceil(n / 2)).reverse();
  const rows = Math.max(left.length, right.length, 1);
  const longest = Math.max(0, ...pins0.map((p) => p.name.length));
  const inner = oneSide ? Math.max(2 * G, Math.ceil((longest * 1.05 + 1.5) / G) * G) : Math.max(4 * G, Math.ceil((2 * longest * 1.05 + 2.5) / G) * G);
  const w = inner;
  const h = (rows + 1) * G;
  const x0 = oneSide ? 0 : -Math.round(w / 2 / G) * G;
  const x1 = x0 + w;
  const y0 = -Math.round(rows / 2) * G;
  const pins: SymPin[] = [];
  left.forEach((p, i) => pins.push({ ...p, at: P(x0 - G, y0 + (i + 1) * G), base: P(x0, y0 + (i + 1) * G), showName: !!p.name && p.name !== p.number, showNumber: true }));
  right.forEach((p, i) => pins.push({ ...p, at: P(x1 + G, y0 + (i + 1) * G), base: P(x1, y0 + (i + 1) * G), showName: !!p.name && p.name !== p.number, showNumber: true }));
  return finish(pins, [{ kind: 'rect', a: P(x0, y0), b: P(x1, y0 + h) }]);
}

const find = (pins: { number: string; name: string }[], ...names: string[]) => pins.find((p) => names.includes(p.name.toUpperCase()));

/** Символ для корпуса (null — у корпуса нет электрических выводов). */
export function symbolFor(fp: FootprintDef): SymbolDef | null {
  const pins = electricalPins(fp);
  if (!pins.length) return null;
  const cat = fp.category;
  const id = `${fp.id} ${fp.name} ${fp.group ?? ''}`.toLowerCase();
  const pre = (fp.refPrefix ?? '').toUpperCase();
  if (pins.length === 2) {
    const [a, b] = pins;
    if (cat === 'Резисторы' || pre === 'R') return twoPin(a, b, [{ kind: 'rect', a: P(-G, -0.9), b: P(G, 0.9) }]);
    if (cat === 'Конденсаторы' || pre === 'C') {
      const polar = /cp|электролит|tantal|танта|elko|polar|полярн/.test(id) || pins.some((p) => p.name === '+');
      const plates: SymGfx[] = [
        { kind: 'line', a: P(-G, 0), b: P(-0.5, 0) },
        { kind: 'line', a: P(0.5, 0), b: P(G, 0) },
        { kind: 'line', a: P(-0.5, -1.8), b: P(-0.5, 1.8) },
        polar ? { kind: 'poly', pts: [P(1.1, -1.8), P(0.55, -0.9), P(0.45, 0), P(0.55, 0.9), P(1.1, 1.8)] } : { kind: 'line', a: P(0.5, -1.8), b: P(0.5, 1.8) },
      ];
      if (polar) plates.push({ kind: 'text', at: P(-1.6, -1.6), text: '+', size: 1.2, align: 'center' });
      const plus = pins.find((p) => p.name === '+') ?? a;
      const minus = plus === a ? b : a;
      return twoPin(plus, minus, plates, -G, G);
    }
    if (cat === 'Индуктивности' || pre === 'L') {
      const g: SymGfx[] = [];
      for (let k = 0; k < 4; k++) {
        const cx = -G + 0.635 + k * 1.27;
        const pts: Vec2[] = [];
        for (let t = 0; t <= 8; t++) pts.push(P(cx - 0.635 * Math.cos((Math.PI * t) / 8), -0.635 * Math.sin((Math.PI * t) / 8)));
        g.push({ kind: 'poly', pts });
      }
      return twoPin(a, b, g);
    }
    const led = cat === 'Светодиоды' || /led|светодиод/.test(id);
    if (cat === 'Диоды' || led || pre === 'D') {
      const an = find(pins, 'A', '+') ?? b;
      const k = find(pins, 'K', 'C', '-') ?? (an === a ? b : a);
      const g: SymGfx[] = [
        { kind: 'poly', pts: [P(-1.1, -1.3), P(-1.1, 1.3), P(1.1, 0)], closed: true, fill: led },
        { kind: 'line', a: P(1.1, -1.3), b: P(1.1, 1.3) },
        { kind: 'line', a: P(-G, 0), b: P(-1.1, 0) },
        { kind: 'line', a: P(1.1, 0), b: P(G, 0) },
      ];
      if (led) g.push(...arrow(0, -1.6, 1.2, -1.2), ...arrow(1.1, -1.4, 1.2, -1.2));
      return twoPin({ ...an, name: 'A' }, { ...k, name: 'K' }, g);
    }
    if (cat === 'Предохранители и защита' || pre === 'F') return twoPin(a, b, [{ kind: 'rect', a: P(-G, -0.7), b: P(G, 0.7) }, { kind: 'line', a: P(-G, 0), b: P(G, 0) }]);
    if (cat === 'Кварцы и резонаторы' || pre === 'Y')
      return twoPin(a, b, [
        { kind: 'line', a: P(-G, 0), b: P(-1.3, 0) },
        { kind: 'line', a: P(1.3, 0), b: P(G, 0) },
        { kind: 'line', a: P(-1.3, -1.5), b: P(-1.3, 1.5) },
        { kind: 'line', a: P(1.3, -1.5), b: P(1.3, 1.5) },
        { kind: 'rect', a: P(-0.7, -1.9), b: P(0.7, 1.9) },
      ]);
    if (cat === 'Кнопки и переключатели' || pre === 'SW' || pre === 'S')
      return twoPin(a, b, [
        { kind: 'circle', c: P(-G, 0), r: 0.35 },
        { kind: 'circle', c: P(G, 0), r: 0.35 },
        { kind: 'line', a: P(-G + 0.3, -0.2), b: P(G - 0.2, -1.4) },
      ], -G, G);
    return twoPin(a, b, [{ kind: 'rect', a: P(-G, -1.27), b: P(G, 1.27) }]);
  }
  // Транзисторы с известными выводами.
  if (pins.length === 3) {
    const bj = [find(pins, 'B'), find(pins, 'C'), find(pins, 'E')];
    const fet = [find(pins, 'G'), find(pins, 'D'), find(pins, 'S')];
    const t = bj.every(Boolean) ? { k: 'bjt' as const, p: bj } : fet.every(Boolean) ? { k: 'fet' as const, p: fet } : null;
    if (t) {
      const [base, top, bottom] = t.p as { number: string; name: string }[];
      const g: SymGfx[] = [{ kind: 'circle', c: P(0.5, 0), r: 3.1 }];
      if (t.k === 'bjt') {
        g.push({ kind: 'line', a: P(-G, 0), b: P(-0.8, 0) }, { kind: 'line', a: P(-0.8, -1.6), b: P(-0.8, 1.6) }, { kind: 'line', a: P(-0.8, -0.6), b: P(G, -G + 0.6) }, ...arrow(-0.8, 0.6, 3.1, 1.3));
      } else {
        g.push({ kind: 'line', a: P(-G, 0), b: P(-1.2, 0) }, { kind: 'line', a: P(-1.2, -1.5), b: P(-1.2, 1.5) }, { kind: 'line', a: P(-0.6, -1.7), b: P(-0.6, 1.7) }, { kind: 'line', a: P(-0.6, -1.2), b: P(G, -1.2) }, { kind: 'line', a: P(-0.6, 1.2), b: P(G, 1.2) });
      }
      const pinsT: SymPin[] = [
        { ...base, at: P(-2 * G, 0), base: P(-G, 0), showName: true, showNumber: true },
        { ...top, at: P(G, -2 * G), base: P(G, t.k === 'bjt' ? -G + 0.6 : -1.2), showName: true, showNumber: true },
        { ...bottom, at: P(G, 2 * G), base: P(G, t.k === 'bjt' ? G - 0.6 : 1.2), showName: true, showNumber: true },
      ];
      return finish(pinsT, g);
    }
  }
  const conn = cat === 'Разъёмы' || pre === 'J' || pre === 'X' || pre === 'P' || pre === 'XS' || pre === 'XP';
  return boxSymbol(pins, conn);
}

/** Точка символа → точка схемы: зеркало по X, поворот (против часовой на экране), перенос. */
export function symToWorld(p: Vec2, at: Vec2, rotation: number, mirror?: boolean): Vec2 {
  const x0 = mirror ? -p.x : p.x;
  const r = (rotation * Math.PI) / 180;
  const c = Math.round(Math.cos(r) * 1e9) / 1e9;
  const s = Math.round(Math.sin(r) * 1e9) / 1e9;
  return { x: +(at.x + x0 * c + p.y * s).toFixed(4), y: +(at.y - x0 * s + p.y * c).toFixed(4) };
}
