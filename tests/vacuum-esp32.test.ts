import { describe, expect, test } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { buildVacuumEsp32, routeVacuumEsp32 } from '../src/core/examples/vacuum-esp32/build';
import { vacuumNotes } from '../src/core/examples/vacuum-esp32/notes';
import { exportBomCsv } from '../src/core/io/bom';
import { parseProjectFile, serializeProject } from '../src/core/io/project-file';
import { computeConnectivity } from '../src/core/model/connectivity';
import { runDrc } from '../src/core/model/drc';
import { getWorld } from '../src/core/model/world';
import { boardBox } from '../src/core/model/project';
import { Simulation, bytesToBase64 } from '../src/core/sim';
import type { Device } from '../src/core/sim/devices';

/*
 * Контроллер пылесоса на ESP32: ядро прошивки (firmware/vacuum-esp32, собранное в
 * WebAssembly) управляет моделью установки — турбины, клапаны продувки, розетка
 * инструмента, датчики. Проверяем, что прошивка и модель понимают друг друга, а
 * разведённая плата в import/ — без ошибок.
 * С VAC_WRITE=1 плата разводится заново и файлы в import/ пишутся заново (около минуты).
 */

const wasm = bytesToBase64(readFileSync('firmware/vacuum-esp32/vacuum-esp32.wasm'));

function start() {
  const sim = Simulation.createSync(buildVacuumEsp32({ name: 'vacuum-esp32.wasm', wasm }));
  const sec = (s: number) => sim.run(Math.round(s * 1e6));
  const dev = (re: RegExp): Device => {
    const d = sim.devices.find((x) => re.test(x.view().title));
    if (!d) throw new Error(`нет устройства ${re}`);
    return d;
  };
  const click = (re: RegExp) => {
    const d = dev(re);
    d.press!(true);
    sec(0.1);
    d.press!(false);
    sec(0.1);
  };
  const plant = () => sim.view().plant!;
  // Последнее значение из строки состояния прошивки: «I1=4,93».
  const logged = (key: string) => {
    const m = [...sim.serial.matchAll(new RegExp(`${key}=(-?[\\d,]+)`, 'g'))].pop();
    return m ? +m[1].replace(',', '.') : NaN;
  };
  sec(1);
  return { sim, sec, dev, click, plant, logged };
}

