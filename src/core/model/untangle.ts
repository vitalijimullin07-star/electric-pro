import type { Vec2 } from '../math/vec';
import { computeConnectivity } from './connectivity';
import { roleOf } from './net-roles';
import type { Id, Project } from './types';

/*
 * Распутывание «паутины» — воздушных линий. Цепь из нескольких выводов можно соединить
 * по-разному (какой вывод с каким); обычно берут кратчайшее дерево, но оно не смотрит на
 * соседей. Здесь дерево каждой цепи подбирается так, чтобы меньше пересекаться с другими
 * цепями и меньше проходить сквозь ряды выводов («стены», между которыми дорожке не пройти),
 * при небольшой плате за длину. Детали не двигаются.
 * Затем по оставшимся пересечениям строится план трассировки: на одной стороне меди —
 * наименьший набор связей, которые пойдут перемычками, чтобы остальные легли без
 * пересечений; на двух слоях — какая связь на каком слое (раскраска графа пересечений).
 */

export interface TanglePoint extends Vec2 {
  /** Вывод, если точка — центр площадки. */
  pad?: string;
  /** Деталь, которой принадлежит точка: её стены связь не «пересекает». */
  owner?: string;
}

export interface TangleNet {
  id: Id;
  /** Островки цепи: точки, к которым можно подвести связь. */
  nodes: TanglePoint[][];
  /** Во сколько раз дороже пускать связь этой цепи перемычкой или на другой слой (питание, 230 В). */
  jumpCost?: number;
}

export interface TangleWall {
  a: Vec2;
  b: Vec2;
  owner: string;
}

export interface TangleEdge {
  net: number;
  /** Номера островков цепи. */
  i: number;
  j: number;
  a: TanglePoint;
  b: TanglePoint;
}

export interface TangleResult {
  edges: TangleEdge[];
  crossings: number;
  walls: number;
  before: { crossings: number; walls: number };
  /** План одной стороны: связь пойдёт перемычкой (или обходом). */
  jump: boolean[];
  /** План двух слоёв: 0 — верхний, 1 — нижний. */
  layer: (0 | 1)[];
  /** Оценка снизу: сколько связей придётся пускать поверху на одной стороне. */
  minJumps: number;
  /** Пересечений, которые не развести раскраской по двум слоям (каждое — пара переходных). */
  minViaPairs: number;
}

function segCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  if (Math.max(a.x, b.x) < Math.min(c.x, d.x) || Math.max(c.x, d.x) < Math.min(a.x, b.x) || Math.max(a.y, b.y) < Math.min(c.y, d.y) || Math.max(c.y, d.y) < Math.min(a.y, b.y)) return false;
  const o1 = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const o2 = (b.x - a.x) * (d.y - a.y) - (b.y - a.y) * (d.x - a.x);
  const o3 = (d.x - c.x) * (a.y - c.y) - (d.y - c.y) * (a.x - c.x);
  const o4 = (d.x - c.x) * (b.y - c.y) - (d.y - c.y) * (b.x - c.x);
  return ((o1 > 1e-9 && o2 < -1e-9) || (o1 < -1e-9 && o2 > 1e-9)) && ((o3 > 1e-9 && o4 < -1e-9) || (o3 < -1e-9 && o4 > 1e-9));
}

const manhattan = (a: Vec2, b: Vec2) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

export interface UntangleOptions {
  /** Проходов улучшения (по умолчанию 6). */
  rounds?: number;
  /** Цена пересечения в миллиметрах длины (по умолчанию 100: пересечение важнее любой длины). */
  crossWeight?: number;
  /** Цена прохода сквозь стену (по умолчанию 70). */
  wallWeight?: number;
  /** Не распутывать (только кратчайшие деревья и план) — для сравнения. */
  plain?: boolean;
}

