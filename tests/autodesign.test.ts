import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseProjectFile } from '../src/core/io/project-file';
import { netsByRole } from '../src/core/model/net-roles';
import { autoplace, applyPlacement } from '../src/core/place/autoplace';
import { startVariantSearch } from '../src/core/router/client';
import { applyRoleClasses, applyVariant, defaultSearchOptions, planVariant, runVariant, type VariantResult } from '../src/core/router/variants';
import { autoroute } from '../src/core/router/autoroute';
import { addComponent, addTrack, addVia, addWire, clearRouting, connectPad, ensureNet } from '../src/core/model/edit';
import { createProject } from '../src/core/model/project';
import { libraryFootprint } from '../src/core/library';
import { computeConnectivity } from '../src/core/model/connectivity';
import { runDrc } from '../src/core/model/drc';
import type { Project } from '../src/core/model/types';

/*
 * Авторасстановка, роли цепей и перебор вариантов «расстановка + трассировка».
 * Тяжёлые прогоны (много вариантов, большие платы) — только в окне редактора; здесь —
 * быстрые проверки смысла: зоны, перекрытия, закреплённые детали, чистая разводка.
 */

function file(name: string): Project {
  const r = parseProjectFile(readFileSync(name, 'utf8'));
  if (r.kind !== 'project') throw new Error('не проект');
  return r.project;
}

/** Маленькая односторонняя плата: DIP-8 и четыре резистора вразброс, одна цепь земли. */
function small(): Project {
  const p = createProject({ width: 50, height: 36, copperLayers: 1 });
  const dip = libraryFootprint('DIP-8_W7.62mm')!;
  const r = libraryFootprint('R_Axial_0.25W_L6.3mm_D2.5mm_P10.16mm_Horizontal')!;
  const u1 = addComponent(p, dip, { x: 10, y: 10 }, { ref: 'U1' });
  const rs = [
    [40, 30],
    [40, 8],
    [12, 30],
    [26, 18],
  ].map(([x, y], i) => addComponent(p, r, { x, y }, { ref: `R${i + 1}` }));
  const gnd = ensureNet(p, 'GND', { netClass: 'Power' });
  ['A', 'B', 'C', 'D'].forEach((name, i) => {
    const n = ensureNet(p, name);
    connectPad(p, u1.id, String(i + 1 === 4 ? 5 : i + 1), n.id);
    connectPad(p, rs[i].id, '1', n.id);
    connectPad(p, rs[i].id, '2', gnd.id);
  });
  connectPad(p, u1.id, '4', gnd.id);
  return structuredClone(p);
}

function withRouting(p: Project, v: Pick<VariantResult, 'tracks' | 'vias' | 'wires'>): Project {
  const q = structuredClone(p);
  for (const t of v.tracks) addTrack(q, t);
  for (const x of v.vias) addVia(q, x);
  for (const w of v.wires) addWire(q, w.a, w.b);
  return structuredClone(q);
}

describe('роли цепей', () => {
  test('угадываются по классу, имени и деталям', () => {
    const q = netsByRole(file('import/quasar-avr-desalex.plata.json'));
    const name = (p: Project, ids: string[]) => ids.map((id) => p.nets[id].name);
    const qp = file('import/quasar-avr-desalex.plata.json');
    expect(name(qp, q.noisy)).toEqual(expect.arrayContaining(['XTAL1', 'XTAL2', 'GATE_N', 'TX_DRV']));
    expect(name(qp, q.sensitive)).toEqual(expect.arrayContaining(['ADC_IN', 'OA_IN+']));
    expect(name(qp, q.power)).toEqual(expect.arrayContaining(['GND', '+5V']));
    expect(q.hv).toEqual([]);
    const vp = file('import/vacuum-esp32.plata.json');
    const v = netsByRole(vp);
    expect(name(vp, v.hv)).toEqual(expect.arrayContaining(['L', 'N', 'M1_SW', 'G1']));
    expect(name(vp, v.hv)).not.toContain('GND');
    expect(name(vp, v.sensitive)).toEqual(expect.arrayContaining(['NTC1', 'CT1', 'VAC']));
  });

  test('роль, заданная вручную, главнее угаданной; роли → классы цепей', () => {
    const p = small();
    const a = Object.values(p.nets).find((n) => n.name === 'A')!;
    p.nets[a.id].role = 'hv';
    const roles = netsByRole(p);
    expect(roles.hv).toEqual([a.id]);
    const changes = applyRoleClasses(p, { roles, use: { hv: true, power: true, noise: true } });
    expect(changes.join(' ')).toMatch(/Mains/);
    expect(p.nets[a.id].netClass).toBe('Mains');
    expect(p.rules.classClearances).toEqual([{ a: 'Mains', b: '*', clearance: 6 }]);
  });
});

