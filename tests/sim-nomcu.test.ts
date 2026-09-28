import { describe, expect, test } from 'vitest';
import { example555Blink, exampleMotorPwm, examplePsu12, exampleRelay, exampleRunningLights } from '../src/core/examples/sim-circuits';
import { findMcu } from '../src/core/sim/circuit';
import { Simulation } from '../src/core/sim';
import { detectKind } from '../src/core/sim/analog/kinds';
import type { Project } from '../src/core/model/types';

/*
 * Симуляция схем без контроллера: примеры из «Шаблоны → Примеры» — мигалка на 555, блок
 * питания от сети, ШИМ двигателя, реле, бегущие огни. Проверяется физика (частота 555,
 * напряжения, обороты), нажатия и ручные модели деталей.
 */

const volts = (sim: Simulation, p: Project, name: string) => sim.analog!.netVolts(Object.values(p.nets).find((n) => n.name === name)!.id)!;
const ref = (sim: Simulation, r: string) => sim.devices.find((d) => d.comp.ref === r)!;

describe('симуляция без контроллера', () => {
  test('мигалка на NE555: частота по формуле, светодиод мигает, выключатель', () => {
    const p = example555Blink();
    expect(findMcu(p)).toBeNull();
    const sim = Simulation.createSync(p, { analogDt: 20e-6 });
    expect(sim.noMcu).toBe(true);
    expect(sim.analog).not.toBeNull();
    // Выключатель в положении 1–2 (выключено): питания на VCC нет.
    sim.run(sim.mcu.freq * 0.2);
    expect(volts(sim, p, 'VCC')).toBeLessThan(0.5);
    // Включить касанием.
    const sw = ref(sim, 'SW1');
    sim.press(sw.id, true);
    sim.press(sw.id, false);
    sim.run(sim.mcu.freq * 0.1);
    expect(volts(sim, p, 'VCC')).toBeGreaterThan(8.5);
    // Мигание: считаем фронты OUT за 4 с (первый период длиннее — конденсатор от нуля).
    sim.run(sim.mcu.freq * 1.5);
    let edges = 0;
    let prev = volts(sim, p, 'OUT') > 4.5;
    let lit = 0;
    let dark = 0;
    for (let i = 0; i < 400; i++) {
      sim.run(sim.mcu.freq * 0.01);
      const hi = volts(sim, p, 'OUT') > 4.5;
      if (hi && !prev) edges++;
      prev = hi;
      const led = sim.view().devices.find((d) => d.ref === 'LED1')!;
      if (led.on) lit++;
      else dark++;
    }
    // f = 1,44/((10k + 2·68k)·10 мкФ) ≈ 0,99 Гц: за 4 с — 4 фронта (±1).
    expect(edges).toBeGreaterThanOrEqual(3);
    expect(edges).toBeLessThanOrEqual(5);
    expect(lit).toBeGreaterThan(50);
    expect(dark).toBeGreaterThan(50);
  });

  test('блок питания: сеть 230 В, трансформатор, мост, 7812 держит 12 В; КЗ сжигает предохранитель', () => {
    const p = examplePsu12();
    const sim = Simulation.createSync(p, { analogDt: 20e-6 });
    sim.run(sim.mcu.freq * 0.5);
    const raw = volts(sim, p, 'RAW');
    expect(raw).toBeGreaterThan(14);
    expect(raw).toBeLessThan(26);
    expect(volts(sim, p, 'OUT12')).toBeGreaterThan(11.6);
    expect(volts(sim, p, 'OUT12')).toBeLessThan(12.4);
    expect(sim.view().devices.find((d) => d.ref === 'LED1')!.on).toBe(true);
    // Нагрузка 1 Ом — перегрузка: предохранитель 100 мА по первичке сгорает, выход пропадает.
    const load = sim.analog!.parts.find((x) => x.comp.ref === 'X2')!;
    load.set('r', 1);
    sim.run(sim.mcu.freq * 1.5);
    const fuse = sim.analog!.parts.find((x) => x.comp.ref === 'F1')!;
    expect(fuse.readings().find((r) => r.label === 'состояние')!.unit).toBe('СГОРЕЛ');
    sim.run(sim.mcu.freq * 0.5);
    expect(volts(sim, p, 'OUT12')).toBeLessThan(2);
  });

  test('ШИМ на 555: потенциометр меняет обороты двигателя', () => {
    const p = exampleMotorPwm();
    const sim = Simulation.createSync(p, { analogDt: 2e-6 });
    const pot = sim.analog!.parts.find((x) => x.comp.ref === 'RP1')!;
    const motor = sim.analog!.parts.find((x) => x.comp.ref === 'M1')!;
    const rpm = () => motor.readings().find((r) => r.label === 'обороты')!.value;
    // Разгон быстрый, а однотактный ШИМ не тормозит (только трение): сначала малые обороты, потом большие.
    pot.set('pos', 15);
    sim.run(sim.mcu.freq * 0.8);
    const slow = rpm();
    pot.set('pos', 85);
    sim.run(sim.mcu.freq * 0.5);
    const fast = rpm();
    expect(fast).toBeGreaterThan(1000);
    expect(slow).toBeGreaterThan(50);
    expect(fast).toBeGreaterThan(slow * 1.5);
    // Частота ШИМ ≈ 1,44/(R·C): 1 кОм + 100 кОм, 10 нФ → около 1,4 кГц.
    const hz = sim.analog!.parts.find((x) => x.comp.ref === 'U1')!.readings().find((r) => r.label === 'частота')!.value;
    expect(hz).toBeGreaterThan(900);
    expect(hz).toBeLessThan(2000);
  });

  test('реле: кнопка — транзистор — катушка — лампа; диод на катушке гасит выброс', () => {
    const p = exampleRelay();
    const sim = Simulation.createSync(p, { analogDt: 5e-6 });
    sim.run(sim.mcu.freq * 0.1);
    expect(volts(sim, p, 'LAMP')).toBeLessThan(0.5);
    expect(sim.view().devices.find((d) => d.ref === 'LED1')!.on).toBe(true);
    const btn = ref(sim, 'SB1');
    sim.press(btn.id, true);
    sim.run(sim.mcu.freq * 0.1);
    expect(volts(sim, p, 'LAMP')).toBeGreaterThan(11);
    expect(sim.view().devices.find((d) => d.ref === 'K1')!.channels![0]).toBe(true);
    sim.press(btn.id, false);
    let peak = 0;
    for (let i = 0; i < 200; i++) {
      sim.run(sim.mcu.freq * 0.0001);
      peak = Math.max(peak, volts(sim, p, 'COIL'));
    }
    // С диодом выброс на коллекторе — не выше питания + падение на диоде.
    expect(peak).toBeLessThan(14);
    sim.run(sim.mcu.freq * 0.1);
    expect(volts(sim, p, 'LAMP')).toBeLessThan(0.5);
  });

  test('реле без диода (модель «не участвует»): выброс на катушке в десятки вольт', () => {
    const p = exampleRelay();
    const d = Object.values(p.components).find((c) => c.ref === 'VD1')!;
    d.sim = { model: 'none' };
    const sim = Simulation.createSync(structuredClone(p), { analogDt: 1e-6 });
    const btn = ref(sim, 'SB1');
    sim.press(btn.id, true);
    sim.run(sim.mcu.freq * 0.05);
    sim.press(btn.id, false);
    let peak = 0;
    for (let i = 0; i < 300; i++) {
      sim.run(sim.mcu.freq * 0.00002);
      peak = Math.max(peak, volts(sim, sim.project, 'COIL'));
    }
    // Выброс ограничен пробоем коллектор—эмиттер BC547 (45 В).
    expect(peak).toBeGreaterThan(30);
    expect(peak).toBeLessThan(70);
  });

  test('бегущие огни: CD4017 по тактам 555 зажигает светодиоды по очереди', () => {
    const p = exampleRunningLights();
    const sim = Simulation.createSync(p, { analogDt: 10e-6 });
    const seen = new Set<string>();
    for (let i = 0; i < 80; i++) {
      sim.run(sim.mcu.freq * 0.02);
      const on = sim.view().devices.filter((d) => /^LED\d/.test(d.ref) && (d.brightness ?? 0) > 0.25).map((d) => d.ref);
      expect(on.length).toBeLessThanOrEqual(1);
      for (const r of on) seen.add(r);
    }
    expect(seen.size).toBeGreaterThanOrEqual(4);
  });

  test('ручная модель: клеммник — источник питания, параметры из свойств детали', () => {
    const p = example555Blink();
    const gb = Object.values(p.components).find((c) => c.ref === 'GB1')!;
    // Клеммник без модели — не участвует; GB1 угадывается как батарея по обозначению.
    expect(detectKind({ ...gb, ref: 'X9', sim: undefined }, p.footprints[gb.footprint])).toBeNull();
    expect(detectKind({ ...gb, sim: undefined }, p.footprints[gb.footprint])).toBe('battery');
    gb.sim = { model: 'source', params: { volts: 5 } };
    const sim = Simulation.createSync(structuredClone(p), { analogDt: 20e-6 });
    sim.press(ref(sim, 'SW1').id, true);
    sim.run(sim.mcu.freq * 0.1);
    expect(volts(sim, sim.project, 'VCC')).toBeCloseTo(5, 0);
  });

  test('генератор из настроек проекта: синус на цепи, частота и амплитуда', () => {
    const p = example555Blink();
    const tim = Object.values(p.nets).find((n) => n.name === 'CTRL')!;
    p.sim = { sources: [{ id: 'g1', net: tim.id, wave: 'sine', volts: 1, offset: 2, freq: 1000, ohms: 1 }] };
    const sim = Simulation.createSync(structuredClone(p), { analogDt: 5e-6 });
    let lo = 99;
    let hi = -99;
    for (let i = 0; i < 400; i++) {
      sim.run(sim.mcu.freq * 0.000005);
      const v = volts(sim, sim.project, 'CTRL');
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    expect(hi).toBeCloseTo(3, 0);
    expect(lo).toBeCloseTo(1, 0);
  });
});
