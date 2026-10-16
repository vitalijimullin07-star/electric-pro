import { describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { buildVacuumStand, STAND_GROUPS, STAND_PINS, standPinTable } from '../src/core/examples/vacuum-s3/stand';
import { MOD_PINS } from '../src/core/examples/vacuum-s3/mod';
import { exportKicadSch, kicadProjectFile } from '../src/core/io/kicad-sch-export';
import { exportKicadPcb } from '../src/core/io/kicad-export';
import { importKicadBoard } from '../src/core/io/kicad';
import { exportSchematicPdf } from '../src/core/io/sch-pdf';
import { serializeProject } from '../src/core/io/project-file';
import { exportBomCsv } from '../src/core/io/bom';

describe('стенд турбины и ударов', () => {
  const p = buildVacuumStand();
  const s = exportKicadSch(p, { offBoard: true, groups: STAND_GROUPS });

  it('у каждой цепи не меньше двух выводов (с выносными), выводы ESP32 — как задано', () => {
    const count = new Map<string, number>();
    for (const c of Object.values(p.components)) for (const n of new Set(Object.values(c.padNets))) count.set(n, (count.get(n) ?? 0) + 1);
    for (const [id, k] of count) expect(k, p.nets[id].name).toBeGreaterThanOrEqual(2);
    const a1 = Object.values(p.components).find((c) => c.ref === 'A1')!;
    const fp = p.footprints[a1.footprint];
    for (const [pin, net] of Object.entries(STAND_PINS)) {
      const pad = fp.pads.find((q) => q.name === pin)!;
      expect(p.nets[a1.padNets[pad.number]].name, pin).toBe(net);
    }
    // Где задача та же, что на плате пылесоса, — тот же вывод.
    for (const pin of ['IO4', 'IO5', 'IO10', 'IO11', 'IO12', 'IO15', 'IO16', 'IO17', 'IO18', 'TX', 'IO0', 'IO48', 'IO39', 'IO38', 'IO40', 'IO41']) expect(STAND_PINS[pin], pin).toBe(MOD_PINS[pin]);
    expect(standPinTable().length).toBe(Object.keys(STAND_PINS).length);
  });

  it('схема KiCad: метки у всех выводов, плата связана и читается обратно', () => {
    expect(s.text.split('(').length).toBe(s.text.split(')').length);
    const pcb = exportKicadPcb(p, { paths: s.paths });
    const onBoard = Object.values(p.components).filter((c) => !c.offBoard).length;
    expect(Object.keys(importKicadBoard(pcb).project.components).length).toBe(onBoard);
    if (process.env.STAND_WRITE) {
      writeFileSync('import/vacuum-stand.kicad_sch', s.text);
      writeFileSync('import/vacuum-stand.kicad_pcb', pcb);
      writeFileSync('import/vacuum-stand.kicad_pro', kicadProjectFile('vacuum-stand', s.uuid));
      writeFileSync('import/vacuum-stand.plata.json', serializeProject(p, false));
      writeFileSync('import/vacuum-stand-perechen.csv', exportBomCsv(p));
      writeFileSync('import/vacuum-stand-vyvody.txt', ['Стенд S3: выводы ESP32-S3-DevKitC-1 N16R8', '', ...standPinTable(), ''].join('\n'));
      const pdf = exportSchematicPdf(p);
      if (pdf) writeFileSync('import/vacuum-stand-shema.pdf', pdf.bytes);
    }
  });
});
