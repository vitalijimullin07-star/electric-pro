/*
 * Экран пылесоса в телефоне: кадр интерфейса 480×320 (тот же код, что в прошивке, нарисованный в scale раз
 * крупнее — чётко на экране телефона) и касания в точках интерфейса.
 */
import { useEffect, useRef } from 'react';

/** Полоса кадра: строки y0… во всю ширину w (кадр w×h, в scale раз крупнее точек интерфейса). */
export interface PanelFrame {
  rgba: Uint8ClampedArray;
  w: number;
  h: number;
  y0: number;
  scale: number;
}

export interface PanelSource {
  onFrame: ((f: PanelFrame) => void) | null;
  view(on: boolean): void;
  touch(x: number, y: number, down: boolean): void;
}

export function Panel({ src, full }: { src: PanelSource; full?: boolean }) {
  const cv = useRef<HTMLCanvasElement>(null);
  /** Размер интерфейса в его точках (касания — в них). */
  const size = useRef({ w: 480, h: 320 });
  useEffect(() => {
    src.onFrame = (f) => {
      const c = cv.current;
      if (!c) return;
      if (c.width !== f.w || c.height !== f.h) {
        c.width = f.w;
        c.height = f.h;
      }
      size.current = { w: f.w / f.scale, h: f.h / f.scale };
      const rows = f.rgba.length / 4 / f.w;
      c.getContext('2d')!.putImageData(new ImageData(f.rgba as Uint8ClampedArray<ArrayBuffer>, f.w, rows), 0, f.y0);
    };
    src.view(true);
    return () => {
      src.view(false);
      src.onFrame = null;
    };
  }, [src]);
  /* Во весь экран кадр вписан с полями (object-fit: contain): точку считаем от самой картинки. */
  const at = (e: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect();
    const { w, h } = size.current;
    const k = Math.min(r.width / w, r.height / h);
    const ox = r.left + (r.width - w * k) / 2;
    const oy = r.top + (r.height - h * k) / 2;
    return [Math.max(0, Math.min(w - 1, (e.clientX - ox) / k)), Math.max(0, Math.min(h - 1, (e.clientY - oy) / k))];
  };
  return (
    <canvas
      ref={cv}
      width={1440}
      height={960}
      className={full ? 'panel full' : 'panel'}
      aria-label="Экран пылесоса: касания передаются ему"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        src.touch(...at(e), true);
      }}
      onPointerMove={(e) => e.buttons && src.touch(...at(e), true)}
      onPointerUp={(e) => src.touch(...at(e), false)}
      onPointerCancel={(e) => src.touch(...at(e), false)}
    />
  );
}