export function untangle(nets: TangleNet[], walls: TangleWall[], o: UntangleOptions = {}): TangleResult {
  const CW = o.crossWeight ?? 100;
  const WW = o.wallWeight ?? 70;
  // Ближайшая пара точек между островками i и j цепи — «связь» между ними.
  const pairOf = nets.map((net) => {
    const k = net.nodes.length;
    const best: { a: TanglePoint; b: TanglePoint; d: number }[][] = [];
    for (let i = 0; i < k; i++) {
      best.push([]);
      for (let j = 0; j < k; j++) {
        if (i === j) {
          best[i].push({ a: net.nodes[i][0], b: net.nodes[i][0], d: 0 });
          continue;
        }
        if (j < i) {
          const r = best[j][i];
          best[i].push({ a: r.b, b: r.a, d: r.d });
          continue;
        }
        let b: { a: TanglePoint; b: TanglePoint; d: number } | null = null;
        for (const p of net.nodes[i]) for (const q of net.nodes[j]) {
          const d = manhattan(p, q);
          if (!b || d < b.d) b = { a: p, b: q, d };
        }
        best[i].push(b!);
      }
    }
    return best;
  });
  // Начало — кратчайшее дерево (как у обычной паутины).
  const trees: [number, number][][] = nets.map((net, n) => {
    const k = net.nodes.length;
    if (k < 2) return [];
    const inT = new Uint8Array(k);
    const d = new Float64Array(k).fill(Infinity);
    const from = new Int32Array(k).fill(-1);
    const out: [number, number][] = [];
    inT[0] = 1;
    let cur = 0;
    for (let s = 1; s < k; s++) {
      for (let q = 0; q < k; q++)
        if (!inT[q]) {
          const dd = pairOf[n][cur][q].d;
          if (dd < d[q]) (d[q] = dd), (from[q] = cur);
        }
      let bq = -1;
      for (let q = 0; q < k; q++) if (!inT[q] && (bq < 0 || d[q] < d[bq])) bq = q;
      inT[bq] = 1;
      out.push([from[bq], bq]);
      cur = bq;
    }
    return out;
  });
  const seg = (n: number, e: [number, number]) => pairOf[n][e[0]][e[1]];
  const wallHits = (p: TanglePoint, q: TanglePoint): number => {
    let c = 0;
    // Свои стены детали тоже считаются (связь сквозь другой ряд своей же микросхемы);
    // касание у своего вывода пересечением не считается.
    for (const w of walls) if (segCross(p, q, w.a, w.b)) c++;
    return c;
  };
  const crossWithOthers = (n: number, p: TanglePoint, q: TanglePoint): number => {
    let c = 0;
    for (let m = 0; m < nets.length; m++) {
      if (m === n) continue;
      for (const e of trees[m]) {
        const s = seg(m, e);
        if (segCross(p, q, s.a, s.b)) c++;
      }
    }
    return c;
  };
  const totals = () => {
    let crossings = 0;
    let wallsHit = 0;
    for (let n = 0; n < nets.length; n++)
      for (const e of trees[n]) {
        const s = seg(n, e);
        wallsHit += wallHits(s.a, s.b);
        for (let m = n + 1; m < nets.length; m++) for (const f of trees[m]) {
          const t = seg(m, f);
          if (segCross(s.a, s.b, t.a, t.b)) crossings++;
        }
      }
    return { crossings, walls: wallsHit };
  };
  const before = totals();

  if (!o.plain)
    for (let round = 0; round < (o.rounds ?? 6); round++) {
      let improved = 0;
      for (let n = 0; n < nets.length; n++) {
        const k = nets[n].nodes.length;
        if (k < 3) continue;
        const t = trees[n];
        for (let q = 0; q < t.length; q++) {
          // Без связи q дерево распадается на две части; ищем лучшую связь между ними.
          const comp = new Int8Array(k).fill(-1);
          const stack = [t[q][0]];
          comp[t[q][0]] = 0;
          while (stack.length) {
            const v = stack.pop()!;
            for (let z = 0; z < t.length; z++) {
              if (z === q) continue;
              const [a, b] = t[z];
              const u = a === v ? b : b === v ? a : -1;
              if (u >= 0 && comp[u] < 0) {
                comp[u] = 0;
                stack.push(u);
              }
            }
          }
          const cost = (i: number, j: number) => {
            const s = pairOf[n][i][j];
            return crossWithOthers(n, s.a, s.b) * CW + wallHits(s.a, s.b) * WW + s.d;
          };
          let best: [number, number] = t[q];
          let bc = cost(t[q][0], t[q][1]);
          for (let i = 0; i < k; i++) {
            if (comp[i] !== 0) continue;
            for (let j = 0; j < k; j++) {
              if (comp[j] >= 0) continue;
              // Отсев: заметно длиннее лучшей — не станет лучше (пересечения — не меньше нуля).
              if (pairOf[n][i][j].d >= bc) continue;
              const c = cost(i, j);
              if (c < bc - 1e-9) {
                bc = c;
                best = [i, j];
              }
            }
          }
          if (best !== t[q]) {
            t[q] = best;
            improved++;
          }
        }
      }
      if (!improved) break;
    }

  const edges: TangleEdge[] = [];
  trees.forEach((t, n) => t.forEach(([i, j]) => edges.push({ net: n, i, j, a: pairOf[n][i][j].a, b: pairOf[n][i][j].b })));
  const after = o.plain ? before : totals();

  // Граф пересечений связей разных цепей.
  const E = edges.length;
  const adj: number[][] = edges.map(() => []);
  for (let x = 0; x < E; x++)
    for (let y = x + 1; y < E; y++) {
      if (edges[x].net === edges[y].net) continue;
      if (segCross(edges[x].a, edges[x].b, edges[y].a, edges[y].b)) {
        adj[x].push(y);
        adj[y].push(x);
      }
    }
  // Одна сторона: жадное вершинное покрытие с весами — прыгает то, что пересекает больше всех и дешевле.
  const jump = new Array<boolean>(E).fill(false);
  const deg = adj.map((a) => a.length);
  const weight = edges.map((e) => nets[e.net].jumpCost ?? 1);
  for (;;) {
    let bx = -1;
    let bv = 0;
    for (let x = 0; x < E; x++) {
      if (jump[x] || !deg[x]) continue;
      const v = deg[x] / weight[x];
      if (v > bv) (bv = v), (bx = x);
    }
    if (bx < 0) break;
    jump[bx] = true;
    for (const y of adj[bx]) if (!jump[y]) deg[y]--;
    deg[bx] = 0;
  }
  const minJumps = jump.filter(Boolean).length;
  // Два слоя: раскраска — связи с большим числом пересечений первыми, цвет с меньшим числом споров.
  const layer = new Array<0 | 1>(E).fill(0);
  const colored = new Uint8Array(E);
  const order = edges.map((_, x) => x).sort((x, y) => adj[y].length - adj[x].length);
  let minViaPairs = 0;
  for (const x of order) {
    let c0 = 0;
    let c1 = 0;
    for (const y of adj[x]) if (colored[y]) layer[y] === 0 ? c0++ : c1++;
    layer[x] = c0 <= c1 ? 0 : 1;
    minViaPairs += Math.min(c0, c1);
    colored[x] = 1;
  }
  return { edges, crossings: after.crossings, walls: after.walls, before, jump, layer, minJumps, minViaPairs };
}

