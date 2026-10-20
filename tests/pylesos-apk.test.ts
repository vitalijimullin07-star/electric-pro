import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { DemoVacuum } from '../src/pylesos/demo-core';
import { FIELDS, SampleRing, SeriesTracker, parseOsc, sampleOf } from '../src/pylesos/apk/history';
import { FAULT_PHRASE } from '../src/pylesos/apk/native';
import { FAULTS } from '../src/pylesos/protocol';
import { VOICE_PHRASES } from '../src/core/sim/voice-phrases';
import { BME_CAL, bme280Compensate } from '../src/core/sim/devices';
import { airDensity, dewPoint } from '../src/pylesos/apk/screens/Sensors';

/*
 * Приложение для Android (src/pylesos/apk + android/pylesos): демо с экраном пылесоса (тот же код
 * интерфейса, что в прошивке), осциллограммы ударов из строки «O», запись выборок и серий.
 */

const wasm = readFileSync('firmware/vacuum-s3/vacuum-s3.wasm');
const panelWasm = readFileSync('firmware/vacuum-panel/vacuum-panel.wasm');
const panelHd = readFileSync('firmware/vacuum-panel/vacuum-panel-hd.wasm');

describe('Приложение Android: демо с экраном', () => {
  test('экран 480×320 рисуется, удар даёт осциллограмму, серии и выборки пишутся', async () => {
    const d = await DemoVacuum.create(wasm, undefined, undefined, panelWasm);
    expect(d.panel).not.toBeNull();
    const osc: string[] = [];
    d.onPanelLine = (l) => l.startsWith('O ') && osc.push(l);
    const ring = new SampleRing();
    const tr = new SeriesTracker();
    let t = 1_000_000;
    const step = (ms: number) => {
      for (let i = 0; i < ms / 250; i++) {
        d.run(250);
        t += 0.25;
        const s = d.status()!;
        ring.push(sampleOf(s, t));
        tr.push(s, t);
      }
    };
    step(1000);
    expect(d.panel!.width).toBe(480);
    expect(d.panel!.height).toBe(320);
    expect(d.panel!.version).toBeGreaterThan(0);
    // Кадр не пустой: на экране что-то нарисовано.
    const px = d.panel!.pixels();
    expect(new Set(px.subarray(0, 480 * 40)).size).toBeGreaterThan(3);
    d.command('start');
    step(6000);
    d.command('purge');
    step(8000);
    expect(osc.length).toBeGreaterThan(0);
    const o = parseOsc(osc[0])!;
    expect(o.a.length).toBeGreaterThan(20);
    expect(o.b.length).toBe(o.a.length);
    expect(o.dt).toBe(2);
    expect(o.imp).toBeGreaterThan(0);
    expect(tr.list.length).toBe(1);
    expect(tr.list[0].pulses).toBeGreaterThan(0);
    expect(tr.list[0].rAfter).toBeGreaterThan(0);
    expect(ring.size).toBeGreaterThan(10);
  }, 120_000);

  test('экран для телефона — втрое крупнее: та же картинка, касания в точках интерфейса', async () => {
    const lo = await DemoVacuum.create(wasm, undefined, undefined, panelWasm);
    const hd = await DemoVacuum.create(wasm, undefined, undefined, panelHd);
    lo.run(1500);
    hd.run(1500);
    expect(hd.panel!.scale).toBe(3);
    expect([hd.panel!.width, hd.panel!.height]).toEqual([1440, 960]);
    // Уменьшенный крупный кадр почти совпадает с обычным (разница — только сглаживание краёв и знаков).
    const a = lo.panel!.pixels();
    const b = hd.panel!.pixels();
    const ch = (c: number) => [(c >> 11) & 31, (c >> 5) & 63, c & 31];
    let diff = 0;
    for (let y = 0; y < 320; y++)
      for (let x = 0; x < 480; x++) {
        const p = ch(a[y * 480 + x]);
        const q = ch(b[(y * 3 + 1) * 1440 + x * 3 + 1]);
        if (Math.abs(p[0] - q[0]) > 6 || Math.abs(p[1] - q[1]) > 12 || Math.abs(p[2] - q[2]) > 6) diff++;
      }
    expect(diff / (480 * 320)).toBeLessThan(0.05);
    const v0 = hd.panel!.version;
    hd.panel!.touch(336, 300, true);
    hd.run(100);
    hd.panel!.touch(336, 300, false);
    hd.run(500);
    expect(hd.panel!.version).toBeGreaterThan(v0);
  }, 60_000);

  test('касание по экрану доходит до интерфейса пылесоса', async () => {
    const d = await DemoVacuum.create(wasm, undefined, undefined, panelWasm);
    d.run(1000);
    const v0 = d.panel!.version;
    // Нижняя строка вкладок: «Графики» (четвёртая из пяти).
    d.panel!.touch(336, 300, true);
    d.run(100);
    d.panel!.touch(336, 300, false);
    d.run(500);
    expect(d.panel!.version).toBeGreaterThan(v0);
  }, 60_000);
});

