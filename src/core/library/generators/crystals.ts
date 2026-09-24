import type { FootprintDef, PadDef } from '../../model/types';
import { CAT } from '../categories';
import { FAB_W, SILK_W, boxFootprint, circle, fmtP, line, rowX, smd, tht, twoPinTht } from './util';

/* Кварцевые резонаторы, генераторы и керамические резонаторы. */

const G = { smd: 'SMD', tht: 'Выводные', osc: 'Генераторы и резонаторы' };

function smd4(o: { id: string; name: string; description: string; body: [number, number]; dx: number; dy: number; pad: [number, number]; verified?: boolean; h?: number }): FootprintDef {
  const pads: PadDef[] = [smd('1', -o.dx, o.dy, o.pad[0], o.pad[1]), smd('2', o.dx, o.dy, o.pad[0], o.pad[1]), smd('3', o.dx, -o.dy, o.pad[0], o.pad[1]), smd('4', -o.dx, -o.dy, o.pad[0], o.pad[1])];
  return boxFootprint({ id: o.id, name: o.name, description: o.description, category: CAT.Y, group: G.smd, refPrefix: 'Y', pads, body: { x0: -o.body[0] / 2, y0: -o.body[1] / 2, x1: o.body[0] / 2, y1: o.body[1] / 2 }, smd: true, pin1Mark: { x: -o.body[0] / 2 - 0.6, y: o.body[1] / 2 + 0.4 }, verified: o.verified ?? false, height: o.h ?? 0.8, tags: ['crystal', 'smd'] });
}
function smd2(o: { id: string; name: string; description: string; body: [number, number]; span: number; pad: [number, number]; verified?: boolean; h?: number }): FootprintDef {
  const pads: PadDef[] = [smd('1', -o.span / 2, 0, o.pad[0], o.pad[1]), smd('2', o.span / 2, 0, o.pad[0], o.pad[1])];
  return boxFootprint({ id: o.id, name: o.name, description: o.description, category: CAT.Y, group: G.smd, refPrefix: 'Y', pads, body: { x0: -o.body[0] / 2, y0: -o.body[1] / 2, x1: o.body[0] / 2, y1: o.body[1] / 2 }, smd: true, verified: o.verified ?? false, height: o.h ?? 0.9, tags: ['crystal', 'smd'] });
}

