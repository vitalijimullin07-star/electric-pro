import type { FootprintDef, PadDef } from '../../model/types';

/*
 * Контроллер строительного пылесоса на ESP32-WROOM-32E — перечень деталей и соединений.
 * Готовых модулей нет, кроме ESP32, платы пульта с экраном и датчиков: блок питания — трансформатор
 * на шасси, мост,
 * понижающий преобразователь AP63205 и стабилизатор AMS1117; «диммер» — детектор нуля
 * с вторичной обмотки, оптроны MOC3023 (турбины, фаза) и MOC3063 (розетка, клапаны, у нуля),
 * симисторы; токи — трансформаторы тока, температура двигателей — термисторы NTC.
 *
 * pins: вывод корпуса (имя или номер) → цепь. at: [x, y, поворот] на плате, мм (y вниз).
 */

export interface VacPart {
  ref: string;
  value: string;
  description: string;
  /** Корпус из библиотеки или один из VAC_FOOTPRINTS. */
  fp: string;
  pins: Record<string, string>;
  at?: [number, number, number?];
  offBoard?: boolean;
  fields?: Record<string, string>;
}

/** Цепи сети 230 В: класс Mains, 6 мм до всего остального. */
export const MAINS_NETS = ['L_IN', 'N_IN', 'L', 'N', 'PE', 'L_F', 'M1_SW', 'M1_A', 'M1_R', 'G1', 'M2_SW', 'M2_A', 'M2_R', 'G2', 'XS_SW', 'XS_L', 'XS_R', 'G3', 'Y1_SW', 'Y1_R', 'Y1_G', 'Y2_SW', 'Y2_R', 'Y2_G'];
export const POWER_NETS = ['GND', '3V3', '5V', '+12V'];

/* ---------------- выносные детали: корпуса «на проводах» ---------------- */

function wired(id: string, name: string, description: string, category: string, refPrefix: string, pins: [string, string][], tags: string[], body: [number, number] = [12, 8]): FootprintDef {
  const pitch = 3.5;
  const x0 = (-(pins.length - 1) * pitch) / 2;
  const pads: PadDef[] = pins.map(([num, nm], i) => ({ number: num, name: nm, type: 'tht', shape: i ? 'circle' : 'rect', at: { x: x0 + i * pitch, y: 0 }, size: { x: 2.2, y: 2.2 }, drill: 1.2 }));
  const w = Math.max(body[0], pins.length * pitch + 2);
  return {
    id,
    name,
    description,
    category,
    refPrefix,
    tags: ['offboard', ...tags],
    pads,
    graphics: [
      { kind: 'rect', layer: 'F.Fab', a: { x: -w / 2, y: -body[1] }, b: { x: w / 2, y: -1.5 }, width: 0.1 },
      { kind: 'text', layer: 'F.Fab', at: { x: 0, y: -body[1] / 2 - 1 }, text: '${REF}', size: 1, thickness: 0.15, align: 'center' },
    ],
    courtyard: { min: { x: -w / 2 - 0.5, y: -body[1] - 0.5 }, max: { x: w / 2 + 0.5, y: 1.6 } },
    source: 'Выносная деталь: подключается проводами',
    verified: false,
  };
}

