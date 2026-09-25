import { useEditor } from '@editor/store';
import { getWorld, padLabel } from '@core/model/world';
import { runDrc } from '@core/model/drc';
import { computeConnectivity } from '@core/model/connectivity';

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
    pads: () => getWorld(useEditor.getState().project).pads.map((p) => ({ label: padLabel(p), key: p.key, x: p.center.x, y: p.center.y, net: p.net })),
  };
}
