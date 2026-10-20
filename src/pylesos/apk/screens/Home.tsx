/* Главная: тяга, режим, основные величины, пуск и удар, бак и турбины. */
import { faultList, filterClean, stateText } from '../../protocol';
import type { Ctx } from '../ctx';
import { fmt } from '../history';
import { native } from '../native';
import { Icon, Param, Seg, Tile } from '../ui';

const WATER = ['сухо', 'вода есть', 'бак полон', 'перелив'];

export function Home(c: Ctx) {
  const { s, send } = c;
  const running = !!s.running || s.state === 1;
  const x = s as unknown as { w1?: number; w2?: number; kg?: number };
  const kw = x.w1 !== undefined ? ((x.w1 ?? 0) + (x.w2 ?? 0)) / 1000 : (s.mains * (s.i1 + s.i2)) / 1000;
  const kg = x.kg !== undefined && x.kg >= 0 ? x.kg / 10 : -1;
  const clean = filterClean(s);
  const rTone = clean === null ? undefined : clean >= 60 ? 'ok' : clean >= 35 ? 'warn' : 'bad';
  const rText = clean === null ? 'не мерили' : clean >= 60 ? 'норма' : clean >= 35 ? 'забит' : 'пора мыть';
  const f = faultList(s);
  const ring = Math.max(0, Math.min(100, s.power || 0));
  const dash = (ring / 100) * 339.3;
  return (
    <div className="screen">
      {c.mode === 'demo' && <DemoCard {...c} />}
      <section className="card hero">
        <svg width="132" height="132" viewBox="0 0 132 132" role="img" aria-label={`Мощность турбин ${ring} процентов`}>
          <circle cx="66" cy="66" r="54" fill="none" stroke="#24313B" strokeWidth="12" />
          <circle cx="66" cy="66" r="54" fill="none" stroke={s.purging ? '#F2A93B' : '#3CC8B4'} strokeWidth="12" strokeLinecap="round" strokeDasharray={`${dash} 340`} transform="rotate(-90 66 66)" />
          <text x="66" y="68" textAnchor="middle" fill="#E9EEF2" fontFamily="IBM Plex Mono" fontSize="30" fontWeight="600">
            {ring}%
          </text>
          <text x="66" y="90" textAnchor="middle" fill="#9AA8B4" fontFamily="IBM Plex Sans" fontSize="12">
            турбины
          </text>
        </svg>
        <div className="hero-t">
          <div className="muted small">{s.mode ? `Авто · расход ${fmt(s.sp)} л/с` : 'Ручной режим'}</div>
          <div className="hero-state">{stateText(s)}</div>
          <div className="muted small">
            {s.en1 ? `Т1 ${fmt(s.p1)} %` : 'Т1 выкл'} · {s.en2 ? `Т2 ${fmt(s.p2)} %` : 'Т2 выкл'}
          </div>
          {f.length > 0 ? <div className={`small ${f[0].severe ? 'bad' : 'warn'}`}>{f[0].text}</div> : <div className="small ok">Всё в порядке</div>}
        </div>
      </section>

      <section className="grid2">
        <Tile label="Разрежение" value={fmt(s.vacuum, 1)} unit="кПа" />
        <Tile label="Расход" value={fmt(s.flow, 1)} unit="л/с" />
        <Tile label="Мощность" value={fmt(kw, 2)} unit="кВт" />
        <Tile label="Фильтр R" value={s.r ? fmt(s.r, 2) : '—'} unit={rText} tone={rTone} />
      </section>

      <section className="stack">
        <Seg items={[[1, 'Авто'], [0, 'Ручной']]} value={s.mode ? 1 : 0} onPick={(v) => send(v ? 'mode a' : 'mode m')} />
        {s.mode ? (
          <Param label="Расход воздуха" value={s.sp} min={10} max={60} step={1} unit="л/с" onSet={(v) => send(`sp ${v}`)} />
        ) : (
          <Param label="Мощность турбин" value={s.power} min={30} max={100} step={5} unit="%" onSet={(v) => send(`pw ${v}`)} />
        )}
      </section>

      <section className="grid-act">
        {s.sleep ? (
          <button type="button" className="btn big go" onClick={() => send('wake')}>
            Включить
          </button>
        ) : running ? (
          <button type="button" className="btn big stop" onClick={() => send('stop')}>
            Стоп
          </button>
        ) : (
          <button type="button" className="btn big go" onClick={() => send('start')}>
            Пуск
          </button>
        )}
        <button type="button" className="btn big" onClick={() => send('purge')} disabled={!!s.purging}>
          Удар
        </button>
        <button type="button" className="btn big" onClick={() => send('purge strong')} disabled={!!s.purging}>
          Мощная
        </button>
      </section>

      <section className="card">
        <div className="row">
          <span className="muted">Бак</span>
          <span className={s.water > 1 || s.float ? 'warn' : ''}>
            {WATER[s.water] ?? '—'}
            {kg >= 0 ? ` · ${fmt(kg, 1)} кг` : ''}
          </span>
        </div>
        <div className="row">
          <span className="muted">Турбины</span>
          <span>
            {fmt(s.t1)} °C · {fmt(s.t2)} °C
          </span>
        </div>
        <div className="row">
          <span className="muted">Сеть</span>
          <span className={s.mains < 190 || s.mains > 250 ? 'warn' : ''}>{fmt(s.mains)} В</span>
        </div>
        {s.air ? (
          <div className="row">
            <span className="muted">Воздух</span>
            <span>
              {fmt(s.ta ?? 0, 1)} °C{s.air === 2 ? ` · ${fmt(s.rh ?? 0)} %` : ''} · {fmt(s.pa ?? 0)} гПа
            </span>
          </div>
        ) : null}
        <div className="row">
          <span className="muted">Запись в телефон</span>
          <span className="ok">{c.ring.size ? `идёт · ${dur(c.ring.size)}` : 'ждёт данных'}</span>
        </div>
      </section>

      <section className="grid2">
        <button type="button" className="tilebtn" onClick={() => c.go('sensors')}>
          {Icon.gauge} Все датчики
        </button>
        <button type="button" className="tilebtn" onClick={() => c.open('screen')}>
          {Icon.screen} Экран пылесоса
        </button>
      </section>
    </div>
  );
}

