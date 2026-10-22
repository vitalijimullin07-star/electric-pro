/*
 * Прошивка ESP32-S3 по кабелю: протокол загрузчика в ПЗУ чипа (как у esptool без «заглушки»): кадры SLIP,
 * SYNC, подключение флеша, запись сжатыми блоками (FLASH_DEFL_*), проверка MD5, перезапуск. Порт — любой
 * с записью, чтением и линиями DTR/RTS: в APK — USB телефона (кабель OTG к разъёму USB платы, родной
 * USB-Serial/JTAG чипа), в тестах — имитация загрузчика.
 */
import { zlibSync } from 'fflate';

export interface FlashPort {
  write(data: Uint8Array): Promise<void>;
  /** Принятые байты (сколько есть) или пусто по истечении ms. */
  read(ms: number): Promise<Uint8Array>;
  /** Линии: DTR, RTS (у USB-Serial/JTAG ими сбрасывают чип и входят в загрузчик). */
  lines(dtr: boolean, rts: boolean): Promise<void>;
  /** Скорость порта (у переходников USB-UART; у родного USB чипа её нет). */
  setBaud?(baud: number): Promise<void>;
}

/** Чип по ответу загрузчика в ПЗУ. */
export interface ChipInfo {
  name: string;
  /** Код чипа в заголовке образа (IMAGE_CHIP_ID esptool). */
  imageId: number;
  /** С какого адреса пишется загрузчик (у ESP32 и S2 — 0x1000). */
  bootAddr: number;
  /** ПЗУ ждёт пятое слово «шифровать» в начале записи (все, кроме ESP32). */
  encWord: boolean;
  /** Где в eFuse лежит MAC: [младшее слово, старшее слово]. */
  mac?: [number, number];
}

const CHIP_ESP32: ChipInfo = { name: 'ESP32', imageId: 0, bootAddr: 0x1000, encWord: false, mac: [0x3ff5a004, 0x3ff5a008] };
const CHIPS: { magic: number[]; chip: ChipInfo }[] = [
  { magic: [0x00f01d83], chip: CHIP_ESP32 },
  { magic: [0x000007c6], chip: { name: 'ESP32-S2', imageId: 2, bootAddr: 0x1000, encWord: true, mac: [0x3f41a044, 0x3f41a048] } },
  { magic: [0x9], chip: { name: 'ESP32-S3', imageId: 9, bootAddr: 0x0, encWord: true, mac: [0x60007044, 0x60007048] } },
  { magic: [0x6921506f, 0x1b31506f, 0x4881606f, 0x4361606f], chip: { name: 'ESP32-C3', imageId: 5, bootAddr: 0x0, encWord: true, mac: [0x60008844, 0x60008848] } },
  { magic: [0x2ce0806f], chip: { name: 'ESP32-C6', imageId: 13, bootAddr: 0x0, encWord: true, mac: [0x600b0844, 0x600b0848] } },
  { magic: [0x6f51306f, 0x7c41a06f], chip: { name: 'ESP32-C2', imageId: 12, bootAddr: 0x0, encWord: true } },
  { magic: [0xd7b73e80], chip: { name: 'ESP32-H2', imageId: 16, bootAddr: 0x0, encWord: true, mac: [0x600b0844, 0x600b0848] } },
];
/** Новые ПЗУ отвечают кодом чипа на GET_SECURITY_INFO — для тех, чьего «магического» числа нет в таблице. */
const CHIP_BY_ID: Record<number, ChipInfo> = Object.fromEntries(CHIPS.filter((c) => c.chip.imageId).map((c) => [c.chip.imageId, c.chip]));

/** Имя чипа по коду в заголовке образа. */
export function chipNameById(id: number): string {
  return id === 0 ? 'ESP32' : CHIP_BY_ID[id]?.name ?? `чип с кодом ${id}`;
}

export interface FlashImage {
  addr: number;
  data: Uint8Array;
  name: string;
}

