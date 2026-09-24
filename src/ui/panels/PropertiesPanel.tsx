import { stableProject, useEditor } from '@editor/store';
import { LAYERS, boardCopperLayers } from '@core/model/layers';
import type { CopperLayer, LayerId } from '@core/model/types';
import { LenInput, TextInput, useUnits } from '../common/NumberInput';
import { FootprintPreview } from '../common/FootprintPreview';
import { computeConnectivity } from '@core/model/connectivity';
import { deleteSelection, flipSelection, renameComponent, rotateSelection } from '@editor/commands';
import { boardBox, rectSize } from '@core/model/project';
import { polygonLength } from '@core/math/geom';

/* Свойства выделенного объекта; если ничего не выбрано — свойства платы. */

export function PropertiesPanel() {
  const s = useEditor();
  const sel = s.selection;
  if (sel.length > 1) {
    const kinds = new Map<string, number>();
    for (const r of sel) kinds.set(r.kind, (kinds.get(r.kind) ?? 0) + 1);
    const names: Record<string, string> = { component: 'компонентов', track: 'дорожек', via: 'переходных', wire: 'перемычек', drawing: 'графики', zone: 'полигонов', ruleArea: 'областей' };
    return (
      <div>
        <h3>Выделено: {sel.length}</h3>
        <p className="hint">{[...kinds].map(([k, n]) => `${names[k] ?? k}: ${n}`).join(', ')}</p>
        <div className="row">
          <button className="btn" onClick={() => rotateSelection(90)}>
            Повернуть
          </button>
          <button className="btn" onClick={flipSelection}>
            На другую сторону
          </button>
          <button className="btn danger" onClick={deleteSelection}>
            Удалить
          </button>
        </div>
      </div>
    );
  }
  const r = sel[0];
  if (!r) return <BoardProps />;
  if (r.kind === 'component') return <ComponentProps id={r.id} />;
  if (r.kind === 'track') return <TrackProps id={r.id} />;
  if (r.kind === 'via') return <ViaProps id={r.id} />;
  if (r.kind === 'wire') return <WireProps id={r.id} />;
  if (r.kind === 'drawing') return <DrawingProps id={r.id} />;
  if (r.kind === 'ruleArea') return <RuleAreaProps id={r.id} />;
  if (r.kind === 'zone') return <ZoneProps id={r.id} />;
  return <BoardProps />;
}

function BoardProps() {
  const s = useEditor();
  const p = s.project;
  const bb = boardBox(p.board);
  const rs = rectSize(p.board.outline);
  const { len } = useUnits();
  const counts = { comps: Object.keys(p.components).length, tracks: Object.keys(p.tracks).length, vias: Object.keys(p.vias).length, wires: Object.keys(p.wires).length, nets: Object.keys(p.nets).length };
  const conn = computeConnectivity(stableProject(s));
  const total = Object.values(p.tracks).reduce((a, t) => a + polygonLength(t.points), 0);
  return (
    <div>
      <h3>Плата</h3>
      <div className="field">
        <label>Название</label>
        <TextInput value={p.meta.name} onChange={(v) => s.commit((d) => void (d.meta.name = v || 'Плата'))} />
        <label>Размер</label>
        <span>
          {len(bb.maxX - bb.minX, 2)} × {len(bb.maxY - bb.minY, 2)}
          {rs ? '' : ' (контур не прямоугольный)'}
        </span>
        <label>Слоёв меди</label>
        <span>{p.board.copperLayers === 1 ? '1 — нижняя' : '2 — верхняя и нижняя'}</span>
        <label>Скругление</label>
        <span>{len(p.board.cornerRadius)}</span>
      </div>
      <div className="row">
        <button className="btn" onClick={() => s.openDialog('board')}>
          Настройки платы и правила…
        </button>
      </div>
      <h4>Состав</h4>
      <p className="hint">
        Компонентов {counts.comps}, цепей {counts.nets} (разведено {conn.total - conn.unrouted} из {conn.total}), дорожек {counts.tracks} общей длиной {len(total, 0)}, переходных {counts.vias}, перемычек {counts.wires}.
      </p>
      {p.meta.description && <p className="hint">{p.meta.description}</p>}
      <p className="hint">Нажмите на объект платы, чтобы увидеть его свойства.</p>
    </div>
  );
}

