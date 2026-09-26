import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { useEditor } from '@editor/store';
import { simRuntime } from '@editor/sim-runtime';
import type { DeviceView, SimView, VacuumView } from '@core/sim';
import { onBack } from './back-button';
import { Devices, HoldButton, Oled, PanelScreen, Readings, Serial, fmtNum, useSimView } from './panels/SimPanel';

/*
 * Симуляция во весь экран: пульт (экран, энкодер, кнопки), мнемосхема установки с
 * живыми турбинами, воздухом и клапанами, графики и все настройки деталей. Для проектов
 * без установки — крупно экраны, кнопки и список деталей. Открывается поверх редактора
 * и просит у браузера полноэкранный режим; «Назад» на телефоне закрывает.
 */

export function SimFullscreen() {
  const full = useEditor((s) => !!s.sim.full);
  return full ? <FullSim /> : null;
}

function FullSim() {
  const root = useRef<HTMLDivElement>(null);
  const sim = useEditor((s) => s.sim);
  const name = useEditor((s) => s.project.meta.name);
  const view = useSimView();
  const close = () => simRuntime.setFull(false);

  useEffect(() => {
    const el = root.current;
    // Полноэкранный режим браузера — если разрешён (на iPhone его нет: остаётся окно поверх).
    el?.requestFullscreen?.().catch(() => undefined);
    const off = onBack(() => (simRuntime.setFull(false), true));
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.fullscreenElement) simRuntime.setFull(false);
    };
    window.addEventListener('keydown', key);
    return () => {
      off();
      window.removeEventListener('keydown', key);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
  }, []);

  const status = sim.status;
  const hasPanel = useEditor((s) => Object.keys(s.project.firmware?.modules ?? {}).length > 0);
  return (
    <div ref={root} className="simfs" role="dialog" aria-label="Симуляция во весь экран">
      <div className="simfs-bar">
        <b className="simfs-name">{name}</b>
        <span className="hint simfs-mcu">{view?.mcu}</span>
        <span className="simfs-time">
          {sim.seconds.toFixed(1).replace('.', ',')} с · {Math.round(sim.speed * 100)} %
        </span>
        <span className="simfs-grow" />
        {status === 'running' ? (
          <button className="btn" onClick={() => simRuntime.pause()}>
            ⏸ Пауза
          </button>
        ) : (
          <button className="btn primary" disabled={status === 'loading'} onClick={() => (status === 'paused' ? simRuntime.resume() : simRuntime.start())}>
            ▶ {status === 'paused' ? 'Дальше' : status === 'loading' ? 'Запуск…' : 'Старт'}
          </button>
        )}
        <button className="btn" onClick={() => simRuntime.start()} title="Сначала: сброс контроллера и установки">
          ⟲ Сброс
        </button>
        <label className="simfs-sound">
          <input type="checkbox" defaultChecked={simRuntime.sound} onChange={(e) => (simRuntime.sound = e.target.checked)} /> звук
        </label>
        <button className="btn" onClick={close} aria-label="Закрыть">
          ✕
        </button>
      </div>
      {sim.error && <p className="simfs-error">{sim.error}</p>}
      {!view ? (
        <div className="simfs-empty">
          {status === 'loading' ? 'Запуск симуляции…' : hasPanel ? 'Питание выключено.' : 'Нажмите «Старт».'}
          {hasPanel && status !== 'loading' && (
            <button className="simfs-round simfs-power" onClick={() => simRuntime.start()}>
              питание
            </button>
          )}
        </div>
      ) : view.plant ? (
        <PlantLayout view={view} plant={view.plant} />
      ) : (
        <GenericLayout view={view} />
      )}
    </div>
  );
}

/* ---------------- установка «пылесос» ---------------- */

