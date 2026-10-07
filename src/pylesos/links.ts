/* Виды связи с пылесосом: демо в воркере, Wi-Fi пылесоса (страница с него самого), Bluetooth. */
import { parseStatus, type Link, type VacStatus } from './protocol';

/* ---------------- Wi-Fi: страница открыта с самого пылесоса ---------------- */

/** Приложение открыто с пылесоса (192.168.4.1 или имя в его сети). */
export function servedByVacuum(): boolean {
  return location.protocol === 'http:' && (location.hostname === '192.168.4.1' || /^pylesos/i.test(location.hostname));
}

export class WifiLink implements Link {
  readonly kind = 'wifi' as const;
  readonly title = 'Wi-Fi пылесоса';
  onStatus: ((s: VacStatus) => void) | null = null;
  onLog: ((line: string) => void) | null = null;
  onClose: ((why: string) => void) | null = null;
  private stop = false;
  private seq = -1;
  private fails = 0;

  constructor(private base = '') {
    void this.poll();
  }

  private async poll(): Promise<void> {
    while (!this.stop) {
      try {
        const r = await fetch(`${this.base}/s`, { cache: 'no-store' });
        const s = parseStatus(await r.text());
        if (s) this.onStatus?.(s);
        const l = await fetch(`${this.base}/l?n=${this.seq}`, { cache: 'no-store' });
        if (l.ok) {
          const j = (await l.json()) as { n: number; lines: string[] };
          if (this.seq >= 0) for (const line of j.lines) this.onLog?.(line);
          this.seq = j.n;
        }
        this.fails = 0;
      } catch {
        if (++this.fails === 5) this.onClose?.('Нет связи с пылесосом по Wi-Fi: телефон подключён к его сети?');
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  send(cmd: string): void {
    void fetch(`${this.base}/c?q=${encodeURIComponent(cmd)}`, { cache: 'no-store' }).catch(() => undefined);
  }

  close(): void {
    this.stop = true;
  }
}

/* ---------------- Bluetooth (Android, Chrome) ---------------- */

/** Служба пылесоса для телефона: команды (запись), состояние и журнал (уведомления, строки до «\n»). */
export const BLE_SERVICE = '5a3c0001-8d2e-4f1b-9a37-6b0e4c2d7f10';
export const BLE_CMD = '5a3c0002-8d2e-4f1b-9a37-6b0e4c2d7f10';
export const BLE_STATUS = '5a3c0003-8d2e-4f1b-9a37-6b0e4c2d7f10';
export const BLE_LOG = '5a3c0004-8d2e-4f1b-9a37-6b0e4c2d7f10';

/* Web Bluetooth — минимум типов (в lib.dom их нет). */
interface BleChar extends EventTarget {
  value?: DataView;
  startNotifications(): Promise<BleChar>;
  readValue(): Promise<DataView>;
  writeValueWithResponse(v: BufferSource): Promise<void>;
}
interface BleServer {
  connected: boolean;
  disconnect(): void;
  getPrimaryService(uuid: string): Promise<{ getCharacteristic(uuid: string): Promise<BleChar> }>;
}
interface BleDevice extends EventTarget {
  name?: string;
  gatt?: { connect(): Promise<BleServer> };
}
interface BleApi {
  requestDevice(o: { filters: { services?: string[]; namePrefix?: string }[]; optionalServices?: string[] }): Promise<BleDevice>;
}

export function bleSupported(): boolean {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
}

/** Склейка строк из уведомлений: куски по MTU, строка кончается «\n». */
export class LineJoiner {
  private buf = '';
  private dec = new TextDecoder();
  constructor(private onLine: (s: string) => void) {}
  push(bytes: Uint8Array): void {
    this.buf += this.dec.decode(bytes, { stream: true });
    let i: number;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i);
      this.buf = this.buf.slice(i + 1);
      if (line) this.onLine(line);
    }
    if (this.buf.length > 8000) this.buf = '';
  }
}

export class BleLink implements Link {
  readonly kind = 'ble' as const;
  title = 'Bluetooth';
  onStatus: ((s: VacStatus) => void) | null = null;
  onLog: ((line: string) => void) | null = null;
  onClose: ((why: string) => void) | null = null;
  private server: BleServer | null = null;
  private cmd: BleChar | null = null;
  private queue: Promise<void> = Promise.resolve();
  private closed = false;

  /** Выбор пылесоса (окно Android), сопряжение — код с экрана пылесоса. */
  static async connect(): Promise<BleLink> {
    const bt = (navigator as unknown as { bluetooth: BleApi }).bluetooth;
    const dev = await bt.requestDevice({ filters: [{ services: [BLE_SERVICE] }, { namePrefix: 'Pylesos' }], optionalServices: [BLE_SERVICE] });
    const link = new BleLink();
    link.title = `Bluetooth: ${dev.name ?? 'пылесос'}`;
    dev.addEventListener('gattserverdisconnected', () => {
      if (!link.closed) link.onClose?.('Bluetooth: связь с пылесосом потеряна');
    });
    const server = await dev.gatt!.connect();
    link.server = server;
    const svc = await server.getPrimaryService(BLE_SERVICE);
    link.cmd = await svc.getCharacteristic(BLE_CMD);
    const st = await svc.getCharacteristic(BLE_STATUS);
    const lg = await svc.getCharacteristic(BLE_LOG);
    const sj = new LineJoiner((line) => {
      const s = parseStatus(line);
      if (s) link.onStatus?.(s);
    });
    const lj = new LineJoiner((line) => link.onLog?.(line));
    st.addEventListener('characteristicvaluechanged', () => st.value && sj.push(new Uint8Array(st.value.buffer, st.value.byteOffset, st.value.byteLength)));
    lg.addEventListener('characteristicvaluechanged', () => lg.value && lj.push(new Uint8Array(lg.value.buffer, lg.value.byteOffset, lg.value.byteLength)));
    // Чтение зашифровано: первое обращение вызывает сопряжение (код — на экране пылесоса, «Телефон»).
    await st.readValue();
    await st.startNotifications();
    await lg.startNotifications();
    return link;
  }

  send(cmd: string): void {
    const c = this.cmd;
    if (!c) return;
    const data = new TextEncoder().encode(cmd.slice(0, 180) + '\n');
    this.queue = this.queue.then(() => c.writeValueWithResponse(data)).catch(() => undefined);
  }

  close(): void {
    this.closed = true;
    this.server?.disconnect();
  }
}
