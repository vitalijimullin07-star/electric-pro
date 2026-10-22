/*
 * Что и куда писать: вид файла по имени и содержимому (целиком, загрузчик, разделы, выбор программы, программа,
 * данные), адрес по виду и чипу, проверка набора перед прошивкой (чип, целостность, адреса, пересечения, размер).
 */
import { IMAGE_MAGIC, parseImage, parsePartitions, type CheckItem } from '../pylesos/apk/fw-check';
import { chipNameById, type ChipInfo } from '../pylesos/apk/esp-flash';

export type FileKind = 'merged' | 'bootloader' | 'partitions' | 'otadata' | 'app' | 'data';

export const KIND_TEXT: Record<FileKind, string> = {
  merged: 'целиком (загрузчик, разделы и программа)',
  bootloader: 'загрузчик',
  partitions: 'таблица разделов',
  otadata: 'выбор программы (boot_app0)',
  app: 'программа',
  data: 'данные',
};

export interface PlanFile {
  name: string;
  data: Uint8Array;
  kind: FileKind;
  /** Адрес во флеше; null — не задан (данные: адрес знает только автор). */
  addr: number | null;
}

/** Код чипа в заголовке образа или null (не образ / испорчен). */
function imageChip(b: Uint8Array): number | null {
  const im = parseImage(b);
  return typeof im === 'string' ? null : im.chip;
}

/** Загрузчик внутри файла «целиком»: у ESP32 и S2 — с 0x1000, у остальных — с 0. */
function mergedBootAt(b: Uint8Array): number {
  return b[0] === IMAGE_MAGIC ? 0 : b.length > 0x1000 && b[0x1000] === IMAGE_MAGIC ? 0x1000 : -1;
}

export function kindOf(name: string, b: Uint8Array): FileKind {
  const n = name.toLowerCase();
  if (b.length > 0x8000 + 32 && parsePartitions(b, 0x8000).length && mergedBootAt(b) >= 0) return 'merged';
  if (b.length >= 32 && b[0] === 0xaa && b[1] === 0x50) return 'partitions';
  if (n.includes('boot_app0') || n.includes('otadata')) return 'otadata';
  if (b[0] === IMAGE_MAGIC) {
    if (n.includes('bootloader')) return 'bootloader';
    const im = parseImage(b);
    // Загрузчик меньше 0x7000 (до таблицы разделов), программа — заметно больше.
    if (typeof im !== 'string' && im.length <= 0x7000 && !n.includes('app')) return 'bootloader';
    return 'app';
  }
  return 'data';
}

/** Адрес по виду файла; загрузчик — по чипу (известному или из заголовка образа). */
export function autoAddr(kind: FileKind, b: Uint8Array, chip: ChipInfo | null): number | null {
  switch (kind) {
    case 'merged':
      return 0;
    case 'bootloader': {
      if (chip) return chip.bootAddr;
      const id = imageChip(b);
      return id === 0 || id === 2 ? 0x1000 : 0;
    }
    case 'partitions':
      return 0x8000;
    case 'otadata':
      return 0xe000;
    case 'app':
      return 0x10000;
    default:
      return null;
  }
}

export function planFile(name: string, data: Uint8Array, chip: ChipInfo | null): PlanFile {
  const kind = kindOf(name, data);
  return { name, data, kind, addr: autoAddr(kind, data, chip) };
}

/** Размер флеша из заголовка загрузчика (байт) — если в наборе есть загрузчик. */
export function flashSizeOf(files: PlanFile[]): number | null {
  for (const f of files) {
    const at = f.kind === 'merged' ? mergedBootAt(f.data) : f.kind === 'bootloader' ? 0 : -1;
    if (at < 0) continue;
    const mb = [1, 2, 4, 8, 16, 32, 64, 128][f.data[at + 3] >> 4];
    if (mb) return mb << 20;
  }
  return null;
}

