import { describe, expect, test } from 'vitest';
import { libraryFootprint } from '../src/core/library';
import { addComponent, addTrack, addVia, connectPad, ensureNet } from '../src/core/model/edit';
import { createProject } from '../src/core/model/project';
import { defaultFabProfile, dfmReportText, fabProfile, runDfm } from '../src/core/fab/dfm';
import { EXAMPLES } from '../src/core/examples';

describe('проверка для производства', () => {
  test('чистая плата: замечаний нет, параметры заказа посчитаны', () => {
    const p = createProject({ width: 50, height: 40 });
    const fp = libraryFootprint('R_0805_2012Metric')!;
    const r1 = addComponent(p, fp, { x: 10, y: 10 });
    const r2 = addComponent(p, fp, { x: 30, y: 10 });
    const a = ensureNet(p, 'A').id;
    connectPad(p, r1.id, '2', a);
    connectPad(p, r2.id, '1', a);
    addTrack(p, { layer: 'F.Cu', width: 0.25, points: [{ x: 10.95, y: 10 }, { x: 29.05, y: 10 }] });
    const r = runDfm(structuredClone(p), fabProfile('typical'));
    expect(r.issues.filter((i) => i.severity !== 'info')).toEqual([]);
    const o = Object.fromEntries(r.order.map((x) => [x.label, x.value]));
    expect(o['Размер']).toBe('50 × 40 мм');
    expect(o['Слоёв меди']).toBe('2');
    expect(o['Мин. дорожка']).toBe('0,25 мм');
    expect(o['Контур']).toBe('прямоугольник');
    expect(o['Детали']).toBe('SMD 2, выводных 0; сверху');
    expect(r.measured.pitch).toBeGreaterThan(1.5);
    expect(dfmReportText(p, r)).toContain('Параметры для заказа');
  });

  test('тонкая дорожка, малый зазор, мелкое отверстие и тонкий поясок — по профилю завода', () => {
    const p = createProject({ width: 50, height: 40 });
    // Дорожки без площадок остаются «без цепи» — зазор между ними всё равно меряется.
    addTrack(p, { layer: 'F.Cu', width: 0.12, points: [{ x: 5, y: 10 }, { x: 40, y: 10 }] });
    // Край к краю 0,12 мм: 10 + 0,06 + 0,12 + 0,1 = 10,28.
    addTrack(p, { layer: 'F.Cu', width: 0.2, points: [{ x: 5, y: 10.28 }, { x: 40, y: 10.28 }] });
    addVia(p, { at: { x: 20, y: 30 }, diameter: 0.5, drill: 0.25 });
    const q = structuredClone(p);
    const typical = runDfm(q, fabProfile('typical'));
    const msgs = typical.issues.map((i) => i.message).join('\n');
    expect(msgs).toMatch(/Дорожки 0,12 мм уже 0,15 мм: 1 шт\./);
    expect(msgs).toMatch(/Зазор 0,12 мм/);
    expect(msgs).toMatch(/Отверстия 0,25 мм меньше 0,3 мм/);
    expect(typical.measured.space).toBeCloseTo(0.12, 3);
    expect(typical.measured.track).toBe(0.12);
    // Класс 5 по ГОСТ: 0,1 мм можно, но отверстие не меньше 0,2 × 1,6 = 0,32 мм.
    const g5 = runDfm(q, fabProfile('gost5'));
    const m5 = g5.issues.map((i) => i.message).join('\n');
    expect(m5).not.toMatch(/Дорожки/);
    expect(m5).not.toMatch(/Зазор/);
    expect(m5).toMatch(/Отверстия 0,25 мм меньше 0,32 мм \(0,2 × толщина 1,6 мм\)/);
  });

  test('медь у края и отверстия вплотную', () => {
    const p = createProject({ width: 50, height: 40 });
    addTrack(p, { layer: 'B.Cu', width: 0.3, points: [{ x: 0.3, y: 5 }, { x: 0.3, y: 30 }] });
    addVia(p, { at: { x: 20, y: 20 }, diameter: 0.8, drill: 0.4 });
    addVia(p, { at: { x: 20.7, y: 20 }, diameter: 0.8, drill: 0.4 });
    const r = runDfm(structuredClone(p), fabProfile('typical'));
    const msgs = r.issues.map((i) => i.message).join('\n');
    expect(msgs).toMatch(/до края платы 0,15 мм/);
    expect(msgs).toMatch(/Между отверстиями .* 0,3 мм/);
    expect(r.drills).toEqual([{ d: 0.4, plated: true, count: 2 }]);
  });

  test('домашний профиль для самодельных правил и советы для ЛУТ', () => {
    const p = createProject({ width: 250, height: 200, homemade: true, copperLayers: 2 });
    expect(defaultFabProfile(p).id).toBe('home');
    addVia(p, { at: { x: 20, y: 20 }, diameter: 2, drill: 0.8 });
    const r = runDfm(structuredClone(p));
    const msgs = r.issues.map((i) => i.message).join('\n');
    expect(msgs).toMatch(/не помещается на лист A4/);
    expect(msgs).toMatch(/Переходных 1/);
    expect(r.order.find((o) => o.label === 'Маска')!.value).toMatch(/нет/);
  });

  test('плата пылесоса проверяется по всем профилям за разумное время', () => {
    const p = EXAMPLES[0].create();
    for (const id of ['typical', 'gost3', 'gost4', 'gost5', 'home']) {
      const r = runDfm(p, fabProfile(id));
      expect(r.order.length).toBeGreaterThan(10);
      expect(r.drills.reduce((s, d) => s + d.count, 0)).toBeGreaterThan(100);
    }
  });
});
