import type { FootprintDef, PadDef } from '../../model/types';
import { CAT } from '../categories';
import { buzzer12, dip } from './tht';
import { FAB_W, SILK_W, boxFootprint, circle, line, npth, rect, tht, twoPinTht } from './util';

/* Дисплеи и индикаторы: семисегментные, матрицы, шкалы, зуммеры и динамики. ЖК/OLED-модули — в разделе «Модули». */

const G = { seg: 'Семисегментные', matrix: 'Матрицы и шкалы', buzz: 'Зуммеры и динамики' };

/** Семисегментный индикатор: два ряда по n выводов, шаг 2,54, ряды через rowPitch. */
function sevenSeg(o: { id: string; name: string; description: string; perRow: number; rowPitch: number; body: [number, number]; verified?: boolean; digits?: number }): FootprintDef {
  const pads: PadDef[] = [];
  const x0 = -((o.perRow - 1) * 2.54) / 2;
  for (let i = 0; i < o.perRow; i++) pads.push(tht(String(i + 1), x0 + i * 2.54, o.rowPitch / 2, 1.6, 1.6, 0.8, i === 0 ? 'rect' : 'oval'));
  for (let i = 0; i < o.perRow; i++) pads.push(tht(String(o.perRow + i + 1), x0 + (o.perRow - 1 - i) * 2.54, -o.rowPitch / 2, 1.6, 1.6, 0.8, 'oval'));
  const [W, H] = o.body;
  const extra = [];
  const digits = o.digits ?? 1;
  const dw = W / digits;
  for (let d = 0; d < digits; d++) {
    const cx = -W / 2 + dw * (d + 0.5);
    extra.push(rect('F.Fab', cx - dw * 0.28, -H * 0.36, cx + dw * 0.28, H * 0.36, FAB_W));
  }
  return boxFootprint({ id: o.id, name: o.name, description: o.description, category: CAT.DS, group: G.seg, refPrefix: 'DS', pads, body: { x0: -W / 2, y0: -H / 2, x1: W / 2, y1: H / 2 }, extraGraphics: extra, pin1Mark: { x: x0 - 1.6, y: o.rowPitch / 2 }, verified: o.verified ?? false, height: 8, tags: ['display', '7-segment', 'led'] });
}

function ledMatrix8x8(size: 32 | 38 | 60): FootprintDef {
  const rowPitch = size === 32 ? 25.4 : size === 38 ? 30.48 : 50.8;
  const pads: PadDef[] = [];
  const x0 = -(7 * 2.54) / 2;
  for (let i = 0; i < 8; i++) pads.push(tht(String(i + 1), x0 + i * 2.54, rowPitch / 2, 1.6, 1.6, 0.8, i === 0 ? 'rect' : 'oval'));
  for (let i = 0; i < 8; i++) pads.push(tht(String(9 + i), x0 + (7 - i) * 2.54, -rowPitch / 2, 1.6, 1.6, 0.8, 'oval'));
  const extra = [];
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) extra.push(circle('F.Fab', { x: -size / 2 + (size / 8) * (c + 0.5), y: -size / 2 + (size / 8) * (r + 0.5) }, size / 8 / 2.8, FAB_W));
  return boxFootprint({ id: `LED_Matrix_8x8_${size}mm`, name: `Матрица 8×8, ${size} мм`, description: `Светодиодная матрица 8×8 ${size}×${size} мм (${size === 32 ? '1088AS/BS' : size === 38 ? '1388AS' : '2088AS'}), два ряда по 8 выводов через ${rowPitch} мм`, category: CAT.DS, group: G.matrix, refPrefix: 'DS', pads, body: { x0: -size / 2, y0: -size / 2, x1: size / 2, y1: size / 2 }, extraGraphics: extra, pin1Mark: { x: x0 - 1.6, y: rowPitch / 2 }, verified: false, height: 8, tags: ['display', 'matrix', 'led'] });
}

