/* Воркер демо: пылесос считается в реальном времени, наружу — состояние, журнал и «мир». */
import { DemoVacuum, type DemoAction } from './demo-core';
import fwB64 from 'virtual:vacuum-fw';

const post = (m: unknown) => (self as unknown as Worker).postMessage(m);

type In = { cmd: string } | { act: DemoAction } | { nvs: Uint8Array | null };

let demo: DemoVacuum | null = null;
const queue: In[] = [];

function handle(m: In): void {
  if (!demo) return void queue.push(m);
  if ('cmd' in m) demo.command(m.cmd);
  else if ('act' in m) demo.act(m.act);
}

self.onmessage = async (e: MessageEvent<In>) => {
  const m = e.data;
  if ('nvs' in m && !demo) {
    const bin = atob(fwB64);
    const wasm = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) wasm[i] = bin.charCodeAt(i);
    demo = await DemoVacuum.create(wasm, m.nvs ?? undefined, (d) => post({ nvs: d }));
    demo.onLog = (line) => post({ log: line });
    for (const q of queue.splice(0)) handle(q);
    loop();
    return;
  }
  handle(m);
};

/* Шаг 50 мс; если телефон не успевает — время идёт медленнее, а не рывками. */
let last = performance.now();
let tick = 0;
function loop(): void {
  const now = performance.now();
  const dt = Math.min(100, now - last);
  last = now;
  demo!.run(dt);
  if (++tick % 5 === 0) post({ status: demo!.status(), world: demo!.world() });
  setTimeout(loop, Math.max(0, 50 - (performance.now() - now)));
}
