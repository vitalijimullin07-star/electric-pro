import { dist, type Vec2 } from '@core/math/vec';
import { fmtLen } from '@core/units';
import { netAtPoint } from '@core/model/connectivity';
import { boardCopperLayers } from '@core/model/layers';
import { addDrawing, addRuleArea, addZone } from '@core/model/edit';
import type { CopperLayer, ItemRef, Project } from '@core/model/types';
import { findFootprint } from './userlib';
import { hitTest, type Hit } from '@render/hit-test';
import { screenToWorld } from '@render/canvas-renderer';
import { finishTrack, moveItems, placeComponent, placeVia, placeWire, routeWidthFor, snapPoint, viaSizeFor } from './commands';
import { useEditor, type ToolId } from './store';
import { boxOfPoints, closestOnSegment } from '@core/math/geom';
import { getWorld } from '@core/model/world';

/*
 * Обработка мыши и касаний на холсте. Один контроллер, поведение зависит от инструмента.
 * Правая кнопка и Esc отменяют действие; средняя кнопка, пробел и два пальца двигают вид.
 */

interface Drag {
  kind: 'pan' | 'move' | 'box' | 'vertex' | 'segment';
  start: Vec2; // экран
  startWorld: Vec2;
  last: Vec2;
  view0: { x: number; y: number; scale: number };
  moved: boolean;
  items?: ItemRef[];
  /** Для вершины: объект и индекс. */
  vertex?: { ref: ItemRef; index: number; orig: Vec2[] };
  segment?: { ref: ItemRef; index: number; orig: Vec2[] };
  hit?: Hit | null;
  touch?: boolean;
}

export class CanvasController {
  private drag: Drag | null = null;
  private pointers = new Map<number, Vec2>();
  private pinch: { d0: number; view0: { x: number; y: number; scale: number }; c0: Vec2 } | null = null;
  private lastTapAt = 0;
  private lastTapPos: Vec2 | null = null;
  private spaceDown = false;
  private placeRotation = 0;
  private placeSide: 'top' | 'bottom' = 'top';
  private diagonalFirst = true;
  /** Точка платы под курсором (для вставки под курсор); null — курсор вне холста. */
  pointerWorld: Vec2 | null = null;

  constructor(private canvas: HTMLCanvasElement) {}

  private get S() {
    return useEditor.getState();
  }

  private screenPt(e: PointerEvent | WheelEvent): Vec2 {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  private worldPt(e: PointerEvent | WheelEvent): Vec2 {
    return screenToWorld(this.S.view, this.screenPt(e));
  }
  private tol(): number {
    return Math.max(0.15, 6 / this.S.view.scale);
  }
  private hits(pt: Vec2, copperOnly = false): Hit[] {
    const s = this.S;
    return hitTest(s.project, pt, { tol: this.tol(), visible: s.layerVisible, activeLayer: s.activeLayer, copperLayers: boardCopperLayers(s.project.board.copperLayers), copperOnly });
  }

  /** Двойной щелчок — только два щелчка подряд: клавиша или щелчок с Shift между ними его сбрасывают. */
  resetTap(): void {
    this.lastTapAt = 0;
    this.lastTapPos = null;
  }

  setSpace(down: boolean): void {
    this.spaceDown = down;
  }

  onWheel(e: WheelEvent): void {
    e.preventDefault();
    const s = this.S;
    const sp = this.screenPt(e);
    if (e.ctrlKey || e.metaKey || !e.shiftKey) {
      const k = Math.exp(-e.deltaY * 0.0015);
      this.zoomAt(sp, k);
    } else {
      s.patch({ view: { ...s.view, x: s.view.x + e.deltaY / s.view.scale, y: s.view.y } });
    }
  }

  zoomAt(sp: Vec2, k: number): void {
    const s = this.S;
    const v = s.view;
    const scale = Math.min(400, Math.max(0.3, v.scale * k));
    const wp = screenToWorld(v, sp);
    s.patch({ view: { scale, x: wp.x - sp.x / scale, y: wp.y - sp.y / scale } });
  }

  onPointerDown(e: PointerEvent): void {
    const s = this.S;
    if (s.routing.running) return;
    this.canvas.setPointerCapture(e.pointerId);
    const sp = this.screenPt(e);
    this.pointers.set(e.pointerId, sp);
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = { d0: dist(a, b) || 1, view0: { ...s.view }, c0: screenToWorld(s.view, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }) };
      if (this.drag?.kind === 'move' || this.drag?.kind === 'vertex' || this.drag?.kind === 'segment') this.S.endTransaction();
      this.drag = null;
      return;
    }
    const wp = this.worldPt(e);
    const view0 = { ...s.view };
    const base: Drag = { kind: 'pan', start: sp, startWorld: wp, last: sp, view0, moved: false, touch: e.pointerType === 'touch' };

    if (e.button === 1 || e.button === 2 || this.spaceDown || s.tool === 'pan') {
      if (e.button === 2 && s.pending) {
        this.cancelPending();
        return;
      }
      this.drag = base;
      return;
    }
    if (e.button !== 0) return;

