import { boxOfPoints } from '../math/geom';
import type { Vec2 } from '../math/vec';
import { LAYERS, boardCopperLayers } from '../model/layers';
import { boardBox } from '../model/project';
import type { LayerId, Project } from '../model/types';
import { flashOutline, flattenProject, type LayerPrims, type Prim } from '../render/flatten';
import { getWorld } from '../model/world';

/*
 * Gerber RS-274X (с атрибутами X2) и Excellon для сверловки.
 * Координаты в мм, формат 4.6. Ось Y переворачивается: в проекте Y вниз,
 * в Gerber — вверх; начало координат — левый нижний угол габарита платы.
 */

export interface GerberFile {
  name: string;
  layer: LayerId | 'PTH' | 'NPTH';
  content: string;
}

function fmt(v: number): string {
  return String(Math.round(v * 1e6));
}

class GerberWriter {
  private lines: string[] = [];
  private apertures = new Map<string, number>();
  private nextD = 10;
  private current = -1;
  private body: string[] = [];

  constructor(
    private readonly ox: number,
    private readonly oy: number,
    fileFunction: string,
    polarity: 'Positive' | 'Negative',
  ) {
    this.lines.push(`%TF.GenerationSoftware,Plata,Plata,0.2*%`);
    this.lines.push(`%TF.CreationDate,${new Date().toISOString()}*%`);
    this.lines.push(`%TF.FileFunction,${fileFunction}*%`);
    this.lines.push(`%TF.FilePolarity,${polarity}*%`);
    this.lines.push('%FSLAX46Y46*%');
    this.lines.push('%MOMM*%');
  }

  private xy(p: Vec2): string {
    return `X${fmt(p.x - this.ox)}Y${fmt(this.oy - p.y)}`;
  }

  private aperture(def: string, fn: string): number {
    const key = def + '|' + fn;
    let d = this.apertures.get(key);
    if (d === undefined) {
      d = this.nextD++;
      this.apertures.set(key, d);
      this.lines.push(`%TA.AperFunction,${fn}*%`);
      this.lines.push(`%ADD${d}${def}*%`);
      this.lines.push('%TD*%');
    }
    return d;
  }

  private select(d: number): void {
    if (this.current !== d) {
      this.body.push(`D${d}*`);
      this.current = d;
    }
  }

  path(pts: Vec2[], width: number, fn: string, closed = false): void {
    if (pts.length < 2) return;
    const d = this.aperture(`C,${Math.max(width, 0.01).toFixed(4)}`, fn);
    this.select(d);
    this.body.push(`${this.xy(pts[0])}D02*`);
    for (let i = 1; i < pts.length; i++) this.body.push(`${this.xy(pts[i])}D01*`);
    if (closed) this.body.push(`${this.xy(pts[0])}D01*`);
  }

  flashCircle(c: Vec2, dia: number, fn: string): void {
    const d = this.aperture(`C,${dia.toFixed(4)}`, fn);
    this.select(d);
    this.body.push(`${this.xy(c)}D03*`);
  }

  region(pts: Vec2[]): void {
    if (pts.length < 3) return;
    this.body.push('G36*');
    this.body.push(`${this.xy(pts[0])}D02*`);
    for (let i = 1; i < pts.length; i++) this.body.push(`${this.xy(pts[i])}D01*`);
    this.body.push(`${this.xy(pts[0])}D01*`);
    this.body.push('G37*');
  }

  toString(): string {
    return [...this.lines, 'G01*', 'G75*', ...this.body, 'M02*', ''].join('\n');
  }
}

const PAD_FN = { 'F.Cu': 'SMDPad,CuDef', 'B.Cu': 'SMDPad,CuDef' } as const;

function writeLayer(prims: LayerPrims, layer: LayerId, ox: number, oy: number): string {
  const info = LAYERS[layer];
  const isCopper = layer === 'F.Cu' || layer === 'B.Cu';
  const isMask = layer.endsWith('Mask');
  const w = new GerberWriter(ox, oy, info.gerberFunction, isMask ? 'Negative' : 'Positive');
  const list = prims[layer] ?? [];
  const lineFn = isCopper ? 'Conductor' : layer === 'Edge.Cuts' ? 'Profile' : 'NonConductor';
  for (const pr of list) {
    if (pr.kind === 'path') w.path(pr.pts, pr.width, lineFn, pr.closed);
    else if (pr.kind === 'region') w.region(pr.pts);
    else {
      const s = pr.shape;
      const fn = isCopper ? (s.pts.length === 1 && s.r > 0 ? 'ComponentPad' : PAD_FN[layer as 'F.Cu']) : 'Material';
      if (s.pts.length === 1) w.flashCircle(s.pts[0], s.r * 2, fn);
      else w.region(flashOutline(s));
    }
  }
  return w.toString();
}

