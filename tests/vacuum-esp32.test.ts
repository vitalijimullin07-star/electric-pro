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
 * Контроллер пылесоса на ESP32 и пульт на ESP32-S3 с экраном: ядра обеих прошивок
 * (firmware/vacuum-esp32 и firmware/vacuum-panel, собранные в WebAssembly) работают
 * вместе — строки по UART, — и управляют моделью установки: турбины, клапаны продувки,
 * розетка инструмента, датчики. Проверяем, что прошивки и модель понимают друг друга,
 * а разведённая плата в import/ — без ошибок.
 * С VAC_WRITE=1 плата разводится заново и файлы в import/ пишутся заново (около минуты).
 */

const wasm = bytesToBase64(readFileSync('firmware/vacuum-esp32/vacuum-esp32.wasm'));
const panelWasm = bytesToBase64(readFileSync('firmware/vacuum-panel/vacuum-panel.wasm'));

function start(withPanel = true) {
  const sim = Simulation.createSync(buildVacuumEsp32({ name: 'vacuum-esp32.wasm', wasm }, withPanel ? { name: 'vacuum-panel.wasm', wasm: panelWasm } : undefined));
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
    sec(0.1);
  };
  // Касание экрана пульта: боковые подписи — x 60 / 740, строки y 78, 182, 286.
  const tap = (x: number, y: number) => {
    const id = sim.devices.find((d) => d.view().kind === 'panel')!.id;
    sim.touch(id, x, y, true);
    sec(0.05);
    sim.touch(id, x, y, false);
    sec(0.15);
  };
  const plant = () => sim.view().plant!;
  const flow = () => plant().air.flow / 3.6;
  // Последнее значение из строки состояния прошивки: «I1=4,93».
  const logged = (key: string) => {
    const m = [...sim.serial.matchAll(new RegExp(`${key}=(-?[\\d,]+)`, 'g'))].pop();
    return m ? +m[1].replace(',', '.') : NaN;
  };
  const cmd = (line: string) => {
    sim.serialWrite(line + '\n');
    sec(0.2);
  };
  sec(1);
  return { sim, sec, dev, click, tap, plant, flow, logged, cmd };
}

/** Сколько точек кадра пульта не цвета фона. */
function lit(sim: Simulation): number {
  const px = sim.view().devices.find((d) => d.kind === 'panel')!.pixels!;
  let n = 0;
  for (let i = 0; i < px.length; i++) if (px[i] !== px[0]) n++;
  return n;
}

