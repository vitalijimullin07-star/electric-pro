import type { Component, FootprintDef, Id, Project } from '../model/types';
import { isResistor, parseOhms, type Circuit } from './circuit';
import type { Device, DeviceView, SimParam } from './devices';

/*
 * Установка «пылесос» для симуляции: сеть 230 В, симисторы с оптронами MOC (случайной
 * фазы — для фазового управления, с детектором нуля — для клапанов и розетки), реле в цепи
 * нагрузок (катушка — через ключ на плате), коллекторные двигатели с вентиляторами, шланг,
 * бак с водой (электроды и поплавок), фильтр из двух секций с продувкой, соленоиды клапанов
 * (ток втягивания и удержания), инструмент в розетке, нагрев двигателей, детектор нуля.
 * Детали находятся по схеме: метки корпусов (universal-motor, triac, solenoid-valve,
 * tool-outlet, current-transformer, transformer, mains, relay, water-electrode, float-switch)
 * и цепи между ними (симистор → предохранитель → контакт реле); датчики привязаны к месту
 * полем «Где стоит» (M1, M2, фильтр, расходомер, вход турбин, бак).
 * Всё считается по полупериодам сети; мгновенный ток — синусоида с отсечкой по фазе.
 */

const RHO = 1.2;
/** Вентилятор турбины: разрежение при закрытом входе (кПа при скорости запирания) и расход, м³/с. */
const FAN_SEALED = 24_000;
const S_SEALED = 1.22;
const FAN_PREF = FAN_SEALED / (S_SEALED * S_SEALED);
const FAN_QMAX = 0.055;
/** Обратный поток через остановленную турбину, м³/с на √Па. */
const FAN_BACK = 1.2e-4;
/** Фильтр: чистый — 120 Па при 43 л/с. */
const FILTER_K0 = 6.5e4;
/** Расходомер (сопло Вентури): 100 Па при 60 л/с — под SDP810-125Pa и коэффициент 21,6 в прошивке. */
const VENTURI_K = 100 / 0.06 ** 2;
/** Клапан продувки: 8 л/с при 15 кПа. */
const VALVE_CV = 0.008 / Math.sqrt(15_000);
/** Двигатель: момент при номинале, момент инерции, трение. */
const MOTOR_R0 = 0.15;
const MOTOR_C = (0.35 + 0.65 * 0.55 + 0.02) * (1 + MOTOR_R0) ** 2;
const MOTOR_J = 5;
/** Нагрев: теплоёмкость, Дж/К; теплоотдача при номинальном потоке, Вт/К. */
const MOTOR_CTH = 3000;
const MOTOR_G = 10;

const HOSES = [27, 32, 36, 38, 50];
const TRIAC_STATES = ['исправен', 'пробит (всегда открыт)', 'обрыв (не открывается)'];
const RELAY_STATES = ['исправно', 'сварилось (всегда замкнуто)', 'не замыкается'];
const VALVE_STATES = ['исправен', 'не втягивается (заклинил)', 'обрыв катушки'];
/** Вода между электродами, Ом: водопроводная, грязная, дистиллированная, пена. */
const WATER_OHMS = [2000, 500, 150_000, 1_000_000];
const WATER_KINDS = ['водопроводная', 'грязная', 'дистиллированная', 'пена'];
/** Соленоид: якорь втягивается за 25 мс — ток падает с пускового до тока удержания. */
const PULL_MS = 25;

const param = (key: string, label: string, value: number, min: number, max: number, step: number, unit: string, options?: string[]): SimParam => ({ key, label, value, min, max, step, unit, options });

const up = (s: string | undefined) => (s ?? '').toUpperCase();

function padNet(c: Component, fp: FootprintDef, name: string): Id | undefined {
  const pad = fp.pads.find((q) => up(q.name ?? q.number) === up(name));
  return pad ? c.padNets[pad.number] : undefined;
}

/** Где стоит датчик: поле «Где стоит» у детали. */
export function placeOf(c: Component): string {
  return (c.fields?.['Где стоит'] ?? '').trim();
}

interface Load {
  comp: Component;
  kind: 'motor' | 'valve' | 'tool';
  nets: Id[];
  triac?: Triac;
}

interface Relay {
  comp: Component;
  /** Группы цепей катушки. */
  coil: number[];
  /** Команда (катушка под током) и контакт (с задержкой срабатывания). */
  cmd: boolean;
  closed: boolean;
  params: SimParam[];
}

interface Triac {
  comp: Component;
  mt1?: Id;
  mt2?: Id;
  g?: Id;
  moc?: Moc;
  /** Реле, через контакт которого симистор получает сеть (через предохранитель). */
  relay?: Relay;
  state: number;
  /** Когда открылся в текущем полупериоде (мкс) или null. */
  firedAt: number | null;
  /** Доля полупериода, когда был открыт в прошлом полупериоде, и квадрат действующего напряжения. */
  lastCond: number;
  lastU2: number;
}

interface Moc {
  comp: Component;
  zeroCross: boolean;
  led?: number;
  ledGnd: boolean;
  /** Ток светодиода, мА, и нужный для включения. */
  ma: number;
  needMa: number;
}

interface Motor {
  load: Load;
  params: SimParam[];
  s: number;
  temp: number;
  amps: number;
  watts: number;
  ifull: number;
  q: number;
  qm3: number;
}

interface Valve {
  load: Load;
  params: SimParam[];
  open: boolean;
  /** Сколько катушка под током, мс (якорь втягивается за PULL_MS). */
  onMs: number;
  openMs: number;
  amps: number;
}

export interface VacuumView {
  mains: { volts: number; hz: number; dip: boolean };
  motors: { ref: string; rpm: number; speed: number; amps: number; watts: number; temp: number; firing: number; conducting: boolean; fault: string | null; triac: string | null }[];
  valves: { ref: string; open: boolean; amps: number; fault: string | null }[];
  relays: { ref: string; closed: boolean; fault: string | null }[];
  tank: { level: number; liters: number; e: [boolean, boolean]; float: boolean; sucking: boolean } | null;
  tool: { ref: string; on: boolean; powered: boolean; amps: number; watts: number } | null;
  air: { flow: number; speed: number; vacuum: number; tank: number; filterDp: number; flowDp: number; cake: [number, number]; deep: number; block: number; hoseMm: number; hoseM: number };
  zc: { width: number; ok: boolean };
}

