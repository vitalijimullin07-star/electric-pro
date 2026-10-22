/*
 * Проверка файла прошивки перед записью по кабелю: что это образ программы ESP32-S3 (заголовок 0xE9, код
 * чипа 9), сегменты в пределах файла, контрольная сумма и SHA-256 в конце образа сходятся (файл не обрезан
 * и не испорчен), это прошивка контроллера пылесоса S3 (метка «VACFW:S3-CTRL:версия»), программа влезает
 * в раздел. Файл «целиком» (с адреса 0) разбирается по таблице разделов внутри него: пишется только
 * программа, настройки на плате остаются.
 */

export type CheckLevel = 'ok' | 'warn' | 'bad';

export interface CheckItem {
  level: CheckLevel;
  text: string;
}

export interface FwCheck {
  /** Можно прошивать (нет ошибок; предупреждения — на усмотрение). */
  ok: boolean;
  items: CheckItem[];
  /** Программа (с адреса 0x10000) — из файла программы или вырезанная из файла «целиком». */
  app?: Uint8Array;
  /** Версия из метки прошивки. */
  ver?: string;
  kind?: 'app' | 'merged';
}

export const IMAGE_MAGIC = 0xe9;
const S3_CHIP_ID = 9;
const CHIP_NAMES: Record<number, string> = { 0: 'ESP32', 2: 'ESP32-S2', 5: 'ESP32-C3', 9: 'ESP32-S3', 12: 'ESP32-C2', 13: 'ESP32-C6', 16: 'ESP32-H2' };
const PART_MAGIC = 0x50aa;
const PART_TABLE = 0x8000;
const MARK_CTRL = 'VACFW:S3-CTRL:';
const MARK_PANEL = 'VACFW:PANEL:';

export interface Partition {
  type: number;
  subtype: number;
  offset: number;
  size: number;
  label: string;
}

/** Таблица разделов (по 32 байта: AA 50, тип, подтип, смещение, размер, имя). */
export function parsePartitions(b: Uint8Array, at = 0): Partition[] {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out: Partition[] = [];
  for (let p = at; p + 32 <= b.length && p < at + 0xc00; p += 32) {
    if (v.getUint16(p, true) !== PART_MAGIC) break;
    const raw = b.subarray(p + 12, p + 28);
    const z = raw.indexOf(0);
    out.push({
      type: b[p + 2],
      subtype: b[p + 3],
      offset: v.getUint32(p + 4, true),
      size: v.getUint32(p + 8, true),
      label: new TextDecoder().decode(z < 0 ? raw : raw.subarray(0, z)),
    });
  }
  return out;
}

/** Раздел, с которого запускается программа после записи boot_app0: factory или первый ota. */
export function appPartition(parts: Partition[]): Partition | undefined {
  return parts.find((p) => p.type === 0 && p.subtype === 0) ?? parts.find((p) => p.type === 0 && p.subtype === 0x10);
}

interface ImageInfo {
  chip: number;
  /** Длина образа в байтах (с контрольной суммой и SHA-256). */
  length: number;
  checksumOk: boolean;
  /** null — SHA-256 в образе нет. */
  shaOk: boolean | null;
  /** Размер флеша из заголовка, МБ. */
  flashMb: number;
}

