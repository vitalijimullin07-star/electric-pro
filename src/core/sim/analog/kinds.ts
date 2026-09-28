import type { Component, FootprintDef } from '../../model/types';
import { isResistor, isWireLike } from '../circuit';
import { transistorType } from '../devices';

/*
 * Вид модели детали для аналогового расчёта. Определяется по корпусу, названию и именам
 * выводов (detectKind); в свойствах детали его можно задать вручную (Component.sim.model),
 * например клеммник — «источник питания 12 В» или «двигатель», транзистор без имён
 * выводов — «MOSFET N». Параметры модели (Component.sim.params) — те же ключи, что у
 * ползунков вкладки «Цепь».
 */

export type SimKind =
  | 'resistor'
  | 'pot'
  | 'ntc'
  | 'ldr'
  | 'capacitor'
  | 'inductor'
  | 'fuse'
  | 'wire'
  | 'diode'
  | 'led'
  | 'zener'
  | 'bridge'
  | 'nmos'
  | 'pmos'
  | 'npn'
  | 'pnp'
  | 'triac'
  | 'scr'
  | 'opamp'
  | 'comparator'
  | 'tl431'
  | 'regulator'
  | 'dcdc'
  | 'timer555'
  | 'logic'
  | 'l293'
  | 'uln'
  | 'opto'
  | 'opto-triac'
  | 'opto-logic'
  | 'relay'
  | 'transformer'
  | 'battery'
  | 'source'
  | 'load'
  | 'lamp'
  | 'speaker'
  | 'buzzer'
  | 'motor'
  | 'button'
  | 'switch'
  | 'switch-spdt'
  | 'microswitch'
  | 'dipswitch'
  | 'current-sensor'
  | 'hall'
  | 'temp-sensor'
  | 'lcd'
  | 'dd-coil'
  | 'ic-load'
  | 'none';

export interface KindParam {
  key: string;
  label: string;
  unit: string;
}

export interface KindInfo {
  label: string;
  /** Раздел в списке выбора. */
  group: string;
  /** Параметры, которые можно задать вручную (остальные — по названию детали). */
  params: KindParam[];
  /** Что должно быть у выводов (подсказка при ручном выборе). */
  pins?: string;
}

const P = (key: string, label: string, unit: string): KindParam => ({ key, label, unit });

