import { useEditor } from '@editor/store';
import { getWorld, padLabel } from '@core/model/world';
import { runDrc } from '@core/model/drc';
import { computeConnectivity } from '@core/model/connectivity';
import { placedPins } from '@core/schematic/netlist';
import { fitView, renderScene } from '@render/canvas-renderer';
import { GFX, type QualityLevel } from '@render/quality';

/** Доступ к состоянию для сквозных проверок (tools/qa.mjs). Включается только с ?qa=1 в адресе. */
export function installQaHooks(): void {
  if (!/[?&]qa=1\b/.test(location.search)) return;
  const pick = () => {
    const s = useEditor.getState();
    return { tool: s.tool, selection: s.selection, activeLayer: s.activeLayer, grid: s.grid, show: s.show, layerVisible: s.layerVisible, pending: s.pending, panelOpen: s.panelOpen, panelTab: s.panelTab, dialog: s.dialog, message: s.message };
  };
  (window as unknown as { __plata: unknown }).__plata = {
    state: pick,
    project: () => JSON.parse(JSON.stringify(useEditor.getState().project)),
    view: () => ({ ...useEditor.getState().view }),
    ghost: () => useEditor.getState().ghost,
    drc: () => runDrc(useEditor.getState().project).markers.map((m) => `${m.severity}: ${m.message}`),
    schPins: () => placedPins(useEditor.getState().project).map((x) => ({ ref: x.ref, number: x.number, x: x.at.x, y: x.at.y })),
    schView: () => ({ ...useEditor.getState().schView }),
    fills: () => computeConnectivity(useEditor.getState().project).zoneFills.map((f) => ({ id: f.zone.id, net: f.zone.net, loops: f.loops.length, islands: f.islands.length, removed: f.removed })),
    netComplete: (name: string) => {
      const p = useEditor.getState().project;
      const n = Object.values(p.nets).find((x) => x.name === name);
      return n ? (computeConnectivity(p).nets.get(n.id)?.complete ?? null) : null;
    },
    outlines: () => {
      const w = getWorld(useEditor.getState().project);
      return Object.fromEntries(w.components.map((c) => [c.component.ref, { minX: Math.min(...c.outline.map((q) => q.x)), maxX: Math.max(...c.outline.map((q) => q.x)), minY: Math.min(...c.outline.map((q) => q.y)), maxY: Math.max(...c.outline.map((q) => q.y)) }]));
    },
    /** Средняя длительность кадра (мс) при заданном качестве: холст 1400×900, вся плата и приближение. */
    bench: (level: QualityLevel | Partial<typeof GFX.high>, frames = 20, dpr = 2) => {
      const s = useEditor.getState();
      const cv = document.createElement('canvas');
      cv.width = 1400 * dpr;
      cv.height = 900 * dpr;
      const ctx = cv.getContext('2d', { alpha: false })!;
      const fit = fitView(s.project, 1400, 900);
      const views = [fit, { ...fit, scale: fit.scale * 4 }];
      const t0 = performance.now();
      for (let i = 0; i < frames; i++) {
        const view = views[i % 2];
        renderScene(ctx, { project: s.project, view: { ...view, x: view.x + i * 0.01 }, width: 1400, height: 900, dpr, activeLayer: s.activeLayer, layerVisible: s.layerVisible, show: s.show, grid: s.grid, selection: s.selection, hover: null, highlightNet: null, pending: null, measure: null, gfx: typeof level === 'string' ? GFX[level] : { ...GFX.eco, ...level }, time: i * 16 });
      }
      ctx.getImageData(0, 0, 1, 1);
      return (performance.now() - t0) / frames;
    },
    pads: () => getWorld(useEditor.getState().project).pads.map((p) => ({ label: padLabel(p), key: p.key, x: p.center.x, y: p.center.y, net: p.net })),
  };
}
