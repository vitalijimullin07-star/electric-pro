import type { Vec2 } from '../math/vec';
import { computeConnectivity } from '../model/connectivity';
import { boardPolygon } from '../model/project';
import type { Component, FootprintDef, Graphic, LayerId, PadDef, Project } from '../model/types';

/*
 * Экспорт платы в KiCad 6 (.kicad_pcb). Этот формат открывают KiCad 6–9 и EasyEDA Pro
 * («Импорт → KiCad»), поэтому через него плата переносится в EasyEDA с деталями, цепями,
 * дорожками, переходными и полигонами (полигоны — только контур, заливку пересчитают там).
 * Координаты и углы у KiCad те же, что у нас (мм, Y вниз, против часовой на экране).
 * Корпус на нижней стороне KiCad хранит уже отражённым по X, слои F/B переставлены.
 */

const LAYER_NAME: Record<LayerId, string> = {
  'F.Cu': 'F.Cu',
  'B.Cu': 'B.Cu',
  'F.Silk': 'F.SilkS',
  'B.Silk': 'B.SilkS',
  'F.Mask': 'F.Mask',
  'B.Mask': 'B.Mask',
  'F.Paste': 'F.Paste',
  'B.Paste': 'B.Paste',
  'F.Fab': 'F.Fab',
  'B.Fab': 'B.Fab',
  'F.Courtyard': 'F.CrtYd',
  'B.Courtyard': 'B.CrtYd',
  'Edge.Cuts': 'Edge.Cuts',
};

const flipName = (l: string): string => (l.startsWith('F.') ? 'B.' + l.slice(2) : l.startsWith('B.') ? 'F.' + l.slice(2) : l);

const n = (v: number): string => {
  const r = Math.round(v * 1e6) / 1e6 + 0;
  return String(r);
};
const q = (s: string): string => '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';
const xy = (p: Vec2): string => `${n(p.x)} ${n(p.y)}`;
const normAng = (a: number): number => ((a % 360) + 360) % 360;

/** Точка дуги нашего формата: угол от оси X против часовой на экране. */
const arcPt = (c: Vec2, r: number, deg: number): Vec2 => {
  const a = (deg * Math.PI) / 180;
  return { x: c.x + r * Math.cos(a), y: c.y - r * Math.sin(a) };
};

function graphicLines(g: Graphic, pre: 'fp' | 'gr', layerOf: (l: LayerId) => string, P: (p: Vec2) => Vec2, textOf: (s: string) => string, extraRot: number): string[] {
  const layer = layerOf(g.layer);
  const st = (w: number) => `(width ${n(w)})`;
  switch (g.kind) {
    case 'line':
      return [`(${pre}_line (start ${xy(P(g.a))}) (end ${xy(P(g.b))}) (layer ${q(layer)}) ${st(g.width)})`];
    case 'rect': {
      const pts = [g.a, { x: g.b.x, y: g.a.y }, g.b, { x: g.a.x, y: g.b.y }].map(P);
      return [`(${pre}_poly (pts ${pts.map((p) => `(xy ${xy(p)})`).join(' ')}) (layer ${q(layer)}) ${st(g.width)} (fill ${g.fill ? 'solid' : 'none'}))`];
    }
    case 'circle':
      return [`(${pre}_circle (center ${xy(P(g.c))}) (end ${xy(P({ x: g.c.x + g.r, y: g.c.y }))}) (layer ${q(layer)}) ${st(g.width)} (fill ${g.fill ? 'solid' : 'none'}))`];
    case 'arc': {
      const a = P(arcPt(g.c, g.r, g.start));
      const m = P(arcPt(g.c, g.r, g.start + g.sweep / 2));
      const b = P(arcPt(g.c, g.r, g.start + g.sweep));
      return [`(${pre}_arc (start ${xy(a)}) (mid ${xy(m)}) (end ${xy(b)}) (layer ${q(layer)}) ${st(g.width)})`];
    }
    case 'poly': {
      if (g.pts.length < 2) return [];
      const pts = g.pts.map(P);
      if (g.closed === false || (!g.fill && g.closed !== true)) {
        const out: string[] = [];
        for (let i = 0; i + 1 < pts.length; i++) out.push(`(${pre}_line (start ${xy(pts[i])}) (end ${xy(pts[i + 1])}) (layer ${q(layer)}) ${st(g.width)})`);
        return out;
      }
      return [`(${pre}_poly (pts ${pts.map((p) => `(xy ${xy(p)})`).join(' ')}) (layer ${q(layer)}) ${st(g.width)} (fill ${g.fill ? 'solid' : 'none'}))`];
    }
    case 'dimension':
      return [];
    case 'text': {
      const text = textOf(g.text);
      if (!text) return [];
      const just = [g.align === 'left' ? 'left' : g.align === 'right' ? 'right' : '', layer.startsWith('B.') ? 'mirror' : ''].filter(Boolean).join(' ');
      const ang = normAng((g.rotation ?? 0) + extraRot);
      const head = pre === 'fp' ? `(fp_text user ${q(text)}` : `(gr_text ${q(text)}`;
      const th = g.thickness ?? g.size * 0.15;
      return [`${head} (at ${xy(P(g.at))}${ang ? ' ' + n(ang) : ''}) (layer ${q(layer)}) (effects (font (size ${n(g.size)} ${n(g.size)}) (thickness ${n(th)}))${just ? ` (justify ${just})` : ''}))`];
    }
  }
}