export class VacuumPlant {
  readonly claimed = new Set<Id>();
  readonly devices: Device[] = [];
  private motors: Motor[] = [];
  private valves: Valve[] = [];
  private triacs: Triac[] = [];
  private tool: { load: Load; params: SimParam[]; on: boolean; since: number; amps: number } | null = null;
  private cts: { comp: Component; loads: Load[]; ratio: number; s1?: Id; s2?: Id }[] = [];
  private mainsP: SimParam[];
  private airP: SimParam[];
  private envP: SimParam[];
  private freq = 1e6;
  private halfStart = 0;
  /** Знак напряжения в текущем полупериоде. */
  private halfSign = 1;
  private dipUntil = -1;
  private zcGroup: number | undefined;
  private zcVth = 3.7;
  private zcRatio = 9 / 230;
  private zcWidth = 0;
  private cake: [number, number] = [0.05, 0.05];
  private blockHeld = false;
  private relays: Relay[] = [];
  private tank: { level: number; sucking: boolean; params: SimParam[]; floatGroup?: number; e: { net: Id; at: number }[]; drive?: number; wet: [boolean, boolean] } | null = null;
  private air = { p: 0, tank: 0, qh: 0, filterDp: 0, flowDp: 0, qv: 0 };

  private constructor(
    private c: Circuit,
    private p: Project,
  ) {
    this.freq = c.mcu.freq;
    this.mainsP = [param('u', 'напряжение сети', 230, 150, 260, 1, 'В'), param('f', 'частота', 0, 0, 1, 1, '', ['50 Гц', '60 Гц'])];
    this.airP = [
      param('hoseM', 'длина шланга', 5, 1, 15, 0.5, 'м'),
      param('hose', 'диаметр шланга', 2, 0, HOSES.length - 1, 1, '', HOSES.map((d) => `${d} мм`)),
      param('block', 'шланг перекрыт', 0, 0, 100, 1, '%'),
      param('deep', 'фильтр забит насовсем', 0, 0, 100, 1, '%'),
      param('dust', 'пыльность работы', 3, 0, 10, 0.5, ''),
      param('filter', 'фильтр', 0, 0, 2, 1, '', ['стоит', 'порван', 'снят']),
    ];
    this.envP = [param('amb', 'температура воздуха', 25, -10, 45, 1, '°C'), param('boost', 'ускорить нагрев', 10, 1, 60, 1, '×')];
  }

  get hz(): number {
    return this.mainsP[1].value ? 60 : 50;
  }
  get volts(): number {
    return this.c.mcu.cycles < this.dipUntil ? 0 : this.mainsP[0].value;
  }
  private get halfUs(): number {
    return 1e6 / (2 * this.hz);
  }
  private get us(): number {
    return (this.c.mcu.cycles / this.freq) * 1e6;
  }
  private toCycles(us: number): number {
    return (us * this.freq) / 1e6;
  }

  /** Установка есть, если на схеме есть двигатели с меткой universal-motor. */
  static detect(c: Circuit, p: Project): VacuumPlant | null {
    const has = Object.values(p.components).some((x) => (p.footprints[x.footprint]?.tags ?? []).includes('universal-motor'));
    if (!has) return null;
    const plant = new VacuumPlant(c, p);
    plant.build();
    return plant;
  }

  private tagged(tag: string): { comp: Component; fp: FootprintDef }[] {
    const out: { comp: Component; fp: FootprintDef }[] = [];
    for (const comp of Object.values(this.p.components)) {
      const fp = this.p.footprints[comp.footprint];
      if (fp && (fp.tags ?? []).includes(tag)) out.push({ comp, fp });
    }
    return out.sort((a, b) => a.comp.ref.localeCompare(b.comp.ref, 'ru', { numeric: true }));
  }