export const OP = { SYNC: 0x08, READ_REG: 0x0a, SPI_SET_PARAMS: 0x0b, SPI_ATTACH: 0x0d, CHANGE_BAUD: 0x0f, DEFL_BEGIN: 0x10, DEFL_DATA: 0x11, MD5: 0x13, SECURITY_INFO: 0x14 } as const;
/** Блок записи загрузчика в ПЗУ. */
const BLOCK = 0x400;
const CHIP_MAGIC_REG = 0x40001000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function slipEncode(p: Uint8Array): Uint8Array {
  const out: number[] = [0xc0];
  for (const b of p) {
    if (b === 0xc0) out.push(0xdb, 0xdc);
    else if (b === 0xdb) out.push(0xdb, 0xdd);
    else out.push(b);
  }
  out.push(0xc0);
  return Uint8Array.from(out);
}

/** Разбор потока SLIP на кадры. */
export class SlipReader {
  private cur: number[] | null = null;
  private esc = false;
  readonly frames: Uint8Array[] = [];
  push(data: Uint8Array): void {
    for (const b of data) {
      if (b === 0xc0) {
        if (this.cur && this.cur.length) this.frames.push(Uint8Array.from(this.cur));
        this.cur = [];
        this.esc = false;
      } else if (this.cur) {
        if (this.esc) {
          this.cur.push(b === 0xdc ? 0xc0 : b === 0xdd ? 0xdb : b);
          this.esc = false;
        } else if (b === 0xdb) this.esc = true;
        else this.cur.push(b);
      }
    }
  }
}

const le32 = (v: number) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
const words = (...v: number[]) => Uint8Array.from(v.flatMap(le32));
const rd32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

export function checksum(data: Uint8Array): number {
  let c = 0xef;
  for (const b of data) c ^= b;
  return c;
}

const ERRORS: Record<number, string> = {
  0x05: 'неверное сообщение',
  0x06: 'не удалось выполнить',
  0x07: 'неверная контрольная сумма',
  0x08: 'ошибка записи флеша',
  0x09: 'ошибка чтения флеша',
  0x0a: 'неверная длина',
  0x0b: 'ошибка распаковки',
};

export class EspLoader {
  private slip = new SlipReader();
  log: (line: string) => void = () => {};
  /** Какой чип отвечает (после detect или flash). */
  chip: ChipInfo | null = null;

  constructor(private port: FlashPort) {}

  private async command(op: number, data: Uint8Array, chk = 0, ms = 3000): Promise<{ value: number; data: Uint8Array }> {
    const pkt = new Uint8Array(8 + data.length);
    pkt.set([0, op, data.length & 255, data.length >> 8, ...le32(chk)]);
    pkt.set(data, 8);
    await this.port.write(slipEncode(pkt));
    const until = Date.now() + ms;
    for (;;) {
      while (this.slip.frames.length) {
        const f = this.slip.frames.shift()!;
        if (f.length < 8 || f[0] !== 1 || f[1] !== op) continue;
        const len = f[2] | (f[3] << 8);
        const body = f.subarray(8, 8 + len);
        // Загрузчик в ПЗУ: в конце 4 байта — состояние и код ошибки.
        if (body.length >= 4 && body[body.length - 4] !== 0) {
          const e = body[body.length - 3];
          throw new Error(`Загрузчик: ${ERRORS[e] ?? `ошибка 0x${e.toString(16)}`} (команда 0x${op.toString(16)})`);
        }
        return { value: rd32(f, 4), data: body.subarray(0, Math.max(0, body.length - 4)) };
      }
      const left = until - Date.now();
      if (left <= 0) throw new Error(`Нет ответа загрузчика (команда 0x${op.toString(16)})`);
      this.slip.push(await this.port.read(Math.min(left, 200)));
    }
  }

  /** Сброс в загрузчик через USB-Serial/JTAG (как esptool: DTR — «BOOT», RTS — сброс). */
  async resetToBootloader(): Promise<void> {
    await this.port.lines(false, false);
    await sleep(100);
    await this.port.lines(true, false);
    await sleep(100);
    await this.port.lines(true, true);
    await this.port.lines(false, true);
    await sleep(100);
    await this.port.lines(false, false);
    await sleep(300);
  }

