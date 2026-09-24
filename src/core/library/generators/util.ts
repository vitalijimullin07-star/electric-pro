import type { Vec2 } from '../../math/vec';
import type { FootprintDef, Graphic, LayerId, PadDef, PadShape } from '../../model/types';
import type { Vec2 as V2 } from '../../math/vec';

/* Общие помощники для генераторов корпусов. Толщины линий как в библиотеке KiCad. */

export const SILK_W = 0.12;
export const FAB_W = 0.1;
export const CRT_W = 0.05;
export const REF_SIZE = 1.0;
/** Отступ габарита (courtyard) от корпуса и площадок: 0,25 мм для SMD, 0,5 мм для выводных. */
export const CRT_SMD = 0.25;
export const CRT_THT = 0.5;

export const r2 = (v: number): number => Math.round(v * 1e4) / 1e4;

export function smd(number: string, x: number, y: number, w: number, h: number, shape: PadShape = 'roundrect', extra: Partial<PadDef> = {}): PadDef {
  return { number, type: 'smd', shape, at: { x: r2(x), y: r2(y) }, size: { x: r2(w), y: r2(h) }, roundness: shape === 'roundrect' ? 0.25 : undefined, ...extra };
}

export function tht(number: string, x: number, y: number, w: number, h: number, drill: number, shape: PadShape = 'circle', extra: Partial<PadDef> = {}): PadDef {
  return { number, type: 'tht', shape, at: { x: r2(x), y: r2(y) }, size: { x: r2(w), y: r2(h) }, drill, ...extra };
}

export function npth(x: number, y: number, d: number): PadDef {
  return { number: '', type: 'npth', shape: 'circle', at: { x, y }, size: { x: d, y: d }, drill: d };
}

export const line = (layer: LayerId, a: Vec2, b: Vec2, width = SILK_W): Graphic => ({ kind: 'line', layer, a, b, width });
export const rect = (layer: LayerId, x0: number, y0: number, x1: number, y1: number, width = FAB_W, fill = false): Graphic => ({
  kind: 'rect',
  layer,
  a: { x: r2(x0), y: r2(y0) },
  b: { x: r2(x1), y: r2(y1) },
  width,
  fill,
});
export const circle = (layer: LayerId, c: Vec2, r: number, width = FAB_W, fill = false): Graphic => ({ kind: 'circle', layer, c, r, width, fill });
export const poly = (layer: LayerId, pts: Vec2[], width = SILK_W, closed = true, fill = false): Graphic => ({ kind: 'poly', layer, pts, width, closed, fill });

export function refText(y: number, x = 0): Graphic {
  return { kind: 'text', layer: 'F.Silk', at: { x, y: r2(y) }, text: '${REF}', size: REF_SIZE, thickness: 0.15, align: 'center' };
}
export function valueText(y: number, x = 0, size = REF_SIZE): Graphic {
  return { kind: 'text', layer: 'F.Fab', at: { x, y: r2(y) }, text: '${VALUE}', size, thickness: 0.15, align: 'center' };
}

/** Габарит по прямоугольнику с отступом, округлённый до 0,01 мм. */
export function courtyardOf(x0: number, y0: number, x1: number, y1: number, margin: number): { min: Vec2; max: Vec2 } {
  const f = (v: number, up: boolean) => (up ? Math.ceil(v * 100) : Math.floor(v * 100)) / 100;
  return { min: { x: f(x0 - margin, false), y: f(y0 - margin, false) }, max: { x: f(x1 + margin, true), y: f(y1 + margin, true) } };
}

/** Габарит, охватывающий корпус и все площадки. */
export function courtyardAround(pads: PadDef[], body: { x0: number; y0: number; x1: number; y1: number }, margin: number) {
  let { x0, y0, x1, y1 } = body;
  for (const p of pads) {
    const rot = Math.abs(((p.rotation ?? 0) % 180) - 90) < 1e-6;
    const w = rot ? p.size.y : p.size.x;
    const h = rot ? p.size.x : p.size.y;
    x0 = Math.min(x0, p.at.x - w / 2);
    x1 = Math.max(x1, p.at.x + w / 2);
    y0 = Math.min(y0, p.at.y - h / 2);
    y1 = Math.max(y1, p.at.y + h / 2);
  }
  return courtyardOf(x0, y0, x1, y1, margin);
}

export function crtGraphic(c: { min: Vec2; max: Vec2 }, layer: LayerId = 'F.Courtyard'): Graphic {
  return rect(layer, c.min.x, c.min.y, c.max.x, c.max.y, CRT_W);
}

