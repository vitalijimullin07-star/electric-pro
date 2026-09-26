import { describe, expect, test } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { buildQuasar } from '../src/core/examples/quasar/build';
import { quasarNotes } from '../src/core/examples/quasar/notes';
import { exportBomCsv } from '../src/core/io/bom';
import { parseProjectFile, serializeProject } from '../src/core/io/project-file';
import { runDrc } from '../src/core/model/drc';
import { getWorld } from '../src/core/model/world';
import type { Project } from '../src/core/model/types';
import { applySchematicToBoard } from '../src/core/schematic/netlist';
import { Simulation } from '../src/core/sim';
import { findMcu } from '../src/core/sim/circuit';

/*
 * Металлоискатель «Квазар AVR» на плате DesAlex: плата из Sprint Layout, схема,
 * выносные детали и симуляция настоящей прошивки 1.4.5 (ATmega32A, 11,0592 МГц).
 * С QUASAR_WRITE=1 тест заново пишет файлы для импорта в папку import/.
 */

const fixture = (n: string) => readFileSync(`tests/fixtures/quasar/${n}`);
const build = (fw = 'Quasar145.hex') => buildQuasar(new Uint8Array(fixture('quasar-desalex.lay')), { name: fw, hex: fixture(fw).toString('utf8') });

const G = ['_', '▁', '▃', '▅', '▒', '■', 'B', 'b'];
function screen(sim: Simulation): string {
  const l = sim.view().devices.find((x) => x.kind === 'lcd')!;
  return l.codes ? l.codes.map((r) => r.map((c) => (c < 8 ? G[c] : c === 255 ? '█' : String.fromCharCode(c))).join('')).join('|') : l.lines!.join('|');
}

