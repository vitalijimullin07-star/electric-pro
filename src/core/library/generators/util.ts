import type { Vec2 } from '../../math/vec';
import type { FootprintDef, Graphic, LayerId, PadDef, PadShape } from '../../model/types';

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
