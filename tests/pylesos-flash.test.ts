import { describe, expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { unzlibSync } from 'fflate';
import { OP, SlipReader, checksum, flashEsp32s3, md5hex, slipEncode, type FlashPort } from '../src/pylesos/apk/esp-flash';

/*
 * Прошивка ESP32-S3 из приложения по кабелю (src/pylesos/apk/esp-flash.ts): против имитации загрузчика
 * в ПЗУ — сброс в загрузчик линиями DTR/RTS (как у USB-Serial/JTAG), кадры SLIP, запись сжатыми блоками,
 * MD5 и перезапуск.
 */

/** Загрузчик в ПЗУ ESP32-S3 (поведение — по протоколу esptool, ответы с 4 байтами состояния). */
class FakeRom implements FlashPort {
  flash = new Uint8Array(8 << 20).fill(0xff);
  mode: 'app' | 'download' = 'app';
  boots: string[] = [];
  private dl = false;
  private rts = false;
  private rx = new SlipReader();
  private out: number[] = [];
  private begin: { addr: number; erase: number; blocks: number; got: Uint8Array[] } | null = null;
  /** Порча: первый блок данных с неверной суммой — загрузчик сообщит об ошибке. */
  corrupt = false;
  flashSize = 0;

  async lines(dtr: boolean, rts: boolean): Promise<void> {
    if (dtr && !rts) this.dl = true;
    if (this.rts && !rts) {
      this.mode = this.dl ? 'download' : 'app';
      this.boots.push(this.mode);
      this.dl = false;
      // После сброса ПЗУ печатает текст — не кадры SLIP.
      this.out.push(...new TextEncoder().encode('ESP-ROM:esp32s3-20210327\r\nwaiting for download\r\n'));
    }
    this.rts = rts;
  }

  async write(data: Uint8Array): Promise<void> {
    if (this.mode !== 'download') return;
    this.rx.push(data);
    while (this.rx.frames.length) this.handle(this.rx.frames.shift()!);
  }

  async read(ms: number): Promise<Uint8Array> {
    if (!this.out.length) await new Promise((r) => setTimeout(r, Math.min(ms, 1)));
    return Uint8Array.from(this.out.splice(0));
  }

  private reply(op: number, value = 0, data: number[] = [], status = 0, err = 0): void {
    const body = [...data, status, err, 0, 0];
    const pkt = Uint8Array.from([1, op, body.length & 255, body.length >> 8, value & 255, (value >> 8) & 255, (value >> 16) & 255, value >>> 24, ...body]);
    this.out.push(...slipEncode(pkt));
  }

  private handle(f: Uint8Array): void {
    const op = f[1];
    const len = f[2] | (f[3] << 8);
    const chk = f[4] | (f[5] << 8) | (f[6] << 16) | (f[7] << 24);
    const d = f.subarray(8, 8 + len);
    const w = (i: number) => (d[i * 4] | (d[i * 4 + 1] << 8) | (d[i * 4 + 2] << 16) | (d[i * 4 + 3] << 24)) >>> 0;
    switch (op) {
      case OP.SYNC:
        for (let i = 0; i < 8; i++) this.reply(op, 0x20120707);
        return;
      case OP.READ_REG:
        return this.reply(op, w(0) === 0x40001000 ? 9 : 0);
      case OP.SPI_ATTACH:
        return this.reply(op);
      case OP.SPI_SET_PARAMS:
        this.flashSize = w(1);
        return this.reply(op);
      case OP.DEFL_BEGIN: {
        expect(len).toBe(20); // у ESP32-S3 в ПЗУ — пятое слово «шифровать»
        const addr = w(3);
        const erase = w(0);
        expect(erase % 0x400).toBe(0);
        this.flash.fill(0xff, addr, addr + erase);
        this.begin = { addr, erase, blocks: w(1), got: [] };
        return this.reply(op);
      }
      case OP.DEFL_DATA: {
        const n = w(0);
        const blk = d.subarray(16, 16 + n);
        if (this.corrupt || checksum(blk) !== chk) {
          this.corrupt = false;
          return this.reply(op, 0, [], 1, 0x07);
        }
        this.begin!.got.push(blk.slice());
        if (this.begin!.got.length === this.begin!.blocks) {
          const all = new Uint8Array(this.begin!.got.reduce((a, b) => a + b.length, 0));
          let o = 0;
          for (const b of this.begin!.got) all.set(b, o), (o += b.length);
          this.flash.set(unzlibSync(all), this.begin!.addr);
        }
        return this.reply(op);
      }
      case OP.MD5: {
        const hex = createHash('md5').update(this.flash.subarray(w(0), w(0) + w(1))).digest('hex');
        return this.reply(op, 0, [...new TextEncoder().encode(hex)]);
      }
      default:
        return this.reply(op, 0, [], 1, 0x05);
    }
  }
}

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
