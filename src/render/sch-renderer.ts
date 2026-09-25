import type { Vec2 } from '@core/math/vec';
import type { Project, SchSymbol } from '@core/model/types';
import { placedPins, schematicNetlist, symbolOf } from '@core/schematic/netlist';
import { SCH_GRID, symToWorld, type SymbolDef } from '@core/schematic/symbols';
import { labelShape, symbolWorldBox } from '@core/schematic/layout';

export { labelShape, symbolWorldBox };
import type { SchPending, SchRef, ViewState } from '@editor/store';

/*
 * Отрисовка схемы: светлый «лист», символы красно-коричневым с жёлтой заливкой,
 * провода зелёным, метки цепей синим. Всё в мм, как и на плате.
 */

export const SCH_COLORS = {
  paper: '#f7f5ee',
  grid: 'rgba(60,60,60,0.22)',
  body: '#8b1c1c',
  fill: '#fff6d0',
  pin: '#8b1c1c',
  text: '#303030',
  ref: '#1c4f8b',
  wire: '#1a7f37',
  label: '#1f4fa0',
  power: '#b3261e',
  select: '#0a84ff',
  open: '#b3261e',
};

export interface SchRenderInput {
  project: Project;
  view: ViewState;
  width: number;
  height: number;
  dpr: number;
  selection: SchRef[];
  pending: SchPending;
  /** Символ, который сейчас ставим (призрак под курсором). */
  ghost?: { def: SymbolDef; at: Vec2; rotation: number } | null;
}