/** Имена файлов в стиле Protel: plata-F_Cu.gtl и т. п. */
export function gerberFileName(base: string, layer: LayerId | 'PTH' | 'NPTH'): string {
  if (layer === 'PTH') return `${base}-PTH.drl`;
  if (layer === 'NPTH') return `${base}-NPTH.drl`;
  return `${base}-${layer.replace('.', '_')}.${LAYERS[layer].gerberExt.toLowerCase()}`;
}

export interface GerberOptions {
  /** Какие слои выводить; по умолчанию — все, что есть на плате. */
  layers?: LayerId[];
  base?: string;
  fab?: boolean;
}

export function exportGerbers(p: Project, o: GerberOptions = {}): GerberFile[] {
  const prims = flattenProject(p, { fab: o.fab ?? false });
  const bb = boardBox(p.board);
  const ox = bb.minX;
  const oy = bb.maxY;
  const copper = boardCopperLayers(p.board.copperLayers);
  const def: LayerId[] = [
    ...copper,
    ...(copper.includes('F.Cu') ? (['F.Mask', 'F.Silk', 'F.Paste'] as LayerId[]) : []),
    ...(copper.includes('B.Cu') ? (['B.Mask', 'B.Silk', 'B.Paste'] as LayerId[]) : []),
    'Edge.Cuts',
  ];
  // На односторонней плате детали стоят сверху: шелкография верхняя всегда нужна.
  if (!def.includes('F.Silk')) def.splice(def.indexOf('Edge.Cuts'), 0, 'F.Silk', 'F.Mask');
  const layers = o.layers ?? def;
  const base = o.base ?? safeName(p.meta.name);
  const files: GerberFile[] = layers.map((l) => ({ name: gerberFileName(base, l), layer: l, content: writeLayer(prims, l, ox, oy) }));
  const drills = exportExcellon(p, base);
  files.push(...drills);
  return files;
}

const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  і: 'i', ї: 'yi', є: 'ye', ґ: 'g', ў: 'u',
};

/**
 * Имя файла только из латиницы, цифр, «_» и «-»: браузеры теряют имя с кириллицей при
 * скачивании (файл сохраняется как «download»), а заводы не любят такие имена в архиве Gerber.
 */
export function safeName(s: string): string {
  const t = [...s.trim()]
    .map((ch) => {
      const lo = ch.toLowerCase();
      const tr = TRANSLIT[lo];
      if (tr === undefined) return ch;
      return ch !== lo && tr ? tr[0].toUpperCase() + tr.slice(1) : tr;
    })
    .join('')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return t || 'plata';
}

/* ---------------- Excellon ---------------- */

interface Hole {
  at: Vec2;
  d: number;
  plated: boolean;
}

export function collectHoles(p: Project): Hole[] {
  const w = getWorld(p);
  const out: Hole[] = [];
  for (const wp of w.pads) if (wp.drill) out.push({ at: wp.center, d: wp.drill, plated: wp.plated });
  for (const v of w.vias) out.push({ at: v.via.at, d: v.via.drill, plated: true });
  return out;
}

function excellonFile(holes: Hole[], ox: number, oy: number, plated: boolean): string {
  const tools = [...new Set(holes.map((h) => +h.d.toFixed(3)))].sort((a, b) => a - b);
  const lines: string[] = ['M48', `; DRILL file {Plata} date ${new Date().toISOString()}`, '; FORMAT={-:-/ absolute / metric / decimal}', `; #@! TF.FileFunction,${plated ? 'Plated' : 'NonPlated'},1,2,PTH`, 'FMAT,2', 'METRIC'];
  tools.forEach((t, i) => lines.push(`T${i + 1}C${t.toFixed(3)}`));
  lines.push('%', 'G90', 'G05');
  tools.forEach((t, i) => {
    lines.push(`T${i + 1}`);
    for (const h of holes) if (+h.d.toFixed(3) === t) lines.push(`X${(h.at.x - ox).toFixed(3)}Y${(oy - h.at.y).toFixed(3)}`);
  });
  lines.push('T0', 'M30', '');
  return lines.join('\n');
}

export function exportExcellon(p: Project, base = safeName(p.meta.name)): GerberFile[] {
  const bb = boardBox(p.board);
  const holes = collectHoles(p);
  const pth = holes.filter((h) => h.plated);
  const npth = holes.filter((h) => !h.plated);
  const out: GerberFile[] = [{ name: gerberFileName(base, 'PTH'), layer: 'PTH', content: excellonFile(pth, bb.minX, bb.maxY, true) }];
  if (npth.length) out.push({ name: gerberFileName(base, 'NPTH'), layer: 'NPTH', content: excellonFile(npth, bb.minX, bb.maxY, false) });
  return out;
}

/** Габарит всех примитивов (для проверки, что ничего не потерялось). */
export function primsBox(prims: Prim[]) {
  const pts: Vec2[] = [];
  for (const pr of prims) {
    if (pr.kind === 'flash') pts.push({ x: pr.shape.box.minX, y: pr.shape.box.minY }, { x: pr.shape.box.maxX, y: pr.shape.box.maxY });
    else pts.push(...pr.pts);
  }
  return boxOfPoints(pts);
}
