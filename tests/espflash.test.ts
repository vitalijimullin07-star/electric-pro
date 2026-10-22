import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { checkPlan, flashSizeOf, planFile } from '../src/espflash/plan';
import type { ChipInfo } from '../src/pylesos/apk/esp-flash';
import { connectLoader, flashFiles } from '../src/espflash/session';
import { FakeRom } from './helpers/fake-rom';

/*
 * «Прошивальщик ESP32» (src/espflash): вид файла и адрес по имени и содержимому, проверка набора перед записью —
 * на настоящих сборках из репозитория (ESP32 целиком, ESP32-S3 целиком и по частям, ESP32-C3).
 */

const file = (p: string) => new Uint8Array(readFileSync(p));
const ESP32: ChipInfo = { name: 'ESP32', imageId: 0, bootAddr: 0x1000, encWord: false };
const S3: ChipInfo = { name: 'ESP32-S3', imageId: 9, bootAddr: 0x0, encWord: true };

describe('Прошивальщик ESP32: файлы, адреса, проверка', () => {
  test('ESP32 целиком: с 0x0, загрузчик внутри с 0x1000; на S3 — отказ', () => {
    const f = planFile('vacuum-esp32-proshivka.bin', file('import/vacuum-esp32-proshivka.bin'), null);
    expect(f.kind).toBe('merged');
    expect(f.addr).toBe(0);
    expect(checkPlan([f], ESP32, 4 << 20).ok).toBe(true);
    const onS3 = checkPlan([f], S3, 8 << 20);
    expect(onS3.ok).toBe(false);
    expect(onS3.items.some((i) => /собран для ESP32, а на плате ESP32-S3|не для ESP32-S3/.test(i.text))).toBe(true);
  });

  test('ESP32-S3 по частям: адреса по имени и содержимому, флеш из заголовка загрузчика', () => {
    const files = [
      planFile('bootloader.bin', file('firmware/vacuum-s3/flash/bootloader-8m.bin'), null),
      planFile('partitions.bin', file('firmware/vacuum-s3/flash/partitions-8m.bin'), null),
      planFile('boot_app0.bin', file('firmware/vacuum-s3/flash/boot_app0.bin'), null),
      planFile('vacuum-s3.bin', file('import/vacuum-s3-app.bin'), null),
    ];
    expect(files.map((f) => [f.kind, f.addr])).toEqual([
      ['bootloader', 0x0],
      ['partitions', 0x8000],
      ['otadata', 0xe000],
      ['app', 0x10000],
    ]);
    expect(flashSizeOf(files)).toBe(8 << 20);
    const r = checkPlan(files, S3, 8 << 20);
    expect(r.ok).toBe(true);
    expect(r.items.filter((i) => i.level === 'warn')).toEqual([]);
    // На обычном ESP32 — и загрузчик не туда, и образы не для него.
    expect(checkPlan(files, ESP32, 4 << 20).ok).toBe(false);
  });

  test('ошибки: не по 4 КБ, пересечение, не влезает, испорченный файл, данные без адреса', () => {
    const app = planFile('app.bin', file('import/vacuum-s3-app.bin'), S3);
    const bad = { ...app, addr: 0x10100 };
    expect(checkPlan([bad], S3, 8 << 20).items.some((i) => /не кратен 0x1000/.test(i.text))).toBe(true);
    const part = planFile('partitions.bin', file('firmware/vacuum-s3/flash/partitions-8m.bin'), S3);
    const over = { ...part, addr: 0x20000 };
    expect(checkPlan([app, over], S3, 8 << 20).items.some((i) => /налезает/.test(i.text))).toBe(true);
    expect(checkPlan([app], S3, 1 << 20).items.some((i) => /не влезает/.test(i.text))).toBe(true);
    const broken = app.data.slice();
    broken[5000] ^= 1;
    expect(checkPlan([{ ...app, data: broken }], S3, 8 << 20).items.some((i) => /испорчен/.test(i.text))).toBe(true);
    const data = planFile('spiffs.bin', new Uint8Array(4096).fill(0x55), S3);
    expect(data.kind).toBe('data');
    expect(data.addr).toBeNull();
    expect(checkPlan([data], S3, 8 << 20).items.some((i) => /задайте адрес/.test(i.text))).toBe(true);
  });

  test('ESP32-C3 целиком и одна программа без загрузчика — предупреждение', () => {
    const c3 = planFile('vacuum-remote-proshivka.bin', file('import/vacuum-remote-proshivka.bin'), null);
    expect(c3.kind).toBe('merged');
    const C3: ChipInfo = { name: 'ESP32-C3', imageId: 5, bootAddr: 0, encWord: true };
    expect(checkPlan([c3], C3, 4 << 20).ok).toBe(true);
    const app = planFile('firmware.bin', file('import/vacuum-s3-app.bin'), S3);
    const r = checkPlan([app], S3, 8 << 20);
    expect(r.ok).toBe(true);
    expect(r.items.some((i) => i.level === 'warn' && /только программа/.test(i.text))).toBe(true);
  });
});

