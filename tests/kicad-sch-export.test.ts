import { describe, expect, it } from 'vitest';
import { buildVacuumS3Smd, SMD_GROUPS } from '../src/core/examples/vacuum-s3/smd';
import { exportKicadSch } from '../src/core/io/kicad-sch-export';
import { exportKicadPcb } from '../src/core/io/kicad-export';
import { importKicadBoard } from '../src/core/io/kicad';
import { MOD_PINS } from '../src/core/examples/vacuum-s3/mod';

describe('схема KiCad и плата S3 SMD', () => {
  const p = buildVacuumS3Smd();
  const s = exportKicadSch(p, { groups: SMD_GROUPS });

  it('у каждого подключённого вывода — метка своей цепи', () => {
    const connected = Object.values(p.components).reduce((k, c) => k + new Set(Object.keys(c.padNets)).size, 0);
    expect(s.text.match(/\(label "/g)!.length).toBe(connected);
    expect(s.text.split('(').length).toBe(s.text.split(')').length);
    const uuids = s.text.match(/\(uuid [0-9a-f-]+\)/g)!;
    expect(new Set(uuids).size).toBe(uuids.length);
  });

  it('у каждой цепи не меньше двух выводов, выводы ESP32 — как у платы на модулях', () => {
    const count = new Map<string, number>();
    for (const c of Object.values(p.components)) for (const n of Object.values(c.padNets)) count.set(n, (count.get(n) ?? 0) + 1);
    for (const [id, k] of count) expect(k, p.nets[id].name).toBeGreaterThanOrEqual(2);
    const a1 = Object.values(p.components).find((c) => c.ref === 'A1')!;
    const fp = p.footprints[a1.footprint];
    for (const [pin, net] of Object.entries(MOD_PINS)) {
      const pad = fp.pads.find((q) => q.name === (pin === 'TX' ? 'TXD0' : pin))!;
      expect(p.nets[a1.padNets[pad.number]].name, pin).toBe(net);
    }
  });

  it('плата связана со схемой и читается обратно', () => {
    const pcb = exportKicadPcb(p, { paths: s.paths });
    expect(pcb).toContain(`(path "/${s.paths.A1}")`);
    expect(Object.keys(importKicadBoard(pcb).project.components).length).toBe(Object.keys(p.components).length);
  });
});
