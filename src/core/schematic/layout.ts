import type { Vec2 } from '../math/vec';
import type { SchSymbol } from '../model/types';
import { symToWorld, type SymbolDef } from './symbols';

/* Геометрия элементов схемы: габарит символа на листе и форма метки цепи. */

export function symbolWorldBox(def: SymbolDef, s: Pick<SchSymbol, 'at' | 'rotation' | 'mirror'>): { minX: number; minY: number; maxX: number; maxY: number } {
  const c = [def.box.min, { x: def.box.max.x, y: def.box.min.y }, def.box.max, { x: def.box.min.x, y: def.box.max.y }].map((q) => symToWorld(q, s.at, s.rotation, s.mirror));
  return { minX: Math.min(...c.map((q) => q.x)), minY: Math.min(...c.map((q) => q.y)), maxX: Math.max(...c.map((q) => q.x)), maxY: Math.max(...c.map((q) => q.y)) };
}

/** Метка цепи: флажок с текстом (или значок питания). */
export function labelShape(l: { at: Vec2; text: string; rotation?: number; kind?: 'net' | 'power' }): { box: { minX: number; minY: number; maxX: number; maxY: number }; textAt: Vec2; align: 'left' | 'center' | 'right' } {
  const w = Math.max(2, l.text.length * 1.08 + 1.2);
  const h = 1.9;
  const r = ((l.rotation ?? 0) % 360 + 360) % 360;
  const d = r === 0 ? { x: 1, y: 0 } : r === 180 ? { x: -1, y: 0 } : r === 90 ? { x: 0, y: -1 } : { x: 0, y: 1 };
  if (l.kind === 'power') {
    const tip = { x: l.at.x + d.x * 1.6, y: l.at.y + d.y * 1.6 };
    const textAt = { x: tip.x + d.x * (Math.abs(d.x) ? w / 2 + 0.4 : 0), y: tip.y + d.y * 1.6 };
    return { box: { minX: Math.min(l.at.x, textAt.x - w / 2), minY: Math.min(l.at.y, textAt.y - h / 2), maxX: Math.max(l.at.x, textAt.x + w / 2), maxY: Math.max(l.at.y, textAt.y + h / 2) }, textAt, align: 'center' };
  }
  const x0 = d.x < 0 ? l.at.x - w : d.x > 0 ? l.at.x : l.at.x - w / 2;
  const y0 = d.y < 0 ? l.at.y - h - 0.4 : d.y > 0 ? l.at.y + 0.4 : l.at.y - h / 2;
  return { box: { minX: x0, minY: y0, maxX: x0 + w, maxY: y0 + h }, textAt: { x: x0 + w / 2, y: y0 + h / 2 }, align: 'center' };
}

