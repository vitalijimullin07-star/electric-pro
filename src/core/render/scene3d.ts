import { boxOfPoints } from '../math/geom';
import { triangulate } from '../math/triangulate';
import type { Vec2 } from '../math/vec';
import { boardPolygon } from '../model/project';
import { placementOf, toWorld } from '../model/placement';
import type { FootprintDef, Project } from '../model/types';
import { getWorld } from '../model/world';

/*
 * Сцена для 3D-вида: плата (верх и низ с текстурой, торцы) и тела деталей —
 * параллелепипеды или цилиндры по габаритам корпуса и типовой высоте.
 * Мир: X — вправо, Y — вверх экрана (−y платы), Z — от платы к смотрящему сверху.
 */

export interface Mesh {
  positions: number[];
  normals: number[];
  uvs?: number[];
  indices: number[];
  color: [number, number, number];
  /** Текстура верхней или нижней стороны платы. */
  texture?: 'top' | 'bottom';
}

export interface Scene3D {
  meshes: Mesh[];
  /** Габарит платы (мм) — для текстур и камеры. */
  box: { minX: number; minY: number; maxX: number; maxY: number };
  thickness: number;
}

const hex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];

interface Body {
  h: number;
  color: string;
  shape: 'box' | 'cyl';
  /** Приподнято над платой (выводные на ножках). */
  lift?: number;
}

/** Типовая высота и вид корпуса по разделу библиотеки и имени (если высота не задана). */
export function bodyOf(fp: FootprintDef): Body {
  const id = `${fp.id} ${fp.name} ${fp.group ?? ''}`.toLowerCase();
  const tht = fp.pads.some((p) => p.type === 'tht');
  const h = fp.height;
  const cat = fp.category;
  if (/cp_radial|электролит|elko|radial/.test(id) && cat === 'Конденсаторы') return { h: h ?? 11, color: '#1f3b73', shape: 'cyl' };
  if (cat === 'Конденсаторы') return { h: h ?? (tht ? 5 : 0.9), color: tht ? '#c9a227' : '#b8875a', shape: 'box' };
  if (cat === 'Резисторы') return tht ? { h: h ?? 2.5, color: '#d8c49a', shape: 'box', lift: 0.3 } : { h: h ?? 0.5, color: '#202020', shape: 'box' };
  if (cat === 'Индуктивности') return { h: h ?? (tht ? 8 : 3), color: '#3a3a3a', shape: 'box' };
  if (cat === 'Светодиоды') return { h: h ?? (tht ? 8.6 : 0.8), color: '#d23c3c', shape: tht ? 'cyl' : 'box' };
  if (cat === 'Диоды') return { h: h ?? (tht ? 2.6 : 1.2), color: '#262626', shape: 'box' };
  if (cat === 'Транзисторы') return { h: h ?? (/to-220|to220/.test(id) ? 15 : /to-92|to92/.test(id) ? 5 : tht ? 4.5 : 1.1), color: '#1e1e1e', shape: 'box' };
  if (cat === 'Микросхемы') return { h: h ?? (/dip/.test(id) ? 3.3 : /qfn|dfn/.test(id) ? 0.9 : 1.6), color: '#161616', shape: 'box', lift: /dip/.test(id) ? 0.5 : 0 };
  if (cat === 'Разъёмы') return { h: h ?? (/usb/.test(id) ? 3.3 : /header|штыр|pin/.test(id) ? 8.5 : 7), color: /usb/.test(id) ? '#b8b8b8' : '#202020', shape: 'box' };
  if (cat === 'Кнопки и переключатели') return { h: h ?? 5, color: '#303030', shape: 'box' };
  if (cat === 'Дисплеи и индикаторы') return { h: h ?? 6, color: '#101820', shape: 'box' };
  if (cat === 'Кварцы и резонаторы') return { h: h ?? (tht ? 3.5 : 0.9), color: '#c0c0c0', shape: 'box' };
  if (cat === 'Реле') return { h: h ?? 15.5, color: '#1f4fa0', shape: 'box' };
  if (cat === 'Модули') return { h: h ?? 9, color: '#18407a', shape: 'box', lift: 2.5 };
  if (cat === 'Питание') return { h: h ?? 16, color: '#1b1b1b', shape: 'box' };
  if (cat === 'Предохранители и защита') return { h: h ?? 8, color: '#8a2a2a', shape: 'box' };
  if (cat === 'Крепёж и технологическое') return { h: 0, color: '#888888', shape: 'box' };
  return { h: h ?? (tht ? 5 : 1.5), color: '#2a2a2a', shape: 'box' };
}

