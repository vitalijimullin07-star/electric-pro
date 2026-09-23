import { describe, expect, test } from 'vitest';
import { EXAMPLES } from '../src/core/examples';
import { computeConnectivity } from '../src/core/model/connectivity';
import { runDrc } from '../src/core/model/drc';
import { convertLegacyBoard } from '../src/core/io/legacy-plata';
import { VACUUM_BOARD } from '../src/core/examples/vacuum-controller/board';

describe('плата пылесоса', () => {
  const r = convertLegacyBoard(VACUUM_BOARD);
  const p = r.project;

  test('все компоненты легли на библиотечные корпуса', () => {
    expect(r.customFootprints).toEqual([]);
    expect(Object.keys(p.components).length).toBe(VACUUM_BOARD.comps.length + 4);
    expect(Object.keys(p.nets).length).toBe(VACUUM_BOARD.nets.length);
  });

  test('готовая разводка: все цепи соединены, замыканий нет', () => {
    const c = computeConnectivity(p);
    const bad = [...c.nets.values()].filter((n) => !n.complete).map((n) => `${p.nets[n.netId].name}: ${n.islands.length}`);
    expect(bad).toEqual([]);
    expect(c.shorts).toEqual([]);
    expect(c.unrouted).toBe(0);
    expect(Object.keys(p.tracks).length).toBeGreaterThan(100);
    expect(Object.keys(p.wires).length).toBe(31);
  });

  test('проверка правил без ошибок', () => {
    const d = runDrc(p);
    const errors = d.markers.filter((m) => m.severity === 'error').map((m) => `${m.code}: ${m.message} @ ${m.at.x},${m.at.y}`);
    expect(errors).toEqual([]);
  });

  test('пример открывается', () => {
    const ex = EXAMPLES[0].create();
    expect(ex.meta.name).toBe(VACUUM_BOARD.title);
    expect(ex.board.copperLayers).toBe(1);
  });
});
