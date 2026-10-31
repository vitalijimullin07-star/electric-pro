import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { strToU8, zipSync } from 'fflate';
import { addSilkValues, BUS, BUS_DOORS, buildLutFloor, busTaps, FLOOR_PARTS, LUT_BOARD, routeLutFloor, type LutFloor } from '../src/core/examples/vacuum-s3/lut5';
import { buildStackBoard, logicalNet } from '../src/core/examples/vacuum-s3/stack';
import { exportGerbers, safeName } from '../src/core/io/gerber';
import { exportLutPdf } from '../src/core/io/lut-pdf';
import { parseProjectFile, serializeProject } from '../src/core/io/project-file';
import { exportAssemblySvg } from '../src/core/io/svg-export';
import { exportBomCsv } from '../src/core/io/bom';
import { runDrc } from '../src/core/model/drc';
import { lutGuideHtml } from '../src/core/examples/vacuum-s3/lut5-notes';
import type { LayerId, Project } from '../src/core/model/types';

/*
 * Этажерка пылесоса S3 из четырёх плат под ЛУТ с масками (lut5.ts). Разведённые платы —
 * import/vacuum-s3-lut-f1…f4.plata.json, архив для мастера (Gerber и PDF) — import/vacuum-s3-lut.zip.
 * Пересоздать: LUT_WRITE=1 npx vitest run tests/vacuum-s3-lut.test.ts (разводка — несколько минут
 * на плату); только архив из записанных плат — LUT_PACK=1.
 */

const FLOORS: LutFloor[] = [1, 2, 3, 4];
const file = (f: LutFloor) => `import/vacuum-s3-lut-f${f}.plata.json`;
const ZIP = 'import/vacuum-s3-lut.zip';
const WRITE = process.env.LUT_WRITE === '1';
const PACK = WRITE || process.env.LUT_PACK === '1';

const errors = (p: Project, routed: boolean) => runDrc(p).markers.filter((m) => m.severity === 'error' && (routed || m.code !== 'unrouted'));

function load(f: LutFloor): Project {
  const r = parseProjectFile(readFileSync(file(f), 'utf8'));
  if (r.kind !== 'project') throw new Error('не проект');
  return r.project;
}

/** Логические цепи деталей (без разъёмов между платами и крепежа). */
function netsOf(p: Project, skip: RegExp): Set<string> {
  const s = new Set<string>();
  for (const c of Object.values(p.components)) {
    if (skip.test(c.ref)) continue;
    for (const id of Object.values(c.padNets)) s.add(logicalNet(p.nets[id].name));
  }
  return s;
}

