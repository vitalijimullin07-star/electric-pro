/* Детали интерфейса приложения: значки, плитки, переключатели, ползунки с вводом, строки. */
import { useEffect, useState, type ReactNode } from 'react';

const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

export const Icon = {
  home: <svg width="22" height="22" viewBox="0 0 24 24" {...P} aria-hidden="true"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /></svg>,
  screen: <svg width="22" height="22" viewBox="0 0 24 24" {...P} aria-hidden="true"><rect x="3" y="5" width="18" height="12" rx="2" /><path d="M8 21h8M12 17v4" /></svg>,
  chart: <svg width="22" height="22" viewBox="0 0 24 24" {...P} aria-hidden="true"><path d="M3 20h18M5 16l4-6 4 3 6-8" /></svg>,
  log: <svg width="22" height="22" viewBox="0 0 24 24" {...P} aria-hidden="true"><path d="M6 4h12v16H6zM9 8h6M9 12h6M9 16h4" /></svg>,
  gear: <svg width="22" height="22" viewBox="0 0 24 24" {...P} aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2" /></svg>,
  back: <svg width="22" height="22" viewBox="0 0 24 24" {...P} strokeWidth={2} aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>,
  next: <svg width="16" height="16" viewBox="0 0 24 24" {...P} strokeWidth={2} aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>,
  down: <svg width="14" height="14" viewBox="0 0 24 24" {...P} strokeWidth={2} aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>,
  bolt: <svg width="20" height="20" viewBox="0 0 24 24" {...P} strokeWidth={2} aria-hidden="true"><path d="M13 2L4 14h7l-1 8 9-12h-7z" /></svg>,
  warn: <svg width="20" height="20" viewBox="0 0 24 24" {...P} strokeWidth={2} aria-hidden="true"><path d="M12 3l10 18H2zM12 10v5M12 18v.5" /></svg>,
  play: <svg width="20" height="20" viewBox="0 0 24 24" {...P} strokeWidth={2} aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M10 8l6 4-6 4z" /></svg>,
  set: <svg width="20" height="20" viewBox="0 0 24 24" {...P} strokeWidth={2} aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3" /></svg>,
  link: <svg width="20" height="20" viewBox="0 0 24 24" {...P} strokeWidth={2} aria-hidden="true"><path d="M7 7l10 10-5 5V2l5 5L7 17" /></svg>,
  search: <svg width="18" height="18" viewBox="0 0 24 24" {...P} strokeWidth={2} aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>,
  download: <svg width="18" height="18" viewBox="0 0 24 24" {...P} strokeWidth={2} aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M4 21h16" /></svg>,
  rotate: <svg width="22" height="22" viewBox="0 0 24 24" {...P} aria-hidden="true"><rect x="7" y="3" width="10" height="18" rx="2" /><path d="M3 9a9 9 0 0 1 4-5M21 15a9 9 0 0 1-4 5" /></svg>,
};

export function Tile({ label, value, unit, tone }: { label: string; value: string; unit?: string; tone?: 'ok' | 'warn' | 'bad' }) {
  return (
    <div className="tile">
      <div className="tile-l">{label}</div>
      <div className="tile-v">
        {value} {unit && <span className={`tile-u ${tone ?? ''}`}>{unit}</span>}
      </div>
    </div>
  );
}

export function Seg<T extends string | number>({ items, value, onPick, small }: { items: [T, string][]; value: T; onPick: (v: T) => void; small?: boolean }) {
  return (
    <div className={`seg ${small ? 'small' : ''}`} style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
      {items.map(([v, label]) => (
        <button key={String(v)} type="button" className={v === value ? 'on' : ''} onClick={() => onPick(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function Card({ title, children, className }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <>
      {title && <div className="group">{title}</div>}
      <section className={`card ${className ?? ''}`}>{children}</section>
    </>
  );
}

export function Row({ k, v, warn }: { k: string; v: ReactNode; warn?: boolean }) {
  return (
    <div className="row">
      <span className="muted">{k}</span>
      <span className={warn ? 'warn' : ''}>{v}</span>
    </div>
  );
}

export function Toggle({ label, hint, on, onChange }: { label: string; hint?: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="toggle">
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <input type="checkbox" role="switch" checked={on} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

/**
 * Параметр: ползунок + точный ввод числа; значение уходит в пылесос, когда отпустили. Показывает диапазон,
 * значение по умолчанию и что оно изменено.
 */
export function Param({
  label,
  hint,
  value,
  min,
  max,
  step,
  unit,
  def,
  zero,
  dec = 0,
  onSet,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  def?: number;
  zero?: string;
  dec?: number;
  onSet: (v: number) => void;
}) {
  const [v, setV] = useState(value);
  const [edit, setEdit] = useState(false);
  const [busy, setBusy] = useState(0);
  useEffect(() => {
    if (Date.now() - busy > 1500) setV(value);
  }, [value, busy]);
  const commit = (x: number) => {
    const c = Math.min(max, Math.max(min, Math.round(x / step) * step));
    setV(c);
    setBusy(Date.now());
    if (Math.abs(c - value) > step / 10) onSet(+c.toFixed(dec));
  };
  const shown = zero && v === 0 ? zero : `${v.toLocaleString('ru', { maximumFractionDigits: dec })}${unit ? ' ' + unit : ''}`;
  const changed = def !== undefined && Math.abs(v - def) > step / 10;
  return (
    <div className="param">
      <div className="param-h">
        <span>{label}</span>
        {edit ? (
          <input
            className="num"
            type="number"
            inputMode="decimal"
            defaultValue={v}
            autoFocus
            min={min}
            max={max}
            step={step}
            aria-label={label}
            onBlur={(e) => {
              setEdit(false);
              const x = Number(e.target.value.replace(',', '.'));
              if (Number.isFinite(x)) commit(x);
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        ) : (
          <button type="button" className={`val ${changed ? 'changed' : ''}`} onClick={() => setEdit(true)}>
            {shown}
          </button>
        )}
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={v}
        aria-label={label}
        onChange={(e) => setV(Number(e.target.value))}
        onPointerUp={(e) => commit(Number((e.target as HTMLInputElement).value))}
        onKeyUp={(e) => commit(Number((e.target as HTMLInputElement).value))}
      />
      <small className="muted">
        {min.toLocaleString('ru')}–{max.toLocaleString('ru')}
        {unit ? ' ' + unit : ''}
        {def !== undefined && ` · по умолчанию ${zero && def === 0 ? zero : def.toLocaleString('ru')}`}
        {hint && ` · ${hint}`}
      </small>
    </div>
  );
}

/** Кнопка с подтверждением вторым нажатием. */
export function Confirm({ children, onClick, className }: { children: ReactNode; onClick: () => void; className?: string }) {
  const [ask, setAsk] = useState(false);
  useEffect(() => {
    if (!ask) return;
    const t = setTimeout(() => setAsk(false), 3000);
    return () => clearTimeout(t);
  }, [ask]);
  return (
    <button
      type="button"
      className={`${className ?? 'btn'} ${ask ? 'ask' : ''}`}
      onClick={() => {
        if (ask) {
          setAsk(false);
          onClick();
        } else setAsk(true);
      }}
    >
      {ask ? 'Точно? Нажмите ещё раз' : children}
    </button>
  );
}