function barGraph10(): FootprintDef {
  return { ...dip(20), id: 'LED_Bargraph_10_DIP-20', name: 'Шкала 10 сегментов', description: 'Светодиодная шкала на 10 сегментов в корпусе DIP-20 (ряды 7,62 мм), 25,4×10,2 мм', category: CAT.DS, group: G.matrix, refPrefix: 'DS', tags: ['display', 'bargraph', 'led'] };
}

function buzzer(kind: '9mm_P4' | '9.6mm_P5' | 'passive_12mm_P6' | 'smd_9x9' | 'smd_12x12' | 'piezo_20mm'): FootprintDef {
  switch (kind) {
    case '9mm_P4':
      return twoPinTht({ id: 'Buzzer_9x5.5mm_P4mm', name: 'Зуммер Ø9, 4 мм', description: 'Пассивный магнитный зуммер Ø9×5,5 мм, шаг 4 мм', category: CAT.DS, group: G.buzz, refPrefix: 'BZ', pitch: 4.0, drill: 0.8, pad: 1.6, body: { d: 9.0 }, tags: ['buzzer'], verified: false, height: 5.5 });
    case '9.6mm_P5':
      return twoPinTht({ id: 'Buzzer_9.6x5mm_P5mm', name: 'Зуммер Ø9,6, 5 мм', description: 'Активный зуммер Ø9,6×5 мм (TMB09A), шаг 5 мм, плюс — вывод 1', category: CAT.DS, group: G.buzz, refPrefix: 'BZ', pitch: 5.0, drill: 0.8, pad: 1.6, body: { d: 9.6 }, polar: true, padNames: ['+', '-'], tags: ['buzzer'], verified: false, height: 5 });
    case 'passive_12mm_P6':
      return twoPinTht({ id: 'Buzzer_12x8.5mm_P6mm', name: 'Зуммер Ø12, 6 мм', description: 'Пассивный магнитный зуммер Ø12×8,5 мм, шаг 6 мм', category: CAT.DS, group: G.buzz, refPrefix: 'BZ', pitch: 6.0, drill: 0.8, pad: 1.6, body: { d: 12.0 }, tags: ['buzzer'], verified: false, height: 8.5 });
    case 'smd_9x9':
      return boxFootprint({ id: 'Buzzer_SMD_9x9mm', name: 'Зуммер SMD 9×9', description: 'Магнитный зуммер SMD 9×9×3 мм с двумя площадками по краям', category: CAT.DS, group: G.buzz, refPrefix: 'BZ', pads: [{ number: '1', type: 'smd', shape: 'rect', at: { x: -4.2, y: 0 }, size: { x: 1.6, y: 5.0 } }, { number: '2', type: 'smd', shape: 'rect', at: { x: 4.2, y: 0 }, size: { x: 1.6, y: 5.0 } }], body: { x0: -4.5, y0: -4.5, x1: 4.5, y1: 4.5 }, smd: true, extraGraphics: [circle('F.Fab', { x: 0, y: 0 }, 1.0, FAB_W)], verified: false, height: 3, tags: ['buzzer', 'smd'] });
    case 'smd_12x12':
      return boxFootprint({ id: 'Buzzer_SMD_12x12mm', name: 'Зуммер SMD 12×12', description: 'Магнитный зуммер SMD 12×12×3 мм', category: CAT.DS, group: G.buzz, refPrefix: 'BZ', pads: [{ number: '1', type: 'smd', shape: 'rect', at: { x: -5.6, y: 0 }, size: { x: 2.0, y: 6.0 } }, { number: '2', type: 'smd', shape: 'rect', at: { x: 5.6, y: 0 }, size: { x: 2.0, y: 6.0 } }], body: { x0: -6, y0: -6, x1: 6, y1: 6 }, smd: true, extraGraphics: [circle('F.Fab', { x: 0, y: 0 }, 1.2, FAB_W)], verified: false, height: 3, tags: ['buzzer', 'smd'] });
    case 'piezo_20mm':
      return boxFootprint({ id: 'Piezo_Disc_20mm_Wires', name: 'Пьезоизлучатель Ø20', description: 'Пьезоэлектрическая пластина Ø20 мм с проводами: две площадки под провода на расстоянии 5 мм', category: CAT.DS, group: G.buzz, refPrefix: 'BZ', pads: [tht('1', -2.5, 0, 2.0, 2.0, 1.0, 'rect'), tht('2', 2.5, 0, 2.0, 2.0, 1.0)], body: { x0: -10, y0: -10, x1: 10, y1: 10 }, extraGraphics: [circle('F.Fab', { x: 0, y: 0 }, 10, FAB_W), circle('F.Silk', { x: 0, y: 0 }, 10.2, SILK_W)], noSilk: true, verified: true, height: 1, tags: ['piezo'] });
  }
}