  private build(): void {
    const p = this.p;
    const c = this.c;
    // Нагрузки.
    const loads: Load[] = [];
    for (const [tag, kind] of [
      ['universal-motor', 'motor'],
      ['solenoid-valve', 'valve'],
      ['tool-outlet', 'tool'],
    ] as const)
      for (const { comp, fp } of this.tagged(tag)) {
        const nets = fp.pads.map((q) => comp.padNets[q.number]).filter((n): n is Id => !!n);
        loads.push({ comp, kind, nets });
        this.claimed.add(comp.id);
      }
    // Трансформаторы тока: первичная обмотка — перемычка в силовой цепи.
    const ctPrim = new Map<Id, Id>();
    for (const { comp, fp } of this.tagged('current-transformer')) {
      const p1 = padNet(comp, fp, 'P1');
      const p2 = padNet(comp, fp, 'P2');
      if (p1 && p2) {
        ctPrim.set(p1, p2);
        ctPrim.set(p2, p1);
      }
      const m = /(\d+)\s*[:/]\s*1\b/.exec(comp.value);
      // Через окно — провод, общий для нагрузок одной стороны; другая сторона бывает общей
      // шиной (ноль N): её нагрузки через окно не идут.
      const bus = (n: Id | undefined) => !!n && /^(N|L|N_IN|L_IN|PE)$/i.test(p.nets[n]?.name ?? '');
      const side = (n: Id | undefined) => loads.filter((l) => n && l.nets.includes(n));
      const a = side(p1);
      const b = side(p2);
      const on = a.length && b.length ? (bus(p2) ? a : bus(p1) ? b : [...a, ...b]) : [...a, ...b];
      this.cts.push({ comp, loads: on, ratio: m ? +m[1] : 1000, s1: padNet(comp, fp, 'S1'), s2: padNet(comp, fp, 'S2') });
      this.claimed.add(comp.id);
    }
    const through = (n: Id | undefined): Id[] => (n ? [n, ...(ctPrim.has(n) ? [ctPrim.get(n)!] : [])] : []);
    // Реле: катушка между питанием и ключом; контакты COM/NO — в цепи нагрузки.
    for (const { comp, fp } of this.tagged('relay')) {
      const coil = fp.pads.filter((q) => /^COIL/i.test(q.name ?? '') || ((q.number === '1' || q.number === '2') && !q.name)).map((q) => comp.padNets[q.number]);
      const groups = coil.map((n) => (n ? c.netGroup.get(n) : undefined)).filter((g): g is number => g !== undefined);
      const r: Relay = { comp, coil: groups, cmd: false, closed: false, params: [param('fault', 'реле', 0, 0, 2, 1, '', RELAY_STATES)] };
      (r as Relay & { no?: Id; com?: Id }).no = padNet(comp, fp, 'NO');
      (r as Relay & { no?: Id; com?: Id }).com = padNet(comp, fp, 'COM');
      this.relays.push(r);
      this.claimed.add(comp.id);
    }
    // Предохранители: двухвыводные детали с номиналом «T2A», «0,5 А» или корпусом Fuse.
    const fuseNext = new Map<Id, Id>();
    for (const comp of Object.values(p.components)) {
      const fp = p.footprints[comp.footprint];
      if (!fp || !(/^Fuse/i.test(fp.id) || /^T?\s*\d+([.,]\d+)?\s*m?А?A?$/i.test(comp.value.trim()) && /^FU/i.test(comp.ref))) continue;
      const nets = fp.pads.map((q) => comp.padNets[q.number]).filter((n): n is Id => !!n);
      if (nets.length === 2) fuseNext.set(nets[0], nets[1]), fuseNext.set(nets[1], nets[0]);
    }
    const relayOf = (net: Id | undefined): Relay | undefined => {
      const seen = new Set<Id>();
      for (let n = net; n && !seen.has(n); n = fuseNext.get(n)) {
        seen.add(n);
        const r = this.relays.find((x) => {
          const y = x as Relay & { no?: Id; com?: Id };
          return y.no === n || y.com === n;
        });
        if (r) return r;
      }
      return undefined;
    };
    // Оптроны MOC30xx.
    const mocs: { moc: Moc; out: Id[] }[] = [];
    for (const comp of Object.values(p.components)) {
      const m = /MOC\s*30([0-9])([0-9])/i.exec(comp.value);
      if (!m) continue;
      const fp = p.footprints[comp.footprint];
      if (!fp) continue;
      const net = (n: string) => comp.padNets[n];
      const led = net('1') ? c.netGroup.get(net('1')) : undefined;
      const k = net('2') ? c.netGroup.get(net('2')) : undefined;
      const moc: Moc = { comp, zeroCross: +m[1] >= 4, led, ledGnd: k !== undefined && c.groups[k].power === 'gnd', ma: 0, needMa: +m[2] === 1 ? 15 : +m[2] === 2 ? 10 : 5 };
      // Ток светодиода: резистор от вывода контроллера к аноду.
      moc.ma = 3.3 - 1.15;
      let ohms = 0;
      for (const rc of Object.values(p.components)) {
        const rf = p.footprints[rc.footprint];
        if (!rf || !isResistor(rf)) continue;
        const nets = rf.pads.map((q) => rc.padNets[q.number]);
        if (nets.includes(net('1'))) ohms = parseOhms(rc.value) ?? 0;
      }
      moc.ma = ohms ? ((c.mcu.vdd - 1.15) / ohms) * 1000 : 0;
      mocs.push({ moc, out: [net('4'), net('6')].filter((x): x is Id => !!x) });
      this.claimed.add(comp.id);
    }
    // Симисторы: к какому оптрону подключён затвор, какая нагрузка на MT2/MT1.
    for (const { comp, fp } of this.tagged('triac')) {
      const pn = (...names: string[]) => names.map((n) => padNet(comp, fp, n)).find(Boolean);
      const t: Triac = { comp, mt1: pn('MT1', 'T1', 'A1'), mt2: pn('MT2', 'T2', 'A2'), g: pn('G'), state: 0, firedAt: null, lastCond: 0, lastU2: 0 };
      t.moc = mocs.find((m) => t.g && m.out.includes(t.g))?.moc;
      const ends = [...through(t.mt1), ...through(t.mt2)];
      for (const l of loads)
        if (!l.triac && l.nets.some((n) => ends.includes(n))) {
          l.triac = t;
          // Вывод симистора со стороны сети (не к нагрузке) — через предохранитель к реле.
          const onLoad = (n: Id | undefined) => !!n && through(n).some((x) => l.nets.includes(x));
          t.relay = relayOf(onLoad(t.mt1) ? t.mt2 : t.mt1);
        }
      this.triacs.push(t);
      this.claimed.add(comp.id);
    }
    for (const l of loads) {
      if (l.kind === 'motor') this.addMotor(l);
      else if (l.kind === 'valve') this.addValve(l);
      else this.addTool(l);
    }
    for (const t of this.triacs) this.addTriacDevice(t);
    for (const r of this.relays) this.addRelayDevice(r);
    this.findTank();
    this.findZeroCross();
    for (const ct of this.cts) this.addCt(ct);
    for (const m of [...this.tagged('mains'), ...this.tagged('mains-switch')]) this.claimed.add(m.comp.id);
    this.addMainsDevice();
    this.addAirDevice();

    // Светодиоды оптронов: фронт — симистор может открыться. Катушки реле — по ключу.
    c.onChange((g, lvl, cycle) => {
      // Катушка: ключ меняет «висит» на «0» без смены уровня — проверяем при любом изменении.
      for (const r of this.relays) this.relayUpdate(r);
      if (lvl !== 1) return;
      for (const t of this.triacs) if (t.moc && t.moc.led === g) this.gateOn(t, (cycle / this.freq) * 1e6);
    });
    for (const r of this.relays) this.relayUpdate(r);
    // Полупериоды сети.
    this.halfStart = this.us;
    this.startHalf();
  }

  /* ---------------- электричество ---------------- */

  /** Катушка под током: одна сторона на питании, другую ключ притянул к земле. */
  private relayEnergized(r: Relay): boolean {
    const c = this.c;
    if (r.coil.length < 2) return false;
    const vcc = r.coil.some((g) => c.groups[g].power === 'vcc');
    const low = r.coil.some((g) => !c.groups[g].power && !c.isFloating(g) && c.levelOf(g) === 0);
    return vcc && low;
  }

  /** Контакт догоняет катушку: срабатывание 8 мс, отпускание 4 мс. */
  private relayUpdate(r: Relay): void {
    const cmd = this.relayEnergized(r);
    if (cmd === r.cmd) return;
    r.cmd = cmd;
    this.c.mcu.schedule(() => {
      if (r.cmd === cmd) r.closed = cmd;
    }, this.toCycles(cmd ? 8000 : 4000));
  }

  private relayClosed(r: Relay | undefined): boolean {
    if (!r) return true;
    const f = r.params[0].value;
    return f === 1 ? true : f === 2 ? false : r.closed;
  }

  /** На симистор приходит сеть (контакт реле перед ним замкнут). */
  private powered(t: Triac): boolean {
    return this.volts > 0 && this.relayClosed(t.relay);
  }

  private ledOn(t: Triac): boolean {
    const m = t.moc;
    if (!m || m.led === undefined || !m.ledGnd) return false;
    return this.c.levelOf(m.led) === 1 && !this.c.isFloating(m.led) && m.ma >= m.needMa;
  }

