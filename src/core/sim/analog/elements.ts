import { Capacitor, Inductor, Resistor, type AnalogElement, type Engine, type Node, type RhsStamper, type StepCtx, type Stamper, volt as v } from './engine';

/*
 * Полупроводники и «поведенческие» модели для аналогового расчёта — кусочно-линейные:
 * в каждом состоянии элемент линейный, состояние выбирается по решению (check).
 * Это идеальные условия: без температуры, разброса и ёмкостей переходов (кроме
 * затвора MOSFET), но токи, напряжения, фронты и резонансы — честные.
 */

const GOFF = 1e-9;

/* ---------------- диод, светодиод, стабилитрон ---------------- */

export interface DiodeModel {
  /** Порог открывания, В. */
  vf: number;
  /** Дифференциальное сопротивление в открытом состоянии, Ом. */
  rd: number;
  /** Пробой (стабилитрон), В; 0 — нет. */
  vz?: number;
  rz?: number;
  /** Светодиод: цвет. */
  led?: string;
}

export class Diode implements AnalogElement {
  pins: { node: Node; pad?: string }[];
  /** 0 — закрыт, 1 — открыт, 2 — пробой (стабилитрон). */
  st = 0;
  constructor(
    public name: string,
    public a: Node,
    public k: Node,
    public m: DiodeModel,
    public comp?: string,
    pads?: [string, string],
  ) {
    this.pins = [
      { node: a, pad: pads?.[0] },
      { node: k, pad: pads?.[1] },
    ];
  }
  state(): number {
    return this.st;
  }
  stamp(s: Stamper): void {
    s.cond(this.a, this.k, this.st === 1 ? 1 / this.m.rd : this.st === 2 ? 1 / (this.m.rz ?? 1) : GOFF);
  }
  rhs(r: RhsStamper): void {
    if (this.st === 1) r.source(this.k, this.a, this.m.vf / this.m.rd);
    else if (this.st === 2) r.source(this.a, this.k, (this.m.vz ?? 0) / (this.m.rz ?? 1));
  }
  current(x: Float64Array): number {
    const u = v(x, this.a) - v(x, this.k);
    if (this.st === 1) return (u - this.m.vf) / this.m.rd;
    if (this.st === 2) return (u + (this.m.vz ?? 0)) / (this.m.rz ?? 1);
    return u * GOFF;
  }
  check(x: Float64Array): boolean {
    const u = v(x, this.a) - v(x, this.k);
    const old = this.st;
    if (this.st === 1 && this.current(x) < 0) this.st = 0;
    else if (this.st === 2 && this.current(x) > 0) this.st = 0;
    else if (this.st === 0) {
      if (u > this.m.vf) this.st = 1;
      else if (this.m.vz && u < -this.m.vz) this.st = 2;
    }
    return this.st !== old;
  }
  currents(x: Float64Array): number[] {
    const i = this.current(x);
    return [i, -i];
  }
}

/* ---------------- MOSFET ---------------- */

export interface MosModel {
  type: 'n' | 'p';
  /** Порог, В (для P — по модулю). */
  vth: number;
  /** Сопротивление открытого канала, Ом. */
  ron: number;
  /** Ёмкость затвор—исток, Ф. */
  cgs: number;
  /** Пробой сток—исток (лавинный), В: выброс индуктивной нагрузки ограничивается им. */
  vds?: number;
}

/**
 * Канал MOSFET — ключ по напряжению затвор—исток: открыт выше порога. Паразитный диод
 * и ёмкость затвора добавляются отдельными элементами (buildMosfet).
 */
