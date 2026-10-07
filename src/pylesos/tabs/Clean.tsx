import type { Ctx } from '../App';
import { PRESETS, PRESET_HINTS, VERR } from '../protocol';
import { Row, Section, Stepper, Toggle } from '../ui';

export function CleanTab({ s, send }: Ctx) {
  const plate = s.vk === 0;
  const valve = (k: 1 | 2) => {
    const err = k === 1 ? s.v1 : s.v2;
    const open = k === 1 ? s.vo1 : s.vo2;
    return err ? VERR[err] || 'неисправен' : open ? 'удар' : plate ? (s.hold ? 'магнит держит' : 'без тока') : 'закрыт';
  };
  return (
    <>
      <div className="pair">
        <button className="btn big primary" onClick={() => send('purge')} disabled={!!s.purging}>
          Продуть сейчас
        </button>
        <button className="btn big" onClick={() => send('purge strong')} disabled={!!s.purging}>
          Мощная очистка
        </button>
      </div>
      <p className="hint">Мощная: закройте шланг ладонью — удары полным разрежением бака. Сама включается, если шланг закрыт 2 с.</p>

      <Section title="Режим очистки">
        <div className="presets">
          {PRESETS.map((name, i) => (
            <button key={name} className={`preset ${s.preset === i ? 'on' : ''}`} onClick={() => send(`preset ${i}`)}>
              <b>{name}</b>
              <small>{PRESET_HINTS[i]}</small>
            </button>
          ))}
        </div>
      </Section>

      <Section title={`Удары в режиме «${PRESETS[s.preset] ?? ''}»`}>
        <p className="hint">0 — подбирает сам. Сейчас: {s.n || 'авто'} уд., {s.imp} мс, через {s.every || 'авто'} с.</p>
        <Stepper label="Ударов в серии" value={s.pn} min={0} max={10} step={1} zero="сам" onSet={(v) => send(`set n ${v}`)} />
        <Stepper label="Серия каждые" value={s.pe} min={0} max={600} step={5} unit="с" zero="по фильтру" onSet={(v) => send(`set every ${v}`)} />
        <Stepper label="Длина удара" hint={plate ? 'магнит без тока' : 'катушка под током'} value={s.pi} min={0} max={300} step={10} unit="мс" zero="сам" onSet={(v) => send(`set imp ${v}`)} />
        <Stepper label="Пауза между ударами" value={s.pp} min={0} max={3000} step={100} unit="мс" zero="авто" onSet={(v) => send(`set pause ${v}`)} />
      </Section>

      <Section title="Когда чистить">
        <Toggle label="Очищать по режиму" hint="иначе — только кнопкой" on={!!s.clean} onChange={(on) => send(`clean ${on ? 'a' : 'o'}`)} />
        <Toggle label="Удары при остановке" on={!!s.coff} onChange={(on) => send(`coff ${on ? 1 : 0}`)} />
        <Toggle label="Мощная по закрытому шлангу" on={!!s.hauto} onChange={(on) => send(`hauto ${on ? 1 : 0}`)} />
        <Stepper
          label="Порог перепада на фильтре"
          hint={`Па при расходе ${s.sp} л/с`}
          value={s.dpon}
          min={0}
          max={600}
          step={10}
          unit="Па"
          zero="авто"
          onSet={(v) => send(`set dp ${v && v < 20 ? 20 : v}`)}
        />
        {!s.dpon && <Stepper label="Серия, когда сопротивление выросло на" value={s.thr - 100} min={5} max={100} step={5} unit="%" onSet={(v) => send(`set thr ${v + 100}`)} />}
        <Stepper label="Ударов мощной очистки" value={s.strong} min={1} max={10} step={1} onSet={(v) => send(`set strong ${v}`)} />
      </Section>

      <Section title="Клапаны">
        <Row k="Клапан 1" v={valve(1)} warn={!!s.v1} />
        <Row k="Клапан 2" v={valve(2)} warn={!!s.v2} />
        <Row k="Сила удара" v={`${Math.round(s.intake)} %`} warn={s.intake < 70} />
        <Row k="Ударов всего" v={Math.round(s.pulses).toLocaleString('ru')} />
        {plate && <Stepper label="Сброс турбин на время удара" hint="больше воздуха через фильтр в бак" value={s.dip} min={0} max={90} step={10} unit="%" zero="нет" onSet={(v) => send(`set dip ${v}`)} />}
        <div className="seg">
          <button className={plate ? 'on' : ''} onClick={() => !plate && send('set valves plate')}>
            Тарельчатые (магнит)
          </button>
          <button className={!plate ? 'on' : ''} onClick={() => plate && send('set valves pulse')}>
            Импульсные
          </button>
        </div>
        <button className="link" onClick={() => send('intake new')}>
          Поменял фильтр клапанов
        </button>
      </Section>
    </>
  );
}
