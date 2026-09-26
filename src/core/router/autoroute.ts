import { boxOfPoints, pointInPolygon, distToPolygonEdge } from '../math/geom';
import { distPointShape } from '../math/shape';
import { dist, type Vec2 } from '../math/vec';
import { computeConnectivity } from '../model/connectivity';
import { boardCopperLayers } from '../model/layers';
import { boardPolygon } from '../model/project';
import { netClassOf, requiredClearance } from '../model/rules';
import type { CopperLayer, Id, NetClass, Project, Track, Via } from '../model/types';
import { getWorld, type WorldPad } from '../model/world';
import { rng } from '../math/random';

export { rng };

/*
 * Автотрассировка методом согласования конфликтов (PathFinder):
 * все цепи разводятся по сетке независимо, спорные клетки дорожают,
 * и за несколько проходов конфликты рассасываются. Работает на одном
 * слое (с перемычками проводом) и на двух (с переходными отверстиями).
 * Дорожки идут по сетке прямо и под 45°: диагональ проходит через угол
 * квадрата из четырёх клеток, и две диагонали одного квадрата — спор.
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
  /** Дорожки под 45° (по умолчанию — да). */
  diagonal?: boolean;
  /** Порядок цепей: короткие первыми (по умолчанию), длинные первыми, случайно (по seed). */
  order?: 'short' | 'long' | 'random';
  /** Семя случайности: порядок цепей и разброс цены изгиба — у каждого варианта своё. */
  seed?: number;
  /** Цена изгиба на 90° в клетках (по умолчанию 2,5); на 45° — треть. */
  bendCost?: number;
  /** Помехоопасные цепи (ШИМ, ключи, кварц) и чувствительные (аналог, датчики): расходятся. */
  noisy?: Id[];
  sensitive?: Id[];
  /** На каком расстоянии чувствительная цепь «слышит» помехоопасную, мм (по умолчанию 2), и доплата за клетку. */
  noiseDistance?: number;
  noiseCost?: number;
  /** Перемычка проводом: длина от и до, мм (по умолчанию 3,8…20). */
  wireMin?: number;
  wireMax?: number;
  /** Во сколько раз завышать оценку остатка пути в A* (1 — точный поиск, по умолчанию 1,15). */
  greed?: number;
  /** Чистовой проход после согласования (по умолчанию — да). */
  polish?: boolean;
  /**
   * План (из распутывания паутины): какие выводы с какими соединять, какие связи пускать
   * перемычкой (на одной стороне) и на каком слое вести (0 — верхний, 1 — нижний).
   */
  plan?: RoutePlanEdge[];
  /** Множители цены перемычки по плану: запланированной и остальным (по умолчанию 0,5 и 3). */
  planHop?: [number, number];
  /** Соединять выводы в порядке дерева плана (по умолчанию — да). */
  planOrder?: boolean;
}

export interface RoutePlanEdge {
  net: Id;
  /** Ключи выводов (padKey). */
  a: string;
  b: string;
  jump?: boolean;
  layer?: 0 | 1;
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
  /** Цепей, улучшенных чистовым проходом. */
  polished?: number;
}

// Направления: 0…3 — прямо (→ ↓ ← ↑), 4…7 — диагонали (↘ ↙ ↖ ↗).
const DI = [1, 0, -1, 0, 1, -1, -1, 1];
const DJ = [0, 1, 0, -1, 1, 1, -1, -1];
const DIAG = Math.SQRT2;

