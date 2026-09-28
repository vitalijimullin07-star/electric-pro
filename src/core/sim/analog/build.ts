import type { Component, Id, Project, SimSource } from '../../model/types';
import { powerVoltsOf, type Circuit } from '../circuit';
import type { McuPin } from '../types';
import type { DdCoil } from './coil';
import { Diode, McuPinEl, OpAmp, Regulator } from './elements';
import { CondSwitch, DcDc, Fuse, LabSupply } from './elements-ext';
import { Capacitor, CoupledCoils, Engine, GND, Inductor, Resistor, Switch, VSource, type AnalogElement, type AnalogParam, type Node } from './engine';
import { kindOf, padsByName } from './kinds';
import { buildPart, fmtSi, type AnalogPart, type BuildCtx } from './models';

/*
 * Аналоговая схема проекта для симуляции «как в EveryCircuit»: каждая цепь — узел, детали —
 * модели движка (engine.ts, elements*.ts, models.ts). Контроллер (если есть) остаётся
 * в логической схеме (Circuit): его выводы здесь — источники с сопротивлением, режим
 * берётся из прошивки. Движок идёт вслед за контроллером: перед каждым событием (фронт
 * вывода, чтение АЦП, нажатие) он досчитывается до текущего такта. Без контроллера время
 * отсчитывает NullMcu, а схема включается «с нуля», как при подаче питания.
 *
 * Питание: аккумуляторы, блоки питания и стабилизаторы — детали схемы; цепи с именами
 * +5V, +12V, -12V… без источника получают блок питания по имени; цепи L и N — сеть 230 В;
 * свои источники и генераторы — в настройках проекта (project.sim.sources).
 * Номиналы можно крутить на ходу (params/set); ручная модель детали — Component.sim.
 */

export type { AnalogPart, AnalogReading, PartUi } from './models';
export { fmtSi } from './models';

/** Канал осциллографа: напряжение цепи или ток через вывод детали. */
export type ScopeProbe = { net: Id } | { comp: Id; pad: string };

const NET_LIVE = /^(L|L1|AC_?L|LINE|~?2[23]0\s*V?~?|AC230|MAINS_?L)$/i;
const NET_NEUTRAL = /^(N|AC_?N|NEUTRAL|MAINS_?N)$/i;
const NET_NEGATIVE = /^-(\d+(?:[.,]\d+)?)V$/i;

/** Псевдодеталь для питания, сети и генераторов (в проекте её нет). */
function pseudo(id: string, ref: string, value: string): Component {
  return { id, ref, value, footprint: '', at: { x: 0, y: 0 }, rotation: 0, side: 'top', padNets: {} };
}

/** Напряжение генератора во времени. */
export function sourceWave(s: SimSource): (t: number) => number {
  const a = s.volts;
  const off = s.offset ?? 0;
  const f = s.freq ?? 1000;
  switch (s.wave) {
    case 'dc':
      return () => a;
    case 'sine':
      return (t) => off + a * Math.sin(2 * Math.PI * f * t);
    case 'mains':
      return (t) => a * Math.SQRT2 * Math.sin(2 * Math.PI * (s.freq ?? 50) * t);
    case 'square': {
      const duty = Math.min(0.99, Math.max(0.01, s.duty ?? 0.5));
      return (t) => off + ((t * f) % 1 < duty ? a : 0);
    }
    case 'triangle':
      return (t) => {
        const ph = (t * f) % 1;
        return off + a * (ph < 0.5 ? 4 * ph - 1 : 3 - 4 * ph);
      };
  }
}

export const WAVE_TITLES: Record<SimSource['wave'], string> = { dc: 'постоянное', sine: 'синус', square: 'меандр', triangle: 'треугольник', mains: 'сеть ~' };