/**
 * Контур шелкографии по прямоугольнику корпуса с разрывами вокруг площадок
 * (чтобы краска не попадала на медь).
 */
export function silkOutline(x0: number, y0: number, x1: number, y1: number, pads: PadDef[], gap = 0.2): Graphic[] {
  const out: Graphic[] = [];
  const edges: [Vec2, Vec2][] = [
    [{ x: x0, y: y0 }, { x: x1, y: y0 }],
    [{ x: x1, y: y0 }, { x: x1, y: y1 }],
    [{ x: x1, y: y1 }, { x: x0, y: y1 }],
    [{ x: x0, y: y1 }, { x: x0, y: y0 }],
  ];
  const keep = SILK_W / 2 + gap;
  const blocked = (p: Vec2) =>
    pads.some((pd) => {
      const rot = Math.abs(((pd.rotation ?? 0) % 180) - 90) < 1e-6;
      const w = (rot ? pd.size.y : pd.size.x) / 2 + keep;
      const h = (rot ? pd.size.x : pd.size.y) / 2 + keep;
      if (pd.shape === 'circle' || pd.shape === 'oval') {
        const dx = Math.max(0, Math.abs(p.x - pd.at.x) - (w - Math.min(w, h)));
        const dy = Math.max(0, Math.abs(p.y - pd.at.y) - (h - Math.min(w, h)));
        return Math.hypot(dx, dy) < Math.min(w, h);
      }
      return Math.abs(p.x - pd.at.x) < w && Math.abs(p.y - pd.at.y) < h;
    });
  for (const [a, b] of edges) {
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.ceil(L / 0.05));
    let start: Vec2 | null = null;
    let prev: Vec2 = a;
    for (let i = 0; i <= n; i++) {
      const p = { x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n };
      const bl = blocked(p);
      if (!bl && !start) start = p;
      if ((bl || i === n) && start) {
        const end = bl ? prev : p;
        if (Math.hypot(end.x - start.x, end.y - start.y) > 0.1)
          out.push(line('F.Silk', { x: r2(start.x), y: r2(start.y) }, { x: r2(end.x), y: r2(end.y) }));
        start = null;
      }
      prev = p;
    }
  }
  return out;
}

export function fp(def: Omit<FootprintDef, 'graphics'> & { graphics?: Graphic[] }): FootprintDef {
  return { graphics: [], ...def };
}

/* ---------- общие заготовки для больших разделов библиотеки ---------- */

export interface TwoPadSpec {
  id: string;
  name: string;
  description: string;
  category: string;
  group?: string;
  refPrefix: string;
  /** Расстояние между центрами площадок. */
  span: number;
  /** Площадка: вдоль оси × поперёк. */
  pad: [number, number];
  /** Корпус: длина × ширина. */
  body: [number, number];
  polar?: boolean;
  padNames?: [string, string];
  shape?: PadShape;
  verified?: boolean;
  height?: number;
  tags?: string[];
  source?: string;
  /** Рисовать контур корпуса на шелкографии целиком (если корпус заметно шире площадок). */
  silkBox?: boolean;
}

