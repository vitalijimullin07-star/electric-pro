import { describe, expect, test } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { buildVacuumS3, routeVacuumS3 } from '../src/core/examples/vacuum-s3/build';
import { vacuumS3Notes } from '../src/core/examples/vacuum-s3/notes';
import { exportBomCsv } from '../src/core/io/bom';
import { parseProjectFile, serializeProject } from '../src/core/io/project-file';
import { computeConnectivity } from '../src/core/model/connectivity';
import { runDrc } from '../src/core/model/drc';
import { Simulation, bytesToBase64 } from '../src/core/sim';
import { siphash24 } from '../src/core/sim/ble-remote';
import type { Device } from '../src/core/sim/devices';

/*
 * Пылесос «S3»: контроллер на ESP32-S3 (firmware/vacuum-s3), пульт с экраном (общая прошивка
 * firmware/vacuum-panel) и беспроводной пульт Bluetooth — ядра прошивок в WebAssembly — управляют
 * моделью установки: реле и симисторы турбин, клапаны с соленоидами, бак с электродами и поплавком.
 * С VAC_WRITE=1 плата разводится заново и файлы в import/ пишутся заново.
 */

const wasm = bytesToBase64(readFileSync('firmware/vacuum-s3/vacuum-s3.wasm'));
const panelWasm = bytesToBase64(readFileSync('firmware/vacuum-panel/vacuum-panel.wasm'));

function start(withPanel = true) {
  const sim = Simulation.createSync(buildVacuumS3({ name: 'vacuum-s3.wasm', wasm }, withPanel ? { name: 'vacuum-panel.wasm', wasm: panelWasm } : undefined));
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
  const plant = () => sim.view().plant!;
  const cmd = (line: string) => {
    sim.serialWrite(line + '\n');
    sec(0.3);
  };
  const set = (re: RegExp, key: string, v: number) => sim.set(dev(re).id, key, v);
  const act = (re: RegExp, key: string) => sim.act(dev(re).id, key);
  const relay = (ref: string) => plant().relays.find((r) => r.ref === ref)!.closed;
  const rpm = (ref: string) => plant().motors.find((m) => m.ref === ref)!.rpm;
  sec(1);
  return { sim, sec, dev, click, plant, cmd, set, act, relay, rpm };
}

