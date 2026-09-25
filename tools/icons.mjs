// Иконки приложения (PNG) без сторонних библиотек: плата с дорожкой и двумя площадками.
// Запуск: node tools/icons.mjs — пишет public/icon-192.png, icon-512.png, icon-maskable-512.png.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // бит на канал
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const BG = hex('#12161b');
const BOARD = hex('#1b3a2a');
const CU = hex('#e8b061');

/** Расстояние от точки до отрезка. */
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

function draw(size, maskable) {
  const img = Buffer.alloc(size * size * 4);
  const SS = 4;
  // Для «маскируемой» иконки рисунок в безопасном круге 80%, фон — во весь квадрат.
  const k = maskable ? 0.72 : 1;
  const off = (1 - k) / 2;
  const path = [
    [0.3, 0.3],
    [0.56, 0.3],
    [0.56, 0.7],
    [0.7, 0.7],
  ].map(([x, y]) => [off + x * k, off + y * k]);
  const pads = [path[0], path[3]];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const acc = [0, 0, 0, 0];
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) {
          const u = (x + (sx + 0.5) / SS) / size;
          const v = (y + (sy + 0.5) / SS) / size;
          let col = null;
          let a = 255;
          // Скруглённый квадрат (у обычной иконки), у маскируемой — весь квадрат.
          const r = maskable ? 0 : 0.2;
          const inset = maskable ? 0 : 0.04;
          const qx = Math.max(Math.abs(u - 0.5) - (0.5 - inset - r), 0);
          const qy = Math.max(Math.abs(v - 0.5) - (0.5 - inset - r), 0);
          if (Math.hypot(qx, qy) > r) {
            a = 0;
            col = BG;
          } else {
            col = BOARD;
            let dmin = Infinity;
            for (let i = 1; i < path.length; i++) dmin = Math.min(dmin, segDist(u, v, path[i - 1][0], path[i - 1][1], path[i][0], path[i][1]));
            if (dmin < 0.045 * k) col = CU;
            for (const [cx, cy] of pads) {
              const d = Math.hypot(u - cx, v - cy);
              if (d < 0.11 * k) col = d < 0.045 * k ? BOARD : CU;
            }
          }
          acc[0] += col[0] * (a / 255);
          acc[1] += col[1] * (a / 255);
          acc[2] += col[2] * (a / 255);
          acc[3] += a;
        }
      const n = SS * SS;
      const alpha = acc[3] / n;
      const i = (y * size + x) * 4;
      img[i] = alpha ? Math.round((acc[0] / n) * (255 / alpha)) : 0;
      img[i + 1] = alpha ? Math.round((acc[1] / n) * (255 / alpha)) : 0;
      img[i + 2] = alpha ? Math.round((acc[2] / n) * (255 / alpha)) : 0;
      img[i + 3] = Math.round(alpha);
    }
  return png(size, img);
}

const dir = new URL('../public/', import.meta.url).pathname;
mkdirSync(dir, { recursive: true });
writeFileSync(dir + 'icon-192.png', draw(192, false));
writeFileSync(dir + 'icon-512.png', draw(512, false));
writeFileSync(dir + 'icon-maskable-512.png', draw(512, true));
console.log('Иконки записаны в public/');
