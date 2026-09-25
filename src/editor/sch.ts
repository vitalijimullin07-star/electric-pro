import { dist, type Vec2 } from '@core/math/vec';
import { newId } from '@core/ids';
import { addComponent, pruneFootprints, removeComponent } from '@core/model/edit';
import { boardBox } from '@core/model/project';
import type { FootprintDef, Project, SchLabel, SchWire } from '@core/model/types';
import { applySchematicToBoard, placedPins, schematicNetlist, symbolDef, symbolOf, syncSymbolsFromBoard } from '@core/schematic/netlist';
import { SCH_GRID } from '@core/schematic/symbols';
import { labelShape, orthoTail, symbolWorldBox } from '@render/sch-renderer';
import { askConfirm, askText } from '../ui/dialogs/AskDialog';
import { findFootprint } from './userlib';
import { useEditor, type SchRef, type SchTool, type ViewState } from './store';

/* Схема: команды и управление мышью и касаниями. Изменения — через commit, как на плате. */

const S = () => useEditor.getState();
const snap = (v: number) => Math.round(v / SCH_GRID) * SCH_GRID;
const snapPt = (q: Vec2): Vec2 => ({ x: +snap(q.x).toFixed(4), y: +snap(q.y).toFixed(4) });

/** Переход на схему: при первом входе схема строится из платы, новые детали платы добавляются. */
export function enterSchematic(): void {
  const s = S();
  const p = s.project;
  const have = new Set(Object.values(p.schematic?.symbols ?? {}).map((x) => x.component));
  const missing = Object.values(p.components).filter((c) => !have.has(c.id) && symbolDef(p.footprints[c.footprint])).length;
  const orphans = Object.values(p.schematic?.symbols ?? {}).filter((x) => !p.components[x.component]).length;
  const first = !p.schematic;
  if (missing || orphans || first) {
    s.commit((d) => void syncSymbolsFromBoard(d));
    s.setMessage(
      first
        ? missing
          ? `Схема построена из платы: символов ${missing}, выводы соединены метками цепей. Их можно заменить проводами.`
          : 'Схема пуста: поставьте компоненты из библиотеки (P) и соедините проводами (W).'
        : `На схему добавлены детали с платы: ${missing}.${orphans ? ` Убраны символы удалённых деталей: ${orphans}.` : ''}`,
    );
  }
  s.patch({ mode: 'sch', schSelection: [], schPending: null });
  setTimeout(fitSchematic, 0);
}

export function leaveSchematic(): void {
  S().patch({ mode: 'pcb', schPending: null });
}

/** Габарит всего на схеме. */
export function schematicBox(p: Project): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const sch = p.schematic;
  if (!sch) return null;
  const xs: number[] = [];
  const ys: number[] = [];
  for (const s of Object.values(sch.symbols)) {
    const def = symbolOf(p, s);
    if (!def) continue;
    const b = symbolWorldBox(def, s);
    xs.push(b.minX, b.maxX);
    ys.push(b.minY - 3, b.maxY + 3);
  }
  for (const w of Object.values(sch.wires)) for (const q of w.points) (xs.push(q.x), ys.push(q.y));
  for (const l of Object.values(sch.labels)) {
    const b = labelShape(l).box;
    xs.push(b.minX, b.maxX);
    ys.push(b.minY, b.maxY);
  }
  if (!xs.length) return null;
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

export function fitSchematic(): void {
  const el = document.querySelector('.stage.sch') as HTMLElement | null;
  const w = el?.clientWidth ?? 800;
  const h = el?.clientHeight ?? 600;
  const b = schematicBox(S().project) ?? { minX: 0, minY: 0, maxX: 100, maxY: 70 };
  const scale = Math.min(40, Math.max(0.5, Math.min((w - 40) / (b.maxX - b.minX || 1), (h - 40) / (b.maxY - b.minY || 1))));
  S().patch({ schView: { scale, x: (b.minX + b.maxX) / 2 - w / 2 / scale, y: (b.minY + b.maxY) / 2 - h / 2 / scale } });
}