export class AnalogSim {
  readonly engine = new Engine();
  readonly nodeOf = new Map<Id, Node>();
  readonly netOfNode: (Id | null)[] = [];
  readonly parts: AnalogPart[] = [];
  readonly partOf = new Map<Id, AnalogPart>();
  /** Детали, для которых модели нет (не влияют на аналоговую часть). */
  readonly skipped: string[] = [];
  readonly coil: DdCoil | null = null;
  /** Схема без контроллера. */
  readonly noMcu: boolean;
  /** Цепи земли (узел −1). */
  readonly ground = new Set<Id>();
  /** Предупреждения сборки: нет земли, нет питания… */
  readonly notes: string[] = [];
  private pins = new Map<McuPin, McuPinEl>();
  private supplies: { src: LabSupply; g: number }[] = [];
  private battery: { src: VSource; g: number }[] = [];
  /** Цепи с выводом контроллера, которые задают активные выходы (ОУ, 555): уровень — в логику. */
  private feeds: { g: number; node: Node; lvl: 0 | 1 }[] = [];
  private nextCoilUpdate = 0;
  private readonly freq: number;
  private scopeRing: Float32Array[] = [];
  private scopeFns: ((x: Float64Array) => number)[] = [];
  private scopePos = 0;
  private scopeCount = 0;
  private scopeEvery = 1;
  private scopeTick = 0;
  /** Время последнего отсчёта осциллографа, с. */
  scopeT = 0;
  scopeLen = 4000;
  /** Генераторы из настроек проекта по id. */
  readonly sources = new Map<string, { s: SimSource; el: LabSupply | VSource; part: AnalogPart }>();

  constructor(
    readonly project: Project,
    readonly circuit: Circuit,
    opts: { dt?: number; settle?: boolean } = {},
  ) {
    const c = circuit;
    this.freq = c.mcu.freq;
    this.noMcu = c.mcu.kind === 'none';
    this.engine.dt = opts.dt ?? 1e-6;
    this.findGround();
    this.build();
    this.addPower();
    c.onPower(() => {
      this.sync();
      for (const s of this.supplies) s.src.volts = c.powerOf(s.g);
      for (const s of this.battery) s.src.volts = c.powerOf(s.g);
    });
    // Выводы контроллера меняют режим — движок досчитывает до фронта.
    c.onMcuPin((pin, _g, mode) => {
      const el = this.pins.get(pin);
      if (!el) return;
      this.sync();
      if (el.mode !== mode) {
        el.mode = mode;
        this.engine.kick();
      }
    });
    // Ручные параметры моделей (свойства детали → «Модель для симуляции»).
    for (const part of this.parts) {
      const ps = part.comp.sim?.params;
      if (ps) for (const [k, val] of Object.entries(ps)) if (part.params.some((q) => q.key === k)) part.set(k, val);
    }
    this.quiet();
    if (opts.settle ?? !this.noMcu) this.settle();
    else this.engine.kick();
    // Выходы ОУ, таймеров, логики на входах контроллера: опрос раз в 20 мкс.
    if (this.feeds.length) {
      const every = Math.max(1, Math.round(this.freq * 20e-6));
      const tick = () => {
        this.sync();
        c.mcu.schedule(tick, every);
      };
      c.mcu.schedule(tick, every);
    }
  }

  /** Имя цепи. */
  netName(net: Id | undefined): string {
    return net ? (this.project.nets[net]?.name ?? '') : '';
  }

  /**
   * Земля схемы: цепи GND (как у логической схемы); если таких нет — минус аккумулятора
   * или блока питания; иначе — цепь, к которой подключено больше всего выводов.
   */
  private findGround(): void {
    const c = this.circuit;
    const p = this.project;
    c.groups.forEach((gr) => {
      if (gr.power === 'gnd') for (const n of gr.nets) this.ground.add(n);
    });
    if (this.ground.size) return;
    for (const comp of Object.values(p.components)) {
      const fp = p.footprints[comp.footprint];
      if (!fp) continue;
      const k = kindOf(comp, fp);
      if (k !== 'battery' && k !== 'source') continue;
      const pads = padsByName(fp);
      const minus = ['-', '−', 'BAT-', 'GND', 'V-', '-V', 'IN-'].map((x) => pads.get(x)?.[0]).find((x) => x) ?? fp.pads.filter((q) => q.type !== 'npth')[1]?.number;
      const net = minus ? comp.padNets[minus] : undefined;
      if (net) {
        this.ground.add(net);
        return;
      }
    }
    for (const s of p.sim?.sources ?? [])
      if (s.ref) {
        this.ground.add(s.ref);
        return;
      }
    const count = new Map<Id, number>();
    for (const comp of Object.values(p.components)) for (const net of Object.values(comp.padNets)) count.set(net, (count.get(net) ?? 0) + 1);
    const best = [...count].sort((a, b) => b[1] - a[1])[0];
    if (best) {
      this.ground.add(best[0]);
      this.notes.push(`Земля схемы не названа (GND) — за ноль взята цепь ${this.netName(best[0])}.`);
    }
  }

