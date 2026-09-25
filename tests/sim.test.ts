import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { libraryFootprint } from '../src/core/library';
import { addComponent, connectPad, ensureNet } from '../src/core/model/edit';
import { createProject } from '../src/core/model/project';
import type { Component, Project } from '../src/core/model/types';
import { MCU_FREQ, Simulation } from '../src/core/sim';
import { parseHex } from '../src/core/sim/hex';

const fw = (n: string) => readFileSync(`tests/fixtures/fw/${n}.hex`, 'utf8');
const ms = (t: number) => Math.round((MCU_FREQ * t) / 1000);

/** Маленькая схема: Arduino Nano и детали, соединения — по именам выводов. */
function board() {
  const p = createProject({ width: 100, height: 80 });
  let x = 10;
  const put = (id: string, ref?: string): Component => {
    const f = libraryFootprint(id);
    if (!f) throw new Error(id);
    x += 15;
    return addComponent(p, f, { x, y: 40 }, ref ? { ref } : {});
  };
  const nano = put('Module_Arduino_Nano', 'A1');
  const wire = (net: string, ...ends: [Component, string][]) => {
    const n = ensureNet(p, net).id;
    for (const [c, name] of ends) {
      const f = p.footprints[c.footprint];
      const pads = f.pads.filter((q) => (q.name ?? q.number) === name);
      if (!pads.length) throw new Error(`${c.ref}: нет вывода ${name}`);
      for (const q of pads) connectPad(p, c.id, q.number, n);
    }
  };
  wire('GND', [nano, 'GND']);
  wire('5V', [nano, '5V']);
  return { p, nano, put, wire, done: () => structuredClone(p) as Project };
}