  /** Мгновенное напряжение сети в момент t (мкс) текущего полупериода, В. */
  private vAt(t: number): number {
    if (this.volts <= 0) return 0;
    const ph = ((t - this.halfStart) / this.halfUs) * Math.PI;
    return this.halfSign * this.volts * Math.SQRT2 * Math.sin(Math.max(0, Math.min(Math.PI, ph)));
  }

  private fire(t: Triac, at: number): void {
    if (t.state !== 0 || t.firedAt !== null || !this.powered(t)) return;
    t.firedAt = at;
  }

  /** Светодиод оптрона загорелся в момент at. */
  private gateOn(t: Triac, at: number): void {
    if (!t.moc || t.firedAt !== null || !this.ledOn(t)) return;
    const v = Math.abs(this.vAt(at));
    if (t.moc.zeroCross) {
      // С детектором нуля: откроется только у нуля (до 20 В), иначе — в следующем полупериоде.
      if (v < 20) this.fire(t, at);
      return;
    }
    if (v >= 10) this.fire(t, at);
    else {
      // У самого нуля: откроется, когда напряжение дорастёт до 10 В (если светодиод ещё горит).
      const wait = (Math.asin(Math.min(1, 10 / Math.max(10, this.volts * Math.SQRT2))) / Math.PI) * this.halfUs;
      const target = this.halfStart + wait;
      if (target > at) this.c.mcu.schedule(() => this.ledOn(t) && this.fire(t, this.us), this.toCycles(target - at));
      else this.fire(t, at);
    }
  }

  /** Новый полупериод: итоги прошлого, симисторы закрываются, детектор нуля. */
  private startHalf(): void {
    const now = this.halfStart;
    const hu = this.halfUs;
    // Итоги прошлого полупериода.
    for (const t of this.triacs) {
      const cond = t.firedAt === null || !this.relayClosed(t.relay) ? 0 : Math.max(0, Math.min(1, 1 - (t.firedAt - (now - hu)) / hu));
      const a = (1 - cond) * Math.PI;
      t.lastCond = cond;
      t.lastU2 = cond <= 0 ? 0 : Math.max(0, 1 - a / Math.PI + Math.sin(2 * a) / (2 * Math.PI));
      t.firedAt = null;
    }
    for (const r of this.relays) this.relayUpdate(r);
    this.step(hu / 1e6);
    // Новый полупериод: пробитые открыты сразу, горящие оптроны открывают у нуля.
    for (const t of this.triacs) {
      if (t.state === 1 && this.powered(t)) t.firedAt = now;
      else if (this.ledOn(t)) {
        const wait = t.moc!.zeroCross ? 150 : (Math.asin(Math.min(1, 10 / Math.max(10, this.volts * Math.SQRT2))) / Math.PI) * hu;
        this.c.mcu.schedule(() => this.ledOn(t) && this.fire(t, this.us), this.toCycles(wait));
      }
    }
    this.halfSign = -this.halfSign;
    this.scheduleZeroCross(now + hu);
    this.c.mcu.schedule(() => {
      this.halfStart += hu;
      this.startHalf();
    }, this.toCycles(this.halfStart + hu - this.us));
  }

  /** Детектор нуля: транзистор закрыт, пока выпрямленное напряжение ниже порога. */
  private scheduleZeroCross(zc: number): void {
    const g = this.zcGroup;
    if (g === undefined) return;
    const vpk = this.volts * Math.SQRT2 * this.zcRatio * 1.15 - 1.4;
    if (vpk <= this.zcVth) {
      // Сети нет или напряжение мало: транзистор всё время закрыт — на входе «1».
      this.zcWidth = 0;
      this.c.drive(g, 'vacuum-zc', null);
      return;
    }
    const w = ((2 * Math.asin(this.zcVth / vpk)) / Math.PI) * this.halfUs;
    this.zcWidth = w;
    const shift = 120; // фазовый сдвиг трансформатора, мкс
    const a = zc - w / 2 + shift;
    const b = zc + w / 2 + shift;
    const now = this.us;
    this.c.mcu.schedule(() => this.c.drive(g, 'vacuum-zc', null), this.toCycles(Math.max(1, a - now)));
    this.c.mcu.schedule(() => this.c.drive(g, 'vacuum-zc', this.volts > 0 ? 0 : null), this.toCycles(Math.max(2, b - now)));
  }

  private findZeroCross(): void {
    const p = this.p;
    const c = this.c;
    // Трансформатор: коэффициент по номиналу «230/9 В».
    const tr = this.tagged('transformer')[0];
    if (tr) {
      const m = /(\d+)\s*\/\s*(\d+(?:[.,]\d+)?)/.exec(tr.comp.value);
      if (m) this.zcRatio = parseFloat(m[2].replace(',', '.')) / +m[1];
      this.claimed.add(tr.comp.id);
    }
    // Мост: «+» — пульсирующее выпрямленное напряжение.
    let vrect: Id | undefined;
    for (const comp of Object.values(p.components)) {
      const fp = p.footprints[comp.footprint];
      if (!fp || !/Bridge/i.test(fp.id)) continue;
      vrect = padNet(comp, fp, '+');
      this.claimed.add(comp.id);
    }
    if (!vrect) return;
    // Транзистор, база которого через резистор от моста; порог по делителю в базе.
    const resistors = Object.values(p.components).filter((x) => p.footprints[x.footprint] && isResistor(p.footprints[x.footprint]));
    for (const comp of Object.values(p.components)) {
      const fp = p.footprints[comp.footprint];
      if (!fp) continue;
      const b = padNet(comp, fp, 'B');
      const col = padNet(comp, fp, 'C');
      if (!b || !col) continue;
      const rin = resistors.find((r) => Object.values(r.padNets).includes(b) && Object.values(r.padNets).includes(vrect!));
      if (!rin) continue;
      const rb = resistors.find((r) => r !== rin && Object.values(r.padNets).includes(b) && Object.values(r.padNets).some((n) => n !== b && c.groups[c.netGroup.get(n) ?? -1]?.power === 'gnd'));
      const Rin = parseOhms(rin.value) ?? 47_000;
      const Rb = rb ? (parseOhms(rb.value) ?? 10_000) : 1e9;
      this.zcVth = 0.65 * (Rin + Rb) / Rb;
      this.zcGroup = c.netGroup.get(col);
      this.claimed.add(comp.id);
      c.drive(this.zcGroup, 'vacuum-zc', 0);
      return;
    }
  }

