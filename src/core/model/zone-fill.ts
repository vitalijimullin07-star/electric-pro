import { boxOfPoints, distPointSegment, signedArea } from '../math/geom';
import { circleShape, distPointShape, type Shape } from '../math/shape';
import type { Vec2 } from '../math/vec';
import { graphicPrims, type LayerPrims } from '../render/graphic';
import { boardCopperLayers } from './layers';
import { boardPolygon } from './project';
import { netClassOf, requiredClearance } from './rules';
import type { CopperLayer, Id, Project, Zone } from './types';
import type { World } from './world';

/*
 * Заливка полигонов меди. Считается на сетке: в каждом узле — расстояние со знаком
 * до ближайшей запретной границы (край полигона, отступ от края платы, чужая медь
 * с зазором, области запрета). Граница заливки — линия нуля этого поля
 * (marching squares с интерполяцией), поэтому контуры гладкие, а не ступеньками.
 * Острова, не касающиеся ни одной площадки своей цепи, убираются, как в KiCad.
 */

export interface ZoneFill {
  zone: Zone;
  /** Контуры заливки по правилу чётности, от большего к меньшему. */
  loops: Vec2[][];
  /** holes[i] — контур-вырез внутри заливки. */
  holes: boolean[];
  /** Острова заливки: ключи узлов связности (P…, T…, V…), которых касается каждый. */
  islands: string[][];
  /** Сколько островов убрано: ни с чем своей цепи не соединены. */
  removed: number;
  /** Шаг сетки расчёта, мм. */
  step: number;
}

/** Цепь медного объекта по ключу узла связности (без учёта полигонов). */
export type NetOfKey = (key: string) => Id | null | 'short';

interface CuObj {
  key: string | null;
  shape: Shape;
  net: Id | null | 'short';
  /** Площадка: без цепи режется, а не присоединяется. */
  pad: boolean;
}

/** Узлов сетки на полигон, не больше: шаг растёт для больших плат. */
const NODE_BUDGET = 260_000;
const BIG = 1e4;

