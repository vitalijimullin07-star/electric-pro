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
 * моделью установки: реле и симисторы турбин, клапаны на магнитах, розетка инструмента с реле K3,
 * метка Bluetooth на инструменте, бак 28 л с электродами и поплавком, камера 2,2 л и фильтр клапанов.
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
    act(/Бак 28 л/, 'suck');
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
    set(/Бак 28 л/, 'water', 3);
    click(/SB7/);
    sec(4);
    act(/Бак 28 л/, 'suck');
    sec(90);
    expect(sim.serial).toContain('Бак полон (поплавок)');
  });

  test('клапаны на магнитах: ток магнитов при подаче, удар обоими, обрыв магнита — неисправность', () => {
    const { sec, click, cmd, set, sim, plant } = start();
    click(/SB7/);
    sec(5);
    cmd('export');
    const m = /магниты, ток, А: ([\d,]+) \/ ([\d,]+)/.exec(sim.serial)!;
    expect(+m[1].replace(',', '.')).toBeGreaterThan(0.15);
    expect(+m[2].replace(',', '.')).toBeGreaterThan(0.15);
    cmd('purge');
    let both = false;
    for (let i = 0; i < 400; i++) {
      sec(0.005);
      if (plant().valves.every((v) => v.open)) both = true;
    }
    expect(both).toBe(true);
    sec(4);
    expect(sim.serial).not.toMatch(/Клапан \d неисправен/);
    set(/YA1 клапан/, 'fault', 1);
    cmd('stop');
    sec(6);
    click(/SB7/);
    sec(3);
    expect(sim.serial).toContain('клапан 1: обрыв магнита');
  });

  test('заклинившая тарелка находится проверкой клапанов по одному в первой серии', () => {
    const { sec, click, cmd, set, sim } = start();
    set(/YA2 клапан/, 'fault', 2);
    click(/SB7/);
    sec(6);
    cmd('purge');
    sec(6);
    expect(sim.serial).toContain('клапан 2: тарелка не открывается');
    expect(sim.serial).not.toContain('клапан 1:');
  });

  test('удар короткий, а поток в шланге не пропадает: разрежение бака тянет дальше', () => {
    const { sim, sec, click, plant } = start();
    click(/SB7/);
    sec(8);
    const before = plant().air.flow;
    sim.serialWrite('purge\n');
    let minFlow = Infinity;
    let bothMs = 0;
    let longest = 0;
    for (let i = 0; i < 1600; i++) {
      sec(0.0025);
      const a = plant();
      minFlow = Math.min(minFlow, a.air.flow);
      if (a.valves.every((v) => v.open)) longest = Math.max(longest, (bothMs += 2.5));
      else bothMs = 0;
    }
    // Первая серия: проверка по одному клапану и удар обоими — 25–80 мс; поток проседает, но не до нуля.
    expect(longest).toBeGreaterThanOrEqual(25);
    expect(longest).toBeLessThanOrEqual(85);
    expect(minFlow).toBeGreaterThan(before * 0.1);
  });

  test('«Авто»: серия, когда сопротивление фильтра выросло, и удары его снижают', () => {
    const { sec, click, set, sim } = start();
    set(/Шланг, бак, фильтр/, 'dust', 8);
    click(/SB7/);
    sec(90);
    const done = [...sim.serial.matchAll(/Продувка закончена: R ([\d,]+) → ([\d,]+)/g)].map((x) => [+x[1].replace(',', '.'), +x[2].replace(',', '.')]);
    expect(sim.serial).toContain('Очистка: сопротивление фильтра выросло');
    expect(done.length).toBeGreaterThan(1);
    for (const [a, b] of done) expect(b).toBeLessThan(a);
  });

  test('много пыли: «Авто» добивает фильтр сериями, пока удары помогают, — без «не отбивается»', () => {
    const { sec, click, set, sim } = start();
    set(/Шланг, бак, фильтр/, 'dust', 10);
    set(/Шланг, бак, фильтр/, 'kind', 1);
    // Журнал целиком: sim.serial хранит только хвост.
    let log = '';
    sim.onSerial = (t: string) => (log += t);
    click(/SB7/);
    sec(420);
    expect(log).toContain('Очистка: фильтр ещё грязный — добиваю');
    expect(log).not.toContain('Фильтр не отбивается');
  });

  test('мощная очистка: закрыли шланг ладонью — 4 удара полным разрежением', () => {
    const { sec, click, act, sim } = start();
    click(/SB7/);
    sec(8);
    act(/Шланг, бак, фильтр/, 'palm');
    sec(12);
    expect(sim.serial).toContain('Шланг закрыт 2 с — мощная очистка');
    expect(sim.serial).toContain('Мощная очистка закончена');
  });

  test('бурение с присоской: закрытый шланг мощную очистку не запускает', () => {
    const { sec, click, cmd, act, sim } = start();
    cmd('preset 2');
    click(/SB7/);
    sec(8);
    act(/Шланг, бак, фильтр/, 'palm');
    sec(6);
    expect(sim.serial).not.toContain('мощная очистка');
  });

  test('розетка: автозапуск от инструмента, выбег, удары и стоп', () => {
    const { sec, act, relay, sim } = start();
    act(/розетка: инструмент/, 'switch');
    sec(3);
    expect(sim.serial).toContain('Инструмент включён — пуск турбин');
    expect(relay('K1')).toBe(true);
    sec(10);
    act(/розетка: инструмент/, 'switch');
    sec(12);
    expect(sim.serial).toContain('Выбег 4 с');
    expect(sim.serial).toContain('Очистка перед остановкой закончена');
    expect(relay('K1')).toBe(false);
    expect(relay('K3')).toBe(true);
  });

  test('розетка: перегрузка — розетка отключена до решения; снизить турбины и включить', () => {
    const { sec, click, cmd, act, set, relay, sim } = start();
    cmd('mode m');
    cmd('pw 100');
    click(/SB7/);
    click(/SB8/);
    sec(6);
    cmd('tool limit 20');
    set(/розетка: инструмент/, 'w', 2600);
    act(/розетка: инструмент/, 'switch');
    sec(8);
    expect(sim.serial).toMatch(/Перегрузка: инструмент [\d,]+ А/);
    expect(relay('K3')).toBe(false);
    sec(3);
    expect(relay('K3')).toBe(false);
    // Инструмент выключили и выбрали «снизить турбины».
    act(/розетка: инструмент/, 'switch');
    cmd('sock cap');
    sec(2);
    expect(sim.serial).toMatch(/Турбины ограничены до \d+ %/);
    expect(relay('K3')).toBe(true);
    act(/розетка: инструмент/, 'switch');
    sec(8);
    expect(sim.serial.match(/Перегрузка:/g)?.length).toBe(1);
  });

  test('розетка: инструмент оставили включённым — при подаче розетка снова снимается', () => {
    const { sec, cmd, act, relay, sim } = start();
    cmd('sock off');
    act(/розетка: инструмент/, 'switch');
    sec(1);
    cmd('sock on');
    sec(2);
    expect(sim.serial).toContain('Инструмент был включён, когда подали розетку');
    expect(relay('K3')).toBe(false);
  });

  test('метка на инструмент: чужая не включает; привязка, пуск по вибрации, стоп с выбегом', () => {
    const { sec, cmd, act, relay, sim } = start();
    act(/метка на инструмент/, 'tool');
    sec(3);
    expect(relay('K1')).toBe(false);
    act(/метка на инструмент/, 'tool');
    cmd('ble pair');
    act(/метка на инструмент/, 'pair');
    sec(0.5);
    expect(sim.serial).toContain('Метка 1 привязана');
    act(/метка на инструмент/, 'tool');
    sec(3);
    expect(sim.serial).toContain('Метка: инструмент работает — пуск турбин');
    expect(relay('K1')).toBe(true);
    act(/метка на инструмент/, 'bump');
    act(/метка на инструмент/, 'tool');
    sec(12);
    expect(relay('K1')).toBe(false);
  });

  test('паспорт фильтра: новый — замер R; отмытый хуже нового — «пора менять»; фильтр Б', () => {
    const { sec, cmd, act, sim } = start();
    cmd('filter а new');
    sec(26);
    expect(sim.serial).toMatch(/Фильтр А: R [\d,]+, от нового 100 %/);
    act(/Шланг, бак, фильтр/, 'dust');
    act(/Шланг, бак, фильтр/, 'dust');
    act(/Шланг, бак, фильтр/, 'dust');
    cmd('filter а washed');
    sec(26);
    expect(sim.serial).toContain('— пора менять');
    act(/Шланг, бак, фильтр/, 'clean');
    cmd('filter б new');
    sec(26);
    expect(sim.serial).toMatch(/Фильтр Б: R [\d,]+, от нового 100 %/);
    cmd('export');
    expect(sim.serial).toMatch(/фильтр А: R нового [\d,]+, R сейчас [\d,]+, моек 1/);
    expect(sim.serial).toMatch(/фильтр Б \(стоит\)/);
  });

  test('фильтр клапанов забит — «Проверьте фильтр клапанов» (клапаны при этом исправны)', () => {
    const { sec, cmd, set, sim } = start();
    cmd('preset 1');
    cmd('start');
    sec(100);
    set(/Шланг, бак, фильтр/, 'intake', 85);
    sec(150);
    expect(sim.serial).toContain('! Проверьте фильтр клапанов');
    expect(sim.serial).not.toMatch(/Клапан \d неисправен/);
  });

  test('настройки: две копии, переживают перезапуск; сеть для телефона со случайным паролем', () => {
    let nvs: Uint8Array | null = null;
    const a = Simulation.createSync(buildVacuumS3({ name: 'vacuum-s3.wasm', wasm }), { onNvs: (d: Uint8Array) => (nvs = d) });
    a.run(1e6);
    a.serialWrite('preset 3\n');
    a.run(0.5e6);
    a.serialWrite('set n 5\n');
    a.run(3e6);
    expect(nvs).not.toBeNull();
    const b = Simulation.createSync(buildVacuumS3({ name: 'vacuum-s3.wasm', wasm }), { nvs: nvs! });
    b.run(1e6);
    expect(b.serial).toContain('очистка «гипс»');
    b.serialWrite('wifi on\n');
    b.run(0.5e6);
    expect(b.serial).toMatch(/сеть Pylesos-S3-[0-9A-F]{4}, пароль [a-z0-9]{8}/);
  });

  test('две турбины с пыльным фильтром: исправные клапаны не считаются неисправными', () => {
    const { sec, click, act, sim } = start();
    click(/SB7/);
    click(/SB8/);
    sec(6);
    act(/Шланг, бак, фильтр/, 'dust');
    act(/Шланг, бак, фильтр/, 'dust');
    sec(30);
    expect(sim.serial).toContain('Продувка закончена');
    expect(sim.serial).not.toMatch(/Клапан \d неисправен/);
  });

  test('режим «Бетон»: серия по времени — удары; только турбина 2 — реле K1 клапанам не нужно', () => {
    const { sec, click, cmd, sim, plant, relay } = start();
    cmd('preset 1');
    click(/SB8/);
    sec(3);
    let opens = 0;
    let was = false;
    for (let i = 0; i < 1000; i++) {
      sec(0.02);
      const o = plant().valves.some((v) => v.open);
      if (o && !was) opens++;
      was = o;
    }
    expect(relay('K1')).toBe(false);
    expect(opens).toBeGreaterThanOrEqual(3);
    expect(sim.serial).toContain('Очистка по времени');
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
    expect(sim.serial).toContain('Пульт 1 привязан');
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
    bin('firmware/vacuum-tag/build/vacuum-tag.ino.merged.bin', 'import/vacuum-tag-proshivka.bin');
    // Файлы для обновления с телефона: только приложение, без загрузчика и разделов.
    const app = (from: string, to: string) => existsSync(from) && writeFileSync(to, readFileSync(from));
    app('firmware/vacuum-s3/build/vacuum-s3.ino.bin', 'import/vacuum-s3-app.bin');
    app('firmware/vacuum-panel/build/vacuum-panel.ino.bin', 'import/vacuum-panel-app.bin');
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
    for (const s of ['ESP32-S3', 'Bluetooth', 'Очистка фильтра', 'Электроды', 'Защиты', 'X1', 'X5', 'X7', 'XT3', 'K1', 'КГ 3×4', 'Компаунд', 'QR-код', 'Метка']) expect(notes).toContain(s);
    const bom = exportBomCsv(p);
    expect(bom).toContain('ESP32-S3-WROOM-1');
    expect(bom).toContain('PCA9555');
    expect(bom).toContain('G5LE');
    expect(bom).toContain('SI2308');
    expect(bom).toContain('SMAJ30A');
  });
});