  /** Действующий ток нагрузки при полной проводимости, А. */
  private loadFullAmps(l: Load): number {
    if (l.kind === 'motor') return this.motors.find((m) => m.load === l)?.ifull ?? 0;
    if (l.kind === 'valve') {
      const v = this.valves.find((x) => x.load === l);
      return v ? this.valveVa(v) / Math.max(1, this.volts) * (this.volts / 230) : 0;
    }
    const t = this.tool;
    if (!t || !t.on) return 0;
    const inrush = 1 + 2.5 * Math.exp(-(this.us - t.since) / 150_000);
    return (t.params[0].value / 230) * (this.volts / 230) * inrush;
  }

  /** Мгновенный ток нагрузки, А (синусоида с отсечкой). */
  /** Полная мощность соленоида сейчас, ВА: пусковая, пока якорь не втянулся, потом — удержания. */
  private valveVa(v: Valve): number {
    const f = v.params[2].value;
    if (f === 2) return 0;
    return f === 1 || v.onMs < PULL_MS ? v.params[0].value : v.params[1].value;
  }

  private loadAmps(l: Load, t: number): number {
    const tr = l.triac;
    if (!tr || tr.firedAt === null || t < tr.firedAt || !this.powered(tr)) return 0;
    return this.vAt(t) / (this.volts * Math.SQRT2) * Math.SQRT2 * this.loadFullAmps(l);
  }

  /* ---------------- механика и пневматика (раз в полупериод) ---------------- */

  private step(dt: number): void {
    const V = this.volts;
    const amb = this.envP[0].value;
    const boost = this.envP[1].value;
    // Турбины: момент двигателя против нагрузки вентилятора.
    for (const m of this.motors) {
      const tr = m.load.triac;
      const cond2 = tr ? tr.lastU2 : 0;
      const wear = m.params[1].value / 100;
      const open = m.params[2].value === 1;
      const r = MOTOR_R0 * (1 + 3 * wear);
      const u2 = (V / 230) ** 2 * cond2 * (open ? 0 : 1);
      const inom = m.params[0].value / 230;
      m.ifull = open ? 0 : inom * (V / 230) * (1 + MOTOR_R0) / (r + m.s);
      const tm = (MOTOR_C * u2) / (r + m.s) ** 2 / (1 + wear);
      const tl = m.s * m.s * (0.35 + 0.65 * m.q) + 0.02 * m.s;
      m.s = Math.max(0, m.s + ((tm - tl) * dt) / MOTOR_J);
      m.amps = m.ifull * Math.sqrt(cond2);
      m.watts = V * m.amps * 0.95;
      const loss = m.watts * 0.5;
      const g = MOTOR_G * (0.35 + 0.65 * m.q) / (0.35 + 0.65 * 0.55);
      m.temp += ((loss - g * (m.temp - amb)) * boost * dt) / MOTOR_CTH;
    }
    for (const v of this.valves) {
      const tr = v.load.triac;
      const powered = !!tr && tr.lastCond > 0.5 && V > 0 && v.params[2].value !== 2;
      v.amps = powered ? this.valveVa(v) / Math.max(1, V) * (V / 230) : 0;
      v.onMs = powered ? v.onMs + dt * 1000 : 0;
      // Втянулся якорь — клапан открыт; заклинивший не открывается (и ток не падает).
      const on = powered && v.params[2].value === 0;
      v.openMs = on ? v.openMs + dt * 1000 : 0;
      const was = v.open;
      v.open = v.openMs >= 15;
      // Продувка: удар воздуха при открытии сбивает часть пыли с секции (тем больше, чем
      // сильнее разрежение), пока клапан открыт — ещё немного.
      if (v.open) {
        const k = this.valves.indexOf(v) % 2;
        const strength = Math.min(1, this.air.p / 12_000);
        if (!was) this.cake[k] *= 1 - 0.3 * strength;
        this.cake[k] = Math.max(0, this.cake[k] * (1 - 3.5 * strength * dt));
      }
    }
    if (this.tool) {
      const tr = this.tool.load.triac;
      this.tool.amps = this.tool.on && tr && tr.lastCond > 0.5 ? this.loadFullAmps(this.tool.load) : 0;
    }
    this.pneumatics(dt);
    this.water(dt);
  }

  private hoseK(): number {
    const d = HOSES[Math.round(this.airP[1].value)] / 1000;
    const L = this.airP[0].value;
    const A = (Math.PI * d * d) / 4;
    const block = Math.min(0.995, (this.blockHeld ? 95 : this.airP[2].value) / 100);
    const k = (0.05 * L * RHO) / (2 * d * A * A) + (1.5 * RHO) / (2 * A * A);
    return k / (1 - block) ** 2;
  }

  private filterK(): number {
    const deep = this.airP[3].value / 100;
    const sec = this.cake.map((x) => 4 * FILTER_K0 * (1 + 3 * x + 8 * deep));
    const k = 1 / (1 / Math.sqrt(sec[0]) + 1 / Math.sqrt(sec[1])) ** 2;
    // Порванный — воздух идёт мимо ткани, снятый — перепада почти нет.
    const state = this.airP[5]?.value ?? 0;
    return state === 1 ? k * 0.06 : state === 2 ? k * 0.005 : k;
  }

  private pneumatics(dt: number): void {
    const kh = this.hoseK();
    const kf = this.filterK();
    const openValves = this.valves.filter((v) => v.open).length;
    const speeds = this.motors.map((m) => m.s);
    const fanQ = (s: number, pc: number) => {
      const back = -FAN_BACK * Math.sqrt(pc);
      if (s < 0.05) return back;
      return Math.max(FAN_QMAX * s * (1 - pc / (FAN_PREF * s * s)), back);
    };
    const f = (pc: number) => speeds.reduce((a, s) => a + fanQ(s, pc), 0) - Math.sqrt(pc / (kh + kf)) - openValves * VALVE_CV * Math.sqrt(pc);
    let lo = 0;
    let hi = Math.max(1, ...speeds.map((s) => FAN_PREF * s * s)) * 1.05;
    if (f(0) <= 0) hi = 0;
    for (let i = 0; i < 50 && hi > 0; i++) {
      const mid = (lo + hi) / 2;
      if (f(mid) > 0) lo = mid;
      else hi = mid;
    }
    const pc = (lo + hi) / 2;
    const qh = Math.sqrt(pc / (kh + kf));
    this.air = { p: pc, tank: kh * qh * qh, qh, filterDp: kf * qh * qh, flowDp: VENTURI_K * qh * qh, qv: openValves * VALVE_CV * Math.sqrt(pc) };
    this.motors.forEach((m, i) => {
      const q = fanQ(speeds[i], pc);
      m.qm3 = q;
      m.q = speeds[i] > 0.05 ? Math.max(0, Math.min(1.2, q / (FAN_QMAX * speeds[i]))) : 0;
    });
    // Пыль копится, пока идёт поток (с инструментом — быстрее).
    const dust = this.airP[4].value * (this.tool?.amps ? 1 : 0.25);
    const grow = dust * 0.0015 * (qh / 0.043) * dt;
    this.cake = [Math.min(2, this.cake[0] + grow), Math.min(2, this.cake[1] + grow)];
  }

