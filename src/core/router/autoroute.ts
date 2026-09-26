import { boxOfPoints, pointInPolygon, distToPolygonEdge } from '../math/geom';
import { distPointShape } from '../math/shape';
import { dist, type Vec2 } from '../math/vec';
import { computeConnectivity } from '../model/connectivity';
import { boardCopperLayers } from '../model/layers';
import { boardPolygon } from '../model/project';
import { netClassOf, requiredClearance } from '../model/rules';
import type { CopperLayer, Id, NetClass, Project, Track, Via } from '../model/types';
import { getWorld, type WorldPad } from '../model/world';

/*
 * Автотрассировка методом согласования конфликтов (PathFinder):
 * все цепи разводятся по сетке независимо, спорные клетки дорожают,
 * и за несколько проходов конфликты рассасываются. Работает на одном
 * слое (с перемычками проводом) и на двух (с переходными отверстиями).
 * Дорожки идут по сетке под прямыми углами — как и положено «домашней» плате.
 */

export interface RouteOptions {
  /** Шаг сетки, мм. По умолчанию подбирается по ширинам дорожек и зазорам. */
  grid?: number;
  /** Максимум проходов согласования. */
  iterations?: number;
  /** Разрешить перемычки проводом (нужно на односторонней плате). */
  allowWires?: boolean;
  /** Разрешить переходные отверстия (двусторонняя плата). */
  allowVias?: boolean;
  /** Стоимость перемычки или переходного в клетках пути. */
  hopCost?: number;
  /** Оставить существующие дорожки и развести только недоведённые цепи. */
  keepExisting?: boolean;
  /** Разводить только эти цепи (по умолчанию все). */
  nets?: Id[];
  /** Обратный вызов прогресса: проход, спорных клеток, доля. */
  progress?: (info: { iteration: number; conflicts: number; fraction: number }) => void | Promise<void>;
  /** Отдавать управление между шагами (для интерфейса без воркера). */
  yieldEvery?: number;
  /**
   * Во сколько раз за проход дорожает спорная клетка (по умолчанию 1,7). Меньше — мягче
   * согласование: цепи дольше уступают друг другу, нужно больше проходов.
   */
  congestionGrowth?: number;
  /**
   * Цена шага по слою (по порядку медных слоёв, по умолчанию 1). Например, [1, 3] — нижний
   * слой только для переходов через чужие дорожки, чтобы заливка земли на нём оставалась цельной.
   */
  layerCost?: number[];
}

export interface RouteResult {
  tracks: Omit<Track, 'id'>[];
  vias: Omit<Via, 'id'>[];
  wires: { a: Vec2; b: Vec2 }[];
  /** Связей, которые не удалось провести (заменены прямыми перемычками). */
  failed: number;
  conflicts: number;
  iterations: number;
  grid: number;
  ms: number;
  /** Клетки, оставшиеся спорными после согласования (узкие места размещения). */
  hot?: { x: number; y: number; layer: CopperLayer }[];
}

const DI = [1, 0, -1, 0];
const DJ = [0, 1, 0, -1];

/** Шаг сетки, при котором соседние клетки разных цепей соблюдают зазор. */
export function autoGrid(p: Project): number {
  const classes = Object.values(p.netClasses);
  let need = 0;
  for (const a of classes)
    for (const b of classes) {
      const c = requiredClearance(p.rules, a, b);
      // Особые большие зазоры (230 В) держатся отдельными запретными зонами, в шаг сетки их не закладываем.
      const cl = c > 2 ? Math.max(a.clearance, b.clearance, p.rules.minClearance) : c;
      need = Math.max(need, a.trackWidth / 2 + b.trackWidth / 2 + cl);
    }
  const steps = [0.5, 0.635, 0.8, 1.0, 1.27, 1.5, 2.0, 2.54];
  return steps.find((s) => s >= need - 1e-6) ?? Math.ceil(need * 10) / 10;
}

