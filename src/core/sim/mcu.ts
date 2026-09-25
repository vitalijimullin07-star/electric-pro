import { AVRADC, AVRClock, AVRIOPort, AVRSPI, AVRTimer, AVRTWI, AVRUSART, AVREEPROM, EEPROMMemoryBackend, CPU, PinState, adcConfig, avrInstruction, clockConfig, eepromConfig, portBConfig, portCConfig, portDConfig, spiConfig, timer0Config, timer1Config, timer2Config, twiConfig, usart0Config } from 'avr8js';
import { flashWords, parseHex } from './hex';

/*
 * ATmega328P (Arduino Uno, Nano, Pro Mini) на эмуляторе avr8js: процессор, порты,
 * таймеры с ШИМ, UART, АЦП, I²C, SPI, EEPROM. Время считается в тактах: 16 МГц.
 */

export const MCU_FREQ = 16_000_000;

/** Выводы контроллера: порт и бит. */
export type McuPin = `P${'B' | 'C' | 'D'}${0 | 1 | 2 | 3 | 4 | 5 | 6 | 7}` | 'ADC6' | 'ADC7';

export type PinMode = 'low' | 'high' | 'input' | 'pullup';

export type PinListener = (pin: McuPin, mode: PinMode, cycle: number) => void;

/** Выводы Arduino → выводы контроллера. */
export const ARDUINO_PINS: Record<string, McuPin> = {
  D0: 'PD0', D1: 'PD1', D2: 'PD2', D3: 'PD3', D4: 'PD4', D5: 'PD5', D6: 'PD6', D7: 'PD7',
  D8: 'PB0', D9: 'PB1', D10: 'PB2', D11: 'PB3', D12: 'PB4', D13: 'PB5',
  A0: 'PC0', A1: 'PC1', A2: 'PC2', A3: 'PC3', A4: 'PC4', A5: 'PC5', A6: 'ADC6', A7: 'ADC7',
};

/** Имя вывода для людей: D13 (PB5). */
export function pinTitle(pin: McuPin): string {
  const ard = Object.entries(ARDUINO_PINS).find(([, p]) => p === pin)?.[0];
  return ard ? `${ard} (${pin})` : pin;
}

const MODE: Record<PinState, PinMode> = { [PinState.Low]: 'low', [PinState.High]: 'high', [PinState.Input]: 'input', [PinState.InputPullUp]: 'pullup' };

export class Atmega328 {
  readonly cpu: CPU;
  readonly ports: Record<'B' | 'C' | 'D', AVRIOPort>;
  readonly usart: AVRUSART;
  readonly adc: AVRADC;
  readonly twi: AVRTWI;
  readonly spi: AVRSPI;
  readonly eeprom: AVREEPROM;
  private readonly timers: AVRTimer[];
  private listeners: PinListener[] = [];
  private last: Record<string, PinMode> = {};

  constructor(flash: Uint8Array) {
    const prog = new Uint8Array(0x8000).fill(0xff);
    prog.set(flash.subarray(0, 0x8000));
    this.cpu = new CPU(flashWords(prog));
    this.timers = [new AVRTimer(this.cpu, timer0Config), new AVRTimer(this.cpu, timer1Config), new AVRTimer(this.cpu, timer2Config)];
    new AVRClock(this.cpu, MCU_FREQ, clockConfig);
    this.ports = { B: new AVRIOPort(this.cpu, portBConfig), C: new AVRIOPort(this.cpu, portCConfig), D: new AVRIOPort(this.cpu, portDConfig) };
    this.usart = new AVRUSART(this.cpu, usart0Config, MCU_FREQ);
    this.adc = new AVRADC(this.cpu, adcConfig);
    this.twi = new AVRTWI(this.cpu, twiConfig, MCU_FREQ);
    this.spi = new AVRSPI(this.cpu, spiConfig, MCU_FREQ);
    this.eeprom = new AVREEPROM(this.cpu, new EEPROMMemoryBackend(1024), eepromConfig);
    for (const [name, port] of Object.entries(this.ports) as ['B' | 'C' | 'D', AVRIOPort][]) {
      port.addListener(() => {
        for (let i = 0; i < 8; i++) {
          const pin = `P${name}${i}` as McuPin;
          const m = MODE[port.pinState(i)];
          if (this.last[pin] === m) continue;
          this.last[pin] = m;
          for (const l of this.listeners) l(pin, m, this.cpu.cycles);
        }
      });
    }
    void this.timers;
  }

  static fromHex(text: string): Atmega328 {
    return new Atmega328(parseHex(text));
  }

  get cycles(): number {
    return this.cpu.cycles;
  }

  onPin(l: PinListener): void {
    this.listeners.push(l);
  }

  /** Состояние вывода: выход 0/1, вход, вход с подтяжкой. */
  pinMode(pin: McuPin): PinMode {
    if (pin === 'ADC6' || pin === 'ADC7') return 'input';
    return MODE[this.ports[pin[1] as 'B' | 'C' | 'D'].pinState(+pin[2])];
  }

  /** Уровень на входе (что прочитает digitalRead). */
  setInput(pin: McuPin, high: boolean): void {
    if (pin === 'ADC6' || pin === 'ADC7') return;
    this.ports[pin[1] as 'B' | 'C' | 'D'].setPin(+pin[2], high);
  }

  /** Напряжение для АЦП, В. */
  setAnalog(pin: McuPin, volts: number): void {
    const ch = pin === 'ADC6' ? 6 : pin === 'ADC7' ? 7 : pin[1] === 'C' ? +pin[2] : -1;
    if (ch >= 0) this.adc.channelValues[ch] = Math.max(0, Math.min(5, volts));
  }

  /** Выполнить не меньше cycles тактов. */
  run(cycles: number): void {
    const cpu = this.cpu;
    const end = cpu.cycles + cycles;
    while (cpu.cycles < end) {
      avrInstruction(cpu);
      cpu.tick();
    }
  }
}
