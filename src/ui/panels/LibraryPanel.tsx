import { useMemo, useState } from 'react';
import { useEditor } from '@editor/store';
import { categories, libraryFootprints, searchFootprints } from '@core/library';
import { FootprintPreview } from '../common/FootprintPreview';
import type { FootprintDef } from '@core/model/types';

export function LibraryPanel() {
  const s = useEditor();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string>('');
  const all = libraryFootprints();
  const projectFps = Object.values(s.project.footprints).filter((f) => f.category === 'Проект' || !all.some((a) => a.id === f.id));
  const list = useMemo(() => {
    const base = cat === 'Проект' ? projectFps : cat ? all.filter((f) => f.category === cat) : [...all, ...projectFps];
    return searchFootprints(q, base).slice(0, 300);
  }, [q, cat, all, projectFps]);
  const cats = useMemo(() => [...categories(all), ...(projectFps.length ? ['Проект'] : [])], [all, projectFps.length]);
  const chosen: FootprintDef | undefined = s.placeFootprint ? all.find((f) => f.id === s.placeFootprint) ?? s.project.footprints[s.placeFootprint] : undefined;

  return (
    <div>
      <h3>Библиотека корпусов</h3>
      <div className="row">
        <input className="inp" placeholder="Поиск: 0805, dip 8, esp32, клеммник…" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1 }} />
      </div>
      <div className="row">
        <select className="sel" value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">Все разделы ({all.length})</option>
          {cats.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      {chosen && (
        <div style={{ margin: '8px 0 10px' }}>
          <FootprintPreview fp={chosen} />
          <div style={{ marginTop: 6 }}>
            <b>{chosen.name}</b> <span className="hint">{chosen.description}</span>
          </div>
          <div className="hint">
            {chosen.pads.filter((p) => p.type !== 'npth').length} выв. · {chosen.source ?? ''} · {chosen.verified ? <span className="tag ok">размеры сверены</span> : <span className="tag warn">размеры типовые — проверить</span>}
          </div>
          <div className="row">
            <button
              className="btn primary"
              onClick={() => {
                s.setTool('place');
                s.patch({ placeFootprint: chosen.id, panelOpen: window.innerWidth >= 900 });
                s.setMessage(`Щёлкните по плате, чтобы поставить ${chosen.name}. R — поворот, Esc — закончить.`);
              }}
            >
              Поставить на плату
            </button>
          </div>
        </div>
      )}
      <div className="list">
        {list.map((f) => (
          <button
            key={f.id}
            className={`item${s.placeFootprint === f.id ? ' on' : ''}`}
            onClick={() => {
              s.patch({ placeFootprint: f.id });
              if (s.tool !== 'place') s.setTool('place');
              s.patch({ placeFootprint: f.id });
            }}
            title={f.id}
          >
            <span className="grow">
              <span className="nm">{f.name}</span>
              <div className="ds">{f.description}</div>
            </span>
            <span className="tag">{f.pads.filter((p) => p.type !== 'npth').length}</span>
          </button>
        ))}
        {!list.length && <p className="hint">Ничего не найдено.</p>}
      </div>
    </div>
  );
}
