import { boxOfPoints } from '../math/geom';
import type { Vec2 } from '../math/vec';
import { LAYERS } from '../model/layers';
import { boardPolygon } from '../model/project';
import type { LayerId, Project } from '../model/types';
import { getWorld } from '../model/world';
import { flashOutline, flattenProject, type Prim } from '../render/flatten';
import { textStrokes } from '../render/stroke-font';
import { PdfDoc, type PdfPage } from './pdf';

/*
 * Листы для ЛУТ и фоторезиста: рисунок слоя строго 1:1 на A4 (или A3, если плата
 * не влезает), несколько копий на листе, контрольная линейка 50 мм для проверки
 * масштаба печати, точки под кернение в центрах отверстий.
 */

export interface LutSheet {
  layer: LayerId;
  /** Зеркально: верхние слои для ЛУТ печатаются зеркально, нижние — нет. */
  mirror: boolean;
}

export interface LutPdfOptions {
  sheets: LutSheet[];
  /** Сколько копий на листе, не больше, чем помещается. */
  copies?: number;
  paper?: 'auto' | 'A4' | 'A3';
  /** Негатив: медь белая на чёрном (для негативного фоторезиста). */
  negative?: boolean;
  drillMarks?: boolean;
  outline?: boolean;
}

export interface LutPdfResult {
  bytes: Uint8Array;
  /** Сколько копий поместилось на каждом листе. */
  copies: number[];
  paper: 'A4' | 'A3';
  /** Плата больше листа A3 — печать по частям не поддерживается. */
  tooBig: boolean;
}

const PAPER = { A4: { w: 210, h: 297 }, A3: { w: 297, h: 420 } };
const MARGIN = 10;
const HEADER = 14;
const RULER = 16;
const GAP = 6;

/** Для ЛУТ: рисунок переносится лицом к меди, поэтому верхняя сторона печатается зеркально. */
export const lutMirrorFor = (layer: LayerId): boolean => layer.startsWith('F.');

interface Layout {
  paper: 'A4' | 'A3';
  w: number;
  h: number;
  cols: number;
  rows: number;
}

function fit(paper: 'A4' | 'A3', bw: number, bh: number): Layout[] {
  const out: Layout[] = [];
  for (const land of [false, true]) {
    const w = land ? PAPER[paper].h : PAPER[paper].w;
    const h = land ? PAPER[paper].w : PAPER[paper].h;
    const cols = Math.floor((w - 2 * MARGIN + GAP) / (bw + GAP));
    const rows = Math.floor((h - 2 * MARGIN - HEADER - RULER + GAP) / (bh + GAP));
    out.push({ paper, w, h, cols: Math.max(0, cols), rows: Math.max(0, rows) });
  }
  return out;
}

function chooseLayout(bw: number, bh: number, copies: number, paper: LutPdfOptions['paper']): { layout: Layout; tooBig: boolean } {
  const papers: ('A4' | 'A3')[] = paper === 'A3' ? ['A3'] : paper === 'A4' ? ['A4'] : ['A4', 'A3'];
  for (const pp of papers) {
    const opts = fit(pp, bw, bh).filter((l) => l.cols * l.rows > 0);
    if (!opts.length) continue;
    // Больше копий (до нужного числа); при равенстве — книжная.
    opts.sort((a, b) => Math.min(copies, b.cols * b.rows) - Math.min(copies, a.cols * a.rows));
    return { layout: opts[0], tooBig: false };
  }
  const last = papers[papers.length - 1];
  const big = fit(last, bw, bh)[bw > bh ? 1 : 0];
  return { layout: { ...big, cols: 1, rows: 1 }, tooBig: true };
}

function text(pg: PdfPage, s: string, at: Vec2, size: number, align: 'left' | 'center' | 'right' = 'left', width = size * 0.12): void {
  for (const st of textStrokes({ text: s, at, size, align })) pg.polyline(st, width);
}

function drawPrim(pg: PdfPage, pr: Prim): void {
  if (pr.kind === 'path') pg.polyline(pr.pts, pr.width, pr.closed);
  else if (pr.kind === 'region') pg.polygon(pr.pts);
  else if (pr.kind === 'fill') pg.evenOdd(pr.loops);
  else if (pr.shape.pts.length === 1) pg.circle(pr.shape.pts[0], pr.shape.r);
  else pg.polygon(flashOutline(pr.shape));
}

