import { zlibSync } from 'fflate';
import type { Vec2 } from '../math/vec';

/*
 * Небольшой писатель PDF: только векторная графика (пути, заливка, обводка).
 * Надписи рисуются штриховым шрифтом редактора как линии — кириллица работает
 * без встраивания шрифтов. Страница задаётся в мм, ось Y вниз (как в проекте).
 */

const PT_PER_MM = 72 / 25.4;
const n = (v: number): string => {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};

export class PdfPage {
  private ops: string[] = [];
  constructor(
    readonly widthMm: number,
    readonly heightMm: number,
  ) {
    // Единица — 1 мм, начало — левый верхний угол, ось Y вниз.
    this.ops.push(`${n(PT_PER_MM)} 0 0 ${n(-PT_PER_MM)} 0 ${n(heightMm * PT_PER_MM)} cm`, '1 J 1 j');
  }

  save(): this {
    this.ops.push('q');
    return this;
  }
  restore(): this {
    this.ops.push('Q');
    return this;
  }
  /** Матрица преобразования: x' = a·x + c·y + e, y' = b·x + d·y + f. */
  transform(a: number, b: number, c: number, d: number, e: number, f: number): this {
    this.ops.push(`${n(a)} ${n(b)} ${n(c)} ${n(d)} ${n(e)} ${n(f)} cm`);
    return this;
  }
  /** Серый 0…1 (0 — чёрный) или цвет '#rrggbb'. */
  fillColor(c: number | string): this {
    this.ops.push(typeof c === 'number' ? `${n(c)} g` : `${rgb(c)} rg`);
    return this;
  }
  strokeColor(c: number | string): this {
    this.ops.push(typeof c === 'number' ? `${n(c)} G` : `${rgb(c)} RG`);
    return this;
  }
  lineWidth(w: number): this {
    this.ops.push(`${n(w)} w`);
    return this;
  }

  private path(pts: Vec2[], closed: boolean): void {
    if (!pts.length) return;
    this.ops.push(`${n(pts[0].x)} ${n(pts[0].y)} m`);
    for (let i = 1; i < pts.length; i++) this.ops.push(`${n(pts[i].x)} ${n(pts[i].y)} l`);
    if (closed) this.ops.push('h');
  }

  polyline(pts: Vec2[], width: number, closed = false): this {
    if (pts.length < 2) return this;
    this.lineWidth(width);
    this.path(pts, closed);
    this.ops.push('S');
    return this;
  }
  polygon(pts: Vec2[]): this {
    if (pts.length < 3) return this;
    this.path(pts, true);
    this.ops.push('f');
    return this;
  }
  /** Несколько контуров одной заливкой по правилу чётности (заливка полигона с вырезами). */
  evenOdd(loops: Vec2[][]): this {
    let any = false;
    for (const l of loops)
      if (l.length >= 3) {
        this.path(l, true);
        any = true;
      }
    if (any) this.ops.push('f*');
    return this;
  }
  circle(c: Vec2, r: number, mode: 'fill' | 'stroke' = 'fill', width = 0.1): this {
    const k = 0.5523 * r;
    const { x, y } = c;
    if (mode === 'stroke') this.lineWidth(width);
    this.ops.push(
      `${n(x + r)} ${n(y)} m`,
      `${n(x + r)} ${n(y + k)} ${n(x + k)} ${n(y + r)} ${n(x)} ${n(y + r)} c`,
      `${n(x - k)} ${n(y + r)} ${n(x - r)} ${n(y + k)} ${n(x - r)} ${n(y)} c`,
      `${n(x - r)} ${n(y - k)} ${n(x - k)} ${n(y - r)} ${n(x)} ${n(y - r)} c`,
      `${n(x + k)} ${n(y - r)} ${n(x + r)} ${n(y - k)} ${n(x + r)} ${n(y)} c`,
      mode === 'fill' ? 'f' : 'S',
    );
    return this;
  }
  rect(x: number, y: number, w: number, h: number, mode: 'fill' | 'stroke' = 'fill', width = 0.1): this {
    if (mode === 'stroke') this.lineWidth(width);
    this.ops.push(`${n(x)} ${n(y)} ${n(w)} ${n(h)} re`, mode === 'fill' ? 'f' : 'S');
    return this;
  }

  content(): string {
    return this.ops.join('\n');
  }
}

function rgb(hex: string): string {
  const v = parseInt(hex.replace('#', ''), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((c) => n(c / 255)).join(' ');
}

/** Строка PDF в UTF-16BE (для названия документа по-русски). */
function textString(s: string): string {
  let hex = 'FEFF';
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp > 0xffff) {
      const v = cp - 0x10000;
      hex += (0xd800 + (v >> 10)).toString(16).padStart(4, '0') + (0xdc00 + (v & 0x3ff)).toString(16).padStart(4, '0');
    } else hex += cp.toString(16).padStart(4, '0');
  }
  return `<${hex.toUpperCase()}>`;
}

export class PdfDoc {
  readonly pages: PdfPage[] = [];
  constructor(private readonly title = 'Plata') {}

  addPage(widthMm: number, heightMm: number): PdfPage {
    const p = new PdfPage(widthMm, heightMm);
    this.pages.push(p);
    return p;
  }

  toBytes(): Uint8Array {
    const enc = new TextEncoder();
    const chunks: Uint8Array[] = [];
    let size = 0;
    const offsets: number[] = [];
    const put = (b: Uint8Array | string) => {
      const u = typeof b === 'string' ? enc.encode(b) : b;
      chunks.push(u);
      size += u.length;
    };
    const obj = (id: number, body: string) => {
      offsets[id] = size;
      put(`${id} 0 obj\n${body}\nendobj\n`);
    };
    put('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    const np = this.pages.length;
    // 1 — каталог, 2 — дерево страниц, 3 — сведения, далее по два объекта на страницу.
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, `<< /Type /Pages /Kids [${this.pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${np} >>`);
    obj(3, `<< /Title ${textString(this.title)} /Producer (Plata) >>`);
    this.pages.forEach((pg, i) => {
      const pid = 4 + i * 2;
      const cid = pid + 1;
      obj(pid, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(pg.widthMm * PT_PER_MM)} ${n(pg.heightMm * PT_PER_MM)}] /Contents ${cid} 0 R /Resources << >> >>`);
      const data = zlibSync(enc.encode(pg.content()), { level: 6 });
      offsets[cid] = size;
      put(`${cid} 0 obj\n<< /Length ${data.length} /Filter /FlateDecode >>\nstream\n`);
      put(data);
      put('\nendstream\nendobj\n');
    });
    const count = 4 + np * 2;
    const xref = size;
    let x = `xref\n0 ${count}\n0000000000 65535 f \n`;
    for (let i = 1; i < count; i++) x += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    put(x);
    put(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    const out = new Uint8Array(size);
    let o = 0;
    for (const c of chunks) {
      out.set(c, o);
      o += c.length;
    }
    return out;
  }
}