    if (s.tool === 'select') {
      const hits = this.hits(wp);
      const hit = hits[0] ?? null;
      const selKeys = new Set(s.selection.map((r) => r.kind + ':' + r.id));
      if (hit?.inside) {
        // Внутри полигона, но не на его краю: щелчок выделит полигон, протяжка — рамка (или вид пальцем).
        this.drag = e.pointerType === 'touch' ? { ...base, hit } : { ...base, kind: 'box', hit };
        if (!e.shiftKey) s.patch({ selection: [], highlightNet: null });
        return;
      }
      if (hit) {
        const key = hit.ref.kind + ':' + hit.ref.id;
        // Вершина выделенной дорожки/контура.
        if (selKeys.has(key) && hit.vertex !== undefined && (hit.ref.kind === 'track' || hit.ref.kind === 'ruleArea' || hit.ref.kind === 'zone') && s.selection.length === 1) {
          this.drag = { ...base, kind: 'vertex', vertex: { ref: hit.ref, index: hit.vertex, orig: this.pointsOf(s.project, hit.ref) } };
          return;
        }
        if (selKeys.has(key) && hit.ref.kind === 'track' && hit.segment !== undefined && s.selection.length === 1) {
          this.drag = { ...base, kind: 'segment', segment: { ref: hit.ref, index: hit.segment, orig: this.pointsOf(s.project, hit.ref) } };
          return;
        }
        if (e.shiftKey) {
          s.select([hit.ref], true);
          this.resetTap();
          return;
        }
        if (!selKeys.has(key)) s.select([hit.ref]);
        // Выбрали объект — показываем его свойства (если панель открыта на библиотеке или слоях).
        if (s.panelTab === 'library' || s.panelTab === 'layers') s.patch({ panelTab: 'props' });
        // Двигаем всё выделенное (объект из группы выделил всю группу).
        this.drag = { ...base, kind: 'move', items: this.S.selection, hit };
        this.showHitInfo(hit);
      } else {
        // Пальцем по пустому месту двигаем плату, мышью — рамка выделения.
        this.drag = e.pointerType === 'touch' ? base : { ...base, kind: 'box' };
        if (!e.shiftKey) s.patch({ selection: [], highlightNet: null });
      }
      return;
    }
    // Остальные инструменты действуют на отпускание (щелчок), а тянуть можно вид.
    this.drag = base;
  }

  onPointerMove(e: PointerEvent): void {
    const s = this.S;
    const sp = this.screenPt(e);
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, sp);
    if (this.pinch && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const d = dist(a, b) || 1;
      const scale = Math.min(400, Math.max(0.3, (this.pinch.view0.scale * d) / this.pinch.d0));
      const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      s.patch({ view: { scale, x: this.pinch.c0.x - c.x / scale, y: this.pinch.c0.y - c.y / scale } });
      return;
    }
    const wp = this.worldPt(e);
    this.pointerWorld = wp;
    if (!this.drag) {
      // Наведение и предпросмотр.
      if (s.pending) {
        const cur = this.pendingCursor(wp);
        const last = s.pending.points[s.pending.points.length - 1];
        const preview = s.pending.kind === 'route' && last ? this.cornerPoints(last, cur) : undefined;
        s.patch({ pending: { ...s.pending, cursor: cur, preview } });
      }
      if (s.tool === 'select' || s.tool === 'route' || s.tool === 'wire') {
        const h = this.hits(wp, s.tool !== 'select')[0] ?? null;
        const ref = h ? h.ref : null;
        if ((ref?.kind ?? null) !== (s.hover?.kind ?? null) || ref?.id !== s.hover?.id) s.patch({ hover: ref });
      } else if (s.hover) s.patch({ hover: null });
      if (s.tool === 'place' && s.placeFootprint) this.updateGhost(wp);
      return;
    }
    const d = this.drag;
    const dx = sp.x - d.start.x;
    const dy = sp.y - d.start.y;
    if (!d.moved && Math.hypot(dx, dy) > (d.touch ? 8 : 4)) {
      d.moved = true;
      if (d.kind === 'move' && d.items?.every((r) => r.kind === 'component' && s.project.components[r.id]?.locked)) {
        s.setMessage('Компонент закреплён: снимите «закрепить» в свойствах, чтобы двигать.');
      }
      if (d.kind === 'move' || d.kind === 'vertex' || d.kind === 'segment') s.beginTransaction();
      if (d.kind === 'box') s.patch({ pending: { kind: 'box', points: [], cursor: wp, start: d.startWorld } });
    }
    if (!d.moved) return;
    if (d.kind === 'pan') {
      s.patch({ view: { ...d.view0, x: d.view0.x - dx / d.view0.scale, y: d.view0.y - dy / d.view0.scale } });
    } else if (d.kind === 'box') {
      s.patch({ pending: { kind: 'box', points: [], cursor: wp, start: d.startWorld } });
    } else if (d.kind === 'move' && d.items) {
      const wpx = wp.x - d.startWorld.x;
      const wpy = wp.y - d.startWorld.y;
      // Привязка: если тянем один компонент за площадку — площадка на сетку, иначе — сдвиг на сетку.
      let delta = snapPoint({ x: wpx, y: wpy });
      if (d.hit?.pad && d.items.length === 1) {
        const target = snapPoint({ x: d.hit.pad.center.x + wpx, y: d.hit.pad.center.y + wpy });
        delta = { x: target.x - d.hit.pad.center.x, y: target.y - d.hit.pad.center.y };
      } else if (d.hit?.ref.kind === 'component' && d.items.length === 1) {
        const c0 = s.past[s.past.length - 1]?.components[d.hit.ref.id]?.at;
        if (c0) {
          const target = snapPoint({ x: c0.x + wpx, y: c0.y + wpy });
          delta = { x: target.x - c0.x, y: target.y - c0.y };
        }
      }
      const base = s.past[s.past.length - 1];
      if (!base) return;
      s.updateTransaction((draft) => {
        // Восстанавливаем от исходного состояния, чтобы не накапливать погрешность.
        for (const r of d.items!) restoreItem(draft, base, r);
        moveItems(draft, d.items!, (q) => ({ x: +(q.x + delta.x).toFixed(4), y: +(q.y + delta.y).toFixed(4) }));
      });
    } else if (d.kind === 'vertex' && d.vertex) {
      const q = snapPoint(wp);
      const vx = d.vertex;
      s.updateTransaction((draft) => {
        const pts = this.pointsOfDraft(draft, vx.ref);
        if (pts) pts[vx.index] = q;
      });
    } else if (d.kind === 'segment' && d.segment) {
      // Параллельный перенос отрезка: двигаем обе вершины на одну и ту же величину поперёк отрезка.
      const sg = d.segment;
      const a = sg.orig[sg.index];
      const b = sg.orig[sg.index + 1];
      const wpx = wp.x - d.startWorld.x;
      const wpy = wp.y - d.startWorld.y;
      const ex = b.x - a.x;
      const ey = b.y - a.y;
      const L = Math.hypot(ex, ey) || 1;
      const nx = -ey / L;
      const ny = ex / L;
      const k = wpx * nx + wpy * ny;
      let shift = { x: nx * k, y: ny * k };
      if (Math.abs(ex) < 1e-9 || Math.abs(ey) < 1e-9) shift = snapPoint(shift);
      s.updateTransaction((draft) => {
        const pts = this.pointsOfDraft(draft, sg.ref);
        if (!pts) return;
        pts[sg.index] = { x: +(a.x + shift.x).toFixed(4), y: +(a.y + shift.y).toFixed(4) };
        pts[sg.index + 1] = { x: +(b.x + shift.x).toFixed(4), y: +(b.y + shift.y).toFixed(4) };
      });
    }
  }

  onPointerUp(e: PointerEvent): void {
    const s = this.S;
    this.pointers.delete(e.pointerId);
    if (this.pinch) {
      if (this.pointers.size === 0) this.pinch = null;
      this.drag = null;
      return;
    }
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    const wp = this.worldPt(e);
    if (d.kind === 'move' || d.kind === 'vertex' || d.kind === 'segment') {
      if (d.moved) {
        s.endTransaction();
        return;
      }
      // Щелчок без движения: выделить только этот объект.
      if (d.kind === 'move' && d.hit && !e.shiftKey) {
        s.select([d.hit.ref]);
        this.showHitInfo(d.hit);
        this.checkDoubleTap(wp, d.hit);
      }
      return;
    }
    if (d.kind === 'box') {
      s.patch({ pending: null });
      if (d.moved) this.boxSelect(d.startWorld, wp, e.shiftKey);
      else if (d.hit) this.selectInside(d.hit, e.shiftKey);
      return;
    }
    if (d.moved) return; // это было перетаскивание вида
    if (s.tool === 'select' && d.hit) {
      this.selectInside(d.hit, false);
      return;
    }
    if (e.button === 2 || e.button === 1) return;
    if (s.tool === 'pan') return;
    this.click(wp, e);
  }

  onPointerCancel(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
    if (this.drag && (this.drag.kind === 'move' || this.drag.kind === 'vertex' || this.drag.kind === 'segment') && this.drag.moved) this.S.endTransaction();
    this.drag = null;
    this.pinch = null;
    this.S.patch({ pending: this.S.pending?.kind === 'box' ? null : this.S.pending });
  }

  onDoubleClick(e: MouseEvent): void {
    const s = this.S;
    if (s.tool === 'select') {
      const r = this.canvas.getBoundingClientRect();
      const wp = screenToWorld(s.view, { x: e.clientX - r.left, y: e.clientY - r.top });
      const h = this.hits(wp)[0];
      if (h?.ref.kind === 'component') s.openDialog('component', h.ref.id);
      else if (h?.ref.kind === 'drawing' && s.project.drawings[h.ref.id]?.kind === 'text') s.openDialog('text', h.ref.id);
    }
  }

  /** Щелчок внутри полигона без протяжки: выделить его. */
  private selectInside(hit: Hit, add: boolean): void {
    const s = this.S;
    s.select([hit.ref], add);
    if (s.panelTab === 'library' || s.panelTab === 'layers') s.patch({ panelTab: 'props' });
    const z = hit.ref.kind === 'zone' ? s.project.zones[hit.ref.id] : null;
    if (z) s.setMessage(`Полигон ${z.net ? (s.project.nets[z.net]?.name ?? '') : 'без цепи'}. Двигать — за край, вершины — за углы; свойства справа.`);
  }

  private checkDoubleTap(wp: Vec2, hit: Hit): void {
    const now = Date.now();
    if (this.lastTapPos && now - this.lastTapAt < 350 && dist(this.lastTapPos, wp) < this.tol() * 2) {
      if (hit.ref.kind === 'component') this.S.openDialog('component', hit.ref.id);
      this.lastTapAt = 0;
      return;
    }
    this.lastTapAt = now;
    this.lastTapPos = wp;
  }

  /* ---------------- щелчки инструментов ---------------- */

  private click(wp: Vec2, e: PointerEvent): void {
    const s = this.S;
    const now = Date.now();
    const isDouble = this.lastTapPos !== null && now - this.lastTapAt < 350 && dist(this.lastTapPos, wp) < this.tol() * 2;
    this.lastTapAt = now;
    this.lastTapPos = wp;
    switch (s.tool) {
      case 'route':
        return this.clickRoute(wp, isDouble);
      case 'via': {
        const q = snapPoint(wp);
        const net = netAtPoint(s.project, q, null);
        placeVia(q, net);
        s.setMessage('Переходное поставлено.');
        return;
      }
      case 'wire':
        return this.clickWire(wp);
      case 'place':
        return this.clickPlace(wp);
      case 'line':
      case 'rect':
      case 'circle':
        return this.clickTwoPoint(wp);
      case 'poly':
      case 'zone':
      case 'keepout':
      case 'outline':
        return this.clickPoly(wp, isDouble);
      case 'text': {
        const q = snapPoint(wp);
        s.openDialog('text', { at: q });
        return;
      }
      case 'dimension':
        return this.clickDimension(e.shiftKey ? wp : snapPoint(wp));
      case 'measure': {
        const q = e.shiftKey ? wp : snapPoint(wp);
        if (!s.pending) s.patch({ pending: { kind: 'measure', points: [q], cursor: q }, measure: null });
        else {
          s.patch({ pending: null, measure: { a: s.pending.points[0], b: q } });
          const d = dist(s.pending.points[0], q);
          s.setMessage(`Расстояние ${fmtLen(d, s.units)} (Δx ${fmtLen(Math.abs(q.x - s.pending.points[0].x), s.units)}, Δy ${fmtLen(Math.abs(q.y - s.pending.points[0].y), s.units)}).`);
        }
        return;
      }
      default:
        return;
    }
  }

  /** Точка предпросмотра для текущего инструмента (с привязкой и углами 45°). */
  private pendingCursor(wp: Vec2): Vec2 {
    const s = this.S;
    const q = snapPoint(wp);
    if (s.pending?.kind === 'route' && s.pending.points.length) {
      // Целевая площадка притягивает.
      const h = this.hits(wp, true)[0];
      if (h?.pad) return h.pad.center;
      if (h?.ref.kind === 'via') return s.project.vias[h.ref.id].at;
    }
    return q;
  }

  /** Излом под 45°: из последней точки к цели через промежуточную вершину. */
  private cornerPoints(from: Vec2, to: Vec2): Vec2[] {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    if (Math.abs(dx) < 1e-9 || Math.abs(dy) < 1e-9 || Math.abs(Math.abs(dx) - Math.abs(dy)) < 1e-9) return [to];
    const m = Math.min(Math.abs(dx), Math.abs(dy));
    const sx = Math.sign(dx);
    const sy = Math.sign(dy);
    const mid = this.diagonalFirst
      ? { x: from.x + sx * m, y: from.y + sy * m }
      : { x: to.x - sx * m, y: to.y - sy * m };
    return [mid, to];
  }

  toggleCornerMode(): void {
    this.diagonalFirst = !this.diagonalFirst;
    this.S.setMessage(this.diagonalFirst ? 'Изгиб: сначала по диагонали.' : 'Изгиб: сначала прямо.');
  }

  private clickRoute(wp: Vec2, isDouble: boolean): void {
    const s = this.S;
    const layers = boardCopperLayers(s.project.board.copperLayers);
    let layer: CopperLayer = s.pending?.kind === 'route' && s.pending.layer ? s.pending.layer : layers.includes(s.activeLayer) ? s.activeLayer : layers[0];
    const all = this.hits(wp, true);
    if (!s.pending || s.pending.kind !== 'route') {
      // Начало на площадке только другого слоя (SMD снизу или сверху) — переходим на её слой.
      const padHit = all.find((x) => x.pad && x.pad.layers.length);
      if (padHit?.pad && !padHit.pad.layers.includes(layer)) {
        const l = padHit.pad.layers.find((x) => layers.includes(x));
        if (l) {
          layer = l;
          s.patch({ activeLayer: l });
        }
      }
    }
    const hits = all.filter((h) => !h.layer || h.layer === layer || h.pad?.layers.includes(layer) || h.ref.kind === 'via');
    const h = hits[0];
    if (!s.pending || s.pending.kind !== 'route') {
      // Начало: площадка, переходное или дорожка на активном слое; иначе — свободная точка.
      let start: Vec2;
      let net: string | null = null;
      if (h?.pad) {
        start = h.pad.center;
        net = h.pad.net;
      } else if (h?.ref.kind === 'via') {
        start = s.project.vias[h.ref.id].at;
        net = netAtPoint(s.project, start, layer);
      } else if (h?.ref.kind === 'track') {
        start = this.pointOnTrack(h, wp);
        net = netAtPoint(s.project, start, layer);
      } else start = snapPoint(wp);
      const width = routeWidthFor(net);
      s.patch({ pending: { kind: 'route', points: [start], cursor: start, layer, width, net }, highlightNet: net, selection: [] });
      const layerName = layer === 'F.Cu' ? 'верхней' : 'нижней';
      s.setMessage(net ? `Цепь ${s.project.nets[net]?.name ?? ''}, слой ${layerName} меди: ведите к подсвеченной площадке. V — переходное, / — тип изгиба.` : `Дорожка без цепи по ${layerName} меди. Ведите к площадке.`);
      return;
    }
    // Щелчок по площадке, которой нет на слое дорожки: подсказываем, а не ставим изгиб поверх неё.
    const foreignPad = all.find((x) => x.pad && !x.pad.layers.includes(layer));
    if (!h && foreignPad?.pad) {
      s.setMessage(`${foreignPad.pad.component.ref}: площадка на ${layer === 'F.Cu' ? 'нижнем' : 'верхнем'} слое. Поставьте переходное (V) рядом и продолжайте.`);
      return;
    }
    const pd = s.pending;
    const last = pd.points[pd.points.length - 1];
    let target: Vec2;
    let finish = false;
    if (h?.pad) {
      target = h.pad.center;
      finish = true;
    } else if (h?.ref.kind === 'via') {
      target = s.project.vias[h.ref.id].at;
      finish = true;
    } else if (h?.ref.kind === 'track' && h.ref.id) {
      target = this.pointOnTrack(h, wp);
      finish = true;
    } else target = snapPoint(wp);
    if (dist(target, last) < 1e-6) {
      if (isDouble && pd.points.length >= 2) {
        finishTrack(pd.points, pd.layer!, pd.width!);
        s.patch({ pending: null, highlightNet: null });
        s.setMessage('Дорожка проведена.');
      }
      return;
    }
    const pts = [...pd.points, ...this.cornerPoints(last, target)];
    if (finish || isDouble) {
      finishTrack(pts, pd.layer!, pd.width!);
      const n = netAtPoint(this.S.project, target, pd.layer!);
      if (pd.net && n && n !== pd.net) s.setMessage('Внимание: дорожка соединяет разные цепи — проверьте отметку ошибки.');
      else s.setMessage(finish && h?.pad ? 'Дорожка доведена до площадки.' : 'Дорожка проведена.');
      s.patch({ pending: null, highlightNet: null });
      return;
    }
    s.patch({ pending: { ...pd, points: pts, cursor: target } });
  }

  /**
   * Точка на оси дорожки под курсором: узел сетки, спроецированный на отрезок.
   * Иначе при крупной сетке или дорожке не по сетке новая дорожка её не касалась бы.
   */
  private pointOnTrack(h: Hit, wp: Vec2): Vec2 {
    const t = this.S.project.tracks[h.ref.id];
    const i = h.segment ?? 0;
    if (!t || i + 1 >= t.points.length) return snapPoint(wp);
    const a = t.points[i];
    const b = t.points[i + 1];
    const q = closestOnSegment(snapPoint(wp), a, b).q;
    return { x: +q.x.toFixed(4), y: +q.y.toFixed(4) };
  }

  /** V во время трассировки: переходное и переход на другой слой. */
  routeVia(): void {
    const s = this.S;
    const pd = s.pending;
    if (!pd || pd.kind !== 'route' || s.project.board.copperLayers === 1) return;
    const last = pd.cursor && pd.points.length ? pd.cursor : pd.points[pd.points.length - 1];
    const pts = pd.cursor && dist(pd.cursor, pd.points[pd.points.length - 1]) > 1e-6 ? [...pd.points, ...this.cornerPoints(pd.points[pd.points.length - 1], pd.cursor)] : pd.points;
    const other: CopperLayer = pd.layer === 'F.Cu' ? 'B.Cu' : 'F.Cu';
    const sz = viaSizeFor(pd.net ?? null);
    s.commit((d) => {
      if (pts.length >= 2) {
        const clean = pts.filter((q, i) => i === 0 || dist(q, pts[i - 1]) > 1e-6);
        if (clean.length >= 2) d.tracks[`t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`] = { id: '', layer: pd.layer!, width: pd.width!, points: clean } as never;
        for (const [id, t] of Object.entries(d.tracks)) if (!t.id) t.id = id;
      }
      const id = `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      d.vias[id] = { id, at: last, ...sz };
    });
    s.patch({ pending: { ...pd, points: [last], cursor: last, layer: other }, activeLayer: other });
    s.setMessage(`Переходное поставлено, продолжаем на слое ${other === 'F.Cu' ? 'верхней' : 'нижней'} меди.`);
  }

  private clickWire(wp: Vec2): void {
    const s = this.S;
    const h = this.hits(wp, true)[0];
    const q = h?.pad ? h.pad.center : h?.ref.kind === 'via' ? s.project.vias[h.ref.id].at : snapPoint(wp);
    const onPad = !!(h?.pad || h?.ref.kind === 'via');
    if (!s.pending || s.pending.kind !== 'wire') {
      s.patch({ pending: { kind: 'wire', points: [q], cursor: q, net: onPad ? (h!.pad?.net ?? null) : null }, highlightNet: h?.pad?.net ?? null });
      s.setMessage(onPad ? 'Теперь вторая площадка.' : 'Конец перемычки не на площадке — там появится площадка с отверстием. Теперь вторая точка.');
      return;
    }
    const a = s.pending.points[0];
    if (dist(a, q) < 1e-6) return;
    const needA = !this.pointOnCopperPad(a);
    placeWire(a, q, needA, !onPad);
    s.patch({ pending: null, highlightNet: null });
    s.setMessage('Перемычка добавлена.');
  }

  private pointOnCopperPad(q: Vec2): boolean {
    const w = getWorld(this.S.project);
    for (const wp of w.pads) if (wp.layers.length && dist(wp.center, q) < 1e-3) return true;
    for (const v of w.vias) if (dist(v.via.at, q) < 1e-3) return true;
    return false;
  }

  private clickPlace(wp: Vec2): void {
    const s = this.S;
    if (!s.placeFootprint) {
      s.setMessage('Сначала выберите корпус в библиотеке справа.');
      s.patch({ panelTab: 'library', panelOpen: true });
      return;
    }
    const fp = findFootprint(s.placeFootprint);
    if (!fp) return;
    const side = this.placeSideFor(fp);
    const id = placeComponent(fp, snapPoint(wp), this.placeRotation, side);
    this.S.select([{ kind: 'component', id }]);
    this.S.setMessage(`Поставлен ${this.S.project.components[id]?.ref}. Ещё щелчок — ещё один, Esc — закончить.`);
  }

  rotatePlacing(): boolean {
    if (this.S.tool !== 'place') return false;
    this.placeRotation = (this.placeRotation + 90) % 360;
    this.refreshGhost();
    return true;
  }

  /** F при установке: следующий компонент — на другую сторону. */
  flipPlacing(): boolean {
    if (this.S.tool !== 'place') return false;
    this.placeSide = this.placeSide === 'top' ? 'bottom' : 'top';
    this.refreshGhost();
    this.S.setMessage(this.placeSide === 'top' ? 'Ставим на верхнюю сторону.' : 'Ставим на нижнюю сторону.');
    return true;
  }

  private placeSideFor(fp: { pads: { type: string }[] }): 'top' | 'bottom' {
    const smd = fp.pads.every((pd) => pd.type !== 'tht');
    // На односторонней плате медь снизу: планарные детали паяются только туда.
    return this.S.project.board.copperLayers === 1 && smd ? 'bottom' : this.placeSide;
  }

  private ghostAt: Vec2 | null = null;
  private updateGhost(wp: Vec2): void {
    this.ghostAt = snapPoint(wp);
    this.refreshGhost();
  }
  private refreshGhost(): void {
    const s = this.S;
    if (s.tool !== 'place' || !s.placeFootprint || !this.ghostAt) {
      if (s.ghost) s.patch({ ghost: null });
      return;
    }
    const fp = findFootprint(s.placeFootprint);
    if (!fp) return;
    const g = s.ghost;
    const side = this.placeSideFor(fp);
    if (g && g.def === fp && g.at.x === this.ghostAt.x && g.at.y === this.ghostAt.y && g.rotation === this.placeRotation && g.side === side) return;
    s.patch({ ghost: { footprint: fp.id, def: fp, at: this.ghostAt, rotation: this.placeRotation, side } });
  }
  hideGhost(): void {
    this.ghostAt = null;
    this.pointerWorld = null;
    if (this.S.ghost) this.S.patch({ ghost: null });
  }

  /** Размер: два щелчка — концы, третий — на каком расстоянии провести размерную линию. */
  private clickDimension(q: Vec2): void {
    const s = this.S;
    const pts = s.pending?.kind === 'poly' ? s.pending.points : [];
    if (pts.length < 2) {
      if (pts.length === 1 && dist(pts[0], q) < 1e-6) return;
      s.patch({ pending: { kind: 'poly', points: [...pts, q], cursor: q } });
      s.setMessage(pts.length ? 'Теперь щелчок сбоку — где провести размерную линию.' : 'Размер: второй конец.');
      return;
    }
    const [a, b] = pts;
    const L = dist(a, b);
    const u = { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
    // Смещение со знаком: проекция на левую нормаль к a→b.
    const offset = +((q.x - a.x) * u.y - (q.y - a.y) * u.x).toFixed(3);
    s.commit((d) => {
      addDrawing(d, { kind: 'dimension', layer: 'F.Fab', a, b, offset: Math.abs(offset) < 0.5 ? 2 : offset, width: 0.12, size: 1.2 });
    });
    s.patch({ pending: null });
    s.setMessage(`Размер ${L.toFixed(2).replace('.', ',')} мм поставлен на сборочный слой. Смещение и высота цифр — в свойствах.`);
  }

  private clickTwoPoint(wp: Vec2): void {
    const s = this.S;
    const q = snapPoint(wp);
    if (!s.pending) {
      s.patch({ pending: { kind: 'poly', points: [q], cursor: q } });
      return;
    }
    const a = s.pending.points[0];
    if (dist(a, q) < 1e-6) return;
    const layer = s.drawLayer;
    const width = s.drawWidth;
    s.commit((d) => {
      if (s.tool === 'line') addDrawing(d, { kind: 'line', layer, a, b: q, width });
      else if (s.tool === 'rect') addDrawing(d, { kind: 'rect', layer, a, b: q, width });
      else addDrawing(d, { kind: 'circle', layer, c: a, r: +dist(a, q).toFixed(3), width });
    });
    s.patch({ pending: null });
  }

  private clickPoly(wp: Vec2, isDouble: boolean): void {
    const s = this.S;
    const q = snapPoint(wp);
    if (!s.pending) {
      s.patch({ pending: { kind: 'poly', points: [q], cursor: q } });
      return;
    }
    const pts = s.pending.points;
    const closeIt = isDouble || (pts.length >= 3 && dist(q, pts[0]) < this.tol());
    if (closeIt) {
      const poly = pts.filter((p, i) => i === 0 || dist(p, pts[i - 1]) > 1e-6);
      if (poly.length < 3) {
        s.patch({ pending: null });
        return;
      }
      this.finishPoly(poly);
      return;
    }
    if (dist(q, pts[pts.length - 1]) < 1e-6) return;
    s.patch({ pending: { ...s.pending, points: [...pts, q], cursor: q } });
  }

  private finishPoly(poly: Vec2[]): void {
    const s = this.S;
    const tool: ToolId = s.tool;
    let zoneNet: string | null = null;
    let zoneId: string | null = null;
    s.commit((d) => {
      if (tool === 'poly') addDrawing(d, { kind: 'poly', layer: s.drawLayer, pts: poly, width: s.drawWidth, closed: true });
      else if (tool === 'zone') {
        const cls = d.netClasses.Default ?? Object.values(d.netClasses)[0];
        const layers = boardCopperLayers(d.board.copperLayers);
        const layer = layers.includes(s.activeLayer) ? s.activeLayer : layers[0];
        // Обычно полигоном заливают землю: если такая цепь есть, сразу назначаем её.
        const gnd = Object.values(d.nets).find((n) => /^(gnd|agnd|dgnd|pgnd|земля|0v|vss)$/i.test(n.name));
        zoneNet = gnd?.name ?? null;
        zoneId = addZone(d, { layer, net: gnd?.id ?? null, outline: poly, clearance: Math.max(cls.clearance, 0.3), minWidth: cls.trackWidth, priority: 0 }).id;
      } else if (tool === 'keepout') addRuleArea(d, { name: 'Область', outline: poly, keepoutTracks: true, keepoutVias: true, showLabel: true });
      else if (tool === 'outline') {
        d.board.outline = poly;
        d.board.cornerRadius = 0;
      }
    });
    s.patch(zoneId ? { pending: null, selection: [{ kind: 'zone', id: zoneId }], panelTab: 'props' } : { pending: null });
    if (tool === 'zone')
      s.setMessage(zoneNet ? `Полигон залит цепью ${zoneNet}: обходит чужие цепи с зазором. Цепь, зазор и приоритет — в свойствах.` : 'Полигон добавлен. Назначьте ему цепь в свойствах — без цепи заливка ни к чему не подключена.');
    else if (tool === 'keepout') s.setMessage('Область добавлена: задайте имя и ограничения в свойствах.');
    else if (tool === 'outline') s.setMessage('Контур платы заменён.');
  }

  cancelPending(): void {
    const s = this.S;
    if (s.pending) {
      s.patch({ pending: null, highlightNet: null });
      s.setMessage('Отменено.');
    } else if (s.tool !== 'select') s.setTool('select');
    else s.patch({ selection: [], highlightNet: null });
  }

  /** Backspace при трассировке: убрать последний изгиб. */
  undoPoint(): boolean {
    const s = this.S;
    if (!s.pending || s.pending.kind === 'box') return false;
    if (s.pending.points.length > 1) s.patch({ pending: { ...s.pending, points: s.pending.points.slice(0, -1) } });
    else s.patch({ pending: null, highlightNet: null });
    return true;
  }

  private boxSelect(a: Vec2, b: Vec2, add: boolean): void {
    const s = this.S;
    const box = boxOfPoints([a, b]);
    const p = s.project;
    const w = getWorld(p);
    const inside = (q: Vec2) => q.x >= box.minX && q.x <= box.maxX && q.y >= box.minY && q.y <= box.maxY;
    const sel: ItemRef[] = [];
    for (const wc of w.components) if (wc.outline.every(inside)) sel.push({ kind: 'component', id: wc.component.id });
    for (const t of Object.values(p.tracks)) if (s.layerVisible[t.layer] && t.points.every(inside)) sel.push({ kind: 'track', id: t.id });
    for (const v of Object.values(p.vias)) if (inside(v.at)) sel.push({ kind: 'via', id: v.id });
    for (const wr of Object.values(p.wires)) if (inside(wr.a) && inside(wr.b)) sel.push({ kind: 'wire', id: wr.id });
    for (const d of Object.values(p.drawings)) {
      const pts = d.kind === 'line' || d.kind === 'rect' || d.kind === 'dimension' ? [d.a, d.b] : d.kind === 'poly' ? d.pts : d.kind === 'text' ? [d.at] : [d.c];
      if (s.layerVisible[d.layer] && pts.every(inside)) sel.push({ kind: 'drawing', id: d.id });
    }
    for (const z of Object.values(p.zones)) if (s.layerVisible[z.layer] && z.outline.every(inside)) sel.push({ kind: 'zone', id: z.id });
    for (const ra of Object.values(p.ruleAreas)) if (ra.outline.every(inside)) sel.push({ kind: 'ruleArea', id: ra.id });
    s.select(sel, add);
    s.setMessage(sel.length ? `Выделено объектов: ${sel.length}.` : 'В рамке ничего нет.');
  }

  private showHitInfo(h: Hit): void {
    const s = this.S;
    const p = s.project;
    if (h.pad) {
      const net = h.pad.net ? p.nets[h.pad.net] : null;
      const nm = h.pad.pad.name && h.pad.pad.name !== h.pad.pad.number ? `${h.pad.pad.number} (${h.pad.pad.name})` : h.pad.pad.number;
      s.patch({ highlightNet: h.pad.net ?? null, message: net ? `${h.pad.component.ref}, вывод ${nm}: цепь ${net.name}${net.description ? ' — ' + net.description : ''}.` : `${h.pad.component.ref}, вывод ${nm}: без цепи. Двойной щелчок по компоненту — назначить цепи.` });
      return;
    }
    if (h.ref.kind === 'track' || h.ref.kind === 'via' || h.ref.kind === 'wire') {
      const netId = netAtPoint(p, h.ref.kind === 'via' ? p.vias[h.ref.id].at : h.ref.kind === 'wire' ? p.wires[h.ref.id].a : p.tracks[h.ref.id].points[0], h.ref.kind === 'track' ? p.tracks[h.ref.id].layer : null);
      const net = netId ? p.nets[netId] : null;
      const kind = h.ref.kind === 'track' ? 'Дорожка' : h.ref.kind === 'via' ? 'Переходное' : 'Перемычка';
      s.patch({ highlightNet: netId, message: `${kind}${net ? `, цепь ${net.name}` : ', без цепи'}. Свойства справа.` });
      return;
    }
    if (h.ref.kind === 'component') {
      const c = p.components[h.ref.id];
      s.patch({ highlightNet: null, message: `${c.ref} ${c.value}${c.description ? ' — ' + c.description : ''}. R — повернуть, F — на другую сторону, двойной щелчок — свойства.` });
    }
  }

  private pointsOf(p: Project, ref: ItemRef): Vec2[] {
    if (ref.kind === 'track') return p.tracks[ref.id].points.map((q) => ({ ...q }));
    if (ref.kind === 'ruleArea') return p.ruleAreas[ref.id].outline.map((q) => ({ ...q }));
    if (ref.kind === 'zone') return p.zones[ref.id].outline.map((q) => ({ ...q }));
    return [];
  }
  private pointsOfDraft(d: Project, ref: ItemRef): Vec2[] | null {
    if (ref.kind === 'track') return d.tracks[ref.id]?.points ?? null;
    if (ref.kind === 'ruleArea') return d.ruleAreas[ref.id]?.outline ?? null;
    if (ref.kind === 'zone') return d.zones[ref.id]?.outline ?? null;
    return null;
  }
}

/** Возвращает объект к состоянию из base перед повторным сдвигом. */
function restoreItem(draft: Project, base: Project, r: ItemRef): void {
  switch (r.kind) {
    case 'component':
      if (base.components[r.id] && draft.components[r.id]) {
        draft.components[r.id].at = { ...base.components[r.id].at };
      }
      break;
    case 'track':
      if (base.tracks[r.id] && draft.tracks[r.id]) draft.tracks[r.id].points = base.tracks[r.id].points.map((q) => ({ ...q }));
      break;
    case 'via':
      if (base.vias[r.id] && draft.vias[r.id]) draft.vias[r.id].at = { ...base.vias[r.id].at };
      break;
    case 'wire':
      if (base.wires[r.id] && draft.wires[r.id]) {
        draft.wires[r.id].a = { ...base.wires[r.id].a };
        draft.wires[r.id].b = { ...base.wires[r.id].b };
      }
      break;
    case 'zone':
      if (base.zones[r.id] && draft.zones[r.id]) draft.zones[r.id].outline = base.zones[r.id].outline.map((q) => ({ ...q }));
      break;
    case 'ruleArea':
      if (base.ruleAreas[r.id] && draft.ruleAreas[r.id]) draft.ruleAreas[r.id].outline = base.ruleAreas[r.id].outline.map((q) => ({ ...q }));
      break;
    case 'drawing':
      if (base.drawings[r.id] && draft.drawings[r.id]) draft.drawings[r.id] = structuredClone(base.drawings[r.id]);
      break;
  }
}