/** Контрольная линейка 50 мм с делениями через 1 мм. */
function ruler(pg: PdfPage, x: number, y: number): void {
  pg.strokeColor(0).fillColor(0);
  pg.polyline([{ x, y }, { x: x + 50, y }], 0.2);
  for (let i = 0; i <= 50; i++) {
    const len = i % 10 === 0 ? 3 : i % 5 === 0 ? 2 : 1.2;
    pg.polyline([{ x: x + i, y }, { x: x + i, y: y - len }], i % 10 === 0 ? 0.2 : 0.12);
    if (i % 10 === 0) text(pg, String(i), { x: x + i, y: y - 5 }, 2, 'center', 0.22);
  }
  text(pg, 'мм', { x: x + 53, y: y - 1 }, 2, 'left', 0.22);
  text(pg, 'Проверьте линейкой: от 0 до 50 должно быть ровно 50 мм.', { x: x + 62, y: y - 3.2 }, 2.2, 'left', 0.22);
  text(pg, 'Иначе в печати выберите масштаб 100% (фактический размер).', { x: x + 62, y: y + 0.2 }, 2.2, 'left', 0.22);
}

export function exportLutPdf(p: Project, o: LutPdfOptions): LutPdfResult {
  const prims = flattenProject(p, { fab: false });
  const outline = boardPolygon(p.board);
  const bb = boxOfPoints(outline);
  const bw = bb.maxX - bb.minX;
  const bh = bb.maxY - bb.minY;
  const want = Math.max(1, Math.round(o.copies ?? 1));
  const { layout, tooBig } = chooseLayout(bw, bh, want, o.paper ?? 'auto');
  const n = Math.min(want, layout.cols * layout.rows);
  const cols = Math.min(layout.cols, n);
  const rows = Math.ceil(n / cols);
  const negative = o.negative ?? false;
  const ink = negative ? 1 : 0;
  const paper = negative ? 0 : 1;
  const w = getWorld(p);
  const holes: { c: Vec2; r: number }[] = [];
  if (o.drillMarks ?? true) {
    for (const wp of w.pads) if (wp.drill) holes.push({ c: wp.center, r: Math.min(0.35, wp.drill / 3) });
    for (const v of w.vias) holes.push({ c: v.via.at, r: Math.min(0.35, v.via.drill / 3) });
  }

  const doc = new PdfDoc(`${p.meta.name} — ЛУТ`);
  const copies: number[] = [];
  for (const sh of o.sheets) {
    const pg = doc.addPage(layout.w, layout.h);
    const isCu = sh.layer === 'F.Cu' || sh.layer === 'B.Cu';
    // Заголовок: что за слой и как прикладывать.
    pg.strokeColor(0);
    text(pg, `${p.meta.name}: ${LAYERS[sh.layer].name}, ${sh.mirror ? 'зеркально' : 'без зеркала'}, 1:1`, { x: MARGIN, y: MARGIN + 2 }, 3.2, 'left', 0.32);
    text(
      pg,
      isCu ? 'ЛУТ: приложите лист тонером к меди. Точки в отверстиях - под кернение.' : 'Шелкография для ЛУТ на сторону деталей после сверления.',
      { x: MARGIN, y: MARGIN + 8 },
      2.2,
      'left',
      0.22,
    );
    const blockW = cols * bw + (cols - 1) * GAP;
    const blockH = rows * bh + (rows - 1) * GAP;
    const areaTop = MARGIN + HEADER;
    const areaH = layout.h - 2 * MARGIN - HEADER - RULER;
    const x0 = (layout.w - blockW) / 2;
    const y0 = areaTop + Math.max(0, (areaH - blockH) / 2);
    for (let k = 0; k < n; k++) {
      const ox = x0 + (k % cols) * (bw + GAP);
      const oy = y0 + Math.floor(k / cols) * (bh + GAP);
      pg.save();
      // Точка платы (x, y) → лист: ox + (x − minX) или зеркально ox + (maxX − x).
      pg.transform(sh.mirror ? -1 : 1, 0, 0, 1, sh.mirror ? ox + bb.maxX : ox - bb.minX, oy - bb.minY);
      if (negative) pg.fillColor(0).polygon(outline);
      pg.fillColor(ink).strokeColor(ink);
      for (const pr of prims[sh.layer] ?? []) drawPrim(pg, pr);
      if (o.outline ?? true) pg.strokeColor(negative ? 0.5 : 0).polyline(outline, 0.15, true);
      if (isCu && holes.length) {
        pg.fillColor(paper);
        for (const hl of holes) pg.circle(hl.c, hl.r);
      }
      pg.restore();
    }
    ruler(pg, MARGIN, layout.h - MARGIN - 3);
    copies.push(n);
  }
  return { bytes: doc.toBytes(), copies, paper: layout.paper, tooBig };
}