/** Габарит тела корпуса: прямоугольник сборочного слоя, иначе габарит установки. */
function bodyRect(fp: FootprintDef): { min: Vec2; max: Vec2 } {
  const fab: Vec2[] = [];
  for (const g of fp.graphics) {
    if (g.layer !== 'F.Fab') continue;
    if (g.kind === 'rect' || g.kind === 'line') fab.push(g.a, g.b);
    else if (g.kind === 'circle') fab.push({ x: g.c.x - g.r, y: g.c.y - g.r }, { x: g.c.x + g.r, y: g.c.y + g.r });
    else if (g.kind === 'poly') fab.push(...g.pts);
  }
  if (fab.length >= 2) {
    const b = boxOfPoints(fab);
    if (b.maxX - b.minX > 0.2 && b.maxY - b.minY > 0.2) return { min: { x: b.minX, y: b.minY }, max: { x: b.maxX, y: b.maxY } };
  }
  if (fp.courtyard) return { min: { x: fp.courtyard.min.x + 0.25, y: fp.courtyard.min.y + 0.25 }, max: { x: fp.courtyard.max.x - 0.25, y: fp.courtyard.max.y - 0.25 } };
  const b = boxOfPoints(fp.pads.map((p) => p.at), 0.5);
  return { min: { x: b.minX, y: b.minY }, max: { x: b.maxX, y: b.maxY } };
}

class Builder {
  positions: number[] = [];
  normals: number[] = [];
  indices: number[] = [];
  quad(a: number[], b: number[], c: number[], d: number[], n: number[]): void {
    const i = this.positions.length / 3;
    this.positions.push(...a, ...b, ...c, ...d);
    for (let k = 0; k < 4; k++) this.normals.push(...n);
    this.indices.push(i, i + 1, i + 2, i, i + 2, i + 3);
  }
  mesh(color: string): Mesh {
    return { positions: this.positions, normals: this.normals, indices: this.indices, color: hex(color) };
  }
}

/** Мировая точка из точки платы: X = x, Y = −y. */
const W = (q: Vec2, z: number): number[] => [q.x, -q.y, z];

function prism(poly: Vec2[], z0: number, z1: number, color: string): Mesh {
  const b = new Builder();
  const tri = triangulate(poly);
  const top = new Builder();
  // Крышки: верх (нормаль +Z) и низ (−Z).
  const base = 0;
  for (const q of poly) {
    top.positions.push(...W(q, z1));
    top.normals.push(0, 0, 1);
  }
  for (const q of poly) {
    top.positions.push(...W(q, z0));
    top.normals.push(0, 0, -1);
  }
  const n = poly.length;
  for (let i = 0; i < tri.length; i += 3) {
    top.indices.push(base + tri[i], base + tri[i + 1], base + tri[i + 2]);
    top.indices.push(n + tri[i], n + tri[i + 2], n + tri[i + 1]);
  }
  // Бока.
  for (let i = 0; i < n; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % n];
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const L = Math.hypot(dx, dy) || 1;
    b.quad(W(p, z0), W(q, z0), W(q, z1), W(p, z1), [dy / L, dx / L, 0]);
  }
  const off = top.positions.length / 3;
  return {
    positions: [...top.positions, ...b.positions],
    normals: [...top.normals, ...b.normals],
    indices: [...top.indices, ...b.indices.map((i) => i + off)],
    color: hex(color),
  };
}

