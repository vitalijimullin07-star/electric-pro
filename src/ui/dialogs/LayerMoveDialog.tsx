import { useState } from 'react';
import { useEditor } from '@editor/store';
import { layerMoveMessage } from '@editor/commands';
import { applyLayerMove, itemsOnLayer, planLayerContent, planLayerMove } from '@core/model/layer-move';
import { LAYERS, LAYER_ORDER, boardCopperLayers } from '@core/model/layers';
import type { LayerId } from '@core/model/types';
import { Dialog } from './Dialog';

/** Перенос выделенного или всего содержимого слоя на другой слой, обмен двух слоёв. */
export function LayerMoveDialog() {
  const s = useEditor();
  const p = s.project;
  const copper = boardCopperLayers(p.board.copperLayers);
  const layers = LAYER_ORDER.filter((l) => (l === 'F.Cu' || l === 'B.Cu' ? copper.includes(l) : !l.endsWith('Mask') && !l.endsWith('Paste')));
  const selRefs = s.selection.filter((r) => r.kind === 'track' || r.kind === 'zone' || r.kind === 'drawing');
  const [scope, setScope] = useState<'selection' | 'layer'>(selRefs.length ? 'selection' : 'layer');
  const [from, setFrom] = useState<LayerId>(copper.includes('F.Cu') ? 'F.Cu' : 'F.Silk');
  const [to, setTo] = useState<LayerId>(copper.includes('B.Cu') && copper.length === 2 ? 'B.Cu' : 'B.Silk');
  const [swap, setSwap] = useState(true);

  const plan = scope === 'selection' ? planLayerMove(p, selRefs, to) : from === to ? null : planLayerContent(p, from, to, swap);
  const count = (l: LayerId) => itemsOnLayer(p, l).length;
  const apply = () => {
    if (!plan || !plan.moves.length) return;
    s.commit((d) => applyLayerMove(d, plan));
    s.closeDialog();
    s.setMessage(layerMoveMessage(plan, scope === 'selection' || !swap ? LAYERS[to].name : undefined));
  };
  const opt = (l: LayerId) => (
    <option key={l} value={l}>
      {LAYERS[l].name} ({count(l)})
    </option>
  );

  return (
    <Dialog
      title="Перенос между слоями"
      footer={
        <>
          <button className="btn" onClick={s.closeDialog}>
            Отмена
          </button>
          <button className="btn primary" disabled={!plan?.moves.length} onClick={apply}>
            Перенести
          </button>
        </>
      }
    >
      <div className="row">
        <label>
          <input type="radio" name="lm-scope" checked={scope === 'selection'} disabled={!selRefs.length} onChange={() => setScope('selection')} /> выделенное ({selRefs.length})
        </label>
        <label>
          <input type="radio" name="lm-scope" checked={scope === 'layer'} onChange={() => setScope('layer')} /> всё со слоя
        </label>
      </div>
      <div className="field">
        {scope === 'layer' && (
          <>
            <label>Со слоя</label>
            <select className="sel" value={from} onChange={(e) => setFrom(e.target.value as LayerId)}>
              {layers.map(opt)}
            </select>
          </>
        )}
        <label>На слой</label>
        <select className="sel" value={to} onChange={(e) => setTo(e.target.value as LayerId)}>
          {layers.map(opt)}
        </select>
      </div>
      {scope === 'layer' && (
        <label className="row">
          <input type="checkbox" checked={swap} onChange={(e) => setSwap(e.target.checked)} /> поменять слои местами (с «{LAYERS[to].name}» — на «{LAYERS[from].name}»)
        </label>
      )}
      <p className="hint">
        Медь переносится только на медь платы, графика — на любой слой графики. Где перенесённая дорожка стыковалась с дорожкой прежнего слоя, поставится переходное. Компоненты переворачивает клавиша F.
      </p>
      {plan && (
        <p className="hint lm-preview">
          Перенесётся объектов: {plan.moves.length}
          {plan.vias.length ? `, переходных: ${plan.vias.length}` : ''}
          {plan.broken.length ? `, порвётся соединений на планарных площадках: ${plan.broken.length}` : ''}
          {plan.skipped ? `, нельзя перенести: ${plan.skipped}` : ''}.
        </p>
      )}
    </Dialog>
  );
}
