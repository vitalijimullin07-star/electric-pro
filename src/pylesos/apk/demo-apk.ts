/* Демо приложения: пылесос в телефоне (воркер), с экраном пылесоса и голосом. */
import DemoWorker from './demo-apk.worker.ts?worker&inline';
import panelWasmUrl from '../../../firmware/vacuum-panel/vacuum-panel.wasm?url';
import type { Link, VacStatus } from '../protocol';
import type { DemoAction, DemoWorld } from '../demo-core';

const NVS_KEY = 'pylesos-apk-demo-nvs';

export class DemoApkLink implements Link {
  readonly kind = 'demo' as const;
  readonly title = 'Демо: пылесос в телефоне';
  onStatus: ((s: VacStatus) => void) | null = null;
  onLog: ((line: string) => void) | null = null;
  onClose: ((why: string) => void) | null = null;
  onWorld: ((w: DemoWorld) => void) | null = null;
  onVoice: ((n: number) => void) | null = null;
  onOsc: ((line: string) => void) | null = null;
  onFrame: ((rgba: Uint8ClampedArray, w: number, h: number) => void) | null = null;
  /** Есть ли экран пылесоса (прошивка экрана загрузилась). */
  hasPanel = false;
  private w: Worker;

  constructor() {
    this.w = new DemoWorker();
    this.w.onmessage = (e: MessageEvent<{ status?: VacStatus; world?: DemoWorld; log?: string; nvs?: Uint8Array; voice?: number; osc?: string; frame?: ArrayBuffer; w?: number; h?: number; panel?: boolean }>) => {
      const m = e.data;
      if (m.status) this.onStatus?.(m.status);
      if (m.world) this.onWorld?.(m.world);
      if (m.log) this.onLog?.(m.log);
      if (m.nvs) saveNvs(m.nvs);
      if (m.voice !== undefined) this.onVoice?.(m.voice);
      if (m.osc) this.onOsc?.(m.osc);
      if (m.panel !== undefined) this.hasPanel = m.panel;
      if (m.frame && m.w && m.h) this.onFrame?.(new Uint8ClampedArray(m.frame), m.w, m.h);
    };
    this.w.onerror = (e) => this.onClose?.(`Демо остановилось: ${e.message}`);
    void this.init();
  }

  private async init(): Promise<void> {
    let panel: ArrayBuffer | null = null;
    try {
      panel = await (await fetch(panelWasmUrl)).arrayBuffer();
    } catch {
      /* без экрана — демо всё равно работает */
    }
    this.w.postMessage({ init: { nvs: loadNvs(), panel } }, panel ? [panel] : []);
  }

  send(cmd: string): void {
    this.w.postMessage({ cmd });
  }

  act(a: DemoAction): void {
    this.w.postMessage({ act: a });
  }

  /** Смотрят ли экран (кадры шлются только тогда). */
  view(on: boolean): void {
    this.w.postMessage({ view: on });
  }

  touch(x: number, y: number, down: boolean): void {
    this.w.postMessage({ touch: [x, y, down] });
  }

  close(): void {
    this.w.terminate();
  }
}

function loadNvs(): Uint8Array | null {
  try {
    const s = localStorage.getItem(NVS_KEY);
    if (!s) return null;
    const b = atob(s);
    return Uint8Array.from(b, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

function saveNvs(d: Uint8Array): void {
  try {
    let s = '';
    for (const x of d) s += String.fromCharCode(x);
    localStorage.setItem(NVS_KEY, btoa(s));
  } catch {
    /* без памяти — демо начнёт с заводских настроек */
  }
}
