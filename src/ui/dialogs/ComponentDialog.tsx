import { useMemo, useState } from 'react';
import { useEditor } from '@editor/store';
import { Dialog } from './Dialog';
import { TextInput } from '../common/NumberInput';
import { FootprintPreview } from '../common/FootprintPreview';
import { compatibleFootprints, libraryFootprints, searchFootprints } from '@core/library';
import { changeFootprint, renameComponent } from '@editor/commands';
import { ensureNet, connectPad } from '@core/model/edit';

/* Свойства компонента: обозначение, номинал, корпус (замена), выводы → цепи. */

export function ComponentDialog({ id }: { id: string }) {
  const s = useEditor();
  const p = s.project;
  const c = p.components[id];
  const fp = c ? p.footprints[c.footprint] : undefined;
  const [fpQuery, setFpQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
  const nets = useMemo(() => Object.values(p.nets).sort((a, b) => a.name.localeCompare(b.name, 'ru', { numeric: true })), [p.nets]);
  if (!c || !fp) return null;

  const upd = (fn: (x: typeof c) => void) =>
    s.commit((d) => {
      const x = d.components[id];
      if (x) fn(x);
    });

  const alt = compatibleFootprints(fp);
  const sameFp = Object.values(p.components).filter((x) => x.footprint === fp.id).length;
  const candidates = showAll ? searchFootprints(fpQuery, libraryFootprints()).slice(0, 40) : alt;

  const setPadNet = (pad: string, name: string) => {
    s.commit((d) => {
      const nm = name.trim();
      if (!nm) {
        connectPad(d, id, pad, null);
        return;
      }
      const net = ensureNet(d, nm);
      connectPad(d, id, pad, net.id);
    });
  };

  return (
    <Dialog title={`${c.ref} — ${c.description ?? fp.description ?? fp.name}`} size="wide">
      <div className="two-col">
        <div>
          <FootprintPreview fp={fp} />
          <div className="field" style={{ marginTop: 8 }}>
            <label>Обозначение</label>
            <TextInput value={c.ref} onChange={(v) => renameComponent(id, v)} />
            <label>Номинал</label>
            <TextInput value={c.value} onChange={(v) => upd((x) => void (x.value = v))} />
            <label>Описание</label>
            <TextInput value={c.description ?? ''} onChange={(v) => upd((x) => void (x.description = v || undefined))} />
            <label>Корпус</label>
            <span>
              {fp.name} <span className="hint">{fp.id}</span>
            </span>
          </div>
          <div className="row">
            <button className="btn" onClick={() => s.openDialog('footprint', { base: fp, componentId: id })}>
              Изменить корпус в редакторе…
            </button>
          </div>
          <h4>Заменить корпус</h4>
          {!showAll && <p className="hint">{alt.length ? 'Корпуса с теми же выводами:' : 'Совместимых корпусов в библиотеке нет.'}</p>}
          {showAll && <input className="inp" placeholder="Поиск по всей библиотеке" value={fpQuery} onChange={(e) => setFpQuery(e.target.value)} />}
          <div className="list" style={{ maxHeight: 220, overflow: 'auto' }}>
            {candidates.map((f) => (
              <button
                key={f.id}
                className="item"
                onClick={() => {
                  if (!changeFootprint(id, f)) s.setMessage('У этого корпуса другие номера выводов: сначала снимите цепи с несовпадающих выводов.');
                }}
              >
                <span className="grow">
                  <span className="nm">{f.name}</span>
                  <div className="ds">{f.description}</div>
                </span>
                <span className="tag">{f.pads.filter((x) => x.type !== 'npth').length}</span>
              </button>
            ))}
          </div>
          <div className="row">
            <label>
              <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> искать по всей библиотеке
            </label>
            {sameFp > 1 && (
              <button className="btn" onClick={() => s.openDialog('replace', { footprint: fp.id })}>
                Заменить у всех {sameFp} с этим корпусом…
              </button>
            )}
          </div>
        </div>
        <div>
          <h4 style={{ marginTop: 0 }}>Выводы и цепи</h4>
          <p className="hint">Введите имя цепи для каждого вывода. Новое имя создаст цепь. Пустое поле — вывод не подключается.</p>
          <datalist id="nets-list">
            {nets.map((n) => (
              <option key={n.id} value={n.name} />
            ))}
          </datalist>
          <table className="grid">
            <thead>
              <tr>
                <th>№</th>
                <th>Имя</th>
                <th>Цепь</th>
              </tr>
            </thead>
            <tbody>
              {fp.pads
                .filter((pd) => pd.type !== 'npth')
                .map((pd) => {
                  const netId = c.padNets[pd.number];
                  return (
                    <tr key={pd.number}>
                      <td>{pd.number}</td>
                      <td className="hint">{pd.name && pd.name !== pd.number ? pd.name : ''}</td>
                      <td>
                        <TextInput className="inp" list="nets-list" value={netId ? p.nets[netId]?.name ?? '' : ''} onChange={(v) => setPadNet(pd.number, v)} placeholder="—" />
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>
    </Dialog>
  );
}