function speaker(d: number): FootprintDef {
  return boxFootprint({ id: `Speaker_D${d}mm_Wires`, name: `Динамик Ø${d}`, description: `Динамик Ø${d} мм: две площадки под провода (шаг 5 мм) и контур для разметки`, category: CAT.DS, group: G.buzz, refPrefix: 'LS', pads: [tht('1', -2.5, d / 2 + 3, 2.0, 2.0, 1.0, 'rect'), tht('2', 2.5, d / 2 + 3, 2.0, 2.0, 1.0)], body: { x0: -d / 2, y0: -d / 2, x1: d / 2, y1: d / 2 }, extraGraphics: [circle('F.Fab', { x: 0, y: 0 }, d / 2, FAB_W), circle('F.Silk', { x: 0, y: 0 }, d / 2 + 0.2, SILK_W), ...[0, 45, 90, 135].map((a) => line('F.Fab', { x: -Math.cos((a * Math.PI) / 180) * d * 0.3, y: -Math.sin((a * Math.PI) / 180) * d * 0.3 }, { x: Math.cos((a * Math.PI) / 180) * d * 0.3, y: Math.sin((a * Math.PI) / 180) * d * 0.3 }, FAB_W))], noSilk: true, verified: true, height: 5, tags: ['speaker'] });
}