describe('Пылесос S3: прошивки в симуляции', () => {
  test('запуск: ESP32-S3, пульт на связи, все детали узнаны', () => {
    const { sim } = start();
    expect(sim.mcuTitle).toContain('ESP32-S3');
    expect(sim.unknown).toEqual([]);
    expect(sim.serial).toContain('Контроллер пылесоса S3');
    expect(sim.serial).toContain('Экран на связи');
    const panel = sim.view().devices.find((d) => d.kind === 'panel')!;
    let lit = 0;
    for (let i = 0; i < panel.pixels!.length; i++) if (panel.pixels![i] !== panel.pixels![0]) lit++;
    expect(lit).toBeGreaterThan(20000);
    expect(sim.view().devices.find((d) => d.kind === 'remote')).toBeTruthy();
  });

  test('«Турбина 1» и «Турбина 2»: реле замыкаются, пуск по очереди, ручной режим', () => {
    const { sec, click, cmd, relay, rpm, sim } = start();
    cmd('mode m');
    click(/SB7/);
    click(/SB8/);
    sec(0.6);
    // Вторая стартует не раньше, чем через 1,5 с после первой (бросок тока — по одному).
    expect(relay('K1')).toBe(true);
    expect(relay('K2')).toBe(false);
    expect(rpm('M2')).toBe(0);
    sec(4);
    expect(relay('K2')).toBe(true);
    expect(rpm('M1')).toBeGreaterThan(15000);
    expect(rpm('M2')).toBeGreaterThan(15000);
    click(/SB7/);
    sec(2);
    expect(relay('K1')).toBe(false);
    expect(rpm('M2')).toBeGreaterThan(15000);
    expect(sim.serial).toContain('Турбина 1: стоп');
  });

  test('пробитый симистор: ток при закрытом симисторе — реле размыкается, турбина заблокирована', () => {
    const { sec, click, set, relay, sim } = start();
    set(/VS3 симистор/, 'state', 1);
    click(/SB7/);
    sec(1);
    expect(sim.serial).toContain('Пробит симистор 1');
    expect(relay('K1')).toBe(false);
  });

  test('сварилось реле и пробит симистор: авария «выключите сеть»', () => {
    const { sec, click, set, sim } = start();
    click(/SB7/);
    sec(3);
    set(/K1 реле/, 'fault', 1);
    set(/VS3 симистор/, 'state', 1);
    click(/SB7/);
    sec(1);
    expect(sim.serial).toContain('Реле 1 сварилось');
  });

  test('бак: вода до электрода уровня — турбины стоп; слили — снова можно; перелив — авария', () => {
    const { sec, click, act, relay, rpm, sim, plant } = start();
    click(/SB7/);
    sec(4);
    act(/Бак 40 л/, 'suck');
    sec(80);
    expect(sim.serial).toContain('Бак полон');
    expect(relay('K1')).toBe(false);
    sec(3);
    expect(rpm('M1')).toBeLessThan(5000);
    expect(plant().tank!.level).toBeGreaterThan(0.7);
    act(/Бак/, 'drain');
    sec(5);
    expect(sim.serial).toContain('снято: Бак полон');
    click(/SB7/);
    sec(3);
    expect(relay('K1')).toBe(true);
  });

  test('пена: электроды не видят — останавливает поплавок', () => {
    const { sec, click, act, set, sim } = start();
    set(/Бак 40 л/, 'water', 3);
    click(/SB7/);
    sec(4);
    act(/Бак 40 л/, 'suck');
    sec(90);
    expect(sim.serial).toContain('Бак полон (поплавок)');
  });

  test('клапаны: ток втягивания и удержания по трансформатору тока; заклинивший — неисправность', () => {
    const { sec, click, cmd, set, sim } = start();
    click(/SB7/);
    sec(5);
    cmd('purge');
    sec(8);
    cmd('export');
    const m = /втягивания\/удержания, А: ([\d,]+)\/([\d,]+)/.exec(sim.serial)!;
    const inrush = +m[1].replace(',', '.');
    const hold = +m[2].replace(',', '.');
    expect(inrush).toBeGreaterThan(0.5);
    expect(hold).toBeLessThan(inrush * 0.6);
    expect(sim.serial).not.toContain('Клапан 1 не срабатывает');
    set(/YA1 клапан/, 'fault', 1);
    cmd('purge');
    sec(8);
    cmd('purge');
    sec(8);
    expect(sim.serial).toContain('Клапан 1 не срабатывает');
  });

  test('полная продувка на двух турбинах с пыльным фильтром: исправные клапаны не считаются неисправными', () => {
    const { sec, click, cmd, act, sim } = start();
    click(/SB7/);
    click(/SB8/);
    sec(6);
    act(/Шланг, бак, фильтр/, 'dust');
    act(/Шланг, бак, фильтр/, 'dust');
    sec(2);
    cmd('purge full');
    sec(15);
    expect(sim.serial).toContain('Продувка закончена');
    expect(sim.serial).not.toMatch(/Клапан \d не срабатывает/);
  });

  test('отбивка как у Hilti: удар каждые 5 с, клапаны по очереди; только турбина 2 — реле K1 держится для клапанов', () => {
    const { sec, click, cmd, sim, plant, relay } = start();
    cmd('tap 5');
    click(/SB8/);
    sec(3);
    expect(relay('K1')).toBe(false);
    const opened = new Set<string>();
    let k1 = false;
    for (let i = 0; i < 140; i++) {
      sec(0.1);
      for (const v of plant().valves) if (v.open) opened.add(v.ref);
      k1 ||= relay('K1');
    }
    expect(opened).toEqual(new Set(['YA1', 'YA2']));
    expect(k1).toBe(true);
    expect(sim.serial).not.toContain('нет питания клапанов');
  });

  test('«Выкл»: очистка на выбеге, реле разомкнуты, экран погашен; кнопка будит', () => {
    const { sec, click, sim, relay } = start();
    click(/SB7/);
    sec(33);
    click(/SB9/);
    sec(1);
    expect(sim.serial).toContain('Очистка фильтра перед остановкой');
    sec(10);
    expect(sim.serial).toContain('Выключено');
    expect(relay('K1')).toBe(false);
    expect(relay('K2')).toBe(false);
    click(/SB1\b/);
    sec(0.5);
    expect(sim.serial).toContain('Включено');
  });

  test('фильтр порван: перепада нет — турбины стоп', () => {
    const { sec, click, set, sim, relay } = start();
    click(/SB7/);
    sec(8);
    set(/Шланг, бак, фильтр/, 'filter', 1);
    sec(12);
    expect(sim.serial).toContain('Фильтр порван или не стоит');
    expect(relay('K1')).toBe(false);
  });

  test('кнопки у экрана: «Продуть» справа посередине (5) — продувка через экран', () => {
    const { sec, click, sim } = start();
    click(/SB7/);
    sec(4);
    click(/SB5/);
    sec(1);
    expect(sim.serial).toContain('Продувка: серия ударов');
  });

  test('беспроводной пульт: привязка, пуск кнопкой, повтор и чужая подпись не проходят', () => {
    const { sec, cmd, act, set, sim, relay } = start();
    // Без привязки посылки не принимаются.
    act(/беспроводной пульт/, 'b1');
    sec(1);
    expect(relay('K1')).toBe(false);
    cmd('remote pair');
    act(/беспроводной пульт/, 'pair');
    sec(0.5);
    expect(sim.serial).toContain('Беспроводной пульт привязан');
    act(/беспроводной пульт/, 'b1');
    sec(2);
    expect(relay('K1')).toBe(true);
    act(/беспроводной пульт/, 'b1');
    sec(2);
    expect(relay('K1')).toBe(false);
    // Перехваченную посылку «пуск» повторили — контроллер её уже видел.
    act(/беспроводной пульт/, 'replay');
    sec(2);
    expect(relay('K1')).toBe(false);
    set(/беспроводной пульт/, 'forge', 1);
    act(/беспроводной пульт/, 'b1');
    sec(2);
    expect(relay('K1')).toBe(false);
  });

  test('без экрана энкодер сам меняет уставку', () => {
    const { sec, sim, dev } = start(false);
    const enc = dev(/SA2 энкодер/);
    for (let i = 0; i < 3; i++) {
      enc.act!('cw');
      sec(0.1);
    }
    expect(sim.serial).toMatch(/Уставка 3[3-5] л\/с/);
  });

  test('SipHash-2-4 — эталонный вектор', () => {
    const key = Uint8Array.from({ length: 16 }, (_, i) => i);
    const data = Uint8Array.from({ length: 15 }, (_, i) => i);
    expect(siphash24(key, data)).toBe(0xa129ca6149be45e5n);
  });
});

