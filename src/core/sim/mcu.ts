import {
  ADCMuxInputType,
  ADCReference,
  AVRADC,
  AVRClock,
  AVRIOPort,
  AVRSPI,
  AVRTimer,
  AVRTWI,
  AVRUSART,
  AVREEPROM,
  CPU,
  EEPROMMemoryBackend,
  PinState,
  adcConfig,
  avrInstruction,
  clockConfig,
  eepromConfig,
  portBConfig,
  portCConfig,
  portDConfig,
  spiConfig,
  timer0Config,
  timer1Config,
  timer2Config,
  twiConfig,
  usart0Config,
  type ADCConfig,
  type ADCMuxConfiguration,
  type ADCMuxInput,
  type AVRPortConfig,
  type AVRTimerConfig,
} from 'avr8js';
import { flashWords, parseHex } from './hex';

/*
 * Контроллеры AVR на эмуляторе avr8js:
 *   ATmega328P (Arduino Uno, Nano, Pro Mini) — порты B, C, D;
 *   ATmega32A/ATmega16A (DIP-40, TQFP-44) — порты A…D, свой набор регистров.
 * Время считается в тактах; частота — по кварцу схемы (Arduino — 16 МГц).
 */

/** Частота Arduino по умолчанию. */
export const MCU_FREQ = 16_000_000;

export type PortLetter = 'A' | 'B' | 'C' | 'D';
type Bit = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
/** Выводы контроллера: порт и бит (ADC6/ADC7 — отдельные входы АЦП у ATmega328P в TQFP). */
export type McuPin = `P${PortLetter}${Bit}` | 'ADC6' | 'ADC7';

export type PinMode = 'low' | 'high' | 'input' | 'pullup';

export type PinListener = (pin: McuPin, mode: PinMode, cycle: number) => void;

export type McuKind = 'atmega328p' | 'atmega32';

export const MCU_TITLES: Record<McuKind, string> = { atmega328p: 'ATmega328P', atmega32: 'ATmega32A' };

/** Выводы Arduino → выводы контроллера. */
export const ARDUINO_PINS: Record<string, McuPin> = {
  D0: 'PD0', D1: 'PD1', D2: 'PD2', D3: 'PD3', D4: 'PD4', D5: 'PD5', D6: 'PD6', D7: 'PD7',
  D8: 'PB0', D9: 'PB1', D10: 'PB2', D11: 'PB3', D12: 'PB4', D13: 'PB5',
  A0: 'PC0', A1: 'PC1', A2: 'PC2', A3: 'PC3', A4: 'PC4', A5: 'PC5', A6: 'ADC6', A7: 'ADC7',
};

/** Имя вывода для людей: D13 (PB5) у Arduino, просто PB5 у остальных. */
export function pinTitle(pin: McuPin, kind: McuKind = 'atmega328p'): string {
  if (kind !== 'atmega328p') return pin;
  const ard = Object.entries(ARDUINO_PINS).find(([, p]) => p === pin)?.[0];
  return ard ? `${ard} (${pin})` : pin;
}

const MODE: Record<PinState, PinMode> = { [PinState.Low]: 'low', [PinState.High]: 'high', [PinState.Input]: 'input', [PinState.InputPullUp]: 'pullup' };

/* ---------------- ATmega32A: адреса регистров (адреса в памяти данных) ---------------- */