describe('пылесос S3 этажеркой под ЛУТ (4 платы)', () => {
  it('платы собираются без нарушений зазоров', () => {
    for (const f of FLOORS) expect(errors(buildLutFloor(f), false).map((m) => m.message), `этаж ${f}`).toEqual([]);
  });

  it('схема та же, что у прежней этажерки', () => {
    const old = new Set<string>();
    for (const b of ['upper', 'lower', 'panel'] as const) for (const n of netsOf(buildStackBoard(b), /^(PT\d|J[2-4]|XS1)$/)) old.add(n);
    const now = new Set<string>();
    for (const f of FLOORS) for (const n of netsOf(buildLutFloor(f), /^XB/)) now.add(n);
    // Делитель ZMPT теперь у клеммника (UAC_IN — там же), подтяжки второй шины — у её клеммника.
    expect([...now].sort()).toEqual([...old].sort());
  });

  it('шина: у цепи на нескольких этажах есть провод, и каждый такой этаж к нему подключён', () => {
    const taps = busTaps();
    const used = new Map<string, Set<LutFloor>>();
    for (const f of FLOORS) for (const part of FLOOR_PARTS[f]()) for (const n of Object.values(part.pins)) used.set(n, new Set([...(used.get(n) ?? []), f]));
    for (const [net, floors] of used) {
      if (floors.size < 2) continue;
      const lines = [...taps.entries()].filter(([id]) => BUS[id[0] as 'L' | 'R'][Number(id.slice(1))] === net);
      expect(lines.length, net).toBeGreaterThan(0);
      const reached = new Set<LutFloor>();
      for (const [, t] of lines) for (const f of t) reached.add(f);
      for (const f of floors) expect(reached.has(f), `${net} на этаже ${f}`).toBe(true);
    }
    // Двери — свободные выводы ESP32.
    const esp = buildLutFloor(2);
    const a1 = Object.values(esp.components).find((c) => c.ref === 'A1')!;
    const fp = esp.footprints[a1.footprint];
    for (const side of ['L', 'R'] as const)
      for (let c = 1; c <= 22; c++) {
        const pad = fp.pads.find((q) => q.number === String(side === 'L' ? c : 22 + c))!;
        const id = a1.padNets[pad.number];
        const net = id ? esp.nets[id].name : null;
        if (BUS_DOORS.has(`${side}${c}`)) expect(net, `${side}${c}`).toBeNull();
        else if (BUS[side][c]) expect(net, `${side}${c}`).toBe(BUS[side][c]);
      }
  });

  it.runIf(WRITE)(
    'развести и записать платы',
    async () => {
      // LUT_FLOORS=24 — развести только эти этажи (остальные — из записанных файлов).
      for (const f of FLOORS.filter((x) => (process.env.LUT_FLOORS ?? '1234').includes(String(x)))) {
        const r = await routeLutFloor(f);
        expect(r.failed, `этаж ${f}: ${r.report.join('; ')}`).toBe(0);
        writeFileSync(file(f), serializeProject(r.project, true));
      }
    },
    3600000,
  );

  it.runIf(FLOORS.every((f) => existsSync(file(f))))('записанные платы разведены без ошибок', () => {
    for (const f of FLOORS) {
      const p = load(f);
      expect(Math.max(...p.board.outline.map((q) => q.x))).toBeCloseTo(LUT_BOARD.w, 1);
      expect(errors(p, true).map((m) => m.message), `этаж ${f}`).toEqual([]);
    }
  });

  it.runIf(PACK)('архив для мастера: Gerber и PDF', () => {
    const files: Record<string, Uint8Array> = {};
    for (const f of FLOORS) {
      const p = addSilkValues(load(f));
      const dir = `etazh-${f}`;
      const base = safeName(p.meta.name);
      for (const g of exportGerbers(p)) files[`${dir}/gerber/${g.name}`] = strToU8(g.content);
      // ЛУТ: верх зеркально (рисунок кладут лицом к меди), низ — как есть; маски — так же.
      const sheets = (mirror: boolean) => (['B.Cu', 'F.Cu', 'B.Mask', 'F.Mask', 'F.Silk', 'B.Silk'] as LayerId[]).map((layer) => ({ layer, mirror: mirror && layer.startsWith('F.') }));
      files[`${dir}/${base}-LUT-zerkalno.pdf`] = exportLutPdf(p, { sheets: sheets(true) }).bytes;
      files[`${dir}/${base}-vid-sverhu.pdf`] = exportLutPdf(p, { sheets: sheets(false) }).bytes;
      files[`${dir}/${base}-sborka.svg`] = strToU8(exportAssemblySvg(p, 'top'));
      files[`${dir}/${base}-perechen.csv`] = strToU8(exportBomCsv(p));
      files[`${dir}/${base}.plata.json`] = strToU8(serializeProject(p, true));
    }
    // Памятка: HTML в архиве; PDF из неё печатает tools/lut5/build.sh (LUT_HTML — куда положить HTML).
    const html = lutGuideHtml({ 1: load(1), 2: load(2), 3: load(3), 4: load(4) });
    files['pamyatka.html'] = strToU8(html);
    if (process.env.LUT_HTML) writeFileSync(process.env.LUT_HTML, html);
    writeFileSync(ZIP, zipSync(files, { level: 6 }));
  });
});