/** «Обновить плату по схеме»: цепи выводов на плате — как на схеме. */
export function updateBoardFromSchematic(): void {
  const s = S();
  const nl = schematicNetlist(s.project);
  let summary = { changed: 0, added: [] as string[], removed: [] as string[] };
  s.commit((d) => void (summary = applySchematicToBoard(d)));
  const parts = [`изменено выводов: ${summary.changed}`];
  if (summary.added.length) parts.push(`новые цепи: ${summary.added.slice(0, 6).join(', ')}${summary.added.length > 6 ? '…' : ''}`);
  if (summary.removed.length) parts.push(`удалены цепи: ${summary.removed.slice(0, 6).join(', ')}${summary.removed.length > 6 ? '…' : ''}`);
  s.setMessage(`Плата обновлена по схеме: ${parts.join('; ')}.${nl.warnings.length ? ' ' + nl.warnings[0] : ''} Воздушные линии покажут, что развести.`);
}

export function deleteSchSelection(): void {
  const s = S();
  const sel = s.schSelection;
  if (!sel.length) return;
  const comps = sel.filter((r) => r.kind === 'symbol').map((r) => s.project.schematic?.symbols[r.id]?.component).filter((x): x is string => !!x);
  const run = () => {
    s.commit((d) => {
      const sch = d.schematic;
      if (!sch) return;
      for (const r of sel) {
        if (r.kind === 'symbol') {
          const sym = sch.symbols[r.id];
          if (sym) removeComponent(d, sym.component);
          delete sch.symbols[r.id];
        } else if (r.kind === 'wire') delete sch.wires[r.id];
        else delete sch.labels[r.id];
      }
      pruneFootprints(d);
    });
    s.patch({ schSelection: [] });
    s.setMessage(comps.length ? `Удалено со схемы и с платы: ${comps.length} дет.` : 'Удалено.');
  };
  if (comps.length > 1) askConfirm({ title: 'Удалить детали', message: `Удалить ${comps.length} деталей со схемы и с платы?`, okLabel: 'Удалить', danger: true, onOk: run });
  else run();
}

function rotPoint(q: Vec2, c: Vec2, deg: number): Vec2 {
  const r = (deg * Math.PI) / 180;
  const cs = Math.round(Math.cos(r));
  const sn = Math.round(Math.sin(r));
  const dx = q.x - c.x;
  const dy = q.y - c.y;
  return { x: +(c.x + dx * cs + dy * sn).toFixed(4), y: +(c.y - dx * sn + dy * cs).toFixed(4) };
}

/** R: повернуть выделенное на 90° против часовой (одиночный символ — вокруг своей точки). */
export function rotateSchSelection(): void {
  const s = S();
  if (!s.schSelection.length) {
    if (s.schTool === 'place') {
      s.patch({ schPlaceRotation: (s.schPlaceRotation + 90) % 360 });
      return;
    }
    return;
  }
  const sel = s.schSelection;
  const p = s.project;
  const pts: Vec2[] = [];
  for (const r of sel) {
    if (r.kind === 'symbol' && p.schematic?.symbols[r.id]) pts.push(p.schematic.symbols[r.id].at);
    if (r.kind === 'label' && p.schematic?.labels[r.id]) pts.push(p.schematic.labels[r.id].at);
    if (r.kind === 'wire' && p.schematic?.wires[r.id]) pts.push(...p.schematic.wires[r.id].points);
  }
  if (!pts.length) return;
  const c = snapPt({ x: (Math.min(...pts.map((q) => q.x)) + Math.max(...pts.map((q) => q.x))) / 2, y: (Math.min(...pts.map((q) => q.y)) + Math.max(...pts.map((q) => q.y))) / 2 });
  const single = sel.length === 1;
  s.commit((d) => {
    const sch = d.schematic!;
    for (const r of sel) {
      if (r.kind === 'symbol' && sch.symbols[r.id]) {
        const sym = sch.symbols[r.id];
        if (!single) sym.at = rotPoint(sym.at, c, 90);
        sym.rotation = (sym.rotation + 90) % 360;
      } else if (r.kind === 'label' && sch.labels[r.id]) {
        const l = sch.labels[r.id];
        if (!single) l.at = rotPoint(l.at, c, 90);
        l.rotation = ((l.rotation ?? 0) + 90) % 360;
      } else if (r.kind === 'wire' && sch.wires[r.id]) sch.wires[r.id].points = sch.wires[r.id].points.map((q) => rotPoint(q, c, 90));
    }
  });
}

/** X: зеркало символов по горизонтали. */
export function mirrorSchSelection(): void {
  const s = S();
  const ids = s.schSelection.filter((r) => r.kind === 'symbol').map((r) => r.id);
  if (!ids.length) return;
  s.commit((d) => {
    for (const id of ids) {
      const sym = d.schematic?.symbols[id];
      if (sym) sym.mirror = !sym.mirror || undefined;
    }
  });
}

