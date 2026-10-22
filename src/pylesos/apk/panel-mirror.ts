/* Экран настоящего пылесоса в телефоне (прошивка 6.3.2+): копия его интерфейса в воркере, связь — Bluetooth. */
import MirrorWorker from './panel-mirror.worker.ts?worker&inline';
import panelWasmUrl from '../../../firmware/vacuum-panel/vacuum-panel-hd.wasm?url';
import type { PanelFrame, PanelSource } from './Panel';

export class PanelMirror implements PanelSource {
  onFrame: ((f: PanelFrame) => void) | null = null;
  /** Когда пришла последняя строка экрана от пылесоса (мс), 0 — ещё не приходила. */
  lastRx = 0;
  private w: Worker | null = null;

  /** send — команда пылесосу (строки копии экрана: касания, «hi2»). */
  constructor(private send: (line: string) => void) {}

  private start(): Worker {
    if (this.w) return this.w;
    const w = new MirrorWorker();
    w.onmessage = (e: MessageEvent<{ tx?: string; frame?: ArrayBuffer; w?: number; h?: number; y0?: number; s?: number }>) => {
      const m = e.data;
      if (m.tx) this.send(m.tx);
      if (m.frame && m.w && m.h) this.onFrame?.({ rgba: new Uint8ClampedArray(m.frame), w: m.w, h: m.h, y0: m.y0 ?? 0, scale: m.s ?? 1 });
    };
    fetch(panelWasmUrl)
      .then((r) => r.arrayBuffer())
      .then((b) => w.postMessage({ init: b }, [b]))
      .catch(() => {
        /* без файла экрана копии не будет */
      });
    this.w = w;
    return w;
  }

  /** Строка контроллера для экрана («#» уже снят). */
  rx(line: string): void {
    this.lastRx = Date.now();
    this.w?.postMessage({ rx: line });
  }

  view(on: boolean): void {
    this.start().postMessage({ view: on });
  }

  touch(x: number, y: number, down: boolean): void {
    this.w?.postMessage({ touch: [x, y, down] });
  }

  close(): void {
    this.w?.terminate();
    this.w = null;
  }
}
