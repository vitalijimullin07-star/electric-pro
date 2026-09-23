import { newId, nextRef } from '../ids';
import type { Vec2 } from '../math/vec';
import { DEFAULT_CLASS } from './rules';
import type { Component, FootprintDef, Graphic, Id, Net, Project, Side, Track, Via, Wire, Zone, RuleArea, Drawing } from './types';

/*
 * Операции над проектом. Они меняют переданный объект — вызывать либо на свежем
 * проекте (шаблоны, импорт), либо внутри immer produce (редактор).
 */

export function ensureFootprint(p: Project, fp: FootprintDef): string {
  if (!p.footprints[fp.id]) p.footprints[fp.id] = fp;
  return fp.id;
}

export function addComponent(
  p: Project,
  fp: FootprintDef,
  at: Vec2,
  o: { rotation?: number; side?: Side; ref?: string; value?: string; description?: string; alternatives?: string[]; excludeFromBom?: boolean } = {},
): Component {
  ensureFootprint(p, fp);
  const used = Object.values(p.components).map((c) => c.ref);
  const c: Component = {
    id: newId('c'),
    ref: o.ref ?? nextRef(fp.refPrefix ?? 'X', used),
    value: o.value ?? '',
    description: o.description,
    footprint: fp.id,
    alternatives: o.alternatives,
    at: { x: at.x, y: at.y },
    rotation: o.rotation ?? 0,
    side: o.side ?? 'top',
    padNets: {},
    excludeFromBom: o.excludeFromBom || fp.category === 'Крепёж' || undefined,
  };
  p.components[c.id] = c;
  return c;
}

export function removeComponent(p: Project, id: Id): void {
  delete p.components[id];
}

export function findNetByName(p: Project, name: string): Net | undefined {
  return Object.values(p.nets).find((n) => n.name === name);
}

export function ensureNet(p: Project, name: string, o: { netClass?: string; description?: string } = {}): Net {
  const hit = findNetByName(p, name);
  if (hit) return hit;
  const n: Net = { id: newId('n'), name, description: o.description, netClass: o.netClass ?? DEFAULT_CLASS };
  p.nets[n.id] = n;
  return n;
}

export function connectPad(p: Project, componentId: Id, pad: string, netId: Id | null): void {
  const c = p.components[componentId];
  if (!c) return;
  if (netId) c.padNets[pad] = netId;
  else delete c.padNets[pad];
}

/** Удаляет цепь и отвязывает от неё все выводы и полигоны. Дорожки остаются (цепь у них считается по связности). */
export function removeNet(p: Project, netId: Id): void {
  delete p.nets[netId];
  for (const c of Object.values(p.components)) for (const k of Object.keys(c.padNets)) if (c.padNets[k] === netId) delete c.padNets[k];
  for (const z of Object.values(p.zones)) if (z.net === netId) z.net = null;
}

export function renameNet(p: Project, netId: Id, name: string): void {
  const n = p.nets[netId];
  if (n) n.name = name;
}

export function addTrack(p: Project, t: Omit<Track, 'id'>): Track {
  const track: Track = { id: newId('t'), ...t, points: t.points.map((q) => ({ x: q.x, y: q.y })) };
  p.tracks[track.id] = track;
  return track;
}

export function addVia(p: Project, v: Omit<Via, 'id'>): Via {
  const via: Via = { id: newId('v'), ...v, at: { x: v.at.x, y: v.at.y } };
  p.vias[via.id] = via;
  return via;
}

export function addWire(p: Project, a: Vec2, b: Vec2): Wire {
  const w: Wire = { id: newId('w'), a: { ...a }, b: { ...b } };
  p.wires[w.id] = w;
  return w;
}

export function addZone(p: Project, z: Omit<Zone, 'id'>): Zone {
  const zone: Zone = { id: newId('z'), ...z };
  p.zones[zone.id] = zone;
  return zone;
}

export function addRuleArea(p: Project, r: Omit<RuleArea, 'id'>): RuleArea {
  const ra: RuleArea = { id: newId('k'), ...r };
  p.ruleAreas[ra.id] = ra;
  return ra;
}

export function addDrawing(p: Project, d: Graphic & { locked?: boolean }): Drawing {
  const dr = { id: newId('g'), ...d } as Drawing;
  p.drawings[dr.id] = dr;
  return dr;
}

export function clearRouting(p: Project): void {
  p.tracks = {};
  p.vias = {};
  p.wires = {};
}

export function touch(p: Project): void {
  p.meta.modified = new Date().toISOString();
}

/** Меняет корпус компонента на другой с тем же набором выводов. */
export function changeFootprint(p: Project, componentId: Id, fp: FootprintDef): boolean {
  const c = p.components[componentId];
  if (!c) return false;
  const oldFp = p.footprints[c.footprint];
  if (oldFp) {
    const a = new Set(oldFp.pads.filter((x) => x.type !== 'npth').map((x) => x.number));
    const b = new Set(fp.pads.filter((x) => x.type !== 'npth').map((x) => x.number));
    for (const k of Object.keys(c.padNets)) if (a.has(k) && !b.has(k)) return false;
  }
  ensureFootprint(p, fp);
  c.footprint = fp.id;
  return true;
}

/** Убирает из проекта корпуса, которые больше никем не используются. */
export function pruneFootprints(p: Project): void {
  const used = new Set(Object.values(p.components).map((c) => c.footprint));
  for (const c of Object.values(p.components)) for (const a of c.alternatives ?? []) used.add(a);
  for (const id of Object.keys(p.footprints)) if (!used.has(id)) delete p.footprints[id];
}
