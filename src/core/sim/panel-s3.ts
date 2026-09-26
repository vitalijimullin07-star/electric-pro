/*
 * Пульт на плате ESP32-S3 с экраном 800×480 и сенсором. Как и у контроллера, процессор
 * не эмулируется: исполняется ядро интерфейса пульта (firmware/vacuum-panel, тот же код
 * на C, что и в ESP32-S3), собранное в WebAssembly. Кадр RGB565 лежит в его памяти;
 * связь с контроллером — строки по UART (байты идут через Esp32.uartWrite / onUart).
 */

export const PANEL_W = 800;
export const PANEL_H = 480;

interface PanelExports {
  memory: WebAssembly.Memory;
  sim_setup(): void;
  sim_frame(): number;
  ui_loop(ms: number): number;
  ui_touch(x: number, y: number, down: number): void;
  ui_rx(ch: number): void;
}

export class PanelS3 {
  private ex: PanelExports | null = null;
  private decoder = new TextDecoder();
  private started = false;
  /** Номер кадра: растёт, когда пульт перерисовал экран. */
  version = 0;
  /** Что пульт отправляет контроллеру. */
  onTx: ((bytes: Uint8Array) => void) | null = null;
  onLog: ((line: string) => void) | null = null;

  private constructor() {}

  static async create(wasm: Uint8Array): Promise<PanelS3> {
    const p = new PanelS3();
    const { instance } = await WebAssembly.instantiate(wasm as BufferSource, p.imports());
    p.attach(instance);
    return p;
  }

  static createSync(wasm: Uint8Array): PanelS3 {
    const p = new PanelS3();
    p.attach(new WebAssembly.Instance(new WebAssembly.Module(wasm as BufferSource), p.imports()));
    return p;
  }

  private attach(inst: WebAssembly.Instance): void {
    const ex = inst.exports as unknown as PanelExports;
    for (const k of ['memory', 'sim_setup', 'sim_frame', 'ui_loop', 'ui_touch', 'ui_rx'] as const) if (!ex[k]) throw new Error(`В прошивке пульта нет ${k}: соберите её из firmware/vacuum-panel (build-sim.sh).`);
    this.ex = ex;
  }

  private imports(): WebAssembly.Imports {
    return {
      env: {
        phal_uart_write: (ptr: number, len: number) => {
          const data = new Uint8Array(this.ex!.memory.buffer).slice(ptr, ptr + len);
          this.onTx?.(data);
        },
        phal_log: (ptr: number) => {
          const m = new Uint8Array(this.ex!.memory.buffer);
          let end = ptr;
          while (m[end]) end++;
          this.onLog?.(this.decoder.decode(m.subarray(ptr, end)));
        },
      },
    };
  }

  /** Такт пульта: время в мс (от контроллера). */
  loop(ms: number): void {
    const ex = this.ex!;
    if (!this.started) {
      this.started = true;
      ex.sim_setup();
      this.version++;
    }
    if (ex.ui_loop(ms >>> 0)) this.version++;
  }

  rx(bytes: Uint8Array): void {
    for (const b of bytes) this.ex!.ui_rx(b);
  }

  touch(x: number, y: number, down: boolean): void {
    this.ex!.ui_touch(Math.round(x), Math.round(y), down ? 1 : 0);
  }

  /** Кадр RGB565 (живой вид на память пульта). */
  pixels(): Uint16Array {
    const ex = this.ex!;
    return new Uint16Array(ex.memory.buffer, ex.sim_frame(), PANEL_W * PANEL_H);
  }
}
