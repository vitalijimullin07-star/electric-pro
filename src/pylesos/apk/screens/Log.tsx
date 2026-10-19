/* Журнал: события пылесоса, неисправности, серии, настройки, связь — поиск, фильтры, выгрузка. */
import { useMemo, useState } from 'react';
import type { Ctx, LogKind } from '../ctx';
import { clock } from '../history';
import { native } from '../native';
import { Icon } from '../ui';

const FILTERS: [LogKind | 'all', string][] = [
  ['all', 'Все'],
  ['fault', 'Ошибки'],
  ['series', 'Удары'],
  ['set', 'Настройки'],
  ['link', 'Связь'],
];

const ICON: Record<LogKind, { i: React.ReactNode; c: string; label: string }> = {
  fault: { i: Icon.warn, c: '#F26B5B', label: 'Ошибка' },
  series: { i: Icon.bolt, c: '#F2A93B', label: 'Удар' },
  set: { i: Icon.set, c: '#5AA2F0', label: 'Настройка' },
  link: { i: Icon.link, c: '#9AA8B4', label: 'Связь' },
  log: { i: Icon.play, c: '#3CC8B4', label: 'Событие' },
};

export function Log(c: Ctx) {
  const [f, setF] = useState<LogKind | 'all'>('all');
  const [q, setQ] = useState('');
  const items = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return c.log.filter((x) => (f === 'all' || x.kind === f) && (!ql || x.text.toLowerCase().includes(ql))).slice(-300).reverse();
  }, [c.log, f, q]);
  const count = (k: LogKind) => c.log.filter((x) => x.kind === k).length;
  const exportCsv = () => {
    const csv = 'время,вид,текст\n' + c.log.map((x) => `${new Date(x.t * 1000).toISOString()},${x.kind},"${x.text.replace(/"/g, '""')}"`).join('\n') + '\n';
    const name = `pylesos-zhurnal-${new Date().toISOString().slice(0, 10)}.csv`;
    if (native) native.shareText(name, csv);
    else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      a.download = name;
      a.click();
    }
  };
  return (
    <div className="screen">
      <header className="bar">
        <h1 className="grow">Журнал</h1>
        <button type="button" className="pill" onClick={exportCsv}>
          Выгрузить
        </button>
      </header>
      <label className="search">
        {Icon.search}
        <span className="sr">Поиск по журналу</span>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск: клапан, перегрев, R…" />
      </label>
      <div className="chips">
        {FILTERS.map(([k, label]) => (
          <button key={k} type="button" className={`chip ${f === k ? 'on' : ''}`} onClick={() => setF(k)}>
            {label}
            {k === 'fault' && count('fault') ? ` · ${count('fault')}` : ''}
          </button>
        ))}
      </div>
      <section className="stack tight">
        {items.length === 0 && <div className="card empty small">Пока пусто.</div>}
        {items.map((x, i) => {
          const ic = ICON[x.kind];
          return (
            <div key={i} className={`event ${x.kind === 'fault' ? 'bad' : ''}`}>
              <span className="event-i" style={{ color: ic.c }} role="img" aria-label={ic.label}>
                {ic.i}
              </span>
              <span className="grow">{x.text}</span>
              <span className="mono small muted">{clock(x.t)}</span>
            </div>
          );
        })}
      </section>
      {c.log.length > 0 && (
        <button type="button" className="btn wide ghost" onClick={c.clearLog}>
          Очистить журнал в телефоне
        </button>
      )}
    </div>
  );
}
