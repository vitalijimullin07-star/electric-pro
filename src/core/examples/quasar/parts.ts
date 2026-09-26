import { libraryFootprint } from '../../library';
import type { FootprintDef, PadDef } from '../../model/types';

/*
 * Детали платы «Квазар AVR» DesAlex: координаты площадок (мм от левого верхнего угла
 * платы, как на сборочном чертеже), назначение выводов, номиналы. Позиционные
 * обозначения — как на схеме Andy_F; где DesAlex поставил другую деталь, номинал
 * и описание — по его плате (звёздочка — подбирается при настройке).
 */

export interface QuasarPart {
  ref: string;
  value: string;
  description?: string;
  kind: 'R' | 'C' | 'CP' | 'L' | 'D' | 'Q' | 'U' | 'Y' | 'X' | 'H';
  fpName: string;
  fpId?: string;
  tags?: string[];
  /** x, y, имя вывода, номер вывода (по умолчанию — порядковый). */
  pads: [number, number, string?, string?][];
  body?: { x0: number; y0: number; x1: number; y1: number };
  offBoard?: { footprint: FootprintDef; nets: Record<string, string> };
}

const two = (ref: string, value: string, kind: QuasarPart['kind'], fpName: string, a: [number, number], b: [number, number], o: Partial<QuasarPart> = {}): QuasarPart => ({ ref, value, kind, fpName, pads: [[...a], [...b]], ...o });

/** ATmega32A в DIP-40: выемка слева, 1-й вывод внизу слева. */
const MEGA32 = ['PB0', 'PB1', 'PB2', 'PB3', 'PB4', 'PB5', 'PB6', 'PB7', 'RESET', 'VCC', 'GND', 'XTAL2', 'XTAL1', 'PD0', 'PD1', 'PD2', 'PD3', 'PD4', 'PD5', 'PD6', 'PD7', 'PC0', 'PC1', 'PC2', 'PC3', 'PC4', 'PC5', 'PC6', 'PC7', 'AVCC', 'GND', 'AREF', 'PA7', 'PA6', 'PA5', 'PA4', 'PA3', 'PA2', 'PA1', 'PA0'];
const dip40: QuasarPart['pads'] = MEGA32.map((name, i) => (i < 20 ? [12.7 + i * 2.54, 24.13, name, String(i + 1)] : [60.96 - (i - 20) * 2.54, 8.89, name, String(i + 1)]));

/** DIP-8, выемка снизу: 1-й вывод внизу справа, 1–4 вверх по правому ряду, 5–8 вниз по левому. */
const dip8 = (xl: number, xr: number, yTop: number, names: string[]): QuasarPart['pads'] => names.map((n, i) => (i < 4 ? [xr, yTop + (3 - i) * 2.54, n, String(i + 1)] : [xl, yTop + (i - 4) * 2.54, n, String(i + 1)]));

const R = (ref: string, value: string, a: [number, number], b: [number, number], o: Partial<QuasarPart> = {}) => two(ref, value, 'R', 'Резистор', a, b, { tags: ['resistor'], ...o });
const C = (ref: string, value: string, a: [number, number], b: [number, number], o: Partial<QuasarPart> = {}) => two(ref, value, 'C', 'Конденсатор', a, b, { tags: ['capacitor'], ...o });
/** Электролит: первый — «+». */
const CP = (ref: string, value: string, plus: [number, number], minus: [number, number], o: Partial<QuasarPart> = {}): QuasarPart => ({ ref, value, kind: 'CP', fpName: 'Электролит', tags: ['capacitor', 'cp', 'polar'], pads: [[...plus, '+', '1'], [...minus, '-', '2']], ...o });
/** Диод: первый — катод. */
const D = (ref: string, value: string, k: [number, number], a: [number, number], o: Partial<QuasarPart> = {}): QuasarPart => ({ ref, value, kind: 'D', fpName: 'Диод', tags: ['diode'], pads: [[...k, 'K', '1'], [...a, 'A', '2']], ...o });

