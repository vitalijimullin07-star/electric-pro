import { boxOfPoints, type Box } from '@core/math/geom';
import { shapeOutline, type Shape } from '@core/math/shape';
import type { Vec2 } from '@core/math/vec';
import { computeConnectivity } from '@core/model/connectivity';
import { runDrc } from '@core/model/drc';
import { LAYERS, boardCopperLayers } from '@core/model/layers';
import { padLocalShape, placementOf, shapeToWorld } from '@core/model/placement';
import { boardPolygon } from '@core/model/project';
import type { CopperLayer, ItemRef, LayerId, Project } from '@core/model/types';
import { getWorld, type World } from '@core/model/world';
import { graphicPrims, type LayerPrims, type Prim } from '@core/render/flatten';
import { textStrokes } from '@core/render/stroke-font';
import type { EditorState, Pending, ViewState } from '@editor/store';
import { fmtLen, type DisplayUnit } from '@core/units';
import { GFX, type GfxProfile } from './quality';
import type { SimView } from '@core/sim';

/*
 * Отрисовка платы на Canvas 2D. Вид сверху: нижняя медь под верхней,
 * неактивный медный слой приглушён. Всё считается в мм и масштабируется
 * матрицей холста, поэтому толщины линий соответствуют реальным.
 */

export const COLORS = {
  bg: '#0d1116',
  bgCenter: '#18202a',
  boardFill: '#1b3a2a',
  boardEdge: '#e8c44a',
  grid: 'rgba(255,255,255,0.10)',
  gridMajor: 'rgba(255,255,255,0.18)',
  padTop: '#e8b061',
  padBottom: '#6fa8f5',
  padTht: '#d9c27a',
  hole: '#0d1014',
  via: '#c9c9c9',
  wire: '#7fe0ff',
  rats: '#9fd8c0',
  selection: '#4fd1ff',
  hover: 'rgba(255,255,255,0.65)',
  drcError: '#ff4f3a',
  drcWarn: '#ffb020',
  netHighlight: '#ffffff',
  ruleArea: '#ff8a3d',
  zone: '#7be08a',
  pending: '#ffffff',
  measure: '#ffd166',
};

const pathCache = new WeakMap<Shape, Path2D>();
function shapePath(s: Shape): Path2D {
  let p = pathCache.get(s);
  if (p) return p;
  p = new Path2D();
  if (s.pts.length === 1) p.arc(s.pts[0].x, s.pts[0].y, s.r, 0, Math.PI * 2);
  else {
    const o = shapeOutline(s, 0.08);
    p.moveTo(o[0].x, o[0].y);
    for (let i = 1; i < o.length; i++) p.lineTo(o[i].x, o[i].y);
    p.closePath();
  }
  pathCache.set(s, p);
  return p;
}

const loopsCache = new WeakMap<Vec2[][], Path2D>();
/** Контуры заливки одним путём (закрашивать по правилу чётности). */
function loopsPath(loops: Vec2[][]): Path2D {
  let p = loopsCache.get(loops);
  if (p) return p;
  p = new Path2D();
  for (const l of loops) {
    p.moveTo(l[0].x, l[0].y);
    for (let i = 1; i < l.length; i++) p.lineTo(l[i].x, l[i].y);
    p.closePath();
  }
  loopsCache.set(loops, p);
  return p;
}

export interface RenderInput {
  project: Project;
  /** Состояние до перетаскивания: из него берутся заливка полигонов и отметки проверки, пока тянем. */
  base?: Project;
  view: ViewState;
  width: number;
  height: number;
  dpr: number;
  activeLayer: CopperLayer;
  layerVisible: Record<LayerId, boolean>;
  show: EditorState['show'];
  grid: number;
  selection: ItemRef[];
  hover: ItemRef | null;
  highlightNet: string | null;
  pending: Pending | null;
  measure: { a: Vec2; b: Vec2 } | null;
  units?: DisplayUnit;
  ghost?: EditorState['ghost'];
  /** Перетаскиваемые компоненты и т. п. рисуются как есть — они уже в проекте. */
  dragging?: boolean;
  /** Качество: свечение, блики, тени, анимация. */
  gfx?: GfxProfile;
  /** Время кадра, мс (для анимации). */
  time?: number;
  /** Прицел пера над экраном. */
  penHover?: Vec2 | null;
  /** Идёт симуляция: уровни на выводах, свечение светодиодов, экраны. */
  sim?: SimView | null;
}

