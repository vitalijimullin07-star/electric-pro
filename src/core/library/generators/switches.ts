import type { FootprintDef, PadDef } from '../../model/types';
import { CAT } from '../categories';
import { dip, tactile6x6 } from './tht';
import { FAB_W, SILK_W, boxFootprint, circle, fmtP, npth, rect, rowX, smd, tht } from './util';

/* Кнопки и переключатели: тактовые (TH и SMD), ползунковые, DIP-переключатели, энкодеры, микропереключатели, клавиатурные. */

const G = { tact: 'Тактовые', slide: 'Ползунковые и DIP', enc: 'Энкодеры', micro: 'Микропереключатели и тумблеры', key: 'Клавиатурные' };

function tactile(kind: '6x6_SMD' | '12x12' | '4.5x4.5' | '3x6_SMD' | '3x4_SMD' | '6x6_2pin' | '6x6_SMD_2pin'): FootprintDef {
  switch (kind) {
    case '6x6_SMD': {
      const pads = [smd('1', -4.0, -2.25, 2.0, 1.4), smd('2', 4.0, -2.25, 2.0, 1.4), smd('3', -4.0, 2.25, 2.0, 1.4), smd('4', 4.0, 2.25, 2.0, 1.4)];
      return boxFootprint({ id: 'SW_PUSH_6mm_SMD', name: 'Кнопка 6×6 SMD', description: 'Тактовая кнопка 6×6 мм SMD, 4 площадки (пары 1–2 и 3–4 соединены внутри)', category: CAT.SW, group: G.tact, refPrefix: 'SW', pads, body: { x0: -3, y0: -3, x1: 3, y1: 3 }, smd: true, extraGraphics: [circle('F.Fab', { x: 0, y: 0 }, 1.75, FAB_W)], verified: false, height: 5, tags: ['tactile', 'button'] });
    }
    case '6x6_SMD_2pin': {
      const pads = [smd('1', -4.0, 0, 2.0, 1.6), smd('2', 4.0, 0, 2.0, 1.6)];
      return boxFootprint({ id: 'SW_PUSH_6mm_SMD_2pin', name: 'Кнопка 6×6 SMD 2 выв.', description: 'Тактовая кнопка 6×6 мм SMD с двумя площадками (низкопрофильная)', category: CAT.SW, group: G.tact, refPrefix: 'SW', pads, body: { x0: -3, y0: -3, x1: 3, y1: 3 }, smd: true, extraGraphics: [circle('F.Fab', { x: 0, y: 0 }, 1.75, FAB_W)], verified: false, height: 3.5, tags: ['tactile', 'button'] });
    }
    case '6x6_2pin': {
      const pads = [tht('1', -3.25, 0, 1.8, 1.8, 1.0, 'rect'), tht('2', 3.25, 0, 1.8, 1.8, 1.0)];
      return boxFootprint({ id: 'SW_PUSH_6mm_2pin', name: 'Кнопка 6×6 2 выв.', description: 'Тактовая кнопка 6×6 мм с двумя выводами через 6,5 мм', category: CAT.SW, group: G.tact, refPrefix: 'SW', pads, body: { x0: -3, y0: -3, x1: 3, y1: 3 }, extraGraphics: [circle('F.Fab', { x: 0, y: 0 }, 1.75, FAB_W)], verified: true, height: 5, tags: ['tactile', 'button'] });
    }
    case '12x12': {
      const pads = [tht('1', -6.25, -2.5, 2.0, 2.0, 1.1, 'rect'), tht('2', 6.25, -2.5, 2.0, 2.0, 1.1), tht('3', -6.25, 2.5, 2.0, 2.0, 1.1), tht('4', 6.25, 2.5, 2.0, 2.0, 1.1)];
      return boxFootprint({ id: 'SW_PUSH_12mm', name: 'Кнопка 12×12', description: 'Тактовая кнопка 12×12 мм, 4 вывода (12,5 × 5,0 мм), под колпачок', category: CAT.SW, group: G.tact, refPrefix: 'SW', pads, body: { x0: -6, y0: -6, x1: 6, y1: 6 }, extraGraphics: [circle('F.Fab', { x: 0, y: 0 }, 3.5, FAB_W)], verified: false, height: 7.3, tags: ['tactile', 'button', '12mm'] });
    }
    case '4.5x4.5': {
      const pads = [tht('1', -3.25, -2.25, 1.6, 1.6, 0.9, 'rect'), tht('2', 3.25, -2.25, 1.6, 1.6, 0.9), tht('3', -3.25, 2.25, 1.6, 1.6, 0.9), tht('4', 3.25, 2.25, 1.6, 1.6, 0.9)];
      return boxFootprint({ id: 'SW_PUSH_4.5mm', name: 'Кнопка 4,5×4,5', description: 'Тактовая кнопка 4,5×4,5 мм, 4 вывода (6,5 × 4,5 мм)', category: CAT.SW, group: G.tact, refPrefix: 'SW', pads, body: { x0: -2.25, y0: -2.25, x1: 2.25, y1: 2.25 }, extraGraphics: [circle('F.Fab', { x: 0, y: 0 }, 1.2, FAB_W)], verified: false, height: 3.8, tags: ['tactile', 'button'] });
    }
    case '3x6_SMD': {
      const pads = [smd('1', -3.5, -1.0, 1.2, 1.0), smd('2', 3.5, -1.0, 1.2, 1.0), smd('3', -3.5, 1.0, 1.2, 1.0), smd('4', 3.5, 1.0, 1.2, 1.0)];
      return boxFootprint({ id: 'SW_PUSH_3x6mm_SMD', name: 'Кнопка 3×6 SMD', description: 'Тактовая кнопка 3×6×2,5 мм SMD, 4 площадки', category: CAT.SW, group: G.tact, refPrefix: 'SW', pads, body: { x0: -3, y0: -1.5, x1: 3, y1: 1.5 }, smd: true, verified: false, height: 2.5, tags: ['tactile', 'button'] });
    }
    case '3x4_SMD': {
      const pads = [smd('1', -2.35, -1.25, 1.1, 0.9), smd('2', 2.35, -1.25, 1.1, 0.9), smd('3', -2.35, 1.25, 1.1, 0.9), smd('4', 2.35, 1.25, 1.1, 0.9)];
      return boxFootprint({ id: 'SW_PUSH_3x4mm_SMD', name: 'Кнопка 3×4 SMD', description: 'Тактовая кнопка 3×4×2 мм SMD, 4 площадки', category: CAT.SW, group: G.tact, refPrefix: 'SW', pads, body: { x0: -2, y0: -1.5, x1: 2, y1: 1.5 }, smd: true, verified: false, height: 2, tags: ['tactile', 'button'] });
    }
  }
}