/** Место на плате для новой детали со схемы: столбиком справа от платы. */
function parkingSpot(p: Project): Vec2 {
  const b = boardBox(p.board);
  const n = Object.values(p.components).filter((c) => c.at.x > b.maxX).length;
  return { x: +(b.maxX + 10 + Math.floor(n / 12) * 12).toFixed(2), y: +(b.minY + 5 + (n % 12) * 8).toFixed(2) };
}

export function placeSymbol(fp: FootprintDef, at: Vec2, rotation: number): string | null {
  const s = S();
  let symId: string | null = null;
  let ref = '';
  s.commit((d) => {
    d.schematic ??= { symbols: {}, wires: {}, labels: {} };
    const c = addComponent(d, fp, parkingSpot(d), { value: fp.refPrefix === 'R' || fp.refPrefix === 'C' ? '' : fp.name });
    ref = c.ref;
    symId = newId('sy');
    d.schematic.symbols[symId] = { id: symId, component: c.id, at: snapPt(at), rotation };
  });
  s.setMessage(`Поставлен ${ref}: на плате он ждёт справа от контура. Ещё щелчок — ещё один, Esc — закончить.`);
  return symId;
}

/* ---------------- попадание ---------------- */

export interface SchHit {
  ref: SchRef;
  /** Вывод символа (для провода). */
  pinAt?: Vec2;
}

