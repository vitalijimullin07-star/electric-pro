import { buildModel, modelSources, parseStl, rotateX90, splitBodies, type StlModel } from '@core/io/stl';
import { cadParts } from '@core/io/step';
import { useEditor } from '@editor/store';
import { openFiles } from './files';
import { readCad } from './occt';

/*
 * Открытые модели (STL, STEP, IGES) — вне состояния редактора: большие массивы вершин не должны
 * попадать в историю и автосохранение. Окно «Просмотр STL» читает их через подписку;
 * при закрытии окна модели остаются, пока их не убрать.
 */

export interface StlEntry {
  key: string;
  model: StlModel;
  color: string;
  visible: boolean;
  /** Сборка, из которой деталь (файл STEP или модель, разбитая на тела). */
  group?: string;
  /** Узлы сборки над деталью. */
  path?: string;
}

export interface StlSnap {
  entries: StlEntry[];
  /** Что сейчас читается (для подписи), null — ничего. */
  busy: string | null;
  errors: string[];
}

export const STL_COLORS = ['#e9ad5a', '#7fa7dc', '#8fc06f', '#d98bb3', '#c9ced6', '#e07b5f', '#6cc2c2', '#c9b458'];

let snap: StlSnap = { entries: [], busy: null, errors: [] };
const subs = new Set<() => void>();
const emit = (patch: Partial<StlSnap>) => {
  snap = { ...snap, ...patch };
  subs.forEach((f) => f());
};

export const stlSnapshot = (): StlSnap => snap;
export function subscribeStl(f: () => void): () => void {
  subs.add(f);
  return () => subs.delete(f);
}
export function updateStlEntries(fn: (e: StlEntry[]) => StlEntry[]): void {
  emit({ entries: fn(snap.entries) });
}
export function clearStlErrors(): void {
  emit({ errors: [] });
}

let seq = 0;
let cadLoaded = false;
const tick = () => new Promise((r) => setTimeout(r, 0));
const hex = (c: [number, number, number]) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(1, v * 0.8 + 0.15)) * 255).toString(16).padStart(2, '0')).join('');
const baseName = (n: string) => n.slice(n.lastIndexOf('/') + 1);

/** Добавить модели из файлов: STL, STEP, IGES или ZIP с ними. Возвращает, сколько моделей добавлено. */
export async function addStlFiles(files: File[]): Promise<number> {
  const errors: string[] = [];
  const added: StlEntry[] = [];
  const color = () => STL_COLORS[(snap.entries.length + added.length) % STL_COLORS.length];
  let n = 0;
  for (const f of files) {
    try {
      emit({ busy: `Читаю ${f.name}…` });
      await tick();
      const src = modelSources(f.name, new Uint8Array(await f.arrayBuffer()));
      if (!src.length) errors.push(`${f.name}: в архиве нет моделей STL, STEP или IGES`);
      for (const s of src) {
        emit({ busy: `Читаю ${s.name}${src.length > 1 ? ` (${++n} из ${src.length})` : ''}…` });
        await tick();
        try {
          if (s.kind === 'stl') {
            added.push({ key: `stl${++seq}`, model: parseStl(s.bytes, s.name), color: color(), visible: true });
            continue;
          }
          if (!cadLoaded) emit({ busy: `Загружаю модуль чтения ${s.kind === 'iges' ? 'IGES' : 'STEP'} (OpenCascade, 7,5 МБ — только в первый раз)…` });
          const parts = cadParts(await readCad(s.bytes, s.kind));
          cadLoaded = true;
          if (!parts.length) throw new Error('в файле нет тел');
          emit({ busy: `Собираю детали: ${s.name} (${parts.length})…` });
          await tick();
          let models = parts.map((p) => ({ m: buildModel(p.positions, p.name, p.normals ?? undefined), p }));
          // Одно «составное» тело без дерева сборки — разобрать на тела.
          if (models.length === 1 && (models[0].m.edges?.bodies ?? 1) > 1) models = splitBodies(models[0].m).map((m) => ({ m, p: models[0].p }));
          const group = models.length > 1 ? baseName(s.name) : undefined;
          for (const { m, p } of models) added.push({ key: `stl${++seq}`, model: m, color: p.color ? hex(p.color) : color(), visible: true, group, path: p.path || undefined });
        } catch (e) {
          const msg = (e as Error).message;
          errors.push(msg.startsWith(baseName(s.name)) ? msg : `${baseName(s.name)}: ${msg}`);
        }
      }
      n = 0;
    } catch (e) {
      errors.push(/^.+?: /.test((e as Error).message) ? (e as Error).message : `${f.name}: ${(e as Error).message || 'не удалось прочитать'}`);
    }
  }
  emit({ entries: [...snap.entries, ...added], busy: null, errors: [...snap.errors, ...errors] });
  return added.length;
}

/** Разбить модель на тела (сборка одним файлом): вместо неё — детали в группе с её именем. */
export function splitStlEntry(key: string): number {
  const e = snap.entries.find((x) => x.key === key);
  if (!e) return 0;
  const bodies = splitBodies(e.model);
  if (bodies.length < 2) return 1;
  const group = e.group ?? baseName(e.model.name);
  const parts: StlEntry[] = bodies.map((m, i) => ({ key: `stl${++seq}`, model: m, color: STL_COLORS[i % STL_COLORS.length], visible: e.visible, group, path: e.path }));
  emit({ entries: snap.entries.flatMap((x) => (x.key === key ? parts : [x])) });
  return bodies.length;
}

/** Повернуть все модели на 90° вокруг X (модель из САПР с осью Y вверх лежит на боку). */
export function rotateAllStl(): void {
  emit({ entries: snap.entries.map((e) => ({ ...e, model: rotateX90(e.model) })) });
}

/** Открыть окно просмотра и добавить в него файлы (выбор с устройства, перетаскивание). */
export async function openStlFiles(files: File[]): Promise<void> {
  const s = useEditor.getState();
  if (s.dialog !== 'stl') s.openDialog('stl');
  const n = await addStlFiles(files);
  const err = snap.errors.length;
  useEditor.getState().setMessage(n ? `Открыто моделей: ${n}${err ? `, с ошибками: ${err}` : ''}.` : 'Модели не открылись — причина в окне просмотра.');
}

/** Расширения, которые открывает просмотр. */
export const MODEL_FILES = /\.(stl|step|stp|iges|igs|zip)$/i;

/** Выбрать файлы STL, STEP, IGES или ZIP на устройстве и открыть их. */
export async function pickStlFiles(): Promise<void> {
  const files = await openFiles('.stl,.step,.stp,.iges,.igs,.zip');
  if (files.length) await openStlFiles(files);
}