/** Имитация как порт приложения: переподключение после сброса и сток для монитора. */
function asPort(rom: FakeRom) {
  return Object.assign(rom, { reopen: async () => ({ kind: 'cdc', name: 'родной USB ESP32', vid: 0x303a, pid: 0x1001 }), drain: () => {}, sink: null as ((b: Uint8Array) => void) | null });
}

describe('Прошивальщик ESP32: подключение и запись (имитация загрузчика)', () => {
  test('ESP32 на CH340: сброс RTS/DTR, чип, 460800, файл «целиком», MD5, перезапуск', async () => {
    const rom = new FakeRom();
    rom.classic = true;
    const log: string[] = [];
    const { ld, chip, mac } = await connectLoader(asPort(rom), { kind: 'ch34x', name: 'CH340/CH341', vid: 0x1a86, pid: 0x7523 }, 460800, (l) => log.push(l));
    expect(chip.name).toBe('ESP32');
    expect(mac).toBe('e5:f6:a1:b2:c3:d4');
    expect(rom.baud).toBe(460800);
    const f = planFile('vacuum-esp32-proshivka.bin', file('import/vacuum-esp32-proshivka.bin'), chip);
    expect(checkPlan([f], chip, 4 << 20).ok).toBe(true);
    await flashFiles(ld, [f], 4 << 20, () => {});
    expect(Buffer.from(rom.flash.subarray(0, f.data.length)).equals(Buffer.from(f.data))).toBe(true);
    await ld.hardReset();
    expect(rom.boots).toEqual(['download', 'app']);
    expect(log.some((l) => l.includes('1a86:7523'))).toBe(true);
  });

  test('ESP32-S3 по родному USB: части сборки по своим адресам', async () => {
    const rom = new FakeRom();
    const { ld, chip } = await connectLoader(asPort(rom), { kind: 'cdc', name: 'родной USB ESP32', vid: 0x303a, pid: 0x1001 }, 460800, () => {});
    expect(chip.name).toBe('ESP32-S3');
    const files = [
      planFile('bootloader.bin', file('firmware/vacuum-s3/flash/bootloader-8m.bin'), chip),
      planFile('partitions.bin', file('firmware/vacuum-s3/flash/partitions-8m.bin'), chip),
      planFile('boot_app0.bin', file('firmware/vacuum-s3/flash/boot_app0.bin'), chip),
      planFile('vacuum-s3.bin', file('import/vacuum-s3-app.bin'), chip),
    ];
    await flashFiles(ld, files, 8 << 20, () => {});
    for (const f of files) expect(Buffer.from(rom.flash.subarray(f.addr!, f.addr! + f.data.length)).equals(Buffer.from(f.data))).toBe(true);
    expect(rom.flashSize).toBe(8 << 20);
  });
});
