import type { Component, FootprintDef, Id, Project } from '../model/types';
import { ARDUINO_PINS, Atmega328, type McuPin, type PinMode } from './mcu';

/*
 * Схема для симуляции на уровне логики: цепи проекта объединяются в группы (резистор
 * между двумя сигнальными цепями передаёт уровень), у каждой группы — уровень 0/1 и
 * напряжение для АЦП. Кто задаёт уровень, по старшинству:
 *   питание → выход контроллера → устройства (кнопка, датчик; «0» сильнее «1», как у
 *   открытого стока) → аналоговый источник → подтяжка резистором → подтяжка в контроллере.
 * Группа, которую никто не задаёт, «висит в воздухе» (читается как 0 и отмечается).
 */

export type Level = 0 | 1;
export type Power = 'gnd' | 'vcc' | null;

export interface GroupInfo {
  nets: Id[];
  name: string;
  power: Power;
  /** Подтяжка резистором к питанию (1) или к земле (0). */
  pull: Level | null;
  pins: McuPin[];
}

/** Имена выводов контроллера, которые означают питание. */
const MCU_GND = /^(GND|GNDL|GNDR|AGND|VSS)$/i;
const MCU_VCC = /^(5V|\+5V|VCC|VDD|AVCC|3V3|3\.3V|VIN|RAW|IOREF)$/i;
/** Цепи с такими именами — питание, даже если к контроллеру не подключены. */
const NET_GND = /^(GND|GNDA|GNDD|AGND|DGND|PGND|0V|VSS|-VO|ЗЕМЛЯ)$/i;
const NET_VCC = /^(\+?5V|\+?5VD|VCC|VDD|\+?3V3|\+?3\.3V|VIN|VBUS|\+?12V|\+?9V|\+?24V|VBAT|RAW|\+VO)$/i;

/** Имена выводов Arduino и ATmega328P → выводы контроллера (включая синонимы). */
export function mcuPinOf(name: string): McuPin | null {
  const n = name.toUpperCase().replace(/\s+/g, '');
  if (n in ARDUINO_PINS) return ARDUINO_PINS[n];
  const alias: Record<string, McuPin> = { RX: 'PD0', RX0: 'PD0', RXD: 'PD0', 'D0/RX': 'PD0', RX1: 'PD0', TX: 'PD1', TX0: 'PD1', TX1: 'PD1', TXD: 'PD1', 'D1/TX': 'PD1', SDA: 'PC4', SCL: 'PC5' };
  if (n in alias) return alias[n];
  if (/^P[BCD][0-7]$/.test(n)) return n as McuPin;
  return null;
}

/** Контроллеры, которые умеет симуляция: Arduino Uno/Nano/Pro Mini и ATmega328P. */
export function findMcu(p: Project): { comp: Component; fp: FootprintDef; pins: Map<string, McuPin> } | null {
  let best: { comp: Component; fp: FootprintDef; pins: Map<string, McuPin> } | null = null;
  for (const c of Object.values(p.components)) {
    const fp = p.footprints[c.footprint];
    if (!fp) continue;
    // Модули ESP32/ESP8266/STM32 не подходят, даже если выводы названы D0…D8.
    if (/esp|stm32|pico|rp2040|teensy|xiao|atmega16|atmega32_|attiny|digispark|32u4|micro/i.test(fp.id + ' ' + (fp.tags ?? []).join(' '))) continue;
    const pins = new Map<string, McuPin>();
    for (const pad of fp.pads) {
      const m = pad.name ? mcuPinOf(pad.name) : null;
      if (m) pins.set(pad.number, m);
    }
    const distinct = new Set(pins.values()).size;
    if (distinct >= 8 && (!best || distinct > new Set(best.pins.values()).size)) best = { comp: c, fp, pins };
  }
  return best;
}

interface Trace {
  t: number[];
  v: Level[];
}

export class Circuit {
  readonly mcu: Atmega328;
  readonly mcuComp: Component;
  readonly groups: GroupInfo[] = [];
  readonly netGroup = new Map<Id, number>();
  readonly pinGroup = new Map<McuPin, number>();
  private level: Level[] = [];
  private floating: boolean[] = [];
  private conflict: boolean[] = [];
  private drivers: Map<string, Level>[] = [];
  private analog: (number | null)[] = [];
  private listeners: ((g: number, lvl: Level, cycle: number) => void)[] = [];
  private mcuListeners: ((pin: McuPin, g: number, mode: PinMode, cycle: number) => void)[] = [];
  // Статистика кадра: время в «1» и число переключений.
  private highAcc: number[] = [];
  private lastEdge: number[] = [];
  private edges: number[] = [];
  private frameStart = 0;
  private traces = new Map<number, Trace>();

