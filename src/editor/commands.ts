import { normAngle, type Vec2 } from '@core/math/vec';
import { newId, nextRef } from '@core/ids';
import { addComponent, addTrack, addVia, addWire, changeFootprint as changeFp, pruneFootprints, removeComponent } from '@core/model/edit';
import { otherCopper } from '@core/model/layers';
import { netClassOf } from '@core/model/rules';
import type { Component, Drawing, FootprintDef, ItemRef, Project, RuleArea, Side, Track, Via, Wire, Zone } from '@core/model/types';
import { computeConnectivity } from '@core/model/connectivity';
import { groupOf, pruneGroups } from '@core/model/groups';
import { getWorld } from '@core/model/world';
import { boxOfPoints, type Box } from '@core/math/geom';
import { snapTo } from '@core/units';
import { applyFollow, planFollow } from '@core/model/follow';
import { applyLayerMove, planLayerMove, type LayerMovePlan, type LayerTarget } from '@core/model/layer-move';
import { LAYERS } from '@core/model/layers';
import { useEditor } from './store';

/* Команды редактора: работают через store.commit и знают про выделение. */

const S = () => useEditor.getState();

/**
 * Правка с дорожками за компонентами: концы на площадках переносимых деталей
 * едут вместе с ними (если это включено). translate — общий сдвиг всего выделенного.
 */
export function commitFollowing(sel: ItemRef[], fn: (d: Project) => void, translate?: Vec2): void {
  const s = S();
  const base = s.project;
  const plan = s.followTracks ? planFollow(base, sel) : null;
  s.commit((d) => {
    fn(d);
    if (plan) applyFollow(d, base, plan, { translate });
  });
}

export function deleteSelection(): void {
  const s = S();
  if (!s.selection.length) return;
  const n = s.selection.length;
  s.commit((d) => {
    for (const r of s.selection) {
      if (r.kind === 'component') removeComponent(d, r.id);
      else if (r.kind === 'track') delete d.tracks[r.id];
      else if (r.kind === 'via') delete d.vias[r.id];
      else if (r.kind === 'wire') delete d.wires[r.id];
      else if (r.kind === 'zone') delete d.zones[r.id];
      else if (r.kind === 'ruleArea') delete d.ruleAreas[r.id];
      else if (r.kind === 'drawing') delete d.drawings[r.id];
    }
    pruneFootprints(d);
    pruneGroups(d);
  });
  s.patch({ selection: [], message: n === 1 ? 'Удалено.' : `Удалено объектов: ${n}.` });
}

/** Центр выделения — вокруг него вращаем группу. */
export function selectionCenter(p: Project, sel: ItemRef[]): Vec2 | null {
  const pts: Vec2[] = [];
  for (const r of sel) {
    if (r.kind === 'component' && p.components[r.id]) pts.push(p.components[r.id].at);
    else if (r.kind === 'via' && p.vias[r.id]) pts.push(p.vias[r.id].at);
    else if (r.kind === 'track' && p.tracks[r.id]) pts.push(...p.tracks[r.id].points);
    else if (r.kind === 'wire' && p.wires[r.id]) pts.push(p.wires[r.id].a, p.wires[r.id].b);
    else if (r.kind === 'drawing' && p.drawings[r.id]) pts.push(...drawingPoints(p.drawings[r.id]));
    else if (r.kind === 'zone' && p.zones[r.id]) pts.push(...p.zones[r.id].outline);
    else if (r.kind === 'ruleArea' && p.ruleAreas[r.id]) pts.push(...p.ruleAreas[r.id].outline);
  }
  if (!pts.length) return null;
  const xs = pts.map((q) => q.x);
  const ys = pts.map((q) => q.y);
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
}

function drawingPoints(d: Project['drawings'][string]): Vec2[] {
  switch (d.kind) {
    case 'line':
    case 'rect':
    case 'dimension':
      return [d.a, d.b];
    case 'circle':
    case 'arc':
      return [d.c];
    case 'poly':
      return d.pts;
    case 'text':
      return [d.at];
  }
}

