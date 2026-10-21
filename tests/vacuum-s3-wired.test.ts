import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { WIRED_PINS, buildVacuumS3Wired } from '../src/core/examples/vacuum-s3/wired';
import { Simulation, bytesToBase64 } from '../src/core/sim';
import type { Esp32 } from '../src/core/sim/esp32';
import type { Device } from '../src/core/sim/devices';
import type { Project } from '../src/core/model/types';

/*
 * Пылесос S3 навесным монтажом (прошивка 6.1): блок питания 5 В, ноль и напряжение сети — ZMPT101B
 * через делитель на IO48 и IO7, термисторы — на АЦП ADS1115. Прошивка узнаёт это сама.
 */

const fw = { name: 'vacuum-s3.wasm', wasm: bytesToBase64(readFileSync('firmware/vacuum-s3/vacuum-s3.wasm')) };
const panelFw = { name: 'vacuum-panel.wasm', wasm: bytesToBase64(readFileSync('firmware/vacuum-panel/vacuum-panel.wasm')) };

const F_NO_ZC = 1;
const F_NTC1 = 1 << 5;
const F_MAINS = 1 << 16;

function start(edit?: (p: Project) => void) {
  const p = buildVacuumS3Wired(fw, panelFw);
  edit?.(p);
  const sim = Simulation.createSync(p);
  const sec = (s: number) => sim.run(Math.round(s * 1e6));
  const dev = (re: RegExp): Device => {
    const d = sim.devices.find((x) => re.test(x.view().title));
    if (!d) throw new Error(`нет устройства ${re}`);
    return d;
  };
  const click = (re: RegExp, hold = 0.1) => {
    const d = dev(re);
    d.press!(true);
    sec(hold);
    d.press!(false);
    sec(0.2);
  };
  const cmd = (line: string) => {
    sim.serialWrite(line + '\n');
    sec(0.3);
  };
  const set = (re: RegExp, key: string, v: number) => sim.set(dev(re).id, key, v);
  const status = () => JSON.parse((sim.mcu as Esp32).statusJson()!) as Record<string, number>;
  const plant = () => sim.view().plant!;
  sec(1);
  return { sim, sec, dev, click, cmd, set, status, plant };
}

