import { describe, expect, test } from 'vitest';
import { netWidth, parseAmps, widthForCurrent } from '../src/core/model/currents';
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