  /** Узел цепи (земля — −1); цепь без узла создаётся. */
  node(net: Id | undefined, label: string): Node {
    if (!net) {
      const n = this.engine.node(`${label} (не подключён)`);
      this.netOfNode[n] = null;
      return n;
    }
    const have = this.nodeOf.get(net);
    if (have !== undefined) return have;
    if (this.ground.has(net)) {
      this.nodeOf.set(net, GND);
      return GND;
    }
    const n = this.engine.node(this.project.nets[net]?.name ?? net);
    this.nodeOf.set(net, n);
    this.netOfNode[n] = net;
    return n;
  }

  private ctx(): BuildCtx {
    return {
      e: this.engine,
      node: (net, label) => this.node(net, label),
      netName: (net) => this.netName(net),
      sync: () => this.sync(),
      kick: () => this.engine.kick(),
      feed: (node) => this.feed(node),
      amplitude: (fn) => this.amplitude(fn),
      frequency: (fn) => this.frequency(fn),
      average: (fn) => this.average(fn),
      setCoil: (coil) => ((this as { coil: DdCoil | null }).coil = coil),
      txResonance: () => this.txResonance(),
    };
  }

  private build(): void {
    const p = this.project;
    const c = this.circuit;
    const e = this.engine;
    const mcu = c.found;
    const ctx = this.ctx();
    let vccNode: Node | null = null;
    const mcuEls: AnalogElement[] = [];
    if (!this.noMcu) {
      // Контроллер: потребление и (ниже) выводы.
      const mcuPads = padsByName(mcu.fp);
      const vccPad = ['VCC', 'VDD', '5V', '3V3', '+5V', '3.3V'].map((k) => mcuPads.get(k)?.[0]).find((x) => x && mcu.comp.padNets[x]);
      const gndPad = ['GND', 'VSS'].map((k) => mcuPads.get(k)?.[0]).find((x) => x && mcu.comp.padNets[x]);
      vccNode = vccPad ? this.node(mcu.comp.padNets[vccPad], 'VCC') : null;
      if (vccNode !== null && vccNode >= 0 && gndPad) mcuEls.push(e.add(new Resistor(`${mcu.comp.ref} потребление`, vccNode, this.node(mcu.comp.padNets[gndPad], 'GND'), c.mcu.vdd / 0.012, mcu.comp.id, [vccPad!, gndPad], false)));
      this.addPart({ comp: mcu.comp, kind: `контроллер ${c.mcu.title}`, sim: 'mcu', params: [], elements: mcuEls, set: () => {}, readings: () => [] });
    }

    for (const comp of Object.values(p.components)) {
      if (comp.id === mcu.comp.id) continue;
      const fp = p.footprints[comp.footprint];
      if (!fp) continue;
      const kind = kindOf(comp, fp);
      if (!kind || kind === 'none') {
        if (kind !== 'none') this.skipped.push(comp.ref);
        continue;
      }
      try {
        const part = buildPart(ctx, kind, comp, fp);
        if (part) this.addPart(part);
        else this.skipped.push(comp.ref);
      } catch {
        this.skipped.push(comp.ref);
      }
    }
    if (this.noMcu) return;
    // Выводы контроллера — только те, к чьим цепям подключено что-то аналоговое
    // (цепи ЖК и SPI без нагрузки лишь добавили бы узлы и состояния).
    for (const [padNo, pin] of mcu.pins) {
      const net = mcu.comp.padNets[padNo];
      if (!net || this.pins.has(pin)) continue;
      const g = c.netGroup.get(net);
      if (g === undefined || c.groups[g].power || !this.nodeOf.has(net)) continue;
      const el = e.add(new McuPinEl(`${mcu.comp.ref} ${pin}`, this.node(net, pin), vccNode !== null ? { node: vccNode } : c.mcu.vdd, 25, mcu.comp.id, padNo));
      el.mode = c.mcu.pinMode(pin);
      this.pins.set(pin, el);
      mcuEls.push(el);
    }
  }

  private addPart(part: AnalogPart): void {
    this.parts.push(part);
    this.partOf.set(part.comp.id, part);
  }

  /** Узлы, которые уже задаёт источник (аккумулятор, стабилизатор, блок питания). */
  private sourced(): Set<Node> {
    const s = new Set<Node>();
    for (const el of this.engine.elements) {
      if (el instanceof VSource || el instanceof LabSupply) s.add(el.p);
      if (el instanceof Regulator) s.add(el.out);
      if (el instanceof DcDc) s.add(el.out);
    }
    return s;
  }

