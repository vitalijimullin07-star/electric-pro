/*
 * Сохранение и открытие файлов. Обычно — скачивание через ссылку и <input type=file>.
 * Внутри страницы claude.ai скачивание по ссылке запрещено; там файл отдаётся
 * через возможность «downloads» площадки (зритель подтверждает сохранение).
 */

interface DownloadsApi {
  save(r: { filename: string; data: string | Blob | ArrayBuffer | ArrayBufferView }): Promise<{ status: 'saved' | 'delivered' }>;
}
interface HostApi {
  use?(name: string): Promise<unknown>;
}

const host = (): HostApi | null => {
  try {
    return (window as unknown as { claude?: HostApi }).claude ?? null;
  } catch {
    return null;
  }
};

/** Открыта ли страница внутри claude.ai (есть площадочный объект claude.use). */
export const isHostedPage = (): boolean => typeof host()?.use === 'function';

let downloads: Promise<DownloadsApi | null> | null = null;
function hostDownloads(): Promise<DownloadsApi | null> {
  const h = host();
  if (!h?.use) return Promise.resolve(null);
  downloads ??= h
    .use('downloads')
    .then((d) => (d as DownloadsApi | null) ?? null)
    .catch(() => null);
  return downloads;
}

/** Расширения, которые площадка claude.ai разрешает сохранять. Gerber (.gtl, .drl…) — только в архиве. */
const HOSTED_EXT = new Set(['gif', 'png', 'jpg', 'jpeg', 'webp', 'mp4', 'webm', 'txt', 'json', 'md', 'docx', 'pptx', 'epub', 'csv', 'ttf', 'html', 'svg', 'pdf', 'xlsx', 'zip']);
export const hostedCanSave = (name: string): boolean => HOSTED_EXT.has(name.slice(name.lastIndexOf('.') + 1).toLowerCase());

function anchorDownload(name: string, data: string | Uint8Array, mime: string): void {
  const blob = new Blob([data as BlobPart], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}

/**
 * Сохраняет файл. Возвращает true, если файл отдан на сохранение, false — если
 * пользователь отказался. Остальные сбои — исключение с понятным текстом.
 */
export async function saveTextFile(name: string, data: string | Uint8Array, mime = 'application/octet-stream'): Promise<boolean> {
  const d = await hostDownloads();
  if (!d) {
    anchorDownload(name, data, mime);
    return true;
  }
  try {
    await d.save({ filename: name, data: typeof data === 'string' ? data : new Blob([data as BlobPart]) });
    return true;
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === 'declined') return false;
    if (code === 'rejected_extension' || code === 'extension_not_enabled') throw new Error(`здесь нельзя сохранить файл с таким расширением (${name}); скачайте архив`);
    if (code === 'rate_limited') throw new Error('окно сохранения уже открыто, подтвердите его или подождите');
    throw new Error('сохранение здесь недоступно');
  }
}

export function openTextFile(accept: string): Promise<{ name: string; text: string } | null> {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = accept;
    inp.onchange = () => {
      const f = inp.files?.[0];
      if (!f) return resolve(null);
      const r = new FileReader();
      r.onload = () => resolve({ name: f.name, text: String(r.result) });
      r.onerror = () => resolve(null);
      r.readAsText(f);
    };
    inp.click();
  });
}

/** Выбор нескольких файлов сразу (импорт корпусов). */
export function openTextFiles(accept: string): Promise<{ name: string; text: string }[]> {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = accept;
    inp.multiple = true;
    inp.onchange = async () => {
      const files = [...(inp.files ?? [])];
      resolve(await Promise.all(files.map(async (f) => ({ name: f.name, text: await f.text() }))));
    };
    inp.click();
  });
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
