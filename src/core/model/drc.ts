import { boxOfPoints, expandBox, pointInPolygon, segmentSegment, segmentsIntersect, type Box } from '../math/geom';
import { shapeGap, type Shape } from '../math/shape';
import { SpatialHash } from '../math/spatial-hash';
import { dist } from '../math/vec';
import type { Vec2 } from '../math/vec';
import { computeConnectivity } from './connectivity';
import { boardCopperLayers } from './layers';
import { boardPolygon } from './project';
import { maxClearance, netClassOf, requiredClearance } from './rules';
import type { CopperLayer, Id, ItemRef, NetClass, Project } from './types';
import { padLabel } from './world';

/*
 * Проверка правил проектирования (DRC). Результат — список отметок с точкой
 * на плате, текстом и ссылками на виновников. Пересчитывается целиком:
 * на платах в несколько тысяч объектов укладывается в десятки миллисекунд.
 */

export type DrcSeverity = 'error' | 'warning';
export type DrcCode =
  | 'clearance'
  | 'short'
  | 'unrouted'
  | 'edge'
  | 'outside'
  | 'hole'
  | 'width'
  | 'via'
  | 'ring'
  | 'keepout'
  | 'class-area'
  | 'courtyard'
  | 'dangling'
  | 'no-footprint'
  | 'no-net-pad'
  | 'zone';

export interface DrcMarker {
  id: string;
  code: DrcCode;
  severity: DrcSeverity;
  message: string;
  at: Vec2;
  items: ItemRef[];
}

export interface DrcReport {
  markers: DrcMarker[];
  errors: number;
  warnings: number;
}

interface CuItem {
  ref: ItemRef;
  owner: string;
  net: Id | null;
  cls: NetClass | null;
  shape: Shape;
  layer: CopperLayer;
  label: string;
  drill?: number;
  drillAt?: Vec2;
  width?: number;
}

const cache = new WeakMap<Project, DrcReport>();