/* ---------------- проект → распутывание ---------------- */

/**
 * Стены: соседние выводы детали, между которыми не пройти даже самой тонкой дорожке
 * (ширина + два зазора самого «тонкого» класса).
 */
export function padWalls(p: Project): TangleWall[] {
  const conn = computeConnectivity(p);
  const thin = Math.min(...Object.values(p.netClasses).map((c) => Math.max(c.trackWidth, p.rules.minTrackWidth) + 2 * Math.max(c.clearance, p.rules.minClearance)));
  const out: TangleWall[] = [];
  for (const wc of conn.world.components) {
    if (wc.component.offBoard) continue;
    const ps = wc.pads;
    const r = ps.map((q) => Math.max(q.shape.box.maxX - q.shape.box.minX, q.shape.box.maxY - q.shape.box.minY) / 2);
    for (let a = 0; a < ps.length; a++) {
      let nearest = Infinity;
      for (let b = 0; b < ps.length; b++) if (b !== a) nearest = Math.min(nearest, Math.hypot(ps[a].center.x - ps[b].center.x, ps[a].center.y - ps[b].center.y));
      for (let b = a + 1; b < ps.length; b++) {
        const d = Math.hypot(ps[a].center.x - ps[b].center.x, ps[a].center.y - ps[b].center.y);
        if (d > Math.min(3.3, nearest * 1.2) || d - r[a] - r[b] >= thin) continue;
        out.push({ a: ps[a].center, b: ps[b].center, owner: wc.component.id });
      }
    }
  }
  return out;
}

/** Цепи проекта для распутывания: островки по текущей меди (выводы, вершины дорожек, переходные). */
export function tangleNets(p: Project, opts: { nets?: Id[]; skipPoured?: boolean } = {}): TangleNet[] {
  const conn = computeConnectivity(p);
  const padOwner = new Map(conn.world.pads.map((q) => [q.key, q.component.id]));
  const padAt = new Map(conn.world.pads.map((q) => [`${q.center.x},${q.center.y}`, q.key]));
  const out: TangleNet[] = [];
  for (const st of conn.nets.values()) {
    if (st.padCount < 2 || st.complete) continue;
    if (opts.nets && !opts.nets.includes(st.netId)) continue;
    const role = roleOf(p, st.netId);
    const nodes = st.islands.map((is) =>
      is.anchors.map((a): TanglePoint => {
        const pad = padAt.get(`${a.x},${a.y}`);
        return { x: a.x, y: a.y, pad, owner: pad ? padOwner.get(pad) : undefined };
      }),
    );
    out.push({ id: st.netId, nodes, jumpCost: role === 'hv' ? 20 : role === 'power' ? 3 : 1 });
  }
  return out;
}

const cache = new WeakMap<Project, TangleResult & { nets: TangleNet[] }>();

/** Уже посчитанная распутанная паутина (без счёта — для отрисовки на каждом кадре). */
export function peekUntangled(p: Project): (TangleResult & { nets: TangleNet[] }) | undefined {
  return cache.get(p);
}

/** Распутанная паутина проекта (кеш по объекту проекта). */
export function untangledRatsnest(p: Project): TangleResult & { nets: TangleNet[] } {
  const hit = cache.get(p);
  if (hit) return hit;
  const nets = tangleNets(p);
  const r = { ...untangle(nets, padWalls(p)), nets };
  cache.set(p, r);
  return r;
}

/** План для трассировщика: связи распутанной паутины в ключах выводов, прыжки и слои. */
export function routePlan(r: TangleResult & { nets: TangleNet[] }): { net: Id; a: string; b: string; jump: boolean; layer: 0 | 1 }[] {
  const out: { net: Id; a: string; b: string; jump: boolean; layer: 0 | 1 }[] = [];
  r.edges.forEach((e, x) => {
    const net = r.nets[e.net];
    const a = e.a.pad ?? net.nodes[e.i].find((q) => q.pad)?.pad;
    const b = e.b.pad ?? net.nodes[e.j].find((q) => q.pad)?.pad;
    if (a && b) out.push({ net: net.id, a, b, jump: r.jump[x], layer: r.layer[x] });
  });
  return out;
}
