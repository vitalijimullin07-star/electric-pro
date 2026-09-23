import type { LegacyBoard, LegacyComp, LegacyPin } from '../../io/legacy-plata';
import routing from './routing.json';

/*
 * Плата контроллера самодельного строительного пылесоса — первая плата Plata,
 * перенесённая из старого формата (единицы 0,254 мм, один слой меди).
 * ESP32, две турбины через MOC3021 и BTA41, датчики давления, тока и температуры,
 * два блока питания HLK-PM01, зона 230 В.
 */

const row = (a: (string | [string, string])[], side: 't' | 'b' = 't', pitch = 10): LegacyPin[] =>
  a.map((s, i) => {
    const [id, t] = Array.isArray(s) ? s : [s, s];
    return { id, t, dx: i * pitch, dy: 0, side, i };
  });
const col = (a: (string | [string, string])[]): LegacyPin[] =>
  a.map((s, i) => {
    const [id, t] = Array.isArray(s) ? s : [s, s];
    return { id, t, dx: 0, dy: i * 10, side: 'r', i: 0 };
  });

const EL: (string | [string, string])[] = ['EN', 'VP', 'VN', 'D34', 'D35', 'D32', 'D33', 'D25', 'D26', 'D27', 'D14', 'D12', 'D13', ['GNDL', 'GND'], 'VIN'];
const ER: (string | [string, string])[] = ['D23', 'D22', 'TX0', 'RX0', 'D21', 'D19', 'D18', 'D5', 'TX2', 'RX2', 'D4', 'D2', 'D15', ['GNDR', 'GND'], '3V3'];
const espPins: LegacyPin[] = [
  ...EL.map((s, i): LegacyPin => {
    const [id, t] = Array.isArray(s) ? s : [s, s];
    return { id, t, dx: 0, dy: i * 10, side: 'r', i };
  }),
  ...ER.map((s, i): LegacyPin => {
    const [id, t] = Array.isArray(s) ? s : [s, s];
    return { id, t, dx: 100, dy: i * 10, side: 'l', i };
  }),
];
const mocPins: LegacyPin[] = [
  { id: '1', t: '1', dx: 0, dy: 0, side: 'b', i: 0 },
  { id: '2', t: '2', dx: 10, dy: 0, side: 'b', i: 0 },
  { id: '3', t: '3', dx: 20, dy: 0, side: 'b', i: 0 },
  { id: '6', t: '6', dx: 0, dy: 30, side: 't', i: 0 },
  { id: '5', t: '5', dx: 10, dy: 30, side: 't', i: 0 },
  { id: '4', t: '4', dx: 20, dy: 30, side: 't', i: 0 },
];
const hlkPins: LegacyPin[] = [
  { id: '+Vo', t: '+Vo', dx: 0, dy: 0, side: 'b', i: 0 },
  { id: '-Vo', t: '−Vo', dx: 40, dy: 0, side: 'b', i: 0 },
  { id: 'ACL', t: 'AC L', dx: 0, dy: 115, side: 't', i: 0 },
  { id: 'ACN', t: 'AC N', dx: 40, dy: 115, side: 't', i: 0 },
];

const comps: LegacyComp[] = [];
const comp = (ref: string, name: string, short: string, x: number, y: number, o: Partial<LegacyComp> = {}) =>
  comps.push({ ref, name, short, x, y, kind: 'mod', pad: 'hdr', ...o });
const pass = (ref: string, name: string, x: number, y: number, fp: string, val: string, o: { alt?: string[]; pol?: [string, string] } = {}) =>
  comps.push({ ref, name, short: ref, x, y, kind: 'pass', fp, val, alt: o.alt, pol: o.pol });
const RA = ['r1206', 'rTH'];