/** Двухвыводной планарный корпус: чип, диод, танталовый или алюминиевый конденсатор. */
export function twoPadSmd(s: TwoPadSpec): FootprintDef {
  const [L, W] = s.body;
  const shape = s.shape ?? 'roundrect';
  const pads = [smd('1', -s.span / 2, 0, s.pad[0], s.pad[1], shape), smd('2', s.span / 2, 0, s.pad[0], s.pad[1], shape)];
  if (s.padNames) {
    pads[0].name = s.padNames[0];
    pads[1].name = s.padNames[1];
  }
  const g: Graphic[] = [rect('F.Fab', -L / 2, -W / 2, L / 2, W / 2, FAB_W)];
  const padOuter = s.span / 2 + s.pad[0] / 2;
  if (s.silkBox || W / 2 > s.pad[1] / 2 + 0.3) {
    // Корпус шире площадок: рисуем контур с разрывами под площадки.
    g.push(...silkOutline(-L / 2 - 0.1, -W / 2 - 0.1, L / 2 + 0.1, W / 2 + 0.1, pads));
  } else if (L / 2 > padOuter + 0.3) {
    g.push(line('F.Silk', { x: r2(-L / 2 - 0.1), y: r2(-W / 2 - 0.1) }, { x: r2(-padOuter - 0.25), y: r2(-W / 2 - 0.1) }));
    g.push(line('F.Silk', { x: r2(padOuter + 0.25), y: r2(-W / 2 - 0.1) }, { x: r2(L / 2 + 0.1), y: r2(-W / 2 - 0.1) }));
    g.push(line('F.Silk', { x: r2(-L / 2 - 0.1), y: r2(W / 2 + 0.1) }, { x: r2(-padOuter - 0.25), y: r2(W / 2 + 0.1) }));
    g.push(line('F.Silk', { x: r2(padOuter + 0.25), y: r2(W / 2 + 0.1) }, { x: r2(L / 2 + 0.1), y: r2(W / 2 + 0.1) }));
  } else {
    const y = Math.max(W / 2, s.pad[1] / 2) + 0.2;
    const x0 = Math.min(L / 2, s.span / 2 - s.pad[0] / 2 - 0.2);
    if (x0 > 0.15) {
      g.push(line('F.Silk', { x: r2(-x0), y: r2(-y) }, { x: r2(x0), y: r2(-y) }));
      g.push(line('F.Silk', { x: r2(-x0), y: r2(y) }, { x: r2(x0), y: r2(y) }));
    }
  }
  if (s.polar) {
    const x = r2(-Math.max(padOuter, L / 2) - 0.3);
    const h = Math.max(W / 2, s.pad[1] / 2) + 0.1;
    g.push(line('F.Silk', { x, y: r2(-h) }, { x, y: r2(h) }, 0.2));
    g.push(line('F.Fab', { x: r2(-L / 2 + L * 0.2), y: -W / 2 }, { x: r2(-L / 2 + L * 0.2), y: W / 2 }, FAB_W));
  }
  const crt = courtyardAround(pads, { x0: -L / 2, y0: -W / 2, x1: L / 2, y1: W / 2 }, CRT_SMD);
  g.push(crtGraphic(crt), refText(crt.min.y - 0.7), valueText(crt.max.y + 0.7));
  return fp({
    id: s.id,
    name: s.name,
    description: s.description,
    category: s.category,
    group: s.group,
    tags: ['smd', ...(s.tags ?? [])],
    refPrefix: s.refPrefix,
    pads,
    graphics: g,
    courtyard: crt,
    source: s.source ?? 'IPC-7351B, номинал',
    verified: s.verified ?? false,
    height: s.height ?? 1,
  });
}

export interface TwoPinThtSpec {
  id: string;
  name: string;
  description: string;
  category: string;
  group?: string;
  refPrefix: string;
  pitch: number;
  drill: number;
  pad: number;
  /** Корпус: прямоугольник длина × ширина (горизонтально) или круг диаметром d. */
  body: { len: number; wid: number } | { d: number; at?: number };
  polar?: boolean;
  padNames?: [string, string];
  verified?: boolean;
  height?: number;
  tags?: string[];
  source?: string;
}