export function runDrc(p: Project): DrcReport {
  const hit = cache.get(p);
  if (hit) return hit;
  const conn = computeConnectivity(p);
  const w = conn.world;
  const R = p.rules;
  const markers: DrcMarker[] = [];
  const seen = new Set<string>();
  let n = 0;
  const add = (code: DrcCode, severity: DrcSeverity, at: Vec2, message: string, items: ItemRef[]) => {
    const key = `${code}:${Math.round(at.x * 4)}:${Math.round(at.y * 4)}:${items
      .map((i) => i.id)
      .sort()
      .join(',')}`;
    if (seen.has(key)) return;
    seen.add(key);
    markers.push({ id: 'd' + n++, code, severity, message, at: { x: +at.x.toFixed(3), y: +at.y.toFixed(3) }, items });
  };

  const netName = (id: Id | null | 'short' | undefined) => (id && id !== 'short' ? (p.nets[id]?.name ?? '?') : id === 'short' ? 'замыкание' : 'без цепи');
  const clsOf = (net: Id | null | 'short' | undefined): NetClass | null => (net && net !== 'short' ? netClassOf(p, net) : null);
  const layers = boardCopperLayers(p.board.copperLayers);

  // Медные объекты по слоям.
  const items: CuItem[] = [];
  for (const wp of w.pads) {
    if (!wp.footprint) continue;
    for (const l of wp.layers) {
      if (!layers.includes(l) && wp.pad.type === 'smd') continue;
      items.push({
        ref: { kind: 'component', id: wp.component.id },
        owner: 'pad:' + wp.key,
        net: wp.net,
        cls: clsOf(wp.net),
        shape: wp.shape,
        layer: l,
        label: padLabel(wp),
        drill: wp.drill ?? undefined,
        drillAt: wp.drill ? wp.center : undefined,
      });
    }
  }
  for (const s of w.segments) {
    const net = conn.itemNet.get(s.track.id);
    items.push({
      ref: { kind: 'track', id: s.track.id },
      owner: 'track:' + s.track.id,
      net: net === 'short' ? null : (net ?? null),
      cls: clsOf(net),
      shape: s.shape,
      layer: s.track.layer,
      label: `дорожка ${netName(net)}`,
      width: s.track.width,
    });
  }
  for (const v of w.vias) {
    const net = conn.itemNet.get(v.via.id);
    for (const l of ['F.Cu', 'B.Cu'] as CopperLayer[])
      items.push({
        ref: { kind: 'via', id: v.via.id },
        owner: 'via:' + v.via.id,
        net: net === 'short' ? null : (net ?? null),
        cls: clsOf(net),
        shape: v.shape,
        layer: l,
        label: `переходное ${netName(net)}`,
        drill: v.via.drill,
        drillAt: v.via.at,
      });
  }

  // 1. Зазоры между медью разных цепей.
  const maxC = maxClearance(p);
  const hash: Record<CopperLayer, SpatialHash<CuItem>> = { 'F.Cu': new SpatialHash(3), 'B.Cu': new SpatialHash(3) };
  for (const it of items) hash[it.layer].insert(it, it.shape.box);
  // Пары проверяются по отдельным кускам меди, а не по владельцам: у дорожки много отрезков,
  // и ближе всего к чужой меди может оказаться не тот, что попался первым.
  const index = new Map<CuItem, number>(items.map((it, i) => [it, i]));
  const checked = new Set<number>();
  for (const a of items) {
    if (!layers.includes(a.layer)) continue;
    const q: Box = expandBox(a.shape.box, maxC);
    const ia = index.get(a)!;
    for (const b of hash[a.layer].query(q)) {
      if (a === b || a.owner === b.owner) continue;
      const ib = index.get(b)!;
      const key = ia < ib ? ia * items.length + ib : ib * items.length + ia;
      if (checked.has(key)) continue;
      checked.add(key);
      if (a.net && b.net && a.net === b.net) continue;
      // Дорожка и переходное без цепи, физически соединённые с площадкой цепи, — уже её часть (связность это учла).
      const need = requiredClearance(R, a.cls, b.cls);
      const g = shapeGap(a.shape, b.shape);
      if (g.d < need - 1e-4) {
        const touching = g.d <= 1e-4;
        const sameOwnerComp = a.ref.kind === 'component' && b.ref.kind === 'component' && a.ref.id === b.ref.id;
        if (touching && sameOwnerComp && a.net === null && b.net === null) continue;
        const bothNoNet = !a.net && !b.net;
        add(
          touching && a.net && b.net ? 'short' : 'clearance',
          bothNoNet ? 'warning' : 'error',
          g.at,
          touching
            ? `${cap(a.label)} касается: ${b.label}`
            : `Зазор ${g.d.toFixed(2)} мм между «${a.label}» и «${b.label}», нужно ${need.toFixed(2)} мм`,
          [a.ref, b.ref],
        );
      }
    }
  }

  // 2. Замыкания и неразведённые цепи из связности.
  for (const s of conn.shorts) add('short', 'error', s.at, `Замыкание цепей ${s.nets.map((id) => p.nets[id]?.name ?? id).join(', ')}`, s.items);
  for (const st of conn.nets.values()) {
    if (st.complete) continue;
    const line = conn.ratsnest.find((r) => r.netId === st.netId);
    add('unrouted', 'error', line ? line.a : { x: 0, y: 0 }, `Цепь ${p.nets[st.netId]?.name ?? st.netId} не разведена: ${st.islands.length} островка`, []);
  }

  // 3. Край платы и выход за контур.
  const poly = boardPolygon(p.board);
  for (const it of items) {
    if (it.owner.startsWith('via:') && it.layer === 'F.Cu') continue;
    const c = centerOf(it.shape);
    const outside = it.shape.pts.some((q) => !pointInPolygon(q, poly));
    if (outside) {
      add('outside', 'error', c, `${cap(it.label)} вне платы`, [it.ref]);
      continue;
    }
    const d = shapeToOutline(it.shape, poly);
    if (d < R.edgeClearance - 1e-4) add('edge', 'error', c, `${cap(it.label)}: до края платы ${Math.max(0, d).toFixed(2)} мм, нужно ${R.edgeClearance} мм`, [it.ref]);
    for (const cut of p.board.cutouts) {
      if (it.shape.pts.some((q) => pointInPolygon(q, cut))) add('outside', 'error', c, `${cap(it.label)} внутри выреза`, [it.ref]);
      else if (shapeToOutline(it.shape, cut) < R.edgeClearance - 1e-4) add('edge', 'error', c, `${cap(it.label)} слишком близко к вырезу`, [it.ref]);
    }
  }

  // 4. Отверстия: минимальный диаметр, кольцо, расстояние между отверстиями.
  const holes: { at: Vec2; d: number; ref: ItemRef; owner: string; label: string }[] = [];
  const holeOwners = new Set<string>();
  for (const it of items)
    if (it.drill && it.drillAt && !holeOwners.has(it.owner)) {
      holeOwners.add(it.owner);
      holes.push({ at: it.drillAt, d: it.drill, ref: it.ref, owner: it.owner, label: it.label });
      const ring = (Math.min(it.shape.box.maxX - it.shape.box.minX, it.shape.box.maxY - it.shape.box.minY) - it.drill) / 2;
      if (it.drill < R.minDrill - 1e-4) add('via', 'error', it.drillAt, `${cap(it.label)}: отверстие ${it.drill} мм меньше ${R.minDrill} мм`, [it.ref]);
      if (ring < R.minAnnularRing - 1e-4) add('ring', 'error', it.drillAt, `${cap(it.label)}: кольцо ${ring.toFixed(2)} мм меньше ${R.minAnnularRing} мм`, [it.ref]);
    }
  for (const wp of w.pads) if (wp.pad.type === 'npth' && wp.drill) holes.push({ at: wp.center, d: wp.drill, ref: { kind: 'component', id: wp.component.id }, owner: 'npth:' + wp.key, label: `отверстие ${wp.component.ref}` });
  const hh = new SpatialHash<(typeof holes)[number]>(3);
  for (const h of holes) hh.insert(h, { minX: h.at.x - h.d / 2, minY: h.at.y - h.d / 2, maxX: h.at.x + h.d / 2, maxY: h.at.y + h.d / 2 });
  const hchecked = new Set<string>();
  for (const a of holes)
    for (const b of hh.query(expandBox({ minX: a.at.x, minY: a.at.y, maxX: a.at.x, maxY: a.at.y }, a.d / 2 + R.holeToHole + 3))) {
      if (a === b) continue;
      const key = a.owner < b.owner ? a.owner + '|' + b.owner : b.owner + '|' + a.owner;
      if (hchecked.has(key)) continue;
      hchecked.add(key);
      const gap = dist(a.at, b.at) - a.d / 2 - b.d / 2;
      if (gap < R.holeToHole - 1e-4) add('hole', 'error', { x: (a.at.x + b.at.x) / 2, y: (a.at.y + b.at.y) / 2 }, `Отверстия «${a.label}» и «${b.label}»: между ними ${Math.max(0, gap).toFixed(2)} мм, нужно ${R.holeToHole} мм`, [a.ref, b.ref]);
    }

  // 5. Ширина дорожек, размеры переходных, слой на односторонней плате.
  for (const t of Object.values(p.tracks)) {
    if (t.width < R.minTrackWidth - 1e-4) add('width', 'error', t.points[0], `Дорожка ${t.width} мм уже минимума ${R.minTrackWidth} мм`, [{ kind: 'track', id: t.id }]);
    if (!layers.includes(t.layer)) add('outside', 'error', t.points[0], `Дорожка на слое ${t.layer}, которого нет на этой плате`, [{ kind: 'track', id: t.id }]);
    if (t.points.length < 2) add('dangling', 'warning', t.points[0] ?? { x: 0, y: 0 }, 'Дорожка из одной точки', [{ kind: 'track', id: t.id }]);
  }
  for (const v of Object.values(p.vias)) {
    if (v.diameter < R.minViaDiameter - 1e-4) add('via', 'error', v.at, `Переходное ${v.diameter} мм меньше ${R.minViaDiameter} мм`, [{ kind: 'via', id: v.id }]);
    if (v.drill < R.minViaDrill - 1e-4) add('via', 'error', v.at, `Отверстие переходного ${v.drill} мм меньше ${R.minViaDrill} мм`, [{ kind: 'via', id: v.id }]);
  }

  // 6. Области правил: запреты и допустимые классы.
  for (const ra of Object.values(p.ruleAreas)) {
    const abox = boxOfPoints(ra.outline);
    const inArea = (s: Shape) => {
      if (!(s.box.minX <= abox.maxX && s.box.maxX >= abox.minX && s.box.minY <= abox.maxY && s.box.maxY >= abox.minY)) return false;
      if (s.pts.some((q) => pointInPolygon(q, ra.outline))) return true;
      if (s.pts.length === 2) for (let i = 0; i < ra.outline.length; i++) if (segmentsIntersect(s.pts[0], s.pts[1], ra.outline[i], ra.outline[(i + 1) % ra.outline.length])) return true;
      return false;
    };
    for (const it of items) {
      const isVia = it.owner.startsWith('via:');
      const isTrack = it.owner.startsWith('track:');
      if (!isVia && !isTrack) continue;
      if (isVia && it.layer === 'F.Cu') continue;
      if (!inArea(it.shape)) continue;
      if ((isTrack && ra.keepoutTracks) || (isVia && ra.keepoutVias)) add('keepout', 'error', centerOf(it.shape), `${cap(it.label)} в запретной области «${ra.name}»`, [it.ref, { kind: 'ruleArea', id: ra.id }]);
      else if (ra.onlyClasses && ra.onlyClasses.length && !(it.cls && ra.onlyClasses.includes(it.cls.name)))
        add('class-area', 'error', centerOf(it.shape), `${cap(it.label)} в области «${ra.name}», где допустимы только классы ${ra.onlyClasses.join(', ')}`, [it.ref, { kind: 'ruleArea', id: ra.id }]);
    }
  }

  // 7. Компоненты: нет корпуса, выводы без цепи у цепей, перекрытие габаритов.
  for (const wc of w.components) {
    if (!wc.footprint) add('no-footprint', 'error', wc.component.at, `У ${wc.component.ref} нет корпуса ${wc.component.footprint}`, [{ kind: 'component', id: wc.component.id }]);
    for (const k of Object.keys(wc.component.padNets)) if (wc.footprint && !wc.footprint.pads.some((pd) => pd.number === k)) add('no-net-pad', 'warning', wc.component.at, `${wc.component.ref}: цепь назначена выводу ${k}, которого нет в корпусе`, [{ kind: 'component', id: wc.component.id }]);
  }
  const ch = new SpatialHash<(typeof w.components)[number]>(5);
  for (const wc of w.components) ch.insert(wc, boxOfPoints(wc.outline));
  const cchecked = new Set<string>();
  for (const a of w.components)
    for (const b of ch.query(boxOfPoints(a.outline))) {
      if (a === b || a.component.side !== b.component.side) continue;
      const key = a.component.id < b.component.id ? a.component.id + '|' + b.component.id : b.component.id + '|' + a.component.id;
      if (cchecked.has(key)) continue;
      cchecked.add(key);
      if (polysOverlap(a.outline, b.outline)) {
        const c = { x: (a.component.at.x + b.component.at.x) / 2, y: (a.component.at.y + b.component.at.y) / 2 };
        add('courtyard', 'warning', c, `Габариты ${a.component.ref} и ${b.component.ref} перекрываются`, [
          { kind: 'component', id: a.component.id },
          { kind: 'component', id: b.component.id },
        ]);
      }
    }
  for (const wc of w.components) {
    if (!wc.footprint) continue;
    if (wc.pads.some((wp) => !pointInPolygon(wp.center, poly) && wp.pad.type !== 'npth')) add('outside', 'error', wc.component.at, `${wc.component.ref} выходит за плату`, [{ kind: 'component', id: wc.component.id }]);
  }

  // 8. Висящие дорожки, переходные и перемычки.
  for (const d of conn.dangling) {
    const at = d.kind === 'track' ? p.tracks[d.id]?.points[0] : d.kind === 'via' ? p.vias[d.id]?.at : p.wires[d.id]?.a;
    if (at) add('dangling', 'warning', at, d.kind === 'track' ? 'Дорожка ни к чему не подключена' : d.kind === 'via' ? 'Переходное ни к чему не подключено' : 'Конец перемычки не попадает на площадку', [d]);
  }

  // 9. Полигоны: без цепи или без единой своей площадки заливка бесполезна.
  for (const zf of conn.zoneFills) {
    const z = zf.zone;
    const ref: ItemRef[] = [{ kind: 'zone', id: z.id }];
    const at = z.outline[0];
    if (!at || !layers.includes(z.layer)) continue;
    if (!z.net) add('zone', 'warning', at, 'Полигон без цепи: заливка ни к чему не подключена. Назначьте цепь (обычно GND) в свойствах.', ref);
    else if (!zf.islands.length) add('zone', 'warning', at, `Полигон ${netName(z.net)} пуст: внутри нет площадок этой цепи.`, ref);
  }

  markers.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));
  const report = { markers, errors: markers.filter((m) => m.severity === 'error').length, warnings: markers.filter((m) => m.severity === 'warning').length };
  cache.set(p, report);
  return report;
}

