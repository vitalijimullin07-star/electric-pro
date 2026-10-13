import { parseStl, stlSources, type StlModel } from '@core/io/stl';
import { useEditor } from '@editor/store';
import { openFiles } from './files';

/*
 * Открытые модели STL — вне состояния редактора: большие массивы вершин не должны
 * попадать в историю и автосохранение. Окно «Просмотр STL» читает их через подписку;
 * при закрытии окна модели остаются, пока их не убрать.
 */

export interface StlEntry {
  key: string;
  model: StlModel;
  color: string;
  visible: boolean;
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
const tick = () => new Promise((r) => setTimeout(r, 0));

/** Добавить модели из файлов: STL или ZIP с STL внутри. Возвращает, сколько моделей добавлено. */
export async function addStlFiles(files: File[]): Promise<number> {
  const errors: string[] = [];
  const added: StlEntry[] = [];
  let n = 0;
  for (const f of files) {
    try {
      emit({ busy: `Читаю ${f.name}…` });
      await tick();
      const src = stlSources(f.name, new Uint8Array(await f.arrayBuffer()));
      if (!src.length) errors.push(`${f.name}: в архиве нет файлов STL`);
      for (const s of src) {
        emit({ busy: `Читаю ${s.name}${src.length > 1 ? ` (${++n} из ${src.length})` : ''}…` });
        await tick();
        try {
          const model = parseStl(s.bytes, s.name);
          added.push({ key: `stl${++seq}`, model, color: STL_COLORS[(snap.entries.length + added.length) % STL_COLORS.length], visible: true });
        } catch (e) {
          errors.push((e as Error).message);
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

/** Открыть окно просмотра и добавить в него файлы (выбор с устройства, перетаскивание). */
export async function openStlFiles(files: File[]): Promise<void> {
  const s = useEditor.getState();
  if (s.dialog !== 'stl') s.openDialog('stl');
  const n = await addStlFiles(files);
  const err = snap.errors.length;
  useEditor.getState().setMessage(n ? `Открыто моделей STL: ${n}${err ? `, с ошибками: ${err}` : ''}.` : 'Модели STL не открылись — причина в окне просмотра.');
}

/** Выбрать файлы STL или ZIP на устройстве и открыть их. */
export async function pickStlFiles(): Promise<void> {
  const files = await openFiles('.stl,.zip');
  if (files.length) await openStlFiles(files);
}
