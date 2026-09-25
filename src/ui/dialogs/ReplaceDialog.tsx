import { useMemo, useState } from 'react';
import { useEditor } from '@editor/store';
import { libraryFootprints, searchFootprints } from '@core/library';
import { pinKey, refPrefix, replaceFootprints, replaceGroups, replacementCandidates } from '@core/model/replace';
import type { Id } from '@core/model/types';
import { Dialog } from './Dialog';
import { FootprintPreview } from '../common/FootprintPreview';

export interface ReplaceData {
  /** Сразу открыть группу деталей с этим корпусом. */
  footprint?: string;
  /** Сразу выбрать новый корпус (из библиотеки): откроются подходящие ему детали. */
  target?: string;
}

/** Массовая замена корпусов: по типу деталей или по текущему корпусу, все или выборочно. */
export function ReplaceDialog({ data }: { data: ReplaceData }) {
  const s = useEditor();
  const p = s.project;
  const groups = useMemo(() => replaceGroups(p), [p]);
  const all = [...groups.byType, ...groups.byFootprint];
  const lib = useMemo(() => [...s.userFootprints, ...libraryFootprints().filter((f) => !s.userFootprints.some((u) => u.id === f.id))], [s.userFootprints]);
  // Открыли из библиотеки с новым корпусом: группа по типу, где есть детали с такими же выводами.
  const want = data.target ? lib.find((f) => f.id === data.target) : undefined;
  const fits = (id: Id) => {
    const fp = p.footprints[p.components[id]?.footprint ?? ''];
    return !!want && !!fp && fp.id !== want.id && pinKey(fp) === pinKey(want);
  };
  const [groupId, setGroupId] = useState(() => {
    if (want) return groups.byType.find((g) => g.components.some((c) => fits(c.id)))?.id ?? groups.byType[0]?.id ?? '';
    return data.footprint && groups.byFootprint.some((g) => g.id === 'fp:' + data.footprint) ? 'fp:' + data.footprint : (groups.byType[0]?.id ?? '');
  });
  const group = all.find((g) => g.id === groupId) ?? all[0];
  const [checked, setChecked] = useState<Set<Id>>(() => new Set(group?.components.filter((c) => !want || fits(c.id)).map((c) => c.id) ?? []));
  const [query, setQuery] = useState('');
  const [target, setTarget] = useState<string | null>(want?.id ?? null);

  const pick = (id: string) => {
    setGroupId(id);
    const g = all.find((x) => x.id === id);
    setChecked(new Set(g?.components.map((c) => c.id) ?? []));
    setTarget(null);
  };
  const ids = (group?.components ?? []).filter((c) => checked.has(c.id)).map((c) => c.id);
  const { key, candidates } = replacementCandidates(p, ids, lib);
  const shown = query.trim() ? searchFootprints(query, candidates) : candidates;
  const current = new Set(ids.map((id) => p.components[id]?.footprint));
  const targetFp = target && candidates.some((f) => f.id === target) ? lib.find((f) => f.id === target) : undefined;
  const threePin = key?.split('|').length === 3 && ids.some((id) => ['Q', 'VT', 'U', 'DA'].includes(refPrefix(p.components[id]?.ref ?? '')));

  const apply = () => {
    if (!targetFp || !ids.length) return;
    let res: ReturnType<typeof replaceFootprints> = { changed: [], failed: [], same: [] };
    s.commit((d) => void (res = replaceFootprints(d, ids, targetFp)));
    const refs = (xs: Id[]) => xs.map((id) => p.components[id]?.ref).join(', ');
    s.closeDialog();
    s.setMessage(
      `Корпус «${targetFp.name}» у деталей: ${res.changed.length}.` +
        (res.failed.length ? ` Не заменены (цепи на выводах, которых нет в новом корпусе): ${refs(res.failed)}.` : '') +
        (res.same.length ? ` Уже в этом корпусе: ${res.same.length}.` : '') +
        (threePin ? ' Проверьте цоколёвку: у разных корпусов порядок выводов может отличаться.' : ''),
    );
  };

  return (
    <Dialog
      title="Замена корпусов"
      size="wide"
      footer={
        <>
          <button className="btn" onClick={s.closeDialog}>
            Отмена
          </button>
          <button className="btn primary" disabled={!targetFp || !ids.length} onClick={apply}>
            Заменить у {ids.length} {ids.length === 1 ? 'детали' : 'деталей'}
          </button>
        </>
      }
    >
      {!all.length ? (
        <p className="hint">На плате нет деталей.</p>
      ) : (
        <div className="two-col">
          <div>
            <div className="field">
              <label>Какие детали</label>
              <select className="sel" value={group?.id} onChange={(e) => pick(e.target.value)}>
                <optgroup label="По типу">
                  {groups.byType.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.label} — {g.components.length}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="По корпусу">
                  {groups.byFootprint.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.label} — {g.components.length}
                    </option>
                  ))}
                </optgroup>
              </select>
            </div>
            <div className="row">
              <button className="btn" onClick={() => setChecked(new Set(group?.components.map((c) => c.id)))}>
                Все
              </button>
              <button className="btn" onClick={() => setChecked(new Set())}>
                Ни одной
              </button>
            </div>
            <div className="list replace-list">
              {group?.components.map((c) => (
                <label key={c.id} className="item">
                  <input
                    type="checkbox"
                    checked={checked.has(c.id)}
                    onChange={() =>
                      setChecked((xs) => {
                        const n = new Set(xs);
                        if (n.has(c.id)) n.delete(c.id);
                        else n.add(c.id);
                        return n;
                      })
                    }
                  />
                  <span className="grow">
                    <span className="nm">{c.ref}</span> {c.value}
                    <div className="ds">{p.footprints[c.footprint]?.name ?? c.footprint}</div>
                  </span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <h4 style={{ marginTop: 0 }}>Новый корпус</h4>
            {!ids.length ? (
              <p className="hint">Отметьте детали слева.</p>
            ) : key === null ? (
              <p className="hint">У отмеченных деталей разные наборы выводов: заменить разом нельзя. Выберите группу «По корпусу» или отметьте детали с одинаковыми выводами.</p>
            ) : (
              <>
                <input className="inp" placeholder="Поиск среди подходящих" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
                <p className="hint">Подходят корпуса с теми же выводами ({key.replace(/\|/g, ', ')}): {candidates.length}.</p>
                <div className="list replace-list">
                  {shown.slice(0, 80).map((f) => (
                    <button key={f.id} className={`item${target === f.id ? ' on' : ''}`} onClick={() => setTarget(f.id)}>
                      <span className="grow">
                        <span className="nm">{f.name}</span>
                        {current.has(f.id) && <span className="tag ok">сейчас</span>}
                        <div className="ds">{f.description}</div>
                      </span>
                    </button>
                  ))}
                </div>
                {targetFp && <FootprintPreview fp={targetFp} />}
                {threePin && <p className="hint">У транзисторов и стабилизаторов в разных корпусах порядок выводов бывает разным — сверьте с даташитом.</p>}
              </>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}