function PlantLayout({ view, plant }: { view: SimView; plant: VacuumView }) {
  const [side, setSide] = useState<'pult' | 'params' | 'serial'>('pult');
  const quick = quickActions(view);
  const panel = view.devices.find((d) => d.kind === 'panel');
  return (
    <div className={`simfs-body${panel ? ' has-panel' : ''}`}>
      <div className="simfs-main">
        {panel && <PultFront view={view} panel={panel} />}
        <div className="simfs-scheme-wrap">
          <VacuumScheme v={plant} />
        </div>
        {quick.length > 0 && (
          <div className="simfs-quick">
            {quick.map((q) => (
              <button key={q.id + q.key} className="btn sm" onClick={() => simRuntime.act(q.id, q.key)}>
                {q.label}
              </button>
            ))}
          </div>
        )}
        <Charts tick={view.seconds} />
      </div>
      <div className="simfs-side">
        <div className="tabs">
          <button className={side === 'pult' ? 'on' : ''} onClick={() => setSide('pult')}>
            Пульт
          </button>
          <button className={side === 'params' ? 'on' : ''} onClick={() => setSide('params')}>
            Настройки
          </button>
          <button className={side === 'serial' ? 'on' : ''} onClick={() => setSide('serial')}>
            Порт
          </button>
        </div>
        {side === 'pult' && <Pult view={view} />}
        {side === 'params' && <ParamCards view={view} />}
        {side === 'serial' && <Serial baud={view.baud} />}
      </div>
    </div>
  );
}

/**
 * Пульт как на макете: экран 800×480 с касаниями (прошивка пульта), под ним кнопка
 * «Пуск турбин» (удержание — пресеты), энкодер (крутить пальцем или колёсиком, нажать —
 * в середине) и «Питание» — полное отключение: симуляция останавливается, настройки
 * контроллера сохраняются, следующее включение — новая смена в журнале.
 */
function PultFront({ view, panel }: { view: SimView; panel: DeviceView }) {
  const start = view.devices.find((d) => d.kind === 'button' && /пуск/i.test(d.title));
  const enc = view.devices.find((d) => d.kind === 'encoder');
  const sw = enc && view.devices.find((d) => d.kind === 'button' && d.comp === enc.comp);
  return (
    <div className="simfs-pultfront">
      <div className="simfs-screen">
        <PanelScreen d={panel} />
      </div>
      {panel.warning && <p className="hint" style={{ color: 'var(--warn)' }}>⚠ {panel.warning}</p>}
      <div className="simfs-controls">
        {start && (
          <div className="simfs-ctl">
            <RoundHold id={start.id} pressed={!!start.pressed} label={'пуск\nтурбин'} />
            <span>удержание — пресеты</span>
          </div>
        )}
        {enc && (
          <div className="simfs-ctl">
            <Knob id={enc.id} swId={sw?.id} pressed={!!sw?.pressed} />
            <span>энкодер</span>
          </div>
        )}
        <div className="simfs-ctl">
          <button className="simfs-round simfs-power" onClick={() => simRuntime.stop()}>
            питание
          </button>
          <span>полное отключение</span>
        </div>
      </div>
    </div>
  );
}

function RoundHold({ id, pressed, label }: { id: string; pressed: boolean; label: string }) {
  const up = () => simRuntime.press(id, false);
  return (
    <button
      className={`simfs-round${pressed ? ' on' : ''}`}
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        simRuntime.press(id, true);
      }}
      onPointerUp={up}
      onPointerCancel={up}
      onContextMenu={(e) => e.preventDefault()}
    >
      {label}
    </button>
  );
}

