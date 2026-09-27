import { computeConnectivity } from '../model/connectivity';
import { runDrc } from '../model/drc';
import { addTrack, addVia, addWire, clearRouting } from '../model/edit';
import { netsByRole, type RoleSets } from '../model/net-roles';
import { routePlan, untangledRatsnest } from '../model/untangle';
import { applyFit, fitTrackWidthsSafe } from '../model/track-fit';
import { MAINS_CLASS, MAINS_CLEARANCE, netClassOf } from '../model/rules';
import type { Id, Project, Track, Via } from '../model/types';
import type { Vec2 } from '../math/vec';
import { applyPlacement, autoplace, type PlaceMove, type PlaceScore } from '../place/autoplace';
import { autoGrid } from './autoroute';
import { getWorld } from '../model/world';
import { netWidth } from '../model/currents';
import { autorouteWithZones } from './zone-aware';

/*
 * Перебор вариантов «расстановка + трассировка». Каждый вариант — своё семя и своя
 * стратегия: расстановка от текущих мест или с нуля, порядок цепей, цена перемычки,
 * точность поиска; на односторонней плате — по желанию и двусторонние варианты.
 * Варианты независимы, поэтому их считают параллельно воркеры — по числу ядер.
 */

export interface SearchOptions {
  /** Расставить компоненты. */
  place: boolean;
  /** Развести дорожки. */
  route: boolean;
  /** Оставить существующие дорожки (только без расстановки). */
  keepExisting: boolean;
  /** Роли цепей и какие из них учитывать. */
  roles: RoleSets;
  /** current — ширина дорожек по токам цепей (после трассировки). */
  use: { hv: boolean; power: boolean; noise: boolean; current?: boolean };
  /** Для односторонней платы — пробовать и двустороннюю. */
  tryTwoLayers: boolean;
  /** Сшить полигоны переходными (двусторонняя плата). */
  stitch: boolean;
  /** Сетка трассировки, мм (по умолчанию — по правилам). */
  grid?: number;
  /** Насколько тщательно (1 — обычно). */
  effort: number;
}

export interface VariantJob {
  index: number;
  seed: number;
  /** Расстановка: от текущей, с нуля или без неё. */
  start: 'current' | 'scratch' | null;
  crossWeight: number;
  layers: 1 | 2;
  order: 'short' | 'long' | 'random';
  hopCost: number;
  greed: number;
  /** Трассировать по плану распутанной паутины (порядок соединений, прыжки, слои). */
  plan: boolean;
  /**
   * Тонко, потом шире: мелкие цепи ведутся минимальной шириной на мелкой сетке (между
   * выводами микросхем проходит дорожка), затем расширяются до ширины класса и тока,
   * насколько позволяют зазоры.
   */
  thin: boolean;
  /** Крайний срок (Date.now(), мс): вариант укладывается в выбранное время поиска. */
  deadline?: number;
  label: string;
}

export interface VariantStats {
  /** Неразведённых цепей. */
  unrouted: number;
  /** Связей, замененных прямой перемычкой (не нашлось пути). */
  failed: number;
  /** Перемычек проводом всего. */
  jumpers: number;
  vias: number;
  /** Длина дорожек, мм. */
  length: number;
  /** Ошибок проверки правил (кроме неразведённых цепей). */
  drc: number;
  /** Имена неразведённых цепей (первые несколько). */
  unroutedNets?: string[];
  place?: PlaceScore;
  /** Ширина по токам: цепей шире класса и где по току не хватило места. */
  widened?: number;
  narrow?: string[];
  /** Цепей, где дорожка местами тоньше ширины класса (не меньше минимума правил). */
  thinner?: number;
  /** Паутина перед трассировкой: пересечений после распутывания и оценка снизу прыжков. */
  tangle?: { crossings: number; before: number; minJumps: number; minVias: number };
}

export interface VariantResult {
  index: number;
  label: string;
  layers: number;
  moves: PlaceMove[];
  tracks: Omit<Track, 'id'>[];
  vias: Omit<Via, 'id'>[];
  wires: { a: Vec2; b: Vec2 }[];
  stats: VariantStats;
  score: number;
  ms: number;
}

