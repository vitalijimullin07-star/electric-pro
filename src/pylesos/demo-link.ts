/* Демо: пылесос считается в воркере (прошивка 5.x + модель установки). */
import DemoWorker from './demo.worker.ts?worker&inline';
import type { Link, VacStatus } from './protocol';
import type { DemoAction, DemoWorld } from './demo-core';

const NVS_KEY = 'pylesos-demo-nvs';

export class DemoLink implements Link {
  readonly kind = 'demo' as const;
  readonly title = 'Демо: пылесос в телефоне';
  onStatus: ((s: VacStatus) => void) | null = null;
  onLog: ((line: string) => void) | null = null;
  onClose: ((why: string) => void) | null = null;
  onWorld: ((w: DemoWorld) => void) | null = null;
  private w: Worker;

  constructor() {
    this.w = new DemoWorker();
    this.w.onmessage = (e: MessageEvent<{ status?: VacStatus; world?: DemoWorld; log?: string; nvs?: Uint8Array }>) => {
      const m = e.data;
      if (m.status) this.onStatus?.(m.status);
      if (m.world) this.onWorld?.(m.world);
      if (m.log) this.onLog?.(m.log);
      if (m.nvs) saveNvs(m.nvs);
    };
    this.w.onerror = (e) => this.onClose?.(`Демо остановилось: ${e.message}`);
    this.w.postMessage({ nvs: loadNvs() });
  }

  send(cmd: string): void {
    this.w.postMessage({ cmd });
  }

  act(a: DemoAction): void {
    this.w.postMessage({ act: a });
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
    /* без памяти браузера демо просто начнёт с заводских настроек */
  }
}

