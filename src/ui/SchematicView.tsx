import { useEffect, useRef, useState } from 'react';
import { useEditor } from '@editor/store';
import { SchController, deleteSchSelection, fitSchematic, mirrorSchSelection, rotateSchSelection, setSchTool, updateBoardFromSchematic } from '@editor/sch';
import { renderSchematic } from '@render/sch-renderer';
import { schematicNetlist, symbolDef } from '@core/schematic/netlist';
import { findFootprint } from '@editor/userlib';
import { Icon } from './icons';
import { SchSelectionBar } from './SelectionBar';
import { simRuntime } from '@editor/sim-runtime';

/* Лист схемы: отрисовка, мышь и касания, клавиатура. */

export function SchematicView() {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctrlRef = useRef<SchController | null>(null);
  const [ghostAt, setGhostAt] = useState<{ x: number; y: number } | null>(null);
  const project = useEditor((s) => s.project);
  const schTool = useEditor((s) => s.schTool);
  const panelOpen = useEditor((s) => s.panelOpen);
  const nl = schematicNetlist(project);
  const openPins = [...(project.schematic ? Object.values(project.schematic.symbols) : [])].length;

  // Отрисовка по кадрам.
  useEffect(() => {
    const canvas = canvasRef.current!;
    const stage = stageRef.current!;
    const ctx = canvas.getContext('2d')!;
    let raf = 0;
    const draw = () => {
      raf = 0;
      const s = useEditor.getState();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = stage.clientWidth;
      const h = stage.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      const fp = s.schTool === 'place' && s.placeFootprint ? findFootprint(s.placeFootprint) : undefined;
      const def = fp ? symbolDef(fp) : null;
      const at = ctrlRef.current?.pointerWorld;
      renderSchematic(ctx, {
        project: s.project,
        view: s.schView,
        width: w,
        height: h,
        dpr,
        selection: s.schSelection,
        pending: s.schPending,
        sim: simRuntime.view,
        ghost: def && at ? { def, at: { x: Math.round(at.x / 2.54) * 2.54, y: Math.round(at.y / 2.54) * 2.54 }, rotation: s.schPlaceRotation } : null,
      });
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(draw);
    };
    const unsub = useEditor.subscribe(schedule);
    const unsubSim = simRuntime.subscribe(schedule);
    const ro = new ResizeObserver(schedule);
    ro.observe(stage);
    schedule();
    return () => {
      unsub();
      unsubSim();
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  // Мышь и касания.
  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctrl = new SchController(canvas);
    ctrlRef.current = ctrl;
    let space = false;
    const down = (e: PointerEvent) => {
      (document.activeElement as HTMLElement | null)?.blur?.();
      ctrl.onPointerDown(e, space);
    };
    const move = (e: PointerEvent) => {
      ctrl.onPointerMove(e);
      if (useEditor.getState().schTool === 'place') setGhostAt(ctrl.pointerWorld ? { ...ctrl.pointerWorld } : null);
    };
    const up = (e: PointerEvent) => ctrl.onPointerUp(e);
    const cancel = (e: PointerEvent) => ctrl.onPointerCancel(e);
    const wheel = (e: WheelEvent) => ctrl.onWheel(e);
    const dbl = (e: MouseEvent) => ctrl.onDoubleClick(e);
    const ctx = (e: Event) => e.preventDefault();
    const leave = () => {
      ctrl.pointerWorld = null;
      setGhostAt(null);
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', cancel);
    canvas.addEventListener('wheel', wheel, { passive: false });
    canvas.addEventListener('dblclick', dbl);
    canvas.addEventListener('contextmenu', ctx);
    canvas.addEventListener('pointerleave', leave);
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      const s = useEditor.getState();
      if (s.dialog) {
        if (e.key === 'Escape') s.closeDialog();
        return;
      }
      if (e.key !== 'Shift') ctrl.resetTap();
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'z') {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
        return;
      }
      if (mod && k === 'y') {
        e.preventDefault();
        s.redo();
        return;
      }
      if (mod && k === 'a') {
        e.preventDefault();
        const sch = s.project.schematic;
        if (sch)
          s.patch({
            schSelection: [
              ...Object.keys(sch.symbols).map((id) => ({ kind: 'symbol' as const, id })),
              ...Object.keys(sch.wires).map((id) => ({ kind: 'wire' as const, id })),
              ...Object.keys(sch.labels).map((id) => ({ kind: 'label' as const, id })),
            ],
          });
        return;
      }
      if (mod && k === 's') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('plata:save'));
        return;
      }
      if (mod) return;
      if (e.key === ' ') {
        space = true;
        e.preventDefault();
        return;
      }
      if (e.key === 'Escape') return ctrl.cancel();
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (ctrl.undoPoint()) return;
        return deleteSchSelection();
      }
      if (e.key === 'Enter' && s.schPending?.kind === 'wire') return ctrl.finishWire();
      switch (k) {
        case 'r':
          return rotateSchSelection();
        case 'x':
          return mirrorSchSelection();
        case 'w':
          return setSchTool('wire');
        case 'n':
        case 'l':
          return setSchTool('label');
        case 's':
          return setSchTool('select');
        case 'h':
          return setSchTool('pan');
        case 'p':
          setSchTool('place');
          s.patch({ panelTab: 'library', panelOpen: true });
          return;
        case '0':
          return fitSchematic();
        case '=':
        case '+':
          return zoom(1.25);
        case '-':
          return zoom(0.8);
      }
    };
    const keyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') space = false;
    };
    window.addEventListener('keydown', key);
    window.addEventListener('keyup', keyUp);
    return () => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', cancel);
      canvas.removeEventListener('wheel', wheel);
      canvas.removeEventListener('dblclick', dbl);
      canvas.removeEventListener('contextmenu', ctx);
      canvas.removeEventListener('pointerleave', leave);
      window.removeEventListener('keydown', key);
      window.removeEventListener('keyup', keyUp);
    };
  }, []);

  // Призрак ставимого символа перерисовываем при движении.
  useEffect(() => {
    if (schTool === 'place') useEditor.setState({});
  }, [ghostAt, schTool]);

  const zoom = (k: number) => {
    const st = stageRef.current!;
    ctrlRef.current?.zoomAt({ x: st.clientWidth / 2, y: st.clientHeight / 2 }, k);
  };
  const unconnected = openPins ? nl.nets.length : 0;

  return (
    <div ref={stageRef} className={`stage sch tool-${schTool}`}>
      <canvas ref={canvasRef} />
      <SchSelectionBar />
      <div className="hud">
        <span className="chip">Схема: цепей {unconnected}</span>
        {nl.warnings.length > 0 && <span className="chip warn">{nl.warnings[0]}</span>}
        <button className="chip chip-btn" onClick={updateBoardFromSchematic} title="Цепи выводов на плате станут такими, как на схеме">
          Обновить плату по схеме
        </button>
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
        <button onClick={fitSchematic} aria-label="Вся схема" title="Вся схема (0)">
          <Icon name="fit" size={16} />
        </button>
      </div>
    </div>
  );
}