export function schHits(p: Project, q: Vec2, tol: number): SchHit[] {
  const sch = p.schematic;
  if (!sch) return [];
  const out: { h: SchHit; d: number }[] = [];
  for (const l of Object.values(sch.labels)) {
    const b = labelShape(l).box;
    if (q.x >= b.minX - tol && q.x <= b.maxX + tol && q.y >= b.minY - tol && q.y <= b.maxY + tol) out.push({ h: { ref: { kind: 'label', id: l.id } }, d: 0.1 });
  }
  for (const w of Object.values(sch.wires))
    for (let i = 1; i < w.points.length; i++) {
      const a = w.points[i - 1];
      const b = w.points[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
      const d = Math.hypot(q.x - a.x - t * dx, q.y - a.y - t * dy);
      if (d <= tol) out.push({ h: { ref: { kind: 'wire', id: w.id } }, d: 0.2 + d });
    }
  for (const s of Object.values(sch.symbols)) {
    const def = symbolOf(p, s);
    if (!def) continue;
    const b = symbolWorldBox(def, s);
    if (q.x >= b.minX - tol && q.x <= b.maxX + tol && q.y >= b.minY - tol && q.y <= b.maxY + tol) out.push({ h: { ref: { kind: 'symbol', id: s.id } }, d: 1 + Math.min(q.x - b.minX, b.maxX - q.x, q.y - b.minY, b.maxY - q.y) * 0.001 });
  }
  return out.sort((a, b) => a.d - b.d).map((x) => x.h);
}

/** Точка прилипания: конец вывода или вершина провода рядом; иначе узел сетки. */
function stickPoint(p: Project, q: Vec2, tol: number): { at: Vec2; onto: boolean } {
  let best: { at: Vec2; d: number } | null = null;
  for (const pin of placedPins(p)) {
    const d = dist(pin.at, q);
    if (d <= tol && (!best || d < best.d)) best = { at: pin.at, d };
  }
  for (const w of Object.values(p.schematic?.wires ?? {}))
    for (const v of w.points) {
      const d = dist(v, q);
      if (d <= tol && (!best || d < best.d)) best = { at: v, d };
    }
  return best ? { at: best.at, onto: true } : { at: snapPt(q), onto: false };
}

/** Лежит ли точка на проводе (не в конце незаконченного). */
function onAnyWire(p: Project, q: Vec2): boolean {
  for (const w of Object.values(p.schematic?.wires ?? {}))
    for (let i = 1; i < w.points.length; i++) {
      const a = w.points[i - 1];
      const b = w.points[i];
      const cross = (b.x - a.x) * (q.y - a.y) - (b.y - a.y) * (q.x - a.x);
      const t = ((q.x - a.x) * (b.x - a.x) + (q.y - a.y) * (b.y - a.y)) / ((b.x - a.x) ** 2 + (b.y - a.y) ** 2 || 1);
      if (Math.abs(cross) < 1e-3 && t >= -1e-6 && t <= 1 + 1e-6) return true;
    }
  return false;
}

/* ---------------- контроллер ---------------- */

interface Drag {
  kind: 'pan' | 'move' | 'box';
  start: Vec2;
  startWorld: Vec2;
  view0: ViewState;
  moved: boolean;
  hit?: SchHit | null;
  touch?: boolean;
}

export class SchController {
  private drag: Drag | null = null;
  private pointers = new Map<number, Vec2>();
  private pinch: { d0: number; view0: ViewState; c0: Vec2 } | null = null;
  private lastTap = { at: 0, pos: null as Vec2 | null };
  pointerWorld: Vec2 | null = null;
  lastLabel = 'GND';

  constructor(private canvas: HTMLCanvasElement) {}

  private sp(e: { clientX: number; clientY: number }): Vec2 {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  private wp(e: { clientX: number; clientY: number }): Vec2 {
    const v = S().schView;
    const p = this.sp(e);
    return { x: v.x + p.x / v.scale, y: v.y + p.y / v.scale };
  }
  private tol(): number {
    return Math.max(0.6, 7 / S().schView.scale);
  }

  zoomAt(sp: Vec2, k: number): void {
    const v = S().schView;
    const scale = Math.min(60, Math.max(0.3, v.scale * k));
    const wx = v.x + sp.x / v.scale;
    const wy = v.y + sp.y / v.scale;
    S().patch({ schView: { scale, x: wx - sp.x / scale, y: wy - sp.y / scale } });
  }

  onWheel(e: WheelEvent): void {
    e.preventDefault();
    this.zoomAt(this.sp(e), Math.exp(-e.deltaY * 0.0015));
  }

  onPointerDown(e: PointerEvent, space: boolean): void {
    const s = S();
    this.canvas.setPointerCapture(e.pointerId);
    const sp = this.sp(e);
    this.pointers.set(e.pointerId, sp);
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const v = s.schView;
      this.pinch = { d0: dist(a, b) || 1, view0: { ...v }, c0: { x: v.x + (a.x + b.x) / 2 / v.scale, y: v.y + (a.y + b.y) / 2 / v.scale } };
      if (this.drag?.kind === 'move' && this.drag.moved) s.endTransaction();
      this.drag = null;
      return;
    }
    const wp = this.wp(e);
    const base: Drag = { kind: 'pan', start: sp, startWorld: wp, view0: { ...s.schView }, moved: false, touch: e.pointerType === 'touch' };
    if (e.button === 1 || e.button === 2 || space || s.schTool === 'pan') {
      if (e.button === 2 && s.schPending) {
        this.cancel();
        return;
      }
      this.drag = base;
      return;
    }
    if (e.button !== 0) return;
    if (s.schTool === 'select') {
      const hit = schHits(s.project, wp, this.tol())[0] ?? null;
      const keys = new Set(s.schSelection.map((r) => r.kind + ':' + r.id));
      if (hit) {
        const k = hit.ref.kind + ':' + hit.ref.id;
        if (e.shiftKey) {
          s.patch({ schSelection: keys.has(k) ? s.schSelection.filter((r) => r.kind + ':' + r.id !== k) : [...s.schSelection, hit.ref] });
          this.lastTap = { at: 0, pos: null };
          return;
        }
        if (!keys.has(k)) s.patch({ schSelection: [hit.ref] });
        this.drag = { ...base, kind: 'move', hit };
      } else {
        this.drag = e.pointerType === 'touch' ? base : { ...base, kind: 'box' };
        if (!e.shiftKey) s.patch({ schSelection: [] });
      }
      return;
    }
    this.drag = base;
  }

  onPointerMove(e: PointerEvent): void {
    const s = S();
    const sp = this.sp(e);
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, sp);
    if (this.pinch && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const scale = Math.min(60, Math.max(0.3, (this.pinch.view0.scale * (dist(a, b) || 1)) / this.pinch.d0));
      const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      s.patch({ schView: { scale, x: this.pinch.c0.x - c.x / scale, y: this.pinch.c0.y - c.y / scale } });
      return;
    }
    const wp = this.wp(e);
    this.pointerWorld = wp;
    const d = this.drag;
    if (!d) {
      if (s.schPending?.kind === 'wire') s.patch({ schPending: { ...s.schPending, cursor: stickPoint(s.project, wp, this.tol()).at } });
      return;
    }
    const dx = sp.x - d.start.x;
    const dy = sp.y - d.start.y;
    if (!d.moved && Math.hypot(dx, dy) > (d.touch ? 8 : 4)) {
      d.moved = true;
      if (d.kind === 'move') s.beginTransaction();
    }
    if (!d.moved) return;
    if (d.kind === 'pan') s.patch({ schView: { ...d.view0, x: d.view0.x - dx / d.view0.scale, y: d.view0.y - dy / d.view0.scale } });
    else if (d.kind === 'box') s.patch({ schPending: { kind: 'box', start: d.startWorld, cursor: wp } });
    else if (d.kind === 'move') {
      const base = s.past[s.past.length - 1];
      if (!base?.schematic) return;
      const delta = { x: snap(wp.x - d.startWorld.x), y: snap(wp.y - d.startWorld.y) };
      const sel = s.schSelection;
      s.updateTransaction((draft) => moveSch(draft, base, sel, delta));
    }
  }

  onPointerUp(e: PointerEvent): void {
    const s = S();
    this.pointers.delete(e.pointerId);
    if (this.pinch) {
      if (!this.pointers.size) this.pinch = null;
      this.drag = null;
      return;
    }
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    const wp = this.wp(e);
    if (d.kind === 'move') {
      if (d.moved) s.endTransaction();
      else if (d.hit) {
        s.patch({ schSelection: [d.hit.ref] });
        this.maybeDouble(wp, d.hit);
      }
      return;
    }
    if (d.kind === 'box') {
      s.patch({ schPending: null });
      if (d.moved) this.boxSelect(d.startWorld, wp, e.shiftKey);
      return;
    }
    if (d.moved || e.button !== 0 || s.schTool === 'pan') return;
    this.click(wp);
  }

  onPointerCancel(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
    if (this.drag?.kind === 'move' && this.drag.moved) S().endTransaction();
    this.drag = null;
    this.pinch = null;
  }

  private maybeDouble(wp: Vec2, hit: SchHit): void {
    const now = Date.now();
    if (this.lastTap.pos && now - this.lastTap.at < 350 && dist(this.lastTap.pos, wp) < this.tol() * 2) {
      this.lastTap = { at: 0, pos: null };
      this.openProps(hit.ref);
      return;
    }
    this.lastTap = { at: now, pos: wp };
  }

  resetTap(): void {
    this.lastTap = { at: 0, pos: null };
  }

  onDoubleClick(e: MouseEvent): void {
    const s = S();
    if (s.schTool === 'wire' && s.schPending?.kind === 'wire') {
      this.finishWire();
      return;
    }
    if (s.schTool !== 'select') return;
    const hit = schHits(s.project, this.wp(e), this.tol())[0];
    if (hit) this.openProps(hit.ref);
  }

  private openProps(ref: SchRef): void {
    const s = S();
    if (ref.kind === 'symbol') {
      const c = s.project.schematic?.symbols[ref.id]?.component;
      if (c) s.openDialog('component', c);
    } else if (ref.kind === 'label') this.editLabel(ref.id);
  }

  editLabel(id: string): void {
    const l = S().project.schematic?.labels[id];
    if (!l) return;
    askText({
      title: 'Метка цепи',
      message: 'Имя цепи. Одноимённые метки соединены между собой.',
      value: l.text,
      okLabel: 'Сохранить',
      onOk: (v) => {
        const t = (v ?? '').trim();
        if (t) S().commit((d) => void (d.schematic!.labels[id].text = t));
      },
    });
  }

  private boxSelect(a: Vec2, b: Vec2, add: boolean): void {
    const s = S();
    const p = s.project;
    const x0 = Math.min(a.x, b.x);
    const x1 = Math.max(a.x, b.x);
    const y0 = Math.min(a.y, b.y);
    const y1 = Math.max(a.y, b.y);
    const inside = (q: Vec2) => q.x >= x0 && q.x <= x1 && q.y >= y0 && q.y <= y1;
    const sel: SchRef[] = [];
    for (const sym of Object.values(p.schematic?.symbols ?? {})) {
      const def = symbolOf(p, sym);
      if (!def) continue;
      const bb = symbolWorldBox(def, sym);
      if (inside({ x: bb.minX, y: bb.minY }) && inside({ x: bb.maxX, y: bb.maxY })) sel.push({ kind: 'symbol', id: sym.id });
    }
    for (const w of Object.values(p.schematic?.wires ?? {})) if (w.points.every(inside)) sel.push({ kind: 'wire', id: w.id });
    for (const l of Object.values(p.schematic?.labels ?? {})) if (inside(l.at)) sel.push({ kind: 'label', id: l.id });
    s.patch({ schSelection: add ? [...s.schSelection, ...sel.filter((r) => !s.schSelection.some((x) => x.kind === r.kind && x.id === r.id))] : sel });
    s.setMessage(sel.length ? `Выделено объектов: ${sel.length}.` : 'В рамке ничего нет.');
  }

  private click(wp: Vec2): void {
    const s = S();
    if (s.schTool === 'wire') return this.clickWire(wp);
    if (s.schTool === 'label') {
      const at = stickPoint(s.project, wp, this.tol()).at;
      askText({
        title: 'Метка цепи',
        message: 'Имя цепи (GND, +5V, SDA…). Одноимённые метки соединены между собой.',
        value: this.lastLabel,
        okLabel: 'Поставить',
        onOk: (v) => {
          const t = (v ?? '').trim();
          if (!t) return;
          this.lastLabel = t;
          const id = newId('sl');
          const power = /^(gnd|agnd|dgnd|vcc|vdd|vss|[+-]?\d+(?:[.,]\d+)?v\d*|3v3)$/i.test(t);
          S().commit((d) => {
            d.schematic ??= { symbols: {}, wires: {}, labels: {} };
            d.schematic.labels[id] = { id, at, text: t, rotation: power ? 90 : 0, kind: power ? 'power' : 'net' } as SchLabel;
          });
        },
      });
      return;
    }
    if (s.schTool === 'place') {
      const fp = s.placeFootprint ? findFootprint(s.placeFootprint) : undefined;
      if (!fp) {
        s.setMessage('Выберите корпус в библиотеке справа.');
        s.patch({ panelTab: 'library', panelOpen: true });
        return;
      }
      if (!symbolDef(fp)) {
        s.setMessage('У этого корпуса нет выводов — на схему его не ставят (крепёж ставится на плату).');
        return;
      }
      placeSymbol(fp, wp, s.schPlaceRotation);
    }
  }

  private clickWire(wp: Vec2): void {
    const s = S();
    const st = stickPoint(s.project, wp, this.tol());
    const pd = s.schPending;
    if (pd?.kind !== 'wire') {
      s.patch({ schPending: { kind: 'wire', points: [st.at], cursor: st.at } });
      s.setMessage('Провод: щелчки — изломы, щелчок по выводу или проводу — закончить, двойной щелчок или Esc — закончить здесь.');
      return;
    }
    const last = pd.points[pd.points.length - 1];
    if (dist(last, st.at) < 1e-6) return;
    const pts = [...pd.points, ...orthoTail(last, st.at)];
    const ends = st.onto || onAnyWire(s.project, st.at);
    if (ends) {
      this.commitWire(pts);
      return;
    }
    s.patch({ schPending: { ...pd, points: pts, cursor: st.at } });
  }

  finishWire(): void {
    const pd = S().schPending;
    if (pd?.kind === 'wire' && pd.points.length >= 2) this.commitWire(pd.points);
    else S().patch({ schPending: null });
  }

  private commitWire(pts: Vec2[]): void {
    const clean = pts.filter((q, i) => i === 0 || dist(q, pts[i - 1]) > 1e-6);
    const s = S();
    s.patch({ schPending: null });
    if (clean.length < 2) return;
    const id = newId('sw');
    s.commit((d) => {
      d.schematic ??= { symbols: {}, wires: {}, labels: {} };
      d.schematic.wires[id] = { id, points: clean } as SchWire;
    });
  }

  /** Esc: закончить провод (если есть что), иначе отменить, иначе к выбору, иначе снять выделение. */
  cancel(): void {
    const s = S();
    if (s.schPending?.kind === 'wire') {
      if (s.schPending.points.length >= 2) this.finishWire();
      else s.patch({ schPending: null });
      return;
    }
    if (s.schPending) s.patch({ schPending: null });
    else if (s.schTool !== 'select') setSchTool('select');
    else s.patch({ schSelection: [] });
  }

  /** Backspace при проводе — убрать последний излом. */
  undoPoint(): boolean {
    const s = S();
    const pd = s.schPending;
    if (pd?.kind !== 'wire') return false;
    if (pd.points.length > 1) s.patch({ schPending: { ...pd, points: pd.points.slice(0, -1) } });
    else s.patch({ schPending: null });
    return true;
  }
}

