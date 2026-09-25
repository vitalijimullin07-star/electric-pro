import { describe, expect, test } from 'vitest';
import { importKicadBoard, importKicadFootprint, parseSexpr, arcThrough } from '../src/core/io/kicad';
import { computeConnectivity } from '../src/core/model/connectivity';
import { runDrc } from '../src/core/model/drc';
import { getWorld } from '../src/core/model/world';

/* Собственные образцы в формате KiCad 8–10 (не копии библиотеки KiCad). */

const MOD = `(footprint "TEST_SOIC-8_Tiny"
  (version 20240108) (generator "test") (layer "F.Cu")
  (descr "Проверочный корпус \\"SOIC\\"") (tags "test soic")
  (property "Reference" "REF**" (at 0 -3.2 0) (layer "F.SilkS") (effects (font (size 1 1) (thickness 0.15))))
  (property "Value" "TEST" (at 0 3.2 0) (layer "F.Fab") (effects (font (size 1 1) (thickness 0.15))))
  (property "Datasheet" "" (at 0 0 0) (layer "F.Fab") (hide yes) (effects (font (size 1 1))))
  (attr smd)
  (fp_line (start -2 -2.5) (end 2 -2.5) (stroke (width 0.12) (type solid)) (layer "F.SilkS"))
  (fp_arc (start -0.5 -2.5) (mid 0 -2) (end 0.5 -2.5) (stroke (width 0.12) (type solid)) (layer "F.SilkS"))
  (fp_circle (center -2.5 -2.2) (end -2.35 -2.2) (stroke (width 0.1) (type solid)) (fill yes) (layer "F.SilkS"))
  (fp_poly (pts (xy -1 1) (xy 1 1) (xy 0 2)) (stroke (width 0.1) (type solid)) (fill no) (layer "F.Fab"))
  (fp_rect (start -3.7 -2.8) (end 3.7 2.8) (stroke (width 0.05) (type solid)) (fill no) (layer "F.CrtYd"))
  (fp_text user "\${REFERENCE}" (at 0 0 0) (layer "F.Fab") (effects (font (size 0.8 0.8) (thickness 0.12))))
  (pad "1" smd roundrect (at -2.475 -1.905) (size 1.95 0.6) (layers "F.Cu" "F.Mask" "F.Paste") (roundrect_rratio 0.25))
  (pad "2" smd roundrect (at -2.475 -0.635) (size 1.95 0.6) (layers "F.Cu" "F.Mask" "F.Paste") (roundrect_rratio 0.25))
  (pad "3" smd rect (at 2.475 0 90) (size 0.6 1.95) (layers "F.Cu" "F.Mask" "F.Paste"))
  (pad "4" thru_hole oval (at 0 1.5) (size 1.2 2) (drill oval 0.6 1.2) (layers "*.Cu" "*.Mask"))
  (pad "" np_thru_hole circle (at 3 2) (size 1 1) (drill 1) (layers "*.Cu" "*.Mask"))
  (model "\${KICAD8_3DMODEL_DIR}/x.step" (offset (xyz 0 0 0)))
)`;

/** Резистор: два круглых вывода с шагом 5,08 мм. */
const RES = (ref: string, at: string, layer: string, n1: string, n2: string) => `(footprint "Lib:R_Test"
  (layer "${layer}") (at ${at})
  (property "Reference" "${ref}" (at 0 -1.5 0) (layer "${layer === 'B.Cu' ? 'B.SilkS' : 'F.SilkS'}") (effects (font (size 1 1) (thickness 0.15))))
  (property "Value" "10k" (at 0 1.5 0) (layer "${layer === 'B.Cu' ? 'B.Fab' : 'F.Fab'}") (effects (font (size 1 1) (thickness 0.15))))
  (fp_line (start -1 -0.8) (end 1 -0.8) (stroke (width 0.12) (type solid)) (layer "${layer === 'B.Cu' ? 'B.SilkS' : 'F.SilkS'}"))
  (pad "1" thru_hole circle (at -2.54 0) (size 1.6 1.6) (drill 0.8) (layers "*.Cu" "*.Mask") ${n1})
  (pad "2" thru_hole circle (at 2.54 0) (size 1.6 1.6) (drill 0.8) (layers "*.Cu" "*.Mask") ${n2})
)`;

