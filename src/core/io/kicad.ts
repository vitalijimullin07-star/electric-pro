import { boxOfPoints } from '../math/geom';
import type { Vec2 } from '../math/vec';
import { MY_CATEGORY } from '../library/builder';
import { addTrack, addVia, addZone, addRuleArea, addDrawing, ensureNet, ensureFootprint } from '../model/edit';
import { newId, nextRef } from '../ids';
import { createProject } from '../model/project';
import type { Component, FootprintDef, Graphic, LayerId, PadDef, PadShape, PadType, Project } from '../model/types';

/*
 * Импорт из KiCad 6–10: корпуса (.kicad_mod) и платы (.kicad_pcb).
 * Координаты KiCad — мм, ось Y вниз, углы против часовой на экране — как у нас.
 * Корпус на нижней стороне KiCad хранит уже отражённым; мы храним корпус для
 * верхней стороны и отражаем при установке, поэтому отражаем обратно по X.
 */

export type SNode = string | SNode[];

/** Разбор S-выражения KiCad. Строки в кавычках — атомы без кавычек. */
export function parseSexpr(text: string): SNode {
  const stack: SNode[][] = [[]];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '(') {
      const list: SNode[] = [];
      stack[stack.length - 1].push(list);
      stack.push(list);
      i++;
    } else if (c === ')') {
      if (stack.length > 1) stack.pop();
      i++;
    } else if (c === '"') {
      let s = '';
      i++;
      while (i < n && text[i] !== '"') {
        if (text[i] === '\\' && i + 1 < n) {
          const e = text[i + 1];
          s += e === 'n' ? '\n' : e === 't' ? '\t' : e;
          i += 2;
        } else s += text[i++];
      }
      i++;
      stack[stack.length - 1].push(s);
    } else if (c === ' ' || c === '\n' || c === '\r' || c === '\t') i++;
    else {
      let j = i;
      while (j < n && !' \n\r\t()"'.includes(text[j])) j++;
      stack[stack.length - 1].push(text.slice(i, j));
      i = j;
    }
  }
  const top = stack[0];
  return top.length === 1 ? top[0] : top;
}

const isList = (x: SNode | undefined): x is SNode[] => Array.isArray(x);
const head = (x: SNode | undefined): string => (isList(x) && typeof x[0] === 'string' ? x[0] : '');
export const child = (x: SNode, name: string): SNode[] | undefined => (isList(x) ? (x.find((c) => head(c) === name) as SNode[] | undefined) : undefined);
export const children = (x: SNode, name: string): SNode[][] => (isList(x) ? (x.filter((c) => head(c) === name) as SNode[][]) : []);
const num = (x: SNode | undefined, d = 0): number => (typeof x === 'string' && x !== '' && Number.isFinite(+x) ? +x : d);
const str = (x: SNode | undefined): string => (typeof x === 'string' ? x : '');
const xy = (x: SNode[] | undefined): Vec2 => ({ x: num(x?.[1]), y: num(x?.[2]) });
const r4 = (v: number): number => Math.round(v * 1e4) / 1e4 + 0;
const hasFlag = (x: SNode, flag: string): boolean => isList(x) && x.some((c) => c === flag || (head(c) === flag && str((c as SNode[])[1]) !== 'no'));

const LAYER_MAP: Record<string, LayerId> = {
  'F.Cu': 'F.Cu',
  'B.Cu': 'B.Cu',
  'F.SilkS': 'F.Silk',
  'B.SilkS': 'B.Silk',
  'F.Silkscreen': 'F.Silk',
  'B.Silkscreen': 'B.Silk',
  'F.Mask': 'F.Mask',
  'B.Mask': 'B.Mask',
  'F.Paste': 'F.Paste',
  'B.Paste': 'B.Paste',
  'F.Fab': 'F.Fab',
  'B.Fab': 'B.Fab',
  'F.CrtYd': 'F.Courtyard',
  'B.CrtYd': 'B.Courtyard',
  'F.Courtyard': 'F.Courtyard',
  'B.Courtyard': 'B.Courtyard',
  'Edge.Cuts': 'Edge.Cuts',
};
const SWAP: Partial<Record<LayerId, LayerId>> = { 'F.Cu': 'B.Cu', 'B.Cu': 'F.Cu', 'F.Silk': 'B.Silk', 'B.Silk': 'F.Silk', 'F.Mask': 'B.Mask', 'B.Mask': 'F.Mask', 'F.Paste': 'B.Paste', 'B.Paste': 'F.Paste', 'F.Fab': 'B.Fab', 'B.Fab': 'F.Fab', 'F.Courtyard': 'B.Courtyard', 'B.Courtyard': 'F.Courtyard' };