export class MosChannel implements AnalogElement {
  pins: { node: Node; pad?: string }[];
  on = false;
  constructor(
    public name: string,
    public d: Node,
    public g: Node,
    public s: Node,
    public m: MosModel,
    public comp?: string,
    pads?: [string, string, string],
  ) {
    this.pins = [
      { node: d, pad: pads?.[0] },
      { node: g, pad: pads?.[1] },
      { node: s, pad: pads?.[2] },
    ];
  }
  state(): number {
    return this.on ? 1 : 0;
  }
  stamp(st: Stamper): void {
    st.cond(this.d, this.s, this.on ? 1 / this.m.ron : GOFF);
  }
  check(x: Float64Array): boolean {
    const vgs = v(x, this.g) - v(x, this.s);
    const on = this.m.type === 'n' ? vgs > this.m.vth : -vgs > this.m.vth;
    const ch = on !== this.on;
    this.on = on;
    return ch;
  }
  currents(x: Float64Array): number[] {
    const i = (v(x, this.d) - v(x, this.s)) * (this.on ? 1 / this.m.ron : GOFF);
    return [i, 0, -i];
  }
}

/** MOSFET целиком: канал, паразитный диод исток→сток (для P — сток→исток), ёмкость затвора. */
export function buildMosfet(e: Engine, name: string, d: Node, g: Node, s: Node, m: MosModel, comp?: string, pads?: [string, string, string]): MosChannel {
  const ch = e.add(new MosChannel(name, d, g, s, m, comp, pads));
  const body: DiodeModel = { vf: 0.8, rd: 0.05, vz: m.vds ?? 60, rz: 1 };
  if (m.type === 'n') e.add(new Diode(`${name} диод`, s, d, body, comp));
  else e.add(new Diode(`${name} диод`, d, s, body, comp));
  if (m.cgs > 0) e.add(new Capacitor(`${name} Cзи`, g, s, m.cgs, comp, undefined, true));
  return ch;
}

/* ---------------- биполярный транзистор ---------------- */

export interface BjtModel {
  type: 'npn' | 'pnp';
  beta: number;
  /** Напряжение база—эмиттер в работе, В. */
  vbe: number;
  /** Сопротивление база—эмиттер (наклон входной характеристики), Ом. */
  rbe: number;
  /** Насыщение: напряжение и сопротивление коллектор—эмиттер. */
  vcesat: number;
  rsat: number;
  /** Пробой коллектор—эмиттер, В (выброс индуктивной нагрузки ограничивается им). */
  vceo?: number;
}

/** 0 — отсечка, 1 — усиление, 2 — насыщение. */
export class Bjt implements AnalogElement {
  pins: { node: Node; pad?: string }[];
  st = 0;
  constructor(
    public name: string,
    public c: Node,
    public b: Node,
    public e: Node,
    public m: BjtModel,
    public comp?: string,
    pads?: [string, string, string],
  ) {
    this.pins = [
      { node: c, pad: pads?.[0] },
      { node: b, pad: pads?.[1] },
      { node: e, pad: pads?.[2] },
    ];
  }
  private get p(): number {
    return this.m.type === 'npn' ? 1 : -1;
  }
  state(): number {
    return this.st;
  }
  stamp(s: Stamper): void {
    const { rbe, beta, rsat } = this.m;
    if (this.st === 0) {
      s.cond(this.b, this.e, GOFF);
      s.cond(this.c, this.e, GOFF);
      return;
    }
    s.cond(this.b, this.e, 1 / rbe);
    if (this.st === 1) s.vccs(this.c, this.e, this.b, this.e, beta / rbe);
    else s.cond(this.c, this.e, 1 / rsat);
  }
  rhs(r: RhsStamper): void {
    if (this.st === 0) return;
    const p = this.p;
    const { vbe, rbe, beta, vcesat, rsat } = this.m;
    // База: ток из b в e = (vbe_eff − p·Vbe)/rbe → постоянная часть −p·Vbe/rbe.
    r.source(this.e, this.b, (p * vbe) / rbe);
    if (this.st === 1) r.source(this.e, this.c, (p * vbe * beta) / rbe);
    else r.source(this.e, this.c, (p * vcesat) / rsat);
  }
  /** Ток базы и коллектора (в направлении «для NPN»). */
  private ib(x: Float64Array): number {
    return (this.p * (v(x, this.b) - v(x, this.e)) - this.m.vbe) / this.m.rbe;
  }
  private ic(x: Float64Array): number {
    if (this.st === 1) return this.m.beta * this.ib(x);
    if (this.st === 2) return (this.p * (v(x, this.c) - v(x, this.e)) - this.m.vcesat) / this.m.rsat;
    return 0;
  }
  check(x: Float64Array): boolean {
    const old = this.st;
    const vbe = this.p * (v(x, this.b) - v(x, this.e));
    const vce = this.p * (v(x, this.c) - v(x, this.e));
    if (this.st === 0) {
      if (vbe > this.m.vbe) this.st = vce > this.m.vcesat ? 1 : 2;
    } else if (this.ib(x) < 0) this.st = 0;
    else if (this.st === 1 && vce < this.m.vcesat) this.st = 2;
    else if (this.st === 2 && this.ic(x) > this.m.beta * this.ib(x)) this.st = 1;
    return this.st !== old;
  }
  currents(x: Float64Array): number[] {
    if (this.st === 0) return [0, 0, 0];
    const ib = this.p * this.ib(x);
    const ic = this.p * this.ic(x);
    return [ic, ib, -(ib + ic)];
  }
}

