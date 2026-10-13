import { Fragment, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useEditor } from '@editor/store';
import { safeStorage } from '@editor/storage';
import { raycastStl, stlSize, type StlModel, type V3 } from '@core/io/stl';
import { fmt } from '@core/units';
import { StlGl, STL_FOV, camBasis, type StlCam, type StlItem } from '@render/stl-gl';
import { gfxProfile } from '@render/quality';
import { onBack } from '../back-button';
import { saveTextFile } from '../files';
import { STL_COLORS, clearStlErrors, pickStlFiles, rotateAllStl, splitStlEntry, stlSnapshot, subscribeStl, updateStlEntries, type StlEntry } from '../stl-session';

/*
 * Просмотр 3D-моделей STL, STEP, IGES: несколько файлов сразу (и ZIP с ними), сборки STEP — по
 * деталям, сборка одним файлом разбивается на тела, разнесение; вращение, сдвиг, масштаб
 * мышью и пальцами, стандартные виды, разрез плоскостью, замер расстояния по двум точкам
 * на поверхности, габарит, объём, масса по материалу, проверка замкнутости.
 */

const MATERIALS = [
  { id: 'pacf', name: 'PA-CF', rho: 1.2 },
  { id: 'pla', name: 'PLA', rho: 1.24 },
  { id: 'petg', name: 'PETG', rho: 1.27 },
  { id: 'abs', name: 'ABS', rho: 1.04 },
  { id: 'asa', name: 'ASA', rho: 1.07 },
  { id: 'tpu', name: 'TPU', rho: 1.21 },
  { id: 'al', name: 'алюминий', rho: 2.7 },
  { id: 'steel', name: 'сталь', rho: 7.85 },
];
const UNITS = [
  { k: 1, label: 'мм' },
  { k: 10, label: 'см' },
  { k: 1000, label: 'м' },
  { k: 25.4, label: 'дюймы' },
];
type ViewId = 'iso' | 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right';
const VIEWS: Record<ViewId, { label: string; yaw: number; pitch: number }> = {
  iso: { label: 'Изометрия', yaw: 0.62, pitch: 0.52 },
  top: { label: 'Сверху', yaw: 0, pitch: Math.PI / 2 },
  bottom: { label: 'Снизу', yaw: 0, pitch: -Math.PI / 2 },
  front: { label: 'Спереди', yaw: 0, pitch: 0 },
  back: { label: 'Сзади', yaw: Math.PI, pitch: 0 },
  left: { label: 'Слева', yaw: -Math.PI / 2, pitch: 0 },
  right: { label: 'Справа', yaw: Math.PI / 2, pitch: 0 },
};
const AXES = ['X', 'Y', 'Z'] as const;

interface Prefs {
  edges: boolean;
  grid: boolean;
  ortho: boolean;
  row: boolean;
  material: string;
  scale: number;
}
const PREF_KEY = 'plata2:stl-view';
const DEF: Prefs = { edges: true, grid: true, ortho: false, row: false, material: 'pacf', scale: 1 };
function loadPrefs(): Prefs {
  try {
    return { ...DEF, ...(JSON.parse(safeStorage.getItem(PREF_KEY) ?? '{}') as Partial<Prefs>) };
  } catch {
    return DEF;
  }
}

interface Box {
  min: V3;
  max: V3;
}
const hexRgb = (h: string): V3 => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const mm = (v: number) => fmt(v, Math.abs(v) >= 100 ? 1 : 2);
/** Большое число — с разбивкой на тысячи. */
const big = (v: number, digits: number) => (Math.abs(v) >= 10000 ? Math.round(v).toLocaleString('ru-RU') : fmt(v, digits));
/** Объём в см³, от литра — в литрах. */
const volText = (cm3: number) => (cm3 >= 1000 ? `${big(cm3 / 1000, cm3 >= 100000 ? 0 : 2)} л` : `${fmt(cm3, cm3 < 10 ? 2 : 1)} см³`);
/** Масса в граммах, от килограмма — в килограммах. */
const massText = (g: number) => (g >= 1000 ? `${big(g / 1000, g >= 100000 ? 0 : 2)} кг` : `${fmt(g, g < 10 ? 1 : 0)} г`);

/**
 * Модели в мире: масштаб единиц и раскладка «рядом» — каждая на свой участок стола,
 * рядами слева направо и сверху вниз (как текст на виде сверху), все стоят на z = 0.
 */
