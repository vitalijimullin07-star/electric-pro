import type { Shape } from '../math/shape';
import { shapeOutline } from '../math/shape';
import type { Vec2 } from '../math/vec';
import { computeConnectivity } from '../model/connectivity';
import { padCopperLayers, padLocalShape, placementOf, shapeToWorld, toWorld } from '../model/placement';
import { boardPolygon } from '../model/project';
import type { LayerId, Project } from '../model/types';
import { getWorld } from '../model/world';
import { graphicPrims, type LayerPrims } from '../render/graphic';
import { textStrokes } from '../render/stroke-font';

/*
 * Плата в формате EasyEDA Standard (редактор 6.x, «Файл → Открыть → EasyEDA…»): документ PCB
 * (docType 3) с корпусами (LIB: площадки, отверстия, шелкография), дорожками, переходными и контуром.
 * Единица EasyEDA — 10 mil (0,254 мм), ось Y вниз, как у нас; начало платы — в точке (4000, 3000).
 * Сквозная площадка с медью с одной стороны (самодельная плата без металлизации) выгружается как
 * планарная площадка на этом слое и отверстие (HOLE) в её центре: медь вокруг отверстия только там.
 * Надписи шелкографии — линиями (как в Gerber); обозначение детали — ещё и скрытым полем TEXT P.
 */