describe('Пылесос на ESP32: прошивка в симуляции', () => {
  test('запуск: приветствие, детектор нуля, экран, все детали узнаны', () => {
    const { sim, plant } = start();
    expect(sim.unknown).toEqual([]);
    expect(sim.serial).toContain('Контроллер пылесоса');
    expect(sim.serial).not.toContain('Нет синхронизации');
    const v = sim.view();
    expect(v.mcu).toMatch(/ESP32/);
    expect(plant().zc.width).toBeGreaterThan(1000);
    expect(plant().motors.map((m) => m.rpm)).toEqual([0, 0]);
    const oled = v.devices.find((d) => d.kind === 'oled')!;
    const lit = oled.frame!.reduce((a, x) => a + x, 0);
    expect(lit).toBeGreaterThan(300);
    for (const k of ['motor', 'valve', 'tool', 'triac', 'mains', 'plant', 'encoder', 'buzzer']) expect(v.devices.some((d) => d.kind === k)).toBe(true);
  });

  test('«Пуск»: мягкий разгон турбин по очереди, ток по трансформаторам — как в модели', () => {
    const { click, sec, plant, logged, sim } = start();
    click(/Пуск/);
    sec(1);
    // Вторая турбина стартует на секунду позже первой.
    expect(plant().motors[0].rpm).toBeGreaterThan(plant().motors[1].rpm + 3000);
    sec(8);
    const m = plant().motors;
    expect(m[0].rpm).toBeGreaterThan(20000);
    expect(m[1].rpm).toBeGreaterThan(20000);
    expect(plant().air.flow).toBeGreaterThan(100);
    expect(plant().air.vacuum).toBeGreaterThan(5);
    // Прошивка меряет ток трансформаторами тока через АЦП: сходится с моделью до 10 %.
    expect(Math.abs(logged('I1') - m[0].amps)).toBeLessThan(m[0].amps * 0.1);
    expect(Math.abs(logged('I2') - m[1].amps)).toBeLessThan(m[1].amps * 0.1);
    expect(logged('U')).toBeGreaterThan(215);
    expect(logged('U')).toBeLessThan(245);
    expect(sim.serial).not.toMatch(/! (Перегрузка|Пробит|Нет тока)/);
    click(/Пуск/);
    sec(3);
    expect(plant().motors.every((x) => x.amps === 0)).toBe(true);
  });

  test('авто: инструмент в розетке запускает турбины, после выключения — выбег', () => {
    const { click, sec, plant, dev, sim, logged } = start();
    click(/Режим/);
    click(/Пуск/);
    sec(1);
    expect(plant().motors[0].amps).toBe(0);
    dev(/розетка/).act!('switch');
    sec(4);
    expect(sim.serial).toContain('Инструмент включён');
    expect(plant().motors[0].rpm).toBeGreaterThan(15000);
    expect(logged('Iинстр')).toBeGreaterThan(5);
    dev(/розетка/).act!('switch');
    sec(2);
    expect(sim.serial).toContain('Инструмент выключен');
    expect(plant().motors[0].amps).toBeGreaterThan(0);
    sec(6);
    expect(plant().motors[0].amps).toBe(0);
  });

  test('продувка: клапаны открываются по очереди, турбины потом останавливаются', () => {
    const { click, sec, plant, sim } = start();
    click(/Продувка/);
    const opened = new Set<number>();
    let pulses = 0;
    let last = '';
    for (let i = 0; i < 150; i++) {
      sec(0.1);
      const st = plant().valves.map((v) => (v.open ? 1 : 0));
      st.forEach((x, k) => x && opened.add(k));
      const s = st.join('');
      if (s !== last && s !== '00') pulses++;
      // Оба клапана сразу не открываются: разрежение сбрасывается по одному фильтру.
      expect(s).not.toBe('11');
      last = s;
    }
    expect([...opened].sort()).toEqual([0, 1]);
    expect(pulses).toBeGreaterThanOrEqual(4);
    expect(sim.serial).toContain('Продувка закончена');
    expect(plant().motors[0].amps).toBe(0);
  });

  test('перегрев: при засоре турбины греются, прошивка снижает мощность и отключает на 110 °C', () => {
    const { click, sec, plant, sim } = start();
    const air = sim.devices.find((d) => d.id.endsWith(':air'))!;
    air.set!('boost', 60);
    air.set!('block', 100);
    click(/Пуск/);
    sec(20);
    expect(sim.serial).toContain('Шланг/бак забит');
    expect(sim.serial).toMatch(/Турбина \d горячая/);
    expect(sim.serial).toMatch(/P=70%/);
    sec(15);
    expect(sim.serial).toMatch(/Перегрев турбины \d/);
    const hot = Math.max(...plant().motors.map((m) => m.temp));
    expect(hot).toBeLessThan(118);
  });

  test('неисправности: обрыв обмотки, пробитый симистор, низкое напряжение сети', () => {
    const { click, sec, sim, dev } = start();
    dev(/^VS3 /).set!('state', 1);
    sec(2);
    expect(sim.serial).toContain('Пробит симистор 1');
    dev(/^VS3 /).set!('state', 0);
    dev(/^M2 /).set!('fault', 1);
    sec(1);
    expect(sim.serial).toContain('снято: Пробит симистор 1');
    click(/Пуск/);
    // Ток проверяется после мягкого пуска, три секунды подряд.
    sec(9);
    expect(sim.serial).toContain('Нет тока турбины 2');
    expect(sim.serial).not.toContain('Нет тока турбины 1');
    const mains = sim.devices.find((d) => d.id.endsWith(':mains'))!;
    mains.set!('u', 170);
    sec(4);
    expect(sim.serial).toContain('Напряжение сети');
  });

  test('монитор порта и энкодер: команды, мощность', () => {
    const { sim, sec, dev, logged, click } = start();
    sim.serialWrite('power 50\n');
    sec(0.3);
    expect(sim.serial).toContain('Мощность задана');
    sim.serialWrite('start\n');
    sec(4);
    sim.serialWrite('status\n');
    sec(0.3);
    expect(logged('P')).toBe(50);
    const enc = dev(/энкодер:/);
    for (let i = 0; i < 4; i++) enc.act!('cw'), sec(0.05);
    sec(3);
    sim.serialWrite('status\n');
    sec(0.3);
    expect(logged('P')).toBeGreaterThan(50);
    sim.serialWrite('stop\n');
    sec(0.3);
    click(/Пуск/);
    sim.serialWrite('help\n');
    sec(0.3);
    expect(sim.serial).toContain('Команды:');
  });
});

