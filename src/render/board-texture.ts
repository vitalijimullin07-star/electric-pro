import { flashOutline, flattenProject, type Prim } from '@core/render/flatten';
import { boardPolygon } from '@core/model/project';
import { getWorld } from '@core/model/world';
import type { Project } from '@core/model/types';

/*
 * Текстуры сторон платы для 3D-вида: маска с медью под ней, открытые площадки
 * (лужение), шелкография и отверстия. Рисуются по тем же примитивам, что Gerber.
 */

function prim(ctx: CanvasRenderingContext2D, pr: Prim): void {
  if (pr.kind === 'path') {
    if (pr.pts.length < 2) return;
    ctx.lineWidth = pr.width;
    ctx.beginPath();
    pr.pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    if (pr.closed) ctx.closePath();
    ctx.stroke();
  } else if (pr.kind === 'region') {
    ctx.beginPath();
    pr.pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    ctx.closePath();
    ctx.fill();
  } else if (pr.kind === 'fill') {
    ctx.beginPath();
    for (const l of pr.loops) {
      l.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
      ctx.closePath();
    }
    ctx.fill('evenodd');
  } else if (pr.shape.pts.length === 1) {
    ctx.beginPath();
    ctx.arc(pr.shape.pts[0].x, pr.shape.pts[0].y, pr.shape.r, 0, Math.PI * 2);
    ctx.fill();
  } else {
    const o = flashOutline(pr.shape, 0.08);
    ctx.beginPath();
    o.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    ctx.closePath();
    ctx.fill();
  }
}

/** Смешивает цвет маски с цветом меди: медь под маской светлее. */
function lighten(hex: string, k: number): string {
  const v = parseInt(hex.slice(1), 16);
  const c = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((x) => Math.round(x + (255 - x) * k));
  return `rgb(${c.join(',')})`;
}

export function boardTexture(p: Project, side: 'top' | 'bottom', maxPx = 2048): HTMLCanvasElement {
  const outline = boardPolygon(p.board);
  const xs = outline.map((q) => q.x);
  const ys = outline.map((q) => q.y);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const w = Math.max(...xs) - x0;
  const h = Math.max(...ys) - y0;
  const k = Math.min(maxPx / w, maxPx / h, 24);
  const cv = document.createElement('canvas');
  cv.width = Math.max(2, Math.round(w * k));
  cv.height = Math.max(2, Math.round(h * k));
  const ctx = cv.getContext('2d')!;
  ctx.setTransform(k, 0, 0, k, -x0 * k, -y0 * k);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const mask = p.board.maskColor || '#1f6b3a';
  ctx.fillStyle = mask;
  ctx.fillRect(x0, y0, w, h);
  const prims = flattenProject(p, { fab: false });
  const L = side === 'top' ? { cu: 'F.Cu', mask: 'F.Mask', silk: 'F.Silk' } : { cu: 'B.Cu', mask: 'B.Mask', silk: 'B.Silk' };
  const hasCu = (L.cu === 'F.Cu' && p.board.copperLayers === 2) || L.cu === 'B.Cu';
  if (hasCu) {
    // Медь под маской.
    const cu = lighten(mask, 0.22);
    ctx.fillStyle = cu;
    ctx.strokeStyle = cu;
    for (const pr of prims[L.cu as 'F.Cu'] ?? []) prim(ctx, pr);
    // Открытая медь (площадки) — лужёная.
    ctx.fillStyle = '#cfcfc4';
    ctx.strokeStyle = '#cfcfc4';
    for (const pr of prims[L.mask as 'F.Mask'] ?? []) prim(ctx, pr);
  }
  ctx.fillStyle = '#f2f2ee';
  ctx.strokeStyle = '#f2f2ee';
  for (const pr of prims[L.silk as 'F.Silk'] ?? []) prim(ctx, pr);
  // Отверстия.
  const world = getWorld(p);
  ctx.fillStyle = '#15130f';
  for (const wp of world.pads)
    if (wp.drill) {
      ctx.beginPath();
      ctx.arc(wp.center.x, wp.center.y, wp.drill / 2, 0, Math.PI * 2);
      ctx.fill();
    }
  for (const v of world.vias) {
    ctx.beginPath();
    ctx.arc(v.via.at.x, v.via.at.y, v.via.drill / 2, 0, Math.PI * 2);
    ctx.fill();
  }
  return cv;
}
