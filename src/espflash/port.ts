/*
 * Мост к Android (window.EspNative) и порт по кабелю для загрузчика ESP32 (FlashPort) и монитора.
 * События от Android — window.__esp(строка JSON): {t:'usb', s|rx}, {t:'file', name, len, err}.
 */
import type { FlashPort } from '../pylesos/apk/esp-flash';

export interface EspNative {
  info(): string;
  ready(): void;
  usbOpen(): void;
  usbReopen(ms: number): void;
  usbWrite(b64: string): boolean;
  usbLines(dtr: boolean, rts: boolean): void;
  usbBaud(baud: number): boolean;
  usbClose(): void;
  pickFile(): void;
}

export const native: EspNative | null = (globalThis as unknown as { EspNative?: EspNative }).EspNative ?? null;

type Ev = { t: string } & Record<string, unknown>;
const listeners = new Set<(e: Ev) => void>();
export function onNative(fn: (e: Ev) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
(globalThis as unknown as { __esp: (s: string) => void }).__esp = (s: string) => {
  let e: Ev;
  try {
    e = JSON.parse(s) as Ev;
  } catch {
    return;
  }
  for (const l of listeners) l(e);
};

/** Переходник на кабеле. */
export interface UsbInfo {
  /** cdc — класс CDC (родной USB ESP32-S3/C3/C6, CH343, CH9102), ch34x, cp210x, ftdi. */
  kind: string;
  name: string;
  vid: number;
  pid: number;
  product?: string;
}

/** Родной USB чипа (USB-Serial/JTAG): сброс — своей последовательностью, после него плата переподключается. */
export const isNativeUsb = (u: UsbInfo | null) => !!u && u.vid === 0x303a;

const TEXT: Record<string, string> = {
  nodevice: 'Плата не найдена: кабель OTG и кабель с проводами данных (не только зарядный)',
  denied: 'Нет доступа к USB: разрешите приложению устройство',
  detached: 'Кабель отключён',
  error: 'Не удалось открыть порт этого устройства',
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

export class SerialPort implements FlashPort {
  info: UsbInfo | null = null;
  /** Пока задан — принятое идёт сюда (монитор), иначе копится для загрузчика. */
  sink: ((b: Uint8Array) => void) | null = null;
  onLost: (() => void) | null = null;
  private q: Uint8Array[] = [];
  private wake: (() => void) | null = null;
  private waitS: ((s: string, e: Ev) => void) | null = null;
  private off: () => void;

  constructor(private api: EspNative) {
    this.off = onNative((e) => {
      if (e.t !== 'usb') return;
      if (typeof e.rx === 'string') {
        const b = unb64(e.rx);
        if (this.sink) this.sink(b);
        else {
          this.q.push(b);
          this.wake?.();
        }
      } else if (typeof e.s === 'string') {
        if (e.s === 'detached') {
          this.info = null;
          this.onLost?.();
        }
        if (e.s !== 'closed' && e.s !== 'detached') this.waitS?.(e.s, e);
      }
    });
  }

  private state(start: () => void, ms: number): Promise<UsbInfo> {
    return new Promise((ok, bad) => {
      const t = setTimeout(() => done('timeout', {} as Ev), ms);
      const done = (s: string, e: Ev) => {
        clearTimeout(t);
        this.waitS = null;
        if (s === 'open') {
          this.info = { kind: String(e.kind ?? 'cdc'), name: String(e.name ?? 'USB'), vid: Number(e.vid ?? 0), pid: Number(e.pid ?? 0), product: e.product ? String(e.product) : undefined };
          ok(this.info);
        } else bad(new Error(TEXT[s] ?? s));
      };
      this.waitS = done;
      start();
    });
  }

  /** Найти плату и открыть (первый раз Android спросит доступ — ждём до минуты). */
  open(): Promise<UsbInfo> {
    this.api.ready();
    return this.state(() => this.api.usbOpen(), 60_000);
  }

  /** После сброса родного USB плата пропадает с шины и подключается снова. */
  reopen(): Promise<UsbInfo> {
    return this.state(() => this.api.usbReopen(10_000), 30_000);
  }

  async write(d: Uint8Array): Promise<void> {
    if (!this.api.usbWrite(b64(d))) throw new Error(TEXT.detached);
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

  async setBaud(baud: number): Promise<void> {
    if (!this.api.usbBaud(baud)) throw new Error(`Переходник не принял скорость ${baud}`);
  }

  /** Выбросить накопленное (перед новым разговором с загрузчиком). */
  drain(): void {
    this.q.length = 0;
  }

  close(): void {
    this.api.usbClose();
    this.info = null;
  }

  dispose(): void {
    this.off();
    this.close();
  }
}

/** Выбрать файл на телефоне: имя и содержимое (null — отказались). */
export function pickFile(api: EspNative): Promise<{ name: string; data: Uint8Array } | null> {
  return new Promise((ok, bad) => {
    const off = onNative((e) => {
      if (e.t !== 'file') return;
      off();
      if (e.err) return bad(new Error(String(e.err)));
      if (!e.len) return ok(null);
      fetch(`/__picked?${Date.now()}`)
        .then((r) => r.arrayBuffer())
        .then((b) => ok({ name: String(e.name ?? 'файл.bin'), data: new Uint8Array(b) }))
        .catch(bad);
    });
    api.pickFile();
  });
}
