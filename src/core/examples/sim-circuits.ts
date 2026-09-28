import { libraryFootprints } from '../library';
import { addComponent, connectPad, ensureNet } from '../model/edit';
import { createProject } from '../model/project';
import type { Component, FootprintDef, Project } from '../model/types';
import { syncSymbolsFromBoard } from '../schematic/netlist';

/*
 * Примеры схем без контроллера для симуляции «как в EveryCircuit»: сразу «Старт» —
 * и видно, как течёт ток, мигают светодиоды, крутится двигатель, щёлкает реле. Плата
 * не разведена (детали расставлены, цепи заданы, схема — из платы с метками цепей).
 */

function find(pred: (f: FootprintDef) => boolean, what: string): FootprintDef {
  const f = libraryFootprints().find(pred);
  if (!f) throw new Error(`В библиотеке нет корпуса: ${what}`);
  return f;
}

const names = (f: FootprintDef) => new Set(f.pads.map((q) => (q.name ?? '').toUpperCase()));
export const FP = {
  resistor: () => find((f) => /^R_Axial_.*Horizontal$/.test(f.id), 'резистор'),
  ceramic: () => find((f) => /^C_Disc_/.test(f.id), 'керамический конденсатор'),
  electrolytic: () => find((f) => /^CP_Radial_D(5|6\.3)mm/.test(f.id), 'электролит'),
  bigElectrolytic: () => find((f) => /^CP_Radial_D(10|12\.5)mm/.test(f.id), 'электролит'),
  led: () => find((f) => f.category === 'Светодиоды' && names(f).has('A') && names(f).has('K') && /5/.test(f.id) && f.pads.length === 2, 'светодиод'),
  diode: () => find((f) => f.id.startsWith('D_DO-35') && names(f).has('A'), 'диод DO-35'),
  powerDiode: () => find((f) => f.id.startsWith('D_DO-41') && names(f).has('A'), 'диод DO-41'),
  terminal2: () => find((f) => /^TerminalBlock_1x02_/.test(f.id), 'клеммник на 2'),
  ne555: () => find((f) => f.id === 'IC_NE555_DIP-8', 'NE555'),
  cd4017: () => find((f) => f.id === 'IC_CD4017_DIP-16', 'CD4017'),
  nmos: () => find((f) => f.id === 'Q_IRFZ44N_TO-220', 'IRFZ44N'),
  npn: () => find((f) => f.id === 'Q_BC547_TO-92', 'BC547'),
  reg: () => find((f) => f.id === 'REG_7805_TO-220', '7805'),
  transformer: () => find((f) => f.id === 'Transformer_EI30_PCB', 'трансформатор'),
  bridge: () => find((f) => f.id === 'D_Bridge_KBP_P5.08mm', 'мост KBP'),
  fuse: () => find((f) => f.id === 'Fuseholder_Clip-5x20mm_P22.6mm_Horizontal', 'держатель предохранителя'),
  relay: () => find((f) => f.id === 'Relay_SRD_SPDT', 'реле SRD'),
  button: () => find((f) => f.id === 'SW_PUSH_6mm', 'кнопка 6×6'),
  slide: () => find((f) => f.id === 'SW_Slide_SS12D00', 'ползунковый переключатель'),
  pot: () => find((f) => /^Potentiometer_/.test(f.id) && f.pads.filter((q) => q.type !== 'npth').length === 3, 'потенциометр'),
};

/** Корпус библиотеки по id (для примеров и тестов). */
export const fpById = (id: string): FootprintDef => find((f) => f.id === id, id);

/** Небольшой помощник: детали по сетке, выводы — в цепи по именам. */
export class Builder {
  readonly p: Project;
  private x = 8;
  private y = 10;
  constructor(name: string, w: number, h: number) {
    this.p = createProject({ name, width: w, height: h, copperLayers: 1, homemade: true });
  }
  /** Поставить деталь; pins — номер или имя вывода → имя цепи. */
  add(fp: FootprintDef, o: { ref?: string; value: string; description?: string; sim?: Component['sim'] }, pins: Record<string, string>): Component {
    const c = addComponent(this.p, fp, { x: this.x, y: this.y }, { ref: o.ref, value: o.value, description: o.description });
    if (o.sim) c.sim = o.sim;
    for (const [pin, net] of Object.entries(pins)) {
      const pad = fp.pads.find((q) => q.number === pin) ?? fp.pads.find((q) => (q.name ?? '').toUpperCase() === pin.toUpperCase());
      if (!pad) throw new Error(`${c.ref}: нет вывода ${pin}`);
      connectPad(this.p, c.id, pad.number, ensureNet(this.p, net).id);
    }
    // Следующая деталь — правее, по рядам.
    const cr = fp.courtyard;
    this.x += Math.max(8, cr ? cr.max.x - cr.min.x + 4 : 10);
    if (this.x > 80) {
      this.x = 8;
      this.y += 18;
    }
    return c;
  }
  done(description: string): Project {
    this.p.meta.description = description;
    syncSymbolsFromBoard(this.p);
    return this.p;
  }
}

