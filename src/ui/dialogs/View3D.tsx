import { useEffect, useRef, useState } from 'react';
import { useEditor } from '@editor/store';
import { buildScene3D } from '@core/render/scene3d';
import { boardTexture } from '@render/board-texture';
import { GlView, type Camera } from '@render/gl3d';
import { saveTextFile } from '../files';
import { safeName } from '@core/io/gerber';

/*
 * 3D-вид платы: вращение — мышь или один палец, сдвиг — правая кнопка, Shift или два
 * пальца, масштаб — колесо или щипок. Детали — объёмы по габаритам и типовым высотам.
 */

export function View3D() {
  const s = useEditor();
  const p = s.project;
  const cvRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<GlView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [parts, setParts] = useState(true);
  const box = useRef({ cx: 0, cy: 0, size: 100 });
  const cam = useRef<Camera>({ yaw: 0.35, pitch: 0.75, dist: 200, target: [0, 0, 0] });
  const raf = useRef(0);

  const redraw = () => {
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      viewRef.current?.draw(cam.current, Math.min(2, window.devicePixelRatio || 1));
    });
  };

  const preset = (k: 'top' | 'bottom' | 'iso') => {
    const b = box.current;
    cam.current = {
      yaw: k === 'iso' ? 0.35 : 0,
      pitch: k === 'top' ? Math.PI / 2 : k === 'bottom' ? -Math.PI / 2 : 0.75,
      dist: b.size * (k === 'iso' ? 1.5 : 1.7),
      target: [b.cx, -b.cy, 0],
    };
    redraw();
  };

  // Сцена: строится при открытии и при смене проекта или показа деталей.
  useEffect(() => {
    const cv = cvRef.current!;
    try {
      if (!viewRef.current) viewRef.current = new GlView(cv);
      const scene = buildScene3D(p);
      if (!parts) scene.meshes = scene.meshes.slice(0, 3);
      viewRef.current.setScene(scene, { top: boardTexture(p, 'top'), bottom: boardTexture(p, 'bottom') });
      const b = scene.box;
      const first = box.current.size === 100 && box.current.cx === 0;
      box.current = { cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2, size: Math.max(b.maxX - b.minX, b.maxY - b.minY) };
      if (first) preset('iso');
      redraw();
    } catch (e) {
      setError((e as Error).message);
    }
  }, [p, parts]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => viewRef.current?.dispose(), []);

  // Мышь, колесо и касания.
  useEffect(() => {
    const cv = cvRef.current!;
    const pts = new Map<number, { x: number; y: number }>();
    let last: { x: number; y: number; d?: number; mid?: { x: number; y: number } } | null = null;
    let panMode = false;
    const pan = (dx: number, dy: number) => {
      const c = cam.current;
      const k = c.dist / Math.max(200, cv.clientHeight) * 1.2;
      // Сдвиг в плоскости экрана: вправо — вдоль оси, перпендикулярной направлению взгляда.
      const rx = Math.cos(c.yaw);
      const ry = Math.sin(c.yaw);
      c.target = [c.target[0] - (dx * rx) * k + dy * ry * k * Math.sign(Math.sin(c.pitch) || 1), c.target[1] - (dx * ry) * k - dy * rx * k * Math.sign(Math.sin(c.pitch) || 1), c.target[2]];
    };
    const down = (e: PointerEvent) => {
      cv.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      panMode = e.button === 2 || e.button === 1 || e.shiftKey;
      last = null;
    };
    const move = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const list = [...pts.values()];
      const c = cam.current;
      if (list.length >= 2) {
        const [a, b] = list;
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        if (last?.d && last.mid) {
          c.dist = Math.min(5000, Math.max(5, c.dist * (last.d / Math.max(1, d))));
          pan(mid.x - last.mid.x, mid.y - last.mid.y);
        }
        last = { x: mid.x, y: mid.y, d, mid };
      } else {
        const q = list[0];
        if (last && last.d === undefined) {
          const dx = q.x - last.x;
          const dy = q.y - last.y;
          if (panMode) pan(dx, dy);
          else {
            c.yaw -= dx * 0.008;
            c.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, c.pitch + dy * 0.008));
          }
        }
        last = { x: q.x, y: q.y };
      }
      redraw();
    };
    const up = (e: PointerEvent) => {
      pts.delete(e.pointerId);
      last = null;
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      cam.current.dist = Math.min(5000, Math.max(5, cam.current.dist * Math.exp(e.deltaY * 0.0012)));
      redraw();
    };
    const ctx = (e: Event) => e.preventDefault();
    const resize = () => redraw();
    cv.addEventListener('pointerdown', down);
    cv.addEventListener('pointermove', move);
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', wheel, { passive: false });
    cv.addEventListener('contextmenu', ctx);
    window.addEventListener('resize', resize);
    return () => {
      cv.removeEventListener('pointerdown', down);
      cv.removeEventListener('pointermove', move);
      cv.removeEventListener('pointerup', up);
      cv.removeEventListener('pointercancel', up);
      cv.removeEventListener('wheel', wheel);
      cv.removeEventListener('contextmenu', ctx);
      window.removeEventListener('resize', resize);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const snapshot = async () => {
    const url = viewRef.current?.snapshot();
    if (!url) return;
    const bin = atob(url.split(',')[1]);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const ok = await saveTextFile(`${safeName(p.meta.name)}-3d.png`, bytes, 'image/png');
    if (ok !== false) s.setMessage('Картинка 3D-вида сохранена.');
  };

  return (
    <div className="view3d" role="dialog" aria-label="3D-вид платы">
      <canvas ref={cvRef} />
      <div className="view3d-bar">
        <b>3D-вид</b>
        <button className="btn" onClick={() => preset('iso')}>
          Изометрия
        </button>
        <button className="btn" onClick={() => preset('top')}>
          Сверху
        </button>
        <button className="btn" onClick={() => preset('bottom')}>
          Снизу
        </button>
        <label>
          <input type="checkbox" checked={parts} onChange={(e) => setParts(e.target.checked)} /> детали
        </label>
        <button className="btn" onClick={() => void snapshot()}>
          Картинка PNG
        </button>
        <button className="btn primary" onClick={s.closeDialog} aria-label="Закрыть 3D-вид">
          Закрыть
        </button>
      </div>
      <div className="view3d-hint">
        {error ? `3D недоступно: ${error}` : 'Вращать — мышь или палец; сдвиг — правая кнопка, Shift или два пальца; масштаб — колесо или щипок. Высоты деталей типовые.'}
      </div>
    </div>
  );
}
