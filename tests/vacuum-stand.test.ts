import { describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { buildVacuumStand, STAND_GROUPS, STAND_PINS, standEasyedaPart, standPinTable } from '../src/core/examples/vacuum-s3/stand';
import { MOD_PINS } from '../src/core/examples/vacuum-s3/mod';
import { exportKicadSch, kicadProjectFile } from '../src/core/io/kicad-sch-export';
import { exportKicadPcb } from '../src/core/io/kicad-export';
import { importKicadBoard } from '../src/core/io/kicad';
import { exportSchematicPdf } from '../src/core/io/sch-pdf';
import { serializeProject } from '../src/core/io/project-file';
import { exportBomCsv } from '../src/core/io/bom';
import { exportEasyedaSch } from '../src/core/io/easyeda-sch-export';

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
      writeFileSync('import/vacuum-stand.easyeda.json', exportEasyedaSch(p, { groups: STAND_GROUPS, part: (c) => standEasyedaPart(c, p) }));
    }
  });

  it('схема EasyEDA Standard: у каждого подключённого вывода — флаг цепи, имена флагов — цепи', () => {
    const j = JSON.parse(exportEasyedaSch(p, { groups: STAND_GROUPS, part: (c) => standEasyedaPart(c, p) }));
    expect(j.docType).toBe('5');
    const shapes: string[] = j.schematics[0].dataStr.shape;
    const flags = shapes.filter((x) => x.startsWith('F~part_netLabel_Bar'));
    const onBoard = Object.values(p.components).filter((c) => !c.offBoard);
    const connected = onBoard.reduce((k, c) => k + new Set(Object.keys(c.padNets)).size, 0);
    expect(flags.length).toBe(connected);
    // У каждой детали платы с выводами — корпус из библиотеки EasyEDA (номер LCSC и UUID корпуса).
    for (const c of onBoard) if (Object.keys(c.padNets).length) expect(standEasyedaPart(c, p), c.ref).toBeTruthy();
    expect(shapes.filter((x) => x.startsWith('LIB') && /Supplier Part`C\d+/.test(x)).length).toBe(onBoard.filter((c) => Object.keys(c.padNets).length).length);
    const names = new Set(Object.values(p.nets).map((n) => n.name));
    for (const f of flags) expect(names.has(f.split('^^')[2].split('~')[0])).toBe(true);
    // Конец каждого флага совпадает с концом вывода детали.
    const ends = new Set(shapes.filter((x) => x.startsWith('LIB')).flatMap((x) => x.split('#@$').filter((q) => q.startsWith('P~')).map((q) => q.split('~').slice(4, 6).join(','))));
    for (const f of flags) expect(ends.has(f.split('~').slice(2, 4).join(','))).toBe(true);
    const ids = shapes.join('#@$').match(/~gge[0-9a-z]+~/g)!;
    expect(new Set(ids).size).toBe(ids.length);
  });
});