/** Энкодер: поворот пальцем по кругу (шаг — 18°), колёсиком мыши; середина — кнопка. */
function Knob({ id, swId, pressed }: { id: string; swId?: string; pressed: boolean }) {
  const [angle, setAngle] = useState(35);
  const drag = useRef<{ a: number; acc: number } | null>(null);
  const turn = (dir: 1 | -1) => {
    simRuntime.act(id, dir > 0 ? 'cw' : 'ccw');
    setAngle((a) => a + dir * 18);
  };
  const angleOf = (e: RPointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return (Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180) / Math.PI;
  };
  const swUp = () => swId && simRuntime.press(swId, false);
  return (
    <div
      className="simfs-knob2"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture?.(e.pointerId);
        drag.current = { a: angleOf(e), acc: 0 };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const a = angleOf(e);
        let da = a - d.a;
        if (da > 180) da -= 360;
        if (da < -180) da += 360;
        d.a = a;
        d.acc += da;
        while (d.acc >= 18) (d.acc -= 18), turn(1);
        while (d.acc <= -18) (d.acc += 18), turn(-1);
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
      onWheel={(e) => turn(e.deltaY < 0 ? 1 : -1)}
      role="slider"
      aria-label="Энкодер: крутите пальцем или колёсиком"
      aria-valuenow={angle}
    >
      <i style={{ transform: `rotate(${angle}deg)` }} />
      {swId && (
        <button
          className={`simfs-knob-sw${pressed ? ' on' : ''}`}
          aria-label="Нажать энкодер"
          onPointerDown={(e) => {
            e.stopPropagation();
            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
            simRuntime.press(swId, true);
          }}
          onPointerUp={swUp}
          onPointerCancel={swUp}
        />
      )}
      <button className="simfs-knob-arrow l" aria-label="Повернуть влево" onPointerDown={(e) => e.stopPropagation()} onClick={() => turn(-1)}>
        ⟲
      </button>
      <button className="simfs-knob-arrow r" aria-label="Повернуть вправо" onPointerDown={(e) => e.stopPropagation()} onClick={() => turn(1)}>
        ⟳
      </button>
    </div>
  );
}

/** Быстрые действия под мнемосхемой: инструмент, насадка, пыль, провал сети. */
function quickActions(view: SimView): { id: string; key: string; label: string }[] {
  const out: { id: string; key: string; label: string }[] = [];
  for (const d of view.devices) if (['tool', 'plant', 'mains'].includes(d.kind)) for (const a of d.actions ?? []) out.push({ id: d.id, key: a.key, label: a.label });
  return out;
}

/** Пульт на корпусе: экран, энкодер, кнопки, зуммер. */
function Pult({ view }: { view: SimView }) {
  if (view.devices.some((d) => d.kind === 'panel')) return <PultExtras view={view} />;
  const oled = view.devices.filter((d) => d.kind === 'oled' || d.kind === 'lcd');
  const enc = view.devices.filter((d) => d.kind === 'encoder');
  const buttons = view.devices.filter((d) => d.kind === 'button');
  const buzzer = view.devices.filter((d) => d.kind === 'buzzer');
  const leds = view.devices.filter((d) => d.kind === 'led');
  // Кнопки на корпусе — крупно; кнопки на плате (сброс, загрузчик) — отдельно.
  const label = (d: DeviceView) => d.title.replace(/^\S+\s+/, '');
  return (
    <div className="simfs-pult">
      {oled.map((d) => (d.frame ? <Oled key={d.id} frame={d.frame} w={d.width!} h={d.height!} /> : <Devices key={d.id} view={{ ...view, devices: [d] }} />))}
      {enc.map((d) => {
        const sw = buttons.find((b) => b.comp === d.comp);
        return (
          <div key={d.id} className="simfs-enc">
            <button className="btn simfs-knob" onClick={() => simRuntime.act(d.id, 'ccw')} aria-label="Повернуть влево">
              ⟲
            </button>
            {sw ? <HoldButton id={sw.id} pressed={!!sw.pressed} label={sw.pressed ? '●' : '○'} /> : <span />}
            <button className="btn simfs-knob" onClick={() => simRuntime.act(d.id, 'cw')} aria-label="Повернуть вправо">
              ⟳
            </button>
            <span className="hint">{label(d)}</span>
          </div>
        );
      })}
      <div className="simfs-keys">
        {buttons
          .filter((b) => !enc.some((e) => e.comp === b.comp))
          .map((b) => (
            <HoldButton key={b.id} id={b.id} pressed={!!b.pressed} label={label(b)} />
          ))}
      </div>
      {(buzzer.length > 0 || leds.length > 0) && (
        <div className="simfs-ind">
          {buzzer.map((b) => (
            <span key={b.id} className={`tag ${b.on ? 'ok' : ''}`}>
              {b.on ? `♪ ${b.hz} Гц` : '♪ тихо'}
            </span>
          ))}
          {leds.map((l) => (
            <span key={l.id} className="sim-led" title={l.title} style={{ background: l.color, opacity: 0.25 + 0.75 * (l.brightness ?? 0), boxShadow: l.on ? `0 0 10px ${l.color}` : 'none' }} />
          ))}
        </div>
      )}
      <p className="hint">Кнопки держатся, пока нажаты (долгое нажатие — как на настоящей). Энкодер — стрелками, его кнопка — в середине.</p>
    </div>
  );
}