describe('Пылесос S3: плата', () => {
  test.runIf(!!process.env.VAC_WRITE)('разводка и файлы для импорта', { timeout: 600_000 }, async () => {
    const { project, report, failedLinks } = await routeVacuumS3(buildVacuumS3({ name: 'vacuum-s3.wasm', wasm }, { name: 'vacuum-panel.wasm', wasm: panelWasm }));
    console.log(report.join('\n'));
    expect(failedLinks).toEqual([]);
    expect(runDrc(project).markers.filter((m) => m.severity === 'error').map((m) => m.message)).toEqual([]);
    writeFileSync('import/vacuum-s3.plata.json', serializeProject(project, false));
    writeFileSync('import/vacuum-s3-perechen.csv', exportBomCsv(project));
    writeFileSync('import/vacuum-s3.txt', vacuumS3Notes(project));
    const bin = (from: string, to: string) => {
      if (!existsSync(from)) return;
      const b = readFileSync(from);
      let n = b.length;
      while (n > 0 && b[n - 1] === 0xff) n--;
      writeFileSync(to, b.subarray(0, (n + 0xfff) & ~0xfff));
    };
    bin('firmware/vacuum-s3/build/vacuum-s3.ino.merged.bin', 'import/vacuum-s3-proshivka.bin');
    bin('firmware/vacuum-remote/build/vacuum-remote.ino.merged.bin', 'import/vacuum-remote-proshivka.bin');
    bin('firmware/vacuum-panel/build/vacuum-panel.ino.merged.bin', 'import/vacuum-panel-proshivka.bin');
  });

  const file = () => {
    const r = parseProjectFile(readFileSync('import/vacuum-s3.plata.json', 'utf8'));
    if (r.kind !== 'project') throw new Error('не проект');
    return r.project;
  };

  test('файл в import/: плата разведена полностью, ошибок проверки нет, 6 мм до сети', () => {
    const p = file();
    expect(runDrc(p).markers.filter((m) => m.severity === 'error').map((m) => m.message)).toEqual([]);
    const conn = computeConnectivity(p);
    expect([...conn.nets.values()].filter((n) => !n.complete).map((n) => p.nets[n.netId].name)).toEqual([]);
    expect(conn.shorts).toEqual([]);
    expect(p.rules.classClearances).toEqual([{ a: 'Mains', b: '*', clearance: 6 }]);
    expect(p.firmware?.wasm).toBe(wasm);
    expect(p.firmware?.modules?.HG1.wasm).toBe(panelWasm);
  });

  test('памятка и перечень', () => {
    const p = file();
    const notes = vacuumS3Notes(p);
    for (const s of ['ESP32-S3', 'Bluetooth', 'Отбивка', 'Электроды', 'Защиты', 'X1', 'X5', 'XT3', 'K1']) expect(notes).toContain(s);
    const bom = exportBomCsv(p);
    expect(bom).toContain('ESP32-S3-WROOM-1');
    expect(bom).toContain('PCA9555');
    expect(bom).toContain('G5LE');
  });
});
