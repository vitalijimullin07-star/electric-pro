import { describe, expect, test } from 'vitest';
import { convertLegacyBoard } from '../src/core/io/legacy-plata';
import { VACUUM_BOARD } from '../src/core/examples/vacuum-controller/board';
import { libraryFootprint } from '../src/core/library';
import { computeConnectivity, getZoneFills } from '../src/core/model/connectivity';
import { runDrc } from '../src/core/model/drc';
import { addComponent, addRuleArea, addTrack, addVia, addZone, connectPad, ensureNet, findNetByName } from '../src/core/model/edit';
import { createProject, rectOutline } from '../src/core/model/project';
import { getWorld } from '../src/core/model/world';
import { distPointShape } from '../src/core/math/shape';
import { distToPolygonEdge, pointInPolygon, signedArea } from '../src/core/math/geom';
import { exportGerbers } from '../src/core/io/gerber';
import { exportCopperSvg } from '../src/core/io/svg-export';
import type { Project } from '../src/core/model/types';

/** Плата 40×30: два резистора 0805 сверху, у обоих вывод 1 — GND, выводы 2 — разные цепи A и B. */
function twoResistors(): { p: Project; gnd: string; a: string; b: string } {
  const p = createProject({ width: 40, height: 30 });
  const fp = libraryFootprint('R_0805_2012Metric')!;
  const r1 = addComponent(p, fp, { x: 10, y: 10 });
  const r2 = addComponent(p, fp, { x: 30, y: 20 });
  const gnd = ensureNet(p, 'GND').id;
  const a = ensureNet(p, 'A').id;
  const b = ensureNet(p, 'B').id;
  connectPad(p, r1.id, '1', gnd);
  connectPad(p, r2.id, '1', gnd);
  connectPad(p, r1.id, '2', a);
  connectPad(p, r2.id, '2', b);
  return { p, gnd, a, b };
}

/** Наименьшее расстояние от вершин заливки до фигур площадок цепи. */
function minGapToNet(p: Project, loops: { x: number; y: number }[][], net: string): number {
  let m = Infinity;
  for (const wp of getWorld(p).pads) {
    if (wp.net !== net) continue;
    for (const l of loops) for (const q of l) m = Math.min(m, distPointShape(q, wp.shape));
  }
  return m;
}

/** Точка в заливке: по правилу чётности, как её рисуют. */
const inFill = (loops: { x: number; y: number }[][], pt: { x: number; y: number }) => loops.filter((l) => pointInPolygon(pt, l)).length % 2 === 1;

