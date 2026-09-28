import { CoupledCoils, Resistor, type Engine, type Node } from './engine';

/*
 * Катушка DD металлоискателя в аналоговом расчёте: передающая (TX) и приёмная (RX)
 * обмотки и цель под катушкой — короткозамкнутый виток с постоянной времени τ = L/R
 * (вихревые токи). Цель связана с обеими обмотками; чем лучше проводник (больше τ),
 * тем больше фаза отклика уходит от феррита. Феррит и железо ещё и усиливают прямую
 * связь TX→RX (магнитная проницаемость). Сведение — остаточная связь TX→RX (ppm).
 *
 * Отклик цели в RX: M_T·M_R/L_t · jωτ/(1+jωτ) с обратным знаком — это получается
 * само из уравнений связанных катушек, фаза не подбирается.
 */

export interface CoilTarget {
  name: string;
  /** Постоянная времени вихревых токов, мкс (0 — не проводник). */
  tau: number;
  /** Сила вплотную (произведение связей), доля от эталонной монеты. */
  size: number;
  /** Магнитная часть относительно вихревой (феррит — только она). */
  mag: number;
  /** Расстояние, на котором связь с каждой обмоткой падает вдвое, см. */
  r0: number;
}

export const COIL_TARGETS: CoilTarget[] = [
  { name: 'нет цели', tau: 0, size: 0, mag: 0, r0: 1 },
  { name: 'железо (гвоздь)', tau: 9, size: 0.8, mag: 0.9, r0: 6.5 },
  { name: 'фольга', tau: 4, size: 0.35, mag: 0, r0: 5 },
  { name: 'золото (кольцо)', tau: 18, size: 0.6, mag: 0, r0: 6 },
  { name: 'никель (монета 5 ₽)', tau: 30, size: 1, mag: 0, r0: 7 },
  { name: 'алюминий (банка)', tau: 60, size: 2.2, mag: 0, r0: 11 },
  { name: 'медь (монета)', tau: 110, size: 1.1, mag: 0, r0: 7.5 },
  { name: 'серебро (монета)', tau: 170, size: 1.2, mag: 0, r0: 8 },
  { name: 'феррит (калибровка)', tau: 0, size: 1.6, mag: 1, r0: 6 },
];

/** Индуктивность витка цели, Гн (от неё не зависит отклик, только от τ и связей). */
const LT = 1e-6;
/** Произведение связей kT·kR для эталонной монеты вплотную. */
const K_COIN = 2.5e-4;

export interface CoilOpts {
  ltx: number;
  rtx: number;
  lrx: number;
  rrx: number;
  /** Остаточная связь TX→RX, ppm (сведение). */
  balance: number;
}

export class DdCoil {
  readonly coils: CoupledCoils;
  readonly rtx: Resistor;
  readonly rrx: Resistor;
  readonly rt: Resistor;
  target = 0;
  depth = 10;
  over = false;
  /** Проводка над целью: время начала, с (−1 — нет). */
  sweepStart = -1;
  private lastK = [NaN, NaN, NaN];

  constructor(
    private e: Engine,
    name: string,
    tx: [Node, Node],
    rx: [Node, Node],
    public o: CoilOpts,
    comp: string,
    pads: { tx: [string, string]; rx: [string, string] },
  ) {
    const t1 = e.node(`${name}:TX обмотка`);
    const r1 = e.node(`${name}:RX обмотка`);
    const tt = e.node(`${name}:цель`);
    this.rtx = e.add(new Resistor(`${name} TX провод`, tx[0], t1, o.rtx, comp, [pads.tx[0], ''], false));
    this.rrx = e.add(new Resistor(`${name} RX провод`, rx[0], r1, o.rrx, comp, [pads.rx[0], ''], true));
    this.rt = e.add(new Resistor(`${name} цель`, tt, -1, 1, comp, undefined, false));
    this.coils = e.add(
      new CoupledCoils(
        `${name} DD`,
        [
          { a: t1, b: tx[1], henry: o.ltx, name: 'TX' },
          { a: r1, b: rx[1], henry: o.lrx, name: 'RX' },
          { a: tt, b: -1, henry: LT, name: 'цель' },
        ],
        [
          [1, o.balance * 1e-6, 0],
          [0, 1, 0],
        ],
        comp,
      ),
    );
    this.coils.pins[1].pad = pads.tx[1];
    this.coils.pins[3].pad = pads.rx[1];
    this.update(0, true);
  }

  /** Расстояние до цели, см. */
  distance(t: number): number {
    const h = this.depth;
    if (this.sweepStart >= 0) {
      const s = t - this.sweepStart;
      if (s > 1.2) this.sweepStart = -1;
      else return Math.hypot(h, -40 + (80 * s) / 1.2);
    }
    return this.over ? h : Math.hypot(h, 60);
  }

  /** Близость цели 0…1 (для полоски). */
  near(t: number): number {
    const tg = COIL_TARGETS[this.target];
    if (!tg || !tg.size) return 0;
    return 1 / (1 + (this.distance(t) / tg.r0) ** 6);
  }

  /** Пересчитать связи по положению цели (вызывается раз в полмиллисекунды). */
  update(t: number, force = false): void {
    const tg = COIL_TARGETS[this.target] ?? COIL_TARGETS[0];
    const g = tg.size ? 1 / (1 + (this.distance(t) / tg.r0) ** 3) : 0;
    const k = Math.sqrt(K_COIN * tg.size) * g;
    const eddy = tg.tau > 0 ? k : 0;
    // Магнитная часть: добавка к прямой связи того же знака, что у феррита.
    const kTR = this.o.balance * 1e-6 + tg.mag * k * k;
    const next = [kTR, eddy, eddy];
    const same = next.every((x, i) => Math.abs(x - this.lastK[i]) <= Math.max(1e-12, Math.abs(this.lastK[i]) * 0.003));
    if (same && !force) return;
    this.lastK = next;
    this.coils.k[0][1] = kTR;
    this.coils.k[0][2] = eddy;
    this.coils.k[1][2] = eddy;
    this.coils.coils[0].henry = this.o.ltx;
    this.coils.coils[1].henry = this.o.lrx;
    this.rtx.ohms = this.o.rtx;
    this.rrx.ohms = this.o.rrx;
    this.rt.ohms = tg.tau > 0 ? LT / (tg.tau * 1e-6) : 1e3;
    this.coils.update();
    this.e.invalidate();
  }

  /** Ток передатчика (амплитуда за последний период считается снаружи), А сейчас. */
  get txCurrent(): number {
    return this.coils.i[0];
  }
}