  /**
   * Узлы, до которых доходит ток от источника по проводящим элементам (резисторы, ключи,
   * дроссели, диоды, предохранители, обмотки трансформатора — через магнитную связь).
   * Цепь «+12V» за выключателем от аккумулятора питается от него, а не от блока по имени.
   */
  private energized(): Set<Node> {
    const parent = new Map<Node, Node>();
    const find = (a: Node): Node => {
      let r = a;
      while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!;
      return r;
    };
    const join = (a: Node, b: Node) => {
      if (a < 0 || b < 0) return;
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    };
    for (const el of this.engine.elements) {
      const conductive = el instanceof Resistor || el instanceof Inductor || el instanceof Switch || el instanceof CondSwitch || el instanceof Fuse || el instanceof Diode || el instanceof CoupledCoils;
      if (!conductive) continue;
      const nodes = el.pins.map((q) => q.node).filter((n) => n >= 0);
      for (let i = 1; i < nodes.length; i++) join(nodes[0], nodes[i]);
    }
    const roots = new Set([...this.sourced()].map(find));
    const out = new Set<Node>();
    for (let n = 0; n < this.engine.n; n++) if (roots.has(find(n))) out.add(n);
    return out;
  }

  /** Питание по именам цепей и сеть 230 В — псевдодетали с ползунками. */
  private addPower(): void {
    const c = this.circuit;
    const e = this.engine;
    // Сеть: цепи L и N — первой, от неё может питаться всё остальное (трансформатор).
    const live = [...this.nodeOf].find(([n, node]) => node >= 0 && NET_LIVE.test(this.netName(n)));
    const neutral = [...this.nodeOf].find(([n]) => NET_NEUTRAL.test(this.netName(n)));
    if (live) this.addSource({ id: 'mains', net: live[0], ref: neutral?.[0], wave: 'mains', volts: 230, freq: 50, ohms: 0.5 }, true);
    for (const s of this.project.sim?.sources ?? []) this.addSource(s);
    const sourced = this.energized();
    const supply = (net: Id, node: Node, volts: number, g: number | null) => {
      const name = this.netName(net);
      const src = e.add(new LabSupply(`питание ${name}`, node, GND, volts, 5, 0.01));
      if (g !== null) this.supplies.push({ src, g });
      const knobs: AnalogParam[] = [
        { key: 'volts', label: 'напряжение', value: volts, unit: 'В', min: Math.min(0, volts * 2), max: Math.max(0, volts * 2) || 1 },
        { key: 'ilim', label: 'ограничение тока', value: 5, unit: 'А', min: 0.01, max: 30, log: true },
      ];
      this.addPart({
        comp: pseudo(`supply:${net}`, name, `${volts} В`),
        kind: 'питание по имени цепи',
        sim: 'supply',
        virtual: 'supply',
        params: knobs,
        elements: [src],
        set: (k, val) => {
          this.sync();
          const q = knobs.find((x) => x.key === k);
          if (!q) return;
          q.value = val;
          if (k === 'volts') src.volts = val;
          else src.ilim = val;
          e.invalidate();
        },
        readings: () => [
          { label: 'напряжение', value: e.volts(node), unit: 'В' },
          { label: 'ток', value: src.out(e.x, e.t), unit: 'А' },
          { label: 'мощность', value: e.volts(node) * src.out(e.x, e.t), unit: 'Вт' },
          { label: 'режим', value: src.st, unit: src.st ? 'ОГРАНИЧЕНИЕ ТОКА' : 'держит напряжение' },
        ],
      });
    };
    c.groups.forEach((gr, g) => {
      if (gr.power !== 'vcc') return;
      const nets = gr.nets.filter((n) => (this.nodeOf.get(n) ?? -1) >= 0);
      if (!nets.length || nets.some((n) => sourced.has(this.nodeOf.get(n)!))) return;
      // Одна цепь группы — источник, остальные связаны с ней дросселями и перемычками.
      const main = nets.find((n) => /\d|VCC|VDD|VIN/i.test(this.netName(n))) ?? nets[0];
      supply(main, this.nodeOf.get(main)!, c.powerOf(g), g);
    });
    // Отрицательное питание: -5V, -12V…
    for (const [net, node] of this.nodeOf) {
      const m = NET_NEGATIVE.exec(this.netName(net));
      if (m && node >= 0 && !sourced.has(node)) supply(net, node, -parseFloat(m[1].replace(',', '.')), null);
    }
  }