/** Есть ли что анимировать: бегущий пунктир выделения, пульсация ошибок, подсветка цепи. */
export function wantsAnimation(inp: Pick<RenderInput, 'gfx' | 'selection' | 'highlightNet' | 'pending'>): boolean {
  return !!inp.gfx?.animate && (inp.selection.length > 0 || !!inp.highlightNet || inp.pending?.kind === 'route');
}

/** Цвет светлее на долю k (для бликов меди). */
const lightCache = new Map<string, string>();
function lighter(hex: string, k: number): string {
  const key = hex + k;
  let c = lightCache.get(key);
  if (c) return c;
  const n = parseInt(hex.slice(1), 16);
  const mix = (v: number) => Math.round(v + (255 - v) * k);
  c = `rgb(${mix((n >> 16) & 255)},${mix((n >> 8) & 255)},${mix(n & 255)})`;
  lightCache.set(key, c);
  return c;
}

export function worldToScreen(v: ViewState, p: Vec2): Vec2 {
  return { x: (p.x - v.x) * v.scale, y: (p.y - v.y) * v.scale };
}
export function screenToWorld(v: ViewState, p: Vec2): Vec2 {
  return { x: v.x + p.x / v.scale, y: v.y + p.y / v.scale };
}

function visibleBox(v: ViewState, w: number, h: number): Box {
  return { minX: v.x, minY: v.y, maxX: v.x + w / v.scale, maxY: v.y + h / v.scale };
}
const inView = (b: Box, s: Box) => b.minX <= s.maxX && b.maxX >= s.minX && b.minY <= s.maxY && b.maxY >= s.minY;

function strokePrim(ctx: CanvasRenderingContext2D, pr: Prim, color: string, minWidth: number): void {
  if (pr.kind === 'flash') {
    ctx.fillStyle = color;
    ctx.fill(shapePath(pr.shape));
    return;
  }
  if (pr.kind === 'region') {
    ctx.fillStyle = color;
    ctx.beginPath();
    pr.pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    ctx.closePath();
    ctx.fill();
    return;
  }
  if (pr.kind === 'fill') {
    ctx.fillStyle = color;
    ctx.fill(loopsPath(pr.loops), 'evenodd');
    return;
  }
  if (pr.pts.length < 2) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(pr.width, minWidth);
  ctx.beginPath();
  pr.pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
  if (pr.closed) ctx.closePath();
  ctx.stroke();
}

const graphicsCache = new WeakMap<Project, { prims: LayerPrims; refs: boolean; values: boolean; fab: boolean }>();
function componentGraphics(p: Project, w: World, refs: boolean, values: boolean, fab: boolean): LayerPrims {
  const hit = graphicsCache.get(p);
  if (hit && hit.refs === refs && hit.values === values && hit.fab === fab) return hit.prims;
  const out: LayerPrims = {};
  for (const wc of w.components) {
    if (!wc.footprint) continue;
    const pl = placementOf(wc.component);
    for (const g of wc.footprint.graphics) {
      if (!fab && (g.layer.endsWith('Fab') || g.layer.endsWith('Courtyard'))) continue;
      graphicPrims(g, pl, wc.component, out, { hideRef: !refs, hideValue: !values });
    }
  }
  for (const d of Object.values(p.drawings)) graphicPrims(d, null, null, out);
  graphicsCache.set(p, { prims: out, refs, values, fab });
  return out;
}

/** Фон с мягким виньетированием: рисуется один раз на размер холста (градиент на весь экран дорог). */
let backdropCache: { w: number; h: number; cv: HTMLCanvasElement | OffscreenCanvas } | null = null;
function backdrop(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
  // Фон размытый по природе: хватает половинного разрешения.
  const w = Math.max(1, Math.round(width / 2));
  const h = Math.max(1, Math.round(height / 2));
  if (backdropCache && backdropCache.w === w && backdropCache.h === h) return backdropCache.cv;
  const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const c = cv.getContext('2d') as CanvasRenderingContext2D;
  const g = c.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.1, w / 2, h / 2, Math.max(w, h) * 0.75);
  g.addColorStop(0, COLORS.bgCenter);
  g.addColorStop(1, COLORS.bg);
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
  backdropCache = { w, h, cv };
  return cv;
}

