/*
 * Копия экрана настоящего пылесоса: тот же интерфейс 480×320, что в его прошивке (нарисованный втрое крупнее),
 * получает строки контроллера («#…» из журнала Bluetooth) и отдаёт свои строки (касания, «hi2») — их телефон
 * пересылает пылесосу командами. Работает, только пока экран смотрят.
 */
import { PanelS3 } from '../../core/sim/panel-s3';
import { FrameDiff } from './panel-frames';

const post = (m: unknown, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);

type In = { init: ArrayBuffer } | { rx: string } | { touch: [number, number, boolean] } | { view: boolean };

let panel: PanelS3 | null = null;
let viewing = false;
let timer: ReturnType<typeof setTimeout> | null = null;
const frames = new FrameDiff();
const dec = new TextDecoder();
let tail = '';

function loop(): void {
  timer = null;
  if (!panel || !viewing) return;
  panel.loop(Math.round(performance.now()));
  const f = frames.next(panel);
  if (f) post(f, [f.frame]);
  timer = setTimeout(loop, 30);
}

self.onmessage = async (e: MessageEvent<In>) => {
  const m = e.data;
  if ('init' in m) {
    panel = await PanelS3.create(new Uint8Array(m.init));
    panel.small = true;
    panel.onTx = (b) => {
      tail += dec.decode(b, { stream: true });
      let i: number;
      while ((i = tail.indexOf('\n')) >= 0) {
        const line = tail.slice(0, i).trim();
        tail = tail.slice(i + 1);
        if (line) post({ tx: line });
      }
    };
    post({ ready: true });
    if (viewing && !timer) loop();
    return;
  }
  if ('view' in m) {
    viewing = m.view;
    frames.reset();
    if (viewing && !timer) loop();
    return;
  }
  if (!panel) return;
  if ('rx' in m) panel.rx(new TextEncoder().encode(m.rx + '\n'));
  else if ('touch' in m) panel.touch(m.touch[0], m.touch[1], m.touch[2]);
};