/** Разбор образа программы ESP (формат esptool): заголовок 24 байта, сегменты, сумма, SHA-256. */
export function parseImage(b: Uint8Array): ImageInfo | string {
  if (b.length < 24 || b[0] !== IMAGE_MAGIC) return 'нет заголовка образа ESP (первый байт не 0xE9)';
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const segs = b[1];
  if (segs === 0 || segs > 16) return `странное число сегментов: ${segs}`;
  const chip = v.getUint16(12, true);
  const hashAppended = b[23] === 1;
  let p = 24;
  let sum = 0xef;
  for (let i = 0; i < segs; i++) {
    if (p + 8 > b.length) return 'файл обрезан: сегменты кончаются раньше заголовков';
    const len = v.getUint32(p + 4, true);
    p += 8;
    if (len > b.length - p) return `файл обрезан: сегмент ${i + 1} длиннее файла`;
    for (let k = p; k < p + len; k++) sum ^= b[k];
    p += len;
  }
  // Сумма — в последнем байте строки из 16: после сегментов дополнение нулями.
  p = (p + 16) & ~15;
  if (p > b.length) return 'файл обрезан: нет контрольной суммы';
  const checksumOk = b[p - 1] === sum;
  let shaOk: boolean | null = null;
  if (hashAppended) {
    if (p + 32 > b.length) return 'файл обрезан: нет SHA-256 в конце образа';
    const got = sha256(b.subarray(0, p));
    shaOk = got.every((x, i) => x === b[p + i]);
    p += 32;
  }
  const flashMb = [1, 2, 4, 8, 16, 32, 64, 128][b[3] >> 4] ?? 0;
  return { chip, length: p, checksumOk, shaOk, flashMb };
}

function findText(b: Uint8Array, text: string): number {
  const t = new TextEncoder().encode(text);
  outer: for (let i = b.indexOf(t[0]); i >= 0 && i <= b.length - t.length; i = b.indexOf(t[0], i + 1)) {
    for (let k = 1; k < t.length; k++) if (b[i + k] !== t[k]) continue outer;
    return i;
  }
  return -1;
}

function markVersion(b: Uint8Array, mark: string): string | null {
  const i = findText(b, mark);
  if (i < 0) return null;
  let s = '';
  for (let k = i + mark.length; k < b.length && k < i + mark.length + 16 && b[k] >= 0x20 && b[k] < 0x7f; k++) s += String.fromCharCode(b[k]);
  return s;
}

