import type { Component, FootprintDef, Project } from '../model/types';
import { isResistor, parseOhms, type Circuit } from './circuit';
import type { DeviceView, SimParam } from './devices';

/*
 * Датчик металлоискателя (катушка DD) для симуляции прошивок вроде «Квазара».
 *
 * Передатчик: катушка TX с конденсатором — последовательный контур. Ток зависит от
 * частоты, с которой контроллер переключает ключи (резонансная кривая), и виден
 * контроллеру как падение напряжения на шунте в цепи питания передатчика.
 * Приёмник: на входе АЦП — средняя точка плюс синусоида частоты TX: остаток
 * разбаланса катушки и отклик цели. Отклик убывает с расстоянием как 1/(1+(r/r0)^6),
 * фаза зависит от металла: феррит и железо — у начала шкалы, чем лучше проводник, тем дальше
 * (фазы подобраны по шкале прошивки «Квазара»: 180° фазы — вся шкала VDI).
 * Кнопка «Провести над целью» проносит катушку над целью за секунду.
 */

export interface MetalTarget {
  name: string;
  /** Фаза отклика относительно феррита, градусы. */
  phase: number;
  /** Сила отклика вплотную, В на входе АЦП. */
  gain: number;
  /** Расстояние, на котором отклик падает вдвое, см. */
  r0: number;
}

export const METAL_TARGETS: MetalTarget[] = [
  { name: 'нет цели', phase: 0, gain: 0, r0: 1 },
  { name: 'железо (гвоздь)', phase: -12, gain: 1.2, r0: 6.5 },
  { name: 'фольга', phase: -38, gain: 0.35, r0: 5 },
  { name: 'золото (кольцо)', phase: -52, gain: 0.8, r0: 6 },
  { name: 'никель (монета 5 ₽)', phase: -66, gain: 1.4, r0: 7 },
  { name: 'алюминий (банка)', phase: -80, gain: 3, r0: 11 },
  { name: 'медь (монета)', phase: -92, gain: 1.6, r0: 7.5 },
  { name: 'серебро (монета)', phase: -106, gain: 1.8, r0: 8 },
  { name: 'феррит (калибровка)', phase: 25, gain: 2.5, r0: 6 },
];

const param = (key: string, label: string, value: number, min: number, max: number, step: number, unit: string, options?: string[]): SimParam => ({ key, label, value, min, max, step, unit, options });

/** Отношение тока к резонансному для последовательного контура с добротностью q. */
export const resonance = (f: number, f0: number, q: number): number => (f > 0 ? 1 / Math.sqrt(1 + q * q * (f / f0 - f0 / f) ** 2) : 0);

export class CoilModel {
  readonly params: SimParam[];
  private txGroup: number | undefined;
  private lastRise = -1;
  private period = 0;
  private shunts: { g: number; supply: number; ohms: number }[] = [];
  private current = 0;
  private sweepStart = -1;
  private noise = 0;
  private seed = 12345;
  private readonly freq: number;

  constructor(
    private c: Circuit,
    readonly comp: Component,
    fp: FootprintDef,
    p: Project,
  ) {
    this.freq = c.mcu.freq;
    this.params = [
      param('target', 'цель', 0, 0, METAL_TARGETS.length - 1, 1, '', METAL_TARGETS.map((t) => t.name)),
      param('depth', 'глубина', 10, 1, 40, 1, 'см'),
      param('over', 'катушка', 0, 0, 1, 1, '', ['в стороне', 'над целью']),
      param('f0', 'резонанс TX', 8200, 4000, 12000, 50, 'Гц'),
      param('balance', 'разбаланс', 60, 0, 500, 5, 'мВ'),
    ];
    // Сигнал передатчика: цепь за конденсатором, что стоит последовательно с катушкой TX.
    const pad = (name: string) => fp.pads.find((q) => (q.name ?? '').toUpperCase() === name)?.number;
    const txNet = pad('TX1') ? comp.padNets[pad('TX1')!] : undefined;
    if (txNet) {
      for (const cc of Object.values(p.components)) {
        const f = p.footprints[cc.footprint];
        if (!f || f.category !== 'Конденсаторы' || f.pads.length !== 2) continue;
        const nets = f.pads.map((q) => cc.padNets[q.number]);
        if (!nets.includes(txNet)) continue;
        const other = nets.find((n) => n && n !== txNet);
        if (other) this.txGroup = c.netGroup.get(other);
      }
      this.txGroup ??= c.netGroup.get(txNet);
    }
    // Шунт тока: резистор до 5 Ом между питанием и сигнальной цепью.
    for (const cc of Object.values(p.components)) {
      const f = p.footprints[cc.footprint];
      if (!f || !isResistor(f)) continue;
      const ohms = parseOhms(cc.value);
      if (!ohms || ohms > 5) continue;
      const gs = f.pads.map((q) => c.groupOfPad(cc, q.number));
      if (gs.some((g) => g === undefined)) continue;
      const [a, b] = gs as number[];
      const pa = c.groups[a].power === 'vcc';
      const pb = c.groups[b].power === 'vcc';
      if (pa !== pb) this.shunts.push({ g: pa ? b : a, supply: pa ? a : b, ohms });
    }
    if (this.txGroup !== undefined)
      c.onChange((g, lvl, cycle) => {
        if (g !== this.txGroup || lvl !== 1) return;
        if (this.lastRise >= 0) this.period = cycle - this.lastRise;
        this.lastRise = cycle;
        this.updateCurrent();
      });
    // Раз в миллисекунду: не остановился ли передатчик.
    const tick = () => {
      this.updateCurrent();
      c.mcu.schedule(tick, Math.round(this.freq / 1000));
    };
    c.mcu.schedule(tick, Math.round(this.freq / 1000));
    this.updateCurrent();
  }