export function rotateSelection(deg: number): void {
  const s = S();
  if (!s.selection.length) return;
  const c = selectionCenter(s.project, s.selection);
  if (!c) return;
  // Один компонент, надпись или переходное вращаются на месте; дорожка, линия, контур — вокруг своего центра.
  const r0 = s.selection[0];
  const d0 = r0.kind === 'drawing' ? s.project.drawings[r0.id] : null;
  const single = s.selection.length === 1 && (r0.kind === 'component' || r0.kind === 'via' || d0?.kind === 'text' || d0?.kind === 'circle');
  const rot = (q: Vec2): Vec2 => {
    if (single) return q;
    const r = (deg * Math.PI) / 180;
    const dx = q.x - c.x;
    const dy = q.y - c.y;
    return { x: +(c.x + dx * Math.cos(r) + dy * Math.sin(r)).toFixed(4), y: +(c.y - dx * Math.sin(r) + dy * Math.cos(r)).toFixed(4) };
  };
  commitFollowing(s.selection, (d) => moveItems(d, s.selection, rot, (a) => normAngle(a + deg)));
}

/** Сообщение по итогам переноса между слоями. */
export function layerMoveMessage(plan: LayerMovePlan, to?: string): string {
  const parts = [`Перенесено объектов: ${plan.moves.length}${to ? ` на «${to}»` : ''}.`];
  if (plan.vias.length) parts.push(`Поставлено переходных на стыках: ${plan.vias.length}.`);
  if (plan.broken.length) parts.push(`Концов на планарных площадках прежнего слоя: ${plan.broken.length} — там появятся воздушные линии.`);
  if (plan.skipped) parts.push(`Нельзя перенести: ${plan.skipped} (медь — только на медь платы, надписи — не на контур).`);
  return parts.join(' ');
}

/** Выделенное (кроме компонентов) — на другой слой. */
export function moveSelectionToLayer(target: LayerTarget): LayerMovePlan | null {
  const s = S();
  const refs = s.selection.filter((r) => r.kind !== 'component');
  if (!refs.length) return null;
  const plan = planLayerMove(s.project, refs, target);
  if (plan.moves.length) s.commit((d) => applyLayerMove(d, plan));
  s.setMessage(plan.moves.length ? layerMoveMessage(plan, target === 'flip' ? undefined : LAYERS[target].name) : plan.skipped ? layerMoveMessage(plan) : 'Выделенное уже на этом слое.');
  return plan;
}

/** F: компоненты — на другую сторону платы, дорожки, полигоны и графика — на парный слой. */
export function flipSelection(): void {
  const s = S();
  const comps = s.selection.filter((r) => r.kind === 'component');
  const others = s.selection.filter((r) => r.kind === 'track' || r.kind === 'zone' || r.kind === 'drawing');
  if (!comps.length && !others.length) {
    s.setMessage('На другую сторону переносятся компоненты, дорожки, полигоны и графика: выберите их.');
    return;
  }
  const plan = others.length ? planLayerMove(s.project, others, 'flip') : null;
  if (comps.length && s.project.board.copperLayers === 1) {
    s.setMessage('Плата односторонняя: планарные детали и так стоят со стороны меди, выводные — сверху.');
  }
  s.commit((d) => {
    for (const r of comps) {
      const c = d.components[r.id];
      if (!c) continue;
      const fp = d.footprints[c.footprint];
      const smd = fp && fp.pads.every((pd) => pd.type !== 'tht');
      if (d.board.copperLayers === 1 && smd && c.side === 'bottom') continue;
      c.side = c.side === 'top' ? 'bottom' : ('top' as Side);
    }
    if (plan) applyLayerMove(d, plan);
  });
  if (plan && (plan.moves.length || plan.skipped)) s.setMessage(layerMoveMessage(plan));
}

/** Двигает объекты: map — преобразование точки, rot — новый угол компонента. */
export function moveItems(d: Project, sel: ItemRef[], map: (q: Vec2) => Vec2, rot?: (a: number) => number): void {
  for (const r of sel) {
    if (r.kind === 'component') {
      const c = d.components[r.id];
      if (!c || c.locked) continue;
      c.at = map(c.at);
      if (rot) c.rotation = rot(c.rotation);
    } else if (r.kind === 'track') {
      const t = d.tracks[r.id];
      if (!t || t.locked) continue;
      t.points = t.points.map(map);
    } else if (r.kind === 'via') {
      const v = d.vias[r.id];
      if (!v || v.locked) continue;
      v.at = map(v.at);
    } else if (r.kind === 'wire') {
      const w = d.wires[r.id];
      if (!w) continue;
      w.a = map(w.a);
      w.b = map(w.b);
    } else if (r.kind === 'zone') {
      const z = d.zones[r.id];
      if (z) z.outline = z.outline.map(map);
    } else if (r.kind === 'ruleArea') {
      const z = d.ruleAreas[r.id];
      if (z) z.outline = z.outline.map(map);
    } else if (r.kind === 'drawing') {
      const g = d.drawings[r.id];
      if (!g || g.locked) continue;
      if (g.kind === 'line' || g.kind === 'rect' || g.kind === 'dimension') {
        g.a = map(g.a);
        g.b = map(g.b);
      } else if (g.kind === 'circle' || g.kind === 'arc') g.c = map(g.c);
      else if (g.kind === 'poly') g.pts = g.pts.map(map);
      else if (g.kind === 'text') {
        g.at = map(g.at);
        if (rot) g.rotation = rot(g.rotation ?? 0);
      }
    }
  }
}