describe('Пылесос S3 навесным монтажом: ZMPT101B и ADS1115 (прошивка 6.1)', () => {
  test('выводы: IO7 и IO48 — с делителя ZMPT101B, остальное — как на плате', () => {
    const p = buildVacuumS3Wired();
    const a1 = Object.values(p.components).find((c) => c.ref === 'A1')!;
    const fp = p.footprints[a1.footprint];
    for (const [pin, net] of Object.entries(WIRED_PINS)) {
      const pad = fp.pads.find((q) => q.name === pin)!;
      expect(p.nets[a1.padNets[pad.number]].name, pin).toBe(net);
    }
    const refs = Object.values(p.components).map((c) => c.ref);
    for (const r of ['U4', 'U5', 'DD4', 'R70', 'R71', 'K1', 'U1', 'U3', 'DD1', 'RK1']) expect(refs).toContain(r);
    for (const r of ['TV1', 'VDS1', 'DA1', 'VT1', 'X20', 'XT1']) expect(refs).not.toContain(r);
  });

  test('запуск: ноль — меандр ZMPT101B, термисторы — с ADS1115, все детали узнаны', () => {
    const { sim, sec, status, dev } = start();
    sec(2);
    expect(sim.unknown).toEqual([]);
    expect(sim.serial).toContain('Контроллер пылесоса S3 6.1');
    expect(sim.serial).toContain('АЦП ADS1115 есть (термисторы на A0, A1)');
    expect(sim.serial).toContain('Ноль сети: ZMPT101B (меандр на IO48)');
    expect(sim.serial).toContain('Напряжение сети: ZMPT101B на IO7 — откалибруйте');
    // Пока ADS1115 не сделал первый замер, термисторы не считаются неисправными.
    expect(sim.serial).not.toContain('Датчик темп.');
    const st = status();
    expect(st.zck).toBe(2);
    expect(st.ads).toBe(1);
    expect(st.ucal).toBe(0);
    // Размах 0,85 В пика на OUT, делитель 2/3: 0,4 В действующего на IO7.
    expect(st.uac).toBeGreaterThan(370);
    expect(st.uac).toBeLessThan(430);
    // Без калибровки напряжение не показывается и не судится.
    expect(st.mains).toBe(0);
    expect(st.faults & (F_NO_ZC | F_NTC1 | F_MAINS)).toBe(0);
    expect(st.t1).toBeGreaterThan(20);
    expect(st.t1).toBeLessThan(30);
    expect(st.t2).toBeGreaterThan(20);
    expect(st.t2).toBeLessThan(30);
    expect(dev(/ZMPT101B/).view().warning).toBeUndefined();
    expect(dev(/ADS1115/).view().warning).toBeUndefined();
  });

  test('калибровка по мультиметру: потом видно 205 и 245 В, ниже 190 — предупреждение', () => {
    const { sim, sec, cmd, set, status } = start();
    sec(2);
    cmd('mains cal 230');
    expect(sim.serial).toContain('Напряжение сети откалибровано: 230 В');
    sec(2);
    expect(Math.abs(status().mains - 230)).toBeLessThanOrEqual(2);
    expect(status().ucal).toBe(1);
    set(/сеть \d+ В, \d+ Гц/, 'u', 205);
    sec(3);
    expect(Math.abs(status().mains - 205)).toBeLessThanOrEqual(3);
    set(/сеть \d+ В, \d+ Гц/, 'u', 245);
    sec(3);
    expect(Math.abs(status().mains - 245)).toBeLessThanOrEqual(3);
    expect(status().faults & F_MAINS).toBe(0);
    set(/сеть \d+ В, \d+ Гц/, 'u', 180);
    sec(3);
    expect(status().faults & F_MAINS).toBe(F_MAINS);
    cmd('mains');
    expect(sim.serial).toMatch(/Сеть: ноль — ZMPT101B \(меандр на IO48\), (49,9\d|50,0\d) Гц/);
    expect(sim.serial).toContain('IO7: ZMPT101B, СКЗ');
  });

  test('удары тарельчатыми клапанами по нулю от ZMPT: магнит без тока ровно целое число полупериодов', () => {
    const { sim, sec, click, cmd, dev, status } = start();
    click(/SB7/);
    sec(6);
    cmd('purge');
    // Канал SSR магнита 1: доля открытого прошлого полупериода. Удар — полупериоды с нулём подряд.
    const ssr = dev(/U3 SSR .*канал 1/);
    const parts: number[] = [];
    const runs: number[] = [];
    let imp = 0;
    let prev = 1;
    let t0 = 0;
    for (let i = 0; i < 2400; i++) {
      sim.run(1000);
      if (i % 200 === 0) imp = Math.max(imp, status().imp);
      const r = ssr.view().readings!.find((x) => x.label === 'открыт')!.value;
      if (r !== 0 && r < 97) parts.push(r);
      const cur = r > 0 ? 1 : 0;
      if (cur !== prev) {
        if (!cur) t0 = i;
        else runs.push(i - t0);
        prev = cur;
      }
    }
    // SSR открывается и закрывается в нуле: полупериод целиком или никак; удары одной длины.
    expect(parts).toEqual([]);
    expect(runs.length).toBeGreaterThan(1);
    expect(new Set(runs).size).toBe(1);
    // Показание — за прошлый полупериод: длина удара (100 мс) плюс полупериод.
    expect(runs[0] - imp).toBeGreaterThanOrEqual(0);
    expect(runs[0] - imp).toBeLessThanOrEqual(10);
  });

  test('мощность турбины — среднее u·i по ZMPT и трансформатору тока', () => {
    const { sec, click, cmd, status } = start();
    sec(2);
    cmd('mains cal 230');
    cmd('mode m');
    cmd('pw 100');
    click(/SB7/);
    sec(10);
    const w1 = status().w1;
    expect(w1).toBeGreaterThan(1000);
    expect(w1).toBeLessThan(2000);
    expect(status().w2).toBe(0);
  });

  test('без ADS1115: IO7 — ZMPT, термистора 1 нет — «датчик температуры 1 неисправен»', () => {
    const { sim, sec, status } = start((p) => {
      const dd4 = Object.values(p.components).find((c) => c.ref === 'DD4')!;
      delete p.components[dd4.id];
    });
    sec(3);
    expect(sim.serial).toContain('АЦП ADS1115 нет');
    expect(status().zck).toBe(2);
    expect(status().faults & F_NTC1).toBe(F_NTC1);
  });
});
