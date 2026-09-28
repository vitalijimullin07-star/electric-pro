import { describe, expect, test } from 'vitest';
import { Capacitor, CoupledCoils, Engine, GND, Inductor, Resistor, Switch, VSource } from '../src/core/sim/analog/engine';
import { Bjt, build555, buildMosfet, buildMotor, buildOpAmp, Diode, McuPinEl, Regulator, Tl431 } from '../src/core/sim/analog/elements';
import { factor } from '../src/core/sim/analog/solver';

/*
 * Аналоговый расчёт сверяется с теорией: заряд RC, резонанс RLC и его добротность,
 * выпрямитель, неинвертирующий усилитель, 555 в автоколебательном режиме, полумост на
 * MOSFET, трансформатор, стабилизатор с просадкой, транзисторный ключ, двигатель.
 */

function eng(dt = 1e-6): Engine {
  const e = new Engine();
  e.dt = dt;
  e.noise = false;
  return e;
}

/** Амплитуда (половина размаха) за последние n шагов. */
function amplitude(e: Engine, read: () => number, steps: number): number {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < steps; i++) {
    e.step();
    const x = read();
    lo = Math.min(lo, x);
    hi = Math.max(hi, x);
  }
  return (hi - lo) / 2;
}

describe('решатель', () => {
  test('разреженное LU совпадает с решением', () => {
    const n = 5;
    const a = new Float64Array([4, -1, 0, 0, -1, -1, 4, -1, 0, 0, 0, -1, 4, -1, 0, 0, 0, -1, 4, -1, -1, 0, 0, -1, 4]);
    const f = factor(a, n)!;
    const b = new Float64Array([1, 2, 3, 4, 5]);
    const x = new Float64Array(n);
    f.solve(b.slice(), x);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = 0; j < n; j++) s += a[i * n + j] * x[j];
      expect(s).toBeCloseTo(b[i], 9);
    }
  });
});

describe('линейные цепи', () => {
  test('RC: за τ — 63 % напряжения', () => {
    const e = eng(1e-6);
    const a = e.node('a');
    const out = e.node('out');
    e.add(new VSource('V', a, GND, 5, 0.001));
    e.add(new Resistor('R', a, out, 1000));
    e.add(new Capacitor('C', out, GND, 1e-6));
    e.advanceTo(1e-3); // τ = 1 мс
    expect(e.volts(out) / 5).toBeCloseTo(1 - Math.exp(-1), 2);
    e.advanceTo(5e-3);
    expect(e.volts(out)).toBeGreaterThan(4.95);
  });

  test('последовательный RLC: резонанс на 1/(2π√LC), ток в резонансе U/R', () => {
    // L = 0,8 мГн, C = 0,47 мкФ (как контур TX «Квазара»): f0 ≈ 8,2 кГц.
    const L = 0.8e-3;
    const C = 0.47e-6;
    const f0 = 1 / (2 * Math.PI * Math.sqrt(L * C));
    const run = (f: number) => {
      const e = eng(0.5e-6);
      const a = e.node('a');
      const m = e.node('m');
      const k = e.node('k');
      const src = e.add(new VSource('V', a, GND, (t) => Math.sin(2 * Math.PI * f * t), 0.001));
      const r = e.add(new Resistor('R', a, m, 10));
      e.add(new Capacitor('C', m, k, C));
      e.add(new Inductor('L', k, GND, L));
      void src;
      e.advanceTo(20 / f);
      return amplitude(e, () => r.currents(e.x)[0], Math.round(2 / f / e.dt));
    };
    expect(f0).toBeGreaterThan(8000);
    expect(f0).toBeLessThan(8300);
    const i0 = run(f0);
    expect(i0).toBeCloseTo(0.1, 2); // 1 В / 10 Ом
    // Добротность Q = ωL/R ≈ 4,1: на ±20 % частоты ток заметно меньше.
    expect(run(f0 * 1.2)).toBeLessThan(i0 * 0.7);
    expect(run(f0 * 0.8)).toBeLessThan(i0 * 0.7);
  });

  test('трансформатор 10:1 (связь 0,999): вторичка — десятая часть', () => {
    const e = eng(2e-6);
    const a = e.node('a');
    const s = e.node('s');
    e.add(new VSource('V', a, GND, (t) => 10 * Math.sin(2 * Math.PI * 50 * t), 0.01));
    e.add(new CoupledCoils('T', [{ a, b: GND, henry: 10, name: 'I' }, { a: s, b: GND, henry: 0.1, name: 'II' }], [[1, 0.999], [0, 1]]));
    e.add(new Resistor('Rн', s, GND, 1000));
    e.advanceTo(0.06);
    expect(amplitude(e, () => e.volts(s), 20_000)).toBeCloseTo(1, 1);
  });
});