function ComponentProps({ id }: { id: string }) {
  const s = useEditor();
  const p = s.project;
  const c = p.components[id];
  if (!c) return null;
  const fp = p.footprints[c.footprint];
  const upd = (fn: (d: typeof c) => void) =>
    s.commit((d) => {
      const x = d.components[id];
      if (x) fn(x);
    });
  const connected = Object.keys(c.padNets).length;
  const pads = fp ? fp.pads.filter((x) => x.type !== 'npth').length : 0;
  return (
    <div>
      <h3>
        {c.ref} <span className="hint">{c.description ?? fp?.description}</span>
      </h3>
      {fp && <FootprintPreview fp={fp} />}
      <div className="field">
        <label>Обозначение</label>
        <TextInput value={c.ref} onChange={(v) => renameComponent(id, v)} />
        <label>Номинал</label>
        <TextInput value={c.value} onChange={(v) => upd((x) => void (x.value = v))} />
        <label>Корпус</label>
        <span title={c.footprint}>
          {fp?.name ?? c.footprint} {fp && !fp.verified && <span className="tag warn">размеры типовые</span>}
        </span>
        <label>X</label>
        <LenInput value={c.at.x} onChange={(v) => upd((x) => void (x.at = { ...x.at, x: v }))} />
        <label>Y</label>
        <LenInput value={c.at.y} onChange={(v) => upd((x) => void (x.at = { ...x.at, y: v }))} />
        <label>Поворот</label>
        <select className="sel" value={String(c.rotation)} onChange={(e) => upd((x) => void (x.rotation = +e.target.value))}>
          {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
            <option key={a} value={String(a)}>
              {a}°
            </option>
          ))}
          {![0, 45, 90, 135, 180, 225, 270, 315].includes(c.rotation) && <option value={String(c.rotation)}>{c.rotation}°</option>}
        </select>
        <label>Сторона</label>
        <select className="sel" value={c.side} onChange={(e) => upd((x) => void (x.side = e.target.value as 'top' | 'bottom'))}>
          <option value="top">верх (сторона деталей)</option>
          <option value="bottom">низ</option>
        </select>
        <label>Выводы</label>
        <span>
          подключено {connected} из {pads}
        </span>
      </div>
      <div className="row">
        <label>
          <input type="checkbox" checked={!!c.locked} onChange={(e) => upd((x) => void (x.locked = e.target.checked || undefined))} /> закрепить
        </label>
        <label>
          <input type="checkbox" checked={!!c.hideRef} onChange={(e) => upd((x) => void (x.hideRef = e.target.checked || undefined))} /> скрыть обозначение
        </label>
        <label>
          <input type="checkbox" checked={!!c.excludeFromBom} onChange={(e) => upd((x) => void (x.excludeFromBom = e.target.checked || undefined))} /> не в перечень
        </label>
      </div>
      <div className="row">
        <button className="btn primary" onClick={() => s.openDialog('component', id)}>
          Выводы и цепи, корпус…
        </button>
        <button className="btn" onClick={() => rotateSelection(90)}>
          Повернуть
        </button>
        <button className="btn danger" onClick={deleteSelection}>
          Удалить
        </button>
      </div>
    </div>
  );
}

function TrackProps({ id }: { id: string }) {
  const s = useEditor();
  const p = s.project;
  const t = p.tracks[id];
  const { len } = useUnits();
  if (!t) return null;
  const conn = computeConnectivity(stableProject(s));
  const net = conn.itemNet.get(id);
  const copper = boardCopperLayers(p.board.copperLayers);
  const upd = (fn: (x: typeof t) => void) =>
    s.commit((d) => {
      const x = d.tracks[id];
      if (x) fn(x);
    });
  return (
    <div>
      <h3>Дорожка</h3>
      <div className="field">
        <label>Цепь</label>
        <span>{net === 'short' ? <span className="tag err">соединяет разные цепи</span> : net ? p.nets[net]?.name : 'без цепи'}</span>
        <label>Слой</label>
        <select className="sel" value={t.layer} onChange={(e) => upd((x) => void (x.layer = e.target.value as CopperLayer))}>
          {copper.map((l) => (
            <option key={l} value={l}>
              {LAYERS[l].name}
            </option>
          ))}
        </select>
        <label>Ширина</label>
        <LenInput value={t.width} min={0.05} onChange={(v) => upd((x) => void (x.width = v))} />
        <label>Длина</label>
        <span>{len(polygonLength(t.points), 2)}</span>
        <label>Точек</label>
        <span>{t.points.length}</span>
      </div>
      <p className="hint">Тяните квадратики вершин, чтобы менять изгибы; тяните середину отрезка — он сдвинется параллельно.</p>
      <div className="row">
        <button className="btn danger" onClick={deleteSelection}>
          Удалить
        </button>
      </div>
    </div>
  );
}