/** Планарный элемент снизу: в файле KiCad его геометрия уже отражена (x → −x), слой B.Cu. */
const SMD_BOTTOM = `(footprint "Lib:SMD_Test"
  (layer "B.Cu") (at 30 20 90)
  (property "Reference" "C1" (at 0 -1.5 90) (layer "B.SilkS") (effects (font (size 1 1) (thickness 0.15)) (justify mirror)))
  (property "Value" "100n" (at 0 1.5 90) (layer "B.Fab") (effects (font (size 1 1) (thickness 0.15)) (justify mirror)))
  (pad "1" smd rect (at 1 0 90) (size 1 1.2) (layers "B.Cu" "B.Mask" "B.Paste") (net 2 "VCC"))
  (pad "2" smd rect (at -1 0 90) (size 1 1.2) (layers "B.Cu" "B.Mask" "B.Paste") (net 1 "GND"))
  (pad "3" smd rect (at 0 3 90) (size 1 1.2) (layers "F.Cu" "F.Mask") (net 1 "GND"))
)`;

const PCB = `(kicad_pcb (version 20241229) (generator "pcbnew")
  (general (thickness 1.6))
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (25 "Edge.Cuts" user) (5 "F.SilkS" user) (7 "B.SilkS" user))
  (net 0 "") (net 1 "GND") (net 2 "VCC") (net 3 "SIG")
  ${RES('R1', '10 10 90', 'F.Cu', '(net 3 "SIG")', '(net 2 "VCC")')}
  ${RES('R2', '20 10', 'F.Cu', '(net 3 "SIG")', '(net 1 "GND")')}
  ${SMD_BOTTOM}
  (segment (start 10 12.54) (end 17.46 12.54) (width 0.4) (layer "B.Cu") (net 3))
  (segment (start 17.46 12.54) (end 17.46 10) (width 0.4) (layer "B.Cu") (net 3))
  (arc (start 22.54 10) (mid 26.2 11.5) (end 27 16) (width 0.3) (layer "B.Cu") (net 1))
  (segment (start 27 16) (end 27 21) (width 0.3) (layer "B.Cu") (net 1))
  (segment (start 27 21) (end 30 21) (width 0.3) (layer "B.Cu") (net 1))
  (segment (start 10 7.46) (end 10 4) (width 0.4) (layer "F.Cu") (net 2))
  (segment (start 10 4) (end 30 4) (width 0.4) (layer "F.Cu") (net 2))
  (via (at 30 4) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 2))
  (segment (start 30 4) (end 30 19) (width 0.4) (layer "B.Cu") (net 2))
  (zone (net 1) (net_name "GND") (layer "F.Cu") (connect_pads (clearance 0.3)) (min_thickness 0.25)
    (fill yes (thermal_gap 0.4) (thermal_bridge_width 0.5))
    (polygon (pts (xy 1 1) (xy 44 1) (xy 44 29) (xy 1 29))))
  (gr_rect (start 0 0) (end 45 30) (stroke (width 0.1) (type solid)) (fill no) (layer "Edge.Cuts"))
  (gr_circle (center 40 25) (end 41.5 25) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts"))
  (gr_text "Проверка" (at 22 27) (layer "F.SilkS") (effects (font (size 1.5 1.5) (thickness 0.2))))
)`;