/** Роли по умолчанию: угаданные для проекта. */
export function defaultSearchOptions(p: Project): SearchOptions {
  return { place: false, route: true, keepExisting: false, roles: netsByRole(p), use: { hv: true, power: true, noise: true, current: true }, tryTwoLayers: false, stitch: true, effort: 1 };
}

/**
 * Роли → классы цепей в проекте: сеть 230 В — класс Mains с большим зазором до остального,
 * питание — Power (шире). Меняет проект на месте; возвращает, что поменялось.
 */
export function applyRoleClasses(p: Project, o: Pick<SearchOptions, 'roles' | 'use'>): string[] {
  const out: string[] = [];
  if (o.use.hv && o.roles.hv.length) {
    let mains = Object.values(p.netClasses).find((c) => /mains|230|сеть/i.test(c.name));
    if (!mains) {
      mains = { ...MAINS_CLASS };
      p.netClasses[mains.name] = mains;
      out.push(`класс ${mains.name}`);
    }
    if (!p.rules.classClearances.some((c) => c.a === mains!.name || c.b === mains!.name)) {
      p.rules.classClearances.push({ a: mains.name, b: '*', clearance: MAINS_CLEARANCE });
      out.push(`зазор ${String(MAINS_CLEARANCE).replace('.', ',')} мм от сети`);
    }
    let n = 0;
    for (const id of o.roles.hv) if (p.nets[id] && p.nets[id].netClass !== mains.name) (p.nets[id].netClass = mains.name), n++;
    if (n) out.push(`цепей сети в Mains: ${n}`);
  }
  if (o.use.power && o.roles.power.length && p.netClasses.Power) {
    let n = 0;
    for (const id of o.roles.power) if (p.nets[id] && p.nets[id].netClass === 'Default') (p.nets[id].netClass = 'Power'), n++;
    if (n) out.push(`цепей питания в Power: ${n}`);
  }
  return out;
}

const ORDERS = ['short', 'long', 'random'] as const;

/** Наименьший шаг выводов у деталей на плате (среди подключённых), мм. */
export function minPadPitch(p: Project): number {
  let m = Infinity;
  for (const c of getWorld(p).components) {
    if (c.component.offBoard) continue;
    const ps = c.pads.filter((x) => x.net);
    for (let i = 0; i < ps.length; i++)
      for (let j = i + 1; j < ps.length; j++) {
        const d = Math.hypot(ps[i].center.x - ps[j].center.x, ps[i].center.y - ps[j].center.y);
        if (d > 0.05 && d < m) m = d;
      }
  }
  return m;
}

/** План варианта по номеру: разные семена и стратегии, первые — самые надёжные. */
export function planVariant(index: number, p: Project, o: SearchOptions): VariantJob {
  const one = p.board.copperLayers === 1;
  // Каждый четвёртый вариант односторонней платы — двусторонний (если разрешено).
  const layers: 1 | 2 = one && o.tryTwoLayers && index % 4 === 3 ? 2 : one ? 1 : 2;
  // С расстановкой первый вариант — детали как стоят (эталон: видно, помогла ли расстановка).
  const start: VariantJob['start'] = !o.place || index === 0 ? null : index % 3 === 1 ? 'current' : 'scratch';
  const order = index === 0 ? 'short' : ORDERS[index % 3];
  // Цена прыжка: перемычка на одной стороне — дорогая; переходное на двух слоях — дешёвое
  // (на плате с модулем ESP32 цена 12 даёт меньше непроведённых связей и быстрее, чем 25).
  const hops = layers === 1 ? [100, 160, 60, 130] : [12, 20, 9, 16];
  const hopCost = hops[Math.floor(index / 3) % hops.length];
  const greed = index % 2 ? 1 : 1.15;
  // Каждый шестой — по плану распутанной паутины: ещё одна стратегия для разнообразия
  // (в среднем не лучше и не хуже прочих, но на отдельных платах выигрывает).
  const plan = index % 6 === 5;
  // Выводы с шагом 1,27 мм и мельче (модули, SOIC, SOT) — почти все варианты тонко, потом
  // шире (между выводами проходит дорожка). Выводные детали с шагом 2,54 — по классам:
  // тонко там втрое дольше, а выигрыш — пара перемычек (на телефоне не успеть).
  const fine = minPadPitch(p) <= 1.3;
  const thin = fine && index % 4 !== 2;
  const crossWeight = (layers === 1 ? 14 : 4) * [1, 1.8, 0.6, 2.5][index % 4];
  const parts: string[] = [];
  if (start) parts.push(start === 'current' ? 'расстановка от текущей' : 'расстановка с нуля');
  else if (o.place) parts.push('детали как стоят');
  if (o.route) parts.push(plan ? 'по распутанной паутине' : order === 'short' ? 'короткие цепи первыми' : order === 'long' ? 'длинные цепи первыми' : 'случайный порядок');
  if (o.route && thin) parts.push('тонко, потом шире');
  if (layers === 2 && one) parts.push('на двух слоях');
  return { index, seed: 1 + index * 7919, start, crossWeight, layers, order, hopCost, greed, plan, thin, label: `№${index + 1}: ${parts.join(', ')}` };
}

