import { OCCT_PARAMS, type OcctResult } from '@core/io/step';

/*
 * Чтение STEP и IGES: OpenCascade в WebAssembly (occt-import-js, LGPL-2.1, ~7,5 МБ) лежит
 * рядом с сайтом в папке occt/ и загружается только при первом открытии такого файла —
 * в отдельном воркере, чтобы большой файл не подвешивал окно. Дальше он в кеше браузера.
 */

type Pending = { res: (r: OcctResult) => void; rej: (e: Error) => void };

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, Pending>();

const LOAD_FAIL = 'не загрузился модуль чтения STEP (папка occt рядом с редактором; при первом открытии нужен интернет)';

function failAll(msg: string): void {
  for (const p of pending.values()) p.rej(new Error(msg));
  pending.clear();
  worker?.terminate();
  worker = null;
}

function getWorker(): Worker {
  if (worker) return worker;
  const base = new URL('occt/', document.baseURI).href;
  const src = `importScripts(${JSON.stringify(base + 'occt-import-js.js')});
let ready = null;
onmessage = async (e) => {
  const { id, bytes, kind, params } = e.data;
  let occt;
  try {
    ready = ready || occtimportjs({ locateFile: (f) => ${JSON.stringify(base)} + f });
    occt = await ready;
  } catch (err) {
    ready = null;
    postMessage({ id, ok: false, load: true, error: String((err && err.message) || err) });
    return;
  }
  try {
    const r = kind === 'iges' ? occt.ReadIgesFile(bytes, params) : occt.ReadStepFile(bytes, params);
    const tr = [];
    const meshes = (r.meshes || []).map((m) => {
      const pos = new Float32Array(m.attributes.position.array);
      const idx = new Uint32Array(m.index.array);
      const nrm = m.attributes.normal ? new Float32Array(m.attributes.normal.array) : null;
      tr.push(pos.buffer, idx.buffer);
      if (nrm) tr.push(nrm.buffer);
      return { name: m.name, color: m.color || null, attributes: nrm ? { position: { array: pos }, normal: { array: nrm } } : { position: { array: pos } }, index: { array: idx } };
    });
    postMessage({ id, ok: true, result: { success: !!r.success, root: r.root || { meshes: [], children: [] }, meshes } }, tr);
  } catch (err) {
    postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
};`;
  const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
  w.onmessage = (e: MessageEvent<{ id: number; ok: boolean; load?: boolean; result?: OcctResult; error?: string }>) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    if (e.data.ok && e.data.result) return p.res(e.data.result);
    const err = e.data.error ?? '';
    if (e.data.load || /NetworkError|Failed to (load|fetch)|fetching/i.test(err)) return p.rej(new Error(LOAD_FAIL));
    p.rej(new Error(/memory|OOM|enlarge/i.test(err) ? 'не хватило памяти — файл слишком большой для этого устройства' : `ошибка OpenCascade: ${err}`));
    // После сбоя внутри WebAssembly модуль не годится — следующий файл читает новый воркер.
    if (/abort|memory|unreachable|RuntimeError/i.test(err)) failAll(`ошибка OpenCascade: ${err}`);
  };
  w.onerror = (e) => {
    e.preventDefault();
    failAll(LOAD_FAIL);
  };
  worker = w;
  return w;
}

/** Прочитать STEP или IGES: дерево сборки и треугольники деталей (мм). */
export function readCad(bytes: Uint8Array, kind: 'step' | 'iges'): Promise<OcctResult> {
  return new Promise((res, rej) => {
    let w: Worker;
    try {
      w = getWorker();
    } catch {
      return rej(new Error(LOAD_FAIL));
    }
    const id = ++seq;
    pending.set(id, { res, rej });
    const copy = bytes.slice();
    w.postMessage({ id, bytes: copy, kind, params: OCCT_PARAMS }, [copy.buffer]);
  });
}
