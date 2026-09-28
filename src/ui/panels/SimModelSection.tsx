import { useEffect, useState } from 'react';
import { useEditor } from '@editor/store';
import { simRuntime } from '@editor/sim-runtime';
import { detectKind, fmtSi, KIND_INFO, kindChoices, type SimKind } from '@core/sim';

/*
 * «Модель для симуляции» в свойствах детали: какая модель выбрана автоматически (по
 * названию и выводам), ручной выбор вида (клеммник — «источник питания 12 В» или
 * «двигатель», транзистор без имён выводов — «MOSFET N») и параметры модели. Параметры
 * пишутся в Component.sim.params; пустое поле — «по названию детали».
 */

const PREFIX: Record<string, number> = { п: 1e-12, p: 1e-12, н: 1e-9, n: 1e-9, мк: 1e-6, u: 1e-6, µ: 1e-6, м: 1e-3, m: 1e-3, к: 1e3, k: 1e3, М: 1e6, M: 1e6, Г: 1e9, G: 1e9 };

/** «100н», «4,7 к», «2.2u», «10 м», «1e-6» → число; null — не число. */
export function parseSi(text: string): number | null {
  const t = text.trim().replace(',', '.');
  if (!t) return null;
  const m = /^(-?\d+(?:\.\d+)?(?:e-?\d+)?)\s*(мк|[пpнnuµмmкkМMГG])?/.exec(t);
  if (!m) return null;
  return parseFloat(m[1]) * (m[2] ? PREFIX[m[2]] : 1);
}

/** Число в запись с приставкой (без единицы): 1e-7 → «100 н». */
export function fmtPlain(v: number): string {
  return fmtSi(v, '').trim();
}

function ParamInput({ value, placeholder, onChange }: { value: number | undefined; placeholder: string; onChange: (v: number | null) => void }) {
  const [text, setText] = useState(value === undefined ? '' : fmtPlain(value));
  useEffect(() => setText(value === undefined ? '' : fmtPlain(value)), [value]);
  const done = () => {
    const v = parseSi(text);
    if (text.trim() === '') onChange(null);
    else if (v !== null && isFinite(v)) onChange(v);
    else setText(value === undefined ? '' : fmtPlain(value));
  };
  return <input className="inp" value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)} onBlur={done} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />;
}

export function SimModelSection({ id }: { id: string }) {
  const s = useEditor();
  const c = s.project.components[id];
  const fp = c ? s.project.footprints[c.footprint] : undefined;
  if (!c || !fp) return null;
  const auto = detectKind({ ...c, sim: undefined }, fp);
  const manual = c.sim?.model as SimKind | undefined;
  const kind = manual ?? auto;
  const info = kind ? KIND_INFO[kind] : null;
  const params = c.sim?.params ?? {};
  // Текущие значения из идущей симуляции — подсказкой в пустых полях.
  const live = simRuntime.sim?.analog?.partOf.get(id);
  const liveVal = (key: string) => live?.params.find((q) => q.key === key)?.value;
  const upd = (fn: (sim: NonNullable<typeof c.sim>) => void) =>
    s.commit((d) => {
      const x = d.components[id];
      if (!x) return;
      const sim: NonNullable<typeof c.sim> = { ...(x.sim ?? {}), params: { ...(x.sim?.params ?? {}) } };
      fn(sim);
      const params = sim.params && Object.keys(sim.params).length ? sim.params : undefined;
      x.sim = sim.model || params ? { model: sim.model, params } : undefined;
    });
  return (
    <div className="sim-model">
      <h4>Модель для симуляции</h4>
      <div className="field">
        <label>Модель</label>
        <select
          className="sel"
          value={manual ?? ''}
          onChange={(e) =>
            upd((sim) => {
              sim.model = e.target.value || undefined;
              // Смена вида — параметры прежнего вида не подходят.
              sim.params = {};
            })
          }
        >
          <option value="">авто: {auto ? KIND_INFO[auto].label : 'нет модели'}</option>
          {kindChoices().map((g) => (
            <optgroup key={g.group} label={g.group}>
              {g.kinds.map((k) => (
                <option key={k.kind} value={k.kind}>
                  {k.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {info?.params.map((q) => (
          <ParamRow key={q.key} label={q.label} unit={q.unit}>
            <ParamInput
              value={params[q.key]}
              placeholder={liveVal(q.key) !== undefined ? `сейчас ${fmtPlain(liveVal(q.key)!)}` : 'по названию'}
              onChange={(v) =>
                upd((sim) => {
                  if (v === null) delete sim.params![q.key];
                  else sim.params![q.key] = v;
                })
              }
            />
          </ParamRow>
        ))}
      </div>
      {info?.pins && <p className="hint">Выводы: {info.pins}.</p>}
      {!kind && <p className="hint">Эта деталь в аналоговом расчёте не участвует. Если это клеммник питания, нагрузка или двигатель — выберите модель вручную.</p>}
      {manual === 'none' && <p className="hint">Деталь исключена из расчёта (как будто её нет).</p>}
      {Object.keys(params).length > 0 && <p className="hint">Заданные параметры действуют со следующего запуска («Сброс»); на ходу — ползунками на вкладке «Симуляция → Цепь».</p>}
    </div>
  );
}

function ParamRow({ label, unit, children }: { label: string; unit: string; children: React.ReactNode }) {
  return (
    <>
      <label>
        {label}
        {unit ? `, ${unit}` : ''}
      </label>
      {children}
    </>
  );
}