function trackLength(tracks: Omit<Track, 'id'>[]): number {
  let L = 0;
  for (const t of tracks) for (let i = 1; i < t.points.length; i++) L += Math.hypot(t.points[i].x - t.points[i - 1].x, t.points[i].y - t.points[i - 1].y);
  return L;
}

/** Оценка варианта: меньше — лучше. Неразведённое и ошибки — главное, потом перемычки. */
export function scoreOf(s: VariantStats, layers: number, baseLayers: number): number {
  return s.unrouted * 1000 + s.drc * 150 + s.failed * 200 + (s.narrow?.length ?? 0) * 30 + s.jumpers * 25 + s.vias * 2 + s.length * 0.01 + (layers > baseLayers ? 150 : 0) + (s.place ? s.place.zone * 300 + s.place.overlap * 5 : 0);
}

/**
 * Этапы разводки по сетке. Шаг сетки задаёт класс с самым большим зазором: у сети 230 В
 * зазор 0,9 мм — и вся плата разводилась бы на сетке 1,27 мм, между выводами микросхем не
 * пройти. Поэтому цепи классов с большим зазором разводятся первыми на своей крупной сетке,
 * остальные — вторым этапом на мелкой; медь первых для них — препятствие со своим зазором.
 * grid — шаг, выбранный вручную: не мельче нужного этапу.
 */
export function routeStages(p: Project, grid?: number): { nets: Id[]; grid: number }[] {
  const nets = Object.keys(p.nets);
  const clr = (id: Id) => Math.max(netClassOf(p, id).clearance, p.rules.minClearance);
  const used = nets.filter((id) => Object.values(p.components).some((c) => !c.offBoard && Object.values(c.padNets).includes(id)));
  if (!used.length) return [{ nets, grid: Math.max(grid ?? 0, autoGrid(p)) }];
  const minClr = Math.min(...used.map(clr));
  // Этап — по классу цепи (цепи без выводов на плате — вместе со своим классом).
  const isCoarse = (id: Id) => clr(id) >= 2 * minClr && clr(id) >= minClr + 0.3;
  const stage = (ids: Id[]) => ({ nets: ids, grid: Math.max(grid ?? 0, autoGrid(p, ids)) });
  if (!used.some(isCoarse) || used.every(isCoarse)) return [stage(nets)];
  return [stage(nets.filter(isCoarse)), stage(nets.filter((id) => !isCoarse(id)))];
}