/* ---------------- операционный усилитель и компаратор ---------------- */

export interface OpAmpModel {
  /** Усиление без обратной связи. */
  a0: number;
  /** Произведение усиления на полосу, Гц. */
  gbw: number;
  /** Запас до плюса и минуса питания на выходе, В. */
  hrHi: number;
  hrLo: number;
  rout: number;
  /** Шум на входе, В/√Гц. */
  en: number;
  /** Компаратор с открытым коллектором (LM393): выход только тянет к минусу. */
  openCollector?: boolean;
}

/**
 * ОУ: каскад усиления — источник тока gm·(v+ − v−) во внутренний узел с R и C на землю
 * (полюс даёт GBW), выход — повторитель этого узла через Rout с упором в питание.
 */
export class OpAmp implements AnalogElement {
  pins: { node: Node; pad?: string }[];
  /** 0 — линейно, 1 — упор в плюс, 2 — упор в минус. */
  st = 0;
  private gm = 1e-3;
  constructor(
    public name: string,
    public inP: Node,
    public inN: Node,
    public out: Node,
    public vp: Node,
    public vn: Node,
    public mid: Node,
    public m: OpAmpModel,
    public comp?: string,
    pads?: string[],
  ) {
    this.pins = [inP, inN, out, vp, vn].map((node, i) => ({ node, pad: pads?.[i] }));
  }
  state(): number {
    return this.st;
  }
  stamp(s: Stamper): void {
    // Каскад усиления: ток в mid = gm·(v+ − v−) (источник «из земли в mid»).
    s.vccs(-1, this.mid, this.inP, this.inN, this.gm);
    s.cond(this.mid, -1, this.gm / this.m.a0);
    const g = 1 / this.m.rout;
    if (this.m.openCollector) {
      // Открытый коллектор: при «0» — ключ на минус, иначе разомкнут.
      s.cond(this.out, this.vn, this.st === 2 ? g : GOFF);
      return;
    }
    if (this.st === 0) {
      s.g(this.out, this.out, g);
      s.g(this.out, this.mid, -g);
    } else s.cond(this.out, this.st === 1 ? this.vp : this.vn, g);
    // В упоре внутренний узел держится у питания (быстрый выход из насыщения, как у настоящих ОУ).
    if (this.st !== 0) s.cond(this.mid, this.st === 1 ? this.vp : this.vn, 1);
  }
  rhs(r: RhsStamper, ctx: StepCtx): void {
    if (ctx.noise && this.m.en) r.inject(this.mid, this.gm * this.m.en * Math.sqrt(1 / (2 * ctx.dt)) * ctx.gauss());
    if (this.m.openCollector) return;
    const g = 1 / this.m.rout;
    if (this.st === 1) {
      r.source(this.vp, this.out, -g * this.m.hrHi);
      r.source(-1, this.mid, -this.m.hrHi);
    } else if (this.st === 2) {
      r.source(this.vn, this.out, g * this.m.hrLo);
      r.source(-1, this.mid, this.m.hrLo);
    }
  }
  check(x: Float64Array): boolean {
    const old = this.st;
    const target = this.m.a0 * (v(x, this.inP) - v(x, this.inN));
    const hi = v(x, this.vp) - this.m.hrHi;
    const lo = v(x, this.vn) + this.m.hrLo;
    if (this.m.openCollector) {
      this.st = target < 0 ? 2 : 0;
      return this.st !== old;
    }
    if (this.st === 0) {
      const m = v(x, this.mid);
      if (m > hi) this.st = 1;
      else if (m < lo) this.st = 2;
    } else if (this.st === 1 && target < hi) this.st = 0;
    else if (this.st === 2 && target > lo) this.st = 0;
    return this.st !== old;
  }
  currents(x: Float64Array): number[] {
    const g = 1 / this.m.rout;
    let iOut = 0;
    if (this.m.openCollector) iOut = this.st === 2 ? (v(x, this.out) - v(x, this.vn)) * g : 0;
    else if (this.st === 0) iOut = (v(x, this.out) - v(x, this.mid)) * g;
    else iOut = (v(x, this.out) - v(x, this.st === 1 ? this.vp : this.vn) + (this.st === 1 ? this.m.hrHi : -this.m.hrLo)) * g;
    // Отдаёт ток (iOut < 0) — он входит через плюс питания; принимает — уходит через минус.
    return [0, 0, iOut, iOut < 0 ? -iOut : 0, iOut > 0 ? -iOut : 0];
  }
}

