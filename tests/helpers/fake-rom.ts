/*
 * Имитация загрузчика в ПЗУ ESP32 для тестов прошивки по кабелю: ESP32-S3 с родным USB (сброс линиями
 * USB-Serial/JTAG) или обычный ESP32 за переходником (classic: EN и IO0 через транзисторы, своя скорость).
 */
import { expect } from 'vitest';
import { createHash } from 'node:crypto';
import { unzlibSync } from 'fflate';
import { OP, SlipReader, checksum, slipEncode, type FlashPort } from '../../src/pylesos/apk/esp-flash';

/** Загрузчик в ПЗУ ESP32-S3 (поведение — по протоколу esptool, ответы с 4 байтами состояния). */
export class FakeRom implements FlashPort {
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
  /** Обычный ESP32 за переходником USB-UART: другой код чипа, 4 слова в начале записи, своя скорость. */
  classic = false;
  baud = 115200;
  portBaud = 115200;
  private enLow = false;

  async setBaud(b: number): Promise<void> {
    this.portBaud = b;
  }

  async lines(dtr: boolean, rts: boolean): Promise<void> {
    if (this.classic) {
      // Два транзистора платы: EN = !(RTS && !DTR), IO0 = !(DTR && !RTS).
      const en = !(rts && !dtr);
      const io0 = !(dtr && !rts);
      if (!en) this.enLow = true;
      else if (this.enLow) {
        this.enLow = false;
        this.mode = io0 ? 'app' : 'download';
        this.boots.push(this.mode);
        this.baud = 115200;
      }
      return;
    }
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
    if (this.classic && this.portBaud !== this.baud) return; // на чужой скорости — мусор
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
        return this.reply(op, w(0) === 0x40001000 ? (this.classic ? 0x00f01d83 : 9) : w(0) === 0x3ff5a004 ? 0xa1b2c3d4 : w(0) === 0x3ff5a008 ? 0x0000e5f6 : 0);
      case OP.SPI_ATTACH:
        return this.reply(op);
      case OP.SPI_SET_PARAMS:
        this.flashSize = w(1);
        return this.reply(op);
      case OP.DEFL_BEGIN: {
        expect(len).toBe(this.classic ? 16 : 20); // у ESP32-S3 в ПЗУ — пятое слово «шифровать», у ESP32 его нет
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
      case OP.CHANGE_BAUD:
        this.reply(op);
        this.baud = w(0);
        return;
      default:
        return this.reply(op, 0, [], 1, 0x05);
    }
  }
}

