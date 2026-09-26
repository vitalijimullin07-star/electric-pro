import { boxOfPoints, distToPolygonEdge, pointInPolygon } from '../math/geom';
import { rng } from '../math/random';
import type { Vec2 } from '../math/vec';
import { netsByRole, type RoleSets } from '../model/net-roles';
import { footprintBounds } from '../model/placement';
import { boardPolygon } from '../model/project';
import { netClassOf } from '../model/rules';
import type { Id, Project } from '../model/types';

/*
 * Авторасстановка компонентов методом имитации отжига. Двигаются незакреплённые детали,
 * у которых есть подключённые выводы; закреплённые, крепёжные отверстия и выносные — на месте.
 * Стоимость расстановки (в «миллиметрах»):
 *   длина связей (полупериметр рамки выводов цепи);
 *   пересечения связей (минимальное дерево каждой цепи) — главный предсказатель перемычек и
 *     переходных: на односторонней плате они дорогие;
 *   перекрытие габаритов (с зазором) и выход за край платы;
 *   выводы не в своей зоне: цепи, которым нельзя в область правил (логика в зоне 230 В), и
 *     цепи 230 В вне своей зоны, если она есть;
 *   зазор от выводов сети до выводов остальных цепей (по классу, обычно 6 мм);
 *   помехоопасные выводы рядом с чувствительными;
 *   разъёмы — к краю платы; конденсаторы развязки — к выводу питания микросхемы.
 * Пересчёт после хода — только для сдвинутых деталей, их цепей и соседей.
 */

export interface PlaceOptions {
  /** Семя: у каждого варианта своё. */
  seed?: number;
  /** Сколько стараться: 1 — обычно, больше — дольше и лучше. */
  effort?: number;
  /** От текущей расстановки или с нуля (случайные места). */
  start?: 'current' | 'scratch';
  /** Роли цепей (по умолчанию — угаданные). */
  roles?: RoleSets;
  /** Цена одного пересечения связей, мм (по умолчанию 14 на одном слое, 4 на двух). */
  crossWeight?: number;
  /** Шаг, по которому ставятся детали, мм (по умолчанию 1,27 при выводных деталях, 0,635 без них). */
  grid?: number;
  /** Зазор между габаритами деталей, мм. */
  spacing?: number;
  /** Зазор от выводов сети до остальных, мм (по умолчанию из правил класса или 6). */
  hvClearance?: number;
  /** На каком расстоянии помехоопасные выводы мешают чувствительным, мм. */
  noiseDistance?: number;
  progress?: (fraction: number) => void | Promise<void>;
  /** Отдавать управление каждые столько ходов (для основного потока). */
  yieldEvery?: number;
}

export interface PlaceScore {
  /** Длина связей, мм. */
  length: number;
  crossings: number;
  /** Связей через «стены» — ряды выводов, между которыми дорожке не пройти. */
  walls: number;
  /** Перекрытие габаритов, мм². */
  overlap: number;
  /** Точек габарита вне платы. */
  outside: number;
  /** Выводов не в своей зоне. */
  zone: number;
  /** Нехватка зазора сеть — остальное, мм (сумма по парам выводов). */
  hv: number;
  cost: number;
}

export interface PlaceMove {
  id: Id;
  at: Vec2;
  rotation: number;
}

export interface PlaceResult {
  moves: PlaceMove[];
  before: PlaceScore;
  after: PlaceScore;
  ms: number;
  steps: number;
}

const W_OVERLAP = 60;
const W_OUT = 400;
const W_ZONE = 500;
const W_HV = 120;
const W_NOISE = 4;
const W_EDGE = 3;
const W_DECAP = 4;

interface Part {
  id: Id;
  ref: string;
  movable: boolean;
  connector: boolean;
  x: number;
  y: number;
  rot: number;
  /** Выводы: локальные координаты (с учётом стороны), глобальные номера. */
  lx: number[];
  ly: number[];
  pads: number[];
  bx0: number;
  by0: number;
  bx1: number;
  by1: number;
  /** Габарит на плате (с половиной зазора). */
  wx0: number;
  wy0: number;
  wx1: number;
  wy1: number;
  area: number;
  hasHv: boolean;
  hasLv: boolean;
  hasNoisy: boolean;
  hasSens: boolean;
}

const ROLE_HV = 1;
const ROLE_POWER = 2;
const ROLE_NOISY = 3;
const ROLE_SENS = 4;

function rot(x: number, y: number, deg: number): [number, number] {
  const d = ((deg % 360) + 360) % 360;
  if (d === 0) return [x, y];
  if (d === 90) return [y, -x];
  if (d === 180) return [-x, -y];
  if (d === 270) return [-y, x];
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [x * c + y * s, -x * s + y * c];
}