  /** Источник или генератор из настроек проекта (или сеть по именам цепей). */
  addSource(s: SimSource, mains = false): AnalogPart | null {
    const e = this.engine;
    if (s.off || !this.project.nets[s.net]) return null;
    const p = this.node(s.net, 'генератор');
    const n = s.ref ? this.node(s.ref, 'генератор −') : GND;
    const wave = sourceWave(s);
    const el: LabSupply | VSource = s.wave === 'dc' ? e.add(new LabSupply(`источник ${this.netName(s.net)}`, p, n, s.volts, 3, s.ohms ?? 0.01)) : e.add(new VSource(`генератор ${this.netName(s.net)}`, p, n, wave, s.ohms ?? 50));
    const knobs: AnalogParam[] = [{ key: 'volts', label: s.wave === 'dc' ? 'напряжение' : s.wave === 'mains' ? 'напряжение (действующее)' : 'амплитуда', value: s.volts, unit: 'В', min: s.wave === 'mains' ? 50 : -60, max: s.wave === 'mains' ? 400 : 60 }];
    if (s.wave !== 'dc') knobs.push({ key: 'freq', label: 'частота', value: s.freq ?? (s.wave === 'mains' ? 50 : 1000), unit: 'Гц', min: 0.1, max: 1e6, log: true });
    if (s.wave !== 'dc' && s.wave !== 'mains') knobs.push({ key: 'offset', label: 'смещение', value: s.offset ?? 0, unit: 'В', min: -30, max: 30 });
    if (s.wave === 'square') knobs.push({ key: 'duty', label: 'скважность', value: (s.duty ?? 0.5) * 100, unit: '%', min: 1, max: 99 });
    if (s.wave === 'dc') knobs.push({ key: 'ilim', label: 'ограничение тока', value: 3, unit: 'А', min: 0.01, max: 30, log: true });
    const cur = { ...s };
    const apply = () => {
      if (el instanceof LabSupply) el.volts = cur.volts;
      else el.volts = sourceWave(cur);
    };
    const ref = mains ? 'Сеть' : `Генератор ${this.netName(s.net)}`;
    const part: AnalogPart = {
      comp: pseudo(mains ? 'mains' : `source:${s.id}`, ref, `${s.wave === 'dc' ? '' : '~'}${s.volts} В${s.wave === 'dc' ? '' : `, ${fmtSi(s.freq ?? 50, 'Гц')}`}`),
      kind: mains ? 'сеть (по цепям L и N)' : `источник: ${WAVE_TITLES[s.wave]}`,
      sim: mains ? 'mains' : 'source',
      virtual: mains ? 'mains' : s.id,
      params: knobs,
      elements: [el],
      set: (k, val) => {
        this.sync();
        const q = knobs.find((x) => x.key === k);
        if (!q) return;
        q.value = val;
        if (k === 'volts') cur.volts = val;
        else if (k === 'freq') cur.freq = val;
        else if (k === 'offset') cur.offset = val;
        else if (k === 'duty') cur.duty = val / 100;
        else if (k === 'ilim' && el instanceof LabSupply) el.ilim = val;
        apply();
        e.invalidate();
      },
      readings: () => [
        { label: 'напряжение', value: e.volts(p) - e.volts(n), unit: 'В' },
        { label: 'ток', value: el instanceof LabSupply ? el.out(e.x, e.t) : -el.currents(e.x)[0], unit: 'А' },
      ],
    };
    this.addPart(part);
    if (!mains) this.sources.set(s.id, { s: cur, el, part });
    return part;
  }

  /** Отключить генератор на ходу (элемент остаётся, но ничего не отдаёт). */
  removeSource(id: string): void {
    const x = this.sources.get(id);
    if (!x) return;
    this.sync();
    if (x.el instanceof LabSupply) {
      x.el.volts = 0;
      x.el.ilim = 0;
      x.el.st = 1;
    } else {
      x.el.volts = 0;
      x.el.ohms = 1e9;
    }
    this.sources.delete(id);
    const i = this.parts.indexOf(x.part);
    if (i >= 0) this.parts.splice(i, 1);
    this.partOf.delete(x.part.comp.id);
    this.engine.invalidate();
  }

  /** Выход активного элемента на входе контроллера: его уровень передаётся в логическую схему. */
  private feed(node: Node): void {
    const net = this.netOfNode[node];
    if (node < 0 || !net || this.noMcu) return;
    const g = this.circuit.netGroup.get(net);
    if (g === undefined || !this.circuit.groups[g].pins.length) return;
    if (!this.feeds.some((f) => f.g === g)) this.feeds.push({ g, node, lvl: 0 });
  }

