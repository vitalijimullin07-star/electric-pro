/*
 * Прошивка платы из приложения по кабелю OTG: порт — родной USB ESP32-S3 через мост Android (UsbLink.java),
 * протокол загрузчика — esp-flash.ts. Файлы прошивки лежат в приложении (fw/, кладёт build.sh).
 */
import { EspLoader, type FlashImage, type FlashPort } from './esp-flash';
import { onNative, type NativeApi } from './native';

export const USB_TEXT: Record<string, string> = {
  nodevice: 'Плата не найдена: кабель OTG — в разъём USB платы (не COM), кабель с проводами данных',
  denied: 'Нет доступа к плате: разрешите его в окне Android',
  error: 'Не удалось открыть порт платы',
  detached: 'Кабель отключён',
  timeout: 'Плата не ответила',
};

function b64(d: Uint8Array): string {
  let s = '';
  for (let i = 0; i < d.length; i += 0x8000) s += String.fromCharCode(...d.subarray(i, i + 0x8000));
  return btoa(s);
}

function unb64(s: string): Uint8Array {
  const b = atob(s);
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

export class UsbPort implements FlashPort {
  private q: Uint8Array[] = [];
  private wake: (() => void) | null = null;
  private waitS: ((s: string) => void) | null = null;
  private off: () => void;

  constructor(private api: NativeApi) {
    this.off = onNative((e) => {
      if (e.t !== 'usb') return;
      if (typeof e.rx === 'string') {
        this.q.push(unb64(e.rx));
        this.wake?.();
      } else if (typeof e.s === 'string' && e.s !== 'detached' && e.s !== 'closed') this.waitS?.(e.s);
    });
  }

  private state(start: () => void, ms: number): Promise<void> {
    return new Promise((ok, bad) => {
      const t = setTimeout(() => done('timeout'), ms);
      const done = (s: string) => {
        clearTimeout(t);
        this.waitS = null;
        if (s === 'open') ok();
        else bad(new Error(USB_TEXT[s] ?? s));
      };
      this.waitS = done;
      start();
    });
  }

  /** Найти плату и открыть (первый раз Android спросит доступ — ждём до минуты). */
  open(): Promise<void> {
    this.api.ready();
    return this.state(() => this.api.usbOpen(), 60_000);
  }

  /** После сброса: плата пропадает с шины и подключается снова. */
  reopen(): Promise<void> {
    return this.state(() => this.api.usbReopen(10_000), 30_000);
  }

  async write(d: Uint8Array): Promise<void> {
    if (!this.api.usbWrite(b64(d))) throw new Error(USB_TEXT.detached);
  }

  async read(ms: number): Promise<Uint8Array> {
    if (!this.q.length)
      await new Promise<void>((r) => {
        this.wake = r;
        setTimeout(r, ms);
      });
    this.wake = null;
    const parts = this.q.splice(0);
    const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
    let o = 0;
    for (const p of parts) out.set(p, o), (o += p.length);
    return out;
  }

  async lines(dtr: boolean, rts: boolean): Promise<void> {
    this.api.usbLines(dtr, rts);
  }

  close(): void {
    this.off();
    this.api.usbClose();
  }
}

export interface FwBundle {
  ver: string;
  app: string;
  bootApp0: string;
  sizes: Record<string, { bootloader: string; partitions: string; title: string }>;
}

/** Файлы прошивки из приложения: загрузчик и разделы под размер флеша, boot_app0, программа. */
export async function loadImages(fw: FwBundle, size: string): Promise<FlashImage[]> {
  const get = async (name: string) => new Uint8Array(await (await fetch(`fw/${name}`)).arrayBuffer());
  const sz = fw.sizes[size];
  return [
    { addr: 0x0, data: await get(sz.bootloader), name: 'загрузчик' },
    { addr: 0x8000, data: await get(sz.partitions), name: 'разделы' },
    { addr: 0xe000, data: await get(fw.bootApp0), name: 'выбор программы' },
    { addr: 0x10000, data: await get(fw.app), name: `программа ${fw.ver}` },
  ];
}

/**
 * Прошить: если плата уже в загрузчике (держали BOOT и нажали RST) — сразу, иначе сброс в загрузчик линиями
 * DTR/RTS и переподключение. В конце — перезапуск в новую прошивку.
 */
export async function flashOverUsb(api: NativeApi, images: FlashImage[], flashSize: number, onProgress: (f: number, what: string) => void, log: (l: string) => void): Promise<void> {
  const port = new UsbPort(api);
  try {
    log('Ищу плату на кабеле…');
    await port.open();
    const ld = new EspLoader(port);
    ld.log = log;
    let inLoader = true;
    await ld.sync(3).catch(() => (inLoader = false));
    if (!inLoader) {
      log('Перезапускаю плату в режим прошивки…');
      await ld.resetToBootloader();
      await port.reopen();
      await ld.sync();
    }
    await ld.flash(images, flashSize, onProgress);
    log('Перезапуск в новую прошивку');
    await ld.hardReset();
  } finally {
    port.close();
  }
}

const sleepMs = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Перезапустить плату линией RTS (USB-Serial/JTAG сбрасывает чип; DTR = 0 — запуск программы, не загрузчик). */
async function restartBoard(port: UsbPort): Promise<void> {
  await port.lines(false, true);
  await sleepMs(100);
  await port.lines(false, false);
  await port.reopen();
}

/** Что видно в выводе платы: загрузчик ждёт прошивку, прошивка падает, запустилась. */
export function bootDiagnosis(text: string): string | null {
  if (/Guru Meditation|Backtrace:|abort\(\) was called|Rebooting\.\.\./.test(text)) return 'Прошивка падает при запуске — пришлите снимок этого журнала';
  if (/waiting for download|DOWNLOAD\(USB/.test(text)) return 'Плата в режиме прошивки (загрузчик ждёт файл): нажмите RST, не держа BOOT, или «Прошить плату»';
  if (/Контроллер пылесоса S3/.test(text)) return 'Прошивка пылесоса запустилась';
  if (/ESP-ROM:esp32s3/.test(text)) return 'Чип ESP32-S3 стартует, но прошивка пылесоса о себе не написала — прошейте плату';
  return null;
}

/** Хвост вывода платы строками (без пустых) — в журнал экрана. */
function tail(text: string, n: number): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l)
    .slice(-n);
}