export const KIND_INFO: Record<SimKind, KindInfo> = {
  resistor: { label: 'резистор', group: 'Пассивные', params: [P('r', 'сопротивление', 'Ом')] },
  pot: { label: 'потенциометр', group: 'Пассивные', params: [P('r', 'сопротивление', 'Ом'), P('pos', 'положение', '%')], pins: '1, W (движок), 3' },
  ntc: { label: 'терморезистор NTC', group: 'Датчики', params: [P('r25', 'сопротивление при 25 °C', 'Ом'), P('beta', 'B', 'К'), P('temp', 'температура', '°C')] },
  ldr: { label: 'фоторезистор', group: 'Датчики', params: [P('r10', 'сопротивление при 10 лк', 'Ом'), P('lux', 'освещённость', 'лк')] },
  capacitor: { label: 'конденсатор', group: 'Пассивные', params: [P('c', 'ёмкость', 'Ф'), P('esr', 'ESR', 'Ом')] },
  inductor: { label: 'дроссель', group: 'Пассивные', params: [P('l', 'индуктивность', 'Гн'), P('dcr', 'сопротивление провода', 'Ом')] },
  fuse: { label: 'предохранитель', group: 'Пассивные', params: [P('amps', 'ток срабатывания', 'А')] },
  wire: { label: 'перемычка', group: 'Пассивные', params: [] },
  diode: { label: 'диод', group: 'Полупроводники', params: [P('vf', 'прямое напряжение', 'В'), P('rd', 'сопротивление открытого', 'Ом')], pins: 'A, K' },
  led: { label: 'светодиод', group: 'Полупроводники', params: [P('vf', 'прямое напряжение', 'В'), P('imax', 'ток полной яркости', 'А')], pins: 'A, K' },
  zener: { label: 'стабилитрон', group: 'Полупроводники', params: [P('vz', 'напряжение стабилизации', 'В'), P('vf', 'прямое напряжение', 'В')], pins: 'A, K' },
  bridge: { label: 'диодный мост', group: 'Полупроводники', params: [P('vf', 'прямое напряжение диода', 'В')], pins: '~, ~, +, −' },
  nmos: { label: 'MOSFET N', group: 'Полупроводники', params: [P('vth', 'порог', 'В'), P('ron', 'сопротивление открытого', 'Ом'), P('cgs', 'ёмкость затвора', 'Ф')], pins: 'G, D, S (без имён — как у TO-220: 1 G, 2 D, 3 S)' },
  pmos: { label: 'MOSFET P', group: 'Полупроводники', params: [P('vth', 'порог', 'В'), P('ron', 'сопротивление открытого', 'Ом'), P('cgs', 'ёмкость затвора', 'Ф')], pins: 'G, D, S' },
  npn: { label: 'транзистор n-p-n', group: 'Полупроводники', params: [P('beta', 'усиление β', ''), P('vbe', 'напряжение база—эмиттер', 'В')], pins: 'B, C, E (без имён — 1 B, 2 C, 3 E)' },
  pnp: { label: 'транзистор p-n-p', group: 'Полупроводники', params: [P('beta', 'усиление β', ''), P('vbe', 'напряжение база—эмиттер', 'В')], pins: 'B, C, E' },
  triac: { label: 'симистор', group: 'Полупроводники', params: [P('igt', 'ток включения', 'А'), P('ih', 'ток удержания', 'А')], pins: 'T1, T2, G' },
  scr: { label: 'тиристор', group: 'Полупроводники', params: [P('igt', 'ток включения', 'А'), P('ih', 'ток удержания', 'А')], pins: 'A, K, G' },
  opamp: { label: 'операционный усилитель', group: 'Микросхемы', params: [P('gbw', 'полоса (GBW)', 'Гц'), P('en', 'шум на входе', 'нВ/√Гц')], pins: 'IN+, IN−, OUT, питание (или IN1+, OUT1…)' },
  comparator: { label: 'компаратор', group: 'Микросхемы', params: [], pins: 'IN+, IN−, OUT, питание' },
  tl431: { label: 'TL431', group: 'Микросхемы', params: [P('vref', 'опорное', 'В')], pins: 'REF, A, K' },
  regulator: { label: 'линейный стабилизатор', group: 'Питание', params: [P('vout', 'выход', 'В'), P('vdrop', 'минимальный перепад', 'В')], pins: 'IN, GND (или ADJ), OUT' },
  dcdc: { label: 'DC-DC преобразователь', group: 'Питание', params: [P('vout', 'выход', 'В'), P('eff', 'КПД', '%')], pins: 'IN+, IN−, OUT+, OUT− (или VIN, GND, OUT)' },
  timer555: { label: 'таймер 555', group: 'Микросхемы', params: [], pins: 'GND, TRIG, OUT, RST, CTRL, THR, DIS, VCC' },
  logic: { label: 'логика (74HC, CD40)', group: 'Микросхемы', params: [] },
  l293: { label: 'мостовой драйвер L293D', group: 'Микросхемы', params: [] },
  uln: { label: 'ключи ULN2003/2803', group: 'Микросхемы', params: [] },
  opto: { label: 'оптрон с транзистором', group: 'Оптроны и реле', params: [P('ctr', 'коэффициент передачи', '%')], pins: 'A, K, C, E' },
  'opto-triac': { label: 'оптосимистор', group: 'Оптроны и реле', params: [P('ift', 'ток включения светодиода', 'А')], pins: 'A, K, MT1, MT2' },
  'opto-logic': { label: 'быстрый оптрон (6N137)', group: 'Оптроны и реле', params: [], pins: 'A, K, VO, VCC, GND' },
  relay: { label: 'реле', group: 'Оптроны и реле', params: [P('vcoil', 'напряжение катушки', 'В'), P('rcoil', 'сопротивление катушки', 'Ом')], pins: 'COIL×2, COM, NO, NC' },
  transformer: { label: 'трансформатор', group: 'Питание', params: [P('vp', 'первичное', 'В'), P('vs', 'вторичное', 'В'), P('va', 'мощность', 'ВА')], pins: 'P1, P2, S1, S2' },
  battery: { label: 'аккумулятор, батарея', group: 'Питание', params: [P('volts', 'напряжение', 'В'), P('rint', 'внутреннее сопротивление', 'Ом')], pins: '+, − (без имён — 1 +, 2 −)' },
  source: { label: 'источник питания (блок питания)', group: 'Питание', params: [P('volts', 'напряжение', 'В'), P('ilim', 'ограничение тока', 'А')], pins: '+, − (без имён — 1 +, 2 −)' },
  load: { label: 'нагрузка (резистивная)', group: 'Нагрузки', params: [P('r', 'сопротивление', 'Ом')] },
  lamp: { label: 'лампа накаливания', group: 'Нагрузки', params: [P('watts', 'мощность', 'Вт'), P('volts', 'напряжение', 'В')] },
  speaker: { label: 'динамик', group: 'Нагрузки', params: [P('r', 'сопротивление', 'Ом')] },
  buzzer: { label: 'зуммер', group: 'Нагрузки', params: [P('r', 'сопротивление', 'Ом')] },
  motor: { label: 'двигатель постоянного тока', group: 'Нагрузки', params: [P('r', 'сопротивление якоря', 'Ом'), P('l', 'индуктивность якоря', 'мГн'), P('k', 'постоянная ЭДС', 'мВ·с/рад'), P('j', 'инерция', 'г·см²'), P('load', 'момент нагрузки', 'мН·м')] },
  button: { label: 'кнопка (нажата, пока держите)', group: 'Кнопки и переключатели', params: [] },
  switch: { label: 'выключатель', group: 'Кнопки и переключатели', params: [P('on', 'включён', '')] },
  'switch-spdt': { label: 'переключатель на два положения', group: 'Кнопки и переключатели', params: [P('pos', 'положение', '')], pins: 'три вывода, общий — средний' },
  microswitch: { label: 'микропереключатель', group: 'Кнопки и переключатели', params: [], pins: 'COM, NO, NC' },
  dipswitch: { label: 'DIP-переключатель', group: 'Кнопки и переключатели', params: [] },
  'current-sensor': { label: 'датчик тока ACS712', group: 'Датчики', params: [P('sens', 'чувствительность', 'мВ/А')] },
  hall: { label: 'датчик Холла', group: 'Датчики', params: [P('field', 'поле', 'мТл')] },
  'temp-sensor': { label: 'датчик температуры LM35', group: 'Датчики', params: [P('temp', 'температура', '°C')] },
  lcd: { label: 'ЖК-модуль (подсветка и потребление)', group: 'Прочее', params: [] },
  'dd-coil': { label: 'катушка металлоискателя', group: 'Прочее', params: [] },
  'ic-load': { label: 'микросхема: только потребление', group: 'Прочее', params: [P('ma', 'потребление', 'мА')] },
  none: { label: 'не участвует в расчёте', group: 'Прочее', params: [] },
};