/** Цена поворота с направления a на b (0 — прямо, 45°, 90°, 135°). */
function turnCost(a: number, b: number, bend: number): number {
  if (a === b) return 0;
  const ang = (d: number) => (d < 4 ? d * 2 : [1, 3, 5, 7][d - 4]); // в восьмушках оборота
  let t = Math.abs(ang(a) - ang(b)) % 8;
  if (t > 4) t = 8 - t;
  return t === 1 ? bend / 3 : t === 2 ? bend : t === 3 ? bend * 4 : bend * 8;
}

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
  // Свои площадки цепи из запретов своего класса исключаются: деталь стоит где стоит (оптрон
  // поперёк изоляционного зазора), зазор между её выводами — её собственная изоляция, его
  // проверяет DRC; трассировщику нужно только выйти из вывода — дальше запрет действует.
  if (special.length)
    for (let l = 0; l < nl; l++)
      for (let k = 0; k < N; k++) {
        const pi = padAt[l][k];
        if (pi < 0 || pads[pi].n < 0) continue;
        forbid[classIdx.get(cls[pads[pi].n].name)!][k] = 0;
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

  // Занятость клеток при согласовании. Углы (cocc) — точки между четырьмя клетками, через
  // которые идут диагонали: две диагонали одного квадрата пересеклись бы.
  const occ: Uint16Array[] = [];
  const cocc: Uint16Array[] = [];
  const hist: Float32Array[] = [];
  const use: Uint8Array[][] = [];
  const cuse: Uint8Array[][] = [];
  for (let l = 0; l < nl; l++) {
    occ.push(new Uint16Array(N));
    cocc.push(new Uint16Array(N));
    hist.push(new Float32Array(N));
  }
  for (let n = 0; n < NN; n++) {
    const a: Uint8Array[] = [];
    const c: Uint8Array[] = [];
    for (let l = 0; l < nl; l++) {
      a.push(new Uint8Array(N));
      c.push(new Uint8Array(N));
    }
    use.push(a);
    cuse.push(c);
  }
  const haloCells: number[][] = netList.map(() => []);
  let pf = 0.5;
  const diagonal = o.diagonal ?? true;
  const ND = diagonal ? 8 : 4;
  const random = rng(o.seed ?? 1);
  const bend = (o.bendCost ?? 2.5) * (o.seed ? 0.8 + 0.4 * random() : 1);
  // Диагональ проходит в G/√2 от центров двух боковых клеток: если это ближе нужного зазора,
  // боковые клетки тоже заняты этой цепью (иначе рядом пройдёт чужая дорожка).
  const need = 2 * maxHw + maxClr;
  const diagSide = G * Math.SQRT1_2 < need - 1e-9;

  // Помехоопасные и чувствительные цепи: вокруг их меди — поле, по которому другой группе дороже.
  const roleOf = new Uint8Array(NN); // 1 — помехоопасная, 2 — чувствительная
  for (const id of o.noisy ?? []) if (netIndex.has(id)) roleOf[netIndex.get(id)!] = 1;
  for (const id of o.sensitive ?? []) if (netIndex.has(id)) roleOf[netIndex.get(id)!] = 2;
  const noiseF = new Uint16Array(N);
  const sensF = new Uint16Array(N);
  const noiseCost = o.noiseCost ?? 3;
  const noiseOffs: number[][] = [];
  {
    const r = (o.noiseDistance ?? 2) + maxHw * 2;
    const m = Math.ceil(r / G);
    for (let dj = -m; dj <= m; dj++) for (let di = -m; di <= m; di++) if (Math.hypot(di, dj) * G <= r) noiseOffs.push([di, dj]);
  }
  const noiseCells: number[][] = netList.map(() => []);
  const markNoise = (n: number, k: number) => {
    const role = roleOf[n];
    if (!role) return;
    const f = role === 1 ? noiseF : sensF;
    const i = k % nx;
    const j = (k - i) / nx;
    for (const [di, dj] of noiseOffs) {
      const i2 = i + di;
      const j2 = j + dj;
      if (i2 < 0 || j2 < 0 || i2 >= nx || j2 >= ny) continue;
      const k2 = cell(i2, j2);
      f[k2]++;
      noiseCells[n].push(k2);
    }
  };

  const forbidden = (n: number, k: number): boolean => forbid[classOfNet[n]][k] === 1 || haloCnt[classOfNet[n]][k] > 0;
  // Статичное «можно» по классу цепи: край платы, чужие площадки (-2), запреты классов, области правил.
  const staticOk: Uint8Array[] = classNames.map((name, ci) => {
    const a = new Uint8Array(N * nl);
    const nRep = cls.findIndex((c) => c.name === name);
    for (let l = 0; l < nl; l++)
      for (let k = 0; k < N; k++) a[l * N + k] = own[l][k] !== -2 && !forbid[ci][k] && (nRep < 0 || areaOk(nRep, l, k, false)) ? 1 : 0;
    return a;
  });
  const allow = (n: number, l: number, k: number): boolean => {
    const ci = classOfNet[n];
    if (!staticOk[ci][l * N + k]) return false;
    const ow = own[l][k];
    if (ow !== -1 && ow !== n) return false;
    return haloCnt[ci][k] === 0;
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
  const landCheck = (n: number, l: number, k: number): boolean => {
    if (!allow(n, l, k) || padAt[l][k] >= 0) return false;
    if (!areaOk(n, l, k, true)) return false;
    if (viaNet[k] || viaAt[k]) return false;
    const i = k % nx;
    const j = (k - i) / nx;
    for (const [di, dj] of viaFoot[n]) {
      const i2 = i + di;
      const j2 = j + dj;
      if (i2 < 0 || j2 < 0 || i2 >= nx || j2 >= ny) return false;
      const k2 = j2 * nx + i2;
      if ((own[l][k2] !== -1 && own[l][k2] !== n) || forbidden(n, k2)) return false;
    }
    for (const [di, dj] of viaGap[n]) {
      const i2 = i + di;
      const j2 = j + dj;
      if (i2 < 0 || j2 < 0 || i2 >= nx || j2 >= ny) return false;
      const k2 = j2 * nx + i2;
      if ((viaAt[k2] && viaAt[k2] !== n + 1) || (viaNet[k2] && viaNet[k2] !== n + 1)) return false;
    }
    for (const [di, dj] of holeFoot) {
      const i2 = i + di;
      const j2 = j + dj;
      if (i2 < 0 || j2 < 0 || i2 >= nx || j2 >= ny) return false;
      const k2 = j2 * nx + i2;
      if (viaAt[k2] === n + 1 || viaNet[k2] === n + 1) return false;
    }
    return true;
  };
  // Внутри одного поиска ответ не меняется — запоминаем (метка поколения, как у состояний).
  const landGen = new Uint32Array(N * nl);
  const landVal = new Uint8Array(N * nl);
  let searchGen = 0;
  const landOK = (n: number, l: number, k: number): boolean => {
    const q = l * N + k;
    if (landGen[q] !== searchGen) {
      landGen[q] = searchGen;
      landVal[q] = landCheck(n, l, k) ? 1 : 0;
    }
    return landVal[q] === 1;
  };

  const addUse = (n: number, l: number, k: number) => {
    if (!use[n][l][k]) {
      use[n][l][k] = 1;
      occ[l][k]++;
    }
  };
  const addCorner = (n: number, l: number, c: number) => {
    if (!cuse[n][l][c]) {
      cuse[n][l][c] = 1;
      cocc[l][c]++;
    }
  };
  const clearNet = (n: number) => {
    for (let l = 0; l < nl; l++) {
      const u = use[n][l];
      const cu = cuse[n][l];
      for (let k = 0; k < N; k++) {
        if (u[k]) {
          u[k] = 0;
          occ[l][k]--;
        }
        if (cu[k]) {
          cu[k] = 0;
          cocc[l][k]--;
        }
      }
    }
    for (const kk of haloCells[n]) haloCnt[kk >> 24][kk & 0xffffff]--;
    haloCells[n] = [];
    for (const kk of netVias[n]) if (viaAt[kk] === n + 1) viaAt[kk] = 0;
    netVias[n] = [];
    const f = roleOf[n] === 1 ? noiseF : sensF;
    for (const k of noiseCells[n]) f[k]--;
    noiseCells[n] = [];
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
  // Чистовой проход: без истории споров и с дорогими прыжками (см. ниже).
  let histW = 1;
  let hopMul = 1;
  const minStep = Math.min(...stepCost);
  // Связь по плану: предпочтительный слой (другой дороже) и цена перемычки.
  let prefLayer = -1;
  let connHop = 1;
  const cc = (n: number, l: number, k: number) => {
    let c = stepCost[l] * (prefLayer >= 0 && l !== prefLayer ? 1.8 : 1) + histW * hist[l][k] + pf * (occ[l][k] - use[n][l][k]);
    const role = roleOf[n];
    if (role === 2 && noiseF[k]) c += noiseCost;
    else if (role === 1 && sensF[k]) c += noiseCost * 0.5;
    return c;
  };
  /** Диагональ из k в k2: угол квадрата и две боковые клетки. */
  const diagParts = (k: number, k2: number): [number, number, number] => {
    const i = k % nx;
    const j = (k - i) / nx;
    const i2 = k2 % nx;
    const j2 = (k2 - i2) / nx;
    return [cell(Math.min(i, i2), Math.min(j, j2)), cell(i2, j), cell(i, j2)];
  };

  // Поиск A* по состояниям (слой, клетка, направление). Вместо очистки массивов перед каждой
  // связью — метки поколения: состояние считается посещённым, только если его метка текущая.
  const NS = N * nl * ND;
  const dist_ = new Float64Array(NS);
  const prev = new Int32Array(NS);
  const hop = new Uint8Array(NS); // 0 — шаг, 1 — перемычка, 2 — переходное, 3 — сохранённое переходное
  const seenGen = new Uint32Array(NS);
  const closedGen = new Uint32Array(NS);
  let gen = 0;
  const sid = (l: number, k: number, d: number) => (l * N + k) * ND + d;
  type Step = { l: number; k: number; hop: number };
  // Немного «жадный» A*: оценка остатка чуть завышена — поиск раскрывает меньше клеток,
  // путь бывает на пару клеток длиннее оптимального.
  const greed = o.greed ?? 1.15;
  const wireMin = Math.max(2, Math.round((o.wireMin ?? 3.8) / G));
  const wireMax = Math.max(wireMin, Math.round((o.wireMax ?? 20) / G));

  const hopGen = new Uint32Array(N * nl);
  function astar(n: number, src: number[], isTarget: (l: number, k: number) => boolean, tb: number[]): Step[] | null {
    gen++;
    if (gen === 0xffffffff) {
      seenGen.fill(0);
      closedGen.fill(0);
      landGen.fill(0);
      hopGen.fill(0);
      gen = 1;
    }
    searchGen = gen;
    const hk: number[] = [];
    const hd: number[] = [];
    const hh = (k: number) => {
      const i = k % nx;
      const j = (k - i) / nx;
      const dx = Math.max(0, tb[0] - i, i - tb[2]);
      const dy = Math.max(0, tb[1] - j, j - tb[3]);
      return (diagonal ? dx + dy + (DIAG - 2) * Math.min(dx, dy) : dx + dy) * minStep * greed;
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
    const relax = (s2: number, c: number, from: number, h: number, k2: number) => {
      if (seenGen[s2] === gen && c >= dist_[s2]) return;
      seenGen[s2] = gen;
      dist_[s2] = c;
      prev[s2] = from;
      hop[s2] = h;
      push(s2, c + hh(k2));
    };
    const srcSet = new Set(src);
    for (const lk of src)
      for (let d = 0; d < ND; d++) {
        const s = lk * ND + d;
        seenGen[s] = gen;
        dist_[s] = 0;
        prev[s] = -1;
        hop[s] = 0;
        push(s, hh(lk % N));
      }
    while (hk.length) {
      const s = pop();
      if (closedGen[s] === gen) continue;
      closedGen[s] = gen;
      const lk = (s / ND) | 0;
      const dir = s - lk * ND;
      const l = (lk / N) | 0;
      const k = lk - l * N;
      const d = dist_[s];
      if (!srcSet.has(lk) && isTarget(l, k)) {
        const path: Step[] = [];
        let st = s;
        while (st >= 0) {
          const lk2 = (st / ND) | 0;
          const l2 = (lk2 / N) | 0;
          path.push({ l: l2, k: lk2 - l2 * N, hop: hop[st] });
          st = prev[st];
        }
        return path.reverse();
      }
      const i = k % nx;
      const j = (k - i) / nx;
      for (let nd = 0; nd < ND; nd++) {
        const i2 = i + DI[nd];
        const j2 = j + DJ[nd];
        if (i2 < 0 || j2 < 0 || i2 >= nx || j2 >= ny) continue;
        const k2 = cell(i2, j2);
        if (!allow(n, l, k2)) continue;
        let c = d + turnCost(dir, nd, bend);
        if (nd < 4) c += cc(n, l, k2);
        else {
          // Диагональ: боковые клетки не должны быть чужой медью; спор за угол и (на мелкой сетке) за бока.
          const [corner, s1, s2] = diagParts(k, k2);
          if (!allow(n, l, s1) || !allow(n, l, s2)) continue;
          c += cc(n, l, k2) * DIAG + pf * (cocc[l][corner] - cuse[n][l][corner]);
          if (diagSide) c += pf * (occ[l][s1] - use[n][l][s1] + occ[l][s2] - use[n][l][s2]);
        }
        relax(sid(l, k2, nd), c, s, 0, k2);
      }
      // Прыжки (переходное, перемычка) из клетки — один раз за поиск: первое (самое дешёвое)
      // раскрытие клетки, остальные направления прихода отличаются только ценой изгиба.
      if (hopGen[lk] === gen) continue;
      hopGen[lk] = gen;
      // Переходное: смена слоя в этой же клетке. Площадка переходного занимает и соседние
      // клетки на всех слоях — их занятость входит в цену, иначе спор не виден поиску.
      // Сохранённое переходное своей цепи — смена слоя без нового отверстия.
      if (nl > 1 && viaNet[k] === n + 1)
        for (let l2 = 0; l2 < nl; l2++) {
          if (l2 === l || !allow(n, l2, k)) continue;
          relax(sid(l2, k, dir), d + cc(n, l2, k), s, 3, k);
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
          relax(sid(l2, k, dir), d + hopCost * hopMul * connHop + cc(n, l2, k) + vc, s, 2, k);
        }
      }
      // Перемычка проводом: прыжок по прямой на том же слое.
      if (allowWires && landOK(n, l, k) && !(padAt[l][k] >= 0 && !srcSet.has(lk))) {
        const lc = around(k, viaFoot[n])!.reduce((a, k2) => a + pf * (occ[l][k2] - use[n][l][k2]), 0);
        for (let nd = 0; nd < 4; nd++)
          for (let L = wireMin; L <= wireMax; L++) {
            const i2 = i + DI[nd] * L;
            const j2 = j + DJ[nd] * L;
            if (i2 < 0 || j2 < 0 || i2 >= nx || j2 >= ny) break;
            const k2 = cell(i2, j2);
            if (!landOK(n, l, k2)) continue;
            const c = d + hopCost * hopMul * connHop + L * 0.5 + cc(n, l, k2) + lc + around(k2, viaFoot[n])!.reduce((a, q) => a + pf * (occ[l][q] - use[n][l][q]), 0);
            relax(sid(l, k2, nd), c, s, 1, k2);
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
  const key = new Map(order.map((i) => [i, o.order === 'random' ? random() : o.order === 'long' ? -Ln.get(i)! : Ln.get(i)!]));
  order.sort((a, b) => Number(isPower(a)) - Number(isPower(b)) || key.get(a)! - key.get(b)!);

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

  // План: связи по цепям в индексах площадок.
  const plan = o.plan?.length ? o.plan : null;
  const planByNet = new Map<number, { a: number; b: number; edge: RoutePlanEdge }[]>();
  if (plan)
    for (const e of plan) {
      const n = netIndex.get(e.net);
      const a = padIndexByKey.get(e.a);
      const b = padIndexByKey.get(e.b);
      if (n === undefined || a === undefined || b === undefined) continue;
      (planByNet.get(n) ?? planByNet.set(n, []).get(n)!).push({ a, b, edge: e });
    }
  /** Порядок выводов по дереву плана: обход от уже соединённых. */
  function planOrder(n: number, inTree: Set<number>, left: number[]): { pad: number; edge: RoutePlanEdge }[] {
    const es = planByNet.get(n);
    if (!es) return [];
    const out: { pad: number; edge: RoutePlanEdge }[] = [];
    const seen = new Set<number>(inTree);
    const queue = [...inTree];
    const want = new Set(left);
    while (queue.length) {
      const v = queue.shift()!;
      for (const e of es) {
        const u = e.a === v ? e.b : e.b === v ? e.a : -1;
        if (u < 0 || seen.has(u)) continue;
        seen.add(u);
        queue.push(u);
        if (want.has(u)) out.push({ pad: u, edge: e.edge });
      }
    }
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
    const planned = o.planOrder === false || !plan ? [] : planOrder(n, inTree, left);
    while (left.length) {
      let pi: number;
      let edge: RoutePlanEdge | undefined;
      const nextPlanned = planned.shift();
      if (nextPlanned && left.includes(nextPlanned.pad)) {
        // По плану: следующий вывод дерева распутанной паутины.
        pi = nextPlanned.pad;
        edge = nextPlanned.edge;
        left.splice(left.indexOf(pi), 1);
      } else {
        // Ближайшая к дереву площадка.
        let bi = 0;
        let bd = 1e18;
        left.forEach((q0, i) => {
          for (const q of inTree) {
            const d = dist(pads[q0].wp.center, pads[q].wp.center);
            if (d < bd) {
              bd = d;
              bi = i;
            }
          }
        });
        pi = left.splice(bi, 1)[0];
      }
      const src = cellsOfPad(pi, n);
      // Запланированной «через верх» связи перемычка дешевле, остальным — дороже; слой — по плану.
      prefLayer = edge?.layer !== undefined && nl > 1 ? edge.layer : -1;
      connHop = !plan ? 1 : edge?.jump ? (o.planHop?.[0] ?? 0.5) : (o.planHop?.[1] ?? 3);
      const path = src.length ? astar(n, src, (l, k) => tree[l * N + k] === 1, tb) : null;
      prefLayer = -1;
      connHop = 1;
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
          markNoise(n, st.k);
          if (i > 0 && !st.hop && path[i - 1].l === st.l) {
            const pk = path[i - 1].k;
            const dd = Math.abs(pk - st.k);
            if (dd !== 1 && dd !== nx) {
              // Диагональный шаг: угол квадрата, на мелкой сетке — и боковые клетки.
              const [corner, s1, s2] = diagParts(pk, st.k);
              addCorner(n, st.l, corner);
              if (diagSide) {
                addUse(n, st.l, s1);
                addUse(n, st.l, s2);
              }
            }
          }
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
    for (let l = 0; l < nl; l++)
      for (let k = 0; k < N; k++) {
        if (occ[l][k] > 1) {
          over++;
          hist[l][k] += 0.8;
        }
        if (cocc[l][k] > 1) {
          over++;
          // Угол спорный — дорожают все четыре клетки квадрата.
          hist[l][k] += 0.4;
          if (k + 1 < N) hist[l][k + 1] += 0.4;
          if (k + nx < N) hist[l][k + nx] += 0.4;
          if (k + nx + 1 < N) hist[l][k + nx + 1] += 0.4;
        }
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
      cuse: cuse.map((a) => a.map((u) => u.slice())),
      cocc: cocc.map((u) => u.slice()),
      noiseF: noiseF.slice(),
      sensF: sensF.slice(),
      noiseCells: noiseCells.map((u) => u.slice()),
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
          if (occ[l][k] < 2 && cocc[l][k] < 2) continue;
          if (cocc[l][k] > 1) for (let n = 0; n < NN; n++) if (cuse[n][l][k]) bad.add(n);
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
      for (let l = 0; l < nl; l++) for (let k = 0; k < N; k++) over += Number(occ[l][k] > 1) + Number(cocc[l][k] > 1);
      if (over < best.over) best = snap();
      await tick();
    }
    if (over > best.over) {
      over = best.over;
      best.use.forEach((a, n) => a.forEach((u, l) => use[n][l].set(u)));
      best.occ.forEach((u, l) => occ[l].set(u));
      best.cuse.forEach((a, n) => a.forEach((u, l) => cuse[n][l].set(u)));
      best.cocc.forEach((u, l) => cocc[l].set(u));
      noiseF.set(best.noiseF);
      sensF.set(best.sensF);
      best.noiseCells.forEach((u, n) => (noiseCells[n] = u));
      best.results.forEach((r, n) => (results[n] = r));
      best.haloCnt.forEach((u, c) => haloCnt[c].set(u));
      best.haloCells.forEach((u, n) => (haloCells[n] = u));
      viaAt.set(best.viaAt);
      best.netVias.forEach((u, n) => (netVias[n] = u));
    }
  }
  // Чистовой проход: каждая цепь перекладывается заново — без истории споров, без права на
  // конфликт и с вдвое дорогими перемычками и переходными. Если вышло без лишних прыжков или
  // короче — остаётся, иначе цепь возвращается как была. Убирает обходы и перемычки, которые
  // понадобились в разгар согласования, а к концу стали не нужны.
  let polished = 0;
  if (!over && (o.polish ?? true)) {
    const measure = (n: number) => {
      let hops = 0;
      let len = 0;
      let fail = 0;
      for (const c of results[n]) {
        if (!c.path) {
          fail++;
          continue;
        }
        for (let i = 1; i < c.path.length; i++) {
          const st = c.path[i];
          if (st.hop === 1 || st.hop === 2) hops++;
          else if (!st.hop) {
            const dd = Math.abs(c.path[i - 1].k - st.k);
            len += dd === 1 || dd === nx ? 1 : DIAG;
          }
        }
      }
      return { hops, len, fail };
    };
    const snapNet = (n: number) => ({
      use: use[n].map((u) => u.slice()),
      cuse: cuse[n].map((u) => u.slice()),
      halo: haloCells[n].slice(),
      vias: netVias[n].slice(),
      noise: noiseCells[n].slice(),
      res: results[n],
    });
    const restoreNet = (n: number, sn: ReturnType<typeof snapNet>) => {
      clearNet(n);
      for (let l = 0; l < nl; l++)
        for (let k = 0; k < N; k++) {
          if (sn.use[l][k]) addUse(n, l, k);
          if (sn.cuse[l][k]) addCorner(n, l, k);
        }
      haloCells[n] = sn.halo;
      for (const kk of sn.halo) haloCnt[kk >> 24][kk & 0xffffff]++;
      netVias[n] = sn.vias;
      for (const k of sn.vias) viaAt[k] = n + 1;
      noiseCells[n] = sn.noise;
      const f = roleOf[n] === 1 ? noiseF : sensF;
      for (const k of sn.noise) f[k]++;
      results[n] = sn.res;
    };
    const conflicted = (n: number) => {
      for (let l = 0; l < nl; l++)
        for (let k = 0; k < N; k++) if ((use[n][l][k] && occ[l][k] > 1) || (cuse[n][l][k] && cocc[l][k] > 1)) return true;
      return false;
    };
    pf = 1e5;
    histW = 0;
    hopMul = 2;
    // Сначала цепи с прыжками — им есть что терять; потом остальные — ради длины.
    const byHops = [...order].sort((a, b) => measure(b).hops - measure(a).hops);
    for (let q = 0; q < byHops.length; q++) {
      const n = byHops[q];
      const was = measure(n);
      const sn = snapNet(n);
      routeNet(n);
      const now = measure(n);
      const better = !conflicted(n) && now.fail <= was.fail && (now.hops < was.hops || (now.hops === was.hops && now.len < was.len - 1e-9));
      if (better) polished++;
      else restoreNet(n, sn);
      if (q % yieldEvery === yieldEvery - 1) await tick();
    }
    histW = 1;
    hopMul = 1;
  }

  const hot: { x: number; y: number; layer: CopperLayer }[] = [];
  if (over)
    for (let l = 0; l < nl; l++)
      for (let k = 0; k < N; k++) {
        if (occ[l][k] > 1) hot.push({ x: +cx(k).toFixed(3), y: +cy(k).toFixed(3), layer: layerIds[l] });
        else if (cocc[l][k] > 1) hot.push({ x: +(cx(k) + G / 2).toFixed(3), y: +(cy(k) + G / 2).toFixed(3), layer: layerIds[l] });
      }
  // Что осталось в конфликте — превращаем в прямые перемычки.
  if (over)
    for (const n of order)
      for (const c of results[n]) {
        const path = c.path;
        if (!path) continue;
        const bad = path.some((st, i) => {
          if (occ[st.l][st.k] > 1) return true;
          if (i === 0 || st.hop || path[i - 1].l !== st.l) return false;
          const dd = Math.abs(path[i - 1].k - st.k);
          if (dd === 1 || dd === nx) return false;
          const [corner, s1, s2] = diagParts(path[i - 1].k, st.k);
          return cocc[st.l][corner] > 1 || (diagSide && (occ[st.l][s1] > 1 || occ[st.l][s2] > 1));
        });
        if (bad) c.path = null;
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
            if (Math.abs((q.x - a.x) * (b.y - q.y) - (q.y - a.y) * (b.x - q.x)) < 1e-9) continue; // коллинеарно
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
  return { tracks, vias, wires, failed, conflicts: over, iterations: it + 1, grid: G, ms: Date.now() - t0, hot, polished };
}
