import type { DeviceView } from '@core/sim';
import { charOf } from '@core/sim/hd44780';

/*
 * Экран символьного ЖК на холсте: обычные знаки — текстом, свои символы прошивки
 * (CGRAM, коды 0…15: шкалы, значки батареи и динамика) — растром 5×8, как на дисплее.
 */

export function drawLcd(ctx: CanvasRenderingContext2D, d: DeviceView, x: number, y: number, w: number, h: number): void {
  const rows = d.codes ?? d.lines?.map((l) => [...l].map((c) => c.charCodeAt(0))) ?? [];
  if (!rows.length) return;
  const cols = rows[0].length || 16;
  const lit = d.backlight === false ? 0 : (d.brightness ?? 1);
  ctx.fillStyle = lit > 0.05 ? `rgb(${Math.round(21 + 15 * lit)},${Math.round(35 + 53 * lit)},${Math.round(63 + 151 * lit)})` : '#15233f';
  ctx.fillRect(x, y, w, h);
  const cw = w / cols;
  const ch = h / rows.length;
  ctx.fillStyle = '#eaf2ff';
  ctx.font = `${(ch * 0.8).toFixed(3)}px ui-monospace, monospace`;
  ctx.textBaseline = 'middle';
  rows.forEach((row, r) =>
    row.forEach((code, c) => {
      const cx = x + c * cw;
      const cy = y + r * ch;
      if (d.codes && code < 16 && d.glyphs) {
        const g = d.glyphs[code & 7];
        const px = (cw * 0.9) / 5;
        const py = (ch * 0.86) / 8;
        for (let yy = 0; yy < 8; yy++) for (let xx = 0; xx < 5; xx++) if ((g[yy] >> (4 - xx)) & 1) ctx.fillRect(cx + cw * 0.05 + xx * px, cy + ch * 0.07 + yy * py, px * 0.9, py * 0.9);
      } else {
        const t = d.codes ? charOf(code) : String.fromCharCode(code);
        if (t !== ' ') ctx.fillText(t, cx + cw * 0.1, cy + ch / 2);
      }
    }),
  );
  ctx.textBaseline = 'alphabetic';
}