function layout(entries: StlEntry[], scale: number, row: boolean, explode = 0): { items: StlItem[]; box: Box | null } {
  const vis = entries.filter((e) => e.visible);
  const dims = vis.map((e) => stlSize(e.model).map((v) => v * scale));
  const biggest = Math.max(0, ...dims.map((d) => Math.max(d[0], d[1])));
  const gap = Math.max(5, biggest * 0.08);
  const width = Math.max(0, ...dims.map((d) => d[0]));
  const shelf = Math.max(width, Math.sqrt(dims.reduce((a, d) => a + (d[0] + gap) * (d[1] + gap), 0)) * 1.3);
  let cx = 0;
  let cy = 0;
  let depth = 0;
  let box: Box | null = null;
  const items = entries.map((e): StlItem => {
    const m = e.model;
    let off: V3 = [0, 0, 0];
    if (row && e.visible) {
      const w = (m.max[0] - m.min[0]) * scale;
      const h = (m.max[1] - m.min[1]) * scale;
      if (cx > 0 && cx + w > shelf) {
        cx = 0;
        cy -= depth + gap;
        depth = 0;
      }
      off = [cx - m.min[0] * scale, cy - m.max[1] * scale, -m.min[2] * scale];
      cx += w + gap;
      depth = Math.max(depth, h);
    }
    return { key: e.key, model: m, color: hexRgb(e.color), visible: e.visible, offset: off };
  });
  // Разнесение (взрыв-схема): каждая деталь отодвигается от центра сборки вдоль своего направления.
  if (explode > 0 && !row) {
    const vb = items.filter((i) => i.visible).map((i) => itemBox(i, scale));
    if (vb.length > 1) {
      const c = [0, 1, 2].map((k) => (Math.min(...vb.map((b) => b.min[k])) + Math.max(...vb.map((b) => b.max[k]))) / 2);
      for (const it of items) {
        if (!it.visible) continue;
        const b = itemBox(it, scale);
        it.offset = [0, 1, 2].map((k) => it.offset[k] + ((b.min[k] + b.max[k]) / 2 - c[k]) * explode * 1.5) as V3;
      }
    }
  }
  for (const it of items) {
    if (!it.visible) continue;
    const b = itemBox(it, scale);
    box = box ? { min: [0, 1, 2].map((k) => Math.min(box!.min[k], b.min[k])) as V3, max: [0, 1, 2].map((k) => Math.max(box!.max[k], b.max[k])) as V3 } : b;
  }
  return { items, box };
}

/** Габарит модели в мире с учётом единиц и раскладки. */
function itemBox(it: StlItem, scale: number): Box {
  return { min: [0, 1, 2].map((k) => it.model.min[k] * scale + it.offset[k]) as V3, max: [0, 1, 2].map((k) => it.model.max[k] * scale + it.offset[k]) as V3 };
}

function gridFor(b: Box) {
  const m = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], 1e-3);
  const pad = m * 0.15;
  const step = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000].find((s) => (m + 2 * pad) / s <= 30) ?? 10000;
  return {
    z: b.min[2],
    minX: Math.floor((b.min[0] - pad) / step) * step,
    maxX: Math.ceil((b.max[0] + pad) / step) * step,
    minY: Math.floor((b.min[1] - pad) / step) * step,
    maxY: Math.ceil((b.max[1] + pad) / step) * step,
    step,
  };
}

const shortName = (n: string) => n.slice(n.lastIndexOf('/') + 1);