describe('Пылесос на ESP32: плата', () => {
  test.runIf(!!process.env.VAC_WRITE)('разводка и файлы для импорта', { timeout: 600_000 }, async () => {
    const { project, report, failedLinks } = await routeVacuumEsp32(buildVacuumEsp32({ name: 'vacuum-esp32.wasm', wasm }));
    console.log(report.join('\n'));
    expect(failedLinks).toEqual([]);
    expect(runDrc(project).markers.filter((m) => m.severity === 'error').map((m) => m.message)).toEqual([]);
    writeFileSync('import/vacuum-esp32.plata.json', serializeProject(project, false));
    writeFileSync('import/vacuum-esp32-perechen.csv', exportBomCsv(project));
    writeFileSync('import/vacuum-esp32.txt', vacuumNotes(project));
    // Прошивка ESP32 целиком (arduino-cli кладёт merged.bin на 4 МБ): хвост из 0xFF не нужен.
    const merged = 'firmware/vacuum-esp32/build/vacuum-esp32.ino.merged.bin';
    if (existsSync(merged)) {
      const b = readFileSync(merged);
      let n = b.length;
      while (n > 0 && b[n - 1] === 0xff) n--;
      writeFileSync('import/vacuum-esp32-proshivka.bin', b.subarray(0, (n + 0xfff) & ~0xfff));
    }
  });

  const file = () => {
    const r = parseProjectFile(readFileSync('import/vacuum-esp32.plata.json', 'utf8'));
    if (r.kind !== 'project') throw new Error('не проект');
    return r.project;
  };

  test('файл в import/: плата разведена полностью, ошибок проверки нет, 6 мм до сети', () => {
    const p = file();
    const drc = runDrc(p);
    expect(drc.markers.filter((m) => m.severity === 'error').map((m) => m.message)).toEqual([]);
    const conn = computeConnectivity(p);
    expect([...conn.nets.values()].filter((n) => !n.complete).map((n) => p.nets[n.netId].name)).toEqual([]);
    expect(conn.shorts).toEqual([]);
    const bb = boardBox(p.board);
    expect([bb.maxX - bb.minX, bb.maxY - bb.minY]).toEqual([110, 74]);
    // Все детали на плате — кроме выносных; модуль ESP32 антенной к краю.
    const w = getWorld(p);
    const a1 = w.pads.filter((q) => q.component.ref === 'A1');
    expect(Math.max(...a1.map((q) => q.center.x))).toBeLessThan(110 - 6);
    expect(p.rules.classClearances).toEqual([{ a: 'Mains', b: '*', clearance: 6 }]);
    // Прошивка в проекте та же, что в firmware/.
    expect(p.firmware?.wasm).toBe(wasm);
  });

  test('файл в import/ открывается и запускается: пуск турбин', () => {
    const sim = Simulation.createSync(file());
    sim.run(1e6);
    const start = sim.devices.find((d) => /Пуск/.test(d.view().title))!;
    start.press!(true);
    sim.run(1e5);
    start.press!(false);
    sim.run(5e6);
    expect(sim.view().plant!.motors[0].rpm).toBeGreaterThan(15000);
    expect(sim.serial).toContain('Пуск: ручной');
  });

  test('памятка и перечень', () => {
    const p = file();
    const notes = vacuumNotes(p);
    for (const s of ['ESP32', 'Прошивка', 'Защиты', 'WebAssembly', 'X1', 'X4', 'XT3']) expect(notes).toContain(s);
    const bom = exportBomCsv(p);
    expect(bom).toContain('ESP32-WROOM-32E');
    expect(bom).toContain('MOC3023');
  });
});