function slideSwitch(kind: 'SS12D00' | 'SS22D07' | 'MSK12C02_SMD' | 'SS12F15'): FootprintDef {
  switch (kind) {
    case 'SS12D00': {
      const pads = rowX(3, 2.54, (i, x) => tht(String(i + 1), x, 0, 1.6, 1.6, 0.9, i === 0 ? 'rect' : 'circle'));
      return boxFootprint({ id: 'SW_Slide_SS12D00', name: 'Ползунок SS12D00', description: 'Ползунковый переключатель SS12D00 (1P2T), 3 вывода с шагом 2,54 мм, корпус 8,6×3,6 мм', category: CAT.SW, group: G.slide, refPrefix: 'SW', pads, body: { x0: -4.3, y0: -1.8, x1: 4.3, y1: 1.8 }, verified: false, height: 5, tags: ['slide', 'spdt'] });
    }
    case 'SS12F15': {
      const pads = rowX(3, 3.0, (i, x) => tht(String(i + 1), x, 0, 1.8, 1.8, 1.0, i === 0 ? 'rect' : 'circle'));
      return boxFootprint({ id: 'SW_Slide_SS12F15', name: 'Ползунок SS12F15', description: 'Ползунковый переключатель SS12F15 (1P2T), 3 вывода с шагом 3,0 мм, корпус 11,7×4,7 мм', category: CAT.SW, group: G.slide, refPrefix: 'SW', pads, body: { x0: -5.85, y0: -2.35, x1: 5.85, y1: 2.35 }, verified: false, height: 6, tags: ['slide', 'spdt'] });
    }
    case 'SS22D07': {
      const pads: PadDef[] = [];
      for (let i = 0; i < 3; i++) pads.push(tht(String(i + 1), -2.54 + i * 2.54, -2.25, 1.6, 1.6, 0.9, i === 0 ? 'rect' : 'circle'));
      for (let i = 0; i < 3; i++) pads.push(tht(String(i + 4), -2.54 + i * 2.54, 2.25, 1.6, 1.6, 0.9));
      return boxFootprint({ id: 'SW_Slide_SS22D07', name: 'Ползунок SS22D07 (2P2T)', description: 'Ползунковый переключатель SS22D07, 2 группы по 3 вывода (2,54 × 4,5 мм)', category: CAT.SW, group: G.slide, refPrefix: 'SW', pads, body: { x0: -4.3, y0: -3.0, x1: 4.3, y1: 3.0 }, verified: false, height: 5, tags: ['slide', 'dpdt'] });
    }
    case 'MSK12C02_SMD': {
      const pads: PadDef[] = rowX(3, 2.5, (i, x) => smd(String(i + 1), x, -2.6, 1.0, 1.6));
      pads.push(smd('MP1', -4.0, 1.5, 1.4, 1.8, 'rect', { name: 'MP' }), smd('MP2', 4.0, 1.5, 1.4, 1.8, 'rect', { name: 'MP' }));
      return boxFootprint({ id: 'SW_Slide_MSK12C02_SMD', name: 'Ползунок MSK12C02 SMD', description: 'Миниатюрный ползунковый переключатель MSK12C02 SMD (1P2T), выводы 2,5 мм, две крепёжные площадки', category: CAT.SW, group: G.slide, refPrefix: 'SW', pads, body: { x0: -3.6, y0: -1.8, x1: 3.6, y1: 1.8 }, smd: true, verified: false, height: 1.5, tags: ['slide', 'spdt', 'smd'] });
    }
  }
}

