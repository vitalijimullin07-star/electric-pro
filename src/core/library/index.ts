import type { FootprintDef } from '../model/types';
import { CAT, CATEGORY_ORDER, GROUP_ORDER } from './categories';
import { allCapacitors } from './generators/capacitors';
import { allConnectors } from './generators/connectors';
import { allCrystals } from './generators/crystals';
import { allDiodes, allLeds } from './generators/diodes';
import { allDisplays } from './generators/displays';
import { allIcs } from './generators/ics';
import { allInductors } from './generators/inductors';
import { allMisc } from './generators/misc';
import { allModules } from './generators/modules';
import { allResistors } from './generators/resistors';
import { allSwitches } from './generators/switches';
import { allTransistors } from './generators/transistors';

export { moduleFootprint, genericModule, MODULE_SPECS } from './generators/modules';
export { pinHeader, jst, screwTerminal, dip, axialResistor, axialDiode, radialCap, radialBoxCap, to92, to220, ledRound, fuseHolder5x20, disc, buzzer12, mountingHole, tactile6x6 } from './generators/tht';
export { chip, CHIP_SPECS, soic, tssop, sot23, sot223, qfp, smaDiode, sodDiode, tantalum } from './generators/smd';
export { CAT, CATEGORY_ORDER, GROUP_ORDER } from './categories';

let cache: FootprintDef[] | null = null;
let byId: Map<string, FootprintDef> | null = null;

/** Вся встроенная библиотека корпусов. Одинаковые идентификаторы схлопываются: побеждает первый. */
export function libraryFootprints(): FootprintDef[] {
  if (!cache) {
    const all = [...allResistors(), ...allCapacitors(), ...allInductors(), ...allDiodes(), ...allLeds(), ...allTransistors(), ...allIcs(), ...allConnectors(), ...allSwitches(), ...allDisplays(), ...allCrystals(), ...allMisc(), ...allModules()];
    byId = new Map();
    for (const f of all) if (!byId.has(f.id)) byId.set(f.id, f);
    cache = [...byId.values()];
  }
  return cache;
}

export function libraryFootprint(id: string): FootprintDef | undefined {
  libraryFootprints();
  return byId!.get(id);
}

export function categories(list: FootprintDef[] = libraryFootprints()): string[] {
  const set = new Set(list.map((f) => f.category));
  return [...CATEGORY_ORDER.filter((c) => set.has(c)), ...[...set].filter((c) => !CATEGORY_ORDER.includes(c)).sort()];
}

/** Подразделы раздела в заданном порядке; корпуса без подраздела попадают в «Прочие». */
export function groupsOf(category: string, list: FootprintDef[] = libraryFootprints()): string[] {
  const set = new Set(list.filter((f) => f.category === category).map((f) => f.group ?? ''));
  const order = GROUP_ORDER[category] ?? [];
  const out = order.filter((g) => set.has(g));
  for (const g of [...set].sort()) if (g && !out.includes(g)) out.push(g);
  if (set.has('')) out.push('');
  return out;
}

/** Дерево «раздел → подраздел → корпуса» для панели библиотеки. */
export function libraryTree(list: FootprintDef[] = libraryFootprints()): { category: string; count: number; groups: { name: string; items: FootprintDef[] }[] }[] {
  return categories(list).map((category) => {
    const items = list.filter((f) => f.category === category);
    return {
      category,
      count: items.length,
      groups: groupsOf(category, list).map((name) => ({ name: name || 'Прочие', items: items.filter((f) => (f.group ?? '') === name) })),
    };
  });
}

const norm = (s: string) => s.toLowerCase().replace(/,/g, '.').replace(/ё/g, 'е').replace(/\s+/g, ' ');

/** Поиск по имени, идентификатору, описанию, разделу и тегам: все слова запроса должны встретиться. */
export function searchFootprints(query: string, list: FootprintDef[] = libraryFootprints()): FootprintDef[] {
  const words = norm(query).split(' ').filter(Boolean);
  if (!words.length) return list;
  return list.filter((f) => {
    const hay = norm([f.id, f.name, f.description ?? '', f.category, f.group ?? '', ...(f.tags ?? [])].join(' '));
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

export const PROJECT_CATEGORY = CAT.PROJ;