function padLine(pad: PadDef, c: Component, netNo: (pad: PadDef) => [number, string] | null): string {
  const bottom = c.side === 'bottom';
  const at = bottom ? { x: -pad.at.x, y: pad.at.y } : pad.at;
  const local = pad.rotation ?? 0;
  const ang = normAng(c.rotation + (bottom ? -local : local));
  const kind = pad.type === 'tht' ? 'thru_hole' : pad.type === 'npth' ? 'np_thru_hole' : 'smd';
  const shape = pad.type === 'npth' ? 'circle' : pad.shape;
  let layers: string[];
  if (pad.type === 'smd') {
    const side = pad.layer === 'B.Cu' ? 'B' : 'F';
    layers = [`${side}.Cu`, `${side}.Paste`, `${side}.Mask`];
    if (bottom) layers = layers.map(flipName);
  } else layers = ['*.Cu', '*.Mask'];
  const parts = [`(pad ${q(pad.type === 'npth' ? '' : pad.number)} ${kind} ${shape} (at ${xy(at)}${ang ? ' ' + n(ang) : ''}) (size ${xy(pad.size)})`];
  if (pad.type !== 'smd') parts.push(`(drill ${n(pad.drill ?? Math.min(pad.size.x, pad.size.y) * 0.5)})`);
  parts.push(`(layers ${layers.map(q).join(' ')})`);
  if (shape === 'roundrect') parts.push(`(roundrect_rratio ${n(pad.roundness ?? 0.25)})`);
  const net = pad.type === 'npth' ? null : netNo(pad);
  if (net) parts.push(`(net ${net[0]} ${q(net[1])})`);
  if (pad.name && pad.name !== pad.number && pad.type !== 'npth') parts.push(`(pinfunction ${q(pad.name)})`);
  if (pad.maskMargin !== undefined) parts.push(`(solder_mask_margin ${n(pad.maskMargin)})`);
  return parts.join(' ') + ')';
}

export interface KicadExportOptions {
  /** Дополнительные свойства деталей по обозначению (например, LCSC) — дописываются к `fields`. */
  extraFields?: Record<string, Record<string, string>>;
}