function centerOf(s: Shape): Vec2 {
  return { x: (s.box.minX + s.box.maxX) / 2, y: (s.box.minY + s.box.maxY) / 2 };
}
/** Зазор между краем фигуры и контуром (многоугольником). */
function shapeToOutline(s: Shape, poly: Vec2[]): number {
  let m = Infinity;
  const edges: [Vec2, Vec2][] = s.pts.length === 1 ? [[s.pts[0], s.pts[0]]] : s.pts.map((q, i) => [q, s.pts[(i + 1) % s.pts.length]] as [Vec2, Vec2]);
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    for (const [c, d] of edges) {
      const k = segmentSegment(a, b, c, d).d;
      if (k < m) m = k;
    }
  }
  return m - s.r;
}
function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function polysOverlap(a: Vec2[], b: Vec2[]): boolean {
  if (a.some((q) => pointInPolygon(q, b)) || b.some((q) => pointInPolygon(q, a))) return true;
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) if (segmentsIntersect(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length])) return true;
  return false;
}

/** Все касания меди с чужой цепью считает связность; здесь — краткая сводка для строки состояния. */
export function drcSummary(p: Project): { errors: number; warnings: number; unrouted: number; total: number } {
  const r = runDrc(p);
  const c = computeConnectivity(p);
  return { errors: r.errors, warnings: r.warnings, unrouted: c.unrouted, total: c.total };
}


