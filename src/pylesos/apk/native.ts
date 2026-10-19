/*
 * Мост к Android (android/pylesos: window.PylesosNative) и связь с пылесосом через него: Bluetooth держит
 * служба приложения (и в фоне), сюда приходят строки состояния и журнала. В браузере моста нет —
 * тогда работает только демо.
 */
import { FAULTS, SEVERE, parseStatus, type Link, type VacStatus } from '../protocol';
import { VOICE_PHRASES } from '../../core/sim/voice-phrases';

export interface NativeApi {
  info(): string;
  ready(): string;
  connect(): void;
  disconnect(): void;
  forget(): void;
  send(line: string): void;
  setTables(json: string): void;
  setAlerts(json: string): void;
  demoStatus(json: string): void;
  voice(n: number): void;
  speak(text: string): void;
  recTail(lines: number): string;
  recDays(): string;
  shareRec(day: string): void;
  shareText(name: string, text: string): void;
  fullscreen(on: boolean): void;
  keepOn(on: boolean): void;
  openNotifySettings(): void;
  askPermissions(): void;
}

export const native: NativeApi | null = (globalThis as unknown as { PylesosNative?: NativeApi }).PylesosNative ?? null;

export interface NativeInfo {
  app: string;
  sdk: number;
  perm: boolean;
  want: boolean;
  device: string;
  name: string;
}

export function nativeInfo(): NativeInfo | null {
  if (!native) return null;
  try {
    return JSON.parse(native.info()) as NativeInfo;
  } catch {
    return null;
  }
}

/** Состояние связи службы: off, nobt, btoff, noperm, scan, notfound, wait, connecting, pairing, noservice, on. */
export type LinkState = string;

export const LINK_TEXT: Record<string, string> = {
  off: 'Не подключён',
  nobt: 'В телефоне нет Bluetooth',
  btoff: 'Bluetooth выключен',
  noperm: 'Нет разрешения на Bluetooth',
  scan: 'Поиск пылесоса…',
  notfound: 'Пылесос не найден — ищу дальше',
  wait: 'Пылесос не рядом — подключусь сам, когда появится',
  connecting: 'Подключение…',
  pairing: 'Сопряжение: введите код с экрана пылесоса («Ещё → Телефон»)',
  noservice: 'Это устройство — не пылесос S3',
  on: 'На связи',
};

/** Фраза голоса для неисправности (бит faults → V_… прошивки, как в vac_ext.c). */
export const FAULT_PHRASE: Record<number, number> = {
  0: 30, 1: 7, 2: 7, 3: 8, 4: 8, 5: 31, 6: 31, 7: 9, 8: 9, 9: 37, 10: 37, 11: 24, 12: 24, 13: 5, 14: 6, 15: 3,
  16: 18, 17: 31, 18: 31, 19: 31, 20: 1, 21: 2, 22: 23, 23: 23, 24: 10, 25: 10, 26: 4, 27: 31, 28: 31, 29: 15, 30: 17, 31: 16,
};

/** Таблицы для службы (уведомления и голос работают и без открытого окна). */
export function pushTables(): void {
  if (!native) return;
  const faults = FAULTS.map(([bit, text]) => {
    const b = Math.round(Math.log2(bit));
    return [bit >>> 0, text, ((SEVERE >>> 0) & bit) >>> 0 !== 0, FAULT_PHRASE[b] ?? 0];
  });
  native.setTables(JSON.stringify({ faults, phrases: VOICE_PHRASES }));
}

type Ev = { t: 'link'; s: string; name?: string } | { t: 'status'; j: string } | { t: 'log'; l: string };

/** Связь через службу Android. Одна на приложение. */
export class NativeLink implements Link {
  readonly kind = 'ble' as const;
  title = 'Bluetooth';
  onStatus: ((s: VacStatus) => void) | null = null;
  onLog: ((line: string) => void) | null = null;
  onClose: ((why: string) => void) | null = null;
  onLink: ((state: LinkState, name: string) => void) | null = null;
  /** Строки для экрана пылесоса (поток экрана — с прошивкой 6.1). */
  onPanelLine: ((line: string) => void) | null = null;
  state: LinkState = 'off';
  name = '';

  constructor(private api: NativeApi) {
    (globalThis as unknown as { __vac: (s: string) => void }).__vac = (s: string) => this.event(s);
  }

  /** Подключиться: служба найдёт пылесос (первый раз — любой S3 рядом, потом — только свой). */
  start(): void {
    try {
      const snap = JSON.parse(this.api.ready()) as { link: string; name: string; status: string; log: string[] };
      this.setLink(snap.link, snap.name);
      for (const l of snap.log ?? []) this.line(l);
      const s = snap.status ? parseStatus(snap.status) : null;
      if (s) this.onStatus?.(s);
    } catch {
      /* служба ещё не запускалась */
    }
    this.api.connect();
  }

  private event(raw: string): void {
    let e: Ev;
    try {
      e = JSON.parse(raw) as Ev;
    } catch {
      return;
    }
    if (e.t === 'link') this.setLink(e.s, e.name ?? '');
    else if (e.t === 'status') {
      const s = parseStatus(e.j);
      if (s) this.onStatus?.(s);
    } else if (e.t === 'log') this.line(e.l);
  }

  private line(l: string): void {
    // Строки экрана (с прошивкой 6.1): «#» + строка, как у экрана по UART.
    if (l.startsWith('#')) return void this.onPanelLine?.(l.slice(1));
    if (l.startsWith('@V ')) return;
    this.onLog?.(l);
  }

  private setLink(s: string, name: string): void {
    this.state = s;
    this.name = name || this.name;
    this.title = this.name ? `Bluetooth: ${this.name}` : 'Bluetooth';
    this.onLink?.(s, this.name);
  }

  send(cmd: string): void {
    this.api.send(cmd);
  }

  close(): void {
    this.api.disconnect();
  }
}