function ViaProps({ id }: { id: string }) {
  const s = useEditor();
  const p = s.project;
  const v = p.vias[id];
  if (!v) return null;
  const conn = computeConnectivity(stableProject(s));
  const net = conn.itemNet.get(id);
  const upd = (fn: (x: typeof v) => void) =>
    s.commit((d) => {
      const x = d.vias[id];
      if (x) fn(x);
    });
  return (
    <div>
      <h3>{p.board.copperLayers === 1 ? 'Площадка перемычки' : 'Переходное отверстие'}</h3>
      <div className="field">
        <label>Цепь</label>
        <span>{net === 'short' ? <span className="tag err">замыкание</span> : net ? p.nets[net]?.name : 'без цепи'}</span>
        <label>X</label>
        <LenInput value={v.at.x} onChange={(val) => upd((x) => void (x.at = { ...x.at, x: val }))} />
        <label>Y</label>
        <LenInput value={v.at.y} onChange={(val) => upd((x) => void (x.at = { ...x.at, y: val }))} />
        <label>Диаметр</label>
        <LenInput value={v.diameter} min={0.2} onChange={(val) => upd((x) => void (x.diameter = val))} />
        <label>Отверстие</label>
        <LenInput value={v.drill} min={0.1} onChange={(val) => upd((x) => void (x.drill = val))} />
      </div>
      <div className="row">
        <button className="btn danger" onClick={deleteSelection}>
          Удалить
        </button>
      </div>
    </div>
  );
}

function WireProps({ id }: { id: string }) {
  const s = useEditor();
  const p = s.project;
  const w = p.wires[id];
  const { len } = useUnits();
  if (!w) return null;
  const conn = computeConnectivity(stableProject(s));
  const net = conn.itemNet.get(id);
  return (
    <div>
      <h3>Перемычка проводом</h3>
      <div className="field">
        <label>Цепь</label>
        <span>{net === 'short' ? <span className="tag err">замыкание</span> : net ? p.nets[net]?.name : 'без цепи'}</span>
        <label>Длина</label>
        <span>{len(Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y), 1)}</span>
      </div>
      <p className="hint">Перемычка паяется со стороны деталей в площадки на её концах.</p>
      <div className="row">
        <button className="btn danger" onClick={deleteSelection}>
          Удалить
        </button>
      </div>
    </div>
  );
}

function DrawingProps({ id }: { id: string }) {
  const s = useEditor();
  const p = s.project;
  const g = p.drawings[id];
  if (!g) return null;
  const upd = (fn: (x: typeof g) => void) =>
    s.commit((d) => {
      const x = d.drawings[id];
      if (x) fn(x);
    });
  return (
    <div>
      <h3>{g.kind === 'text' ? 'Надпись' : 'Графика'}</h3>
      <div className="field">
        <label>Слой</label>
        <select className="sel" value={g.layer} onChange={(e) => upd((x) => void (x.layer = e.target.value as LayerId))}>
          {(['F.Silk', 'B.Silk', 'F.Fab', 'B.Fab', 'Edge.Cuts', 'F.Cu', 'B.Cu'] as LayerId[]).map((l) => (
            <option key={l} value={l}>
              {LAYERS[l].name}
            </option>
          ))}
        </select>
        {g.kind === 'text' ? (
          <>
            <label>Текст</label>
            <TextInput value={g.text} onChange={(v) => upd((x) => void (x.kind === 'text' && (x.text = v)))} />
            <label>Высота</label>
            <LenInput value={g.size} min={0.3} onChange={(v) => upd((x) => void (x.kind === 'text' && (x.size = v)))} />
            <label>Поворот</label>
            <select className="sel" value={String(g.rotation ?? 0)} onChange={(e) => upd((x) => void (x.kind === 'text' && (x.rotation = +e.target.value)))}>
              {[0, 90, 180, 270].map((a) => (
                <option key={a} value={String(a)}>
                  {a}°
                </option>
              ))}
            </select>
          </>
        ) : (
          <>
            <label>Толщина</label>
            <LenInput value={g.width} min={0.05} onChange={(v) => upd((x) => void ('width' in x && (x.width = v)))} />
            {(g.kind === 'rect' || g.kind === 'circle' || g.kind === 'poly') && (
              <>
                <label>Заливка</label>
                <input type="checkbox" checked={!!g.fill} onChange={(e) => upd((x) => void ('fill' in x && (x.fill = e.target.checked)))} />
              </>
            )}
            {g.kind === 'circle' && (
              <>
                <label>Радиус</label>
                <LenInput value={g.r} min={0.1} onChange={(v) => upd((x) => void (x.kind === 'circle' && (x.r = v)))} />
              </>
            )}
          </>
        )}
      </div>
      <div className="row">
        <button className="btn danger" onClick={deleteSelection}>
          Удалить
        </button>
      </div>
    </div>
  );
}

