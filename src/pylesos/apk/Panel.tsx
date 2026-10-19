/* Экран пылесоса в телефоне: кадр интерфейса 480×320 (тот же код, что в прошивке) и касания. */
import { useEffect, useRef } from 'react';

export interface PanelSource {
  onFrame: ((rgba: Uint8ClampedArray, w: number, h: number) => void) | null;
  view(on: boolean): void;
  touch(x: number, y: number, down: boolean): void;
}

export function Panel({ src, full }: { src: PanelSource; full?: boolean }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const size = useRef({ w: 480, h: 320 });
  useEffect(() => {
    src.onFrame = (rgba, w, h) => {
      const c = cv.current;
      if (!c) return;
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
      }
      size.current = { w, h };
      c.getContext('2d')!.putImageData(new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0);
    };
    src.view(true);
    return () => {
      src.view(false);
      src.onFrame = null;
    };
  }, [src]);
  const at = (e: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * size.current.w, ((e.clientY - r.top) / r.height) * size.current.h];
  };
  return (
    <canvas
      ref={cv}
      width={480}
      height={320}
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
