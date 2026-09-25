import type { FootprintDef } from '../../model/types';
import { CAT } from '../categories';

/*
 * Конкретные микросхемы, транзисторы и стабилизаторы с распиновкой: корпус берётся из
 * общей библиотеки (DIP-8, SOIC-16, TO-220…), выводам даются имена по даташиту —
 * по ним на шелкографии печатается распиновка, а в схеме видно, что куда.
 */

export interface ChipSpec {
  /** Идентификатор нового корпуса. */
  id: string;
  /** Корпус-основа из библиотеки. */
  base: string;
  name: string;
  description: string;
  group: string;
  category?: string;
  refPrefix?: string;
  /** Имена выводов по порядку номеров 1, 2, 3… */
  pins: string[];
  tags?: string[];
}

const MCU = 'Микроконтроллеры';
const LOGIC = 'Логика 74HC и CD4000';
const AMP = 'Операционные усилители и таймеры';
const DRV = 'Драйверы и интерфейсы';
const MEM = 'Память, часы, АЦП, расширители';
const OPTO = 'Оптроны';
const REG = 'Стабилизаторы';
const TR = 'Транзисторы и тиристоры с распиновкой';

const range = (prefix: string, a: number, b: number) => Array.from({ length: Math.abs(b - a) + 1 }, (_, i) => `${prefix}${a <= b ? a + i : a - i}`);