// Регистры, которых у ATmega32 нет, но которые ждёт avr8js: кладём за конец ОЗУ (0x860…),
// прошивка туда не пишет.
const V = { T0A: 0x900, T0B: 0x901, T0OCRB: 0x902, T2A: 0x903, T2B: 0x904, T2OCRB: 0x905, ADCSRB: 0x906, DIDR0: 0x907, TWAMR: 0x908, UCSRC: 0x909, UBRRH: 0x90a };
const M32 = {
  TIFR: 0x58,
  TIMSK: 0x59,
  TCCR0: 0x53,
  TCCR2: 0x45,
  UBRRH_UCSRC: 0x40,
};
const port32 = (PIN: number): AVRPortConfig => ({ PIN, DDR: PIN + 1, PORT: PIN + 2, externalInterrupts: [] });
const PORTS32: Record<PortLetter, AVRPortConfig> = { A: port32(0x39), B: port32(0x36), C: port32(0x33), D: port32(0x30) };
const dividers01 = { 0: 0, 1: 1, 2: 8, 3: 64, 4: 256, 5: 1024, 6: 0, 7: 0 };
const noC = { OCRC: 0, TCCRC: 0, compCInterrupt: 0, compPortC: 0, compPinC: 0, OCFC: 0, OCIEC: 0 };
const timer0_32: AVRTimerConfig = {
  ...noC,
  bits: 8,
  captureInterrupt: 0,
  compAInterrupt: 0x14,
  compBInterrupt: 0,
  ovfInterrupt: 0x16,
  TIFR: M32.TIFR,
  TIMSK: M32.TIMSK,
  OCRA: 0x5c,
  OCRB: V.T0OCRB,
  ICR: 0,
  TCNT: 0x52,
  TCCRA: V.T0A,
  TCCRB: V.T0B,
  dividers: dividers01,
  compPortA: PORTS32.B.PORT,
  compPinA: 3,
  compPortB: 0,
  compPinB: 0,
  externalClockPort: PORTS32.B.PORT,
  externalClockPin: 0,
  TOV: 0x01,
  OCFA: 0x02,
  OCFB: 0,
  TOIE: 0x01,
  OCIEA: 0x02,
  OCIEB: 0,
};
const timer1_32: AVRTimerConfig = {
  ...noC,
  bits: 16,
  captureInterrupt: 0x0c,
  compAInterrupt: 0x0e,
  compBInterrupt: 0x10,
  ovfInterrupt: 0x12,
  TIFR: M32.TIFR,
  TIMSK: M32.TIMSK,
  OCRA: 0x4a,
  OCRB: 0x48,
  ICR: 0x46,
  TCNT: 0x4c,
  TCCRA: 0x4f,
  TCCRB: 0x4e,
  dividers: dividers01,
  compPortA: PORTS32.D.PORT,
  compPinA: 5,
  compPortB: PORTS32.D.PORT,
  compPinB: 4,
  externalClockPort: PORTS32.B.PORT,
  externalClockPin: 1,
  TOV: 0x04,
  OCFA: 0x10,
  OCFB: 0x08,
  TOIE: 0x04,
  OCIEA: 0x10,
  OCIEB: 0x08,
};
const timer2_32: AVRTimerConfig = {
  ...noC,
  bits: 8,
  captureInterrupt: 0,
  compAInterrupt: 0x08,
  compBInterrupt: 0,
  ovfInterrupt: 0x0a,
  TIFR: M32.TIFR,
  TIMSK: M32.TIMSK,
  OCRA: 0x43,
  OCRB: V.T2OCRB,
  ICR: 0,
  TCNT: 0x44,
  TCCRA: V.T2A,
  TCCRB: V.T2B,
  dividers: { 0: 0, 1: 1, 2: 8, 3: 32, 4: 64, 5: 128, 6: 256, 7: 1024 },
  compPortA: PORTS32.D.PORT,
  compPinA: 7,
  compPortB: 0,
  compPinB: 0,
  externalClockPort: 0,
  externalClockPin: 0,
  TOV: 0x40,
  OCFA: 0x80,
  OCFB: 0,
  TOIE: 0x40,
  OCIEA: 0x80,
  OCIEB: 0,
};

/** Входы АЦП ATmega32: 0…7 — обычные, 8…0x1D — разностные с усилением, 0x1E — 1,22 В, 0x1F — земля. */
function channels32(): ADCMuxConfiguration {
  const ch: ADCMuxConfiguration = {};
  for (let i = 0; i < 8; i++) ch[i] = { type: ADCMuxInputType.SingleEnded, channel: i };
  const diff = (n: number, p: number, m: number, gain: number) => (ch[n] = { type: ADCMuxInputType.Differential, positiveChannel: p, negativeChannel: m, gain });
  diff(0x08, 0, 0, 10);
  diff(0x09, 1, 0, 10);
  diff(0x0a, 0, 0, 200);
  diff(0x0b, 1, 0, 200);
  diff(0x0c, 2, 2, 10);
  diff(0x0d, 3, 2, 10);
  diff(0x0e, 2, 2, 200);
  diff(0x0f, 3, 2, 200);
  for (let i = 0; i < 8; i++) diff(0x10 + i, i, 1, 1);
  for (let i = 0; i < 6; i++) diff(0x18 + i, i, 2, 1);
  ch[0x1e] = { type: ADCMuxInputType.Constant, voltage: 1.22 };
  ch[0x1f] = { type: ADCMuxInputType.Constant, voltage: 0 };
  return ch;
}

