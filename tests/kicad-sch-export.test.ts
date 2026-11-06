import { describe, expect, it } from 'vitest';
import { exportKicadSch } from '../src/core/io/kicad-sch-export';
import { exportKicadPcb } from '../src/core/io/kicad-export';
import { importKicadBoard } from '../src/core/io/kicad';
import { sampleBoard } from './helpers/sample-board';

describe('схема KiCad из платы', () => {
  const p = sampleBoard();
  const s = exportKicadSch(p);

  it('у каждого подключённого вывода — метка своей цепи', () => {
    const connected = Object.values(p.components).filter((c) => !c.offBoard).reduce((k, c) => k + new Set(Object.keys(c.padNets)).size, 0);
    expect(s.text.match(/\(label "/g)!.length).toBe(connected);
    expect(s.text.split('(').length).toBe(s.text.split(')').length);
    const uuids = s.text.match(/\(uuid [0-9a-f-]+\)/g)!;
    expect(new Set(uuids).size).toBe(uuids.length);
  });

  it('плата связана со схемой и читается обратно', () => {
    const pcb = exportKicadPcb(p, { paths: s.paths });
    const first = Object.values(p.components)[0];
    expect(pcb).toContain(`(path "/${s.paths[first.ref]}")`);
    expect(Object.keys(importKicadBoard(pcb).project.components).length).toBe(Object.values(p.components).filter((c) => !c.offBoard).length);
  });
});