/** ОУ целиком: внутренний узел и ёмкость полюса (всегда неявно — узел жёсткий). */
export function buildOpAmp(e: Engine, name: string, inP: Node, inN: Node, out: Node, vp: Node, vn: Node, m: OpAmpModel, comp?: string, pads?: string[]): OpAmp {
  const mid = e.node(`${name}:вн`);
  const op = e.add(new OpAmp(name, inP, inN, out, vp, vn, mid, m, comp, pads));
  // GBW = gm/(2π·C).
  e.add(new Capacitor(`${name} полюс`, mid, -1, 1e-3 / (2 * Math.PI * m.gbw), comp, undefined, true));
  return op;
}

/* ---------------- TL431 ---------------- */

export class Tl431 implements AnalogElement {
  pins: { node: Node; pad?: string }[];
  on = false;
  constructor(
    public name: string,
    public k: Node,
    public a: Node,
    public ref: Node,
    public vref = 2.495,
    public gm = 5,
    public comp?: string,
    pads?: [string, string, string],
  ) {
    this.pins = [
      { node: k, pad: pads?.[0] },
      { node: a, pad: pads?.[1] },
      { node: ref, pad: pads?.[2] },
    ];
  }
  state(): number {
    return this.on ? 1 : 0;
  }
  stamp(s: Stamper): void {
    if (this.on) s.vccs(this.k, this.a, this.ref, this.a, this.gm);
    else s.cond(this.k, this.a, GOFF);
  }
  rhs(r: RhsStamper): void {
    if (this.on) r.source(this.a, this.k, this.gm * this.vref);
  }
  private ika(x: Float64Array): number {
    return this.on ? this.gm * (v(x, this.ref) - v(x, this.a) - this.vref) : 0;
  }
  check(x: Float64Array): boolean {
    const old = this.on;
    if (this.on) this.on = this.ika(x) >= 0;
    else this.on = v(x, this.ref) - v(x, this.a) > this.vref;
    return old !== this.on;
  }
  currents(x: Float64Array): number[] {
    const i = this.ika(x);
    return [i, -i, 0];
  }
}

