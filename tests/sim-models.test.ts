import { describe, expect, test } from 'vitest';
import { Builder, exampleRelay, FP, fpById } from '../src/core/examples/sim-circuits';
import { diodeVrrm, resistorWatts } from '../src/core/sim/analog/parts';
import { Simulation } from '../src/core/sim';
import type { Project } from '../src/core/model/types';

/*
 * Модели деталей без контроллера по одной-две в схеме: оптосимистор и симистор в сети,
 * мостовой драйвер, ключи Дарлингтона, логика, оптрон, стабилитрон, DC-DC, NTC с
 * компаратором, датчик Холла. Проверяются режимы, а не точные цифры.
 */

const T2 = FP.terminal2;
const R = FP.resistor;
const LED = FP.led;
const volts = (sim: Simulation, name: string) => sim.analog!.netVolts(Object.values(sim.project.nets).find((n) => n.name === name)!.id)!;
const part = (sim: Simulation, ref: string) => sim.analog!.parts.find((x) => x.comp.ref === ref)!;
const reading = (sim: Simulation, ref: string, label: string) => part(sim, ref).readings().find((r) => r.label === label)!;
const dev = (sim: Simulation, ref: string) => sim.devices.find((d) => d.comp.ref === ref)!;
const led = (sim: Simulation, ref: string) => sim.view().devices.find((d) => d.ref === ref)!;
const sec = (sim: Simulation, s: number) => sim.run(sim.mcu.freq * s);

