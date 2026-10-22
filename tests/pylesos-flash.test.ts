import { describe, expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { EspLoader, SlipReader, flashEsp32s3, md5hex, slipEncode } from '../src/pylesos/apk/esp-flash';
import { FakeRom } from './helpers/fake-rom';

/*
 * Прошивка ESP32-S3 из приложения по кабелю (src/pylesos/apk/esp-flash.ts): против имитации загрузчика
 * в ПЗУ — сброс в загрузчик линиями DTR/RTS (как у USB-Serial/JTAG), кадры SLIP, запись сжатыми блоками,
 * MD5 и перезапуск.
 */

const rnd = (n: number, seed: number) => {
  const a = new Uint8Array(n);
  let x = seed;
  for (let i = 0; i < n; i++) (x = (x * 1103515245 + 12345) & 0x7fffffff), (a[i] = i % 7 === 0 ? 0xff : x >> 16);
  return a;
};

describe('Прошивка ESP32-S3 по кабелю из приложения', () => {
  test('MD5 и SLIP', () => {
    for (const n of [0, 1, 55, 56, 64, 1000, 70000]) {
      const d = rnd(n, n + 1);
      expect(md5hex(d)).toBe(createHash('md5').update(d).digest('hex'));
    }
    const r = new SlipReader();
    r.push(new TextEncoder().encode('мусор'));
    r.push(slipEncode(Uint8Array.from([1, 0xc0, 0xdb, 2])));
    expect([...r.frames[r.frames.length - 1]]).toEqual([1, 0xc0, 0xdb, 2]);
  });

  test('сброс в загрузчик, запись четырёх частей, проверка, перезапуск', async () => {
    const rom = new FakeRom();
    const images = [
      { addr: 0x0, data: rnd(19968, 1), name: 'загрузчик' },
      { addr: 0x8000, data: rnd(3072, 2), name: 'разделы' },
      { addr: 0xe000, data: rnd(8192, 3), name: 'boot_app0' },
      { addr: 0x10000, data: rnd(300_000, 4), name: 'программа' },
    ];
    const prog: number[] = [];
    await flashEsp32s3(rom, images, 8 << 20, (f) => prog.push(f));
    expect(rom.boots).toEqual(['download', 'app']);
    expect(rom.flashSize).toBe(8 << 20);
    for (const im of images) expect(rom.flash.subarray(im.addr, im.addr + im.data.length)).toEqual(im.data);
    expect(prog[prog.length - 1]).toBe(1);
    expect(prog.every((v, i) => i === 0 || v >= prog[i - 1])).toBe(true);
  });

  test('ошибка загрузчика доходит словами', async () => {
    const rom = new FakeRom();
    rom.corrupt = true;
    await expect(flashEsp32s3(rom, [{ addr: 0x10000, data: rnd(5000, 9), name: 'программа' }], 8 << 20)).rejects.toThrow('неверная контрольная сумма');
  });
});

describe('Прошивальщик ESP32: обычный ESP32 за переходником (CH340)', () => {
  test('сброс через RTS/DTR, чип и MAC, скорость 460800, запись с 0x1000 (четыре слова), проверка', async () => {
    const rom = new FakeRom();
    rom.classic = true;
    const ld = new EspLoader(rom);
    await ld.classicReset();
    expect(rom.boots).toEqual(['download']);
    await ld.sync();
    const chip = await ld.detect();
    expect(chip.name).toBe('ESP32');
    expect(chip.bootAddr).toBe(0x1000);
    expect(await ld.readMac()).toBe('e5:f6:a1:b2:c3:d4');
    await ld.changeBaud(460800);
    expect(rom.baud).toBe(460800);
    expect(rom.portBaud).toBe(460800);
    const images = [
      { addr: 0x1000, data: rnd(24000, 5), name: 'загрузчик' },
      { addr: 0x10000, data: rnd(200_000, 6), name: 'программа' },
    ];
    await ld.flash(images, 4 << 20, undefined, '');
    for (const im of images) expect(rom.flash.subarray(im.addr, im.addr + im.data.length)).toEqual(im.data);
    await ld.hardReset();
    expect(rom.boots).toEqual(['download', 'app']);
  });

  test('ждали ESP32-S3, а это ESP32 — отказ до записи', async () => {
    const rom = new FakeRom();
    rom.classic = true;
    const ld = new EspLoader(rom);
    await ld.classicReset();
    await ld.sync();
    await expect(ld.flash([{ addr: 0x10000, data: rnd(100, 1), name: 'x' }], 4 << 20)).rejects.toThrow('Это не ESP32-S3, а ESP32');
  });
});