function text(ctx: CanvasRenderingContext2D, s: string, at: Vec2, size: number, align: CanvasTextAlign = 'center', color = SCH_COLORS.text, bold = false): void {
  ctx.fillStyle = color;
  ctx.font = `${bold ? '600 ' : ''}${size}px system-ui, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(s, at.x, at.y);
}

export function drawSymbol(ctx: CanvasRenderingContext2D, def: SymbolDef, s: Pick<SchSymbol, 'at' | 'rotation' | 'mirror'>, ref: string, value: string, px: number, alpha = 1, openPins?: Set<string>): void {
  const T = (q: Vec2) => symToWorld(q, s.at, s.rotation, s.mirror);
  ctx.globalAlpha = alpha;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = SCH_COLORS.body;
  ctx.lineWidth = Math.max(0.2, px * 1.2);
  for (const g of def.gfx) {
    ctx.beginPath();
    if (g.kind === 'line') {
      const a = T(g.a);
      const b = T(g.b);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    } else if (g.kind === 'rect') {
      const pts = [g.a, { x: g.b.x, y: g.a.y }, g.b, { x: g.a.x, y: g.b.y }].map(T);
      pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
      ctx.closePath();
      ctx.fillStyle = SCH_COLORS.fill;
      ctx.fill();
      ctx.stroke();
    } else if (g.kind === 'circle') {
      const c = T(g.c);
      ctx.arc(c.x, c.y, g.r, 0, Math.PI * 2);
      if (g.fill) {
        ctx.fillStyle = SCH_COLORS.body;
        ctx.fill();
      }
      ctx.stroke();
    } else if (g.kind === 'poly') {
      const pts = g.pts.map(T);
      pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
      if (g.closed) ctx.closePath();
      if (g.fill) {
        ctx.fillStyle = SCH_COLORS.body;
        ctx.fill();
      }
      ctx.stroke();
    } else if (g.kind === 'text') text(ctx, g.text, T(g.at), g.size, 'center', SCH_COLORS.body);
  }
  // Выводы: линия, номер снаружи, имя внутри.
  for (const pin of def.pins) {
    const a = T(pin.at);
    const b = T(pin.base);
    ctx.strokeStyle = SCH_COLORS.pin;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const L = Math.hypot(dx, dy) || 1;
    const ux = dx / L;
    const uy = dy / L;
    if (pin.showNumber) {
      const m = { x: (a.x + b.x) / 2 + (Math.abs(uy) > 0.5 ? 0.7 : 0), y: (a.y + b.y) / 2 - (Math.abs(ux) > 0.5 ? 0.7 : 0) };
      text(ctx, pin.number, m, 1.0, 'center', SCH_COLORS.pin);
    }
    if (pin.showName && pin.name) {
      const at = { x: b.x + ux * 0.6, y: b.y + uy * 0.6 };
      const align: CanvasTextAlign = Math.abs(ux) > 0.5 ? (ux > 0 ? 'left' : 'right') : 'center';
      text(ctx, pin.name, { x: at.x, y: at.y + (Math.abs(uy) > 0.5 ? uy * 0.6 : 0) }, 1.2, align, SCH_COLORS.text);
    }
    if (openPins?.has(pin.number)) {
      ctx.strokeStyle = SCH_COLORS.open;
      ctx.lineWidth = Math.max(0.12, px);
      ctx.beginPath();
      ctx.arc(a.x, a.y, 0.4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = Math.max(0.2, px * 1.2);
    }
  }
  const box = symbolWorldBox(def, s);
  text(ctx, ref, { x: (box.minX + box.maxX) / 2, y: box.minY - 1.3 }, 1.6, 'center', SCH_COLORS.ref, true);
  if (value) text(ctx, value, { x: (box.minX + box.maxX) / 2, y: box.maxY + 1.3 }, 1.4, 'center', SCH_COLORS.text);
  ctx.globalAlpha = 1;
}

export function renderSchematic(ctx: CanvasRenderingContext2D, inp: SchRenderInput): void {
  const { view: v, width, height, dpr, project: p } = inp;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = SCH_COLORS.paper;
  ctx.fillRect(0, 0, width, height);
  ctx.setTransform(dpr * v.scale, 0, 0, dpr * v.scale, -v.x * v.scale * dpr, -v.y * v.scale * dpr);
  const px = 1 / v.scale;
  // Сетка точками.
  const step = v.scale * SCH_GRID < 6 ? SCH_GRID * 5 : SCH_GRID;
  const x0 = Math.floor(v.x / step) * step;
  const y0 = Math.floor(v.y / step) * step;
  ctx.fillStyle = SCH_COLORS.grid;
  const r = Math.max(px * 0.8, 0.08);
  for (let x = x0; x < v.x + width / v.scale; x += step) for (let y = y0; y < v.y + height / v.scale; y += step) ctx.fillRect(x - r, y - r, 2 * r, 2 * r);

  const sch = p.schematic;
  if (!sch) return;
  const sel = new Set(inp.selection.map((x) => x.kind + ':' + x.id));
  const nl = schematicNetlist(p);
  const pins = placedPins(p);
  // Незадействованные выводы: не входят ни в одну цепь.
  const open = new Map<string, Set<string>>();
  for (const pin of pins)
    if (!nl.pinNet.has(pin.component + '#' + pin.number)) {
      if (!open.has(pin.symbol)) open.set(pin.symbol, new Set());
      open.get(pin.symbol)!.add(pin.number);
    }
  // Провода.
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const w of Object.values(sch.wires)) {
    if (w.points.length < 2) continue;
    const isSel = sel.has('wire:' + w.id);
    ctx.strokeStyle = isSel ? SCH_COLORS.select : SCH_COLORS.wire;
    ctx.lineWidth = Math.max(0.25, px * (isSel ? 3 : 1.6));
    ctx.beginPath();
    w.points.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    ctx.stroke();
  }
  ctx.fillStyle = SCH_COLORS.wire;
  for (const j of nl.junctions) {
    ctx.beginPath();
    ctx.arc(j.x, j.y, 0.55, 0, Math.PI * 2);
    ctx.fill();
  }
  // Символы.
  for (const s of Object.values(sch.symbols)) {
    const c = p.components[s.component];
    const def = symbolOf(p, s);
    if (!c || !def) continue;
    drawSymbol(ctx, def, s, c.ref, c.value, px, 1, open.get(s.id));
    if (sel.has('symbol:' + s.id)) {
      const b = symbolWorldBox(def, s);
      ctx.strokeStyle = SCH_COLORS.select;
      ctx.lineWidth = px * 2;
      ctx.setLineDash([px * 6, px * 4]);
      ctx.strokeRect(b.minX - 0.8, b.minY - 2.6, b.maxX - b.minX + 1.6, b.maxY - b.minY + 5.2);
      ctx.setLineDash([]);
    }
  }
  // Метки.
  for (const l of Object.values(sch.labels)) {
    const shp = labelShape(l);
    const isSel = sel.has('label:' + l.id);
    const col = isSel ? SCH_COLORS.select : l.kind === 'power' ? SCH_COLORS.power : SCH_COLORS.label;
    ctx.strokeStyle = col;
    ctx.lineWidth = Math.max(0.18, px * 1.3);
    if (l.kind === 'power') {
      const r0 = ((l.rotation ?? 0) % 360 + 360) % 360;
      const d = r0 === 0 ? { x: 1, y: 0 } : r0 === 180 ? { x: -1, y: 0 } : r0 === 90 ? { x: 0, y: -1 } : { x: 0, y: 1 };
      const tip = { x: l.at.x + d.x * 1.6, y: l.at.y + d.y * 1.6 };
      ctx.beginPath();
      ctx.moveTo(l.at.x, l.at.y);
      ctx.lineTo(tip.x, tip.y);
      ctx.moveTo(tip.x - d.y * 1.2, tip.y + d.x * 1.2);
      ctx.lineTo(tip.x + d.y * 1.2, tip.y - d.x * 1.2);
      ctx.stroke();
    } else {
      const b = shp.box;
      ctx.beginPath();
      ctx.rect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
      ctx.fillStyle = 'rgba(31,79,160,0.08)';
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(l.at.x, l.at.y, 0.3, 0, Math.PI * 2);
      ctx.fillStyle = col;
      ctx.fill();
    }
    text(ctx, l.text, shp.textAt, 1.4, shp.align, col, true);
  }
  // Незаконченный провод и рамка.
  const pd = inp.pending;
  if (pd?.kind === 'wire') {
    ctx.strokeStyle = SCH_COLORS.wire;
    ctx.lineWidth = Math.max(0.25, px * 1.6);
    ctx.setLineDash([px * 6, px * 4]);
    ctx.beginPath();
    const pts = [...pd.points, ...orthoTail(pd.points[pd.points.length - 1], pd.cursor)];
    pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    ctx.stroke();
    ctx.setLineDash([]);
  } else if (pd?.kind === 'box') {
    ctx.strokeStyle = SCH_COLORS.select;
    ctx.lineWidth = px;
    ctx.setLineDash([px * 5, px * 3]);
    ctx.strokeRect(Math.min(pd.start.x, pd.cursor.x), Math.min(pd.start.y, pd.cursor.y), Math.abs(pd.cursor.x - pd.start.x), Math.abs(pd.cursor.y - pd.start.y));
    ctx.setLineDash([]);
  }
  if (inp.ghost) drawSymbol(ctx, inp.ghost.def, { at: inp.ghost.at, rotation: inp.ghost.rotation }, '?', '', px, 0.5);
}

/** Прямоугольный излом: сначала по горизонтали, потом по вертикали. */
export function orthoTail(from: Vec2, to: Vec2): Vec2[] {
  if (Math.abs(from.x - to.x) < 1e-9 || Math.abs(from.y - to.y) < 1e-9) return [to];
  return [{ x: to.x, y: from.y }, to];
}
