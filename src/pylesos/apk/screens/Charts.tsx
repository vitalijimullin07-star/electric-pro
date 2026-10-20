/* Графики: любые величины за минуту … всё записанное, отметки серий ударов, выгрузка CSV. */
import { useMemo, useState } from 'react';
import type { Ctx } from '../ctx';
import { SERIES, clock, fmt, type Sample } from '../history';
import { native } from '../native';
import { Icon, Seg } from '../ui';

const WINDOWS: [number, string][] = [
  [60, '1 мин'],
  [600, '10 мин'],
  [3600, '1 ч'],
  [6 * 3600, '6 ч'],
];
const KEY = 'pylesos-apk-series';

/** Открыть графики с этой величиной (с экрана «Датчики»): она первой в списке выбранных. */
export function pickSeries(key: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([key, ...loadPicked().filter((k) => k !== key)].slice(0, 3)));
  } catch {
    /* не запомнили */
  }
}

function loadPicked(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '') as string[];
    if (Array.isArray(v) && v.length) return v;
  } catch {
    /* по умолчанию */
  }
  return ['vacuum', 'flow', 'r'];
}

export function Charts(c: Ctx) {
  const [win, setWin] = useState(600);
  const [picked, setPicked] = useState<string[]>(loadPicked);
  const [more, setMore] = useState(false);
  const data = useMemo(() => c.ring.since(win), [c.ring, win, c.tick]);
  const toggle = (k: string) => {
    const next = picked.includes(k) ? picked.filter((x) => x !== k) : [...picked, k];
    setPicked(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* не запомнили */
    }
  };
  const shown = SERIES.filter((s) => picked.includes(s.key));
  const last = data[data.length - 1];
  const exportCsv = () => {
    const day = new Date().toISOString().slice(0, 10);
    if (native && c.mode === 'device') native.shareRec(day);
    else if (native) native.shareText(`pylesos-demo-${day}.csv`, c.ring.toCsv());
    else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([c.ring.toCsv()], { type: 'text/csv' }));
      a.download = `pylesos-${day}.csv`;
      a.click();
    }
  };
  return (
    <div className="screen">
      <header className="bar">
        <h1>Графики</h1>
        <button type="button" className="pill" onClick={() => c.open('strikes')}>
          Удары {Icon.next}
        </button>
      </header>
      <Seg items={WINDOWS} value={win} onPick={setWin} small />
      <section className="card chart">
        <Chart data={data} series={shown} marks={c.series.map((x) => x.t)} />
        <div className="axis">
          <span>{data.length ? clock(data[0].t) : '—'}</span>
          <span>{data.length ? clock(data[Math.floor(data.length / 2)].t) : ''}</span>
          <span>{last ? clock(last.t) : ''}</span>
        </div>
      </section>
      <section className="stack tight">
        {SERIES.filter((s) => more || picked.includes(s.key) || SERIES.indexOf(s) < 3).map((s) => (
          <label key={s.key} className="legend">
            <input type="checkbox" checked={picked.includes(s.key)} onChange={() => toggle(s.key)} />
            <span className="swatch" style={{ background: s.color }} />
            <span className="grow">
              {s.label}
              {s.unit ? `, ${s.unit}` : ''}
            </span>
            <span className="mono">{last ? fmt(s.get(last.v), s.dec) : '—'}</span>
          </label>
        ))}
        {!more && (
          <button type="button" className="btn dashed" onClick={() => setMore(true)}>
            + ещё величины: мощность, ток, температуры, сеть…
          </button>
        )}
      </section>
      <section className="row muted small">
        <span>В телефоне: {fmt(c.ring.size / 60)} мин записи</span>
        <button type="button" className="pill" onClick={exportCsv}>
          {Icon.download} CSV
        </button>
      </section>
    </div>
  );
}

/** Каждая величина — в своём масштабе (мин…макс окна), подписи — в легенде. */
function Chart({ data, series, marks }: { data: Sample[]; series: typeof SERIES; marks: number[] }) {
  const W = 340;
  const H = 210;
  if (data.length < 2)
    return (
      <div className="empty" style={{ height: H }}>
        Данные появятся через пару секунд
      </div>
    );
  const t0 = data[0].t;
  const t1 = data[data.length - 1].t;
  const x = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * W;
  const step = Math.max(1, Math.floor(data.length / 400));
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="График выбранных величин">
      {[0.1, 0.35, 0.6, 0.85].map((f) => (
        <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} stroke="#24313B" />
      ))}
      {marks
        .filter((t) => t >= t0 && t <= t1)
        .map((t) => (
          <line key={t} x1={x(t)} x2={x(t)} y1="6" y2={H - 4} stroke="#F2A93B" strokeDasharray="3 4" />
        ))}
      {series.map((s) => {
        let lo = Infinity;
        let hi = -Infinity;
        for (const d of data) {
          const v = s.get(d.v);
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
        if (hi - lo < 1e-6) {
          hi += 1;
          lo -= 1;
        }
        const y = (v: number) => H - 12 - ((v - lo) / (hi - lo)) * (H - 28);
        const pts: string[] = [];
        for (let i = 0; i < data.length; i += step) pts.push(`${x(data[i].t).toFixed(1)},${y(s.get(data[i].v)).toFixed(1)}`);
        return <polyline key={s.key} fill="none" stroke={s.color} strokeWidth="2" points={pts.join(' ')} />;
      })}
    </svg>
  );
}