/* ---------------- линейный стабилизатор ---------------- */

export interface RegModel {
  vout: number;
  /** Минимальный перепад вход—выход, В. */
  vdrop: number;
  rout: number;
  /** Собственный ток, А. */
  iq: number;
}

/** 0 — стабилизирует, 1 — не хватает входа (выход = вход − перепад), 2 — выключен (выход выше нормы). */
export class Regulator implements AnalogElement {
  pins: { node: Node; pad?: string }[];
  st = 0;
  constructor(
    public name: string,
    public vin: Node,
    public gnd: Node,
    public out: Node,
    public m: RegModel,
    public comp?: string,
    pads?: [string, string, string],
  ) {
    this.pins = [
      { node: vin, pad: pads?.[0] },
      { node: gnd, pad: pads?.[1] },
      { node: out, pad: pads?.[2] },
    ];
  }
  state(): number {
    return this.st;
  }
  stamp(s: Stamper): void {
    const g = 1 / this.m.rout;
    if (this.st === 2) {
      s.cond(this.out, this.gnd, GOFF);
      return;
    }
    const ref = this.st === 0 ? this.gnd : this.vin;
    // Ток из out в регулятор = g·(v_out − v_ref − U); столько же входит через вход.
    s.g(this.out, this.out, g);
    s.g(this.out, ref, -g);
    s.g(this.vin, this.out, -g);
    s.g(this.vin, ref, g);
  }
  rhs(r: RhsStamper): void {
    const g = 1 / this.m.rout;
    r.source(this.vin, this.gnd, this.m.iq);
    if (this.st === 2) return;
    const u = this.st === 0 ? this.m.vout : -this.m.vdrop;
    // Постоянная часть: из out в регулятор −g·U, из vin — +g·U.
    r.inject(this.out, g * u);
    r.inject(this.vin, -g * u);
  }
  /** Ток нагрузки (из регулятора в выход), А. */
  load(x: Float64Array): number {
    const g = 1 / this.m.rout;
    if (this.st === 2) return 0;
    const ref = this.st === 0 ? v(x, this.gnd) + this.m.vout : v(x, this.vin) - this.m.vdrop;
    return g * (ref - v(x, this.out));
  }
  check(x: Float64Array): boolean {
    const old = this.st;
    const headroom = v(x, this.vin) - this.m.vdrop - v(x, this.gnd);
    if (this.st === 0) {
      if (headroom < this.m.vout) this.st = 1;
      else if (this.load(x) < 0) this.st = 2;
    } else if (this.st === 1) {
      if (headroom > this.m.vout) this.st = 0;
      else if (this.load(x) < 0) this.st = 2;
    } else if (v(x, this.out) - v(x, this.gnd) < this.m.vout - 1e-3 && headroom > v(x, this.out) - v(x, this.gnd)) this.st = headroom > this.m.vout ? 0 : 1;
    return this.st !== old;
  }
  currents(x: Float64Array): number[] {
    const i = this.load(x);
    return [i + this.m.iq, -this.m.iq, -i];
  }
}

/* ---------------- таймер 555 ---------------- */

/**
 * 555: внутренний делитель 3×5 кОм (CTRL = ⅔ питания, нижний порог — ⅓), два компаратора,
 * RS-триггер, выходной каскад и разряд. Триггер переключается в том же шаге.
 */