export const QUASAR_PARTS: QuasarPart[] = [
  // --- контроллер ---
  { ref: 'U5', value: 'ATmega32A-PU', description: 'Микроконтроллер ATmega32A, DIP-40', kind: 'U', fpName: 'ATmega32A (DIP-40)', fpId: 'ATmega32_DIP40', tags: ['atmega32', 'avr', 'mcu'], pads: dip40, body: { x0: -25, y0: -6.5, x1: 25, y1: 6.5 } },
  { ref: 'BQ1', value: '11,0592 МГц', description: 'Кварц 11,0592 МГц', kind: 'Y', fpName: 'Кварц HC-49', tags: ['crystal'], pads: [[35.56, 27.94], [40.4, 27.94]] },
  C('C18', '22 пФ', [38.16, 34.32], [38.16, 39.32]),
  C('C21', '22 пФ', [40.7, 34.32], [40.7, 39.32]),
  two('L2', '100 мкГн', 'L', 'Дроссель', [15.24, 3.81], [25.4, 3.81], { description: 'Фильтр питания АЦП (AVCC)', tags: ['inductor'] }),
  C('C19', '100 нФ', [17.89, 6.37], [22.89, 6.37]),
  C('C27', '100 нФ', [33.12, 6.37], [38.12, 6.37]),
  // --- провода к дисплею, кнопкам, динамику, катушке, питанию ---
  { ref: 'X2', value: 'К дисплею', description: 'Площадки под провода к ЖК 1602: данные D4–D7, E, RS и подсветка', kind: 'X', fpName: 'Провода к ЖК (8 шт.)', tags: ['wires'], pads: [[40.64, 6.35, 'D7'], [43.18, 6.35, 'D6'], [45.72, 6.35, 'D5'], [48.26, 6.35, 'D4'], [50.8, 6.35, 'E'], [53.34, 6.35, 'RS'], [55.88, 6.35, 'LIGHT+'], [58.42, 6.35, 'LIGHT-']] },
  { ref: 'X7', value: '+5 В ЖК', description: 'Провод питания ЖК', kind: 'X', fpName: 'Площадка под провод', tags: ['wires'], pads: [[15.24, 6.35, '+5V']] },
  { ref: 'X8', value: 'GND ЖК', description: 'Общий провод ЖК', kind: 'X', fpName: 'Площадка под провод', tags: ['wires'], pads: [[29.21, 6.35, 'GND']] },
  { ref: 'X3', value: 'К кнопкам', description: 'Провода к клавиатуре: линии B1 и B2', kind: 'X', fpName: 'Провода к кнопкам (2 шт.)', tags: ['wires'], pads: [[64.77, 13.97, 'B1'], [64.77, 10.16, 'B2']] },
  { ref: 'X9', value: 'К кнопкам', description: 'Провод к клавиатуре: линия B3', kind: 'X', fpName: 'Площадка под провод', tags: ['wires'], pads: [[64.77, 22.86, 'B3']] },
  { ref: 'X4', value: 'К динамику', kind: 'X', fpName: 'Провода к динамику', tags: ['wires'], pads: [[80.01, 8.89, 'SP1'], [85.09, 8.89, 'SP2']] },
  { ref: 'X5', value: 'К катушке TX', kind: 'X', fpName: 'Провода к катушке TX', tags: ['wires'], pads: [[20.32, 45.72, 'TX1'], [17.78, 49.53, 'TX2']] },
  { ref: 'X6', value: 'К катушке RX', kind: 'X', fpName: 'Провода к катушке RX', tags: ['wires'], pads: [[73.66, 45.72, 'RX1'], [71.12, 49.53, 'RX2']] },
  { ref: 'X1', value: '+ аккумулятора', description: 'Провод от плюса аккумулятора', kind: 'X', fpName: 'Площадка под провод', tags: ['wires'], pads: [[7.62, 50.8, '+BAT']] },
  { ref: 'X10', value: '− аккумулятора', description: 'Провод от минуса аккумулятора', kind: 'X', fpName: 'Площадка под провод', tags: ['wires'], pads: [[8.89, 46.99, '-BAT']] },
  // --- питание ---
  { ref: 'U7', value: 'L4940V5', description: 'Стабилизатор 5 В (у Andy_F — LM2941S), питание цифровой части', kind: 'U', fpName: 'TO-220 стоя', tags: ['regulator'], pads: [[6.35, 33.02, 'IN', '1'], [8.89, 30.48, 'GND', '2'], [6.35, 27.94, 'OUT', '3']] },
  { ref: 'U3', value: 'LM2931Z-5.0', description: 'Стабилизатор 5 В (у Andy_F — LP2950), питание аналоговой части VDD', kind: 'U', fpName: 'TO-92', tags: ['regulator'], pads: [[82.55, 35.56, 'OUT', '1'], [85.09, 38.1, 'GND', '2'], [82.55, 40.64, 'IN', '3']] },
  C('C22', '470 нФ', [3.83, 28.02], [3.83, 33.02]),
  C('C16', '10 нФ', [3.81, 20.32], [10.16, 20.32]),
  C('C9', '100 нФ', [3.88, 24.16], [8.88, 24.16]),
  C('C23', '10 нФ', [6.41, 36.86], [11.41, 36.86]),
  CP('C14', '2200 мкФ × 10 В', [17.05, 33.56], [17.05, 37.56]),
  CP('C13', '1500 мкФ × 10 В', [14.51, 42.45], [14.51, 46.45]),
  CP('C11', '2200 мкФ × 10 В', [81.09, 30.48], [85.09, 30.48]),
  CP('C34', '1000 мкФ × 16 В', [85.09, 46.99], [80.01, 46.99]),
  C('C1', '100 нФ', [76.22, 39.45], [76.22, 44.45]),
  R('R29', '4,3 кОм*', [3.81, 36.83], [3.81, 46.99], { description: 'Делитель напряжения аккумулятора (у Andy_F — 10 кОм)' }),
  R('R18', '1,1 кОм', [6.35, 39.37], [6.35, 46.99]),
  // --- передатчик ---
  R('R9', '1,8 Ом*', [6.35, 3.81], [6.35, 13.97], { description: 'Датчик тока передатчика (у Andy_F — 1 Ом)' }),
  R('R10', '10 кОм', [8.89, 3.81], [8.89, 13.97]),
  R('R15', '100 кОм', [11.43, 29.21], [21.59, 29.21]),
  R('R12', '68 Ом', [17.78, 26.67], [25.4, 26.67]),
  D('D4', '1N4148', [24.13, 31.75], [29.21, 31.75]),
  R('R14', '1 кОм', [22.86, 34.29], [30.48, 34.29]),
  R('R13', '1 кОм', [25.4, 36.83], [33.02, 36.83]),
  D('D3', '1N4148', [29.21, 39.37], [34.29, 39.37]),
  { ref: 'Q1B', value: 'IRF9640', description: 'P-канальный MOSFET — верхний ключ передатчика', kind: 'Q', fpName: 'TO-220 лёжа', tags: ['p-mosfet', 'pmos'], pads: [[27.94, 41.91, 'G', '1'], [25.4, 44.45, 'D', '2'], [22.86, 41.91, 'S', '3']] },
  { ref: 'Q1A', value: 'IRF840', description: 'N-канальный MOSFET — нижний ключ передатчика', kind: 'Q', fpName: 'TO-220 лёжа', tags: ['n-mosfet', 'nmos'], pads: [[35.56, 41.91, 'G', '1'], [38.1, 44.45, 'D', '2'], [40.64, 41.91, 'S', '3']] },
  C('C6', '0,47 мкФ*', [22.96, 47.01], [27.96, 47.01], { description: 'Резонансный конденсатор катушки TX (подбирается под частоту)' }),
  R('R3', '10 Ом*', [30.48, 46.99], [40.64, 46.99], { description: 'Ограничение тока передатчика (подбирается)' }),
  // --- приёмник ---
  C('C2', '33 нФ', [59.71, 44.53], [59.71, 49.53]),
  R('R1', '100 Ом', [73.66, 34.29], [73.66, 41.91]),
  D('D1', '1N4148', [76.2, 29.21], [76.2, 34.29]),
  R('R2', '2 кОм', [71.12, 26.67], [71.12, 34.29]),
  R('R6', '1,2 кОм', [68.58, 21.59], [68.58, 29.21]),
  { ref: 'U2', value: 'TL431', description: 'Опорное напряжение 2,5 В для средней точки приёмника', kind: 'U', fpName: 'TO-92', tags: ['tl431'], pads: [[76.2, 24.13, 'A', '2'], [73.66, 26.67, 'REF', '1'], [78.74, 26.67, 'K', '3']] },
  { ref: 'U8', value: 'MCP601', description: 'Операционный усилитель приёмника (у Andy_F — MCP633)', kind: 'U', fpName: 'DIP-8', tags: ['opamp'], pads: dip8(60.96, 68.58, 31.75, ['NC', 'IN-', 'IN+', 'VSS', 'NC', 'OUT', 'VDD', 'NC']) },
  R('R4', '470 Ом', [60.96, 41.91], [71.12, 41.91]),
  R('R7', '47 кОм*', [63.5, 44.45], [71.12, 44.45], { description: 'Обратная связь ОУ — задаёт усиление приёмника' }),
  C('C10', '47 пФ', [63.61, 47.01], [68.61, 47.01]),
  R('R5', '4,7 кОм', [55.88, 31.75], [55.88, 39.37]),
  two('L1', '100 мкГн', 'L', 'Дроссель', [45.72, 40.64], [53.34, 40.64], { tags: ['inductor'] }),
  C('C15', '100 нФ', [45.74, 44.53], [45.74, 49.53]),
  C('C7', '2,2 нФ', [49.55, 44.49], [49.55, 49.49]),
  C('C8', '1 мкФ', [53.36, 44.53], [53.36, 49.53]),
  { ref: 'U4', value: 'MCP3201', description: '12-битный АЦП приёмника, SPI', kind: 'U', fpName: 'DIP-8', tags: ['adc', 'mcp3201'], pads: dip8(45.72, 53.34, 29.21, ['VREF', 'IN+', 'IN-', 'VSS', 'CS', 'DOUT', 'CLK', 'VDD']) },
  R('R8', '330 Ом', [33.02, 31.75], [43.18, 31.75]),
  // --- подсветка ---
  R('R22', '1,5 кОм', [60.96, 6.35], [68.58, 6.35]),
  { ref: 'Q4', value: 'C945', description: 'NPN — ключ подсветки дисплея (у Andy_F — BC846)', kind: 'Q', fpName: 'TO-92 треугольником', tags: ['npn'], pads: [[71.12, 6.35, 'B', '3'], [73.66, 3.81, 'C', '2'], [76.2, 6.35, 'E', '1']] },
  R('R26', '47 Ом', [77.47, 3.81], [87.63, 3.81], { description: 'Ток подсветки дисплея (у Andy_F — два по 25 Ом)' }),
  // --- звук ---
  R('R21', '10 кОм', [64.77, 19.05], [72.39, 19.05]),
  { ref: 'Q2', value: 'C945', description: 'NPN — управление звуком (у Andy_F — BC846)', kind: 'Q', fpName: 'TO-92 треугольником', tags: ['npn'], pads: [[72.39, 21.59, 'B', '3'], [74.93, 19.05, 'C', '2'], [77.47, 21.59, 'E', '1']] },
  R('R25', '10 кОм', [80.01, 19.05], [87.63, 19.05]),
  { ref: 'Q3', value: 'A733', description: 'PNP — ключ динамика (у Andy_F — BC857)', kind: 'Q', fpName: 'TO-92 треугольником', tags: ['pnp'], pads: [[77.47, 19.05, 'B', '3'], [80.01, 16.51, 'C', '2'], [77.47, 13.97, 'E', '1']] },
  R('R24', '100 Ом', [77.47, 11.43], [87.63, 11.43]),
  D('D6', '1N4148', [80.01, 13.97], [85.09, 13.97]),
  CP('C33', '1000 мкФ × 16 В', [73.66, 12.7], [68.58, 12.7]),
  C('C32', '100 нФ', [82.59, 24.14], [87.59, 24.14]),
  // --- крепёж ---
  { ref: 'H1', value: 'M2', kind: 'H', fpName: 'Отверстие Ø2,2', tags: ['hole'], pads: [[45.72, 2.54]] },
  { ref: 'H2', value: 'M2', kind: 'H', fpName: 'Отверстие Ø2,2', tags: ['hole'], pads: [[2.54, 50.8]] },
  { ref: 'H3', value: 'M2', kind: 'H', fpName: 'Отверстие Ø2,2', tags: ['hole'], pads: [[87.63, 50.8]] },
];

