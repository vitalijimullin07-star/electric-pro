import { useMemo, useState } from 'react';
import { useEditor } from '@editor/store';
import { defaultFabProfile, dfmReportText, fabProfile, FAB_PROFILES, runDfm, type DfmIssue } from '@core/fab/dfm';
import { fabricationZip } from '@core/io/package';
import { safeName } from '@core/io/gerber';
import { Dialog } from './Dialog';
import { copyText, saveTextFile } from '../files';

const PREF_KEY = 'plata2:fab-profile';

function loadPref(): string | null {
  try {
    return localStorage.getItem(PREF_KEY);
  } catch {
    return null;
  }
}

function savePref(id: string): void {
  try {
    localStorage.setItem(PREF_KEY, id);
  } catch {
    /* без хранилища выбор просто не запомнится */
  }
}

const mm = (v: number) => String(+v.toFixed(3)).replace('.', ',');
const TAG = { error: ['err', '!'], warning: ['warn', '?'], info: ['ok', 'i'] } as const;

/** Проверка платы под возможности производства и параметры для формы заказа. */
export function DfmDialog() {
  const s = useEditor();
  const p = s.project;
  const [pid, setPid] = useState(() => {
    const saved = loadPref();
    return saved && FAB_PROFILES.some((f) => f.id === saved) ? saved : defaultFabProfile(p).id;
  });
  const profile = fabProfile(pid);
  const r = useMemo(() => runDfm(p, profile), [p, profile]);
  const base = safeName(p.meta.name);
  const infos = r.issues.length - r.errors - r.warnings;

  const goTo = (i: DfmIssue) => {
    const stage = document.querySelector('.stage') as HTMLElement | null;
    const w = stage?.clientWidth ?? 800;
    const h = stage?.clientHeight ?? 600;
    const scale = Math.max(s.view.scale, 30);
    const view = i.at ? { scale, x: i.at.x - w / scale / 2, y: i.at.y - h / scale / 2 } : s.view;
    s.closeDialog();
    s.patch({ view, selection: i.items.filter((x) => x.kind !== 'ruleArea' && x.kind !== 'zone'), message: i.message, panelOpen: window.innerWidth >= 900 });
  };
  const save = async (label: string, fn: () => Promise<boolean>) => {
    try {
      const ok = await fn();
      s.setMessage(ok === false ? `${label}: сохранение отменено.` : `${label}: готово.`);
    } catch (e) {
      s.setMessage(`${label}: ошибка — ${(e as Error).message}`);
    }
  };

  return (
    <Dialog
      title="Проверка для производства"
      size="wide"
      footer={
        <>
          <button className="btn" onClick={() => void save('Отчёт', () => saveTextFile(`${base}-DFM.txt`, dfmReportText(p, r), 'text/plain'))}>
            Сохранить отчёт
          </button>
          <button className="btn" onClick={() => void copyText(r.order.map((o) => `${o.label}: ${o.value}`).join('\n')).then((ok) => s.setMessage(ok ? 'Параметры заказа скопированы.' : 'Не удалось скопировать.'))}>
            Скопировать параметры
          </button>
          <button
            className="btn primary"
            onClick={() =>
              void save('Архив для завода', () => {
                const z = fabricationZip(p, profile);
                return saveTextFile(z.name, z.data, 'application/zip');
              })
            }
          >
            Скачать архив для завода
          </button>
        </>
      }
    >
      <div className="row">
        <label>
          Производство{' '}
          <select
            className="sel"
            value={pid}
            onChange={(e) => {
              setPid(e.target.value);
              savePref(e.target.value);
            }}
          >
            {FAB_PROFILES.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="hint">
        {profile.note} Дорожка от {mm(profile.track)} мм, зазор от {mm(profile.space)} мм, отверстие от {mm(profile.drill)} мм
        {profile.aspect ? ` и не меньше ${mm(profile.aspect)} толщины` : ''}, поясок от {mm(profile.ring)} мм, до края от {mm(profile.edge)} мм.{profile.home ? '' : ' Цены и сроки смотрите у завода.'}
      </p>
      <div className="row">
        <span className={`tag ${r.errors ? 'err' : 'ok'}`}>ошибок {r.errors}</span>
        <span className={`tag ${r.warnings ? 'warn' : 'ok'}`}>предупреждений {r.warnings}</span>
        <span className="tag ok">советов {infos}</span>
      </div>
      {!r.issues.length && <p className="hint">Замечаний нет: плата укладывается в возможности этого производства.</p>}
      <div className="list dfm-list">
        {r.issues.map((i) => (
          <button key={i.id} className="item" onClick={() => goTo(i)} disabled={!i.at && !i.items.length}>
            <span className={`tag ${TAG[i.severity][0]}`}>{TAG[i.severity][1]}</span>
            <span className="grow">
              <div>{i.message}</div>
              <div className="ds">
                {i.group}
                {i.at ? ` · ${mm(i.at.x)}; ${mm(i.at.y)} мм` : ''}
              </div>
            </span>
          </button>
        ))}
      </div>
      <h4>Параметры для заказа</h4>
      <table className="grid dfm-order">
        <tbody>
          {r.order.map((o) => (
            <tr key={o.label}>
              <th>{o.label}</th>
              <td>{o.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h4>Свёрла</h4>
      {r.drills.length ? (
        <table className="grid dfm-order">
          <tbody>
            {r.drills.map((d) => (
              <tr key={`${d.d}:${d.plated}`}>
                <th>
                  {mm(d.d)} мм{d.plated ? '' : ', без металлизации'}
                </th>
                <td>{d.count} шт.</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="hint">Отверстий нет.</p>
      )}
    </Dialog>
  );
}
