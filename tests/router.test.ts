import { describe, expect, test } from 'vitest';
import { convertLegacyBoard } from '../src/core/io/legacy-plata';
import { VACUUM_BOARD } from '../src/core/examples/vacuum-controller/board';
import { autoroute } from '../src/core/router/autoroute';
import { addTrack, addVia, addWire, clearRouting } from '../src/core/model/edit';
import { computeConnectivity } from '../src/core/model/connectivity';
import { runDrc } from '../src/core/model/drc';
import type { Project } from '../src/core/model/types';
import { createProject } from '../src/core/model/project';
import { addComponent, connectPad, ensureNet } from '../src/core/model/edit';
import { libraryFootprint } from '../src/core/library';

/** Кеши связности и DRC привязаны к объекту проекта, поэтому после правок на месте берём копию. */
function applyResult(p: Project, r: Awaited<ReturnType<typeof autoroute>>): Project {
  for (const t of r.tracks) addTrack(p, t);
  for (const v of r.vias) addVia(p, v);
  for (const w of r.wires) addWire(p, w.a, w.b);
  return structuredClone(p);
}

describe('автотрассировка', () => {
  test('плата пылесоса с нуля: один слой с перемычками, всё разведено и без ошибок', { timeout: 300_000 }, async () => {
    const p = convertLegacyBoard(VACUUM_BOARD).project;
    clearRouting(p);
    const r = await autoroute(p, { iterations: 40, hopCost: 60, yieldEvery: 1000 });
    const q = applyResult(p, r);
    const c = computeConnectivity(q);
    const bad = [...c.nets.values()].filter((n) => !n.complete).map((n) => p.nets[n.netId].name);
    process.stdout.write(`  сетка ${r.grid} мм, дорожек ${r.tracks.length}, перемычек ${r.wires.length}, не проведено ${r.failed}, проходов ${r.iterations}, ${r.ms} мс\n`);
    expect(bad).toEqual([]);
    expect(c.shorts).toEqual([]);
    const d = runDrc(q);
    expect(d.markers.filter((m) => m.severity === 'error').map((m) => m.message)).toEqual([]);
  });

  test('двусторонняя плата: DIP и резисторы, переходные отверстия', { timeout: 120_000 }, async () => {
    const p = createProject({ width: 40, height: 30 });
    const dip = libraryFootprint('DIP-8_W7.62mm')!;
    const r = libraryFootprint('R_0805_2012Metric')!;
    const u1 = addComponent(p, dip, { x: 20, y: 15 }, { ref: 'U1' });
    const r1 = addComponent(p, r, { x: 8, y: 6 }, { ref: 'R1' });
    const r2 = addComponent(p, r, { x: 32, y: 24 }, { ref: 'R2' });
    const r3 = addComponent(p, r, { x: 8, y: 24 }, { ref: 'R3', side: 'bottom' });
    const n1 = ensureNet(p, 'A');
    const n2 = ensureNet(p, 'B');
    const n3 = ensureNet(p, 'C');
    const gnd = ensureNet(p, 'GND', { netClass: 'Power' });
    connectPad(p, u1.id, '1', n1.id);
    connectPad(p, r2.id, '1', n1.id);
    connectPad(p, u1.id, '8', n2.id);
    connectPad(p, r1.id, '1', n2.id);
    connectPad(p, u1.id, '5', n3.id);
    connectPad(p, r3.id, '1', n3.id);
    connectPad(p, r1.id, '2', gnd.id);
    connectPad(p, r2.id, '2', gnd.id);
    connectPad(p, r3.id, '2', gnd.id);
    connectPad(p, u1.id, '4', gnd.id);
    const res = await autoroute(p, { iterations: 20, yieldEvery: 1000 });
    const q = applyResult(p, res);
    const c = computeConnectivity(q);
    expect([...c.nets.values()].filter((n) => !n.complete).map((n) => q.nets[n.netId].name)).toEqual([]);
    expect(res.wires.length).toBe(0);
    const d = runDrc(q);
    expect(d.markers.filter((m) => m.severity === 'error').map((m) => m.message)).toEqual([]);
  });
});