/* ---------------- имена цепей (как на схеме Andy_F) ---------------- */

/** Вывод детали → имя его цепи. */
export const QUASAR_NET_NAMES: Record<string, string> = {
  'U5.11': 'GND',
  'U5.10': '+5V',
  'U3.1': 'VDD',
  'U7.1': '+BATT',
  'U5.30': 'AVCC',
  'U5.40': 'ADC-',
  'U5.37': 'UCTRL',
  'U5.9': 'RESET',
  'U5.12': 'XTAL2',
  'U5.13': 'XTAL1',
  'U5.1': 'TXO',
  'D4.2': 'TX_DRV',
  'Q1A.1': 'GATE_N',
  'Q1B.1': 'GATE_P',
  'Q1A.2': 'TX_OUT',
  'R3.1': 'TX_R',
  'X5.1': 'TX_C1',
  'X6.1': 'RX_C1',
  'R1.2': 'RX_IN',
  'U8.3': 'OA_IN+',
  'U8.2': 'OA_IN-',
  'R4.1': 'OA_FB',
  'U8.6': 'OA_OUT',
  'U4.2': 'ADC_IN',
  'U4.1': 'ADC_REF',
  'U2.3': 'REF_2V5',
  'U5.8': 'SCK',
  'U5.7': 'MISO',
  'U4.6': 'DOUT',
  'U5.14': 'CS',
  'U5.18': 'SOUND',
  'Q2.3': 'Q2_B',
  'Q3.3': 'Q3_B',
  'Q3.1': 'SND_PWR',
  'Q3.2': 'SP+',
  'U5.21': 'LIGHT',
  'Q4.3': 'Q4_B',
  'Q4.2': 'LIGHT-',
  'X2.7': 'LIGHT+',
  'U5.24': 'LCD_RS',
  'U5.25': 'LCD_E',
  'U5.26': 'LCD_D4',
  'U5.27': 'LCD_D5',
  'U5.28': 'LCD_D6',
  'U5.29': 'LCD_D7',
  'U5.23': 'B1',
  'U5.22': 'B2',
  'U5.20': 'B3',
};

