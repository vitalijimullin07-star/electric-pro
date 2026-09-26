/*
 * Общее для контроллеров симуляции: выводы, режимы, интерфейс, через который схема
 * (circuit.ts) и детали (devices.ts) работают и с AVR (avr8js), и с ESP32 (ядро
 * прошивки в WebAssembly).
 */

export type PortLetter = 'A' | 'B' | 'C' | 'D';
type Bit = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
/** Выводы: AVR — порт и бит (ADC6/ADC7 — отдельные входы АЦП), ESP32 — IO0…IO39. */
export type McuPin = `P${PortLetter}${Bit}` | 'ADC6' | 'ADC7' | `IO${number}`;

export type PinMode = 'low' | 'high' | 'input' | 'pullup' | 'pulldown';

export type PinListener = (pin: McuPin, mode: PinMode, cycle: number) => void;

export type McuKind = 'atmega328p' | 'atmega32' | 'esp32';

export const MCU_TITLES: Record<McuKind, string> = { atmega328p: 'ATmega328P', atmega32: 'ATmega32A', esp32: 'ESP32' };

/** Контроллер для схемы: время в «тактах» (у ESP32 такт — микросекунда), выводы, АЦП. */
export interface SimMcu {
  readonly kind: McuKind;
  readonly title: string;
  /** Тактов в секунду. */
  readonly freq: number;
  readonly cycles: number;
  /** Напряжение питания выводов, В. */
  readonly vdd: number;
  /** Опорное напряжение АЦП снаружи (AREF на питании), только AVR. */
  forcedRef: number | null;
  onPin(l: PinListener): void;
  pinMode(pin: McuPin): PinMode;
  /** Уровень на входе (что прочитает digitalRead). */
  setInput(pin: McuPin, high: boolean): void;
  /** Вывод на цепи, которую выход не пересилит: читается её уровень. null — отпустить. */
  forcePin(pin: McuPin, high: boolean | null): void;
  /** Напряжение для АЦП, В (ESP32 читает напряжение сам в момент измерения). */
  setAnalog(pin: McuPin, volts: number): void;
  /** Вызвать fn через cycles тактов. */
  schedule(fn: () => void, cycles: number): void;
  run(cycles: number): void;
}
