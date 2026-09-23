import { useEffect, useState } from 'react';
import { fmt, parseLen } from '@core/units';

/** Поле длины в мм: принимает запятую, единицы mil и in, применяет по Enter или потере фокуса. */
export function LenInput({ value, onChange, min, className = 'inp', disabled, placeholder }: { value: number; onChange: (v: number) => void; min?: number; className?: string; disabled?: boolean; placeholder?: string }) {
  const [text, setText] = useState(fmt(value, 3));
  useEffect(() => setText(fmt(value, 3)), [value]);
  const apply = () => {
    const v = parseLen(text);
    if (v === null || (min !== undefined && v < min)) {
      setText(fmt(value, 3));
      return;
    }
    if (Math.abs(v - value) > 1e-9) onChange(+v.toFixed(4));
    else setText(fmt(value, 3));
  };
  return (
    <input
      className={className}
      value={text}
      disabled={disabled}
      placeholder={placeholder}
      inputMode="decimal"
      onChange={(e) => setText(e.target.value)}
      onBlur={apply}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setText(fmt(value, 3));
        e.stopPropagation();
      }}
    />
  );
}

export function TextInput({ value, onChange, className = 'inp', placeholder, list }: { value: string; onChange: (v: string) => void; className?: string; placeholder?: string; list?: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <input
      className={className}
      value={text}
      placeholder={placeholder}
      list={list}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text !== value && onChange(text)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        e.stopPropagation();
      }}
    />
  );
}