describe('Пылесос на ESP32: прошивки в симуляции', () => {
  test('запуск: пульт на связи, экран нарисован, все детали узнаны', () => {
    const { sim } = start();
    expect(sim.unknown).toEqual([]);
    expect(sim.serial).toContain('Контроллер пылесоса 2.0');
    expect(sim.serial).toContain('Пульт на связи');
    expect(sim.serial).not.toMatch(/Нет (синхронизации|связи)/);
    const v = sim.view();
    expect(v.mcu).toMatch(/ESP32/);
    expect(v.plant!.zc.width).toBeGreaterThan(1000);
    expect(v.plant!.motors.map((m) => m.rpm)).toEqual([0, 0]);
    const panel = v.devices.find((d) => d.kind === 'panel')!;
    expect(panel.warning).toBeUndefined();
    expect([panel.width, panel.height]).toEqual([800, 480]);
    expect(lit(sim)).toBeGreaterThan(20000);
    for (const k of ['motor', 'valve', 'tool', 'triac', 'mains', 'plant', 'encoder', 'buzzer', 'panel']) expect(v.devices.some((d) => d.kind === k)).toBe(true);
  });

  test('авто: регулятор выводит расход на уставку, вторая турбина — когда одной мало', () => {
    const { click, sec, plant, flow, logged, sim } = start();
    click(/Пуск турбин/);
    sec(1);
    // Первая турбина раньше второй.
    expect(plant().motors[0].rpm).toBeGreaterThan(plant().motors[1].rpm + 3000);
    sec(34);
    expect(sim.serial).toContain('Регулятор: вторая турбина включена');
    expect(Math.abs(flow() - 32)).toBeLessThan(1.5);
    expect(plant().motors[1].rpm).toBeGreaterThan(10000);
    // Токи — трансформаторами тока через АЦП: сходятся с моделью до 10 %.
    const m = plant().motors;
    expect(Math.abs(logged('I1') - m[0].amps)).toBeLessThan(m[0].amps * 0.1);
    expect(Math.abs(logged('I2') - m[1].amps)).toBeLessThan(m[1].amps * 0.1);
    expect(logged('U')).toBeGreaterThan(215);
    expect(logged('U')).toBeLessThan(245);
    expect(sim.serial).not.toMatch(/! (Перегрузка|Пробит|Нет тока)/);
    // Стоп после долгой работы: сначала серия ударов на ходу, потом турбины встают.
    click(/Пуск турбин/);
    sec(9);
    expect(sim.serial).toContain('Продувка закончена');
    expect(plant().motors.every((x) => x.amps === 0)).toBe(true);
  });

  test('ручной режим с пульта: касание «Режим» → «Ручной», энкодер меняет мощность', () => {
    const { tap, sec, dev, click, logged, sim } = start();
    tap(60, 78); // «Режим»
    tap(60, 182); // «Ручной»
    expect(sim.serial).toContain('Режим: ручной');
    tap(740, 286); // «Назад»
    click(/Пуск турбин/);
    sec(5);
    expect(logged('P')).toBe(80);
    expect(logged('P2')).toBe(80);
    const enc = dev(/энкодер:/);
    for (let i = 0; i < 4; i++) enc.act!('ccw'), sec(0.05);
    sec(4);
    // Пульт получил повороты и прислал новую мощность: 80 − 4·5.
    expect(logged('P')).toBe(60);
  });

  test('без пульта энкодер сам меняет уставку', () => {
    const { dev, sec, sim, logged, cmd } = start(false);
    expect(sim.serial).not.toContain('Пульт на связи');
    const enc = dev(/энкодер:/);
    for (let i = 0; i < 3; i++) enc.act!('cw'), sec(0.05);
    sec(1.2);
    expect(sim.serial).toContain('Уставка 35 л/с');
    cmd('status');
    expect(logged('уст')).toBe(35);
  });

  test('розетка: инструмент запускает турбины, после выключения — уборка остатка', () => {
    const { click, sec, plant, dev, sim, logged, cmd } = start();
    cmd('sock 1');
    click(/Пуск турбин/);
    sec(1);
    expect(plant().motors[0].amps).toBe(0);
    dev(/розетка/).act!('switch');
    sec(4);
    expect(sim.serial).toContain('Инструмент включён');
    expect(plant().motors[0].rpm).toBeGreaterThan(15000);
    expect(logged('Iинстр')).toBeGreaterThan(5);
    dev(/розетка/).act!('switch');
    sec(2);
    expect(sim.serial).toContain('уборка остатка');
    expect(plant().motors[0].amps).toBeGreaterThan(0);
    sec(8);
    expect(plant().motors[0].amps).toBe(0);
  });

  test('продувка с пульта: серия из трёх ударов по очереди, R падает, R нового обучен', () => {
    const { click, sec, plant, sim, tap } = start();
    click(/Пуск турбин/);
    sec(12);
    const air = sim.devices.find((d) => d.id.endsWith(':air'))!;
    air.act!('dust');
    sec(3);
    tap(740, 182); // «Продуть»
    const opened: number[] = [];
    let last = '';
    for (let i = 0; i < 800; i++) {
      sec(0.01);
      const st = plant().valves.map((v) => (v.open ? 1 : 0)).join('');
      // Оба клапана сразу не открываются: разрежение сбрасывается через один фильтр.
      expect(st).not.toBe('11');
      if (st !== last && st !== '00') opened.push(st === '10' ? 0 : 1);
      last = st;
    }
    expect(opened).toEqual([0, 1, 0]);
    sec(3);
    const m = /Продувка закончена: R ([\d,]+) → ([\d,]+)/.exec(sim.serial)!;
    const [before, after] = [+m[1].replace(',', '.'), +m[2].replace(',', '.')];
    expect(after).toBeLessThan(before * 0.9);
    // Пульт получил R нового: экран «Фильтр» показывает его.
    tap(463, 450);
    expect(lit(sim)).toBeGreaterThan(20000);
  });

  test('пресеты: удержание «Пуск турбин» открывает их на пульте, «Пуск» применяет, серии по периоду', () => {
    const { click, sec, sim, tap, logged } = start();
    click(/Пуск турбин/, 1.2);
    expect(sim.serial).not.toContain('Пуск: авто');
    tap(60, 182); // «Бурение»
    tap(740, 286); // «Пуск»
    expect(sim.serial).toContain('Пресет: бурение');
    expect(sim.serial).toContain('Пуск: авто по расходу');
    sec(1);
    expect(logged('уст')).toBe(30);
    sec(40);
    expect(sim.serial).toContain('Очистка по периоду');
    expect(sim.serial).toContain('Продувка закончена');
  });

  test('фильтр: забит насовсем — продувка не помогает, «пора мыть»; «Сброс» на пульте', () => {
    const { click, sec, sim, tap, cmd } = start();
    cmd('clean o');
    click(/Пуск турбин/);
    sec(12);
    cmd('purge');
    sec(6);
    expect(sim.serial).toContain('Продувка закончена');
    const air = sim.devices.find((d) => d.id.endsWith(':air'))!;
    air.set!('deep', 100);
    sec(3);
    cmd('purge');
    sec(6);
    expect(sim.serial).toContain('! Фильтр: пора мыть');
    tap(740, 286); // «Сброс»
    expect(sim.serial).toContain('Аварии сброшены');
  });

  test('перегрев: при засоре турбины греются, прошивка снижает мощность и отключает на 110 °C', () => {
    const { click, sec, plant, sim, cmd } = start();
    cmd('mode m');
    const air = sim.devices.find((d) => d.id.endsWith(':air'))!;
    air.set!('boost', 60);
    air.set!('block', 100);
    click(/Пуск турбин/);
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
    const { click, sec, sim, dev, cmd } = start();
    cmd('mode m');
    dev(/^VS3 /).set!('state', 1);
    sec(2);
    expect(sim.serial).toContain('Пробит симистор 1');
    dev(/^VS3 /).set!('state', 0);
    dev(/^M2 /).set!('fault', 1);
    sec(1);
    expect(sim.serial).toContain('снято: Пробит симистор 1');
    click(/Пуск турбин/);
    // Ток проверяется после мягкого пуска, три секунды подряд.
    sec(9);
    expect(sim.serial).toContain('Нет тока турбины 2');
    expect(sim.serial).not.toContain('Нет тока турбины 1');
    const mains = sim.devices.find((d) => d.id.endsWith(':mains'))!;
    mains.set!('u', 170);
    sec(4);
    expect(sim.serial).toContain('Напряжение сети');
  });

  test('монитор порта: команды и журнал', () => {
    const { sim, cmd, logged } = start();
    cmd('sp 40');
    expect(logged('уст')).toBe(NaN);
    cmd('status');
    expect(logged('уст')).toBe(40);
    cmd('help');
    expect(sim.serial).toContain('Команды:');
    cmd('export');
    expect(sim.serial).toContain('Журнал пылесоса:');
    cmd('что-то');
    expect(sim.serial).toContain('Не понял');
  });
});