  /* ---------------- датчики для devices.ts ---------------- */

  /** Температура двигателя по обозначению (для термистора с полем «Где стоит»). */
  temperatureOf(where: string): (() => number) | null {
    const m = this.motors.find((x) => up(x.load.comp.ref) === up(where));
    return m ? () => m.temp : null;
  }

  /** Перепад давления для датчика, Па: «фильтр», «расходомер», «вход турбин» (разрежение). */
  pressureOf(where: string): (() => number) | null {
    const w = where.toLowerCase();
    if (/фильтр/.test(w)) return () => this.air.filterDp;
    if (/расход|вентури|шланг/.test(w)) return () => this.air.flowDp;
    if (/вход|турбин|разреж/.test(w)) return () => this.air.p;
    if (/бак/.test(w)) return () => this.air.tank;
    return null;
  }

  /* ---------------- устройства для панели ---------------- */

  private addMotor(l: Load): void {
    const rated = /(\d{3,4})\s*(Вт|W)/i.exec(l.comp.value);
    const m: Motor = {
      load: l,
      params: [param('w', 'мощность (номинал)', rated ? Math.min(2000, Math.max(400, +rated[1])) : 1200, 400, 2000, 50, 'Вт'), param('wear', 'износ щёток', 0, 0, 100, 1, '%'), param('fault', 'обмотка', 0, 0, 1, 1, '', ['исправна', 'обрыв'])],
      s: 0,
      temp: 25,
      amps: 0,
      watts: 0,
      ifull: 0,
      q: 0,
      qm3: 0,
    };
    m.temp = this.envP[0].value;
    this.motors.push(m);
    const comp = l.comp;
    this.devices.push({
      id: comp.id,
      comp,
      set: (k, v) => {
        const pp = m.params.find((x) => x.key === k);
        if (pp) pp.value = v;
      },
      view: (): DeviceView => ({
        id: comp.id,
        comp: comp.id,
        ref: comp.ref,
        kind: 'motor',
        title: `${comp.ref} турбина ${comp.value}`,
        params: m.params,
        readings: [
          { label: 'обороты', value: Math.round(m.s * 30000), unit: 'об/мин' },
          { label: 'ток', value: +m.amps.toFixed(2), unit: 'А' },
          { label: 'мощность', value: Math.round(m.watts), unit: 'Вт' },
          { label: 'температура', value: +m.temp.toFixed(1), unit: '°C' },
          { label: 'поток', value: Math.round(Math.max(0, m.qm3) * 1000), unit: 'л/с' },
        ],
        level: Math.min(1, m.s / 1.2),
        warning: !l.triac ? 'не найден симистор в цепи двигателя' : !l.triac.moc ? `затвор ${l.triac.comp.ref} не подключён к оптрону` : undefined,
      }),
    });
  }

  private addValve(l: Load): void {
    // Соленоид 230 В ~ с тягой 4 кгс: пусковая мощность ~200 ВА, удержания ~45 ВА.
    const v: Valve = { load: l, params: [param('va', 'пусковая мощность катушки', 200, 5, 400, 5, 'ВА'), param('hold', 'мощность удержания', 45, 2, 150, 1, 'ВА'), param('fault', 'клапан', 0, 0, 2, 1, '', VALVE_STATES)], open: false, onMs: 0, openMs: 0, amps: 0 };
    this.valves.push(v);
    const comp = l.comp;
    this.devices.push({
      id: comp.id,
      comp,
      set: (k, val) => {
        const pp = v.params.find((x) => x.key === k);
        if (pp) pp.value = val;
      },
      view: () => ({
        id: comp.id,
        comp: comp.id,
        ref: comp.ref,
        kind: 'valve',
        title: `${comp.ref} клапан продувки ${comp.value}`,
        on: v.open,
        params: v.params,
        readings: [{ label: 'ток катушки', value: +v.amps.toFixed(2), unit: 'А' }],
        warning: !l.triac ? 'не найден симистор в цепи клапана' : l.triac.relay && !this.relayClosed(l.triac.relay) && v.params[2].value === 0 ? `нет сети: разомкнуто реле ${l.triac.relay.comp.ref}` : undefined,
      }),
    });
  }

  private addTool(l: Load): void {
    const t = { load: l, params: [param('w', 'мощность инструмента', 1400, 100, 3000, 50, 'Вт')], on: false, since: 0, amps: 0 };
    this.tool = t;
    const comp = l.comp;
    this.devices.push({
      id: comp.id,
      comp,
      set: (k, val) => {
        const pp = t.params.find((x) => x.key === k);
        if (pp) pp.value = val;
      },
      act: (k) => {
        if (k !== 'switch') return;
        t.on = !t.on;
        t.since = this.us;
      },
      view: () => ({
        id: comp.id,
        comp: comp.id,
        ref: comp.ref,
        kind: 'tool',
        title: `${comp.ref} розетка: инструмент ${t.on ? 'включён' : 'выключен'}`,
        on: t.on,
        params: t.params,
        readings: [
          { label: 'напряжение на розетке', value: l.triac && l.triac.lastCond > 0.5 ? Math.round(this.volts) : 0, unit: 'В' },
          { label: 'ток', value: +t.amps.toFixed(2), unit: 'А' },
        ],
        actions: [{ key: 'switch', label: t.on ? 'Выключить инструмент' : 'Включить инструмент' }],
      }),
    });
  }

  private addTriacDevice(t: Triac): void {
    const comp = t.comp;
    const params = [param('state', 'симистор', 0, 0, 2, 1, '', TRIAC_STATES)];
    this.devices.push({
      id: comp.id,
      comp,
      set: (_k, v) => {
        params[0].value = v;
        t.state = Math.round(v);
      },
      view: () => ({
        id: comp.id,
        comp: comp.id,
        ref: comp.ref,
        kind: 'triac',
        title: `${comp.ref} симистор ${comp.value}${t.moc ? ` ← ${t.moc.comp.ref} ${t.moc.comp.value}` : ''}`,
        on: t.lastCond > 0,
        params,
        readings: [{ label: 'открыт', value: Math.round(t.lastCond * 100), unit: '% полупериода' }],
        warning: !t.moc ? 'затвор не подключён к оптрону' : t.moc.ma < t.moc.needMa ? `мало тока светодиода ${t.moc.comp.ref}: ${t.moc.ma.toFixed(1)} мА, нужно ${t.moc.needMa}` : undefined,
      }),
    });
  }