export function StlViewer() {
  const s = useEditor();
  const snap = useSyncExternalStore(subscribeStl, stlSnapshot);
  const entries = snap.entries;
  const gfx = gfxProfile(s.quality, s.gfxLevel);
  const [prefs, setPrefsState] = useState<Prefs>(loadPrefs);
  const setPrefs = (p: Partial<Prefs>) =>
    setPrefsState((cur) => {
      const next = { ...cur, ...p };
      safeStorage.setItem(PREF_KEY, JSON.stringify(next));
      return next;
    });
  const [clip, setClip] = useState<{ on: boolean; axis: 0 | 1 | 2; t: number; flip: boolean }>({ on: false, axis: 2, t: 0.5, flip: false });
  const [measure, setMeasure] = useState(false);
  const [marks, setMarks] = useState<V3[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [panel, setPanel] = useState(() => window.innerWidth >= 760);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Одна модель «в фокусе»: камера вращается вокруг неё, разрез — только по ней.
  const [focus, setFocus] = useState<string | null>(null);
  const [others, setOthers] = useState(false);
  // Следующее касание задаёт место разреза.
  const [clipPick, setClipPick] = useState(false);
  // Разнесение деталей (0…1) и свёрнутые сборки в списке.
  const [explode, setExplode] = useState(0);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const cvRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<StlGl | null>(null);
  const cam = useRef<StlCam>({ yaw: VIEWS.iso.yaw, pitch: VIEWS.iso.pitch, dist: 300, target: [0, 0, 0], ortho: prefs.ortho });
  const raf = useRef(0);

  const { items: laid, box: sceneBox } = useMemo(() => layout(entries, prefs.scale, prefs.row, explode), [entries, prefs.scale, prefs.row, explode]);
  const focusItem = focus ? (laid.find((i) => i.key === focus && i.visible) ?? null) : null;
  const items = useMemo(
    () => (focusItem ? laid.map((it) => ({ ...it, visible: it.visible && (it.key === focusItem.key || others), clip: it.key === focusItem.key })) : laid),
    [laid, focusItem?.key, others], // eslint-disable-line react-hooks/exhaustive-deps
  );
  // Габарит, по которому вписывается камера и ходит разрез: модель в фокусе или вся сцена.
  const box = focusItem ? itemBox(focusItem, prefs.scale) : sceneBox;
  const clipPlane = clip.on && !clipPick && box ? { axis: clip.axis, pos: box.min[clip.axis] + clip.t * (box.max[clip.axis] - box.min[clip.axis]), flip: clip.flip } : null;
  const diag = box ? len(sub(box.max, box.min)) : 0;

  // Всё, что нужно для кадра и для обработчиков касаний, — в одном изменяемом месте.
  const live = useRef({ items, laid, sceneBox, box, clip, clipPlane, clipPick, focus: focusItem?.key ?? null, prefs, marks, measure, selected, more, panel, dpr: 1 });
  live.current = { items, laid, sceneBox, box, clip, clipPlane, clipPick, focus: focusItem?.key ?? null, prefs, marks, measure, selected, more, panel, dpr: Math.min(gfx.dprCap, window.devicePixelRatio || 1) };

  const redraw = () => {
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      const g = glRef.current;
      const L = live.current;
      if (!g) return;
      cam.current.ortho = L.prefs.ortho;
      g.draw(cam.current, {
        scale: L.prefs.scale,
        clip: L.clipPlane,
        edges: L.prefs.edges,
        grid: L.prefs.grid && L.box ? gridFor(L.box) : null,
        axes: L.box ? Math.max(5, len(sub(L.box.max, L.box.min)) * 0.12) : 0,
        marks: L.marks,
        hi: L.selected,
        dpr: L.dpr,
      });
    });
  };

  const fit = (b: Box | null = live.current.box) => {
    if (!b) return;
    const c = cam.current;
    const cv = cvRef.current;
    // Узкий экран (телефон стоя): вписывать по ширине.
    const aspect = cv && cv.clientHeight ? cv.clientWidth / cv.clientHeight : 1;
    const half = Math.atan(Math.tan(STL_FOV / 2) * Math.min(1, aspect));
    c.target = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
    c.dist = Math.max(len(sub(b.max, b.min)) / 2, 0.01) / Math.sin(half);
    redraw();
  };
  /** Смотреть одну модель (null — все): камера вписывается в неё, разрез — посередине неё. */
  const focusOn = (key: string | null) => {
    const L = live.current;
    const it = key ? L.laid.find((i) => i.key === key) : null;
    setFocus(it ? it.key : null);
    if (it) setSelected(it.key);
    setClip((c) => ({ ...c, t: 0.5 }));
    setClipPick(false);
    setMarks([]);
    fit(it ? itemBox(it, L.prefs.scale) : L.sceneBox);
  };
  const setView = (v: ViewId) => {
    cam.current.yaw = VIEWS[v].yaw;
    cam.current.pitch = VIEWS[v].pitch;
    fit();
  };

  // WebGL: создаётся при открытии окна, освобождается при закрытии. Телефон может отобрать
  // видеопамять (свернули браузер) — тогда всё загружается заново, когда её вернут.
  useEffect(() => {
    const cv = cvRef.current!;
    const make = () => {
      try {
        glRef.current = new StlGl(cv, gfx.antialias3d);
        glRef.current.setItems(live.current.items);
        setError(null);
      } catch (e) {
        glRef.current = null;
        setError((e as Error).message);
      }
      redraw();
    };
    const lost = (e: Event) => {
      e.preventDefault();
      glRef.current = null;
    };
    make();
    cv.addEventListener('webglcontextlost', lost);
    cv.addEventListener('webglcontextrestored', make);
    return () => {
      cv.removeEventListener('webglcontextlost', lost);
      cv.removeEventListener('webglcontextrestored', make);
      cancelAnimationFrame(raf.current);
      raf.current = 0;
      glRef.current?.dispose();
      glRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Новые модели — загрузить и вписать в экран; убранные — освободить. Смена раскладки или единиц — вписать заново.
  const shown = useRef<{ keys: Set<string>; sig: string }>({ keys: new Set(), sig: '' });
  useEffect(() => {
    glRef.current?.setItems(items);
    const sig = `${prefs.row}|${prefs.scale}`;
    const prev = shown.current;
    const added = items.some((i) => !prev.keys.has(i.key));
    shown.current = { keys: new Set(items.map((i) => i.key)), sig };
    if (added || sig !== prev.sig) fit(box);
    if (selected && !items.some((i) => i.key === selected)) setSelected(null);
    if (focus && !laid.some((i) => i.key === focus && i.visible)) setFocus(null);
    redraw();
  }, [items]); // eslint-disable-line react-hooks/exhaustive-deps

  // Любое изменение состояния окна — новый кадр.
  useEffect(() => redraw());

  /** Модель и точка под пальцем (мир, мм). Части за плоскостью разреза не считаются. */
  const pick = (px: number, py: number): { key: string; p: V3 } | null => {
    const g = glRef.current;
    if (!g) return null;
    const L = live.current;
    const r = g.ray(cam.current, px, py);
    const k = L.prefs.scale;
    let best: { key: string; t: number } | null = null;
    for (const it of L.items) {
      if (!it.visible) continue;
      const o = [0, 1, 2].map((i) => (r.o[i] - it.offset[i]) / k) as V3;
      const cp = it.clip === false ? null : L.clipPlane;
      const keep = cp
        ? (x: number, y: number, z: number) => {
            const w = [x, y, z][cp.axis] * k + it.offset[cp.axis];
            return cp.flip ? w >= cp.pos : w <= cp.pos;
          }
        : undefined;
      const t = raycastStl(it.model.positions, o, r.d, keep);
      if (t !== null && (!best || t * k < best.t)) best = { key: it.key, t: t * k };
    }
    return best ? { key: best.key, p: [0, 1, 2].map((i) => r.o[i] + r.d[i] * best!.t) as V3 } : null;
  };

  // Мышь, колесо и касания.
  useEffect(() => {
    const cv = cvRef.current!;
    const pts = new Map<number, { x: number; y: number }>();
    let last: { x: number; y: number; d?: number } | null = null;
    let panMode = false;
    let down: { x: number; y: number; t: number } | null = null;
    let moved = false;
    let lastTap = { t: 0, x: 0, y: 0 };
    const rel = (e: { clientX: number; clientY: number }) => {
      const b = cv.getBoundingClientRect();
      return { x: e.clientX - b.left, y: e.clientY - b.top };
    };
    const pan = (dx: number, dy: number) => {
      const c = cam.current;
      const k = (2 * c.dist * Math.tan(STL_FOV / 2)) / Math.max(1, cv.clientHeight);
      const { x, y } = camBasis(c);
      c.target = [0, 1, 2].map((i) => c.target[i] - x[i] * dx * k + y[i] * dy * k) as V3;
    };
    const zoomAt = (f: number, px: number, py: number) => {
      const c = cam.current;
      const g = glRef.current;
      if (g) {
        const r = g.ray(c, px, py);
        const { z } = camBasis(c);
        const den = dot3(r.d, z);
        if (Math.abs(den) > 1e-6) {
          const t = dot3(sub(c.target, r.o), z) / den;
          const p = [0, 1, 2].map((i) => r.o[i] + r.d[i] * t) as V3;
          c.target = [0, 1, 2].map((i) => c.target[i] + (p[i] - c.target[i]) * (1 - f)) as V3;
        }
      }
      c.dist = Math.min(1e6, Math.max(0.01, c.dist * f));
    };
    const tap = (x: number, y: number) => {
      const L = live.current;
      if (L.clipPick) {
        // Место разреза: плоскость пройдёт через точку касания.
        const h = pick(x, y);
        const b = L.box;
        if (!h || !b) return useEditor.getState().setMessage('Мимо модели — коснитесь места, где нужен разрез.');
        const a = L.clip.axis;
        const span = b.max[a] - b.min[a] || 1;
        // Чуть внутрь модели: плоскость точно по грани (верх фланца) рябит.
        const t = (h.p[a] - b.min[a]) / span;
        setClip((c) => ({ ...c, on: true, t: Math.max(0, Math.min(1, t + (t > 0.5 ? -0.002 : 0.002))) }));
        setClipPick(false);
        return;
      }
      if (L.measure) {
        const h = pick(x, y);
        if (!h) return useEditor.getState().setMessage('Мимо модели — коснитесь поверхности.');
        setMarks((m) => (m.length >= 2 ? [h.p] : [...m, h.p]));
        return;
      }
      const now = performance.now();
      const dbl = now - lastTap.t < 380 && Math.hypot(x - lastTap.x, y - lastTap.y) < 24;
      lastTap = { t: dbl ? 0 : now, x, y };
      const h = pick(x, y);
      if (dbl) {
        // Двойное касание по другой модели — смотреть её отдельно; по той же — вращать вокруг этой точки.
        if (h && h.key !== L.focus) focusOn(h.key);
        else if (h) cam.current.target = h.p;
        redraw();
        return;
      }
      setSelected(h ? h.key : null);
    };
    const onDown = (e: PointerEvent) => {
      cv.setPointerCapture(e.pointerId);
      const q = rel(e);
      pts.set(e.pointerId, q);
      panMode = e.button === 2 || e.button === 1 || e.shiftKey;
      last = null;
      if (pts.size === 1) {
        down = { ...q, t: performance.now() };
        moved = false;
      } else moved = true;
    };
    const onMove = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return;
      const q = rel(e);
      pts.set(e.pointerId, q);
      if (down && Math.hypot(q.x - down.x, q.y - down.y) > 6) moved = true;
      if (!moved) return;
      const list = [...pts.values()];
      const c = cam.current;
      if (list.length >= 2) {
        const [a, b] = list;
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        if (last?.d) {
          zoomAt(last.d / Math.max(1, d), mid.x, mid.y);
          pan(mid.x - last.x, mid.y - last.y);
        }
        last = { x: mid.x, y: mid.y, d };
      } else {
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
    const onUp = (e: PointerEvent) => {
      const had = pts.delete(e.pointerId);
      last = null;
      if (had && !pts.size && down && !moved && e.type === 'pointerup' && e.button === 0 && performance.now() - down.t < 450) {
        const q = rel(e);
        tap(q.x, q.y);
      }
      if (!pts.size) down = null;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const q = rel(e);
      zoomAt(Math.exp(e.deltaY * 0.0012), q.x, q.y);
      redraw();
    };
    const ctx = (e: Event) => e.preventDefault();
    const resize = () => redraw();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
    ro?.observe(cv);
    cv.addEventListener('pointerdown', onDown);
    cv.addEventListener('pointermove', onMove);
    cv.addEventListener('pointerup', onUp);
    cv.addEventListener('pointercancel', onUp);
    cv.addEventListener('wheel', onWheel, { passive: false });
    cv.addEventListener('contextmenu', ctx);
    window.addEventListener('resize', resize);
    return () => {
      cv.removeEventListener('pointerdown', onDown);
      cv.removeEventListener('pointermove', onMove);
      cv.removeEventListener('pointerup', onUp);
      cv.removeEventListener('pointercancel', onUp);
      cv.removeEventListener('wheel', onWheel);
      cv.removeEventListener('contextmenu', ctx);
      window.removeEventListener('resize', resize);
      ro?.disconnect();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // «Назад» и Esc: сначала меню «Ещё», выбор места разреза, замер, модель в фокусе, нижняя панель на телефоне, потом окно целиком.
  useEffect(() => {
    const inner = (): boolean => {
      const L = live.current;
      if (L.more) return setMore(false), true;
      if (L.clipPick) return setClipPick(false), true;
      if (L.measure) return setMeasure(false), setMarks([]), true;
      if (L.focus) return focusOn(null), true;
      if (L.panel && window.innerWidth < 760) return setPanel(false), true;
      return false;
    };
    const off = onBack(inner);
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && inner()) {
        e.stopPropagation();
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', key, true);
    return () => {
      off();
      window.removeEventListener('keydown', key, true);
    };
  }, []);

  const snapshot = async () => {
    setMore(false);
    redraw();
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    const url = glRef.current?.snapshot();
    if (!url) return;
    const bin = atob(url.split(',')[1]);
    const name = entries.length === 1 ? shortName(entries[0].model.name).replace(/\.stl$/i, '') : 'modeli';
    try {
      const ok = await saveTextFile(`${name}-3d.png`, Uint8Array.from(bin, (c) => c.charCodeAt(0)), 'image/png');
      if (ok) s.setMessage('Картинка сохранена.');
    } catch (e) {
      s.setMessage(`Не удалось сохранить картинку: ${(e as Error).message}`);
    }
  };

  const mat = MATERIALS.find((m) => m.id === prefs.material) ?? MATERIALS[0];
  const k = prefs.scale;
  const sel = entries.find((e) => e.key === selected) ?? null;
  const totalTri = entries.reduce((a, e) => a + e.model.triangles, 0);
  const sizeOf = (m: StlModel) => stlSize(m).map((v) => v * k) as V3;
  const sizeText = (v: V3) => `${mm(v[0])} × ${mm(v[1])} × ${mm(v[2])} мм`;
  const sceneSize = box ? sub(box.max, box.min) : null;
  const tiny = !!sceneSize && k === 1 && Math.max(...sceneSize) < 2;

  const info = (e: StlEntry) => {
    const m = e.model;
    const vol = (m.volume * k ** 3) / 1000;
    const ed = m.edges;
    const closed = ed ? (ed.open === 0 && ed.nonManifold === 0 ? 'замкнута — годится для печати' : `не замкнута: дыр (рёбер) ${ed.open}${ed.nonManifold ? `, лишних граней на рёбрах ${ed.nonManifold}` : ''}`) : 'не проверялась (больше 400 тыс. граней)';
    return (
      <dl className="stlv-info">
        <dt>{e.group ? 'Деталь' : 'Файл'}</dt>
        <dd className="stlv-wrap">{m.name}</dd>
        {e.group ? (
          <>
            <dt>Сборка</dt>
            <dd className="stlv-wrap">{e.path ? `${e.group} · ${e.path}` : e.group}</dd>
          </>
        ) : null}
        <dt>Габарит</dt>
        <dd>{sizeText(sizeOf(m))}</dd>
        <dt>Объём</dt>
        <dd>{volText(vol)}</dd>
        <dt>Масса</dt>
        <dd>
          ≈ {massText(vol * mat.rho)} ({mat.name}, сплошная)
        </dd>
        <dt>Площадь</dt>
        <dd>{big((m.area * k * k) / 100, 1)} см²</dd>
        <dt>Граней</dt>
        <dd>{m.triangles.toLocaleString('ru-RU')}</dd>
        <dt>Поверхность</dt>
        <dd className={ed && (ed.open || ed.nonManifold) ? 'warn' : ed ? 'ok' : ''}>{closed}</dd>
        {ed && ed.bodies > 1 ? (
          <>
            <dt>Тел</dt>
            <dd>{ed.bodies}</dd>
          </>
        ) : null}
        {m.flipped ? (
          <>
            <dt>Обход</dt>
            <dd className="warn">был вывернут — показано исправленным</dd>
          </>
        ) : null}
      </dl>
    );
  };

  const measureText = ((): { main: string; sub?: string } | null => {
    if (!measure) return null;
    if (!marks.length) return { main: 'Замер', sub: 'коснитесь первой точки на модели' };
    const p = marks[0];
    if (marks.length === 1) return { main: `Точка 1: X ${mm(p[0])} · Y ${mm(p[1])} · Z ${mm(p[2])}`, sub: 'коснитесь второй точки' };
    const d = sub(marks[1], p);
    return { main: `Расстояние ${mm(len(d))} мм`, sub: `ΔX ${mm(Math.abs(d[0]))} · ΔY ${mm(Math.abs(d[1]))} · ΔZ ${mm(Math.abs(d[2]))}` };
  })();

  return (
    <div className={`stlv${panel ? ' with-panel' : ''}`} role="dialog" aria-label="Просмотр 3D-моделей">
      <div className="stlv-bar">
        <b className="stlv-title">3D</b>
        <button className="btn" onClick={() => void pickStlFiles()}>
          Открыть…
        </button>
        {focusItem && (
          <button className="btn on" onClick={() => focusOn(null)} title="Вернуться ко всем моделям">
            ← Все модели
          </button>
        )}
        <select className="btn" value="" aria-label="Вид" onChange={(e) => setView(e.target.value as ViewId)} disabled={!box}>
          <option value="" disabled>
            Вид
          </option>
          {(Object.keys(VIEWS) as ViewId[]).map((v) => (
            <option key={v} value={v}>
              {VIEWS[v].label}
            </option>
          ))}
        </select>
        <button className="btn" onClick={() => fit()} disabled={!box} title={focusItem ? 'Показать модель целиком' : 'Показать все модели целиком'}>
          Вписать
        </button>
        <button className={`btn${clip.on ? ' on' : ''}`} aria-pressed={clip.on} disabled={!box} onClick={() => setClip((c) => ({ ...c, on: !c.on }))}>
          Разрез
        </button>
        <button
          className={`btn${measure ? ' on' : ''}`}
          aria-pressed={measure}
          disabled={!box}
          onClick={() => {
            setMeasure(!measure);
            setMarks([]);
          }}
        >
          Замер
        </button>
        <button className={`btn${panel ? ' on' : ''}`} aria-pressed={panel} onClick={() => setPanel(!panel)}>
          Модели{entries.length ? ` · ${entries.length}` : ''}
        </button>
        <div className="stlv-more-wrap">
          <button className={`btn${more ? ' on' : ''}`} aria-expanded={more} onClick={() => setMore(!more)}>
            Ещё ▾
          </button>
          {more && (
            <div className="stlv-more" role="menu">
              <label>
                <input type="checkbox" checked={prefs.ortho} onChange={(e) => setPrefs({ ortho: e.target.checked })} /> Без перспективы (для размеров)
              </label>
              <label>
                <input type="checkbox" checked={prefs.edges} onChange={(e) => setPrefs({ edges: e.target.checked })} /> Рёбра
              </label>
              <label>
                <input type="checkbox" checked={prefs.grid} onChange={(e) => setPrefs({ grid: e.target.checked })} /> Сетка и оси
              </label>
              <label>
                <input type="checkbox" checked={prefs.row} onChange={(e) => setPrefs({ row: e.target.checked })} /> Разложить рядом (а не как в файлах)
              </label>
              {focusItem && (
                <label>
                  <input type="checkbox" checked={others} onChange={(e) => setOthers(e.target.checked)} /> Показывать остальные модели (без разреза)
                </label>
              )}
              <label className="stlv-explode">
                Разнести детали
                <input type="range" min={0} max={100} value={Math.round(explode * 100)} disabled={prefs.row || entries.length < 2} aria-label="Разнести детали" onChange={(e) => setExplode(Number(e.target.value) / 100)} />
              </label>
              <button className="btn" onClick={rotateAllStl} disabled={!entries.length} title="Модель из САПР с осью Y вверх лежит на боку — поставить на Z">
                Повернуть всё на 90° (лежит на боку)
              </button>
              <label>
                Единицы файла{' '}
                <select value={prefs.scale} onChange={(e) => setPrefs({ scale: Number(e.target.value) })}>
                  {UNITS.map((u) => (
                    <option key={u.k} value={u.k}>
                      {u.label}
                    </option>
                  ))}
                </select>
              </label>
              <button className="btn" onClick={() => void snapshot()} disabled={!box}>
                Картинка PNG
              </button>
            </div>
          )}
        </div>
        <button className="btn primary stlv-close" onClick={s.closeDialog} aria-label="Закрыть просмотр 3D-моделей">
          Закрыть
        </button>
      </div>

      <div className="stlv-stage">
        <canvas ref={cvRef} aria-label="3D-модели" />
        {clip.on && box && (
          <div className="stlv-clip">
            {focusItem && <span className="stlv-cliptarget mute">{shortName(focusItem.model.name)}</span>}
            <span className="stlv-seg" role="group" aria-label="Ось разреза">
              {AXES.map((a, i) => (
                <button key={a} className={`btn sm${clip.axis === i ? ' on' : ''}`} aria-pressed={clip.axis === i} onClick={() => setClip((c) => ({ ...c, axis: i as 0 | 1 | 2, t: 0.5 }))}>
                  {a}
                </button>
              ))}
            </span>
            <input
              type="range"
              min={0}
              max={1000}
              value={Math.round(clip.t * 1000)}
              aria-label="Положение разреза"
              onChange={(e) => setClip((c) => ({ ...c, t: Number(e.target.value) / 1000 }))}
            />
            <span className="stlv-num">
              {AXES[clip.axis]} = {mm(box.min[clip.axis] + clip.t * (box.max[clip.axis] - box.min[clip.axis]))}
            </span>
            <button className="btn sm" onClick={() => setClip((c) => ({ ...c, flip: !c.flip }))} title="Убрать другую половину">
              ⇄
            </button>
            <button className={`btn sm${clipPick ? ' on' : ''}`} aria-pressed={clipPick} onClick={() => setClipPick(!clipPick)} title="Коснуться модели там, где нужен разрез">
              По точке
            </button>
          </div>
        )}

        {!entries.length && !snap.busy && (
          <div className="stlv-empty">
            <b>Просмотр 3D-моделей</b>
            <p>Выберите файлы STL, STEP или IGES — или архив ZIP, в котором они лежат. Сборка STEP откроется по деталям. Можно перетащить файлы прямо сюда.</p>
            <button className="btn primary" onClick={() => void pickStlFiles()}>
              Открыть файлы
            </button>
            {snap.errors.length > 0 && <p className="warn">{snap.errors.join(' · ')}</p>}
          </div>
        )}
        {snap.busy && <div className="stlv-chip">{snap.busy}</div>}
        {!snap.busy && clipPick && (
          <div className="stlv-chip stlv-measure">
            <span>
              <b>Место разреза</b>
              <small>коснитесь модели там, где нужен разрез по {AXES[clip.axis]}</small>
            </span>
            <button className="btn sm" onClick={() => setClipPick(false)}>
              Отмена
            </button>
          </div>
        )}
        {!snap.busy && !clipPick && measureText && (
          <div className="stlv-chip stlv-measure">
            <span>
              <b>{measureText.main}</b>
              {measureText.sub ? <small>{measureText.sub}</small> : null}
            </span>
            {marks.length > 0 && (
              <button className="btn sm" onClick={() => setMarks([])}>
                Сбросить
              </button>
            )}
          </div>
        )}
        {!snap.busy && !clipPick && !measureText && sel && !panel && (
          <div className="stlv-chip">
            <button className="stlv-chip-main" onClick={() => setPanel(true)} title="Подробнее — в списке моделей">
              <b>{shortName(sel.model.name)}</b>
              <small>
                {sizeText(sizeOf(sel.model))} · {volText((sel.model.volume * k ** 3) / 1000)}
              </small>
            </button>
            {focusItem?.key === sel.key ? (
              <button className="btn sm" onClick={() => focusOn(null)}>
                Все
              </button>
            ) : (
              <button className="btn sm" onClick={() => focusOn(sel.key)}>
                Отдельно
              </button>
            )}
          </div>
        )}
        <div className="stlv-hint">
          {error
            ? `3D недоступно: ${error}`
            : entries.length
              ? `Вращать — мышь или палец; сдвиг — правая кнопка, Shift или два пальца; масштаб — колесо или щипок; двойное касание по модели — смотреть её отдельно, по ней же ещё раз — вращать вокруг точки.${diag ? ` Всё: ${mm(diag)} мм по диагонали.` : ''}`
              : ''}
        </div>
      </div>

      {panel && (
        <aside className="stlv-panel" aria-label="Модели">
          <div className="stlv-panel-head">
            <b>Модели</b>
            <span className="mute">{entries.length ? `${entries.length} шт · ${totalTri.toLocaleString('ru-RU')} граней` : 'нет'}</span>
            <button className="ibtn" onClick={() => setPanel(false)} aria-label="Скрыть список моделей">
              ×
            </button>
          </div>
          {snap.errors.length > 0 && (
            <div className="stlv-err">
              {snap.errors.map((t, i) => (
                <div key={i}>{t}</div>
              ))}
              <button className="btn sm" onClick={clearStlErrors}>
                Скрыть
              </button>
            </div>
          )}
          <div className="stlv-list">
            {entries.map((e, i) => {
              const head = e.group && e.group !== entries[i - 1]?.group;
              const members = head ? entries.filter((x) => x.group === e.group) : [];
              const shut = !!e.group && collapsed.has(e.group);
              return (
                <Fragment key={e.key}>
                  {head && (
                    <div className="stlv-group">
                      <button
                        className="stlv-fold"
                        aria-expanded={!shut}
                        aria-label={`${shut ? 'Раскрыть' : 'Свернуть'} сборку ${e.group}`}
                        onClick={() =>
                          setCollapsed((c) => {
                            const n = new Set(c);
                            if (n.has(e.group!)) n.delete(e.group!);
                            else n.add(e.group!);
                            return n;
                          })
                        }
                      >
                        {shut ? '▸' : '▾'}
                      </button>
                      <input
                        type="checkbox"
                        checked={members.every((x) => x.visible)}
                        aria-label={`Показывать сборку ${e.group}`}
                        onChange={(ev) => updateStlEntries((list) => list.map((x) => (x.group === e.group ? { ...x, visible: ev.target.checked } : x)))}
                      />
                      <div className="stlv-name">
                        <div title={e.group}>{e.group}</div>
                        <small>сборка · деталей: {members.length}</small>
                      </div>
                      <button
                        className="ibtn"
                        aria-label={`Убрать сборку ${e.group}`}
                        title="Убрать всю сборку из просмотра"
                        onClick={() => updateStlEntries((list) => list.filter((x) => x.group !== e.group))}
                      >
                        ×
                      </button>
                    </div>
                  )}
                  {!shut &&
                <div className={`stlv-row${e.group ? ' in-group' : ''}${selected === e.key ? ' sel' : ''}${e.visible ? '' : ' off'}`} onClick={() => setSelected(selected === e.key ? null : e.key)}>
                  <button
                    className="stlv-swatch"
                    style={{ background: e.color }}
                    title="Другой цвет"
                    aria-label={`Цвет: ${shortName(e.model.name)}`}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      updateStlEntries((list) => list.map((x) => (x.key === e.key ? { ...x, color: STL_COLORS[(STL_COLORS.indexOf(x.color) + 1) % STL_COLORS.length] } : x)));
                    }}
                  />
                  <input
                    type="checkbox"
                    checked={e.visible}
                    aria-label={`Показывать ${shortName(e.model.name)}`}
                    onClick={(ev) => ev.stopPropagation()}
                    onChange={(ev) => updateStlEntries((list) => list.map((x) => (x.key === e.key ? { ...x, visible: ev.target.checked } : x)))}
                  />
                  <div className="stlv-name">
                    <div title={e.model.name}>{shortName(e.model.name)}</div>
                    <small>{sizeText(sizeOf(e.model))}</small>
                  </div>
                  <button
                    className={`ibtn${focusItem?.key === e.key ? ' on' : ''}`}
                    aria-label={`Смотреть отдельно: ${shortName(e.model.name)}`}
                    aria-pressed={focusItem?.key === e.key}
                    title={focusItem?.key === e.key ? 'Вернуться ко всем моделям' : 'Смотреть отдельно: камера вокруг неё, разрез по ней'}
                    disabled={!e.visible}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      focusOn(focusItem?.key === e.key ? null : e.key);
                    }}
                  >
                    ◎
                  </button>
                  <button
                    className="ibtn"
                    aria-label={`Убрать ${shortName(e.model.name)}`}
                    title="Убрать из просмотра"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      updateStlEntries((list) => list.filter((x) => x.key !== e.key));
                    }}
                  >
                    ×
                  </button>
                </div>}
                </Fragment>
              );
            })}
          </div>
          {sel ? (
            <>
              {info(sel)}
              <span className="row stlv-sel-act">
                {(sel.model.edges?.bodies ?? 1) > 1 && (
                  <button
                    className="btn sm"
                    title="Сборка одним файлом: каждое тело — отдельной деталью"
                    onClick={() => {
                      const n = splitStlEntry(sel.key);
                      setSelected(null);
                      setFocus(null);
                      s.setMessage(`Разделено на ${n} деталей.`);
                    }}
                  >
                    Разделить на тела ({sel.model.edges!.bodies})
                  </button>
                )}
                {focusItem?.key === sel.key ? (
                  <button className="btn sm" onClick={() => focusOn(null)}>
                    Ко всем моделям
                  </button>
                ) : (
                  <button className="btn sm" onClick={() => focusOn(sel.key)} disabled={!sel.visible}>
                    Смотреть отдельно
                  </button>
                )}
              </span>
            </>
          ) : entries.length > 0 ? <p className="mute stlv-tip">Коснитесь модели или строки — покажу размеры, объём и массу.</p> : null}
          {tiny && <p className="warn stlv-tip">Модели меньше 2 мм — похоже, файл в метрах: «Ещё» → «Единицы файла» → м.</p>}
          <div className="stlv-panel-foot">
            <label>
              Материал{' '}
              <select value={prefs.material} onChange={(e) => setPrefs({ material: e.target.value })}>
                {MATERIALS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} — {fmt(m.rho, 2)} г/см³
                  </option>
                ))}
              </select>
            </label>
            {sceneSize && entries.length > 1 && <span className="mute">Всё вместе: {sizeText(sceneSize)}</span>}
            <span className="row">
              <button className="btn sm" disabled={!entries.some((e) => !e.visible)} onClick={() => updateStlEntries((list) => list.map((x) => ({ ...x, visible: true })))}>
                Показать все
              </button>
              <button
                className="btn sm danger"
                disabled={!entries.length}
                onClick={() => {
                  updateStlEntries(() => []);
                  clearStlErrors();
                  setMarks([]);
                }}
              >
                Убрать все
              </button>
            </span>
          </div>
        </aside>
      )}
    </div>
  );
}
