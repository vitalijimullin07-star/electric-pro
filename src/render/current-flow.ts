import { computeConnectivity } from '@core/model/connectivity';
import { shapeContains } from '@core/math/shape';
import type { Vec2 } from '@core/math/vec';
import type { Id, Project } from '@core/model/types';
import type { WorldSegment } from '@core/model/world';

/*
 * Ток по дорожкам для показа «бегущими точками»: у каждой цепи — граф из концов отрезков,
 * площадок и переходных; остовное дерево, в площадки втекают токи выводов из аналогового
 * расчёта, ток по каждому отрезку — сумма втекающих в его поддерево. На кольцах часть
 * отрезков вне дерева (показываются без тока) — это оценка, не расчёт растекания по меди.
 */

interface Edge {
  seg: WorldSegment;
  /** Узлы концов a и b. */
  a: number;
  b: number;
}

interface NetTree {
  /** Порядок обхода (корень первым) и родитель каждого узла с ребром к нему. */
  order: number[];
  parent: Int32Array;
  parentEdge: Int32Array;
  /** Направление ребра к родителю совпадает с a→b. */
  edges: Edge[];
  /** Площадка → узел. */
  pads: Map<string, number>;
  nodes: number;
}

const cache = new WeakMap<Project, Map<Id, NetTree>>();

function build(p: Project): Map<Id, NetTree> {
  const conn = computeConnectivity(p);
  const w = conn.world;
  const byNet = new Map<Id, { segs: WorldSegment[]; pads: typeof w.pads; vias: typeof w.vias }>();
  const get = (n: Id) => {
    let x = byNet.get(n);
    if (!x) byNet.set(n, (x = { segs: [], pads: [], vias: [] }));
    return x;
  };
  for (const s of w.segments) {
    const n = conn.itemNet.get(s.track.id);
    if (typeof n === 'string' && n !== 'short') get(n).segs.push(s);
  }
  for (const pd of w.pads) if (pd.net) get(pd.net).pads.push(pd);
  for (const v of w.vias) {
    const n = conn.itemNet.get(v.via.id);
    if (typeof n === 'string' && n !== 'short') get(n).vias.push(v);
  }
  const out = new Map<Id, NetTree>();
  for (const [net, g] of byNet) {
    if (!g.segs.length) continue;
    const pts = new Map<string, number>();
    let count = 0;
    const pt = (v: Vec2, layer: string) => {
      const k = `${layer}:${Math.round(v.x * 100)}:${Math.round(v.y * 100)}`;
      let i = pts.get(k);
      if (i === undefined) pts.set(k, (i = count++));
      return i;
    };
    const edges: Edge[] = g.segs.map((s) => ({ seg: s, a: pt(s.a, s.track.layer), b: pt(s.b, s.track.layer) }));
    const pads = new Map<string, number>();
    const links: [number, number][] = [];
    const ends = [...pts.entries()].map(([k, i]) => {
      const [layer, x, y] = k.split(':');
      return { layer, p: { x: +x / 100, y: +y / 100 }, i };
    });
    for (const pd of g.pads) {
      const id = count++;
      pads.set(pd.key, id);
      for (const e of ends) if (pd.layers.includes(e.layer as never) && shapeContains(pd.shape, e.p, 0.05)) links.push([id, e.i]);
    }
    for (const v of g.vias) {
      const id = count++;
      for (const e of ends) if (shapeContains(v.shape, e.p, 0.05)) links.push([id, e.i]);
    }
    // Соседи: рёбра-отрезки (номер ≥ 0) и связи без отрезка (−1).
    const adj: [number, number][][] = Array.from({ length: count }, () => []);
    edges.forEach((e, k) => {
      adj[e.a].push([e.b, k]);
      adj[e.b].push([e.a, k]);
    });
    for (const [a, b] of links) {
      adj[a].push([b, -1]);
      adj[b].push([a, -1]);
    }
    const parent = new Int32Array(count).fill(-2);
    const parentEdge = new Int32Array(count).fill(-1);
    const order: number[] = [];
    for (let r = 0; r < count; r++) {
      if (parent[r] !== -2) continue;
      parent[r] = -1;
      const q = [r];
      while (q.length) {
        const u = q.shift()!;
        order.push(u);
        for (const [v, k] of adj[u])
          if (parent[v] === -2) {
            parent[v] = u;
            parentEdge[v] = k;
            q.push(v);
          }
      }
    }
    out.set(net, { order, parent, parentEdge, edges, pads, nodes: count });
  }
  return out;
}

/**
 * Ток по отрезкам дорожек, А: положительный — от начала отрезка (a) к концу (b).
 * padCurrent — ток в деталь через площадку (ключ площадки как в World).
 */
export function segmentFlows(p: Project, padCurrent: Map<string, number>): Map<WorldSegment, number> {
  let trees = cache.get(p);
  if (!trees) cache.set(p, (trees = build(p)));
  const flows = new Map<WorldSegment, number>();
  for (const t of trees.values()) {
    const sub = new Float64Array(t.nodes);
    let any = false;
    for (const [key, node] of t.pads) {
      const i = padCurrent.get(key);
      if (i) {
        // Ток уходит из цепи в деталь: для цепи это сток.
        sub[node] -= i;
        any = true;
      }
    }
    if (!any) continue;
    for (let k = t.order.length - 1; k >= 0; k--) {
      const u = t.order[k];
      const par = t.parent[u];
      if (par < 0) continue;
      const ek = t.parentEdge[u];
      if (ek >= 0) {
        // Ток из поддерева u течёт к родителю.
        const e = t.edges[ek];
        flows.set(e.seg, e.a === u ? sub[u] : -sub[u]);
      }
      sub[par] += sub[u];
    }
  }
  return flows;
}