export const up = (s: string) => s.toUpperCase().replace(/\s+/g, '');

export function padsByName(fp: FootprintDef): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const q of fp.pads) {
    if (q.type === 'npth') continue;
    const k = up(q.name ?? q.number);
    const list = m.get(k) ?? [];
    list.push(q.number);
    m.set(k, list);
  }
  return m;
}

/** Микросхемы логики, которые умеет расчёт (по номиналу или меткам корпуса). */
export const LOGIC_RE = /74(HC|HCT|LS|AC|ALS)?(00|02|04|08|14|32|86|595)\b|CD40(17|106|11|01|69|70|71|81)\b|4017|40106|К155ЛА3|К561ЛА7|К561ЛН2|К561ИЕ8|К176ИЕ8/i;

/**
 * Вид модели по детали. null — модели нет (кварц, крепёж, контроллер, модули без
 * известной аналоговой части). Ручной выбор (Component.sim.model) проверяется до вызова.
 */
export function detectKind(comp: Component, fp: FootprintDef): SimKind | null {
  const tags = fp.tags ?? [];
  const has = (t: string) => tags.includes(t);
  const pads = padsByName(fp);
  const names = (...n: string[]) => n.every((x) => pads.has(up(x)));
  const text = `${tags.join(' ')} ${fp.id} ${fp.name} ${comp.value} ${comp.description ?? ''}`;
  const two = fp.pads.filter((q) => q.type !== 'npth').length === 2;
  const v = comp.value;

  if (has('crystal') || fp.category === 'Кварцы и резонаторы' || has('hole') || fp.category === 'Крепёж') return null;
  if (has('dd-coil')) return 'dd-coil';
  if (has('relay') && pads.has('COM')) return 'relay';
  if (has('transformer') && names('P1', 'P2', 'S1', 'S2')) return 'transformer';
  if (has('bridge') && pads.has('~') && pads.has('+') && pads.has('-')) return 'bridge';
  if ((has('opto') || has('optocoupler') || /PC817|EL817|4N3\d|4N2\d|MOC30|6N13\d/i.test(v)) && names('A', 'K')) {
    if (names('MT1', 'MT2')) return 'opto-triac';
    if (names('VO', 'VCC')) return 'opto-logic';
    if (names('C', 'E')) return 'opto';
  }
  if (names('T1', 'T2', 'G') || (has('triac') && names('MT1', 'MT2', 'G'))) return 'triac';
  if ((has('scr') || /BT15\d|TYN\d|2N50\d\d|MCR\d/i.test(v)) && names('A', 'K', 'G')) return 'scr';
  if (has('ntc') || has('thermistor')) return two ? 'ntc' : null;
  if (has('ldr') || has('photoresistor')) return two ? 'ldr' : null;
  if (/^Potentiometer_|^Module_Potentiometer$/.test(fp.id) || /potentiometer|потенциометр|trimmer|подстроеч/i.test(text)) return 'pot';
  if (isResistor(fp)) return 'resistor';
  if ((fp.category === 'Конденсаторы' || has('capacitor')) && two) return 'capacitor';
  if (isWireLike(fp) && two) return fp.category === 'Индуктивности' ? 'inductor' : /fuse|предохран|ptc/i.test(text) ? 'fuse' : 'wire';
  if ((fp.category === 'Светодиоды' || has('led')) && names('A', 'K')) return 'led';
  if ((fp.category === 'Диоды' || has('diode') || has('photodiode')) && names('A', 'K')) return /zener|стабилитрон|BZX|BZV|1N47\d\d|KC\d/i.test(text) ? 'zener' : 'diode';
  const pol = transistorType(fp, comp);
  if (pol) return pol;
  if (has('tl431') || /TL431|AZ431|KA431|LM431/i.test(v)) return 'tl431';
  if ((has('buck') || has('boost') || has('dc-dc') || /AP6320\d|K78\d\d|MP1584|LM2596|XL4015|MT3608|MINI-?360/i.test(`${v} ${fp.id}`)) && ((names('IN+', 'OUT+') || names('VIN+', 'VOUT+')) || names('VIN', 'GND') || names('IN', 'GND', 'OUT'))) return 'dcdc';
  if ((has('regulator') || has('ldo') || /regulator|стабилизатор/i.test(text)) && (pads.has('IN') || pads.has('VI') || pads.has('VIN'))) return 'regulator';
  if ((has('555') || /(^|[^0-9])(NE|LM|SE|NA|TLC|ICM|LMC)?7?555/i.test(v)) && names('THR', 'TRIG')) return 'timer555';
  if (has('l293d') || /L293|SN754410/i.test(v)) return 'l293';
  if (has('uln2003') || has('uln2803') || /ULN2[08]0\d/i.test(v)) return 'uln';
  if (LOGIC_RE.test(`${v} ${tags.join(' ')}`) && (pads.has('VCC') || pads.has('VDD'))) return 'logic';
  if (/LM39[37]|LM339|LM2903|LM2901|LM311/i.test(v)) return 'comparator';
  if (has('opamp') || /op-?amp|операцион|LM358|LM324|TL07\d|TL08\d|NE553\d|MCP60\d|LM741|OP07|TDA20[35]0|LM1875/i.test(`${text}`)) return 'opamp';
  if (has('comparator')) return 'comparator';
  if (has('acs712') && fp.pads.length >= 8 && !fp.id.startsWith('Module_')) return 'current-sensor';
  if (has('hall') && (pads.has('OUT') || pads.has('VOUT'))) return 'hall';
  if (has('lm35') || /LM35|LM335|TMP36/i.test(v)) return 'temp-sensor';
  if (has('battery') || /^(GB|BAT|BT)\d/i.test(comp.ref)) return 'battery';
  if ((has('speaker') || /^Speaker_/.test(fp.id)) && two) return 'speaker';
  if ((has('buzzer') || /^Buzzer_/.test(fp.id)) && two) return 'buzzer';
  if ((has('motor') || /^M\d/.test(comp.ref) || /^Motor_DC|двигател/i.test(`${fp.id} ${comp.description ?? ''}`)) && two && !has('module')) return 'motor';
  if (has('lamp') || /лампа|lamp/i.test(comp.value)) return two ? 'lamp' : null;
  if (fp.category === 'Кнопки и переключатели' || has('button') || has('tactile') || has('reed') || has('tilt') || has('vibration')) {
    if (has('encoder') || has('touch') || has('keyboard')) return has('keyboard') ? 'button' : null;
    if (has('dip-switch')) return 'dipswitch';
    if (has('microswitch') || names('COM', 'NO', 'NC')) return 'microswitch';
    if (has('spdt') || has('dpdt') || has('toggle') || has('slide')) return 'switch-spdt';
    if (has('rocker') || has('reed') || has('tilt') || has('vibration')) return 'switch';
    return 'button';
  }
  if (has('lcd') || has('hd44780')) return 'lcd';
  if (fp.category === 'Микросхемы' || has('module') || fp.category === 'Модули' || fp.category === 'Датчики') return 'ic-load';
  return null;
}

/** Вид модели с учётом ручного выбора. */
export function kindOf(comp: Component, fp: FootprintDef): SimKind | null {
  const m = comp.sim?.model;
  if (m && m in KIND_INFO) return m as SimKind;
  return detectKind(comp, fp);
}

/** Список видов для выбора в свойствах: по разделам. */
export function kindChoices(): { group: string; kinds: { kind: SimKind; label: string }[] }[] {
  const groups = new Map<string, { kind: SimKind; label: string }[]>();
  for (const [k, info] of Object.entries(KIND_INFO) as [SimKind, KindInfo][]) {
    if (k === 'dd-coil') continue;
    const list = groups.get(info.group) ?? [];
    list.push({ kind: k, label: info.label });
    groups.set(info.group, list);
  }
  return [...groups].map(([group, kinds]) => ({ group, kinds }));
}