function cmpVer(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

export interface CheckOptions {
  /** Флеш платы, МБ (выбран на экране). */
  flashMb: number;
  /** Таблица разделов, которая будет записана (из приложения под этот флеш). */
  partitions: Uint8Array;
  /** Версия на плате, если пылесос на связи. */
  boardVer?: string;
  /** Чужая прошивка ESP32-S3 (без метки) — не ошибка, а предупреждение. */
  allowForeign?: boolean;
}

/** Проверить файл перед прошивкой. */
export function checkFirmware(file: Uint8Array, o: CheckOptions): FwCheck {
  const items: CheckItem[] = [];
  const bad = (text: string): FwCheck => (items.push({ level: 'bad', text }), { ok: false, items });
  if (file.length < 1024) return bad(`Файл слишком мал (${file.length} байт) — это не прошивка`);
  const kb = (n: number) => `${Math.round(n / 1024)} КБ`;
  let app = file;
  let kind: FwCheck['kind'] = 'app';
  // «Целиком»: с адреса 0 — загрузчик (образ короче 0x8000), на 0x8000 — таблица разделов, дальше программа.
  const boot = parseImage(file);
  const filePart = typeof boot !== 'string' && boot.length <= PART_TABLE && file.length > PART_TABLE + 32 ? parsePartitions(file, PART_TABLE) : [];
  if (typeof boot !== 'string' && filePart.length) {
    kind = 'merged';
    const ap = appPartition(filePart);
    if (!ap || ap.offset >= file.length) return bad('Файл «целиком», но программы в нём нет (раздел пуст)');
    if (boot.flashMb && boot.flashMb !== o.flashMb)
      items.push({ level: 'warn', text: `Файл «целиком» собран под флеш ${boot.flashMb} МБ, выбрано ${o.flashMb} МБ: загрузчик и разделы возьму из приложения под ${o.flashMb} МБ` });
    app = file.subarray(ap.offset);
    items.push({ level: 'ok', text: `Файл «целиком» (${kb(file.length)}): пишется только программа с 0x${ap.offset.toString(16)}, настройки на плате остаются` });
  } else if (file[0] !== IMAGE_MAGIC) {
    if (findText(file.subarray(0, 64), 'PK') === 0) return bad('Это архив ZIP: распакуйте и выберите файл .bin (vacuum-s3-app.bin или …-celikom.bin)');
    return bad('Не образ программы ESP (первый байт не 0xE9): выберите vacuum-s3-app.bin или …-celikom.bin');
  }
  const im = parseImage(app);
  if (typeof im === 'string') return bad(im[0].toUpperCase() + im.slice(1));
  if (im.chip !== S3_CHIP_ID) return bad(`Прошивка для ${CHIP_NAMES[im.chip] ?? `чипа с кодом ${im.chip}`}, а на плате ESP32-S3`);
  items.push({ level: 'ok', text: 'Образ для ESP32-S3' });
  if (!im.checksumOk) return bad('Контрольная сумма образа не сходится — файл испорчен, скачайте заново');
  if (im.shaOk === false) return bad('SHA-256 образа не сходится — файл испорчен, скачайте заново');
  items.push({ level: 'ok', text: im.shaOk ? 'Контрольная сумма и SHA-256 сходятся — файл целый' : 'Контрольная сумма сходится (SHA-256 в образе нет)' });
  app = app.subarray(0, im.length);
  const parts = parsePartitions(o.partitions);
  const ap = appPartition(parts);
  if (ap && app.length > ap.size) return bad(`Программа ${kb(app.length)} не влезает в раздел ${kb(ap.size)} (флеш ${o.flashMb} МБ)`);
  if (ap) items.push({ level: 'ok', text: `Размер ${kb(app.length)} из ${kb(ap.size)} раздела` });
  const ver = markVersion(app, MARK_CTRL) ?? undefined;
  if (ver === undefined) {
    if (markVersion(app, MARK_PANEL) !== null) return bad('Это прошивка экрана (пульта 7″), а не контроллера — для контроллера нужен vacuum-s3-app.bin');
    if (!o.allowForeign) return bad('Не прошивка контроллера пылесоса S3 (нет метки VACFW:S3-CTRL) — с ней приложение к плате не подключится');
    items.push({ level: 'warn', text: 'Чужая прошивка ESP32-S3 (нет метки пылесоса): приложение к плате после неё не подключится' });
  } else {
    items.push({ level: 'ok', text: `Прошивка контроллера пылесоса S3, версия ${ver}` });
    if (o.boardVer && /^\d+(\.\d+)*$/.test(o.boardVer)) {
      const d = cmpVer(ver, o.boardVer);
      if (d < 0) items.push({ level: 'warn', text: `На плате новее — ${o.boardVer}: это откат на ${ver}` });
      else if (d === 0) items.push({ level: 'ok', text: `На плате та же версия ${o.boardVer}` });
      else items.push({ level: 'ok', text: `На плате ${o.boardVer} → будет ${ver}` });
    }
  }
  return { ok: true, items, app, ver, kind };
}

/* ---------------- SHA-256 (FIPS 180-4): без crypto.subtle, работает и вне https ---------------- */

const SK = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function sha256(data: Uint8Array): Uint8Array {
  const n = data.length;
  const total = (((n + 9 + 63) >> 6) << 6) >>> 0;
  const m = new Uint8Array(total);
  m.set(data);
  m[n] = 0x80;
  const dv = new DataView(m.buffer);
  dv.setUint32(total - 8, Math.floor(n / 0x20000000), false);
  dv.setUint32(total - 4, (n << 3) >>> 0, false);
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const rotr = (x: number, r: number) => (x >>> r) | (x << (32 - r));
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15];
      const b = w[i - 2];
      w[i] = (w[i - 16] + (rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)) + w[i - 7] + (rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10))) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + SK[i] + w[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] += a;
    h[1] += b;
    h[2] += c;
    h[3] += d;
    h[4] += e;
    h[5] += f;
    h[6] += g;
    h[7] += hh;
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) ov.setUint32(i * 4, h[i], false);
  return out;
}