  private get txHz(): number {
    const now = this.c.mcu.cycles;
    if (this.lastRise < 0 || !this.period || now - this.lastRise > Math.max(3 * this.period, this.freq / 200)) return 0;
    return this.freq / this.period;
  }

  private value(key: string): number {
    return this.params.find((q) => q.key === key)!.value;
  }

  /** Ток передатчика, А: в резонансе 0,15 А, добротность контура 6. */
  get txCurrent(): number {
    const f = this.txHz;
    return f ? 0.15 * resonance(f, this.value('f0'), 6) : 0;
  }

  private updateCurrent(): void {
    const i = this.txCurrent;
    if (Math.abs(i - this.current) < 0.0005 && (i === 0) === (this.current === 0)) return;
    this.current = i;
    for (const s of this.shunts) this.c.setVolts(s.g, this.c.powerOf(s.supply) - i * s.ohms);
  }

  /** Расстояние до цели, см: над целью — глубина, при проводке — по дуге пролёта. */
  private distance(cycle: number): number {
    const h = this.value('depth');
    if (this.sweepStart >= 0) {
      const t = (cycle - this.sweepStart) / this.freq;
      if (t > 1.2) this.sweepStart = -1;
      else {
        const x = -40 + (80 * t) / 1.2;
        return Math.hypot(h, x);
      }
    }
    return this.value('over') ? h : Math.hypot(h, 60);
  }

  private gauss(): number {
    // Простой генератор шума (повторяемый).
    let s = 0;
    for (let i = 0; i < 4; i++) {
      this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
      s += this.seed / 0x7fffffff - 0.5;
    }
    return s * 1.7;
  }

  /** Напряжение на входе АЦП приёмника в момент cycle, В (средняя точка — 2,5 В). */
  sample(cycle: number, mid = 2.5): number {
    const f = this.txHz;
    this.noise = 0.0006 * this.gauss();
    if (!f || this.period <= 0) return mid + this.noise;
    const k = resonance(f, this.value('f0'), 6);
    const ph = (2 * Math.PI * (cycle - this.lastRise)) / this.period;
    const deg = Math.PI / 180;
    // Остаток разбаланса катушки и отклик цели; опорная фаза феррита — 40°.
    let s = (this.value('balance') / 1000) * k * Math.sin(ph + 20 * deg);
    const t = METAL_TARGETS[Math.round(this.value('target'))];
    if (t && t.gain) {
      const r = this.distance(cycle);
      s += t.gain * k * (1 / (1 + (r / t.r0) ** 6)) * Math.sin(ph + (40 + t.phase) * deg);
    }
    return mid + s + this.noise;
  }

  set(key: string, v: number): void {
    const q = this.params.find((x) => x.key === key);
    if (q) q.value = v;
    if (key === 'f0') this.updateCurrent();
  }

  act(key: string): void {
    if (key === 'sweep') this.sweepStart = this.c.mcu.cycles;
  }

  view(): DeviceView {
    const f = this.txHz;
    const t = METAL_TARGETS[Math.round(this.value('target'))];
    const r = this.distance(this.c.mcu.cycles);
    const near = t && t.gain ? 1 / (1 + (r / t.r0) ** 6) : 0;
    return {
      id: this.comp.id,
      comp: this.comp.id,
      ref: this.comp.ref,
      kind: 'coil',
      title: `${this.comp.ref} катушка DD: ${f ? `TX ${Math.round(f)} Гц, ${Math.round(this.txCurrent * 1000)} мА` : 'передатчик выключен'}`,
      params: this.params,
      actions: [{ key: 'sweep', label: 'Провести над целью' }],
      level: near,
      warning: this.txGroup === undefined ? 'не найдена цепь передатчика (TX1 через конденсатор)' : undefined,
    };
  }
}