/** Мигалка на NE555: светодиод ≈ 1 раз в секунду, выключатель питания. */
export function example555Blink(): Project {
  const b = new Builder('Мигалка на NE555', 90, 60);
  b.add(FP.terminal2(), { ref: 'GB1', value: '9 В', description: 'Батарея «Крона» 9 В', sim: { model: 'battery' } }, { '1': 'BAT+', '2': 'GND' });
  b.add(FP.slide(), { ref: 'SW1', value: 'Питание' }, { '1': 'OFF', '2': 'BAT+', '3': 'VCC' });
  b.add(FP.ne555(), { ref: 'U1', value: 'NE555' }, { VCC: 'VCC', RST: 'VCC', GND: 'GND', DIS: 'DIS', THR: 'TIM', TRIG: 'TIM', CTRL: 'CTRL', OUT: 'OUT' });
  b.add(FP.resistor(), { ref: 'R1', value: '10 кОм' }, { '1': 'VCC', '2': 'DIS' });
  b.add(FP.resistor(), { ref: 'R2', value: '68 кОм' }, { '1': 'DIS', '2': 'TIM' });
  b.add(FP.electrolytic(), { ref: 'C1', value: '10 мкФ × 16 В' }, { '1': 'TIM', '2': 'GND' });
  b.add(FP.ceramic(), { ref: 'C2', value: '10 нФ' }, { '1': 'CTRL', '2': 'GND' });
  b.add(FP.resistor(), { ref: 'R3', value: '470 Ом' }, { '1': 'OUT', '2': 'LED_A' });
  b.add(FP.led(), { ref: 'LED1', value: 'красный' }, { A: 'LED_A', K: 'GND' });
  b.add(FP.electrolytic(), { ref: 'C3', value: '100 мкФ × 16 В' }, { '1': 'VCC', '2': 'GND' });
  return b.done('Классическая мигалка на таймере 555: частота 1,44/((R1 + 2·R2)·C1) ≈ 1 Гц. Симуляция без контроллера: «Старт», переключатель SW1 — касанием; на вкладке «Цепь» — ползунки R1, R2, C1 и осциллограф (TIM и OUT).');
}

/** Блок питания 12 В: сеть 230 В, трансформатор, мост, фильтр, 7812, нагрузка. */
export function examplePsu12(): Project {
  const b = new Builder('Блок питания 12 В', 110, 70);
  b.add(FP.terminal2(), { ref: 'X1', value: 'Сеть 230 В' }, { '1': 'L', '2': 'N' });
  b.add(FP.fuse(), { ref: 'F1', value: '100 мА' }, { '1': 'L', '2': 'L_F' });
  b.add(FP.transformer(), { ref: 'TV1', value: '230/15 В 5 ВА' }, { P1: 'L_F', P2: 'N', S1: 'AC1', S2: 'AC2' });
  b.add(FP.bridge(), { ref: 'VD1', value: 'KBP206' }, { '1': 'AC1', '3': 'AC2', '2': 'RAW', '4': 'GND' });
  b.add(FP.bigElectrolytic(), { ref: 'C1', value: '2200 мкФ × 35 В' }, { '1': 'RAW', '2': 'GND' });
  b.add(FP.reg(), { ref: 'DA1', value: 'LM7812' }, { IN: 'RAW', GND: 'GND', OUT: 'OUT12' });
  b.add(FP.ceramic(), { ref: 'C2', value: '100 нФ' }, { '1': 'OUT12', '2': 'GND' });
  b.add(FP.resistor(), { ref: 'R1', value: '1 кОм' }, { '1': 'OUT12', '2': 'LED_A' });
  b.add(FP.led(), { ref: 'LED1', value: 'зелёный' }, { A: 'LED_A', K: 'GND' });
  b.add(FP.terminal2(), { ref: 'X2', value: 'Нагрузка', description: 'Нагрузка 120 Ом (≈ 100 мА)', sim: { model: 'load', params: { r: 120 } } }, { '1': 'OUT12', '2': 'GND' });
  return b.done('Линейный блок питания: сеть 230 В 50 Гц (цепи L и N), трансформатор 230/15 В, мост, конденсатор 2200 мкФ, стабилизатор 7812. На осциллографе видны пульсации на RAW и ровные 12 В на OUT12; ползунком нагрузки X2 можно довести до провала стабилизации, а короткое замыкание сожжёт предохранитель F1.');
}