export function renderScene(ctx: CanvasRenderingContext2D, inp: RenderInput): void {
  const { project: p, view: v, width, height, dpr } = inp;
  const w = getWorld(p);
  const copper = boardCopperLayers(p.board.copperLayers);
  const vis = (l: LayerId) => inp.layerVisible[l];
  const px = 1 / v.scale; // один пиксель в мм
  const vb = visibleBox(v, width, height);

  const fx = inp.gfx ?? GFX.balanced;
  const time = inp.time ?? 0;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (fx.shadows) ctx.drawImage(backdrop(width, height), 0, 0, width, height);
  else {
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.setTransform(dpr * v.scale, 0, 0, dpr * v.scale, -v.x * v.scale * dpr, -v.y * v.scale * dpr);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  /** Свечение (размытие в пикселях экрана). */
  const glow = (color: string, blurPx: number) => {
    if (!fx.glow) return;
    ctx.shadowColor = color;
    ctx.shadowBlur = blurPx * dpr;
  };
  const noGlow = () => {
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
  };
  const ants = fx.animate ? -time / 45 : 0;

  // Плата.
  const outline = boardPolygon(p.board);
  const boardPath = new Path2D();
  const outlinePath = new Path2D();
  outline.forEach((q, i) => (i ? outlinePath.lineTo(q.x, q.y) : outlinePath.moveTo(q.x, q.y)));
  outlinePath.closePath();
  boardPath.addPath(outlinePath);
  for (const cut of p.board.cutouts) {
    cut.forEach((q, i) => (i ? boardPath.lineTo(q.x, q.y) : boardPath.moveTo(q.x, q.y)));
    boardPath.closePath();
  }
  if (fx.shadows) {
    // Тень платы на фоне: ореол из нескольких полупрозрачных обводок, сдвинутый вниз
    // (размытие shadowBlur на всю плату слишком дорого на телефоне).
    ctx.save();
    ctx.translate(0, px * 5);
    for (const [w, a] of [
      [18, 0.09],
      [7, 0.16],
    ]) {
      ctx.strokeStyle = `rgba(0,0,0,${a})`;
      ctx.lineWidth = px * w;
      ctx.stroke(outlinePath);
    }
    ctx.restore();
  }
  ctx.fillStyle = p.board.maskColor ?? COLORS.boardFill;
  ctx.fill(boardPath, 'evenodd');


  // Сетка.
  if (inp.show.grid && inp.grid * v.scale >= 5) {
    const bb = boxOfPoints(outline);
    const g = inp.grid;
    const x0 = Math.max(bb.minX, Math.floor(vb.minX / g) * g);
    const x1 = Math.min(bb.maxX, vb.maxX);
    const y0 = Math.max(bb.minY, Math.floor(vb.minY / g) * g);
    const y1 = Math.min(bb.maxY, vb.maxY);
    const dots = inp.grid * v.scale < 12;
    ctx.fillStyle = COLORS.grid;
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = px;
    if (dots) {
      const r = px * 0.8;
      for (let x = x0; x <= x1; x += g) for (let y = y0; y <= y1; y += g) ctx.fillRect(x - r / 2, y - r / 2, r, r);
    } else {
      ctx.beginPath();
      for (let x = x0; x <= x1; x += g) {
        ctx.moveTo(x, y0);
        ctx.lineTo(x, y1);
      }
      for (let y = y0; y <= y1; y += g) {
        ctx.moveTo(x0, y);
        ctx.lineTo(x1, y);
      }
      ctx.stroke();
    }
  }
  // Начало координат.
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = px;
  ctx.beginPath();
  ctx.moveTo(-3, 0);
  ctx.lineTo(3, 0);
  ctx.moveTo(0, -3);
  ctx.lineTo(0, 3);
  ctx.stroke();

  const conn = computeConnectivity(p, { zonesFrom: inp.base });
  const selKeys = new Set(inp.selection.map((r) => r.kind + ':' + r.id));
  const hoverKey = inp.hover ? inp.hover.kind + ':' + inp.hover.id : null;
  const hlNet = inp.highlightNet;

  // Области правил и полигоны (контуры).
  for (const ra of Object.values(p.ruleAreas)) {
    ctx.strokeStyle = COLORS.ruleArea;
    ctx.lineWidth = px * (selKeys.has('ruleArea:' + ra.id) ? 2.5 : 1.2);
    ctx.setLineDash([1, 0.6]);
    ctx.beginPath();
    ra.outline.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,138,61,0.07)';
    ctx.fill();
  }
  for (const z of Object.values(p.zones)) {
    if (!vis(z.layer)) continue;
    ctx.strokeStyle = LAYERS[z.layer].color;
    ctx.lineWidth = px * 1.5;
    ctx.setLineDash([0.8, 0.5]);
    ctx.beginPath();
    z.outline.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Медь: сначала неактивный слой, потом активный.
  const order: CopperLayer[] = copper.filter((l) => l !== inp.activeLayer).concat(copper.includes(inp.activeLayer) ? [inp.activeLayer] : []);
  const gfx = componentGraphics(p, w, inp.show.refs, inp.show.values, inp.show.fab);
  for (const layer of order) {
    if (!vis(layer)) continue;
    const active = layer === inp.activeLayer;
    ctx.globalAlpha = active ? 1 : 0.55;
    const col = LAYERS[layer].color;
    // Заливка полигонов — под дорожками, чуть светлее меди.
    for (const zf of conn.zoneFills) {
      if (zf.zone.layer !== layer || !zf.loops.length) continue;
      const lit = selKeys.has('zone:' + zf.zone.id) || (hlNet && zf.zone.net === hlNet);
      ctx.globalAlpha = (active ? 0.5 : 0.3) + (lit ? 0.2 : 0);
      ctx.fillStyle = col;
      ctx.fill(loopsPath(zf.loops), 'evenodd');
    }
    ctx.globalAlpha = active ? 1 : 0.55;
    // Капли — цветом дорожек, под ними.
    ctx.fillStyle = col;
    for (const td of conn.teardrops) {
      if (td.layer !== layer || !inView(td.shape.box, vb)) continue;
      ctx.beginPath();
      td.pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
      ctx.closePath();
      ctx.fill();
    }
    // Дорожки.
    for (const t of Object.values(p.tracks)) {
      if (t.layer !== layer || t.points.length < 2) continue;
      const segs = w.segmentsByTrack.get(t.id) ?? [];
      if (!segs.some((s) => inView(s.shape.box, vb))) continue;
      const net = conn.itemNet.get(t.id);
      const isHl = hlNet && net === hlNet;
      const isSel = selKeys.has('track:' + t.id);
      if (isSel || isHl || hoverKey === 'track:' + t.id) {
        const c = isSel ? COLORS.selection : isHl ? COLORS.netHighlight : COLORS.hover;
        ctx.strokeStyle = c;
        ctx.lineWidth = t.width + px * 4;
        ctx.globalAlpha = 0.45;
        if (isSel || isHl) glow(c, 10);
        strokePoly(ctx, t.points);
        noGlow();
        ctx.globalAlpha = active ? 1 : 0.55;
      }
      ctx.strokeStyle = net === 'short' ? COLORS.drcError : col;
      ctx.lineWidth = Math.max(t.width, px);
      strokePoly(ctx, t.points);
      if (fx.sheen && active && t.width * v.scale > 3) {
        // Блик по оси дорожки — медь выглядит объёмной.
        ctx.strokeStyle = lighter(col, 0.55);
        ctx.globalAlpha = 0.35;
        ctx.lineWidth = t.width * 0.3;
        strokePoly(ctx, t.points);
        ctx.globalAlpha = 1;
      }
    }
    // Площадки этого слоя.
    if (inp.show.pads)
      for (const wp of w.pads) {
        if (!wp.layers.includes(layer) || !inView(wp.shape.box, vb)) continue;
        if (wp.pad.type === 'tht' && layer !== order[order.length - 1] && vis(order[order.length - 1])) continue; // сквозная рисуется один раз, поверх
        const isHl = hlNet && wp.net === hlNet;
        if (isHl) {
          ctx.fillStyle = COLORS.netHighlight;
          ctx.globalAlpha = 0.35;
          ctx.beginPath();
          ctx.arc(wp.center.x, wp.center.y, Math.max(wp.pad.size.x, wp.pad.size.y) / 2 + px * 3, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = active ? 1 : 0.55;
        }
        const pc = wp.pad.type === 'tht' ? COLORS.padTht : layer === 'F.Cu' ? COLORS.padTop : COLORS.padBottom;
        ctx.fillStyle = pc;
        const path = shapePath(wp.shape);
        ctx.fill(path);
        if (fx.sheen && v.scale > 4) {
          // Светлый ободок — площадка как лужёная.
          ctx.strokeStyle = lighter(pc, 0.5);
          ctx.lineWidth = px * 1.2;
          ctx.globalAlpha = (active ? 0.8 : 0.45);
          ctx.stroke(path);
          ctx.globalAlpha = active ? 1 : 0.55;
        }
      }
  }
  ctx.globalAlpha = 1;

  // Отверстия и переходные.
  for (const wp of w.pads) {
    if (!wp.drill || !inView(wp.shape.box, vb)) continue;
    if (wp.pad.type === 'npth') {
      ctx.fillStyle = COLORS.bg;
      ctx.beginPath();
      ctx.arc(wp.center.x, wp.center.y, wp.drill / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = px;
      ctx.stroke();
    } else if (inp.show.pads) {
      ctx.fillStyle = COLORS.hole;
      ctx.beginPath();
      ctx.arc(wp.center.x, wp.center.y, wp.drill / 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  for (const wv of w.vias) {
    if (!inView(wv.shape.box, vb)) continue;
    const v2 = wv.via;
    const net = conn.itemNet.get(v2.id);
    const isSel = selKeys.has('via:' + v2.id);
    if (isSel || (hlNet && net === hlNet) || hoverKey === 'via:' + v2.id) {
      ctx.fillStyle = isSel ? COLORS.selection : COLORS.netHighlight;
      ctx.globalAlpha = 0.45;
      if (isSel) glow(COLORS.selection, 10);
      ctx.beginPath();
      ctx.arc(v2.at.x, v2.at.y, v2.diameter / 2 + px * 3, 0, Math.PI * 2);
      ctx.fill();
      noGlow();
      ctx.globalAlpha = 1;
    }
    if (fx.sheen && v.scale > 4) {
      // Переходное — металлический «пятак» с бликом.
      const r0 = v2.diameter / 2;
      const g = ctx.createRadialGradient(v2.at.x - r0 * 0.35, v2.at.y - r0 * 0.35, r0 * 0.1, v2.at.x, v2.at.y, r0);
      g.addColorStop(0, '#f2f2f2');
      g.addColorStop(1, net === 'short' ? COLORS.drcError : '#9a9a9a');
      ctx.fillStyle = g;
    } else ctx.fillStyle = net === 'short' ? COLORS.drcError : COLORS.via;
    ctx.beginPath();
    ctx.arc(v2.at.x, v2.at.y, v2.diameter / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = COLORS.hole;
    ctx.beginPath();
    ctx.arc(v2.at.x, v2.at.y, v2.drill / 2, 0, Math.PI * 2);
    ctx.fill();
  }

  // Графика: шелкография, сборочные слои, габариты, контур.
  const layerOrder: LayerId[] = ['B.Courtyard', 'B.Fab', 'B.Silk', 'F.Courtyard', 'F.Fab', 'F.Silk', 'Edge.Cuts'];
  for (const l of layerOrder) {
    if (!vis(l)) continue;
    if (l.endsWith('Courtyard') && !inp.show.courtyard) continue;
    if (l.endsWith('Fab') && !inp.show.fab) continue;
    const list = gfx[l];
    if (!list) continue;
    const col = LAYERS[l].color;
    ctx.globalAlpha = l.startsWith('B.') ? 0.6 : 1;
    for (const pr of list) strokePrim(ctx, pr, col, px * 0.8);
    ctx.globalAlpha = 1;
  }
  // Подписи областей правил.
  for (const ra of Object.values(p.ruleAreas)) {
    if (!ra.showLabel) continue;
    const top = Math.min(...ra.outline.map((q) => q.y));
    const left = Math.min(...ra.outline.map((q) => q.x));
    ctx.strokeStyle = COLORS.ruleArea;
    ctx.lineWidth = 0.18;
    for (const s of textStrokes({ text: ra.name, at: { x: left + 1.5, y: top + 1.6 }, size: 1.2, align: 'left' })) strokePoly(ctx, s);
  }
  // Контур платы.
  if (vis('Edge.Cuts')) {
    if (fx.glow) {
      // Мягкое свечение контура — широкой прозрачной обводкой.
      ctx.strokeStyle = 'rgba(232,196,74,0.16)';
      ctx.lineWidth = px * 7;
      ctx.stroke(boardPath);
    }
    ctx.strokeStyle = COLORS.boardEdge;
    ctx.lineWidth = Math.max(0.15, px * 1.5);
    ctx.stroke(boardPath);
  }

  // Перемычки проводом.
  for (const wr of w.wires) {
    const isSel = selKeys.has('wire:' + wr.id);
    const net = conn.itemNet.get(wr.id);
    ctx.strokeStyle = isSel ? COLORS.selection : hlNet && net === hlNet ? COLORS.netHighlight : hoverKey === 'wire:' + wr.id ? COLORS.hover : COLORS.wire;
    ctx.lineWidth = Math.max(0.5, px * 2);
    ctx.setLineDash([1.2, 0.8]);
    ctx.beginPath();
    ctx.moveTo(wr.a.x, wr.a.y);
    ctx.lineTo(wr.b.x, wr.b.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = ctx.strokeStyle;
    for (const q of [wr.a, wr.b]) {
      ctx.beginPath();
      ctx.arc(q.x, q.y, Math.max(0.4, px * 3), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Воздушные линии.
  if (inp.show.ratsnest) {
    ctx.lineWidth = px;
    for (const r of conn.ratsnest) {
      const hl = hlNet === r.netId;
      if (hlNet && !hl) continue;
      ctx.strokeStyle = hl ? COLORS.netHighlight : COLORS.rats;
      ctx.globalAlpha = hl ? 0.95 : 0.6;
      ctx.setLineDash(hl ? [] : [0.6, 0.4]);
      if (hl) glow(COLORS.netHighlight, 6);
      ctx.beginPath();
      ctx.moveTo(r.a.x, r.a.y);
      ctx.lineTo(r.b.x, r.b.y);
      ctx.stroke();
      noGlow();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  // Выделение и наведение: компоненты, графика, области.
  const drawOutline = (pts: Vec2[], color: string, wpx: number) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = px * wpx;
    ctx.setLineDash([px * 6, px * 4]);
    ctx.lineDashOffset = ants * px;
    if (color === COLORS.selection) {
      glow(color, 8);
      ctx.fillStyle = 'rgba(79,209,255,0.06)';
    }
    ctx.beginPath();
    pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    ctx.closePath();
    if (color === COLORS.selection && fx.shadows) ctx.fill();
    ctx.stroke();
    noGlow();
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
  };
  for (const wc of w.components) {
    const k = 'component:' + wc.component.id;
    if (selKeys.has(k)) drawOutline(wc.outline, COLORS.selection, 1.6);
    else if (hoverKey === k) drawOutline(wc.outline, COLORS.hover, 1.2);
  }
  for (const d of Object.values(p.drawings)) {
    const k = 'drawing:' + d.id;
    if (!selKeys.has(k) && hoverKey !== k) continue;
    const tmp: LayerPrims = {};
    graphicPrims(d, null, null, tmp);
    ctx.globalAlpha = 0.6;
    for (const pr of tmp[d.layer] ?? []) strokePrim(ctx, pr, selKeys.has(k) ? COLORS.selection : COLORS.hover, px * 3);
    ctx.globalAlpha = 1;
  }
  for (const z of Object.values(p.zones)) if (selKeys.has('zone:' + z.id)) drawOutline(z.outline, COLORS.selection, 2);
  // Вершины выделенной дорожки или контура.
  if (inp.selection.length === 1) {
    const s = inp.selection[0];
    const pts = s.kind === 'track' ? p.tracks[s.id]?.points : s.kind === 'ruleArea' ? p.ruleAreas[s.id]?.outline : s.kind === 'zone' ? p.zones[s.id]?.outline : null;
    if (pts) {
      ctx.fillStyle = COLORS.bg;
      ctx.strokeStyle = COLORS.selection;
      ctx.lineWidth = px;
      const r = px * 3.5;
      for (const q of pts) {
        ctx.beginPath();
        ctx.rect(q.x - r, q.y - r, 2 * r, 2 * r);
        ctx.fill();
        ctx.stroke();
      }
    }
  }

  // Ошибки проверки.
  if (inp.show.drc) {
    const rep = runDrc(inp.base ?? p);
    for (const m of rep.markers) {
      const col = m.severity === 'error' ? COLORS.drcError : COLORS.drcWarn;
      const r = px * (7 + (fx.animate && m.severity === 'error' ? 1.5 * Math.sin(time / 260) : 0));
      ctx.strokeStyle = col;
      ctx.lineWidth = px * 1.6;
      ctx.beginPath();
      ctx.arc(m.at.x, m.at.y, r, 0, Math.PI * 2);
      ctx.moveTo(m.at.x - r * 0.5, m.at.y - r * 0.5);
      ctx.lineTo(m.at.x + r * 0.5, m.at.y + r * 0.5);
      ctx.moveTo(m.at.x + r * 0.5, m.at.y - r * 0.5);
      ctx.lineTo(m.at.x - r * 0.5, m.at.y + r * 0.5);
      if (fx.glow) {
        ctx.globalAlpha = 0.25;
        ctx.lineWidth = px * 5;
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.lineWidth = px * 1.6;
      }
      ctx.stroke();
    }
  }

  // Незавершённое действие: дорожка, многоугольник, рамка.
  const pd = inp.pending;
  if (pd) {
    const pts = pd.preview && pd.preview.length ? [...pd.points, ...pd.preview] : pd.cursor ? [...pd.points, pd.cursor] : pd.points;
    if (pd.kind === 'route' && pts.length >= 1) {
      ctx.strokeStyle = pd.layer ? LAYERS[pd.layer].color : COLORS.pending;
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = Math.max(pd.width ?? 0.25, px);
      strokePoly(ctx, pts);
      ctx.globalAlpha = 1;
    } else if (pd.kind === 'box' && pd.start && pd.cursor) {
      ctx.strokeStyle = COLORS.selection;
      ctx.lineWidth = px;
      ctx.setLineDash([px * 4, px * 3]);
      ctx.strokeRect(Math.min(pd.start.x, pd.cursor.x), Math.min(pd.start.y, pd.cursor.y), Math.abs(pd.cursor.x - pd.start.x), Math.abs(pd.cursor.y - pd.start.y));
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(95,224,255,0.08)';
      ctx.fillRect(Math.min(pd.start.x, pd.cursor.x), Math.min(pd.start.y, pd.cursor.y), Math.abs(pd.cursor.x - pd.start.x), Math.abs(pd.cursor.y - pd.start.y));
    } else if (pts.length >= 1) {
      ctx.strokeStyle = COLORS.pending;
      ctx.lineWidth = px * 1.5;
      ctx.setLineDash([px * 5, px * 3]);
      strokePoly(ctx, pts);
      if (pd.kind === 'poly' && pts.length > 2) {
        ctx.beginPath();
        ctx.moveTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
        ctx.lineTo(pts[0].x, pts[0].y);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    for (const q of pd.points) {
      ctx.fillStyle = COLORS.pending;
      ctx.beginPath();
      ctx.arc(q.x, q.y, px * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Призрак устанавливаемого корпуса.
  if (inp.ghost) {
    const fp = inp.ghost.def;
    if (fp) {
      const pl = { at: inp.ghost.at, rotation: inp.ghost.rotation, side: inp.ghost.side };
      ctx.globalAlpha = 0.55;
      for (const pad of fp.pads) {
        ctx.fillStyle = pad.type === 'npth' ? COLORS.hole : pad.type === 'tht' ? COLORS.padTht : inp.ghost.side === 'top' ? COLORS.padTop : COLORS.padBottom;
        ctx.fill(shapePath(shapeToWorld(pl, padLocalShape(pad))));
      }
      const tmp: LayerPrims = {};
      for (const g of fp.graphics) if (!g.layer.endsWith('Fab')) graphicPrims(g, pl, null, tmp);
      for (const [l, list] of Object.entries(tmp)) for (const pr of list ?? []) strokePrim(ctx, pr, l.endsWith('Courtyard') ? COLORS.selection : LAYERS[l as LayerId].color, px);
      ctx.globalAlpha = 1;
    }
  }
  if (inp.sim) drawSim(ctx, inp.sim, p, w, px);

  // Прицел пера над экраном: куда попадёт касание (с привязкой к сетке).
  if (inp.penHover) {
    const q = inp.penHover;
    ctx.strokeStyle = COLORS.selection;
    ctx.lineWidth = px * 1.2;
    glow(COLORS.selection, 6);
    ctx.beginPath();
    ctx.arc(q.x, q.y, px * 7, 0, Math.PI * 2);
    ctx.moveTo(q.x - px * 12, q.y);
    ctx.lineTo(q.x - px * 3, q.y);
    ctx.moveTo(q.x + px * 3, q.y);
    ctx.lineTo(q.x + px * 12, q.y);
    ctx.moveTo(q.x, q.y - px * 12);
    ctx.lineTo(q.x, q.y - px * 3);
    ctx.moveTo(q.x, q.y + px * 3);
    ctx.lineTo(q.x, q.y + px * 12);
    ctx.stroke();
    noGlow();
  }
  if (inp.measure) {
    const { a, b } = inp.measure;
    ctx.strokeStyle = COLORS.measure;
    ctx.lineWidth = px * 1.5;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    for (const q of [a, b]) {
      ctx.beginPath();
      ctx.arc(q.x, q.y, px * 3, 0, Math.PI * 2);
      ctx.stroke();
    }
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const u = inp.units ?? 'mm';
    const label = `${fmtLen(d, u)}  (Δx ${fmtLen(Math.abs(b.x - a.x), u)}, Δy ${fmtLen(Math.abs(b.y - a.y), u)})`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const sp = worldToScreen(v, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    ctx.font = '12px system-ui, sans-serif';
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(sp.x - tw / 2 - 5, sp.y - 20, tw + 10, 18);
    ctx.fillStyle = COLORS.measure;
    ctx.fillText(label, sp.x - tw / 2, sp.y - 7);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

/* ---------------- симуляция поверх платы ---------------- */

const oledCache = new WeakMap<Uint8Array, HTMLCanvasElement | OffscreenCanvas>();
function oledImage(frame: Uint8Array, w: number, h: number): HTMLCanvasElement | OffscreenCanvas {
  let cv = oledCache.get(frame);
  if (cv) return cv;
  cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const c = cv.getContext('2d') as CanvasRenderingContext2D;
  const img = c.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const on = frame[i];
    img.data.set(on ? [120, 210, 255, 255] : [4, 8, 14, 255], i * 4);
  }
  c.putImageData(img, 0, 0);
  oledCache.set(frame, cv);
  return cv;
}

function drawSim(ctx: CanvasRenderingContext2D, sim: SimView, p: Project, w: World, px: number): void {
  // Уровни на выводах сигнальных цепей: красный — 1, синий — 0, фиолетовый — ШИМ.
  for (const wp of w.pads) {
    const st = wp.net ? sim.nets.get(wp.net) : undefined;
    if (!st) continue;
    ctx.fillStyle = st.duty > 0.02 && st.duty < 0.98 ? '#bf5af2' : st.level ? '#ff453a' : '#3a86ff';
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(wp.center.x, wp.center.y, Math.max(px * 2.5, Math.min(wp.pad.size.x, wp.pad.size.y) * 0.22), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  const lcdModule = Object.values(p.components).find((c) => /^Module_LCD(1602|2004)$/.test(c.footprint));
  for (const d of sim.devices) {
    const target = d.kind === 'lcd' && /PCF8574/.test(p.components[d.comp]?.footprint ?? '') && lcdModule ? lcdModule.id : d.comp;
    const wc = w.componentById.get(target);
    if (!wc) continue;
    const bb = boxOfPoints(wc.outline);
    const cx = (bb.minX + bb.maxX) / 2;
    const cy = (bb.minY + bb.maxY) / 2;
    const bw = bb.maxX - bb.minX;
    const bh = bb.maxY - bb.minY;
    if (d.kind === 'led' && d.on) {
      const r = Math.max(2.5, Math.max(bw, bh) * 0.9);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, d.color ?? '#ff3b30');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = 0.25 + 0.7 * (d.brightness ?? 1);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    } else if (d.kind === 'button' && d.pressed) {
      ctx.fillStyle = 'rgba(79,209,255,0.35)';
      ctx.fillRect(bb.minX, bb.minY, bw, bh);
    } else if (d.kind === 'lcd' && d.lines) {
      const rows = d.lines.length;
      const cols = d.lines[0]?.length ?? 16;
      const iw = bw * 0.82;
      const ih = Math.min(bh * 0.7, (iw / cols) * 1.9 * rows);
      ctx.fillStyle = d.backlight === false ? '#15233f' : '#2458d6';
      ctx.fillRect(cx - iw / 2, cy - ih / 2, iw, ih);
      ctx.fillStyle = '#eaf2ff';
      const ch = ih / rows;
      ctx.font = `${(ch * 0.8).toFixed(3)}px ui-monospace, monospace`;
      ctx.textBaseline = 'middle';
      d.lines.forEach((l, i) => {
        for (let k = 0; k < l.length; k++) ctx.fillText(l[k], cx - iw / 2 + (k + 0.1) * (iw / cols), cy - ih / 2 + (i + 0.5) * ch);
      });
      ctx.textBaseline = 'alphabetic';
    } else if (d.kind === 'oled' && d.frame && d.width && d.height) {
      const k = Math.min((bw * 0.85) / d.width, (bh * 0.7) / d.height);
      const iw = d.width * k;
      const ih = d.height * k;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(oledImage(d.frame, d.width, d.height), cx - iw / 2, cy - ih / 2, iw, ih);
      ctx.imageSmoothingEnabled = true;
    } else if ((d.kind === 'relay' && d.channels?.some(Boolean)) || (d.kind === 'buzzer' && d.on)) {
      const r = Math.max(1, Math.min(bw, bh) * 0.12);
      ctx.fillStyle = d.kind === 'relay' ? '#34c759' : '#ffd60a';
      ctx.beginPath();
      ctx.arc(bb.maxX - r * 1.5, bb.minY + r * 1.5, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function strokePoly(ctx: CanvasRenderingContext2D, pts: Vec2[]): void {
  if (pts.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
}

/** Вписать плату в холст. */
export function fitView(p: Project, width: number, height: number, margin = 24): ViewState {
  const bb = boxOfPoints(p.board.outline);
  const bw = bb.maxX - bb.minX || 1;
  const bh = bb.maxY - bb.minY || 1;
  const scale = Math.max(0.5, Math.min((width - 2 * margin) / bw, (height - 2 * margin) / bh));
  return { scale, x: bb.minX - (width / scale - bw) / 2, y: bb.minY - (height / scale - bh) / 2 };
}


