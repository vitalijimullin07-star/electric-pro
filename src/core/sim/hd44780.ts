/*
 * Контроллер знакосинтезирующего ЖК HD44780 (LCD1602/2004): команды, память DDRAM,
 * 4- и 8-битный режим. Строки 0x00…, 0x40…, 0x14…, 0x54… как у реального дисплея.
 */

export class Hd44780 {
  readonly ddram = new Uint8Array(128).fill(0x20);
  readonly cgram = new Uint8Array(64);
  private ac = 0;
  private cgMode = false;
  private increment = true;
  private shiftDisplay = false;
  private eightBit = true;
  private half: number | null = null;
  displayOn = false;
  cursorOn = false;
  blinkOn = false;
  shift = 0;
  backlight = true;

  constructor(
    readonly cols = 16,
    readonly rows = 2,
  ) {}

  /** Спад E: rs — данные/команда, hi — D7…D4, lo — D3…D0 (в 4-битном режиме не используется). */
  strobe(rs: boolean, hi: number, lo: number): void {
    if (this.eightBit) return this.exec(rs, ((hi & 15) << 4) | (lo & 15));
    if (this.half === null) {
      this.half = hi & 15;
      return;
    }
    const b = (this.half << 4) | (hi & 15);
    this.half = null;
    this.exec(rs, b);
  }

  private exec(rs: boolean, b: number): void {
    if (rs) {
      if (this.cgMode) {
        this.cgram[this.ac & 63] = b & 31;
        this.ac = (this.ac + (this.increment ? 1 : -1)) & 63;
      } else {
        this.ddram[this.ac & 127] = b;
        this.ac = (this.ac + (this.increment ? 1 : -1)) & 127;
        if (this.shiftDisplay) this.shift += this.increment ? 1 : -1;
      }
      return;
    }
    if (b & 0x80) {
      this.cgMode = false;
      this.ac = b & 0x7f;
    } else if (b & 0x40) {
      this.cgMode = true;
      this.ac = b & 0x3f;
    } else if (b & 0x20) {
      this.eightBit = !!(b & 0x10);
      this.half = null;
    } else if (b & 0x10) {
      if (b & 0x08) this.shift += b & 0x04 ? -1 : 1;
      else this.ac = (this.ac + (b & 0x04 ? 1 : -1)) & 127;
    } else if (b & 0x08) {
      this.displayOn = !!(b & 4);
      this.cursorOn = !!(b & 2);
      this.blinkOn = !!(b & 1);
    } else if (b & 0x04) {
      this.increment = !!(b & 2);
      this.shiftDisplay = !!(b & 1);
    } else if (b & 0x02) {
      this.ac = 0;
      this.shift = 0;
      this.cgMode = false;
    } else if (b & 0x01) {
      this.ddram.fill(0x20);
      this.ac = 0;
      this.shift = 0;
      this.increment = true;
      this.cgMode = false;
    }
  }

  /** Начало строки в DDRAM. */
  private rowAddr(r: number): number {
    return [0x00, 0x40, this.cols, 0x40 + this.cols][r] ?? 0;
  }

  /** Текст на экране (пустые строки, если дисплей выключен). */
  lines(): string[] {
    const out: string[] = [];
    for (let r = 0; r < this.rows; r++) {
      let s = '';
      for (let c = 0; c < this.cols; c++) {
        const base = this.rowAddr(r);
        const within = r % 2 === 0 && this.rows === 4 ? 0x28 : 0x28;
        const code = this.ddram[base + ((c + this.shift) % within + within) % within];
        s += charOf(code);
      }
      out.push(this.displayOn ? s : ' '.repeat(this.cols));
    }
    return out;
  }

  /** Коды символов строки (для своих символов CGRAM). */
  codes(r: number): number[] {
    const base = this.rowAddr(r);
    return Array.from({ length: this.cols }, (_, c) => this.ddram[base + (((c + this.shift) % 0x28) + 0x28) % 0x28]);
  }
}

/** Знакогенератор A00: ASCII, пара японских знаков заменены похожими. */
export function charOf(code: number): string {
  if (code < 8) return '▒';
  if (code >= 0x20 && code < 0x7e) return String.fromCharCode(code);
  if (code === 0x7e) return '→';
  if (code === 0x7f) return '←';
  if (code === 0xdf) return '°';
  if (code === 0xff) return '█';
  if (code === 0xe4) return 'µ';
  if (code === 0xf4) return 'Ω';
  return ' ';
}
