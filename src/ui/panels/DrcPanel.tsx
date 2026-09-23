import { useEditor } from '@editor/store';
import { runDrc, type DrcMarker } from '@core/model/drc';
import { computeConnectivity } from '@core/model/connectivity';

export function DrcPanel() {
  const s = useEditor();
  const rep = runDrc(s.project);
  const conn = computeConnectivity(s.project);
  const goTo = (m: DrcMarker) => {
    const stage = document.querySelector('.stage') as HTMLElement | null;
    const w = stage?.clientWidth ?? 800;
    const h = stage?.clientHeight ?? 600;
    const scale = Math.max(s.view.scale, 30);
    s.patch({ view: { scale, x: m.at.x - w / scale / 2, y: m.at.y - h / scale / 2 }, selection: m.items.filter((i) => i.kind !== 'ruleArea'), message: m.message, panelOpen: window.innerWidth >= 900 });
  };
  const errs = rep.markers.filter((m) => m.severity === 'error');
  const warns = rep.markers.filter((m) => m.severity === 'warning');
  return (
    <div>
      <h3>Проверка правил</h3>
      <div className="row">
        <span className={`tag ${errs.length ? 'err' : 'ok'}`}>ошибок {errs.length}</span>
        <span className={`tag ${warns.length ? 'warn' : 'ok'}`}>предупреждений {warns.length}</span>
        <span className={`tag ${conn.unrouted ? 'warn' : 'ok'}`}>не разведено {conn.unrouted}</span>
      </div>
      <p className="hint">
        Зазор {s.project.rules.minClearance} мм, дорожка от {s.project.rules.minTrackWidth} мм, до края {s.project.rules.edgeClearance} мм
        {s.project.rules.classClearances.map((c) => ` · ${c.a}–${c.b === '*' ? 'все' : c.b}: ${c.clearance} мм`)}. Правила — в настройках платы.
      </p>
      {!rep.markers.length && <p className="hint">Замечаний нет: зазоры, ширины, отверстия, край платы и области правил в порядке, все цепи разведены.</p>}
      <div className="list">
        {[...errs, ...warns].slice(0, 200).map((m) => (
          <button key={m.id} className="item" onClick={() => goTo(m)}>
            <span className={`tag ${m.severity === 'error' ? 'err' : 'warn'}`}>{m.severity === 'error' ? '!' : '?'}</span>
            <span className="grow">
              <div>{m.message}</div>
              <div className="ds">
                {m.at.x.toFixed(2)}, {m.at.y.toFixed(2)} мм
              </div>
            </span>
          </button>
        ))}
        {rep.markers.length > 200 && <p className="hint">Показаны первые 200.</p>}
      </div>
    </div>
  );
}