const adc32: ADCConfig = {
  ADMUX: 0x27,
  ADCSRA: 0x26,
  ADCSRB: V.ADCSRB,
  ADCL: 0x24,
  ADCH: 0x25,
  DIDR0: V.DIDR0,
  adcInterrupt: 0x20,
  numChannels: 8,
  muxInputMask: 0x1f,
  muxChannels: channels32(),
  adcReferences: [ADCReference.AREF, ADCReference.AVCC, ADCReference.Reserved, ADCReference.Internal2V56],
};

/* ---------------- контроллер ---------------- */

export class Avr {
  readonly cpu: CPU;
  readonly ports: Partial<Record<PortLetter, AVRIOPort>>;
  readonly usart: AVRUSART;
  readonly adc: AVRADC;
  readonly twi: AVRTWI;
  readonly spi: AVRSPI;
  readonly eeprom: AVREEPROM;
  readonly title: string;
  /** Опорное напряжение АЦП снаружи (AREF соединён с питанием) — перекрывает встроенное. */
  forcedRef: number | null = null;
  private readonly timers: AVRTimer[];
  private listeners: PinListener[] = [];
  private last: Record<string, PinMode> = {};
  /** Выводы, уровень которых задаёт схема сильнее выхода (сидят на питании): маска и значение по портам. */
  private forced: Partial<Record<PortLetter, { mask: number; value: number }>> = {};

