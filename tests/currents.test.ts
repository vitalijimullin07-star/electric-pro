import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseProjectFile } from '../src/core/io/project-file';
import { componentPinCurrents, netCurrents, netWidth, parseAmps, widthForCurrent } from '../src/core/model/currents';
import { applyFit, fitTrackWidths, fitTrackWidthsSafe } from '../src/core/model/track-fit';
import { addComponent, addTrack, connectPad, ensureNet } from '../src/core/model/edit';
import { createProject } from '../src/core/model/project';
import { libraryFootprint } from '../src/core/library';
import { computeConnectivity } from '../src/core/model/connectivity';
import { runDrc } from '../src/core/model/drc';
import { defaultSearchOptions, planVariant, runVariant } from '../src/core/router/variants';
import type { Project } from '../src/core/model/types';

/*
 * Ширина дорожек по токам: оценка токов по деталям, формула IPC-2221, подгонка ширины
 * (расширение, где хватает зазора, и сужение у чужой меди), замечания проверки правил.
 */

function file(name: string): Project {
  const r = parseProjectFile(readFileSync(name, 'utf8'));
  if (r.kind !== 'project') throw new Error('не проект');
  return r.project;
}
const byName = (p: Project, name: string) => Object.values(p.nets).find((n) => n.name === name)!.id;
/** Ошибки проверки правил, кроме неразведённых цепей (на пробных платах резисторы нарочно не соединены). */
const errors = (p: Project) => runDrc(structuredClone(p)).markers.filter((m) => m.severity === 'error' && m.code !== 'unrouted').map((m) => m.message);

describe('ток и ширина', () => {
  test('IPC-2221, наружный слой, 35 мкм, нагрев 10 °C', () => {
    expect(widthForCurrent(0)).toBe(0);
    expect(widthForCurrent(1)).toBeCloseTo(0.35, 5);
    expect(widthForCurrent(2)).toBeCloseTo(0.8, 5);
    expect(widthForCurrent(3)).toBeCloseTo(1.4, 5);
    expect(widthForCurrent(5)).toBeCloseTo(2.8, 5);
    // Толще медь или больше допустимый нагрев — уже дорожка.
    expect(widthForCurrent(3, { copperThickness: 70 })).toBeLessThan(0.8);
    expect(widthForCurrent(3, { tempRise: 30 })).toBeLessThan(0.8);
  });

  test('токи из названий', () => {
    expect(parseAmps('T1A')).toBe(1);
    expect(parseAmps('0,5А')).toBe(0.5);
    expect(parseAmps('500 мА')).toBe(0.5);
    expect(parseAmps('230/9 В 10 ВА')).toBeNull();
    expect(parseAmps('BTA41-600B')).toBeNull();
  });

  test('плата пылесоса ESP32: токи по стабилизаторам, модулям, предохранителю, трансформатору', () => {
    const p = file('import/vacuum-esp32.plata.json');
    const cur = netCurrents(p);
    const I = (name: string) => cur.get(byName(p, name))?.current ?? 0;
    // Понижающий AP63205 — 2 А: выход, ключ SW и земля; вход — примерно половина.
    expect(I('SW5')).toBeCloseTo(2, 5);
    expect(I('5V')).toBeGreaterThanOrEqual(2);
    expect(I('GND')).toBeGreaterThanOrEqual(2);
    expect(I('+12V')).toBeCloseTo(1, 5);
    // AMS1117 — 1 А; предохранитель T1A — 1 А; вторичная обмотка 10 ВА / 9 В — 1,1 А.
    expect(I('3V3')).toBeCloseTo(1, 5);
    expect(I('L')).toBeCloseTo(1, 5);
    expect(I('AC1')).toBeCloseTo(10 / 9, 3);
    // Цепь ключа турбины на плате — только управление оптрона: ток мотора по ней не идёт.
    expect(I('M1_SW')).toBe(0);
    // Выводы стабилизатора: вход, выход, земля — по 1 А.
    const da2 = Object.values(p.components).find((c) => c.ref === 'DA2')!;
    const pins = componentPinCurrents(p, da2);
    expect([...pins.values()].map((x) => x.current)).toEqual([1, 1, 1, 1]);
    // Ширина: по току шире класса Power (0,4 мм).
    expect(netWidth(p, byName(p, 'SW5')).width).toBeCloseTo(0.8, 5);
    expect(netWidth(p, byName(p, '3V3')).width).toBeCloseTo(0.4, 5);
    // Ток, заданный вручную, главнее оценки.
    const q = structuredClone(p);
    q.nets[byName(q, 'N')].current = 1;
    const n = netCurrents(q).get(byName(q, 'N'))!;
    expect(n.manual).toBe(true);
    expect(n.current).toBe(1);
    expect(netWidth(q, byName(q, 'N')).capped).toBe(false);
  });

  test('плата на выводных деталях: HLK-PM01 — 0,6 А, предохранители 0,5 А; классы и так шире', () => {
    const p = file('import/plata-dip.plata.json');
    const cur = netCurrents(p);
    expect(cur.get(byName(p, '5V'))!.current).toBeCloseTo(0.6, 5);
    expect(cur.get(byName(p, 'AC_L'))!.current).toBeCloseTo(0.5, 5);
    for (const id of cur.keys()) expect(netWidth(p, id).width).toBeCloseTo(netWidth(p, id).classWidth, 5);
  });
});

