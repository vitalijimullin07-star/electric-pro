import { describe, expect, test } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { vacuumS3Notes } from '../src/core/examples/vacuum-s3/notes';
import { buildPult, routePult } from '../src/core/examples/vacuum-s3/pult';
import { MOD_PINS, buildVacuumS3Mod, routeVacuumS3Mod, vacuumS3ModNotes, withRoutingOf } from '../src/core/examples/vacuum-s3/mod';
import { exportLutPdf } from '../src/core/io/lut-pdf';
import { exportBomCsv } from '../src/core/io/bom';
import { parseProjectFile, serializeProject } from '../src/core/io/project-file';
import { computeConnectivity } from '../src/core/model/connectivity';
import { runDrc } from '../src/core/model/drc';
import { Simulation, bytesToBase64 } from '../src/core/sim';
import { siphash24 } from '../src/core/sim/ble-remote';
import type { Esp32 } from '../src/core/sim/esp32';
import { VOICE_PHRASES } from '../src/core/sim/voice-phrases';
import type { Device } from '../src/core/sim/devices';
import type { Project } from '../src/core/model/types';

/*
 * Пылесос «S3» на модулях: контроллер на ESP32-S3-DevKitC-1 (firmware/vacuum-s3, 5.1), интерфейс
 * экрана (общая прошивка firmware/vacuum-panel) и беспроводной пульт Bluetooth — ядра прошивок в
 * WebAssembly — управляют моделью установки: модули реле 30 А и регуляторы МР248 (ШИМ) турбин
 * Domel 1600 Вт, тарельчатые клапаны с удерживающими магнитами 230 В через твердотельное реле G3MB,
 * розетка инструмента с модулем реле K3, трансформаторы тока SCT-013 с выходом 1 В, метка
 * Bluetooth на инструменте, бак 30 л с электродами и поплавком, камера коробки 3 л и фильтр клапанов. Прежняя плата S3 (SMD, клапаны на магнитах,
 * прошивка 4.0 внутри файла) — архив: проверяются только её файлы.
 * С VAC_WRITE=1 файлы в import/ пишутся заново (медь платы на модулях берётся из её файла;
 * VAC_REROUTE=1 — развести заново).
 */

const wasm = bytesToBase64(readFileSync('firmware/vacuum-s3/vacuum-s3.wasm'));
const panelWasm = bytesToBase64(readFileSync('firmware/vacuum-panel/vacuum-panel.wasm'));

const fw = { name: 'vacuum-s3.wasm', wasm };
const panelFw = { name: 'vacuum-panel.wasm', wasm: panelWasm };

