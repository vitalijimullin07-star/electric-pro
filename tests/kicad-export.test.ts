import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { parseProjectFile } from '../src/core/io/project-file';
import { exportKicadPcb } from '../src/core/io/kicad-export';
import { importKicadBoard } from '../src/core/io/kicad';
import { getWorld } from '../src/core/model/world';

describe('экспорт в KiCad', () => {
  const r = parseProjectFile(readFileSync('import/vacuum-s3.plata.json', 'utf8'));
  if (r.kind !== 'project') throw new Error('старый формат');
  const p = r.project;
  const text = exportKicadPcb(p, { extraFields: { A1: { LCSC: 'C2913198' } } });

  it('обратный импорт даёт те же детали, площадки и дорожки', () => {
    const back = importKicadBoard(text).project;
    const onBoard = Object.values(p.components).filter((c) => !c.offBoard);
    expect(Object.keys(back.components).length).toBe(onBoard.length);
    const segs = Object.values(p.tracks).reduce((s, t) => s + t.points.length - 1, 0);
    expect(Object.values(back.tracks).reduce((s, t) => s + t.points.length - 1, 0)).toBe(segs);
    expect(Object.keys(back.vias).length).toBe(Object.keys(p.vias).length);
    // Площадки на тех же местах и в тех же цепях.
    const key = (w: ReturnType<typeof getWorld>, netName: (id: string | null) => string) =>
      w.pads.map((q) => `${q.component.ref}.${q.pad.number}@${q.center.x.toFixed(2)},${q.center.y.toFixed(2)}:${netName(q.net)}`).sort();
    const a = key(getWorld(p), (id) => (id ? p.nets[id].name : ''));
    const b = key(getWorld(back), (id) => (id ? back.nets[id].name : ''));
    expect(b).toEqual(a);
  });

  it('деталь снизу и под углом', () => {
    const q = structuredClone(p);
    const c = Object.values(q.components).find((x) => x.ref === 'DD1')!;
    c.side = 'bottom';
    c.rotation = 30;
    const back = importKicadBoard(exportKicadPcb(q)).project;
    const pads = (w: ReturnType<typeof getWorld>) =>
      w.pads.filter((x) => x.component.ref === 'DD1').map((x) => `${x.pad.number}@${x.center.x.toFixed(3)},${x.center.y.toFixed(3)}:${x.layers.join('+')}`).sort();
    expect(pads(getWorld(back))).toEqual(pads(getWorld(q)));
  });

  it('свойства деталей и контур платы', () => {
    expect(text).toContain('(property "LCSC" "C2913198")');
    expect(text.match(/layer "Edge\.Cuts"/g)!.length).toBeGreaterThanOrEqual(4);
    expect(text.split('(').length).toBe(text.split(')').length);
  });
});