function RuleAreaProps({ id }: { id: string }) {
  const s = useEditor();
  const p = s.project;
  const ra = p.ruleAreas[id];
  if (!ra) return null;
  const upd = (fn: (x: typeof ra) => void) =>
    s.commit((d) => {
      const x = d.ruleAreas[id];
      if (x) fn(x);
    });
  const classes = Object.keys(p.netClasses);
  return (
    <div>
      <h3>Область правил</h3>
      <div className="field">
        <label>Название</label>
        <TextInput value={ra.name} onChange={(v) => upd((x) => void (x.name = v))} />
      </div>
      <div className="row">
        <label>
          <input type="checkbox" checked={!!ra.keepoutTracks} onChange={(e) => upd((x) => void (x.keepoutTracks = e.target.checked))} /> запрет дорожек
        </label>
        <label>
          <input type="checkbox" checked={!!ra.keepoutVias} onChange={(e) => upd((x) => void (x.keepoutVias = e.target.checked))} /> запрет переходных
        </label>
        <label>
          <input type="checkbox" checked={!!ra.showLabel} onChange={(e) => upd((x) => void (x.showLabel = e.target.checked))} /> подпись на плате
        </label>
      </div>
      <h4>Допустимые классы цепей</h4>
      <p className="hint">Если отмечен хотя бы один класс, внутри области разрешены только его дорожки (так делается зона 230 В).</p>
      {classes.map((c) => (
        <label key={c} className="layer-row" style={{ cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={!!ra.onlyClasses?.includes(c)}
            onChange={(e) =>
              upd((x) => {
                const set = new Set(x.onlyClasses ?? []);
                e.target.checked ? set.add(c) : set.delete(c);
                x.onlyClasses = set.size ? [...set] : undefined;
              })
            }
          />
          <span className="nm">{c}</span>
          <span className="ds">{p.netClasses[c].description}</span>
        </label>
      ))}
      <div className="row">
        <button className="btn danger" onClick={deleteSelection}>
          Удалить область
        </button>
      </div>
    </div>
  );
}

function ZoneProps({ id }: { id: string }) {
  const s = useEditor();
  const p = s.project;
  const z = p.zones[id];
  const { label: U } = useUnits();
  if (!z) return null;
  const fill = computeConnectivity(stableProject(s)).zoneFills.find((f) => f.zone.id === id);
  const upd = (fn: (x: typeof z) => void) =>
    s.commit((d) => {
      const x = d.zones[id];
      if (x) fn(x);
    });
  return (
    <div>
      <h3>Полигон меди</h3>
      <p className="hint">
        Заливка обходит чужие цепи с зазором и край платы, своя цепь соединяется сплошной медью. Острова без своих площадок убираются.
        {fill && fill.step > 0 && (
          <>
            {' '}
            Островов: {fill.islands.length}
            {fill.removed ? `, убрано: ${fill.removed}` : ''}.
          </>
        )}
      </p>
      <div className="field">
        <label>Цепь</label>
        <select className="sel" value={z.net ?? ''} onChange={(e) => upd((x) => void (x.net = e.target.value || null))}>
          <option value="">без цепи</option>
          {Object.values(p.nets).map((n) => (
            <option key={n.id} value={n.id}>
              {n.name}
            </option>
          ))}
        </select>
        <label>Слой</label>
        <select className="sel" value={z.layer} onChange={(e) => upd((x) => void (x.layer = e.target.value as CopperLayer))}>
          {boardCopperLayers(p.board.copperLayers).map((l) => (
            <option key={l} value={l}>
              {LAYERS[l].name}
            </option>
          ))}
        </select>
        <label>Зазор, {U}</label>
        <LenInput value={z.clearance} min={0.05} onChange={(v) => upd((x) => void (x.clearance = v))} />
        <label>Приоритет</label>
        <input
          className="inp"
          type="number"
          min={0}
          max={99}
          value={z.priority}
          onChange={(e) => upd((x) => void (x.priority = Math.max(0, Math.min(99, Math.round(+e.target.value || 0)))))}
          onKeyDown={(e) => e.stopPropagation()}
          title="Где полигоны разных цепей перекрываются, первым заливается тот, у кого приоритет выше"
        />
      </div>
      <div className="row">
        <button className="btn danger" onClick={deleteSelection}>
          Удалить
        </button>
      </div>
    </div>
  );
}
