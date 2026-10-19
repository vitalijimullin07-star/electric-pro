/* Удары: осциллограмма (перепад на фильтре и разрежение камеры), цифры, список ударов и серий. */
import { useState } from 'react';
import type { Ctx } from '../ctx';
import { clock, fmt, type Osc } from '../history';
import { Icon } from '../ui';

const KIND = ['', 'серия', 'мощная', 'серия', 'перед остановкой'];

export function Strikes(c: Ctx) {
  const [pick, setPick] = useState(0);
  const [cmp, setCmp] = useState(false);
  const o = c.oscs[pick];
  const prev = c.oscs[pick + 1];
  return (
    <div className="screen">
      <header className="bar">
        <button type="button" className="iconbtn" aria-label="Назад" onClick={() => c.open(null)}>
          {Icon.back}
        </button>
        <h1 className="grow">{o ? `Удар ${clock(o.t, true)}` : 'Удары'}</h1>
      </header>
      {o ? (
        <>
          <section className="card">
            <div className="row small muted">
              <span>Перепад на фильтре, Па</span>
              <span>
                0–{fmt(o.a.length * o.dt)} мс
              </span>
            </div>
            <OscView o={o} cmp={cmp ? prev : undefined} />
            <div className="legend-row small muted">
              <span>
                <i className="swatch" style={{ background: '#F2A93B' }} />
                перепад на фильтре
              </span>
              <span>
                <i className="swatch" style={{ background: '#5AA2F0' }} />
                разрежение камеры
              </span>
              {cmp && prev && (
                <span>
                  <i className="swatch" style={{ background: '#6C7884' }} />
                  прошлый
                </span>
              )}
            </div>
          </section>
          <section className="grid2">
            <div className="tile">
              <div className="tile-l">Обратный перепад</div>
              <div className="tile-v">{fmt(o.rev)} Па</div>
            </div>
            <div className="tile">
              <div className="tile-l">Импульс</div>
              <div className="tile-v">{fmt(o.imp)} мс</div>
            </div>
            <div className="tile">
              <div className="tile-l">Провал разрежения</div>
              <div className="tile-v">{fmt(o.depth)} %</div>
            </div>
            <div className="tile">
              <div className="tile-l">Клапаны · фронт</div>
              <div className="tile-v">
                {o.mask === 3 ? 'оба' : o.mask === 2 ? 'К2' : 'К1'} · {fmt(o.front)} мс
              </div>
            </div>
          </section>
          {prev && (
            <button type="button" className="btn wide" onClick={() => setCmp(!cmp)}>
              {cmp ? 'Без сравнения' : 'Сравнить с прошлым ударом'}
            </button>
          )}
        </>
      ) : (
        <section className="card empty">Осциллограмма появится после первого удара: кнопка «Удар» на главной.</section>
      )}

      {c.oscs.length > 1 && (
        <>
          <div className="group">Последние удары</div>
          <section className="stack tight">
            {c.oscs.slice(0, 12).map((x, i) => (
              <button key={x.k + ':' + x.t} type="button" className={`listbtn ${i === pick ? 'on' : ''}`} onClick={() => setPick(i)}>
                <span>
                  {clock(x.t, true)} · {fmt(x.imp)} мс
                </span>
                <span className="mono">{fmt(x.rev)} Па</span>
              </button>
            ))}
          </section>
        </>
      )}

      <div className="group">Серии ударов</div>
      {c.series.length ? (
        <section className="stack tight">
          {c.series.slice(0, 20).map((x) => (
            <div key={x.t} className="listbtn static">
              <span>
                {clock(x.t)} · {KIND[x.kind] ?? 'серия'} · {x.pulses} уд.
              </span>
              <span className={`mono ${x.rAfter < x.rBefore ? 'ok' : 'warn'}`}>
                R {fmt(x.rBefore, 2)}→{fmt(x.rAfter, 2)}
              </span>
            </div>
          ))}
        </section>
      ) : (
        <section className="card empty small">Серий пока не было.</section>
      )}
    </div>
  );
}

function OscView({ o, cmp }: { o: Osc; cmp?: Osc }) {
  const W = 340;
  const H = 180;
  const all = [...o.b, ...(cmp?.b ?? [])];
  const lo = Math.min(0, ...all);
  const hi = Math.max(10, ...all);
  const alo = Math.min(...o.a, ...(cmp?.a ?? []));
  const ahi = Math.max(...o.a, ...(cmp?.a ?? []), alo + 0.5);
  const n = Math.max(o.b.length, cmp?.b.length ?? 0, 2);
  const x = (i: number) => (i / (n - 1)) * W;
  const yb = (v: number) => H - 10 - ((v - lo) / (hi - lo)) * (H - 24);
  const ya = (v: number) => H - 10 - ((v - alo) / (ahi - alo)) * (H - 24);
  const line = (arr: number[], y: (v: number) => number) => arr.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Осциллограмма удара: обратный перепад до ${Math.round(o.rev)} паскалей`}>
      {[0.15, 0.45, 0.75].map((f) => (
        <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} stroke="#24313B" />
      ))}
      <line x1="0" x2={W} y1={yb(0)} y2={yb(0)} stroke="#3A4854" />
      {cmp && <polyline fill="none" stroke="#6C7884" strokeWidth="1.6" points={line(cmp.b, yb)} />}
      <polyline fill="none" stroke="#5AA2F0" strokeWidth="1.6" points={line(o.a, ya)} />
      <polyline fill="none" stroke="#F2A93B" strokeWidth="2.2" points={line(o.b, yb)} />
    </svg>
  );
}