  constructor(
    readonly project: Project,
    mcu: Atmega328,
  ) {
    this.mcu = mcu;
    const found = findMcu(project);
    if (!found) throw new Error('На схеме нет Arduino Uno/Nano/Pro Mini или ATmega328P.');
    this.mcuComp = found.comp;
    this.buildGroups(found);
    mcu.onPin((pin, mode, cycle) => {
      const g = this.pinGroup.get(pin);
      if (g === undefined) return;
      for (const l of this.mcuListeners) l(pin, g, mode, cycle);
      this.resolve(g, cycle);
    });
    for (let g = 0; g < this.groups.length; g++) this.resolve(g, 0, true);
  }

  private buildGroups(found: { comp: Component; fp: FootprintDef; pins: Map<string, McuPin> }): void {
    const p = this.project;
    const power = new Map<Id, Power>();
    for (const n of Object.values(p.nets)) {
      if (NET_GND.test(n.name)) power.set(n.id, 'gnd');
      else if (NET_VCC.test(n.name)) power.set(n.id, 'vcc');
    }
    for (const pad of found.fp.pads) {
      const net = found.comp.padNets[pad.number];
      if (!net || !pad.name) continue;
      if (MCU_GND.test(pad.name)) power.set(net, 'gnd');
      else if (MCU_VCC.test(pad.name) && !power.has(net)) power.set(net, 'vcc');
    }
    // Объединение цепей через резисторы (кроме питания).
    const parent = new Map<Id, Id>();
    const find = (a: Id): Id => {
      let r = a;
      while (parent.get(r) !== undefined && parent.get(r) !== r) r = parent.get(r)!;
      parent.set(a, r);
      return r;
    };
    for (const n of Object.keys(p.nets)) parent.set(n, n);
    const pulls: [Id, Level][] = [];
    for (const c of Object.values(p.components)) {
      const fp = p.footprints[c.footprint];
      if (!fp || !isResistor(fp)) continue;
      const nets = fp.pads.filter((x) => x.type !== 'npth').map((x) => c.padNets[x.number]);
      if (nets.length !== 2 || !nets[0] || !nets[1] || nets[0] === nets[1]) continue;
      const [a, b] = nets as [Id, Id];
      const pa = power.get(a);
      const pb = power.get(b);
      if (pa && pb) continue;
      if (pa) pulls.push([b, pa === 'vcc' ? 1 : 0]);
      else if (pb) pulls.push([a, pb === 'vcc' ? 1 : 0]);
      else parent.set(find(a), find(b));
    }
    const rootGroup = new Map<Id, number>();
    for (const n of Object.values(p.nets)) {
      const root = power.has(n.id) ? n.id : find(n.id);
      let g = rootGroup.get(root);
      if (g === undefined) {
        g = this.groups.length;
        rootGroup.set(root, g);
        this.groups.push({ nets: [], name: n.name, power: power.get(n.id) ?? null, pull: null, pins: [] });
      }
      this.groups[g].nets.push(n.id);
      this.netGroup.set(n.id, g);
    }
    for (const [net, lvl] of pulls) {
      const g = this.netGroup.get(net);
      if (g !== undefined) this.groups[g].pull = lvl;
    }
    for (const [padNo, pin] of found.pins) {
      const net = found.comp.padNets[padNo];
      if (!net) continue;
      const g = this.netGroup.get(net)!;
      if (this.groups[g].power) continue;
      if (!this.pinGroup.has(pin)) {
        this.pinGroup.set(pin, g);
        if (!this.groups[g].pins.includes(pin)) this.groups[g].pins.push(pin);
      }
    }
    for (const g of this.groups) {
      g.nets.sort();
      // Имя группы — самая «человеческая» цепь: не автоматическая Net-(…).
      const names = g.nets.map((n) => p.nets[n].name);
      g.name = names.find((n) => !/^Net-/.test(n)) ?? names[0];
    }
    const n = this.groups.length;
    this.level = new Array(n).fill(0);
    this.floating = new Array(n).fill(false);
    this.conflict = new Array(n).fill(false);
    this.drivers = Array.from({ length: n }, () => new Map());
    this.analog = new Array(n).fill(null);
    this.highAcc = new Array(n).fill(0);
    this.lastEdge = new Array(n).fill(0);
    this.edges = new Array(n).fill(0);
  }

  /** Группа, к которой подключён вывод компонента. */
  groupOfPad(c: Component, pad: string): number | undefined {
    const net = c.padNets[pad];
    return net ? this.netGroup.get(net) : undefined;
  }

  levelOf(g: number): Level {
    return this.level[g];
  }
  isFloating(g: number): boolean {
    return this.floating[g];
  }
  isConflict(g: number): boolean {
    return this.conflict[g];
  }

