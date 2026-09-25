import { shapeContains } from '../math/shape';
import type { Vec2 } from '../math/vec';
import { placementOf, toWorld } from './placement';
import type { Id, ItemRef, Project } from './types';
import { getWorld } from './world';

/*
 * Дорожки и перемычки за компонентом: при переносе или повороте детали концы,
 * лежащие на её площадках, едут вместе с площадками, а к неподвижной части
 * дорожки добавляется излом под 45°. Дорожка, у которой оба конца на
 * переносимых деталях, переносится целиком.
 */

export interface EndAnchor {
  kind: 'track' | 'wire';
  id: Id;
  /** 0 — первая точка (или a у перемычки), 1 — последняя (b). */
  end: 0 | 1;
  comp: Id;
  pad: string;
  /** Смещение конца от центра площадки (обычно ноль). */
  offset: Vec2;
}

export interface FollowPlan {
  anchors: EndAnchor[];
  /** Дорожки и перемычки, у которых оба конца на переносимых деталях. */
  whole: Set<string>;
}

const key = (kind: 'track' | 'wire', id: Id) => kind + ':' + id;

/** Какие концы дорожек и перемычек привязаны к площадкам выбранных деталей. */
export function planFollow(p: Project, sel: ItemRef[]): FollowPlan | null {
  const comps = new Set(sel.filter((r) => r.kind === 'component' && !p.components[r.id]?.locked).map((r) => r.id));
  if (!comps.size) return null;
  const selected = new Set(sel.map((r) => r.kind + ':' + r.id));
  const w = getWorld(p);
  const pads = w.pads.filter((wp) => comps.has(wp.component.id) && wp.layers.length);
  if (!pads.length) return null;
  const anchors: EndAnchor[] = [];
  const padAt = (q: Vec2, layer: string | null) => {
    let best: (typeof pads)[number] | null = null;
    let bd = Infinity;
    for (const wp of pads) {
      if (layer && !wp.layers.includes(layer as never)) continue;
      if (q.x < wp.shape.box.minX - 1e-3 || q.x > wp.shape.box.maxX + 1e-3 || q.y < wp.shape.box.minY - 1e-3 || q.y > wp.shape.box.maxY + 1e-3) continue;
      if (!shapeContains(wp.shape, q, 1e-3)) continue;
      const d = Math.hypot(q.x - wp.center.x, q.y - wp.center.y);
      if (d < bd) {
        bd = d;
        best = wp;
      }
    }
    return best;
  };
  const push = (kind: 'track' | 'wire', id: Id, end: 0 | 1, q: Vec2, layer: string | null) => {
    const wp = padAt(q, layer);
    if (!wp) return;
    anchors.push({ kind, id, end, comp: wp.component.id, pad: wp.pad.number, offset: { x: q.x - wp.center.x, y: q.y - wp.center.y } });
  };
  for (const t of Object.values(p.tracks)) {
    if (t.locked || t.points.length < 2 || selected.has('track:' + t.id)) continue;
    push('track', t.id, 0, t.points[0], t.layer);
    push('track', t.id, 1, t.points[t.points.length - 1], t.layer);
  }
  for (const wr of Object.values(p.wires)) {
    if (selected.has('wire:' + wr.id)) continue;
    push('wire', wr.id, 0, wr.a, null);
    push('wire', wr.id, 1, wr.b, null);
  }
  if (!anchors.length) return null;
  const count = new Map<string, number>();
  for (const a of anchors) count.set(key(a.kind, a.id), (count.get(key(a.kind, a.id)) ?? 0) + 1);
  const whole = new Set([...count].filter(([, n]) => n === 2).map(([k]) => k));
  return { anchors, whole };
}

/** Центр площадки детали в текущем (уже сдвинутом) состоянии проекта. */
function padCenter(d: Project, comp: Id, pad: string): Vec2 | null {
  const c = d.components[comp];
  const fp = c && d.footprints[c.footprint];
  const pd = fp?.pads.find((x) => x.number === pad);
  return pd ? toWorld(placementOf(c), pd.at) : null;
}