export function allDisplays(): FootprintDef[] {
  const out: FootprintDef[] = [];
  out.push(
    sevenSeg({ id: 'Display_7Seg_0.56in_1digit', name: '7-сегм. 0,56″ × 1', description: 'Семисегментный индикатор 0,56″ одноразрядный (5161AS/BS), 2 ряда по 5 выводов через 15,24 мм, корпус 12,6×19 мм', perRow: 5, rowPitch: 15.24, body: [12.6, 19.0], verified: true }),
    sevenSeg({ id: 'Display_7Seg_0.36in_1digit', name: '7-сегм. 0,36″ × 1', description: 'Семисегментный индикатор 0,36″ одноразрядный (3161AS), 2 ряда по 5 выводов через 10,16 мм, корпус 9,2×14 мм', perRow: 5, rowPitch: 10.16, body: [9.2, 14.0] }),
    sevenSeg({ id: 'Display_7Seg_0.56in_2digit', name: '7-сегм. 0,56″ × 2', description: 'Семисегментный индикатор 0,56″ двухразрядный (5261AS), 2 ряда по 5 выводов через 15,24 мм, корпус 25×19 мм', perRow: 5, rowPitch: 15.24, body: [25.0, 19.0], digits: 2 }),
    sevenSeg({ id: 'Display_7Seg_0.56in_3digit', name: '7-сегм. 0,56″ × 3', description: 'Семисегментный индикатор 0,56″ трёхразрядный (5361AS), 2 ряда по 6 выводов через 15,24 мм, корпус 38×19 мм', perRow: 6, rowPitch: 15.24, body: [38.0, 19.0], digits: 3 }),
    sevenSeg({ id: 'Display_7Seg_0.56in_4digit', name: '7-сегм. 0,56″ × 4', description: 'Семисегментный индикатор 0,56″ четырёхразрядный (5461AS/BS, с двоеточием), 2 ряда по 6 выводов через 15,24 мм, корпус 50,3×19 мм', perRow: 6, rowPitch: 15.24, body: [50.3, 19.0], digits: 4 }),
    sevenSeg({ id: 'Display_7Seg_0.36in_4digit', name: '7-сегм. 0,36″ × 4', description: 'Семисегментный индикатор 0,36″ четырёхразрядный (3461AS), 2 ряда по 6 выводов через 10,16 мм, корпус 30,1×14 мм', perRow: 6, rowPitch: 10.16, body: [30.1, 14.0], digits: 4 }),
    sevenSeg({ id: 'Display_7Seg_0.8in_1digit', name: '7-сегм. 0,8″ × 1', description: 'Семисегментный индикатор 0,8″ одноразрядный (8011AS), 2 ряда по 5 выводов через 20,32 мм, корпус 19×26 мм', perRow: 5, rowPitch: 20.32, body: [19.0, 26.0] }),
    sevenSeg({ id: 'Display_7Seg_1.0in_1digit', name: '7-сегм. 1,0″ × 1', description: 'Семисегментный индикатор 1,0″ одноразрядный (10011AS), 2 ряда по 5 выводов через 25,4 мм, корпус 24×34 мм', perRow: 5, rowPitch: 25.4, body: [24.0, 34.0] }),
  );
  out.push(ledMatrix8x8(32), ledMatrix8x8(38), ledMatrix8x8(60), barGraph10());
  out.push({ ...buzzer12(), category: CAT.DS, group: G.buzz }, buzzer('9mm_P4'), buzzer('9.6mm_P5'), buzzer('passive_12mm_P6'), buzzer('smd_9x9'), buzzer('smd_12x12'), buzzer('piezo_20mm'), speaker(28), speaker(40), speaker(50));
  out.push(
    boxFootprint({ id: 'Microphone_Electret_D9.7mm', name: 'Микрофон Ø9,7', description: 'Электретный микрофон Ø9,7 мм, два вывода с шагом 2,54 мм (или площадки под провода); экран у вывода 2', category: CAT.DS, group: G.buzz, refPrefix: 'MK', pads: [tht('1', -1.27, 0, 1.8, 1.8, 0.9, 'rect', { name: 'OUT' }), tht('2', 1.27, 0, 1.8, 1.8, 0.9, 'circle', { name: 'GND' })], body: { x0: -4.85, y0: -4.85, x1: 4.85, y1: 4.85 }, extraGraphics: [circle('F.Fab', { x: 0, y: 0 }, 4.85, FAB_W), circle('F.Silk', { x: 0, y: 0 }, 5.0, SILK_W)], noSilk: true, verified: false, height: 6.5, tags: ['microphone', 'electret'] }),
    boxFootprint({ id: 'Microphone_Electret_D6mm', name: 'Микрофон Ø6', description: 'Электретный микрофон Ø6 мм, два вывода с шагом 2 мм', category: CAT.DS, group: G.buzz, refPrefix: 'MK', pads: [tht('1', -1.0, 0, 1.4, 1.4, 0.8, 'rect', { name: 'OUT' }), tht('2', 1.0, 0, 1.4, 1.4, 0.8, 'circle', { name: 'GND' })], body: { x0: -3.0, y0: -3.0, x1: 3.0, y1: 3.0 }, extraGraphics: [circle('F.Fab', { x: 0, y: 0 }, 3.0, FAB_W), circle('F.Silk', { x: 0, y: 0 }, 3.15, SILK_W)], noSilk: true, verified: false, height: 5, tags: ['microphone', 'electret'] }),
  );
  void npth;
  return out;
}
