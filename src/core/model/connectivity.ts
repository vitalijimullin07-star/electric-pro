import { dist } from '../math/vec';
import type { Vec2 } from '../math/vec';
import { expandBox } from '../math/geom';
import { shapeContains, shapesTouch } from '../math/shape';
import { SpatialHash } from '../math/spatial-hash';
import { boardCopperLayers } from './layers';
import type { CopperLayer, Id, ItemRef, Project } from './types';
import { getWorld, type World, type WorldPad, type WorldSegment, type WorldVia } from './world';
import { fillZones, type ZoneFill } from './zone-fill';

/*
 * Связность: какие площадки, дорожки, переходные и перемычки соединены физически.
 * Считается геометрически: две медные фигуры на одном слое соединены, если
 * касаются. Переходное отверстие и выводная площадка есть на обоих слоях.
 */

export interface NetIsland {
  /** Ключи площадок, входящих в островок. */
  pads: string[];
  /** Точки, к которым можно подвести воздушную линию: центры площадок и переходных, вершины дорожек. */
  anchors: Vec2[];
}

export interface NetStatus {
  netId: Id;
  islands: NetIsland[];
  /** Площадок этой цепи всего. */
  padCount: number;
  /** Разведена ли цепь полностью. */
  complete: boolean;
}

export interface Short {
  nets: Id[];
  items: ItemRef[];
  at: Vec2;
}

export interface RatsLine {
  netId: Id;
  a: Vec2;
  b: Vec2;
}

export interface Connectivity {
  world: World;
  /** Цепь дорожки, переходного или перемычки: null — ни к чему не подключена, 'short' — соединяет разные цепи. */
  itemNet: Map<Id, Id | null | 'short'>;
  nets: Map<Id, NetStatus>;
  shorts: Short[];
  ratsnest: RatsLine[];
  /** Дорожки, переходные и перемычки, не касающиеся ни одной площадки. */
  dangling: ItemRef[];
  unrouted: number;
  total: number;
  /** Заливка полигонов (считается вместе со связностью: острова соединяют свою цепь). */
  zoneFills: ZoneFill[];
}

class UnionFind {
  private parent = new Map<string, string>();
  find(k: string): string {
    let root = k;
    for (;;) {
      const p = this.parent.get(root);
      if (p === undefined) {
        this.parent.set(root, root);
        break;
      }
      if (p === root) break;
      root = p;
    }
    // Сжатие пути.
    let cur = k;
    while (cur !== root) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }
  union(a: string, b: string): void {
    const x = this.find(a);
    const y = this.find(b);
    if (x !== y) this.parent.set(x, y);
  }
}

type Node = { key: string; ref: ItemRef | null; kind: 'pad' | 'seg' | 'via'; pad?: WorldPad; seg?: WorldSegment; via?: WorldVia };

const cache = new WeakMap<Project, Connectivity>();
/** Связность с заливкой, взятой у другого состояния (во время перетаскивания). */
const staleCache = new WeakMap<Project, Connectivity>();

/**
 * Связность проекта. zonesFrom — взять заливку полигонов у этого состояния, а не считать заново:
 * так редактор перетаскивает объекты без пересчёта заливки на каждом кадре (как KiCad до перезаливки).
 */
