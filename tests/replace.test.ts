import { describe, expect, test } from 'vitest';
import { produce } from 'immer';
import { libraryFootprint, libraryFootprints } from '../src/core/library';
import { addComponent, connectPad, ensureNet } from '../src/core/model/edit';
import { createProject } from '../src/core/model/project';
import { pinKey, refPrefix, replaceFootprints, replaceGroups, replacementCandidates, typeName } from '../src/core/model/replace';
import { EXAMPLES } from '../src/core/examples';

describe('массовая замена корпусов', () => {
  test('обозначения и типы', () => {
    expect(refPrefix('R12')).toBe('R');
    expect(refPrefix('VT3')).toBe('VT');
    expect(typeName('VT')).toBe('Транзисторы');
    expect(typeName('C')).toBe('Конденсаторы');
    expect(typeName('ZZ')).toBe('Прочие (ZZ)');
  });

  test('все резисторы 0805 → 1206: цепи и положение сохраняются', () => {
    const p = createProject({ width: 60, height: 40 });
    const r0805 = libraryFootprint('R_0805_2012Metric')!;
    const ids = [addComponent(p, r0805, { x: 10, y: 10 }).id, addComponent(p, r0805, { x: 20, y: 10 }).id];
    const c = addComponent(p, libraryFootprint('C_0805_2012Metric')!, { x: 30, y: 10 });
    const n = ensureNet(p, 'A').id;
    connectPad(p, ids[0], '1', n);
    const q = structuredClone(p);
    const g = replaceGroups(q);
    const res = g.byType.find((x) => x.label === 'Резисторы')!;
    expect(res.components.map((x) => x.id).sort()).toEqual([...ids].sort());
    const { key, candidates } = replacementCandidates(q, ids, libraryFootprints());
    expect(key).toBe('1|2');
    const r1206 = candidates.find((f) => f.id === 'R_1206_3216Metric')!;
    expect(r1206).toBeTruthy();
    let out!: ReturnType<typeof replaceFootprints>;
    const q2 = produce(q, (d) => void (out = replaceFootprints(d, ids, r1206)));
    expect(out.changed).toHaveLength(2);
    expect(q2.components[ids[0]].footprint).toBe('R_1206_3216Metric');
    expect(q2.components[ids[0]].padNets['1']).toBe(n);
    expect(q2.components[ids[0]].at).toEqual({ x: 10, y: 10 });
    expect(q2.components[c.id].footprint).toBe('C_0805_2012Metric');
    // Старый корпус больше не нужен — убран из проекта.
    expect(q2.footprints['R_0805_2012Metric']).toBeUndefined();
  });

  test('детали с разными выводами вместе не заменить', () => {
    const p = EXAMPLES[0].create();
    const ids = Object.values(p.components).slice(0, 40).map((c) => c.id);
    const keys = new Set(ids.map((id) => pinKey(p.footprints[p.components[id].footprint])));
    if (keys.size > 1) expect(replacementCandidates(p, ids, libraryFootprints()).key).toBeNull();
  });
});