export class Timer555 implements AnalogElement {
  pins: { node: Node; pad?: string }[];
  q = false;
  constructor(
    public name: string,
    public n: { vcc: Node; gnd: Node; trig: Node; thr: Node; ctrl: Node; reset: Node; out: Node; dis: Node; low: Node },
    /** КМОП (7555, TLC555): выход до питания; биполярный NE555 — на 1,7 В ниже. */
    public cmos = false,
    public comp?: string,
    pads?: Record<string, string>,
  ) {
    this.pins = (['vcc', 'gnd', 'trig', 'thr', 'ctrl', 'reset', 'out', 'dis'] as const).map((k) => ({ node: n[k], pad: pads?.[k] }));
  }
  state(): number {
    return this.q ? 1 : 0;
  }
  stamp(s: Stamper): void {
    const { vcc, gnd, out, dis } = this.n;
    const gOut = 1 / (this.cmos ? 20 : 10);
    s.cond(out, this.q ? vcc : gnd, gOut);
    s.cond(dis, gnd, this.q ? GOFF : 1 / 10);
  }
  rhs(r: RhsStamper): void {
    const { vcc, gnd, out } = this.n;
    const gOut = 1 / (this.cmos ? 20 : 10);
    // Выход «1»: v = vcc − 1,7 (NE555); «0»: v = gnd + 0,1.
    if (this.q) r.source(vcc, out, -gOut * (this.cmos ? 0 : 1.7));
    else r.source(out, gnd, -gOut * 0.1);
  }
  check(x: Float64Array): boolean {
    const { gnd, trig, thr, ctrl, reset, low } = this.n;
    const old = this.q;
    if (v(x, reset) - v(x, gnd) < 0.7) this.q = false;
    else if (v(x, trig) < v(x, low)) this.q = true;
    else if (v(x, thr) > v(x, ctrl)) this.q = false;
    return this.q !== old;
  }
  currents(x: Float64Array): number[] {
    const { vcc, gnd, out, dis } = this.n;
    const gOut = 1 / (this.cmos ? 20 : 10);
    const iOut = this.q ? (v(x, out) - v(x, vcc) + (this.cmos ? 0 : 1.7)) * gOut : (v(x, out) - v(x, gnd) - 0.1) * gOut;
    const iDis = this.q ? 0 : (v(x, dis) - v(x, gnd)) / 10;
    // Порядок выводов: vcc, gnd, trig, thr, ctrl, reset, out, dis.
    return [this.q ? -iOut : 0, (this.q ? 0 : -iOut) - iDis, 0, 0, 0, 0, iOut, iDis];
  }
}

/** 555 целиком: внутренний делитель и сам таймер. */
export function build555(e: Engine, name: string, n: Omit<Timer555['n'], 'low'>, cmos: boolean, comp?: string, pads?: Record<string, string>): Timer555 {
  const low = e.node(`${name}:⅓`);
  e.add(new Resistor(`${name} делитель`, n.vcc, n.ctrl, 5000, comp, undefined, false));
  e.add(new Resistor(`${name} делитель`, n.ctrl, low, 5000, comp, undefined, false));
  e.add(new Resistor(`${name} делитель`, low, n.gnd, 5000, comp, undefined, false));
  return e.add(new Timer555(name, { ...n, low }, cmos, comp, pads));
}

/* ---------------- вывод контроллера ---------------- */

export type PinDrive = 'low' | 'high' | 'input' | 'pullup' | 'pulldown';

