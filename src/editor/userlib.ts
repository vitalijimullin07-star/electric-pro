import { libraryFootprint } from '@core/library';
import { MY_CATEGORY } from '@core/library/builder';
import type { FootprintDef, Project } from '@core/model/types';
import { safeStorage } from './storage';
import { USERLIB_KEY, useEditor } from './store';

/*
 * «Мои корпуса»: свои и импортированные корпуса. Хранятся в браузере и
 * переносятся файлом; в проект корпус попадает, когда его ставят на плату.
 */

function persist(list: FootprintDef[]): boolean {
  useEditor.setState({ userFootprints: list });
  return safeStorage.setItem(USERLIB_KEY, JSON.stringify(list));
}

/** Сохраняет корпус в «Мои корпуса» (с тем же id — заменяет). */
export function saveUserFootprint(fp: FootprintDef): boolean {
  const list = useEditor.getState().userFootprints.filter((f) => f.id !== fp.id);
  return persist([...list, { ...fp, category: fp.category || MY_CATEGORY }].sort((a, b) => a.name.localeCompare(b.name, 'ru')));
}

export function removeUserFootprint(id: string): void {
  persist(useEditor.getState().userFootprints.filter((f) => f.id !== id));
}

/** Добавляет несколько корпусов (импорт): возвращает, сколько новых и сколько заменено. */
export function addUserFootprints(fps: FootprintDef[]): { added: number; replaced: number } {
  let list = useEditor.getState().userFootprints;
  let added = 0;
  let replaced = 0;
  for (const fp of fps) {
    if (list.some((f) => f.id === fp.id)) replaced++;
    else added++;
    list = [...list.filter((f) => f.id !== fp.id), fp];
  }
  persist(list.sort((a, b) => a.name.localeCompare(b.name, 'ru')));
  return { added, replaced };
}

/** Корпус по id: встроенная библиотека, мои корпуса, корпуса проекта. */
export function findFootprint(id: string, p: Project = useEditor.getState().project): FootprintDef | undefined {
  return libraryFootprint(id) ?? useEditor.getState().userFootprints.find((f) => f.id === id) ?? p.footprints[id];
}

/** Занят ли id (для новых своих корпусов). */
export const footprintIdTaken = (id: string): boolean => !!libraryFootprint(id) || useEditor.getState().userFootprints.some((f) => f.id === id);
