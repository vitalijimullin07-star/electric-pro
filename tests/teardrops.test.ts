import { describe, expect, test } from 'vitest';
import { convertLegacyBoard } from '../src/core/io/legacy-plata';
import { VACUUM_BOARD } from '../src/core/examples/vacuum-controller/board';
import { libraryFootprint } from '../src/core/library';
import { computeConnectivity, getTeardrops } from '../src/core/model/connectivity';
import { runDrc } from '../src/core/model/drc';
import { addComponent, addTrack, addZone, connectPad, ensureNet, findNetByName } from '../src/core/model/edit';
import { createProject, rectOutline } from '../src/core/model/project';
import { getWorld } from '../src/core/model/world';
import { pointInPolygon } from '../src/core/math/geom';
import { shapeGap } from '../src/core/math/shape';
import { exportGerbers } from '../src/core/io/gerber';

describe('каплевидные переходы', () => {
  test('выключены — нет; включены — капля у выводной площадки, внутри неё и вдоль дорожки', () => {
    const p = createProject({ width: 40, height: 30 });
    const fp = libraryFootprint('R_Axial_0.25W_L6.3mm_D2.5mm_P10.16mm_Horizontal')!;
    const r1 = addComponent(p, fp, { x: 10, y: 10 });
    const a = ensureNet(p, 'A').id;
    connectPad(p, r1.id, '1', a);
    const pad = getWorld(p).pads.find((x) => x.pad.number === '1')!;
    addTrack(p, { layer: 'B.Cu', width: 0.3, points: [pad.center, { x: pad.center.x, y: pad.center.y + 10 }] });
    expect(getTeardrops(structuredClone(p))).toHaveLength(0);
    p.rules.teardrops = true;
    const q = structuredClone(p);
    const tds = getTeardrops(q);
    expect(tds).toHaveLength(1);
    const td = tds[0];
    expect(td.layer).toBe('B.Cu');
    // Основание внутри площадки, хвост на дорожке ниже края площадки.
    const R = (pad.shape.box.maxY - pad.shape.box.minY) / 2;
    expect(pointInPolygon({ x: pad.center.x, y: pad.center.y + R * 0.5 }, td.pts)).toBe(true);
    expect(pointInPolygon({ x: pad.center.x, y: pad.center.y + R + 0.3 }, td.pts)).toBe(true);
    expect(Math.max(...td.pts.map((v) => v.y))).toBeLessThan(pad.center.y + 10);
    expect(runDrc(q).errors).toBe(0);
    // Капля выходит в Gerber нижней меди как область.
    const cu = exportGerbers(q).find((f) => f.layer === 'B.Cu')!.content;
    expect(cu.match(/G36\*/g)!.length).toBeGreaterThanOrEqual(1);
  });

  test('рядом чужая площадка — капля уменьшается или пропадает, зазор соблюдён', () => {
    const p = createProject({ width: 40, height: 30 });
    p.rules.teardrops = true;
    const fp = libraryFootprint('R_Axial_0.25W_L6.3mm_D2.5mm_P10.16mm_Horizontal')!;
    const r1 = addComponent(p, fp, { x: 10, y: 10 });
    const r2 = addComponent(p, fp, { x: 10, y: 12.2 });
    const a = ensureNet(p, 'A').id;
    const b = ensureNet(p, 'B').id;
    connectPad(p, r1.id, '1', a);
    connectPad(p, r2.id, '1', b);
    const w = getWorld(p);
    const pa = w.pads.find((x) => x.component.id === r1.id && x.pad.number === '1')!;
    // Дорожка уходит вправо, чужая площадка прямо под площадкой — капля расширяется к ней.
    addTrack(p, { layer: 'B.Cu', width: 0.3, points: [pa.center, { x: pa.center.x + 4, y: pa.center.y }] });
    const q = structuredClone(p);
    const pb = getWorld(q).pads.find((x) => x.component.id === r2.id && x.pad.number === '1')!;
    for (const td of getTeardrops(q)) expect(shapeGap(td.shape, pb.shape).d).toBeGreaterThanOrEqual(q.rules.minClearance - 1e-6);
    expect(runDrc(q).errors).toBe(0);
  });

  test('плата пылесоса с каплями и полигоном: без ошибок, всё разведено', () => {
    const p = structuredClone(convertLegacyBoard(VACUUM_BOARD).project);
    p.rules.teardrops = true;
    addZone(p, { layer: 'B.Cu', net: findNetByName(p, 'GND')!.id, outline: rectOutline(203.2, 132.08), clearance: 0.4, minWidth: 0.3, priority: 0 });
    const q = structuredClone(p);
    const c = computeConnectivity(q);
    expect(c.teardrops.length).toBeGreaterThan(80);
    expect(c.unrouted).toBe(0);
    expect(c.shorts).toHaveLength(0);
    expect(runDrc(q).markers.filter((m) => m.severity === 'error').map((m) => m.message)).toEqual([]);
  });
});