/** При пульте с экраном основное — над мнемосхемой; здесь — зуммер и кнопки на плате. */
function PultExtras({ view }: { view: SimView }) {
  const buzzer = view.devices.filter((d) => d.kind === 'buzzer');
  const enc = view.devices.filter((d) => d.kind === 'encoder');
  const buttons = view.devices.filter((d) => d.kind === 'button' && !/пуск/i.test(d.title) && !enc.some((e) => e.comp === d.comp));
  return (
    <div className="simfs-pult">
      <div className="simfs-ind">
        {buzzer.map((b) => (
          <span key={b.id} className={`tag ${b.on ? 'ok' : ''}`}>
            {b.on ? `♪ ${b.hz} Гц` : '♪ тихо'}
          </span>
        ))}
      </div>
      {buttons.length > 0 && (
        <div className="simfs-keys">
          {buttons.map((b) => (
            <HoldButton key={b.id} id={b.id} pressed={!!b.pressed} label={b.title.replace(/^\S+\s+/, '')} />
          ))}
        </div>
      )}
      <p className="hint">Экран пульта — сенсорный: касайтесь подписей по бокам и вкладок внизу. Энкодер — пальцем по кругу или колёсиком, его кнопка — в середине. «Пуск турбин»: коротко — пуск и стоп, держать дольше секунды — пресеты на экране.</p>
    </div>
  );
}

const CARD_ORDER: DeviceView['kind'][] = ['plant', 'mains', 'motor', 'tool', 'valve', 'triac', 'sensor', 'pot', 'analog', 'digital', 'battery', 'coil', 'relay'];

