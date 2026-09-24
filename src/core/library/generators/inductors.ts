import type { FootprintDef } from '../../model/types';
import { CAT } from '../categories';
import { CHIP_SPECS, chip } from './smd';
import { fmtP, twoPadSmd, twoPinTht } from './util';

/* Индуктивности: чипы, силовые SMD (CD/CDRH, экранированные), выводные осевые и радиальные. */

const G = { smd: 'SMD чип', power: 'Силовые SMD', tht: 'Выводные' };

function powerInductor(o: { name: string; body: number; h: number; span: number; pad: [number, number]; note?: string; verified?: boolean; round?: boolean }): FootprintDef {
  return twoPadSmd({
    id: `L_${o.name}_${o.body}x${o.body}mm`,
    name: `${o.name} ${o.body}×${o.body}`,
    description: `Силовая SMD индуктивность ${o.name}, корпус ${o.body}×${o.body}×${o.h} мм${o.note ? ', ' + o.note : ''}`,
    category: CAT.L,
    group: G.power,
    refPrefix: 'L',
    span: o.span,
    pad: o.pad,
    body: [o.body, o.body],
    silkBox: true,
    tags: ['inductor', 'power', o.name.toLowerCase()],
    verified: o.verified ?? false,
    height: o.h,
    source: 'Типовые размеры серии',
  });
}

export function allInductors(): FootprintDef[] {
  const out: FootprintDef[] = [];
  for (const s of CHIP_SPECS) if (['0402', '0603', '0805', '1206', '1210', '2010'].includes(s.code)) out.push({ ...chip('L', s), group: G.smd });
  out.push(
    powerInductor({ name: 'CD32', body: 3.5, h: 2.0, span: 2.9, pad: [1.3, 1.6], note: 'открытая, тип CD32' }),
    powerInductor({ name: 'CD43', body: 4.5, h: 3.2, span: 3.6, pad: [1.6, 2.2], note: 'открытая, тип CD43' }),
    powerInductor({ name: 'CD54', body: 5.8, h: 4.5, span: 4.6, pad: [2.2, 2.6], note: 'открытая, тип CD54' }),
    powerInductor({ name: 'CD75', body: 7.8, h: 5.0, span: 6.4, pad: [2.4, 3.0], note: 'открытая, тип CD75' }),
    powerInductor({ name: 'CD105', body: 10.4, h: 5.4, span: 8.6, pad: [3.0, 4.0], note: 'открытая, тип CD105' }),
    powerInductor({ name: 'CDRH5D28', body: 5.7, h: 3.0, span: 4.8, pad: [1.8, 2.4], note: 'экранированная' }),
    powerInductor({ name: 'CDRH6D28', body: 6.7, h: 3.0, span: 5.6, pad: [2.0, 2.8], note: 'экранированная' }),
    powerInductor({ name: 'SMD-0420', body: 4.0, h: 2.0, span: 3.4, pad: [1.4, 3.6], note: 'экранированная 4×4' }),
    powerInductor({ name: 'SMD-0630', body: 6.7, h: 3.0, span: 5.4, pad: [1.8, 6.2], note: 'экранированная 6×6' }),
    powerInductor({ name: 'SMD-1040', body: 10.5, h: 4.0, span: 9.0, pad: [2.6, 9.8], note: 'экранированная 10×10' }),
    powerInductor({ name: 'SMD-1265', body: 12.5, h: 6.5, span: 10.6, pad: [3.0, 12.0], note: 'экранированная 12×12' }),
  );
  out.push(
    twoPinTht({ id: 'L_Axial_L9.5mm_D4.0mm_P12.7mm', name: 'Осевая 0410', description: 'Индуктивность с осевыми выводами (цветовой код), корпус 9,5×4 мм, шаг 12,7 мм', category: CAT.L, group: G.tht, refPrefix: 'L', pitch: 12.7, drill: 0.8, pad: 1.6, body: { len: 9.5, wid: 4.0 }, tags: ['axial', 'inductor'], verified: true, height: 4 }),
    twoPinTht({ id: 'L_Axial_L6.6mm_D2.7mm_P10.16mm', name: 'Осевая 0307', description: 'Индуктивность с осевыми выводами, корпус 6,6×2,7 мм, шаг 10,16 мм', category: CAT.L, group: G.tht, refPrefix: 'L', pitch: 10.16, drill: 0.8, pad: 1.6, body: { len: 6.6, wid: 2.7 }, tags: ['axial', 'inductor'], verified: true, height: 2.7 }),
    twoPinTht({ id: 'L_Radial_D6mm_P5mm', name: 'Радиальная Ø6', description: 'Индуктивность радиальная (RLB0608 и т. п.) Ø6 мм, шаг 5 мм', category: CAT.L, group: G.tht, refPrefix: 'L', pitch: 5.0, drill: 0.8, pad: 1.6, body: { d: 6.0 }, tags: ['radial', 'inductor'], verified: false, height: 8 }),
    twoPinTht({ id: 'L_Radial_D8mm_P5mm', name: 'Радиальная Ø8', description: 'Индуктивность радиальная (RLB0812) Ø8 мм, шаг 5 мм', category: CAT.L, group: G.tht, refPrefix: 'L', pitch: 5.0, drill: 0.8, pad: 1.6, body: { d: 8.0 }, tags: ['radial', 'inductor'], verified: false, height: 12 }),
    twoPinTht({ id: 'L_Radial_D10mm_P5mm', name: 'Радиальная Ø10', description: 'Индуктивность радиальная (RLB0914/1014) Ø10 мм, шаг 5 мм', category: CAT.L, group: G.tht, refPrefix: 'L', pitch: 5.0, drill: 1.0, pad: 2.0, body: { d: 10.0 }, tags: ['radial', 'inductor'], verified: false, height: 14 }),
    twoPinTht({ id: 'L_Toroid_D18mm_P12mm', name: 'Тороид Ø18', description: 'Тороидальный дроссель Ø18 мм стоя, выводы через 12 мм', category: CAT.L, group: G.tht, refPrefix: 'L', pitch: 12.0, drill: 1.2, pad: 2.4, body: { d: 18.0 }, tags: ['toroid', 'inductor'], verified: false, height: 10 }),
    twoPinTht({ id: 'L_Toroid_D25mm_P18mm', name: 'Тороид Ø25', description: 'Тороидальный дроссель Ø25 мм стоя, выводы через 18 мм', category: CAT.L, group: G.tht, refPrefix: 'L', pitch: 18.0, drill: 1.4, pad: 2.8, body: { d: 25.0 }, tags: ['toroid', 'inductor'], verified: false, height: 14 }),
    twoPinTht({ id: 'L_Choke_Vertical_D9mm_P5mm', name: `Дроссель стоя ${fmtP(5)}`, description: 'Дроссель на гантельном сердечнике Ø9 мм стоя (PK0810), шаг 5 мм', category: CAT.L, group: G.tht, refPrefix: 'L', pitch: 5.0, drill: 1.0, pad: 2.0, body: { d: 9.0 }, tags: ['choke', 'inductor'], verified: false, height: 12 }),
  );
  return out;
}