/** ШИМ-регулятор оборотов двигателя: 555 с потенциометром и диодами, MOSFET, двигатель. */
export function exampleMotorPwm(): Project {
  const b = new Builder('ШИМ-регулятор двигателя на 555', 110, 70);
  b.add(FP.terminal2(), { ref: 'GB1', value: '12 В', description: 'Аккумулятор 12 В', sim: { model: 'battery' } }, { '1': '+12V', '2': 'GND' });
  b.add(FP.ne555(), { ref: 'U1', value: 'NE555' }, { VCC: '+12V', RST: '+12V', GND: 'GND', DIS: 'DIS', THR: 'TIM', TRIG: 'TIM', CTRL: 'CTRL', OUT: 'OUT' });
  b.add(FP.resistor(), { ref: 'R1', value: '1 кОм' }, { '1': '+12V', '2': 'DIS' });
  b.add(FP.pot(), { ref: 'RP1', value: '100 кОм', description: 'Скорость' }, { '1': 'CH', '2': 'DIS', '3': 'DCH' });
  b.add(FP.diode(), { ref: 'VD1', value: '1N4148' }, { A: 'CH', K: 'TIM' });
  b.add(FP.diode(), { ref: 'VD2', value: '1N4148' }, { A: 'TIM', K: 'DCH' });
  b.add(FP.ceramic(), { ref: 'C1', value: '10 нФ' }, { '1': 'TIM', '2': 'GND' });
  b.add(FP.ceramic(), { ref: 'C2', value: '10 нФ' }, { '1': 'CTRL', '2': 'GND' });
  b.add(FP.resistor(), { ref: 'R2', value: '100 Ом' }, { '1': 'OUT', '2': 'GATE' });
  b.add(FP.resistor(), { ref: 'R3', value: '10 кОм' }, { '1': 'GATE', '2': 'GND' });
  b.add(FP.nmos(), { ref: 'VT1', value: 'IRFZ44N' }, { G: 'GATE', D: 'DRAIN', S: 'GND' });
  b.add(FP.terminal2(), { ref: 'M1', value: 'Двигатель 12 В', description: 'Коллекторный двигатель 12 В', sim: { model: 'motor' } }, { '1': '+12V', '2': 'DRAIN' });
  b.add(FP.powerDiode(), { ref: 'VD3', value: 'SS34' }, { A: 'DRAIN', K: '+12V' });
  b.add(FP.bigElectrolytic(), { ref: 'C3', value: '470 мкФ × 25 В' }, { '1': '+12V', '2': 'GND' });
  return b.done('ШИМ на таймере 555: потенциометр RP1 с диодами VD1, VD2 меняет скважность при почти постоянной частоте (≈ 1,4 кГц), MOSFET VT1 включает двигатель M1, VD3 гасит выброс катушки. На вкладке «Цепь» — ползунок RP1 (положение) и момент нагрузки двигателя; на осциллографе — GATE и DRAIN, в карточке двигателя — обороты и ток.');
}