export const VAC_FOOTPRINTS: FootprintDef[] = [
  wired('Mains_Plug_Cord', 'Сетевой шнур с вилкой', 'Шнур 3×1,5 мм² с вилкой (L, N, PE) — через автомат 16 А', 'Разъёмы', 'XP', [['L', 'L'], ['N', 'N'], ['PE', 'PE']], ['mains']),
  wired('Motor_Universal_Wires', 'Турбина (коллекторный двигатель)', 'Турбина пылесоса: коллекторный двигатель с вентилятором, 230 В, провода', 'Разное', 'M', [['1', '1'], ['2', '2']], ['universal-motor', 'motor'], [30, 20]),
  wired('Triac_BTA41_TOP3_Heatsink', 'BTA41 на радиаторе', 'Симистор BTA41-600B (TOP3, 40 А) на общем радиаторе, изолированный корпус: T1 (MT1), T2 (MT2), G', 'Транзисторы', 'VS', [['1', 'T1'], ['2', 'T2'], ['3', 'G']], ['triac', 'bta41']),
  wired('CT_ZMCT103C_Wires', 'Трансформатор тока ZMCT103C', 'Трансформатор тока ZMCT103C 5 А : 5 мА (1000:1): провод нагрузки проходит через окно (P1→P2), обмотка S1–S2 — к плате', 'Датчики', 'TA', [['P1', 'P1'], ['P2', 'P2'], ['S1', 'S1'], ['S2', 'S2']], ['current-transformer', 'zmct103c']),
  wired('Valve_Solenoid_230V', 'Электромагнитный клапан 230 В', 'Клапан продувки фильтра, 230 В ~, нормально закрытый, 1/2″', 'Разное', 'YA', [['1', '1'], ['2', '2']], ['solenoid-valve'], [16, 16]),
  wired('Socket_Tool_Outlet', 'Розетка для инструмента', 'Розетка 16 А на корпусе пылесоса — для электроинструмента (автозапуск)', 'Разъёмы', 'XS', [['L', 'L'], ['N', 'N'], ['PE', 'PE']], ['tool-outlet']),
  wired('R_NTC_Probe_Wires', 'Термистор NTC на проводах', 'Термистор NTC 10 кОм B3950 в изолированной гильзе на корпусе двигателя (провода в изоляции на 230 В)', 'Резисторы', 'RK', [['1', '1'], ['2', '2']], ['ntc', 'thermistor']),
  wired('Sensor_SDP810_Wires', 'Sensirion SDP810', 'Датчик перепада давления Sensirion SDP810 (I²C 0x25), трубки 5 мм, 4 провода', 'Датчики', 'B', [['1', 'VDD'], ['2', 'GND'], ['3', 'SCL'], ['4', 'SDA']], ['sdp810', 'pressure']),
  wired('Display_ESP32-S3_800x480_Wires', 'Плата ESP32-S3 с экраном 800×480', 'Пульт: плата ESP32-S3 с сенсорным RGB-экраном 5″ или 7″ 800×480 (Sunton ESP32-8048S050C/070C или аналог с GT911), в крышке пылесоса; к контроллеру — 5 В, земля и UART', 'Дисплеи', 'HG', [['1', '5V'], ['2', 'GND'], ['3', 'TX'], ['4', 'RX']], ['panel-s3', 'display'], [40, 26]),
  wired('SW_Mains_2P_16A', 'Выключатель сети 2P 16 А', 'Двухполюсный клавишный выключатель 250 В 16 А на корпус: полное отключение (фаза и ноль)', 'Кнопки и переключатели', 'SA', [['1', 'L1'], ['2', 'L2'], ['3', 'N1'], ['4', 'N2']], ['mains-switch']),
  wired('Transformer_Chassis_Wires', 'Трансформатор на корпус', 'Сетевой трансформатор на шасси (EI48 или тороидальный), 230 В → 9 В, 10 ВА: первичная P1–P2, вторичная S1–S2 — проводами к клеммникам на плате', 'Питание', 'TV', [['P1', 'P1'], ['P2', 'P2'], ['S1', 'S1'], ['S2', 'S2']], ['transformer'], [44, 36]),
  wired('SW_PUSH_Panel_16mm', 'Кнопка на панель Ø16', 'Кнопка без фиксации Ø16 мм на панель пылесоса, нормально разомкнутая', 'Кнопки и переключатели', 'SB', [['1', '1'], ['2', '2']], ['panel', 'button']),
];

/* ---------------- детали ---------------- */

const R = (ref: string, value: string, description: string, a: string, b: string, at: [number, number, number?], fp = 'R_0805_2012Metric'): VacPart => ({ ref, value, description, fp, pins: { '1': a, '2': b }, at });
const C = (ref: string, value: string, description: string, a: string, b: string, at: [number, number, number?], fp = 'C_0805_2012Metric'): VacPart => ({ ref, value, description, fp, pins: { '1': a, '2': b }, at });

/**
 * Аналоговая часть слева от ESP32: столбцы на шаге 2,54 мм (между ними проходит дорожка),
 * справа налево — в порядке выводов АЦП на модуле; вывод к ESP32 — сверху (поворот 270°).
 */