function dipSwitch(n: number, isSmd = false): FootprintDef {
  if (!isSmd) return { ...dip(n * 2), id: `SW_DIP_x${String(n).padStart(2, '0')}_W7.62mm`, name: `DIP-переключатель ×${n}`, description: `DIP-переключатель на ${n} позиций, ряды 7,62 мм, шаг 2,54 мм`, category: CAT.SW, group: G.slide, refPrefix: 'SW', tags: ['dip-switch'] };
  const pads: PadDef[] = [];
  const y0 = -((n - 1) * 2.54) / 2;
  for (let i = 0; i < n; i++) pads.push(smd(String(i + 1), -4.2, y0 + i * 2.54, 2.0, 1.2));
  for (let i = 0; i < n; i++) pads.push(smd(String(2 * n - i), 4.2, y0 + i * 2.54, 2.0, 1.2));
  return boxFootprint({ id: `SW_DIP_x${String(n).padStart(2, '0')}_SMD`, name: `DIP-переключатель ×${n} SMD`, description: `DIP-переключатель SMD на ${n} позиций, шаг 2,54 мм, размах площадок 8,4 мм`, category: CAT.SW, group: G.slide, refPrefix: 'SW', pads, body: { x0: -3.4, y0: y0 - 1.5, x1: 3.4, y1: -y0 + 1.5 }, smd: true, verified: false, height: 4, tags: ['dip-switch', 'smd'] });
}

