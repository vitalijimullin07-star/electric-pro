import { computeConnectivity } from '../model/connectivity';
import { runDrc } from '../model/drc';
import { addTrack, addVia, addWire, clearRouting } from '../model/edit';
import { netsByRole, type RoleSets } from '../model/net-roles';
import { routePlan, untangledRatsnest } from '../model/untangle';
import { MAINS_CLASS, MAINS_CLEARANCE } from '../model/rules';
import type { Project, Track, Via } from '../model/types';
import type { Vec2 } from '../math/vec';
import { applyPlacement, autoplace, type PlaceMove, type PlaceScore } from '../place/autoplace';
import { autoGrid } from './autoroute';
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
  use: { hv: boolean; power: boolean; noise: boolean };
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
  /** Ошибок проверки правил. */
  drc: number;
  place?: PlaceScore;
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
  return { place: false, route: true, keepExisting: false, roles: netsByRole(p), use: { hv: true, power: true, noise: true }, tryTwoLayers: false, stitch: true, effort: 1 };
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

/** План варианта по номеру: разные семена и стратегии, первые — самые надёжные. */
export function planVariant(index: number, p: Project, o: SearchOptions): VariantJob {
  const one = p.board.copperLayers === 1;
  // Каждый четвёртый вариант односторонней платы — двусторонний (если разрешено).
  const layers: 1 | 2 = one && o.tryTwoLayers && index % 4 === 3 ? 2 : one ? 1 : 2;
  const start: VariantJob['start'] = !o.place ? null : index === 0 ? 'current' : index % 3 === 1 ? 'current' : 'scratch';
  const order = index === 0 ? 'short' : ORDERS[index % 3];
  const hops = layers === 1 ? [100, 160, 60, 130] : [25, 40, 18, 30];
  const hopCost = hops[Math.floor(index / 3) % hops.length];
  const greed = index % 2 ? 1 : 1.15;
  // Каждый шестой — по плану распутанной паутины: ещё одна стратегия для разнообразия
  // (в среднем не лучше и не хуже прочих, но на отдельных платах выигрывает).
  const plan = index % 6 === 5;
  const crossWeight = (layers === 1 ? 14 : 4) * [1, 1.8, 0.6, 2.5][index % 4];
  const parts: string[] = [];
  if (start) parts.push(start === 'current' ? 'расстановка от текущей' : 'расстановка с нуля');
  if (o.route) parts.push(plan ? 'по распутанной паутине' : order === 'short' ? 'короткие цепи первыми' : order === 'long' ? 'длинные цепи первыми' : 'случайный порядок');
  if (layers === 2 && one) parts.push('на двух слоях');
  return { index, seed: 1 + index * 7919, start, crossWeight, layers, order, hopCost, greed, plan, label: `№${index + 1}: ${parts.join(', ')}` };
}

function trackLength(tracks: Omit<Track, 'id'>[]): number {
  let L = 0;
  for (const t of tracks) for (let i = 1; i < t.points.length; i++) L += Math.hypot(t.points[i].x - t.points[i - 1].x, t.points[i].y - t.points[i - 1].y);
  return L;
}

/** Оценка варианта: меньше — лучше. Неразведённое и ошибки — главное, потом перемычки. */
export function scoreOf(s: VariantStats, layers: number, baseLayers: number): number {
  return s.unrouted * 1000 + s.drc * 150 + s.failed * 200 + s.jumpers * 25 + s.vias * 2 + s.length * 0.01 + (layers > baseLayers ? 150 : 0) + (s.place ? s.place.zone * 300 + s.place.overlap * 5 : 0);
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
  let moves: PlaceMove[] = [];
  let placeScore: PlaceScore | undefined;
  if (job.start) {
    const res = await autoplace(q, { seed: job.seed, start: job.start, effort: o.effort * (job.start === 'scratch' ? 3 : 1.5), crossWeight: job.crossWeight, roles, yieldEvery: run.inline ? 200 : 2000, progress: (f) => progress?.(f * 0.4) });
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
  let vias: Omit<Via, 'id'>[] = [];
  let wires: { a: Vec2; b: Vec2 }[] = [];
  let failed = 0;
  if (o.route) {
    const r = await autorouteWithZones(structuredClone(q), {
      grid: o.grid ?? autoGrid(q),
      iterations: Math.round(30 * Math.max(1, o.effort)),
      keepExisting: keep,
      allowWires: job.layers === 1,
      allowVias: job.layers > 1,
      stitch: o.stitch,
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
      progress: (i) => progress?.(0.4 + 0.6 * i.fraction),
    });
    tracks = r.tracks;
    vias = r.vias;
    wires = r.wires;
    failed = r.failed;
    for (const t of tracks) addTrack(q, t);
    for (const v of vias) addVia(q, v);
    for (const w of wires) addWire(q, w.a, w.b);
  }
  const done = structuredClone(q);
  const conn = computeConnectivity(done);
  const drc = runDrc(done).markers.filter((m) => m.severity === 'error').length;
  const stats: VariantStats = {
    unrouted: conn.unrouted,
    failed,
    jumpers: Object.keys(done.wires).length,
    vias: Object.keys(done.vias).length,
    length: Math.round(trackLength(Object.values(done.tracks))),
    drc,
    place: placeScore,
    tangle,
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