describe('полупроводники', () => {
  test('однополупериодный выпрямитель: пик минус падение на диоде', () => {
    const e = eng(5e-6);
    const a = e.node('a');
    const k = e.node('k');
    e.add(new VSource('V', a, GND, (t) => 10 * Math.sin(2 * Math.PI * 50 * t), 0.01));
    e.add(new Diode('D', a, k, { vf: 0.7, rd: 0.05 }));
    e.add(new Resistor('R', k, GND, 1000));
    let hi = -Infinity;
    let lo = Infinity;
    for (let i = 0; i < 8000; i++) {
      e.step();
      hi = Math.max(hi, e.volts(k));
      lo = Math.min(lo, e.volts(k));
    }
    expect(hi).toBeCloseTo(9.3, 1);
    expect(lo).toBeGreaterThan(-0.01);
  });

  test('неинвертирующий усилитель на ОУ: 1 + R2/R1, упор в питание', () => {
    const e = eng(1e-6);
    const vcc = e.node('vcc');
    const inp = e.node('in');
    const out = e.node('out');
    const fb = e.node('fb');
    e.add(new VSource('Vcc', vcc, GND, 5, 0.01));
    const src = e.add(new VSource('Vin', inp, GND, 0.1, 0.01));
    buildOpAmp(e, 'U1', inp, fb, out, vcc, GND, { a0: 1e5, gbw: 2.8e6, hrHi: 0.025, hrLo: 0.025, rout: 50, en: 0 });
    e.add(new Resistor('R2', out, fb, 9000));
    e.add(new Resistor('R1', fb, GND, 1000));
    e.advanceTo(2e-3);
    expect(e.volts(out)).toBeCloseTo(1, 2);
    src.volts = 1; // ×10 = 10 В — упор в питание 5 В
    e.invalidate();
    e.advanceTo(4e-3);
    expect(e.volts(out)).toBeGreaterThan(4.9);
    expect(e.volts(out)).toBeLessThan(5.01);
  });

  test('555: частота 1,44/((R1+2R2)·C), скважность', () => {
    const e = eng(2e-6);
    const vcc = e.node('vcc');
    const n = { trig: e.node('trig'), out: e.node('out'), ctrl: e.node('ctrl'), dis: e.node('dis') };
    e.add(new VSource('V', vcc, GND, 9, 0.01));
    const t = build555(e, 'U1', { vcc, gnd: GND, trig: n.trig, thr: n.trig, ctrl: n.ctrl, reset: vcc, out: n.out, dis: n.dis }, false);
    e.add(new Resistor('R1', vcc, n.dis, 1000));
    e.add(new Resistor('R2', n.dis, n.trig, 10000));
    e.add(new Capacitor('C', n.trig, GND, 100e-9));
    e.add(new Capacitor('Cctrl', n.ctrl, GND, 10e-9));
    e.advanceTo(0.01);
    // Период: считаем фронты выхода за 20 мс.
    let edges = 0;
    let prev = t.q;
    let high = 0;
    const steps = Math.round(0.02 / e.dt);
    for (let i = 0; i < steps; i++) {
      e.step();
      if (t.q && !prev) edges++;
      if (t.q) high++;
      prev = t.q;
    }
    const f = edges / 0.02;
    const expected = 1.44 / ((1000 + 2 * 10000) * 100e-9); // ≈ 686 Гц
    expect(Math.abs(f - expected) / expected).toBeLessThan(0.05);
    // Скважность: (R1+R2)/(R1+2R2) ≈ 52 %.
    expect(high / steps).toBeCloseTo(11000 / 21000, 1);
  });

  test('полумост на MOSFET в контур LC: ток и паразитные диоды', () => {
    const e = eng(0.5e-6);
    const vcc = e.node('vcc');
    const g = e.node('g');
    const mid = e.node('mid');
    const c = e.node('c');
    e.add(new VSource('V', vcc, GND, 5, 0.01));
    const f = 8200;
    e.add(new VSource('драйвер', g, GND, (t) => ((t * f) % 1 < 0.5 ? 5 : 0), 10));
    buildMosfet(e, 'Qn', mid, g, GND, { type: 'n', vth: 3, ron: 0.85, cgs: 1e-9 });
    buildMosfet(e, 'Qp', mid, g, vcc, { type: 'p', vth: 3, ron: 0.5, cgs: 1e-9 });
    const r = e.add(new Resistor('R', mid, c, 10));
    const k = e.node('k');
    e.add(new Capacitor('C', c, k, 0.47e-6));
    e.add(new Inductor('L', k, GND, 0.8e-3));
    e.advanceTo(3e-3);
    const i = amplitude(e, () => r.currents(e.x)[0], 400);
    // Первая гармоника меандра 0…5 В: 4/π·2,5 ≈ 3,18 В; в резонансе ток ≈ 3,18/(10+0,7) ≈ 0,3 А.
    expect(i).toBeGreaterThan(0.2);
    expect(i).toBeLessThan(0.4);
  });

  test('стабилизатор: 5 В, при низком входе — вход минус перепад', () => {
    const e = eng(10e-6);
    const vin = e.node('in');
    const out = e.node('out');
    const src = e.add(new VSource('V', vin, GND, 12, 0.05));
    e.add(new Regulator('U', vin, GND, out, { vout: 5, vdrop: 0.4, rout: 0.05, iq: 1e-3 }));
    e.add(new Capacitor('C', out, GND, 10e-6));
    e.add(new Resistor('Rн', out, GND, 50));
    e.advanceTo(5e-3);
    expect(e.volts(out)).toBeCloseTo(5, 1);
    src.volts = 4;
    e.invalidate();
    e.advanceTo(10e-3);
    expect(e.volts(out)).toBeCloseTo(3.6, 1);
  });

  test('TL431 с REF на катоде — 2,5 В; транзисторный ключ в насыщении', () => {
    const e = eng(10e-6);
    const vcc = e.node('vcc');
    const ref = e.node('ref');
    e.add(new VSource('V', vcc, GND, 5, 0.01));
    e.add(new Resistor('R', vcc, ref, 1200));
    e.add(new Tl431('U2', ref, GND, ref));
    const b = e.node('b');
    const c = e.node('c');
    const drv = e.node('drv');
    e.add(new VSource('драйвер', drv, GND, 5, 0.01));
    e.add(new Resistor('Rб', drv, b, 1000));
    e.add(new Resistor('Rк', vcc, c, 100));
    const q = e.add(new Bjt('Q', c, b, GND, { type: 'npn', beta: 200, vbe: 0.65, rbe: 50, vcesat: 0.15, rsat: 1 }));
    e.advanceTo(1e-3);
    expect(e.volts(ref)).toBeCloseTo(2.5, 1);
    expect(q.st).toBe(2);
    expect(e.volts(c)).toBeLessThan(0.3);
  });

  test('вывод контроллера и кнопка: подтяжка и замыкание', () => {
    const e = eng(10e-6);
    const n = e.node('in');
    const pin = e.add(new McuPinEl('PD2', n, 5));
    pin.mode = 'pullup';
    e.kick();
    const sw = e.add(new Switch('SW', n, GND, false));
    e.advanceTo(1e-3);
    expect(e.volts(n)).toBeCloseTo(5, 1);
    sw.closed = true;
    e.kick();
    e.advanceTo(2e-3);
    expect(e.volts(n)).toBeLessThan(0.01);
  });

  test('двигатель: скорость холостого хода ≈ U/k, пусковой ток ≈ U/R', () => {
    const e = eng(20e-6);
    const a = e.node('a');
    e.add(new VSource('V', a, GND, 12, 0.01));
    const m = buildMotor(e, 'M1', a, GND, { r: 1, l: 1e-3, k: 0.02, j: 1e-5, b: 1e-6, load: 0 });
    e.step();
    e.step();
    e.advanceTo(0.2e-3);
    expect(m.ind.i).toBeGreaterThan(1);
    e.advanceTo(1);
    // ω = U/k минус трение: 600 рад/с ≈ 5730 об/мин.
    expect(m.rpm).toBeGreaterThan(5000);
    expect(m.rpm).toBeLessThan(5800);
  });
});
