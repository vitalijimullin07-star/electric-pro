import { useMemo, useState } from 'react';
import { useEditor } from '@editor/store';
import { Dialog } from './Dialog';
import { FootprintPreview } from '../common/FootprintPreview';
import { LenInput, useUnits } from '../common/NumberInput';
import { MY_CATEGORY, autoGraphics, checkFootprint, dualRow, myFootprintId, padRow, quadRow, type PadStyle } from '@core/library/builder';
import { footprintIdTaken, saveUserFootprint } from '@editor/userlib';
import { changeFootprint } from '@editor/commands';
import type { FootprintDef, PadDef, PadShape, PadType } from '@core/model/types';

/*
 * Редактор своего корпуса: площадки таблицей и генератором рядов (ряд, DIP/SOIC,
 * QFP), контур корпуса строится сам по площадкам и размерам тела. Сохраняется
 * в «Мои корпуса»; можно сразу поставить на плату или применить к компоненту.
 */

export interface FootprintEditorData {
  base?: FootprintDef;
  /** Компонент, к которому можно применить результат. */
  componentId?: string;
}

const TYPES: { v: PadType; label: string }[] = [
  { v: 'smd', label: 'планарная' },
  { v: 'tht', label: 'выводная' },
  { v: 'npth', label: 'отверстие' },
];
const SHAPES: { v: PadShape; label: string }[] = [
  { v: 'rect', label: 'прямоуг.' },
  { v: 'roundrect', label: 'скругл.' },
  { v: 'circle', label: 'круг' },
  { v: 'oval', label: 'овал' },
];

type Pattern = 'row' | 'dual' | 'quad';