export function translateSelectionBy(dx: number, dy: number): void {
  const s = S();
  if (!s.selection.length) return;
  commitFollowing(s.selection, (d) => moveItems(d, s.selection, (q) => ({ x: +(q.x + dx).toFixed(4), y: +(q.y + dy).toFixed(4) })), { x: dx, y: dy });
}

export function selectAll(): void {
  const s = S();
  const p = s.project;
  const sel: ItemRef[] = [
    ...Object.keys(p.components).map((id) => ({ kind: 'component', id }) as ItemRef),
    ...Object.keys(p.tracks).map((id) => ({ kind: 'track', id }) as ItemRef),
    ...Object.keys(p.vias).map((id) => ({ kind: 'via', id }) as ItemRef),
    ...Object.keys(p.wires).map((id) => ({ kind: 'wire', id }) as ItemRef),
    ...Object.keys(p.drawings).map((id) => ({ kind: 'drawing', id }) as ItemRef),
    ...Object.keys(p.zones).map((id) => ({ kind: 'zone', id }) as ItemRef),
    ...Object.keys(p.ruleAreas).map((id) => ({ kind: 'ruleArea', id }) as ItemRef),
  ];
  s.select(sel);
}

export function placeComponent(fp: FootprintDef, at: Vec2, rotation: number, side: Side): string {
  let id = '';
  S().commit((d) => {
    const c = addComponent(d, fp, at, { rotation, side, value: fp.refPrefix === 'R' || fp.refPrefix === 'C' ? '' : fp.name });
    id = c.id;
  });
  return id;
}

export function changeFootprint(componentId: string, fp: FootprintDef): boolean {
  let ok = false;
  S().commit((d) => {
    ok = changeFp(d, componentId, fp);
    pruneFootprints(d);
  });
  return ok;
}

/** Ширина дорожки для точки: по классу цепи или ручная. */
export function routeWidthFor(netId: string | null): number {
  const s = S();
  if (s.routeWidth !== 'auto') return s.routeWidth;
  return Math.max(netClassOf(s.project, netId).trackWidth, s.project.rules.minTrackWidth);
}

export function viaSizeFor(netId: string | null): { diameter: number; drill: number } {
  const p = S().project;
  const c = netClassOf(p, netId);
  return { diameter: Math.max(c.viaDiameter, p.rules.minViaDiameter), drill: Math.max(c.viaDrill, p.rules.minViaDrill) };
}

export function finishTrack(points: Vec2[], layer: Project['tracks'][string]['layer'], width: number): void {
  const clean = points.filter((q, i) => i === 0 || Math.hypot(q.x - points[i - 1].x, q.y - points[i - 1].y) > 1e-6);
  if (clean.length < 2) return;
  S().commit((d) => {
    addTrack(d, { layer, width, points: clean });
  });
}

export function placeVia(at: Vec2, netId: string | null): void {
  const sz = viaSizeFor(netId);
  S().commit((d) => {
    addVia(d, { at, ...sz });
  });
}

export function placeWire(a: Vec2, b: Vec2, needViaA: boolean, needViaB: boolean): void {
  const sz = viaSizeFor(null);
  S().commit((d) => {
    if (needViaA) addVia(d, { at: a, ...sz });
    if (needViaB) addVia(d, { at: b, ...sz });
    addWire(d, a, b);
  });
}

export function snapPoint(q: Vec2): Vec2 {
  const s = S();
  if (!s.snap) return { x: +q.x.toFixed(4), y: +q.y.toFixed(4) };
  return { x: snapTo(q.x, s.grid), y: snapTo(q.y, s.grid) };
}

export function toggleActiveLayer(): void {
  const s = S();
  if (s.project.board.copperLayers === 1) return;
  s.patch({ activeLayer: otherCopper(s.activeLayer) });
}

