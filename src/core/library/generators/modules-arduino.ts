import { CAT } from '../categories';
import { twoRows, type HeaderRow, type ModuleSpec } from './modules';

/*
 * Модули для Arduino: набор датчиков KY, платки GY, газовые MQ, драйверы, радио,
 * дисплеи, звук, питание, шилд Uno. Габариты платок и порядок выводов — как у самых
 * распространённых платок с Aliexpress; у клонов бывает иначе, поэтому все модули
 * помечены «сверить»: перед заказом платы сравните подписи с надписями на вашей платке.
 */

const NOTE = '. Порядок выводов — как на типовой платке, сверьте с надписями на своей';

const SENS = CAT.SENS;
const G = {
  temp: 'Температура и влажность',
  move: 'Движение и расстояние',
  power: 'Ток и напряжение',
  gas: 'Давление и газ',
  light: 'Свет и цвет',
  sound: 'Звук и вибрация',
  ky: 'Набор KY',
  other: 'Прочие',
  rf: 'Радио и связь',
  wifi: 'Wi-Fi и Bluetooth',
  drv: 'Драйверы и силовые',
  audio: 'Звук',
  input: 'Ввод',
  mcu: 'Микроконтроллеры',
  ps: 'DC-DC',
  lcd: 'ЖК и OLED модули',
  relay: 'Модули',
};

interface Opt {
  group: string;
  category?: string;
  refPrefix?: string;
  height?: number;
  tags?: string[];
  /** Где ряд штырей: по нижнему краю (по умолчанию) или по левому. */
  side?: 'bottom' | 'left';
  pitch?: number;
  padDiameter?: number;
  drill?: number;
  fab?: [number, number, number, number][];
}

/** Платка W×H с одним рядом штырей по краю. */
function one(id: string, name: string, description: string, board: [number, number], pins: string[], o: Opt): ModuleSpec {
  const [w, h] = board;
  const pitch = o.pitch ?? 2.54;
  const span = ((pins.length - 1) * pitch) / 2;
  const left = o.side === 'left';
  const rows: HeaderRow[] = left ? [{ at: [0, -span], dir: 'y', pitch, names: pins, markFirst: true }] : [{ at: [-span, 0], dir: 'x', pitch, names: pins, markFirst: true }];
  return {
    id,
    name,
    description: description + NOTE,
    board,
    offset: left ? [w / 2 - 1.6, 0] : [0, -(h / 2 - 1.6)],
    rows,
    group: o.group,
    category: o.category ?? CAT.M,
    refPrefix: o.refPrefix ?? 'M',
    height: o.height ?? 6,
    tags: ['arduino', ...(o.tags ?? [])],
    padDiameter: o.padDiameter,
    drill: o.drill,
    fab: o.fab,
    verified: false,
  };
}

/** Платка с двумя рядами: слева и справа (вдоль Y), имена сверху вниз. */
function sides(id: string, name: string, description: string, board: [number, number], leftPins: string[], rightPins: string[], o: Opt): ModuleSpec {
  const [w] = board;
  const x = w / 2 - 1.6;
  const lspan = ((leftPins.length - 1) * 2.54) / 2;
  const rspan = ((rightPins.length - 1) * 2.54) / 2;
  const rows: HeaderRow[] = [
    { at: [-x, -lspan], dir: 'y', names: leftPins, markFirst: true },
    { at: [x, -rspan], dir: 'y', names: rightPins },
  ];
  return { id, name, description: description + NOTE, board, rows, group: o.group, category: o.category ?? CAT.M, refPrefix: o.refPrefix ?? 'M', height: o.height ?? 6, tags: ['arduino', ...(o.tags ?? [])], padDiameter: o.padDiameter, drill: o.drill, verified: false };
}

const ky3 = (n: string, what: string, tags: string[], pins = ['S', '+', '-']) => one(`Module_KY-${n}`, `KY-${n} ${what}`, `Модуль KY-${n}: ${what.toLowerCase()}, платка 18,5×15 мм, 3 штыря: S — сигнал, «+» — питание, «−» — земля`, [18.5, 15], pins, { group: G.ky, category: SENS, refPrefix: 'M', tags: ['ky', `ky-${n}`, ...tags] });
const ky4 = (n: string, what: string, tags: string[]) => one(`Module_KY-${n}`, `KY-${n} ${what}`, `Модуль KY-${n}: ${what.toLowerCase()} с компаратором LM393, платка 32×14 мм, 4 штыря: A0 — аналоговый выход, G — земля, «+» — питание, D0 — цифровой выход (порог — подстроечником)`, [32, 14], ['A0', 'G', '+', 'D0'], { group: G.ky, category: SENS, tags: ['ky', `ky-${n}`, 'lm393', ...tags] });
const lm393 = (id: string, name: string, what: string, board: [number, number], tags: string[], group = G.other) => one(id, name, `${what}, платка с компаратором LM393 ${board[0]}×${board[1]} мм: VCC, GND, DO — цифровой выход (порог подстроечником), AO — аналоговый`, board, ['VCC', 'GND', 'DO', 'AO'], { group, category: SENS, tags });
const mq = (n: string, gas: string) => lm393(`Module_MQ-${n}`, `MQ-${n} ${gas}`, `Датчик газа MQ-${n} (${gas}), нагреватель около 150 мА от 5 В`, [32, 22], ['mq', `mq-${n}`, 'gas'], G.gas);
const i2c4 = (id: string, name: string, what: string, board: [number, number], tags: string[], group: string, pins = ['VIN', 'GND', 'SCL', 'SDA']) => one(id, name, `${what}, I²C, платка ${board[0]}×${board[1]} мм`, board, pins, { group, category: SENS, tags: ['i2c', ...tags] });