/* ---------------- выносные детали ---------------- */

const lib = (id: string): FootprintDef => {
  const f = libraryFootprint(id);
  if (!f) throw new Error(`нет корпуса ${id}`);
  return f;
};

const wirePad = (number: string, name: string, x: number, y: number): PadDef => ({ number, name, type: 'tht', shape: number === '1' ? 'rect' : 'circle', at: { x, y }, size: { x: 2.2, y: 2.2 }, drill: 1.0 });

/** Датчик DD: две катушки в одном корпусе, выводы — провода к плате. */
const COIL_DD: FootprintDef = {
  id: 'Coil_DD_230mm',
  name: 'Катушка DD Ø230',
  description: 'Датчик металлоискателя DD Ø230 мм: TX — 40–45 витков провода 0,5 мм, RX — 200 витков провода 0,2 мм (выводы — провода к плате)',
  category: 'Датчики',
  group: 'Металлоискатель',
  refPrefix: 'L',
  tags: ['dd-coil', 'metal-detector', 'quasar'],
  pads: [wirePad('1', 'TX1', -3.81, 0), wirePad('2', 'TX2', -1.27, 0), wirePad('3', 'RX1', 1.27, 0), wirePad('4', 'RX2', 3.81, 0)],
  graphics: [
    { kind: 'circle', layer: 'F.Fab', c: { x: 0, y: 12 }, r: 10, width: 0.15 },
    { kind: 'arc', layer: 'F.Fab', c: { x: -3, y: 12 }, r: 7, start: 90, sweep: 180, width: 0.15 },
    { kind: 'arc', layer: 'F.Fab', c: { x: 3, y: 12 }, r: 7, start: 270, sweep: 180, width: 0.15 },
  ],
  courtyard: { min: { x: -10.5, y: -1.5 }, max: { x: 10.5, y: 22.5 } },
  verified: false,
};

