import { useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '@editor/store';
import { Dialog } from './Dialog';
import { computeConnectivity } from '@core/model/connectivity';
import { netsByRole, ROLE_TITLES } from '@core/model/net-roles';
import type { NetRole, Project } from '@core/model/types';
import { autoGrid } from '@core/router/autoroute';
import { searchThreads, startVariantSearch, type SearchJob, type SearchProgress } from '@core/router/client';
import { applyRoleClasses, applyVariant, type SearchOptions, type VariantResult } from '@core/router/variants';
import { applyPlacement } from '@core/place/autoplace';
import { boardPolygon } from '@core/model/project';
import { getWorld } from '@core/model/world';

/*
 * Расстановка и трассировка: галочки — что делать и что учитывать (роли цепей), сколько
 * искать и сколькими потоками; поиск перебирает варианты на всех ядрах, лучшие показываются
 * карточками с миниатюрой — любой можно применить (и отменить Ctrl+Z или выбрать другой).
 */

const TIMES = [
  { ms: 15_000, label: '15 с' },
  { ms: 45_000, label: '45 с' },
  { ms: 120_000, label: '2 мин' },
  { ms: 300_000, label: '5 мин' },
];
const KEEP = 6;

/** Последний поиск: чтобы после «Применить» можно было выбрать другой вариант. */
let last: { base: Project; applied: Project | null; options: SearchOptions; results: VariantResult[]; appliedIndex: number | null } | null = null;

export function AutoDesignDialog() {
  const s = useEditor();
  const p = s.project;
  const conn = useMemo(() => computeConnectivity(p), [p]);
  const oneLayer = p.board.copperLayers === 1;
  const roles = useMemo(() => netsByRole(p), [p]);
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
  const [place, setPlace] = useState(false);
  const [route, setRoute] = useState(true);
  const [keep, setKeep] = useState(false);
  const [twoLayers, setTwoLayers] = useState(oneLayer);
  const [useHv, setUseHv] = useState(true);
  const [usePower, setUsePower] = useState(true);
  const [useNoise, setUseNoise] = useState(true);
  const [timeIdx, setTimeIdx] = useState(1);
  const [threads, setThreads] = useState(searchThreads());
  const [grid, setGrid] = useState<number>(autoGrid(p));
  const [editRoles, setEditRoles] = useState(false);
  const restored = last && (p === last.base || p === last.applied) ? last : null;
  const [results, setResults] = useState<VariantResult[]>(restored?.results ?? []);
  const [appliedIndex, setAppliedIndex] = useState<number | null>(restored?.appliedIndex ?? null);
  const [progress, setProgress] = useState<SearchProgress | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const job = useRef<SearchJob | null>(null);
  const running = !!progress;

  useEffect(() => () => job.current?.stop(), []);

  const start = () => {
    // Роли → классы цепей (сеть — Mains с большим зазором, питание — Power): прямо в проект.
    const use = { hv: useHv, power: usePower, noise: useNoise };
    const probe = structuredClone(p);
    if (applyRoleClasses(probe, { roles, use }).length) s.commit((d) => void applyRoleClasses(d, { roles, use }));
    const base = useEditor.getState().project;
    const options: SearchOptions = { place, route, keepExisting: keep && !place, roles: netsByRole(base), use, tryTwoLayers: oneLayer && twoLayers, stitch: true, grid, effort: [0.6, 1.2, 2.5, 5][timeIdx] };
    last = { base, applied: null, options, results: [], appliedIndex: null };
    setResults([]);
    setAppliedIndex(null);
    setErrors([]);
    setProgress({ done: 0, running: new Map(), threads, leftMs: TIMES[timeIdx].ms });
    const j = startVariantSearch(base, options, {
      timeMs: TIMES[timeIdx].ms,
      threads,
      onResult: (r) => {
        if (!last || last.base !== base) return;
        // Сначала — варианты с тем же числом слоёв, что у платы; двусторонние предложения — после.
        const same = (v: VariantResult) => v.layers === base.board.copperLayers;
        const all = [...last.results, r].sort((a, b) => Number(!same(a)) - Number(!same(b)) || a.score - b.score);
        const mine = all.filter(same).slice(0, KEEP - 2);
        const other = all.filter((v) => !same(v)).slice(0, 2);
        last.results = [...mine, ...other, ...all.filter(same).slice(KEEP - 2)].slice(0, KEEP);
        setResults(last.results);
      },
      onProgress: (pr) => setProgress(pr),
      onError: (m) => setErrors((e) => [...e.slice(-2), m]),
    });
    job.current = j;
    j.promise.then(() => {
      setProgress(null);
      job.current = null;
      const best = last?.results[0];
      s.setMessage(best ? `Поиск закончен: лучший вариант — ${statsText(best)}.` : 'Поиск закончен: вариантов нет.');
    });
  };
  const stop = () => {
    job.current?.stop();
  };
  const apply = (v: VariantResult) => {
    if (!last) return;
    const base = last.base;
    const o = last.options;
    s.commit((d) => {
      // Каждый раз — от состояния до поиска: переключение между вариантами не копит правки.
      for (const k of Object.keys(base) as (keyof Project)[]) (d as unknown as Record<string, unknown>)[k] = structuredClone(base[k]);
      applyVariant(d, o, v);
    });
    last.applied = useEditor.getState().project;
    last.appliedIndex = v.index;
    setAppliedIndex(v.index);
    s.setMessage(`Применён вариант ${v.label}: ${statsText(v)}. Ctrl+Z — отменить.`);
  };

  const setRole = (id: string, role: NetRole | '') =>
    s.commit((d) => {
      if (!d.nets[id]) return;
      if (role) d.nets[id].role = role;
      else delete d.nets[id].role;
    });
  const netNames = (ids: string[]) => {
    const names = ids.map((id) => p.nets[id]?.name ?? '?');
    return names.length > 8 ? `${names.slice(0, 8).join(', ')} и ещё ${names.length - 8}` : names.join(', ') || '—';
  };
  const time = TIMES[timeIdx];

  return (
    <Dialog
      title="Автотрассировка и расстановка"
      size="wide"
      onClose={() => {
        job.current?.stop();
        s.closeDialog();
      }}
      footer={
        running ? (
          <button className="btn danger" onClick={stop}>
            Остановить (оставить найденное)
          </button>
        ) : (
          <>
            <button className="btn" onClick={s.closeDialog}>
              Закрыть
            </button>
            <button className="btn primary" onClick={start} disabled={!conn.total || (!place && !route)}>
              {results.length ? 'Искать заново' : 'Искать варианты'}
            </button>
          </>
        )
      }
    >
      <div className="ad-grid">
        <section>
          <h4>Что сделать</h4>
          <label className="ad-check">
            <input type="checkbox" checked={place} onChange={(e) => setPlace(e.target.checked)} disabled={running} />
            <span>
              <b>Расставить компоненты</b>
              <small>Закреплённые (свойства → «закрепить») и крепёжные отверстия остаются на месте. Разъёмы — к краю, выводы 230 В — в своей зоне, меньше пересечений связей.</small>
            </span>
          </label>
          <label className="ad-check">
            <input type="checkbox" checked={route} onChange={(e) => setRoute(e.target.checked)} disabled={running} />
            <span>
              <b>Развести дорожки</b>
              <small>{oneLayer ? 'Одна сторона меди: где дорожке не пройти — перемычка проводом.' : 'Два слоя: переходные, где нужно.'} Дорожки прямо и под 45°.</small>
            </span>
          </label>
          {route && !place && conn.total - conn.unrouted > 0 && (
            <label className="ad-check">
              <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} disabled={running} />
              <span>
                <b>Оставить уже проведённые дорожки</b>
                <small>Развести только недоведённые цепи ({conn.unrouted}).</small>
              </span>
            </label>
          )}
          {oneLayer && route && (
            <label className="ad-check">
              <input type="checkbox" checked={twoLayers} onChange={(e) => setTwoLayers(e.target.checked)} disabled={running} />
              <span>
                <b>Предложить и двустороннюю плату</b>
                <small>Каждый четвёртый вариант — на двух слоях: без перемычек, с переходными. Выберете — плата станет двусторонней.</small>
              </span>
            </label>
          )}

          <h4>Что учитывать</h4>
          <label className="ad-check">
            <input type="checkbox" checked={useHv} onChange={(e) => setUseHv(e.target.checked)} disabled={running} />
            <span>
              <b>{ROLE_TITLES.hv}: отдельно, зазор 6 мм</b>
              <small>{roles.hv.length ? netNames(roles.hv) : 'цепей 230 В не найдено'}</small>
            </span>
          </label>
          <label className="ad-check">
            <input type="checkbox" checked={usePower} onChange={(e) => setUsePower(e.target.checked)} disabled={running} />
            <span>
              <b>{ROLE_TITLES.power}: шире дорожки</b>
              <small>{netNames(roles.power)}</small>
            </span>
          </label>
          <label className="ad-check">
            <input type="checkbox" checked={useNoise} onChange={(e) => setUseNoise(e.target.checked)} disabled={running} />
            <span>
              <b>Помехоопасные — подальше от чувствительных</b>
              <small>
                помехоопасные: {netNames(roles.noisy)}; чувствительные: {netNames(roles.sensitive)}
              </small>
            </span>
          </label>
          <button className="btn sm" onClick={() => setEditRoles(!editRoles)} disabled={running}>
            {editRoles ? 'Скрыть список цепей' : 'Изменить роли цепей…'}
          </button>
          {editRoles && (
            <div className="ad-roles">
              {(Object.keys(roles) as NetRole[]).flatMap((r) =>
                roles[r].map((id) => (
                  <label key={id}>
                    <span>{p.nets[id].name}</span>
                    <select value={p.nets[id].role ?? ''} onChange={(e) => setRole(id, e.target.value as NetRole | '')}>
                      <option value="">сам: {ROLE_TITLES[r].toLowerCase()}</option>
                      {(Object.keys(ROLE_TITLES) as NetRole[]).map((k) => (
                        <option key={k} value={k}>
                          {ROLE_TITLES[k]}
                        </option>
                      ))}
                    </select>
                  </label>
                )),
              )}
            </div>
          )}

          <h4>Сколько искать</h4>
          <div className="ad-seg">
            {TIMES.map((t, i) => (
              <button key={t.ms} className={`btn sm${i === timeIdx ? ' primary' : ''}`} onClick={() => setTimeIdx(i)} disabled={running}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="field">
            <label>Потоков</label>
            <select className="sel" value={threads} onChange={(e) => setThreads(+e.target.value)} disabled={running}>
              {Array.from({ length: Math.max(1, cores) }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n}
                  {n === cores ? ' — все ядра' : ''}
                </option>
              ))}
            </select>
            <label>Сетка трассировки, мм</label>
            <select className="sel" value={String(grid)} onChange={(e) => setGrid(+e.target.value)} disabled={running}>
              {[...new Set([autoGrid(p), 0.5, 0.635, 0.8, 1.0, 1.27, 2.54])].sort((a, b) => a - b).map((g) => (
                <option key={g} value={String(g)}>
                  {String(g).replace('.', ',')}
                  {Math.abs(g - autoGrid(p)) < 1e-9 ? ' — по правилам' : ''}
                </option>
              ))}
            </select>
          </div>
          <p className="hint">
            Считает на ядрах процессора: каждый поток — свой вариант (своё семя расстановки и свой порядок трассировки). Нейропроцессор телефона браузер программам не отдаёт — для этой задачи он и не
            подходит: перебор вариантов — работа для процессора. Больше времени — больше вариантов и тщательнее расстановка.
          </p>
        </section>

        <section>
          <h4>Варианты</h4>
          {running && progress && (
            <>
              <div className="progress">
                <div style={{ width: `${Math.round(100 * (1 - progress.leftMs / time.ms))}%` }} />
              </div>
              <p className="hint">
                Потоков: {progress.threads} · проверено вариантов: {progress.done} · считаются: {progress.running.size} ·{' '}
                {progress.leftMs > 0 ? `осталось ${Math.ceil(progress.leftMs / 1000)} с` : 'время вышло — доделываются начатые'}
              </p>
            </>
          )}
          {!results.length && !running && <p className="hint">Нажмите «Искать варианты». Лучшие появятся здесь по мере готовности — выберите любой.</p>}
          {errors.length > 0 && <p className="hint" style={{ color: 'var(--warn)' }}>Ошибка в варианте: {errors[errors.length - 1]}</p>}
          <div className="ad-cards">
            {results.map((v, i) => (
              <div key={v.index} className={`ad-card${appliedIndex === v.index ? ' on' : ''}`}>
                <Thumb base={last?.base ?? p} v={v} />
                <div className="ad-card-body">
                  <b>
                    {i === 0 && v.layers === (last?.base ?? p).board.copperLayers && <span className="tag ok">лучший</span>}
                    {v.layers !== (last?.base ?? p).board.copperLayers && <span className="tag">{v.layers} слоя</span>} {v.label}
                  </b>
                  <small>{statsText(v)}</small>
                  <button className={`btn sm${appliedIndex === v.index ? '' : ' primary'}`} onClick={() => apply(v)} disabled={appliedIndex === v.index}>
                    {appliedIndex === v.index ? 'Применён' : 'Применить'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </Dialog>
  );
}

function statsText(v: VariantResult): string {
  const st = v.stats;
  const parts = [st.unrouted ? `не разведено цепей: ${st.unrouted}` : 'разведено всё'];
  if (v.layers === 1 || st.jumpers) parts.push(`перемычек ${st.jumpers}`);
  if (v.layers > 1) parts.push(`переходных ${st.vias}`);
  parts.push(`дорожки ${(st.length / 1000).toFixed(2).replace('.', ',')} м`);
  if (st.drc) parts.push(`ошибок ${st.drc}`);
  if (st.place) parts.push(`пересечений связей ${st.place.crossings}`);
  return parts.join(' · ');
}

/** Миниатюра варианта: плата, габариты деталей, дорожки по слоям, перемычки, переходные. */
function Thumb({ base, v }: { base: Project; v: VariantResult }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const q = structuredClone(base);
    q.tracks = {};
    q.vias = {};
    q.wires = {};
    applyPlacement(q, v.moves);
    const w = getWorld(q);
    const poly = boardPolygon(q.board);
    const xs = poly.map((a) => a.x);
    const ys = poly.map((a) => a.y);
    const x0 = Math.min(...xs);
    const y0 = Math.min(...ys);
    const bw = Math.max(...xs) - x0;
    const bh = Math.max(...ys) - y0;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = cv.clientWidth || 260;
    const H = Math.round((W * bh) / bw);
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    cv.style.height = `${H}px`;
    const k = ((W - 8) / bw) * dpr;
    const X = (x: number) => (x - x0) * k + 4 * dpr;
    const Y = (y: number) => (y - y0) * k + 4 * dpr;
    const ctx = cv.getContext('2d')!;
    ctx.fillStyle = '#0d1a12';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.beginPath();
    poly.forEach((a, i) => (i ? ctx.lineTo(X(a.x), Y(a.y)) : ctx.moveTo(X(a.x), Y(a.y))));
    ctx.closePath();
    ctx.fillStyle = '#16452a';
    ctx.fill();
    ctx.strokeStyle = '#8fd19e';
    ctx.lineWidth = dpr;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(230,230,210,0.45)';
    for (const c of w.components) {
      if (c.component.offBoard) continue;
      ctx.beginPath();
      c.outline.forEach((a, i) => (i ? ctx.lineTo(X(a.x), Y(a.y)) : ctx.moveTo(X(a.x), Y(a.y))));
      ctx.closePath();
      ctx.stroke();
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const t of v.tracks) {
      ctx.strokeStyle = t.layer === 'F.Cu' ? '#e0564b' : '#e8a33d';
      ctx.lineWidth = Math.max(dpr, t.width * k);
      ctx.beginPath();
      t.points.forEach((a, i) => (i ? ctx.lineTo(X(a.x), Y(a.y)) : ctx.moveTo(X(a.x), Y(a.y))));
      ctx.stroke();
    }
    ctx.fillStyle = '#d8d8d0';
    for (const pd of w.pads) {
      if (pd.component.offBoard) continue;
      ctx.fillRect(X(pd.center.x) - dpr, Y(pd.center.y) - dpr, 2 * dpr, 2 * dpr);
    }
    ctx.strokeStyle = '#5ec8ff';
    ctx.lineWidth = 1.2 * dpr;
    ctx.setLineDash([3 * dpr, 2 * dpr]);
    for (const wr of v.wires) {
      ctx.beginPath();
      ctx.moveTo(X(wr.a.x), Y(wr.a.y));
      ctx.lineTo(X(wr.b.x), Y(wr.b.y));
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.fillStyle = '#ffffff';
    for (const vi of v.vias) {
      ctx.beginPath();
      ctx.arc(X(vi.at.x), Y(vi.at.y), Math.max(1.2 * dpr, (vi.diameter / 2) * k), 0, Math.PI * 2);
      ctx.fill();
    }
  }, [base, v]);
  return <canvas ref={ref} className="ad-thumb" aria-label={`Миниатюра варианта ${v.label}`} />;
}