function encoderEc11(): FootprintDef {
  const pads: PadDef[] = [tht('A', -2.5, 7.5, 1.8, 1.8, 1.0, 'rect', { name: 'A' }), tht('C', 0, 7.5, 1.8, 1.8, 1.0, 'circle', { name: 'C' }), tht('B', 2.5, 7.5, 1.8, 1.8, 1.0, 'circle', { name: 'B' }), tht('S1', -2.5, -7.0, 1.8, 1.8, 1.0, 'circle', { name: 'SW' }), tht('S2', 2.5, -7.0, 1.8, 1.8, 1.0, 'circle', { name: 'SW' }), tht('MP1', -5.6, 0, 3.2, 2.2, 1.6, 'oval', { name: 'MP' }), tht('MP2', 5.6, 0, 3.2, 2.2, 1.6, 'oval', { name: 'MP' })];
  return boxFootprint({ id: 'RotaryEncoder_Alps_EC11E_Vertical_H20mm', name: 'Энкодер EC11', description: 'Инкрементальный энкодер EC11 с кнопкой, вертикальный: выводы A, C, B (шаг 2,5 мм), кнопка (2 вывода через 5 мм), лапки крепления через 11,2 мм', category: CAT.SW, group: G.enc, refPrefix: 'SW', pads, body: { x0: -6.0, y0: -6.6, x1: 6.0, y1: 6.6 }, extraGraphics: [circle('F.Fab', { x: 0, y: 0 }, 3.0, FAB_W)], verified: false, height: 20, tags: ['encoder', 'ec11'] });
}
function encoderEc12(): FootprintDef {
  const pads: PadDef[] = [tht('A', -2.5, 5.5, 1.6, 1.6, 0.9, 'rect', { name: 'A' }), tht('C', 0, 5.5, 1.6, 1.6, 0.9, 'circle', { name: 'C' }), tht('B', 2.5, 5.5, 1.6, 1.6, 0.9, 'circle', { name: 'B' }), tht('MP1', -6.1, 0, 3.2, 2.0, 1.4, 'oval', { name: 'MP' }), tht('MP2', 6.1, 0, 3.2, 2.0, 1.4, 'oval', { name: 'MP' })];
  return boxFootprint({ id: 'RotaryEncoder_EC12_Vertical', name: 'Энкодер EC12', description: 'Инкрементальный энкодер EC12 без кнопки, вертикальный: A, C, B с шагом 2,5 мм, лапки через 12,2 мм', category: CAT.SW, group: G.enc, refPrefix: 'SW', pads, body: { x0: -6.2, y0: -6.2, x1: 6.2, y1: 6.2 }, extraGraphics: [circle('F.Fab', { x: 0, y: 0 }, 3.0, FAB_W)], verified: false, height: 15, tags: ['encoder', 'ec12'] });
}

function microSwitch(kind: 'KW11-3Z' | 'KW10' | 'D2F'): FootprintDef {
  const S = { 'KW11-3Z': { pitch: 5.08, body: [19.8, 6.4] as [number, number], h: 10.2, d: 1.2 }, KW10: { pitch: 5.0, body: [12.8, 5.8] as [number, number], h: 6.5, d: 1.0 }, D2F: { pitch: 5.08, body: [12.8, 5.8] as [number, number], h: 6.5, d: 1.0 } }[kind];
  const names = ['COM', 'NO', 'NC'];
  const pads = rowX(3, S.pitch, (i, x) => tht(String(i + 1), x, 0, S.d + 1.0, S.d + 1.0, S.d, i === 0 ? 'rect' : 'circle', { name: names[i] }));
  return boxFootprint({ id: `SW_Micro_${kind}`, name: `Микропереключатель ${kind}`, description: `Микропереключатель ${kind}, 3 вывода с шагом ${fmtP(S.pitch)} мм (COM, NO, NC — сверить), корпус ${S.body[0]}×${S.body[1]} мм`, category: CAT.SW, group: G.micro, refPrefix: 'SW', pads, body: { x0: -S.body[0] / 2, y0: -S.body[1] / 2 - 2, x1: S.body[0] / 2, y1: S.body[1] / 2 - 2 }, verified: false, height: S.h, tags: ['microswitch', kind.toLowerCase()] });
}
function toggleMts(): FootprintDef {
  const pads = rowX(3, 4.7, (i, x) => tht(String(i + 1), x, 0, 2.6, 2.6, 1.5, i === 0 ? 'rect' : 'circle'));
  return boxFootprint({ id: 'SW_Toggle_MTS-102_PCB', name: 'Тумблер MTS-102', description: 'Тумблер MTS-102/103 (ON-ON) с выводами под плату, шаг 4,7 мм, корпус 13×8 мм', category: CAT.SW, group: G.micro, refPrefix: 'SW', pads, body: { x0: -6.5, y0: -4.0, x1: 6.5, y1: 4.0 }, verified: false, height: 20, tags: ['toggle', 'mts'] });
}
function rockerKcd(): FootprintDef {
  const pads = rowX(2, 4.8, (i, x) => tht(String(i + 1), x, 0, 3.0, 2.0, 1.3, 'oval'));
  return boxFootprint({ id: 'SW_Rocker_KCD1_PCB', name: 'Клавиша KCD1', description: 'Клавишный выключатель KCD1-101 (2 вывода) с выводами под плату, шаг 4,8 мм; сам корпус 21×15 мм ставится в панель', category: CAT.SW, group: G.micro, refPrefix: 'SW', pads, body: { x0: -10.5, y0: -7.5, x1: 10.5, y1: 7.5 }, verified: false, height: 25, tags: ['rocker', 'kcd1'] });
}

