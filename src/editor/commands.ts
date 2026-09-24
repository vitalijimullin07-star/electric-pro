import { normAngle, type Vec2 } from '@core/math/vec';
import { newId, nextRef } from '@core/ids';
import { addComponent, addTrack, addVia, addWire, changeFootprint as changeFp, pruneFootprints, removeComponent } from '@core/model/edit';
import { otherCopper } from '@core/model/layers';
import { netClassOf } from '@core/model/rules';
import type { Component, Drawing, FootprintDef, ItemRef, Project, RuleArea, Side, Track, Via, Wire, Zone } from '@core/model/types';
import { computeConnectivity } from '@core/model/connectivity';
import { snapTo } from '@core/units';
import { useEditor } from './store';

/* Команды редактора: работают через store.commit и знают про выделение. */

const S = () => useEditor.getState();

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
  s.commit((d) => moveItems(d, s.selection, rot, (a) => normAngle(a + deg)));
}

export function flipSelection(): void {
  const s = S();
  const comps = s.selection.filter((r) => r.kind === 'component');
  if (!comps.length) {
    s.setMessage('На другую сторону переносятся компоненты: выберите компонент.');
    return;
  }
  if (s.project.board.copperLayers === 1) {
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
  });
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
      if (g.kind === 'line' || g.kind === 'rect') {
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
  s.commit((d) => moveItems(d, s.selection, (q) => ({ x: +(q.x + dx).toFixed(4), y: +(q.y + dy).toFixed(4) })));
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