const hex = (n: number) => `0x${n.toString(16)}`;
const kb = (n: number) => (n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(n % (1 << 20) ? 1 : 0)} МБ` : `${Math.round(n / 1024)} КБ`);

export interface PlanCheck {
  ok: boolean;
  items: CheckItem[];
}

/**
 * Проверить набор: chip — подключённый чип (null — ещё не знаем), flash — размер флеша, байт (null — не знаем).
 */
export function checkPlan(files: PlanFile[], chip: ChipInfo | null, flash: number | null): PlanCheck {
  const items: CheckItem[] = [];
  const add = (level: CheckItem['level'], text: string) => items.push({ level, text });
  if (!files.length) return { ok: false, items: [{ level: 'bad', text: 'Нет файлов: добавьте .bin' }] };
  const imgChip = (f: PlanFile): { at: number; id: number } | null => {
    if (f.kind === 'merged') {
      const at = mergedBootAt(f.data);
      const id = imageChip(f.data.subarray(at));
      return id === null ? null : { at, id };
    }
    if (f.kind === 'bootloader' || f.kind === 'app') {
      const id = imageChip(f.data);
      return id === null ? null : { at: 0, id };
    }
    return null;
  };
  for (const f of files) {
    const label = `${f.name} (${KIND_TEXT[f.kind]})`;
    if (f.addr === null) {
      add('bad', `${label}: задайте адрес`);
      continue;
    }
    if (f.addr % 0x1000) add('bad', `${label}: адрес ${hex(f.addr)} не кратен 0x1000 (4 КБ)`);
    if (f.kind === 'bootloader' || f.kind === 'app') {
      const im = parseImage(f.data);
      if (typeof im === 'string') add('bad', `${label}: ${im}`);
      else if (!im.checksumOk || im.shaOk === false) add('bad', `${label}: контрольная сумма не сходится — файл испорчен`);
    }
    if (f.kind === 'merged') {
      const at = mergedBootAt(f.data);
      const parts = parsePartitions(f.data, 0x8000);
      const app = parts.find((p) => p.type === 0 && (p.subtype === 0 || p.subtype === 0x10));
      if (app && app.offset < f.data.length) {
        const im = parseImage(f.data.subarray(app.offset));
        if (typeof im === 'string' || !im.checksumOk || im.shaOk === false) add('bad', `${label}: программа внутри файла испорчена`);
      }
      if (f.addr !== 0) add('bad', `${label}: файл «целиком» пишется с 0x0`);
      if (chip && at !== chip.bootAddr) add('bad', `${label}: собран не для ${chip.name} (загрузчик с ${hex(at)}, а у ${chip.name} — с ${hex(chip.bootAddr)})`);
    }
    const ic = imgChip(f);
    if (ic) {
      if (chip && ic.id !== chip.imageId) add('bad', `${label}: собран для ${chipNameById(ic.id)}, а на плате ${chip.name}`);
      else if (!chip) add('ok', `${label}: для ${chipNameById(ic.id)}`);
    }
    if (f.kind === 'bootloader' && chip && f.addr !== chip.bootAddr) add('bad', `${label}: у ${chip.name} загрузчик пишется с ${hex(chip.bootAddr)}, а не ${hex(f.addr)}`);
    if (flash && f.addr + f.data.length > flash) add('bad', `${label}: не влезает во флеш ${kb(flash)} (до ${hex(f.addr + f.data.length)})`);
  }
  // Пересечения.
  const placed = files.filter((f) => f.addr !== null).sort((a, b) => a.addr! - b.addr!);
  for (let i = 1; i < placed.length; i++) {
    const a = placed[i - 1];
    const b = placed[i];
    if (a.addr! + a.data.length > b.addr!) add('bad', `${a.name} (до ${hex(a.addr! + a.data.length)}) налезает на ${b.name} (с ${hex(b.addr!)})`);
  }
  // Чего не хватает.
  const kinds = new Set(files.map((f) => f.kind));
  if (!kinds.has('merged') && kinds.has('app') && !kinds.has('bootloader'))
    add('warn', 'Пишется только программа: загрузчик и разделы на плате должны быть от такой же сборки');
  if (kinds.has('merged') && files.length > 1) add('warn', 'Вместе с файлом «целиком» другие файлы обычно не нужны');
  const fsz = flashSizeOf(files);
  if (fsz && flash && fsz !== flash) add('warn', `Загрузчик собран под флеш ${kb(fsz)}, выбрано ${kb(flash)}`);
  if (!chip) add('warn', 'Плата не подключена: чип проверю при прошивке');
  const bad = items.some((i) => i.level === 'bad');
  if (!bad) {
    const total = files.reduce((a, f) => a + f.data.length, 0);
    items.unshift({ level: 'ok', text: `Файлов: ${files.length}, всего ${kb(total)}${chip ? ` — для ${chip.name}` : ''}` });
  }
  return { ok: !bad, items };
}