describe('авторасстановка', () => {
  test('плата на выводных деталях: оптроны развёрнуты в свою зону, перекрытий нет, пересечений меньше', async () => {
    const p = file('import/plata-dip.plata.json');
    // Одну деталь закрепляем — она не должна сдвинуться.
    const fixed = Object.values(p.components).find((c) => c.ref === 'R1')!;
    p.components[fixed.id].locked = true;
    const res = await autoplace(p, { seed: 3, effort: 0.6 });
    expect(res.before.zone).toBeGreaterThan(0);
    expect(res.after.zone).toBe(0);
    expect(res.after.overlap).toBe(0);
    expect(res.after.crossings).toBeLessThan(res.before.crossings);
    expect(res.moves.length).toBeGreaterThan(10);
    expect(res.moves.some((m) => m.id === fixed.id)).toBe(false);
    // Повторяемость: то же семя — та же расстановка.
    const again = await autoplace(file('import/plata-dip.plata.json'), { seed: 3, effort: 0.2 });
    const again2 = await autoplace(file('import/plata-dip.plata.json'), { seed: 3, effort: 0.2 });
    expect(again.moves).toEqual(again2.moves);
  });

  test('маленькая плата: расстановка и разводка на одной стороне без перемычек и ошибок', async () => {
    const p = small();
    const res = await autoplace(p, { seed: 1, effort: 1 });
    applyPlacement(p, res.moves);
    const q = structuredClone(p);
    const r = await autoroute(q, { iterations: 20, yieldEvery: 1000 });
    const done = withRouting(q, r);
    expect(computeConnectivity(done).unrouted).toBe(0);
    expect(r.wires.length).toBe(0);
    expect(runDrc(done).markers.filter((m) => m.severity === 'error').map((m) => m.message)).toEqual([]);
    // Дорожки идут и под 45°.
    const diag = r.tracks.some((t) => t.points.some((a, i) => i > 0 && Math.abs(Math.abs(a.x - t.points[i - 1].x) - Math.abs(a.y - t.points[i - 1].y)) < 1e-6 && a.x !== t.points[i - 1].x));
    expect(diag).toBe(true);
  });
});

describe('перебор вариантов', () => {
  test('вариант «расстановка с нуля + трассировка»: всё разведено, без ошибок; применяется к проекту', async () => {
    const p = small();
    const o = { ...defaultSearchOptions(p), place: true };
    const job = planVariant(2, p, o);
    expect(job.start).toBe('scratch');
    const v = await runVariant(p, o, job);
    expect(v.stats.unrouted).toBe(0);
    expect(v.stats.drc).toBe(0);
    expect(v.moves.length).toBeGreaterThan(0);
    const q = structuredClone(p);
    applyVariant(q, o, v);
    const c = computeConnectivity(structuredClone(q));
    expect(c.unrouted).toBe(0);
  });

  test('без воркеров перебор идёт по очереди; двусторонние варианты — по желанию', async () => {
    const p = small();
    clearRouting(p);
    const o = { ...defaultSearchOptions(p), tryTwoLayers: true };
    const got: VariantResult[] = [];
    const s = startVariantSearch(p, o, { timeMs: 120_000, maxVariants: 4, onResult: (r) => got.push(r) });
    await s.promise;
    expect(got.map((r) => r.index).sort()).toEqual([0, 1, 2, 3]);
    expect(got.find((r) => r.index === 3)!.layers).toBe(2);
    expect(got.every((r) => r.stats.unrouted === 0)).toBe(true);
  });
});
