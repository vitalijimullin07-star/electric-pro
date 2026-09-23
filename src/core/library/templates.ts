import { addComponent, addDrawing } from '../model/edit';
import { createProject, rectOutline, type NewProjectOptions } from '../model/project';
import type { Project } from '../model/types';
import { mountingHole, pinHeader } from './generators/tht';

/*
 * Шаблоны плат: контур, крепёжные отверстия и разъёмы стандартных форм-факторов.
 * Размеры отверстий и контуров взяты из официальных чертежей.
 */

export interface BoardTemplate {
  id: string;
  name: string;
  description: string;
  group: 'Пустые' | 'Форм-факторы' | 'Примеры';
  /** Размер для карточки в списке. */
  size: [number, number];
  create(o?: NewProjectOptions): Project;
}

function blank(id: string, name: string, w: number, h: number, description: string, extra: Partial<NewProjectOptions> = {}): BoardTemplate {
  return {
    id,
    name,
    description,
    group: 'Пустые',
    size: [w, h],
    create: (o = {}) => createProject({ name, width: w, height: h, template: id, ...extra, ...o }),
  };
}

function holes(p: Project, m: 2.5 | 3 | 4, pts: [number, number][]): void {
  const fp = mountingHole(m);
  pts.forEach(([x, y], i) => addComponent(p, fp, { x, y }, { ref: `H${i + 1}`, excludeFromBom: true }));
}

export const TEMPLATES: BoardTemplate[] = [
  blank('blank-50x50', 'Пустая 50×50', 50, 50, 'Квадрат 50×50 мм, самый дешёвый размер у большинства заводов'),
  blank('blank-100x100', 'Пустая 100×100', 100, 100, 'Квадрат 100×100 мм — обычный предел дешёвого тарифа'),
  blank('blank-100x80', 'Пустая 100×80', 100, 80, 'Плата 100×80 мм, двусторонняя'),
  blank('blank-lut', 'Дома: ЛУТ 100×70', 100, 70, 'Односторонняя плата под ЛУТ или фоторезист: медь снизу, правила крупные, перемычки проводом', {
    copperLayers: 1,
    homemade: true,
  }),
  blank('eurocard', 'Еврокарта 160×100', 160, 100, 'Еврокарта 160×100 мм (DIN 41494)'),
  blank('half-eurocard', 'Полуеврокарта 100×80', 100, 80, 'Половина еврокарты, 100×80 мм'),
  {
    id: 'arduino-uno-shield',
    name: 'Шилд Arduino Uno',
    description: 'Контур Arduino Uno R3 (68,6×53,3 мм) и четыре крепёжных отверстия Ø3,2 мм по чертежу Arduino. Разъёмы добавьте из библиотеки',
    group: 'Форм-факторы',
    size: [68.58, 53.34],
    create: (o = {}) => {
      const p = createProject({ name: 'Шилд Arduino Uno', width: 68.58, height: 53.34, template: 'arduino-uno-shield', ...o });
      p.board.outline = [
        { x: 0, y: 0 },
        { x: 66.04, y: 0 },
        { x: 68.58, y: 2.54 },
        { x: 68.58, y: 35.56 },
        { x: 66.04, y: 38.1 },
        { x: 66.04, y: 50.8 },
        { x: 63.5, y: 53.34 },
        { x: 0, y: 53.34 },
      ];
      holes(p, 3, [
        [13.97, 2.54],
        [15.24, 50.8],
        [66.04, 7.62],
        [66.04, 35.56],
      ]);
      return p;
    },
  },
  {
    id: 'rpi-hat',
    name: 'Raspberry Pi HAT',
    description: 'Плата HAT 65×56,5 мм со скруглением 3 мм, отверстия под M2,5 и 40-контактный разъём GPIO по спецификации HAT',
    group: 'Форм-факторы',
    size: [65, 56.5],
    create: (o = {}) => {
      const p = createProject({ name: 'Raspberry Pi HAT', width: 65, height: 56.5, cornerRadius: 3, template: 'rpi-hat', ...o });
      holes(p, 2.5, [
        [3.5, 3.5],
        [61.5, 3.5],
        [3.5, 52.5],
        [61.5, 52.5],
      ]);
      // Разъём 2×20 сверху: центр по ширине платы, ряды на 3,5 и 6,04 мм от верхнего края (спецификация HAT+).
      addComponent(p, pinHeader(2, 20, 2.54, { female: true }), { x: 32.5, y: 4.77 }, { ref: 'J1', value: 'GPIO 40' });
      return p;
    },
  },
  {
    id: 'pico-carrier',
    name: 'Плата под Pi Pico',
    description: 'Плата 60×40 мм с двумя гнёздами 1×20 под Raspberry Pi Pico (ряды через 17,78 мм) и отверстиями M3 по углам',
    group: 'Форм-факторы',
    size: [60, 40],
    create: (o = {}) => {
      const p = createProject({ name: 'Плата под Pi Pico', width: 60, height: 40, cornerRadius: 2, template: 'pico-carrier', ...o });
      holes(p, 3, [
        [3.5, 3.5],
        [56.5, 3.5],
        [3.5, 36.5],
        [56.5, 36.5],
      ]);
      const sock = pinHeader(1, 20, 2.54, { female: true });
      addComponent(p, sock, { x: 30, y: 20 - 8.89 }, { ref: 'J1', value: 'Pico, ряд 1' });
      addComponent(p, sock, { x: 30, y: 20 + 8.89 }, { ref: 'J2', value: 'Pico, ряд 2', rotation: 180 });
      return p;
    },
  },
  {
    id: 'din-rail-72',
    name: 'Корпус на DIN-рейку, 72 мм',
    description: 'Плата 72×54 мм под модульный корпус на DIN-рейку 4 модуля (D4MG-ТИП). Габарит типовой — сверить с корпусом',
    group: 'Форм-факторы',
    size: [72, 54],
    create: (o = {}) => {
      const p = createProject({ name: 'Корпус DIN 4M', width: 72, height: 54, cornerRadius: 1, template: 'din-rail-72', ...o });
      addDrawing(p, { kind: 'text', layer: 'F.Silk', at: { x: 36, y: 50 }, text: 'DIN 4M — проверить габарит по корпусу', size: 1.2, align: 'center' });
      return p;
    },
  },
];

export function templateById(id: string): BoardTemplate | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

export { rectOutline };
