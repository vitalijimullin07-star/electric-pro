import { describe, expect, test } from 'vitest';
import { autoGraphics, checkFootprint, dualRow, myFootprintId, padRow, quadRow } from '../src/core/library/builder';
import type { FootprintDef } from '../src/core/model/types';

const tht = { type: 'tht' as const, shape: 'circle' as const, size: { x: 1.6, y: 1.6 }, drill: 0.8 };
const smd = { type: 'smd' as const, shape: 'roundrect' as const, size: { x: 1.5, y: 0.6 } };

describe('конструктор корпусов', () => {
  test('ряд: шаг и центрирование', () => {
    const pads = padRow({ count: 5, pitch: 2.54, dir: 'x', style: tht });
    expect(pads.map((p) => p.number)).toEqual(['1', '2', '3', '4', '5']);
    expect(pads[0].at.x).toBeCloseTo(-5.08);
    expect(pads[4].at.x).toBeCloseTo(5.08);
    expect(pads.every((p) => p.drill === 0.8)).toBe(true);
  });

  test('два ряда: нумерация против часовой, как у DIP', () => {
    const pads = dualRow({ perSide: 4, pitch: 2.54, span: 7.62, style: tht });
    const at = (n: string) => pads.find((p) => p.number === n)!.at;
    expect(at('1')).toEqual({ x: -3.81, y: -3.81 });
    expect(at('4')).toEqual({ x: -3.81, y: 3.81 });
    expect(at('5')).toEqual({ x: 3.81, y: 3.81 });
    expect(at('8')).toEqual({ x: 3.81, y: -3.81 });
  });

  test('четыре стороны: 4×n площадок, поперечные повёрнуты', () => {
    const pads = quadRow({ perSide: 12, pitch: 0.5, span: 8.4, style: smd });
    expect(pads).toHaveLength(48);
    expect(new Set(pads.map((p) => p.number)).size).toBe(48);
    expect(pads[12].size).toEqual({ x: 0.6, y: 1.5 });
  });

  test('контур строится по площадкам; проверка ловит ошибки', () => {
    const pads = dualRow({ perSide: 4, pitch: 2.54, span: 7.62, style: tht });
    const g = autoGraphics(pads, { w: 6.35, h: 10 });
    expect(g.graphics.some((x) => x.layer === 'F.Fab' && x.kind === 'rect')).toBe(true);
    expect(g.graphics.some((x) => x.kind === 'text' && x.text === '${REF}')).toBe(true);
    expect(g.courtyard.min.x).toBeLessThan(-4.5);
    const fp: FootprintDef = { id: 'x', name: 'Проба', category: 'Мои корпуса', pads, graphics: g.graphics };
    expect(checkFootprint(fp).errors).toEqual([]);
    const bad = { ...fp, pads: [...pads.slice(0, 2), { ...pads[2], drill: 1.7 }, { ...pads[3], number: '1' }] };
    const r = checkFootprint(bad);
    expect(r.errors.join()).toMatch(/пояска/);
    expect(r.warnings.join()).toMatch(/Повторяются номера 1/);
  });

  test('id своего корпуса: латиница, без повторов', () => {
    const taken = new Set(['My_moy_razem']);
    expect(myFootprintId('Мой разъём', (id) => taken.has(id))).toBe('My_moy_razem_2');
    expect(myFootprintId('DIP-8 узкий', () => false)).toBe('My_dip-8_uzkiy');
  });
});