  /**
   * Сброс в загрузчик через переходник USB-UART (CH340, CP2102, FTDI) по обычной схеме плат: RTS — EN,
   * DTR — IO0 (через два транзистора: оба «1» или оба «0» — ничего не делают).
   */
  async classicReset(): Promise<void> {
    await this.port.lines(false, true);
    await sleep(100);
    await this.port.lines(true, false);
    await sleep(50);
    await this.port.lines(false, false);
    await sleep(100);
  }

  async hardReset(): Promise<void> {
    await this.port.lines(false, true);
    await sleep(100);
    await this.port.lines(false, false);
  }

  /** Связаться с загрузчиком: SYNC до первого ответа (чип мог ещё просыпаться). */
  async sync(tries = 12): Promise<void> {
    const data = new Uint8Array(36);
    data.set([0x07, 0x07, 0x12, 0x20]);
    data.fill(0x55, 4);
    for (let i = 0; i < tries; i++) {
      try {
        await this.command(OP.SYNC, data, 0, 300);
        // ПЗУ отвечает на SYNC несколько раз — лишнее выбросить.
        await sleep(50);
        this.slip.push(await this.port.read(50));
        this.slip.frames.length = 0;
        return;
      } catch {
        /* ещё раз */
      }
    }
    throw new Error('Плата не отвечает: нет загрузчика ESP32');
  }

  async readReg(addr: number): Promise<number> {
    return (await this.command(OP.READ_REG, words(addr))).value;
  }

  /** Какой чип: по «магическому» регистру, у новых ПЗУ — по GET_SECURITY_INFO. */
  async detect(): Promise<ChipInfo> {
    const magic = await this.readReg(CHIP_MAGIC_REG);
    let chip = CHIPS.find((c) => c.magic.includes(magic))?.chip;
    if (!chip) {
      const r = await this.command(OP.SECURITY_INFO, new Uint8Array(0)).catch(() => null);
      const id = r && r.data.length >= 16 ? rd32(r.data, 12) : -1;
      chip = CHIP_BY_ID[id];
      if (!chip) throw new Error(`Неизвестный чип (код 0x${magic.toString(16)}${id >= 0 ? `, номер ${id}` : ''})`);
    }
    this.chip = chip;
    return chip;
  }

  /** MAC из eFuse (если известно, где он у этого чипа). */
  async readMac(): Promise<string | null> {
    const c = this.chip ?? (await this.detect());
    if (!c.mac) return null;
    const lo = await this.readReg(c.mac[0]);
    const hi = await this.readReg(c.mac[1]);
    const b = [(hi >> 8) & 255, hi & 255, (lo >>> 24) & 255, (lo >> 16) & 255, (lo >> 8) & 255, lo & 255];
    return b.map((x) => x.toString(16).padStart(2, '0')).join(':');
  }

  /** Сменить скорость: загрузчик переходит на неё после ответа, порт — следом. */
  async changeBaud(baud: number): Promise<void> {
    if (!this.port.setBaud) return;
    await this.command(OP.CHANGE_BAUD, words(baud, 0));
    await sleep(50);
    await this.port.setBaud(baud);
    await sleep(50);
    await this.port.read(20);
    this.slip.frames.length = 0;
  }