const U = (mx: number, my: number): [number, number] => [+(mx * 0.0254 - 34.29).toFixed(3), +((2100 - my) * 0.0254 - 26.67).toFixed(3)];

export const ARDUINO_MODULES: ModuleSpec[] = [
  // ---------- набор KY ----------
  ky3('001', 'Датчик температуры DS18B20', ['ds18b20', 'temperature']),
  ky3('002', 'Датчик вибрации', ['vibration']),
  ky3('003', 'Датчик Холла', ['hall', 'magnet']),
  ky3('004', 'Кнопка', ['button']),
  ky3('005', 'ИК-светодиод', ['ir', 'led']),
  ky3('006', 'Пассивный зуммер', ['buzzer']),
  ky3('008', 'Лазер 650 нм', ['laser']),
  { ...ky3('009', 'RGB-светодиод SMD', ['rgb', 'led'], ['B', 'G', 'R', '-']), description: 'Модуль KY-009: RGB-светодиод 5050, платка 18,5×15 мм, 4 штыря: B, G, R, «−» общий' + NOTE },
  ky3('010', 'Оптопрерыватель', ['optical', 'interrupter']),
  ky3('011', 'Двухцветный светодиод 5 мм', ['led', 'bicolor'], ['-', 'R', 'G']),
  ky3('012', 'Активный зуммер', ['buzzer']),
  ky3('013', 'Аналоговый термистор', ['ntc', 'temperature']),
  ky3('015', 'Датчик DHT11', ['dht11', 'humidity']),
  { ...ky3('016', 'RGB-светодиод 5 мм', ['rgb', 'led'], ['R', 'G', 'B', '-']), description: 'Модуль KY-016: RGB-светодиод 5 мм с резисторами, 4 штыря: R, G, B, «−» общий' + NOTE },
  ky3('017', 'Ртутный датчик наклона', ['tilt']),
  ky3('018', 'Фоторезистор', ['ldr', 'light']),
  ky3('019', 'Реле 5 В', ['relay']),
  ky3('020', 'Датчик наклона (шарик)', ['tilt']),
  ky3('021', 'Геркон мини', ['reed', 'magnet']),
  ky3('022', 'ИК-приёмник 38 кГц', ['ir', 'receiver', 'vs1838']),
  ky4('024', 'Линейный датчик Холла', ['hall']),
  ky4('025', 'Геркон', ['reed']),
  ky4('026', 'Датчик пламени', ['flame']),
  { ...ky3('027', 'Волшебная чашка', ['tilt', 'led'], ['G', '+', 'S', 'L']), description: 'Модуль KY-027: ртутный датчик с светодиодом, 4 штыря: G, «+», S — датчик, L — светодиод' + NOTE },
  ky4('028', 'Цифровой датчик температуры', ['ntc', 'temperature']),
  ky3('029', 'Двухцветный светодиод 3 мм', ['led', 'bicolor'], ['-', 'R', 'G']),
  ky3('031', 'Датчик удара', ['knock']),
  { ...ky3('032', 'ИК-датчик препятствия', ['ir', 'obstacle'], ['GND', '+', 'OUT', 'EN']), description: 'Модуль KY-032: ИК-датчик препятствия с регулировкой дальности, 4 штыря: GND, «+», OUT, EN' + NOTE },
  ky3('033', 'Датчик линии', ['line', 'tracking'], ['G', 'V+', 'S']),
  ky3('034', 'Мигающий 7-цветный светодиод', ['led']),
  ky3('035', 'Аналоговый датчик Холла', ['hall']),
  ky4('036', 'Сенсорный датчик', ['touch']),
  ky4('037', 'Микрофон чувствительный', ['sound', 'microphone']),
  ky4('038', 'Микрофон', ['sound', 'microphone']),
  ky3('039', 'Датчик пульса', ['pulse', 'heart']),
  one('Module_KY-040', 'KY-040 Энкодер', 'Модуль KY-040: механический энкодер с кнопкой, платка 26×19 мм, 5 штырей: CLK, DT, SW — кнопка, «+», GND', [26, 19], ['CLK', 'DT', 'SW', '+', 'GND'], { group: G.input, tags: ['ky', 'ky-040', 'encoder'], height: 20 }),
  // ---------- датчики с компаратором и газовые ----------
  lm393('Module_Soil_Moisture_FC-28', 'Влажность почвы FC-28', 'Датчик влажности почвы FC-28/YL-69 (плата компаратора; щуп — отдельно на 2 провода)', [32, 14], ['soil', 'moisture'], G.other),
  one('Module_Soil_Capacitive_v1.2', 'Влажность почвы ёмкостный v1.2', 'Ёмкостный датчик влажности почвы v1.2, 98×23 мм: GND, VCC, AOUT', [23, 98], ['GND', 'VCC', 'AOUT'], { group: G.other, category: SENS, tags: ['soil', 'capacitive'] }),
  lm393('Module_Rain_FC-37', 'Дождь FC-37', 'Датчик дождя FC-37/YL-83 (плата компаратора; пластина — отдельно)', [32, 14], ['rain']),
  lm393('Module_Light_LDR', 'Датчик света (LDR)', 'Датчик освещённости на фоторезисторе', [32, 14], ['ldr', 'light'], G.light),
  lm393('Module_Flame_IR', 'Датчик пламени', 'ИК-датчик пламени 760–1100 нм', [32, 14], ['flame'], G.light),
  lm393('Module_Sound_LM393', 'Датчик звука', 'Датчик звука с электретным микрофоном', [32, 14], ['sound', 'microphone'], G.sound),
  lm393('Module_TCRT5000_Line', 'TCRT5000 датчик линии', 'Отражательный ИК-датчик линии TCRT5000', [32, 10], ['tcrt5000', 'line'], G.move),
  one('Module_IR_Obstacle_FC-51', 'ИК-датчик препятствия FC-51', 'ИК-датчик препятствия FC-51, 31×14 мм: OUT, GND, VCC', [14, 31], ['OUT', 'GND', 'VCC'], { group: G.move, category: SENS, tags: ['ir', 'obstacle', 'fc-51'] }),
  one('Module_Vibration_SW-420', 'Вибрация SW-420', 'Датчик вибрации SW-420, 32×14 мм: VCC, GND, DO', [32, 14], ['VCC', 'GND', 'DO'], { group: G.sound, category: SENS, tags: ['vibration', 'sw-420'] }),
  one('Module_Water_Level', 'Уровень воды', 'Датчик уровня воды (гребёнка), 62×20 мм: S, «+», «−»', [20, 62], ['S', '+', '-'], { group: G.other, category: SENS, tags: ['water', 'level'] }),
  mq('2', 'дым, пропан'),
  mq('3', 'алкоголь'),
  mq('4', 'метан'),
  mq('5', 'природный газ'),
  mq('6', 'пропан-бутан'),
  mq('7', 'угарный газ'),
  mq('8', 'водород'),
  mq('9', 'CO и горючие'),
  mq('135', 'качество воздуха'),
  // ---------- расстояние и движение ----------
  one('Module_HC-SR04', 'HC-SR04 дальномер', 'Ультразвуковой дальномер HC-SR04, 45×20 мм: VCC, TRIG, ECHO, GND', [45, 20], ['VCC', 'TRIG', 'ECHO', 'GND'], { group: G.move, category: SENS, tags: ['hc-sr04', 'ultrasonic', 'distance'], height: 15 }),
  one('Module_JSN-SR04T', 'JSN-SR04T влагозащищённый', 'Плата влагозащищённого дальномера JSN-SR04T, 41×28 мм: 5V, TRIG, ECHO, GND', [41, 28], ['5V', 'TRIG', 'ECHO', 'GND'], { group: G.move, category: SENS, tags: ['jsn-sr04t', 'ultrasonic'] }),
  one('Module_HC-SR505_PIR', 'HC-SR505 мини PIR', 'Мини датчик движения HC-SR505, 10×23 мм: «+», OUT, «−»', [10, 23], ['+', 'OUT', '-'], { group: G.move, category: SENS, tags: ['pir', 'hc-sr505'], height: 20 }),
  one('Module_AM312_PIR', 'AM312 мини PIR', 'Мини датчик движения AM312: VCC, OUT, GND', [10, 16], ['VCC', 'OUT', 'GND'], { group: G.move, category: SENS, tags: ['pir', 'am312'], height: 15 }),
  one('Module_RCWL-0516_Radar', 'RCWL-0516 радар', 'Микроволновый датчик движения RCWL-0516, 36×17 мм: 3V3 (выход), GND, OUT, VIN 4–28 В, CDS', [36, 17], ['3V3', 'GND', 'OUT', 'VIN', 'CDS'], { group: G.move, category: SENS, tags: ['radar', 'rcwl-0516'] }),
  one('Module_VL53L0X', 'VL53L0X лазерный дальномер', 'Лазерный дальномер VL53L0X (GY-530), I²C, 25×11 мм: VIN, GND, SCL, SDA, GPIO1, XSHUT', [25, 11], ['VIN', 'GND', 'SCL', 'SDA', 'GPIO1', 'XSHUT'], { group: G.move, category: SENS, tags: ['vl53l0x', 'tof', 'i2c'] }),
  one('Module_VL53L1X', 'VL53L1X лазерный дальномер', 'Лазерный дальномер VL53L1X до 4 м, I²C: VIN, GND, SDA, SCL, XSHUT, GPIO1', [22, 13], ['VIN', 'GND', 'SDA', 'SCL', 'XSHUT', 'GPIO1'], { group: G.move, category: SENS, tags: ['vl53l1x', 'tof', 'i2c'] }),
  one('Module_ADXL345_GY-291', 'ADXL345 акселерометр', 'Акселерометр ADXL345 (GY-291), 20×15 мм: GND, VCC, CS, INT1, INT2, SDO, SDA, SCL', [20, 15], ['GND', 'VCC', 'CS', 'INT1', 'INT2', 'SDO', 'SDA', 'SCL'], { group: G.move, category: SENS, tags: ['adxl345', 'accelerometer', 'i2c'] }),
  one('Module_MPU9250', 'MPU-9250/6500 9 осей', 'Гироскоп-акселерометр-магнитометр MPU-9250/6500, 25×15 мм: VCC, GND, SCL, SDA, EDA, ECL, AD0, INT, NCS, FSYNC', [25, 15], ['VCC', 'GND', 'SCL', 'SDA', 'EDA', 'ECL', 'AD0', 'INT', 'NCS', 'FSYNC'], { group: G.move, category: SENS, tags: ['mpu9250', 'imu', 'i2c'] }),
  one('Module_QMC5883L_GY-273', 'QMC5883L/HMC5883L компас', 'Магнитометр (компас) GY-273 на QMC5883L/HMC5883L, 18×14 мм: VCC, GND, SCL, SDA, DRDY', [18, 14], ['VCC', 'GND', 'SCL', 'SDA', 'DRDY'], { group: G.move, category: SENS, tags: ['qmc5883l', 'hmc5883l', 'compass', 'i2c'] }),
  one('Module_AS5600', 'AS5600 угол поворота', 'Магнитный датчик угла AS5600: VCC, OUT, GND, DIR, SCL, SDA, GPO', [23, 23], ['VCC', 'OUT', 'GND', 'DIR', 'SCL', 'SDA', 'GPO'], { group: G.move, category: SENS, tags: ['as5600', 'encoder', 'i2c'] }),
  one('Module_GPS_NEO-6M', 'GPS NEO-6M', 'Приёмник GPS NEO-6M (GY-GPS6MV2), 25×35 мм, UART 9600: VCC, RX, TX, GND', [25, 35], ['VCC', 'RX', 'TX', 'GND'], { group: G.move, category: SENS, tags: ['gps', 'neo-6m', 'uart'] }),
  // ---------- температура, давление, воздух ----------
  one('Module_DHT11', 'DHT11 на платке', 'Датчик температуры и влажности DHT11 на платке с резистором, 28×12 мм: VCC, DATA, GND', [12, 28], ['VCC', 'DATA', 'GND'], { group: G.temp, category: SENS, tags: ['dht11', 'humidity'] }),
  one('Module_DHT22_Board', 'DHT22 на платке', 'Датчик DHT22/AM2302 на платке с резистором, 3 штыря: «+», OUT, «−»', [15, 38], ['+', 'OUT', '-'], { group: G.temp, category: SENS, tags: ['dht22', 'am2302'] }),
  one('Module_DS18B20_Board', 'DS18B20 на платке', 'Датчик DS18B20 на платке с подтяжкой 4,7 кОм: GND, DQ, VCC', [20, 15], ['GND', 'DQ', 'VCC'], { group: G.temp, category: SENS, tags: ['ds18b20', '1-wire'] }),
  i2c4('Module_BME280_4pin', 'BME280 (4 вывода)', 'Температура, влажность, давление BME280', [11, 13], ['bme280', 'pressure'], G.temp),
  i2c4('Module_BME280_6pin', 'BME280/BMP280 (6 выводов)', 'Датчик BME280/BMP280 (GY-BME280), I²C или SPI', [15, 11.5], ['bme280', 'bmp280', 'spi'], G.temp, ['VCC', 'GND', 'SCL', 'SDA', 'CSB', 'SDO']),
  i2c4('Module_BMP180_GY-68', 'BMP180 (GY-68)', 'Давление и температура BMP180', [13, 10], ['bmp180', 'pressure'], G.gas),
  i2c4('Module_AHT20', 'AHT10/AHT20', 'Температура и влажность AHT10/AHT20', [16, 11], ['aht20', 'aht10', 'humidity'], G.temp),
  i2c4('Module_SHT31', 'SHT31', 'Температура и влажность SHT31', [18, 13], ['sht31', 'humidity'], G.temp, ['VIN', 'GND', 'SCL', 'SDA', 'ADR', 'ALR']),
  i2c4('Module_HTU21D_GY-21', 'HTU21D/SHT21 (GY-21)', 'Температура и влажность HTU21D/SHT21/Si7021', [15, 12], ['htu21d', 'si7021', 'humidity'], G.temp),
  i2c4('Module_MLX90614_GY-906', 'MLX90614 ИК-термометр', 'Бесконтактный ИК-термометр MLX90614 (GY-906)', [11.5, 17], ['mlx90614', 'ir', 'thermometer'], G.temp),
  i2c4('Module_CCS811', 'CCS811 качество воздуха', 'Датчик eCO₂ и TVOC CCS811', [21, 15], ['ccs811', 'air'], G.gas, ['VCC', 'GND', 'SCL', 'SDA', 'WAK', 'INT', 'RST', 'ADD']),
  i2c4('Module_SGP30', 'SGP30 качество воздуха', 'Датчик eCO₂ и TVOC SGP30', [13, 12], ['sgp30', 'air'], G.gas),
  one('Module_MAX6675', 'MAX6675 термопара K', 'Преобразователь термопары K MAX6675, 25×15 мм, SPI: GND, VCC, SCK, CS, SO', [25, 15], ['GND', 'VCC', 'SCK', 'CS', 'SO'], { group: G.temp, category: SENS, tags: ['max6675', 'thermocouple', 'spi'] }),
  one('Module_MAX31865', 'MAX31865 PT100/PT1000', 'Преобразователь термосопротивления PT100/PT1000 MAX31865, SPI: VIN, GND, 3V3, CLK, SDO, SDI, CS, RDY', [28, 25], ['VIN', 'GND', '3V3', 'CLK', 'SDO', 'SDI', 'CS', 'RDY'], { group: G.temp, category: SENS, tags: ['max31865', 'pt100', 'spi'] }),
  // ---------- свет и цвет ----------
  i2c4('Module_BH1750_GY-30', 'BH1750 освещённость (GY-30)', 'Датчик освещённости BH1750', [18.5, 14], ['bh1750', 'lux'], G.light, ['VCC', 'GND', 'SCL', 'SDA', 'ADDR']),
  i2c4('Module_TSL2561', 'TSL2561 освещённость', 'Датчик освещённости TSL2561', [19, 16], ['tsl2561', 'lux'], G.light, ['VCC', 'GND', 'SCL', 'SDA', 'ADDR', 'INT']),
  i2c4('Module_APDS-9960', 'APDS-9960 жесты и цвет', 'Датчик жестов, приближения и цвета APDS-9960', [20, 15], ['apds9960', 'gesture'], G.light, ['VL', 'GND', 'VCC', 'SDA', 'SCL', 'INT']),
  i2c4('Module_TCS34725', 'TCS34725 цвет', 'Датчик цвета TCS34725 с подсветкой', [20, 20], ['tcs34725', 'color'], G.light, ['LED', 'INT', 'SDA', 'SCL', '3V3', 'GND', 'VIN']),
  i2c4('Module_MAX30102', 'MAX30102 пульс и SpO₂', 'Датчик пульса и кислорода MAX30102', [14, 14], ['max30102', 'pulse', 'spo2'], G.light, ['VIN', 'SCL', 'SDA', 'INT', 'IRD', 'RD', 'GND']),
  // ---------- ток, напряжение, вес ----------
  { ...sides('Module_HX711', 'HX711 тензодатчик', 'Модуль HX711 для тензодатчиков, 34×21 мм: слева к датчику E+, E−, A−, A+, B−, B+; справа к контроллеру GND, DT, SCK, VCC', [34, 21], ['E+', 'E-', 'A-', 'A+', 'B-', 'B+'], ['GND', 'DT', 'SCK', 'VCC'], { group: G.power }), category: SENS, tags: ['arduino', 'hx711', 'load cell', 'weight'] },
  i2c4('Module_INA226', 'INA226 ток и мощность', 'Датчик тока и мощности INA226 (шунт 0,1 Ом)', [23, 16], ['ina226', 'current'], G.power, ['VCC', 'GND', 'SCL', 'SDA', 'ALE', 'VBS']),
  one('Module_ZMCT103C', 'ZMCT103C ток 5 А', 'Трансформатор тока ZMCT103C на платке с ОУ, до 5 А AC: VCC, GND, OUT', [18, 43], ['VCC', 'GND', 'OUT'], { group: G.power, category: SENS, tags: ['zmct103c', 'current', 'ac'] }),
  one('Module_ZMPT101B', 'ZMPT101B напряжение 220 В', 'Датчик переменного напряжения ZMPT101B: VCC, OUT, GND, GND', [50, 19], ['VCC', 'OUT', 'GND', 'GND'], { group: G.power, category: SENS, tags: ['zmpt101b', 'voltage', 'ac'] }),
  one('Module_Voltage_25V', 'Датчик напряжения 0–25 В', 'Делитель напряжения 0–25 В (1:5): S — к аналоговому входу, «+», «−»', [27, 14], ['S', '+', '-'], { group: G.power, category: SENS, tags: ['voltage', 'divider'] }),
  one('Module_PZEM-004T', 'PZEM-004T v3 счётчик', 'Модуль учёта энергии PZEM-004T v3.0, UART (Modbus): 5V, RX, TX, GND', [72, 34], ['5V', 'RX', 'TX', 'GND'], { group: G.power, category: SENS, tags: ['pzem-004t', 'energy', 'modbus'] }),
  // ---------- драйверы и силовые ----------
  one('Module_L9110S', 'L9110S драйвер 2 моторов', 'Сдвоенный драйвер моторов L9110S, 29×23 мм: B-IA, B-IB, GND, VCC, A-IA, A-IB', [29, 23], ['B-IA', 'B-IB', 'GND', 'VCC', 'A-IA', 'A-IB'], { group: G.drv, tags: ['l9110s', 'motor'] }),
  one('Module_MX1508', 'MX1508 драйвер 2 моторов', 'Сдвоенный драйвер моторов MX1508: IN1–IN4, «+», «−» (моторы — на площадки по бокам)', [24, 21], ['IN1', 'IN2', 'IN3', 'IN4', '+', '-'], { group: G.drv, tags: ['mx1508', 'motor'] }),
  one('Module_ULN2003_Stepper', 'ULN2003 шаговый 28BYJ-48', 'Плата ULN2003 для шагового 28BYJ-48, 35×32 мм: IN1–IN4, питание «−», «+»', [35, 32], ['IN1', 'IN2', 'IN3', 'IN4', '-', '+'], { group: G.drv, tags: ['uln2003', 'stepper', '28byj-48'] }),
  one('Module_BTS7960_IBT-2', 'BTS7960 (IBT-2) 43 А', 'Мощный мостовой драйвер BTS7960 (IBT-2): RPWM, LPWM, R_EN, L_EN, R_IS, L_IS, VCC, GND', [50, 50], ['RPWM', 'LPWM', 'R_EN', 'L_EN', 'R_IS', 'L_IS', 'VCC', 'GND'], { group: G.drv, tags: ['bts7960', 'motor'], height: 25 }),
  { id: 'Module_TMC2208_Stepper', name: 'TMC2208/TMC2209', description: 'Тихий драйвер шагового TMC2208/2209 (StepStick), 20,3×15,2 мм' + NOTE, board: [15.2, 20.3], rows: twoRows(8, 15.24, ['EN', 'MS1', 'MS2', 'RX', 'TX', 'CLK', 'STEP', 'DIR'], ['VM', 'GND', 'B2', 'B1', 'A1', 'A2', 'VIO', 'GND']), group: G.drv, verified: false, height: 12, tags: ['arduino', 'tmc2208', 'tmc2209', 'stepper'] },
  one('Module_SSR_G3MB_1ch', 'Твердотельное реле 1 канал', 'Модуль твердотельного реле Omron G3MB-202P, 1 канал: DC+, DC−, CH1', [26, 33], ['DC+', 'DC-', 'CH1'], { group: G.relay, category: CAT.K, refPrefix: 'K', tags: ['ssr', 'g3mb'] }),
  one('Module_SSR_G3MB_2ch', 'Твердотельное реле 2 канала', 'Модуль твердотельных реле G3MB-202P, 2 канала: DC+, DC−, CH1, CH2', [38, 33], ['DC+', 'DC-', 'CH1', 'CH2'], { group: G.relay, category: CAT.K, refPrefix: 'K', tags: ['ssr', 'g3mb'] }),
  one('Module_Relay_8ch', 'Реле 8 каналов', 'Блок из 8 реле 5 В с оптронами, 138×56 мм: GND, IN1–IN8, VCC', [56, 138], ['GND', 'IN1', 'IN2', 'IN3', 'IN4', 'IN5', 'IN6', 'IN7', 'IN8', 'VCC'], { group: G.relay, category: CAT.K, refPrefix: 'K', side: 'left', tags: ['relay', '8ch'], height: 19 }),
  // ---------- звук ----------
  one('Module_MAX98357A', 'MAX98357A усилитель I²S', 'Усилитель класса D с входом I²S MAX98357A, 3 Вт: LRC, BCLK, DIN, GAIN, SD, GND, VIN', [18, 18], ['LRC', 'BCLK', 'DIN', 'GAIN', 'SD', 'GND', 'VIN'], { group: G.audio, tags: ['max98357a', 'i2s', 'amplifier'] }),
  one('Module_PAM8403', 'PAM8403 усилитель 2×3 Вт', 'Стереоусилитель PAM8403 5 В: вход L, GND, R; питание «+», «−» (динамики — на площадки)', [21, 18], ['L', 'GND', 'R', '+', '-'], { group: G.audio, tags: ['pam8403', 'amplifier'] }),
  { id: 'Module_DFPlayer_Mini', name: 'DFPlayer Mini', description: 'MP3-плеер DFPlayer Mini с microSD, 20×20 мм, 2×8 выводов' + NOTE + ' (расстояние между рядами тоже)', board: [21, 21], rows: twoRows(8, 17.78, ['VCC', 'RX', 'TX', 'DAC_R', 'DAC_L', 'SPK1', 'GND', 'SPK2'], ['BUSY', 'USB-', 'USB+', 'ADK2', 'ADK1', 'IO2', 'GND', 'IO1']), group: G.audio, verified: false, height: 8, tags: ['arduino', 'dfplayer', 'mp3'] },
  one('Module_ISD1820', 'ISD1820 запись голоса', 'Модуль записи и воспроизведения голоса ISD1820: VCC, GND, REC, PLAYE, PLAYL, FT', [38, 42], ['VCC', 'GND', 'REC', 'PLAYE', 'PLAYL', 'FT'], { group: G.audio, tags: ['isd1820', 'voice'] }),
  // ---------- ввод ----------
  one('Module_TTP223_Touch', 'TTP223 сенсорная кнопка', 'Сенсорная кнопка TTP223, 15×11 мм: I/O, VCC, GND', [15, 11], ['I/O', 'VCC', 'GND'], { group: G.input, tags: ['ttp223', 'touch'] }),
  one('Module_Keypad_4x3', 'Клавиатура 4×3 (плёночная)', 'Плёночная клавиатура 4×3: 7 выводов, строки R1–R4 и столбцы C1–C3 (порядок у разных партий разный — прозвоните)', [20, 10], ['R1', 'R2', 'R3', 'R4', 'C1', 'C2', 'C3'], { group: G.input, tags: ['keypad', '4x3'] }),
  one('Module_Button_4', 'Четыре кнопки', 'Платка из 4 кнопок с общим проводом: GND, K1–K4', [42, 14], ['GND', 'K1', 'K2', 'K3', 'K4'], { group: G.input, tags: ['button'] }),
  one('Module_Potentiometer', 'Потенциометр на платке', 'Потенциометр 10 кОм на платке: GND, OUT, VCC', [22, 22], ['GND', 'OUT', 'VCC'], { group: G.input, tags: ['potentiometer'] }),
  // ---------- связь ----------
  one('Module_HM-10_BLE', 'HM-10 Bluetooth LE', 'Модуль Bluetooth 4.0 LE HM-10 (AT-09), 37×15 мм: STATE, VCC, GND, TXD, RXD, BRK', [15, 37], ['STATE', 'VCC', 'GND', 'TXD', 'RXD', 'BRK'], { group: G.wifi, tags: ['hm-10', 'ble', 'bluetooth'] }),
  one('Module_HC-12_433', 'HC-12 радио 433 МГц', 'Радиомодуль HC-12 433 МГц до 1 км, UART, 27,8×14,4 мм: VCC, GND, RXD, TXD, SET', [14.4, 27.8], ['VCC', 'GND', 'RXD', 'TXD', 'SET'], { group: G.rf, tags: ['hc-12', '433', 'radio'] }),
  one('Module_433_TX_FS1000A', 'Передатчик 433 МГц FS1000A', 'Передатчик 433 МГц FS1000A, 19×19 мм: DATA, VCC, GND', [19, 19], ['DATA', 'VCC', 'GND'], { group: G.rf, tags: ['433', 'fs1000a', 'radio'] }),
  one('Module_433_RX_MK-5V', 'Приёмник 433 МГц MX-RM-5V', 'Приёмник 433 МГц XY-MK-5V/MX-RM-5V, 30×14 мм: VCC, DATA, DATA, GND', [30, 14], ['VCC', 'DATA', 'DATA', 'GND'], { group: G.rf, tags: ['433', 'radio', 'receiver'] }),
  one('Module_MCP2515_CAN', 'MCP2515 CAN (TJA1050)', 'Модуль шины CAN MCP2515 + TJA1050, кварц 8 МГц, 40×28 мм: INT, SCK, SI, SO, CS, GND, VCC', [28, 40], ['INT', 'SCK', 'SI', 'SO', 'CS', 'GND', 'VCC'], { group: G.rf, side: 'left', tags: ['mcp2515', 'can'] }),
  sides('Module_RS485_MAX485', 'RS-485 (MAX485)', 'Модуль RS-485 на MAX485, 44×14 мм: к контроллеру RO, RE, DE, DI; к линии VCC, B, A, GND', [44, 14], ['RO', 'RE', 'DE', 'DI'], ['VCC', 'B', 'A', 'GND'], { group: G.rf, tags: ['rs485', 'max485', 'modbus'] }),
  one('Module_MAX3232_RS232', 'RS-232 (MAX3232)', 'Модуль RS-232 на MAX3232 с разъёмом DB9: VCC, GND, TXD, RXD', [34, 30], ['VCC', 'GND', 'TXD', 'RXD'], { group: G.rf, tags: ['rs232', 'max3232'] }),
  one('Module_FTDI_Basic', 'USB-UART FTDI (6 выводов)', 'Переходник USB–UART в формате FTDI Basic (FT232RL/CH340): GND, CTS, VCC, TXD, RXD, DTR — ответная часть к Arduino Pro Mini', [18, 30], ['GND', 'CTS', 'VCC', 'TXD', 'RXD', 'DTR'], { group: G.rf, tags: ['ftdi', 'usb', 'uart'] }),
  one('Module_CP2102_USB-UART', 'USB-UART CP2102', 'Переходник USB–UART CP2102: 3V3, DTR, RXD, TXD, GND, 5V', [16, 34], ['3V3', 'DTR', 'RXD', 'TXD', 'GND', '5V'], { group: G.rf, tags: ['cp2102', 'usb', 'uart'] }),
  one('Module_PN532_NFC', 'PN532 NFC (I²C)', 'Модуль NFC PN532 (разъём I²C): GND, VCC, SDA, SCL', [43, 41], ['GND', 'VCC', 'SDA', 'SCL'], { group: G.rf, tags: ['pn532', 'nfc', 'rfid'] }),
  one('Module_SD_Card_SPI', 'SD-карта (полноразмерная)', 'Модуль полноразмерной SD-карты, SPI: GND, 3V3, 5V, CS, MOSI, SCK, MISO, GND', [52, 42], ['GND', '3V3', '5V', 'CS', 'MOSI', 'SCK', 'MISO', 'GND'], { group: G.rf, tags: ['sd', 'spi'] }),
  // ---------- дисплеи ----------
  one('Module_TM1638_LED_KEY', 'TM1638 LED&KEY', 'Плата TM1638: 8 разрядов, 8 светодиодов, 8 кнопок, 76×50 мм: VCC, GND, STB, CLK, DIO', [50, 76], ['VCC', 'GND', 'STB', 'CLK', 'DIO'], { group: G.lcd, category: CAT.DS, refPrefix: 'DS', side: 'left', tags: ['tm1638', '7-segment'] }),
  one('Module_MAX7219_8digit', 'MAX7219 8 разрядов', 'Индикатор 8×7 сегментов на MAX7219, 82×15 мм: VCC, GND, DIN, CS, CLK', [15, 82], ['VCC', 'GND', 'DIN', 'CS', 'CLK'], { group: G.lcd, category: CAT.DS, refPrefix: 'DS', side: 'left', tags: ['max7219', '7-segment'] }),
  one('Module_OLED_0.96_SPI', 'OLED 0,96″ SPI (7 выводов)', 'Дисплей OLED 0,96″ 128×64 SSD1306, SPI: GND, VCC, D0 (SCK), D1 (MOSI), RES, DC, CS', [27, 27], ['GND', 'VCC', 'D0', 'D1', 'RES', 'DC', 'CS'], { group: G.lcd, category: CAT.DS, refPrefix: 'DS', tags: ['oled', 'ssd1306', 'spi'] }),
  one('Module_TFT_1.3_ST7789', 'TFT 1,3″ ST7789 240×240', 'Цветной дисплей 1,3″ 240×240 ST7789, SPI: GND, VCC, SCL, SDA, RES, DC, BLK', [28, 39], ['GND', 'VCC', 'SCL', 'SDA', 'RES', 'DC', 'BLK'], { group: G.lcd, category: CAT.DS, refPrefix: 'DS', tags: ['tft', 'st7789', 'spi'] }),
  one('Module_TFT_1.44_ST7735', 'TFT 1,44″ ST7735 128×128', 'Цветной дисплей 1,44″ 128×128 ST7735, SPI: VCC, GND, CS, RESET, A0, SDA, SCK, LED', [32, 43], ['VCC', 'GND', 'CS', 'RST', 'A0', 'SDA', 'SCK', 'LED'], { group: G.lcd, category: CAT.DS, refPrefix: 'DS', tags: ['tft', 'st7735', 'spi'] }),
  one('Module_TFT_2.8_ILI9341_Touch', 'TFT 2,8″ ILI9341 с тачем', 'Цветной дисплей 2,8″ 320×240 ILI9341 с резистивным тачем XPT2046, SPI, 86×50 мм, 14 выводов', [50, 86], ['VCC', 'GND', 'CS', 'RESET', 'DC', 'SDI', 'SCK', 'LED', 'SDO', 'T_CLK', 'T_CS', 'T_DIN', 'T_DO', 'T_IRQ'], { group: G.lcd, category: CAT.DS, refPrefix: 'DS', side: 'left', tags: ['tft', 'ili9341', 'touch', 'spi'] }),
  one('Module_LCD12864_ST7920', 'LCD 12864 (ST7920)', 'Графический ЖК 128×64 на ST7920, 93×70 мм, 20 выводов (PSB = 0 — последовательный режим)', [93, 70], ['VSS', 'VDD', 'V0', 'RS', 'RW', 'E', 'DB0', 'DB1', 'DB2', 'DB3', 'DB4', 'DB5', 'DB6', 'DB7', 'PSB', 'NC', 'RST', 'VOUT', 'BLA', 'BLK'], { group: G.lcd, category: CAT.DS, refPrefix: 'DS', tags: ['lcd12864', 'st7920'] }),
  one('Module_EPaper_1.54', 'E-paper 1,54″', 'Электронная бумага 1,54″ 200×200, SPI: VCC, GND, DIN, CLK, CS, DC, RST, BUSY', [33, 48], ['VCC', 'GND', 'DIN', 'CLK', 'CS', 'DC', 'RST', 'BUSY'], { group: G.lcd, category: CAT.DS, refPrefix: 'DS', tags: ['epaper', 'e-ink', 'spi'] }),
  // ---------- питание ----------
  { ...one('Module_Mini-360_Buck', 'Mini-360 понижающий', 'Сверхмалый понижающий DC-DC Mini-360 (MP2307), 17×11 мм: IN+, IN−, OUT−, OUT+', [17, 11], ['IN+', 'IN-', 'OUT-', 'OUT+'], { group: G.ps, category: CAT.PS, refPrefix: 'PS', tags: ['mini-360', 'buck'] }) },
  one('Module_XL6009_Boost', 'XL6009 повышающий', 'Повышающий DC-DC XL6009 4 А, 43×21 мм: IN+, IN−, OUT+, OUT− (площадки по углам — здесь в ряд)', [21, 43], ['IN+', 'IN-', 'OUT+', 'OUT-'], { group: G.ps, category: CAT.PS, refPrefix: 'PS', tags: ['xl6009', 'boost'], padDiameter: 2.2, drill: 1.2 }),
  one('Module_MB102_Power', 'MB102 питание макетки', 'Блок питания макетной платы MB102 (5 и 3,3 В): штыри 5V, GND, 3V3 для своей платы', [53, 35], ['5V', 'GND', '3V3', 'GND'], { group: G.ps, category: CAT.PS, refPrefix: 'PS', tags: ['mb102', 'breadboard'] }),
  one('Module_USB-C_Breakout', 'USB-C питание (платка)', 'Платка разъёма USB-C для питания 5 В: VBUS, GND, CC1, CC2', [16, 12], ['VBUS', 'GND', 'CC1', 'CC2'], { group: G.ps, category: CAT.PS, refPrefix: 'J', tags: ['usb-c', 'power'] }),
  // ---------- контроллеры ----------
  {
    id: 'Module_Arduino_Uno_R3_Shield',
    name: 'Arduino Uno R3 (шилд)',
    description: 'Контур и разъёмы Arduino Uno R3 / Leonardo для своего шилда, 68,6×53,3 мм: питание (IOREF, RESET, 3V3, 5V, GND, VIN), A0–A5, D0–D13, AREF, SDA, SCL; между рядами цифровых выводов зазор 4,06 мм, как у оригинала. Отверстия — сверить с платой',
    board: [68.58, 53.34],
    rows: [
      { at: U(1100, 100), dir: 'x', names: ['NC', 'IOREF', 'RST', '3V3', '5V', 'GND', 'GND', 'VIN'], markFirst: true },
      { at: U(2000, 100), dir: 'x', names: ['A0', 'A1', 'A2', 'A3', 'A4', 'A5'] },
      { at: U(840, 2000), dir: 'x', names: ['SCL', 'SDA', 'AREF', 'GND', 'D13', 'D12', 'D11', 'D10', 'D9', 'D8'] },
      { at: U(1900, 2000), dir: 'x', names: ['D7', 'D6', 'D5', 'D4', 'D3', 'D2', 'D1', 'D0'] },
    ],
    holes: [
      { at: U(550, 100), d: 3.2 },
      { at: U(600, 2000), d: 3.2 },
      { at: U(2600, 300), d: 3.2 },
      { at: U(2600, 1400), d: 3.2 },
    ],
    group: G.mcu,
    verified: false,
    height: 15,
    refPrefix: 'A',
    tags: ['arduino', 'uno', 'shield', 'leonardo'],
  },
  {
    id: 'Module_NodeMCU_v3_LoLin',
    name: 'NodeMCU v3 (LoLin, широкая)',
    description: 'NodeMCU v3 LoLin (CH340), 58×31 мм, 2×15 выводов через 27,94 мм — шире, чем v2 Amica' + NOTE,
    board: [31, 58],
    rows: twoRows(15, 27.94, ['A0', 'RSV', 'RSV', 'SD3', 'SD2', 'SD1', 'CMD', 'SD0', 'CLK', 'GND', '3V3', 'EN', 'RST', 'GND', 'VIN'], ['D0', 'D1', 'D2', 'D3', 'D4', '3V3', 'GND', 'D5', 'D6', 'D7', 'D8', 'RX', 'TX', 'GND', '3V3']),
    group: G.wifi,
    verified: false,
    height: 13,
    refPrefix: 'A',
    tags: ['arduino', 'esp8266', 'nodemcu', 'lolin'],
  },
];
