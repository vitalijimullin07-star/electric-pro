import type { Ctx } from '../App';
import { FILTER_STATES, filterClean } from '../protocol';
import { Confirm, Row, Section, Toggle } from '../ui';

export function FilterTab({ s, send }: Ctx) {
  const ab = s.filt ? 'Б' : 'А';
  const other = s.filt ? 'А' : 'Б';
  const clean = filterClean(s);
  return (
    <>
      <Section title={`Фильтр ${ab}`}>
        <div className="big-num">
          {clean === null ? '—' : `${clean} %`}
          <small>{clean === null ? 'нужен замер нового фильтра' : 'чистоты (100 — как новый)'}</small>
        </div>
        <div className="g-bar wide">
          <i style={{ width: `${clean ?? 0}%`, background: clean !== null && clean < 50 ? 'var(--bad)' : undefined }} />
        </div>
        <Row k="Перепад сейчас" v={`${Math.round(s.filter)} Па`} />
        <Row k="Сопротивление R" v={s.r ? s.r.toLocaleString('ru', { maximumFractionDigits: 1 }) : '—'} />
        <Row k="R нового" v={s.rnew ? s.rnew.toLocaleString('ru', { maximumFractionDigits: 1 }) : 'не мерили'} />
        <Row k="R после установки" v={s.rbase ? s.rbase.toLocaleString('ru', { maximumFractionDigits: 1 }) : '—'} />
        <Row k="Поставлен" v={FILTER_STATES[s.fst] ?? '—'} />
        <Row k="Моек" v={s.washes} />
        <Row k="Наработка" v={`${s.fwork.toLocaleString('ru', { maximumFractionDigits: 1 })} ч`} />
        <Row k="Ударов по нему" v={Math.round(s.fpulses).toLocaleString('ru')} />
      </Section>

      <Section title="Поставил фильтр">
        <p className="hint">Турбины прогонят воздух 10–20 с и запишут сопротивление в паспорт фильтра.</p>
        <div className="grid2">
          <Confirm onClick={() => send(`filter ${s.filt ? 'б' : 'а'} new`)}>Новый {ab}</Confirm>
          <Confirm onClick={() => send(`filter ${s.filt ? 'б' : 'а'} washed`)}>Отмытый {ab}</Confirm>
          <Confirm onClick={() => send(`filter ${s.filt ? 'б' : 'а'} blown`)}>Продутый {ab}</Confirm>
          <Confirm onClick={() => send(`filter ${s.filt ? 'а' : 'б'} use`)}>Сейчас стоит {other}</Confirm>
        </div>
      </Section>

      <Section title="Мешок в баке">
        <Toggle label="Мешок стоит" on={!!s.bag} onChange={(on) => send(`bag ${on ? 1 : 0}`)} />
        {!!s.bag && (
          <Confirm className="btn" onClick={() => send('bag new')}>
            Поставил новый мешок
          </Confirm>
        )}
      </Section>
    </>
  );
}