describe('Приложение Android: датчик воздуха BME280', () => {
  test('прошивка находит датчик и отдаёт температуру, влажность, давление', async () => {
    const d = await DemoVacuum.create(wasm);
    const log: string[] = [];
    d.onLog = (l) => log.push(l);
    d.run(2500);
    const s = d.status()!;
    expect(log.some((l) => l.includes('воздух BME280'))).toBe(true);
    expect(s.air).toBe(2);
    expect(s.ta).toBeCloseTo(25, 0);
    expect(s.rh).toBeCloseTo(45, 0);
    expect(s.pa).toBeCloseTo(1005, 0);
  }, 60_000);

  test('пересчёт BME280 по даташиту и плотность воздуха', () => {
    // Пример из даташита Bosch (разд. 8.2): adc_T = 519888 → 25,08 °C при этих поправках.
    const r = bme280Compensate(BME_CAL, 519888, 415148, 30000);
    expect(r.t).toBeCloseTo(25.08, 1);
    expect(r.pa / 100).toBeCloseTo(1006.5, 0);
    expect(airDensity(20, 1013.25, 0)).toBeCloseTo(1.204, 2);
    expect(airDensity(30, 1013.25, 80)).toBeLessThan(airDensity(30, 1013.25, 0));
    expect(dewPoint(25, 50)).toBeCloseTo(13.9, 0);
  });
});

describe('Приложение Android: данные', () => {
  test('строка «O» разбирается', () => {
    const o = parseOsc('O k=3 n=4 dt=2 m=3 i=60 d=42 rv=812 tf=7 a=184/180/150/170 b=600/-10/-812/300')!;
    expect(o).toMatchObject({ k: 3, dt: 2, mask: 3, imp: 60, depth: 42, rev: 812, front: 7 });
    expect(o.a).toEqual([18.4, 18, 15, 17]);
    expect(o.b).toEqual([600, -10, -812, 300]);
    expect(parseOsc('S x=1')).toBeNull();
  });

  test('запись службы (CSV) подмешивается в график без повторов', () => {
    const r = new SampleRing();
    const head = ['t', ...FIELDS].join(',');
    const row = (t: number, vac: number) => [t, ...FIELDS.map((f) => (f === 'vacuum' ? vac : 0))].join(',');
    r.push({ t: 1000, v: new Float32Array(FIELDS.length) });
    r.loadCsv([head, row(990, 5), row(995, 6), row(1000, 7), row(1001, 8)].join('\n'));
    expect(r.all().map((s) => s.t)).toEqual([990, 995, 1000]);
    expect(r.all()[0].v[FIELDS.indexOf('vacuum')]).toBe(5);
    expect(r.since(6).length).toBe(2);
    expect(r.toCsv().split('\n')[0]).toBe(head);
  });

  test('у каждой неисправности есть голосовая фраза', () => {
    for (const [bit] of FAULTS) {
      const b = Math.round(Math.log2(bit));
      const n = FAULT_PHRASE[b];
      expect(n, `бит ${b}`).toBeGreaterThan(0);
      expect(VOICE_PHRASES[n], `фраза ${n}`).toBeTruthy();
    }
  });

  test('поля записи одинаковые в приложении и в службе Android', () => {
    const java = readFileSync('android/pylesos/src/ru/pylesos/app/Recorder.java', 'utf8');
    const m = /FIELDS = \{([^}]+)\}/.exec(java)!;
    const list = m[1].split(',').map((s) => s.trim().replace(/"/g, '')).filter(Boolean);
    expect(list).toEqual([...FIELDS]);
  });
});
