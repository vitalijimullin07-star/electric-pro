import type { Component, FootprintDef, Id, Project } from '../model/types';
import { isResistor, parseOhms, type Circuit } from './circuit';
import type { Device, DeviceView, SimParam } from './devices';
import type { McuPin } from './types';

/*
 * Установка «пылесос» для симуляции: сеть 230 В, симисторы с оптронами MOC (случайной
 * фазы — для фазового управления, с детектором нуля — для клапанов и розетки), реле в цепи
 * нагрузок (катушка — через ключ на плате), коллекторные двигатели с вентиляторами, шланг,
 * бак с водой (электроды и поплавок), фильтр из двух секций с продувкой, соленоиды клапанов
 * (ток втягивания и удержания), инструмент в розетке (через симистор или реле), нагрев
 * двигателей, детектор нуля. Клапаны на электромагнитах (magnet-valve): магнит 12 В держит
 * тарелку, без тока её вталкивает разрежение; тогда фильтр в общей камере, а воздух — по
 * динамике двух объёмов (камера за фильтром и бак, неявный метод с шагом до 1 мс), удар —
 * обратным потоком через фильтр, фильтр клапанов на входе, мешок в баке, вид пыли.
 * Плата на модулях: модули реле (relay-module, включаются «0» на IN), регуляторы мощности МР248
 * (triac-dimmer: мощность — по скважности ШИМ на входе «управление»), твердотельные реле
 * (ssr-module: включаются «0» на CHn и только в нуле сети) с импульсными клапанами 230 В —
 * они тоже бьют по фильтру через камеру (та же динамика двух объёмов), тарельчатые клапаны
 * (plate-valve: удерживающий магнит 230 В через SSR держит тарелку Ø90 против разрежения,
 * без тока её вталкивает разрежение, закрывают пружины), трансформаторы тока
 * с выходом 1 В (sct013-v: нагрузка внутри, сигнал — относительно середины на S2).
 * Детали находятся по схеме: метки корпусов (universal-motor, triac, solenoid-valve,
 * magnet-valve, tool-outlet, current-transformer, transformer, mains, relay, water-electrode,
 * float-switch) и цепи между ними (симистор → предохранитель → контакт реле); датчики
 * привязаны к месту полем «Где стоит» (M1, M2, фильтр, расходомер, вход турбин, бак).
 * Электричество считается по полупериодам сети; мгновенный ток — синусоида с отсечкой по фазе.
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
/** Клапан на магните: проход Ø40 (коэффициент расхода 0,62) — Па/(м³/с)². */
const MAG_KV = RHO / (2 * (0.62 * Math.PI * 0.02 * 0.02) ** 2);
/** Фильтр клапанов (гофрированный Ø70×150): 1,5 кПа при 200 л/с. */
const INTAKE_K = 1500 / 0.2 ** 2;
/** Мешок в баке: чистый — 150 Па при 40 л/с. */
const BAG_K = 150 / 0.04 ** 2;
/** Тарелка: пружина держит закрытой до 0,8 кПа (с магнитом — против любого); открывается за 6 мс, закрывается за 15 мс. */
const PLATE_OPEN_PA = 800;
const PLATE_OPEN_MS = 6;
const PLATE_CLOSE_MS = 15;
const P_ATM = 101_325;
const MAG_STATES = ['исправен', 'обрыв магнита', 'тарелка заклинила', 'пробит ключ (магнит всегда под током)'];
/**
 * Тарельчатый клапан (свой, по принципу Kärcher Tact): площадь под уплотнением 52,8 см², ход 9 мм —
 * щель как труба Ø54; три пружины 0,39 Н/мм: закрыт — 4,7 Н, открыт — 15,4 Н. Магнит Ø40 на якоре
 * при зазоре 0,5 мм — по паспорту (150 Н), на открытой тарелке (зазор 9 мм) — несколько процентов.
 * Без тока поле спадает за ~6 мс; тарелка открывается за 4,5 мс, пружины возвращают за ~27 мс.
 */
const PLATE_AREA = 52.8e-4;
const PLATE_SPRING_CLOSED = 4.7;
const PLATE_SPRING_OPEN = 15.4;
const PLATE_FIELD_MS = 6;
const PLATE_GO_MS = 4.5;
const PLATE_BACK_MS = 27;
/** Проход открытой тарелки относительно Ø40: (54/40)². */
const PLATE_SIZE = (54 / 40) ** 2;
const PLATE_STATES = ['исправен', 'обрыв магнита', 'тарелка заклинила', 'тарелка не садится (грязь в седле)', 'SSR пробит (магнит всегда под током)'];
/** Импульсный клапан 230 В: якорь втягивается за 8 мс, мембрана открывается за 6 мс, закрывается за 15 мс. */
const PULSE_PULL_MS = 8;
const SSR_STATES = ['исправен', 'пробит (всегда включён)', 'обрыв (не включается)'];
const DIMMER_STATES = ['исправен', 'пробит симистор (всегда полная)', 'не открывается'];
/** Вид пыли: доля, которая «прилипает» (снимается только мощным ударом или мойкой). */
const DUST_KINDS = ['сухая мелкая (бетон)', 'средняя', 'липкая (гипс)', 'влажная'];
const DUST_STICK = [0.03, 0.12, 0.35, 0.6];

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
  kind: 'motor' | 'valve' | 'tool' | 'magnet';
  nets: Id[];
  triac?: Triac;
  /** Нагрузка без симистора — прямо через контакт реле (розетка инструмента). */
  relay?: Relay;
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
  /** Канал твердотельного реле: группы входа (питание модуля и вход канала, включается «0»). */
  ssr?: number[];
  /** Регулятор мощности МР248: вход «управление» (группа и вывод контроллера), питание модуля. */
  dimmer?: { ctrl?: number; pin?: McuPin; vcc?: number; power: number };
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

