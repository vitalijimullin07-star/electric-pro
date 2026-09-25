import type { Vec2 } from '../math/vec';
import type { Project } from '../model/types';
import { labelShape, symbolWorldBox } from '../schematic/layout';
import { schematicNetlist, symbolOf } from '../schematic/netlist';
import { symToWorld } from '../schematic/symbols';
import { textStrokes } from '../render/stroke-font';
import { PdfDoc, type PdfPage } from './pdf';

/*
 * Схема в PDF: лист A4 или A3 (альбомный), схема вписана целиком, рамка и штамп
 * с названием и датой. Надписи — штриховым шрифтом редактора.
 */

const BODY = '#8b1c1c';
const WIRE = '#1a7f37';
const LABEL = '#1f4fa0';

function txt(pg: PdfPage, s: string, at: Vec2, size: number, align: 'left' | 'center' | 'right' = 'center', color = '#303030'): void {
  pg.strokeColor(color);
  for (const st of textStrokes({ text: s, at, size, align })) pg.polyline(st, size * 0.11);
}

export function exportSchematicPdf(p: Project): { bytes: Uint8Array; paper: 'A4' | 'A3' } | null {
  const sch = p.schematic;
  if (!sch || !Object.keys(sch.symbols).length) return null;
  // Габарит схемы.
  const xs: number[] = [];
  const ys: number[] = [];
  for (const s of Object.values(sch.symbols)) {
    const def = symbolOf(p, s);
    if (!def) continue;
    const b = symbolWorldBox(def, s);
    xs.push(b.minX, b.maxX);
    ys.push(b.minY - 3, b.maxY + 3);
  }
  for (const w of Object.values(sch.wires)) for (const q of w.points) (xs.push(q.x), ys.push(q.y));
  for (const l of Object.values(sch.labels)) {
    const b = labelShape(l).box;
    xs.push(b.minX, b.maxX);
    ys.push(b.minY, b.maxY);
  }
  const bx = { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
  const w = bx.maxX - bx.minX;
  const h = bx.maxY - bx.minY;
  const paper: 'A4' | 'A3' = w > 400 || h > 270 ? 'A3' : 'A4';
  const W = paper === 'A4' ? 297 : 420;
  const H = paper === 'A4' ? 210 : 297;
  const doc = new PdfDoc(`${p.meta.name} — схема`);
  const pg = doc.addPage(W, H);
  // Рамка и штамп.
  pg.strokeColor(0).polyline([{ x: 10, y: 10 }, { x: W - 10, y: 10 }, { x: W - 10, y: H - 10 }, { x: 10, y: H - 10 }], 0.35, true);
  pg.polyline([{ x: W - 130, y: H - 28 }, { x: W - 10, y: H - 28 }], 0.3).polyline([{ x: W - 130, y: H - 28 }, { x: W - 130, y: H - 10 }], 0.3);
  txt(pg, p.meta.name, { x: W - 125, y: H - 22 }, 3.2, 'left', '#000000');
  txt(pg, `Схема электрическая принципиальная · ${new Date().toISOString().slice(0, 10)}`, { x: W - 125, y: H - 15 }, 2, 'left', '#000000');
  // Масштаб «вписать».
  const areaW = W - 30;
  const areaH = H - 50;
  const k = Math.min(1.6, areaW / w, areaH / h);
  const ox = 15 + (areaW - w * k) / 2;
  const oy = 15 + (areaH - h * k) / 2;
  pg.save();
  pg.transform(k, 0, 0, k, ox - bx.minX * k, oy - bx.minY * k);
  // Провода и точки соединения.
  pg.strokeColor(WIRE);
  for (const wr of Object.values(sch.wires)) pg.polyline(wr.points, 0.25);
  pg.fillColor(WIRE);
  for (const j of schematicNetlist(p).junctions) pg.circle(j, 0.55);
  // Символы.
  for (const s of Object.values(sch.symbols)) {
    const c = p.components[s.component];
    const def = symbolOf(p, s);
    if (!c || !def) continue;
    const T = (q: Vec2) => symToWorld(q, s.at, s.rotation, s.mirror);
    pg.strokeColor(BODY).fillColor(BODY);
    for (const g of def.gfx) {
      if (g.kind === 'line') pg.polyline([T(g.a), T(g.b)], 0.25);
      else if (g.kind === 'rect') {
        const pts = [g.a, { x: g.b.x, y: g.a.y }, g.b, { x: g.a.x, y: g.b.y }].map(T);
        pg.fillColor('#fff6d0').polygon(pts).fillColor(BODY);
        pg.polyline(pts, 0.25, true);
      } else if (g.kind === 'circle') {
        if (g.fill) pg.circle(T(g.c), g.r);
        else pg.circle(T(g.c), g.r, 'stroke', 0.25);
      } else if (g.kind === 'poly') {
        const pts = g.pts.map(T);
        if (g.fill) pg.polygon(pts);
        pg.polyline(pts, 0.25, !!g.closed);
      } else txt(pg, g.text, T(g.at), g.size, 'center', BODY);
    }
    for (const pin of def.pins) {
      const a = T(pin.at);
      const b = T(pin.base);
      pg.strokeColor(BODY).polyline([a, b], 0.25);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const L = Math.hypot(dx, dy) || 1;
      if (pin.showNumber) txt(pg, pin.number, { x: (a.x + b.x) / 2 + (Math.abs(dy) > Math.abs(dx) ? 0.8 : 0), y: (a.y + b.y) / 2 - (Math.abs(dx) >= Math.abs(dy) ? 0.8 : 0) }, 1, 'center', BODY);
      if (pin.showName && pin.name) {
        const ux = dx / L;
        txt(pg, pin.name, { x: b.x + ux * 0.6, y: b.y + (dy / L) * 1.2 }, 1.2, Math.abs(ux) > 0.5 ? (ux > 0 ? 'left' : 'right') : 'center');
      }
    }
    const bb = symbolWorldBox(def, s);
    txt(pg, c.ref, { x: (bb.minX + bb.maxX) / 2, y: bb.minY - 1.4 }, 1.6, 'center', '#1c4f8b');
    if (c.value) txt(pg, c.value, { x: (bb.minX + bb.maxX) / 2, y: bb.maxY + 1.4 }, 1.4);
  }
  // Метки.
  for (const l of Object.values(sch.labels)) {
    const shp = labelShape(l);
    const col = l.kind === 'power' ? '#b3261e' : LABEL;
    pg.strokeColor(col);
    if (l.kind === 'power') {
      const r0 = (((l.rotation ?? 0) % 360) + 360) % 360;
      const d = r0 === 0 ? { x: 1, y: 0 } : r0 === 180 ? { x: -1, y: 0 } : r0 === 90 ? { x: 0, y: -1 } : { x: 0, y: 1 };
      const tip = { x: l.at.x + d.x * 1.6, y: l.at.y + d.y * 1.6 };
      pg.polyline([l.at, tip], 0.2).polyline([{ x: tip.x - d.y * 1.2, y: tip.y + d.x * 1.2 }, { x: tip.x + d.y * 1.2, y: tip.y - d.x * 1.2 }], 0.2);
    } else {
      const b = shp.box;
      pg.polyline([{ x: b.minX, y: b.minY }, { x: b.maxX, y: b.minY }, { x: b.maxX, y: b.maxY }, { x: b.minX, y: b.maxY }], 0.18, true);
    }
    txt(pg, l.text, shp.textAt, 1.4, 'center', col);
  }
  pg.restore();
  return { bytes: doc.toBytes(), paper };
}