function cherryMx(kind: 'plate' | 'pcb'): FootprintDef {
  const pads: PadDef[] = [tht('1', -3.81, -2.54, 2.2, 2.2, 1.5, 'circle'), tht('2', 2.54, -5.08, 2.2, 2.2, 1.5, 'circle'), npth(0, 0, 4.0)];
  if (kind === 'pcb') pads.push(npth(-5.08, 0, 1.7), npth(5.08, 0, 1.7));
  return boxFootprint({ id: `SW_Cherry_MX_${kind === 'pcb' ? 'PCB' : 'Plate'}`, name: `Cherry MX (${kind === 'pcb' ? 'на плату' : 'в пластину'})`, description: `Клавиатурный переключатель Cherry MX: контакты в (−3,81; −2,54) и (2,54; −5,08), центральное отверстие Ø4${kind === 'pcb' ? ', направляющие Ø1,7 через 10,16 мм' : ''}. Шаг клавиш 19,05 мм`, category: CAT.SW, group: G.key, refPrefix: 'SW', pads, body: { x0: -7.0, y0: -7.0, x1: 7.0, y1: 7.0 }, extraGraphics: [rect('F.Fab', -9.525, -9.525, 9.525, 9.525, 0.05)], verified: true, height: 11.6, tags: ['keyboard', 'cherry', 'mx'] });
}
function kailhChoc(): FootprintDef {
  const pads: PadDef[] = [tht('1', 0, -5.9, 2.2, 2.2, 1.2), tht('2', 5.0, -3.8, 2.2, 2.2, 1.2), npth(0, 0, 3.4), npth(-5.5, 0, 1.9), npth(5.5, 0, 1.9)];
  return boxFootprint({ id: 'SW_Kailh_Choc_V1', name: 'Kailh Choc v1', description: 'Низкопрофильный клавиатурный переключатель Kailh Choc v1: контакты в (0; −5,9) и (5; −3,8), центральное отверстие Ø3,4, направляющие Ø1,9 через 11 мм', category: CAT.SW, group: G.key, refPrefix: 'SW', pads, body: { x0: -7.0, y0: -7.0, x1: 7.0, y1: 7.0 }, verified: false, height: 8, tags: ['keyboard', 'kailh', 'choc'] });
}

/** Маленькая плёночная кнопка/панельные кнопки на светодиоде: сенсорная площадка. */
function touchPad(d: number): FootprintDef {
  return boxFootprint({ id: `TouchPad_D${d}mm`, name: `Сенсорная площадка Ø${d}`, description: `Круглая медная площадка Ø${d} мм для емкостной сенсорной кнопки (TTP223 и т. п.)`, category: CAT.SW, group: G.tact, refPrefix: 'SW', pads: [smd('1', 0, 0, d, d, 'circle', { name: 'T' })], body: { x0: -d / 2, y0: -d / 2, x1: d / 2, y1: d / 2 }, smd: true, noSilk: true, extraGraphics: [circle('F.Silk', { x: 0, y: 0 }, d / 2 + 0.5, SILK_W)], verified: true, height: 0, tags: ['touch', 'capacitive'] });
}

export function allSwitches(): FootprintDef[] {
  const out: FootprintDef[] = [{ ...tactile6x6(), category: CAT.SW, group: G.tact }];
  out.push(tactile('6x6_SMD'), tactile('6x6_SMD_2pin'), tactile('6x6_2pin'), tactile('12x12'), tactile('4.5x4.5'), tactile('3x6_SMD'), tactile('3x4_SMD'), touchPad(8), touchPad(12));
  out.push(slideSwitch('SS12D00'), slideSwitch('SS12F15'), slideSwitch('SS22D07'), slideSwitch('MSK12C02_SMD'));
  for (const n of [1, 2, 3, 4, 5, 6, 8, 10]) out.push(dipSwitch(n));
  for (const n of [2, 4, 8]) out.push(dipSwitch(n, true));
  out.push(encoderEc11(), encoderEc12(), microSwitch('KW11-3Z'), microSwitch('KW10'), microSwitch('D2F'), toggleMts(), rockerKcd(), cherryMx('plate'), cherryMx('pcb'), kailhChoc());
  return out;
}