/** Клапан на электромагните: катушка между питанием и ключом, тарелка с пружиной. */
interface MagValve {
  load: Load;
  params: SimParam[];
  coil: number[];
  /** Магнит под током (по схеме, на момент последнего изменения цепей). */
  held: boolean;
  /** Открытие тарелки 0…1, открыта ли (для вида), ток магнита, А. */
  x: number;
  open: boolean;
  amps: number;
  /** Удар: когда открылась (мкс) и наибольший обратный перепад на фильтре, Па. */
  openedAt: number;
  peakRev: number;
  /** Импульсный клапан 230 В через SSR (не магнит): сколько катушка под током, мс. */
  pulse?: { onMs: number };
  /** Тарельчатый клапан с удерживающим магнитом через SSR: доля поля магнита (0…1). */
  plate?: { field: number };
}

/** Трансформатор тока: с нагрузкой на плате (ток во вторичную цепь) или с выходом напряжения (vPerA). */
interface Ct {
  comp: Component;
  loads: Load[];
  ratio: number;
  s1?: Id;
  s2?: Id;
  /** SCT-013 с выходом 1 В: вольт на ампер мгновенного тока (сигнал S1 относительно S2). */
  vPerA?: number;
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
  private cts: Ct[] = [];
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
  /** Клапаны на магнитах; есть — воздух считается по динамике камеры и бака. */
  private mags: MagValve[] = [];
  private dyn = { pc: 0, pt: 0, t: 0, loose: 0.05, stuck: 0, bagCake: 0, bagFill: 0 };
  private tankL = 40;
  /** Мусор в баке, кг (растёт с пылью и потоком; «Слить бак» — ноль). */
  private debrisKg = 0;
  /** Пустой бак на тензодатчике под колесом, кг. */
  private tankTareKg = 9;
  /** Предохранители: цепь по одну сторону → цепь по другую. */
  private fuseNext = new Map<Id, Id>();
  private chamberL = 2.2;

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
      ['plate-valve', 'valve'],
      ['magnet-valve', 'magnet'],
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
      // SCT-013-020/030 со встроенной нагрузкой: 1 В действующего на 20/30 А.
      const rated = (fp.tags ?? []).includes('sct013-v') ? +(/SCT-?013-0*(\d+)/i.exec(comp.value)?.[1] ?? 30) : 0;
      this.cts.push({ comp, loads: on, ratio: m ? +m[1] : 1000, s1: padNet(comp, fp, 'S1'), s2: padNet(comp, fp, 'S2'), vPerA: rated ? 1 / rated : undefined });
      this.claimed.add(comp.id);
    }
    const through = (n: Id | undefined): Id[] => (n ? [n, ...(ctPrim.has(n) ? [ctPrim.get(n)!] : [])] : []);
    // Реле: катушка между питанием и ключом; контакты COM/NO — в цепи нагрузки.
    for (const { comp, fp } of this.tagged('relay')) {
      // Модуль реле: катушка с оптроном между DC+ и IN (перемычка L — включается замыканием IN на землю).
      const coil = (fp.tags ?? []).includes('relay-module')
        ? [padNet(comp, fp, 'DC+'), padNet(comp, fp, 'IN')]
        : fp.pads.filter((q) => /^COIL/i.test(q.name ?? '') || ((q.number === '1' || q.number === '2') && !q.name)).map((q) => comp.padNets[q.number]);
      const groups = coil.map((n) => (n ? c.netGroup.get(n) : undefined)).filter((g): g is number => g !== undefined);
      const r: Relay = { comp, coil: groups, cmd: false, closed: false, params: [param('fault', 'реле', 0, 0, 2, 1, '', RELAY_STATES)] };
      (r as Relay & { no?: Id; com?: Id }).no = padNet(comp, fp, 'NO');
      (r as Relay & { no?: Id; com?: Id }).com = padNet(comp, fp, 'COM');
      this.relays.push(r);
      this.claimed.add(comp.id);
    }
    // Предохранители: двухвыводные детали с номиналом «T2A», «0,5 А» или корпусом Fuse.
    const fuseNext = this.fuseNext;
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
    const attach = (t: Triac, viaRelay = true) => {
      const ends = [...through(t.mt1), ...through(t.mt2)];
      for (const l of loads)
        if (!l.triac && l.nets.some((n) => ends.includes(n))) {
          l.triac = t;
          // Вывод симистора со стороны сети (не к нагрузке) — через предохранитель к реле.
          const onLoad = (n: Id | undefined) => !!n && through(n).some((x) => l.nets.includes(x));
          if (viaRelay) t.relay = relayOf(onLoad(t.mt1) ? t.mt2 : t.mt1);
        }
      this.triacs.push(t);
      this.claimed.add(t.comp.id);
    };
    for (const { comp, fp } of this.tagged('triac')) {
      const pn = (...names: string[]) => names.map((n) => padNet(comp, fp, n)).find(Boolean);
      const t: Triac = { comp, mt1: pn('MT1', 'T1', 'A1'), mt2: pn('MT2', 'T2', 'A2'), g: pn('G'), state: 0, firedAt: null, lastCond: 0, lastU2: 0 };
      t.moc = mocs.find((m) => t.g && m.out.includes(t.g))?.moc;
      attach(t);
    }
    // Регуляторы мощности МР248: сеть L → симистор → OUT; мощность — по входу «управление».
    const groupOf = (n: Id | undefined) => (n ? c.netGroup.get(n) : undefined);
    for (const { comp, fp } of this.tagged('triac-dimmer')) {
      const ctrl = groupOf(padNet(comp, fp, 'CTRL'));
      const pin = ctrl !== undefined ? c.groups[ctrl].pins[0] : undefined;
      attach({ comp, mt1: padNet(comp, fp, 'L'), mt2: padNet(comp, fp, 'OUT'), state: 0, firedAt: null, lastCond: 0, lastU2: 0, dimmer: { ctrl, pin, vcc: groupOf(padNet(comp, fp, 'VCC')), power: 0 } });
    }
    // Твердотельные реле (каналы CHn → выходы SWnA/SWnB): сеть на них — напрямую, без реле.
    for (const { comp, fp } of this.tagged('ssr-module'))
      for (let ch = 1; ch <= 8; ch++) {
        const inp = padNet(comp, fp, `CH${ch}`);
        if (!inp) break;
        const coil = [groupOf(padNet(comp, fp, 'DC+')), groupOf(inp)].filter((g): g is number => g !== undefined);
        attach({ comp, mt1: padNet(comp, fp, `SW${ch}A`), mt2: padNet(comp, fp, `SW${ch}B`), state: 0, firedAt: null, lastCond: 0, lastU2: 0, ssr: coil }, false);
      }
    // Варисторы на катушках и в сети — часть установки (в логической схеме им делать нечего).
    for (const { comp } of this.tagged('varistor')) this.claimed.add(comp.id);
    // Без симистора — через контакт реле (розетка инструмента за реле 30 А).
    for (const l of loads) if (!l.triac && l.kind === 'tool') l.relay = l.nets.flatMap((n) => through(n)).map((n) => relayOf(n)).find(Boolean);
    for (const l of loads) {
      if (l.kind === 'motor') this.addMotor(l);
      else if (l.kind === 'valve' && l.triac?.ssr) this.addPulse(l, !!this.p.footprints[l.comp.footprint]?.tags?.includes('plate-valve'));
      else if (l.kind === 'valve') this.addValve(l);
      else if (l.kind === 'magnet') this.addMagnet(l);
      else this.addTool(l);
    }
    this.findShunts();
    if (this.mags.length)
      this.airP.push(
        param('kind', 'вид пыли', 0, 0, DUST_KINDS.length - 1, 1, '', DUST_KINDS),
        param('intake', 'фильтр клапанов забит', 0, 0, 100, 1, '%'),
        param('bag', 'мешок', 0, 0, 1, 1, '', ['нет', 'стоит']),
      );
    // Объёмы: у электрода на дне бака — поле «Объём», у датчика перепада на фильтре — «Камера».
    for (const comp of Object.values(p.components)) {
      const vol = /(\d+(?:[.,]\d+)?)/.exec(comp.fields?.['Объём'] ?? '');
      if (vol) this.tankL = parseFloat(vol[1].replace(',', '.'));
      const ch = /(\d+(?:[.,]\d+)?)/.exec(comp.fields?.['Камера'] ?? '');
      if (ch) this.chamberL = parseFloat(ch[1].replace(',', '.'));
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
      // Магниты: воздух досчитываем со старым состоянием, потом берём новое.
      if (this.mags.length) {
        this.advanceAir((cycle / this.freq) * 1e6);
        for (const v of this.mags) v.held = this.coilEnergized(v.coil);
      }
      // Катушка: ключ меняет «висит» на «0» без смены уровня — проверяем при любом изменении.
      for (const r of this.relays) this.relayUpdate(r);
      // Вход SSR — «0» включает: у нуля сети откроется сразу, иначе — в следующем полупериоде.
      for (const t of this.triacs) if (t.ssr?.includes(g)) this.gateOn(t, (cycle / this.freq) * 1e6);
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
    return this.coilEnergized(r.coil);
  }

  private coilEnergized(coil: number[]): boolean {
    const c = this.c;
    if (coil.length < 2) return false;
    const vcc = coil.some((g) => c.groups[g].power === 'vcc');
    const low = coil.some((g) => !c.groups[g].power && !c.isFloating(g) && c.levelOf(g) === 0);
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
    if (t.ssr) return t.state !== 2 && this.coilEnergized(t.ssr);
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
    if ((!t.moc && !t.ssr) || t.firedAt !== null || !this.ledOn(t)) return;
    const v = Math.abs(this.vAt(at));
    if (t.ssr || t.moc!.zeroCross) {
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

  /**
   * Регулятор МР248: доля мощности — напряжение на входе «управление» к питанию модуля (ШИМ
   * сглаживается внутри), угол открытия — такой, чтобы среднеквадратичное напряжение на
   * нагрузке дало эту долю. null — закрыт (вход у нуля или модуль без питания).
   */
  private dimmerAngle(t: Triac): number | null {
    const d = t.dimmer!;
    const c = this.c;
    const vcc = d.vcc !== undefined && c.groups[d.vcc].power === 'vcc' ? c.powerOf(d.vcc) : 0;
    let duty = 0;
    if (d.pin) duty = c.mcu.pwmDuty?.(d.pin) ?? (c.mcu.pinMode(d.pin) === 'high' ? 1 : 0);
    const frac = vcc > 0 ? Math.min(1, (duty * c.mcu.vdd) / vcc) : 0;
    d.power = frac;
    if (frac < 0.02) return null;
    // u²(a) = 1 − a/π + sin 2a / 2π убывает от 1 до 0: деление пополам.
    let lo = 0;
    let hi = Math.PI;
    for (let i = 0; i < 30; i++) {
      const a = (lo + hi) / 2;
      if (1 - a / Math.PI + Math.sin(2 * a) / (2 * Math.PI) > frac) lo = a;
      else hi = a;
    }
    return (lo + hi) / 2;
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
    // Новый полупериод: пробитые открыты сразу, горящие оптроны открывают у нуля, регуляторы — по углу.
    for (const t of this.triacs) {
      if (t.state === 1 && this.powered(t)) t.firedAt = now;
      else if (t.dimmer) {
        const a = this.dimmerAngle(t);
        if (a !== null && t.state === 0 && this.powered(t)) t.firedAt = now + (a / Math.PI) * hu;
      } else if (this.ledOn(t)) {
        const wait = t.ssr || t.moc!.zeroCross ? 150 : (Math.asin(Math.min(1, 10 / Math.max(10, this.volts * Math.SQRT2))) / Math.PI) * hu;
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
    if (l.kind === 'magnet') return 0;
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
    if (!tr && l.relay) return this.volts > 0 && this.relayClosed(l.relay) ? (this.vAt(t) / (this.volts * Math.SQRT2)) * Math.SQRT2 * this.loadFullAmps(l) : 0;
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
      // Нагрузка вентилятора и трение щёток и подшипников (без него выбег тянулся бы минутами).
      const tl = m.s * m.s * (0.35 + 0.65 * m.q) + 0.02 * m.s + (m.s > 0 ? 0.04 : 0);
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
      const l = this.tool.load;
      const tr = l.triac;
      const fed = tr ? tr.lastCond > 0.5 : !!l.relay && this.relayClosed(l.relay) && V > 0;
      this.tool.amps = this.tool.on && fed ? this.loadFullAmps(l) : 0;
    }
    if (this.mags.length) this.advanceAir(this.us);
    else this.pneumatics(dt);
    this.water(dt);
  }

  private palm = false;

  private hoseK(): number {
    const d = HOSES[Math.round(this.airP[1].value)] / 1000;
    const L = this.airP[0].value;
    const A = (Math.PI * d * d) / 4;
    const block = this.palm ? 0.999 : Math.min(0.995, (this.blockHeld ? 95 : this.airP[2].value) / 100);
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
    // Удар клапана — воздух идёт через половину фильтра обратно: перепад на датчике проседает.
    const back = Math.min(0.9, openValves * 0.75);
    this.air = { p: pc, tank: kh * qh * qh, qh, filterDp: kf * qh * qh * (1 - back), flowDp: VENTURI_K * qh * qh, qv: openValves * VALVE_CV * Math.sqrt(pc) };
    this.motors.forEach((m, i) => {
      const q = fanQ(speeds[i], pc);
      m.qm3 = q;
      m.q = speeds[i] > 0.05 ? Math.max(0, Math.min(1.2, q / (FAN_QMAX * speeds[i]))) : 0;
    });
    // Пыль копится, пока идёт поток (с инструментом — быстрее).
    const dust = this.airP[4].value * (this.tool?.amps ? 1 : 0.25);
    const grow = dust * 0.0015 * (qh / 0.043) * dt;
    this.cake = [Math.min(2, this.cake[0] + grow), Math.min(2, this.cake[1] + grow)];
    this.debrisKg += dust * 0.0004 * (qh / 0.043) * dt;
  }

  /* ---------------- клапаны на магнитах: камера за фильтром и бак ---------------- */

  private dustP(key: string): number {
    return this.airP.find((x) => x.key === key)?.value ?? 0;
  }

  private bagK(): number {
    if (!this.dustP('bag')) return 0;
    const d = this.dyn;
    return BAG_K * (1 + 6 * d.bagCake + 10 * d.bagFill * d.bagFill);
  }

  private filterKDyn(): number {
    const d = this.dyn;
    const k = FILTER_K0 * (1 + 3 * (d.loose + d.stuck) + 8 * (this.airP[3].value / 100));
    const state = this.airP[5]?.value ?? 0;
    return state === 1 ? k * 0.06 : state === 2 ? k * 0.005 : k;
  }

  /** Удар (от открытия первой тарелки до закрытия последней): наибольший обратный перепад. */
  private pulse = { active: false, peak: 0, t0: 0 };

  /** Тарелки: магнит держит; без него — вталкивает разрежение (пружина держит до 0,8 кПа). */
  private plates(h: number, us: number): void {
    const pc = this.dyn.pc;
    for (const v of this.mags) {
      if (v.plate) {
        this.holdPlate(v, h, us);
        continue;
      }
      if (v.pulse) {
        this.pulsePlate(v, h, us);
        continue;
      }
      const f = v.params[0].value;
      const held = (v.held && f !== 1) || f === 3;
      let target: number;
      if (f === 2) target = 0;
      else if (v.x <= 0) target = !held && pc > PLATE_OPEN_PA ? 1 : 0;
      // Открыта: пружина и магнит (на зазоре он слабый) закрывают против перепада до 5 кПа, одна пружина — до 0,8 кПа.
      else target = (held && pc < 5000) || pc < PLATE_OPEN_PA ? 0 : 1;
      if (target > v.x) {
        v.x = Math.min(1, v.x + (h * 1000) / PLATE_OPEN_MS);
        if (!v.open) (v.open = true), (v.openedAt = us);
      } else if (target < v.x) {
        v.x = Math.max(0, v.x - (h * 1000) / PLATE_CLOSE_MS);
        if (v.x <= 0) v.open = false;
      }
      v.amps = held && this.volts > 0 ? 11.5 / Math.max(1, v.params[1].value) : 0;
    }
    const any = this.mags.some((v) => v.x > 0);
    const p = this.pulse;
    if (any && !p.active) Object.assign(p, { active: true, peak: 0, t0: us });
    if (p.active) p.peak = Math.max(p.peak, this.dyn.pt - this.dyn.pc);
    if (!any && p.active) {
      // Удар кончился: складки фильтра рывком прогнулись обратно — сбито по силе обратного перепада
      // (рабочий — десятки паскалей, обратный — сотни, фронт — первые ~20 мс). Прилипшее снимает
      // только сильный удар (при закрытом шланге бак держит полное разрежение).
      p.active = false;
      const d = this.dyn;
      const k = Math.min(1, p.peak / 800) * Math.min(1, (us - p.t0) / 20_000);
      d.loose *= 1 - 0.5 * k;
      if (p.peak > 1500) d.stuck *= 1 - 0.2 * Math.min(1, (p.peak - 1500) / 1500);
      d.bagCake *= 1 - 0.3 * k;
    }
  }

  /** Катушка импульсного клапана под током в момент us: SSR проводит весь полупериод от включения. */
  private pulseOn(v: MagValve, us: number): boolean {
    const t = v.load.triac;
    if (!t || this.volts <= 0 || (!v.plate && v.params[2].value === 2)) return false;
    return us <= this.halfStart ? t.lastCond > 0.5 : t.firedAt !== null && us >= t.firedAt;
  }

  /** Импульсный клапан: якорь втягивается за PULSE_PULL_MS, потом мембрана открывается; без тока — закрывается. */
  private pulsePlate(v: MagValve, h: number, us: number): void {
    const on = this.pulseOn(v, us);
    const p = v.pulse!;
    p.onMs = on ? p.onMs + h * 1000 : 0;
    const target = on && v.params[2].value === 0 && p.onMs >= PULSE_PULL_MS ? 1 : 0;
    if (target > v.x) {
      v.x = Math.min(1, v.x + (h * 1000) / PLATE_OPEN_MS);
      if (!v.open) (v.open = true), (v.openedAt = us);
    } else if (target < v.x) {
      v.x = Math.max(0, v.x - (h * 1000) / PLATE_CLOSE_MS);
      if (v.x <= 0) v.open = false;
    }
    // Ток катушки: пусковой, пока якорь не втянулся (и всё время, если заклинил), потом — удержания.
    const va = v.params[2].value === 1 || p.onMs < PULL_MS ? v.params[0].value : v.params[1].value;
    v.amps = on ? va / Math.max(1, this.volts) : 0;
  }

  /**
   * Тарельчатый клапан: закрытую держат магнит и пружины против разрежения на площади уплотнения;
   * открытую закрывают пружины (магнит на зазоре 9 мм почти не тянет), когда разрежение спало.
   */
  private holdPlate(v: MagValve, h: number, us: number): void {
    const f = v.params[1].value;
    const on = (this.pulseOn(v, us) && f !== 1) || (f === 4 && this.volts > 0);
    const pl = v.plate!;
    const k = (h * 1000) / PLATE_FIELD_MS;
    pl.field = on ? Math.min(1, pl.field + k) : Math.max(0, pl.field - k);
    // Магнит тянет якорь тем слабее, чем больше зазор (0,5 мм закрытой, +9 мм хода): ~ (0,5/зазор)².
    const force = v.params[0].value * pl.field * (0.5 / (0.5 + 9 * v.x)) ** 2;
    const spring = PLATE_SPRING_CLOSED + (PLATE_SPRING_OPEN - PLATE_SPRING_CLOSED) * v.x;
    const push = Math.max(0, this.dyn.pc) * PLATE_AREA;
    let target: number;
    if (f === 2) target = 0;
    // Не садится — грязь в седле: закроется, только когда разрежение почти пропадёт (турбины сброшены).
    else if (f === 3 && v.x > 0) target = push > 150 * PLATE_AREA ? 1 : 0;
    else target = push > spring + force ? 1 : 0;
    if (target > v.x) {
      v.x = Math.min(1, v.x + (h * 1000) / PLATE_GO_MS);
      if (!v.open) (v.open = true), (v.openedAt = us);
    } else if (target < v.x) {
      v.x = Math.max(0, v.x - (h * 1000) / PLATE_BACK_MS);
      if (v.x <= 0) v.open = false;
    }
    v.amps = on && this.volts > 0 ? v.params[2].value / Math.max(1, this.volts) : 0;
  }

  /** Клапан движется или вот-вот откроется: воздух считается мелким шагом. */
  private valveBusy(v: MagValve, pc: number, us: number): boolean {
    if (v.x > 0) return true;
    if (v.plate) return v.plate.field < 1 && pc * PLATE_AREA > v.params[0].value * v.plate.field;
    return v.pulse ? this.pulseOn(v, us) : !v.held && pc > PLATE_OPEN_PA;
  }

  /**
   * Воздух до момента tUs: разрежение в камере за фильтром (турбины тянут, фильтр и клапаны
   * впускают) и в баке (фильтр забирает, шланг впускает). Неявный метод по каждому объёму,
   * шаг 1 мс, пока тарелки движутся или открыты — 0,25 мс.
   */
  private advanceAir(tUs: number): void {
    const d = this.dyn;
    if (!d.t) d.t = tUs;
    let left = (tUs - d.t) / 1e6;
    if (left <= 0) return;
    d.t = tUs;
    const speeds = this.motors.map((m) => m.s);
    const kh = this.hoseK() + this.bagK();
    const kf = this.filterKDyn();
    const clog = this.dustP('intake') / 100;
    const ki = INTAKE_K * (1 + 24 * clog * clog);
    const Vc = this.chamberL / 1000;
    const Vt = this.tankL / 1000;
    const fanQ = (sp: number, pc: number) => {
      const back = -FAN_BACK * Math.sqrt(Math.max(0, pc));
      if (sp < 0.05) return back;
      return Math.max(FAN_QMAX * sp * (1 - pc / (FAN_PREF * sp * sp)), back);
    };
    const fans = (pc: number) => speeds.reduce((a, sp) => a + fanQ(sp, pc), 0);
    const qf = (pc: number, pt: number) => {
      const dp = pc - pt;
      return Math.sign(dp) * Math.sqrt(Math.abs(dp) / kf);
    };
    const qh = (pt: number) => Math.sign(pt) * Math.sqrt(Math.abs(pt) / kh);
    const top = Math.max(1, ...speeds.map((sp) => FAN_PREF * sp * sp)) + 30_000;
    const solve = (fn: (x: number) => number, lo: number, hi: number) => {
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        if (fn(mid) > 0) hi = mid;
        else lo = mid;
      }
      return (lo + hi) / 2;
    };
    let us = tUs - left * 1e6;
    let q = { h: 0, f: 0, v: 0 };
    while (left > 1e-9) {
      const moving = this.mags.some((v) => this.valveBusy(v, d.pc, us));
      const h = Math.min(left, moving ? 0.00025 : 0.001);
      left -= h;
      us += h * 1e6;
      this.plates(h, us);
      const area = this.mags.reduce((a, v) => a + v.x * (v.plate ? PLATE_SIZE : 1), 0);
      const kv = area > 0 ? MAG_KV / (area * area) + ki : 0;
      const qv = (pc: number) => (kv > 0 && pc > 0 ? Math.sqrt(pc / kv) : 0);
      const pc0 = d.pc;
      const pt0 = d.pt;
      let pc = pc0;
      let pt = pt0;
      for (let it = 0; it < 3; it++) {
        const ptc = pt;
        pc = solve((x) => ((x - pc0) * Vc) / (P_ATM * h) - (fans(x) - qf(x, ptc) - qv(x)), -5000, top);
        const pcc = pc;
        pt = solve((x) => ((x - pt0) * Vt) / (P_ATM * h) - (qf(pcc, x) - qh(x)), -5000, top);
      }
      d.pc = pc;
      d.pt = pt;
      q = { h: qh(pt), f: qf(pc, pt), v: qv(pc) };
      // Пыль копится, пока идёт поток (с инструментом — быстрее); с мешком почти вся — в мешок.
      const dust = this.airP[4].value * (this.tool?.amps ? 1 : 0.25);
      const grow = dust * 0.0015 * (Math.max(0, q.h) / 0.043) * h;
      this.debrisKg += dust * 0.0004 * (Math.max(0, q.h) / 0.043) * h;
      const bag = this.dustP('bag') > 0;
      const onFilter = bag ? grow * 0.2 : grow;
      const stick = DUST_STICK[Math.round(this.dustP('kind'))] ?? 0.03;
      d.stuck = Math.min(2, d.stuck + onFilter * stick);
      d.loose = Math.min(2, d.loose + onFilter * (1 - stick));
      if (bag) (d.bagFill = Math.min(1, d.bagFill + grow * 0.02)), (d.bagCake = Math.min(1, d.bagCake + grow * 0.3));
    }
    const qH = Math.max(0, q.h);
    this.air = { p: Math.max(0, d.pc), tank: Math.max(0, d.pt), qh: qH, filterDp: d.pc - d.pt, flowDp: VENTURI_K * qH * qH, qv: q.v };
    this.motors.forEach((m, i) => {
      const f = fanQ(speeds[i], Math.max(0, d.pc));
      m.qm3 = f;
      m.q = speeds[i] > 0.05 ? Math.max(0, Math.min(1.2, f / (FAN_QMAX * speeds[i]))) : 0;
    });
  }

  private addMagnet(l: Load): void {
    const comp = l.comp;
    const fp = this.p.footprints[comp.footprint];
    // Плюс магнита — питание, в том числе через предохранитель (самовосстанавливающийся).
    const plus = (n: Id | undefined): Id | undefined => {
      const g = n ? this.c.netGroup.get(n) : undefined;
      if (!n || g === undefined || this.c.groups[g].power) return n;
      const next = this.fuseNext.get(n);
      const gn = next ? this.c.netGroup.get(next) : undefined;
      return next && gn !== undefined && this.c.groups[gn].power === 'vcc' ? next : n;
    };
    const coil = [plus(padNet(comp, fp, '+')), padNet(comp, fp, '-')]
      .map((n) => (n ? this.c.netGroup.get(n) : undefined))
      .filter((g): g is number => g !== undefined);
    const ohms = /(\d+)\s*Ом/.exec(comp.value);
    const v: MagValve = { load: l, params: [param('fault', 'клапан', 0, 0, 3, 1, '', MAG_STATES), param('ohm', 'сопротивление магнита', ohms ? +ohms[1] : 48, 10, 200, 1, 'Ом')], coil, held: false, x: 0, open: false, amps: 0, openedAt: 0, peakRev: 0 };
    this.mags.push(v);
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
        title: `${comp.ref} клапан на магните ${comp.value}`,
        on: v.open,
        params: v.params,
        readings: [
          { label: 'ток магнита', value: +v.amps.toFixed(2), unit: 'А' },
          { label: 'тарелка', value: Math.round(v.x * 100), unit: '% открыта' },
        ],
        warning: coil.length < 2 ? 'магнит не подключён' : undefined,
      }),
    });
  }

  /** Импульсный клапан 230 В через SSR: бьёт по фильтру так же, как клапан на магните (динамика камеры и бака). */
  private addPulse(l: Load, plate = false): void {
    const comp = l.comp;
    if (plate) return this.addHoldPlate(l);
    const v: MagValve = {
      load: l,
      params: [param('va', 'пусковая мощность катушки', 60, 5, 400, 5, 'ВА'), param('hold', 'мощность удержания', 25, 2, 150, 1, 'ВА'), param('fault', 'клапан', 0, 0, 2, 1, '', VALVE_STATES)],
      coil: [],
      held: false,
      x: 0,
      open: false,
      amps: 0,
      openedAt: 0,
      peakRev: 0,
      pulse: { onMs: 0 },
    };
    this.mags.push(v);
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
        title: `${comp.ref} импульсный клапан ${comp.value}${l.triac ? ` ← ${l.triac.comp.ref}` : ''}`,
        on: v.open,
        params: v.params,
        readings: [
          { label: 'ток катушки', value: +v.amps.toFixed(2), unit: 'А' },
          { label: 'мембрана', value: Math.round(v.x * 100), unit: '% открыта' },
        ],
        warning: !l.triac ? 'не найдено твердотельное реле в цепи клапана' : undefined,
      }),
    });
  }

  /** Тарельчатый клапан с удерживающим магнитом 230 В через SSR. */
  private addHoldPlate(l: Load): void {
    const comp = l.comp;
    const n = /(\d+)\s*Н/.exec(comp.value);
    const v: MagValve = {
      load: l,
      params: [param('force', 'сила магнита (зазор 0,5 мм)', n ? +n[1] : 150, 20, 400, 5, 'Н'), param('fault', 'клапан', 0, 0, PLATE_STATES.length - 1, 1, '', PLATE_STATES), param('va', 'мощность магнита', 12, 2, 60, 1, 'ВА')],
      coil: [],
      held: false,
      x: 0,
      open: false,
      amps: 0,
      openedAt: 0,
      peakRev: 0,
      plate: { field: 0 },
    };
    this.mags.push(v);
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
        title: `${comp.ref} тарельчатый клапан ${comp.value}${l.triac ? ` ← ${l.triac.comp.ref}` : ''}`,
        on: v.open,
        params: v.params,
        readings: [
          { label: 'магнит держит', value: Math.round(v.params[0].value * v.plate!.field), unit: 'Н' },
          { label: 'давит разрежение', value: Math.round(Math.max(0, this.dyn.pc) * PLATE_AREA), unit: 'Н' },
          { label: 'тарелка', value: Math.round(v.x * 100), unit: '% открыта' },
          { label: 'ток магнита', value: +v.amps.toFixed(3), unit: 'А' },
        ],
        warning: !l.triac ? 'не найдено твердотельное реле в цепи магнита' : undefined,
      }),
    });
  }

  /** Шунт в истоках ключей магнитов: ток магнитов — в цепь шунта (на нём напряжение для АЦП). */
  private findShunts(): void {
    const p = this.p;
    const c = this.c;
    const byNet = new Map<Id, MagValve[]>();
    for (const v of this.mags) {
      const comp = v.load.comp;
      const minus = padNet(comp, p.footprints[comp.footprint], '-');
      if (!minus) continue;
      for (const q of Object.values(p.components)) {
        const fp = p.footprints[q.footprint];
        if (!fp || q.offBoard) continue;
        const d = padNet(q, fp, 'D');
        const src = padNet(q, fp, 'S');
        if (d !== minus || !src) continue;
        const g = c.netGroup.get(src);
        if (g === undefined || c.groups[g].power) continue;
        byNet.set(src, [...(byNet.get(src) ?? []), v]);
      }
    }
    for (const [net, list] of byNet) c.setNetCurrent(net, () => list.reduce((a, v) => a + v.amps, 0), 'magnets');
  }

  /* ---------------- датчики для devices.ts ---------------- */

  /** Температура двигателя по обозначению (для термистора с полем «Где стоит»). */
  temperatureOf(where: string): (() => number) | null {
    const m = this.motors.find((x) => up(x.load.comp.ref) === up(where));
    return m ? () => m.temp : null;
  }

  /** Масса на тензодатчике под колесом бака, кг: пустой бак, вода и мусор (весы NAU7802). */
  massOf(): () => number {
    return () => this.tankTareKg + (this.tank ? this.tank.level * this.tankL : 0) + this.debrisKg;
  }

  /** Перепад давления для датчика, Па: «фильтр», «расходомер», «вход турбин» (разрежение). */
  pressureOf(where: string): (() => number) | null {
    const w = where.toLowerCase();
    if (this.mags.length) {
      const at = (f: () => number) => () => (this.advanceAir(this.us), f());
      if (/фильтр/.test(w)) return at(() => this.air.filterDp);
      if (/расход|вентури|шланг/.test(w)) return at(() => this.air.flowDp);
      if (/вход|турбин|разреж/.test(w)) return at(() => this.air.p);
      if (/бак/.test(w)) return at(() => this.air.tank);
      return null;
    }
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
        warning: !l.triac ? 'не найден симистор или регулятор в цепи двигателя' : !l.triac.moc && !l.triac.dimmer ? `затвор ${l.triac.comp.ref} не подключён к оптрону` : undefined,
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
          { label: 'напряжение на розетке', value: (l.triac ? l.triac.lastCond > 0.5 : !!l.relay && this.relayClosed(l.relay)) ? Math.round(this.volts) : 0, unit: 'В' },
          { label: 'ток', value: +t.amps.toFixed(2), unit: 'А' },
        ],
        actions: [{ key: 'switch', label: t.on ? 'Выключить инструмент' : 'Включить инструмент' }],
      }),
    });
  }

  private addTriacDevice(t: Triac): void {
    const comp = t.comp;
    // У модуля SSR каналов несколько — у каждого своя карточка.
    const ch = t.ssr ? this.triacs.filter((x) => x.comp === comp).indexOf(t) + 1 : 0;
    const id = ch ? `${comp.id}:ch${ch}` : comp.id;
    const states = t.ssr ? SSR_STATES : t.dimmer ? DIMMER_STATES : TRIAC_STATES;
    const params = [param('state', t.ssr ? `канал ${ch}` : t.dimmer ? 'регулятор' : 'симистор', 0, 0, 2, 1, '', states)];
    const feeds = () =>
      [...this.motors.map((m) => m.load), ...this.valves.map((v) => v.load), ...this.mags.map((v) => v.load), ...(this.tool ? [this.tool.load] : [])]
        .filter((l) => l.triac === t)
        .map((l) => l.comp.ref)
        .join(', ');
    const title = () => {
      if (t.ssr) return `${comp.ref} SSR ${comp.value}, канал ${ch}${feeds() ? ` → ${feeds()}` : ''}`;
      if (t.dimmer) return `${comp.ref} регулятор ${comp.value}${feeds() ? ` → ${feeds()}` : ''}`;
      return `${comp.ref} симистор ${comp.value}${t.moc ? ` ← ${t.moc.comp.ref} ${t.moc.comp.value}` : ''}`;
    };
    const warning = () => {
      if (t.ssr) return t.ssr.length < 2 ? 'вход канала или питание модуля не подключены' : !feeds() ? 'выход канала не в цепи нагрузки' : undefined;
      if (t.dimmer) return !t.dimmer.pin ? 'вход «управление» не подключён к контроллеру' : t.dimmer.vcc === undefined || this.c.groups[t.dimmer.vcc].power !== 'vcc' ? 'нет питания +VCC регулятора' : undefined;
      return !t.moc ? 'затвор не подключён к оптрону' : t.moc.ma < t.moc.needMa ? `мало тока светодиода ${t.moc.comp.ref}: ${t.moc.ma.toFixed(1)} мА, нужно ${t.moc.needMa}` : undefined;
    };
    this.devices.push({
      id,
      comp,
      set: (_k, v) => {
        params[0].value = v;
        t.state = Math.round(v);
      },
      view: () => ({
        id,
        comp: comp.id,
        ref: comp.ref,
        kind: 'triac',
        title: title(),
        on: t.lastCond > 0,
        params,
        readings: [
          ...(t.dimmer ? [{ label: 'задано', value: Math.round(t.dimmer.power * 100), unit: '% мощности' }] : []),
          ...(t.ssr ? [{ label: 'вход', value: this.ledOn(t) ? 1 : 0, unit: this.ledOn(t) ? 'включён' : 'выключен' }] : []),
          { label: 'открыт', value: Math.round(t.lastCond * 100), unit: '% полупериода' },
        ],
        warning: warning(),
      }),
    });
  }

  private addRelayDevice(r: Relay): void {
    const comp = r.comp;
    const feeds = () =>
      [...this.motors.map((m) => m.load), ...this.valves.map((v) => v.load), ...(this.tool ? [this.tool.load] : [])]
        .filter((l) => l.triac?.relay === r || l.relay === r)
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
        if (k === 'drain') (t.level = 0), (t.sucking = false), (this.debrisKg = 0);
        if (k === 'debris') this.debrisKg += 5;
        if (k === 'full') t.level = Math.max(t.level, 0.8);
      },
      view: () => ({
        id,
        comp: comp.id,
        ref: 'Бак',
        kind: 'tank',
        title: `Бак ${this.tankL} л: вода ${Math.round(t.level * 100)} %, мусор ${this.debrisKg.toFixed(1)} кг${t.sucking ? ', шланг в воде' : ''}`,
        params,
        readings: [
          { label: 'уровень', value: Math.round(t.level * 100), unit: '%' },
          { label: 'электрод уровня', value: t.wet[0] ? 1 : 0, unit: t.wet[0] ? 'в воде' : 'сухой' },
          { label: 'электрод перелива', value: t.wet[1] ? 1 : 0, unit: t.wet[1] ? 'в воде' : 'сухой' },
        ],
        actions: [
          { key: 'suck', label: t.sucking ? 'Вынуть шланг из воды' : 'Сосать воду' },
          { key: 'full', label: 'Бак почти полон (80 %)' },
          { key: 'debris', label: 'Насыпать 5 кг мусора' },
          { key: 'drain', label: 'Опорожнить бак' },
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

  private addCt(ct: Ct): void {
    const c = this.c;
    const amps = (cycle: number) => {
      const t = (cycle / this.freq) * 1e6;
      return ct.loads.reduce((a, l) => a + this.loadAmps(l, t), 0);
    };
    if (ct.vPerA) {
      // Нагрузка внутри: на S1 — напряжение середины (S2) плюс сигнал.
      const k = ct.vPerA;
      c.setNetSource(ct.s1, (cy) => (ct.s2 ? c.netVolts(ct.s2) : 0) + amps(cy) * k);
    } else {
      c.setNetCurrent(ct.s1, (cy) => amps(cy) / ct.ratio, ct.comp.id);
      c.setNetCurrent(ct.s2, (cy) => -amps(cy) / ct.ratio, ct.comp.id);
    }
    const comp = ct.comp;
    this.devices.push({
      id: comp.id,
      comp,
      view: () => {
        const rms = ct.loads.reduce((a, l) => a + (l.kind === 'motor' ? (this.motors.find((m) => m.load === l)?.amps ?? 0) : l.kind === 'tool' ? (this.tool?.amps ?? 0) : ([...this.valves, ...this.mags].find((v) => v.load === l)?.amps ?? 0)), 0);
        const readings = [{ label: 'ток', value: +rms.toFixed(2), unit: 'А' }, ...(ct.vPerA ? [{ label: 'выход', value: +(rms * ct.vPerA).toFixed(3), unit: 'В действ.' }] : [])];
        return { id: comp.id, comp: comp.id, ref: comp.ref, kind: 'sensor', title: `${comp.ref} трансформатор тока ${comp.value}: ${ct.loads.map((l) => l.comp.ref).join(', ') || '—'}`, readings, warning: !ct.loads.length ? 'через окно не проходит провод нагрузки' : undefined };
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
        if (k === 'palm') this.palm = !this.palm;
        if (k === 'dust') (this.dyn.loose = Math.min(2, this.dyn.loose + 0.4)), (this.dyn.stuck = Math.min(2, this.dyn.stuck + 0.4 * (DUST_STICK[Math.round(this.dustP('kind'))] ?? 0)));
        if (k === 'clean') (this.dyn.loose = 0), (this.dyn.stuck = 0), (this.dyn.bagCake = 0);
        if (k === 'bag') (this.dyn.bagFill = 0), (this.dyn.bagCake = 0);
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
            { label: 'пыль на фильтре', value: Math.round((this.mags.length ? this.dyn.loose + this.dyn.stuck : (this.cake[0] + this.cake[1]) / 2) * 100), unit: '%' },
            ...(this.mags.length ? [{ label: 'разрежение в баке', value: +(a.tank / 1000).toFixed(2), unit: 'кПа' }, { label: 'мешок заполнен', value: Math.round(this.dyn.bagFill * 100), unit: '%' }] : []),
          ],
          actions: [
            { key: 'dust', label: 'Насыпать пыли на фильтр' },
            { key: 'clean', label: 'Чистый фильтр' },
            { key: 'nozzle', label: this.blockHeld ? 'Отпустить насадку' : 'Прижать насадку' },
            ...(this.mags.length ? [{ key: 'palm', label: this.palm ? 'Открыть шланг' : 'Закрыть шланг ладонью' }, { key: 'bag', label: 'Новый мешок' }] : []),
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
      valves: [
        ...this.valves.map((v) => ({ ref: v.load.comp.ref, open: v.open, amps: v.amps, fault: v.params[2].value ? VALVE_STATES[v.params[2].value] : null })),
        ...this.mags.map((v) => {
          const f = v.params[v.plate ? 1 : v.pulse ? 2 : 0].value;
          return { ref: v.load.comp.ref, open: v.open, amps: v.amps, fault: f ? (v.plate ? PLATE_STATES : v.pulse ? VALVE_STATES : MAG_STATES)[f] : null };
        }),
      ],
      relays: this.relays.map((r) => ({ ref: r.comp.ref, closed: this.relayClosed(r), fault: r.params[0].value ? RELAY_STATES[r.params[0].value] : null })),
      tank: this.tank ? { level: this.tank.level, liters: this.tank.level * this.tankL, e: [this.tank.wet[0], this.tank.wet[1]], float: this.tank.level >= 0.8 && !this.tank.params[2].value, sucking: this.tank.sucking } : null,
      tool: this.tool ? { ref: this.tool.load.comp.ref, on: this.tool.on, powered: this.tool.load.triac ? this.tool.load.triac.lastCond > 0.5 : !!this.tool.load.relay && this.relayClosed(this.tool.load.relay) && this.volts > 0, amps: this.tool.amps, watts: this.tool.amps * this.volts } : null,
      air: {
        flow: a.qh * 3600,
        speed: a.qh / A,
        vacuum: a.p / 1000,
        tank: a.tank / 1000,
        filterDp: a.filterDp,
        flowDp: a.flowDp,
        cake: this.mags.length ? [this.dyn.loose + this.dyn.stuck, this.dyn.loose + this.dyn.stuck] : [this.cake[0], this.cake[1]],
        deep: this.airP[3].value / 100,
        block: this.palm ? 1 : this.blockHeld ? 0.95 : this.airP[2].value / 100,
        hoseMm: d,
        hoseM: this.airP[0].value,
      },
      zc: { width: this.zcWidth, ok: this.zcGroup !== undefined },
    };
  }
}
