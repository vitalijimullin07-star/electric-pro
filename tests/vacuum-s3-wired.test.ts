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
    expect(sim.serial).toContain('Контроллер пылесоса S3 6.4');
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

const F_SDP_F = 1 << 17;
const F_SDP_Q = 1 << 18;
const F_LEAK1 = 1 << 11;
const F_WELD1 = 1 << 22;

describe('Стенд на двух турбинах (прошивка 6.2): расходомер на второй шине I²C, SSR High Level, зуммер', () => {
  function stand() {
    const p = buildVacuumS3Wired(fw, panelFw, { stand: true });
    const sim = Simulation.createSync(p);
    const sec = (s: number) => sim.run(Math.round(s * 1e6));
    const status = () => JSON.parse((sim.mcu as Esp32).statusJson()!) as Record<string, number>;
    const dev = (re: RegExp): Device => {
      const d = sim.devices.find((x) => re.test(x.view().title));
      if (!d) throw new Error(`нет устройства ${re}`);
      return d;
    };
    const cmd = (line: string) => {
      sim.serialWrite(line + '\n');
      sec(0.3);
    };
    sec(1);
    return { p, sim, sec, status, dev, cmd };
  }

  test('выводы: IO13/IO14 — вторая шина I²C, розетки нет, SSR — прямо от IO40/IO41', () => {
    const p = buildVacuumS3Wired(undefined, undefined, { stand: true });
    const by = (ref: string) => Object.values(p.components).find((c) => c.ref === ref)!;
    const netOf = (ref: string, pin: string) => {
      const c = by(ref);
      const pad = p.footprints[c.footprint].pads.find((q) => q.name === pin)!;
      return p.nets[c.padNets[pad.number]]?.name;
    };
    expect(netOf('A1', 'IO13')).toBe('SDA2');
    expect(netOf('A1', 'IO14')).toBe('SCL2');
    expect(netOf('B3', 'SDA')).toBe('SDA2');
    expect(netOf('U3', 'CH1')).toBe('VLV1');
    expect(netOf('A1', 'IO40')).toBe('VLV1');
    expect(netOf('HL1', 'A')).toBe('5V');
    const refs = Object.values(p.components).map((c) => c.ref);
    for (const r of ['K3', 'XS1', 'TA3', 'DD3', 'DA2', 'VT5', 'VT6']) expect(refs).not.toContain(r);
    for (const r of ['R72', 'R73', 'K1', 'K2', 'U3', 'B2', 'B3', 'DD2', 'DD4', 'U5']) expect(refs).toContain(r);
  });

  test('SDP810-125 (0x25) на IO13/IO14 найден сам; навесной вариант с SDP811 — на общей шине', () => {
    const { sim, status } = stand();
    expect(sim.unknown).toEqual([]);
    expect(sim.serial).toContain('Контроллер пылесоса S3 6.4');
    expect(sim.serial).toContain('Расходомер SDP810 — на второй шине I²C');
    expect(status().fbus).toBe(1);
    expect(status().faults & (F_SDP_F | F_SDP_Q)).toBe(0);
    const w = start();
    expect(w.status().fbus).toBe(0);
    expect(w.status().faults & (F_SDP_F | F_SDP_Q)).toBe(0);
  });

  test('турбина на стенде: расход с SDP810-125, магниты клапанов держат через SSR High Level, удары идут', () => {
    const { sec, status, dev, cmd } = stand();
    cmd('mode m');
    cmd('pw 100');
    const t1 = dev(/SB7/);
    t1.press!(true);
    sec(0.1);
    t1.press!(false);
    sec(6);
    expect(status().flow).toBeGreaterThan(5);
    const ssr = dev(/U3 .*канал 1/);
    expect(ssr.view().readings!.find((x) => x.label === 'открыт')!.value).toBeGreaterThan(90);
    cmd('purge');
    let imp = 0;
    for (let i = 0; i < 20; i++) sec(0.2), (imp = Math.max(imp, status().imp));
    expect(imp).toBeGreaterThan(0);
    expect(status().faults & (F_SDP_F | F_SDP_Q)).toBe(0);
  });

  test('6.4: розетки нет — вход ТТ инструмента (IO6) висит: розетка и автозапуск от «инструмента» выключены', () => {
    const { sim, sec, status, cmd } = stand();
    sec(2);
    expect(sim.serial).toContain('ТТ инструмента на IO6 не подключён');
    expect(status().sock).toBe(0);
    expect(status().tool).toBe(0);
    cmd('sock none');
    expect(sim.serial).toContain('Розетки нет');
    expect(status().sock).toBe(0);
  });

  test('6.4: остановка турбины — мощность МР248 спадает секунды (вход сглажен), реле размыкается без тока', () => {
    const { sim, sec, status, dev, cmd } = stand();
    cmd('mode m');
    cmd('pw 100');
    const t1 = dev(/SB7/);
    const press = () => {
      t1.press!(true);
      sec(0.1);
      t1.press!(false);
      sec(0.2);
    };
    press();
    sec(8);
    expect(status().k1).toBe(1);
    expect(status().i1).toBeGreaterThan(3);
    press();
    sec(1);
    // Ток ещё идёт (C5 регулятора разряжается) — реле держит, «пробит симистор» не ставится.
    expect(status().k1).toBe(1);
    expect(status().i1).toBeGreaterThan(0.5);
    sec(6);
    expect(status().k1).toBe(0);
    expect(status().faults & (F_LEAK1 | F_WELD1)).toBe(0);
    expect(sim.serial).not.toContain('Пробит симистор');
  });

  test('6.4: длинная непонятная команда — в журнал только начало, прошивка работает дальше', () => {
    const { sim, cmd, status } = stand();
    cmd('ы'.repeat(500));
    const line = sim.serial.split('\n').find((l) => l.startsWith('Не понял: '))!;
    expect(new TextEncoder().encode(line).length).toBeLessThan(240);
    expect(line).toContain('(help — список команд)');
    expect(String(status().ver)).toBe('6.4');
  });

  test('зуммер со своим генератором: set buzz 1 — вывод IO45 просто «1» на время сигнала', () => {
    const { sim, status, cmd } = stand();
    cmd('set buzz 1');
    expect(sim.serial).toContain('Зуммер со своим генератором');
    expect(status().bz).toBe(1);
    cmd('set buzz 0');
    expect(status().bz).toBe(0);
  });
});