  /** Напряжение группы, В: аналоговый источник или логический уровень. */
  voltsOf(g: number): number {
    const a = this.analog[g];
    const info = this.groups[g];
    if (info.power) return info.power === 'vcc' ? 5 : 0;
    const pins = info.pins.map((p) => this.mcu.pinMode(p));
    if (pins.some((m) => m === 'low' || m === 'high')) return this.level[g] ? 5 : 0;
    if (this.drivers[g].size) return this.level[g] ? 5 : 0;
    if (a !== null) return a;
    return this.level[g] ? 5 : 0;
  }

  onChange(l: (g: number, lvl: Level, cycle: number) => void): void {
    this.listeners.push(l);
  }
  onMcuPin(l: (pin: McuPin, g: number, mode: PinMode, cycle: number) => void): void {
    this.mcuListeners.push(l);
  }

  /** Устройство задаёт уровень (null — отпускает линию). */
  drive(g: number | undefined, owner: string, lvl: Level | null): void {
    if (g === undefined || this.groups[g].power) return;
    const d = this.drivers[g];
    if (lvl === null) {
      if (!d.has(owner)) return;
      d.delete(owner);
    } else {
      if (d.get(owner) === lvl) return;
      d.set(owner, lvl);
    }
    this.resolve(g, this.mcu.cycles);
  }

  /** Аналоговый источник (потенциометр, датчик), В; null — убрать. */
  setVolts(g: number | undefined, v: number | null): void {
    if (g === undefined || this.groups[g].power) return;
    this.analog[g] = v;
    this.resolve(g, this.mcu.cycles);
  }

  private resolve(g: number, cycle: number, init = false): void {
    const info = this.groups[g];
    let lvl: Level = 0;
    let float = false;
    let conflict = false;
    if (info.power) lvl = info.power === 'vcc' ? 1 : 0;
    else {
      const modes = info.pins.map((p) => this.mcu.pinMode(p));
      const hasHigh = modes.includes('high');
      const hasLow = modes.includes('low');
      const d = [...this.drivers[g].values()];
      if (hasHigh || hasLow) {
        conflict = (hasHigh && hasLow) || (hasHigh && d.includes(0)) || (hasLow && d.includes(1));
        lvl = hasLow ? 0 : 1;
      } else if (d.length) lvl = d.includes(0) ? 0 : 1;
      else if (this.analog[g] !== null) lvl = this.analog[g]! > 2.5 ? 1 : 0;
      else if (info.pull !== null) lvl = info.pull;
      else if (modes.includes('pullup')) lvl = 1;
      else float = true;
    }
    this.floating[g] = float;
    this.conflict[g] = conflict;
    // Входы контроллера видят уровень и напряжение группы.
    for (const p of info.pins) {
      this.mcu.setInput(p, lvl === 1);
      this.mcu.setAnalog(p, this.voltsOf(g));
    }
    if (!init && lvl === this.level[g]) return;
    const prev = this.level[g];
    this.level[g] = lvl;
    if (init) {
      this.lastEdge[g] = cycle;
      return;
    }
    if (prev === 1) this.highAcc[g] += cycle - Math.max(this.lastEdge[g], this.frameStart);
    this.lastEdge[g] = cycle;
    this.edges[g]++;
    const tr = this.traces.get(g);
    if (tr) {
      tr.t.push(cycle);
      tr.v.push(lvl);
      if (tr.t.length > 20000) {
        tr.t.splice(0, 5000);
        tr.v.splice(0, 5000);
      }
    }
    for (const l of this.listeners) l(g, lvl, cycle);
  }

  /**
   * Итоги кадра по группе: доля времени в «1» (для яркости при ШИМ) и частота переключений.
   * Вызывать раз в кадр для всех групп, потом endFrame().
   */
  frameStats(g: number): { duty: number; hz: number } {
    const now = this.mcu.cycles;
    const span = Math.max(1, now - this.frameStart);
    let high = this.highAcc[g];
    if (this.level[g] === 1) high += now - Math.max(this.lastEdge[g], this.frameStart);
    return { duty: Math.min(1, high / span), hz: (this.edges[g] / 2) * (16e6 / span) };
  }

  endFrame(): void {
    this.frameStart = this.mcu.cycles;
    this.highAcc.fill(0);
    this.edges.fill(0);
  }

  /** Запись переключений группы для логического анализатора. */
  watch(g: number, on: boolean): void {
    if (on && !this.traces.has(g)) this.traces.set(g, { t: [this.mcu.cycles], v: [this.level[g]] });
    if (!on) this.traces.delete(g);
  }
  trace(g: number): Trace | undefined {
    return this.traces.get(g);
  }
}

function isResistor(fp: FootprintDef): boolean {
  return (fp.refPrefix === 'R' || /^R_/.test(fp.id)) && fp.pads.filter((x) => x.type !== 'npth').length === 2;
}