/** Все настройки деталей: параметры (ползунки, списки), показания, действия. */
function ParamCards({ view }: { view: SimView }) {
  const list = view.devices.filter((d) => CARD_ORDER.includes(d.kind)).sort((a, b) => CARD_ORDER.indexOf(a.kind) - CARD_ORDER.indexOf(b.kind));
  return (
    <div className="simfs-cards">
      {list.map((d) => (
        <details key={d.id} className="simfs-card" open={d.kind === 'plant' || d.kind === 'mains'}>
          <summary>
            {d.title}
            {d.warning && <span className="tag warn">⚠</span>}
          </summary>
          {d.warning && <div className="hint" style={{ color: 'var(--warn)' }}>{d.warning}</div>}
          {d.readings && d.readings.length > 0 && <Readings d={d} />}
          {d.params?.map((p) =>
            p.options ? (
              <label key={p.key} className="sim-param">
                <span>{p.label}</span>
                <select value={Math.round(p.value)} onChange={(e) => simRuntime.set(d.id, p.key, +e.target.value)}>
                  {p.options.map((o, i) => (
                    <option key={i} value={i}>
                      {o}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label key={p.key} className="sim-param">
                <span>{p.label}</span>
                <input type="range" min={p.min} max={p.max} step={p.step} defaultValue={p.value} onChange={(e) => simRuntime.set(d.id, p.key, +e.target.value)} />
                <b>
                  {fmtNum(p.value)} {p.unit}
                </b>
              </label>
            ),
          )}
          {d.actions && (
            <div className="row">
              {d.actions.map((a) => (
                <button key={a.key} className="btn sm primary" onClick={() => simRuntime.act(d.id, a.key)}>
                  {a.label}
                </button>
              ))}
            </div>
          )}
        </details>
      ))}
    </div>
  );
}

/* ---------------- мнемосхема ---------------- */

const tempColor = (t: number) => (t >= 110 ? '#ff453a' : t >= 90 ? '#ff9f0a' : t >= 60 ? '#ffd60a' : '#57d69b');

function Fan({ cx, cy, r, rpm }: { cx: number; cy: number; r: number; rpm: number }) {
  // Видимое вращение — медленнее настоящего (иначе стробоскоп): оборот за 0,25…3 с.
  const dur = rpm > 300 ? Math.max(0.25, Math.min(3, 9000 / rpm)) : 0;
  return (
    <g className={`simfs-fan${dur ? ' spin' : ''}`} style={dur ? { animationDuration: `${dur.toFixed(2)}s` } : undefined}>
      {[0, 60, 120, 180, 240, 300].map((a) => (
        <path key={a} d={`M${cx} ${cy} q${r * 0.55} ${-r * 0.2} ${r * 0.8} ${-r * 0.55} q${-r * 0.35} ${r * 0.05} ${-r * 0.8} ${r * 0.55}z`} transform={`rotate(${a} ${cx} ${cy})`} />
      ))}
      <circle cx={cx} cy={cy} r={r * 0.16} />
    </g>
  );
}

/** Полупериод сети с закрашенной частью, где симистор открыт (угол открытия α). */
function Phase({ x, y, firing, on }: { x: number; y: number; firing: number; on: boolean }) {
  const w = 70;
  const h = 26;
  const pts: string[] = [];
  const fill: string[] = [`${x + (firing / 180) * w},${y}`];
  for (let i = 0; i <= 36; i++) {
    const a = (i / 36) * 180;
    const px = x + (a / 180) * w;
    const py = y - Math.sin((a * Math.PI) / 180) * h;
    pts.push(`${px.toFixed(1)},${py.toFixed(1)}`);
    if (a >= firing) fill.push(`${px.toFixed(1)},${py.toFixed(1)}`);
  }
  fill.push(`${x + w},${y}`);
  return (
    <g className="simfs-phase">
      <line x1={x} y1={y} x2={x + w} y2={y} />
      <polyline points={pts.join(' ')} />
      {on && firing < 180 && <polygon points={fill.join(' ')} />}
    </g>
  );
}

function VacuumScheme({ v }: { v: VacuumView }) {
  const flow = v.air.flow;
  // Скорость «бегущего воздуха» — по расходу.
  const airDur = flow > 3 ? Math.max(0.3, Math.min(4, 120 / flow)) : 0;
  const air = (d: string, key: string) => <path key={key} className={`simfs-air${airDur ? ' run' : ''}`} d={d} style={airDur ? { animationDuration: `${airDur.toFixed(2)}s` } : undefined} />;
  const cakeH = (c: number) => Math.min(1, c / 2) * 70;
  const motors = v.motors.slice(0, 2);
  const mx = [560, 790];
  const blocked = v.air.block > 0.02;
  return (
    <svg className="simfs-scheme" viewBox="0 0 1000 600" role="img" aria-label="Мнемосхема пылесоса">
      <defs>
        <linearGradient id="simfs-dust" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8a6d3b" />
          <stop offset="1" stopColor="#5c4726" />
        </linearGradient>
      </defs>
      {/* шланг и расходомер */}
      <path className="simfs-pipe" d="M20 470 C80 470 90 420 150 420 L200 420" />
      {air('M20 470 C80 470 90 420 150 420 L200 420', 'hose')}
      <path className="simfs-venturi" d="M120 404 L150 412 L170 412 L196 404 L196 436 L170 428 L150 428 L120 436 Z" />
      <text x="20" y="550" className="simfs-t">
        шланг Ø{v.air.hoseMm} мм · {fmtNum(v.air.hoseM)} м
      </text>
      <text x="20" y="574" className="simfs-t">
        B3 расход {Math.round(flow)} м³/ч · {fmtNum(v.air.speed)} м/с
      </text>
      {blocked && (
        <g className="simfs-block">
          <circle cx="40" cy="470" r="16" />
          <text x="40" y="475" textAnchor="middle">
            {Math.round(v.air.block * 100)}%
          </text>
        </g>
      )}
      {/* бак и фильтры */}
      <rect className="simfs-tank" x="200" y="260" width="260" height="260" rx="14" />
      <rect x="206" y={514 - 60} width="248" height="60" rx="8" fill="url(#simfs-dust)" opacity="0.8" />
      <text x="330" y="494" textAnchor="middle" className="simfs-t">
        бак {fmtNum(v.air.tank)} кПа
      </text>
      {air('M200 420 C250 420 250 330 270 290', 'tank1')}
      {air('M200 420 C300 420 350 340 370 290', 'tank2')}
      {[0, 1].map((i) => {
        const x = 240 + i * 100;
        const valve = v.valves[i];
        return (
          <g key={i}>
            <rect className="simfs-filter" x={x} y="170" width="60" height="120" rx="6" />
            <rect x={x + 3} y={287 - cakeH(v.air.cake[i] ?? 0)} width="54" height={cakeH(v.air.cake[i] ?? 0)} rx="4" fill="url(#simfs-dust)" opacity="0.85" />
            <text x={x + 30} y="235" textAnchor="middle" className="simfs-t small">
              фильтр {i + 1}
            </text>
            {air(`M${x + 12} 170 L${x + 12} 80`, `up${i}`)}
            {valve && (
              <g className={`simfs-valve${valve.open ? ' open' : ''}`}>
                <rect x={x + 28} y="96" width="28" height="32" rx="4" />
                <text x={x + 60} y="118" className="simfs-t small">
                  {valve.ref}
                  {valve.fault ? ' ⚠' : ''}
                </text>
                {valve.open && <path className="simfs-puff" d={`M${x + 42} 130 L${x + 42} 250 M${x + 30} 236 L${x + 42} 252 L${x + 54} 236`} />}
              </g>
            )}
          </g>
        );
      })}
      <text x="330" y="160" textAnchor="middle" className="simfs-t">
        B2 перепад {Math.round(v.air.filterDp)} Па
      </text>
      {/* чистая камера → турбины */}
      <rect className="simfs-chamber" x="200" y="40" width="260" height="40" rx="8" />
      <text x="210" y="30" className="simfs-t">
        B1 разрежение {fmtNum(v.air.vacuum)} кПа
      </text>
      <path className="simfs-pipe" d="M460 60 L880 60" />
      {air('M252 60 L880 60', 'pipe')}
      {motors.map((m, i) => (
        <g key={m.ref}>
          <path className="simfs-pipe thin" d={`M${mx[i]} 60 L${mx[i]} 100`} />
          <circle className={`simfs-motor${m.fault ? ' bad' : ''}`} cx={mx[i]} cy="165" r="62" style={{ stroke: tempColor(m.temp) }} />
          <Fan cx={mx[i]} cy={165} r={52} rpm={m.rpm} />
          <text x={mx[i]} y="252" textAnchor="middle" className="simfs-t big">
            {m.ref} {fmtNum(m.rpm / 1000)} тыс. об/мин
          </text>
          <text x={mx[i]} y="272" textAnchor="middle" className="simfs-t small">
            {fmtNum(m.amps)} А · {Math.round(m.watts)} Вт ·{' '}
            <tspan fill={tempColor(m.temp)}>{Math.round(m.temp)} °C</tspan>
          </text>
          {m.fault && (
            <text x={mx[i]} y="292" textAnchor="middle" className="simfs-t warn">
              {m.fault}
            </text>
          )}
          {/* симистор и фаза */}
          <rect className="simfs-box" x={mx[i] - 60} y="304" width="120" height="64" rx="6" />
          <Phase x={mx[i] - 35} y={358} firing={m.firing} on={m.conducting} />
          <text x={mx[i]} y="322" textAnchor="middle" className="simfs-t small">
            симистор α {m.conducting ? `${m.firing}°` : '—'}
          </text>
          {m.triac && (
            <text x={mx[i]} y="386" textAnchor="middle" className="simfs-t small warn">
              {m.triac}
            </text>
          )}
          <path className="simfs-wire" d={`M${mx[i]} 368 L${mx[i]} 420`} />
          <path className="simfs-wire" d={`M${mx[i]} 304 L${mx[i]} 228`} />
        </g>
      ))}
      {/* выхлоп */}
      {air('M880 60 L960 60 L960 20', 'exhaust')}
      <text x="900" y="96" className="simfs-t small">
        выхлоп
      </text>
      {/* сеть, контроллер, розетка */}
      <path className="simfs-bus" d="M560 420 L934 420" />
      <g>
        <rect className="simfs-box" x="872" y="440" width="124" height="86" rx="8" />
        <text x="934" y="466" textAnchor="middle" className="simfs-t">
          сеть {Math.round(v.mains.volts)} В
        </text>
        <text x="934" y="488" textAnchor="middle" className="simfs-t small">
          {v.mains.hz} Гц{v.mains.dip ? ' · провал' : ''}
        </text>
        <text x="934" y="508" textAnchor="middle" className="simfs-t small">
          нуль {v.zc.ok ? `${Math.round(v.zc.width)} мкс` : 'не найден'}
        </text>
        <path className="simfs-wire" d="M934 440 L934 420" />
      </g>
      <g>
        <rect className="simfs-box ctl" x="470" y="450" width="170" height="76" rx="8" />
        <text x="555" y="478" textAnchor="middle" className="simfs-t">
          ESP32
        </text>
        <text x="555" y="500" textAnchor="middle" className="simfs-t small">
          ключи, датчики, экран
        </text>
      </g>
      {v.tool && (
        <g className={`simfs-tool${v.tool.on ? ' on' : ''}`}>
          <rect className="simfs-box" x="655" y="450" width="205" height="76" rx="8" />
          <circle cx="685" cy="488" r="18" />
          <circle cx="679" cy="488" r="3" />
          <circle cx="691" cy="488" r="3" />
          <text x="712" y="478" className="simfs-t">
            {v.tool.ref} розетка
          </text>
          <text x="712" y="500" className="simfs-t small">
            {v.tool.on ? (v.tool.powered ? `инструмент ${fmtNum(v.tool.amps)} А` : 'нет питания') : 'выключена'}
          </text>
          <path className="simfs-wire" d="M757 450 L757 420" />
        </g>
      )}
    </svg>
  );
}

/* ---------------- графики ---------------- */

const CHARTS: { title: string; series: { key: string; label: string; color: string; k?: number }[]; unit: string }[] = [
  {
    title: 'Обороты',
    unit: 'тыс. об/мин',
    series: [
      { key: 'rpm1', label: 'M1', color: '#4fb3ff', k: 0.001 },
      { key: 'rpm2', label: 'M2', color: '#ff9f0a', k: 0.001 },
    ],
  },
  {
    title: 'Ток',
    unit: 'А',
    series: [
      { key: 'amps1', label: 'M1', color: '#4fb3ff' },
      { key: 'amps2', label: 'M2', color: '#ff9f0a' },
      { key: 'tool', label: 'инстр.', color: '#bf5af2' },
    ],
  },
  {
    title: 'Воздух',
    unit: 'кПа / сотни м³/ч',
    series: [
      { key: 'vacuum', label: 'разрежение, кПа', color: '#57d69b' },
      { key: 'flow', label: 'расход, ×100 м³/ч', color: '#64d2ff', k: 0.01 },
    ],
  },
  {
    title: 'Температура',
    unit: '°C',
    series: [
      { key: 't1', label: 'M1', color: '#4fb3ff' },
      { key: 't2', label: 'M2', color: '#ff9f0a' },
    ],
  },
];

function Charts({ tick }: { tick: number }) {
  return (
    <div className="simfs-charts">
      {CHARTS.map((c) => (
        <Chart key={c.title} def={c} tick={tick} />
      ))}
    </div>
  );
}

function Chart({ def, tick }: { def: (typeof CHARTS)[number]; tick: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const h = simRuntime.history;
    const dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth;
    const H = cv.clientHeight;
    if (!W || !H) return;
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    const ctx = cv.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const span = 60;
    const t1 = h.t.length ? h.t[h.t.length - 1] : 0;
    const t0 = Math.max(0, t1 - span);
    const key = (k: string) => (k === 't1' ? 'temp1' : k === 't2' ? 'temp2' : k);
    let max = 0;
    for (const s of def.series) for (let i = 0; i < h.t.length; i++) if (h.t[i] >= t0) max = Math.max(max, (h.s[key(s.key)]?.[i] ?? 0) * (s.k ?? 1));
    max = max > 0 ? niceMax(max) : 1;
    const x0 = 34;
    const X = (t: number) => x0 + ((t - t0) / span) * (W - x0 - 6);
    const Y = (v: number) => H - 16 - (v / max) * (H - 30);
    ctx.strokeStyle = '#2c3541';
    ctx.fillStyle = '#93a0ae';
    ctx.font = '10px system-ui';
    ctx.lineWidth = 1;
    for (let g = 0; g <= 2; g++) {
      const v = (max * g) / 2;
      ctx.beginPath();
      ctx.moveTo(x0, Y(v));
      ctx.lineTo(W - 6, Y(v));
      ctx.stroke();
      ctx.fillText(fmtNum(v), 2, Y(v) + 3);
    }
    for (const s of def.series) {
      const arr = h.s[key(s.key)];
      if (!arr) continue;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      let first = true;
      for (let i = 0; i < h.t.length; i++) {
        if (h.t[i] < t0) continue;
        const px = X(h.t[i]);
        const py = Y(arr[i] * (s.k ?? 1));
        if (first) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
        first = false;
      }
      ctx.stroke();
    }
    ctx.fillStyle = '#5b6775';
    ctx.fillText('−60 с', x0, H - 3);
    ctx.fillText('сейчас', W - 40, H - 3);
  }, [tick, def]);
  return (
    <div className="simfs-chart">
      <div className="simfs-chart-h">
        <b>{def.title}</b>
        <span className="hint">{def.unit}</span>
        {def.series.map((s) => (
          <span key={s.key} className="simfs-key">
            <i style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
      <canvas ref={ref} />
    </div>
  );
}

function niceMax(v: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (v <= m * p) return m * p;
  return 10 * p;
}

/* ---------------- без установки ---------------- */

function GenericLayout({ view }: { view: SimView }) {
  const [side, setSide] = useState<'dev' | 'serial'>('dev');
  const shown = view.devices.filter((d) => ['lcd', 'oled', 'button', 'encoder', 'led', 'buzzer', 'coil', 'relay'].includes(d.kind));
  return (
    <div className="simfs-body">
      <div className="simfs-main">
        <div className="simfs-generic">
          <Pult view={{ ...view, devices: shown }} />
        </div>
      </div>
      <div className="simfs-side">
        <div className="tabs">
          <button className={side === 'dev' ? 'on' : ''} onClick={() => setSide('dev')}>
            Детали
          </button>
          <button className={side === 'serial' ? 'on' : ''} onClick={() => setSide('serial')}>
            Порт
          </button>
        </div>
        {side === 'dev' && <Devices view={view} />}
        {side === 'serial' && <Serial baud={view.baud} />}
      </div>
    </div>
  );
}