describe('Квазар AVR (DesAlex)', () => {
  const p = build();

  test('плата: все площадки файла — выводы деталей, ошибок проверки нет', () => {
    const w = getWorld(p);
    expect(w.components.length).toBe(Object.values(p.components).filter((c) => !c.offBoard).length);
    expect(Object.keys(p.tracks).length).toBe(98);
    const drc = runDrc(p);
    expect(drc.markers.filter((m) => m.severity === 'error').map((m) => m.message)).toEqual([]);
    // Имена цепей — как на схеме Andy_F.
    const names = new Set(Object.values(p.nets).map((n) => n.name));
    for (const n of ['GND', '+5V', 'VDD', '+BATT', 'TXO', 'CS', 'SCK', 'MISO', 'SOUND', 'LIGHT', 'B1', 'B2', 'B3', 'LCD_E', 'RX_C1', 'TX_C1']) expect(names).toContain(n);
    // TX — на PB0…PB3 разом, как у DesAlex.
    const u5 = Object.values(p.components).find((c) => c.ref === 'U5')!;
    const txo = [...names].includes('TXO') ? Object.values(p.nets).find((n) => n.name === 'TXO')!.id : '';
    expect(['1', '2', '3', '4'].map((pin) => u5.padNets[pin])).toEqual([txo, txo, txo, txo]);
  });

  test('схема совпадает с платой, выносные детали — только на схеме', () => {
    const q = structuredClone(p) as Project;
    const sum = applySchematicToBoard(q);
    expect(sum.changed).toBe(0);
    const off = Object.values(p.components).filter((c) => c.offBoard).map((c) => c.ref);
    expect(off).toEqual(expect.arrayContaining(['HG1', 'SW1', 'SW6', 'VD1', 'BA1', 'GB1', 'L3', 'C35']));
    expect(getWorld(p).components.some((wc) => wc.component.offBoard)).toBe(false);
    expect(exportBomCsv(p)).toContain('LCD 1602');
  });

  test('контроллер: ATmega32A на 11,0592 МГц, AREF на +5 В', () => {
    const m = findMcu(p)!;
    expect(m.kind).toBe('atmega32');
    expect(m.freq).toBe(11_059_200);
    const sim = new Simulation(p, p.firmware!.hex);
    expect(sim.circuit.arefFromSupply).toBe(true);
    expect(sim.unknown).toEqual([]);
  });

  test('прошивка 1.4.5: самотест портов, заставка, рабочий экран с напряжением', () => {
    const sim = new Simulation(p, p.firmware!.hex);
    const F = sim.mcu.freq;
    sim.run(F * 1.2);
    expect(screen(sim)).toContain('-= Quasar =-');
    sim.run(F * 5.5);
    sim.view();
    sim.run(F * 0.2);
    const v = sim.view();
    const lcd = v.devices.find((d) => d.kind === 'lcd')!;
    const s = lcd.codes!.map((r) => r.map((c) => (c < 32 ? '_' : String.fromCharCode(c))).join('')).join('|');
    expect(s).not.toContain('Error');
    // 12 В на аккумуляторе через делитель DesAlex (4,3 кОм / 1,1 кОм) и опору +5 В.
    expect(s).toMatch(/1[23]\.\dV/);
    const coil = v.devices.find((d) => d.kind === 'coil')!;
    expect(coil.title).toMatch(/TX 82\d\d Гц/);
    // Подсветка — ШИМ таймера 2 через ключ Q4.
    expect(lcd.backlight).toBe(true);
    expect(lcd.brightness!).toBeGreaterThan(0.1);
  });

  test('клавиатура на трёх линиях с диодами: меню и порог', () => {
    const sim = new Simulation(p, p.firmware!.hex);
    const F = sim.mcu.freq;
    sim.run(F * 7);
    const key = (ref: string) => sim.devices.find((d) => d.comp.ref === ref)!.id;
    sim.press(key('SW5'), true);
    sim.run(F * 0.3);
    sim.press(key('SW5'), false);
    sim.run(F * 0.6);
    expect(screen(sim)).toContain('Audio...');
    const sim2 = new Simulation(p, p.firmware!.hex);
    sim2.run(F * 7);
    sim2.press(sim2.devices.find((d) => d.comp.ref === 'SW1')!.id, true);
    sim2.run(F * 0.3);
    expect(screen(sim2)).toContain('Barrier');
  });

  test('цель под катушкой: метка на шкале VDI и звук', () => {
    const sim = new Simulation(p, p.firmware!.hex);
    const F = sim.mcu.freq;
    sim.run(F * 7);
    const coil = sim.devices.find((d) => d.view().kind === 'coil')!.id;
    const marks = (target: number) => {
      sim.set(coil, 'target', target);
      sim.set(coil, 'depth', 8);
      sim.act(coil, 'sweep');
      const cols: number[] = [];
      let tone = 0;
      for (let i = 0; i < 14; i++) {
        sim.run(F / 10);
        const v = sim.view();
        const col = v.devices.find((d) => d.kind === 'lcd')!.codes![0].indexOf(255);
        if (col >= 0) cols.push(col);
        const spk = v.devices.find((d) => d.kind === 'buzzer')!;
        if (spk.on) tone = Math.max(tone, spk.hz ?? 0);
      }
      return { col: cols.length ? Math.round(cols.reduce((a, b) => a + b) / cols.length) : -1, tone };
    };
    const iron = marks(1);
    const copper = marks(6);
    expect(iron.col).toBeGreaterThanOrEqual(0);
    expect(copper.col).toBeGreaterThan(iron.col);
    expect(copper.tone).toBeGreaterThan(iron.tone);
    expect(copper.tone).toBeGreaterThan(200);
  });

  test('файлы для импорта', () => {
    const text = serializeProject(p, false);
    const r = parseProjectFile(text);
    expect(r.kind).toBe('project');
    const notes = quasarNotes(p);
    expect(notes).toContain('0x3F');
    if (process.env.QUASAR_WRITE) {
      writeFileSync('import/quasar-avr-desalex.plata.json', text);
      const p138 = build('Quasar138.hex');
      writeFileSync('import/quasar-avr-desalex-fw138.plata.json', serializeProject(p138, false));
      writeFileSync('import/quasar-avr-desalex.txt', notes);
      writeFileSync('import/quasar-avr-desalex-perechen.csv', exportBomCsv(p));
    }
  });

  test('файл в import/ открывается и запускается', () => {
    const r = parseProjectFile(readFileSync('import/quasar-avr-desalex.plata.json', 'utf8'));
    if (r.kind !== 'project') throw new Error('не проект');
    const sim = new Simulation(r.project, r.project.firmware!.hex);
    sim.run(sim.mcu.freq * 1.2);
    expect(screen(sim)).toContain('Quasar');
  });
});