/** Двухвыводной выводной корпус горизонтально (осевой) или стоя (радиальный). */
export function twoPinTht(s: TwoPinThtSpec): FootprintDef {
  const pads = [tht('1', -s.pitch / 2, 0, s.pad, s.pad, s.drill, s.polar ? 'rect' : 'circle'), tht('2', s.pitch / 2, 0, s.pad, s.pad, s.drill)];
  if (s.padNames) {
    pads[0].name = s.padNames[0];
    pads[1].name = s.padNames[1];
  }
  const g: Graphic[] = [];
  let box: { x0: number; y0: number; x1: number; y1: number };
  if ('d' in s.body) {
    const r = s.body.d / 2;
    const cx = s.body.at ?? 0;
    box = { x0: cx - r, y0: -r, x1: cx + r, y1: r };
    g.push(circle('F.Fab', { x: cx, y: 0 }, r, FAB_W), circle('F.Silk', { x: cx, y: 0 }, r + 0.1, SILK_W));
    if (s.polar) {
      g.push(line('F.Silk', { x: r2(-s.pitch / 2 - s.pad / 2 - 1.2), y: r2(-r * 0.5) }, { x: r2(-s.pitch / 2 - s.pad / 2 - 0.4), y: r2(-r * 0.5) }, 0.15));
      g.push(line('F.Silk', { x: r2(-s.pitch / 2 - s.pad / 2 - 0.8), y: r2(-r * 0.5 - 0.4) }, { x: r2(-s.pitch / 2 - s.pad / 2 - 0.8), y: r2(-r * 0.5 + 0.4) }, 0.15));
    }
  } else {
    const { len: L, wid: W } = s.body;
    box = { x0: -L / 2, y0: -W / 2, x1: L / 2, y1: W / 2 };
    g.push(rect('F.Fab', -L / 2, -W / 2, L / 2, W / 2, FAB_W));
    if (L / 2 + s.pad / 2 + 0.3 < s.pitch / 2) {
      // Осевой: корпус между выводами, ножки рисуем линиями.
      g.push(rect('F.Silk', -L / 2 - 0.1, -W / 2 - 0.1, L / 2 + 0.1, W / 2 + 0.1, SILK_W));
      g.push(line('F.Silk', { x: r2(-s.pitch / 2 + s.pad / 2 + 0.25), y: 0 }, { x: -L / 2 - 0.1, y: 0 }));
      g.push(line('F.Silk', { x: L / 2 + 0.1, y: 0 }, { x: r2(s.pitch / 2 - s.pad / 2 - 0.25), y: 0 }));
      if (s.polar) g.push(line('F.Silk', { x: r2(-L / 2 + L * 0.22), y: -W / 2 - 0.1 }, { x: r2(-L / 2 + L * 0.22), y: W / 2 + 0.1 }, 0.3));
    } else {
      g.push(...silkOutline(-L / 2 - 0.1, -W / 2 - 0.1, L / 2 + 0.1, W / 2 + 0.1, pads));
      if (s.polar) g.push(line('F.Silk', { x: r2(-L / 2 - 0.9), y: -0.4 }, { x: r2(-L / 2 - 0.9), y: 0.4 }, 0.15), line('F.Silk', { x: r2(-L / 2 - 1.3), y: 0 }, { x: r2(-L / 2 - 0.5), y: 0 }, 0.15));
    }
  }
  const crt = courtyardAround(pads, box, CRT_THT);
  g.push(crtGraphic(crt), refText(crt.min.y - 0.7), valueText(crt.max.y + 0.7));
  return fp({
    id: s.id,
    name: s.name,
    description: s.description,
    category: s.category,
    group: s.group,
    tags: ['tht', ...(s.tags ?? [])],
    refPrefix: s.refPrefix,
    pads,
    graphics: g,
    courtyard: crt,
    source: s.source ?? 'Типовые размеры',
    verified: s.verified ?? false,
    height: s.height ?? ('d' in s.body ? s.body.d : s.body.wid),
  });
}

/** Прямоугольный корпус с произвольными площадками: шелкография с разрывами, габарит, подписи. */
export function boxFootprint(o: {
  id: string;
  name: string;
  description: string;
  category: string;
  group?: string;
  refPrefix: string;
  pads: PadDef[];
  body: { x0: number; y0: number; x1: number; y1: number };
  smd?: boolean;
  pin1Mark?: V2;
  extraGraphics?: Graphic[];
  verified?: boolean;
  height?: number;
  tags?: string[];
  source?: string;
  noSilk?: boolean;
}): FootprintDef {
  const b = o.body;
  const g: Graphic[] = [rect('F.Fab', b.x0, b.y0, b.x1, b.y1, FAB_W)];
  if (!o.noSilk) g.push(...silkOutline(b.x0 - 0.1, b.y0 - 0.1, b.x1 + 0.1, b.y1 + 0.1, o.pads));
  if (o.pin1Mark) g.push(circle('F.Silk', o.pin1Mark, 0.25, SILK_W, true));
  if (o.extraGraphics) g.push(...o.extraGraphics);
  const crt = courtyardAround(o.pads, b, o.smd ? CRT_SMD : CRT_THT);
  g.push(crtGraphic(crt), refText(crt.min.y - 0.7), valueText(crt.max.y + 0.7));
  return fp({
    id: o.id,
    name: o.name,
    description: o.description,
    category: o.category,
    group: o.group,
    tags: [o.smd ? 'smd' : 'tht', ...(o.tags ?? [])],
    refPrefix: o.refPrefix,
    pads: o.pads,
    graphics: g,
    courtyard: crt,
    source: o.source ?? 'Типовые размеры',
    verified: o.verified ?? false,
    height: o.height ?? 3,
  });
}

/** Ряд выводов вдоль X: n штук с шагом pitch, центрированный. */
export function rowX(n: number, pitch: number, mk: (i: number, x: number) => PadDef): PadDef[] {
  const x0 = -((n - 1) * pitch) / 2;
  return Array.from({ length: n }, (_, i) => mk(i, r2(x0 + i * pitch)));
}

export const fmtP = (v: number): string => String(+v.toFixed(2)).replace('.', ',');