function segCross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  if (Math.max(ax, bx) < Math.min(cx, dx) || Math.max(cx, dx) < Math.min(ax, bx) || Math.max(ay, by) < Math.min(cy, dy) || Math.max(cy, dy) < Math.min(ay, by)) return false;
  const o1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const o2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  const o3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const o4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  return ((o1 > 1e-9 && o2 < -1e-9) || (o1 < -1e-9 && o2 > 1e-9)) && ((o3 > 1e-9 && o4 < -1e-9) || (o3 < -1e-9 && o4 > 1e-9));
}

export async function autoplace(p: Project, o: PlaceOptions = {}): Promise<PlaceResult> {
  const t0 = Date.now();
  const random = rng(o.seed ?? 1);
  const roles = o.roles ?? netsByRole(p);
  const oneLayer = p.board.copperLayers === 1;
  const crossW = o.crossWeight ?? (oneLayer ? 14 : 4);
  const spacing = o.spacing ?? 0.6;
  const noiseD = o.noiseDistance ?? 6;

  // ---- цепи и роли ----
  const netIds = Object.keys(p.nets);
  const netIdx = new Map(netIds.map((id, i) => [id, i]));
  const role = new Uint8Array(netIds.length);
  const put = (ids: Id[] | undefined, r: number) => ids?.forEach((id) => netIdx.has(id) && (role[netIdx.get(id)!] = r));
  put(roles.power, ROLE_POWER);
  put(roles.noisy, ROLE_NOISY);
  put(roles.sensitive, ROLE_SENS);
  put(roles.hv, ROLE_HV);
  // Зазор до сети: по правилам классов (наибольший особый зазор) или 6 мм.
  let hvClear = o.hvClearance ?? 0;
  if (!hvClear) {
    for (const cc of p.rules.classClearances) hvClear = Math.max(hvClear, cc.clearance);
    if (hvClear < 2.5) hvClear = 6;
  }
  const poured = new Set(Object.values(p.zones).filter((z) => z.net && (p.board.copperLayers > 1 || z.layer === 'B.Cu' || z.layer === 'F.Cu')).map((z) => z.net!));

  // ---- плата: растр «можно ставить» с отступом от края ----
  const poly = boardPolygon(p.board);
  const bb = boxOfPoints(poly);
  const edgeM = Math.max(p.rules.edgeClearance, 0.5);
  const RS = 0.5;
  const rw = Math.ceil((bb.maxX - bb.minX) / RS) + 1;
  const rh = Math.ceil((bb.maxY - bb.minY) / RS) + 1;
  const okMap = new Uint8Array(rw * rh);
  for (let j = 0; j < rh; j++)
    for (let i = 0; i < rw; i++) {
      const q = { x: bb.minX + i * RS, y: bb.minY + j * RS };
      let ok = pointInPolygon(q, poly) && distToPolygonEdge(q, poly) >= edgeM;
      if (ok) for (const cut of p.board.cutouts) if (pointInPolygon(q, cut) || distToPolygonEdge(q, cut) < edgeM) ok = false;
      okMap[j * rw + i] = ok ? 1 : 0;
    }
  const inside = (x: number, y: number) => {
    const i = Math.round((x - bb.minX) / RS);
    const j = Math.round((y - bb.minY) / RS);
    return i >= 0 && j >= 0 && i < rw && j < rh && okMap[j * rw + i] === 1;
  };

  // ---- области правил: куда каким классам можно ----
  const areas = Object.values(p.ruleAreas).map((ra) => ({ ra, box: boxOfPoints(ra.outline) }));
  const hvClassNames = new Set<string>();
  for (const id of roles.hv) hvClassNames.add(netClassOf(p, id).name);
  const hvAreas = areas.filter((a) => a.ra.onlyClasses && a.ra.onlyClasses.length && a.ra.onlyClasses.every((c) => hvClassNames.has(c)));

  // ---- детали и выводы ----
  const parts: Part[] = [];
  const padX: number[] = [];
  const padY: number[] = [];
  const padNet: number[] = [];
  const padPart: number[] = [];
  const padR: number[] = [];
  const padCls: string[] = [];
  let anyTht = false;
  for (const c of Object.values(p.components)) {
    if (c.offBoard) continue;
    const fp = p.footprints[c.footprint];
    if (!fp) continue;
    const mirror = c.side === 'bottom' ? -1 : 1;
    const b = footprintBounds(fp);
    const bx0 = mirror > 0 ? b.min.x : -b.max.x;
    const bx1 = mirror > 0 ? b.max.x : -b.min.x;
    const part: Part = {
      id: c.id,
      ref: c.ref,
      movable: false,
      connector: /^(X|XS|XP|XT|XW|J|P|CN|CON|USB)\d/i.test(c.ref) || ['connector', 'terminal', 'header', 'jst', 'usb'].some((t) => (fp.tags ?? []).includes(t)),
      x: c.at.x,
      y: c.at.y,
      rot: c.rotation,
      lx: [],
      ly: [],
      pads: [],
      bx0: bx0 - spacing / 2,
      by0: b.min.y - spacing / 2,
      bx1: bx1 + spacing / 2,
      by1: b.max.y + spacing / 2,
      wx0: 0,
      wy0: 0,
      wx1: 0,
      wy1: 0,
      area: (bx1 - bx0) * (b.max.y - b.min.y),
      hasHv: false,
      hasLv: false,
      hasNoisy: false,
      hasSens: false,
    };
    let connected = false;
    for (const pad of fp.pads) {
      const net = pad.type === 'npth' ? -1 : (netIdx.get(c.padNets[pad.number] ?? '') ?? -1);
      if (net >= 0) connected = true;
      if (pad.type === 'tht') anyTht = true;
      const gi = padX.length;
      part.lx.push(pad.at.x * mirror);
      part.ly.push(pad.at.y);
      part.pads.push(gi);
      padX.push(0);
      padY.push(0);
      padNet.push(net);
      padPart.push(parts.length);
      padR.push(Math.max(pad.size.x, pad.size.y) / 2);
      padCls.push(net >= 0 ? netClassOf(p, netIds[net]).name : '');
      if (net >= 0) {
        const r = role[net];
        if (r === ROLE_HV) part.hasHv = true;
        else part.hasLv = true;
        if (r === ROLE_NOISY) part.hasNoisy = true;
        if (r === ROLE_SENS) part.hasSens = true;
      }
    }
    part.movable = !c.locked && connected;
    parts.push(part);
  }
  const G = o.grid ?? (anyTht ? 1.27 : 0.635);
  const NP = parts.length;
  const movable = parts.map((_, i) => i).filter((i) => parts[i].movable);

  const place = (i: number) => {
    const pt = parts[i];
    for (let q = 0; q < pt.pads.length; q++) {
      const [x, y] = rot(pt.lx[q], pt.ly[q], pt.rot);
      padX[pt.pads[q]] = x + pt.x;
      padY[pt.pads[q]] = y + pt.y;
    }
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const [lx, ly] of [
      [pt.bx0, pt.by0],
      [pt.bx1, pt.by0],
      [pt.bx1, pt.by1],
      [pt.bx0, pt.by1],
    ]) {
      const [x, y] = rot(lx, ly, pt.rot);
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
    pt.wx0 = x0 + pt.x;
    pt.wy0 = y0 + pt.y;
    pt.wx1 = x1 + pt.x;
    pt.wy1 = y1 + pt.y;
  };
  // Первый вывод — на шаг сетки от угла платы: выводы попадают на сетку трассировки.
  const snap = (i: number) => {
    const pt = parts[i];
    const [ox, oy] = pt.lx.length ? rot(pt.lx[0], pt.ly[0], pt.rot) : [0, 0];
    pt.x = Math.round((pt.x + ox - bb.minX) / G) * G + bb.minX - ox;
    pt.y = Math.round((pt.y + oy - bb.minY) / G) * G + bb.minY - oy;
  };

  // ---- цепи: выводы, вес, развязка ----
  const netPads: number[][] = netIds.map(() => []);
  padNet.forEach((n, gi) => n >= 0 && netPads[n].push(gi));
  const netW = netIds.map((id, n) => {
    const k = netPads[n].length;
    if (k < 2) return 0;
    let w = 1;
    if (role[n] === ROLE_POWER && (k > 6 || poured.has(id))) w = 0.3;
    else if (poured.has(id)) w = 0.3;
    if (role[n] === ROLE_NOISY) w *= k <= 3 ? 2.5 : 1.5;
    return w;
  });
  const netCross = netIds.map((id, n) => netPads[n].length >= 2 && netPads[n].length <= 64 && !poured.has(id));
  // Развязка: конденсатор на двух цепях питания рядом с выводом питания микросхемы.
  const decap: [number, number][] = [];
  const bigParts = parts.map((pt) => pt.pads.length >= 6 && !pt.connector);
  parts.forEach((pt) => {
    if (!/^C\d/i.test(pt.ref) || pt.pads.length !== 2) return;
    const [a, b] = pt.pads;
    const na = padNet[a];
    const nb = padNet[b];
    if (na < 0 || nb < 0 || role[na] !== ROLE_POWER || role[nb] !== ROLE_POWER) return;
    const gnd = /GND|ЗЕМ|VSS/i.test(p.nets[netIds[na]].name) ? na : nb;
    const supply = gnd === na ? nb : na;
    const capPad = gnd === na ? b : a;
    let best = -1;
    let bd = Infinity;
    for (const gi of netPads[supply]) {
      if (!bigParts[padPart[gi]]) continue;
      const d = Math.hypot(padX[gi] - padX[capPad], padY[gi] - padY[capPad]);
      if (d < bd) {
        bd = d;
        best = gi;
      }
    }
    if (best >= 0) decap.push([capPad, best]);
  });

  // ---- начальное положение ----
  if (o.start === 'scratch')
    for (const i of movable) {
      const pt = parts[i];
      pt.rot = pt.rot + 90 * Math.floor(random() * 4);
      pt.x = bb.minX + (bb.maxX - bb.minX) * (0.1 + 0.8 * random());
      pt.y = bb.minY + (bb.maxY - bb.minY) * (0.1 + 0.8 * random());
      snap(i);
    }
  for (let i = 0; i < NP; i++) place(i);
  const startState = parts.map((pt) => ({ x: pt.x, y: pt.y, rot: pt.rot }));
  const origin = Object.fromEntries(parts.map((pt) => [pt.id, { x: p.components[pt.id].at.x, y: p.components[pt.id].at.y, rot: p.components[pt.id].rotation }]));

  // ---- стоимость цепей ----
  const netLen = new Float64Array(netIds.length);
  const netEdges: number[][] = netIds.map(() => []);
  const hpwl = (n: number): number => {
    const ps = netPads[n];
    if (ps.length < 2) return 0;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const gi of ps) {
      const x = padX[gi];
      const y = padY[gi];
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    const k = ps.length;
    return (x1 - x0 + y1 - y0) * (k <= 3 ? 1 : 1 + 0.12 * (k - 3));
  };
  const mst = (n: number): number[] => {
    const ps = netPads[n];
    const k = ps.length;
    if (!netCross[n] || k < 2) return [];
    const inT = new Uint8Array(k);
    const d = new Float64Array(k).fill(Infinity);
    const from = new Int32Array(k).fill(-1);
    const out: number[] = [];
    let cur = 0;
    inT[0] = 1;
    for (let step = 1; step < k; step++) {
      for (let q = 0; q < k; q++) {
        if (inT[q]) continue;
        const dd = Math.abs(padX[ps[q]] - padX[ps[cur]]) + Math.abs(padY[ps[q]] - padY[ps[cur]]);
        if (dd < d[q]) {
          d[q] = dd;
          from[q] = cur;
        }
      }
      let bq = -1;
      for (let q = 0; q < k; q++) if (!inT[q] && (bq < 0 || d[q] < d[bq])) bq = q;
      inT[bq] = 1;
      out.push(ps[from[bq]], ps[bq]);
      cur = bq;
    }
    return out;
  };
  const edgeCross = (e: number[], f: number[]): number => {
    let c = 0;
    for (let a = 0; a < e.length; a += 2) {
      const ax = padX[e[a]];
      const ay = padY[e[a]];
      const bx = padX[e[a + 1]];
      const by = padY[e[a + 1]];
      for (let b = 0; b < f.length; b += 2) if (segCross(ax, ay, bx, by, padX[f[b]], padY[f[b]], padX[f[b + 1]], padY[f[b + 1]])) c++;
    }
    return c;
  };
  for (let n = 0; n < netIds.length; n++) {
    netLen[n] = hpwl(n);
    netEdges[n] = mst(n);
  }
  // Стены: соседние выводы детали, между которыми не пройти даже самой тонкой дорожке.
  const thin = Math.min(...Object.values(p.netClasses).map((c) => Math.max(c.trackWidth, p.rules.minTrackWidth) + 2 * Math.max(c.clearance, p.rules.minClearance)));
  const walls: number[] = [];
  const wallsOf: number[][] = parts.map(() => []);
  parts.forEach((pt, pi) => {
    const k = pt.pads.length;
    for (let a = 0; a < k; a++) {
      let nearest = Infinity;
      for (let b = 0; b < k; b++) if (b !== a) nearest = Math.min(nearest, Math.hypot(pt.lx[a] - pt.lx[b], pt.ly[a] - pt.ly[b]));
      for (let b = a + 1; b < k; b++) {
        const d = Math.hypot(pt.lx[a] - pt.lx[b], pt.ly[a] - pt.ly[b]);
        if (d > Math.min(3.3, nearest * 1.2)) continue;
        if (d - padR[pt.pads[a]] - padR[pt.pads[b]] >= thin) continue;
        wallsOf[pi].push(walls.length / 2);
        walls.push(pt.pads[a], pt.pads[b]);
      }
    }
  });
  const wallW = crossW * (oneLayer ? 0.7 : 0.25);
  const edgeWallsPart = (e: number[], pi: number): number => {
    const ws = wallsOf[pi];
    if (!ws.length) return 0;
    const pt = parts[pi];
    let c = 0;
    for (let a = 0; a < e.length; a += 2) {
      const e0 = e[a];
      const e1 = e[a + 1];
      if (padPart[e0] === pi || padPart[e1] === pi) continue;
      const ax = padX[e0];
      const ay = padY[e0];
      const bx = padX[e1];
      const by = padY[e1];
      if (Math.max(ax, bx) < pt.wx0 || Math.min(ax, bx) > pt.wx1 || Math.max(ay, by) < pt.wy0 || Math.min(ay, by) > pt.wy1) continue;
      for (const w of ws) if (segCross(ax, ay, bx, by, padX[walls[w * 2]], padY[walls[w * 2]], padX[walls[w * 2 + 1]], padY[walls[w * 2 + 1]])) c++;
    }
    return c;
  };
  const edgeWalls = (e: number[]): number => {
    let c = 0;
    for (let pi = 0; pi < NP; pi++) c += edgeWallsPart(e, pi);
    return c;
  };
  let crossTotal = 0;
  for (let a = 0; a < netIds.length; a++) for (let b = a + 1; b < netIds.length; b++) if (netEdges[a].length && netEdges[b].length) crossTotal += edgeCross(netEdges[a], netEdges[b]);
  let wallTotal = 0;
  for (let n = 0; n < netIds.length; n++) wallTotal += edgeWalls(netEdges[n]);

  // ---- стоимость деталей ----
  const selfCost = (i: number): number => {
    const pt = parts[i];
    let c = 0;
    // Выход за край: точки по контуру габарита.
    const sx = Math.max(1, Math.ceil((pt.wx1 - pt.wx0) / 3));
    const sy = Math.max(1, Math.ceil((pt.wy1 - pt.wy0) / 3));
    for (let q = 0; q <= sx; q++) {
      const x = pt.wx0 + ((pt.wx1 - pt.wx0) * q) / sx;
      if (!inside(x, pt.wy0)) c += W_OUT;
      if (!inside(x, pt.wy1)) c += W_OUT;
    }
    for (let q = 1; q < sy; q++) {
      const y = pt.wy0 + ((pt.wy1 - pt.wy0) * q) / sy;
      if (!inside(pt.wx0, y)) c += W_OUT;
      if (!inside(pt.wx1, y)) c += W_OUT;
    }
    // Зоны: вывод цепи, которой в области нельзя; вывод сети вне зоны сети.
    for (const gi of pt.pads) {
      const n = padNet[gi];
      if (n < 0) continue;
      const q = { x: padX[gi], y: padY[gi] };
      let inHv = false;
      for (const a of areas) {
        if (q.x < a.box.minX || q.x > a.box.maxX || q.y < a.box.minY || q.y > a.box.maxY) continue;
        if (!pointInPolygon(q, a.ra.outline)) continue;
        if (a.ra.onlyClasses && !a.ra.onlyClasses.includes(padCls[gi])) c += W_ZONE;
        else if (a.ra.keepoutTracks && !a.ra.layers) c += W_ZONE * 0.3;
        if (hvAreas.includes(a)) inHv = true;
      }
      if (role[n] === ROLE_HV && hvAreas.length && !inHv) c += W_ZONE * 0.4;
    }
    // Разъём — к краю платы.
    if (pt.connector) c += W_EDGE * Math.min(pt.wx0 - bb.minX, bb.maxX - pt.wx1, pt.wy0 - bb.minY, bb.maxY - pt.wy1, 60);
    return c;
  };
  /** Нехватка зазора от выводов сети одной детали до остальных выводов другой, мм. */
  const hvDeficit = (a: Part, b: Part, gap: number): number => {
    if (gap >= hvClear + 2 || !((a.hasHv && b.hasLv) || (a.hasLv && b.hasHv))) return 0;
    let s = 0;
    for (const ga of a.pads) {
      const na = padNet[ga];
      if (na < 0) continue;
      for (const gb of b.pads) {
        const nb = padNet[gb];
        if (nb < 0 || (role[na] === ROLE_HV) === (role[nb] === ROLE_HV)) continue;
        const d = Math.hypot(padX[ga] - padX[gb], padY[ga] - padY[gb]) - padR[ga] - padR[gb];
        if (d < hvClear) s += hvClear - d;
      }
    }
    return s;
  };
  const pairCost = (i: number, j: number): number => {
    const a = parts[i];
    const b = parts[j];
    let c = 0;
    const ox = Math.min(a.wx1, b.wx1) - Math.max(a.wx0, b.wx0);
    const oy = Math.min(a.wy1, b.wy1) - Math.max(a.wy0, b.wy0);
    if (ox > 0 && oy > 0) c += W_OVERLAP * (ox * oy + 1);
    const gap = Math.max(-ox, -oy, 0);
    c += W_HV * hvDeficit(a, b, gap);
    if (gap < noiseD && ((a.hasNoisy && b.hasSens) || (a.hasSens && b.hasNoisy)))
      for (const ga of a.pads) {
        const ra = role[padNet[ga]] ?? 0;
        if (padNet[ga] < 0 || (ra !== ROLE_NOISY && ra !== ROLE_SENS)) continue;
        for (const gb of b.pads) {
          const rb = padNet[gb] < 0 ? 0 : role[padNet[gb]];
          if (!((ra === ROLE_NOISY && rb === ROLE_SENS) || (ra === ROLE_SENS && rb === ROLE_NOISY))) continue;
          const d = Math.hypot(padX[ga] - padX[gb], padY[ga] - padY[gb]);
          if (d < noiseD) c += W_NOISE * (noiseD - d);
        }
      }
    return c;
  };
  const decapCost = (q: [number, number]) => W_DECAP * Math.max(0, Math.hypot(padX[q[0]] - padX[q[1]], padY[q[0]] - padY[q[1]]) - 3);
  const decapOf: number[][] = parts.map(() => []);
  decap.forEach((q, k) => {
    decapOf[padPart[q[0]]].push(k);
    if (padPart[q[1]] !== padPart[q[0]]) decapOf[padPart[q[1]]].push(k);
  });

  const score = (): PlaceScore => {
    let length = 0;
    let cost = crossW * crossTotal + wallW * wallTotal;
    for (let n = 0; n < netIds.length; n++) {
      length += netLen[n];
      cost += netLen[n] * netW[n];
    }
    let overlap = 0;
    let hv = 0;
    for (let i = 0; i < NP; i++)
      for (let j = i + 1; j < NP; j++) {
        const a = parts[i];
        const b = parts[j];
        const ox = Math.min(a.wx1, b.wx1) - Math.max(a.wx0, b.wx0);
        const oy = Math.min(a.wy1, b.wy1) - Math.max(a.wy0, b.wy0);
        if (ox > 0 && oy > 0) overlap += ox * oy;
        hv += hvDeficit(a, b, Math.max(-ox, -oy, 0));
        cost += pairCost(i, j);
      }
    let outside = 0;
    let zone = 0;
    for (let i = 0; i < NP; i++) {
      cost += selfCost(i);
      const pt = parts[i];
      for (const [x, y] of [
        [pt.wx0, pt.wy0],
        [pt.wx1, pt.wy0],
        [pt.wx1, pt.wy1],
        [pt.wx0, pt.wy1],
      ])
        if (!inside(x, y)) outside++;
      for (const gi of pt.pads) {
        if (padNet[gi] < 0) continue;
        const q = { x: padX[gi], y: padY[gi] };
        for (const a of areas) if (a.ra.onlyClasses && pointInPolygon(q, a.ra.outline) && !a.ra.onlyClasses.includes(padCls[gi])) zone++;
      }
    }
    for (const q of decap) cost += decapCost(q);
    return { length: Math.round(length), crossings: crossTotal, walls: wallTotal, overlap: +overlap.toFixed(1), outside, zone, hv: +hv.toFixed(1), cost: Math.round(cost) };
  };
  const before = score();

  // ---- ход: сдвиг, поворот, обмен ----
  const netMark = new Uint32Array(netIds.length);
  let markGen = 0;
  const affectedNets = (ids: number[]): number[] => {
    markGen++;
    const out: number[] = [];
    for (const i of ids)
      for (const gi of parts[i].pads) {
        const n = padNet[gi];
        if (n >= 0 && netMark[n] !== markGen) {
          netMark[n] = markGen;
          out.push(n);
        }
      }
    return out;
  };
  const crossInvolving = (A: number[]): number => {
    let c = 0;
    const inA = netMark; // метка текущего набора
    for (let x = 0; x < A.length; x++) {
      const e = netEdges[A[x]];
      if (!e.length) continue;
      for (let n = 0; n < netIds.length; n++) {
        if (n === A[x] || !netEdges[n].length) continue;
        if (inA[n] === markGen && n < A[x]) continue; // пара внутри A — один раз
        c += edgeCross(e, netEdges[n]);
      }
    }
    return c;
  };
  const localCost = (M: number[], A: number[]): { cost: number; cross: number; through: number } => {
    let c = 0;
    for (const n of A) c += netLen[n] * netW[n];
    const cross = crossInvolving(A);
    c += crossW * cross;
    // Через стены: связи сдвинутых цепей — через все детали; остальные связи — через сдвинутые детали.
    let through = 0;
    for (const n of A) through += edgeWalls(netEdges[n]);
    for (const i of M) for (let n = 0; n < netIds.length; n++) if (netMark[n] !== markGen && netEdges[n].length) through += edgeWallsPart(netEdges[n], i);
    c += wallW * through;
    const inM = (j: number) => M.includes(j);
    for (const i of M) {
      c += selfCost(i);
      for (let j = 0; j < NP; j++) if (j !== i && (!inM(j) || j > i)) c += pairCost(i, j);
      for (const k of decapOf[i]) c += decapCost(decap[k]);
    }
    return { cost: c, cross, through };
  };

  let steps = 0;
  const totalSteps = Math.round((o.effort ?? 1) * Math.max(4000, 350 * movable.length));
  const yieldEvery = o.yieldEvery ?? 2000;
  const tick = () => new Promise<void>((r) => setTimeout(r, 0));
  const saveParts = (M: number[]) => M.map((i) => ({ i, x: parts[i].x, y: parts[i].y, rot: parts[i].rot }));

  const tryMove = (M: number[], apply: () => void, T: number): boolean => {
    const A = affectedNets(M);
    const old = localCost(M, A);
    const saved = saveParts(M);
    const oldLen = A.map((n) => netLen[n]);
    const oldEdges = A.map((n) => netEdges[n]);
    apply();
    for (const i of M) place(i);
    for (const n of A) {
      netLen[n] = hpwl(n);
      netEdges[n] = mst(n);
    }
    // Метки A сохранились (affectedNets не вызывался) — считаем новую стоимость.
    const now = localCost(M, A);
    const delta = now.cost - old.cost;
    if (delta <= 0 || (T > 0 && random() < Math.exp(-delta / T))) {
      crossTotal += now.cross - old.cross;
      wallTotal += now.through - old.through;
      return true;
    }
    for (const s of saved) {
      parts[s.i].x = s.x;
      parts[s.i].y = s.y;
      parts[s.i].rot = s.rot;
      place(s.i);
    }
    A.forEach((n, q) => {
      netLen[n] = oldLen[q];
      netEdges[n] = oldEdges[q];
    });
    return false;
  };

  const W = bb.maxX - bb.minX;
  const H = bb.maxY - bb.minY;
  const L0 = Math.max(W, H) / 2;
  const randomMove = (T: number, T0: number) => {
    const i = movable[Math.floor(random() * movable.length)];
    const pt = parts[i];
    const r = random();
    const range = Math.max(G * 2, L0 * Math.pow(Math.max(T, 1e-9) / T0, 0.5));
    if (r < 0.55) {
      const nx = pt.x + (random() * 2 - 1) * range;
      const ny = pt.y + (random() * 2 - 1) * range;
      return tryMove([i], () => {
        pt.x = Math.min(bb.maxX, Math.max(bb.minX, nx));
        pt.y = Math.min(bb.maxY, Math.max(bb.minY, ny));
        snap(i);
      }, T);
    }
    if (r < 0.72) {
      const d = random() < 0.5 ? 90 : random() < 0.5 ? -90 : 180;
      return tryMove([i], () => {
        pt.rot += d;
        snap(i);
      }, T);
    }
    if (r < 0.88 && movable.length > 1) {
      const j = movable[Math.floor(random() * movable.length)];
      if (j === i) return false;
      const q = parts[j];
      if (Math.max(pt.area, q.area) > 4 * Math.max(1, Math.min(pt.area, q.area))) return false;
      return tryMove([i, j], () => {
        const cxI = (pt.wx0 + pt.wx1) / 2 - pt.x;
        const cyI = (pt.wy0 + pt.wy1) / 2 - pt.y;
        const cxJ = (q.wx0 + q.wx1) / 2 - q.x;
        const cyJ = (q.wy0 + q.wy1) / 2 - q.y;
        const ci = { x: (pt.wx0 + pt.wx1) / 2, y: (pt.wy0 + pt.wy1) / 2 };
        const cj = { x: (q.wx0 + q.wx1) / 2, y: (q.wy0 + q.wy1) / 2 };
        pt.x = cj.x - cxI;
        pt.y = cj.y - cyI;
        q.x = ci.x - cxJ;
        q.y = ci.y - cyJ;
        snap(i);
        snap(j);
      }, T);
    }
    // К середине связанных выводов других деталей.
    let sx = 0;
    let sy = 0;
    let k = 0;
    for (const gi of pt.pads) {
      const n = padNet[gi];
      if (n < 0 || netW[n] < 0.5) continue;
      for (const g2 of netPads[n])
        if (padPart[g2] !== i) {
          sx += padX[g2];
          sy += padY[g2];
          k++;
        }
    }
    if (!k) return false;
    const cx0 = (pt.wx0 + pt.wx1) / 2 - pt.x;
    const cy0 = (pt.wy0 + pt.wy1) / 2 - pt.y;
    const tx = sx / k + (random() * 2 - 1) * range * 0.3;
    const ty = sy / k + (random() * 2 - 1) * range * 0.3;
    return tryMove([i], () => {
      pt.x = tx - cx0;
      pt.y = ty - cy0;
      snap(i);
    }, T);
  };

  if (movable.length) {
    // Начальная температура: средний рост стоимости на случайных ходах.
    let sum = 0;
    let cnt = 0;
    for (let q = 0; q < 60; q++) {
      const i = movable[Math.floor(random() * movable.length)];
      const pt = parts[i];
      const M = [i];
      const A = affectedNets(M);
      const old = localCost(M, A).cost;
      const saved = saveParts(M);
      const oldLen = A.map((n) => netLen[n]);
      const oldEdges = A.map((n) => netEdges[n]);
      pt.x += (random() * 2 - 1) * L0 * 0.3;
      pt.y += (random() * 2 - 1) * L0 * 0.3;
      place(i);
      for (const n of A) {
        netLen[n] = hpwl(n);
        netEdges[n] = mst(n);
      }
      const d = localCost(M, A).cost - old;
      if (d > 0) {
        sum += d;
        cnt++;
      }
      pt.x = saved[0].x;
      pt.y = saved[0].y;
      place(i);
      A.forEach((n, z) => {
        netLen[n] = oldLen[z];
        netEdges[n] = oldEdges[z];
      });
    }
    const T0 = o.start === 'scratch' ? (cnt ? sum / cnt : 100) * 0.8 : (cnt ? sum / cnt : 100) * 0.15;
    const Tend = T0 * 0.002;
    const alpha = Math.pow(Tend / T0, 1 / totalSteps);
    let T = T0;
    for (steps = 0; steps < totalSteps; steps++) {
      randomMove(T, T0);
      T *= alpha;
      if (steps % yieldEvery === yieldEvery - 1) {
        if (o.progress) await o.progress((steps + 1) / totalSteps);
        await tick();
      }
    }

    // Узаконивание: детали с перекрытием, вне платы или не в своей зоне — ближайшее хорошее место.
    const partBad = (i: number): number => {
      let c = selfCost(i);
      for (let j = 0; j < NP; j++) if (j !== i) {
        const a = parts[i];
        const b = parts[j];
        const ox = Math.min(a.wx1, b.wx1) - Math.max(a.wx0, b.wx0);
        const oy = Math.min(a.wy1, b.wy1) - Math.max(a.wy0, b.wy0);
        if (ox > 0 && oy > 0) c += W_OVERLAP * (ox * oy + 1);
      }
      return c >= W_OVERLAP ? c : 0;
    };
    for (let pass = 0; pass < 3; pass++) {
      const bad = movable.filter((i) => partBad(i) > 0).sort((a, b) => parts[b].area - parts[a].area);
      if (!bad.length) break;
      for (const i of bad) {
        const pt = parts[i];
        const x0 = pt.x;
        const y0 = pt.y;
        const r0 = pt.rot;
        let best = { x: x0, y: y0, rot: r0, c: Infinity };
        const A = affectedNets([i]);
        for (let ring = 0; ring <= Math.ceil(L0 / G) && best.c === Infinity; ring += 1) {
          for (let dj = -ring; dj <= ring; dj++)
            for (let di = -ring; di <= ring; di++) {
              if (Math.max(Math.abs(di), Math.abs(dj)) !== ring) continue;
              for (const dr of [0, 90, 180, 270]) {
                pt.x = x0 + di * G;
                pt.y = y0 + dj * G;
                pt.rot = r0 + dr;
                snap(i);
                place(i);
                if (partBad(i) > 0) continue;
                for (const n of A) {
                  netLen[n] = hpwl(n);
                  netEdges[n] = mst(n);
                }
                const c = localCost([i], A).cost;
                if (c < best.c) best = { x: pt.x, y: pt.y, rot: pt.rot, c };
              }
            }
          // Нашли на этом кольце — довольно (ближе к месту, которое выбрал отжиг).
        }
        pt.x = best.x;
        pt.y = best.y;
        pt.rot = best.rot;
        place(i);
        for (const n of A) {
          netLen[n] = hpwl(n);
          netEdges[n] = mst(n);
        }
      }
      crossTotal = 0;
      for (let a = 0; a < netIds.length; a++) for (let b = a + 1; b < netIds.length; b++) if (netEdges[a].length && netEdges[b].length) crossTotal += edgeCross(netEdges[a], netEdges[b]);
      wallTotal = 0;
      for (let n = 0; n < netIds.length; n++) wallTotal += edgeWalls(netEdges[n]);
    }
    // Доводка без случайности: только улучшения.
    for (let q = 0; q < movable.length * 30; q++) randomMove(0, T0 * 50);
  }

  const after = score();
  // Если стало хуже (например, из-за неудачного начала с нуля) — оставляем как было.
  if (after.cost > before.cost && o.start !== 'scratch') {
    parts.forEach((pt, i) => {
      pt.x = startState[i].x;
      pt.y = startState[i].y;
      pt.rot = startState[i].rot;
    });
    return { moves: [], before, after: before, ms: Date.now() - t0, steps };
  }
  const moves: PlaceMove[] = [];
  for (const pt of parts) {
    if (!pt.movable) continue;
    const og = origin[pt.id];
    const r = ((Math.round(pt.rot * 1000) / 1000) % 360 + 360) % 360;
    if (Math.abs(og.x - pt.x) < 1e-6 && Math.abs(og.y - pt.y) < 1e-6 && Math.abs(((og.rot - r) % 360 + 360) % 360) < 1e-6) continue;
    moves.push({ id: pt.id, at: { x: +pt.x.toFixed(4), y: +pt.y.toFixed(4) }, rotation: r });
  }
  return { moves, before, after, ms: Date.now() - t0, steps };
}

/** Применить расстановку к проекту (дорожки старых мест при этом устаревают — их стирают отдельно). */
export function applyPlacement(p: Project, moves: PlaceMove[]): void {
  for (const m of moves) {
    const c = p.components[m.id];
    if (!c) continue;
    c.at = { x: m.at.x, y: m.at.y };
    c.rotation = m.rotation;
  }
}