export function fillZones(p: Project, world: World, netOf: NetOfKey): ZoneFill[] {
  const zones = Object.values(p.zones);
  if (!zones.length) return [];
  const layers = boardCopperLayers(p.board.copperLayers);

  // Медь по слоям.
  const cu: Record<CopperLayer, CuObj[]> = { 'F.Cu': [], 'B.Cu': [] };
  const holes: Shape[] = [];
  for (const wp of world.pads) {
    if (!wp.layers.length) {
      if (wp.drill) holes.push(circleShape(wp.center, wp.drill / 2));
      continue;
    }
    for (const l of wp.layers) cu[l].push({ key: 'P' + wp.key, shape: wp.shape, net: wp.net, pad: true });
  }
  for (const s of world.segments) cu[s.track.layer].push({ key: 'T' + s.track.id, shape: s.shape, net: netOf('T' + s.track.id), pad: false });
  for (const v of world.vias) {
    const net = netOf('V' + v.via.id);
    for (const l of ['F.Cu', 'B.Cu'] as CopperLayer[]) cu[l].push({ key: 'V' + v.via.id, shape: v.shape, net, pad: false });
  }
  // Графика и надписи на меди: без цепи.
  const gfx: LayerPrims = {};
  for (const d of Object.values(p.drawings)) if (d.layer === 'F.Cu' || d.layer === 'B.Cu') graphicPrims(d, null, null, gfx);
  const gfxPolys: Record<CopperLayer, Vec2[][]> = { 'F.Cu': [], 'B.Cu': [] };
  for (const l of ['F.Cu', 'B.Cu'] as CopperLayer[])
    for (const pr of gfx[l] ?? []) {
      if (pr.kind === 'path') {
        const n = pr.pts.length;
        for (let i = 1; i < n + (pr.closed ? 1 : 0); i++) cu[l].push({ key: null, shape: capsule(pr.pts[i - 1], pr.pts[i % n], pr.width / 2), net: null, pad: true });
      } else if (pr.kind === 'region') gfxPolys[l].push(pr.pts);
    }

  const board = boardPolygon(p.board);
  const out: ZoneFill[] = [];
  for (const z of zones) {
    if (!layers.includes(z.layer) || z.outline.length < 3) {
      out.push({ zone: z, loops: [], holes: [], islands: [], removed: 0, step: 0 });
      continue;
    }
    const zoneCls = z.net ? netClassOf(p, z.net) : null;
    const baseClr = Math.max(z.clearance, p.rules.minClearance, zoneCls?.clearance ?? 0);
    const clrTo = (net: Id | null | 'short'): number => Math.max(baseClr, requiredClearance(p.rules, zoneCls, net && net !== 'short' ? netClassOf(p, net) : null));

    // Сетка по габариту полигона в пределах платы.
    const zb = boxOfPoints(z.outline);
    const bb = boxOfPoints(board);
    const minX = Math.max(zb.minX, bb.minX);
    const minY = Math.max(zb.minY, bb.minY);
    const maxX = Math.min(zb.maxX, bb.maxX);
    const maxY = Math.min(zb.maxY, bb.maxY);
    if (maxX <= minX || maxY <= minY) {
      out.push({ zone: z, loops: [], holes: [], islands: [], removed: 0, step: 0 });
      continue;
    }
    const h = Math.min(0.5, Math.max(0.1, Math.sqrt(((maxX - minX) * (maxY - minY)) / NODE_BUDGET)));
    // Перешейки уже минимальной ширины убираем (раскрытие: сжать на r и расширить обратно).
    const r = Math.max(0, z.minWidth) / 2;
    const grid = new Grid(minX - 2 * h, minY - 2 * h, Math.ceil((maxX - minX) / h) + 5, Math.ceil((maxY - minY) / h) + 5, h, 2 * h + 2 * r);
    // Запас на погрешность интерполяции: контур идёт хордами внутри скруглений.
    const margin = Math.min(0.03, h * 0.1);

    grid.polygon(z.outline, true, 0);
    grid.polygon(board, true, p.rules.edgeClearance);
    for (const cut of p.board.cutouts) grid.polygon(cut, false, p.rules.edgeClearance);
    for (const hole of holes) grid.shape(hole, baseClr + margin);
    for (const ra of Object.values(p.ruleAreas)) {
      const forbidden = ra.keepoutTracks || (ra.onlyClasses?.length && !ra.onlyClasses.includes(zoneCls?.name ?? netClassOf(p, null).name));
      if (forbidden) grid.polygon(ra.outline, false, 0);
    }
    // Полигоны других цепей с большим приоритетом (при равном — созданный раньше) заливаются первыми.
    for (const o of zones) {
      if (o === z || o.layer !== z.layer || o.net === z.net || o.outline.length < 3) continue;
      if (o.priority > z.priority || (o.priority === z.priority && o.id < z.id)) grid.polygon(o.outline, false, Math.max(baseClr, o.clearance));
    }
    for (const poly of gfxPolys[z.layer]) grid.polygon(poly, false, baseClr + margin);

    const joins: CuObj[] = [];
    for (const o of cu[z.layer]) {
      const own = z.net !== null && (o.net === z.net || (o.net === null && !o.pad && o.key !== null));
      if (own) joins.push(o);
      else grid.shape(o.shape, clrTo(o.net) + margin);
    }

    grid.border();
    grid.open(r);
    const { labels, count } = grid.label();
    const touches: Set<string>[] = Array.from({ length: count }, () => new Set<string>());
    for (const o of joins) for (const lab of grid.touching(o.shape, labels)) touches[lab].add(o.key!);
    // Остров без своих площадок никуда не подключён — убираем (у полигона без цепи оставляем всё).
    let removed = 0;
    const keep = new Uint8Array(count);
    for (let i = 0; i < count; i++) {
      if (z.net === null || touches[i].size) keep[i] = 1;
      else removed++;
    }
    if (removed) grid.drop(labels, keep);
    const loops = grid.contours();
    const withArea = loops.map((pts) => ({ pts, a: signedArea(pts) })).filter((x) => Math.abs(x.a) > 1e-4);
    withArea.sort((a, b) => Math.abs(b.a) - Math.abs(a.a));
    out.push({
      zone: z,
      loops: withArea.map((x) => x.pts),
      // Внешние контуры обходятся по часовой (на экране), вырезы — против: см. Grid.contours.
      holes: withArea.map((x) => x.a > 0),
      islands: touches.filter((_, i) => keep[i] && touches[i].size).map((s) => [...s]),
      removed,
      step: h,
    });
  }
  return out;
}

