import type { FootprintDef, Graphic, PadDef } from '../../model/types';
import { CAT } from '../categories';
import { CRT_SMD, CRT_THT, FAB_W, courtyardAround, crtGraphic, fp, line, rect, refText, smd, tht, valueText } from './util';

/*
 * Корпуса, которых нет среди общих генераторов: модуль ESP32-WROOM-32E (планарный,
 * с антенной) и сетевой трансформатор на плату EI30.
 */

/** ESP32-WROOM-32E / 32UE: 18×25,5 мм, 38 площадок с шагом 1,27 мм, антенна по стороне −Y. */
export function esp32Wroom32E(): FootprintDef {
  const left = ['GND', '3V3', 'EN', 'SENSOR_VP', 'SENSOR_VN', 'IO34', 'IO35', 'IO32', 'IO33', 'IO25', 'IO26', 'IO27', 'IO14', 'IO12'];
  const bottom = ['GND', 'IO13', 'NC', 'NC', 'NC', 'NC', 'NC', 'NC', 'IO15', 'IO2'];
  const right = ['IO0', 'IO4', 'IO16', 'IO17', 'IO5', 'IO18', 'IO19', 'NC', 'IO21', 'RXD0', 'TXD0', 'IO22', 'IO23', 'GND'];
  const pads: PadDef[] = [];
  let n = 1;
  left.forEach((nm, i) => pads.push(smd(String(n++), -8.75, -5.26 + i * 1.27, 1.5, 0.9, 'rect', { name: nm })));
  bottom.forEach((nm, i) => pads.push(smd(String(n++), -5.715 + i * 1.27, 12.5, 0.9, 1.5, 'rect', { name: nm })));
  right.forEach((nm, i) => pads.push(smd(String(n++), 8.75, 11.25 - i * 1.27, 1.5, 0.9, 'rect', { name: nm })));
  const body = { x0: -9, y0: -12.75, x1: 9, y1: 12.75 };
  const crt = courtyardAround(pads, body, CRT_SMD);
  const g: Graphic[] = [
    rect('F.Fab', body.x0, body.y0, body.x1, body.y1, FAB_W),
    // Антенна: под ней не должно быть меди, лучше — за краем платы.
    rect('F.Fab', -9, -12.75, 9, -6.56, FAB_W),
    line('F.Silk', { x: -9.12, y: -12.87 }, { x: 9.12, y: -12.87 }),
    line('F.Silk', { x: -9.12, y: -12.87 }, { x: -9.12, y: -6.1 }),
    line('F.Silk', { x: 9.12, y: -12.87 }, { x: 9.12, y: -6.1 }),
    line('F.Silk', { x: -9.12, y: 12.0 }, { x: -9.12, y: 12.87 }),
    line('F.Silk', { x: -9.12, y: 12.87 }, { x: -6.5, y: 12.87 }),
    line('F.Silk', { x: 9.12, y: 12.0 }, { x: 9.12, y: 12.87 }),
    line('F.Silk', { x: 9.12, y: 12.87 }, { x: 6.5, y: 12.87 }),
    // Метка первого вывода.
    line('F.Silk', { x: -9.8, y: -5.9 }, { x: -9.8, y: -4.6 }, 0.2),
    { kind: 'text', layer: 'F.Fab', at: { x: 0, y: -9.6 }, text: 'антенна', size: 1.2, thickness: 0.15, align: 'center' },
    crtGraphic(crt),
    refText(crt.min.y - 0.8),
    valueText(3),
  ];
  return fp({
    id: 'Module_ESP32-WROOM-32E',
    name: 'ESP32-WROOM-32E',
    description:
      'Модуль ESP32-WROOM-32E/32UE (Espressif), 18×25,5×3,1 мм: 38 планарных площадок с шагом 1,27 мм (14 + 10 + 14). Антенна по стороне −Y — без меди под ней, край — у края платы. Нижняя площадка GND модуля не выведена: для пайки паяльником хватает выводов 1, 15 и 38',
    category: CAT.M,
    group: 'Wi-Fi и Bluetooth',
    tags: ['module', 'smd', 'esp32', 'wroom', 'wifi', 'bluetooth'],
    refPrefix: 'A',
    pads,
    graphics: g,
    courtyard: crt,
    source: 'Даташит ESP32-WROOM-32E v1.8 (Espressif), сверено с KiCad RF_Module:ESP32-WROOM-32E',
    verified: true,
    height: 3.1,
  });
}

/** Сетевой трансформатор на плату EI30 (1,5–2,3 ВА): 230 В → 6…18 В. */
export function transformerEi30(): FootprintDef {
  const pads = [tht('1', -10, -10, 2.4, 2.4, 1.2, 'rect', { name: 'P1' }), tht('2', 10, -10, 2.4, 2.4, 1.2, 'circle', { name: 'P2' }), tht('3', -10, 10, 2.4, 2.4, 1.2, 'circle', { name: 'S1' }), tht('4', 10, 10, 2.4, 2.4, 1.2, 'circle', { name: 'S2' })];
  const body = { x0: -16.25, y0: -13.75, x1: 16.25, y1: 13.75 };
  const crt = courtyardAround(pads, body, CRT_THT);
  return fp({
    id: 'Transformer_EI30_PCB',
    name: 'Трансформатор EI30',
    description:
      'Сетевой трансформатор на плату EI30/15,5 (1,5–2,3 ВА), корпус 32,5×27,5 мм: первичная обмотка P1–P2 (230 В) сверху, вторичная S1–S2 снизу, между рядами 20 мм. Разметка выводов у производителей разная (Block VB, Myrra 44xxx, HAHN BV EI 302) — сверьте с даташитом выбранного',
    category: CAT.PS,
    group: 'AC-DC',
    tags: ['transformer', 'ei30', 'mains'],
    refPrefix: 'TV',
    pads,
    graphics: [
      rect('F.Fab', body.x0, body.y0, body.x1, body.y1, FAB_W),
      rect('F.Silk', body.x0 - 0.1, body.y0 - 0.1, body.x1 + 0.1, body.y1 + 0.1, 0.12),
      line('F.Silk', { x: -14, y: 0 }, { x: 14, y: 0 }, 0.12),
      { kind: 'text', layer: 'F.Silk', at: { x: 0, y: -5 }, text: '~230V', size: 1.2, thickness: 0.18, align: 'center' },
      crtGraphic(crt),
      refText(crt.min.y - 0.8),
      valueText(5),
    ],
    courtyard: crt,
    source: 'Типовой трансформатор EI30/15,5 на плату',
    verified: false,
    height: 23,
  });
}

export function allSpecial(): FootprintDef[] {
  return [esp32Wroom32E(), transformerEi30()];
}
