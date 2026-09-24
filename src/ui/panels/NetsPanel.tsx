import { useMemo, useState } from 'react';
import { stableProject, useEditor } from '@editor/store';
import { computeConnectivity } from '@core/model/connectivity';
import { ensureNet, removeNet } from '@core/model/edit';
import { getWorld, padLabel } from '@core/model/world';
import { askConfirm } from '../dialogs/AskDialog';

export function NetsPanel() {
  const s = useEditor();
  const p = stableProject(s);
  const conn = computeConnectivity(p);
  const [q, setQ] = useState('');
  const [newName, setNewName] = useState('');
  const nets = useMemo(() => {
    const w = getWorld(p);
    const members = new Map<string, string[]>();
    for (const wp of w.pads) if (wp.net) (members.get(wp.net) ?? members.set(wp.net, []).get(wp.net)!).push(padLabel(wp));
    return Object.values(p.nets)
      .map((n) => ({ n, st: conn.nets.get(n.id), members: members.get(n.id) ?? [] }))
      .filter((x) => !q || (x.n.name + ' ' + (x.n.description ?? '') + ' ' + x.members.join(' ')).toLowerCase().includes(q.toLowerCase()))
      .sort((a, b) => a.n.name.localeCompare(b.n.name, 'ru', { numeric: true }));
  }, [p, conn, q]);

  const add = () => {
    const name = newName.trim();
    if (!name) return;
    if (Object.values(p.nets).some((n) => n.name === name)) {
      s.setMessage('Такая цепь уже есть.');
      return;
    }
    s.commit((d) => {
      ensureNet(d, name);
    });
    setNewName('');
  };

  return (
    <div>
      <h3>Цепи</h3>
      <div className="row">
        <input className="inp" placeholder="Поиск по цепям и выводам" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1 }} />
      </div>
      <div className="row">
        <input
          className="inp"
          placeholder="Новая цепь, например SDA"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add();
            e.stopPropagation();
          }}
          style={{ flex: 1 }}
        />
        <button className="btn" onClick={add} disabled={!newName.trim()}>
          Добавить
        </button>
      </div>
      <p className="hint">Выводы назначаются цепям в свойствах компонента (двойной щелчок по нему). Щелчок по цепи подсвечивает её на плате.</p>
      <div className="list">
        {nets.map(({ n, st, members }) => {
          const cls = p.netClasses[n.netClass];
          const done = !st || st.complete;
          return (
            <button key={n.id} className={`item${s.highlightNet === n.id ? ' on' : ''}`} onClick={() => s.patch({ highlightNet: s.highlightNet === n.id ? null : n.id })} onDoubleClick={() => s.openDialog('net', n.id)}>
              <span className="grow">
                <span className="nm">{n.name}</span> {n.description && <span className="ds">{n.description}</span>}
                <div className="ds">{members.length ? members.join(', ') : 'нет выводов'}</div>
              </span>
              {cls && n.netClass !== 'Default' && <span className="tag cls">{cls.name}</span>}
              <span className={`tag ${done ? 'ok' : 'warn'}`}>{members.length < 2 ? `${members.length} выв.` : done ? 'готово' : `осталось ${st!.islands.length - 1}`}</span>
            </button>
          );
        })}
        {!nets.length && <p className="hint">Цепей пока нет.</p>}
      </div>
      {s.highlightNet && p.nets[s.highlightNet] && (
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn sm" onClick={() => s.openDialog('net', s.highlightNet)}>
            Свойства цепи
          </button>
          <button
            className="btn sm danger"
            onClick={() => {
              const id = s.highlightNet!;
              askConfirm({
                title: 'Удалить цепь',
                message: `Удалить цепь ${p.nets[id].name}? Выводы останутся без цепи.`,
                okLabel: 'Удалить',
                danger: true,
                onOk: () => {
                  s.commit((d) => removeNet(d, id));
                  s.patch({ highlightNet: null });
                },
              });
            }}
          >
            Удалить цепь
          </button>
        </div>
      )}
    </div>
  );
}