/** Аккумулятор на проводах. */
const BATTERY: FootprintDef = {
  id: 'Battery_Pack_Wires',
  name: 'Аккумулятор на проводах',
  description: 'Аккумулятор или батарейный отсек, выводы — провода к плате',
  category: 'Разъёмы',
  group: 'Батареи',
  refPrefix: 'GB',
  tags: ['battery'],
  pads: [wirePad('1', '+', -2.54, 0), wirePad('2', '-', 2.54, 0)],
  graphics: [{ kind: 'rect', layer: 'F.Fab', a: { x: -8, y: 2 }, b: { x: 8, y: 12 }, width: 0.15 }],
  courtyard: { min: { x: -8.5, y: -1.5 }, max: { x: 8.5, y: 12.5 } },
  verified: false,
};

const off = (ref: string, value: string, fp: FootprintDef, nets: Record<string, string>, description?: string): QuasarPart => ({ ref, value, description, kind: 'X', fpName: fp.name, pads: [], offBoard: { footprint: fp, nets } });

/**
 * Клавиатура Andy_F: 6 кнопок на трёх линиях. Кнопка соединяет свою линию B с общей
 * точкой COL_L или COL_R, а те через диоды подключены к двум другим линиям — так
 * контроллер по очереди опрашивает линии и отличает все шесть кнопок.
 */