const U = 0.254;
const OX = 4000;
const OY = 3000;
const r2 = (v: number) => +v.toFixed(3);
const X = (x: number) => r2(OX + x / U);
const Y = (y: number) => r2(OY + y / U);
const L = (mm: number) => r2(mm / U);
const pts = (a: Vec2[]) => a.map((q) => `${X(q.x)} ${Y(q.y)}`).join(' ');
/** Поля EasyEDA разделяются «~», подшейпы — «#@$», атрибуты — «`». */
const clean = (s: string) => s.replace(/[~`#@$^]/g, ' ').trim();

const LAYER: Partial<Record<LayerId, number>> = {
  'F.Cu': 1,
  'B.Cu': 2,
  'F.Silk': 3,
  'B.Silk': 4,
  'F.Paste': 5,
  'B.Paste': 6,
  'F.Mask': 7,
  'B.Mask': 8,
  'Edge.Cuts': 10,
};

const LAYERS = [
  '1~TopLayer~#FF0000~true~true~true~',
  '2~BottomLayer~#0000FF~true~false~true~',
  '3~TopSilkLayer~#FFCC00~true~false~true~',
  '4~BottomSilkLayer~#66CC33~true~false~true~',
  '5~TopPasteMaskLayer~#808080~true~false~true~',
  '6~BottomPasteMaskLayer~#800000~true~false~true~',
  '7~TopSolderMaskLayer~#800080~true~false~true~0.3',
  '8~BottomSolderMaskLayer~#AA00FF~true~false~true~0.3',
  '9~Ratlines~#6464FF~true~false~true~',
  '10~BoardOutLine~#FF00FF~true~false~true~',
  '11~Multi-Layer~#C0C0C0~true~false~true~',
  '12~Document~#FFFFFF~true~false~true~',
  '13~TopAssembly~#33CC99~false~false~false~',
  '14~BottomAssembly~#5555FF~false~false~false~',
  '15~Mechanical~#F022F0~false~false~false~',
  '19~3DModel~#66CCFF~false~false~false~',
];

export interface EasyedaPcbOptions {
  /** Имя цепи в файле (например, чтобы скрыть назначение). */
  netName?: (name: string) => string;
}

/** Площадка EasyEDA из нашей фигуры (точки + радиус). */
function padShape(s: Shape): { kind: string; w: number; h: number; pts: string } {
  const { pts: p, r } = s;
  if (p.length === 1) return { kind: 'ELLIPSE', w: L(2 * r), h: L(2 * r), pts: '' };
  if (p.length === 2 && (Math.abs(p[0].x - p[1].x) < 1e-6 || Math.abs(p[0].y - p[1].y) < 1e-6)) {
    const vert = Math.abs(p[0].x - p[1].x) < 1e-6;
    const len = Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y);
    return { kind: 'OVAL', w: L(vert ? 2 * r : len + 2 * r), h: L(vert ? len + 2 * r : 2 * r), pts: pts(p) };
  }
  if (p.length === 4 && r < 1e-6) {
    const xs = p.map((q) => q.x);
    const ys = p.map((q) => q.y);
    const axis = p.every((q) => xs.some((x) => Math.abs(x - q.x) < 1e-6)) && new Set(xs.map((x) => x.toFixed(4))).size === 2 && new Set(ys.map((y) => y.toFixed(4))).size === 2;
    if (axis) return { kind: 'RECT', w: L(Math.max(...xs) - Math.min(...xs)), h: L(Math.max(...ys) - Math.min(...ys)), pts: pts(p) };
  }
  const o = shapeOutline(s, 0.08);
  const xs = o.map((q) => q.x);
  const ys = o.map((q) => q.y);
  return { kind: 'POLYGON', w: L(Math.max(...xs) - Math.min(...xs)), h: L(Math.max(...ys) - Math.min(...ys)), pts: pts(o) };
}

export function exportEasyedaPcb(p: Project, o: EasyedaPcbOptions = {}): string {
  let gid = 0;
  const id = () => `gge${(++gid).toString(36)}`;
  const netName = (nid: string | null | undefined) => (nid && p.nets[nid] ? clean((o.netName ?? ((s) => s))(p.nets[nid].name)) : '');
  const conn = computeConnectivity(p);
  const itemNet = (iid: string) => {
    const n = conn.itemNet.get(iid);
    return n && n !== 'short' ? netName(n) : '';
  };
  const shapes: string[] = [];
  const world = getWorld(p);

  /** Примитивы шелкографии и прочих слоёв (кроме меди) — дорожками и сплошными областями. */
  const primShapes = (prims: LayerPrims, out: string[]) => {
    for (const [layer, list] of Object.entries(prims) as [LayerId, LayerPrims[LayerId]][]) {
      const lid = LAYER[layer];
      if (!lid || lid <= 2 || !list) continue;
      for (const pr of list) {
        if (pr.kind === 'path') {
          const a = pr.closed ? [...pr.pts, pr.pts[0]] : pr.pts;
          if (a.length >= 2) out.push(`TRACK~${L(pr.width)}~${lid}~~${pts(a)}~${id()}~0`);
        } else if (pr.kind === 'region') out.push(`SOLIDREGION~${lid}~~${pts(pr.pts)}~solid~${id()}~~~~0`);
        else if (pr.kind === 'flash') out.push(`SOLIDREGION~${lid}~~${pts(shapeOutline(pr.shape, 0.08))}~solid~${id()}~~~~0`);
      }
    }
  };

  const textPath = (s: string, at: Vec2, size: number) =>
    textStrokes({ text: s, at, size, align: 'center' })
      .map((st) => 'M ' + st.map((q) => `${X(q.x)} ${Y(q.y)}`).join(' L '))
      .join(' ');

  for (const wc of world.components) {
    const c = wc.component;
    const fp = wc.footprint;
    if (!fp) continue;
    const pl = placementOf(c);
    const sub: string[] = [];
    const box = wc.outline;
    const cx = box.reduce((s, q) => s + q.x, 0) / (box.length || 1);
    const cy = box.reduce((s, q) => s + q.y, 0) / (box.length || 1);
    const silk = c.side === 'bottom' ? 4 : 3;
    // Обозначение и номинал — полями (скрытыми: на шелкографии они уже есть линиями).
    sub.push(`TEXT~P~${X(cx)}~${Y(cy)}~0.6~0~${c.side === 'bottom' ? 'mirror' : 'none'}~${silk}~~4~${clean(c.ref)}~${textPath(clean(c.ref), { x: cx, y: cy }, 1)}~none~${id()}~~0~pinpart`);
    sub.push(`TEXT~N~${X(cx)}~${Y(cy + 1.5)}~0.6~0~${c.side === 'bottom' ? 'mirror' : 'none'}~${silk}~~4~${clean(c.value)}~${textPath(clean(c.value || ' '), { x: cx, y: cy + 1.5 }, 1)}~none~${id()}~~0~pinpart`);
    for (const pad of fp.pads) {
      const shape = shapeToWorld(pl, padLocalShape(pad));
      const ctr = toWorld(pl, pad.at);
      const net = netName(c.padNets[pad.number]);
      const num = clean(pad.number);
      if (pad.type === 'npth') {
        sub.push(`HOLE~${X(ctr.x)}~${Y(ctr.y)}~${L((pad.drill ?? 1) / 2)}~${id()}~0`);
        continue;
      }
      const ps = padShape(shape);
      const layers = padCopperLayers(pad, c.side);
      const holeR = pad.type === 'tht' ? L((pad.drill ?? 0) / 2) : 0;
      if (pad.type === 'tht' && layers.length === 2) {
        sub.push(`PAD~${ps.kind}~${X(ctr.x)}~${Y(ctr.y)}~${ps.w}~${ps.h}~11~${net}~${num}~${holeR}~${ps.pts}~0~${id()}~0~~Y~0~~~${X(ctr.x)},${Y(ctr.y)}`);
      } else {
        const lid = layers[0] === 'F.Cu' ? 1 : 2;
        sub.push(`PAD~${ps.kind}~${X(ctr.x)}~${Y(ctr.y)}~${ps.w}~${ps.h}~${lid}~${net}~${num}~0~${ps.pts}~0~${id()}~0~~Y~0~~~${X(ctr.x)},${Y(ctr.y)}`);
        if (holeR > 0) sub.push(`HOLE~${X(ctr.x)}~${Y(ctr.y)}~${holeR}~${id()}~0`);
      }
    }
    const prims: LayerPrims = {};
    for (const g of fp.graphics) {
      if (g.layer.endsWith('Fab') || g.layer.endsWith('Courtyard')) continue;
      graphicPrims(g, pl, c, prims);
    }
    primShapes(prims, sub);
    const attrs = `package\`${clean(fp.name || fp.id)}\`value\`${clean(c.value)}\``;
    shapes.push(`LIB~${X(c.at.x)}~${Y(c.at.y)}~${attrs}~0~~${id()}~0~${c.side === 'bottom' ? 2 : 1}#@$` + sub.join('#@$'));
  }

  for (const t of Object.values(p.tracks)) {
    if (t.points.length < 2) continue;
    shapes.push(`TRACK~${L(t.width)}~${LAYER[t.layer]}~${itemNet(t.id)}~${pts(t.points)}~${id()}~0`);
  }
  for (const v of Object.values(p.vias)) shapes.push(`VIA~${X(v.at.x)}~${Y(v.at.y)}~${L(v.diameter)}~${itemNet(v.id)}~${L(v.drill / 2)}~${id()}~0`);
  // Перемычки проводом — на слое документа (видно, где они).
  for (const w of Object.values(p.wires)) shapes.push(`TRACK~${L(0.5)}~12~~${pts([w.a, w.b])}~${id()}~0`);
  const top: LayerPrims = {};
  for (const d of Object.values(p.drawings)) graphicPrims(d, null, null, top);
  primShapes(top, shapes);
  const outline = boardPolygon(p.board);
  shapes.push(`TRACK~${L(0.15)}~10~~${pts([...outline, outline[0]])}~${id()}~0`);
  for (const cut of p.board.cutouts) shapes.push(`TRACK~${L(0.15)}~10~~${pts([...cut, cut[0]])}~${id()}~0`);

  const xs = outline.map((q) => q.x);
  const ys = outline.map((q) => q.y);
  const bb = { x: X(Math.min(...xs)), y: Y(Math.min(...ys)), width: L(Math.max(...xs) - Math.min(...xs)), height: L(Math.max(...ys) - Math.min(...ys)) };
  const doc = {
    head: { docType: '3', editorVersion: '6.5.40', newgId: true, c_para: {}, x: String(OX), y: String(OY), hasIdFlag: true, importFlag: 0, transformList: '' },
    canvas: `CA~1000~1000~#000000~yes~#FFFFFF~10~1000~1000~line~0.5~mm~1~45~visible~0.5~${OX}~${OY}~0~yes`,
    shape: shapes,
    layers: LAYERS,
    objects: [],
    BBox: bb,
    preference: { hideFootprints: '', hideNets: '' },
    DRCRULE: {
      Default: { trackWidth: L(p.rules.minTrackWidth), clearance: L(p.rules.minClearance), viaHoleDiameter: L(p.rules.minViaDiameter), viaHoleD: L(p.rules.minViaDrill) },
      isRealtime: false,
      isDrcOnRoutingOrPlaceVia: false,
      checkObjectToCopperarea: true,
      showDRCRangeLine: true,
    },
    netColors: {},
    title: clean(p.meta.name),
  };
  return JSON.stringify(doc);
}