function analog(): VacPart[] {
  const col = (i: number) => +(77.47 - i * 2.54).toFixed(3);
  const row = [45.72, 50.165, 54.61];
  const r = (ref: string, v: string, d: string, a: string, b: string, i: number, j: number) => R(ref, v, d, a, b, [col(i), row[j], 270], 'R_0603_1608Metric');
  const c = (ref: string, v: string, d: string, a: string, b: string, i: number, j: number) => C(ref, v, d, a, b, [col(i), row[j], 270], 'C_0603_1608Metric');
  return [
    r('R26', '10k', 'Делитель термистора турбины 2', 'NTC2', '3V3', 0, 0),
    c('C12', '100 нФ', 'Фильтр термистора 2', 'NTC2', 'GND', 0, 1),
    r('R25', '10k', 'Делитель термистора турбины 1', 'NTC1', '3V3', 1, 0),
    c('C11', '100 нФ', 'Фильтр термистора 1', 'NTC1', 'GND', 1, 1),
    r('R27', '6,8k', 'Делитель датчика разрежения 4,7 → 2,8 В', 'VAC', 'VAC_S', 2, 0),
    r('R28', '10k', 'Делитель датчика разрежения', 'VAC', 'GND', 2, 1),
    c('C14', '10 нФ', 'Фильтр датчика разрежения', 'VAC', 'GND', 2, 2),
    r('R24', '33', 'Нагрузка ТТ3 (инструмент, до 16 А)', 'CT3', 'VMID', 3, 0),
    c('C10', '10 мкФ', 'Середина питания АЦП', 'VMID', 'GND', 3, 1),
    r('R23', '82', 'Нагрузка ТТ2 (турбина 2, до 8 А)', 'CT2', 'VMID', 4, 0),
    r('R21', '10k', 'Середина питания АЦП для трансформаторов тока', 'VMID', 'GND', 4, 1),
    r('R22', '82', 'Нагрузка ТТ1 (турбина 1, до 8 А)', 'CT1', 'VMID', 5, 0),
    r('R20', '10k', 'Середина питания АЦП для трансформаторов тока', 'VMID', '3V3', 5, 1),
  ];
}

/** Места оптронов (по x) и строка их центров: над прорезью, выводы 1–3 — в низковольтной части. */
const MOC_X = [46, 56, 66, 80, 94];
const MOC_Y = 31;

