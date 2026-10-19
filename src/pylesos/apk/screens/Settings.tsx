/* Настройки: очистка, клапаны, фильтр, розетка, уведомления и голос, связь, команда вручную. */
import { useState } from 'react';
import { FILTER_STATES, PRESETS, PRESET_HINTS, VERR, filterClean } from '../../protocol';
import type { Ctx } from '../ctx';
import { fmt } from '../history';
import { LINK_TEXT, native, nativeInfo } from '../native';
import { Card, Confirm, Icon, Param, Row, Seg, Toggle } from '../ui';

const ALERT_KEY = 'pylesos-apk-alerts';
export interface AlertPrefs {
  voice: number;
  alarm: boolean;
  vibrate: boolean;
}
export function loadAlerts(): AlertPrefs {
  try {
    return { voice: 2, alarm: true, vibrate: true, ...(JSON.parse(localStorage.getItem(ALERT_KEY) ?? '{}') as Partial<AlertPrefs>) };
  } catch {
    return { voice: 2, alarm: true, vibrate: true };
  }
}
export function pushAlerts(a: AlertPrefs): void {
  try {
    localStorage.setItem(ALERT_KEY, JSON.stringify(a));
  } catch {
    /* не запомнили */
  }
  native?.setAlerts(JSON.stringify(a));
}

