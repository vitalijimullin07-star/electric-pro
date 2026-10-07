import { describe, expect, test } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { DemoVacuum } from '../src/pylesos/demo-core';
import { LineJoiner } from '../src/pylesos/links';
import { faultList, filterClean, parseStatus, stateText, type VacStatus } from '../src/pylesos/protocol';

/*
 * Приложение «Пылесос S3» для телефона (src/pylesos): демо — настоящая прошивка контроллера и
 * модель установки, состояние — тот же JSON, что по Wi-Fi и Bluetooth, команды — строки порта.
 */

const wasm = readFileSync('firmware/vacuum-s3/vacuum-s3.wasm');

function demo() {
  const d = DemoVacuum.createSync(wasm);
  const log: string[] = [];
  d.onLog = (l) => log.push(l);
  d.run(1000);
  return { d, log, s: () => d.status()! };
}

describe('Приложение для телефона: демо', () => {
  test('состояние от прошивки — все поля, что показывает приложение', () => {
    const { s } = demo();
    const st = s();
    expect(st.ver).toBe('6.0');
    // Поля, на которые опираются экраны.
    const keys: (keyof VacStatus)[] = ['state', 'running', 'flow', 'vacuum', 'speed', 'itotal', 'p1', 'p2', 'i1', 'i2', 't1', 't2', 'mode', 'sp', 'power', 'preset', 'pn', 'pe', 'pi', 'pp', 'dip', 'dpon', 'vk', 'hold', 'v1', 'v2', 'r', 'rnew', 'filt', 'fst', 'tauto', 'tthr', 'limit', 'faults', 'phone', 'wifi'];
    for (const k of keys) expect(st, k).toHaveProperty(k);
    expect(st.vk).toBe(0);
    expect(stateText(st)).toBe('Стоит');
  });

  test('пуск, режим очистки, продувка: команды доходят, журнал приходит', () => {
    const { d, log, s } = demo();
    d.command('start');
    d.run(6000);
    expect(s().running).toBe(1);
    expect(s().hold).toBe(1);
    expect(stateText(s())).toMatch(/Работа/);
    d.command('preset 1');
    d.run(300);
    expect(s().preset).toBe(1);
    expect(s().pi).toBe(100);
    d.command('purge');
    d.run(4000);
    expect(log.some((l) => /Продувка/.test(l))).toBe(true);
    d.command('stop');
    d.run(8000);
    expect(s().running).toBe(0);
  });

  test('«мир» демо: закрыли шланг — мощная очистка; включили инструмент — турбины сами', () => {
    const { d, log, s } = demo();
    d.command('start');
    d.run(6000);
    d.act('hose');
    d.run(400);
    expect(d.world().hoseClosed).toBe(true);
    d.run(5000);
    expect(log.some((l) => /мощная очистка/i.test(l))).toBe(true);
    d.act('hose');
    d.command('stop');
    d.run(10000);
    d.act('tool');
    d.run(4000);
    expect(d.world().tool).toBe(true);
    expect(s().tool).toBeGreaterThan(0);
    expect(s().running).toBe(1);
  });

  test('настройки из приложения: сброс турбин, порог перепада, клапаны', () => {
    const { d, s } = demo();
    d.command('set dip 50');
    d.command('set dp 150');
    d.run(400);
    expect(s().dip).toBe(50);
    expect(s().dpon).toBe(150);
    d.command('set valves pulse');
    d.run(300);
    expect(s().vk).toBe(1);
  });
});

describe('Приложение для телефона: протокол', () => {
  test('строки из уведомлений Bluetooth: куски по MTU, кириллица на границе куска', () => {
    const lines: string[] = [];
    const j = new LineJoiner((l) => lines.push(l));
    const bytes = new TextEncoder().encode('{"a":1}\nПродувка закончена\n');
    for (let i = 0; i < bytes.length; i += 7) j.push(bytes.subarray(i, i + 7));
    expect(lines).toEqual(['{"a":1}', 'Продувка закончена']);
  });

  test('неисправности: бит 31, причина клапана, чистота фильтра', () => {
    const st = parseStatus(JSON.stringify({ state: 0, faults: (2 ** 31 + (1 << 24)) | 0, v1: 6, v2: 0, rnew: 6, r: 12 }))!;
    const f = faultList(st);
    expect(f.map((x) => x.text)).toEqual(['Клапан 1 неисправен: магнит не держит тарелку: обрыв, нет 230 В, SSR, слабый магнит', 'Удар слабый: шланг широкий — закройте шланг для мощной очистки']);
    expect(filterClean(st)).toBe(50);
    expect(parseStatus('не json')).toBeNull();
  });

  test('сборка: приложение на сайте и в прошивке пылесоса', () => {
    expect(existsSync('pylesos.html')).toBe(true);
    const h = readFileSync('firmware/vacuum-s3/app_page.h', 'utf8');
    const n = +/APP_PAGE_GZ_LEN = (\d+)/.exec(h)![1];
    expect(n).toBeGreaterThan(20_000);
    expect(n).toBeLessThan(200_000);
    // В прошивку — без демо (оно с прошивкой и моделью — только на сайте).
    expect(readFileSync('pylesos.html', 'utf8').length).toBeGreaterThan(n * 3);
  });
});