const button = (ref: string, line: string, col: string, what: string) => off(ref, 'Кнопка', lib('SW_PUSH_6mm_2pin'), { '1': line, '2': col }, what);
const diode = (ref: string, a: string, k: string) => off(ref, '1N4148', lib('D_DO-35_P2.54mm_Vertical'), { '2': a, '1': k }, 'Диод клавиатуры');

export const QUASAR_OFFBOARD: QuasarPart[] = [
  off('HG1', 'LCD 1602', lib('Module_LCD1602'), { '1': 'GND', '2': '+5V', '3': 'GND', '4': 'LCD_RS', '5': 'GND', '6': 'LCD_E', '11': 'LCD_D4', '12': 'LCD_D5', '13': 'LCD_D6', '14': 'LCD_D7', '15': 'LIGHT+', '16': 'LIGHT-' }, 'Символьный ЖК 16×2 на HD44780, подключён по 4 проводам данных; RW и V0 — на общий провод'),
  button('SW1', 'B2', 'COL_L', 'Плюс (вверх)'),
  button('SW2', 'B2', 'COL_R', 'Громкость'),
  button('SW3', 'B3', 'COL_R', 'Пинпоинт (держать)'),
  button('SW4', 'B3', 'COL_L', 'Подсветка'),
  button('SW5', 'B1', 'COL_L', 'Меню'),
  button('SW6', 'B1', 'COL_R', 'Минус (вниз)'),
  diode('VD1', 'B2', 'COL_L'),
  diode('VD2', 'B3', 'COL_L'),
  diode('VD3', 'B3', 'COL_R'),
  diode('VD4', 'B1', 'COL_R'),
  off('BA1', 'Динамик 8 Ом', lib('Speaker_D40mm_Wires'), { '1': 'SP+', '2': 'GND' }, 'Динамик или наушники'),
  off('GB1', '12 В', BATTERY, { '1': '+BATT', '2': 'GND' }, 'Аккумулятор 12 В (8 элементов NiMH или 3 Li-ion)'),
  off('L3', 'DD Ø230', COIL_DD, { '1': 'TX_C1', '2': 'GND', '3': 'RX_C1', '4': 'GND' }, 'Катушка DD: TX в последовательном резонансе с C6, RX — в параллельном с C35, настроена на 1,5–2 кГц ниже TX'),
  off('C35', '33 нФ', lib('C_Disc_D5mm_W2.5mm_P2.5mm'), { '1': 'RX_C1', '2': 'GND' }, 'Конденсатор контура RX — на выводах катушки'),
];