/** Расстояние от точки до отрезка. */
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

function capsule(a: Vec2, b: Vec2, r: number): Shape {
  return { pts: [a, b], r, box: { minX: Math.min(a.x, b.x) - r, minY: Math.min(a.y, b.y) - r, maxX: Math.max(a.x, b.x) + r, maxY: Math.max(a.y, b.y) + r } };
}

/** Сетка узлов с полем расстояний: > 0 — заливать можно. */
class Grid {
  f: Float32Array;
  /**
   * @param extra насколько за границей считать точное расстояние: поле должно быть верным
   *   не только у нуля, но и на глубину раскрытия.
   */
  constructor(
    readonly x0: number,
    readonly y0: number,
    readonly nx: number,
    readonly ny: number,
    readonly h: number,
    readonly extra: number,
  ) {
    this.f = new Float32Array(nx * ny).fill(BIG);
  }

  private range(minX: number, minY: number, maxX: number, maxY: number): [number, number, number, number] | null {
    const i0 = Math.max(0, Math.ceil((minX - this.x0) / this.h));
    const i1 = Math.min(this.nx - 1, Math.floor((maxX - this.x0) / this.h));
    const j0 = Math.max(0, Math.ceil((minY - this.y0) / this.h));
    const j1 = Math.min(this.ny - 1, Math.floor((maxY - this.y0) / this.h));
    return i0 > i1 || j0 > j1 ? null : [i0, i1, j0, j1];
  }

  /**
   * Многоугольник: inside = true — заливать можно только внутри (с отступом offset от края),
   * false — внутри нельзя, снаружи держим отступ offset.
   */
  polygon(poly: Vec2[], inside: boolean, offset: number): void {
    const { nx, ny, h, x0, y0, f } = this;
    const g = new Float32Array(nx * ny).fill(-BIG);
    // Внутренность — построчно по пересечениям с рёбрами.
    const xs: number[] = [];
    for (let j = 0; j < ny; j++) {
      const y = y0 + j * h;
      xs.length = 0;
      for (let k = 0, m = poly.length - 1; k < poly.length; m = k++) {
        const a = poly[k];
        const b = poly[m];
        if (a.y > y !== b.y > y) xs.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const i0 = Math.max(0, Math.ceil((xs[k] - x0) / h));
        const i1 = Math.min(nx - 1, Math.floor((xs[k + 1] - x0) / h));
        for (let i = i0; i <= i1; i++) g[j * nx + i] = BIG;
      }
    }
    // Точное расстояние у рёбер.
    const band = offset + this.extra;
    for (let k = 0, m = poly.length - 1; k < poly.length; m = k++) {
      const a = poly[m];
      const b = poly[k];
      const r = this.range(Math.min(a.x, b.x) - band, Math.min(a.y, b.y) - band, Math.max(a.x, b.x) + band, Math.max(a.y, b.y) + band);
      if (!r) continue;
      for (let j = r[2]; j <= r[3]; j++)
        for (let i = r[0]; i <= r[1]; i++) {
          const idx = j * nx + i;
          const d = segDist(x0 + i * h, y0 + j * h, a.x, a.y, b.x, b.y);
          if (d < Math.abs(g[idx])) g[idx] = g[idx] > 0 ? d : -d;
        }
    }
    for (let idx = 0; idx < f.length; idx++) {
      const v = (inside ? g[idx] : -g[idx]) - offset;
      if (v < f[idx]) f[idx] = v;
    }
  }