describe('полигоны меди', () => {
  test('заливка соединяет свою цепь и обходит чужие с зазором', () => {
    const { p, gnd, a, b } = twoResistors();
    const before = computeConnectivity(p);
    expect(before.nets.get(gnd)!.complete).toBe(false);
    addZone(p, { layer: 'F.Cu', net: gnd, outline: rectOutline(40, 30), clearance: 0.4, minWidth: 0.25, priority: 0 });
    const q = structuredClone(p);
    const c = computeConnectivity(q);
    expect(c.nets.get(gnd)!.complete).toBe(true);
    expect(c.shorts).toHaveLength(0);
    expect(c.ratsnest.filter((r) => r.netId === gnd)).toHaveLength(0);
    const zf = c.zoneFills[0];
    expect(zf.islands).toHaveLength(1);
    expect(zf.loops.length).toBeGreaterThanOrEqual(3);
    // Внешний контур — самый большой, по часовой; вырезы вокруг A и B — против.
    expect(zf.holes[0]).toBe(false);
    expect(signedArea(zf.loops[0])).toBeLessThan(0);
    expect(zf.holes.filter(Boolean).length).toBeGreaterThanOrEqual(2);
    // Зазор до чужих площадок не меньше заданного (допуск — погрешность сетки).
    expect(minGapToNet(q, zf.loops, a)).toBeGreaterThan(0.4 - 0.01);
    expect(minGapToNet(q, zf.loops, b)).toBeGreaterThan(0.4 - 0.01);
    // Отступ от края платы.
    const edge = q.rules.edgeClearance;
    for (const l of zf.loops)
      for (const pt of l) {
        expect(pt.x).toBeGreaterThan(edge - 0.02);
        expect(pt.y).toBeGreaterThan(edge - 0.02);
        expect(pt.x).toBeLessThan(40 - edge + 0.02);
        expect(pt.y).toBeLessThan(30 - edge + 0.02);
      }
    expect(runDrc(q).markers.filter((m) => m.severity === 'error')).toHaveLength(0);
  });

  test('чужая дорожка режет заливку: остров без своих площадок убирается', () => {
    const { p, gnd } = twoResistors();
    // Обе площадки GND слева от вертикальной дорожки цепи A.
    const r2 = Object.values(p.components).find((c) => c.ref === 'R2')!;
    r2.at = { x: 12, y: 22 };
    const a = findNetByName(p, 'A')!.id;
    const r1 = Object.values(p.components).find((c) => c.ref === 'R1')!;
    connectPad(p, r1.id, '2', a);
    addTrack(p, { layer: 'F.Cu', width: 0.3, points: [{ x: 11, y: 10 }, { x: 25, y: 10 }, { x: 25, y: 0.5 }] });
    addTrack(p, { layer: 'F.Cu', width: 0.3, points: [{ x: 25, y: 10 }, { x: 25, y: 29.5 }] });
    addZone(p, { layer: 'F.Cu', net: gnd, outline: rectOutline(40, 30), clearance: 0.3, minWidth: 0.25, priority: 0 });
    const zf = computeConnectivity(structuredClone(p)).zoneFills[0];
    expect(zf.islands).toHaveLength(1);
    expect(zf.removed).toBe(1);
    // Справа от дорожки меди нет.
    for (const l of zf.loops) for (const pt of l) expect(pt.x).toBeLessThan(25);
  });

  test('перешейки уже минимальной ширины не заливаются', () => {
    const sliver = (minWidth: number) => {
      const { p, gnd, a } = twoResistors();
      // Две дорожки цепи A: между ними после зазоров остаётся полоска около 0,6 мм.
      const r1 = Object.values(p.components).find((c) => c.ref === 'R1')!;
      const pa = getWorld(p).pads.find((x) => x.component.id === r1.id && x.pad.number === '2')!.center;
      addTrack(p, { layer: 'F.Cu', width: 0.3, points: [pa, { x: pa.x, y: 14 }, { x: 36, y: 14 }, { x: 36, y: 15.6 }, { x: 16, y: 15.6 }] });
      void a;
      addZone(p, { layer: 'F.Cu', net: gnd, outline: rectOutline(40, 30), clearance: 0.3, minWidth, priority: 0 });
      const zf = getZoneFills(structuredClone(p))[0];
      return inFill(zf.loops, { x: 26, y: 14.8 });
    };
    expect(sliver(0.3)).toBe(true);
    expect(sliver(0.8)).toBe(false);
  });

  test('область запрета и полигон без цепи', () => {
    const { p } = twoResistors();
    addRuleArea(p, { name: 'Антенна', outline: rectOutline(10, 30, 30, 0), keepoutTracks: true, keepoutVias: true });
    addZone(p, { layer: 'B.Cu', net: null, outline: rectOutline(40, 30), clearance: 0.3, minWidth: 0.25, priority: 0 });
    const q = structuredClone(p);
    const zf = getZoneFills(q)[0];
    expect(zf.loops.length).toBeGreaterThan(0);
    for (const l of zf.loops) for (const pt of l) expect(pt.x).toBeLessThanOrEqual(30.001);
    const warn = runDrc(q).markers.filter((m) => m.code === 'zone');
    expect(warn).toHaveLength(1);
    expect(warn[0].message).toMatch(/без цепи/);
  });

  test('переходное без цепи в полигоне сшивает его с дорожкой другого слоя', () => {
    const { p, gnd } = twoResistors();
    // GND R1.1 → дорожка вниз → переходное; полигон GND снизу; R2.1 тоже через переходное.
    const w = getWorld(p);
    const pad = (ref: string, n: string) => w.pads.find((x) => x.component.ref === ref && x.pad.number === n)!.center;
    const p1 = pad('R1', '1');
    const p2 = pad('R2', '1');
    addTrack(p, { layer: 'F.Cu', width: 0.3, points: [p1, { x: p1.x, y: p1.y + 4 }] });
    addVia(p, { at: { x: p1.x, y: p1.y + 4 }, diameter: 0.8, drill: 0.4 });
    addTrack(p, { layer: 'F.Cu', width: 0.3, points: [p2, { x: p2.x, y: p2.y - 4 }] });
    addVia(p, { at: { x: p2.x, y: p2.y - 4 }, diameter: 0.8, drill: 0.4 });
    // Отдельное переходное без дорожек — «сшивка», тоже получает цепь GND от полигона.
    const stitch = addVia(p, { at: { x: 20, y: 5 }, diameter: 0.8, drill: 0.4 });
    addZone(p, { layer: 'B.Cu', net: gnd, outline: rectOutline(40, 30), clearance: 0.3, minWidth: 0.25, priority: 0 });
    const c = computeConnectivity(structuredClone(p));
    expect(c.nets.get(gnd)!.complete).toBe(true);
    expect(c.itemNet.get(stitch.id)).toBe(gnd);
    expect(c.dangling.some((d) => d.id === stitch.id)).toBe(false);
  });

  test('полигоны разных цепей: больший приоритет заливается первым', () => {
    const { p, gnd, a } = twoResistors();
    const low = addZone(p, { layer: 'F.Cu', net: gnd, outline: rectOutline(40, 30), clearance: 0.3, minWidth: 0.25, priority: 0 });
    addZone(p, { layer: 'F.Cu', net: a, outline: rectOutline(8, 8, 6, 6), clearance: 0.3, minWidth: 0.25, priority: 1 });
    const fills = getZoneFills(structuredClone(p));
    const g = fills.find((f) => f.zone.id === low.id)!;
    // Внутри квадрата полигона A заливки GND нет: ни одна вершина GND не лежит глубже зазора.
    const inner = rectOutline(7.4, 7.4, 6.3, 6.3);
    for (const l of g.loops) for (const pt of l) expect(pointInPolygon(pt, inner)).toBe(false);
    expect(computeConnectivity(structuredClone(p)).shorts).toHaveLength(0);
  });

  test('экспорт: Gerber со стиранием вырезов, SVG по правилу чётности', () => {
    const { p, gnd } = twoResistors();
    addZone(p, { layer: 'F.Cu', net: gnd, outline: rectOutline(40, 30), clearance: 0.4, minWidth: 0.25, priority: 0 });
    const q = structuredClone(p);
    const cu = exportGerbers(q).find((f) => f.layer === 'F.Cu')!.content;
    expect(cu).toMatch(/%LPC\*%/);
    // После каждого стирания полярность возвращается, медь выводится после заливки.
    expect(cu.match(/%LPC\*%/g)!.length).toBe(cu.match(/%LPD\*%/g)!.length);
    expect(cu.lastIndexOf('%LPD*%')).toBeLessThan(cu.lastIndexOf('G36*'));
    const svg = exportCopperSvg(q, 'F.Cu');
    expect(svg).toContain('fill-rule="evenodd"');
  });

  test('плата пылесоса с полигоном GND снизу: без ошибок, всё разведено', () => {
    const p = structuredClone(convertLegacyBoard(VACUUM_BOARD).project);
    const gnd = findNetByName(p, 'GND')!;
    addZone(p, { layer: 'B.Cu', net: gnd.id, outline: p.board.outline.map((q) => ({ ...q })), clearance: 0.4, minWidth: 0.3, priority: 0 });
    const q = structuredClone(p);
    const t = performance.now();
    const c = computeConnectivity(q);
    const ms = performance.now() - t;
    expect(c.unrouted).toBe(0);
    expect(c.shorts).toHaveLength(0);
    expect(c.zoneFills[0].islands.length).toBeGreaterThan(0);
    expect(runDrc(q).markers.filter((m) => m.severity === 'error')).toHaveLength(0);
    // Зона 230 В: полигон земли туда не заходит.
    const mains = Object.values(q.ruleAreas).find((r) => r.onlyClasses?.length);
    expect(mains).toBeTruthy();
    const deep = c.zoneFills[0].loops.flat().filter((pt) => pointInPolygon(pt, mains!.outline) && distToPolygonEdge(pt, mains!.outline) > 0.05);
    expect(deep).toHaveLength(0);
    expect(ms).toBeLessThan(2000);
  });
});
