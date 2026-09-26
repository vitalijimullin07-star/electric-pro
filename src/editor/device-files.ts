import { newId } from '@core/ids';
import { migrateProject, serializeProject } from '@core/io/project-file';
import type { Project } from '@core/model/types';

/*
 * «Мои проекты» — файлы проектов в памяти устройства (IndexedDB браузера или
 * установленного приложения). Сохранение — без окна скачивания и без предела
 * localStorage; браузер просим не стирать эти данные (navigator.storage.persist).
 * Списку хватает коротких описаний (meta), сам проект лежит отдельно (data).
 */

export interface SavedMeta {
  id: string;
  name: string;
  /** Когда сохранён на устройство. */
  saved: string;
  /** Ключ проекта: дата создания и имя — чтобы один и тот же проект не множился. */
  key: string;
  size: string;
  components: number;
  bytes: number;
  firmware?: string;
}

const DB_NAME = 'plata-files';
const DB_VERSION = 1;
let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('браузер не даёт хранить файлы (IndexedDB недоступен)'));
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('data')) d.createObjectStore('data', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new Error('не удалось открыть хранилище проектов: ' + (req.error?.message ?? '')));
    req.onblocked = () => reject(new Error('хранилище проектов занято другой вкладкой'));
  }).catch((e) => {
    dbPromise = null;
    throw e;
  });
  return dbPromise;
}

function done(t: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error ?? new Error('ошибка хранилища'));
    t.onabort = () => reject(t.error?.name === 'QuotaExceededError' ? new Error('на устройстве не хватает места') : (t.error ?? new Error('запись прервана')));
  });
}

function get<T>(store: IDBObjectStore, key: IDBValidKey): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const r = store.get(key);
    r.onsuccess = () => resolve(r.result as T | undefined);
    r.onerror = () => reject(r.error);
  });
}

export const projectKey = (p: Project): string => `${p.meta.created}|${p.meta.name}`;

function describe(p: Project, id: string, text: string): SavedMeta {
  const xs = p.board.outline.map((q) => q.x);
  const ys = p.board.outline.map((q) => q.y);
  return {
    id,
    name: p.meta.name,
    saved: new Date().toISOString(),
    key: projectKey(p),
    size: xs.length ? `${(Math.max(...xs) - Math.min(...xs)).toFixed(0)}×${(Math.max(...ys) - Math.min(...ys)).toFixed(0)} мм` : '',
    components: Object.keys(p.components).length,
    bytes: text.length,
    firmware: p.firmware?.name,
  };
}

/** Список сохранённых проектов, свежие сверху. */
export async function listSaved(): Promise<SavedMeta[]> {
  const d = await db();
  const t = d.transaction('meta', 'readonly');
  const all = await new Promise<SavedMeta[]>((resolve, reject) => {
    const r = t.objectStore('meta').getAll();
    r.onsuccess = () => resolve(r.result as SavedMeta[]);
    r.onerror = () => reject(r.error);
  });
  return all.sort((a, b) => b.saved.localeCompare(a.saved));
}

/** Найти сохранённый экземпляр этого же проекта (по дате создания и имени). */
export async function findSaved(p: Project): Promise<SavedMeta | undefined> {
  const k = projectKey(p);
  return (await listSaved()).find((m) => m.key === k);
}

/**
 * Сохраняет проект на устройство. id — перезаписать этот файл; без id — новый.
 * Возвращает описание сохранённого.
 */
export async function saveToDevice(p: Project, id?: string | null): Promise<SavedMeta> {
  const d = await db();
  const text = serializeProject(p, false);
  const meta = describe(p, id || newId('pf'), text);
  const t = d.transaction(['meta', 'data'], 'readwrite');
  t.objectStore('meta').put(meta);
  t.objectStore('data').put({ id: meta.id, text });
  await done(t);
  void askPersist();
  return meta;
}

export async function loadSaved(id: string): Promise<Project> {
  const d = await db();
  const t = d.transaction('data', 'readonly');
  const rec = await get<{ id: string; text: string }>(t.objectStore('data'), id);
  if (!rec) throw new Error('проект не найден на устройстве');
  return migrateProject(JSON.parse(rec.text) as Project);
}

/** Текст файла проекта (для «Скачать файлом»). */
export async function savedText(id: string): Promise<string> {
  const d = await db();
  const rec = await get<{ id: string; text: string }>(d.transaction('data', 'readonly').objectStore('data'), id);
  if (!rec) throw new Error('проект не найден на устройстве');
  return rec.text;
}

export async function removeSaved(id: string): Promise<void> {
  const d = await db();
  const t = d.transaction(['meta', 'data'], 'readwrite');
  t.objectStore('meta').delete(id);
  t.objectStore('data').delete(id);
  await done(t);
}

export async function renameSaved(id: string, name: string): Promise<void> {
  const p = await loadSaved(id);
  p.meta.name = name;
  await saveToDevice(p, id);
}

let persistAsked = false;
/** Просим браузер не удалять сохранённое при нехватке места (для установленного приложения — обычно да). */
async function askPersist(): Promise<void> {
  if (persistAsked) return;
  persistAsked = true;
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return;
    await navigator.storage?.persist?.();
  } catch {
    /* не поддерживается — не страшно */
  }
}

/** Сколько места занято и доступно (МБ) — для подсказки в списке. */
export async function storageInfo(): Promise<{ usedMb: number; quotaMb: number; persisted: boolean } | null> {
  try {
    const e = await navigator.storage?.estimate?.();
    if (!e) return null;
    const persisted = (await navigator.storage.persisted?.()) ?? false;
    return { usedMb: (e.usage ?? 0) / 1e6, quotaMb: (e.quota ?? 0) / 1e6, persisted };
  } catch {
    return null;
  }
}