function dur(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h ? `${h} ч ${m} мин` : `${m} мин`;
}

/** Демо — до первого подключения: пояснение и что можно попробовать. */
function DemoCard(c: Ctx) {
  const w = c.world;
  return (
    <section className="card demo">
      <div className="demo-h">
        <b>Демо: пылесос в телефоне</b>
        <span className="muted small">та же прошивка, что в пылесосе</span>
      </div>
      <p className="small muted">Поверните телефон боком — увидите экран пылесоса. Попробуйте сами:</p>
      <div className="chips">
        <button type="button" className="chip" onClick={() => c.demo?.act('hose')}>
          {w?.hoseClosed ? 'Открыть шланг' : 'Закрыть шланг'}
        </button>
        <button type="button" className="chip" onClick={() => c.demo?.act('dust')}>
          Запылить фильтр
        </button>
        <button type="button" className="chip" onClick={() => c.demo?.act('tool')}>
          {w?.tool ? 'Выключить инструмент' : 'Включить инструмент'}
        </button>
        <button type="button" className="chip" onClick={() => c.demo?.act('suck')}>
          {w?.sucking ? 'Хватит воды' : 'Сосать воду'}
        </button>
      </div>
      <button type="button" className="btn wide go" onClick={() => c.setMode('device')}>
        Подключить свой пылесос
      </button>
      {native && (
        <button type="button" className="btn wide" onClick={() => c.open('update')}>
          Прошить плату по кабелю
        </button>
      )}
    </section>
  );
}
