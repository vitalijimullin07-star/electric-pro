import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useEditor } from '@editor/store';
import { simRuntime } from '@editor/sim-runtime';
import { fmtSi } from '@core/sim';
import { onBack } from '../back-button';
import { Devices, useSimView } from './SimPanel';
import { PartKnobs, fmtValue } from './AnalogPanel';

/*
 * Карточка параметров на холсте во время симуляции: тройной щелчок или удержание на детали
 * (плата или схема) — её ползунки, точные значения и показания прямо на ходу; на дорожке,
 * проводе или метке — напряжение цепи, её источники и детали на ней. Карточку можно тащить
 * за заголовок; касание другой детали переводит карточку на неё.
 */

const W = 340;

export function SimTuner() {
  const status = useEditor((s) => s.sim.status);
  const full = useEditor((s) => s.sim.full);
  const project = useEditor((s) => s.project);
  // Открытие и закрытие карточки меняют sim.tick — перерисовка и на паузе.
  useEditor((s) => s.sim.tick);
  const view = useSimView();
  const tune = simRuntime.tune;
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [dock, setDock] = useState(false);
  // Место — по точке касания: новая точка — новое место; переход на другую деталь из карточки место не меняет.
  const key = tune ? `${tune.x}|${tune.y}` : '';
  const open = !!tune && status !== 'off' && !full && !!simRuntime.sim;

  // Новая цель — карточка у точки касания (правее и ниже), в пределах окна; узкий экран — снизу.
  useLayoutEffect(() => {
    if (!tune) return;
    const narrow = window.innerWidth < 640;
    setDock(narrow);
    if (narrow) return setPos(null);
    const h = box.current?.offsetHeight ?? 320;
    const x = Math.min(window.innerWidth - W - 8, Math.max(8, tune.x + 18));
    const y = Math.min(window.innerHeight - h - 8, Math.max(48, tune.y - 60));
    setPos({ x, y });
  }, [key]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && simRuntime.closeTune();
    window.addEventListener('keydown', onKey);
    const off = onBack(() => (simRuntime.closeTune(), true));
    return () => {
      window.removeEventListener('keydown', onKey);
      off();
    };
  }, [open]);

  if (!open || !tune || !view) return null;
  const sim = simRuntime.sim!;
  const a = sim.analog;
  const comp = tune.comp ? project.components[tune.comp] : undefined;
  const part = tune.comp ? a?.partOf.get(tune.comp) : undefined;
  const net = tune.net ? project.nets[tune.net] : undefined;

  // Перетаскивание за заголовок.
  const drag = (e: React.PointerEvent) => {
    if (dock || !pos || (e.target as HTMLElement).closest('button')) return;
    const start = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => setPos({ x: Math.min(window.innerWidth - 60, Math.max(-W + 60, ev.clientX - start.x)), y: Math.min(window.innerHeight - 40, Math.max(0, ev.clientY - start.y)) });
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  let title: React.ReactNode;
  let body: React.ReactNode;
  if (tune.comp) {
    // Карточки устройств: с моделью расчёта — только индикаторы (светодиод, реле, кнопка), ползунки даёт модель;
    // без неё (контроллер без аналогового расчёта) — ползунки устройства (потенциометр, датчик).
    const devices = view.devices
      .filter((d) => d.comp === tune.comp && (part ? ['led', 'buzzer', 'relay', 'button'].includes(d.kind) : d.params?.length || d.kind === 'button'))
      .map((d) => (part ? { ...d, params: undefined, readings: undefined } : d));
    title = (
      <>
        <b>{comp?.ref ?? part?.comp.ref ?? '?'}</b> <span>{part?.kind ?? ''}</span> <span className="hint">{comp?.value ?? part?.comp.value}</span>
      </>
    );
    body = (
      <>
        {part ? (
          <PartKnobs part={part} tick={view.seconds} projectValue={comp?.value} bare />
        ) : devices.length ? null : (
          <p className="hint">
            {a ? 'Эта деталь в аналоговом расчёте не участвует. Модель можно выбрать в свойствах детали («Модель для симуляции»).' : 'Аналоговый расчёт выключен: включите галочку «аналоговый расчёт» на вкладке «Симуляция» и нажмите «Сброс».'}
          </p>
        )}
        {devices.length > 0 && <Devices view={{ ...view, devices }} only />}
        {comp && (
          <div className="row">
            <button
              className="btn sm"
              onClick={() => {
                const s = useEditor.getState();
                s.select([{ kind: 'component', id: comp.id }]);
                s.patch({ panelTab: 'props', panelOpen: true });
              }}
              title="Свойства детали: номинал, модель для симуляции и её параметры на следующие запуски"
            >
              Модель и свойства…
            </button>
          </div>
        )}
      </>
    );
  } else {
    const v = net && a ? a.netVolts(net.id) : undefined;
    const ground = !!net && !!a?.ground.has(net.id);
    const onNet = net && a ? a.partsOnNet(net.id) : [];
    const sources = onNet.filter((x) => x.virtual);
    const others = onNet.filter((x) => !x.virtual);
    const st = net ? view.nets.get(net.id) : undefined;
    title = (
      <>
        <b>Цепь {net?.name ?? '?'}</b>
        {ground && <span className="hint">земля схемы</span>}
      </>
    );
    body = (
      <>
        <div className="tune-volts">{v !== undefined ? fmtValue(v, 'В') : st ? (st.duty > 0.02 && st.duty < 0.98 ? `ШИМ ${Math.round(st.duty * 100)} %` : st.level ? '«1»' : '«0»') : '—'}</div>
        {sources.map((x) => (
          <div key={x.comp.id} className="sim-dev">
            <div className="sim-title">
              <b>{x.comp.ref}</b> <span>{x.kind}</span>
            </div>
            <PartKnobs part={x} tick={view.seconds} bare />
          </div>
        ))}
        {!sources.length && a && !ground && <p className="hint">Источника на этой цепи нет. Генератор или постоянное напряжение подключается на вкладке «Симуляция → Цепь» («Источники и генераторы»).</p>}
        {others.length > 0 && (
          <div className="tune-parts">
            <span className="hint">На цепи:</span>
            {others.slice(0, 24).map((x) => (
              <button key={x.comp.id} className="btn sm" onClick={() => simRuntime.openTune({ comp: x.comp.id, x: tune.x, y: tune.y })} title={`${x.kind} ${x.comp.value}`}>
                {x.comp.ref}
              </button>
            ))}
            {others.length > 24 && <span className="hint">и ещё {others.length - 24}</span>}
          </div>
        )}
      </>
    );
  }

  return (
    <div ref={box} className={`sim-tune${dock ? ' dock' : ''}`} style={!dock && pos ? { left: pos.x, top: pos.y, width: W } : undefined} role="dialog" aria-label="Параметры на ходу">
      <div className="sim-title tune-head" onPointerDown={drag}>
        {title}
        <span className="tune-grow" />
        <span className="hint">{fmtSi(view.seconds, 'с')}</span>
        <button className="btn sm" onClick={() => simRuntime.closeTune()} aria-label="Закрыть" title="Закрыть (Esc)">
          ✕
        </button>
      </div>
      <div className="tune-body">{body}</div>
    </div>
  );
}