  /** Амплитуда величины за последние ~2000 шагов. */
  private amplitude(fn: () => number): () => number {
    let peak = 0;
    let acc = 0;
    let n = 0;
    this.engine.listen(() => {
      acc = Math.max(acc, Math.abs(fn()));
      if (++n >= 2000) {
        peak = acc;
        acc = 0;
        n = 0;
      }
    });
    return () => Math.max(peak, acc);
  }

  /**
   * Среднее за последние 20 мс (период сети; как инерция глаза для светодиода при ШИМ, мощность
   * лампы, нагрев ключа): 20 корзин по 1 мс. Чтение ничего не сбрасывает — карточка и показания
   * видят одно, а после выключения среднее уходит в ноль ровно за окно.
   */
  private average(fn: () => number, window = 0.02): () => number {
    const bins = 20;
    const bin = window / bins;
    const sum = new Float64Array(bins);
    const dur = new Float64Array(bins);
    let pos = 0;
    let acc = 0;
    let accT = 0;
    let prev = -1;
    let last = 0;
    this.engine.listen((e) => {
      const x = fn();
      last = x;
      if (prev < 0 || e.t < prev) {
        sum.fill(0);
        dur.fill(0);
        acc = accT = 0;
        prev = e.t;
        return;
      }
      const dt = e.t - prev;
      prev = e.t;
      acc += x * dt;
      accT += dt;
      if (accT >= bin) {
        sum[pos] = acc;
        dur[pos] = accT;
        pos = (pos + 1) % bins;
        acc = accT = 0;
      }
    });
    return () => {
      let s = acc;
      let t = accT;
      for (let i = 0; i < bins; i++) {
        s += sum[i];
        t += dur[i];
      }
      return t > 0 ? s / t : last;
    };
  }

  /** Частота по переходам через ноль за последние ~20 мс (0 — нет колебаний). */
  private frequency(fn: () => number): () => number {
    let hz = 0;
    let prev = 0;
    let first = -1;
    let last = -1;
    let count = 0;
    let t0 = 0;
    const e = this.engine;
    e.listen(() => {
      const val = fn();
      if (prev <= 0 && val > 0 && Math.abs(val) > 1e-4) {
        // Переход через ноль — с долей шага.
        const t = e.t - e.dt * (val / (val - prev));
        if (first < 0) first = t;
        last = t;
        count++;
      }
      prev = val;
      if (e.t - t0 >= 0.02) {
        // Медленные сигналы: окно растёт, пока не наберётся пара переходов (до 2 с).
        if (count >= 2 || e.t - t0 >= 2) {
          hz = count >= 2 ? (count - 1) / (last - first) : 0;
          first = last = -1;
          count = 0;
          t0 = e.t;
        }
      }
    });
    return () => hz;
  }

  /** Резонанс передатчика катушки с последовательной ёмкостью (по номиналам), Гц. */
  private txResonance(): number {
    const coil = this.coil;
    if (!coil) return 0;
    const txNode = coil.rtx.a;
    const cap = this.engine.elements.find((x): x is Capacitor => x instanceof Capacitor && (x.a === txNode || x.b === txNode));
    return cap ? 1 / (2 * Math.PI * Math.sqrt(coil.o.ltx * cap.farads)) : 0;
  }

  /**
   * Тепловой шум слышен только там, где его усиливают: у входов ОУ и на приёмной катушке.
   * Остальным резисторам шум выключается — это экономит время шага.
   */
  private quiet(): void {
    const loud = new Set<Node>();
    for (const el of this.engine.elements) if (el instanceof OpAmp) loud.add(el.inP).add(el.inN);
    if (this.coil) for (const q of this.coil.rrx.pins) loud.add(q.node);
    for (const el of this.engine.elements) if (el instanceof Resistor && el.noisy && !loud.has(el.a) && !loud.has(el.b)) el.noisy = false;
  }

  /** Рабочая точка: 20 мс крупным неявным шагом, потом время — с нуля. */
  private settle(): void {
    const e = this.engine;
    const dt = e.dt;
    const noise = e.noise;
    e.noise = false;
    e.implicit = true;
    e.setDt(50e-6);
    for (let i = 0; i < 400; i++) e.step();
    e.implicit = false;
    e.noise = noise;
    e.setDt(dt);
    e.t = 0;
    e.steps = 0;
    e.kick();
  }