function start(withPanel = true) {
  const sim = Simulation.createSync(buildVacuumS3Mod(fw, withPanel ? panelFw : undefined));
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

describe('Пылесос S3 на модулях: прошивки в симуляции', () => {
  test('запуск: ESP32-S3, экран на связи, все детали узнаны', () => {
    const { sim } = start();
    expect(sim.mcuTitle).toContain('ESP32-S3');
    expect(sim.unknown).toEqual([]);
    expect(sim.serial).toContain('Контроллер пылесоса S3 6.0 (плата на модулях)');
    expect(sim.serial).toContain('Экран на связи');
    expect(sim.devices.map((d) => d.view()).filter((v) => v.warning).map((v) => `${v.title}: ${v.warning}`)).toEqual([]);
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

  test('МР248 и SCT-013: скважность ШИМ — мощность регулятора, ток по ТТ с выходом 1 В — как у двигателя', () => {
    const { sec, click, cmd, plant, sim, dev } = start();
    cmd('mode m');
    cmd('pw 50');
    click(/SB7/);
    sec(8);
    const set = dev(/U1 регулятор/).view().readings!.find((r) => r.label === 'задано')!.value;
    expect(set).toBeGreaterThanOrEqual(48);
    expect(set).toBeLessThanOrEqual(52);
    const m = plant().motors.find((x) => x.ref === 'M1')!;
    expect(m.firing).toBeGreaterThan(60);
    expect(m.firing).toBeLessThan(120);
    const i1 = +[...sim.serial.matchAll(/I1=([\d,]+)/g)].at(-1)![1].replace(',', '.');
    expect(Math.abs(i1 - m.amps) / m.amps).toBeLessThan(0.08);
    const ta1 = dev(/TA1 трансформатор/).view().readings!;
    expect(ta1.find((r) => r.label === 'выход')!.value).toBeCloseTo(m.amps / 20, 2);
  });

  test('пробитый симистор: ток при закрытом симисторе — реле размыкается, турбина заблокирована', () => {
    const { sec, click, set, relay, sim } = start();
    set(/U1 регулятор/, 'state', 1);
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
    set(/U1 регулятор/, 'state', 1);
    click(/SB7/);
    sec(1);
    expect(sim.serial).toContain('Реле 1 сварилось');
  });

  test('бак: вода до электрода уровня — турбины стоп; слили — снова можно; перелив — авария', () => {
    const { sec, click, act, relay, rpm, sim, plant } = start();
    click(/SB7/);
    sec(4);
    act(/Бак 30 л/, 'suck');
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
    set(/Бак 30 л/, 'water', 3);
    click(/SB7/);
    sec(4);
    act(/Бак 30 л/, 'suck');
    sec(90);
    expect(sim.serial).toContain('Бак полон (поплавок)');
  });

  test('клапаны через SSR: удар обоими — целыми полупериодами сети; обрыв катушки — неисправность', () => {
    const { sec, click, cmd, set, sim, plant, dev } = start();
    click(/SB7/);
    sec(5);
    cmd('purge');
    let both = false;
    const halves: number[] = [];
    for (let i = 0; i < 600; i++) {
      sec(0.005);
      if (plant().valves.every((v) => v.open)) both = true;
      halves.push(dev(/U3 SSR .*канал 1/).view().readings!.find((r) => r.label === 'открыт')!.value);
    }
    expect(both).toBe(true);
    // SSR открывается и закрывается в нуле: полупериод либо целиком (без первых ~150 мкс), либо никак.
    expect(halves.some((x) => x >= 97)).toBe(true);
    expect(halves.filter((x) => x !== 0 && x < 97)).toEqual([]);
    sec(4);
    expect(sim.serial).not.toMatch(/Клапан \d неисправен/);
    // Обрыв катушки: удар обоими его не выдаёт (второй клапан бьёт), проверка по одному — да.
    set(/YV1 тарельчатый/, 'fault', 2);
    cmd('ack');
    cmd('purge');
    sec(6);
    expect(sim.serial).toContain('клапан 1: не открывается');
  });

  test('заклинивший клапан находится проверкой клапанов по одному в первой серии', () => {
    const { sec, click, cmd, set, sim } = start();
    set(/YV2 тарельчатый/, 'fault', 2);
    click(/SB7/);
    sec(6);
    cmd('purge');
    sec(6);
    expect(sim.serial).toContain('клапан 2: не открывается');
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
    // Первая серия: проверка по одному клапану и удар обоими — магнит без тока 80–120 мс, тарелка
    // открывается за ~5 мс и возвращается за ~30 мс; поток проседает, но не до нуля.
    expect(longest).toBeGreaterThanOrEqual(60);
    expect(longest).toBeLessThanOrEqual(170);
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

  test('порог перепада: серия, когда перепад (при расходе уставки) дошёл до порога, — не по времени', () => {
    const { sec, click, cmd, set, sim } = start();
    let log = '';
    sim.onSerial = (t: string) => (log += t);
    set(/Шланг, бак, фильтр/, 'dust', 10);
    cmd('set dp 150');
    expect(sim.serial).toContain('Очистка по перепаду: 150 Па при 32 л/с');
    click(/SB7/);
    sec(170);
    expect(log).toContain('Очистка: перепад на фильтре дошёл до порога');
    expect(log).not.toContain('Очистка по времени');
    const done = [...log.matchAll(/Продувка закончена: R ([\d,]+) → ([\d,]+)/g)].map((x) => [+x[1].replace(',', '.'), +x[2].replace(',', '.')]);
    expect(done.length).toBeGreaterThan(0);
    // Порог 150 Па при 32 л/с — это R = 150·100/32² ≈ 14,6: серия — около него, после — заметно ниже.
    for (const [a, b] of done) {
      expect(a).toBeGreaterThan(13.5);
      expect(b).toBeLessThan(a * 0.8);
    }
  });

  test('шланг 50 мм: удар слабый (в баке мало разрежения) — подсказка про мощную очистку, а не «не отбивается»', () => {
    const { sec, click, set, act, sim } = start();
    let log = '';
    sim.onSerial = (t: string) => (log += t);
    set(/Шланг, бак, фильтр/, 'hose', 4);
    set(/Шланг, бак, фильтр/, 'dust', 10);
    click(/SB7/);
    sec(150);
    expect(log).toContain('! Удар слабый: шланг широкий');
    expect(log).not.toContain('Фильтр не отбивается');
    act(/Шланг, бак, фильтр/, 'palm');
    sec(12);
    expect(log).toContain('Шланг закрыт 2 с — мощная очистка');
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
    // Журнал целиком: sim.serial хранит только хвост.
    let log = '';
    sim.onSerial = (t: string) => (log += t);
    cmd('preset 1');
    cmd('start');
    sec(100);
    set(/Шланг, бак, фильтр/, 'intake', 85);
    sec(150);
    expect(log).toContain('! Проверьте фильтр клапанов');
    expect(log).not.toMatch(/Клапан \d неисправен/);
  });

  test('настройки: две копии, переживают перезапуск; сеть для телефона со случайным паролем', () => {
    let nvs: Uint8Array | null = null;
    const a = Simulation.createSync(buildVacuumS3Mod(fw), { onNvs: (d: Uint8Array) => (nvs = d) });
    a.run(1e6);
    a.serialWrite('preset 3\n');
    a.run(0.5e6);
    a.serialWrite('set n 5\n');
    a.run(3e6);
    expect(nvs).not.toBeNull();
    const b = Simulation.createSync(buildVacuumS3Mod(fw), { nvs: nvs! });
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

  test('тарельчатые клапаны: магниты под током раньше турбин, удар — снять ток; без разрежения магниты отпускают', () => {
    const { sec, click, cmd, sim, plant, dev, relay } = start();
    const ssrOn = () => dev(/U3 SSR .*канал 1/).view().readings!.find((r) => r.label === 'открыт')!.value > 50;
    expect(sim.serial).toContain('Клапаны тарельчатые');
    expect(ssrOn()).toBe(false);
    click(/SB7/);
    expect(ssrOn()).toBe(true);
    expect(relay('K1')).toBe(true);
    sec(6);
    expect(plant().valves.every((v) => !v.open)).toBe(true);
    cmd('purge');
    let offWhileOpen = false;
    for (let i = 0; i < 800; i++) {
      sec(0.005);
      if (plant().valves.every((v) => v.open) && !ssrOn()) offWhileOpen = true;
    }
    expect(offWhileOpen).toBe(true);
    expect(ssrOn()).toBe(true);
    sec(3);
    expect(plant().valves.every((v) => !v.open)).toBe(true);
    expect(sim.serial).not.toContain('Тарелка');
    click(/SB7/);
    sec(20);
    expect(ssrOn()).toBe(false);
  });

  test('тарелка не садится (грязь в седле): сброс турбин — пружины закрывают, разрежение возвращается', () => {
    const { sec, click, cmd, set, sim, plant } = start();
    let log = '';
    sim.onSerial = (t: string) => (log += t);
    click(/SB7/);
    sec(6);
    const before = plant().air.vacuum;
    set(/YV1 тарельчатый/, 'fault', 3);
    cmd('purge');
    sec(3);
    expect(log).toContain('Тарелка не села после удара — сброс турбин');
    set(/YV1 тарельчатый/, 'fault', 0);
    sec(6);
    expect(plant().valves.every((v) => !v.open)).toBe(true);
    expect(plant().air.vacuum).toBeGreaterThan(before * 0.8);
  });

  test('обрыв магнита: при заметном разрежении тарелка открывается сама — после трёх сбросов «магнит не держит»', () => {
    const { sec, click, set, sim } = start();
    let log = '';
    sim.onSerial = (t: string) => (log += t);
    // Без магнита пружины держат ~3 кПа: при открытом шланге разницы почти нет — шланг полуперекрыт.
    set(/Шланг, бак, фильтр/, 'block', 70);
    click(/SB7/);
    sec(6);
    set(/YV2 тарельчатый/, 'fault', 1);
    sec(60);
    expect(log).toContain('Тарелка открылась сама');
    expect(log).toContain('клапан 2: магнит не держит тарелку');
  });

  test('закрытый шланг (~24 кПа): магнит 150 Н держит, слабый (60 Н) — тарелка срывается сама', () => {
    for (const force of [150, 60]) {
      const { sec, click, cmd, act, set, sim } = start();
      let log = '';
      sim.onSerial = (t: string) => (log += t);
      set(/YV1 тарельчатый/, 'force', force);
      set(/YV2 тарельчатый/, 'force', force);
      // Без мощной очистки: разрежение копится, удары его не сбрасывают.
      cmd('hauto 0');
      click(/SB7/);
      click(/SB8/);
      sec(6);
      act(/Шланг, бак, фильтр/, 'palm');
      sec(10);
      if (force === 150) expect(log).not.toContain('Тарелка');
      else expect(log).toMatch(/Тарелка открылась сама при 1\d/);
    }
  });

  test('«set valves pulse» — импульсные клапаны: SSR только на удар, режимы — заводские для соленоидов', () => {
    const { sec, click, cmd, sim, dev } = start();
    cmd('set valves pulse');
    expect(sim.serial).toContain('Клапаны импульсные');
    click(/SB7/);
    sec(2);
    expect(dev(/U3 SSR .*канал 1/).view().readings!.find((r) => r.label === 'открыт')!.value).toBe(0);
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

describe('Пылесос S3 6.0: экран 3,5″, турбины по отдельности, клапаны, разгон, часы, весы, голос', () => {
  const espOf = (sim: Simulation) => sim.mcu as Esp32;
  const status = (sim: Simulation) => JSON.parse(espOf(sim).statusJson()!) as Record<string, number>;

  test('экран 3,5″: свой интерфейс 480×320, касание вкладки «Меню» меняет экран', () => {
    const { sim, sec } = start();
    const panel = () => sim.view().devices.find((d) => d.kind === 'panel')!;
    expect(panel().width).toBe(480);
    expect(panel().height).toBe(320);
    const before = Array.from(panel().pixels!.slice(0, 480 * 260));
    sim.touch(panel().id, 432, 295, true);
    sec(0.1);
    sim.touch(panel().id, 432, 295, false);
    sec(0.5);
    const after = panel().pixels!;
    let diff = 0;
    for (let i = 0; i < before.length; i++) if (before[i] !== after[i]) diff++;
    expect(diff).toBeGreaterThan(5000);
  });

  test('часы DS3231 и весы NAU7802: ноль, калибровка грузом 10 кг, мусор в баке', () => {
    const { sim, sec, cmd, set, act } = start();
    expect(sim.serial).toContain('6.0: часы есть, весы есть');
    expect(status(sim).time).toBeGreaterThan(820_000_000); // после 2025 года
    cmd('scale tare');
    set(/NAU7802/, 'extra', 10);
    sec(1.5);
    cmd('scale cal 10');
    set(/NAU7802/, 'extra', 0);
    act(/Бак 30 л/, 'debris');
    sec(2);
    expect(status(sim).kg / 10).toBeCloseTo(5, 0);
  });

  test('голос: проверка голоса и тревога «бак полон» — фразы плееру DFPlayer', () => {
    const { sim, sec, cmd, act, click } = start();
    const said: string[] = [];
    sim.onVoice = (_t, text) => said.push(text);
    sec(4);
    cmd('voice test 36');
    sec(1);
    expect(said).toContain('Пылесос готов к работе.');
    click(/SB7/);
    sec(4);
    act(/Бак 30 л/, 'suck');
    sec(80);
    expect(said).toContain('Бак полон. Слейте воду.');
    expect(sim.devices.find((d) => /DFPlayer/.test(d.view().title))!.view().warning).toBeUndefined();
  });

  test('турбины по отдельности: ручной режим, Т1 — 50 %, Т2 — 90 %', () => {
    const { sec, click, cmd, dev } = start();
    cmd('mode m');
    click(/SB7/);
    click(/SB8/);
    cmd('pw1 50');
    cmd('pw2 90');
    sec(10);
    const set = (re: RegExp) => dev(re).view().readings!.find((r) => r.label === 'задано')!.value;
    expect(set(/U1 регулятор/)).toBeGreaterThanOrEqual(48);
    expect(set(/U1 регулятор/)).toBeLessThanOrEqual(52);
    expect(set(/U2 регулятор/)).toBeGreaterThanOrEqual(88);
    expect(set(/U2 регулятор/)).toBeLessThanOrEqual(92);
  });

  test('мощность турбины в ваттах — по току и фазе сети (Domel 1600 Вт на полной)', () => {
    const { sim, sec, click, cmd } = start();
    cmd('mode m');
    cmd('pw 100');
    click(/SB7/);
    sec(10);
    const w1 = status(sim).w1;
    expect(w1).toBeGreaterThan(1000);
    expect(w1).toBeLessThan(2000);
    expect(status(sim).w2).toBe(0);
  });

  test('клапаны: «только клапан 1» — второй не открывается (после первой серии с проверкой по одному)', () => {
    const { sim, sec, click, cmd, plant } = start();
    cmd('set vmode 2');
    click(/SB7/);
    sec(6);
    cmd('purge');
    sec(12);
    expect(sim.serial).toContain('Продувка закончена');
    let v1 = false;
    let v2 = false;
    // Первый удар — сразу по команде: смотрим с самого начала.
    sim.serialWrite('purge\n');
    for (let i = 0; i < 2000; i++) {
      sec(0.005);
      if (plant().valves[0].open) v1 = true;
      if (plant().valves[1].open) v2 = true;
    }
    expect(v1).toBe(true);
    expect(v2).toBe(false);
  });

  test('разгон: работает одна Т1, мощная очистка — Т2 плавно, но быстро разгоняется к ударам', () => {
    const { sim, sec, click, act, rpm } = start();
    click(/SB7/);
    sec(8);
    expect(rpm('M2')).toBe(0);
    act(/Шланг, бак, фильтр/, 'palm');
    sec(5);
    expect(sim.serial).toContain('мощная очистка');
    expect(rpm('M2')).toBeGreaterThan(15000);
  });

  test('мастер первого пуска: датчики, турбина 1 (шланг закрыть по просьбе), паспорт', () => {
    const { sim, sec, cmd, act } = start();
    cmd('test zero');
    sec(4);
    expect(sim.serial).toContain('Проверка пройдена');
    cmd('test t1');
    sec(9);
    act(/Шланг, бак, фильтр/, 'palm');
    sec(5);
    expect(sim.serial.match(/Проверка пройдена/g)!.length).toBe(2);
    cmd('test stop');
    cmd('pass done');
    expect(sim.serial).toContain('паспорт пылесоса сохранён');
    expect(status(sim).pass).toBe(1);
  });

  test('обслуживание фильтра: «обстучал и продул» — замер и запись в истории (R до → после)', () => {
    const { sim, sec, click, cmd, act } = start();
    click(/SB7/);
    sec(5);
    act(/Шланг, бак, фильтр/, 'dust');
    act(/Шланг, бак, фильтр/, 'dust');
    sec(5);
    cmd('fsvc 3');
    sec(30);
    expect(sim.serial).toMatch(/Обслуживание фильтра записано: R [\d,]+ → [\d,]+/);
  });

  test('голос: фразы — по номерам V_… ядра, файлы mp3 для карты плеера — все', () => {
    const h = readFileSync('firmware/vacuum-s3/vac_core.h', 'utf8');
    const names = /V_TANK_FULL = 1,([\s\S]*?)V_COUNT/.exec(h)![1].split(',').map((x) => x.trim()).filter(Boolean);
    expect(names.length + 1).toBe(VOICE_PHRASES.length - 1);
    const txt = readFileSync('firmware/vacuum-s3/voice/phrases.txt', 'utf8').trimEnd().split('\n');
    expect(txt).toEqual(VOICE_PHRASES.slice(1));
    for (let i = 1; i < VOICE_PHRASES.length; i++) expect(existsSync(`firmware/vacuum-s3/voice/mp3/${String(i).padStart(4, '0')}.mp3`), `фраза ${i}`).toBe(true);
    const len = /PH_LEN\[V_COUNT\] = \{([^}]*)\}/.exec(readFileSync('firmware/vacuum-s3/vac_ext.c', 'utf8'))![1].split(',').map((x) => x.trim()).filter(Boolean);
    expect(len.length).toBe(VOICE_PHRASES.length);
  });

  test('осциллограф удара, графики и «чёрный ящик»', () => {
    const { sim, sec, click, cmd } = start();
    let uart = '';
    const esp = espOf(sim);
    const prev = esp.onUart!;
    esp.onUart = (b) => {
      uart += new TextDecoder().decode(b);
      prev(b);
    };
    click(/SB7/);
    sec(6);
    cmd('purge');
    sec(10);
    cmd('osc');
    cmd('hist 0 0');
    cmd('get ext');
    sec(0.5);
    expect(uart).toMatch(/^O k=\d+ n=\d+ dt=2/m);
    expect(uart).toMatch(/^H m=0 r=0 n=\d+ dt=5 v=/m);
    expect(uart).toMatch(/^X pw2=/m);
    expect(esp.blackBox.length).toBeGreaterThan(0);
  });
});

describe('Пылесос S3, прежняя плата (архив: SMD, клапаны на магнитах, прошивка 4.0 в файле)', () => {
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
    expect(p.firmware?.wasm).toBeTruthy();
  });

  test('вариант на выводных деталях: без SMD, без дорожек, сеть отдельно; симуляция узнаёт все детали', () => {
    const r = parseProjectFile(readFileSync('import/vacuum-s3-dip.plata.json', 'utf8'));
    if (r.kind !== 'project') throw new Error('не проект');
    const p = r.project;
    const smd = Object.values(p.components).filter((c) => !c.offBoard && p.footprints[c.footprint].pads.some((q) => !q.drill && q.type !== 'npth'));
    expect(smd.map((c) => c.ref)).toEqual([]);
    expect(Object.keys(p.tracks)).toEqual([]);
    expect([...new Set(runDrc(p).markers.filter((m) => m.severity === 'error').map((m) => m.code))]).toEqual(['unrouted']);
    const sim = Simulation.createSync(p);
    sim.run(1e6);
    expect(sim.unknown).toEqual([]);
    expect(sim.serial).toContain('Экран на связи');
    const d = sim.devices.find((x) => /SB7/.test(x.view().title))!;
    d.press!(true);
    sim.run(1e5);
    d.press!(false);
    sim.run(6e6);
    sim.serialWrite('purge\n');
    sim.run(6e6);
    expect(sim.serial).toContain('Продувка закончена');
    expect(sim.serial).not.toMatch(/Клапан \d неисправен/);
  });

  test('плата пульта: разведена полностью, ошибок нет; кнопки 1–6 напротив подписей на экране', () => {
    const r = parseProjectFile(readFileSync('import/vacuum-s3-pult.plata.json', 'utf8'));
    if (r.kind !== 'project') throw new Error('не проект');
    const p = r.project;
    expect(runDrc(p).markers.filter((m) => m.severity === 'error').map((m) => m.message)).toEqual([]);
    const conn = computeConnectivity(p);
    expect([...conn.nets.values()].filter((n) => !n.complete).map((n) => p.nets[n.netId].name)).toEqual([]);
    const at = (ref: string) => Object.values(p.components).find((c) => c.ref === ref)!.at;
    // Одинаковая высота слева и справа, шаг — как у зон подписей (104 из 480 кадра).
    for (let i = 0; i < 3; i++) expect(at(`SB${i + 1}`).y).toBeCloseTo(at(`SB${i + 4}`).y, 1);
    expect(at('SB2').y - at('SB1').y).toBeCloseTo(at('SB3').y - at('SB2').y, 0);
    expect(at('SA1').y).toBeGreaterThan(at('SB3').y);
    const x1 = Object.values(p.components).find((c) => c.ref === 'X1')!;
    expect(x1.side).toBe('bottom');
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

describe('Пылесос S3 на модулях: плата под ЛУТ', () => {
  test.runIf(!!process.env.VAC_WRITE)('разводка и файлы для импорта', { timeout: 1_200_000 }, async () => {
    const fresh = buildVacuumS3Mod(fw, panelFw);
    // Медь — из уже разведённого файла (её могли напечатать), заново — только с VAC_REROUTE=1.
    const reroute = !!process.env.VAC_REROUTE || !existsSync('import/vacuum-s3-mod.plata.json');
    let project: Project;
    if (reroute) {
      const r = await routeVacuumS3Mod(fresh);
      console.log(r.report.join('\n'));
      expect(r.failed).toBe(0);
      project = r.project;
    } else project = withRoutingOf(fresh, file());
    expect(runDrc(project).markers.filter((m) => m.severity === 'error').map((m) => m.message)).toEqual([]);
    writeFileSync('import/vacuum-s3-mod.plata.json', serializeProject(project, false));
    writeFileSync('import/vacuum-s3-mod-perechen.csv', exportBomCsv(project));
    writeFileSync('import/vacuum-s3-mod.txt', vacuumS3ModNotes(project));
    if (reroute) {
      // Для ЛУТ: низ как есть, верх зеркально, точки под кернение.
      const pdf = exportLutPdf(project, { sheets: [{ layer: 'B.Cu', mirror: false }, { layer: 'F.Cu', mirror: true }], drillMarks: true, outline: true, paper: 'A4' });
      expect(pdf.tooBig).toBe(false);
      writeFileSync('import/vacuum-s3-mod-lut.pdf', pdf.bytes);
      const pult = await routePult(buildPult());
      expect(pult.result.failed).toBe(0);
      writeFileSync('import/vacuum-s3-pult.plata.json', serializeProject(pult.project, false));
      writeFileSync('import/vacuum-s3-pult-perechen.csv', exportBomCsv(pult.project));
    }
    // Прошивки (собраны arduino-cli в firmware/*/build): целиком — с адреса 0, без хвоста 0xFF.
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
    const r = parseProjectFile(readFileSync('import/vacuum-s3-mod.plata.json', 'utf8'));
    if (r.kind !== 'project') throw new Error('не проект');
    return r.project;
  };

  test('файл в import/: разведена полностью, ошибок проверки нет, 6 мм до сети', () => {
    const p = file();
    expect(runDrc(p).markers.filter((m) => m.severity === 'error').map((m) => m.message)).toEqual([]);
    const conn = computeConnectivity(p);
    expect([...conn.nets.values()].filter((n) => !n.complete).map((n) => p.nets[n.netId].name)).toEqual([]);
    expect(conn.shorts).toEqual([]);
    expect(p.rules.classClearances).toEqual([{ a: 'Mains', b: '*', clearance: 6 }]);
  });

  test('файл в import/: прошивки — текущие, симуляция из файла узнаёт все детали', () => {
    const p = file();
    expect(p.firmware?.wasm).toBe(wasm);
    expect(p.firmware?.modules?.HG1.wasm).toBe(panelWasm);
    const sim = Simulation.createSync(p);
    sim.run(1e6);
    expect(sim.unknown).toEqual([]);
    expect(sim.serial).toContain('Экран на связи');
  });

  test('интерфейс экрана в прошивке контроллера — копия firmware/vacuum-panel (sync-panel.sh)', () => {
    for (const f of ['panel_main.c', 'panel_ui.c', 'panel_s3.c', 'gfx.c', 'fonts.c', 'qr.c', 'panel_int.h', 'panel_ui.h', 'gfx.h', 'fonts.h', 'qr.h']) {
      const copy = readFileSync(`firmware/vacuum-s3/src/panel/${f}`, 'utf8');
      const src = readFileSync(`firmware/vacuum-panel/${f}`, 'utf8');
      expect(copy.endsWith(src), `${f}: запустите sh firmware/vacuum-s3/sync-panel.sh`).toBe(true);
    }
  });

  test('без металлизации: выводы паяются только снизу, сверху — дорожки только между переходными', () => {
    const p = file();
    const onBoard = Object.values(p.components).filter((c) => !c.offBoard);
    for (const c of onBoard) for (const pad of p.footprints[c.footprint].pads) if (pad.type === 'tht') expect(pad.layer, `${c.ref}.${pad.number}`).toBe('B.Cu');
    expect(onBoard.some((c) => p.footprints[c.footprint].pads.some((q) => q.type === 'smd'))).toBe(false);
    // Сверху у выводов меди нет: верхние дорожки связаны с выводами только через переходные (цепи
    // при этом целые — проверено выше), висящих концов нет.
    expect(Object.values(p.tracks).some((t) => t.layer === 'F.Cu')).toBe(true);
    expect(runDrc(p).markers.filter((m) => m.code === 'dangling').map((m) => m.message)).toEqual([]);
  });

  test('выводы ESP32-S3: нет IO35–IO37 (PSRAM у N16R8) и USB IO19/IO20; клеммники 5 и 3,5 мм; PCA9555 — 800 mil', () => {
    const p = file();
    const a1 = Object.values(p.components).find((c) => c.ref === 'A1')!;
    const fp = p.footprints[a1.footprint];
    const used = fp.pads.filter((q) => a1.padNets[q.number]).map((q) => q.name);
    for (const pin of ['IO35', 'IO36', 'IO37', 'IO19', 'IO20', 'RX']) expect(used).not.toContain(pin);
    for (const [pin, net] of Object.entries(MOD_PINS)) {
      const pad = fp.pads.find((q) => q.name === pin)!;
      expect(p.nets[a1.padNets[pad.number]].name, pin).toBe(net);
    }
    const fpOf = (ref: string) => p.footprints[Object.values(p.components).find((c) => c.ref === ref)!.footprint];
    expect(fpOf('XT1').id).toBe('TerminalBlock_1x02_P5mm');
    expect(fpOf('X20').id).toBe('TerminalBlock_1x06_P3.5mm');
    const dd1 = fpOf('DD1');
    const xs = [...new Set(dd1.pads.map((q) => q.at.x))];
    expect(Math.abs(xs[0] - xs[1])).toBeCloseTo(20.32, 2);
    expect(fpOf('VDS1').pads.map((q) => q.name)).toEqual(['+', '~', '~', '-']);
  });

  test('памятка и перечень', () => {
    const p = file();
    const notes = vacuumS3ModNotes(p);
    for (const s of ['Нижняя сторона', 'перемычку режима', 'MP1584', 'IO43', 'X13', 'XT1', 'Прошивка']) expect(notes).toContain(s);
    const bom = exportBomCsv(p);
    for (const s of ['ESP32-S3-DevKitC-1 N16R8', 'PCA9555', 'KBP310', 'SS8050', 'MPX5100DP', 'SLA-05VDC']) expect(bom).toContain(s);
  });
});
