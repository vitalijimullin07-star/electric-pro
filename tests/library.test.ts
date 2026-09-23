import { describe, expect, test } from 'vitest';
import { libraryFootprints, searchFootprints, compatibleFootprints, libraryFootprint } from '../src/core/library';
import { TEMPLATES } from '../src/core/library/templates';
import { padLocalShape, footprintBounds } from '../src/core/model/placement';
import { shapesTouch } from '../src/core/math/shape';

describe('библиотека корпусов', () => {
  const all = libraryFootprints();

  test('идентификаторы уникальны, корпусов много', () => {
    const ids = new Set(all.map((f) => f.id));
    expect(ids.size).toBe(all.length);
    expect(all.length).toBeGreaterThan(150);
  });

  test('у каждого корпуса есть площадки с уникальными номерами и разумными размерами', () => {
    for (const f of all) {
      expect(f.pads.length, f.id).toBeGreaterThan(0);
      const nums = f.pads.filter((p) => p.type !== 'npth').map((p) => p.number);
      expect(new Set(nums).size, f.id).toBe(nums.length);
      for (const p of f.pads) {
        expect(p.size.x, `${f.id} ${p.number}`).toBeGreaterThan(0.2);
        expect(p.size.y, `${f.id} ${p.number}`).toBeGreaterThan(0.2);
        if (p.type !== 'smd') {
          expect(p.drill, `${f.id} ${p.number}: отверстие`).toBeGreaterThan(0.2);
          if (p.type === 'tht') expect(Math.min(p.size.x, p.size.y) - p.drill!, `${f.id} ${p.number}: кольцо`).toBeGreaterThanOrEqual(0.3);
        }
      }
    }
  });

  test('площадки одного корпуса не перекрываются', () => {
    for (const f of all) {
      const shapes = f.pads.map((p) => ({ p, s: padLocalShape(p) }));
      for (let i = 0; i < shapes.length; i++)
        for (let j = i + 1; j < shapes.length; j++)
          expect(shapesTouch(shapes[i].s, shapes[j].s, -0.05), `${f.id}: ${shapes[i].p.number} и ${shapes[j].p.number}`).toBe(false);
    }
  });

  test('габарит охватывает все площадки', () => {
    for (const f of all) {
      const b = footprintBounds(f);
      for (const p of f.pads) {
        const s = padLocalShape(p);
        expect(s.box.minX, f.id).toBeGreaterThanOrEqual(b.min.x - 1e-6);
        expect(s.box.maxX, f.id).toBeLessThanOrEqual(b.max.x + 1e-6);
        expect(s.box.minY, f.id).toBeGreaterThanOrEqual(b.min.y - 1e-6);
        expect(s.box.maxY, f.id).toBeLessThanOrEqual(b.max.y + 1e-6);
      }
    }
  });

  test('размеры известных корпусов', () => {
    const r0805 = libraryFootprint('R_0805_2012Metric')!;
    expect(r0805.pads[1].at.x - r0805.pads[0].at.x).toBeCloseTo(1.825, 3);
    const dip8 = libraryFootprint('DIP-8_W7.62mm')!;
    expect(dip8.pads.find((p) => p.number === '1')!.at.x).toBeCloseTo(-3.81);
    expect(dip8.pads.find((p) => p.number === '8')!.at.x).toBeCloseTo(3.81);
    expect(dip8.pads.find((p) => p.number === '8')!.at.y).toBeCloseTo(dip8.pads.find((p) => p.number === '1')!.at.y);
    const soic8 = libraryFootprint('SOIC-8_3.9x4.9mm_P1.27mm')!;
    expect(soic8.pads.find((p) => p.number === '5')!.at.y).toBeCloseTo(1.905);
    const nano = libraryFootprint('Module_Arduino_Nano')!;
    const p1 = nano.pads.find((p) => p.number === '1')!;
    const p30 = nano.pads.find((p) => p.number === '30')!;
    expect(p30.at.x - p1.at.x).toBeCloseTo(15.24);
    expect(p30.at.y).toBeCloseTo(p1.at.y);
    expect(p30.name).toBe('D12');
    const pico = libraryFootprint('Module_Raspberry_Pi_Pico')!;
    expect(pico.pads.find((p) => p.number === '40')!.name).toBe('VBUS');
    expect(pico.pads.find((p) => p.number === '21')!.name).toBe('GP16');
  });

  test('поиск и совместимые корпуса', () => {
    expect(searchFootprints('0805 резистор').map((f) => f.id)).toContain('R_0805_2012Metric');
    expect(searchFootprints('dip 16').map((f) => f.id)).toContain('DIP-16_W7.62mm');
    const alt = compatibleFootprints(libraryFootprint('R_1206_3216Metric')!).map((f) => f.id);
    expect(alt).toContain('R_Axial_0.25W_L6.3mm_D2.5mm_P10.16mm_Horizontal');
    expect(alt).not.toContain('SOT-23');
  });
});

describe('шаблоны плат', () => {
  test('каждый шаблон создаёт проект с контуром', () => {
    for (const t of TEMPLATES) {
      const p = t.create();
      expect(p.board.outline.length, t.id).toBeGreaterThanOrEqual(4);
      expect(p.meta.template).toBe(t.id);
      for (const c of Object.values(p.components)) expect(p.footprints[c.footprint], `${t.id}: корпус ${c.footprint}`).toBeTruthy();
    }
  });
});