export function Settings(c: Ctx) {
  const { s, send } = c;
  const [al, setAl] = useState(loadAlerts);
  const [line, setLine] = useState('');
  const setA = (p: Partial<AlertPrefs>) => {
    const n = { ...al, ...p };
    setAl(n);
    pushAlerts(n);
  };
  const plate = s.vk === 0;
  const valve = (k: 1 | 2) => {
    const err = k === 1 ? s.v1 : s.v2;
    const open = k === 1 ? s.vo1 : s.vo2;
    return err ? VERR[err] || 'неисправен' : open ? 'удар' : plate ? (s.hold ? 'магнит держит' : 'без тока') : 'закрыт';
  };
  const ab = s.filt ? 'Б' : 'А';
  const other = s.filt ? 'А' : 'Б';
  const clean = filterClean(s);
  const info = nativeInfo();
  return (
    <div className="screen">
      <header className="bar">
        <h1 className="grow">Настройки</h1>
        <button type="button" className="pill" onClick={() => c.open('all')}>
          Все параметры {Icon.next}
        </button>
      </header>
      <div className="grid2">
        <button type="button" className="tilebtn" onClick={() => c.open('update')}>
          {Icon.download} Прошивка
        </button>
        <button type="button" className="tilebtn" onClick={() => c.open('strikes')}>
          {Icon.bolt} Удары
        </button>
      </div>

      <Card title="Режим очистки">
        <div className="chips">
          {PRESETS.map((name, i) => (
            <button key={name} type="button" className={`chip ${s.preset === i ? 'on' : ''}`} onClick={() => send(`preset ${i}`)}>
              {name}
            </button>
          ))}
        </div>
        <p className="small muted">{PRESET_HINTS[s.preset] ?? ''}</p>
        <Param label="Ударов в серии" value={s.pn} min={0} max={10} step={1} zero="сам" onSet={(v) => send(`set n ${v}`)} />
        <Param label="Серия каждые" value={s.pe} min={0} max={600} step={5} unit="с" zero="по фильтру" onSet={(v) => send(`set every ${v}`)} />
        <Param label="Длина удара" hint={plate ? 'магнит без тока' : 'катушка под током'} value={s.pi} min={0} max={300} step={5} unit="мс" zero="сам" onSet={(v) => send(`set imp ${v}`)} />
        <Param label="Пауза между ударами" value={s.pp} min={0} max={3000} step={100} unit="мс" zero="авто" onSet={(v) => send(`set pause ${v}`)} />
      </Card>

      <Card title="Когда чистить">
        <Toggle label="Очищать по режиму" hint="иначе — только кнопкой" on={!!s.clean} onChange={(on) => send(`clean ${on ? 'a' : 'o'}`)} />
        <Toggle label="Удары при остановке" on={!!s.coff} onChange={(on) => send(`coff ${on ? 1 : 0}`)} />
        <Toggle label="Мощная по закрытому шлангу" on={!!s.hauto} onChange={(on) => send(`hauto ${on ? 1 : 0}`)} />
        <Param label="Порог перепада на фильтре" hint={`при расходе ${fmt(s.sp)} л/с`} value={s.dpon} min={0} max={600} step={10} unit="Па" zero="авто" onSet={(v) => send(`set dp ${v && v < 20 ? 20 : v}`)} />
        {!s.dpon && <Param label="Серия, когда R вырос на" value={s.thr - 100} min={5} max={100} step={5} unit="%" onSet={(v) => send(`set thr ${v + 100}`)} />}
        <Param label="Ударов мощной очистки" value={s.strong} min={1} max={10} step={1} onSet={(v) => send(`set strong ${v}`)} />
      </Card>

      <Card title="Клапаны">
        <Seg items={[[1, 'Тарельчатые (магнит)'], [0, 'Импульсные']]} value={plate ? 1 : 0} onPick={(v) => send(v ? 'set valves plate' : 'set valves pulse')} small />
        <Row k="Клапан 1" v={valve(1)} warn={!!s.v1} />
        <Row k="Клапан 2" v={valve(2)} warn={!!s.v2} />
        <Row k="Сила удара" v={`${fmt(s.intake)} %`} warn={s.intake < 70} />
        <Row k="Ударов всего" v={fmt(s.pulses)} />
        {plate && <Param label="Сброс турбин на время удара" hint="больше воздуха через фильтр в бак" value={s.dip} min={0} max={90} step={5} unit="%" def={70} zero="нет" onSet={(v) => send(`set dip ${v}`)} />}
        <Confirm className="btn wide ghost" onClick={() => send('intake new')}>
          Поставил новый фильтр клапанов
        </Confirm>
      </Card>

      <Card title={`Фильтр ${ab}`}>
        <Row k="Чистота" v={clean === null ? 'нужен замер нового' : `${clean} % (100 — как новый)`} warn={clean !== null && clean < 50} />
        <Row k="Перепад сейчас" v={`${fmt(s.filter)} Па`} />
        <Row k="Сопротивление R" v={s.r ? fmt(s.r, 2) : '—'} />
        <Row k="R нового" v={s.rnew ? fmt(s.rnew, 2) : 'не мерили'} />
        <Row k="Поставлен" v={FILTER_STATES[s.fst] ?? '—'} />
        <Row k="Моек · наработка" v={`${s.washes} · ${fmt(s.fwork, 1)} ч`} />
        <div className="grid2">
          <Confirm onClick={() => send(`filter ${s.filt ? 'б' : 'а'} new`)}>Новый {ab}</Confirm>
          <Confirm onClick={() => send(`filter ${s.filt ? 'б' : 'а'} washed`)}>Отмытый {ab}</Confirm>
          <Confirm onClick={() => send(`filter ${s.filt ? 'б' : 'а'} blown`)}>Продутый {ab}</Confirm>
          <Confirm onClick={() => send(`filter ${s.filt ? 'а' : 'б'} use`)}>Сейчас стоит {other}</Confirm>
        </div>
        <Toggle label="Мешок в баке" on={!!s.bag} onChange={(on) => send(`bag ${on ? 1 : 0}`)} />
      </Card>

      <Card title="Розетка и инструмент">
        <Toggle label="Автозапуск от инструмента" hint="турбины — когда инструмент берёт ток" on={!!s.tauto} onChange={(on) => send(`tool auto ${on ? 1 : 0}`)} />
        <Param label="Порог тока инструмента" value={s.tthr} min={0.1} max={5} step={0.1} dec={1} unit="А" onSet={(v) => send(`tool thr ${Math.round(v * 10)}`)} />
        <Param label="Выбег после инструмента" value={s.runon} min={0} max={30} step={1} unit="с" onSet={(v) => send(`tool runon ${v}`)} />
        <Param label="Ударов после инструмента" value={s.tend} min={0} max={10} step={1} onSet={(v) => send(`tool end ${v}`)} />
        <Param label="Предел общего тока" hint="автомат на линии" value={s.limit} min={10} max={32} step={1} unit="А" onSet={(v) => send(`tool limit ${v}`)} />
        <Toggle label="Розетка без пылесоса" on={!!s.sfree} onChange={(on) => send(`tool free ${on ? 1 : 0}`)} />
        <Toggle label="Вторая турбина помогает в авто" on={!!s.t2a} onChange={(on) => send(`t2allow ${on ? 1 : 0}`)} />
      </Card>

      <Card title="Уведомления и голос">
        <p className="small muted">Сообщения всплывают и звучат, даже когда приложение закрыто. Голос — тот же, что у пылесоса.</p>
        <Seg items={[[0, 'Молча'], [1, 'Аварии'], [2, '+ предупр.'], [3, 'Всё']]} value={al.voice} onPick={(v) => setA({ voice: v })} small />
        <Toggle label="Аварии громкостью будильника" hint="слышно и в беззвучном режиме" on={al.alarm} onChange={(on) => setA({ alarm: on })} />
        <Toggle label="Вибрация" on={al.vibrate} onChange={(on) => setA({ vibrate: on })} />
        <div className="grid2">
          <button type="button" className="btn" onClick={() => (native ? native.voice(3) : undefined)}>
            Проверить голос
          </button>
          <button type="button" className="btn" onClick={() => native?.openNotifySettings()} disabled={!native}>
            Настройки Android
          </button>
        </div>
      </Card>

      <Card title="Связь">
        <Row k="Сейчас" v={c.mode === 'demo' ? 'демо в телефоне' : LINK_TEXT[c.linkState] ?? c.linkState} warn={c.mode === 'device' && c.linkState !== 'on'} />
        {c.mode === 'device' && <Row k="Пылесос" v={c.linkName || info?.name || '—'} />}
        <Row k="Прошивка пылесоса" v={s.ver || '—'} />
        {info && <Row k="Приложение" v={info.app} />}
        {c.mode === 'device' ? (
          <div className="grid2">
            <Confirm onClick={() => native?.forget()}>Забыть пылесос</Confirm>
            <button type="button" className="btn" onClick={() => c.setMode('demo')}>
              Демо
            </button>
          </div>
        ) : (
          <button type="button" className="btn wide go" onClick={() => c.setMode('device')}>
            Подключить свой пылесос
          </button>
        )}
      </Card>

      <Card title="Команда вручную">
        <form
          className="cmd"
          onSubmit={(e) => {
            e.preventDefault();
            if (line.trim()) send(line.trim());
            setLine('');
          }}
        >
          <input value={line} onChange={(e) => setLine(e.target.value)} placeholder="help, status, set …" autoCapitalize="off" autoCorrect="off" aria-label="Команда" />
          <button type="submit" className="btn">
            Отправить
          </button>
        </form>
        <p className="small muted">Ответ — в журнале.</p>
      </Card>

      <Confirm className="btn wide ghost" onClick={() => send('off')}>
        Выключить пылесос
      </Confirm>
    </div>
  );
}

/** Все поля состояния как есть — для анализа (с поиском). */
export function AllParams(c: Ctx) {
  const [q, setQ] = useState('');
  const entries = Object.entries(c.s as unknown as Record<string, unknown>).filter(([k]) => !q || k.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="screen">
      <header className="bar">
        <button type="button" className="iconbtn" aria-label="Назад" onClick={() => c.open(null)}>
          {Icon.back}
        </button>
        <h1 className="grow">Все параметры</h1>
      </header>
      <label className="search">
        {Icon.search}
        <span className="sr">Поиск параметра</span>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Имя поля: vacuum, r, t1…" />
      </label>
      <section className="card mono small">
        {entries.map(([k, v]) => (
          <div key={k} className="row">
            <span className="muted">{k}</span>
            <span>{typeof v === 'number' ? fmt(v, Number.isInteger(v) ? 0 : 2) : String(v)}</span>
          </div>
        ))}
      </section>
    </div>
  );
}
