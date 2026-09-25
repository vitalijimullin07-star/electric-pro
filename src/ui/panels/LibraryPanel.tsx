import { useMemo, useState } from 'react';
import { useEditor } from '@editor/store';
import { categories, groupsOf, libraryFootprints, searchFootprints, PROJECT_CATEGORY } from '@core/library';
import { FootprintPreview } from '../common/FootprintPreview';
import type { FootprintDef } from '@core/model/types';
import { findFootprint, removeUserFootprint } from '@editor/userlib';
import { setSchTool } from '@editor/sch';
import { askConfirm } from '../dialogs/AskDialog';
import { exportUserLibrary, importFootprintFiles } from '../library-io';

/* Библиотека: раздел → подраздел → корпуса, поиск по всему, предпросмотр и кнопка «Поставить». */

const SHOW_LIMIT = 250;

export function LibraryPanel() {
  const s = useEditor();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string>('');
  const [grp, setGrp] = useState<string>('');
  const all = libraryFootprints();
  const user = s.userFootprints;
  const projectFps = useMemo(
    () => Object.values(s.project.footprints).filter((f) => (f.category === PROJECT_CATEGORY || !all.some((a) => a.id === f.id)) && !user.some((u) => u.id === f.id)),
    [s.project.footprints, all, user],
  );
  const everything = useMemo(() => [...all, ...user, ...projectFps], [all, user, projectFps]);
  const cats = useMemo(() => categories(everything), [everything]);
  const groups = useMemo(() => (cat ? groupsOf(cat, everything) : []), [cat, everything]);

  const list = useMemo(() => {
    let base = everything;
    if (cat) base = base.filter((f) => f.category === cat);
    if (cat && grp) base = base.filter((f) => (f.group ?? '') === grp);
    return searchFootprints(q, base);
  }, [q, cat, grp, everything]);

  const chosen: FootprintDef | undefined = s.placeFootprint ? findFootprint(s.placeFootprint, s.project) : undefined;
  const mine = !!chosen && user.some((u) => u.id === chosen.id);
  const sch = s.mode === 'sch';
  const pick = (f: FootprintDef) => {
    if (sch) setSchTool('place');
    else if (s.tool !== 'place') s.setTool('place');
    s.patch({ placeFootprint: f.id });
  };

  return (
    <div>
      <h3>
        Библиотека корпусов <span className="hint">{all.length}</span>
      </h3>
      <div className="row">
        <button className="btn" onClick={() => s.openDialog('footprint', {})} title="Свой корпус: площадки рядами, контур строится сам">
          Новый корпус…
        </button>
        <button className="btn" onClick={() => void importFootprintFiles()} title="Корпуса KiCad (.kicad_mod) или файл «Мои корпуса» (.json)">
          Импорт…
        </button>
        {user.length > 0 && (
          <button className="btn" onClick={() => void exportUserLibrary()} title="Сохранить «Мои корпуса» файлом, чтобы перенести на другое устройство">
            Мои → файл
          </button>
        )}
      </div>
      <div className="row">
        <input className="inp" placeholder="Поиск: 0805, dip 16, esp32, кнопка 6x6, кварц…" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1 }} />
      </div>
      <div className="row">
        <select
          className="sel"
          value={cat}
          onChange={(e) => {
            setCat(e.target.value);
            setGrp('');
          }}
          style={{ flex: 1 }}
        >
          <option value="">Все разделы</option>
          {cats.map((c) => (
            <option key={c} value={c}>
              {c} ({everything.filter((f) => f.category === c).length})
            </option>
          ))}
        </select>
      </div>
      {cat && groups.length > 1 && (
        <div className="row">
          <select className="sel" value={grp} onChange={(e) => setGrp(e.target.value)} style={{ flex: 1 }}>
            <option value="">Все подразделы</option>
            {groups.map((g) => (
              <option key={g} value={g}>
                {g || 'Прочие'} ({everything.filter((f) => f.category === cat && (f.group ?? '') === g).length})
              </option>
            ))}
          </select>
        </div>
      )}
      {chosen && (
        <div style={{ margin: '8px 0 10px' }}>
          <div className="row" style={{ marginTop: 0 }}>
            <button
              className="btn primary"
              onClick={() => {
                if (sch) setSchTool('place');
                else s.setTool('place');
                s.patch({ placeFootprint: chosen.id, panelOpen: window.innerWidth >= 900 });
                s.setMessage(`Щёлкните по ${sch ? 'схеме' : 'плате'}, чтобы поставить ${chosen.name}. R — поворот, Esc — закончить.`);
              }}
            >
              {sch ? 'Поставить на схему' : 'Поставить на плату'}
            </button>
            <b>{chosen.name}</b>
          </div>
          <FootprintPreview fp={chosen} />
          <div className="row">
            {mine ? (
              <>
                <button className="btn" onClick={() => s.openDialog('footprint', { base: chosen })}>
                  Изменить…
                </button>
                <button
                  className="btn danger"
                  onClick={() =>
                    askConfirm({
                      title: 'Удалить из моих корпусов',
                      message: `Удалить «${chosen.name}» из «Моих корпусов»? На плате уже поставленные детали останутся.`,
                      okLabel: 'Удалить',
                      danger: true,
                      onOk: () => {
                        removeUserFootprint(chosen.id);
                        s.patch({ placeFootprint: null });
                      },
                    })
                  }
                >
                  Удалить из моих
                </button>
              </>
            ) : (
              <button className="btn" onClick={() => s.openDialog('footprint', { base: chosen })}>
                Свой на основе этого…
              </button>
            )}
          </div>
          <div className="hint">{chosen.description}</div>
          <div className="hint">
            {chosen.category}
            {chosen.group ? ` → ${chosen.group}` : ''} · {chosen.pads.filter((p) => p.type !== 'npth').length} выв. · {chosen.source ?? ''} ·{' '}
            {chosen.verified ? <span className="tag ok">размеры сверены</span> : <span className="tag warn">размеры типовые — проверить</span>}
          </div>
        </div>
      )}
      {!cat && !q && (
        <div className="list">
          {cats.map((c) => (
            <button key={c} className="item" onClick={() => setCat(c)}>
              <span className="grow">
                <span className="nm">{c}</span>
                <div className="ds">{groupsOf(c, everything).filter(Boolean).join(' · ')}</div>
              </span>
              <span className="tag">{everything.filter((f) => f.category === c).length}</span>
            </button>
          ))}
        </div>
      )}
      {(cat || q) && (
        <div className="list">
          {list.slice(0, SHOW_LIMIT).map((f) => (
            <button key={f.id} className={`item${s.placeFootprint === f.id ? ' on' : ''}`} onClick={() => pick(f)} title={f.id}>
              <span className="grow">
                <span className="nm">{f.name}</span>
                {!grp && f.group && <span className="tag" style={{ marginLeft: 6 }}>{f.group}</span>}
                <div className="ds">{f.description}</div>
              </span>
              <span className="tag">{f.pads.filter((p) => p.type !== 'npth').length}</span>
            </button>
          ))}
          {list.length > SHOW_LIMIT && <p className="hint">Показаны первые {SHOW_LIMIT} из {list.length}: уточните поиск или выберите подраздел.</p>}
          {!list.length && <p className="hint">Ничего не найдено.</p>}
        </div>
      )}
    </div>
  );
}