const HINTS: Record<SchTool, string> = {
  select: 'Схема: щелчок — выбрать, тянуть — двигать, рамка — выделить несколько. R — повернуть, X — зеркало, Delete — удалить.',
  pan: 'Рука: тяните, чтобы двигать лист.',
  wire: 'Провод: щелчок по выводу — начать, щелчки — изломы, щелчок по выводу или проводу — закончить.',
  label: 'Метка цепи: щелчок по концу провода или выводу, затем имя. Одноимённые метки соединены.',
  place: 'Выберите корпус в библиотеке и щёлкните по листу. R — повернуть.',
};

export function setSchTool(t: SchTool): void {
  S().patch({ schTool: t, schPending: null, message: HINTS[t] });
}

/**
 * Перенос выделенного на delta от исходного состояния base. Провода, прицепленные
 * к выводам переносимых символов, тянутся концом; отвод с меткой на конце едет целиком.
 */
function moveSch(d: Project, base: Project, sel: SchRef[], delta: Vec2): void {
  const sch = d.schematic;
  const b = base.schematic;
  if (!sch || !b) return;
  const mv = (q: Vec2): Vec2 => ({ x: +(q.x + delta.x).toFixed(4), y: +(q.y + delta.y).toFixed(4) });
  const selKeys = new Set(sel.map((r) => r.kind + ':' + r.id));
  const k = (q: Vec2) => `${Math.round(q.x * 1000)},${Math.round(q.y * 1000)}`;
  // Выводы переносимых символов (в исходном положении).
  const movedPins = new Set<string>();
  for (const pin of placedPins(base)) if (selKeys.has('symbol:' + pin.symbol)) movedPins.add(k(pin.at));
  // Сколько концов проводов и меток в каждой точке — чтобы понять, «отвод» ли это.
  const labelsAt = new Map<string, string[]>();
  for (const l of Object.values(b.labels)) (labelsAt.get(k(l.at)) ?? labelsAt.set(k(l.at), []).get(k(l.at))!).push(l.id);
  const wireEnds = new Map<string, number>();
  for (const w of Object.values(b.wires)) for (const q of [w.points[0], w.points[w.points.length - 1]]) wireEnds.set(k(q), (wireEnds.get(k(q)) ?? 0) + 1);
  const pinsAt = new Set(placedPins(base).map((x) => k(x.at)));
  const movedLabels = new Set<string>();
  for (const r of sel) {
    if (r.kind === 'symbol' && b.symbols[r.id] && sch.symbols[r.id]) sch.symbols[r.id].at = mv(b.symbols[r.id].at);
    else if (r.kind === 'label' && b.labels[r.id] && sch.labels[r.id]) sch.labels[r.id].at = mv(b.labels[r.id].at);
    else if (r.kind === 'wire' && b.wires[r.id] && sch.wires[r.id]) sch.wires[r.id].points = b.wires[r.id].points.map(mv);
  }
  for (const w of Object.values(b.wires)) {
    if (selKeys.has('wire:' + w.id) || !sch.wires[w.id]) continue;
    const first = w.points[0];
    const last = w.points[w.points.length - 1];
    const a = movedPins.has(k(first));
    const z = movedPins.has(k(last));
    if (!a && !z) continue;
    const other = a ? last : first;
    const stub = !(a && z) && !pinsAt.has(k(other)) && (wireEnds.get(k(other)) ?? 0) === 1 && (labelsAt.get(k(other))?.length ?? 0) > 0;
    if (a && z) sch.wires[w.id].points = w.points.map(mv);
    else if (stub) {
      sch.wires[w.id].points = w.points.map(mv);
      for (const id of labelsAt.get(k(other)) ?? []) movedLabels.add(id);
    } else {
      const pts = w.points.map((q) => ({ ...q }));
      if (a) pts[0] = mv(first);
      if (z) pts[pts.length - 1] = mv(last);
      sch.wires[w.id].points = pts;
    }
  }
  for (const id of movedLabels) if (!selKeys.has('label:' + id) && b.labels[id] && sch.labels[id]) sch.labels[id].at = mv(b.labels[id].at);
  // Метки прямо на выводах переносимых символов.
  for (const l of Object.values(b.labels)) if (!selKeys.has('label:' + l.id) && movedPins.has(k(l.at)) && sch.labels[l.id]) sch.labels[l.id].at = mv(l.at);
}
