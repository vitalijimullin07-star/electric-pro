import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { layGeometry, layToProject, parseLay } from '../src/core/io/sprint-layout';
import { computeConnectivity } from '../src/core/model/connectivity';
import { runDrc } from '../src/core/model/drc';

const lay = () => new Uint8Array(readFileSync('tests/fixtures/quasar/quasar-desalex.lay'));

describe('Sprint Layout', () => {
  test('разбор файла пятой версии', () => {
    const f = parseLay(lay());
    expect(f.version).toBe(5);
    expect(f.unit).toBe(0.01);
    expect(f.boards).toHaveLength(1);
    const objs = f.boards[0].objects;
    expect(objs).toHaveLength(638);
    // Площадки, дорожки на меди снизу (слой 3), шелкография сверху (слой 2).
    expect(objs.filter((o) => o.type === 2)).toHaveLength(370);
    expect(objs.filter((o) => o.type === 6 && o.layer === 3)).toHaveLength(99);
  });

  test('миллиметры, ось Y вниз, шаг DIP 2,54 мм, контур из тонкой линии', () => {
    const g = layGeometry(parseLay(lay()));
    expect(g.outline).not.toBeNull();
    const xs = g.outline!.map((q) => q.x);
    const ys = g.outline!.map((q) => q.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(90.17, 1);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(53.34, 1);
    const row = g.pads.filter((p) => Math.abs(p.center.y - g.pads[0].center.y) < 0.01).map((p) => p.center.x).sort((a, b) => a - b);
    const steps = row.slice(1).map((x, i) => +(x - row[i]).toFixed(2));
    expect(steps).toContain(2.54);
    // Площадка DIP: диаметр 2,2 мм (в файле — радиус 110), отверстие 0,65 мм.
    expect(g.pads.some((p) => p.def.size.x === 2.2 && p.def.drill === 0.65)).toBe(true);
    // Контур — тонкая линия меди вокруг платы, в дорожки не попадает.
    expect(g.tracks).toHaveLength(98);
  });

  test('плата целиком: детали из групп, цепи по меди, всё разведено', () => {
    const r = layToProject(parseLay(lay()), { name: 'Квазар' });
    const p = r.project;
    expect(Object.keys(p.components).length).toBe(50);
    expect(Object.keys(p.tracks).length).toBe(98);
    expect(Object.keys(p.nets).length).toBeGreaterThan(30);
    expect(p.board.copperLayers).toBe(1);
    const conn = computeConnectivity(p);
    expect(conn.unrouted).toBe(0);
    expect(conn.shorts).toHaveLength(0);
    expect(runDrc(p).markers.filter((m) => m.code === 'short' || m.code === 'unrouted')).toHaveLength(0);
  });

  test('чужой файл — понятная ошибка', () => {
    expect(() => parseLay(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]))).toThrow(/Sprint Layout/);
    const bad = lay().slice(0, 2000);
    expect(() => parseLay(bad)).toThrow(/обрывается/);
  });
});
