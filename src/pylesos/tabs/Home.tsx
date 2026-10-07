import type { Ctx } from '../App';
import { Gauge, Row, Section, Stepper } from '../ui';

const WATER = ['сухо', 'вода на уровне — турбины стоп', 'перелив!'];

export function HomeTab({ s, send, world, demo }: Ctx) {
  const running = !!s.running || s.state === 1;
  return (
    <>
      <div className="power">
        {s.sleep ? (
          <button className="btn big primary" onClick={() => send('wake')}>
            Включить
          </button>
        ) : running ? (
          <button className="btn big danger" onClick={() => send('stop')}>
            Стоп
          </button>
        ) : (
          <button className="btn big primary" onClick={() => send('start')}>
            Пуск
          </button>
        )}
        <div className="pair">
          <button className={`btn ${s.en1 ? 'on' : ''}`} onClick={() => send(`t1 ${s.en1 ? 0 : 1}`)}>
            Турбина 1{s.en1 ? ' ✓' : ''}
          </button>
          <button className={`btn ${s.en2 ? 'on' : ''}`} onClick={() => send(`t2 ${s.en2 ? 0 : 1}`)}>
            Турбина 2{s.en2 ? ' ✓' : ''}
          </button>
        </div>
      </div>

      <div className="gauges">
        <Gauge label="Расход" value={s.flow} unit="л/с" max={70} dec={1} mark={s.mode ? s.sp : undefined} />
        <Gauge label="Разрежение" value={s.vacuum} unit="кПа" max={25} dec={1} />
        <Gauge label="В шланге" value={s.speed} unit="м/с" max={40} dec={0} />
        <Gauge label="Ток всего" value={s.itotal} unit="А" max={s.limit || 25} dec={1} />
      </div>

      <Section title="Мощность">
        <div className="seg">
          <button className={s.mode ? 'on' : ''} onClick={() => send('mode a')}>
            Авто: держит расход
          </button>
          <button className={!s.mode ? 'on' : ''} onClick={() => send('mode m')}>
            Ручная
          </button>
        </div>
        {s.mode ? (
          <Stepper label="Расход воздуха" hint="для режима очистки" value={s.sp} min={10} max={60} step={1} unit="л/с" slider onSet={(v) => send(`sp ${v}`)} />
        ) : (
          <Stepper label="Мощность турбин" value={s.power} min={30} max={100} step={5} unit="%" slider onSet={(v) => send(`pw ${v}`)} />
        )}
        {s.cap > 0 && s.cap < 100 && <Row k="Ограничение по току" v={`${s.cap} %`} warn />}
      </Section>

      <Section title="Турбины">
        <div className="two">
          {[1, 2].map((k) => {
            const p = k === 1 ? s.p1 : s.p2;
            const i = k === 1 ? s.i1 : s.i2;
            const t = k === 1 ? s.t1 : s.t2;
            const relay = k === 1 ? s.k1 : s.k2;
            return (
              <div key={k} className={`turb ${p > 0 ? 'run' : ''}`}>
                <div className="turb-h">Турбина {k}</div>
                <Row k="Мощность" v={`${Math.round(p)} %`} />
                <Row k="Ток" v={`${i.toLocaleString('ru', { maximumFractionDigits: 1 })} А`} />
                <Row k="Нагрев" v={`${Math.round(t)} °C`} warn={t > 85} />
                <Row k="Реле" v={relay ? 'замкнуто' : '—'} />
              </div>
            );
          })}
        </div>
        <Row k="Наработка" v={`${s.h1.toLocaleString('ru', { maximumFractionDigits: 1 })} ч / ${s.h2.toLocaleString('ru', { maximumFractionDigits: 1 })} ч`} />
      </Section>

      <Section title="Розетка инструмента">
        <Row k="Инструмент" v={s.tool ? `работает, ${s.itool.toLocaleString('ru', { maximumFractionDigits: 1 })} А` : 'не работает'} />
        <Row k="Розетка" v={s.sock ? 'под напряжением' : 'выключена'} />
        <div className="pair">
          <button className="btn" onClick={() => send('sock on')}>
            Включить розетку
          </button>
          <button className="btn" onClick={() => send('sock off')}>
            Выключить
          </button>
        </div>
      </Section>

      <Section title="Бак">
        <Row k="Вода" v={WATER[s.water] ?? '—'} warn={s.water > 0} />
        <Row k="Поплавок" v={s.float ? 'всплыл — бак полон' : 'внизу'} warn={!!s.float} />
        <Row k="Сеть" v={`${Math.round(s.mains)} В`} warn={s.mains < 190 || s.mains > 250} />
      </Section>

      {demo && world && (
        <Section title="Демо: что происходит с пылесосом">
          <p className="hint">Это кнопки «мира» — как будто вы сами что-то сделали с пылесосом.</p>
          <div className="grid2">
            <button className={`btn ${world.hoseClosed ? 'on' : ''}`} onClick={() => demo.act('hose')}>
              {world.hoseClosed ? 'Открыть шланг' : 'Закрыть шланг ладонью'}
            </button>
            <button className={`btn ${world.tool ? 'on' : ''}`} onClick={() => demo.act('tool')}>
              {world.tool ? 'Выключить инструмент' : 'Включить инструмент'}
            </button>
            <button className="btn" onClick={() => demo.act('dust')}>
              Насыпать пыли ({world.dust} %)
            </button>
            <button className="btn" onClick={() => demo.act('clean')}>
              Фильтр чистый
            </button>
            <button className={`btn ${world.sucking ? 'on' : ''}`} onClick={() => demo.act('suck')}>
              {world.sucking ? 'Шланг из воды' : 'Сосать воду'} ({world.water} %)
            </button>
            <button className="btn" onClick={() => demo.act('drain')}>
              Слить бак
            </button>
          </div>
        </Section>
      )}
    </>
  );
}