  constructor(
    readonly kind: McuKind,
    flash: Uint8Array,
    readonly freq = MCU_FREQ,
  ) {
    this.title = MCU_TITLES[kind];
    const prog = new Uint8Array(0x8000).fill(0xff);
    prog.set(flash.subarray(0, 0x8000));
    if (kind === 'atmega328p') {
      this.cpu = new CPU(flashWords(prog));
      this.timers = [new AVRTimer(this.cpu, timer0Config), new AVRTimer(this.cpu, timer1Config), new AVRTimer(this.cpu, timer2Config)];
      new AVRClock(this.cpu, freq, clockConfig);
      this.ports = { B: new AVRIOPort(this.cpu, portBConfig), C: new AVRIOPort(this.cpu, portCConfig), D: new AVRIOPort(this.cpu, portDConfig) };
      this.usart = new AVRUSART(this.cpu, usart0Config, freq);
      this.adc = new AVRADC(this.cpu, adcConfig);
      this.twi = new AVRTWI(this.cpu, twiConfig, freq);
      this.spi = new AVRSPI(this.cpu, spiConfig, freq);
      this.eeprom = new AVREEPROM(this.cpu, new EEPROMMemoryBackend(1024), eepromConfig);
    } else {
      // 2 КБ ОЗУ (0x60…0x85F) и место под служебные регистры за ним.
      this.cpu = new CPU(flashWords(prog), 0x900);
      this.ports = { A: new AVRIOPort(this.cpu, PORTS32.A), B: new AVRIOPort(this.cpu, PORTS32.B), C: new AVRIOPort(this.cpu, PORTS32.C), D: new AVRIOPort(this.cpu, PORTS32.D) };
      this.timers = [new AVRTimer(this.cpu, timer0_32), new AVRTimer(this.cpu, timer1_32), new AVRTimer(this.cpu, timer2_32)];
      this.shareTimerFlags();
      this.singleControl(M32.TCCR0, V.T0A, V.T0B);
      this.singleControl(M32.TCCR2, V.T2A, V.T2B);
      this.usart = new AVRUSART(this.cpu, { rxCompleteInterrupt: 0x1a, dataRegisterEmptyInterrupt: 0x1c, txCompleteInterrupt: 0x1e, UCSRA: 0x2b, UCSRB: 0x2a, UCSRC: V.UCSRC, UBRRL: 0x29, UBRRH: V.UBRRH, UDR: 0x2c }, freq);
      this.sharedUbrrh();
      this.adc = new AVRADC(this.cpu, adc32);
      this.twi = new AVRTWI(this.cpu, { twiInterrupt: 0x26, TWBR: 0x20, TWSR: 0x21, TWAR: 0x22, TWDR: 0x23, TWCR: 0x56, TWAMR: V.TWAMR }, freq);
      this.spi = new AVRSPI(this.cpu, { spiInterrupt: 0x18, SPCR: 0x2d, SPSR: 0x2e, SPDR: 0x2f }, freq);
      this.eeprom = new AVREEPROM(this.cpu, new EEPROMMemoryBackend(1024), { ...eepromConfig, eepromReadyInterrupt: 0x22, EECR: 0x3c, EEDR: 0x3d, EEARL: 0x3e, EEARH: 0x3f });
      this.adc.avcc = 5;
      this.adc.aref = 5;
    }
    this.adc.onADCRead = (input) => this.adcRead(input);
    for (const t of this.timers) fixPhasePwmStart(t);
    // Чтение PINx с учётом выводов, которые схема держит сильнее выхода.
    const pinRegs: Record<string, number> = this.kind === 'atmega328p' ? { B: portBConfig.PIN, C: portCConfig.PIN, D: portDConfig.PIN } : { A: PORTS32.A.PIN, B: PORTS32.B.PIN, C: PORTS32.C.PIN, D: PORTS32.D.PIN };
    for (const [letter, addr] of Object.entries(pinRegs)) {
      this.cpu.readHooks[addr] = () => {
        const f = this.forced[letter as PortLetter];
        const v = this.cpu.data[addr];
        return f ? (v & ~f.mask) | (f.value & f.mask) : v;
      };
    }
    for (const [name, port] of Object.entries(this.ports) as [PortLetter, AVRIOPort][]) {
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
  }

  /** Три таймера ATmega32 делят регистры флагов и масок прерываний. */
  private shareTimerFlags(): void {
    const cpu = this.cpu;
    type Irq = Parameters<CPU['clearInterruptByFlag']>[0];
    const irqs: Irq[] = [];
    for (const t of this.timers) {
      const x = t as unknown as { OVF: Irq; OCFA: Irq; OCFB: Irq };
      for (const i of [x.OVF, x.OCFA, x.OCFB]) if (i.flagMask) irqs.push(i);
    }
    // Запись единицы сбрасывает флаг, нули ничего не меняют.
    cpu.writeHooks[M32.TIFR] = (value) => {
      for (const i of irqs) cpu.clearInterruptByFlag(i, value);
      return true;
    };
    cpu.writeHooks[M32.TIMSK] = (value) => {
      cpu.data[M32.TIMSK] = value;
      for (const i of irqs) cpu.updateInterruptEnable(i, value);
      return true;
    };
  }

  /**
   * У таймеров 0 и 2 ATmega32 один управляющий регистр TCCRn: FOC WGM0 COM1 COM0 WGM1 CS2 CS1 CS0.
   * avr8js ждёт пару TCCRnA/TCCRnB, как у ATmega328P, — раскладываем запись по ним.
   */
  private singleControl(real: number, va: number, vb: number): void {
    const cpu = this.cpu;
    cpu.writeHooks[real] = (value) => {
      const wgm = ((value >> 6) & 1) | (((value >> 3) & 1) << 1);
      const com = (value >> 4) & 3;
      cpu.data[real] = value & 0x7f;
      cpu.writeHooks[va]!((com << 6) | wgm, cpu.data[va], va, 0xff);
      cpu.writeHooks[vb]!((value & 7) | (value & 0x80), cpu.data[vb], vb, 0xff);
      return true;
    };
  }

  /** UBRRH и UCSRC ATmega32 живут по одному адресу: выбирает старший бит URSEL. */
  private sharedUbrrh(): void {
    const cpu = this.cpu;
    cpu.writeHooks[M32.UBRRH_UCSRC] = (value) => {
      const target = value & 0x80 ? V.UCSRC : V.UBRRH;
      const v = value & 0x80 ? value & 0x7f : value & 0x0f;
      const hook = cpu.writeHooks[target];
      if (!hook || !hook(v, cpu.data[target], target, 0xff)) cpu.data[target] = v;
      cpu.data[M32.UBRRH_UCSRC] = value;
      return true;
    };
  }

  /** Чтение АЦП: разностные каналы ATmega32 дают знаковое 10-битное число. */
  private adcRead(input: ADCMuxInput): void {
    const adc = this.adc;
    const v = (ch: number) => adc.channelValues[ch] ?? 0;
    const ref = this.forcedRef ?? adc.referenceVoltage;
    let result: number;
    if (input.type === ADCMuxInputType.Differential) {
      const x = Math.round(((v(input.positiveChannel) - v(input.negativeChannel)) * input.gain * 512) / ref);
      result = Math.max(-512, Math.min(511, x)) & 0x3ff;
    } else {
      const volts = input.type === ADCMuxInputType.Constant ? input.voltage : input.type === ADCMuxInputType.SingleEnded ? v(input.channel) : 0.378125;
      result = Math.min(1023, Math.max(0, Math.floor((volts / ref) * 1024)));
    }
    this.cpu.addClockEvent(() => adc.completeADCRead(result), adc.sampleCycles);
  }

  static fromHex(text: string, kind: McuKind = 'atmega328p', freq = MCU_FREQ): Avr {
    return new Avr(kind, parseHex(text), freq);
  }

  get cycles(): number {
    return this.cpu.cycles;
  }

  onPin(l: PinListener): void {
    this.listeners.push(l);
  }

  private port(pin: McuPin): AVRIOPort | undefined {
    return pin.length === 3 ? this.ports[pin[1] as PortLetter] : undefined;
  }

  /** Есть ли такой вывод у этого контроллера. */
  hasPin(pin: McuPin): boolean {
    return !!this.port(pin) || (this.kind === 'atmega328p' && (pin === 'ADC6' || pin === 'ADC7'));
  }

  /** Состояние вывода: выход 0/1, вход, вход с подтяжкой. */
  pinMode(pin: McuPin): PinMode {
    const p = this.port(pin);
    return p ? MODE[p.pinState(+pin[2])] : 'input';
  }

  /** Уровень на входе (что прочитает digitalRead). */
  setInput(pin: McuPin, high: boolean): void {
    this.port(pin)?.setPin(+pin[2], high);
  }

  /** Вывод сидит на цепи, которую выход не пересилит (питание, шунт): читается её уровень. null — отпустить. */
  forcePin(pin: McuPin, high: boolean | null): void {
    if (pin.length !== 3) return;
    const letter = pin[1] as PortLetter;
    const bit = 1 << +pin[2];
    const f = (this.forced[letter] ??= { mask: 0, value: 0 });
    if (high === null) f.mask &= ~bit;
    else {
      f.mask |= bit;
      f.value = high ? f.value | bit : f.value & ~bit;
    }
  }

  /** Канал АЦП вывода или −1. */
  adcChannel(pin: McuPin): number {
    if (pin === 'ADC6') return 6;
    if (pin === 'ADC7') return 7;
    const port = this.kind === 'atmega328p' ? 'C' : 'A';
    const bit = +pin[2];
    return pin[1] === port && (this.kind !== 'atmega328p' || bit <= 5) ? bit : -1;
  }

  /** Напряжение для АЦП, В. */
  setAnalog(pin: McuPin, volts: number): void {
    const ch = this.adcChannel(pin);
    if (ch >= 0) this.adc.channelValues[ch] = Math.max(0, Math.min(5.5, volts));
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

/** Arduino Uno/Nano/Pro Mini: ATmega328P на 16 МГц. */
export class Atmega328 extends Avr {
  constructor(flash: Uint8Array) {
    super('atmega328p', flash, MCU_FREQ);
  }
  static override fromHex(text: string): Atmega328 {
    return new Atmega328(parseHex(text));
  }
}

/**
 * Исправление avr8js: в ШИМ с коррекцией фазы (режимы 8–11 таймера 1) новые OCR
 * записываются в буфер и переносятся «на дне» счёта. Если OCR1A (вершина) был 0,
 * а прошивка записала его до запуска таймера, счётчик стоит на нуле и до переноса
 * дело не доходит — звук «Квазара» (режим 9) молчал. Настоящий кристалл переносит
 * буфер на дне, то есть сразу.
 */
function fixPhasePwmStart(t: AVRTimer): void {
  const x = t as unknown as { phasePwmCount(value: number, delta: number): number; ocrA: number; ocrB: number; ocrC: number; nextOcrA: number; nextOcrB: number; nextOcrC: number };
  const orig = x.phasePwmCount.bind(t);
  x.phasePwmCount = (value: number, delta: number) => {
    if (!value && !x.ocrA && x.nextOcrA) {
      x.ocrA = x.nextOcrA;
      x.ocrB = x.nextOcrB;
      x.ocrC = x.nextOcrC;
    }
    return orig(value, delta);
  };
}