/** Вывод контроллера: выход — источник с сопротивлением ~25 Ом от питания контроллера; вход — почти обрыв. */
export class McuPinEl implements AnalogElement {
  pins: { node: Node; pad?: string }[];
  mode: PinDrive = 'input';
  /** Питание контроллера: узел (null — постоянное напряжение vccVolts). */
  vccNode: Node | null;
  vccVolts: number;
  constructor(
    public name: string,
    public node: Node,
    /** Питание контроллера: { node } — узел схемы, число — постоянное напряжение. */
    vcc: { node: Node } | number,
    public rout = 25,
    public comp?: string,
    pad?: string,
  ) {
    this.pins = [{ node, pad }];
    this.vccNode = typeof vcc === 'number' ? null : vcc.node;
    this.vccVolts = typeof vcc === 'number' ? vcc : 0;
  }
  /** «0» и «1» на выходе — одна матрица (питание подставляется в правую часть): ШИМ не требует разложений. */
  state(): number {
    return this.mode === 'high' ? 0 : ['low', 'high', 'input', 'pullup', 'pulldown'].indexOf(this.mode);
  }
  private g(): number {
    return this.mode === 'low' || this.mode === 'high' ? 1 / this.rout : this.mode === 'input' ? GOFF : 1 / 45_000;
  }
  private get toVcc(): boolean {
    return this.mode === 'high' || this.mode === 'pullup';
  }
  stamp(s: Stamper): void {
    s.g(this.node, this.node, this.g());
  }
  rhs(r: RhsStamper, _ctx: StepCtx, x: Float64Array): void {
    // Напряжение питания — с прошлого шага (оно почти постоянное).
    if (this.toVcc) r.inject(this.node, this.g() * (this.vccNode === null ? this.vccVolts : v(x, this.vccNode)));
  }
  current(x: Float64Array): number {
    const ref = this.toVcc ? (this.vccNode === null ? this.vccVolts : v(x, this.vccNode)) : 0;
    return (v(x, this.node) - ref) * this.g();
  }
  currents(x: Float64Array): number[] {
    return [this.current(x)];
  }
}

/* ---------------- двигатель постоянного тока ---------------- */

export interface MotorModel {
  /** Сопротивление и индуктивность якоря. */
  r: number;
  l: number;
  /** Постоянная ЭДС и момента, В·с/рад (= Н·м/А). */
  k: number;
  /** Момент инерции, кг·м², вязкое трение, Н·м·с. */
  j: number;
  b: number;
  /** Момент нагрузки, Н·м. */
  load: number;
}

/** Двигатель: якорь (R, L) и ЭДС k·ω; скорость — из момента k·i. */
export class DcMotor implements AnalogElement {
  pins: { node: Node; pad?: string }[];
  omega = 0;
  readonly ind: Inductor;
  constructor(
    public name: string,
    public a: Node,
    public b: Node,
    public emf: Node,
    ind: Inductor,
    public m: MotorModel,
    public comp?: string,
    pads?: [string, string],
  ) {
    this.ind = ind;
    this.pins = [
      { node: a, pad: pads?.[0] },
      { node: b, pad: pads?.[1] },
    ];
  }
  stamp(s: Stamper): void {
    // ЭДС: источник k·ω между emf и b с малым сопротивлением.
    s.cond(this.emf, this.b, 1e3);
  }
  rhs(r: RhsStamper): void {
    r.source(this.b, this.emf, this.m.k * this.omega * 1e3);
  }
  commit(_x: Float64Array, ctx: StepCtx): void {
    const drive = this.m.k * this.ind.i;
    const load = Math.abs(this.m.load);
    // Стоит и момента не хватает сдвинуть нагрузку — стоит.
    if (Math.abs(this.omega) < 1e-3 && Math.abs(drive) <= load) {
      this.omega = 0;
      return;
    }
    const tl = load * Math.sign(Math.abs(this.omega) < 1e-3 ? drive : this.omega);
    this.omega += ((drive - this.m.b * this.omega - tl) / this.m.j) * ctx.dt;
  }
  get rpm(): number {
    return (this.omega * 60) / (2 * Math.PI);
  }
  currents(): number[] {
    return [this.ind.i, -this.ind.i];
  }
}

export function buildMotor(e: Engine, name: string, a: Node, b: Node, m: MotorModel, comp?: string, pads?: [string, string]): DcMotor {
  const n1 = e.node(`${name}:R`);
  const n2 = e.node(`${name}:ЭДС`);
  e.add(new Resistor(`${name} якорь`, a, n1, m.r, comp, undefined, false));
  const ind = e.add(new Inductor(`${name} индуктивность`, n1, n2, m.l, comp));
  return e.add(new DcMotor(name, a, b, n2, ind, m, comp, pads));
}
