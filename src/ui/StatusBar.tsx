import { useEditor } from '@editor/store';
import { LAYERS, boardCopperLayers } from '@core/model/layers';
import { UNIT_LABEL, type DisplayUnit } from '@core/units';

export function StatusBar() {
  const message = useEditor((s) => s.message);
  const activeLayer = useEditor((s) => s.activeLayer);
  const project = useEditor((s) => s.project);
  const view = useEditor((s) => s.view);
  const units = useEditor((s) => s.units);
  const snap = useEditor((s) => s.snap);
  const routeWidth = useEditor((s) => s.routeWidth);
  const copper = boardCopperLayers(project.board.copperLayers);
  return (
    <footer className="statusbar">
      <span className="msg" title={message}>
        {message}
      </span>
      <span>
        Слой{' '}
        <select value={activeLayer} onChange={(e) => useEditor.setState({ activeLayer: e.target.value as 'F.Cu' | 'B.Cu' })} aria-label="Активный слой">
          {copper.map((l) => (
            <option key={l} value={l}>
              {LAYERS[l].name}
            </option>
          ))}
        </select>
      </span>
      <span>
        Ширина{' '}
        <select value={String(routeWidth)} onChange={(e) => useEditor.setState({ routeWidth: e.target.value === 'auto' ? 'auto' : +e.target.value })} aria-label="Ширина дорожки">
          <option value="auto">по классу</option>
          {[0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.8, 1.0, 1.2, 1.5, 2.0, 2.5, 3.0].map((w) => (
            <option key={w} value={String(w)}>
              {String(w).replace('.', ',')} мм
            </option>
          ))}
        </select>
      </span>
      <label>
        <input type="checkbox" checked={snap} onChange={(e) => useEditor.setState({ snap: e.target.checked })} /> привязка
      </label>
      <span>
        <select value={units} onChange={(e) => useEditor.setState({ units: e.target.value as DisplayUnit })} aria-label="Единицы">
          {(['mm', 'mil', 'in'] as DisplayUnit[]).map((u) => (
            <option key={u} value={u}>
              {UNIT_LABEL[u]}
            </option>
          ))}
        </select>
      </span>
      <span className="zoom">
        Масштаб <b>{(view.scale * 25.4).toFixed(0)}</b> px/дюйм
      </span>
    </footer>
  );
}
