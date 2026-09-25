import { boxOfPoints } from '../math/geom';
import { makeShape, shapeGap, type Shape } from '../math/shape';
import type { Vec2 } from '../math/vec';
import { netClassOf, requiredClearance } from './rules';
import type { CopperLayer, Id, Project } from './types';
import type { World } from './world';
import type { NetOfKey } from './zone-fill';

/*
 * Каплевидные переходы: у конца дорожки, входящей в площадку или переходное,
 * медь плавно расширяется до ширины площадки. Так дорожка не отрывается при
 * травлении и пайке. Капли — производная геометрия: считаются по дорожкам
 * и площадкам (как заливка), в проекте хранится только включатель в правилах.
 */

export interface Teardrop {
  /** Дорожка, к которой относится капля (её цепь и слой). */
  trackId: Id;
  layer: CopperLayer;
  /** Контур капли (простой многоугольник). */
  pts: Vec2[];
  shape: Shape;
}

interface Anchor {
  center: Vec2;
  /** Полуширина площадки поперёк дорожки (по вписанному размеру). */
  half: number;
  layers: CopperLayer[];
  shape: Shape;
  key: string;
}

/** Точка на квадратичной кривой Безье. */
const bez = (a: Vec2, c: Vec2, b: Vec2, t: number): Vec2 => ({
  x: (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * c.x + t * t * b.x,
  y: (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * c.y + t * t * b.y,
});

/** Контур капли: от площадки (ширина 2·half) к точке на дорожке (ширина w), бока вогнутые. */
function dropOutline(p0: Vec2, u: Vec2, half: number, w: number, len: number): Vec2[] {
  const nx = -u.y;
  const ny = u.x;
  const at = (s: number, t: number): Vec2 => ({ x: p0.x + u.x * s + nx * t, y: p0.y + u.y * s + ny * t });
  const tail = len;
  const hw = w / 2;
  const left: Vec2[] = [];
  const right: Vec2[] = [];
  const steps = 8;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    left.push(bez(at(0, half), at(tail * 0.45, hw), at(tail, hw), t));
    right.push(bez(at(0, -half), at(tail * 0.45, -hw), at(tail, -hw), t));
  }
  // Основание уходит внутрь площадки, чтобы капля перекрывалась с ней.
  return [at(-half * 0.5, 0), ...left, ...right.reverse()].map((q) => ({ x: +q.x.toFixed(4), y: +q.y.toFixed(4) }));
}

export function computeTeardrops(p: Project, world: World, netOf: NetOfKey): Teardrop[] {
  if (!p.rules.teardrops) return [];
  const anchors: Anchor[] = [];
  for (const wp of world.pads) {
    if (!wp.layers.length) continue;
    const bw = wp.shape.box.maxX - wp.shape.box.minX;
    const bh = wp.shape.box.maxY - wp.shape.box.minY;
    anchors.push({ center: wp.center, half: Math.min(bw, bh) / 2, layers: wp.layers, shape: wp.shape, key: 'P' + wp.key });
  }
  for (const v of world.vias) anchors.push({ center: v.via.at, half: v.via.diameter / 2, layers: ['F.Cu', 'B.Cu'], shape: v.shape, key: 'V' + v.via.id });

  // Чужая медь рядом — для проверки зазора.
  type Obst = { shape: Shape; net: Id | null | 'short'; layer: CopperLayer; key: string };
  const obst: Obst[] = [];
  for (const wp of world.pads) for (const l of wp.layers) obst.push({ shape: wp.shape, net: wp.net, layer: l, key: 'P' + wp.key });
  for (const s of world.segments) obst.push({ shape: s.shape, net: netOf('T' + s.track.id), layer: s.track.layer, key: 'T' + s.track.id });
  for (const v of world.vias) for (const l of ['F.Cu', 'B.Cu'] as CopperLayer[]) obst.push({ shape: v.shape, net: netOf('V' + v.via.id), layer: l, key: 'V' + v.via.id });

  const out: Teardrop[] = [];
  for (const t of Object.values(p.tracks)) {
    if (t.points.length < 2) continue;
    const net = netOf('T' + t.id);
    const cls = net && net !== 'short' ? netClassOf(p, net) : null;
    for (const end of [0, t.points.length - 1]) {
      const p0 = t.points[end];
      const p1 = t.points[end === 0 ? 1 : t.points.length - 2];
      const a = anchors.find((x) => x.layers.includes(t.layer) && Math.hypot(x.center.x - p0.x, x.center.y - p0.y) < x.half * 0.6);
      if (!a) continue;
      // Капля нужна, только если площадка заметно шире дорожки.
      const half = a.half * 0.9;
      if (half <= t.width / 2 + 0.05) continue;
      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      const L = Math.hypot(dx, dy);
      if (L < 1e-6) continue;
      const u = { x: dx / L, y: dy / L };
      // Длина: за край площадки ещё на её полуширину (не больше 1,5 мм) и не дальше 80% отрезка.
      let len = Math.min(a.half + Math.min(a.half, 1.5), L * 0.8);
      let h = half;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (len <= a.half + 0.05) break;
        const pts = dropOutline(p0, u, h, t.width, len);
        const shape = makeShape(pts, 0);
        const box = boxOfPoints(pts);
        const clash = obst.some((o) => {
          if (o.layer !== t.layer || o.key === a.key || o.key === 'T' + t.id) return false;
          if (o.net && o.net === net && net !== 'short') return false;
          if (o.shape.box.minX > box.maxX + 7 || o.shape.box.maxX < box.minX - 7 || o.shape.box.minY > box.maxY + 7 || o.shape.box.maxY < box.minY - 7) return false;
          const need = requiredClearance(p.rules, cls, o.net && o.net !== 'short' ? netClassOf(p, o.net) : null);
          return shapeGap(shape, o.shape).d < need - 1e-6;
        });
        if (!clash) {
          out.push({ trackId: t.id, layer: t.layer, pts, shape });
          break;
        }
        // Мешает соседняя медь — капля поменьше.
        len = a.half + (len - a.half) * 0.6;
        h = Math.max(t.width / 2 + 0.05, h * 0.75);
      }
    }
  }
  return out;
}