/** Плата: SOIC-8 и клеммник, цепь PWR на 3 А между ними; посредине — два резистора чужой цепи с узким проходом. */
function neckBoard(): { p: Project; pwr: string } {
  const p = createProject({ width: 60, height: 30, copperLayers: 2 });
  // Вывод 8 SOIC-8 — на 1,905 мм выше центра: ставим так, чтобы он был на оси y = 15.
  const u1 = addComponent(p, libraryFootprint('SOIC-8_3.9x4.9mm_P1.27mm')!, { x: 10, y: 16.905 }, { ref: 'U1' });
  const j1 = addComponent(p, libraryFootprint('TerminalBlock_1x02_P5.08mm')!, { x: 50, y: 15 }, { ref: 'J1' });
  const r = libraryFootprint('R_0805_2012Metric')!;
  const r1 = addComponent(p, r, { x: 30, y: 13.7 }, { ref: 'R1' });
  const r2 = addComponent(p, r, { x: 30, y: 16.3 }, { ref: 'R2' });
  const pwr = ensureNet(p, 'PWR');
  pwr.current = 3;
  const sig = ensureNet(p, 'SIG');
  const sig2 = ensureNet(p, 'SIG2');
  connectPad(p, u1.id, '8', pwr.id);
  connectPad(p, j1.id, '1', pwr.id);
  for (const c of [r1, r2]) {
    connectPad(p, c.id, '1', sig.id);
    connectPad(p, c.id, '2', sig2.id);
  }
  return { p: structuredClone(p), pwr: pwr.id };
}

