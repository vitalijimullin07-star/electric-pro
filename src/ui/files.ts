/* Сохранение и открытие файлов: File System Access API, если есть, иначе скачивание и <input type=file>. */

export async function saveTextFile(name: string, data: string | Uint8Array, mime = 'application/octet-stream'): Promise<boolean> {
  const blob = new Blob([data as BlobPart], { type: mime });
  const w = window as unknown as { showSaveFilePicker?: (o: unknown) => Promise<{ createWritable(): Promise<{ write(b: Blob): Promise<void>; close(): Promise<void> }> }> };
  if (w.showSaveFilePicker) {
    try {
      const ext = name.slice(name.lastIndexOf('.'));
      const h = await w.showSaveFilePicker({ suggestedName: name, types: [{ description: 'Файл', accept: { [mime]: [ext] } }] });
      const ws = await h.createWritable();
      await ws.write(blob);
      await ws.close();
      return true;
    } catch (e) {
      if ((e as { name?: string }).name === 'AbortError') return false;
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
  return true;
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

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
