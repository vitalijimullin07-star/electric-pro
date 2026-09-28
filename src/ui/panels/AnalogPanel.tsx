import { useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '@editor/store';
import { simRuntime } from '@editor/sim-runtime';
import { fmtSi, WAVE_TITLES, type AnalogParam, type AnalogPart, type ScopeProbe, type SimView } from '@core/sim';
import type { SimSource } from '@core/model/types';

/*
 * Вкладка «Цепь» (аналоговый расчёт): номиналы выбранной детали на ходу с показаниями
 * напряжения, тока и мощности, «в проект»; осциллограф на 4 канала с синхронизацией;
 * АЧХ от выбранной цепи до напряжения или тока детали.
 */

const COLORS = ['#ffd60a', '#4fd1ff', '#ff6b9a', '#7ee787'];

/** Ползунок 0…1000 ↔ значение (логарифмическая шкала для номиналов). */
const toSlider = (q: AnalogParam, v: number) => (q.log && q.min > 0 ? (1000 * Math.log(v / q.min)) / Math.log(q.max / q.min) : (1000 * (v - q.min)) / (q.max - q.min));
const fromSlider = (q: AnalogParam, x: number) => (q.log && q.min > 0 ? q.min * Math.pow(q.max / q.min, x / 1000) : q.min + ((q.max - q.min) * x) / 1000);

/** Номинал для сравнения: без звёздочки подбора, пробелов и регистра. */
const norm = (v: string) => v.replace(/[*\s]/g, '').replace('.', ',').toLowerCase();

const SI_UNITS = new Set(['Ом', 'Ф', 'Гн', 'В', 'А', 'Вт', 'Гц']);
function fmtValue(v: number, unit: string): string {
  if (SI_UNITS.has(unit)) return fmtSi(v, unit);
  if (unit && !/[а-яА-Я%°·/]/.test(unit) && Number.isNaN(v)) return '—';
  const s = Math.abs(v) >= 100 ? String(Math.round(v)) : String(+v.toPrecision(3));
  return `${s.replace('.', ',')}${unit ? ' ' + unit : ''}`;
}

export function AnalogPanel({ view }: { view: SimView }) {
  const sim = simRuntime.sim;
  const a = sim?.analog;
  const selection = useEditor((s) => s.selection);
  const project = useEditor((s) => s.project);
  const selComp = selection.find((x) => x.kind === 'component')?.id;
  const [pick, setPick] = useState<string>('');
  const parts = useMemo(() => (a ? [...a.parts].filter((x) => x.params.length || x.readings().length).sort((x, y) => x.comp.ref.localeCompare(y.comp.ref, 'ru', { numeric: true })) : []), [a]);
  const part = a?.partOf.get(selComp && a.partOf.has(selComp) ? selComp : pick) ?? null;

  if (!sim) return null;
  if (!a)
    return (
      <p className="hint">
        {sim.analogError ? `Аналоговый расчёт не собрался: ${sim.analogError}` : 'Аналоговый расчёт выключен — включите галочку «аналоговый расчёт» выше и нажмите «Сброс».'}
      </p>
    );
  return (
    <div className="analog">
      <div className="row">
        <select value={part?.comp.id ?? ''} onChange={(e) => setPick(e.target.value)} title="Деталь; можно выбрать и касанием на плате или схеме">
          <option value="">— деталь —</option>
          {parts.map((x) => (
            <option key={x.comp.id} value={x.comp.id}>
              {x.comp.ref} · {x.kind} {x.comp.value}
            </option>
          ))}
        </select>
        <span className="hint">
          {a.stats.nodes} узлов · шаг {fmtSi(a.engine.dt, 'с')}
        </span>
      </div>
      {a.notes.map((n) => (
        <p key={n} className="hint" style={{ color: 'var(--warn)' }}>
          {n}
        </p>
      ))}
      {part ? <PartKnobs part={part} tick={view.seconds} projectValue={project.components[part.comp.id]?.value} /> : <p className="hint">Выберите деталь касанием на плате или в списке: ползунки меняют номинал прямо во время работы.</p>}
      <Sources tick={view.seconds} />
      <Scope tick={view.seconds} part={part} />
      <AcPlot part={part} />
      <NetsTable tick={view.seconds} />
      {a.skipped.length > 0 && <p className="hint">Без аналоговой модели: {a.skipped.join(', ')}. Модель можно выбрать вручную в свойствах детали.</p>}
    </div>
  );
}

function PartKnobs({ part, tick, projectValue }: { part: AnalogPart; tick: number; projectValue?: string }) {
  const [, force] = useState(0);
  const readings = part.readings();
  const nominal = part.nominal?.();
  const commit = useEditor((s) => s.commit);
  void tick;
  return (
    <div className="sim-dev">
      <div className="sim-title">
        <b>{part.comp.ref}</b> <span>{part.kind}</span> <span className="hint">{part.comp.value}</span>
      </div>
      {part.params.map((q) =>
        q.options ? (
          <label key={q.key} className="sim-param">
            <span>{q.label}</span>
            <select value={Math.round(q.value)} onChange={(e) => (simRuntime.analogSet(part.comp.id, q.key, +e.target.value), force((x) => x + 1))}>
              {q.options.map((o, i) => (
                <option key={i} value={i}>
                  {o}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label key={q.key} className="sim-param">
            <span>{q.label}</span>
            <input type="range" min={0} max={1000} step={1} value={Math.round(toSlider(q, q.value))} onChange={(e) => (simRuntime.analogSet(part.comp.id, q.key, fromSlider(q, +e.target.value)), force((x) => x + 1))} />
            <b>{fmtValue(q.value, q.unit)}</b>
          </label>
        ),
      )}
      {part.actions && (
        <div className="row">
          {part.actions.map((x) => (
            <button key={x.key} className="btn sm primary" onClick={() => part.act?.(x.key)}>
              {x.label}
            </button>
          ))}
        </div>
      )}
      <div className="sim-readings">
        {readings.map((r) => (
          <span key={r.label}>
            {r.label} <b>{/^[а-яё ]{4,}$/i.test(r.unit) ? r.unit : fmtValue(r.value, r.unit)}</b>
          </span>
        ))}
      </div>
      {nominal && !part.virtual && norm(nominal) !== norm(projectValue ?? '') && (
        <div className="row">
          <button
            className="btn sm"
            title="Записать номинал в деталь проекта"
            onClick={() => {
              commit((d) => {
                const c = d.components[part.comp.id];
                if (c) c.value = nominal;
              });
              simRuntime.synced = useEditor.getState().project;
              force((x) => x + 1);
            }}
          >
            В проект: {nominal}
          </button>
          <span className="hint">в проекте {projectValue}</span>
        </div>
      )}
      <SaveParams part={part} onSaved={() => force((x) => x + 1)} />
    </div>
  );
}

/** Изменённые параметры модели (не номинал) — в деталь (Component.sim.params) или в генератор проекта. */
function SaveParams({ part, onSaved }: { part: AnalogPart; onSaved: () => void }) {
  const commit = useEditor((s) => s.commit);
  const project = useEditor((s) => s.project);
  if (part.virtual === 'supply' || part.virtual === 'mains') return null;
  if (part.virtual) {
    const src = project.sim?.sources?.find((x) => x.id === part.virtual);
    if (!src) return null;
    const val = (k: string) => part.params.find((q) => q.key === k)?.value;
    const next = { ...src, volts: val('volts') ?? src.volts, freq: val('freq') ?? src.freq, offset: val('offset') ?? src.offset, duty: val('duty') !== undefined ? val('duty')! / 100 : src.duty };
    if (JSON.stringify(next) === JSON.stringify(src)) return null;
    return (
      <div className="row">
        <button
          className="btn sm"
          onClick={() => {
            commit((d) => {
              const list = d.sim?.sources ?? [];
              const i = list.findIndex((x) => x.id === src.id);
              if (i >= 0) list[i] = next;
            });
            simRuntime.synced = useEditor.getState().project;
            onSaved();
          }}
        >
          Запомнить генератор в проекте
        </button>
      </div>
    );
  }
  const saved = project.components[part.comp.id]?.sim?.params ?? {};
  const changed = part.params.filter((q) => !q.nominal && part.defaults && Math.abs(q.value - (part.defaults[q.key] ?? q.value)) > 1e-12 + Math.abs(part.defaults[q.key] ?? 0) * 1e-6 && saved[q.key] !== q.value);
  if (!changed.length) return null;
  return (
    <div className="row">
      <button
        className="btn sm"
        title="Записать параметры модели в деталь (свойства → «Модель для симуляции»); действуют при следующих запусках"
        onClick={() => {
          commit((d) => {
            const c = d.components[part.comp.id];
            if (!c) return;
            const params = { ...(c.sim?.params ?? {}) };
            for (const q of changed) params[q.key] = q.value;
            c.sim = { ...(c.sim ?? {}), params };
          });
          simRuntime.synced = useEditor.getState().project;
          onSaved();
        }}
      >
        Запомнить в детали: {changed.map((q) => q.label).join(', ')}
      </button>
    </div>
  );
}

/** Источники и генераторы: постоянное напряжение, синус, меандр, треугольник, сеть — на любую цепь. */
function Sources({ tick }: { tick: number }) {
  const a = simRuntime.sim?.analog;
  const project = useEditor((s) => s.project);
  const commit = useEditor((s) => s.commit);
  const [net, setNet] = useState('');
  const [wave, setWave] = useState<SimSource['wave']>('sine');
  const [volts, setVolts] = useState('1');
  const [freq, setFreq] = useState('1000');
  const [open, setOpen] = useState(false);
  void tick;
  if (!a) return null;
  const nets = Object.values(project.nets)
    .filter((n) => !a.ground.has(n.id))
    .sort((x, y) => x.name.localeCompare(y.name, 'ru', { numeric: true }));
  const list = project.sim?.sources ?? [];
  const add = () => {
    if (!net) return;
    const s: SimSource = { id: `src${Date.now().toString(36)}`, net, wave, volts: parseFloat(volts.replace(',', '.')) || 0, freq: wave === 'dc' ? undefined : parseFloat(freq.replace(',', '.')) || 1000, ohms: wave === 'dc' ? 0.01 : wave === 'mains' ? 0.5 : 50 };
    commit((d) => {
      d.sim = { ...(d.sim ?? {}), sources: [...(d.sim?.sources ?? []), s] };
    });
    a.addSource(s);
    simRuntime.synced = useEditor.getState().project;
    simRuntime.refresh();
  };
  const remove = (id: string) => {
    commit((d) => {
      if (d.sim?.sources) d.sim.sources = d.sim.sources.filter((x) => x.id !== id);
    });
    a.removeSource(id);
    simRuntime.synced = useEditor.getState().project;
    simRuntime.refresh();
  };
  return (
    <div className="sim-dev">
      <div className="sim-title">
        <label>
          <input type="checkbox" checked={open || list.length > 0} onChange={(e) => setOpen(e.target.checked)} /> <b>Источники и генераторы</b>
        </label>
        <span className="hint">{list.length ? `${list.length} в проекте` : 'на любую цепь, относительно земли'}</span>
      </div>
      {list.map((s) => (
        <div key={s.id} className="row">
          <span>
            {project.nets[s.net]?.name ?? '?'}: {WAVE_TITLES[s.wave]} {s.volts} В{s.wave !== 'dc' ? `, ${fmtSi(s.freq ?? 50, 'Гц')}` : ''}
          </span>
          <button className="btn sm" onClick={() => remove(s.id)} title="Убрать генератор">
            ✕
          </button>
        </div>
      ))}
      {(open || list.length > 0) && (
        <div className="analog-chans">
          <select value={net} onChange={(e) => setNet(e.target.value)}>
            <option value="">цепь —</option>
            {nets.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
          </select>
          <select value={wave} onChange={(e) => setWave(e.target.value as SimSource['wave'])}>
            {(Object.keys(WAVE_TITLES) as SimSource['wave'][]).map((w) => (
              <option key={w} value={w}>
                {WAVE_TITLES[w]}
              </option>
            ))}
          </select>
          <label className="hint">
            {wave === 'dc' ? 'напряжение' : wave === 'mains' ? 'действующее' : 'амплитуда'} <input className="inp" style={{ width: 64 }} value={volts} onChange={(e) => setVolts(e.target.value)} /> В
          </label>
          {wave !== 'dc' && (
            <label className="hint">
              <input className="inp" style={{ width: 80 }} value={freq} onChange={(e) => setFreq(e.target.value)} /> Гц
            </label>
          )}
          <button className="btn sm primary" onClick={add} disabled={!net}>
            Подключить
          </button>
        </div>
      )}
    </div>
  );
}

/** Напряжения всех цепей (как мультиметр на каждой), по имени. */
function NetsTable({ tick }: { tick: number }) {
  const a = simRuntime.sim?.analog;
  const [open, setOpen] = useState(false);
  void tick;
  if (!a) return null;
  const rows = [...a.nodeOf]
    .filter(([, n]) => n >= 0)
    .map(([net, n]) => ({ name: a.netName(net) || net, v: a.engine.volts(n) }))
    .sort((x, y) => x.name.localeCompare(y.name, 'ru', { numeric: true }));
  return (
    <div className="sim-dev">
      <div className="sim-title">
        <label>
          <input type="checkbox" checked={open} onChange={(e) => setOpen(e.target.checked)} /> <b>Напряжения цепей</b>
        </label>
        <span className="hint">{rows.length} цепей, земля — {[...a.ground].map((g) => a.netName(g)).join(', ') || 'нет'}</span>
      </div>
      {open && (
        <table className="grid">
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <td>{r.name}</td>
                <td style={{ textAlign: 'right' }}>{fmtSi(r.v, 'В')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

type Probe = { label: string; probe: ScopeProbe; unit: 'В' | 'А' };

/** Что можно смотреть: напряжения цепей и токи через выводы выбранной детали. */
function probeList(part: AnalogPart | null): Probe[] {
  const a = simRuntime.sim?.analog;
  if (!a) return [];
  const p = a.project;
  const out: Probe[] = [];
  if (part) {
    const pads = new Set<string>();
    for (const el of part.elements) for (const q of el.pins) if (q.pad) pads.add(q.pad);
    for (const pad of pads) out.push({ label: `ток ${part.comp.ref}.${pad}`, probe: { comp: part.comp.id, pad }, unit: 'А' });
  }
  const nets = [...a.nodeOf.entries()].filter(([, n]) => n >= 0).map(([net]) => net);
  nets.sort((x, y) => (p.nets[x]?.name ?? '').localeCompare(p.nets[y]?.name ?? '', 'ru', { numeric: true }));
  for (const net of nets) out.push({ label: p.nets[net]?.name ?? net, probe: { net }, unit: 'В' });
  return out;
}

const WINDOWS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];

function Scope({ tick, part }: { tick: number; part: AnalogPart | null }) {
  const a = simRuntime.sim?.analog;
  const probes = useMemo(() => probeList(part), [part, a]);
  const [chans, setChans] = useState<string[]>(() => {
    // По умолчанию: катушка — вход АЦП и выход ключей, иначе — пусто.
    const names = probes.map((x) => x.label);
    return ['ADC_IN', 'TX_OUT', '', ''].map((n) => (names.includes(n) ? n : ''));
  });
  const [win, setWin] = useState(0.5);
  const [on, setOn] = useState(false);
  const ref = useRef<HTMLCanvasElement>(null);
  const active = chans.map((c) => probes.find((x) => x.label === c)).filter((x): x is Probe => !!x);
  const key = active.map((x) => x.label).join('|') + win;
  useEffect(() => {
    if (!a || !on) return;
    const len = 2000;
    a.setScope(
      active.map((x) => x.probe),
      (win / 1000 / a.engine.dt / len) * 2,
      len,
    );
    return () => a.setScope([], 1, 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a, key, on]);
  useEffect(() => {
    const cv = ref.current;
    if (!cv || !a || !on) return;
    const dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth;
    const H = 190;
    cv.width = W * dpr;
    cv.height = H * dpr;
    const ctx = cv.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0b0f14';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#1d2733';
    ctx.lineWidth = 1;
    for (let i = 1; i < 10; i++) {
      ctx.beginPath();
      ctx.moveTo((W * i) / 10, 0);
      ctx.lineTo((W * i) / 10, H);
      ctx.stroke();
    }
    for (let i = 1; i < 8; i++) {
      ctx.beginPath();
      ctx.moveTo(0, (H * i) / 8);
      ctx.lineTo(W, (H * i) / 8);
      ctx.stroke();
    }
    const s = a.scope();
    if (!s.data.length || !s.data[0].length) return;
    const n = s.data[0].length;
    const span = Math.min(n, Math.round(win / 1000 / s.dt));
    // Синхронизация: последний фронт канала 1 через середину, чтобы окно поместилось.
    const d0 = s.data[0];
    let mn = Infinity;
    let mx = -Infinity;
    for (const x of d0) (mn = Math.min(mn, x)), (mx = Math.max(mx, x));
    const mid = (mn + mx) / 2;
    let start = n - span;
    for (let i = n - span - 1; i > Math.max(0, n - 2 * span); i--)
      if (d0[i] < mid && d0[i + 1] >= mid && mx - mn > 1e-6) {
        start = i;
        break;
      }
    start = Math.max(0, start);
    ctx.font = '11px system-ui';
    s.data.forEach((d, k) => {
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = start; i < start + span && i < d.length; i++) (lo = Math.min(lo, d[i])), (hi = Math.max(hi, d[i]));
      if (hi - lo < 1e-9) (hi += 1e-9), (lo -= 1e-9);
      const pad = (hi - lo) * 0.1;
      const Y = (v: number) => H - 6 - ((v - lo + pad) / (hi - lo + 2 * pad)) * (H - 12);
      ctx.strokeStyle = COLORS[k];
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      for (let i = 0; i < span && start + i < d.length; i++) {
        const x = (i / span) * W;
        const y = Y(d[start + i]);
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.stroke();
      const pr = active[k];
      ctx.fillStyle = COLORS[k];
      ctx.fillText(`${pr?.label ?? ''}: ${fmtSi(lo + pad * 0, pr?.unit ?? 'В')} … ${fmtSi(hi, pr?.unit ?? 'В')}`, 4, 13 + k * 13);
    });
    ctx.fillStyle = '#5b6775';
    ctx.fillText(`${String(win).replace('.', ',')} мс на экран`, W - 96, H - 4);
  }, [tick, a, on, key, win, active]);
  if (!a) return null;
  return (
    <div className="sim-dev">
      <div className="sim-title">
        <label>
          <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} /> <b>Осциллограф</b>
        </label>
        {on && (
          <select value={win} onChange={(e) => setWin(+e.target.value)}>
            {WINDOWS.map((w) => (
              <option key={w} value={w}>
                {String(w).replace('.', ',')} мс
              </option>
            ))}
          </select>
        )}
      </div>
      {on && (
        <>
          <div className="analog-chans">
            {chans.map((c, k) => (
              <select key={k} value={c} style={{ borderColor: COLORS[k] }} onChange={(e) => setChans((cs) => cs.map((x, i) => (i === k ? e.target.value : x)))}>
                <option value="">канал {k + 1} —</option>
                {probes.map((x) => (
                  <option key={x.label} value={x.label}>
                    {x.label}
                  </option>
                ))}
              </select>
            ))}
          </div>
          <canvas ref={ref} className="sim-scope" style={{ height: 190 }} />
          <p className="hint">Синхронизация — по фронту первого канала, масштаб каждого канала — по размаху.</p>
        </>
      )}
    </div>
  );
}

function AcPlot({ part }: { part: AnalogPart | null }) {
  const a = simRuntime.sim?.analog;
  const probes = useMemo(() => probeList(part), [part, a]);
  const netProbes = probes.filter((x) => 'net' in x.probe);
  const defIn = a?.defaultAcInput();
  const [inp, setInp] = useState<string>(() => (defIn && a ? (a.project.nets[defIn]?.name ?? '') : ''));
  const [out, setOut] = useState<string>('');
  const [f1, setF1] = useState(100);
  const [f2, setF2] = useState(100_000);
  const [res, setRes] = useState<{ f: number; mag: number; phase: number }[] | null>(null);
  const [unit, setUnit] = useState<'В' | 'А'>('В');
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv || !res || !res.length) return;
    const dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth;
    const H = 170;
    cv.width = W * dpr;
    cv.height = H * dpr;
    const ctx = cv.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0b0f14';
    ctx.fillRect(0, 0, W, H);
    const lf1 = Math.log10(res[0].f);
    const lf2 = Math.log10(res[res.length - 1].f);
    const X = (f: number) => ((Math.log10(f) - lf1) / (lf2 - lf1 || 1)) * W;
    ctx.strokeStyle = '#1d2733';
    ctx.fillStyle = '#5b6775';
    ctx.font = '10px system-ui';
    for (let e = Math.ceil(lf1); e <= lf2; e++) {
      const x = X(10 ** e);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
      ctx.fillText(fmtSi(10 ** e, 'Гц', 2), x + 2, H - 3);
    }
    const db = res.map((r) => 20 * Math.log10(Math.max(1e-15, r.mag)));
    const top = Math.max(...db);
    const bot = Math.max(top - 80, Math.min(...db));
    const Y = (v: number) => 6 + ((top - v) / (top - bot || 1)) * (H - 20);
    ctx.strokeStyle = '#ffd60a';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    res.forEach((r, i) => (i ? ctx.lineTo(X(r.f), Y(db[i])) : ctx.moveTo(X(r.f), Y(db[i]))));
    ctx.stroke();
    ctx.strokeStyle = '#4fd1ff';
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    const P = (ph: number) => 6 + ((180 - ph) / 360) * (H - 20);
    res.forEach((r, i) => (i ? ctx.lineTo(X(r.f), P(r.phase)) : ctx.moveTo(X(r.f), P(r.phase))));
    ctx.stroke();
    ctx.setLineDash([]);
  }, [res]);
  if (!a) return null;
  const peak = res?.reduce((b, x) => (x.mag > b.mag ? x : b));
  const run = () => {
    const pIn = netProbes.find((x) => x.label === inp);
    const pOut = probes.find((x) => x.label === out);
    if (!pIn || !pOut || !('net' in pIn.probe)) return;
    setUnit(pOut.unit);
    setRes(a.acSweep(pIn.probe.net, pOut.probe, Math.max(1, f1), Math.max(f1 * 1.01, f2), 240));
  };
  return (
    <div className="sim-dev">
      <div className="sim-title">
        <b>АЧХ</b> <span className="hint">1 В переменного на входе, ключи — как сейчас</span>
      </div>
      <div className="analog-chans">
        <select value={inp} onChange={(e) => setInp(e.target.value)}>
          <option value="">вход —</option>
          {netProbes.map((x) => (
            <option key={x.label}>{x.label}</option>
          ))}
        </select>
        <select value={out} onChange={(e) => setOut(e.target.value)}>
          <option value="">выход —</option>
          {probes.map((x) => (
            <option key={x.label}>{x.label}</option>
          ))}
        </select>
        <label className="hint">
          от <input type="number" value={f1} min={1} onChange={(e) => setF1(+e.target.value)} style={{ width: 80 }} /> Гц
        </label>
        <label className="hint">
          до <input type="number" value={f2} min={2} onChange={(e) => setF2(+e.target.value)} style={{ width: 90 }} /> Гц
        </label>
        <button className="btn sm primary" onClick={run} disabled={!inp || !out}>
          Построить
        </button>
      </div>
      {res && (
        <>
          <canvas ref={ref} className="sim-scope" style={{ height: 170 }} />
          {peak && (
            <p className="hint">
              Жёлтая — размах (дБ), голубая — фаза. Пик: {fmtSi(peak.f, 'Гц')}, {fmtSi(peak.mag, unit === 'А' ? 'А' : 'В')} на 1 В, фаза {Math.round(peak.phase)}°.
            </p>
          )}
        </>
      )}
    </div>
  );
}