/** Реле с кнопкой: транзисторный ключ, диод на катушке, лампа на контактах. */
export function exampleRelay(): Project {
  const b = new Builder('Реле с кнопкой', 100, 60);
  b.add(FP.terminal2(), { ref: 'GB1', value: '12 В', sim: { model: 'battery' } }, { '1': '+12V', '2': 'GND' });
  b.add(FP.button(), { ref: 'SB1', value: 'Пуск' }, { '1': '+12V', '3': 'BTN' });
  b.add(FP.resistor(), { ref: 'R1', value: '4,7 кОм' }, { '1': 'BTN', '2': 'BASE' });
  b.add(FP.resistor(), { ref: 'R2', value: '47 кОм' }, { '1': 'BASE', '2': 'GND' });
  b.add(FP.npn(), { ref: 'VT1', value: 'BC547' }, { B: 'BASE', C: 'COIL', E: 'GND' });
  b.add(FP.relay(), { ref: 'K1', value: 'SRD-12VDC' }, { COIL1: '+12V', COIL2: 'COIL', COM: '+12V', NO: 'LAMP', NC: 'IDLE' });
  b.add(FP.powerDiode(), { ref: 'VD1', value: '1N4007' }, { A: 'COIL', K: '+12V' });
  b.add(FP.terminal2(), { ref: 'EL1', value: 'Лампа 12 В 5 Вт', sim: { model: 'lamp' } }, { '1': 'LAMP', '2': 'GND' });
  b.add(FP.resistor(), { ref: 'R3', value: '2,2 кОм' }, { '1': 'IDLE', '2': 'LED_A' });
  b.add(FP.led(), { ref: 'LED1', value: 'зелёный' }, { A: 'LED_A', K: 'GND' });
  return b.done('Кнопка SB1 открывает транзистор VT1, реле K1 срабатывает через несколько миллисекунд (индуктивность катушки), контакты переключают лампу EL1 и светодиод LED1 «ожидание». Диод VD1 гасит выброс на катушке — попробуйте в свойствах VD1 поставить модель «не участвует в расчёте» и посмотреть напряжение COIL на осциллографе.');
}

/** Бегущие огни: 555 даёт такты, CD4017 зажигает светодиоды по очереди. */
export function exampleRunningLights(): Project {
  const b = new Builder('Бегущие огни на CD4017', 120, 80);
  b.add(FP.terminal2(), { ref: 'GB1', value: '9 В', sim: { model: 'battery' } }, { '1': 'VCC', '2': 'GND' });
  b.add(FP.ne555(), { ref: 'U1', value: 'NE555' }, { VCC: 'VCC', RST: 'VCC', GND: 'GND', DIS: 'DIS', THR: 'TIM', TRIG: 'TIM', CTRL: 'CTRL', OUT: 'CLK' });
  b.add(FP.resistor(), { ref: 'R1', value: '10 кОм' }, { '1': 'VCC', '2': 'DIS' });
  b.add(FP.resistor(), { ref: 'R2', value: '68 кОм' }, { '1': 'DIS', '2': 'TIM' });
  b.add(FP.electrolytic(), { ref: 'C1', value: '1 мкФ × 16 В' }, { '1': 'TIM', '2': 'GND' });
  b.add(FP.ceramic(), { ref: 'C2', value: '10 нФ' }, { '1': 'CTRL', '2': 'GND' });
  b.add(FP.cd4017(), { ref: 'U2', value: 'CD4017' }, { VDD: 'VCC', VSS: 'GND', CLK: 'CLK', CE: 'GND', RST: 'GND', Q0: 'Q0', Q1: 'Q1', Q2: 'Q2', Q3: 'Q3', Q4: 'Q4', Q5: 'Q5' });
  for (let i = 0; i < 6; i++) b.add(FP.led(), { ref: `LED${i + 1}`, value: i % 2 ? 'зелёный' : 'красный' }, { A: `Q${i}`, K: 'LED_K' });
  b.add(FP.resistor(), { ref: 'R3', value: '470 Ом' }, { '1': 'LED_K', '2': 'GND' });
  return b.done('Таймер 555 выдаёт такты ≈ 10 Гц, счётчик CD4017 по каждому фронту зажигает следующий светодиод. Ползунком R2 или C1 на вкладке «Цепь» меняется скорость бега.');
}

export const SIM_EXAMPLES: { id: string; name: string; description: string; size: [number, number]; create: () => Project }[] = [
  { id: 'sim-555-blink', name: 'Мигалка на NE555', description: 'Симуляция без контроллера: таймер 555, светодиод, выключатель', size: [90, 60], create: example555Blink },
  { id: 'sim-psu-12v', name: 'Блок питания 12 В', description: 'Сеть 230 В, трансформатор, мост, 7812, нагрузка, предохранитель', size: [110, 70], create: examplePsu12 },
  { id: 'sim-motor-pwm', name: 'ШИМ-регулятор двигателя', description: '555 + MOSFET + двигатель: скорость потенциометром', size: [110, 70], create: exampleMotorPwm },
  { id: 'sim-relay', name: 'Реле с кнопкой', description: 'Транзисторный ключ, реле, лампа, диод на катушке', size: [100, 60], create: exampleRelay },
  { id: 'sim-running-lights', name: 'Бегущие огни', description: '555 + CD4017 + 6 светодиодов', size: [120, 80], create: exampleRunningLights },
];