  private addRelayDevice(r: Relay): void {
    const comp = r.comp;
    const feeds = () =>
      [...this.motors.map((m) => m.load), ...this.valves.map((v) => v.load)]
        .filter((l) => l.triac?.relay === r)
        .map((l) => l.comp.ref)
        .join(', ');
    this.devices.push({
      id: comp.id,
      comp,
      set: (_k, v) => {
        r.params[0].value = v;
      },
      view: () => ({
        id: comp.id,
        comp: comp.id,
        ref: comp.ref,
        kind: 'relay',
        title: `${comp.ref} реле ${comp.value}${feeds() ? ` → ${feeds()}` : ''}`,
        on: this.relayClosed(r),
        params: r.params,
        readings: [{ label: 'катушка', value: r.cmd ? 1 : 0, unit: r.cmd ? 'под током' : 'обесточена' }],
        warning: r.coil.length < 2 ? 'катушка не подключена' : !feeds() ? 'контакт не в цепи нагрузки' : undefined,
      }),
    });
  }

  /* ---------------- бак: вода, электроды, поплавок ---------------- */

  private findTank(): void {
    const c = this.c;
    const el = this.tagged('water-electrode');
    const fl = this.tagged('float-switch')[0];
    if (!el.length && !fl) return;
    const params = [
      param('water', 'вода', 0, 0, 3, 1, '', WATER_KINDS),
      param('rate', 'набор воды со шлангом', 2, 0.2, 10, 0.2, '%/с'),
      param('float', 'поплавок', 0, 0, 1, 1, '', ['исправен', 'залип внизу']),
    ];
    const t: NonNullable<VacuumPlant['tank']> = { level: 0, sucking: false, params, e: [], wet: [false, false] };
    let common: Id | undefined;
    for (const { comp, fp } of el) {
      const net = comp.padNets[fp.pads[0]?.number ?? ''];
      const w = placeOf(comp).toLowerCase();
      this.claimed.add(comp.id);
      if (!net) continue;
      if (/дно|общ/.test(w)) common = net;
      else t.e.push({ net, at: /перелив|верх/.test(w) ? 0.9 : 0.75 });
    }
    t.e.sort((a, b) => a.at - b.at);
    // Раскачка общего электрода: от вывода контроллера через резистор и конденсатор.
    if (common) {
      const pinGroups = new Set(c.pinGroup.values());
      const seen = new Set<Id>([common]);
      let front: Id[] = [common];
      for (let hop = 0; hop < 3 && t.drive === undefined; hop++) {
        const next: Id[] = [];
        for (const comp of Object.values(this.p.components)) {
          const fp = this.p.footprints[comp.footprint];
          if (!fp || fp.pads.length !== 2 || comp.offBoard) continue;
          const nets = fp.pads.map((q) => comp.padNets[q.number]);
          for (const [a, b] of [
            [nets[0], nets[1]],
            [nets[1], nets[0]],
          ])
            if (a && b && front.includes(a) && !seen.has(b)) {
              seen.add(b);
              next.push(b);
              const g = c.netGroup.get(b);
              if (g !== undefined && pinGroups.has(g) && !c.groups[g].power) t.drive = g;
            }
        }
        front = next;
      }
    }
    // Электрод: вода замыкает его с общим — на нём раскачка через сопротивление воды (нагрузка 200 кОм на плате).
    for (const e of t.e)
      c.setNetSource(e.net, () => {
        const wet = t.level >= e.at && t.level >= 0.02 && t.drive !== undefined;
        if (!wet) return 0;
        const k = 200_000 / (200_000 + 1000 + WATER_OHMS[Math.round(params[0].value)]);
        return (c.levelOf(t.drive!) ? 1.65 : -1.65) * k;
      });
    if (fl) {
      this.claimed.add(fl.comp.id);
      const sig = fl.fp.pads.map((q) => fl.comp.padNets[q.number]).map((n) => (n ? c.netGroup.get(n) : undefined)).find((g) => g !== undefined && !c.groups[g].power);
      t.floatGroup = sig;
    }
    this.tank = t;
    const comp = el[0]?.comp ?? fl!.comp;
    const id = `${comp.id}:tank`;
    this.devices.push({
      id,
      comp,
      set: (k, v) => {
        const pp = params.find((x) => x.key === k);
        if (pp) pp.value = v;
      },
      act: (k) => {
        if (k === 'suck') t.sucking = !t.sucking;
        if (k === 'drain') (t.level = 0), (t.sucking = false);
        if (k === 'full') t.level = Math.max(t.level, 0.8);
      },
      view: () => ({
        id,
        comp: comp.id,
        ref: 'Бак',
        kind: 'tank',
        title: `Бак 40 л: вода ${Math.round(t.level * 100)} %${t.sucking ? ', шланг в воде' : ''}`,
        params,
        readings: [
          { label: 'уровень', value: Math.round(t.level * 100), unit: '%' },
          { label: 'электрод уровня', value: t.wet[0] ? 1 : 0, unit: t.wet[0] ? 'в воде' : 'сухой' },
          { label: 'электрод перелива', value: t.wet[1] ? 1 : 0, unit: t.wet[1] ? 'в воде' : 'сухой' },
        ],
        actions: [
          { key: 'suck', label: t.sucking ? 'Вынуть шланг из воды' : 'Сосать воду' },
          { key: 'full', label: 'Бак почти полон (80 %)' },
          { key: 'drain', label: 'Слить бак' },
        ],
        warning: t.drive === undefined && t.e.length ? 'не найдена раскачка общего электрода (вывод → резистор → конденсатор)' : undefined,
      }),
    });
  }

  /** Вода в бак — пока шланг в воде и есть поток; поплавок всплывает на 80 %. */
  private water(dt: number): void {
    const t = this.tank;
    if (!t) return;
    const q = this.air.qh;
    if (t.sucking && q > 0.005) t.level = Math.min(1, t.level + ((t.params[1].value / 100) * (q / 0.04) * dt));
    t.wet = [t.level >= (t.e[0]?.at ?? 2), t.level >= (t.e[1]?.at ?? 2)];
    if (t.floatGroup !== undefined) this.c.drive(t.floatGroup, 'vacuum-float', t.level >= 0.8 && !t.params[2].value ? 0 : null);
  }