comp('U1', 'ESP32 DevKit, 30 ножек', 'ESP32', 400, 150, { pins: espPins, lib: 'Module_ESP32_DevKit_30pin' });
comp('M1', 'Модуль ADS1115 (АЦП)', 'ADS1115', 430, 50, { pins: row(['VDD', 'GND', 'SCL', 'SDA', 'ADDR', 'ALRT', 'A0', 'A1', 'A2', 'A3']), lib: 'Module_ADS1115' });
comp('M2', 'Модуль DS3231 (часы)', 'DS3231', 560, 50, { pins: row(['32K', 'SQW', 'SCL', 'SDA', 'VCC', 'GND']), lib: 'Module_DS3231' });
comp('J2', 'Разъём SDP810-500Pa (перепад фильтра)', 'SDP 500', 650, 50, { pins: row(['VDD', 'GND', 'SCL', 'SDA']) });
comp('J4', 'Разъём MPX5100DP (разрежение)', 'MPX', 720, 50, { pins: row(['VS', 'GND', 'VOUT']) });
pass('R9', 'Резистор 10k (делитель MPX)', 560, 100, 'r1206', '10k', { alt: RA });
pass('R10', 'Резистор 18k (делитель MPX)', 560, 125, 'r1206', '18k', { alt: RA });
pass('R11', 'Резистор 4.7k (подтяжка SDA1)', 540, 150, 'r1206', '4.7k', { alt: RA });
pass('R12', 'Резистор 4.7k (подтяжка SCL1)', 540, 175, 'r1206', '4.7k', { alt: RA });
comp('M3', 'Модуль MAX31855, термопара Т1', 'MAX Т1', 620, 160, { pins: row(['GND', 'VCC', 'SCK', 'CS', 'SO']), lib: 'Module_MAX31855' });
comp('M4', 'Модуль MAX31855, термопара Т2', 'MAX Т2', 710, 160, { pins: row(['GND', 'VCC', 'SCK', 'CS', 'SO']), lib: 'Module_MAX31855' });
comp('J8', 'Разъём дисплея (питание + UART)', 'Дисплей', 620, 230, { pins: row([['5VD', '+5V'], 'GND', ['TXD', 'TX'], ['RXD', 'RX']]) });
pass('R22', 'Резистор 1k (база зуммера)', 540, 265, 'r1206', '1k', { alt: RA });
comp('Q1', 'Транзистор S8050 (NPN), TO-92', 'S8050', 620, 280, { pins: row(['E', 'B', 'C'], 'b'), pad: 'to92', lib: 'TO-92_Inline_Wide' });
pass('BZ1', 'Зуммер активный 5 В', 700, 280, 'buz', '', { pol: ['+', '-'] });
comp('J1', 'Разъём диммера RobotDyn', 'Диммер', 620, 330, { pins: row(['VCC', 'GND', 'ZC', 'CH1', 'CH2', 'CH3', 'CH4']) });
pass('C3', 'Конденсатор 470 мкФ 16 В (питание дисплея)', 580, 330, 'elec', '470µ', { pol: ['+', '-'] });
comp('J5', 'Разъём ACS712 турбины 1', 'ACS Т1', 40, 40, { pins: col(['VCC', 'GND', 'OUT']) });
comp('J6', 'Разъём ACS712 турбины 2', 'ACS Т2', 40, 95, { pins: col(['VCC', 'GND', 'OUT']) });
comp('J7', 'Разъём rbAmp (ток розетки)', 'Ток роз.', 40, 150, { pins: col(['VCC', 'GND', 'OUT']) });
comp('J3', 'Разъём SDP810-125Pa (расход)', 'SDP 125', 40, 205, { pins: col(['VDD', 'GND', 'SCL', 'SDA']) });
comp('J9', 'Разъём кнопок панели', 'Кнопки', 40, 270, { pins: col(['K1', 'K2', 'K3', 'K4', 'K5', 'K6', 'GND']) });
comp('J10', 'Разъём SSR розетки', 'SSR', 40, 365, { pins: col([['+', '+'], ['-', '−']]) });
pass('R5', 'Резистор 10k (делитель ACS Т1)', 110, 45, 'r1206', '10k', { alt: RA });
pass('R6', 'Резистор 18k (делитель ACS Т1)', 110, 70, 'r1206', '18k', { alt: RA });
pass('R7', 'Резистор 10k (делитель ACS Т2)', 110, 100, 'r1206', '10k', { alt: RA });
pass('R8', 'Резистор 18k (делитель ACS Т2)', 110, 125, 'r1206', '18k', { alt: RA });
pass('R13', 'Резистор 4.7k (подтяжка SDA2)', 110, 180, 'r1206', '4.7k', { alt: RA });
pass('R14', 'Резистор 4.7k (подтяжка SCL2)', 110, 205, 'r1206', '4.7k', { alt: RA });
(
  [
    ['R16', '100'],
    ['R17', '1k'],
    ['R18', '2.2k'],
    ['R19', '3.9k'],
    ['R20', '6.8k'],
    ['R21', '15k'],
  ] as [string, string][]
).forEach(([r, v], i) => pass(r, 'Резистор ' + v + ' (лестница кнопок)', 110, 235 + i * 25, 'r1206', v, { alt: RA }));
pass('R15', 'Резистор 10k (подтяжка кнопок)', 200, 190, 'r1206', '10k', { alt: RA });
pass('C2', 'Конденсатор 100 нФ (фильтр кнопок)', 200, 215, 'c1206', '100n', { alt: ['c1206', 'cTH'] });
pass('R1', 'Резистор 150 Ом (оптрон Т1)', 270, 345, 'r1206', '150', { alt: RA });
pass('R2', 'Резистор 150 Ом (оптрон Т2)', 330, 345, 'r1206', '150', { alt: RA });
pass('C1', 'Конденсатор 470 мкФ 16 В (питание 5 В)', 440, 330, 'elec', '470µ', { pol: ['+', '-'] });
comp('U2', 'Оптрон MOC3021, турбина 1', 'MOC Т1', 260, 380, { pins: mocPins, lib: 'DIP-6_W7.62mm' });
comp('U3', 'Оптрон MOC3021, турбина 2', 'MOC Т2', 330, 380, { pins: mocPins, lib: 'DIP-6_W7.62mm' });
comp('M5', 'Блок питания HLK-PM01 (логика)', 'HLK логика', 440, 360, { pins: hlkPins, pad: 'hlk', lib: 'Module_HLK-PM01' });
comp('M6', 'Блок питания HLK-PM01 (дисплей)', 'HLK дисплей', 560, 360, { pins: hlkPins, pad: 'hlk', lib: 'Module_HLK-PM01' });
pass('R3', 'Резистор 330 Ом 1 Вт (затвор Т1)', 220, 455, 'r1W', '330 1Вт');
pass('R4', 'Резистор 330 Ом 1 Вт (затвор Т2)', 320, 455, 'r1W', '330 1Вт');
comp('J11', 'Клеммник к BTA41 турбины 1', 'BTA Т1', 250, 500, { pins: row(['MT2', 'G'], 't', 20), pad: 'term', lib: 'TerminalBlock_1x02_P5.08mm' });
comp('J12', 'Клеммник к BTA41 турбины 2', 'BTA Т2', 330, 500, { pins: row(['MT2', 'G'], 't', 20), pad: 'term', lib: 'TerminalBlock_1x02_P5.08mm' });
pass('F1', 'Предохранитель 0,5 А, БП логики', 650, 410, 'fuse', '0,5А');
pass('F2', 'Предохранитель 0,5 А, БП дисплея', 650, 445, 'fuse', '0,5А');
pass('RV1', 'Варистор 14D471K, БП логики', 650, 485, 'varist', '471');
pass('RV2', 'Варистор 14D471K, БП дисплея', 710, 485, 'varist', '471');
comp('J13', 'Клеммник сети 230 В', 'Сеть', 770, 470, { pins: row(['L', 'N'], 't', 20), pad: 'term', lib: 'TerminalBlock_1x02_P5.08mm' });