/** Один вариант: расстановка, трассировка, оценка. Проект не меняется. */
export async function runVariant(base: Project, o: SearchOptions, job: VariantJob, progress?: (fraction: number) => void, run: { inline?: boolean } = {}): Promise<VariantResult> {
  const t0 = Date.now();
  const q = structuredClone(base);
  if (job.layers !== q.board.copperLayers) q.board.copperLayers = job.layers;
  const roles: RoleSets = {
    ...o.roles,
    hv: o.use.hv ? o.roles.hv : [],
    noisy: o.use.noise ? o.roles.noisy : [],
    sensitive: o.use.noise ? o.roles.sensitive : [],
  };
  // Сроки: расстановке — до 45 % оставшегося времени, трассировке — остальное без запаса на
  // подгонку ширины и проверку правил.
  const left = job.deadline ? Math.max(0, job.deadline - t0) : 0;
  const placeDeadline = job.deadline ? t0 + left * 0.45 : undefined;
  const routeDeadline = job.deadline ? job.deadline - Math.min(5000, Math.max(1000, left * 0.12)) : undefined;
  let moves: PlaceMove[] = [];
  let placeScore: PlaceScore | undefined;
  if (job.start) {
    const res = await autoplace(q, { seed: job.seed, start: job.start, effort: o.effort * (job.start === 'scratch' ? 3 : 1.5), crossWeight: job.crossWeight, roles, deadline: placeDeadline, yieldEvery: run.inline ? 200 : 2000, progress: (f) => progress?.(f * 0.4) });
    moves = res.moves;
    placeScore = res.after;
    applyPlacement(q, moves);
  }
  // Старые дорожки остаются только без расстановки и без смены слоёв; иначе они не к месту.
  const keep = o.keepExisting && !job.start && job.layers === base.board.copperLayers;
  if (!keep && (o.route || job.start)) clearRouting(q);
  // Паутина перед трассировкой: распутанная — и план, и честная оценка «сколько прыжков минимум».
  const tq = structuredClone(q);
  const tr = untangledRatsnest(tq);
  const tangle = { crossings: tr.crossings, before: tr.before.crossings, minJumps: tr.minJumps, minVias: tr.minViaPairs * 2 };
  let tracks: Omit<Track, 'id'>[] = [];
  const vias: Omit<Via, 'id'>[] = [];
  const wires: { a: Vec2; b: Vec2 }[] = [];
  let failed = 0;
  let widened: number | undefined;
  let narrow: string[] | undefined;
  let thinner: number | undefined;
  if (o.route) {
    // По этапам: сначала цепи с большим зазором на крупной сетке, затем остальные на мелкой.
    const stages = routeStages(q, o.grid);
    const ids: Id[] = [];
    const tStages = Date.now();
    for (let si = 0; si < stages.length; si++) {
      const st = stages[si];
      const lastStage = si === stages.length - 1;
      const src = structuredClone(q);
      let grid = st.grid;
      // Тонко: цепи этапа (кроме этапа с большим зазором) — шириной минимума правил, сетка по ней.
      if (job.thin && (stages.length === 1 || si > 0)) {
        const thinW = Math.max(q.rules.minTrackWidth, 0.1);
        const mine = new Set(st.nets.map((id) => netClassOf(src, id).name));
        for (const name of mine) if (src.netClasses[name]) src.netClasses[name] = { ...src.netClasses[name], trackWidth: Math.min(src.netClasses[name].trackWidth, thinW) };
        grid = Math.max(o.grid ?? 0, autoGrid(src, st.nets));
      }
      // Срок этапа: доля оставшегося времени по числу этапов (первый этап сети — короткий).
      const stageDeadline = routeDeadline ? tStages + ((routeDeadline - tStages) * (si + 1)) / stages.length : undefined;
      const r = await autorouteWithZones(src, {
        grid,
        // Диагонали — на крупной сетке; на мелкой они втрое дольше и не лучше.
        diagonal: grid >= 0.8,
        deadline: stageDeadline,
        nets: stages.length > 1 ? st.nets : undefined,
        iterations: Math.round(30 * Math.max(1, o.effort)),
        keepExisting: keep || si > 0,
        allowWires: job.layers === 1,
        allowVias: job.layers > 1,
        stitch: lastStage ? o.stitch : false,
        hopCost: job.hopCost,
        order: job.order,
        seed: job.seed,
        greed: job.greed,
        noisy: roles.noisy,
        sensitive: roles.sensitive,
        plan: job.plan ? routePlan(tr) : undefined,
        planHop: [0.7, 1.5],
        // В основном потоке — чаще отдавать управление, чтобы интерфейс не замирал.
        yieldEvery: run.inline ? 2 : 1000,
        progress: (i) => progress?.(0.4 + (0.6 * (si + i.fraction)) / stages.length),
      });
      tracks.push(...r.tracks);
      vias.push(...r.vias);
      failed += r.failed;
      for (const t of r.tracks) ids.push(addTrack(q, t).id);
      for (const v of r.vias) addVia(q, v);
      // Связь без пути на односторонней плате — перемычка проводом. На двусторонней провод
      // через SMD-площадку не впаять, а в модели он замкнул бы слои в точке: такая связь
      // остаётся воздушной линией (и видна в карточке как «не нашлось пути»).
      if (job.layers === 1) {
        wires.push(...r.wires);
        for (const w of r.wires) addWire(q, w.a, w.b);
      }
    }
    // Ширина: тонкие дорожки — до ширины класса, сильноточные — и по току, насколько
    // позволяют зазоры (у тонких выводов остаются сужения).
    const want = new Map<Id, number>();
    for (const id of Object.keys(q.nets)) {
      const nw = netWidth(q, id);
      want.set(id, o.use.current !== false ? nw.width : nw.classWidth);
    }
    if (ids.length) {
      const f = fitTrackWidthsSafe(structuredClone(q), { tracks: ids, widths: want });
      if (f.nets.length) {
        applyFit(q, f);
        const gone = new Set(f.remove);
        tracks = [...ids.filter((id) => !gone.has(id)).map((id) => ({ layer: q.tracks[id].layer, width: q.tracks[id].width, points: q.tracks[id].points })), ...f.add];
      }
      const byCurrent = (id: Id) => netWidth(q, id).width > netWidth(q, id).classWidth + 1e-6;
      if (o.use.current !== false) {
        widened = f.nets.filter((n) => byCurrent(n.net)).length;
        narrow = f.short.filter((n) => byCurrent(n.net)).map((n) => q.nets[n.net]?.name ?? n.net);
      }
      thinner = f.short.filter((n) => !byCurrent(n.net) || o.use.current === false).length;
    }
  }
  const done = structuredClone(q);
  const conn = computeConnectivity(done);
  // Ошибки правил — без «цепь не разведена»: неразведённое считается отдельно.
  const drc = runDrc(done).markers.filter((m) => m.severity === 'error' && m.code !== 'unrouted').length;
  const stats: VariantStats = {
    unrouted: conn.unrouted,
    unroutedNets: [...conn.nets.values()].filter((st) => !st.complete).map((st) => done.nets[st.netId]?.name ?? '?').slice(0, 4),
    failed,
    jumpers: Object.keys(done.wires).length,
    vias: Object.keys(done.vias).length,
    length: Math.round(trackLength(Object.values(done.tracks))),
    drc,
    place: placeScore,
    tangle,
    widened,
    narrow,
    thinner,
  };
  return { index: job.index, label: job.label, layers: job.layers, moves, tracks, vias, wires, stats, score: Math.round(scoreOf(stats, job.layers, base.board.copperLayers)), ms: Date.now() - t0 };
}

/** Применить вариант к проекту: места деталей, слои, дорожки (старые — стираются, если не оставляли). */
export function applyVariant(p: Project, o: Pick<SearchOptions, 'keepExisting' | 'route'>, v: VariantResult): void {
  const layersChanged = v.layers !== p.board.copperLayers;
  if (layersChanged) p.board.copperLayers = v.layers as Project['board']['copperLayers'];
  applyPlacement(p, v.moves);
  const keep = o.keepExisting && !v.moves.length && !layersChanged;
  if (!keep && (o.route || v.moves.length)) clearRouting(p);
  for (const t of v.tracks) addTrack(p, t);
  for (const x of v.vias) addVia(p, x);
  for (const w of v.wires) addWire(p, w.a, w.b);
}