describe('подгонка ширины', () => {
  test('новая дорожка по току: широкая, в узком проходе сужается, ошибок нет', () => {
    const { p, pwr } = neckBoard();
    const w = computeConnectivity(p).world;
    const a = w.pads.find((x) => x.component.ref === 'U1' && x.pad.number === '8')!.center;
    const b = w.pads.find((x) => x.component.ref === 'J1' && x.pad.number === '1')!.center;
    expect(netWidth(p, pwr).width).toBeCloseTo(1.4, 5);
    // Прямая от вывода 8 к клеммнику по оси y = 15: через проход между R1 и R2.
    const q = structuredClone(p);
    expect(a.y).toBeCloseTo(15, 3);
    expect(b.y).toBeCloseTo(15, 3);
    // Как при рисовании с галочкой «авто»: дорожка по классу, затем расширение до нужной.
    const t = addTrack(q, { layer: 'F.Cu', width: netWidth(p, pwr).classWidth, points: [a, b] });
    const fit = fitTrackWidths(structuredClone(q), { tracks: [t.id] });
    expect(fit.remove).toEqual([t.id]);
    const widths = fit.add.map((x) => x.width);
    expect(Math.max(...widths)).toBeCloseTo(1.4, 5);
    const neck = Math.min(...widths);
    expect(neck).toBeLessThan(1);
    expect(neck).toBeGreaterThanOrEqual(0.25);
    expect(fit.short.map((x) => x.net)).toEqual([pwr]);
    applyFit(q, fit);
    const done = structuredClone(q);
    expect(errors(done)).toEqual([]);
    expect(computeConnectivity(done).nets.get(pwr)!.complete).toBe(true);
  });

  test('«Ширина по токам» расширяет тонкую дорожку; замечание DRC до и после — только об узком проходе', () => {
    const { p, pwr } = neckBoard();
    const w = computeConnectivity(p).world;
    const a = w.pads.find((x) => x.component.ref === 'U1' && x.pad.number === '8')!.center;
    const b = w.pads.find((x) => x.component.ref === 'J1' && x.pad.number === '1')!.center;
    const q = structuredClone(p);
    addTrack(q, { layer: 'F.Cu', width: 0.25, points: [a, b] });
    const before = runDrc(structuredClone(q)).markers.filter((m) => m.code === 'width');
    expect(before.map((m) => m.message).join()).toMatch(/PWR: ток ~3 А, дорожка 0,25 мм — нужно 1,4 мм/);
    const fit = fitTrackWidthsSafe(structuredClone(q));
    expect(fit.nets.map((n) => n.net)).toEqual([pwr]);
    applyFit(q, fit);
    const done = structuredClone(q);
    expect(errors(done)).toEqual([]);
    const tracks = Object.values(done.tracks);
    expect(Math.max(...tracks.map((t) => t.width))).toBeCloseTo(1.4, 5);
    // Узкое место между резисторами остаётся — о нём и замечание.
    const after = runDrc(done).markers.filter((m) => m.code === 'width');
    expect(after).toHaveLength(1);
    expect(after[0].items.length).toBeLessThan(tracks.length);
  });

  test('плата пылесоса ESP32: расширение не рвёт заливку и не добавляет ошибок', () => {
    const p = file('import/vacuum-esp32.plata.json');
    expect(errors(p)).toEqual([]);
    const fit = fitTrackWidthsSafe(p);
    const names = fit.nets.map((n) => p.nets[n.net].name);
    expect(names).toEqual(expect.arrayContaining(['SW5', 'GND', '5V']));
    const q = structuredClone(p);
    applyFit(q, fit);
    const done = structuredClone(q);
    expect(errors(done)).toEqual([]);
    expect(computeConnectivity(done).unrouted).toBe(0);
    // Тронуты только цепи, которым по току нужно шире класса (сужения сигнальных дорожек — нет).
    for (const id of fit.remove) {
      const nw = netWidth(p, computeConnectivity(p).itemNet.get(id) as string);
      expect(nw.width).toBeGreaterThan(nw.classWidth);
    }
  });

  test('вариант автотрассировки: дорожки сильноточной цепи шире класса', async () => {
    const { p, pwr } = neckBoard();
    const o = defaultSearchOptions(p);
    const v = await runVariant(p, o, planVariant(0, p, o));
    expect(v.stats.unrouted).toBe(0);
    expect(v.stats.drc).toBe(0);
    expect(v.stats.widened).toBe(1);
    expect(Math.max(...v.tracks.map((t) => t.width))).toBeCloseTo(1.4, 5);
    const off = await runVariant(p, { ...o, use: { ...o.use, current: false } }, planVariant(0, p, o));
    expect(Math.max(...off.tracks.map((t) => t.width))).toBeLessThan(1);
    expect(netWidth(p, pwr).classWidth).toBeLessThan(1);
  });
});