const nets: [string, string, string, 'm'?][] = [
  ['3V3', 'Питание 3,3 В', 'U1.3V3 M1.VDD M2.VCC M3.VCC M4.VCC J1.VCC J2.VDD J3.VDD J7.VCC R11.1 R12.1 R13.1 R14.1 R15.1'],
  ['5V', 'Питание 5 В логики', 'M5.+Vo U1.VIN C1.+ J4.VS J5.VCC J6.VCC BZ1.+'],
  ['5VD', 'Питание 5 В дисплея', 'M6.+Vo C3.+ J8.5VD'],
  [
    'GND',
    'Общий минус',
    'M5.-Vo M6.-Vo U1.GNDL U1.GNDR C1.- C3.- M1.GND M1.ADDR M2.GND M3.GND M4.GND J1.GND J2.GND J3.GND J4.GND J5.GND J6.GND J7.GND J8.GND J9.GND J10.- R6.2 R8.2 R10.2 C2.2 Q1.E U2.2 U3.2',
  ],
  ['T1_IN', 'Турбина 1, сигнал', 'U1.D25 R1.1'],
  ['T1_LED', 'Турбина 1, светодиод оптрона', 'R1.2 U2.1'],
  ['T2_IN', 'Турбина 2, сигнал', 'U1.D26 R2.1'],
  ['T2_LED', 'Турбина 2, светодиод оптрона', 'R2.2 U3.1'],
  ['T1_R', 'Турбина 1, оптрон к резистору', 'U2.6 R3.1', 'm'],
  ['T1_MT2', 'Турбина 1, MT2 симистора', 'R3.2 J11.MT2', 'm'],
  ['T1_G', 'Турбина 1, затвор', 'U2.4 J11.G', 'm'],
  ['T2_R', 'Турбина 2, оптрон к резистору', 'U3.6 R4.1', 'm'],
  ['T2_MT2', 'Турбина 2, MT2 симистора', 'R4.2 J12.MT2', 'm'],
  ['T2_G', 'Турбина 2, затвор', 'U3.4 J12.G', 'm'],
  ['ZC', 'Синхронизация, Z-C диммера', 'U1.D4 J1.ZC'],
  ['V1', 'Клапан 1, CH3 диммера', 'U1.D27 J1.CH3'],
  ['V2', 'Клапан 2, CH4 диммера', 'U1.D14 J1.CH4'],
  ['SSR', 'Реле розетки инструмента', 'U1.D13 J10.+'],
  ['ACS1', 'Ток Т1 до делителя', 'J5.OUT R5.1'],
  ['ACS1_D', 'Ток Т1 после делителя', 'R5.2 R6.1 U1.VP'],
  ['ACS2', 'Ток Т2 до делителя', 'J6.OUT R7.1'],
  ['ACS2_D', 'Ток Т2 после делителя', 'R7.2 R8.1 U1.VN'],
  ['MPX', 'Разрежение до делителя', 'J4.VOUT R9.1'],
  ['MPX_D', 'Разрежение после делителя', 'R9.2 R10.1 M1.A0'],
  ['CUR', 'Ток розетки', 'J7.OUT U1.D34'],
  ['SDA1', 'I2C шина 1, данные', 'U1.D21 M1.SDA M2.SDA J2.SDA R11.2'],
  ['SCL1', 'I2C шина 1, такт', 'U1.D22 M1.SCL M2.SCL J2.SCL R12.2'],
  ['SDA2', 'I2C шина 2, данные', 'U1.D33 J3.SDA R13.2'],
  ['SCL2', 'I2C шина 2, такт', 'U1.D32 J3.SCL R14.2'],
  ['SCK', 'Термопары, такт', 'U1.D18 M3.SCK M4.SCK'],
  ['SO', 'Термопары, данные', 'U1.D19 M3.SO M4.SO'],
  ['CS1', 'Термопара Т1, выбор', 'U1.D5 M3.CS'],
  ['CS2', 'Термопара Т2, выбор', 'U1.D23 M4.CS'],
  ['TXD', 'UART, на RX дисплея', 'U1.TX2 J8.TXD'],
  ['RXD', 'UART, с TX дисплея', 'U1.RX2 J8.RXD'],
  ['BTN', 'Кнопки, общая точка лестницы', 'U1.D35 R15.2 C2.1 R16.1 R17.1 R18.1 R19.1 R20.1 R21.1'],
  ['K1', 'Кнопка «Продуть»', 'R16.2 J9.K1'],
  ['K2', 'Кнопка «Режим»', 'R17.2 J9.K2'],
  ['K3', 'Кнопка «Сброс»', 'R18.2 J9.K3'],
  ['K4', 'Кнопка «Турбины»', 'R19.2 J9.K4'],
  ['K5', 'Кнопка «Пресет»', 'R20.2 J9.K5'],
  ['K6', 'Кнопка «Назад»', 'R21.2 J9.K6'],
  ['BZ_IN', 'Зуммер, сигнал', 'U1.D2 R22.1'],
  ['BZ_B', 'Зуммер, база транзистора', 'R22.2 Q1.B'],
  ['BZ_C', 'Зуммер, минус', 'Q1.C BZ1.-'],
  ['AC_L', 'Сеть L с клеммника', 'J13.L F1.1 F2.1', 'm'],
  ['AC_L1', 'L после F1, БП логики', 'F1.2 RV1.1 M5.ACL', 'm'],
  ['AC_L2', 'L после F2, БП дисплея', 'F2.2 RV2.1 M6.ACL', 'm'],
  ['AC_N', 'Сеть N', 'J13.N RV1.2 RV2.2 M5.ACN M6.ACN', 'm'],
];

export const VACUUM_BOARD: LegacyBoard = {
  id: 'vacuum-controller',
  title: 'Плата контроллера пылесоса',
  description:
    'Контроллер самодельного строительного пылесоса: ESP32, две турбины через MOC3021 и BTA41, датчики давления, тока и температуры, два блока питания HLK-PM01, зона 230 В. Односторонняя плата под ЛУТ с перемычками.',
  w: 820,
  h: 540,
  mainsY: 395,
  powerNets: ['3V3', '5V', '5VD', 'GND'],
  comps,
  nets,
  routing: routing as LegacyBoard['routing'],
};
