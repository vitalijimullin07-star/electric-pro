/*
 * Кадры экрана пылесоса из воркера: RGB565 → RGBA полосой от первой до последней изменившейся строки
 * (кадр у телефона 1440×960 — втрое крупнее точек интерфейса). Общее для демо и копии экрана настоящего пылесоса.
 */
import type { PanelS3 } from '../../core/sim/panel-s3';

export interface FrameMsg {
  frame: ArrayBuffer;
  w: number;
  h: number;
  y0: number;
  s: number;
}

export class FrameDiff {
  private prev: Uint16Array | null = null;
  private lastVer = -1;
  private lastAt = 0;

  /** Смотреть начали заново — следующий кадр целиком. */
  reset(): void {
    this.prev = null;
    this.lastVer = -1;
  }

  /** Новый кадр (не чаще раза в 60 мс) или null, если ничего не изменилось. */
  next(p: PanelS3): FrameMsg | null {
    const now = performance.now();
    if (p.version === this.lastVer || now - this.lastAt < 60) return null;
    this.lastVer = p.version;
    this.lastAt = now;
    const w = p.width;
    const h = p.height;
    const src = p.sleeping() ? new Uint16Array(w * h) : p.pixels();
    let y0 = 0;
    let y1 = h;
    const prev = this.prev;
    if (prev && prev.length === src.length) {
      const same = (y: number) => {
        for (let i = y * w, e = i + w; i < e; i++) if (src[i] !== prev[i]) return false;
        return true;
      };
      while (y0 < h && same(y0)) y0++;
      if (y0 === h) return null;
      while (y1 > y0 && same(y1 - 1)) y1--;
      prev.set(src.subarray(y0 * w, y1 * w), y0 * w);
    } else this.prev = src.slice();
    const out = new Uint8ClampedArray(w * (y1 - y0) * 4);
    for (let i = y0 * w, e = y1 * w, j = 0; i < e; i++, j += 4) {
      const c = src[i];
      out[j] = ((c >> 11) & 31) * 255 / 31;
      out[j + 1] = ((c >> 5) & 63) * 255 / 63;
      out[j + 2] = (c & 31) * 255 / 31;
      out[j + 3] = 255;
    }
    return { frame: out.buffer, w, h, y0, s: p.scale };
  }
}