const r4 = (v: number) => +v.toFixed(4) + 0;
const same = (a: Vec2, b: Vec2) => Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;

/** Излом под 45° от неподвижной точки from к новому концу to: сначала диагональ, к площадке — прямо. */
export function corner45(from: Vec2, to: Vec2): Vec2[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) < 1e-6 || Math.abs(dy) < 1e-6 || Math.abs(Math.abs(dx) - Math.abs(dy)) < 1e-6) return [];
  const m = Math.min(Math.abs(dx), Math.abs(dy));
  return [{ x: r4(from.x + Math.sign(dx) * m), y: r4(from.y + Math.sign(dy) * m) }];
}

/** Убирает повторы и вершины на прямой. */
export function simplifyPath(pts: Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const q of pts) if (!out.length || !same(out[out.length - 1], q)) out.push(q);
  for (let i = 1; i + 1 < out.length; ) {
    const a = out[i - 1];
    const b = out[i];
    const c = out[i + 1];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    const dot = (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y);
    if (Math.abs(cross) < 1e-6 && dot >= 0) out.splice(i, 1);
    else i++;
  }
  return out;
}

/**
 * Применяет план к черновику d. base — состояние до переноса (из него берутся исходные
 * точки, поэтому при перетаскивании можно вызывать на каждом кадре). translate — общий
 * сдвиг, если детали только переносились: тогда дорожки между ними едут целиком.
 */
export function applyFollow(d: Project, base: Project, plan: FollowPlan, o: { translate?: Vec2; corner?: boolean } = {}): void {
  const corner = o.corner ?? true;
  const byItem = new Map<string, EndAnchor[]>();
  for (const a of plan.anchors) {
    const k = key(a.kind, a.id);
    byItem.set(k, [...(byItem.get(k) ?? []), a]);
  }
  for (const [k, list] of byItem) {
    const kind = list[0].kind;
    const id = list[0].id;
    const t = o.translate;
    const ends: (Vec2 | null)[] = [null, null];
    for (const a of list) {
      const c = padCenter(d, a.comp, a.pad);
      if (c) ends[a.end] = { x: r4(c.x + a.offset.x), y: r4(c.y + a.offset.y) };
    }
    if (kind === 'wire') {
      const w0 = base.wires[id];
      const w = d.wires[id];
      if (!w0 || !w) continue;
      w.a = ends[0] ?? { ...w0.a };
      w.b = ends[1] ?? { ...w0.b };
      continue;
    }
    const t0 = base.tracks[id];
    const tr = d.tracks[id];
    if (!t0 || !tr) continue;
    const orig = t0.points;
    if (t && plan.whole.has(k)) {
      tr.points = orig.map((q) => ({ x: r4(q.x + t.x), y: r4(q.y + t.y) }));
      continue;
    }
    let pts = orig.map((q) => ({ ...q }));
    if (ends[0] && ends[1] && pts.length === 2) {
      // Оба конца на площадках, но не общий перенос (поворот): прямая с изломом.
      pts = corner ? [ends[0], ...corner45(ends[1], ends[0]).reverse(), ends[1]] : [ends[0], ends[1]];
      tr.points = simplifyPath(pts);
      continue;
    }
    if (ends[0]) {
      const n = pts[1];
      pts = [ends[0], ...(corner ? corner45(n, ends[0]) : []), ...pts.slice(1)];
    }
    if (ends[1]) {
      const n = pts[pts.length - 2];
      pts = [...pts.slice(0, -1), ...(corner ? corner45(n, ends[1]) : []), ends[1]];
    }
    tr.points = simplifyPath(pts);
    if (tr.points.length < 2) tr.points = [ends[0] ?? orig[0], ends[1] ?? orig[orig.length - 1]];
  }
}