describe('Пылесос на ESP32: плата', () => {
  test.runIf(!!process.env.VAC_WRITE)('разводка и файлы для импорта', { timeout: 600_000 }, async () => {
    const { project, report, failedLinks } = await routeVacuumEsp32(buildVacuumEsp32({ name: 'vacuum-esp32.wasm', wasm }, { name: 'vacuum-panel.wasm', wasm: panelWasm }));
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
    const panelBin = 'firmware/vacuum-panel/build/vacuum-panel.ino.merged.bin';
    if (existsSync(panelBin)) {
      const b = readFileSync(panelBin);
      let n = b.length;
      while (n > 0 && b[n - 1] === 0xff) n--;
      writeFileSync('import/vacuum-panel-proshivka.bin', b.subarray(0, (n + 0xfff) & ~0xfff));
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
    expect(p.firmware?.modules?.HG1.wasm).toBe(panelWasm);
  });

  test('файл в import/ открывается и запускается: пуск турбин', () => {
    const sim = Simulation.createSync(file());
    sim.run(1e6);
    const start = sim.devices.find((d) => /Пуск турбин/.test(d.view().title))!;
    start.press!(true);
    sim.run(1e5);
    start.press!(false);
    sim.run(5e6);
    expect(sim.view().plant!.motors[0].rpm).toBeGreaterThan(15000);
    expect(sim.serial).toContain('Пуск: авто по расходу');
    expect(sim.serial).toContain('Пульт на связи');
  });

  test('памятка и перечень', () => {
    const p = file();
    const notes = vacuumNotes(p);
    for (const s of ['ESP32-S3', 'Прошивки', 'Пульт', 'Защиты', 'WebAssembly', 'X1', 'X4', 'XT3', 'XT5', 'PNL_TX']) expect(notes).toContain(s);
    const bom = exportBomCsv(p);
    expect(bom).toContain('ESP32-WROOM-32E');
    expect(bom).toContain('MOC3023');
  });
});