describe('модели деталей без контроллера', () => {
  test('сеть 230 В: кнопка → MOC3021 → BTA16 включает лампу 60 Вт', () => {
    const b = new Builder('Симистор', 100, 60);
    b.add(T2(), { ref: 'X1', value: 'Сеть 230 В' }, { '1': 'L', '2': 'N' });
    b.add(T2(), { ref: 'GB1', value: '5 В', sim: { model: 'battery' } }, { '1': '+5V', '2': 'GND' });
    b.add(fpById('SW_PUSH_6mm'), { ref: 'SB1', value: 'Вкл' }, { '1': '+5V', '3': 'BTN' });
    b.add(R(), { ref: 'R1', value: '330 Ом' }, { '1': 'BTN', '2': 'LED_A' });
    b.add(fpById('IC_MOC3021_DIP-6'), { ref: 'U1', value: 'MOC3021' }, { A: 'LED_A', K: 'GND', MT2: 'MT2', MT1: 'GATE' });
    b.add(R(), { ref: 'R2', value: '360 Ом' }, { '1': 'LOAD', '2': 'MT2' });
    b.add(fpById('Q_BTA16_TO-220'), { ref: 'VS1', value: 'BTA16-600' }, { T2: 'LOAD', T1: 'N', G: 'GATE' });
    b.add(T2(), { ref: 'EL1', value: 'Лампа 230 В 60 Вт', sim: { model: 'lamp' } }, { '1': 'L', '2': 'LOAD' });
    const sim = Simulation.createSync(b.done('тест'), { analogDt: 20e-6 });
    sec(sim, 0.2);
    const off = reading(sim, 'EL1', 'мощность').value;
    sim.press(dev(sim, 'SB1').id, true);
    sec(sim, 0.2);
    const on = reading(sim, 'EL1', 'мощность').value;
    expect(off).toBeLessThan(1);
    expect(on).toBeGreaterThan(45);
    expect(on).toBeLessThan(65);
    // Отпустили — симистор закрывается на ближайшем переходе тока через ноль.
    sim.press(dev(sim, 'SB1').id, false);
    sec(sim, 0.2);
    expect(reading(sim, 'EL1', 'мощность').value).toBeLessThan(1);
  });

  const bridge = (reverse: boolean): Project => {
    const b = new Builder('L293D', 100, 60);
    b.add(T2(), { ref: 'GB1', value: '9 В', sim: { model: 'battery' } }, { '1': '+9V', '2': 'GND' });
    b.add(fpById('REG_7805_TO-220'), { ref: 'DA1', value: 'LM7805' }, { IN: '+9V', GND: 'GND', OUT: '+5V' });
    b.add(fpById('SW_Slide_SS12D00'), { ref: 'SW1', value: 'Стоп' }, { '1': '+5V', '2': 'IN', '3': 'GND' });
    b.add(fpById('IC_L293D_DIP-16'), { ref: 'U1', value: 'L293D' }, { EN12: '+5V', IN1: reverse ? 'GND' : 'IN', IN2: reverse ? 'IN' : 'GND', OUT1: 'M+', OUT2: 'M-', '4': 'GND', '5': 'GND', VS: '+9V', VSS: '+5V' });
    b.add(T2(), { ref: 'M1', value: 'Двигатель 6 В', sim: { model: 'motor' } }, { '1': 'M+', '2': 'M-' });
    return b.done('тест');
  };

  test('L293D: двигатель крутится в обе стороны, при обоих входах в «0» тормозит', () => {
    const sim = Simulation.createSync(bridge(false), { analogDt: 10e-6 });
    const rpm = () => reading(sim, 'M1', 'обороты').value;
    sec(sim, 0.6);
    const fwd = rpm();
    expect(fwd).toBeGreaterThan(1000);
    // Оба входа в «0»: нижние ключи замыкают двигатель — ЭДС тормозит его быстрее, чем трение.
    sim.press(dev(sim, 'SW1').id, true);
    sim.press(dev(sim, 'SW1').id, false);
    sec(sim, 0.3);
    expect(rpm()).toBeLessThan(fwd * 0.6);
    const back = Simulation.createSync(bridge(true), { analogDt: 10e-6 });
    back.run(back.mcu.freq * 0.6);
    expect(back.analog!.parts.find((x) => x.comp.ref === 'M1')!.readings().find((r) => r.label === 'обороты')!.value).toBeLessThan(-1000);
  });

  test('ULN2003, 74HC00, PC817, стабилитрон: кнопка переключает всё сразу', () => {
    const b = new Builder('Логика', 120, 80);
    b.add(T2(), { ref: 'GB1', value: '12 В', sim: { model: 'battery' } }, { '1': '+12V', '2': 'GND' });
    b.add(fpById('REG_7805_TO-220'), { ref: 'DA1', value: 'LM7805' }, { IN: '+12V', GND: 'GND', OUT: '+5V' });
    b.add(fpById('SW_PUSH_6mm'), { ref: 'SB1', value: 'Кнопка' }, { '1': '+5V', '3': 'BTN' });
    b.add(R(), { ref: 'R1', value: '10 кОм' }, { '1': 'BTN', '2': 'GND' });
    b.add(fpById('IC_74HC00_DIP-14'), { ref: 'U1', value: '74HC00' }, { VCC: '+5V', GND: 'GND', '1A': 'BTN', '1B': '+5V', '1Y': 'NBTN' });
    b.add(R(), { ref: 'R3', value: '470 Ом' }, { '1': 'NBTN', '2': 'LED2_A' });
    b.add(LED(), { ref: 'LED2', value: 'зелёный' }, { A: 'LED2_A', K: 'GND' });
    b.add(fpById('IC_ULN2003_DIP-16'), { ref: 'U2', value: 'ULN2003A' }, { IN1: 'BTN', OUT1: 'LED1_K', GND: 'GND', COM: '+12V' });
    b.add(R(), { ref: 'R2', value: '1 кОм' }, { '1': '+12V', '2': 'LED1_A' });
    b.add(LED(), { ref: 'LED1', value: 'красный' }, { A: 'LED1_A', K: 'LED1_K' });
    b.add(R(), { ref: 'R4', value: '1 кОм' }, { '1': 'BTN', '2': 'OPT_A' });
    b.add(fpById('IC_PC817_DIP-4'), { ref: 'U3', value: 'PC817' }, { A: 'OPT_A', K: 'GND', C: 'OPT_C', E: 'GND' });
    b.add(R(), { ref: 'R5', value: '10 кОм' }, { '1': '+5V', '2': 'OPT_C' });
    b.add(R(), { ref: 'R6', value: '1 кОм' }, { '1': '+12V', '2': 'VZ' });
    b.add(FP.diode(), { ref: 'VD1', value: 'BZX55C5V1' }, { K: 'VZ', A: 'GND' });
    const sim = Simulation.createSync(b.done('тест'), { analogDt: 10e-6 });
    sec(sim, 0.05);
    expect(led(sim, 'LED1').on).toBe(false);
    expect(led(sim, 'LED2').on).toBe(true);
    expect(volts(sim, 'OPT_C')).toBeGreaterThan(4.5);
    expect(volts(sim, 'VZ')).toBeGreaterThan(4.8);
    expect(volts(sim, 'VZ')).toBeLessThan(5.4);
    sim.press(dev(sim, 'SB1').id, true);
    sec(sim, 0.05);
    expect(led(sim, 'LED1').on).toBe(true);
    expect(led(sim, 'LED2').on).toBe(false);
    expect(volts(sim, 'OPT_C')).toBeLessThan(0.5);
  });

  test('DC-DC 12→5 В с нагрузкой, NTC с компаратором LM358, датчик Холла', () => {
    const b = new Builder('Питание и датчики', 120, 80);
    b.add(T2(), { ref: 'GB1', value: '12 В', sim: { model: 'battery' } }, { '1': '+12V', '2': 'GND' });
    b.add(fpById('Module_LM2596_Buck'), { ref: 'A1', value: 'LM2596' }, { 'IN+': '+12V', 'IN-': 'GND', 'OUT+': '+5V', 'OUT-': 'GND' });
    b.add(T2(), { ref: 'X1', value: 'Нагрузка', sim: { model: 'load', params: { r: 10 } } }, { '1': '+5V', '2': 'GND' });
    b.add(fpById('R_NTC_D5mm_P2.5mm'), { ref: 'RK1', value: '10 кОм' }, { '1': '+5V', '2': 'T' });
    b.add(R(), { ref: 'R1', value: '10 кОм' }, { '1': 'T', '2': 'GND' });
    b.add(R(), { ref: 'R2', value: '10 кОм' }, { '1': '+5V', '2': 'REF' });
    b.add(R(), { ref: 'R3', value: '20 кОм' }, { '1': 'REF', '2': 'GND' });
    b.add(fpById('IC_LM358_DIP-8'), { ref: 'DA1', value: 'LM358' }, { 'IN1+': 'T', 'IN1-': 'REF', OUT1: 'HOT', VCC: '+5V', GND: 'GND' });
    b.add(fpById('SENS_A3144_TO-92'), { ref: 'DD1', value: 'A3144' }, { VCC: '+5V', GND: 'GND', OUT: 'HALL' });
    b.add(R(), { ref: 'R4', value: '10 кОм' }, { '1': '+5V', '2': 'HALL' });
    const sim = Simulation.createSync(b.done('тест'), { analogDt: 10e-6 });
    sec(sim, 0.05);
    expect(volts(sim, '+5V')).toBeGreaterThan(4.8);
    expect(volts(sim, '+5V')).toBeLessThan(5.1);
    // 5 В × 0,5 А / 12 В / КПД 0,88 ≈ 0,24 А со входа.
    const iin = reading(sim, 'A1', 'ток со входа').value;
    expect(iin).toBeGreaterThan(0.2);
    expect(iin).toBeLessThan(0.28);
    expect(volts(sim, 'HOT')).toBeLessThan(0.5);
    expect(volts(sim, 'HALL')).toBeGreaterThan(4.5);
    part(sim, 'RK1').set('temp', 60);
    part(sim, 'DD1').set('field', 30);
    sec(sim, 0.02);
    expect(volts(sim, 'T')).toBeGreaterThan(3.8);
    expect(volts(sim, 'HOT')).toBeGreaterThan(3);
    expect(volts(sim, 'HALL')).toBeLessThan(0.5);
  });

  test('ручки на ходу: пробой К—Э ограничивает выброс, перегрузка резистора, пробой диода, детали на цепи', () => {
    expect(diodeVrrm('1N4007')).toBe(1000);
    expect(diodeVrrm('1N4148')).toBe(100);
    expect(diodeVrrm('SS34')).toBe(40);
    expect(resistorWatts('R_Axial_0.125W_L3.3mm_D1.8mm_P5.08mm_Horizontal', '10 кОм')).toBe(0.125);
    expect(resistorWatts('R_0805_2012Metric', '1 кОм')).toBe(0.125);
    expect(resistorWatts('R_1206_3216Metric', '1 Ом 0,5 Вт')).toBe(0.5);

    const p = exampleRelay();
    p.components[Object.values(p.components).find((c) => c.ref === 'VD1')!.id].sim = { model: 'none' };
    const sim = Simulation.createSync(structuredClone(p), { analogDt: 1e-6 });
    const vt = part(sim, 'VT1');
    expect(vt.params.map((q) => q.key)).toEqual(['beta', 'vbe', 'vcesat', 'vceo']);
    vt.set('vceo', 30);
    sim.press(dev(sim, 'SB1').id, true);
    sec(sim, 0.05);
    // Резистор базы 100 Ом вместо 4,7 кОм: 1,3 Вт на корпусе 0,125 Вт — перегрузка в показаниях.
    const r1 = part(sim, 'R1');
    expect(r1.readings().some((r) => /ПЕРЕГРУЗКА/.test(r.label))).toBe(false);
    r1.set('r', 100);
    sec(sim, 0.01);
    expect(r1.readings().some((r) => /ПЕРЕГРУЗКА/.test(r.label))).toBe(true);
    sim.press(dev(sim, 'SB1').id, false);
    let peak = 0;
    for (let i = 0; i < 300; i++) {
      sim.run(sim.mcu.freq * 0.00002);
      peak = Math.max(peak, volts(sim, 'COIL'));
    }
    // Выброс упирается в пробой 30 В (плюс сопротивление лавины), а не в 45 В по умолчанию.
    expect(peak).toBeGreaterThan(25);
    expect(peak).toBeLessThan(40);
    // Детали на цепи COIL — коллектор транзистора и катушка реле.
    const coil = Object.values(sim.project.nets).find((n) => n.name === 'COIL')!.id;
    const refs = sim.analog!.partsOnNet(coil).map((x) => x.comp.ref);
    expect(refs).toContain('VT1');
    expect(refs).toContain('K1');
    // У диода с моделью — обратный пробой по названию (1N4007: 1000 В с запасом).
    const sim2 = Simulation.createSync(exampleRelay(), { analogDt: 5e-6 });
    const vbr = part(sim2, 'VD1').params.find((q) => q.key === 'vbr')!.value;
    expect(vbr).toBeCloseTo(1200, 0);
  });
});