function mapLayer(name: string, flip: boolean): LayerId | null {
  const l = LAYER_MAP[name];
  if (!l) return null;
  return flip ? (SWAP[l] ?? l) : l;
}

const strokeWidth = (n: SNode): number => num(child(child(n, 'stroke') ?? [], 'width')?.[1], num(child(n, 'width')?.[1], 0.12));

/** Точки дуги по трём точкам (начало, середина, конец). */
export function arcThrough(a: Vec2, m: Vec2, b: Vec2, maxSeg = 0.2): Vec2[] {
  const d = 2 * (a.x * (m.y - b.y) + m.x * (b.y - a.y) + b.x * (a.y - m.y));
  if (Math.abs(d) < 1e-9) return [a, b];
  const ux = ((a.x ** 2 + a.y ** 2) * (m.y - b.y) + (m.x ** 2 + m.y ** 2) * (b.y - a.y) + (b.x ** 2 + b.y ** 2) * (a.y - m.y)) / d;
  const uy = ((a.x ** 2 + a.y ** 2) * (b.x - m.x) + (m.x ** 2 + m.y ** 2) * (a.x - b.x) + (b.x ** 2 + b.y ** 2) * (m.x - a.x)) / d;
  const r = Math.hypot(a.x - ux, a.y - uy);
  const ang = (p: Vec2) => Math.atan2(p.y - uy, p.x - ux);
  const a0 = ang(a);
  // Идём от a к b через m: если m не на пути «по возрастанию угла», идём в другую сторону.
  const norm = (v: number) => ((((v - a0) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI));
  let sweep = norm(ang(b));
  if (norm(ang(m)) > sweep) sweep -= 2 * Math.PI;
  const steps = Math.max(2, Math.ceil((Math.abs(sweep) * r) / maxSeg));
  const out: Vec2[] = [];
  for (let k = 0; k <= steps; k++) {
    const t = a0 + (sweep * k) / steps;
    out.push({ x: r4(ux + r * Math.cos(t)), y: r4(uy + r * Math.sin(t)) });
  }
  return out;
}

interface FpOpts {
  /** Угол корпуса на плате (для плат: углы площадок в файле абсолютные). */
  rot: number;
  /** Корпус на нижней стороне: его геометрия в файле отражена. */
  bottom: boolean;
  board: boolean;
}

export interface ParsedFootprint {
  def: FootprintDef;
  ref: string;
  value: string;
  padNets: Record<string, string>;
  excludeFromBom: boolean;
  warnings: string[];
}

const normAng = (a: number): number => r4(((a % 360) + 360) % 360);

function guessPrefix(id: string, ref: string): string {
  const fromRef = /^[A-Za-z]+/.exec(ref)?.[0];
  if (fromRef && ref !== 'REF**') return fromRef.toUpperCase();
  const u = id.toUpperCase();
  if (/^(R_|RESISTOR|RV)/.test(u)) return 'R';
  if (/^(C_|CP_|CAP)/.test(u)) return 'C';
  if (/^(L_|IND)/.test(u)) return 'L';
  if (/^LED/.test(u)) return 'D';
  if (/^(D_|DIODE)/.test(u)) return 'D';
  if (/^(SOT|TO-|TO_|DPAK|D2PAK)/.test(u)) return 'Q';
  if (/^(CONN|PIN|USB|JST|TERMINAL|BARREL)/.test(u)) return 'J';
  if (/^(SW|BUTTON)/.test(u)) return 'SW';
  if (/^(CRYSTAL|XTAL|RESONATOR)/.test(u)) return 'Y';
  if (/^(FUSE)/.test(u)) return 'F';
  if (/^(MOUNTING|HOLE)/.test(u)) return 'H';
  return 'U';
}

/** Корпус из узла (footprint …) или (module …). */
export function parseFootprintNode(node: SNode[], o: FpOpts = { rot: 0, bottom: false, board: false }): ParsedFootprint {
  const warnings: string[] = [];
  const full = str(node[1]);
  const id = full.includes(':') ? full.slice(full.indexOf(':') + 1) : full;
  const L = (p: Vec2): Vec2 => (o.bottom ? { x: r4(-p.x), y: r4(p.y) } : { x: r4(p.x), y: r4(p.y) });
  const relAng = (a: number): number => {
    const local = o.board ? a - o.rot : a;
    return normAng(o.bottom ? -local : local);
  };
  const pads: PadDef[] = [];
  const padNets: Record<string, string> = {};
  let slots = 0;
  for (const p of children(node, 'pad')) {
    const kind = str(p[2]);
    const type: PadType = kind === 'thru_hole' ? 'tht' : kind === 'np_thru_hole' ? 'npth' : 'smd';
    let shapeName = str(p[3]);
    if (shapeName === 'custom') shapeName = str(child(child(p, 'options') ?? [], 'anchor')?.[1]) || 'rect';
    const shape: PadShape = shapeName === 'circle' ? 'circle' : shapeName === 'oval' ? 'oval' : shapeName === 'roundrect' ? 'roundrect' : 'rect';
    const at = child(p, 'at');
    const size = xy(child(p, 'size'));
    const pd: PadDef = { number: type === 'npth' ? '' : str(p[1]), type, shape, at: L(xy(at)), size: { x: r4(size.x), y: r4(size.y) } };
    // Планарная площадка на другой стороне корпуса (торцевой разъём): у отражённого корпуса слои в файле тоже отражены.
    const pl = (child(p, 'layers') ?? []).slice(1).map(str);
    if (type === 'smd' && pl.includes(o.bottom ? 'F.Cu' : 'B.Cu') && !pl.includes(o.bottom ? 'B.Cu' : 'F.Cu')) pd.layer = 'B.Cu';
    const ang = relAng(num(at?.[3]));
    if (ang) pd.rotation = ang;
    if (shape === 'roundrect') pd.roundness = num(child(p, 'roundrect_rratio')?.[1], 0.25);
    const dr = child(p, 'drill');
    if (dr && type !== 'smd') {
      if (str(dr[1]) === 'oval') {
        pd.drill = r4(Math.min(num(dr[2]), num(dr[3], num(dr[2]))));
        slots++;
      } else pd.drill = r4(num(dr[1]));
      if (!pd.drill) pd.drill = r4(Math.min(size.x, size.y) * 0.5);
    }
    const net = child(p, 'net');
    const netName = net ? str(net[net.length - 1]) : '';
    if (netName && pd.number && !padNets[pd.number]) padNets[pd.number] = netName;
    if (pd.size.x > 0 && pd.size.y > 0) pads.push(pd);
  }
  if (slots) warnings.push(`${id}: пазы (${slots}) заменены круглыми отверстиями по ширине паза.`);

  const graphics: Graphic[] = [];
  const gl = (n: SNode[]): LayerId | null => mapLayer(str(child(n, 'layer')?.[1]), o.bottom);
  for (const n of node) {
    if (!isList(n)) continue;
    const h = head(n);
    const layer = h.startsWith('fp_') ? gl(n) : null;
    if (!layer || layer === 'Edge.Cuts' || layer.endsWith('Cu')) continue;
    const width = strokeWidth(n);
    const fill = ['yes', 'solid'].includes(str(child(n, 'fill')?.[1]));
    if (h === 'fp_line') graphics.push({ kind: 'line', layer, a: L(xy(child(n, 'start'))), b: L(xy(child(n, 'end'))), width });
    else if (h === 'fp_rect') graphics.push({ kind: 'rect', layer, a: L(xy(child(n, 'start'))), b: L(xy(child(n, 'end'))), width, fill });
    else if (h === 'fp_circle') {
      const c = xy(child(n, 'center'));
      const e = xy(child(n, 'end'));
      graphics.push({ kind: 'circle', layer, c: L(c), r: r4(Math.hypot(e.x - c.x, e.y - c.y)), width, fill });
    } else if (h === 'fp_arc') {
      const mid = child(n, 'mid');
      if (mid) graphics.push({ kind: 'poly', layer, pts: arcThrough(xy(child(n, 'start')), xy(mid), xy(child(n, 'end'))).map(L), width, closed: false });
    } else if (h === 'fp_poly') {
      const pts = children(child(n, 'pts') ?? [], 'xy').map((q) => L(xy(q)));
      if (pts.length >= 2) graphics.push({ kind: 'poly', layer, pts, width, fill, closed: true });
    }
  }
  // Надписи: fp_text (KiCad 6–7) и свойства Reference/Value (KiCad 8+).
  let ref = '';
  let value = '';
  const textOf = (n: SNode[], text: string) => {
    const layer = gl(n);
    const at = child(n, 'at');
    if (!layer || hasFlag(n, 'hide') || str(at?.[0]) !== 'at') return;
    const font = child(child(n, 'effects') ?? [], 'font');
    const size = num(child(font ?? [], 'size')?.[1], 1);
    const thickness = num(child(font ?? [], 'thickness')?.[1], size * 0.15);
    const rot = relAng(num(at?.[3]));
    graphics.push({ kind: 'text', layer, at: L(xy(at)), text, size, thickness, rotation: rot || undefined, align: 'center' });
  };
  for (const n of children(node, 'property')) {
    const k = str(n[1]);
    if (k === 'Reference') {
      ref = str(n[2]);
      textOf(n, '${REF}');
    } else if (k === 'Value') {
      value = str(n[2]);
      textOf(n, '${VALUE}');
    }
  }
  for (const n of children(node, 'fp_text')) {
    const k = str(n[1]);
    const t = str(n[2]);
    if (k === 'reference') ref = ref || t;
    if (k === 'value') value = value || t;
    textOf(n, k === 'reference' ? '${REF}' : k === 'value' ? '${VALUE}' : t.replace(/\$\{REFERENCE\}/g, '${REF}').replace(/\$\{VALUE\}/g, '${VALUE}'));
  }
  // Габарит установки — по слою courtyard, если он нарисован.
  const crt: Vec2[] = [];
  for (const g of graphics)
    if (g.layer === 'F.Courtyard') {
      if (g.kind === 'line' || g.kind === 'rect') crt.push(g.a, g.b);
      else if (g.kind === 'circle') crt.push({ x: g.c.x - g.r, y: g.c.y - g.r }, { x: g.c.x + g.r, y: g.c.y + g.r });
      else if (g.kind === 'poly') crt.push(...g.pts);
    }
  const cb = crt.length ? boxOfPoints(crt) : null;
  const attr = child(node, 'attr');
  const def: FootprintDef = {
    id,
    name: id,
    description: str(child(node, 'descr')?.[1]) || undefined,
    category: MY_CATEGORY,
    group: 'Из KiCad',
    tags: str(child(node, 'tags')?.[1]).split(/\s+/).filter(Boolean),
    pads,
    graphics,
    courtyard: cb ? { min: { x: r4(cb.minX), y: r4(cb.minY) }, max: { x: r4(cb.maxX), y: r4(cb.maxY) } } : undefined,
    refPrefix: guessPrefix(id, ref),
    source: 'Импорт из KiCad',
    verified: false,
  };
  return { def, ref, value, padNets, excludeFromBom: !!attr && attr.includes('exclude_from_bom'), warnings };
}

/** Корпус из файла .kicad_mod. */
export function importKicadFootprint(text: string): { def: FootprintDef; warnings: string[] } {
  const root = parseSexpr(text);
  if (!isList(root) || !['footprint', 'module'].includes(head(root))) throw new Error('Это не корпус KiCad: нет (footprint …).');
  const r = parseFootprintNode(root);
  if (!r.def.pads.length) throw new Error(`${r.def.id}: в корпусе нет площадок.`);
  return { def: r.def, warnings: r.warnings };
}

/** Сцепляет отрезки контура в замкнутые многоугольники. */
function chainLoops(segs: Vec2[][]): Vec2[][] {
  const eq = (a: Vec2, b: Vec2) => Math.abs(a.x - b.x) < 1e-3 && Math.abs(a.y - b.y) < 1e-3;
  const left = segs.filter((s) => s.length >= 2).map((s) => [...s]);
  const loops: Vec2[][] = [];
  while (left.length) {
    const cur = left.shift()!;
    let grown = true;
    while (grown && !eq(cur[0], cur[cur.length - 1])) {
      grown = false;
      for (let i = 0; i < left.length; i++) {
        const s = left[i];
        const end = cur[cur.length - 1];
        if (eq(s[0], end)) cur.push(...s.slice(1));
        else if (eq(s[s.length - 1], end)) cur.push(...[...s].reverse().slice(1));
        else continue;
        left.splice(i, 1);
        grown = true;
        break;
      }
    }
    if (cur.length >= 4 && eq(cur[0], cur[cur.length - 1])) loops.push(cur.slice(0, -1));
    else if (cur.length >= 3 && segs.length === 1) loops.push(cur);
  }
  return loops;
}

const polyArea = (p: Vec2[]): number => Math.abs(p.reduce((s, q, i) => s + q.x * p[(i + 1) % p.length].y - p[(i + 1) % p.length].x * q.y, 0) / 2);

export interface KicadBoardResult {
  project: Project;
  warnings: string[];
}

/** Плата из файла .kicad_pcb. */
export function importKicadBoard(text: string, name = 'Плата из KiCad'): KicadBoardResult {
  const root = parseSexpr(text);
  if (!isList(root) || head(root) !== 'kicad_pcb') throw new Error('Это не плата KiCad: нет (kicad_pcb …).');
  const warnings: string[] = [];
  const layersNode = child(root, 'layers') ?? [];
  const copper = layersNode.filter((l) => isList(l) && /\.Cu$/.test(str(l[1]))).map((l) => str((l as SNode[])[1]));
  if (copper.length > 2) warnings.push(`Слоёв меди в KiCad ${copper.length}: внутренние слои не переносятся (здесь до двух слоёв).`);
  const p = createProject({ name, copperLayers: copper.includes('B.Cu') ? 2 : 1 });
  p.board.thickness = num(child(child(root, 'general') ?? [], 'thickness')?.[1], 1.6);

  // Цепи: в KiCad ≤ 9 номер → имя в заголовке, в 10 — имя прямо у объекта.
  const netNames = new Map<string, string>();
  for (const n of children(root, 'net')) netNames.set(str(n[1]), str(n[2]));
  const netOf = (n: SNode[] | undefined): string | null => {
    if (!n) return null;
    const nm = n.length >= 3 ? str(n[2]) : netNames.get(str(n[1])) || str(n[1]);
    return nm ? ensureNet(p, nm).id : null;
  };
  const cuLayer = (n: SNode[]): 'F.Cu' | 'B.Cu' | null => {
    const l = str(child(n, 'layer')?.[1]);
    return l === 'F.Cu' || l === 'B.Cu' ? l : null;
  };

  // Корпуса и компоненты.
  const defs = new Map<string, string>(); // id → JSON для сравнения
  let comps = 0;
  const used: string[] = [];
  for (const fnode of [...children(root, 'footprint'), ...children(root, 'module')]) {
    const bottom = str(child(fnode, 'layer')?.[1]) === 'B.Cu';
    const at = child(fnode, 'at');
    const rot = num(at?.[3]);
    const r = parseFootprintNode(fnode, { rot, bottom, board: true });
    warnings.push(...r.warnings);
    // Один и тот же корпус с разной геометрией (правка на плате) — отдельные id.
    let id = r.def.id;
    const sig = JSON.stringify([r.def.pads, r.def.graphics.filter((g) => g.kind !== 'text')]);
    for (let k = 2; defs.has(id) && defs.get(id) !== sig; k++) id = `${r.def.id}_${k}`;
    defs.set(id, sig);
    const def: FootprintDef = { ...r.def, id, name: id, category: 'Проект', group: 'Из KiCad' };
    ensureFootprint(p, def);
    let ref = r.ref && r.ref !== 'REF**' ? r.ref : nextRef(def.refPrefix ?? 'U', used);
    if (used.includes(ref)) ref = nextRef(/^[A-Za-z]+/.exec(ref)?.[0] ?? 'U', used);
    used.push(ref);
    const padNets: Record<string, string> = {};
    for (const [pad, nm] of Object.entries(r.padNets)) padNets[pad] = ensureNet(p, nm).id;
    const c: Component = {
      id: newId('c'),
      ref,
      value: r.value,
      footprint: id,
      at: xy(at),
      rotation: normAng(rot),
      side: bottom ? 'bottom' : 'top',
      padNets,
      excludeFromBom: r.excludeFromBom || undefined,
    };
    p.components[c.id] = c;
    comps++;
  }

  // Дорожки и дуги.
  let dropped = 0;
  for (const s of children(root, 'segment')) {
    const layer = cuLayer(s);
    if (!layer) {
      dropped++;
      continue;
    }
    addTrack(p, { layer, width: num(child(s, 'width')?.[1], 0.25), points: [xy(child(s, 'start')), xy(child(s, 'end'))] });
  }
  for (const s of children(root, 'arc')) {
    const layer = cuLayer(s);
    if (!layer) {
      dropped++;
      continue;
    }
    addTrack(p, { layer, width: num(child(s, 'width')?.[1], 0.25), points: arcThrough(xy(child(s, 'start')), xy(child(s, 'mid')), xy(child(s, 'end'))) });
  }
  if (dropped) warnings.push(`Дорожек на внутренних слоях: ${dropped} — не перенесены.`);
  for (const v of children(root, 'via')) addVia(p, { at: xy(child(v, 'at')), diameter: num(child(v, 'size')?.[1], 0.8), drill: num(child(v, 'drill')?.[1], 0.4) });

  // Полигоны и области запрета.
  for (const z of children(root, 'zone')) {
    const pts = children(child(child(z, 'polygon') ?? [], 'pts') ?? [], 'xy').map(xy);
    if (pts.length < 3) continue;
    const layers = [str(child(z, 'layer')?.[1]), ...(child(z, 'layers') ?? []).slice(1).map(str)].filter((l) => l === 'F.Cu' || l === 'B.Cu' || l === '*.Cu' || l === 'F&B.Cu');
    const keep = child(z, 'keepout');
    if (keep) {
      const no = (k: string) => str(child(keep, k)?.[1]) === 'not_allowed';
      addRuleArea(p, { name: str(child(z, 'name')?.[1]) || 'Запрет из KiCad', outline: pts, keepoutTracks: no('tracks') || no('copperpour'), keepoutVias: no('vias'), showLabel: false });
      continue;
    }
    const net = netOf(child(z, 'net')) ?? (str(child(z, 'net_name')?.[1]) ? ensureNet(p, str(child(z, 'net_name')?.[1])).id : null);
    const cp = child(z, 'connect_pads');
    const fill = child(z, 'fill') ?? [];
    const cuLayers = layers.flatMap((l) => (l === '*.Cu' || l === 'F&B.Cu' ? (['F.Cu', 'B.Cu'] as const) : [l as 'F.Cu' | 'B.Cu']));
    for (const layer of [...new Set(cuLayers)])
      addZone(p, {
        layer,
        net,
        outline: pts,
        clearance: num(child(cp ?? [], 'clearance')?.[1], 0.5),
        minWidth: num(child(z, 'min_thickness')?.[1], 0.25),
        priority: num(child(z, 'priority')?.[1], 0),
        padConnection: cp && str(cp[1]) === 'yes' ? 'solid' : undefined,
        thermalGap: num(child(fill, 'thermal_gap')?.[1], 0) || undefined,
        thermalWidth: num(child(fill, 'thermal_bridge_width')?.[1], 0) || undefined,
      });
  }

  // Контур платы и графика платы.
  const edge: Vec2[][] = [];
  for (const g of root) {
    if (!isList(g)) continue;
    const h = head(g);
    if (!h.startsWith('gr_')) continue;
    const lname = str(child(g, 'layer')?.[1]);
    const width = strokeWidth(g);
    let pts: Vec2[] | null = null;
    let closed = false;
    if (h === 'gr_line') pts = [xy(child(g, 'start')), xy(child(g, 'end'))];
    else if (h === 'gr_arc') pts = arcThrough(xy(child(g, 'start')), xy(child(g, 'mid')), xy(child(g, 'end')));
    else if (h === 'gr_rect') {
      const a = xy(child(g, 'start'));
      const b = xy(child(g, 'end'));
      pts = [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }, a];
      closed = true;
    } else if (h === 'gr_circle') {
      const c = xy(child(g, 'center'));
      const e = xy(child(g, 'end'));
      const r = Math.hypot(e.x - c.x, e.y - c.y);
      const n = Math.max(24, Math.ceil(r * 8));
      pts = Array.from({ length: n + 1 }, (_, k) => ({ x: r4(c.x + r * Math.cos((2 * Math.PI * k) / n)), y: r4(c.y + r * Math.sin((2 * Math.PI * k) / n)) }));
      closed = true;
    } else if (h === 'gr_poly') {
      pts = children(child(g, 'pts') ?? [], 'xy').map(xy);
      if (pts.length) pts.push(pts[0]);
      closed = true;
    } else if (h === 'gr_text') {
      const layer = mapLayer(lname, false);
      const at = child(g, 'at');
      if (layer && layer !== 'Edge.Cuts' && !hasFlag(g, 'hide')) {
        const font = child(child(g, 'effects') ?? [], 'font');
        const size = num(child(font ?? [], 'size')?.[1], 1);
        addDrawing(p, { kind: 'text', layer, at: xy(at), text: str(g[1]), size, thickness: num(child(font ?? [], 'thickness')?.[1], size * 0.15), rotation: num(at?.[3]) || undefined, align: 'center' });
      }
      continue;
    }
    if (!pts) continue;
    if (lname === 'Edge.Cuts') edge.push(pts);
    else {
      const layer = mapLayer(lname, false);
      if (layer && !layer.endsWith('Cu') && layer !== 'Edge.Cuts') addDrawing(p, { kind: 'poly', layer, pts: closed ? pts.slice(0, -1) : pts, width, closed });
    }
  }
  const loops = chainLoops(edge).sort((a, b) => polyArea(b) - polyArea(a));
  if (loops.length) {
    p.board.outline = loops[0].map((q) => ({ x: r4(q.x), y: r4(q.y) }));
    p.board.cornerRadius = 0;
    p.board.cutouts = loops.slice(1).map((l) => l.map((q) => ({ x: r4(q.x), y: r4(q.y) })));
  } else {
    // Контура нет — прямоугольник вокруг всего с запасом.
    const all: Vec2[] = [...Object.values(p.components).map((c) => c.at), ...Object.values(p.tracks).flatMap((t) => t.points)];
    const b = all.length ? boxOfPoints(all, 5) : { minX: 0, minY: 0, maxX: 100, maxY: 80 };
    p.board.outline = [
      { x: b.minX, y: b.minY },
      { x: b.maxX, y: b.minY },
      { x: b.maxX, y: b.maxY },
      { x: b.minX, y: b.maxY },
    ];
    warnings.push('Контур платы (Edge.Cuts) не найден или не замкнут — поставлен прямоугольник по деталям.');
  }
  if (!comps) warnings.push('На плате нет корпусов.');
  return { project: p, warnings: [...new Set(warnings)] };
}