export function FootprintEditorDialog({ data }: { data: FootprintEditorData }) {
  const s = useEditor();
  const { label: U } = useUnits();
  const base = data.base;
  const own = base ? s.userFootprints.some((f) => f.id === base.id) : false;
  const [draft, setDraft] = useState<FootprintDef>(() =>
    base
      ? { ...structuredClone(base), name: own ? base.name : `${base.name} (моя)` }
      : { id: '', name: 'Новый корпус', description: '', category: MY_CATEGORY, group: 'Свои', refPrefix: 'U', pads: dualRow({ perSide: 4, pitch: 2.54, span: 7.62, style: { type: 'tht', shape: 'circle', size: { x: 1.6, y: 1.6 }, drill: 0.8 } }), graphics: [] },
  );
  const [regen, setRegen] = useState(!base);
  const [body, setBody] = useState({ w: 0, h: 0 });
  const [pattern, setPattern] = useState<Pattern>('dual');
  const [gen, setGen] = useState({ count: 4, pitch: 2.54, span: 7.62 });
  const [style, setStyle] = useState<PadStyle>({ type: 'tht', shape: 'circle', size: { x: 1.6, y: 1.6 }, drill: 0.8 });

  const auto = useMemo(() => autoGraphics(draft.pads, body), [draft.pads, body]);
  const result: FootprintDef = useMemo(
    () => ({ ...draft, graphics: regen || !draft.graphics.length ? auto.graphics : draft.graphics, courtyard: regen || !draft.courtyard ? auto.courtyard : draft.courtyard }),
    [draft, regen, auto],
  );
  const check = checkFootprint(result);

  const setPads = (pads: PadDef[]) => setDraft((d) => ({ ...d, pads }));
  const updPad = (i: number, fn: (p: PadDef) => PadDef) => setPads(draft.pads.map((p, k) => (k === i ? fn({ ...p }) : p)));
  const generate = (replace: boolean) => {
    const g =
      pattern === 'row'
        ? padRow({ count: gen.count, pitch: gen.pitch, dir: 'x', style })
        : pattern === 'dual'
          ? dualRow({ perSide: gen.count, pitch: gen.pitch, span: gen.span, style })
          : quadRow({ perSide: gen.count, pitch: gen.pitch, span: gen.span, style });
    if (replace) setPads(g);
    else {
      // Дописываем с продолжением нумерации.
      const max = Math.max(0, ...draft.pads.map((p) => parseInt(p.number, 10)).filter((n) => Number.isFinite(n)));
      setPads([...draft.pads, ...g.map((p, i) => ({ ...p, number: String(max + i + 1) }))]);
    }
    setRegen(true);
  };

  const finalDef = (): FootprintDef => {
    const id = own && base ? base.id : myFootprintId(draft.name, footprintIdTaken);
    return { ...result, id, category: MY_CATEGORY, group: draft.group?.trim() || 'Свои', verified: false, source: 'Свой корпус' };
  };
  const save = (then?: 'place' | 'apply') => {
    if (check.errors.length) return;
    const fp = finalDef();
    if (!saveUserFootprint(fp)) s.setMessage('Корпус сохранён только до перезагрузки: браузер не даёт хранить данные. Сохраните проект файлом.');
    // Если корпус уже стоит на плате, обновляем и его копию в проекте.
    if (s.project.footprints[fp.id]) s.commit((d) => void (d.footprints[fp.id] = fp));
    if (then === 'apply' && data.componentId) {
      const ok = changeFootprint(data.componentId, fp);
      s.setMessage(ok ? `Корпус «${fp.name}» сохранён и применён.` : 'Корпус сохранён, но не применён: не нашлось компонента.');
    } else if (then === 'place') {
      s.closeDialog();
      s.setTool('place');
      s.patch({ placeFootprint: fp.id, panelTab: 'library' });
      s.setMessage(`Корпус «${fp.name}» сохранён в «Мои корпуса». Щёлкните по плате, чтобы поставить.`);
      return;
    } else s.setMessage(`Корпус «${fp.name}» сохранён в «Мои корпуса».`);
    s.closeDialog();
  };
  const comp = data.componentId ? s.project.components[data.componentId] : null;

  return (
    <Dialog
      title={own ? `Корпус: ${base!.name}` : base ? `Свой корпус на основе ${base.name}` : 'Новый корпус'}
      size="wide"
      footer={
        <>
          <button className="btn" onClick={s.closeDialog}>
            Отмена
          </button>
          <button className="btn" disabled={!!check.errors.length} onClick={() => save()}>
            Сохранить в мои корпуса
          </button>
          {comp ? (
            <button className="btn primary" disabled={!!check.errors.length} onClick={() => save('apply')}>
              Сохранить и применить к {comp.ref}
            </button>
          ) : (
            <button className="btn primary" disabled={!!check.errors.length} onClick={() => save('place')}>
              Сохранить и поставить
            </button>
          )}
        </>
      }
    >
      <div className="two-col">
        <div>
          <FootprintPreview fp={result} />
          {check.errors.map((e) => (
            <p key={e} className="hint" style={{ color: 'var(--err)' }}>
              {e}
            </p>
          ))}
          {check.warnings.map((w) => (
            <p key={w} className="hint" style={{ color: 'var(--warn)' }}>
              {w}
            </p>
          ))}
          <div className="field">
            <label>Имя</label>
            <input className="inp" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
            <label>Описание</label>
            <input className="inp" value={draft.description ?? ''} onChange={(e) => setDraft({ ...draft, description: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
            <label>Подраздел</label>
            <input className="inp" value={draft.group ?? ''} placeholder="Свои" onChange={(e) => setDraft({ ...draft, group: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
            <label>Обозначение</label>
            <input className="inp" value={draft.refPrefix ?? ''} placeholder="U, R, J…" onChange={(e) => setDraft({ ...draft, refPrefix: e.target.value.replace(/[^A-Za-z]/g, '').toUpperCase() })} onKeyDown={(e) => e.stopPropagation()} />
            <label>Высота, {U}</label>
            <LenInput value={draft.height ?? 0} min={0} onChange={(v) => setDraft({ ...draft, height: v || undefined })} />
          </div>
          <h4>Контур</h4>
          <div className="field">
            <label>Корпус (тело), {U}</label>
            <span className="row" style={{ margin: 0, flexWrap: 'nowrap' }}>
              <LenInput value={body.w} min={0} onChange={(v) => (setBody({ ...body, w: v }), setRegen(true))} placeholder="ширина" />
              <LenInput value={body.h} min={0} onChange={(v) => (setBody({ ...body, h: v }), setRegen(true))} placeholder="высота" />
            </span>
            <label>Нарисовать заново</label>
            <label>
              <input type="checkbox" checked={regen} onChange={(e) => setRegen(e.target.checked)} /> контур, метка вывода 1, надписи
            </label>
          </div>
          <p className="hint">0 — по площадкам. Размеры тела и шаг берите из даташита: корпус помечается «размеры типовые», пока вы его не проверите.</p>
        </div>
        <div>
          <h4 style={{ marginTop: 0 }}>Генератор площадок</h4>
          <div className="field">
            <label>Расположение</label>
            <select className="sel" value={pattern} onChange={(e) => setPattern(e.target.value as Pattern)}>
              <option value="row">ряд (штыри, разъём)</option>
              <option value="dual">два ряда (DIP, SOIC)</option>
              <option value="quad">четыре стороны (QFP, QFN)</option>
            </select>
            <label>{pattern === 'row' ? 'Площадок' : 'На сторону'}</label>
            <input className="inp" type="number" min={1} max={200} value={gen.count} onChange={(e) => setGen({ ...gen, count: Math.max(1, Math.min(200, Math.round(+e.target.value || 1))) })} onKeyDown={(e) => e.stopPropagation()} />
            <label>Шаг, {U}</label>
            <LenInput value={gen.pitch} min={0.1} onChange={(v) => setGen({ ...gen, pitch: v })} />
            {pattern !== 'row' && (
              <>
                <label>Между рядами, {U}</label>
                <LenInput value={gen.span} min={0.1} onChange={(v) => setGen({ ...gen, span: v })} />
              </>
            )}
            <label>Площадка</label>
            <span className="row" style={{ margin: 0, flexWrap: 'nowrap' }}>
              <select className="sel" value={style.type} onChange={(e) => setStyle({ ...style, type: e.target.value as PadType, shape: e.target.value === 'smd' ? 'roundrect' : 'circle' })}>
                {TYPES.filter((t) => t.v !== 'npth').map((t) => (
                  <option key={t.v} value={t.v}>
                    {t.label}
                  </option>
                ))}
              </select>
              <select className="sel" value={style.shape} onChange={(e) => setStyle({ ...style, shape: e.target.value as PadShape })}>
                {SHAPES.map((t) => (
                  <option key={t.v} value={t.v}>
                    {t.label}
                  </option>
                ))}
              </select>
            </span>
            <label>Размер, {U}</label>
            <span className="row" style={{ margin: 0, flexWrap: 'nowrap' }}>
              <LenInput value={style.size.x} min={0.05} onChange={(v) => setStyle({ ...style, size: { ...style.size, x: v } })} />
              <LenInput value={style.size.y} min={0.05} onChange={(v) => setStyle({ ...style, size: { ...style.size, y: v } })} />
            </span>
            {style.type === 'tht' && (
              <>
                <label>Отверстие, {U}</label>
                <LenInput value={style.drill ?? 0.8} min={0.1} onChange={(v) => setStyle({ ...style, drill: v })} />
              </>
            )}
          </div>
          <div className="row">
            <button className="btn primary" onClick={() => generate(true)}>
              Заменить площадки
            </button>
            <button className="btn" onClick={() => generate(false)}>
              Добавить к имеющимся
            </button>
          </div>
          <h4>Площадки: {draft.pads.length}</h4>
          <div style={{ maxHeight: 320, overflow: 'auto' }}>
            <table className="grid pads">
              <thead>
                <tr>
                  <th>№</th>
                  <th>Тип</th>
                  <th>Форма</th>
                  <th>X</th>
                  <th>Y</th>
                  <th>Ш</th>
                  <th>В</th>
                  <th>Отв.</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {draft.pads.map((p, i) => (
                  <tr key={i}>
                    <td>
                      <input className="inp" value={p.number} disabled={p.type === 'npth'} onChange={(e) => updPad(i, (x) => ({ ...x, number: e.target.value }))} onKeyDown={(e) => e.stopPropagation()} />
                    </td>
                    <td>
                      <select className="sel" value={p.type} onChange={(e) => updPad(i, (x) => ({ ...x, type: e.target.value as PadType, drill: e.target.value === 'smd' ? undefined : (x.drill ?? 0.8), number: e.target.value === 'npth' ? '' : x.number }))}>
                        {TYPES.map((t) => (
                          <option key={t.v} value={t.v}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select className="sel" value={p.shape} onChange={(e) => updPad(i, (x) => ({ ...x, shape: e.target.value as PadShape }))}>
                        {SHAPES.map((t) => (
                          <option key={t.v} value={t.v}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <LenInput value={p.at.x} onChange={(v) => updPad(i, (x) => ({ ...x, at: { ...x.at, x: v } }))} />
                    </td>
                    <td>
                      <LenInput value={p.at.y} onChange={(v) => updPad(i, (x) => ({ ...x, at: { ...x.at, y: v } }))} />
                    </td>
                    <td>
                      <LenInput value={p.size.x} min={0.05} onChange={(v) => updPad(i, (x) => ({ ...x, size: { ...x.size, x: v } }))} />
                    </td>
                    <td>
                      <LenInput value={p.size.y} min={0.05} onChange={(v) => updPad(i, (x) => ({ ...x, size: { ...x.size, y: v } }))} />
                    </td>
                    <td>{p.type !== 'smd' ? <LenInput value={p.drill ?? 0} min={0.1} onChange={(v) => updPad(i, (x) => ({ ...x, drill: v }))} /> : null}</td>
                    <td>
                      <button className="btn" title="Удалить площадку" onClick={() => (setPads(draft.pads.filter((_, k) => k !== i)), setRegen(true))}>
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row">
            <button
              className="btn"
              onClick={() => {
                const last = draft.pads[draft.pads.length - 1];
                const max = Math.max(0, ...draft.pads.map((p) => parseInt(p.number, 10)).filter((n) => Number.isFinite(n)));
                const np: PadDef = last ? { ...structuredClone(last), number: String(max + 1), at: { x: last.at.x + gen.pitch, y: last.at.y } } : { number: '1', type: style.type, shape: style.shape, at: { x: 0, y: 0 }, size: { ...style.size }, drill: style.type === 'tht' ? style.drill : undefined };
                setPads([...draft.pads, np]);
                setRegen(true);
              }}
            >
              + площадка
            </button>
            <button className="btn" onClick={() => (setPads([...draft.pads, { number: '', type: 'npth', shape: 'circle', at: { x: 0, y: 0 }, size: { x: 3, y: 3 }, drill: 3 }]), setRegen(true))}>
              + крепёжное отверстие
            </button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
