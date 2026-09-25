import { useState } from 'react';
import { useEditor } from '@editor/store';
import { Dialog } from './Dialog';
import { askText } from './AskDialog';
import { LenInput, TextInput, useUnits } from '../common/NumberInput';
import { rectOutline, rectSize } from '@core/model/project';
import { MAINS_CLASS, MAINS_CLEARANCE, RULE_PRESETS, defaultNetClasses } from '@core/model/rules';
import type { DesignRules, NetClass } from '@core/model/types';

const RULE_FIELDS: { k: keyof DesignRules; label: string }[] = [
  { k: 'minClearance', label: 'Мин. зазор медь–медь' },
  { k: 'minTrackWidth', label: 'Мин. ширина дорожки' },
  { k: 'minViaDiameter', label: 'Мин. диаметр переходного' },
  { k: 'minViaDrill', label: 'Мин. отверстие переходного' },
  { k: 'minDrill', label: 'Мин. отверстие вообще' },
  { k: 'minAnnularRing', label: 'Мин. кольцо вокруг отверстия' },
  { k: 'edgeClearance', label: 'Зазор до края платы' },
  { k: 'holeToHole', label: 'Между отверстиями' },
  { k: 'maskMargin', label: 'Отступ маски' },
];

export function BoardDialog() {
  const s = useEditor();
  const p = s.project;
  const rs = rectSize(p.board.outline);
  const [tab, setTab] = useState<'board' | 'rules' | 'classes'>('board');
  const { label: U } = useUnits();

  const setRule = (k: keyof DesignRules, v: number) => s.commit((d) => void ((d.rules as unknown as Record<string, number>)[k] = v));
  const setClass = (name: string, fn: (c: NetClass) => void) => s.commit((d) => void (d.netClasses[name] && fn(d.netClasses[name])));

  return (
    <Dialog title="Плата, правила и классы цепей" size="wide">
      <div className="tabs" style={{ display: 'flex', borderBottom: '1px solid var(--line)', marginBottom: 12 }}>
        {(
          [
            ['board', 'Плата'],
            ['rules', 'Правила'],
            ['classes', 'Классы цепей'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} className="btn" style={{ border: 0, borderBottom: tab === id ? '2px solid var(--accent)' : '2px solid transparent', borderRadius: 0, background: 'transparent' }} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'board' && (
        <>
          <div className="field">
            <label>Название</label>
            <TextInput value={p.meta.name} onChange={(v) => s.commit((d) => void (d.meta.name = v || 'Плата'))} />
            <label>Описание</label>
            <TextInput value={p.meta.description ?? ''} onChange={(v) => s.commit((d) => void (d.meta.description = v || undefined))} />
            <label>Ширина, {U}</label>
            <LenInput
              value={rs ? rs.w : 0}
              min={5}
              disabled={!rs}
              onChange={(v) => s.commit((d) => void (d.board.outline = rectOutline(v, rs!.h, rs!.x, rs!.y)))}
            />
            <label>Высота, {U}</label>
            <LenInput
              value={rs ? rs.h : 0}
              min={5}
              disabled={!rs}
              onChange={(v) => s.commit((d) => void (d.board.outline = rectOutline(rs!.w, v, rs!.x, rs!.y)))}
            />
            <label>Скругление углов</label>
            <LenInput value={p.board.cornerRadius} min={0} onChange={(v) => s.commit((d) => void (d.board.cornerRadius = v))} />
            <label>Толщина, {U}</label>
            <LenInput value={p.board.thickness} min={0.2} onChange={(v) => s.commit((d) => void (d.board.thickness = v))} />
            <label>Слоёв меди</label>
            <select
              className="sel"
              value={p.board.copperLayers}
              onChange={(e) => {
                const n = +e.target.value as 1 | 2;
                s.commit((d) => {
                  d.board.copperLayers = n;
                  if (n === 1) for (const t of Object.values(d.tracks)) t.layer = 'B.Cu';
                });
                s.patch({ activeLayer: n === 1 ? 'B.Cu' : s.activeLayer });
                if (n === 1) {
                  // Планарные детали сверху на односторонней плате не достанут до меди.
                  const top = Object.values(useEditor.getState().project.components).filter((c) => {
                    const f = useEditor.getState().project.footprints[c.footprint];
                    return c.side === 'top' && f && f.pads.some((pd) => pd.type === 'smd');
                  });
                  s.setMessage(top.length ? `Плата стала односторонней. Планарные детали сверху (${top.map((c) => c.ref).slice(0, 8).join(', ')}${top.length > 8 ? '…' : ''}) не достанут до меди: выделите их и нажмите F, чтобы перенести вниз.` : 'Плата стала односторонней: все дорожки на нижнем слое.');
                }
              }}
            >
              <option value={2}>2 — двусторонняя</option>
              <option value={1}>1 — односторонняя, медь снизу (все дорожки перенесутся на нижний слой)</option>
            </select>
            <label>Цвет маски</label>
            <select className="sel" value={p.board.maskColor ?? '#1f6b3a'} onChange={(e) => s.commit((d) => void (d.board.maskColor = e.target.value))}>
              <option value="#1f6b3a">зелёная</option>
              <option value="#1b3a2a">тёмно-зелёная</option>
              <option value="#1e3a6e">синяя</option>
              <option value="#7a1f1f">красная</option>
              <option value="#222222">чёрная</option>
              <option value="#cfcfcf">белая</option>
              <option value="#6a4a1e">без маски (ЛУТ)</option>
            </select>
          </div>
          {!rs && <p className="hint">Контур не прямоугольный: размеры редактируются инструментом «Контур платы».</p>}
        </>
      )}

      {tab === 'rules' && (
        <>
          <div className="row">
            <span className="hint">Заготовки:</span>
            {RULE_PRESETS.map((r) => (
              <button key={r.id} className="btn sm" onClick={() => s.commit((d) => void (d.rules = { ...structuredClone(r.rules), classClearances: d.rules.classClearances }))}>
                {r.name}
              </button>
            ))}
          </div>
          <div className="field">
            {RULE_FIELDS.map((f) => (
              <span key={f.k} style={{ display: 'contents' }}>
                <label>
                  {f.label}, {U}
                </label>
                <LenInput value={p.rules[f.k] as number} min={0} onChange={(v) => setRule(f.k, v)} />
              </span>
            ))}
            <label>Закрывать переходные маской</label>
            <input type="checkbox" checked={p.rules.tentVias} onChange={(e) => s.commit((d) => void (d.rules.tentVias = e.target.checked))} />
            <label>Каплевидные переходы</label>
            <input type="checkbox" checked={!!p.rules.teardrops} onChange={(e) => s.commit((d) => void (d.rules.teardrops = e.target.checked || undefined))} />
          </div>
          <h4>Особые зазоры между классами</h4>
          <p className="hint">Например, 6 мм между сетью 230 В и всем остальным. «*» — любой другой класс.</p>
          <table className="grid">
            <thead>
              <tr>
                <th>Класс A</th>
                <th>Класс B</th>
                <th>Зазор, {U}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {p.rules.classClearances.map((c, i) => (
                <tr key={i}>
                  <td>
                    <select value={c.a} onChange={(e) => s.commit((d) => void (d.rules.classClearances[i].a = e.target.value))}>
                      {Object.keys(p.netClasses).map((k) => (
                        <option key={k}>{k}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select value={c.b} onChange={(e) => s.commit((d) => void (d.rules.classClearances[i].b = e.target.value))}>
                      <option value="*">* любой</option>
                      {Object.keys(p.netClasses).map((k) => (
                        <option key={k}>{k}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <LenInput className="inp" value={c.clearance} min={0} onChange={(v) => s.commit((d) => void (d.rules.classClearances[i].clearance = v))} />
                  </td>
                  <td>
                    <button className="btn sm danger" onClick={() => s.commit((d) => void d.rules.classClearances.splice(i, 1))}>
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row">
            <button className="btn sm" onClick={() => s.commit((d) => void d.rules.classClearances.push({ a: Object.keys(d.netClasses)[0], b: '*', clearance: 1 }))}>
              Добавить правило
            </button>
            {!p.netClasses.Mains && (
              <button
                className="btn sm"
                onClick={() =>
                  s.commit((d) => {
                    d.netClasses.Mains = { ...MAINS_CLASS };
                    d.rules.classClearances.push({ a: 'Mains', b: '*', clearance: MAINS_CLEARANCE });
                  })
                }
              >
                Добавить класс «Сеть 230 В» с зазором 6 мм
              </button>
            )}
          </div>
        </>
      )}

      {tab === 'classes' && (
        <>
          <p className="hint">Класс задаёт зазор, ширину дорожки и размер переходного для своих цепей. Цепь получает класс в своих свойствах.</p>
          <table className="grid">
            <thead>
              <tr>
                <th>Класс</th>
                <th>Описание</th>
                <th>Зазор</th>
                <th>Дорожка</th>
                <th>Переходное</th>
                <th>Отверстие</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {Object.values(p.netClasses).map((c) => (
                <tr key={c.name}>
                  <td>
                    <b>{c.name}</b>
                  </td>
                  <td>
                    <TextInput className="inp" value={c.description ?? ''} onChange={(v) => setClass(c.name, (x) => void (x.description = v))} />
                  </td>
                  <td>
                    <LenInput className="inp" value={c.clearance} min={0} onChange={(v) => setClass(c.name, (x) => void (x.clearance = v))} />
                  </td>
                  <td>
                    <LenInput className="inp" value={c.trackWidth} min={0.05} onChange={(v) => setClass(c.name, (x) => void (x.trackWidth = v))} />
                  </td>
                  <td>
                    <LenInput className="inp" value={c.viaDiameter} min={0.2} onChange={(v) => setClass(c.name, (x) => void (x.viaDiameter = v))} />
                  </td>
                  <td>
                    <LenInput className="inp" value={c.viaDrill} min={0.1} onChange={(v) => setClass(c.name, (x) => void (x.viaDrill = v))} />
                  </td>
                  <td>
                    {c.name !== 'Default' && (
                      <button
                        className="btn sm danger"
                        onClick={() =>
                          s.commit((d) => {
                            delete d.netClasses[c.name];
                            for (const n of Object.values(d.nets)) if (n.netClass === c.name) n.netClass = 'Default';
                            d.rules.classClearances = d.rules.classClearances.filter((r) => r.a !== c.name && r.b !== c.name);
                          })
                        }
                      >
                        ×
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row">
            <button
              className="btn sm"
              onClick={() =>
                askText({
                  title: 'Новый класс цепей',
                  message: 'Имя класса латиницей, без пробелов:',
                  value: 'HighCurrent',
                  okLabel: 'Добавить',
                  onOk: (v) => {
                    const name = (v ?? '').replace(/\s+/g, '');
                    if (!name || useEditor.getState().project.netClasses[name]) return;
                    s.commit((d) => void (d.netClasses[name] = { ...defaultNetClasses().Default, name, description: '' }));
                    s.openDialog('board');
                  },
                  onCancel: () => s.openDialog('board'),
                })
              }
            >
              Добавить класс
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}