/** Плата в формате KiCad 6. Выносные детали (`offBoard`) не выгружаются. */
export function exportKicadPcb(p: Project, o: KicadExportOptions = {}): string {
  const out: string[] = [];
  const two = p.board.copperLayers === 2;
  out.push('(kicad_pcb (version 20211014) (generator plata)');
  out.push(`  (general (thickness ${n(p.board.thickness)}))`);
  out.push('  (paper "A4")');
  out.push(`  (title_block (title ${q(p.meta.name)}))`);
  out.push('  (layers');
  out.push('    (0 "F.Cu" signal)');
  out.push('    (31 "B.Cu" signal)');
  for (const [i, nm, kind] of [
    [32, 'B.Adhes', 'user "B.Adhesive"'],
    [33, 'F.Adhes', 'user "F.Adhesive"'],
    [34, 'B.Paste', 'user'],
    [35, 'F.Paste', 'user'],
    [36, 'B.SilkS', 'user "B.Silkscreen"'],
    [37, 'F.SilkS', 'user "F.Silkscreen"'],
    [38, 'B.Mask', 'user'],
    [39, 'F.Mask', 'user'],
    [44, 'Edge.Cuts', 'user'],
    [46, 'B.CrtYd', 'user "B.Courtyard"'],
    [47, 'F.CrtYd', 'user "F.Courtyard"'],
    [48, 'B.Fab', 'user'],
    [49, 'F.Fab', 'user'],
  ] as const)
    out.push(`    (${i} ${q(nm)} ${kind})`);
  out.push('  )');
  const r = p.rules;
  out.push(`  (setup (pad_to_mask_clearance ${n(r.maskMargin)})`);
  out.push('    (pcbplotparams (layerselection 0x00010fc_ffffffff) (outputdirectory "gerber/")))');

  // Цепи: номер 0 — «без цепи».
  const nets = Object.values(p.nets).sort((a, b) => a.name.localeCompare(b.name, 'ru', { numeric: true }));
  const netIdx = new Map<string, number>();
  out.push('  (net 0 "")');
  nets.forEach((nt, i) => {
    netIdx.set(nt.id, i + 1);
    out.push(`  (net ${i + 1} ${q(nt.name)})`);
  });
  const netOf = (id: string | null | undefined): [number, string] | null => {
    if (!id) return null;
    const i = netIdx.get(id);
    return i ? [i, p.nets[id].name] : null;
  };

  // Классы цепей (KiCad 6 хранит их в плате).
  for (const cls of Object.values(p.netClasses)) {
    const members = nets.filter((nt) => nt.netClass === cls.name);
    if (cls.name !== 'Default' && !members.length) continue;
    out.push(`  (net_class ${q(cls.name)} ${q(cls.description ?? '')}`);
    out.push(`    (clearance ${n(cls.clearance)}) (trace_width ${n(cls.trackWidth)}) (via_dia ${n(cls.viaDiameter)}) (via_drill ${n(cls.viaDrill)}) (uvia_dia 0.3) (uvia_drill 0.1)`);
    for (const m of members) out.push(`    (add_net ${q(m.name)})`);
    out.push('  )');
  }

  // Детали.
  const comps = Object.values(p.components)
    .filter((c) => !c.offBoard)
    .sort((a, b) => a.ref.localeCompare(b.ref, 'ru', { numeric: true }));
  for (const c of comps) {
    const fp: FootprintDef | undefined = p.footprints[c.footprint];
    if (!fp) continue;
    const bottom = c.side === 'bottom';
    const L = (pt: Vec2): Vec2 => (bottom ? { x: -pt.x, y: pt.y } : pt);
    const layerOf = (l: LayerId): string => (bottom ? flipName(LAYER_NAME[l]) : LAYER_NAME[l]);
    const textOf = (s: string) => s.replace(/\$\{REF\}/g, c.ref).replace(/\$\{VALUE\}/g, c.value);
    const attr = c.excludeFromBom ? ' exclude_from_bom' : '';
    const smdOnly = fp.pads.length > 0 && fp.pads.every((pd) => pd.type !== 'tht');
    out.push(`  (footprint ${q('Plata:' + fp.id)} (layer ${q(bottom ? 'B.Cu' : 'F.Cu')})`);
    out.push(`    (at ${xy(c.at)}${normAng(c.rotation) ? ' ' + n(normAng(c.rotation)) : ''})`);
    if (fp.description || c.description) out.push(`    (descr ${q(c.description ?? fp.description ?? '')})`);
    const fields: Record<string, string> = { ...(c.fields ?? {}), ...(o.extraFields?.[c.ref] ?? {}) };
    for (const [k, v] of Object.entries(fields)) if (v) out.push(`    (property ${q(k)} ${q(v)})`);
    out.push(`    (attr ${smdOnly ? 'smd' : 'through_hole'}${attr})`);
    // Обозначение и номинал: над корпусом на шелкографии и на слое сборки.
    const b = fp.courtyard ?? { min: { x: -1, y: -1 }, max: { x: 1, y: 1 } };
    const rot = normAng(c.rotation);
    const silk = bottom ? 'B.SilkS' : 'F.SilkS';
    const fab = bottom ? 'B.Fab' : 'F.Fab';
    const mir = bottom ? ' (justify mirror)' : '';
    const hasRefText = fp.graphics.some((g) => g.kind === 'text' && g.text.includes('${REF}'));
    out.push(`    (fp_text reference ${q(c.ref)} (at ${xy(L({ x: 0, y: b.min.y - 1 }))}${rot ? ' ' + n(rot) : ''}) (layer ${q(silk)})${hasRefText || c.hideRef ? ' hide' : ''} (effects (font (size 1 1) (thickness 0.15))${mir}))`);
    out.push(`    (fp_text value ${q(c.value)} (at ${xy(L({ x: 0, y: b.max.y + 1 }))}${rot ? ' ' + n(rot) : ''}) (layer ${q(fab)}) (effects (font (size 1 1) (thickness 0.15))${mir}))`);
    for (const g of fp.graphics) for (const line of graphicLines(g, 'fp', layerOf, L, textOf, c.rotation)) out.push('    ' + line);
    if (fp.courtyard && !fp.graphics.some((g) => g.layer === 'F.Courtyard')) {
      const cy = bottom ? 'B.CrtYd' : 'F.CrtYd';
      const pts = [b.min, { x: b.max.x, y: b.min.y }, b.max, { x: b.min.x, y: b.max.y }].map(L);
      out.push(`    (fp_poly (pts ${pts.map((pt) => `(xy ${xy(pt)})`).join(' ')}) (layer ${q(cy)}) (width 0.05) (fill none))`);
    }
    for (const pad of fp.pads) out.push('    ' + padLine(pad, c, (pd) => netOf(c.padNets[pd.number])));
    out.push('  )');
  }

  // Контур платы и вырезы.
  const edge = (poly: Vec2[]) => {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b2 = poly[(i + 1) % poly.length];
      if (Math.hypot(a.x - b2.x, a.y - b2.y) < 1e-6) continue;
      out.push(`  (gr_line (start ${xy(a)}) (end ${xy(b2)}) (layer "Edge.Cuts") (width 0.1))`);
    }
  };
  edge(boardPolygon(p.board));
  for (const cut of p.board.cutouts) edge(cut);

  // Рисунки на плате.
  const id = (pt: Vec2) => pt;
  for (const d of Object.values(p.drawings)) {
    if (!two && d.layer === 'F.Cu') continue;
    for (const line of graphicLines(d, 'gr', (l) => LAYER_NAME[l], id, (s) => s, 0)) out.push('  ' + line);
  }

  // Дорожки и переходные.
  const trackNet = trackNets(p);
  for (const t of Object.values(p.tracks)) {
    const nt = netOf(trackNet.get(t.id));
    for (let i = 0; i + 1 < t.points.length; i++)
      out.push(`  (segment (start ${xy(t.points[i])}) (end ${xy(t.points[i + 1])}) (width ${n(t.width)}) (layer ${q(t.layer)}) (net ${nt ? nt[0] : 0}))`);
  }
  for (const v of Object.values(p.vias)) {
    const nt = netOf(trackNet.get(v.id));
    out.push(`  (via (at ${xy(v.at)}) (size ${n(v.diameter)}) (drill ${n(v.drill)}) (layers "F.Cu" "B.Cu") (net ${nt ? nt[0] : 0}))`);
  }

  // Полигоны: только контур, заливку пересчитает KiCad или EasyEDA.
  for (const z of Object.values(p.zones)) {
    const nt = netOf(z.net);
    const conn = z.padConnection === 'solid' ? ' yes' : '';
    out.push(`  (zone (net ${nt ? nt[0] : 0}) (net_name ${q(nt ? nt[1] : '')}) (layer ${q(z.layer)}) (hatch edge 0.5)${z.priority ? ` (priority ${Math.round(z.priority)})` : ''}`);
    out.push(`    (connect_pads${conn} (clearance ${n(z.clearance)}))`);
    out.push(`    (min_thickness ${n(z.minWidth)})`);
    out.push(`    (fill yes (thermal_gap ${n(z.thermalGap ?? z.clearance)}) (thermal_bridge_width ${n(z.thermalWidth ?? 0.5)}))`);
    out.push(`    (polygon (pts ${z.outline.map((pt) => `(xy ${xy(pt)})`).join(' ')}))`);
    out.push('  )');
  }
  out.push(')');
  return out.join('\n') + '\n';
}

/** Цепь дорожек и переходных — по связности проекта. */
function trackNets(p: Project): Map<string, string | null> {
  const m = new Map<string, string | null>();
  for (const [id, net] of computeConnectivity(p).itemNet) m.set(id, net === 'short' ? null : net);
  return m;
}