  /** Чужая медь: нельзя ближе clearance к фигуре. */
  shape(s: Shape, clearance: number): void {
    const { nx, h, x0, y0, f } = this;
    const band = clearance + this.extra;
    const r = this.range(s.box.minX - band, s.box.minY - band, s.box.maxX + band, s.box.maxY + band);
    if (!r) return;
    const q = { x: 0, y: 0 };
    const [a, b] = s.pts;
    const kind = s.pts.length === 1 ? 1 : s.pts.length === 2 ? 2 : 3;
    const rr = s.r + clearance;
    for (let j = r[2]; j <= r[3]; j++)
      for (let i = r[0]; i <= r[1]; i++) {
        const idx = j * nx + i;
        if (f[idx] <= -clearance) continue;
        q.x = x0 + i * h;
        q.y = y0 + j * h;
        // Круг и капсула — самые частые (переходные, дорожки, круглые площадки): считаем без выделения памяти.
        const v =
          kind === 1
            ? Math.max(Math.hypot(q.x - a.x, q.y - a.y) - rr, -clearance)
            : kind === 2
              ? Math.max(segDist(q.x, q.y, a.x, a.y, b.x, b.y) - rr, -clearance)
              : distPointShape(q, s) - clearance;
        if (v < f[idx]) f[idx] = v;
      }
  }

  /** Крайние узлы — снаружи, чтобы контуры замыкались. */
  border(): void {
    const { nx, ny, f } = this;
    for (let i = 0; i < nx; i++) {
      f[i] = Math.min(f[i], -this.h);
      f[(ny - 1) * nx + i] = Math.min(f[(ny - 1) * nx + i], -this.h);
    }
    for (let j = 0; j < ny; j++) {
      f[j * nx] = Math.min(f[j * nx], -this.h);
      f[j * nx + nx - 1] = Math.min(f[j * nx + nx - 1], -this.h);
    }
  }