  /**
   * Записать образы и проверить. flashSize — байт (8 или 16 МБ): так загрузчик ПЗУ знает размер флеша.
   * onProgress(доля 0…1, что пишется).
   */
  async flash(images: FlashImage[], flashSize: number, onProgress: (f: number, what: string) => void = () => {}, want = 'ESP32-S3'): Promise<void> {
    const chip = this.chip ?? (await this.detect().catch((e: Error) => {
      throw new Error(want ? `Это не ${want}: ${e.message}` : e.message);
    }));
    if (want && chip.name !== want) throw new Error(`Это не ${want}, а ${chip.name}`);
    this.log(`Чип ${chip.name}, загрузчик на связи`);
    await this.command(OP.SPI_ATTACH, new Uint8Array(8));
    await this.command(OP.SPI_SET_PARAMS, words(0, flashSize, 0x10000, 0x1000, 0x100, 0xffff));
    const total = images.reduce((a, im) => a + im.data.length, 0);
    let done = 0;
    for (const im of images) {
      const z = zlibSync(im.data, { level: 9 });
      const blocks = Math.ceil(z.length / BLOCK);
      const erase = Math.ceil(im.data.length / BLOCK) * BLOCK;
      this.log(`${im.name}: ${im.data.length} байт с 0x${im.addr.toString(16)} (сжато ${z.length})`);
      onProgress(done / total, `${im.name}: стирание`);
      // У ESP32 в ПЗУ четыре слова, у остальных — пятое «шифровать».
      const begin = chip.encWord ? words(erase, blocks, BLOCK, im.addr, 0) : words(erase, blocks, BLOCK, im.addr);
      await this.command(OP.DEFL_BEGIN, begin, 0, Math.max(3000, (erase / 1e6) * 30000));
      for (let i = 0; i < blocks; i++) {
        const blk = z.subarray(i * BLOCK, (i + 1) * BLOCK);
        const pkt = new Uint8Array(16 + blk.length);
        pkt.set(words(blk.length, i, 0, 0));
        pkt.set(blk, 16);
        await this.command(OP.DEFL_DATA, pkt, checksum(blk), 10000);
        onProgress((done + (im.data.length * (i + 1)) / blocks) / total, im.name);
      }
      done += im.data.length;
    }
    // FLASH_DEFL_END не шлём: загрузчик в ПЗУ по ней сразу запускает программу (так и esptool), а нужна проверка.
    for (const im of images) {
      const r = await this.command(OP.MD5, words(im.addr, im.data.length, 0, 0), 0, Math.max(5000, (im.data.length / 1e6) * 8000));
      const got = new TextDecoder().decode(r.data.subarray(0, 32)).toLowerCase();
      const want = md5hex(im.data);
      if (got !== want) throw new Error(`${im.name}: проверка не сошлась (MD5 ${got} вместо ${want})`);
    }
    this.log('Записано и проверено (MD5)');
    onProgress(1, 'готово');
  }
}

/** Прошить целиком: сброс в загрузчик, связь, запись, проверка, перезапуск. */
export async function flashEsp32s3(port: FlashPort, images: FlashImage[], flashSize: number, onProgress?: (f: number, what: string) => void, log?: (l: string) => void): Promise<void> {
  const ld = new EspLoader(port);
  if (log) ld.log = log;
  await ld.resetToBootloader();
  await ld.sync();
  await ld.flash(images, flashSize, onProgress);
  await ld.hardReset();
}

/* ---------------- MD5 (RFC 1321) ---------------- */

const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);
const R = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];

export function md5hex(data: Uint8Array): string {
  const n = data.length;
  const len = (((n + 8) >> 6) + 1) << 6;
  const m = new Uint8Array(len);
  m.set(data);
  m[n] = 0x80;
  const bits = n * 8;
  m.set(le32(bits >>> 0), len - 8);
  m.set(le32(Math.floor(bits / 2 ** 32)), len - 4);
  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;
  const w = new Uint32Array(16);
  for (let off = 0; off < len; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = rd32(m, off + i * 4);
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) (f = (b & c) | (~b & d)), (g = i);
      else if (i < 32) (f = (d & b) | (~d & c)), (g = (5 * i + 1) & 15);
      else if (i < 48) (f = b ^ c ^ d), (g = (3 * i + 5) & 15);
      else (f = c ^ (b | ~d)), (g = (7 * i) & 15);
      const t = d;
      d = c;
      c = b;
      const x = (a + f + K[i] + w[g]) >>> 0;
      b = (b + ((x << R[i]) | (x >>> (32 - R[i])))) >>> 0;
      a = t;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }
  return [a0, b0, c0, d0].map((v) => le32(v).map((x) => x.toString(16).padStart(2, '0')).join('')).join('');
}
