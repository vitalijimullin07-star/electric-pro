import { describe, expect, test } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { boardSize, sampleBoard } from './helpers/sample-board';
import { exportGerbers } from '../src/core/io/gerber';
import { exportCopperSvg, exportAssemblySvg } from '../src/core/io/svg-export';
import { bomRows, exportBomCsv, exportNetlistText, exportPickPlaceCsv } from '../src/core/io/bom';
import { parseProjectFile, serializeProject } from '../src/core/io/project-file';
import { fabricationZip, homemadeZip } from '../src/core/io/package';
import { textStrokes, unsupportedChars } from '../src/core/render/stroke-font';
import { computeConnectivity } from '../src/core/model/connectivity';
import { runDrc } from '../src/core/model/drc';

const p = sampleBoard();
const size = boardSize(p);

describe('экспорт', () => {
  test('Gerber: слои и сверловка, правильные заголовки, координаты в пределах платы', () => {
    const files = exportGerbers(p);
    const names = files.map((f) => f.name);
    expect(names.some((n) => n.endsWith('B_Cu.gbl'))).toBe(true);
    expect(names.some((n) => n.endsWith('F_Silk.gto'))).toBe(true);
    expect(names.some((n) => n.endsWith('Edge_Cuts.gko'))).toBe(true);
    expect(names.some((n) => n.endsWith('PTH.drl'))).toBe(true);
    expect(names.some((n) => n.endsWith('NPTH.drl'))).toBe(true);
    const cu = files.find((f) => f.layer === 'B.Cu')!.content;
    expect(cu).toMatch(/%FSLAX46Y46\*%/);
    expect(cu).toMatch(/%MOMM\*%/);
    expect(cu).toMatch(/%TF.FileFunction,Copper,L2,Bot\*%/);
    expect(cu.trim().endsWith('M02*')).toBe(true);
    expect(cu.match(/D03\*/g)!.length + cu.match(/G36\*/g)!.length).toBeGreaterThan(200);
    expect(cu.match(/D01\*/g)!.length).toBeGreaterThan(200);
    const coords = [...cu.matchAll(/X(-?\d+)Y(-?\d+)D0[123]\*/g)].map((m) => [+m[1] / 1e6, +m[2] / 1e6]);
    for (const [x, y] of coords) {
      expect(x).toBeGreaterThanOrEqual(-0.01);
      expect(x).toBeLessThanOrEqual(size.w + 0.1);
      expect(y).toBeGreaterThanOrEqual(-0.01);
      expect(y).toBeLessThanOrEqual(size.h + 0.1);
    }
    const drl = files.find((f) => f.layer === 'PTH')!.content;
    expect(drl).toMatch(/^M48/);
    expect(drl).toMatch(/METRIC/);
    expect(drl.match(/^X[\d.-]+Y[\d.-]+$/gm)!.length).toBeGreaterThan(150);
    expect(drl.trim().endsWith('M30')).toBe(true);
  });

  test('SVG меди и сборочный вид', () => {
    const svg = exportCopperSvg(p, 'B.Cu');
    expect(svg).toMatch(new RegExp(`^<svg[^>]+width="${size.w}mm"`));
    expect(svg.match(/<circle/g)!.length).toBeGreaterThan(100);
    const asm = exportAssemblySvg(p);
    expect(asm).toContain('<path');
    expect(asm.length).toBeGreaterThan(20000);
  });

  test('перечень элементов и расстановка', () => {
    const rows = bomRows(p);
    const parts = Object.values(p.components).filter((c) => !/^H\d+$/.test(c.ref));
    expect(rows.reduce((k, r) => k + r.qty, 0)).toBe(parts.length);
    expect(rows.some((r) => r.refs.includes('H1'))).toBe(false);
    const csv = exportBomCsv(p);
    expect(csv.startsWith('﻿№;Позиции;Кол-во')).toBe(true);
    expect(exportPickPlaceCsv(p)).toContain('U2;');
    expect(exportNetlistText(p)).toContain('GND');
  });

  test('файл проекта: сохранить и открыть без потерь', () => {
    const text = serializeProject(p);
    const r = parseProjectFile(text);
    expect(r.kind).toBe('project');
    if (r.kind !== 'project') return;
    expect(JSON.stringify(r.project)).toBe(JSON.stringify(p));
    expect(computeConnectivity(r.project).unrouted).toBe(0);
    expect(runDrc(r.project).errors).toBe(0);
  });

  test('старый файл проекта распознаётся', () => {
    const r = parseProjectFile(JSON.stringify({ bw: 820, bh: 540, comps: {}, traces: [], nid: 1 }));
    expect(r.kind).toBe('legacy');
    expect(() => parseProjectFile('{"a":1}')).toThrow();
    expect(() => parseProjectFile('не json')).toThrow();
  });

  test('архивы для завода и для дома', () => {
    const z = fabricationZip(p);
    const files = unzipSync(z.data);
    const names = Object.keys(files);
    expect(names.some((n) => n.endsWith('.gbl'))).toBe(true);
    expect(names.some((n) => n.endsWith('BOM.csv'))).toBe(true);
    const h = homemadeZip(p);
    const hf = unzipSync(h.data);
    const proj = Object.keys(hf).find((n) => n.endsWith('.plata.json'))!;
    expect(parseProjectFile(strFromU8(hf[proj])).kind).toBe('project');
  });

  test('штриховой шрифт: латиница, цифры, кириллица', () => {
    expect(unsupportedChars('R12 C3 U1 ЗОНА 230 В +5V µF Ω 0,5А')).toEqual([]);
    const s = textStrokes({ text: 'R1', at: { x: 10, y: 10 }, size: 1 });
    expect(s.length).toBeGreaterThan(2);
    for (const stroke of s) for (const q of stroke) {
      expect(Math.abs(q.x - 10)).toBeLessThan(1.2);
      expect(Math.abs(q.y - 10)).toBeLessThan(0.8);
    }
  });
});

describe('имена файлов', () => {
  test('латиница без пробелов, кириллица транслитерируется', async () => {
    const { safeName } = await import('../src/core/io/gerber');
    expect(safeName('Плата контроллера')).toBe('Plata_kontrollera');
    expect(safeName('  ESP32 — блок №2 (v1.0) ')).toBe('ESP32_blok_No2_v1_0');
    expect(safeName('Щёткин Ёж')).toBe('Schetkin_Ezh');
    expect(safeName('***')).toBe('plata');
  });
});