export const VAC_PARTS: VacPart[] = [
  // --- сеть и блок питания ---
  { ref: 'XT1', value: 'Сеть', description: 'Клеммник сети 230 В: L, N', fp: 'TerminalBlock_1x02_P5.08mm', pins: { '1': 'L', '2': 'N' }, at: [13, 5.8] },
  { ref: 'FU1', value: 'T1A', description: 'Предохранитель 1 А (TR5, с задержкой): трансформатор и клапаны', fp: 'Fuse_TR5_P5.08mm', pins: { '1': 'L', '2': 'L_F' }, at: [27, 5.8] },
  { ref: 'RU1', value: 'S07K275', description: 'Варистор 275 В, Ø7: защита от выбросов сети', fp: 'RV_Disc_D7mm_P5mm', pins: { '1': 'L_F', '2': 'N' }, at: [27, 14] },
  { ref: 'XT4', value: '~230 В', description: 'Клеммник первичной обмотки трансформатора TV1 (после предохранителя)', fp: 'TerminalBlock_1x02_P5.08mm', pins: { '1': 'L_F', '2': 'N' }, at: [12, 18] },
  { ref: 'XT5', value: '~9 В', description: 'Клеммник вторичной обмотки трансформатора TV1', fp: 'TerminalBlock_1x02_P5.08mm', pins: { '1': 'AC1', '2': 'AC2' }, at: [12, 40] },
  { ref: 'VDS1', value: 'MB6S', description: 'Диодный мост 0,5 А 600 В (SOP-4): средний ток ≈0,25 А с пультом', fp: 'D_Bridge_MBS_SOP-4', pins: { '1': 'AC2', '3': 'AC1', '4': 'VRECT', '2': 'GND' }, at: [8, 53] },
  { ref: 'VD1', value: 'SS14', description: 'Диод Шоттки 1 А: развязка детектора нуля от накопительного конденсатора', fp: 'D_SMA', pins: { A: 'VRECT', K: '+12V' }, at: [14, 51, 180] },
  C('C1', '680 мкФ 25 В', 'Накопительный конденсатор после моста (пульсации ≈3 В при 0,25 А)', '+12V', 'GND', [24, 51], 'CP_Elec_10x10.5'),
  { ref: 'DA1', value: 'AP63205WU', description: 'Понижающий преобразователь 3,8–32 В → 5 В, 2 А (SOT-23-6)', fp: 'REG_AP63205_SOT-23-6', pins: { VIN: '+12V', EN: '+12V', GND: 'GND', SW: 'SW5', BST: 'BST', FB: '5V' }, at: [8.5, 61.5] },
  C('C2', '10 мкФ 35 В', 'Вход преобразователя (X5R, 1206)', '+12V', 'GND', [4, 61.5, 90], 'C_1206_3216Metric'),
  C('C3', '100 нФ', 'Вольтодобавка BST–SW', 'BST', 'SW5', [9, 65.5]),
  { ref: 'L1', value: '6,8 мкГн 1,5 А', description: 'Дроссель преобразователя (CD54)', fp: 'L_CD54_5.8x5.8mm', pins: { '1': 'SW5', '2': '5V' }, at: [14.5, 61.4] },
  C('C4', '22 мкФ 10 В', 'Выход 5 В (X5R, 1206)', '5V', 'GND', [20.5, 61, 90], 'C_1206_3216Metric'),
  C('C5', '22 мкФ 10 В', 'Выход 5 В (X5R, 1206)', '5V', 'GND', [23, 61, 90], 'C_1206_3216Metric'),
  { ref: 'DA2', value: 'AMS1117-3.3', description: 'Стабилизатор 3,3 В 1 А для ESP32', fp: 'REG_AMS1117_SOT-223', pins: { '1': 'GND', '2': '3V3', '3': '5V', '4': '3V3' }, at: [28.5, 63.5] },
  C('C6', '22 мкФ 10 В', 'Выход 3,3 В', '3V3', 'GND', [33.2, 63.5, 90], 'C_1206_3216Metric'),

  // --- детектор нуля (со вторичной обмотки) ---
  R('R1', '47k', 'Детектор нуля: от выпрямителя к базе', 'VRECT', 'ZC_B', [13, 67]),
  R('R2', '10k', 'Детектор нуля: база — земля (порог ≈3,7 В)', 'ZC_B', 'GND', [13, 69.5]),
  { ref: 'VT1', value: 'MMBT3904', description: 'Детектор нуля: у нуля сети транзистор закрыт — на входе «1»', fp: 'Q_MMBT3904_SOT-23', pins: { B: 'ZC_B', E: 'GND', C: 'ZC' }, at: [18, 68] },
  R('R3', '10k', 'Детектор нуля: подтяжка к 3,3 В', '3V3', 'ZC', [22, 68, 90]),

  // --- ESP32 ---
  {
    ref: 'A1',
    value: 'ESP32-WROOM-32E',
    description: 'Модуль ESP32-WROOM-32E 4 МБ (антенна к краю платы)',
    fp: 'Module_ESP32-WROOM-32E',
    pins: {
      '1': 'GND', '15': 'GND', '38': 'GND', '3V3': '3V3', EN: 'EN', IO0: 'IO0', TXD0: 'TXD0', RXD0: 'RXD0',
      // Верхний ряд (к оптронам и датчикам): ключи и входы АЦП1; левый торец — клапан 1,
      // кнопка, зуммер; нижний ряд (к разъёмам) — шины I²C, энкодер, кнопки, детектор нуля.
      // Выводы, которые при загрузке дёргает ПЗУ (IO5, IO12, IO14, IO15, IO2), — не на ключах симисторов.
      SENSOR_VP: 'CT1', SENSOR_VN: 'CT2', IO34: 'CT3', IO35: 'VAC', IO32: 'NTC1', IO33: 'NTC2',
      IO12: 'T1', IO27: 'T2', IO26: 'OUT', IO13: 'Y1', IO25: 'Y2', IO4: 'ZC',
      IO18: 'SDA0', IO5: 'SCL0', IO16: 'SDA1', IO17: 'SCL1', IO19: 'ENC_A', IO21: 'ENC_B', IO22: 'ENC_SW',
      IO14: 'K_START', IO23: 'PNL_TX', IO15: 'PNL_RX', IO2: 'BZ',
    },
    at: [97, 52.77, 270],
  },
  // У выводов 3V3 и GND модуля, не загораживая выход EN вверх.
  C('C8', '10 мкФ', 'Питание ESP32 3,3 В (у вывода 3V3)', '3V3', 'GND', [101.4, 38.5]),
  C('C9', '100 нФ', 'Питание ESP32 3,3 В: прямо над выводами 3V3 и GND', '3V3', 'GND', [101.9, 42.1], 'C_0603_1608Metric'),
  R('R4', '10k', 'EN: подтяжка (сброс при включении)', 'EN', '3V3', [104.5, 66.6, 270], 'R_0603_1608Metric'),
  C('C7', '1 мкФ', 'EN: задержка сброса', 'EN', 'GND', [106.4, 66.6, 270], 'C_0603_1608Metric'),
  {
    ref: 'X6',
    value: 'Прошивка',
    description: 'Разъём прошивки 1×5 к переходнику USB-UART 3,3 В: IO0, RXD, TXD, 3V3, GND (TX переходника — к RXD, RX — к TXD). Прошивка: перемычка IO0–GND, включить питание переходника, загрузить, снять перемычку и перевключить',
    fp: 'PinHeader_1x05_P2.54mm',
    pins: { '1': 'IO0', '2': 'RXD0', '3': 'TXD0', '4': '3V3', '5': 'GND' },
    at: [102.77, 71.9],
  },

  // --- оптроны и выходные резисторы ---
  ...(['T1', 'T2', 'OUT', 'Y1', 'Y2'] as const).flatMap((sig, i): VacPart[] => {
    const x = MOC_X[i];
    const zc = i >= 2;
    const out = ['M1', 'M2', 'XS', 'Y1', 'Y2'][i];
    const what = ['турбина 1', 'турбина 2', 'розетка инструмента', 'клапан продувки 1', 'клапан продувки 2'][i];
    const gate = i < 3 ? `G${i + 1}` : `${out}_G`;
    return [
      R(`R${6 + i}`, '220', `Светодиод оптрона U${i + 1} (≈9 мА): ${what}`, sig, `${sig}_LED`, [x - 2.54, 37.7, 90], 'R_0603_1608Metric'),
      { ref: `U${i + 1}`, value: zc ? 'MOC3063' : 'MOC3023', description: `Оптосимистор ${zc ? 'с переходом через ноль' : 'случайной фазы'}: ${what}`, fp: 'IC_MOC3021_DIP-6', pins: { '1': `${sig}_LED`, '2': 'GND', '6': `${out}_R`, '4': gate }, at: [x, MOC_Y, 90] },
      { ref: `R${11 + i}`, value: '360', description: `Резистор в цепи оптрона U${i + 1} (2010, 400 В)`, fp: 'R_2010_5025Metric', pins: { '1': `${out}_R`, '2': `${out}_SW` }, at: [x - 2.54, 22, 90] },
    ];
  }),
  { ref: 'XT3', value: 'Симисторы', description: 'Клеммник к симисторам BTA41 на радиаторе: T2 и G турбин 1, 2 и розетки', fp: 'TerminalBlock_1x06_P5.08mm', pins: { '1': 'M1_SW', '2': 'G1', '3': 'M2_SW', '4': 'G2', '5': 'XS_SW', '6': 'G3' }, at: [56, 5.8] },
  { ref: 'VS1', value: 'BT134W-600', description: 'Симистор клапана продувки 1 (SOT-223)', fp: 'Q_BT134W_SOT-223', pins: { '1': 'L_F', '2': 'Y1_SW', '4': 'Y1_SW', '3': 'Y1_G' }, at: [83.5, 15.5] },
  { ref: 'VS2', value: 'BT134W-600', description: 'Симистор клапана продувки 2 (SOT-223)', fp: 'Q_BT134W_SOT-223', pins: { '1': 'L_F', '2': 'Y2_SW', '4': 'Y2_SW', '3': 'Y2_G' }, at: [97.5, 15.5] },
  { ref: 'XT2', value: 'Клапаны', description: 'Клеммник клапанов продувки: Y1, Y2, N', fp: 'TerminalBlock_1x03_P5.08mm', pins: { '1': 'Y1_SW', '2': 'Y2_SW', '3': 'N' }, at: [102, 5.8] },

  // --- датчики на плате: аналоговая часть слева от ESP32, разъёмы по нижнему краю ---
  { ref: 'X4', value: 'Датчики', description: 'Трансформаторы тока (общий VMID, ТТ1, ТТ2, ТТ3) и термисторы двигателей (NTC1, NTC2, GND), JST PH', fp: 'JST_PH_B7B-PH-A_1x07_P2mm_Vertical', pins: { '1': 'VMID', '2': 'CT1', '3': 'CT2', '4': 'CT3', '5': 'NTC1', '6': 'NTC2', '7': 'GND' }, at: [68.4, 69.95] },
  ...analog(),
  { ref: 'B1', value: 'MPX5050DP', description: 'Датчик разрежения 0–50 кПа (NXP), трубка ко входу турбин', fp: 'Sensor_MPX5100DP', pins: { VOUT: 'VAC_S', GND: 'GND', VS: '5V' }, at: [45.5, 52, 180], fields: { 'Где стоит': 'вход турбин' } },
  C('C13', '1 мкФ', 'Питание датчика разрежения', '5V', 'GND', [47.5, 45.4], 'C_0603_1608Metric'),
  { ref: 'X2', value: 'Фильтр', description: 'Датчик перепада на фильтре SDP810-500Pa (шина I²C 0), JST PH: GND, 3V3, SCL, SDA', fp: 'JST_PH_B4B-PH-A_1x04_P2mm_Vertical', pins: { '1': 'GND', '2': '3V3', '3': 'SCL0', '4': 'SDA0' }, at: [54.35, 69.95] },
  { ref: 'X3', value: 'Расход', description: 'Расходомер SDP810-125Pa (шина I²C 1), JST PH: GND, 3V3, SCL, SDA', fp: 'JST_PH_B4B-PH-A_1x04_P2mm_Vertical', pins: { '1': 'GND', '2': '3V3', '3': 'SCL1', '4': 'SDA1' }, at: [43.35, 69.95] },
  R('R29', '4,7k', 'Подтяжка SDA0', 'SDA0', '3V3', [55.1, 64.3], 'R_0603_1608Metric'),
  R('R30', '4,7k', 'Подтяжка SCL0', 'SCL0', '3V3', [55.1, 66.0], 'R_0603_1608Metric'),
  R('R31', '4,7k', 'Подтяжка SDA1', 'SDA1', '3V3', [44.1, 64.3], 'R_0603_1608Metric'),
  R('R32', '4,7k', 'Подтяжка SCL1', 'SCL1', '3V3', [44.1, 66.0], 'R_0603_1608Metric'),

  // --- панель и звук ---
  { ref: 'X1', value: 'Пульт', description: 'Пульт — плоский кабель 2×6 (IDC): плата с экраном (5 В, земля, UART), энкодер, кнопка «Пуск турбин», зуммер. Питание экрана — по двум проводам 5 В и трём земли', fp: 'PinHeader_2x06_P2.54mm', pins: { '1': '5V', '3': 'GND', '5': 'ENC_A', '7': 'ENC_B', '9': 'ENC_SW', '11': 'PNL_TX', '2': 'K_START', '4': 'PNL_RX', '6': 'BZ_K', '8': '5V', '10': 'GND', '12': 'GND' }, at: [85.1, 69.05] },
  { ref: 'VT2', value: 'MMBT3904', description: 'Ключ зуммера', fp: 'Q_MMBT3904_SOT-23', pins: { B: 'BZ_B', E: 'GND', C: 'BZ_K' }, at: [60.3, 55.31] },
  R('R33', '1k', 'База ключа зуммера', 'BZ', 'BZ_B', [60.3, 51.4], 'R_0603_1608Metric'),
  { ref: 'VD2', value: '1N4148W', description: 'Диод на катушке зуммера', fp: 'D_SOD-123', pins: { A: 'BZ_K', K: '5V' }, at: [60.3, 59.4] },

  // --- крепёж ---
  { ref: 'H1', value: '', description: 'Крепёжное отверстие M3', fp: 'MountingHole_3.2mm_M3', pins: {}, at: [3.5, 3.5] },
  { ref: 'H2', value: '', description: 'Крепёжное отверстие M3', fp: 'MountingHole_3.2mm_M3', pins: {}, at: [106.5, 17] },
  { ref: 'H3', value: '', description: 'Крепёжное отверстие M3', fp: 'MountingHole_3.2mm_M3', pins: {}, at: [3.5, 70.5] },
  { ref: 'H4', value: '', description: 'Крепёжное отверстие M3', fp: 'MountingHole_3.2mm_M3', pins: {}, at: [38.3, 40.6] },

  // --- выносные детали ---
  { ref: 'TV1', value: '230/9 В 10 ВА', description: 'Трансформатор 230 → 9 В, 10 ВА, на шасси (Block VC 10/1/9, тороидальный TTR 10 ВА или аналог): хватает на контроллер и пульт с экраном (до 0,5 А от 5 В)', fp: 'Transformer_Chassis_Wires', pins: { P1: 'L_F', P2: 'N', S1: 'AC1', S2: 'AC2' }, offBoard: true },
  { ref: 'XP1', value: '3×1,5 мм²', description: 'Сетевой шнур с вилкой', fp: 'Mains_Plug_Cord', pins: { L: 'L_IN', N: 'N_IN', PE: 'PE' }, offBoard: true },
  { ref: 'SA2', value: '2P 16 А', description: 'Выключатель «Питание» на пульте: полное отключение фазы и нуля (всё, включая розетку инструмента)', fp: 'SW_Mains_2P_16A', pins: { L1: 'L_IN', L2: 'L', N1: 'N_IN', N2: 'N' }, offBoard: true },
  { ref: 'M1', value: '1200 Вт', description: 'Турбина 1 (коллекторный двигатель с вентилятором)', fp: 'Motor_Universal_Wires', pins: { '1': 'M1_A', '2': 'N' }, offBoard: true },
  { ref: 'M2', value: '1200 Вт', description: 'Турбина 2', fp: 'Motor_Universal_Wires', pins: { '1': 'M2_A', '2': 'N' }, offBoard: true },
  { ref: 'VS3', value: 'BTA41-600B', description: 'Симистор турбины 1 на радиаторе', fp: 'Triac_BTA41_TOP3_Heatsink', pins: { T1: 'L', T2: 'M1_SW', G: 'G1' }, offBoard: true },
  { ref: 'VS4', value: 'BTA41-600B', description: 'Симистор турбины 2 на радиаторе', fp: 'Triac_BTA41_TOP3_Heatsink', pins: { T1: 'L', T2: 'M2_SW', G: 'G2' }, offBoard: true },
  { ref: 'VS5', value: 'BTA41-600B', description: 'Симистор розетки инструмента на радиаторе', fp: 'Triac_BTA41_TOP3_Heatsink', pins: { T1: 'L', T2: 'XS_SW', G: 'G3' }, offBoard: true },
  { ref: 'TA1', value: 'ZMCT103C 1000:1', description: 'Ток турбины 1: провод M1 — через окно', fp: 'CT_ZMCT103C_Wires', pins: { P1: 'M1_SW', P2: 'M1_A', S1: 'CT1', S2: 'VMID' }, offBoard: true },
  { ref: 'TA2', value: 'ZMCT103C 1000:1', description: 'Ток турбины 2: провод M2 — через окно', fp: 'CT_ZMCT103C_Wires', pins: { P1: 'M2_SW', P2: 'M2_A', S1: 'CT2', S2: 'VMID' }, offBoard: true },
  { ref: 'TA3', value: 'ZMCT103C 1000:1', description: 'Ток инструмента: провод розетки — через окно', fp: 'CT_ZMCT103C_Wires', pins: { P1: 'XS_SW', P2: 'XS_L', S1: 'CT3', S2: 'VMID' }, offBoard: true },
  { ref: 'XS1', value: '16 А', description: 'Розетка для инструмента (автозапуск пылесоса)', fp: 'Socket_Tool_Outlet', pins: { L: 'XS_L', N: 'N', PE: 'PE' }, offBoard: true },
  { ref: 'YA1', value: '230 В ~', description: 'Клапан продувки фильтра 1', fp: 'Valve_Solenoid_230V', pins: { '1': 'Y1_SW', '2': 'N' }, offBoard: true },
  { ref: 'YA2', value: '230 В ~', description: 'Клапан продувки фильтра 2', fp: 'Valve_Solenoid_230V', pins: { '1': 'Y2_SW', '2': 'N' }, offBoard: true },
  { ref: 'RK1', value: '10k B3950', description: 'Термистор на корпусе турбины 1', fp: 'R_NTC_Probe_Wires', pins: { '1': 'NTC1', '2': 'GND' }, offBoard: true, fields: { 'Где стоит': 'M1' } },
  { ref: 'RK2', value: '10k B3950', description: 'Термистор на корпусе турбины 2', fp: 'R_NTC_Probe_Wires', pins: { '1': 'NTC2', '2': 'GND' }, offBoard: true, fields: { 'Где стоит': 'M2' } },
  { ref: 'B2', value: 'SDP810-500Pa', description: 'Перепад давления на фильтре (трубки до и после фильтра)', fp: 'Sensor_SDP810_Wires', pins: { VDD: '3V3', GND: 'GND', SCL: 'SCL0', SDA: 'SDA0' }, offBoard: true, fields: { 'Где стоит': 'фильтр' } },
  { ref: 'B3', value: 'SDP810-125Pa', description: 'Расходомер: сопло Вентури на входе шланга в бак', fp: 'Sensor_SDP810_Wires', pins: { VDD: '3V3', GND: 'GND', SCL: 'SCL1', SDA: 'SDA1' }, offBoard: true, fields: { 'Где стоит': 'расходомер' } },
  { ref: 'HG1', value: 'ESP32-S3 5″ 800×480', description: 'Пульт: плата ESP32-S3 с сенсорным экраном 800×480 (Sunton ESP32-8048S050C или аналог), прошивка firmware/vacuum-panel. TX платы — к PNL_RX контроллера, RX — к PNL_TX', fp: 'Display_ESP32-S3_800x480_Wires', pins: { '5V': '5V', GND: 'GND', TX: 'PNL_RX', RX: 'PNL_TX' }, offBoard: true },
  { ref: 'SA1', value: 'EC11', description: 'Энкодер с кнопкой под экраном пульта: уставка, параметры на экране', fp: 'RotaryEncoder_Alps_EC11E_Vertical_H20mm', pins: { A: 'ENC_A', B: 'ENC_B', C: 'GND', S1: 'ENC_SW', S2: 'GND' }, offBoard: true },
  { ref: 'SB3', value: 'Пуск турбин', description: 'Кнопка «Пуск турбин» под экраном: коротко — пуск и стоп, удержание — пресеты на экране', fp: 'SW_PUSH_Panel_16mm', pins: { '1': 'K_START', '2': 'GND' }, offBoard: true },
  { ref: 'BA1', value: 'Зуммер 5 В', description: 'Зуммер электромагнитный без генератора 5 В, Ø12, на панели', fp: 'Buzzer_12x8.5mm_P6mm', pins: { '1': '5V', '2': 'BZ_K' }, offBoard: true },
];

export const VAC_NET_DESCRIPTIONS: Record<string, string> = {
  L_IN: 'Сеть от вилки до выключателя SA2',
  N_IN: 'Ноль от вилки до выключателя SA2',
  PNL_TX: 'UART к пульту: IO23 → RX платы с экраном',
  PNL_RX: 'UART от пульта: TX платы с экраном → IO15',
  L: 'Сеть, фаза',
  N: 'Сеть, ноль',
  PE: 'Защитная земля',
  L_F: 'Фаза после предохранителя FU1',
  AC1: 'Вторичная обмотка 9 В',
  AC2: 'Вторичная обмотка 9 В',
  VRECT: 'Выпрямленное без сглаживания (детектор нуля)',
  '+12V': 'Постоянное после моста, 11–15 В',
  '5V': 'Питание 5 В (AP63205)',
  '3V3': 'Питание 3,3 В (AMS1117)',
  ZC: 'Детектор нуля → IO4',
  VMID: 'Середина 1,65 В для трансформаторов тока',
};