/** Цепи выделенных дорожек/площадок — для подсветки. */
export function netOfSelection(): string | null {
  const s = S();
  const conn = computeConnectivity(s.project);
  for (const r of s.selection) {
    if (r.kind === 'track' || r.kind === 'via' || r.kind === 'wire') {
      const n = conn.itemNet.get(r.id);
      if (n && n !== 'short') return n;
    }
  }
  return null;
}

/** Новое обозначение компонента: пустое и уже занятое не принимаем. */
export function renameComponent(id: string, ref: string): boolean {
  const s = S();
  const r = ref.trim();
  const c = s.project.components[id];
  if (!c || !r || r === c.ref) return false;
  const other = Object.values(s.project.components).find((x) => x.id !== id && x.ref.toLowerCase() === r.toLowerCase());
  if (other) {
    s.setMessage(`Обозначение ${r} уже занято: так называется другой компонент.`);
    return false;
  }
  s.commit((d) => void (d.components[id] && (d.components[id].ref = r)));
  return true;
}

/** Новое имя цепи: пустое и уже занятое не принимаем. */
export function renameNetChecked(id: string, name: string): boolean {
  const s = S();
  const n = name.trim();
  const net = s.project.nets[id];
  if (!net || !n || n === net.name) return false;
  if (Object.values(s.project.nets).some((x) => x.id !== id && x.name === n)) {
    s.setMessage(`Цепь ${n} уже есть. Чтобы объединить цепи, назначьте выводам одно имя в свойствах компонента.`);
    return false;
  }
  s.commit((d) => void (d.nets[id] && (d.nets[id].name = n)));
  return true;
}

/* ---------------- буфер обмена ---------------- */

interface Clip {
  components: Component[];
  footprints: FootprintDef[];
  tracks: Track[];
  vias: Via[];
  wires: Wire[];
  drawings: Drawing[];
  zones: Zone[];
  ruleAreas: RuleArea[];
  center: Vec2;
  /** Сколько раз вставляли — каждая следующая копия без курсора сдвигается дальше. */
  pastes: number;
}
let clip: Clip | null = null;

export const hasClipboard = (): boolean => clip !== null;

/** Копирует выделенное в буфер редактора. */
export function copySelection(): number {
  const s = S();
  const p = s.project;
  const c: Clip = { components: [], footprints: [], tracks: [], vias: [], wires: [], drawings: [], zones: [], ruleAreas: [], center: { x: 0, y: 0 }, pastes: 0 };
  for (const r of s.selection) {
    if (r.kind === 'component' && p.components[r.id]) {
      const comp = p.components[r.id];
      c.components.push(structuredClone(comp));
      const fp = p.footprints[comp.footprint];
      if (fp && !c.footprints.some((f) => f.id === fp.id)) c.footprints.push(fp);
    } else if (r.kind === 'track' && p.tracks[r.id]) c.tracks.push(structuredClone(p.tracks[r.id]));
    else if (r.kind === 'via' && p.vias[r.id]) c.vias.push(structuredClone(p.vias[r.id]));
    else if (r.kind === 'wire' && p.wires[r.id]) c.wires.push(structuredClone(p.wires[r.id]));
    else if (r.kind === 'drawing' && p.drawings[r.id]) c.drawings.push(structuredClone(p.drawings[r.id]));
    else if (r.kind === 'zone' && p.zones[r.id]) c.zones.push(structuredClone(p.zones[r.id]));
    else if (r.kind === 'ruleArea' && p.ruleAreas[r.id]) c.ruleAreas.push(structuredClone(p.ruleAreas[r.id]));
  }
  const n = c.components.length + c.tracks.length + c.vias.length + c.wires.length + c.drawings.length + c.zones.length + c.ruleAreas.length;
  if (!n) {
    s.setMessage('Нечего копировать: сначала выделите объекты.');
    return 0;
  }
  c.center = selectionCenter(p, s.selection) ?? { x: 0, y: 0 };
  clip = c;
  s.setMessage(`Скопировано объектов: ${n}. Ctrl+V — вставить под курсор.`);
  return n;
}

export function cutSelection(): void {
  if (copySelection()) {
    const n = S().selection.length;
    deleteSelection();
    S().setMessage(`Вырезано объектов: ${n}. Ctrl+V — вставить под курсор.`);
  }
}

/**
 * Вставляет копию буфера: центр копии — в точку at (курсор), без неё — со сдвигом от оригинала.
 * Компоненты получают свободные обозначения, цепи выводов сохраняются.
 */
