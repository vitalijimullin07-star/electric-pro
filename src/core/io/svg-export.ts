import { boardBox, boardPolygon } from '../model/project';
import type { LayerId, Project } from '../model/types';
import { flashOutline, flattenProject, type Prim } from '../render/flatten';
import { getWorld } from '../model/world';
import { LAYERS } from '../model/layers';

/*
 * SVG в масштабе 1:1 (размеры в мм): медь для ЛУТ или фоторезиста,
 * сборочный вид, любой слой по выбору.
 */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const f = (v: number) => (Math.round(v * 1000) / 1000).toString();

function primSvg(pr: Prim, color: string): string {
  if (pr.kind === 'path') {
    const d = pr.pts.map((q, i) => `${i ? 'L' : 'M'}${f(q.x)} ${f(q.y)}`).join('') + (pr.closed ? 'Z' : '');
    return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${f(pr.width)}" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  if (pr.kind === 'region') return `<polygon points="${pr.pts.map((q) => `${f(q.x)},${f(q.y)}`).join(' ')}" fill="${color}" stroke="none"/>`;
  const s = pr.shape;
  if (s.pts.length === 1) return `<circle cx="${f(s.pts[0].x)}" cy="${f(s.pts[0].y)}" r="${f(s.r)}" fill="${color}"/>`;
  return `<polygon points="${flashOutline(s)
    .map((q) => `${f(q.x)},${f(q.y)}`)
    .join(' ')}" fill="${color}"/>`;
}

export interface SvgOptions {
  /** Зеркально по горизонтали (для печати нижней меди на плёнку, если требуется). */
  mirror?: boolean;
  /** Точки в центрах отверстий для кернения. */
  drillMarks?: boolean;
  /** Цвет меди; по умолчанию чёрный на белом. */
  color?: string;
  background?: string;
  /** Рамка контура платы. */
  outline?: boolean;
}

function svgHead(p: Project, mirror: boolean, background: string): { head: string; tail: string } {
  const bb = boardBox(p.board);
  const w = bb.maxX - bb.minX;
  const h = bb.maxY - bb.minY;
  const tr = mirror ? ` transform="translate(${f(bb.minX + bb.maxX)} 0) scale(-1 1)"` : '';
  const head =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${f(w)}mm" height="${f(h)}mm" viewBox="${f(bb.minX)} ${f(bb.minY)} ${f(w)} ${f(h)}">` +
    `<title>${esc(p.meta.name)}</title>` +
    (background ? `<rect x="${f(bb.minX)}" y="${f(bb.minY)}" width="${f(w)}" height="${f(h)}" fill="${background}"/>` : '') +
    `<g${tr}>`;
  return { head, tail: '</g></svg>' };
}

/** Один слой меди 1:1 для ЛУТ: чёрная медь, контур платы, точки под кернение. */
export function exportCopperSvg(p: Project, layer: 'F.Cu' | 'B.Cu', o: SvgOptions = {}): string {
  const prims = flattenProject(p, { fab: false });
  const color = o.color ?? '#000';
  const { head, tail } = svgHead(p, o.mirror ?? false, o.background ?? '#fff');
  let s = head;
  if (o.outline ?? true) s += `<path d="${boardPolygon(p.board).map((q, i) => `${i ? 'L' : 'M'}${f(q.x)} ${f(q.y)}`).join('')}Z" fill="none" stroke="${color}" stroke-width="0.25"/>`;
  for (const pr of prims[layer] ?? []) s += primSvg(pr, color);
  if (o.drillMarks ?? true) {
    const w = getWorld(p);
    const bg = o.background ?? '#fff';
    for (const wp of w.pads) if (wp.drill) s += `<circle cx="${f(wp.center.x)}" cy="${f(wp.center.y)}" r="${f(Math.min(0.35, wp.drill / 3))}" fill="${bg}"/>`;
    for (const v of w.vias) s += `<circle cx="${f(v.via.at.x)}" cy="${f(v.via.at.y)}" r="${f(Math.min(0.35, v.via.drill / 3))}" fill="${bg}"/>`;
  }
  return s + tail;
}

/** Сборочный вид: контур, шелкография, габариты корпусов, площадки серым. */
export function exportAssemblySvg(p: Project, side: 'top' | 'bottom' = 'top'): string {
  const prims = flattenProject(p, { fab: true });
  const { head, tail } = svgHead(p, side === 'bottom', '#fff');
  let s = head;
  s += `<path d="${boardPolygon(p.board).map((q, i) => `${i ? 'L' : 'M'}${f(q.x)} ${f(q.y)}`).join('')}Z" fill="none" stroke="#000" stroke-width="0.3"/>`;
  const cu: LayerId = side === 'top' ? 'F.Cu' : 'B.Cu';
  const silk: LayerId = side === 'top' ? 'F.Silk' : 'B.Silk';
  const fab: LayerId = side === 'top' ? 'F.Fab' : 'B.Fab';
  for (const pr of prims[cu] ?? []) if (pr.kind === 'flash') s += primSvg(pr, '#bbb');
  for (const pr of prims[fab] ?? []) s += primSvg(pr, '#777');
  for (const pr of prims[silk] ?? []) s += primSvg(pr, '#000');
  return s + tail;
}

/** Произвольный набор слоёв в цветах редактора (для просмотра и печати). */
export function exportLayersSvg(p: Project, layers: LayerId[], o: SvgOptions = {}): string {
  const prims = flattenProject(p, { fab: true });
  const { head, tail } = svgHead(p, o.mirror ?? false, o.background ?? '#0b1a12');
  let s = head;
  for (const l of layers) for (const pr of prims[l] ?? []) s += primSvg(pr, LAYERS[l].color);
  return s + tail;
}
