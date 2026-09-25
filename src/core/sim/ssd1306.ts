/*
 * OLED-контроллеры SSD1306 (128×64, 128×32) и SH1106 (132 столбца, видимы 2…129):
 * команды адресации, запись данных, включение и инверсия. Кадр — биты по страницам.
 */

const ARGS: Record<number, number> = { 0x20: 1, 0x21: 2, 0x22: 2, 0x81: 1, 0xa8: 1, 0xd3: 1, 0x8d: 1, 0xda: 1, 0xd5: 1, 0xd9: 1, 0xdb: 1, 0xa3: 2, 0x26: 6, 0x27: 6, 0x29: 5, 0x2a: 5, 0xad: 1 };

export class Ssd1306 {
  readonly ram: Uint8Array;
  private mode = 2; // 0 — горизонтальная, 1 — вертикальная, 2 — постраничная
  private col = 0;
  private page = 0;
  private colStart = 0;
  private colEnd: number;
  private pageStart = 0;
  private pageEnd: number;
  private pending: number[] = [];
  private need = 0;
  on = false;
  inverted = false;
  /** Ждём байт-признак; Co = 1 — после одного байта снова признак. */
  private expectCtrl = true;
  private co = false;
  private isData = false;

  constructor(
    readonly width = 128,
    readonly height = 64,
    readonly sh1106 = false,
  ) {
    this.ram = new Uint8Array((sh1106 ? 132 : width) * (height / 8));
    this.colEnd = (sh1106 ? 132 : width) - 1;
    this.pageEnd = height / 8 - 1;
  }

  private get stride(): number {
    return this.sh1106 ? 132 : this.width;
  }

  /** Начало передачи по I²C. */
  begin(): void {
    this.expectCtrl = true;
  }

  /** Байт по I²C: сначала байт-признак (0x00/0x80 — команды, 0x40/0xC0 — данные). */
  byte(v: number): void {
    if (this.expectCtrl) {
      this.co = !!(v & 0x80);
      this.isData = !!(v & 0x40);
      this.expectCtrl = false;
      return;
    }
    if (this.isData) this.data(v);
    else this.command(v);
    if (this.co) this.expectCtrl = true;
  }

  command(v: number): void {
    if (this.need) {
      this.pending.push(v);
      if (--this.need === 0) this.apply(this.pending[0], this.pending.slice(1));
      return;
    }
    const n = ARGS[v];
    if (n) {
      this.pending = [v];
      this.need = n;
      return;
    }
    this.apply(v, []);
  }

  private apply(c: number, a: number[]): void {
    if (c === 0xae) this.on = false;
    else if (c === 0xaf) this.on = true;
    else if (c === 0xa6) this.inverted = false;
    else if (c === 0xa7) this.inverted = true;
    else if (c === 0x20) this.mode = a[0] & 3;
    else if (c === 0x21) {
      this.colStart = this.col = a[0] & 0x7f;
      this.colEnd = a[1] & 0x7f;
    } else if (c === 0x22) {
      this.pageStart = this.page = a[0] & 7;
      this.pageEnd = a[1] & 7;
    } else if (c >= 0xb0 && c <= 0xb7) this.page = c & 7;
    else if (c <= 0x0f) this.col = (this.col & 0xf0) | c;
    else if (c >= 0x10 && c <= 0x1f) this.col = (this.col & 0x0f) | ((c & 0x0f) << 4);
  }

  data(v: number): void {
    const pages = this.height / 8;
    if (this.page < pages && this.col < this.stride) this.ram[this.page * this.stride + this.col] = v;
    if (this.mode === 0) {
      if (this.col >= this.colEnd) {
        this.col = this.colStart;
        this.page = this.page >= this.pageEnd ? this.pageStart : this.page + 1;
      } else this.col++;
    } else if (this.mode === 1) {
      if (this.page >= this.pageEnd) {
        this.page = this.pageStart;
        this.col = this.col >= this.colEnd ? this.colStart : this.col + 1;
      } else this.page++;
    } else if (this.col < this.stride - 1) this.col++;
  }

  /** Пиксель видимой области. */
  pixel(x: number, y: number): boolean {
    const cx = this.sh1106 ? x + 2 : x;
    const bit = (this.ram[(y >> 3) * this.stride + cx] >> (y & 7)) & 1;
    return this.on && (bit === 1) !== this.inverted;
  }

  /** Кадр одним массивом (1 — горит) для отрисовки. */
  frame(): Uint8Array {
    const out = new Uint8Array(this.width * this.height);
    for (let y = 0; y < this.height; y++) for (let x = 0; x < this.width; x++) out[y * this.width + x] = this.pixel(x, y) ? 1 : 0;
    return out;
  }
}