function cylinder(c: Vec2, r: number, z0: number, z1: number, color: string, seg = 24): Mesh {
  const pts: Vec2[] = Array.from({ length: seg }, (_, k) => ({ x: c.x + r * Math.cos((2 * Math.PI * k) / seg), y: c.y + r * Math.sin((2 * Math.PI * k) / seg) }));
  return prism(pts, z0, z1, color);
}

export function buildScene3D(p: Project): Scene3D {
  const outline = boardPolygon(p.board);
  const bb = boxOfPoints(outline);
  const t = p.board.thickness || 1.6;
  const meshes: Mesh[] = [];
  // Плата: верх и низ с текстурами, торцы цветом стеклотекстолита.
  const tri = triangulate(outline);
  const face = (z: number, nz: number, tex: 'top' | 'bottom'): Mesh => {
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    for (const q of outline) {
      positions.push(...W(q, z));
      normals.push(0, 0, nz);
      uvs.push((q.x - bb.minX) / (bb.maxX - bb.minX), (q.y - bb.minY) / (bb.maxY - bb.minY));
    }
    const indices: number[] = [];
    for (let i = 0; i < tri.length; i += 3) indices.push(...(nz > 0 ? [tri[i], tri[i + 1], tri[i + 2]] : [tri[i], tri[i + 2], tri[i + 1]]));
    return { positions, normals, uvs, indices, color: [1, 1, 1], texture: tex };
  };
  // Отсечение нелицевых граней в 3D-виде выключено, освещение двустороннее — порядок вершин не важен.
  meshes.push(face(t, 1, 'top'), face(0, -1, 'bottom'));
  const edge = new Builder();
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const L = Math.hypot(dx, dy) || 1;
    edge.quad(W(a, 0), W(b, 0), W(b, t), W(a, t), [dy / L, dx / L, 0]);
  }
  meshes.push(edge.mesh('#c8c29a'));

  // Детали.
  const w = getWorld(p);
  for (const wc of w.components) {
    const fp = wc.footprint;
    if (!fp) continue;
    const body = bodyOf(fp);
    if (body.h <= 0) continue;
    const r = bodyRect(fp);
    const pl = placementOf(wc.component);
    const top = wc.component.side === 'top';
    const lift = body.lift ?? 0;
    const z0 = top ? t + lift : -lift;
    const z1 = top ? t + lift + body.h : -lift - body.h;
    const lo = Math.min(z0, z1);
    const hi = Math.max(z0, z1);
    if (body.shape === 'cyl') {
      const c = toWorld(pl, { x: (r.min.x + r.max.x) / 2, y: (r.min.y + r.max.y) / 2 });
      const rad = Math.min(r.max.x - r.min.x, r.max.y - r.min.y) / 2;
      meshes.push(cylinder(c, rad, lo, hi, body.color));
      // Светлая крышка электролита.
      if (fp.category === 'Конденсаторы') meshes.push(cylinder(c, rad * 0.92, top ? hi : lo - 0.05, top ? hi + 0.05 : lo, '#c9ced6'));
    } else {
      const corners = [r.min, { x: r.max.x, y: r.min.y }, r.max, { x: r.min.x, y: r.max.y }].map((q) => toWorld(pl, q));
      meshes.push(prism(corners, lo, hi, body.color));
      // Метка первого вывода у микросхем.
      if (fp.category === 'Микросхемы' && body.h > 0.5) {
        const p1 = fp.pads.find((x) => x.number === '1');
        if (p1) {
          const inx = Math.max(r.min.x + 0.6, Math.min(r.max.x - 0.6, p1.at.x));
          const iny = Math.max(r.min.y + 0.6, Math.min(r.max.y - 0.6, p1.at.y));
          meshes.push(cylinder(toWorld(pl, { x: inx, y: iny }), 0.35, top ? hi : lo - 0.02, top ? hi + 0.02 : lo, '#8a8a8a', 12));
        }
      }
    }
  }
  return { meshes, box: bb, thickness: t };
}
