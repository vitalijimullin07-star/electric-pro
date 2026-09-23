import type { FootprintDef } from '../model/types';
import { allModules } from './generators/modules';
import { allSmd } from './generators/smd';
import { allTht } from './generators/tht';

export { moduleFootprint, genericModule, MODULE_SPECS } from './generators/modules';
export { pinHeader, jst, screwTerminal, dip, axialResistor, axialDiode, radialCap, radialBoxCap, to92, to220, ledRound, fuseHolder5x20, disc, buzzer12, mountingHole, tactile6x6 } from './generators/tht';
export { chip, CHIP_SPECS, soic, tssop, sot23, sot223, qfp, smaDiode, sodDiode, tantalum } from './generators/smd';

let cache: FootprintDef[] | null = null;
let byId: Map<string, FootprintDef> | null = null;

/** Вся встроенная библиотека корпусов. */
export function libraryFootprints(): FootprintDef[] {
  if (!cache) {
    cache = [...allSmd(), ...allTht(), ...allModules()];
    byId = new Map(cache.map((f) => [f.id, f]));
  }
  return cache;
}

export function libraryFootprint(id: string): FootprintDef | undefined {
  libraryFootprints();
  return byId!.get(id);
}

/** Порядок разделов в панели библиотеки. */
export const CATEGORY_ORDER = [
  'Резисторы',
  'Конденсаторы',
  'Индуктивности',
  'Диоды',
  'Светодиоды',
  'Транзисторы и мелкие корпуса',
  'Микросхемы SMD',
  'Микросхемы выводные',
  'Разъёмы',
  'Модули',
  'Питание',
  'Реле',
  'Дисплеи',
  'Датчики',
  'Кнопки и переключатели',
  'Предохранители',
  'Защита',
  'Крепёж',
  'Разное',
  'Проект',
];

export function categories(list: FootprintDef[] = libraryFootprints()): string[] {
  const set = new Set(list.map((f) => f.category));
  return [...CATEGORY_ORDER.filter((c) => set.has(c)), ...[...set].filter((c) => !CATEGORY_ORDER.includes(c)).sort()];
}

const norm = (s: string) => s.toLowerCase().replace(/,/g, '.').replace(/\s+/g, ' ');

/** Поиск по имени, идентификатору, описанию и тегам: все слова запроса должны встретиться. */
export function searchFootprints(query: string, list: FootprintDef[] = libraryFootprints()): FootprintDef[] {
  const words = norm(query).split(' ').filter(Boolean);
  if (!words.length) return list;
  return list.filter((f) => {
    const hay = norm([f.id, f.name, f.description ?? '', f.category, ...(f.tags ?? [])].join(' '));
    return words.every((w) => hay.includes(w));
  });
}

/** Корпуса с таким же набором номеров выводов — на них можно заменить. */
export function compatibleFootprints(fp: FootprintDef, list: FootprintDef[] = libraryFootprints()): FootprintDef[] {
  const key = fp.pads
    .filter((p) => p.type !== 'npth')
    .map((p) => p.number)
    .sort()
    .join('|');
  return list.filter(
    (f) =>
      f.id !== fp.id &&
      f.pads
        .filter((p) => p.type !== 'npth')
        .map((p) => p.number)
        .sort()
        .join('|') === key,
  );
}
