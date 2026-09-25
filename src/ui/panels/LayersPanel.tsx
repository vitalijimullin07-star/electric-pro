import { useEditor } from '@editor/store';
import { LAYERS, LAYER_ORDER, boardCopperLayers } from '@core/model/layers';
import type { LayerId } from '@core/model/types';

export function LayersPanel() {
  const s = useEditor();
  const copper = boardCopperLayers(s.project.board.copperLayers);
  const layers: LayerId[] = LAYER_ORDER.filter((l) => {
    if (l === 'F.Cu' || l === 'B.Cu') return copper.includes(l);
    if (l.endsWith('Paste') || l.endsWith('Mask')) return false;
    return true;
  });
  return (
    <div>
      <h3>Слои</h3>
      <p className="hint">Точка — активный медный слой (на нём рисуются дорожки). Глаз — видимость.</p>
      {layers.map((l) => {
        const info = LAYERS[l];
        const isCu = l === 'F.Cu' || l === 'B.Cu';
        return (
          <div className="layer-row" key={l}>
            {isCu ? (
              <input type="radio" name="active" checked={s.activeLayer === l} onChange={() => s.patch({ activeLayer: l })} aria-label={`Активный: ${info.name}`} />
            ) : (
              <span style={{ width: 13 }} />
            )}
            <span className="swatch" style={{ background: info.color }} />
            <span className="nm">{info.name}</span>
            <button className={`eye${s.layerVisible[l] ? ' on' : ''}`} onClick={() => s.toggleLayer(l)} aria-label={s.layerVisible[l] ? 'Скрыть' : 'Показать'} title="Видимость">
              {s.layerVisible[l] ? '👁' : '◌'}
            </button>
          </div>
        );
      })}
      <button className="btn" style={{ marginTop: 6 }} onClick={() => s.openDialog('layers')}>
        Перенести или поменять слои…
      </button>
      <h4>Показывать</h4>
      {(
        [
          ['grid', 'Сетка'],
          ['ratsnest', 'Воздушные линии'],
          ['drc', 'Отметки проверки'],
          ['refs', 'Обозначения (R1, U2…)'],
          ['values', 'Номиналы'],
          ['courtyard', 'Габариты корпусов'],
          ['fab', 'Сборочный слой и подписи выводов'],
          ['pads', 'Площадки'],
        ] as [keyof typeof s.show, string][]
      ).map(([k, label]) => (
        <label key={k} className="layer-row" style={{ cursor: 'pointer' }}>
          <input type="checkbox" checked={s.show[k]} onChange={() => s.patch({ show: { ...s.show, [k]: !s.show[k] } })} />
          <span className="nm">{label}</span>
        </label>
      ))}
      <h4>Слой для рисования</h4>
      <div className="field">
        <label>Графика</label>
        <select className="sel" value={s.drawLayer} onChange={(e) => s.patch({ drawLayer: e.target.value as LayerId })}>
          {(['F.Silk', 'B.Silk', 'F.Fab', 'B.Fab', 'Edge.Cuts'] as LayerId[]).map((l) => (
            <option key={l} value={l}>
              {LAYERS[l].name}
            </option>
          ))}
        </select>
        <label>Толщина линии</label>
        <select className="sel" value={String(s.drawWidth)} onChange={(e) => s.patch({ drawWidth: +e.target.value })}>
          {[0.1, 0.12, 0.15, 0.2, 0.25, 0.3, 0.5].map((w) => (
            <option key={w} value={String(w)}>
              {String(w).replace('.', ',')} мм
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
