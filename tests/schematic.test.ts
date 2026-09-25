import { describe, expect, test } from 'vitest';
import { convertLegacyBoard } from '../src/core/io/legacy-plata';
import { VACUUM_BOARD } from '../src/core/examples/vacuum-controller/board';
import { libraryFootprint, libraryFootprints } from '../src/core/library';
import { addComponent, connectPad, ensureNet } from '../src/core/model/edit';
import { createProject } from '../src/core/model/project';
import { computeConnectivity } from '../src/core/model/connectivity';
import { applySchematicToBoard, emptySchematic, placedPins, schematicNetlist, syncSymbolsFromBoard } from '../src/core/schematic/netlist';
import { symbolFor, symToWorld } from '../src/core/schematic/symbols';

describe('схема', () => {
  test('символы: у каждого корпуса с выводами есть символ, все выводы на месте, без совпадающих точек', () => {
    let n = 0;
    for (const fp of libraryFootprints()) {
      const def = symbolFor(fp);
      const pads = new Set(fp.pads.filter((p) => p.type !== 'npth' && p.number).map((p) => p.number));
      if (!pads.size) {
        expect(def).toBeNull();
        continue;
      }
      expect(def, fp.id).not.toBeNull();
      expect(new Set(def!.pins.map((p) => p.number))).toEqual(pads);
      const pts = new Set(def!.pins.map((p) => `${p.at.x},${p.at.y}`));
      expect(pts.size, fp.id).toBe(def!.pins.length);
      n++;
    }
    expect(n).toBeGreaterThan(700);
  });

  test('поворот и зеркало символа', () => {
    expect(symToWorld({ x: 5.08, y: 0 }, { x: 10, y: 10 }, 90)).toEqual({ x: 10, y: 4.92 });
    expect(symToWorld({ x: 5.08, y: 0 }, { x: 10, y: 10 }, 0, true)).toEqual({ x: 4.92, y: 10 });
  });

  test('схема из платы пылесоса и обратно: цепи на плате не меняются', () => {
    const p = structuredClone(convertLegacyBoard(VACUUM_BOARD).project);
    const before = JSON.stringify(Object.values(p.components).map((c) => [c.ref, Object.entries(c.padNets).map(([k, v]) => [k, p.nets[v].name]).sort()]));
    const n = syncSymbolsFromBoard(p);
    expect(n).toBeGreaterThan(40);
    const q = structuredClone(p);
    const nl = schematicNetlist(q);
    expect(nl.warnings).toEqual([]);
    const r = applySchematicToBoard(q);
    expect(r.changed).toBe(0);
    expect(r.added).toEqual([]);
    const after = JSON.stringify(Object.values(q.components).map((c) => [c.ref, Object.entries(c.padNets).map(([k, v]) => [k, q.nets[v].name]).sort()]));
    expect(after).toBe(before);
    expect(computeConnectivity(structuredClone(q)).unrouted).toBe(0);
  });

  test('провода, Т-соединение и метки дают цепи; перенос на плату', () => {
    const p = createProject({ width: 40, height: 30 });
    const fp = libraryFootprint('R_0805_2012Metric')!;
    const r1 = addComponent(p, fp, { x: 10, y: 10 });
    const r2 = addComponent(p, fp, { x: 20, y: 10 });
    const r3 = addComponent(p, fp, { x: 30, y: 10 });
    // Цепь с платы: провод без метки сохранит её имя (и класс цепи); цепь STALE на схеме не встречается — уйдёт.
    connectPad(p, r3.id, '2', ensureNet(p, 'OLD').id);
    connectPad(p, r3.id, '1', ensureNet(p, 'STALE').id);
    p.schematic = emptySchematic();
    const sch = p.schematic;
    sch.symbols.a = { id: 'a', component: r1.id, at: { x: 0, y: 0 }, rotation: 0 };
    sch.symbols.b = { id: 'b', component: r2.id, at: { x: 20.32, y: 0 }, rotation: 0 };
    sch.symbols.c = { id: 'c', component: r3.id, at: { x: 10.16, y: 10.16 }, rotation: 90 };
    const pins = placedPins(p);
    const pin = (c: string, n: string) => pins.find((x) => x.component === c && x.number === n)!.at;
    // R1.2 — R2.1 проводом; к середине провода — R3.2 (Т-соединение).
    sch.wires.w1 = { id: 'w1', points: [pin(r1.id, '2'), pin(r2.id, '1')] };
    const mid = { x: (pin(r1.id, '2').x + pin(r2.id, '1').x) / 2, y: 0 };
    sch.wires.w2 = { id: 'w2', points: [pin(r3.id, '2'), { x: pin(r3.id, '2').x, y: mid.y }] };
    expect(pin(r3.id, '2').x).toBeCloseTo(mid.x, 6);
    // Метки GND на R1.1 и R2.2.
    sch.labels.l1 = { id: 'l1', at: pin(r1.id, '1'), text: 'GND' };
    sch.labels.l2 = { id: 'l2', at: pin(r2.id, '2'), text: 'GND' };
    const nl = schematicNetlist(p);
    const names = nl.nets.map((n) => `${n.name}:${n.pins.map((x) => x.ref + '.' + x.number).sort().join(',')}`);
    expect(names).toEqual(['GND:R1.1,R2.2', 'OLD:R1.2,R2.1,R3.2']);
    expect(nl.junctions.length).toBe(1);
    const q = structuredClone(p);
    const r = applySchematicToBoard(q);
    expect(r.added).toEqual(['GND']);
    expect(r.removed).toEqual(['STALE']);
    const netOf = (c: string, n: string) => q.nets[q.components[c].padNets[n]]?.name;
    expect(netOf(r1.id, '2')).toBe('OLD');
    expect(netOf(r3.id, '2')).toBe('OLD');
    expect(netOf(r2.id, '2')).toBe('GND');
    expect(netOf(r3.id, '1')).toBeUndefined();
  });
});
