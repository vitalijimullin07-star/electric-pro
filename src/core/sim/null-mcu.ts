import type { Component, FootprintDef } from '../model/types';
import type { McuFound } from './circuit';
import type { McuPin, PinListener, PinMode, SimMcu } from './types';

/*
 * «Контроллер» для схемы без контроллера: у него нет выводов, он только отсчитывает время
 * (такт — микросекунда) и вызывает отложенные события. Так симуляция схемы на 555, ОУ,
 * транзисторах и реле идёт тем же путём, что и с прошивкой: логическая схема, детали,
 * аналоговый расчёт.
 */

export class NullMcu implements SimMcu {
  readonly kind = 'none' as const;
  readonly title = 'без контроллера';
  readonly freq = 1_000_000;
  readonly vdd = 5;
  forcedRef: number | null = null;
  private now = 0;
  /** Отложенные события по возрастанию времени. */
  private queue: { at: number; fn: () => void }[] = [];

  get cycles(): number {
    return this.now;
  }
  onPin(_l: PinListener): void {}
  pinMode(_pin: McuPin): PinMode {
    return 'input';
  }
  setInput(): void {}
  forcePin(): void {}
  setAnalog(): void {}

  schedule(fn: () => void, cycles: number): void {
    const at = this.now + Math.max(1, Math.round(cycles));
    let i = this.queue.length;
    while (i > 0 && this.queue[i - 1].at > at) i--;
    this.queue.splice(i, 0, { at, fn });
  }

  run(cycles: number): void {
    const end = this.now + Math.max(0, Math.round(cycles));
    while (this.queue.length && this.queue[0].at <= end) {
      const ev = this.queue.shift()!;
      this.now = Math.max(this.now, ev.at);
      ev.fn();
    }
    this.now = end;
  }
}

/** Пустая «находка контроллера» для схемы без него: деталь-заглушка без выводов. */
export function noMcuFound(): McuFound {
  const fp: FootprintDef = { id: '__no_mcu__', name: 'без контроллера', category: '', pads: [], graphics: [], courtyard: { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } } } as unknown as FootprintDef;
  const comp: Component = { id: '__no_mcu__', ref: '', value: '', footprint: '__no_mcu__', at: { x: 0, y: 0 }, rotation: 0, side: 'top', padNets: {} };
  return { comp, fp, pins: new Map(), kind: 'none', freq: 1_000_000, freqFrom: 'без контроллера' };
}