describe('симуляция Arduino', () => {
  test('Intel HEX: контрольная сумма и данные', () => {
    const f = parseHex(fw('demo'));
    expect(f[0]).toBe(0x0c); // jmp в таблице векторов
    expect(() => parseHex(':0400000000000000FF\n')).toThrow(/контрольная/);
    expect(() => parseHex('hello')).toThrow(/Intel HEX/);
  });

  test('демо: мигание, ШИМ, кнопка, монитор порта, АЦП от потенциометра', () => {
    const b = board();
    const r1 = b.put('R_0805_2012Metric', 'R1');
    const d1 = b.put('LED_D5.0mm', 'D1');
    const d2 = b.put('LED_D5.0mm', 'D2');
    const d3 = b.put('LED_D5.0mm', 'D3');
    const sw = b.put('SW_PUSH_6mm_2pin', 'SW1');
    const rv = b.put('Potentiometer_Bourns_3386P', 'RV1');
    b.wire('BLINK', [b.nano, 'D13'], [r1, '1']);
    b.wire('LED1', [r1, '2'], [d1, 'A']);
    b.wire('PWM', [b.nano, 'D6'], [d2, 'A']);
    b.wire('FOLLOW', [b.nano, 'D12'], [d3, 'A']);
    b.wire('GND', [d1, 'K'], [d2, 'K'], [d3, 'K'], [sw, '2'], [rv, '1']);
    b.wire('BTN', [b.nano, 'D2'], [sw, '1']);
    b.wire('5V', [rv, '3']);
    b.wire('POT', [b.nano, 'A0'], [rv, 'W']);
    const sim = new Simulation(b.done(), fw('demo'));
    sim.run(ms(50));
    expect(sim.serial).toBe('Plata OK\r\n');
    // ШИМ 25 % на D6.
    sim.view();
    sim.run(ms(40));
    const v = sim.view();
    const led = (ref: string) => v.devices.find((d) => d.ref === ref)!;
    expect(led('D2').brightness!).toBeGreaterThan(0.2);
    expect(led('D2').brightness!).toBeLessThan(0.3);
    expect(led('D3').on).toBe(false);
    // D13 мигает: за 0,5 с светодиод успевает и гореть, и не гореть.
    const seen = new Set<boolean>();
    for (let i = 0; i < 10; i++) {
      sim.run(ms(50));
      seen.add(!!sim.view().devices.find((d) => d.ref === 'D1')!.on);
    }
    expect([...seen].sort()).toEqual([false, true]);
    // Кнопка: D2 к земле → D12 горит.
    sim.press(sim.devices.find((d) => d.comp.ref === 'SW1')!.id, true);
    sim.run(ms(5));
    sim.view();
    sim.run(ms(5));
    expect(sim.view().devices.find((d) => d.ref === 'D3')!.on).toBe(true);
    sim.press(sim.devices.find((d) => d.comp.ref === 'SW1')!.id, false);
    // Потенциометр 25 % → A0 ≈ 256.
    sim.set(sim.devices.find((d) => d.comp.ref === 'RV1')!.id, 'v', 25);
    sim.serialWrite('a');
    sim.run(ms(20));
    const m = /A0=(\d+)/.exec(sim.serial);
    expect(m).not.toBeNull();
    expect(Math.abs(+m![1] - 256)).toBeLessThan(4);
    // Эхо заглавными.
    sim.serialWrite('hi');
    sim.run(ms(20));
    expect(sim.serial.endsWith('HI')).toBe(true);
    // Таблица выводов.
    expect(sim.view().pins.find((q) => q.title.startsWith('D13'))!.net).toBe('BLINK');
  });

  test('ЖК 1602 через PCF8574 по I²C', () => {
    const b = board();
    const lcd = b.put('Module_PCF8574_LCD_Backpack', 'M1');
    b.wire('SDA', [b.nano, 'A4'], [lcd, 'SDA']);
    b.wire('SCL', [b.nano, 'A5'], [lcd, 'SCL']);
    b.wire('GND', [lcd, 'GND']);
    b.wire('5V', [lcd, 'VCC']);
    const sim = new Simulation(b.done(), fw('lcd_i2c'));
    sim.run(ms(300));
    const view = sim.view().devices.find((d) => d.kind === 'lcd')!;
    expect(view.warning).toBeUndefined();
    expect(view.lines).toEqual(['Hello, Plata!   ', 'I2C LCD 1602    ']);
  });

  test('ЖК 1602 параллельно, как в LiquidCrystal(12, 11, 5, 4, 3, 2)', () => {
    const b = board();
    const lcd = b.put('Module_LCD1602', 'DS1');
    b.wire('RS', [b.nano, 'D12'], [lcd, 'RS']);
    b.wire('E', [b.nano, 'D11'], [lcd, 'E']);
    b.wire('LD4', [b.nano, 'D5'], [lcd, 'D4']);
    b.wire('LD5', [b.nano, 'D4'], [lcd, 'D5']);
    b.wire('LD6', [b.nano, 'D3'], [lcd, 'D6']);
    b.wire('LD7', [b.nano, 'D2'], [lcd, 'D7']);
    b.wire('GND', [lcd, 'VSS'], [lcd, 'RW']);
    const sim = new Simulation(b.done(), fw('lcd_par'));
    sim.run(ms(200));
    expect(sim.view().devices.find((d) => d.kind === 'lcd')!.lines![0]).toBe('Parallel LCD    ');
  });

  test('OLED SSD1306 128×64 по I²C: рамка', () => {
    const b = board();
    const o = b.put('Module_OLED_0.96_I2C', 'DS1');
    b.wire('SDA', [b.nano, 'A4'], [o, 'SDA']);
    b.wire('SCL', [b.nano, 'A5'], [o, 'SCL']);
    const sim = new Simulation(b.done(), fw('oled'));
    sim.run(ms(300));
    const v = sim.view().devices.find((d) => d.kind === 'oled')!;
    const px = (x: number, y: number) => v.frame![y * 128 + x];
    expect([px(0, 0), px(127, 63), px(64, 0), px(64, 63), px(0, 30)]).toEqual([1, 1, 1, 1, 1]);
    expect(px(64, 40)).toBe(0);
    expect(px(20, 12)).toBe(1); // диагональ: x = 20 → страница 1, бит 4
  });

  test('DHT22: температура и влажность', () => {
    const b = board();
    const s = b.put('Module_DHT22', 'U1');
    b.wire('DHT', [b.nano, 'D2'], [s, 'DATA']);
    b.wire('GND', [s, 'GND']);
    b.wire('5V', [s, 'VCC']);
    const sim = new Simulation(b.done(), fw('dht'));
    const id = sim.devices.find((d) => d.comp.ref === 'U1')!.id;
    sim.set(id, 't', -3.4);
    sim.set(id, 'h', 61.2);
    sim.run(ms(700));
    expect(sim.serial).toContain('T=-34 H=612');
  });

  test('HC-SR04: расстояние', () => {
    const b = board();
    const s = b.put('Module_HC-SR04', 'U1');
    b.wire('TRIG', [b.nano, 'D9'], [s, 'TRIG']);
    b.wire('ECHO', [b.nano, 'D8'], [s, 'ECHO']);
    const sim = new Simulation(b.done(), fw('sr04'));
    sim.set(sim.devices.find((d) => d.comp.ref === 'U1')!.id, 'd', 123);
    sim.run(ms(200));
    const m = [...sim.serial.matchAll(/D=(\d+)/g)].map((x) => +x[1]);
    expect(m.length).toBeGreaterThan(1);
    expect(Math.abs(m[m.length - 1] - 123)).toBeLessThanOrEqual(1);
  });

  test('MAX6675 программным SPI', () => {
    const b = board();
    const s = b.put('Module_MAX6675', 'U1');
    b.wire('CS', [b.nano, 'D10'], [s, 'CS']);
    b.wire('SO', [b.nano, 'D12'], [s, 'SO']);
    b.wire('SCK', [b.nano, 'D13'], [s, 'SCK']);
    const sim = new Simulation(b.done(), fw('max6675'));
    sim.set(sim.devices.find((d) => d.comp.ref === 'U1')!.id, 't', 231.5);
    sim.run(ms(300));
    expect(sim.serial).toContain('Q=926');
  });

  test('часы DS3231 и АЦП ADS1115 по I²C', () => {
    const b = board();
    const rtc = b.put('Module_DS3231', 'U1');
    b.wire('SDA', [b.nano, 'A4'], [rtc, 'SDA']);
    b.wire('SCL', [b.nano, 'A5'], [rtc, 'SCL']);
    const sim = new Simulation(b.done(), fw('rtc'));
    sim.run(ms(100));
    const now = new Date();
    expect(sim.serial).toMatch(new RegExp(`^${String(now.getHours()).padStart(2, '0')}:\\d\\d:\\d\\d`));

    const b2 = board();
    const ads = b2.put('Module_ADS1115', 'U2');
    b2.wire('SDA', [b2.nano, 'A4'], [ads, 'SDA']);
    b2.wire('SCL', [b2.nano, 'A5'], [ads, 'SCL']);
    b2.wire('GND', [ads, 'ADDR'], [ads, 'GND']);
    const sim2 = new Simulation(b2.done(), fw('ads1115'));
    sim2.set(sim2.devices.find((d) => d.comp.ref === 'U2')!.id, 'A0', 1.0);
    sim2.run(ms(100));
    expect(sim2.serial).toContain('R=8000');
  });

  test('подсказки: дисплей не на A4/A5, нет Arduino', () => {
    const b = board();
    const o = b.put('Module_OLED_0.96_I2C', 'DS1');
    b.wire('X', [b.nano, 'D7'], [o, 'SDA']);
    const sim = new Simulation(b.done(), fw('oled'));
    expect(sim.view().devices.find((d) => d.kind === 'oled')!.warning).toMatch(/A4/);
    expect(() => new Simulation(createProject(), fw('demo'))).toThrow(/Arduino/);
  });
});

describe('пример import/arduino-simulation-demo', () => {
  test('открывается и работает: ЖК, светодиоды, кнопка, зуммер', () => {
    const p = JSON.parse(readFileSync('import/arduino-simulation-demo.plata.json', 'utf8')) as Project;
    const sim = new Simulation(p, p.firmware!.hex);
    sim.run(ms(1200));
    let v = sim.view();
    expect(v.devices.find((d) => d.kind === 'lcd')!.lines).toEqual(['T=24.5°C H=45%  ', 'A0=512 BTN:0    ']);
    sim.press(sim.devices.find((d) => d.comp.ref === 'SW1')!.id, true);
    sim.run(ms(600));
    sim.view();
    sim.run(ms(20));
    v = sim.view();
    const bz = v.devices.find((d) => d.kind === 'buzzer')!;
    expect(bz.on).toBe(true);
    expect(Math.abs(bz.hz! - 1000)).toBeLessThan(30);
    expect(v.devices.find((d) => d.ref === 'D3')!.on).toBe(true);
    expect(sim.serial).toContain('BTN=1');
  });
});
