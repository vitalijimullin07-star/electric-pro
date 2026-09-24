import { useEditor } from '@editor/store';
import { getWorld, padLabel } from '@core/model/world';
import { runDrc } from '@core/model/drc';

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
    pads: () => getWorld(useEditor.getState().project).pads.map((p) => ({ label: padLabel(p), key: p.key, x: p.center.x, y: p.center.y, net: p.net })),
  };
}