export async function autoroute(p: Project, o: RouteOptions = {}): Promise<RouteResult> {
  const t0 = Date.now();
  const world = getWorld(p);
  const conn = computeConnectivity(p);
  const layerIds: CopperLayer[] = boardCopperLayers(p.board.copperLayers);
  const nl = layerIds.length;
  const allowVias = o.allowVias ?? nl > 1;
  const allowWires = o.allowWires ?? nl === 1;
  const G = o.grid ?? autoGrid(p);
  const iters = o.iterations ?? 24;
  const hopCost = o.hopCost ?? (allowVias ? 25 : 60);
  const yieldEvery = o.yieldEvery ?? 4;
  const R = p.rules;

  // Цепи, которые разводим.
  const netList = Object.values(p.nets).filter((n) => !o.nets || o.nets.includes(n.id));
  const netIndex = new Map<Id, number>();
  netList.forEach((n, i) => netIndex.set(n.id, i));
  const NN = netList.length;
  const cls: NetClass[] = netList.map((n) => netClassOf(p, n.id));
  const maxHw = Math.max(0.1, ...Object.values(p.netClasses).map((c) => c.trackWidth / 2));
  const maxClr = Math.max(R.minClearance, ...Object.values(p.netClasses).map((c) => c.clearance));

  // Сетка над платой.
  const poly = boardPolygon(p.board);
  const bb = boxOfPoints(poly);
  const x0 = bb.minX;
  const y0 = bb.minY;
  const nx = Math.floor((bb.maxX - bb.minX) / G) + 1;
  const ny = Math.floor((bb.maxY - bb.minY) / G) + 1;
  const N = nx * ny;
  const cx = (k: number) => x0 + (k % nx) * G;
  const cy = (k: number) => y0 + Math.floor(k / nx) * G;
  const cell = (i: number, j: number) => j * nx + i;

  // own[l][k]: -1 свободно, -2 запрет, n ≥ 0 — медь цепи n (площадка или сохранённая дорожка). padAt: индекс площадки.
  const own: Int16Array[] = [];
  const padAt: Int32Array[] = [];
  for (let l = 0; l < nl; l++) {
    own.push(new Int16Array(N).fill(-1));
    padAt.push(new Int32Array(N).fill(-1));
  }
  const edgeR = R.edgeClearance + maxHw;
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const k = cell(i, j);
      const q = { x: cx(k), y: cy(k) };
      let blocked = !pointInPolygon(q, poly) || distToPolygonEdge(q, poly) < edgeR;
      if (!blocked) for (const cut of p.board.cutouts) if (pointInPolygon(q, cut) || distToPolygonEdge(q, cut) < edgeR) blocked = true;
      if (blocked) for (let l = 0; l < nl; l++) own[l][k] = -2;
    }

  const mark = (x: number, y: number, r: number, fn: (k: number) => void) => {
    const i0 = Math.max(0, Math.floor((x - r - x0) / G));
    const i1 = Math.min(nx - 1, Math.ceil((x + r - x0) / G));
    const j0 = Math.max(0, Math.floor((y - r - y0) / G));
    const j1 = Math.min(ny - 1, Math.ceil((y + r - y0) / G));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) fn(cell(i, j));
  };

  // Площадки.
  const pads: { wp: WorldPad; n: number; layers: number[] }[] = [];
  const padIndexByKey = new Map<string, number>();
  for (const wp of world.pads) {
    const layers = wp.layers.map((l) => layerIds.indexOf(l)).filter((l) => l >= 0);
    if (!layers.length && wp.pad.type !== 'npth') continue;
    const n = wp.net ? (netIndex.get(wp.net) ?? -1) : -1;
    const idx = pads.length;
    pads.push({ wp, n, layers });
    padIndexByKey.set(wp.key, idx);
    const halo = maxHw + maxClr + G * 0.51;
    const center = { x: (wp.shape.box.minX + wp.shape.box.maxX) / 2, y: (wp.shape.box.minY + wp.shape.box.maxY) / 2 };
    const reach = Math.hypot(wp.shape.box.maxX - wp.shape.box.minX, wp.shape.box.maxY - wp.shape.box.minY) / 2 + halo;
    const targetLayers = wp.pad.type === 'npth' ? [...Array(nl).keys()] : layers;
    mark(center.x, center.y, reach, (k) => {
      const d = distPointShape({ x: cx(k), y: cy(k) }, wp.shape);
      if (d > halo) return;
      for (const l of targetLayers) {
        if (own[l][k] === -2) continue;
        if (n < 0) {
          own[l][k] = -2;
          padAt[l][k] = -1;
        } else if (own[l][k] === -1) {
          own[l][k] = n;
          padAt[l][k] = idx;
        } else if (own[l][k] !== n) {
          own[l][k] = -2;
          padAt[l][k] = -1;
        }
      }
    });
  }

  // Особые зазоры между классами (например, 6 мм от 230 В): статичные запреты от площадок
  // и динамические ореолы от проведённых дорожек.
  const classNames = [...new Set(cls.map((c) => c.name))];
  const classIdx = new Map(classNames.map((c, i) => [c, i]));
  const special: { a: number; b: number; d: number }[] = [];
  for (let a = 0; a < classNames.length; a++)
    for (let b = 0; b < classNames.length; b++) {
      if (a === b) continue;
      const ca = p.netClasses[classNames[a]];
      const cb = p.netClasses[classNames[b]];
      const need = requiredClearance(R, ca, cb);
      if (need > Math.max(ca.clearance, cb.clearance, R.minClearance) + 1e-9) special.push({ a, b, d: need });
    }
  const forbid: Uint8Array[] = classNames.map(() => new Uint8Array(N));
  const haloCnt: Uint16Array[] = classNames.map(() => new Uint16Array(N));
  if (special.length)
    for (const pd of pads) {
      if (pd.n < 0) continue;
      const ca = classIdx.get(cls[pd.n].name)!;
      for (const sp of special) {
        if (sp.a !== ca) continue;
        const hwB = p.netClasses[classNames[sp.b]].trackWidth / 2;
        const r = sp.d + hwB + G * 0.51;
        const center = { x: (pd.wp.shape.box.minX + pd.wp.shape.box.maxX) / 2, y: (pd.wp.shape.box.minY + pd.wp.shape.box.maxY) / 2 };
        const reach = Math.hypot(pd.wp.shape.box.maxX - pd.wp.shape.box.minX, pd.wp.shape.box.maxY - pd.wp.shape.box.minY) / 2 + r;
        mark(center.x, center.y, reach, (k) => {
          if (distPointShape({ x: cx(k), y: cy(k) }, pd.wp.shape) <= r) forbid[sp.b][k] = 1;
        });
      }
    }
  const haloOf = cls.map((c) => {
    const a = classIdx.get(c.name)!;
    return special.filter((s) => s.a === a).map((s) => ({ b: s.b, r: s.d + p.netClasses[classNames[s.b]].trackWidth / 2 + c.trackWidth / 2 }));
  });
  const classOfNet = cls.map((c) => classIdx.get(c.name)!);

  // Области правил.
  const areas = Object.values(p.ruleAreas).map((ra) => ({ ra, box: boxOfPoints(ra.outline), allowed: ra.onlyClasses ? new Set(ra.onlyClasses) : null }));
  // По слою: действующая в клетке область (в пересечении — последняя) и запрет переходных.
  const areaAt = layerIds.map(() => new Int8Array(N).fill(-1));
  const noVia = new Uint8Array(N);
  areas.forEach((a, ai) => {
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const k = cell(i, j);
        const q = { x: cx(k), y: cy(k) };
        if (q.x < a.box.minX || q.x > a.box.maxX || q.y < a.box.minY || q.y > a.box.maxY) continue;
        if (!pointInPolygon(q, a.ra.outline)) continue;
        layerIds.forEach((lid, l) => {
          if (!a.ra.layers || a.ra.layers.includes(lid)) areaAt[l][k] = ai;
        });
        if (a.ra.keepoutVias) noVia[k] = 1;
      }
  });
  const areaOk = (n: number, l: number, k: number, via: boolean): boolean => {
    if (via && noVia[k]) return false;
    const ai = areaAt[l][k];
    if (ai < 0) return true;
    const a = areas[ai];
    if (a.ra.keepoutTracks) return false;
    if (via && a.ra.keepoutVias) return false;
    if (a.allowed && !a.allowed.has(cls[n].name)) return false;
    return true;
  };

  // Сохранённые дорожки, переходные и заливка (режим keepExisting): их клетки — медь своей цепи.
  const keepSets = new Map<number, Set<number>>(); // цепь → клетки (l*N+k) уже проведённой меди
  const keepCopper = (n: number) => keepSets.get(n) ?? keepSets.set(n, new Set()).get(n)!;
  const viaNet = new Int16Array(N); // n + 1: клетка сохранённого переходного цепи n (связь слоёв)
  if (o.keepExisting) {
    const addKeep = (n: number, l: number, k: number) => {
      if (own[l][k] === -2) return;
      if (own[l][k] === -1 || own[l][k] === n) {
        own[l][k] = n;
        keepCopper(n).add(l * N + k);
      } else {
        own[l][k] = -2;
        padAt[l][k] = -1;
      }
    };
    for (const s of world.segments) {
      const netId = conn.itemNet.get(s.track.id);
      const n = netId && netId !== 'short' ? (netIndex.get(netId) ?? -1) : -1;
      const l = layerIds.indexOf(s.track.layer);
      if (l < 0) continue;
      const r = s.track.width / 2 + maxHw + maxClr + G * 0.51;
      const c = { x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 };
      mark(c.x, c.y, dist(s.a, s.b) / 2 + r, (k) => {
        const d = distPointShape({ x: cx(k), y: cy(k) }, s.shape);
        if (d > maxHw + maxClr + G * 0.51) return;
        if (n < 0) {
          own[l][k] = -2;
          return;
        }
        addKeep(n, l, k);
      });
    }
    for (const v of world.vias) {
      const netId = conn.itemNet.get(v.via.id);
      const n = netId && netId !== 'short' ? (netIndex.get(netId) ?? -1) : -1;
      mark(v.via.at.x, v.via.at.y, v.via.diameter / 2 + maxHw + maxClr + G * 0.51, (k) => {
        if (distPointShape({ x: cx(k), y: cy(k) }, v.shape) > maxHw + maxClr + G * 0.51) return;
        for (let l = 0; l < nl; l++) {
          if (n < 0) own[l][k] = -2;
          else addKeep(n, l, k);
        }
        if (n >= 0 && distPointShape({ x: cx(k), y: cy(k) }, v.shape) <= 1e-6) viaNet[k] = n + 1;
      });
    }
    // Заливка полигонов своей цепи — тоже медь: островок можно довести до ближайшего её места.
    for (const zf of conn.zoneFills) {
      const n = zf.zone.net ? netIndex.get(zf.zone.net) : undefined;
      const l = layerIds.indexOf(zf.zone.layer as CopperLayer);
      if (n === undefined || l < 0 || !zf.loops.length) continue;
      const set = keepCopper(n);
      for (let j = 0; j < ny; j++) {
        // Строка сетки: пересечения с контурами, заливка — между парами (правило чётности).
        const y = y0 + j * G;
        const xs: number[] = [];
        for (const loop of zf.loops)
          for (let a = 0, b = loop.length - 1; a < loop.length; b = a++)
            if (loop[b].y > y !== loop[a].y > y) xs.push(loop[b].x + ((y - loop[b].y) * (loop[a].x - loop[b].x)) / (loop[a].y - loop[b].y));
        xs.sort((u, v) => u - v);
        for (let q = 0; q + 1 < xs.length; q += 2)
          for (let i = Math.max(0, Math.ceil((xs[q] - x0) / G)); i <= Math.min(nx - 1, Math.floor((xs[q + 1] - x0) / G)); i++) {
            const k = cell(i, j);
            if (own[l][k] === -1 || own[l][k] === n) set.add(l * N + k);
          }
      }
    }
  }

  // Занятость клеток при согласовании.
  const occ: Uint16Array[] = [];
  const hist: Float32Array[] = [];
  const use: Uint8Array[][] = [];
  for (let l = 0; l < nl; l++) {
    occ.push(new Uint16Array(N));
    hist.push(new Float32Array(N));
  }
  for (let n = 0; n < NN; n++) {
    const a: Uint8Array[] = [];
    for (let l = 0; l < nl; l++) a.push(new Uint8Array(N));
    use.push(a);
  }
  const haloCells: number[][] = netList.map(() => []);
  let pf = 0.5;

  const forbidden = (n: number, k: number): boolean => forbid[classOfNet[n]][k] === 1 || haloCnt[classOfNet[n]][k] > 0;
  const allow = (n: number, l: number, k: number): boolean => {
    const ow = own[l][k];
    if (ow === -2) return false;
    if (ow !== -1 && ow !== n) return false;
    if (forbidden(n, k)) return false;
    return areaOk(n, l, k, false);
  };
  // Место под переходное (или площадку перемычки): клетки ближе радиус + зазор + полуширина
  // дорожки — на мелкой сетке это и диагональные клетки. Переходные друг от друга — отдельно.
  const viaR = (n: number) => Math.max(cls[n].viaDiameter, R.minViaDiameter) / 2;
  const maxViaR = Math.max(R.minViaDiameter, ...Object.values(p.netClasses).map((c) => c.viaDiameter)) / 2;
  const offsets = (r: number): number[][] => {
    const m = Math.ceil(r / G);
    const out: number[][] = [];
    for (let dj = -m; dj <= m; dj++) for (let di = -m; di <= m; di++) if ((di || dj) && Math.hypot(di, dj) * G < r - 1e-9) out.push([di, dj]);
    return out;
  };
  const viaFoot = cls.map((_, n) => offsets(Math.max(viaR(n) + maxClr + maxHw, G * 1.01)));
  // Переходные чужих цепей — не ближе суммы радиусов и зазора; своей — не ближе допуска между отверстиями.
  const viaGap = cls.map((_, n) => offsets(viaR(n) + maxClr + maxViaR));
  const holeFoot = offsets(Math.max(R.minViaDrill, ...Object.values(p.netClasses).map((c) => c.viaDrill)) + R.holeToHole);
  const viaAt = new Int16Array(N); // n + 1: переходное, поставленное при этой разводке
  const netVias: number[][] = netList.map(() => []);
  const around = (k: number, offs: number[][]): number[] | null => {
    const i = k % nx;
    const j = (k - i) / nx;
    const out: number[] = [];
    for (const [di, dj] of offs) {
      const i2 = i + di;
      const j2 = j + dj;
      if (i2 < 0 || j2 < 0 || i2 >= nx || j2 >= ny) return null;
      out.push(cell(i2, j2));
    }
    return out;
  };
  /** Клетка годится под площадку перемычки или переходное: свободна вместе с окрестностью и не на чужой площадке. */
  const landOK = (n: number, l: number, k: number): boolean => {
    if (!allow(n, l, k) || padAt[l][k] >= 0) return false;
    if (!areaOk(n, l, k, true)) return false;
    const a = around(k, viaFoot[n]);
    if (!a) return false;
    if (!a.every((k2) => (own[l][k2] === -1 || own[l][k2] === n) && !forbidden(n, k2))) return false;
    if (viaNet[k] || viaAt[k]) return false;
    const g = around(k, viaGap[n]);
    if (!g || g.some((k2) => (viaAt[k2] && viaAt[k2] !== n + 1) || (viaNet[k2] && viaNet[k2] !== n + 1))) return false;
    const h = around(k, holeFoot);
    return !!h && !h.some((k2) => viaAt[k2] === n + 1 || viaNet[k2] === n + 1);
  };

  const addUse = (n: number, l: number, k: number) => {
    if (!use[n][l][k]) {
      use[n][l][k] = 1;
      occ[l][k]++;
    }
  };
  const clearNet = (n: number) => {
    for (let l = 0; l < nl; l++) {
      const u = use[n][l];
      for (let k = 0; k < N; k++)
        if (u[k]) {
          u[k] = 0;
          occ[l][k]--;
        }
    }
    for (const kk of haloCells[n]) haloCnt[kk >> 24][kk & 0xffffff]--;
    haloCells[n] = [];
    for (const kk of netVias[n]) if (viaAt[kk] === n + 1) viaAt[kk] = 0;
    netVias[n] = [];
  };
  const addHalo = (n: number, k: number) => {
    for (const h of haloOf[n]) {
      const x = cx(k);
      const y = cy(k);
      mark(x, y, h.r, (k2) => {
        if (Math.hypot(cx(k2) - x, cy(k2) - y) <= h.r) {
          haloCnt[h.b][k2]++;
          haloCells[n].push((h.b << 24) | k2);
        }
      });
    }
  };
  const stepCost = layerIds.map((_, l) => o.layerCost?.[l] ?? 1);
  const cc = (n: number, l: number, k: number) => stepCost[l] + hist[l][k] + pf * (occ[l][k] - use[n][l][k]);

  // Поиск A* по состояниям (слой, клетка, направление).
  const NS = N * nl * 4;
  const dist_ = new Float64Array(NS);
  const prev = new Int32Array(NS);
  const hop = new Uint8Array(NS); // 0 — шаг, 1 — перемычка, 2 — переходное, 3 — сохранённое переходное
  const closed = new Uint8Array(NS);
  const sid = (l: number, k: number, d: number) => ((l * N + k) << 2) | d;
  type Step = { l: number; k: number; hop: number };

  function astar(n: number, src: number[], isTarget: (l: number, k: number) => boolean, tb: number[]): Step[] | null {
    dist_.fill(Infinity);
    prev.fill(-1);
    hop.fill(0);
    closed.fill(0);
    const hk: number[] = [];
    const hd: number[] = [];
    const hh = (k: number) => {
      const i = k % nx;
      const j = (k - i) / nx;
      return Math.max(0, tb[0] - i, i - tb[2]) + Math.max(0, tb[1] - j, j - tb[3]);
    };
    const push = (s: number, d: number) => {
      hk.push(s);
      hd.push(d);
      let i = hk.length - 1;
      while (i > 0) {
        const q = (i - 1) >> 1;
        if (hd[q] <= hd[i]) break;
        [hk[q], hk[i]] = [hk[i], hk[q]];
        [hd[q], hd[i]] = [hd[i], hd[q]];
        i = q;
      }
    };
    const pop = () => {
      const s = hk[0];
      const ls = hk.pop()!;
      const ld = hd.pop()!;
      if (hk.length) {
        hk[0] = ls;
        hd[0] = ld;
        let i = 0;
        for (;;) {
          const a = 2 * i + 1;
          const b = a + 1;
          let m = i;
          if (a < hk.length && hd[a] < hd[m]) m = a;
          if (b < hk.length && hd[b] < hd[m]) m = b;
          if (m === i) break;
          [hk[m], hk[i]] = [hk[i], hk[m]];
          [hd[m], hd[i]] = [hd[i], hd[m]];
          i = m;
        }
      }
      return s;
    };
    const srcSet = new Set(src);
    for (const lk of src)
      for (let d = 0; d < 4; d++) {
        const s = (lk << 2) | d;
        dist_[s] = 0;
        push(s, hh(lk % N));
      }
    while (hk.length) {
      const s = pop();
      if (closed[s]) continue;
      closed[s] = 1;
      const lk = s >> 2;
      const dir = s & 3;
      const l = Math.floor(lk / N);
      const k = lk - l * N;
      const d = dist_[s];
      if (!srcSet.has(lk) && isTarget(l, k)) {
        const path: Step[] = [];
        let st = s;
        while (st >= 0) {
          const lk2 = st >> 2;
          const l2 = Math.floor(lk2 / N);
          path.push({ l: l2, k: lk2 - l2 * N, hop: hop[st] });
          st = prev[st];
        }
        return path.reverse();
      }
      const i = k % nx;
      const j = (k - i) / nx;
      for (let nd = 0; nd < 4; nd++) {
        const i2 = i + DI[nd];
        const j2 = j + DJ[nd];
        if (i2 < 0 || j2 < 0 || i2 >= nx || j2 >= ny) continue;
        const k2 = cell(i2, j2);
        if (!allow(n, l, k2)) continue;
        const c = d + cc(n, l, k2) + (nd !== dir ? 2.5 : 0);
        const s2 = sid(l, k2, nd);
        if (c < dist_[s2]) {
          dist_[s2] = c;
          prev[s2] = s;
          hop[s2] = 0;
          push(s2, c + hh(k2));
        }
      }
      // Переходное: смена слоя в этой же клетке. Площадка переходного занимает и соседние
      // клетки на всех слоях — их занятость входит в цену, иначе спор не виден поиску.
      // Сохранённое переходное своей цепи — смена слоя без нового отверстия.
      if (nl > 1 && viaNet[k] === n + 1)
        for (let l2 = 0; l2 < nl; l2++) {
          if (l2 === l || !allow(n, l2, k)) continue;
          const c = d + cc(n, l2, k);
          const s2 = sid(l2, k, dir);
          if (c < dist_[s2]) {
            dist_[s2] = c;
            prev[s2] = s;
            hop[s2] = 3;
            push(s2, c + hh(k));
          }
        }
      if (allowVias && nl > 1 && landOK(n, l, k)) {
        const foot = around(k, viaFoot[n])!;
        let vc = 0;
        for (let l3 = 0; l3 < nl; l3++) {
          for (const q of foot) vc += pf * (occ[l3][q] - use[n][l3][q]);
          if (l3 !== l) vc += pf * (occ[l3][k] - use[n][l3][k]);
        }
        for (let l2 = 0; l2 < nl; l2++) {
          if (l2 === l || !landOK(n, l2, k)) continue;
          const c = d + hopCost + cc(n, l2, k) + vc;
          const s2 = sid(l2, k, dir);
          if (c < dist_[s2]) {
            dist_[s2] = c;
            prev[s2] = s;
            hop[s2] = 2;
            push(s2, c + hh(k));
          }
        }
      }
      // Перемычка проводом: прыжок по прямой на 3…12 клеток на том же слое.
      if (allowWires && landOK(n, l, k) && !(padAt[l][k] >= 0 && !srcSet.has(lk))) {
        const lc = around(k, viaFoot[n])!.reduce((a, k2) => a + pf * (occ[l][k2] - use[n][l][k2]), 0);
        for (let nd = 0; nd < 4; nd++)
          for (let L = 3; L <= 12; L++) {
            const i2 = i + DI[nd] * L;
            const j2 = j + DJ[nd] * L;
            if (i2 < 0 || j2 < 0 || i2 >= nx || j2 >= ny) break;
            const k2 = cell(i2, j2);
            if (!landOK(n, l, k2)) continue;
            const c = d + hopCost + L + cc(n, l, k2) + lc + around(k2, viaFoot[n])!.reduce((a, q) => a + pf * (occ[l][q] - use[n][l][q]), 0);
            const s2 = sid(l, k2, nd);
            if (c < dist_[s2]) {
              dist_[s2] = c;
              prev[s2] = s;
              hop[s2] = 1;
              push(s2, c + hh(k2));
            }
          }
      }
    }
    return null;
  }

  // Порядок: сначала сигнальные короткие цепи, питание в конце (оно шире и гибче).
  const members: number[][] = netList.map((net) => pads.map((pd, i) => (pd.n >= 0 && pd.wp.net === net.id ? i : -1)).filter((i) => i >= 0));
  const routable = netList.map((net, n) => {
    if (members[n].length < 2) return false;
    if (o.keepExisting) return !(conn.nets.get(net.id)?.complete ?? true);
    return true;
  });
  const lenEst = (n: number) => {
    const m = members[n].map((i) => pads[i].wp.center);
    let L = 0;
    const done = [m[0]];
    const left = m.slice(1);
    while (left.length) {
      let b: { d: number; i: number } | null = null;
      left.forEach((a, ai) => done.forEach((q) => {
        const d = Math.abs(a.x - q.x) + Math.abs(a.y - q.y);
        if (!b || d < b.d) b = { d, i: ai };
      }));
      L += b!.d;
      done.push(left[b!.i]);
      left.splice(b!.i, 1);
    }
    return L;
  };
  const order = netList.map((_, i) => i).filter((i) => routable[i]);
  const Ln = new Map(order.map((i) => [i, lenEst(i)]));
  const isPower = (i: number) => cls[i].trackWidth > cls.reduce((a, c) => Math.min(a, c.trackWidth), 1e9) + 1e-9;
  order.sort((a, b) => Number(isPower(a)) - Number(isPower(b)) || Ln.get(a)! - Ln.get(b)!);

  type Conn = { padIdx: number; path: Step[] | null; fallback: number | null };
  const results: Conn[][] = netList.map(() => []);
  const cellsOfPad = (pi: number, n: number): number[] => {
    const out: number[] = [];
    const pd = pads[pi];
    const c = pd.wp.center;
    const reach = Math.hypot(pd.wp.shape.box.maxX - pd.wp.shape.box.minX, pd.wp.shape.box.maxY - pd.wp.shape.box.minY) / 2 + maxHw + maxClr + G;
    for (const l of pd.layers) mark(c.x, c.y, reach, (k) => {
      if (own[l][k] === n && padAt[l][k] === pi) out.push(l * N + k);
    });
    return out;
  };

  /**
   * Сохранённая медь цепи, связанная с данными площадками: обход клеток по слою и между
   * слоями — в переходных и выводах со сквозным отверстием. Считается один раз на цепь.
   */
  const keptCache = new Map<number, number[]>();
  function keptTree(n: number, padIdx: number[]): number[] {
    const hit = keptCache.get(n);
    if (hit) return hit;
    const set = keepSets.get(n);
    const out: number[] = [];
    if (set?.size) {
      const seen = new Set<number>();
      const stack: number[] = [];
      for (const pi of padIdx) for (const lk of cellsOfPad(pi, n)) if (!seen.has(lk)) (seen.add(lk), stack.push(lk));
      const copper = (l: number, k: number) => set.has(l * N + k) || (own[l][k] === n && padAt[l][k] >= 0);
      while (stack.length) {
        const lk = stack.pop()!;
        const l = Math.floor(lk / N);
        const k = lk - l * N;
        if (set.has(lk)) out.push(lk);
        const i = k % nx;
        const j = (k - i) / nx;
        const next: number[] = [];
        if (i > 0) next.push(l * N + k - 1);
        if (i < nx - 1) next.push(l * N + k + 1);
        if (j > 0) next.push(l * N + k - nx);
        if (j < ny - 1) next.push(l * N + k + nx);
        const pa = padAt[l][k];
        if (viaNet[k] === n + 1 || (pa >= 0 && pads[pa].layers.length > 1)) for (let l2 = 0; l2 < nl; l2++) if (l2 !== l) next.push(l2 * N + k);
        for (const q of next) {
          if (seen.has(q)) continue;
          const l2 = Math.floor(q / N);
          if (!copper(l2, q - l2 * N)) continue;
          seen.add(q);
          stack.push(q);
        }
      }
    }
    keptCache.set(n, out);
    return out;
  }

  function routeNet(n: number) {
    clearNet(n);
    const conns: Conn[] = [];
    const mem = members[n];
    const tree = new Uint8Array(N * nl);
    const inTree = new Set<number>();
    const tb = [1e9, 1e9, -1e9, -1e9];
    const grow = (k: number) => {
      const i = k % nx;
      const j = (k - i) / nx;
      tb[0] = Math.min(tb[0], i);
      tb[1] = Math.min(tb[1], j);
      tb[2] = Math.max(tb[2], i);
      tb[3] = Math.max(tb[3], j);
    };
    const seed = (lk: number) => {
      tree[lk] = 1;
      addUse(n, Math.floor(lk / N), lk % N);
      grow(lk % N);
    };
    // Начальное дерево: первая площадка, площадки её островка и связанная с ними сохранённая медь.
    for (const lk of cellsOfPad(mem[0], n)) seed(lk);
    inTree.add(mem[0]);
    if (o.keepExisting) {
      const st = conn.nets.get(netList[n].id);
      const first = pads[mem[0]].wp.key;
      const island = st?.islands.find((is) => is.pads.includes(first));
      if (island) for (const pk of island.pads) {
        const pi = padIndexByKey.get(pk);
        if (pi !== undefined && !inTree.has(pi)) {
          for (const lk of cellsOfPad(pi, n)) seed(lk);
          inTree.add(pi);
        }
      }
      for (const lk of keptTree(n, [...inTree])) seed(lk);
    }
    const left = mem.filter((pi) => !inTree.has(pi));
    while (left.length) {
      // Ближайшая к дереву площадка.
      let bi = 0;
      let bd = 1e18;
      left.forEach((pi, i) => {
        for (const q of inTree) {
          const d = dist(pads[pi].wp.center, pads[q].wp.center);
          if (d < bd) {
            bd = d;
            bi = i;
          }
        }
      });
      const pi = left.splice(bi, 1)[0];
      const src = cellsOfPad(pi, n);
      const path = src.length ? astar(n, src, (l, k) => tree[l * N + k] === 1, tb) : null;
      if (!path) {
        let best: number | null = null;
        let bdist = 1e18;
        for (const q of inTree) {
          const d = dist(pads[pi].wp.center, pads[q].wp.center);
          if (d < bdist) {
            bdist = d;
            best = q;
          }
        }
        conns.push({ padIdx: pi, path: null, fallback: best });
      } else {
        conns.push({ padIdx: pi, path, fallback: null });
        for (let i = 0; i < path.length; i++) {
          const st = path[i];
          seed(st.l * N + st.k);
          addHalo(n, st.k);
          if (i > 0 && (st.hop === 1 || st.hop === 2)) {
            // Площадки перемычки или переходного занимают и окрестность.
            const pr = path[i - 1];
            for (const [ll, kk] of [[pr.l, pr.k], [st.l, st.k]] as [number, number][]) {
              const a = around(kk, viaFoot[n]);
              if (a) for (const q of a) addUse(n, ll, q);
              if (st.hop === 2) for (let l2 = 0; l2 < nl; l2++) {
                addUse(n, l2, kk);
                if (a) for (const q of a) addUse(n, l2, q);
              }
            }
            if (st.hop === 2 && !viaAt[st.k]) {
              viaAt[st.k] = n + 1;
              netVias[n].push(st.k);
            }
          }
        }
      }
      for (const lk of src) seed(lk);
      inTree.add(pi);
    }
    results[n] = conns;
  }

  const tick = () => new Promise<void>((r) => setTimeout(r, 0));
  let over = 0;
  let it = 0;
  for (it = 0; it < iters; it++) {
    pf = 0.5 * Math.pow(o.congestionGrowth ?? 1.7, it);
    for (let q = 0; q < order.length; q++) {
      routeNet(order[q]);
      if (q % yieldEvery === yieldEvery - 1) await tick();
    }
    over = 0;
    for (let l = 0; l < nl; l++) for (let k = 0; k < N; k++) if (occ[l][k] > 1) {
      over++;
      hist[l][k] += 0.8;
    }
    if (o.progress) await o.progress({ iteration: it + 1, conflicts: over, fraction: Math.min(1, (it + 1) / iters) });
    await tick();
    if (!over) break;
  }
  // Последняя попытка: спорные цепи снимаются все сразу и ведутся заново по одной с
  // запретительной ценой конфликта — то в прямом, то в обратном порядке; со второго круга
  // снимаются и цепи, проходящие рядом со спорными клетками, чтобы освободить место.
  if (over) {
    pf = 1e5;
    // Лучшее состояние (меньше всего спорных клеток): круг может и ухудшить — тогда вернёмся.
    const snap = () => ({
      over,
      use: use.map((a) => a.map((u) => u.slice())),
      occ: occ.map((u) => u.slice()),
      results: results.slice(),
      haloCnt: haloCnt.map((u) => u.slice()),
      haloCells: haloCells.map((u) => u.slice()),
      viaAt: viaAt.slice(),
      netVias: netVias.map((u) => u.slice()),
    });
    let best = snap();
    for (let pass = 0; pass < 8 && over; pass++) {
      const bad = new Set<number>();
      const r = pass >= 2 ? 2 : 0;
      for (let l = 0; l < nl; l++)
        for (let k = 0; k < N; k++) {
          if (occ[l][k] < 2) continue;
          const i = k % nx;
          const j = (k - i) / nx;
          for (let dj = -r; dj <= r; dj++)
            for (let di = -r; di <= r; di++) {
              const i2 = i + di;
              const j2 = j + dj;
              if (i2 < 0 || j2 < 0 || i2 >= nx || j2 >= ny) continue;
              const k2 = cell(i2, j2);
              for (let l2 = 0; l2 < nl; l2++) if (occ[l2][k2]) for (let n = 0; n < NN; n++) if (use[n][l2][k2]) bad.add(n);
            }
        }
      const list = order.filter((n) => bad.has(n));
      if (pass % 2) list.reverse();
      for (const n of list) clearNet(n);
      for (const n of list) routeNet(n);
      over = 0;
      for (let l = 0; l < nl; l++) for (let k = 0; k < N; k++) if (occ[l][k] > 1) over++;
      if (over < best.over) best = snap();
      await tick();
    }
    if (over > best.over) {
      over = best.over;
      best.use.forEach((a, n) => a.forEach((u, l) => use[n][l].set(u)));
      best.occ.forEach((u, l) => occ[l].set(u));
      best.results.forEach((r, n) => (results[n] = r));
      best.haloCnt.forEach((u, c) => haloCnt[c].set(u));
      best.haloCells.forEach((u, n) => (haloCells[n] = u));
      viaAt.set(best.viaAt);
      best.netVias.forEach((u, n) => (netVias[n] = u));
    }
  }
  const hot: { x: number; y: number; layer: CopperLayer }[] = [];
  if (over) for (let l = 0; l < nl; l++) for (let k = 0; k < N; k++) if (occ[l][k] > 1) hot.push({ x: +cx(k).toFixed(3), y: +cy(k).toFixed(3), layer: layerIds[l] });
  // Что осталось в конфликте — превращаем в прямые перемычки.
  if (over)
    for (const n of order)
      for (const c of results[n])
        if (c.path && c.path.some((st) => occ[st.l][st.k] > 1)) {
          c.path = null;
        }

  // Сборка дорожек.
  const tracks: Omit<Track, 'id'>[] = [];
  const vias: Omit<Via, 'id'>[] = [];
  const wires: { a: Vec2; b: Vec2 }[] = [];
  let failed = 0;
  const pt = (k: number): Vec2 => ({ x: +cx(k).toFixed(4), y: +cy(k).toFixed(4) });
  const viaKey = new Set<string>();
  const addViaAt = (q: Vec2, n: number) => {
    const key = `${q.x},${q.y}`;
    if (viaKey.has(key)) return;
    viaKey.add(key);
    vias.push({ at: q, diameter: Math.max(cls[n].viaDiameter, R.minViaDiameter), drill: Math.max(cls[n].viaDrill, R.minViaDrill) });
  };
  for (const n of order) {
    const w = +Math.max(cls[n].trackWidth, R.minTrackWidth).toFixed(3);
    const inTree = new Set<number>([members[n][0]]);
    for (const c of results[n]) {
      const pd = pads[c.padIdx];
      if (!c.path) {
        failed++;
        let tgt = c.fallback;
        if (tgt === null) {
          let bd = 1e18;
          for (const q of inTree) {
            const d = dist(pd.wp.center, pads[q].wp.center);
            if (d < bd) {
              bd = d;
              tgt = q;
            }
          }
        }
        if (tgt !== null) wires.push({ a: pd.wp.center, b: pads[tgt].wp.center });
        inTree.add(c.padIdx);
        continue;
      }
      // Режем путь на куски между прыжками.
      const pieces: Step[][] = [[c.path[0]]];
      for (let i = 1; i < c.path.length; i++) {
        if (c.path[i].hop) pieces.push([c.path[i]]);
        else pieces[pieces.length - 1].push(c.path[i]);
      }
      const last = c.path[c.path.length - 1];
      const endPadIdx = padAt[last.l][last.k];
      pieces.forEach((cells, pi) => {
        const pts: Vec2[] = [];
        const first = pi === 0;
        const isLast = pi === pieces.length - 1;
        if (first) pts.push(pd.wp.center);
        for (let i = 0; i < cells.length; i++) {
          const q = pt(cells[i].k);
          if (i > 0 && i < cells.length - 1) {
            const a = pt(cells[i - 1].k);
            const b = pt(cells[i + 1].k);
            if ((q.x - a.x) * (b.y - q.y) === (q.y - a.y) * (b.x - q.x)) continue; // коллинеарно
          }
          pts.push(q);
        }
        if (isLast && endPadIdx >= 0 && own[last.l][last.k] === n) pts.push(pads[endPadIdx].wp.center);
        const clean = pts.filter((q, i) => i === 0 || dist(q, pts[i - 1]) > 1e-6);
        if (clean.length >= 2) tracks.push({ layer: layerIds[cells[0].l], width: w, points: clean });
      });
      // Прыжки: перемычка между концами соседних кусков или переходное.
      for (let i = 1; i < c.path.length; i++) {
        const st = c.path[i];
        if (!st.hop || st.hop === 3) continue;
        const pr = c.path[i - 1];
        if (st.hop === 2) addViaAt(pt(st.k), n);
        else {
          const a = pt(pr.k);
          const b = pt(st.k);
          addViaAt(a, n);
          addViaAt(b, n);
          wires.push({ a, b });
        }
      }
      inTree.add(c.padIdx);
    }
  }
  return { tracks, vias, wires, failed, conflicts: over, iterations: it + 1, grid: G, ms: Date.now() - t0, hot };
}