  private addCt(ct: { comp: Component; loads: Load[]; ratio: number; s1?: Id; s2?: Id }): void {
    const c = this.c;
    const amps = (cycle: number) => {
      const t = (cycle / this.freq) * 1e6;
      return ct.loads.reduce((a, l) => a + this.loadAmps(l, t), 0);
    };
    c.setNetCurrent(ct.s1, (cy) => amps(cy) / ct.ratio, ct.comp.id);
    c.setNetCurrent(ct.s2, (cy) => -amps(cy) / ct.ratio, ct.comp.id);
    const comp = ct.comp;
    this.devices.push({
      id: comp.id,
      comp,
      view: () => {
        const rms = ct.loads.reduce((a, l) => a + (l.kind === 'motor' ? (this.motors.find((m) => m.load === l)?.amps ?? 0) : l.kind === 'tool' ? (this.tool?.amps ?? 0) : (this.valves.find((v) => v.load === l)?.amps ?? 0)), 0);
        return { id: comp.id, comp: comp.id, ref: comp.ref, kind: 'sensor', title: `${comp.ref} трансформатор тока ${comp.value}: ${ct.loads.map((l) => l.comp.ref).join(', ') || '—'}`, readings: [{ label: 'ток', value: +rms.toFixed(2), unit: 'А' }], warning: !ct.loads.length ? 'через окно не проходит провод нагрузки' : undefined };
      },
    });
  }

  private addMainsDevice(): void {
    const mains = this.tagged('mains')[0]?.comp;
    const comp = mains ?? this.motors[0].load.comp;
    const id = `${comp.id}:mains`;
    this.devices.push({
      id,
      comp,
      set: (k, v) => {
        const pp = this.mainsP.find((x) => x.key === k);
        if (pp) pp.value = v;
      },
      act: (k) => {
        if (k === 'dip') this.dipUntil = this.c.mcu.cycles + this.toCycles(300_000);
      },
      view: () => ({
        id,
        comp: comp.id,
        ref: mains?.ref ?? 'Сеть',
        kind: 'mains',
        title: `${mains?.ref ?? ''} сеть ${Math.round(this.volts)} В, ${this.hz} Гц`.trim(),
        params: this.mainsP,
        readings: [{ label: 'импульс детектора нуля', value: Math.round(this.zcWidth), unit: 'мкс' }],
        actions: [{ key: 'dip', label: 'Провал сети 0,3 с' }],
        warning: this.zcGroup === undefined ? 'детектор нуля не найден (трансформатор → мост → транзистор)' : undefined,
      }),
    });
  }

  private addAirDevice(): void {
    const comp = this.motors[0].load.comp;
    const id = `${comp.id}:air`;
    this.devices.push({
      id,
      comp,
      set: (k, v) => {
        const pp = [...this.airP, ...this.envP].find((x) => x.key === k);
        if (pp) pp.value = v;
      },
      act: (k) => {
        if (k === 'dust') this.cake = [Math.min(2, this.cake[0] + 0.4), Math.min(2, this.cake[1] + 0.4)];
        if (k === 'clean') this.cake = [0, 0];
        if (k === 'nozzle') this.blockHeld = !this.blockHeld;
      },
      view: () => {
        const a = this.air;
        const d = HOSES[Math.round(this.airP[1].value)] / 1000;
        return {
          id,
          comp: comp.id,
          ref: 'Пневматика',
          kind: 'plant',
          title: 'Шланг, бак, фильтр',
          params: [...this.airP, ...this.envP],
          readings: [
            { label: 'расход', value: Math.round(a.qh * 3600), unit: 'м³/ч' },
            { label: 'скорость в шланге', value: +(a.qh / ((Math.PI * d * d) / 4)).toFixed(1), unit: 'м/с' },
            { label: 'разрежение у турбин', value: +(a.p / 1000).toFixed(2), unit: 'кПа' },
            { label: 'перепад на фильтре', value: Math.round(a.filterDp), unit: 'Па' },
            { label: 'пыль на фильтре', value: Math.round(((this.cake[0] + this.cake[1]) / 2) * 100), unit: '%' },
          ],
          actions: [
            { key: 'dust', label: 'Насыпать пыли на фильтр' },
            { key: 'clean', label: 'Чистый фильтр' },
            { key: 'nozzle', label: this.blockHeld ? 'Отпустить насадку' : 'Прижать насадку' },
          ],
        };
      },
    });
  }

  /** Всё состояние для мнемосхемы во весь экран. */
  view(): VacuumView {
    const a = this.air;
    const d = HOSES[Math.round(this.airP[1].value)];
    const A = (Math.PI * (d / 1000) ** 2) / 4;
    return {
      mains: { volts: this.volts, hz: this.hz, dip: this.volts <= 0 },
      motors: this.motors.map((m) => {
        const tr = m.load.triac;
        return {
          ref: m.load.comp.ref,
          rpm: Math.round(m.s * 30000),
          speed: m.s,
          amps: m.amps,
          watts: m.watts,
          temp: m.temp,
          firing: tr && tr.lastCond > 0 ? Math.round((1 - tr.lastCond) * 180) : 180,
          conducting: !!tr && tr.lastCond > 0,
          fault: m.params[2].value === 1 ? 'обрыв' : m.params[1].value > 50 ? 'щётки' : null,
          triac: tr ? (tr.state ? TRIAC_STATES[tr.state] : null) : 'нет симистора',
        };
      }),
      valves: this.valves.map((v) => ({ ref: v.load.comp.ref, open: v.open, amps: v.amps, fault: v.params[2].value ? VALVE_STATES[v.params[2].value] : null })),
      relays: this.relays.map((r) => ({ ref: r.comp.ref, closed: this.relayClosed(r), fault: r.params[0].value ? RELAY_STATES[r.params[0].value] : null })),
      tank: this.tank ? { level: this.tank.level, liters: this.tank.level * 40, e: [this.tank.wet[0], this.tank.wet[1]], float: this.tank.level >= 0.8 && !this.tank.params[2].value, sucking: this.tank.sucking } : null,
      tool: this.tool ? { ref: this.tool.load.comp.ref, on: this.tool.on, powered: !!this.tool.load.triac && this.tool.load.triac.lastCond > 0.5, amps: this.tool.amps, watts: this.tool.amps * this.volts } : null,
      air: { flow: a.qh * 3600, speed: a.qh / A, vacuum: a.p / 1000, tank: a.tank / 1000, filterDp: a.filterDp, flowDp: a.flowDp, cake: [this.cake[0], this.cake[1]], deep: this.airP[3].value / 100, block: this.blockHeld ? 0.95 : this.airP[2].value / 100, hoseMm: d, hoseM: this.airP[0].value },
      zc: { width: this.zcWidth, ok: this.zcGroup !== undefined },
    };
  }
}
