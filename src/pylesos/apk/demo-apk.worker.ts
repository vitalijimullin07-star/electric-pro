/*
 * Демо для приложения: пылесос целиком в телефоне — прошивка контроллера и экран пылесоса (тот же код
 * интерфейса 480×320, что в его прошивке, нарисованный втрое крупнее), модель установки. Наружу: состояние,
 * журнал, голос, кадры экрана (RGBA, когда их смотрят, — только изменившиеся строки) и строки осциллограмм ударов.
 */
import { DemoVacuum, type DemoAction } from '../demo-core';
import fwB64 from 'virtual:vacuum-fw';

const post = (m: unknown, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);

type In =
  | { init: { nvs: Uint8Array | null; panel: ArrayBuffer | null } }
  | { cmd: string }
  | { act: DemoAction }
  | { touch: [number, number, boolean] }
  | { view: boolean };

let demo: DemoVacuum | null = null;
const queue: In[] = [];
let viewing = false;
let lastVer = -1;
let lastFrame = 0;

function handle(m: In): void {
  if ('view' in m) {
    viewing = m.view;
    lastVer = -1;
    prev = null;
    return;
  }
  if (!demo) return void queue.push(m);
  if ('cmd' in m) demo.command(m.cmd);
  else if ('act' in m) demo.act(m.act);
  else if ('touch' in m) demo.panel?.touch(m.touch[0], m.touch[1], m.touch[2]);
}

self.onmessage = async (e: MessageEvent<In>) => {
  const m = e.data;
  if ('init' in m && !demo) {
    const bin = atob(fwB64);
    const wasm = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) wasm[i] = bin.charCodeAt(i);
    demo = await DemoVacuum.create(wasm, m.init.nvs ?? undefined, (d) => post({ nvs: d }), m.init.panel ? new Uint8Array(m.init.panel) : undefined);
    demo.onLog = (line) => post({ log: line });
    demo.onPanelLine = (line) => {
      if (line.startsWith('O ')) post({ osc: line });
    };
    demo.sim.onVoice = (track) => post({ voice: track });
    post({ panel: !!demo.panel });
    for (const q of queue.splice(0)) handle(q);
    loop();
    return;
  }
  handle(m);
};

/* Прошлый кадр: пересылаются только изменившиеся строки (кадр у телефона 1440×960 — втрое крупнее). */
let prev: Uint16Array | null = null;

/** Кадр экрана RGB565 → RGBA, полосой от первой до последней изменившейся строки. */
function frame(): void {
  const p = demo?.panel;
  if (!p || !viewing) return;
  const now = performance.now();
  if (p.version === lastVer || now - lastFrame < 60) return;
  lastVer = p.version;
  lastFrame = now;
  const w = p.width;
  const h = p.height;
  const src = p.sleeping() ? new Uint16Array(w * h) : p.pixels();
  let y0 = 0;
  let y1 = h;
  if (prev && prev.length === src.length) {
    const same = (y: number) => {
      for (let i = y * w, e = i + w; i < e; i++) if (src[i] !== prev![i]) return false;
      return true;
    };
    while (y0 < h && same(y0)) y0++;
    if (y0 === h) return;
    while (y1 > y0 && same(y1 - 1)) y1--;
    prev.set(src.subarray(y0 * w, y1 * w), y0 * w);
  } else prev = src.slice();
  const out = new Uint8ClampedArray(w * (y1 - y0) * 4);
  for (let i = y0 * w, e = y1 * w, j = 0; i < e; i++, j += 4) {
    const c = src[i];
    out[j] = ((c >> 11) & 31) * 255 / 31;
    out[j + 1] = ((c >> 5) & 63) * 255 / 63;
    out[j + 2] = (c & 31) * 255 / 31;
    out[j + 3] = 255;
  }
  post({ frame: out.buffer, w, h, y0, s: p.scale }, [out.buffer]);
}

/* Шаг 50 мс; если телефон не успевает — время идёт медленнее, а не рывками. */
let last = performance.now();
let tick = 0;
function loop(): void {
  const now = performance.now();
  const dt = Math.min(100, now - last);
  last = now;
  demo!.run(dt);
  if (++tick % 5 === 0) post({ status: demo!.status(), world: demo!.world() });
  frame();
  setTimeout(loop, Math.max(0, 50 - (performance.now() - now)));
}