export function pasteClipboard(at?: Vec2 | null): void {
  const s = S();
  if (!clip) {
    s.setMessage('Буфер пуст: выделите объекты и нажмите Ctrl+C.');
    return;
  }
  const c = clip;
  c.pastes++;
  const step = Math.max(s.grid, 1.27) * 2;
  const target = at ? snapPoint(at) : { x: c.center.x + step * c.pastes, y: c.center.y + step * c.pastes };
  const off = snapPoint({ x: target.x - c.center.x, y: target.y - c.center.y });
  const refs: ItemRef[] = [];
  s.commit((d) => {
    for (const fp of c.footprints) if (!d.footprints[fp.id]) d.footprints[fp.id] = fp;
    const used = Object.values(d.components).map((x) => x.ref);
    for (const src of c.components) {
      const prefix = /^[A-Za-z_]+/.exec(src.ref)?.[0] ?? d.footprints[src.footprint]?.refPrefix ?? 'X';
      const ref = nextRef(prefix, used);
      used.push(ref);
      const comp: Component = { ...structuredClone(src), id: newId('c'), ref, locked: undefined, padNets: Object.fromEntries(Object.entries(src.padNets).filter(([, n]) => d.nets[n])) };
      d.components[comp.id] = comp;
      refs.push({ kind: 'component', id: comp.id });
    }
    const put = <T extends { id: string }>(list: T[], coll: Record<string, T>, prefix: string, kind: ItemRef['kind']) => {
      for (const src of list) {
        const x = { ...structuredClone(src), id: newId(prefix) } as T & { locked?: boolean };
        delete x.locked;
        coll[x.id] = x;
        refs.push({ kind, id: x.id });
      }
    };
    put(c.tracks, d.tracks, 't', 'track');
    put(c.vias, d.vias, 'v', 'via');
    put(c.wires, d.wires, 'w', 'wire');
    put(c.drawings, d.drawings, 'g', 'drawing');
    put(
      c.zones.map((z) => ({ ...z, net: z.net && d.nets[z.net] ? z.net : null })),
      d.zones,
      'z',
      'zone',
    );
    put(c.ruleAreas, d.ruleAreas, 'a', 'ruleArea');
    moveItems(d, refs, (q) => ({ x: +(q.x + off.x).toFixed(4), y: +(q.y + off.y).toFixed(4) }));
  });
  s.select(refs);
  s.setMessage(`Вставлено объектов: ${refs.length}. Перетащите на место; R — повернуть.`);
}

/** Ctrl+D: копия выделенного рядом с оригиналом. */
export function duplicateSelection(): void {
  if (copySelection()) pasteClipboard(null);
}

/* ---------------- выравнивание, распределение, группы ---------------- */

function itemBox(p: Project, r: ItemRef): Box | null {
  switch (r.kind) {
    case 'component': {
      const wc = getWorld(p).componentById.get(r.id);
      return wc ? boxOfPoints(wc.outline) : null;
    }
    case 'via': {
      const v = p.vias[r.id];
      return v ? boxOfPoints([v.at], v.diameter / 2) : null;
    }
    case 'track': {
      const t = p.tracks[r.id];
      return t ? boxOfPoints(t.points, t.width / 2) : null;
    }
    case 'wire': {
      const w = p.wires[r.id];
      return w ? boxOfPoints([w.a, w.b]) : null;
    }
    case 'drawing': {
      const g = p.drawings[r.id];
      return g ? boxOfPoints(drawingPoints(g)) : null;
    }
    case 'zone':
      return p.zones[r.id] ? boxOfPoints(p.zones[r.id].outline) : null;
    case 'ruleArea':
      return p.ruleAreas[r.id] ? boxOfPoints(p.ruleAreas[r.id].outline) : null;
  }
}

type Unit = { refs: ItemRef[]; box: Box };

/** Единицы выравнивания: группа целиком — одна единица, остальное поштучно. */
function selectionUnits(p: Project, sel: ItemRef[]): Unit[] {
  const done = new Set<string>();
  const units: Unit[] = [];
  for (const r of sel) {
    const k = r.kind + ':' + r.id;
    if (done.has(k)) continue;
    const g = groupOf(p, r);
    const refs = g ? g.members.filter((m) => sel.some((x) => x.kind === m.kind && x.id === m.id)) : [r];
    for (const m of refs) done.add(m.kind + ':' + m.id);
    const boxes = refs.map((m) => itemBox(p, m)).filter((b): b is Box => !!b);
    if (!boxes.length) continue;
    units.push({ refs, box: boxOfPoints(boxes.flatMap((b) => [{ x: b.minX, y: b.minY }, { x: b.maxX, y: b.maxY }])) });
  }
  return units;
}