  /** Досчитать движок до текущего такта контроллера. */
  sync(): void {
    const t = this.circuit.mcu.cycles / this.freq;
    const e = this.engine;
    if (t <= e.t + e.dt * 0.5) return;
    const coil = this.coil;
    while (e.t < t - e.dt * 0.5) {
      if (coil && e.t >= this.nextCoilUpdate - e.dt * 0.5) {
        coil.update(e.t);
        this.nextCoilUpdate = e.t + 0.5e-3;
      }
      e.advanceTo(coil ? Math.min(t, this.nextCoilUpdate) : t);
    }
    const c = this.circuit;
    const half = c.mcu.vdd / 2;
    for (const f of this.feeds) {
      const val = e.volts(f.node);
      const lvl: 0 | 1 = f.lvl ? (val > half * 0.8 ? 1 : 0) : val > half * 1.2 ? 1 : 0;
      if (lvl !== f.lvl) {
        f.lvl = lvl;
        c.setVolts(f.g, val);
      }
    }
  }

  /** Напряжение цепи, В (undefined — цепь не в аналоговой схеме). */
  netVolts(net: Id): number | undefined {
    const n = this.nodeOf.get(net);
    if (n === undefined) return undefined;
    this.sync();
    return this.engine.volts(n);
  }

  /** Нажатие кнопки (id устройства: «comp:B» или id детали). */
  press(id: string, down: boolean): void {
    const part = this.partOf.get(id.replace(/:B$/, ''));
    part?.ui?.press?.(down);
  }

  set(comp: Id, key: string, value: number): void {
    const part = this.partOf.get(comp);
    if (part && part.params.some((q) => q.key === key)) part.set(key, value);
  }

  /** Ток через каждый вывод деталей, А (положительный — в деталь). */
  padCurrents(): Map<Id, Map<string, number>> {
    const x = this.engine.x;
    const out = new Map<Id, Map<string, number>>();
    for (const el of this.engine.elements) {
      if (!el.comp || !el.currents) continue;
      const cur = el.currents(x);
      el.pins.forEach((pin, i) => {
        if (!pin.pad) return;
        const m = out.get(el.comp!) ?? new Map<string, number>();
        m.set(pin.pad, (m.get(pin.pad) ?? 0) + cur[i]);
        out.set(el.comp!, m);
      });
    }
    return out;
  }

  /* ---------------- осциллограф ---------------- */

  /** Каналы осциллографа (до 4) и шаг записи (каждый every-й шаг движка). */
  setScope(probes: ScopeProbe[], every: number, len = 4000): void {
    this.scopeFns = probes.slice(0, 4).map((pr) => this.probeFn(pr));
    this.scopeLen = len;
    this.scopeRing = this.scopeFns.map(() => new Float32Array(len));
    this.scopeEvery = Math.max(1, Math.round(every));
    this.scopePos = 0;
    this.scopeCount = 0;
    if (!this.scopeHooked) {
      this.scopeHooked = true;
      this.engine.listen((e) => {
        if (!this.scopeFns.length || ++this.scopeTick < this.scopeEvery) return;
        this.scopeTick = 0;
        const x = e.x;
        for (let k = 0; k < this.scopeFns.length; k++) this.scopeRing[k][this.scopePos] = this.scopeFns[k](x);
        this.scopePos = (this.scopePos + 1) % this.scopeLen;
        if (this.scopeCount < this.scopeLen) this.scopeCount++;
        this.scopeT = e.t;
      });
    }
  }
  private scopeHooked = false;

  /** Отсчёты каналов по порядку (старые → новые) и интервал между ними, с. */
  scope(): { data: Float32Array[]; dt: number; t: number } {
    const n = this.scopeCount;
    const data = this.scopeRing.map((ring) => {
      const out = new Float32Array(n);
      const start = (this.scopePos - n + this.scopeLen) % this.scopeLen;
      for (let i = 0; i < n; i++) out[i] = ring[(start + i) % this.scopeLen];
      return out;
    });
    return { data, dt: this.engine.dt * this.scopeEvery, t: this.scopeT };
  }