  /**
   * Морфологическое раскрытие на радиус r: остаётся то, что покрывается кругами радиуса r
   * внутри заливки. Узкие перешейки и щепки уже 2r исчезают, выпуклые углы скругляются.
   * Расстояние до сжатой области оцениваем через соседние узлы: max(0, |x−y| − (f(y) − r)).
   */
  open(r: number): void {
    if (r <= 0) return;
    const { nx, ny, h, f } = this;
    const out = new Float32Array(f);
    const reach = r + 2 * h;
    const R = Math.ceil(reach / h);
    const offs: number[] = [];
    for (let dj = -R; dj <= R; dj++)
      for (let di = -R; di <= R; di++) {
        const d = Math.hypot(di, dj) * h;
        if (d <= reach) offs.push(di, dj, d);
      }
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        const v = f[k];
        if (v <= 0 || v >= r) continue;
        let D = reach;
        for (let o = 0; o < offs.length && D > 0; o += 3) {
          const ii = i + offs[o];
          const jj = j + offs[o + 1];
          if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
          const fy = f[jj * nx + ii];
          if (fy <= r) continue;
          const c = offs[o + 2] - (fy - r);
          if (c < D) D = c;
        }
        out[k] = Math.min(v, r - Math.max(0, D));
      }
    this.f = out;
  }

  /** Связные (по четырём соседям) области заливки. */
  label(): { labels: Int32Array; count: number } {
    const { nx, f } = this;
    const labels = new Int32Array(f.length).fill(-1);
    const stack = new Int32Array(f.length);
    let count = 0;
    for (let s = 0; s < f.length; s++) {
      if (f[s] <= 0 || labels[s] >= 0) continue;
      let top = 0;
      stack[top++] = s;
      labels[s] = count;
      while (top) {
        const k = stack[--top];
        const i = k % nx;
        for (let d = 0; d < 4; d++) {
          const m = d === 0 ? (i > 0 ? k - 1 : -1) : d === 1 ? (i < nx - 1 ? k + 1 : -1) : d === 2 ? k - nx : k + nx;
          if (m < 0 || m >= f.length || labels[m] >= 0 || f[m] <= 0) continue;
          labels[m] = count;
          stack[top++] = m;
        }
      }
      count++;
    }
    return { labels, count };
  }

  /** Острова, которых касается своя медь (узел заливки не дальше полшага от фигуры). */
  touching(s: Shape, labels: Int32Array): Set<number> {
    const { nx, h, x0, y0, f } = this;
    const out = new Set<number>();
    const r = this.range(s.box.minX - h, s.box.minY - h, s.box.maxX + h, s.box.maxY + h);
    if (!r) return out;
    const q = { x: 0, y: 0 };
    for (let j = r[2]; j <= r[3]; j++)
      for (let i = r[0]; i <= r[1]; i++) {
        const idx = j * nx + i;
        if (f[idx] <= 0 || out.has(labels[idx])) continue;
        q.x = x0 + i * h;
        q.y = y0 + j * h;
        if (distPointShape(q, s) <= h * 0.75) out.add(labels[idx]);
      }
    return out;
  }

  drop(labels: Int32Array, keep: Uint8Array): void {
    const f = this.f;
    for (let k = 0; k < f.length; k++) if (labels[k] >= 0 && !keep[labels[k]]) f[k] = -this.h;
  }

  /**
   * Контуры нуля поля. Углы клетки обходим по часовой (на экране): TL, TR, BR, BL;
   * отрезок идёт от «входа» в заливку к следующему по часовой «выходу» — так у всех
   * контуров заливка с одной стороны, а седловые клетки разделяются (как соседство по четырём).
   */
  contours(): Vec2[][] {
    const { nx, ny, h, x0, y0, f } = this;
    const next = new Int32Array(2 * nx * ny).fill(-1);
    const H = (i: number, j: number) => 2 * (j * nx + i);
    const V = (i: number, j: number) => 2 * (j * nx + i) + 1;
    const c = [0, 0, 0, 0];
    const e = [0, 0, 0, 0];
    for (let j = 0; j < ny - 1; j++)
      for (let i = 0; i < nx - 1; i++) {
        c[0] = f[j * nx + i];
        c[1] = f[j * nx + i + 1];
        c[2] = f[(j + 1) * nx + i + 1];
        c[3] = f[(j + 1) * nx + i];
        const a0 = c[0] > 0;
        if (a0 === c[1] > 0 && a0 === c[2] > 0 && a0 === c[3] > 0) continue;
        e[0] = H(i, j);
        e[1] = V(i + 1, j);
        e[2] = H(i, j + 1);
        e[3] = V(i, j);
        for (let k = 0; k < 4; k++) {
          // Вход: угол k снаружи, угол k+1 внутри.
          if (c[k] > 0 || !(c[(k + 1) % 4] > 0)) continue;
          for (let t = 1; t < 4; t++) {
            const m = (k + t) % 4;
            if (c[m] > 0 && !(c[(m + 1) % 4] > 0)) {
              next[e[k]] = e[m];
              break;
            }
          }
        }
      }
    const point = (id: number): Vec2 => {
      const k = id >> 1;
      const i = k % nx;
      const j = (k - i) / nx;
      const fa = f[k];
      if ((id & 1) === 0) {
        const t = fa / (fa - f[k + 1]);
        return { x: x0 + (i + t) * h, y: y0 + j * h };
      }
      const t = fa / (fa - f[k + nx]);
      return { x: x0 + i * h, y: y0 + (j + t) * h };
    };
    const loops: Vec2[][] = [];
    for (let s = 0; s < next.length; s++) {
      if (next[s] < 0) continue;
      const pts: Vec2[] = [];
      let cur = s;
      while (cur >= 0 && next[cur] >= 0) {
        pts.push(point(cur));
        const n = next[cur];
        next[cur] = -1;
        cur = n;
      }
      if (pts.length >= 3) loops.push(simplify(pts));
    }
    return loops.map((pts) => pts.map((q) => ({ x: Math.round(q.x * 1e4) / 1e4, y: Math.round(q.y * 1e4) / 1e4 })));
  }
}

/** Убирает точки, лежащие почти на прямой между соседями (прямые участки контура). */
function simplify(pts: Vec2[], eps = 0.002): Vec2[] {
  if (pts.length < 4) return pts;
  const out: Vec2[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const prev = out[out.length - 1];
    const nxt = pts[(i + 1) % pts.length];
    if (distPointSegment(pts[i], prev, nxt) > eps) out.push(pts[i]);
  }
  return out.length >= 3 ? out : pts;
}