export type AlignMode = 'left' | 'right' | 'top' | 'bottom' | 'hcenter' | 'vcenter';

/** Выравнивает выделенное по краю или центру общего габарита. */
export function alignSelection(mode: AlignMode): void {
  const s = S();
  const units = selectionUnits(s.project, s.selection);
  if (units.length < 2) {
    s.setMessage('Выровнять можно два объекта и больше: выделите их рамкой или с Shift.');
    return;
  }
  const minX = Math.min(...units.map((u) => u.box.minX));
  const maxX = Math.max(...units.map((u) => u.box.maxX));
  const minY = Math.min(...units.map((u) => u.box.minY));
  const maxY = Math.max(...units.map((u) => u.box.maxY));
  commitFollowing(s.selection, (d) => {
    for (const u of units) {
      const b = u.box;
      const dx = mode === 'left' ? minX - b.minX : mode === 'right' ? maxX - b.maxX : mode === 'hcenter' ? (minX + maxX) / 2 - (b.minX + b.maxX) / 2 : 0;
      const dy = mode === 'top' ? minY - b.minY : mode === 'bottom' ? maxY - b.maxY : mode === 'vcenter' ? (minY + maxY) / 2 - (b.minY + b.maxY) / 2 : 0;
      if (Math.abs(dx) > 1e-9 || Math.abs(dy) > 1e-9) moveItems(d, u.refs, (q) => ({ x: +(q.x + dx).toFixed(4), y: +(q.y + dy).toFixed(4) }));
    }
  });
}

/** Распределяет выделенное с равными промежутками по горизонтали или вертикали. */
export function distributeSelection(axis: 'h' | 'v'): void {
  const s = S();
  const units = selectionUnits(s.project, s.selection);
  if (units.length < 3) {
    s.setMessage('Распределить можно три объекта и больше.');
    return;
  }
  const lo = (u: Unit) => (axis === 'h' ? u.box.minX : u.box.minY);
  const hi = (u: Unit) => (axis === 'h' ? u.box.maxX : u.box.maxY);
  units.sort((a, b) => lo(a) + hi(a) - (lo(b) + hi(b)));
  const span = hi(units[units.length - 1]) - lo(units[0]);
  const total = units.reduce((a, u) => a + hi(u) - lo(u), 0);
  const gap = (span - total) / (units.length - 1);
  commitFollowing(s.selection, (d) => {
    let pos = lo(units[0]);
    for (const u of units) {
      const shift = pos - lo(u);
      if (Math.abs(shift) > 1e-9) moveItems(d, u.refs, (q) => (axis === 'h' ? { x: +(q.x + shift).toFixed(4), y: q.y } : { x: q.x, y: +(q.y + shift).toFixed(4) }));
      pos += hi(u) - lo(u) + gap;
    }
  });
  s.setMessage(gap < 0 ? 'Распределено, но объекты перекрываются: места мало.' : `Промежутки выровнены: ${gap.toFixed(2).replace('.', ',')} мм.`);
}

/** Ctrl+G: объединить выделенное в группу. */
export function groupSelection(): void {
  const s = S();
  if (s.selection.length < 2) {
    s.setMessage('В группу объединяют два объекта и больше.');
    return;
  }
  const members = [...s.selection];
  let name = '';
  s.commit((d) => {
    d.groups ??= {};
    // Объекты уходят из прежних групп.
    for (const g of Object.values(d.groups)) g.members = g.members.filter((m) => !members.some((x) => x.kind === m.kind && x.id === m.id));
    pruneGroups(d);
    const id = newId('grp');
    name = `Группа ${Object.keys(d.groups).length + 1}`;
    d.groups[id] = { id, name, members };
  });
  s.setMessage(`${name}: объектов ${members.length}. Щелчок по любому выделяет всю группу; Ctrl+Shift+G — разгруппировать.`);
}

/** Ctrl+Shift+G: распустить группы выделенных объектов. */
export function ungroupSelection(): void {
  const s = S();
  const ids = new Set(s.selection.map((r) => groupOf(s.project, r)?.id).filter((x): x is string => !!x));
  if (!ids.size) {
    s.setMessage('Выделенное не входит в группы.');
    return;
  }
  s.commit((d) => {
    for (const id of ids) delete d.groups?.[id];
  });
  s.setMessage(`Разгруппировано: ${ids.size}.`);
}