/** ATmega328P в DIP-28: имена как на Arduino (D0…D13, A0…A5). */
const M328_DIP = ['RST', 'D0', 'D1', 'D2', 'D3', 'D4', 'VCC', 'GND', 'XT1', 'XT2', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10', 'D11', 'D12', 'D13', 'AVCC', 'AREF', 'GND', 'A0', 'A1', 'A2', 'A3', 'A4', 'A5'];
/** ATmega328P в TQFP-32 (распиновка по даташиту, имена как на Arduino). */
const M328_TQFP = ['D3', 'D4', 'GND', 'VCC', 'GND', 'VCC', 'XT1', 'XT2', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10', 'D11', 'D12', 'D13', 'AVCC', 'A6', 'AREF', 'GND', 'A7', 'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'RST', 'D0', 'D1', 'D2'];
const MEGA_DIP40 = [...range('PB', 0, 7), 'RST', 'VCC', 'GND', 'XT2', 'XT1', ...range('PD', 0, 7), ...range('PC', 0, 7), 'AVCC', 'GND', 'AREF', ...range('PA', 7, 0)];
const DUAL_OPAMP = ['OUT1', 'IN1-', 'IN1+', 'GND', 'IN2+', 'IN2-', 'OUT2', 'VCC'];
const QUAD_OPAMP = ['OUT1', 'IN1-', 'IN1+', 'VCC', 'IN2+', 'IN2-', 'OUT2', 'OUT3', 'IN3-', 'IN3+', 'GND', 'IN4+', 'IN4-', 'OUT4'];
const LM339 = ['OUT2', 'OUT1', 'VCC', 'IN1-', 'IN1+', 'IN2-', 'IN2+', 'IN3-', 'IN3+', 'IN4-', 'IN4+', 'GND', 'OUT4', 'OUT3'];
const SINGLE_OPAMP = ['NULL', 'IN-', 'IN+', 'V-', 'NULL', 'OUT', 'V+', 'NC'];
const GATE4 = ['1A', '1B', '1Y', '2A', '2B', '2Y', 'GND', '3Y', '3A', '3B', '4Y', '4A', '4B', 'VCC'];
const NOR4 = ['1Y', '1A', '1B', '2Y', '2A', '2B', 'GND', '3A', '3B', '3Y', '4A', '4B', '4Y', 'VCC'];
const HEX_INV = ['1A', '1Y', '2A', '2Y', '3A', '3Y', 'GND', '4Y', '4A', '5Y', '5A', '6Y', '6A', 'VCC'];
const HC595 = ['QB', 'QC', 'QD', 'QE', 'QF', 'QG', 'QH', 'GND', "QH'", 'MR', 'SHCP', 'STCP', 'OE', 'DS', 'QA', 'VCC'];
const HC165 = ['SH/LD', 'CLK', 'E', 'F', 'G', 'H', "QH'", 'GND', 'QH', 'SER', 'A', 'B', 'C', 'D', 'INH', 'VCC'];
const DS1307 = ['X1', 'X2', 'VBAT', 'GND', 'SDA', 'SCL', 'SQW', 'VCC'];
const EEPROM24 = ['A0', 'A1', 'A2', 'GND', 'SDA', 'SCL', 'WP', 'VCC'];
const PCF8574 = ['A0', 'A1', 'A2', 'P0', 'P1', 'P2', 'P3', 'GND', 'P4', 'P5', 'P6', 'P7', 'INT', 'SCL', 'SDA', 'VCC'];
const MAX485 = ['RO', 'RE', 'DE', 'DI', 'GND', 'A', 'B', 'VCC'];
const CH340G = ['GND', 'TXD', 'RXD', 'V3', 'UD+', 'UD-', 'XI', 'XO', 'CTS', 'DSR', 'RI', 'DCD', 'DTR', 'RTS', 'R232', 'VCC'];
const NE555 = ['GND', 'TRIG', 'OUT', 'RST', 'CTRL', 'THR', 'DIS', 'VCC'];
const MOC30 = ['A', 'K', 'NC', 'MT2', 'NC', 'MT1'];

export const CHIP_SPECS: ChipSpec[] = [
  // --- микроконтроллеры ---
  { id: 'IC_ATmega328P_DIP-28', base: 'DIP-28_W7.62mm', name: 'ATmega328P (DIP-28)', description: 'ATmega328P/ATmega8 в DIP-28 — сердце Arduino Uno. Подписи как на Arduino: D0–D13, A0–A5; порты: D0–D7 = PD0–PD7, D8–D13 = PB0–PB5, A0–A5 = PC0–PC5', group: MCU, pins: M328_DIP, tags: ['atmega328p', 'atmega8', 'arduino', 'avr'] },
  { id: 'IC_ATmega328P_TQFP-32', base: 'TQFP-32_7x7mm_P0.8mm', name: 'ATmega328P (TQFP-32)', description: 'ATmega328P в TQFP-32 (как на Arduino Nano и Pro Mini). Имена выводов как на Arduino, A6/A7 — только аналоговые входы. Шаг 0,8 мм: распиновка — на сборочном слое', group: MCU, pins: M328_TQFP, tags: ['atmega328p', 'arduino', 'nano', 'avr'] },
  { id: 'IC_ATtiny85_DIP-8', base: 'DIP-8_W7.62mm', name: 'ATtiny85/45/25/13 (DIP-8)', description: 'ATtiny85/45/25/13A в DIP-8: PB0–PB5, PB5 — RESET. Digispark: P0–P5 = PB0–PB5', group: MCU, pins: ['PB5/RST', 'PB3', 'PB4', 'GND', 'PB0', 'PB1', 'PB2', 'VCC'], tags: ['attiny85', 'attiny13', 'avr'] },
  { id: 'IC_ATtiny85_SOIC-8', base: 'SOIC-8_5.23x5.23mm_P1.27mm_EIAJ', name: 'ATtiny85 (SOIC-8 широкий)', description: 'ATtiny85-20SU в SOIC-8 208 mil (EIAJ)', group: MCU, pins: ['PB5/RST', 'PB3', 'PB4', 'GND', 'PB0', 'PB1', 'PB2', 'VCC'], tags: ['attiny85', 'avr'] },
  { id: 'IC_ATtiny84_DIP-14', base: 'DIP-14_W7.62mm', name: 'ATtiny84/44/24 (DIP-14)', description: 'ATtiny84/44/24 в DIP-14: PA0–PA7, PB0–PB3 (PB3 — RESET)', group: MCU, pins: ['VCC', 'PB0', 'PB1', 'PB3/RST', 'PB2', 'PA7', 'PA6', 'PA5', 'PA4', 'PA3', 'PA2', 'PA1', 'PA0', 'GND'], tags: ['attiny84', 'avr'] },
  { id: 'IC_ATtiny2313_DIP-20', base: 'DIP-20_W7.62mm', name: 'ATtiny2313/4313 (DIP-20)', description: 'ATtiny2313A/4313 в DIP-20', group: MCU, pins: ['PA2/RST', 'PD0', 'PD1', 'PA1', 'PA0', 'PD2', 'PD3', 'PD4', 'PD5', 'GND', 'PD6', 'PB0', 'PB1', 'PB2', 'PB3', 'PB4', 'PB5', 'PB6', 'PB7', 'VCC'], tags: ['attiny2313', 'avr'] },
  { id: 'IC_ATmega16_32_DIP-40', base: 'DIP-40_W15.24mm', name: 'ATmega16/32/644/1284 (DIP-40)', description: 'ATmega16/32/164/324/644/1284 в DIP-40: порты PA–PD', group: MCU, pins: MEGA_DIP40, tags: ['atmega32', 'atmega16', 'atmega1284', 'avr'] },
  { id: 'IC_PIC12F675_DIP-8', base: 'DIP-8_W7.62mm', name: 'PIC12F629/675 (DIP-8)', description: 'PIC12F629/675/683 в DIP-8: GP0–GP5, GP3 — MCLR', group: MCU, pins: ['VDD', 'GP5', 'GP4', 'GP3/MCLR', 'GP2', 'GP1', 'GP0', 'VSS'], tags: ['pic', 'pic12f675'] },
  { id: 'IC_PIC16F628A_DIP-18', base: 'DIP-18_W7.62mm', name: 'PIC16F628A/84A (DIP-18)', description: 'PIC16F628A/648A/84A в DIP-18', group: MCU, pins: ['RA2', 'RA3', 'RA4', 'RA5/MCLR', 'VSS', 'RB0', 'RB1', 'RB2', 'RB3', 'RB4', 'RB5', 'RB6', 'RB7', 'VDD', 'RA6', 'RA7', 'RA0', 'RA1'], tags: ['pic', 'pic16f628'] },
  { id: 'IC_CH340G_SOIC-16', base: 'SOIC-16_3.9x9.9mm_P1.27mm', name: 'CH340G (SOIC-16)', description: 'Преобразователь USB–UART CH340G (как на Arduino Nano). Кварц 12 МГц на XI/XO, V3 — конденсатор 100 нФ на землю при питании 5 В', group: DRV, pins: CH340G, tags: ['ch340', 'usb', 'uart'] },
  // --- таймеры и ОУ ---
  { id: 'IC_NE555_DIP-8', base: 'DIP-8_W7.62mm', name: 'NE555 (DIP-8)', description: 'Таймер NE555/LM555/ICM7555 в DIP-8', group: AMP, pins: NE555, tags: ['555', 'timer'] },
  { id: 'IC_NE555_SOIC-8', base: 'SOIC-8_3.9x4.9mm_P1.27mm', name: 'NE555 (SOIC-8)', description: 'Таймер NE555 в SOIC-8', group: AMP, pins: NE555, tags: ['555', 'timer'] },
  { id: 'IC_NE556_DIP-14', base: 'DIP-14_W7.62mm', name: 'NE556 (DIP-14)', description: 'Сдвоенный таймер NE556 в DIP-14', group: AMP, pins: ['DIS1', 'THR1', 'CTR1', 'RST1', 'OUT1', 'TRG1', 'GND', 'TRG2', 'OUT2', 'RST2', 'CTR2', 'THR2', 'DIS2', 'VCC'], tags: ['556', 'timer'] },
  { id: 'IC_LM358_DIP-8', base: 'DIP-8_W7.62mm', name: 'LM358 / TL072 / NE5532 (DIP-8)', description: 'Сдвоенный ОУ или компаратор в DIP-8: LM358, LM2904, TL072, TL082, NE5532, MCP6002, LM393', group: AMP, pins: DUAL_OPAMP, tags: ['lm358', 'tl072', 'lm393', 'opamp', 'comparator'] },
  { id: 'IC_LM358_SOIC-8', base: 'SOIC-8_3.9x4.9mm_P1.27mm', name: 'LM358 / LM393 (SOIC-8)', description: 'Сдвоенный ОУ или компаратор в SOIC-8: LM358, LM393, TL072, NE5532', group: AMP, pins: DUAL_OPAMP, tags: ['lm358', 'lm393', 'opamp'] },
  { id: 'IC_LM324_DIP-14', base: 'DIP-14_W7.62mm', name: 'LM324 / TL074 (DIP-14)', description: 'Счетверённый ОУ в DIP-14: LM324, TL074, TL084, LM2902', group: AMP, pins: QUAD_OPAMP, tags: ['lm324', 'tl074', 'opamp'] },
  { id: 'IC_LM339_DIP-14', base: 'DIP-14_W7.62mm', name: 'LM339 (DIP-14)', description: 'Счетверённый компаратор LM339/LM2901 в DIP-14 (распиновка отличается от LM324)', group: AMP, pins: LM339, tags: ['lm339', 'comparator'] },
  { id: 'IC_LM741_DIP-8', base: 'DIP-8_W7.62mm', name: 'LM741 / OP07 / CA3140 (DIP-8)', description: 'Одиночный ОУ в DIP-8: LM741, OP07, CA3140, LF356, TL071', group: AMP, pins: SINGLE_OPAMP, tags: ['lm741', 'op07', 'opamp'] },
  { id: 'IC_LM386_DIP-8', base: 'DIP-8_W7.62mm', name: 'LM386 (DIP-8)', description: 'Усилитель мощности звука LM386 в DIP-8', group: AMP, pins: ['GAIN', 'IN-', 'IN+', 'GND', 'OUT', 'VS', 'BYP', 'GAIN'], tags: ['lm386', 'audio'] },
  { id: 'IC_TDA2030_TO-220-5', base: 'TO-220-5_Vertical', name: 'TDA2030 / LM1875 (TO-220-5)', description: 'Усилитель мощности TDA2030A/TDA2050/LM1875 в TO-220-5', group: AMP, pins: ['IN+', 'IN-', 'V-', 'OUT', 'V+'], tags: ['tda2030', 'audio'] },
  // --- логика ---
  { id: 'IC_74HC595_DIP-16', base: 'DIP-16_W7.62mm', name: '74HC595 (DIP-16)', description: 'Сдвиговый регистр 74HC595: DS — данные, SHCP — такт, STCP — защёлка, OE — разрешение (активный 0), MR — сброс (активный 0)', group: LOGIC, pins: HC595, tags: ['74hc595', 'shift register'] },
  { id: 'IC_74HC595_SOIC-16', base: 'SOIC-16_3.9x9.9mm_P1.27mm', name: '74HC595 (SOIC-16)', description: 'Сдвиговый регистр 74HC595 в SOIC-16', group: LOGIC, pins: HC595, tags: ['74hc595'] },
  { id: 'IC_74HC165_DIP-16', base: 'DIP-16_W7.62mm', name: '74HC165 (DIP-16)', description: 'Сдвиговый регистр на ввод 74HC165 (параллельно → последовательно)', group: LOGIC, pins: HC165, tags: ['74hc165'] },
  { id: 'IC_74HC00_DIP-14', base: 'DIP-14_W7.62mm', name: '74HC00/08/32/86 (DIP-14)', description: 'Четыре элемента на 2 входа: 74HC00 (И-НЕ), 74HC08 (И), 74HC32 (ИЛИ), 74HC86 (исключающее ИЛИ); К155ЛА3', group: LOGIC, pins: GATE4, tags: ['74hc00', '74hc08', '74hc32', '74hc86'] },
  { id: 'IC_74HC02_DIP-14', base: 'DIP-14_W7.62mm', name: '74HC02 (DIP-14)', description: 'Четыре элемента ИЛИ-НЕ 74HC02 (распиновка отличается от 74HC00)', group: LOGIC, pins: NOR4, tags: ['74hc02'] },
  { id: 'IC_74HC04_DIP-14', base: 'DIP-14_W7.62mm', name: '74HC04/14 (DIP-14)', description: 'Шесть инверторов: 74HC04, 74HC14 (с триггером Шмитта), CD40106', group: LOGIC, pins: HEX_INV, tags: ['74hc04', '74hc14'] },
  { id: 'IC_74HC138_DIP-16', base: 'DIP-16_W7.62mm', name: '74HC138 (DIP-16)', description: 'Дешифратор 3→8 74HC138', group: LOGIC, pins: ['A0', 'A1', 'A2', 'E1', 'E2', 'E3', 'Y7', 'GND', 'Y6', 'Y5', 'Y4', 'Y3', 'Y2', 'Y1', 'Y0', 'VCC'], tags: ['74hc138'] },
  { id: 'IC_CD4051_DIP-16', base: 'DIP-16_W7.62mm', name: 'CD4051 / 74HC4051 (DIP-16)', description: 'Аналоговый мультиплексор 8→1 CD4051/74HC4051: S0–S2 — выбор канала, Z — общий', group: LOGIC, pins: ['Y4', 'Y6', 'Z', 'Y7', 'Y5', 'E', 'VEE', 'GND', 'S2', 'S1', 'S0', 'Y3', 'Y0', 'Y1', 'Y2', 'VCC'], tags: ['cd4051', '74hc4051', 'mux'] },
  { id: 'IC_CD4017_DIP-16', base: 'DIP-16_W7.62mm', name: 'CD4017 (DIP-16)', description: 'Десятичный счётчик CD4017 (бегущие огни)', group: LOGIC, pins: ['Q5', 'Q1', 'Q0', 'Q2', 'Q6', 'Q7', 'Q3', 'VSS', 'Q8', 'Q4', 'Q9', 'CO', 'CE', 'CLK', 'RST', 'VDD'], tags: ['cd4017', 'counter'] },
  // --- драйверы и интерфейсы ---
  { id: 'IC_ULN2003_DIP-16', base: 'DIP-16_W7.62mm', name: 'ULN2003 (DIP-16)', description: 'Семь ключей Дарлингтона ULN2003/ULN2003A (реле, шаговый 28BYJ-48). COM — к плюсу нагрузки (диоды)', group: DRV, pins: [...range('IN', 1, 7), 'GND', 'COM', ...range('OUT', 7, 1)], tags: ['uln2003', 'driver'] },
  { id: 'IC_ULN2803_DIP-18', base: 'DIP-18_W7.62mm', name: 'ULN2803 (DIP-18)', description: 'Восемь ключей Дарлингтона ULN2803A', group: DRV, pins: [...range('IN', 1, 8), 'GND', 'COM', ...range('OUT', 8, 1)], tags: ['uln2803', 'driver'] },
  { id: 'IC_L293D_DIP-16', base: 'DIP-16_W7.62mm', name: 'L293D (DIP-16)', description: 'Сдвоенный мостовой драйвер двигателей L293D/SN754410: VS (8) — питание моторов, VSS (16) — логика 5 В; средние GND — теплоотвод', group: DRV, pins: ['EN12', 'IN1', 'OUT1', 'GND', 'GND', 'OUT2', 'IN2', 'VS', 'EN34', 'IN3', 'OUT3', 'GND', 'GND', 'OUT4', 'IN4', 'VSS'], tags: ['l293d', 'motor', 'driver'] },
  { id: 'IC_MAX232_DIP-16', base: 'DIP-16_W7.62mm', name: 'MAX232 (DIP-16)', description: 'Преобразователь уровней RS-232 MAX232/MAX3232 (четыре конденсатора накачки)', group: DRV, pins: ['C1+', 'V+', 'C1-', 'C2+', 'C2-', 'V-', 'T2OUT', 'R2IN', 'R2OUT', 'T2IN', 'T1IN', 'R1OUT', 'R1IN', 'T1OUT', 'GND', 'VCC'], tags: ['max232', 'rs232'] },
  { id: 'IC_MAX485_DIP-8', base: 'DIP-8_W7.62mm', name: 'MAX485 (DIP-8)', description: 'Приёмопередатчик RS-485 MAX485/MAX487/SN75176: RO — к RX, DI — к TX, RE и DE — направление', group: DRV, pins: MAX485, tags: ['max485', 'rs485', 'modbus'] },
  { id: 'IC_MAX485_SOIC-8', base: 'SOIC-8_3.9x4.9mm_P1.27mm', name: 'MAX485 (SOIC-8)', description: 'Приёмопередатчик RS-485 MAX485/SP3485 в SOIC-8', group: DRV, pins: MAX485, tags: ['max485', 'rs485'] },
  { id: 'IC_MCP2515_DIP-18', base: 'DIP-18_W7.62mm', name: 'MCP2515 (DIP-18)', description: 'Контроллер CAN MCP2515 с SPI (к нему — трансивер TJA1050/MCP2551)', group: DRV, pins: ['TXCAN', 'RXCAN', 'CLKOUT', 'TX0RTS', 'TX1RTS', 'TX2RTS', 'OSC2', 'OSC1', 'VSS', 'RX1BF', 'RX0BF', 'INT', 'SCK', 'SI', 'SO', 'CS', 'RST', 'VDD'], tags: ['mcp2515', 'can'] },
  { id: 'IC_TJA1050_SOIC-8', base: 'SOIC-8_3.9x4.9mm_P1.27mm', name: 'TJA1050 / MCP2551 (SOIC-8)', description: 'Трансивер шины CAN TJA1050/MCP2551/SN65HVD230', group: DRV, pins: ['TXD', 'GND', 'VCC', 'RXD', 'VREF', 'CANL', 'CANH', 'RS'], tags: ['tja1050', 'can'] },
  // --- память, часы, АЦП, расширители ---
  { id: 'IC_DS1307_DIP-8', base: 'DIP-8_W7.62mm', name: 'DS1307 (DIP-8)', description: 'Часы реального времени DS1307: кварц 32,768 кГц на X1/X2, батарейка на VBAT', group: MEM, pins: DS1307, tags: ['ds1307', 'rtc'] },
  { id: 'IC_24C256_DIP-8', base: 'DIP-8_W7.62mm', name: 'AT24C02…256 (DIP-8)', description: 'EEPROM I²C 24C02/04/08/16/32/64/128/256: A0–A2 — адрес, WP — защита записи', group: MEM, pins: EEPROM24, tags: ['24c02', '24c256', 'eeprom', 'i2c'] },
  { id: 'IC_24C256_SOIC-8', base: 'SOIC-8_3.9x4.9mm_P1.27mm', name: 'AT24Cxx (SOIC-8)', description: 'EEPROM I²C 24Cxx в SOIC-8', group: MEM, pins: EEPROM24, tags: ['24c256', 'eeprom'] },
  { id: 'IC_W25Q32_SOIC-8', base: 'SOIC-8_5.23x5.23mm_P1.27mm_EIAJ', name: 'W25Q32/64/128 (SOIC-8 широкий)', description: 'Flash SPI W25Qxx в SOIC-8 208 mil', group: MEM, pins: ['CS', 'DO', 'WP', 'GND', 'DI', 'CLK', 'HOLD', 'VCC'], tags: ['w25q', 'flash', 'spi'] },
  { id: 'IC_PCF8574_DIP-16', base: 'DIP-16_W7.62mm', name: 'PCF8574 (DIP-16)', description: 'Расширитель портов I²C на 8 выводов PCF8574/PCF8574A (как в переходнике LCD1602)', group: MEM, pins: PCF8574, tags: ['pcf8574', 'i2c', 'expander'] },
  { id: 'IC_MCP23017_DIP-28', base: 'DIP-28_W7.62mm', name: 'MCP23017 (DIP-28)', description: 'Расширитель портов I²C на 16 выводов MCP23017', group: MEM, pins: [...range('GPB', 0, 7), 'VDD', 'VSS', 'NC', 'SCL', 'SDA', 'NC', 'A0', 'A1', 'A2', 'RST', 'INTB', 'INTA', ...range('GPA', 0, 7)], tags: ['mcp23017', 'i2c', 'expander'] },
  { id: 'IC_MCP3008_DIP-16', base: 'DIP-16_W7.62mm', name: 'MCP3008 (DIP-16)', description: 'АЦП 10 бит, 8 каналов, SPI — MCP3008 (MCP3208 — 12 бит, та же распиновка)', group: MEM, pins: [...range('CH', 0, 7), 'DGND', 'CS', 'DIN', 'DOUT', 'CLK', 'AGND', 'VREF', 'VDD'], tags: ['mcp3008', 'adc', 'spi'] },
  { id: 'IC_HX711_SOP-16', base: 'SOP-16_5.3x10.3mm_P1.27mm', name: 'HX711 (SOP-16)', description: 'АЦП 24 бита для тензодатчиков HX711', group: MEM, pins: ['VSUP', 'BASE', 'AVDD', 'VFB', 'AGND', 'VBG', 'INA-', 'INA+', 'INB-', 'INB+', 'PD_SCK', 'DOUT', 'XO', 'XI', 'RATE', 'DVDD'], tags: ['hx711', 'adc', 'load cell'] },
  // --- оптроны ---
  { id: 'IC_PC817_DIP-4', base: 'Opto_DIP-4_W7.62mm', name: 'PC817 (DIP-4)', description: 'Оптрон PC817/EL817/LTV817: светодиод 1–2, транзистор 3–4', group: OPTO, pins: ['A', 'K', 'E', 'C'], tags: ['pc817', 'opto'] },
  { id: 'IC_MOC3021_DIP-6', base: 'Opto_DIP-6_W7.62mm', name: 'MOC3021/3041/3063 (DIP-6)', description: 'Оптосимистор MOC3021/3023 (случайная фаза) или MOC3041/3063 (переход через ноль): светодиод 1–2, симистор 4–6', group: OPTO, pins: MOC30, tags: ['moc3021', 'moc3063', 'triac', 'opto'] },
  { id: 'IC_4N35_DIP-6', base: 'Opto_DIP-6_W7.62mm', name: '4N25/4N35 (DIP-6)', description: 'Оптрон с транзистором 4N25/4N35/4N33', group: OPTO, pins: ['A', 'K', 'NC', 'E', 'C', 'B'], tags: ['4n35', 'opto'] },
  { id: 'IC_6N137_DIP-8', base: 'Opto_DIP-8_W7.62mm', name: '6N137 (DIP-8)', description: 'Быстрый оптрон 6N137 (10 Мбит/с): VE — разрешение, нужен конденсатор 100 нФ у VCC', group: OPTO, pins: ['NC', 'A', 'K', 'NC', 'GND', 'VO', 'VE', 'VCC'], tags: ['6n137', 'opto'] },
  // --- стабилизаторы ---
  { id: 'REG_7805_TO-220', base: 'TO-220-3_Vertical', name: '7805/7812 (TO-220)', description: 'Линейный стабилизатор L7805/7809/7812/7815 (положительный): вход, земля, выход', group: REG, category: CAT.PS, refPrefix: 'U', pins: ['IN', 'GND', 'OUT'], tags: ['7805', '7812', 'regulator'] },
  { id: 'REG_7905_TO-220', base: 'TO-220-3_Vertical', name: '7905/7912 (TO-220)', description: 'Отрицательный стабилизатор 7905/7912: распиновка отличается от 7805', group: REG, category: CAT.PS, refPrefix: 'U', pins: ['GND', 'IN', 'OUT'], tags: ['7905', 'regulator'] },
  { id: 'REG_LM317_TO-220', base: 'TO-220-3_Vertical', name: 'LM317 (TO-220)', description: 'Регулируемый стабилизатор LM317: ADJ, выход, вход', group: REG, category: CAT.PS, refPrefix: 'U', pins: ['ADJ', 'OUT', 'IN'], tags: ['lm317', 'regulator'] },
  { id: 'REG_AMS1117_SOT-223', base: 'SOT-223', name: 'AMS1117 (SOT-223)', description: 'Стабилизатор AMS1117/LM1117 3,3 или 5 В: 1 — GND (ADJ), 2 и теплоотвод — выход, 3 — вход', group: REG, category: CAT.PS, refPrefix: 'U', pins: ['GND', 'OUT', 'IN', 'OUT'], tags: ['ams1117', 'lm1117', 'ldo'] },
  { id: 'REG_78L05_TO-92', base: 'TO-92_Inline', name: '78L05 (TO-92)', description: 'Маломощный стабилизатор 78L05/78L33: выход, земля, вход', group: REG, category: CAT.PS, refPrefix: 'U', pins: ['OUT', 'GND', 'IN'], tags: ['78l05', 'regulator'] },
  { id: 'REG_TL431_TO-92', base: 'TO-92_Inline', name: 'TL431 (TO-92)', description: 'Регулируемый стабилитрон TL431: управляющий, анод, катод', group: REG, category: CAT.PS, refPrefix: 'U', pins: ['REF', 'A', 'K'], tags: ['tl431', 'reference'] },
  { id: 'REG_HT7333_TO-92', base: 'TO-92_Inline', name: 'HT7333/HT7550 (TO-92)', description: 'Малопотребляющий стабилизатор HT73xx/HT75xx: земля, вход, выход', group: REG, category: CAT.PS, refPrefix: 'U', pins: ['GND', 'IN', 'OUT'], tags: ['ht7333', 'ldo'] },
  // --- транзисторы, тиристоры и датчики в TO-92/TO-220 ---
  { id: 'Q_S8050_TO-92', base: 'TO-92_Inline', name: 'S8050/2N2222/2N3904 (TO-92, ЭБК)', description: 'NPN/PNP в TO-92 с выводами Э-Б-К: S8050, S8550, 2N2222A, 2N3904, 2N3906, 2N5551, S9013, S9014', group: TR, category: CAT.Q, refPrefix: 'Q', pins: ['E', 'B', 'C'], tags: ['s8050', '2n2222', '2n3904', 'npn'] },
  { id: 'Q_BC547_TO-92', base: 'TO-92_Inline', name: 'BC547/BC337 (TO-92, КБЭ)', description: 'NPN/PNP в TO-92 с выводами К-Б-Э: BC547, BC548, BC557, BC337, BC327', group: TR, category: CAT.Q, refPrefix: 'Q', pins: ['C', 'B', 'E'], tags: ['bc547', 'bc337', 'npn'] },
  { id: 'Q_2N7000_TO-92', base: 'TO-92_Inline', name: '2N7000 (TO-92, ИЗС)', description: 'Полевой N-канальный 2N7000: исток, затвор, сток', group: TR, category: CAT.Q, refPrefix: 'Q', pins: ['S', 'G', 'D'], tags: ['2n7000', 'mosfet'] },
  { id: 'Q_BS170_TO-92', base: 'TO-92_Inline', name: 'BS170 (TO-92, СЗИ)', description: 'Полевой N-канальный BS170: сток, затвор, исток (обратный порядок от 2N7000)', group: TR, category: CAT.Q, refPrefix: 'Q', pins: ['D', 'G', 'S'], tags: ['bs170', 'mosfet'] },
  { id: 'Q_IRFZ44N_TO-220', base: 'TO-220-3_Vertical', name: 'IRFZ44N/IRF540/IRLZ44N (TO-220, ЗСИ)', description: 'Полевые N-канальные в TO-220: IRFZ44N, IRLZ44N, IRF540N, IRF520, IRF3205, IRF640 — затвор, сток, исток', group: TR, category: CAT.Q, refPrefix: 'Q', pins: ['G', 'D', 'S'], tags: ['irfz44n', 'irf540', 'irf520', 'mosfet'] },
  { id: 'Q_TIP120_TO-220', base: 'TO-220-3_Vertical', name: 'TIP120/TIP31/TIP41 (TO-220, БКЭ)', description: 'Биполярные в TO-220: TIP120/122/125/127 (Дарлингтон), TIP31/32, TIP41/42 — база, коллектор, эмиттер', group: TR, category: CAT.Q, refPrefix: 'Q', pins: ['B', 'C', 'E'], tags: ['tip120', 'tip41', 'darlington'] },
  { id: 'Q_BD139_TO-126', base: 'TO-126-3_Vertical', name: 'BD139/BD140 (TO-126, ЭКБ)', description: 'Биполярные в TO-126: BD135–BD140 — эмиттер, коллектор, база', group: TR, category: CAT.Q, refPrefix: 'Q', pins: ['E', 'C', 'B'], tags: ['bd139', 'bd140'] },
  { id: 'Q_BTA16_TO-220', base: 'TO-220-3_Vertical', name: 'BTA16/BTA41/BT136 (TO-220, симистор)', description: 'Симисторы BTA12/16/24/41, BT136/137/139: T1 (MT1), T2 (MT2), управляющий электрод', group: TR, category: CAT.Q, refPrefix: 'Q', pins: ['T1', 'T2', 'G'], tags: ['bta16', 'bta41', 'bt136', 'triac'] },
  { id: 'Q_BT151_TO-220', base: 'TO-220-3_Vertical', name: 'BT151 (TO-220, тиристор)', description: 'Тиристор BT151/BT152/TYN612: катод, анод, управляющий электрод', group: TR, category: CAT.Q, refPrefix: 'Q', pins: ['K', 'A', 'G'], tags: ['bt151', 'scr'] },
  { id: 'Q_AO3400_SOT-23', base: 'SOT-23', name: 'AO3400/SI2302 (SOT-23)', description: 'Полевые N-канальные в SOT-23: AO3400, SI2302, 2N7002 — затвор, исток, сток', group: TR, category: CAT.Q, refPrefix: 'Q', pins: ['G', 'S', 'D'], tags: ['ao3400', '2n7002', 'mosfet'] },
  { id: 'Q_MMBT3904_SOT-23', base: 'SOT-23', name: 'MMBT3904/BC847/S8050 (SOT-23)', description: 'Биполярные в SOT-23: MMBT3904/3906, BC847/857, MMBT2222A, S8050 (J3Y) — база, эмиттер, коллектор', group: TR, category: CAT.Q, refPrefix: 'Q', pins: ['B', 'E', 'C'], tags: ['mmbt3904', 'bc847', 'npn'] },
  { id: 'SENS_A3144_TO-92', base: 'TO-92_Inline', name: 'A3144/SS49E (TO-92S)', description: 'Датчик Холла A3144 (цифровой) или SS49E/49E (аналоговый): питание, земля, выход', group: 'Прочие', category: CAT.SENS, refPrefix: 'U', pins: ['VCC', 'GND', 'OUT'], tags: ['a3144', 'hall', 'ss49e'] },
];

/** Собирает корпуса с распиновкой; base — готовые корпуса библиотеки по идентификатору. */
export function namedChips(base: Map<string, FootprintDef>): FootprintDef[] {
  const out: FootprintDef[] = [];
  for (const s of CHIP_SPECS) {
    const b = base.get(s.base);
    if (!b) throw new Error(`Нет корпуса-основы ${s.base} для ${s.id}`);
    const numbered = b.pads.filter((p) => p.type !== 'npth');
    const pads = b.pads.map((p) => {
      const i = Number(p.number) - 1;
      const nm = p.type !== 'npth' && Number.isInteger(i) && i >= 0 && i < s.pins.length ? s.pins[i] : undefined;
      return nm ? { ...p, name: nm } : { ...p };
    });
    if (s.pins.length > numbered.length) throw new Error(`${s.id}: имён ${s.pins.length}, выводов ${numbered.length}`);
    out.push({
      ...b,
      id: s.id,
      name: s.name,
      description: s.description,
      category: s.category ?? CAT.U,
      group: s.group,
      tags: [...(b.tags ?? []), ...(s.tags ?? [])],
      refPrefix: s.refPrefix ?? b.refPrefix ?? 'U',
      pads,
      // Сверена распиновка по даташиту; размеры — как у корпуса-основы.
      source: `Распиновка по даташиту; корпус ${b.name}`,
      // Подписи выводов основы (если были) заменяются новыми.
      graphics: b.graphics.filter((g) => !(g.kind === 'text' && g.layer === 'F.Silk' && !g.text.includes('${'))),
    });
  }
  return out;
}
