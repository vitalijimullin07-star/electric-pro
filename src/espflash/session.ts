/*
 * Разговор с платой без интерфейса: перевести в загрузчик (родной USB — своей последовательностью и
 * переподключением, переходник — RTS/DTR), связаться, узнать чип и MAC, поднять скорость; записать набор файлов.
 */
import { EspLoader, type ChipInfo, type FlashPort } from '../pylesos/apk/esp-flash';
import type { PlanFile } from './plan';
import type { UsbInfo } from './port';

export interface LoaderPort extends FlashPort {
  /** Переподключиться после сброса (родной USB пропадает с шины). */
  reopen(): Promise<UsbInfo>;
  drain(): void;
  sink: ((b: Uint8Array) => void) | null;
}

const isNative = (u: UsbInfo) => u.vid === 0x303a;

export async function connectLoader(p: LoaderPort, info: UsbInfo, speed: number, log: (l: string) => void): Promise<{ ld: EspLoader; chip: ChipInfo; mac: string | null }> {
  p.sink = null;
  p.drain();
  const ld = new EspLoader(p);
  ld.log = log;
  if (!isNative(info)) await p.setBaud?.(115200);
  log(`Порт: ${info.name} (${info.vid.toString(16).padStart(4, '0')}:${info.pid.toString(16).padStart(4, '0')}). Перевожу плату в режим прошивки…`);
  if (isNative(info)) {
    await ld.resetToBootloader();
    await p.reopen();
  } else await ld.classicReset();
  try {
    await ld.sync();
  } catch {
    throw new Error('Плата не отвечает. Держите BOOT, нажмите и отпустите RST (EN), отпустите BOOT — и ещё раз «Подключить».');
  }
  const chip = await ld.detect();
  const mac = await ld.readMac().catch(() => null);
  log(`Чип ${chip.name}${mac ? `, MAC ${mac}` : ''}`);
  if (!isNative(info) && speed > 115200) {
    await ld.changeBaud(speed);
    log(`Скорость ${speed}`);
  }
  return { ld, chip, mac };
}

/** Записать файлы (адреса уже проверены) и сверить MD5. flash — размер флеша, байт (null — 4 МБ или по файлам). */
export async function flashFiles(ld: EspLoader, files: PlanFile[], flash: number | null, onProgress: (f: number, what: string) => void): Promise<void> {
  const images = files.map((f) => ({ addr: f.addr!, data: f.data, name: f.name }));
  const end = Math.max(...images.map((i) => i.addr + i.data.length));
  await ld.flash(images, Math.max(flash ?? 4 << 20, end), onProgress, '');
}
