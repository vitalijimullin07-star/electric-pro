import { useEffect, useRef, useState } from 'react';
import { stableProject, useEditor } from '@editor/store';
import { CanvasController } from '@editor/interaction';
import { fitView, renderScene, screenToWorld, wantsAnimation } from '@render/canvas-renderer';
import { AdaptiveQuality, gfxProfile } from '@render/quality';
import { groupSelection, ungroupSelection, copySelection, cutSelection, deleteSelection, duplicateSelection, flipSelection, netOfSelection, pasteClipboard, rotateSelection, selectAll, toggleActiveLayer, translateSelectionBy } from '@editor/commands';
import { Icon } from './icons';
import { findFootprint } from '@editor/userlib';
import { drcSummary } from '@core/model/drc';
import { GRID_STEPS, UNIT_LABEL, fmt, fromMm } from '@core/units';

/* Холст платы: отрисовка по requestAnimationFrame, события мыши/касаний, клавиатура. */

export function CanvasView() {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctrlRef = useRef<CanvasController | null>(null);
  const redrawRef = useRef<() => void>(() => {});
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const tool = useEditor((s) => s.tool);
  const placeFootprint = useEditor((s) => s.placeFootprint);
  const project = useEditor((s) => s.project);
  const grid = useEditor((s) => s.grid);
  const show = useEditor((s) => s.show);
  const panelOpen = useEditor((s) => s.panelOpen);
  const units = useEditor((s) => s.units);
  const stable = useEditor(stableProject);
  const summary = drcSummary(stable);

  // Отрисовка: подписываемся на store и рисуем в следующем кадре.
  useEffect(() => {
    const canvas = canvasRef.current!;
    const stage = stageRef.current!;
    const ctx = canvas.getContext('2d', { alpha: false })!;
    let raf = 0;
    let dirty = true;
    const adaptive = new AdaptiveQuality(useEditor.getState().gfxLevel);
    const draw = (now: number) => {
      raf = 0;
      if (!dirty) return;
      dirty = false;
      const t0 = performance.now();
      const s = useEditor.getState();
      const gfx = gfxProfile(s.quality, s.gfxLevel);
      const dpr = Math.min(gfx.dprCap, window.devicePixelRatio || 1);
      const w = stage.clientWidth;
      const h = stage.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      renderScene(ctx, {
        project: s.project,
        base: s.transaction ? stableProject(s) : undefined,
        view: s.view,
        width: w,
        height: h,
        dpr,
        activeLayer: s.activeLayer,
        layerVisible: s.layerVisible,
        show: s.show,
        grid: s.grid,
        selection: s.selection,
        hover: s.hover,
        highlightNet: s.highlightNet,
        pending: s.pending,
        measure: s.measure,
        ghost: s.ghost,
        units: s.units,
        gfx,
        time: now,
        penHover: ctrlRef.current?.penHover ?? null,
      });
      // «Авто»: кадры слишком долгие — понижаем качество.
      if (s.quality === 'auto' && adaptive.sample(performance.now() - t0) && adaptive.level !== s.gfxLevel) {
        useEditor.setState({ gfxLevel: adaptive.level });
      }
      // Бегущий пунктир и пульсация — пока есть что анимировать.
      if (wantsAnimation({ gfx, selection: s.selection, highlightNet: s.highlightNet, pending: s.pending })) schedule();
    };
    const schedule = () => {
      dirty = true;
      if (!raf) raf = requestAnimationFrame(draw);
    };
    redrawRef.current = schedule;
    const unsub = useEditor.subscribe(schedule);
    const ro = new ResizeObserver(schedule);
    ro.observe(stage);
    // Первый показ: вписать плату.
    const s0 = useEditor.getState();
    useEditor.setState({ view: fitView(s0.project, stage.clientWidth, stage.clientHeight) });
    schedule();
    return () => {
      unsub();
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  // Вписать при смене проекта.
  const projectId = project.meta.created + project.meta.name;
  useEffect(() => {
    const stage = stageRef.current!;
    const s = useEditor.getState();
    if (s.past.length === 0 && s.future.length === 0) useEditor.setState({ view: fitView(s.project, stage.clientWidth, stage.clientHeight) });
  }, [projectId]);

  // Контроллер событий.
  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctrl = new CanvasController(canvas);
    ctrlRef.current = ctrl;
    ctrl.onOverlay = () => redrawRef.current();
    const onWheel = (e: WheelEvent) => ctrl.onWheel(e);
    const onDown = (e: PointerEvent) => {
      (document.activeElement as HTMLElement | null)?.blur?.();
      ctrl.onPointerDown(e);
    };
    const onMove = (e: PointerEvent) => {
      ctrl.onPointerMove(e);
      const r = canvas.getBoundingClientRect();
      const w = screenToWorld(useEditor.getState().view, { x: e.clientX - r.left, y: e.clientY - r.top });
      setCursor(w);
    };
    const onUp = (e: PointerEvent) => ctrl.onPointerUp(e);
    const onCancel = (e: PointerEvent) => ctrl.onPointerCancel(e);
    const onDbl = (e: MouseEvent) => ctrl.onDoubleClick(e);
    const onCtx = (e: MouseEvent) => e.preventDefault();
    const onLeave = () => ctrl.hideGhost();
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onCancel);
    canvas.addEventListener('dblclick', onDbl);
    canvas.addEventListener('contextmenu', onCtx);
    return () => {
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onCancel);
      canvas.removeEventListener('dblclick', onDbl);
      canvas.removeEventListener('contextmenu', onCtx);
      canvas.removeEventListener('pointerleave', onLeave);
    };
  }, []);

  // Клавиатура.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      const s = useEditor.getState();
      if (s.dialog) {
        if (e.key === 'Escape') s.closeDialog();
        return;
      }
      const ctrl = ctrlRef.current!;
      if (e.key !== 'Shift') ctrl.resetTap();
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'z') {
        e.preventDefault();
        e.shiftKey ? s.redo() : s.undo();
        return;
      }
      if (mod && k === 'y') {
        e.preventDefault();
        s.redo();
        return;
      }
      if (mod && k === 'a') {
        e.preventDefault();
        selectAll();
        return;
      }
      if (mod && k === 'g') {
        e.preventDefault();
        if (e.shiftKey) ungroupSelection();
        else groupSelection();
        return;
      }
      if (mod && (k === 'c' || k === 'x' || k === 'v' || k === 'd') && !e.shiftKey) {
        e.preventDefault();
        if (k === 'c') copySelection();
        else if (k === 'x') cutSelection();
        else if (k === 'v') pasteClipboard(ctrl.pointerWorld);
        else duplicateSelection();
        return;
      }
      if (mod && k === 's') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('plata:save'));
        return;
      }
      if (mod && k === 'o') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('plata:open'));
        return;
      }
      if (mod) return;
      switch (e.key) {
        case 'Escape':
          ctrl.cancelPending();
          return;
        case 'Delete':
        case 'Backspace':
          if (ctrl.undoPoint()) return;
          deleteSelection();
          return;
        case ' ':
          if (!e.repeat) ctrl.setSpace(true);
          e.preventDefault();
          return;
        case 'ArrowLeft':
        case 'ArrowRight':
        case 'ArrowUp':
        case 'ArrowDown': {
          if (!s.selection.length) return;
          e.preventDefault();
          const step = e.shiftKey ? s.grid * 10 : s.grid;
          translateSelectionBy(e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0, e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0);
          return;
        }
      }
      switch (k) {
        case 'r':
          if (ctrl.rotatePlacing()) return;
          rotateSelection(e.shiftKey ? -90 : 90);
          return;
        case 'f':
          if (ctrl.flipPlacing()) return;
          flipSelection();
          return;
        case 'v':
          if (s.pending?.kind === 'route') ctrl.routeVia();
          else s.setTool('via');
          return;
        case '/':
          ctrl.toggleCornerMode();
          return;
        case 'l':
          toggleActiveLayer();
          return;
        case 'g':
          s.patch({ show: { ...s.show, grid: !s.show.grid } });
          return;
        case 'n': {
          const n = netOfSelection();
          s.patch({ highlightNet: s.highlightNet ? null : n });
          return;
        }
        case 's':
          s.setTool('select');
          return;
        case 'w':
          s.setTool('route');
          return;
        case 'j':
          s.setTool('wire');
          return;
        case 'p':
          s.setTool('place');
          s.patch({ panelTab: 'library', panelOpen: true });
          return;
        case 'm':
          s.setTool('measure');
          return;
        case 't':
          s.setTool('text');
          return;
        case 'h':
          s.setTool('pan');
          return;
        case '=':
        case '+':
          zoom(1.25);
          return;
        case '-':
          zoom(0.8);
          return;
        case '0':
          fit();
          return;
        case '3':
          s.openDialog('3d');
          return;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') ctrlRef.current?.setSpace(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  const zoom = (k: number) => {
    const stage = stageRef.current!;
    ctrlRef.current?.zoomAt({ x: stage.clientWidth / 2, y: stage.clientHeight / 2 }, k);
  };
  const fit = () => {
    const stage = stageRef.current!;
    useEditor.setState({ view: fitView(useEditor.getState().project, stage.clientWidth, stage.clientHeight) });
  };

  const ghostFp = tool === 'place' && placeFootprint ? findFootprint(placeFootprint, project) : null;
  const unitsClass = summary.errors ? 'err' : summary.warnings ? 'warn' : 'ok';

  return (
    <div ref={stageRef} className={`stage tool-${tool}`}>
      <canvas ref={canvasRef} />
      <div className="hud">
        <span className={`chip ${summary.unrouted ? 'warn' : 'ok'}`}>
          Разведено <b>{summary.total - summary.unrouted}</b> из <b>{summary.total}</b>
        </span>
        <span className={`chip ${unitsClass}`} title="Проверка правил">
          Ошибок <b>{summary.errors}</b>
          {summary.warnings ? <> · предупр. {summary.warnings}</> : null}
        </span>
        <span className="chip">
          Сетка{' '}
          <select value={String(grid)} onChange={(e) => useEditor.setState({ grid: +e.target.value })} aria-label="Шаг сетки">
            {GRID_STEPS.map((g) => (
              <option key={g.mm} value={String(g.mm)}>
                {g.label}
              </option>
            ))}
            {!GRID_STEPS.some((g) => Math.abs(g.mm - grid) < 1e-9) && <option value={String(grid)}>{grid} мм</option>}
          </select>
        </span>
        {ghostFp && (
          <span className="chip">
            Ставим <b>{ghostFp.name}</b> — R поворот, Esc выход
          </span>
        )}
        {!show.ratsnest && <span className="chip">воздушные линии скрыты</span>}
      </div>
      <button className="ibtn panel-toggle" onClick={() => useEditor.setState({ panelOpen: !panelOpen })} aria-label="Панель">
        <Icon name="panel" />
      </button>
      <div className="zoombar">
        <button onClick={() => zoom(1.25)} aria-label="Приблизить">
          +
        </button>
        <button onClick={() => zoom(0.8)} aria-label="Отдалить">
          −
        </button>
        <button onClick={fit} aria-label="Вся плата" title="Вся плата (0)">
          <Icon name="fit" size={16} />
        </button>
      </div>
      {cursor && tool !== 'select' && tool !== 'pan' && (
        <div className="ghost" style={{ left: 10, bottom: 10 }}>
          {fmt(fromMm(cursor.x, units), units === 'mm' ? 2 : units === 'mil' ? 0 : 3)}, {fmt(fromMm(cursor.y, units), units === 'mm' ? 2 : units === 'mil' ? 0 : 3)} {UNIT_LABEL[units]}
        </div>
      )}
    </div>
  );
}
