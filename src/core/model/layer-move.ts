import { closestOnSegment } from '../math/geom';
import { shapeContains } from '../math/shape';
import type { Vec2 } from '../math/vec';
import { computeConnectivity } from './connectivity';
import { addVia } from './edit';
import { boardCopperLayers, isCopper, sideLayer } from './layers';
import { netClassOf } from './rules';
import type { CopperLayer, Id, ItemRef, LayerId, Project } from './types';
import { getWorld } from './world';

/*
 * Перенос объектов между слоями: выделенное — на другой слой, всё содержимое
 * слоя — на другой, обмен двух слоёв. Медь переносится только на медь платы;
 * там, где перенесённая дорожка стыковалась с медью, оставшейся на прежнем слое,
 * ставится переходное. Компоненты не трогаются: их переворачивает F.
 */

export type LayerTarget = LayerId | 'flip';

export interface LayerMovePlan {
  /** Новый слой для каждого объекта. */
  moves: { ref: ItemRef; layer: LayerId }[];
  /** Переходные на стыках с медью прежнего слоя. */
  vias: { at: Vec2; diameter: number; drill: number }[];
  /** Концы дорожек на планарных площадках прежнего слоя: соединение порвётся. */
  broken: Vec2[];
  /** Объекты, которые нельзя перенести на этот слой. */
  skipped: number;
}

const COPPER_OK = (p: Project, l: LayerId): l is CopperLayer => isCopper(l) && boardCopperLayers(p.board.copperLayers).includes(l);

function layerOf(p: Project, r: ItemRef): LayerId | null {
  if (r.kind === 'track') return p.tracks[r.id]?.layer ?? null;
  if (r.kind === 'zone') return p.zones[r.id]?.layer ?? null;
  if (r.kind === 'drawing') return p.drawings[r.id]?.layer ?? null;
  return null;
}

/** Объекты на слое: дорожки, полигоны, графика платы. */
export function itemsOnLayer(p: Project, l: LayerId): ItemRef[] {
  const out: ItemRef[] = [];
  for (const t of Object.values(p.tracks)) if (t.layer === l) out.push({ kind: 'track', id: t.id });
  for (const z of Object.values(p.zones)) if (z.layer === l) out.push({ kind: 'zone', id: z.id });
  for (const d of Object.values(p.drawings)) if (d.layer === l) out.push({ kind: 'drawing', id: d.id });
  return out;
}

/** Куда можно перенести объект: медь — на медь платы, графику — на любой немедный слой. */
function allowed(p: Project, r: ItemRef, to: LayerId): boolean {
  if (r.kind === 'track' || r.kind === 'zone') return COPPER_OK(p, to);
  if (r.kind === 'drawing') {
    const d = p.drawings[r.id];
    if (!d || isCopper(to)) return false;
    // На контур платы — только линии и фигуры, без надписей и размеров.
    return to !== 'Edge.Cuts' || (d.kind !== 'text' && d.kind !== 'dimension');
  }
  return false;
}

/**
 * План переноса refs на слой target ('flip' — на парный слой другой стороны).
 * Для обмена слоёв передайте pairs: каждый объект со своим слоем назначения.
 */
export function planLayerMove(p: Project, refs: ItemRef[], target: LayerTarget | ((from: LayerId) => LayerId | null)): LayerMovePlan {
  const moves: LayerMovePlan['moves'] = [];
  let skipped = 0;
  for (const r of refs) {
    const from = layerOf(p, r);
    if (!from) continue;
    const to = typeof target === 'function' ? target(from) : target === 'flip' ? sideLayer(from, 'bottom') : target;
    if (!to || to === from) continue;
    if (!allowed(p, r, to)) {
      skipped++;
      continue;
    }
    moves.push({ ref: r, layer: to });
  }

  // Стыки перенесённых дорожек с медью, оставшейся на прежнем слое.
  const movedTracks = new Map(moves.filter((m) => m.ref.kind === 'track').map((m) => [m.ref.id, m.layer as CopperLayer]));
  const vias: LayerMovePlan['vias'] = [];
  const broken: Vec2[] = [];
  if (movedTracks.size) {
    const w = getWorld(p);
    const conn = computeConnectivity(p);
    const bothLayers = (q: Vec2) => w.vias.some((v) => Math.hypot(v.via.at.x - q.x, v.via.at.y - q.y) <= v.via.diameter / 2) || w.pads.some((wp) => wp.pad.type === 'tht' && wp.layers.length === 2 && shapeContains(wp.shape, q, 1e-3));
    const layerAfter = (id: Id, l: CopperLayer) => movedTracks.get(id) ?? l;
    const seen: Vec2[] = [];
    for (const id of movedTracks.keys()) {
      const t = p.tracks[id];
      const from = t.layer;
      for (const q of [t.points[0], t.points[t.points.length - 1]]) {
        if (bothLayers(q)) continue;
        // Планарная площадка прежнего слоя: переходное внутри площадки не ставим.
        if (w.pads.some((wp) => wp.pad.type === 'smd' && wp.layers.includes(from) && shapeContains(wp.shape, q, 1e-3))) {
          broken.push(q);
          continue;
        }
        const touches = Object.values(p.tracks).some((o) => {
          if (o.id === id || o.layer !== from || layerAfter(o.id, o.layer) !== from) return false;
          for (let i = 0; i + 1 < o.points.length; i++) if (closestOnSegment(q, o.points[i], o.points[i + 1]).d <= o.width / 2 + 1e-3) return true;
          return false;
        });
        if (!touches || seen.some((s) => Math.hypot(s.x - q.x, s.y - q.y) < 1e-3)) continue;
        seen.push(q);
        const net = conn.itemNet.get(id);
        const cls = netClassOf(p, net && net !== 'short' ? net : null);
        vias.push({ at: { x: q.x, y: q.y }, diameter: Math.max(cls.viaDiameter, p.rules.minViaDiameter), drill: Math.max(cls.viaDrill, p.rules.minViaDrill) });
      }
    }
  }
  return { moves, vias, broken, skipped };
}

/** Применяет план к черновику проекта. */
export function applyLayerMove(d: Project, plan: LayerMovePlan): void {
  for (const m of plan.moves) {
    if (m.ref.kind === 'track' && d.tracks[m.ref.id]) d.tracks[m.ref.id].layer = m.layer as CopperLayer;
    else if (m.ref.kind === 'zone' && d.zones[m.ref.id]) d.zones[m.ref.id].layer = m.layer as CopperLayer;
    else if (m.ref.kind === 'drawing' && d.drawings[m.ref.id]) d.drawings[m.ref.id].layer = m.layer;
  }
  for (const v of plan.vias) addVia(d, v);
}

/** Всё со слоя a — на b; swap — и обратно, b на a. */
export function planLayerContent(p: Project, a: LayerId, b: LayerId, swap: boolean): LayerMovePlan {
  const refs = [...itemsOnLayer(p, a), ...(swap ? itemsOnLayer(p, b) : [])];
  return planLayerMove(p, refs, (from) => (from === a ? b : swap && from === b ? a : null));
}