export function computeConnectivity(p: Project, o: { zonesFrom?: Project } = {}): Connectivity {
  const hit = cache.get(p);
  if (hit) return hit;
  const zonesFrom = o.zonesFrom && o.zonesFrom !== p && Object.keys(p.zones).length ? o.zonesFrom : undefined;
  if (zonesFrom) {
    const stale = staleCache.get(p);
    if (stale) return stale;
  }
  const world = getWorld(p);
  const uf = new UnionFind();
  const layers = boardCopperLayers(p.board.copperLayers);
  const allLayers: CopperLayer[] = ['F.Cu', 'B.Cu'];
  const hash: Record<CopperLayer, SpatialHash<Node>> = { 'F.Cu': new SpatialHash(2), 'B.Cu': new SpatialHash(2) };

  const padNode = (wp: WorldPad): Node => ({ key: 'P' + wp.key, ref: null, kind: 'pad', pad: wp });
  const padNodes = new Map<string, Node>();
  for (const wp of world.pads) {
    if (wp.layers.length === 0) continue;
    const n = padNode(wp);
    padNodes.set(wp.key, n);
    uf.find(n.key);
    for (const l of wp.layers) hash[l].insert(n, wp.shape.box);
  }
  const segNodes: Node[] = [];
  for (const s of world.segments) {
    const n: Node = { key: 'T' + s.track.id, ref: { kind: 'track', id: s.track.id }, kind: 'seg', seg: s };
    segNodes.push(n);
    uf.find(n.key);
    hash[s.track.layer].insert(n, s.shape.box);
  }
  const viaNodes: Node[] = [];
  for (const v of world.vias) {
    const n: Node = { key: 'V' + v.via.id, ref: { kind: 'via', id: v.via.id }, kind: 'via', via: v };
    viaNodes.push(n);
    uf.find(n.key);
    for (const l of allLayers) hash[l].insert(n, v.shape.box);
  }

  // Касания на каждом слое: дорожки с площадками, дорожками и переходными; переходные с площадками.
  const touched = new Set<string>();
  const tryUnion = (a: Node, b: Node) => {
    if (a.key === b.key) return;
    const k = a.key < b.key ? a.key + '|' + b.key : b.key + '|' + a.key;
    if (touched.has(k)) return;
    const sa = a.pad?.shape ?? a.seg?.shape ?? a.via!.shape;
    const sb = b.pad?.shape ?? b.seg?.shape ?? b.via!.shape;
    if (shapesTouch(sa, sb)) {
      touched.add(k);
      uf.union(a.key, b.key);
    }
  };
  for (const n of segNodes) for (const m of hash[n.seg!.track.layer].query(n.seg!.shape.box)) tryUnion(n, m);
  for (const n of viaNodes) for (const l of layers) for (const m of hash[l].query(n.via!.shape.box)) if (m.kind === 'pad') tryUnion(n, m);

  // Перемычки: концы соединяются с тем, что под ними, на любом слое.
  const wireNodes: { key: string; id: Id; hitA: boolean; hitB: boolean }[] = [];
  for (const w of world.wires) {
    const key = 'W' + w.id;
    uf.find(key);
    const hitEnd = (pt: Vec2): boolean => {
      let any = false;
      const box = expandBox({ minX: pt.x, minY: pt.y, maxX: pt.x, maxY: pt.y }, 0.05);
      for (const l of allLayers)
        for (const m of hash[l].query(box)) {
          const s = m.pad?.shape ?? m.seg?.shape ?? m.via!.shape;
          if (shapeContains(s, pt, 0.05)) {
            uf.union(key, m.key);
            any = true;
          }
        }
      return any;
    };
    wireNodes.push({ key, id: w.id, hitA: hitEnd(w.a), hitB: hitEnd(w.b) });
  }

  // Какие цепи попали в каждый корень.
  let rootNets = new Map<string, Set<Id>>();
  let rootPads = new Map<string, WorldPad[]>();
  const collectRoots = () => {
    rootNets = new Map();
    rootPads = new Map();
    for (const wp of world.pads) {
      const n = padNodes.get(wp.key);
      if (!n) continue;
      const r = uf.find(n.key);
      if (!rootPads.has(r)) rootPads.set(r, []);
      rootPads.get(r)!.push(wp);
      if (wp.net) {
        if (!rootNets.has(r)) rootNets.set(r, new Set());
        rootNets.get(r)!.add(wp.net);
      }
    }
  };
  collectRoots();
  const netOfRoot = (r: string): Id | null | 'short' => {
    const s = rootNets.get(r);
    if (!s || s.size === 0) return null;
    return s.size === 1 ? [...s][0] : 'short';
  };

  // Полигоны: заливка обходит чужие цепи, её острова соединяют всё своё, чего касаются.
  const zoneFills = zonesFrom
    ? computeConnectivity(zonesFrom).zoneFills.filter((zf) => p.zones[zf.zone.id])
    : fillZones(p, world, (key) => netOfRoot(uf.find(key)));
  if (zoneFills.some((z) => z.islands.length)) {
    for (const zf of zoneFills)
      zf.islands.forEach((keys, i) => {
        const node = 'Z' + zf.zone.id + '#' + i;
        for (const k of keys) uf.union(node, k);
      });
    collectRoots();
  }

  const itemNet = new Map<Id, Id | null | 'short'>();
  const dangling: ItemRef[] = [];
  const rootItems = new Map<string, ItemRef[]>();
  const pushItem = (r: string, ref: ItemRef) => {
    if (!rootItems.has(r)) rootItems.set(r, []);
    rootItems.get(r)!.push(ref);
  };
  for (const t of Object.values(p.tracks)) {
    const r = uf.find('T' + t.id);
    const n = netOfRoot(r);
    itemNet.set(t.id, n);
    pushItem(r, { kind: 'track', id: t.id });
    if (!rootPads.has(r)) dangling.push({ kind: 'track', id: t.id });
  }
  for (const v of Object.values(p.vias)) {
    const r = uf.find('V' + v.id);
    const n = netOfRoot(r);
    itemNet.set(v.id, n);
    pushItem(r, { kind: 'via', id: v.id });
    if (!rootPads.has(r)) dangling.push({ kind: 'via', id: v.id });
  }
  for (const w of wireNodes) {
    const r = uf.find(w.key);
    itemNet.set(w.id, netOfRoot(r));
    pushItem(r, { kind: 'wire', id: w.id });
    if (!w.hitA || !w.hitB) dangling.push({ kind: 'wire', id: w.id });
  }

  // Замыкания: корень с несколькими цепями.
  const shorts: Short[] = [];
  for (const [r, nets] of rootNets) {
    if (nets.size < 2) continue;
    const pads = rootPads.get(r) ?? [];
    const items: ItemRef[] = [...(rootItems.get(r) ?? [])];
    for (const wp of pads) items.push({ kind: 'component', id: wp.component.id });
    const at = pads.length ? pads[0].center : { x: 0, y: 0 };
    shorts.push({ nets: [...nets], items, at });
  }

  // Островки каждой цепи. Якоря островка: центры его площадок и переходных, вершины его дорожек.
  const anchorsOfRoot = new Map<string, Vec2[]>();
  const addAnchor = (r: string, q: Vec2) => {
    if (!anchorsOfRoot.has(r)) anchorsOfRoot.set(r, []);
    anchorsOfRoot.get(r)!.push(q);
  };
  for (const t of Object.values(p.tracks)) {
    const r = uf.find('T' + t.id);
    for (const q of t.points) addAnchor(r, q);
  }
  for (const v of Object.values(p.vias)) addAnchor(uf.find('V' + v.id), v.at);

  const nets = new Map<Id, NetStatus>();
  const padsByNet = new Map<Id, WorldPad[]>();
  for (const wp of world.pads) if (wp.net && padNodes.has(wp.key)) (padsByNet.get(wp.net) ?? padsByNet.set(wp.net, []).get(wp.net)!).push(wp);
  let unrouted = 0;
  let total = 0;
  const ratsnest: RatsLine[] = [];
  for (const net of Object.values(p.nets)) {
    const pads = padsByNet.get(net.id) ?? [];
    const byRoot = new Map<string, WorldPad[]>();
    for (const wp of pads) {
      const r = uf.find('P' + wp.key);
      (byRoot.get(r) ?? byRoot.set(r, []).get(r)!).push(wp);
    }
    const islands: NetIsland[] = [...byRoot.entries()].map(([r, ps]) => ({
      pads: ps.map((x) => x.key),
      anchors: [...ps.map((x) => x.center), ...(anchorsOfRoot.get(r) ?? [])],
    }));
    const complete = pads.length < 2 || islands.length <= 1;
    nets.set(net.id, { netId: net.id, islands, padCount: pads.length, complete });
    if (pads.length >= 2) {
      total++;
      if (!complete) unrouted++;
      // Воздушные линии: жадное дерево между островками по ближайшим якорям.
      const done = [islands[0]];
      const left = islands.slice(1);
      while (left.length) {
        let best: { d: number; a: Vec2; b: Vec2; i: number } | null = null;
        for (let i = 0; i < left.length; i++)
          for (const g of done)
            for (const a of left[i].anchors)
              for (const b of g.anchors) {
                const d = dist(a, b);
                if (!best || d < best.d) best = { d, a, b, i };
              }
        if (!best) break;
        ratsnest.push({ netId: net.id, a: best.a, b: best.b });
        done.push(left[best.i]);
        left.splice(best.i, 1);
      }
    }
  }

  const res: Connectivity = { world, itemNet, nets, shorts, ratsnest, dangling, unrouted, total, zoneFills };
  (zonesFrom ? staleCache : cache).set(p, res);
  return res;
}

/** Цепь, к которой относится точка на слое: по площадке, дорожке или переходному под ней. */
export function netAtPoint(p: Project, pt: Vec2, layer: CopperLayer | null): Id | null {
  const conn = computeConnectivity(p);
  const w = conn.world;
  for (const wp of w.pads) if ((!layer || wp.layers.includes(layer)) && shapeContains(wp.shape, pt, 0.01)) return wp.net;
  for (const v of w.vias) if (shapeContains(v.shape, pt, 0.01)) {
    const n = conn.itemNet.get(v.via.id);
    return n === 'short' ? null : (n ?? null);
  }
  for (const s of w.segments) if ((!layer || s.track.layer === layer) && shapeContains(s.shape, pt, 0.01)) {
    const n = conn.itemNet.get(s.track.id);
    return n === 'short' ? null : (n ?? null);
  }
  return null;
}

/** Заливка полигонов проекта (кешируется вместе со связностью). */
export const getZoneFills = (p: Project): ZoneFill[] => computeConnectivity(p).zoneFills;
