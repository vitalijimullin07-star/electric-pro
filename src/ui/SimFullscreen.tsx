import { useEffect, useRef, useState } from 'react';
import { useEditor } from '@editor/store';
import { simRuntime } from '@editor/sim-runtime';
import type { DeviceView, SimView } from '@core/sim';
import { onBack } from './back-button';
import { Devices, HoldButton, Oled, Serial, useSimView } from './panels/SimPanel';

/*
 * Симуляция во весь экран: крупно экраны, энкодер, кнопки и список деталей. Открывается
 * поверх редактора и просит у браузера полноэкранный режим; «Назад» на телефоне закрывает.
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
        <button className="btn" onClick={() => simRuntime.start()} title="Сначала: сброс контроллера">
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
          {status === 'loading' ? 'Запуск симуляции…' : 'Нажмите «Старт».'}
        </div>
      ) : (
        <GenericLayout view={view} />
      )}
    </div>
  );
}


/** Пульт на корпусе: экран, энкодер, кнопки, зуммер. */
function Pult({ view }: { view: SimView }) {
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
      <p className="hint">Кнопки держатся, пока нажаты (долгое нажатие — как на настоящей), тумблеры переключаются касанием. Энкодер — стрелками, его кнопка — в середине.</p>
    </div>
  );
}

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
