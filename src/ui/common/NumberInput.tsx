import { useEffect, useState } from 'react';
import { fmt, fmtLen, fromMm, parseLen, UNIT_LABEL, type DisplayUnit } from '@core/units';
import { useEditor } from '@editor/store';

/** Единицы отображения из строки состояния: подпись и форматирование длины. */
export function useUnits(): { unit: DisplayUnit; label: string; len: (mm: number, digits?: number) => string } {
  const unit = useEditor((s) => s.units);
  return { unit, label: UNIT_LABEL[unit], len: (mm, digits) => fmtLen(mm, unit, digits) };
}

const digitsFor = (u: DisplayUnit) => (u === 'mm' ? 3 : u === 'mil' ? 1 : 4);

/**
 * Поле длины. Значение хранится в мм, показывается и вводится в выбранных единицах;
 * можно явно дописать единицы: «0,5 мм», «20 mil», «0,1 in». Применяется по Enter или потере фокуса.
 */
/** Поле длины в текущих единицах. value = null — значений несколько (поле пустое, видна подсказка). */
export function LenInput({ value, onChange, min, className = 'inp', disabled, placeholder }: { value: number | null; onChange: (v: number) => void; min?: number; className?: string; disabled?: boolean; placeholder?: string }) {
  const unit = useEditor((s) => s.units);
  const show = (v: number | null) => (v === null ? '' : fmt(fromMm(v, unit), digitsFor(unit)));
  const [text, setText] = useState(show(value));
  useEffect(() => setText(show(value)), [value, unit]); // eslint-disable-line react-hooks/exhaustive-deps
  const apply = () => {
    // Текст не трогали — значение не меняем (иначе округление показа молча портило бы его).
    if (text === show(value)) return;
    const v = parseLen(text, unit);
    if (v === null || (min !== undefined && v < min - 1e-9)) {
      setText(show(value));
      return;
    }
    if (value === null || Math.abs(v - value) > 1e-9) onChange(+v.toFixed(4));
    else setText(show(value));
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
        if (e.key === 'Escape') setText(show(value));
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
      onBlur={() => {
        // Если значение не приняли (например, занятое обозначение), поле возвращается к прежнему.
        if (text !== value) onChange(text);
        setText(value);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        e.stopPropagation();
      }}
    />
  );
}