  private probeFn(pr: ScopeProbe): (x: Float64Array) => number {
    if ('net' in pr) {
      const n = this.nodeOf.get(pr.net);
      return n === undefined || n < 0 ? () => 0 : (x) => x[n];
    }
    const els = this.engine.elements.filter((el) => el.comp === pr.comp && el.currents && el.pins.some((q) => q.pad === pr.pad));
    return (x) => {
      let s = 0;
      for (const el of els) {
        const cur = el.currents!(x);
        el.pins.forEach((q, i) => {
          if (q.pad === pr.pad) s += cur[i];
        });
      }
      return s;
    };
  }

  /* ---------------- АЧХ ---------------- */

  /**
   * АЧХ от цепи inp (1 В переменного) до напряжения цепи out или тока через деталь (резистор,
   * конденсатор, дроссель, обмотку катушки). Ключи — в текущем состоянии.
   */
  acSweep(inp: Id, out: ScopeProbe, f1: number, f2: number, points = 200): { f: number; mag: number; phase: number }[] {
    this.sync();
    const e = this.engine;
    const ni = this.nodeOf.get(inp) ?? GND;
    const res: { f: number; mag: number; phase: number }[] = [];
    for (let k = 0; k < points; k++) {
      const f = f1 * Math.pow(f2 / f1, k / Math.max(1, points - 1));
      const sol = e.acAt(f, ni);
      if (!sol) continue;
      const vv = (n: Node): [number, number] => (n < 0 ? [0, 0] : [sol.re[n], sol.im[n]]);
      let re = 0;
      let im = 0;
      if ('net' in out) [re, im] = vv(this.nodeOf.get(out.net) ?? GND);
      else {
        const w = 2 * Math.PI * f;
        for (const el of e.elements) {
          if (el.comp !== out.comp) continue;
          const idx = el.pins.findIndex((q) => q.pad === out.pad);
          if (idx < 0) continue;
          if (el instanceof CoupledCoils) {
            // Ток обмотки p = Σ Γpq·Vq / (jω).
            const p = idx >> 1;
            const m = el.coils.length;
            const G = el.inverseL;
            let sr = 0;
            let si = 0;
            for (let q = 0; q < m; q++) {
              const [ar, ai] = vv(el.coils[q].a);
              const [br, bi] = vv(el.coils[q].b);
              sr += G[p * m + q] * (ar - br);
              si += G[p * m + q] * (ai - bi);
            }
            const sign = idx % 2 ? -1 : 1;
            re += (sign * si) / w;
            im += (-sign * sr) / w;
            continue;
          }
          if (el.pins.length !== 2) continue;
          const [ar, ai] = vv(el.pins[0].node);
          const [br, bi] = vv(el.pins[1].node);
          const dr = ar - br;
          const di = ai - bi;
          const sign = idx === 0 ? 1 : -1;
          if (el instanceof Resistor) (re += (sign * dr) / el.ohms), (im += (sign * di) / el.ohms);
          else if (el instanceof Capacitor) (re += -sign * di * w * el.farads), (im += sign * dr * w * el.farads);
          else if (el instanceof Inductor) (re += (sign * di) / (w * el.henry)), (im += (-sign * dr) / (w * el.henry));
        }
      }
      res.push({ f, mag: Math.hypot(re, im), phase: (Math.atan2(im, re) * 180) / Math.PI });
    }
    return res;
  }

  /** Цепь, с которой удобно начинать АЧХ: выход ключей передатчика катушки или генератор. */
  defaultAcInput(): Id | null {
    const coil = this.coil;
    if (!coil) {
      const gen = [...this.sources.values()].find((x) => x.s.wave !== 'dc');
      return gen?.s.net ?? null;
    }
    // Катушка ← конденсатор ← резистор ← выход ключей.
    let node = coil.rtx.a;
    const seen = new Set<AnalogElement>();
    for (let hop = 0; hop < 3; hop++) {
      const el = this.engine.elements.find((x) => !seen.has(x) && (x instanceof Capacitor || (x instanceof Resistor && x.ohms <= 100 && x.comp !== coil.rtx.comp)) && x.pins.some((q) => q.node === node) && x.pins.every((q) => q.node !== GND));
      if (!el) break;
      seen.add(el);
      node = el.pins.find((q) => q.node !== node)!.node;
    }
    return this.netOfNode[node] ?? null;
  }

  /** Сколько узлов и разложений: для подсказки о скорости. */
  get stats(): { nodes: number; elements: number; steps: number; factorizations: number } {
    const e = this.engine;
    return { nodes: e.n, elements: e.elements.length, steps: e.steps, factorizations: e.factorizations };
  }
}

/** Напряжение цепи питания по имени (для подсказок): +12V → 12. */
export { powerVoltsOf };
