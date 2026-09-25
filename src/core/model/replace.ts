import { changeFootprint, pruneFootprints } from './edit';
import type { Component, FootprintDef, Id, Project } from './types';

/*
 * Массовая замена корпусов: все резисторы 0805 → 1206, все транзисторы TO-92 → SOT-23
 * или выбранные детали. Заменить можно на корпус с тем же набором номеров выводов:
 * цепи выводов сохраняются, положение и поворот детали — тоже.
 */

/** Буквенная часть обозначения: R12 → R, VT3 → VT. */
export function refPrefix(ref: string): string {
  return (/^[A-Za-zА-Яа-я]+/.exec(ref)?.[0] ?? '?').toUpperCase();
}

const TYPES: [string[], string][] = [
  [['R', 'RN'], 'Резисторы'],
  [['RV', 'VR', 'RP'], 'Переменные и варисторы'],
  [['C', 'CP'], 'Конденсаторы'],
  [['Q', 'VT'], 'Транзисторы'],
  [['D', 'VD', 'LED', 'HL'], 'Диоды и светодиоды'],
  [['U', 'IC', 'DA', 'DD'], 'Микросхемы'],
  [['L', 'FB'], 'Катушки'],
  [['J', 'X', 'XS', 'XP', 'P', 'CN', 'CON'], 'Разъёмы'],
  [['SW', 'S', 'SB', 'BTN'], 'Кнопки'],
  [['K', 'RL'], 'Реле'],
  [['F', 'FU'], 'Предохранители'],
  [['Y', 'ZQ'], 'Кварцы'],
  [['BZ', 'BQ', 'LS'], 'Звук'],
  [['M', 'A', 'MOD'], 'Модули'],
  [['H', 'MH'], 'Отверстия'],
  [['T', 'TR', 'TV'], 'Трансформаторы'],
  [['BT', 'G'], 'Батареи'],
];

/** Название типа детали по обозначению. */
export function typeName(prefix: string): string {
  for (const [list, name] of TYPES) if (list.includes(prefix)) return name;
  return `Прочие (${prefix})`;
}

/** Ключ набора выводов: заменять можно только корпуса с одинаковым ключом. */
export function pinKey(fp: FootprintDef): string {
  return fp.pads
    .filter((p) => p.type !== 'npth')
    .map((p) => p.number)
    .filter((n, i, a) => a.indexOf(n) === i)
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
    .join('|');
}

export interface ComponentGroup {
  id: string;
  label: string;
  components: Component[];
}

/** Группы деталей: по типу (обозначению) и по текущему корпусу. */
export function replaceGroups(p: Project): { byType: ComponentGroup[]; byFootprint: ComponentGroup[] } {
  const comps = Object.values(p.components).sort((a, b) => a.ref.localeCompare(b.ref, 'ru', { numeric: true }));
  const types = new Map<string, Component[]>();
  const fps = new Map<string, Component[]>();
  for (const c of comps) {
    const t = typeName(refPrefix(c.ref));
    types.set(t, [...(types.get(t) ?? []), c]);
    fps.set(c.footprint, [...(fps.get(c.footprint) ?? []), c]);
  }
  return {
    byType: [...types].map(([label, components]) => ({ id: 'type:' + label, label, components })).sort((a, b) => b.components.length - a.components.length),
    byFootprint: [...fps].map(([id, components]) => ({ id: 'fp:' + id, label: p.footprints[id]?.name ?? id, components })).sort((a, b) => b.components.length - a.components.length),
  };
}

/** Корпуса из списка, на которые можно заменить все эти детали (одинаковые выводы). */
export function replacementCandidates(p: Project, ids: Id[], list: FootprintDef[]): { key: string | null; candidates: FootprintDef[] } {
  const keys = new Set(ids.map((id) => p.footprints[p.components[id]?.footprint ?? '']).filter((f): f is FootprintDef => !!f).map(pinKey));
  if (keys.size !== 1) return { key: null, candidates: [] };
  const key = [...keys][0];
  return { key, candidates: list.filter((f) => pinKey(f) === key) };
}

/** Меняет корпус у деталей; возвращает, у каких получилось. */
export function replaceFootprints(d: Project, ids: Id[], fp: FootprintDef): { changed: Id[]; failed: Id[]; same: Id[] } {
  const changed: Id[] = [];
  const failed: Id[] = [];
  const same: Id[] = [];
  for (const id of ids) {
    const c = d.components[id];
    if (!c) continue;
    if (c.footprint === fp.id) {
      same.push(id);
      continue;
    }
    if (changeFootprint(d, id, fp)) changed.push(id);
    else failed.push(id);
  }
  pruneFootprints(d);
  return { changed, failed, same };
}