/**
 * Код для Bluetooth по кабелю (плата без экрана): «ble code» в порт, ответ «Код для телефона: NNNNNN».
 * С 6.3 код хранится на плате; `set` — сначала задать свой (6 цифр, «ble code N»). Плата молчит —
 * перезапуск линией RTS (могла остаться в загрузчике) и ещё раз; не вышло — в журнал то, что она писала.
 */
export async function readBleCode(api: NativeApi, log: (l: string) => void = () => {}, set?: string): Promise<string> {
  const port = new UsbPort(api);
  const dec = new TextDecoder();
  let text = '';
  const ask = async (tries: number): Promise<string | null> => {
    if (set) {
      await port.write(new TextEncoder().encode(`ble code ${set}\n`));
      await sleepMs(300);
    }
    for (let i = 0; i < tries; i++) {
      await port.write(new TextEncoder().encode('ble code\n'));
      const until = Date.now() + 1500;
      while (Date.now() < until) {
        text += dec.decode(await port.read(200), { stream: true });
        const m = /Код для телефона: (\d{6})/.exec(text);
        if (m && set && m[1] !== set) throw new Error('Плата не приняла код: прошивка старше 6.3');
        if (m) return m[1];
      }
      log('Плата ещё не ответила — спрашиваю снова');
    }
    return null;
  };
  try {
    await port.open();
    const first = await ask(2);
    if (first) return first;
    log('Перезапускаю плату и спрашиваю ещё раз…');
    await restartBoard(port);
    await sleepMs(2500);
    const second = await ask(3);
    if (second) return second;
    const lines = tail(text, 25);
    if (lines.length) {
      log('Плата писала:');
      for (const l of lines) log(`  ${l}`);
    } else log('Плата ничего не прислала даже после перезапуска');
    throw new Error(bootDiagnosis(text) ?? 'Плата не прислала код: прошивка старше 6.0, не запустилась или кабель только для зарядки');
  } finally {
    port.close();
  }
}

/** Монитор по кабелю: перезапустить плату и показать, что она пишет (загрузка, журнал прошивки, «status»). */
export async function bootLog(api: NativeApi, log: (l: string) => void): Promise<string> {
  const port = new UsbPort(api);
  const dec = new TextDecoder();
  let text = '';
  let shown = 0;
  const pump = async (ms: number) => {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      text += dec.decode(await port.read(200), { stream: true });
      const done = text.lastIndexOf('\n') + 1;
      for (const l of tail(text.slice(shown, done), 1000)) log(l);
      shown = Math.max(shown, done);
    }
  };
  try {
    await port.open();
    log('Перезапускаю плату — её вывод при запуске:');
    await restartBoard(port);
    await pump(6000);
    await port.write(new TextEncoder().encode('status\n'));
    await pump(1500);
    const d = bootDiagnosis(text);
    if (!text.trim()) log('Плата ничего не прислала: прошивки нет или кабель только для зарядки');
    return d ?? (text.trim() ? 'Плата пишет, но прошивки пылесоса в выводе не видно' : 'Плата молчит');
  } finally {
    port.close();
  }
}
