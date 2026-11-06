import { describe, expect, it } from 'vitest';
import { exportEasyedaPcb } from '../src/core/io/easyeda-pcb-export';
import { padCopperLayers } from '../src/core/model/placement';
import { getWorld } from '../src/core/model/world';
import type { Project } from '../src/core/model/types';
import { sampleBoard } from './helpers/sample-board';

/*
 * Плата для EasyEDA Standard: корпуса с площадками и цепями, дорожки, переходные, контур.
 * Сквозная площадка с медью с одной стороны (самодельная плата) — планарная площадка и отверстие.
 */

/** Образец, у которого выводы одной детали паяются только снизу (без металлизации). */
function board(): Project {
  const p = structuredClone(sampleBoard());
  const c = Object.values(p.components).find((x) => p.footprints[x.footprint].pads.some((q) => q.type === 'tht'))!;
  const fp = structuredClone(p.footprints[c.footprint]);
  fp.id = fp.id + '_bottom';
  for (const q of fp.pads) if (q.type === 'tht') q.layer = 'B.Cu';
  p.footprints[fp.id] = fp;
  c.footprint = fp.id;
  return p;
}

describe('плата в формате EasyEDA Standard', () => {
  it('корпуса, площадки, цепи, дорожки и переходные на месте', () => {
    const p = board();
    const j = JSON.parse(exportEasyedaPcb(p));
    expect(j.head.docType).toBe('3');
    const shapes: string[] = j.shape;
    const libs = shapes.filter((s) => s.startsWith('LIB~'));
    const w = getWorld(p);
    expect(libs.length).toBe(w.components.length);
    const sub = libs.flatMap((s) => s.split('#@$').slice(1));
    const pads = sub.filter((s) => s.startsWith('PAD~')).map((s) => s.split('~'));
    expect(pads.length).toBe(w.pads.filter((q) => q.pad.type !== 'npth').length);
    // Площадка: центр в единицах 10 mil от (4000, 3000), цепь — имя цепи проекта, слой — по меди.
    const at = (x: number, y: number) => pads.find((a) => Math.abs(+a[2] - (4000 + x / 0.254)) < 0.01 && Math.abs(+a[3] - (3000 + y / 0.254)) < 0.01);
    let oneSided = 0;
    for (const wp of w.pads.filter((q) => q.pad.type === 'tht' && q.net)) {
      const f = at(wp.center.x, wp.center.y)!;
      expect(f, `${wp.component.ref}.${wp.pad.number}`).toBeTruthy();
      expect(f[7]).toBe(p.nets[wp.net!].name);
      const layers = padCopperLayers(wp.pad, wp.component.side);
      if (layers.length === 1) {
        oneSided++;
        expect(f[6]).toBe(layers[0] === 'F.Cu' ? '1' : '2');
      } else expect(f[6]).toBe('11');
    }
    expect(oneSided).toBeGreaterThan(0);
    expect(sub.filter((s) => s.startsWith('HOLE~')).length).toBeGreaterThanOrEqual(oneSided);
    const tracks = shapes.filter((s) => /^TRACK~[^~]+~[12]~/.test(s));
    expect(tracks.length).toBe(Object.values(p.tracks).filter((t) => t.points.length >= 2).length);
    expect(shapes.filter((s) => s.startsWith('VIA~')).length).toBe(Object.keys(p.vias).length);
    expect(shapes.some((s) => s.startsWith('TRACK~') && s.split('~')[2] === '10')).toBe(true);
    // Разделители EasyEDA не попадают в поля.
    for (const s of shapes) for (const part of s.split('#@$')) expect(part.split('~').length, part.slice(0, 40)).toBeGreaterThan(4);
  });
});
