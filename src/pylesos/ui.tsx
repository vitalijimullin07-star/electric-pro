import { useEffect, useRef, useState, type ReactNode } from 'react';

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="card">
      <div className="card-h">
        <h2>{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

/** Крупное число с полосой (0…max). */
export function Gauge({ label, value, unit, max, dec = 0, mark }: { label: string; value: number; unit: string; max: number; dec?: number; mark?: number }) {
  const v = Number.isFinite(value) ? value : 0;
  return (
    <div className="gauge">
      <div className="g-label">{label}</div>
      <div className="g-val">
        {v.toLocaleString('ru', { maximumFractionDigits: dec, minimumFractionDigits: dec })}
        <small> {unit}</small>
      </div>
      <div className="g-bar">
        <i style={{ width: `${Math.max(0, Math.min(100, (v / max) * 100))}%` }} />
        {mark !== undefined && <b style={{ left: `${Math.max(0, Math.min(100, (mark / max) * 100))}%` }} />}
      </div>
    </div>
  );
}

export function Row({ k, v, warn }: { k: ReactNode; v: ReactNode; warn?: boolean }) {
  return (
    <div className={`row ${warn ? 'warn' : ''}`}>
      <span>{k}</span>
      <b>{v}</b>
    </div>
  );
}

export function Toggle({ label, on, onChange, hint }: { label: string; on: boolean; onChange: (on: boolean) => void; hint?: string }) {
  return (
    <label className="toggle">
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />
      <i />
    </label>
  );
}

/**
 * Число с кнопками − и + (и ползунком): своё значение показывается сразу, команда уходит через
 * 0,6 с после последнего нажатия; значение с пылесоса подхватывается, когда его не трогают.
 */
export function Stepper({
  label,
  value,
  min,
  max,
  step,
  unit,
  hint,
  onSet,
  slider,
  zero,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  hint?: string;
  onSet: (v: number) => void;
  slider?: boolean;
  zero?: string;
}) {
  const [v, setV] = useState(value);
  const touched = useRef(0);
  const timer = useRef<number>(0);
  useEffect(() => {
    if (Date.now() - touched.current > 2500) setV(value);
  }, [value]);
  const change = (x: number) => {
    const n = Math.max(min, Math.min(max, Math.round(x / step) * step));
    setV(n);
    touched.current = Date.now();
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => onSet(n), 600);
  };
  return (
    <div className="stepper">
      <div className="st-h">
        <span>
          {label}
          {hint && <small>{hint}</small>}
        </span>
        <b>
          {zero && v === 0 ? zero : `${v.toLocaleString('ru')}${unit ? ` ${unit}` : ''}`}
        </b>
      </div>
      <div className="st-c">
        <button onClick={() => change(v - step)} aria-label="меньше">
          −
        </button>
        {slider ? <input type="range" min={min} max={max} step={step} value={v} onChange={(e) => change(+e.target.value)} /> : <span className="st-fill" />}
        <button onClick={() => change(v + step)} aria-label="больше">
          +
        </button>
      </div>
    </div>
  );
}

/** Кнопка, которая просит подтверждение вторым нажатием. */
export function Confirm({ children, onClick, className = 'btn', ask = 'Точно? Нажмите ещё раз' }: { children: ReactNode; onClick: () => void; className?: string; ask?: string }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      className={`${className} ${armed ? 'armed' : ''}`}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onClick();
        } else setArmed(true);
      }}
    >
      {armed ? ask : children}
    </button>
  );
}