export function allCrystals(): FootprintDef[] {
  const out: FootprintDef[] = [];
  out.push(
    smd4({ id: 'Crystal_SMD_3225-4Pin_3.2x2.5mm', name: 'Кварц 3225', description: 'Кварцевый резонатор SMD 3,2×2,5 мм, 4 площадки (1 и 3 — кристалл, 2 и 4 — корпус/земля)', body: [3.2, 2.5], dx: 1.1, dy: 0.85, pad: [1.4, 1.2], verified: true, h: 0.8 }),
    smd4({ id: 'Crystal_SMD_2520-4Pin_2.5x2.0mm', name: 'Кварц 2520', description: 'Кварцевый резонатор SMD 2,5×2,0 мм, 4 площадки', body: [2.5, 2.0], dx: 0.85, dy: 0.7, pad: [1.1, 0.9], h: 0.6 }),
    smd4({ id: 'Crystal_SMD_2016-4Pin_2.0x1.6mm', name: 'Кварц 2016', description: 'Кварцевый резонатор SMD 2,0×1,6 мм, 4 площадки', body: [2.0, 1.6], dx: 0.75, dy: 0.6, pad: [0.9, 0.8], h: 0.5 }),
    smd4({ id: 'Crystal_SMD_5032-4Pin_5.0x3.2mm', name: 'Кварц 5032', description: 'Кварцевый резонатор SMD 5,0×3,2 мм, 4 площадки', body: [5.0, 3.2], dx: 1.85, dy: 1.1, pad: [1.9, 1.6], h: 1.0 }),
    smd4({ id: 'Crystal_SMD_7050-4Pin_7.0x5.0mm', name: 'Кварц 7050', description: 'Кварцевый резонатор / генератор SMD 7,0×5,0 мм, 4 площадки', body: [7.0, 5.0], dx: 2.55, dy: 2.1, pad: [2.0, 1.6], h: 1.3 }),
    smd2({ id: 'Crystal_SMD_5032-2Pin_5.0x3.2mm', name: 'Кварц 5032 (2)', description: 'Кварцевый резонатор SMD 5,0×3,2 мм, 2 площадки', body: [5.0, 3.2], span: 4.2, pad: [1.8, 2.4], h: 1.0 }),
    smd2({ id: 'Crystal_SMD_HC49-SD', name: 'Кварц HC-49SM', description: 'Кварцевый резонатор HC-49/SD (HC-49SM) SMD, 11,4×4,7 мм, 2 площадки', body: [11.4, 4.7], span: 9.8, pad: [5.5, 1.9], h: 3.8 }),
    smd2({ id: 'Crystal_SMD_3215-2Pin_3.2x1.5mm', name: 'Кварц 3215 (32,768 кГц)', description: 'Часовой кварц 32,768 кГц SMD 3,2×1,5 мм, 2 площадки', body: [3.2, 1.5], span: 2.7, pad: [1.4, 1.8], h: 0.9 }),
    smd2({ id: 'Crystal_SMD_2012-2Pin_2.0x1.2mm', name: 'Кварц 2012 (32,768 кГц)', description: 'Часовой кварц 32,768 кГц SMD 2,0×1,2 мм, 2 площадки', body: [2.0, 1.2], span: 1.7, pad: [0.9, 1.4], h: 0.6 }),
    smd2({ id: 'Crystal_SMD_MC-146_7.0x1.5mm', name: 'Кварц MC-146 (32,768 кГц)', description: 'Часовой кварц Epson MC-146 SMD 7,0×1,5 мм, 2 площадки', body: [7.0, 1.5], span: 6.4, pad: [1.8, 2.0], h: 1.4 }),
  );
  out.push(
    twoPinTht({ id: 'Crystal_HC49-4H_Vertical', name: 'Кварц HC-49S', description: 'Кварцевый резонатор HC-49/S (HC-49US) вертикальный, 11,05×4,65 мм, шаг 4,88 мм', category: CAT.Y, group: G.tht, refPrefix: 'Y', pitch: 4.88, drill: 0.8, pad: 1.6, body: { len: 11.05, wid: 4.65 }, tags: ['crystal', 'hc49'], verified: true, height: 3.5 }),
    twoPinTht({ id: 'Crystal_HC49-U_Vertical', name: 'Кварц HC-49U', description: 'Кварцевый резонатор HC-49/U (высокий) вертикальный, 11,05×4,65 мм, шаг 4,88 мм', category: CAT.Y, group: G.tht, refPrefix: 'Y', pitch: 4.88, drill: 0.8, pad: 1.6, body: { len: 11.05, wid: 4.65 }, tags: ['crystal', 'hc49'], verified: true, height: 13.5 }),
    twoPinTht({ id: 'Crystal_HC49-U_Horizontal', name: 'Кварц HC-49U лежа', description: 'Кварцевый резонатор HC-49/U положен на плату, выводы согнуты, шаг 4,88 мм', category: CAT.Y, group: G.tht, refPrefix: 'Y', pitch: 4.88, drill: 0.8, pad: 1.6, body: { len: 4.65, wid: 13.5 }, tags: ['crystal', 'hc49', 'horizontal'], verified: false, height: 4.65 }),
    twoPinTht({ id: 'Crystal_C2_D2.0mm_L6.0mm_Vertical', name: 'Кварц Ø2×6 (32,768 кГц)', description: 'Часовой кварц 32,768 кГц в цилиндре Ø2×6 мм, вертикально, шаг 0,7 мм → выводы разведены на 2,0 мм', category: CAT.Y, group: G.tht, refPrefix: 'Y', pitch: 2.0, drill: 0.6, pad: 1.2, body: { d: 2.2, at: 0 }, tags: ['crystal', '32768'], verified: false, height: 6.5 }),
    twoPinTht({ id: 'Crystal_C2_D2.0mm_L6.0mm_Horizontal', name: 'Кварц Ø2×6 лежа', description: 'Часовой кварц Ø2×6 мм положен на плату, выводы через 1,3 мм разведены на 2,54 мм', category: CAT.Y, group: G.tht, refPrefix: 'Y', pitch: 2.54, drill: 0.6, pad: 1.2, body: { len: 6.0, wid: 2.0 }, tags: ['crystal', '32768', 'horizontal'], verified: false, height: 2.0 }),
    twoPinTht({ id: 'Crystal_C3_D3.0mm_L8.0mm_Horizontal', name: 'Кварц Ø3×8 лежа', description: 'Часовой кварц Ø3×8 мм положен на плату, выводы разведены на 2,54 мм', category: CAT.Y, group: G.tht, refPrefix: 'Y', pitch: 2.54, drill: 0.6, pad: 1.2, body: { len: 8.0, wid: 3.0 }, tags: ['crystal', '32768', 'horizontal'], verified: false, height: 3.0 }),
  );
  out.push(
    boxFootprint({ id: 'Oscillator_DIP-8_Half', name: 'Генератор DIP-8 (половинный)', description: 'Кварцевый генератор в металлическом корпусе DIP-8 половинного размера (4 вывода по углам 7,62 × 7,62 мм)', category: CAT.Y, group: G.osc, refPrefix: 'X', pads: [tht('1', -3.81, -3.81, 1.6, 1.6, 0.8, 'rect'), tht('4', -3.81, 3.81, 1.6, 1.6, 0.8), tht('5', 3.81, 3.81, 1.6, 1.6, 0.8), tht('8', 3.81, -3.81, 1.6, 1.6, 0.8)], body: { x0: -6.6, y0: -5.1, x1: 6.6, y1: 5.1 }, extraGraphics: [line('F.Silk', { x: -6.7, y: -3.5 }, { x: -6.7, y: -5.2 }, 0.3)], verified: true, height: 5, tags: ['oscillator', 'dip8'] }),
    boxFootprint({ id: 'Oscillator_DIP-14_Full', name: 'Генератор DIP-14 (полный)', description: 'Кварцевый генератор в металлическом корпусе DIP-14 (4 вывода по углам 15,24 × 7,62 мм)', category: CAT.Y, group: G.osc, refPrefix: 'X', pads: [tht('1', -7.62, -3.81, 1.6, 1.6, 0.8, 'rect'), tht('7', -7.62, 3.81, 1.6, 1.6, 0.8), tht('8', 7.62, 3.81, 1.6, 1.6, 0.8), tht('14', 7.62, -3.81, 1.6, 1.6, 0.8)], body: { x0: -10.2, y0: -5.1, x1: 10.2, y1: 5.1 }, verified: true, height: 5, tags: ['oscillator', 'dip14'] }),
    smd4({ id: 'Oscillator_SMD_3225-4Pin', name: 'Генератор 3225', description: 'Кварцевый генератор SMD 3,2×2,5 мм, 4 площадки (EN/NC, GND, OUT, VDD)', body: [3.2, 2.5], dx: 1.1, dy: 0.85, pad: [1.4, 1.2], h: 1.2 }),
    smd4({ id: 'Oscillator_SMD_5032-4Pin', name: 'Генератор 5032', description: 'Кварцевый генератор SMD 5,0×3,2 мм, 4 площадки', body: [5.0, 3.2], dx: 1.85, dy: 1.1, pad: [1.9, 1.6], h: 1.3 }),
    boxFootprint({ id: 'Resonator_Ceramic_3Pin_P2.5mm', name: 'Керамический резонатор ZTT', description: `Керамический резонатор ZTT/ZTA с встроенными конденсаторами, 3 вывода с шагом ${fmtP(2.5)} мм (средний — земля)`, category: CAT.Y, group: G.osc, refPrefix: 'Y', pads: rowX(3, 2.5, (i, x) => tht(String(i + 1), x, 0, 1.4, 1.4, 0.8, i === 0 ? 'rect' : 'circle', { name: ['1', 'GND', '3'][i] })), body: { x0: -3.9, y0: -1.7, x1: 3.9, y1: 1.7 }, verified: false, height: 8, tags: ['resonator', 'ceramic'] }),
    boxFootprint({ id: 'Resonator_Ceramic_2Pin_P5.0mm', name: 'Керамический резонатор 2 выв.', description: 'Керамический резонатор без конденсаторов (ZTB), 2 вывода с шагом 5,0 мм', category: CAT.Y, group: G.osc, refPrefix: 'Y', pads: rowX(2, 5.0, (i, x) => tht(String(i + 1), x, 0, 1.6, 1.6, 0.8, i === 0 ? 'rect' : 'circle')), body: { x0: -3.9, y0: -1.7, x1: 3.9, y1: 1.7 }, verified: false, height: 8, tags: ['resonator', 'ceramic'] }),
    boxFootprint({ id: 'Resonator_SAW_3Pin_TO-39', name: 'ПАВ-резонатор TO-39', description: 'ПАВ-резонатор 433 МГц в корпусе TO-39, 3 вывода по кругу с шагом 2,54 (в линию 1,27)', category: CAT.Y, group: G.osc, refPrefix: 'Y', pads: [tht('1', -2.54, 0, 1.4, 1.4, 0.8, 'rect'), tht('2', 0, 0, 1.4, 1.4, 0.8), tht('3', 2.54, 0, 1.4, 1.4, 0.8)], body: { x0: -4.5, y0: -4.5, x1: 4.5, y1: 4.5 }, extraGraphics: [circle('F.Fab', { x: 0, y: 0 }, 4.5, FAB_W), circle('F.Silk', { x: 0, y: 0 }, 4.6, SILK_W)], noSilk: true, verified: false, height: 6, tags: ['saw', 'resonator'] }),
  );
  return out;
}