describe('импорт KiCad', () => {
  test('S-выражения: кавычки, экранирование, вложенность', () => {
    const t = parseSexpr('(a "b c" (d 1 2) "e\\"f")');
    expect(t).toEqual(['a', 'b c', ['d', '1', '2'], 'e"f']);
  });

  test('дуга через три точки проходит через середину', () => {
    const pts = arcThrough({ x: -1, y: 0 }, { x: 0, y: -1 }, { x: 1, y: 0 });
    expect(pts[0]).toEqual({ x: -1, y: 0 });
    expect(pts[pts.length - 1]).toEqual({ x: 1, y: 0 });
    expect(Math.min(...pts.map((p) => p.y))).toBeCloseTo(-1, 2);
    for (const p of pts) expect(Math.hypot(p.x, p.y)).toBeCloseTo(1, 3);
  });

  test('корпус .kicad_mod: площадки, повороты, пазы, графика, габарит', () => {
    const { def, warnings } = importKicadFootprint(MOD);
    expect(def.id).toBe('TEST_SOIC-8_Tiny');
    expect(def.description).toBe('Проверочный корпус "SOIC"');
    expect(def.pads).toHaveLength(5);
    const p3 = def.pads.find((p) => p.number === '3')!;
    expect(p3.rotation).toBe(90);
    expect(def.pads.find((p) => p.number === '1')!.roundness).toBe(0.25);
    const p4 = def.pads.find((p) => p.number === '4')!;
    expect(p4.type).toBe('tht');
    expect(p4.drill).toBe(0.6);
    expect(warnings.join()).toMatch(/паз/);
    expect(def.pads.filter((p) => p.type === 'npth')).toHaveLength(1);
    expect(def.courtyard).toEqual({ min: { x: -3.7, y: -2.8 }, max: { x: 3.7, y: 2.8 } });
    const texts = def.graphics.filter((g) => g.kind === 'text').map((g) => (g.kind === 'text' ? g.text : ''));
    expect(texts).toEqual(expect.arrayContaining(['${REF}', '${VALUE}']));
    expect(def.graphics.some((g) => g.kind === 'poly' && g.closed === false)).toBe(true); // дуга
    expect(def.refPrefix).toBe('U');
  });

  test('плата .kicad_pcb: детали сверху и снизу, дорожки к центрам площадок, полигон, контур', () => {
    const { project, warnings } = importKicadBoard(PCB, 'Проверка');
    const p = structuredClone(project);
    expect(Object.keys(p.components)).toHaveLength(3);
    expect(Object.values(p.nets).map((n) => n.name).sort()).toEqual(['GND', 'SIG', 'VCC']);
    const byRef = (r: string) => Object.values(p.components).find((c) => c.ref === r)!;
    expect(byRef('R1').rotation).toBe(90);
    expect(byRef('C1').side).toBe('bottom');
    const w = getWorld(p);
    const pad = (ref: string, n: string) => w.pads.find((x) => x.component.ref === ref && x.pad.number === n)!;
    // R1 повёрнут на 90° против часовой: вывод 1 (−2,54; 0) → (10; 12,54).
    expect(pad('R1', '1').center.x).toBeCloseTo(10, 6);
    expect(pad('R1', '1').center.y).toBeCloseTo(12.54, 6);
    expect(pad('R2', '2').center.x).toBeCloseTo(22.54, 6);
    // C1 снизу, повёрнут на 90°: KiCad хранит отражённую геометрию и ставит её как at + поворот(точка);
    // вывод 1 (1; 0) → (30; 19), вывод 2 → (30; 21) — там же, где их видит KiCad.
    expect(pad('C1', '1').layers).toEqual(['B.Cu']);
    expect(pad('C1', '1').center.x).toBeCloseTo(30, 6);
    expect(pad('C1', '1').center.y).toBeCloseTo(19, 6);
    expect(pad('C1', '2').center.y).toBeCloseTo(21, 6);
    // Площадка 3 — на обратной стороне корпуса, то есть сверху платы: (0; 3) → (33; 20).
    expect(pad('C1', '3').layers).toEqual(['F.Cu']);
    expect(pad('C1', '3').center.x).toBeCloseTo(33, 6);
    expect(pad('C1', '3').center.y).toBeCloseTo(20, 6);
    expect(Object.keys(p.tracks)).toHaveLength(8);
    expect(Object.keys(p.vias)).toHaveLength(1);
    expect(Object.values(p.zones)[0]).toMatchObject({ layer: 'F.Cu', clearance: 0.3, thermalGap: 0.4, thermalWidth: 0.5 });
    expect(p.board.outline).toHaveLength(4);
    expect(p.board.cutouts).toHaveLength(1);
    expect(Object.values(p.drawings).some((d) => d.kind === 'text' && d.text === 'Проверка')).toBe(true);
    const c = computeConnectivity(p);
    expect(c.shorts).toEqual([]);
    const done = (name: string) => c.nets.get(Object.values(p.nets).find((n) => n.name === name)!.id)!.complete;
    expect(done('SIG')).toBe(true);
    expect(done('VCC')).toBe(true);
    expect(done('GND')).toBe(true);
    expect(runDrc(p).markers.filter((m) => m.code === 'short')).toEqual([]);
    expect(warnings).toEqual([]);
  });

  test('KiCad 10: цепи по имени у объектов, без таблицы номеров', () => {
    const v10 = PCB.replace(/\(net (\d+) "([^"]*)"\)/g, '(net "$2")').replace(/\(net (\d)\)/g, (_, n) => `(net "${['', 'GND', 'VCC', 'SIG'][+n]}")`).replace(/\(net_name "GND"\)/, '');
    const p = structuredClone(importKicadBoard(v10).project);
    const c = computeConnectivity(p);
    expect(Object.values(p.nets).map((n) => n.name).sort()).toEqual(['GND', 'SIG', 'VCC']);
    expect([...c.nets.values()].filter((n) => !n.complete).map((n) => p.nets[n.netId].name)).toEqual([]);
    expect(c.shorts).toEqual([]);
  });

  test('ошибка формата — понятное сообщение', () => {
    expect(() => importKicadFootprint('(kicad_pcb)')).toThrow(/не корпус KiCad/);
    expect(() => importKicadBoard('(footprint "x")')).toThrow(/не плата KiCad/);
  });
});
