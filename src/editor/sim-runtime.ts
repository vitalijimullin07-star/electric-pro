import { Simulation, type SimView } from '@core/sim';
import { useEditor } from './store';

/*
 * Исполнитель симуляции в редакторе: крутит эмулятор по кадрам (не дольше ~12 мс
 * вычислений на кадр, чтобы интерфейс не подвисал), раздаёт снимок холсту и панели,
 * играет звук зуммеров. Проект берётся на момент запуска: правки схемы — после «Сброса».
 */

const BUDGET_MS = 12;
const SLICE = 16_000; // 1 мс времени контроллера

type Listener = () => void;

class SimRuntime {
  sim: Simulation | null = null;
  view: SimView | null = null;
  private raf = 0;
  private last = 0;
  private listeners = new Set<Listener>();
  private audio: AudioContext | null = null;
  private tones = new Map<string, { osc: OscillatorNode; gain: GainNode }>();
  private speedAcc = { sim: 0, wall: 0 };
  sound = true;

  get running(): boolean {
    return useEditor.getState().sim.status === 'running';
  }
  get active(): boolean {
    return !!this.sim && useEditor.getState().sim.status !== 'off';
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private patch(p: Partial<ReturnType<typeof useEditor.getState>['sim']>): void {
    const s = useEditor.getState();
    s.patch({ sim: { ...s.sim, ...p, tick: s.sim.tick + 1 } });
  }

  /** Запуск с начала (прошивка из проекта). */
  start(): void {
    const s = useEditor.getState();
    const fw = s.project.firmware;
    this.stop(true);
    if (!fw) {
      this.patch({ error: 'Сначала загрузите прошивку (.hex).', status: 'off' });
      return;
    }
    try {
      this.sim = new Simulation(s.project, fw.hex);
    } catch (e) {
      this.sim = null;
      this.patch({ error: (e as Error).message, status: 'off' });
      return;
    }
    try {
      this.audio ??= new AudioContext();
      void this.audio.resume();
    } catch {
      this.audio = null;
    }
    this.view = this.sim.view();
    this.patch({ status: 'running', error: null, seconds: 0, speed: 0 });
    s.setMessage(`Симуляция идёт: ${fw.name}. Кнопки на плате нажимаются касанием, ползунки и монитор порта — на вкладке «Симуляция».`);
    this.last = performance.now();
    this.loop();
  }

  pause(): void {
    if (!this.sim) return;
    cancelAnimationFrame(this.raf);
    this.silence();
    this.patch({ status: 'paused' });
  }

  resume(): void {
    if (!this.sim) return this.start();
    this.patch({ status: 'running' });
    this.last = performance.now();
    this.loop();
  }

  stop(quiet = false): void {
    cancelAnimationFrame(this.raf);
    this.silence();
    this.sim = null;
    this.view = null;
    if (!quiet) this.patch({ status: 'off', seconds: 0, speed: 0 });
    this.emit();
  }

  private loop = (): void => {
    const sim = this.sim;
    if (!sim || !this.running) return;
    const now = performance.now();
    const dt = Math.min(50, now - this.last);
    this.last = now;
    const target = Math.round((dt / 1000) * sim.mcu.freq);
    const t0 = performance.now();
    let done = 0;
    while (done < target && performance.now() - t0 < BUDGET_MS) {
      const n = Math.min(SLICE, target - done);
      sim.run(n);
      done += n;
    }
    this.speedAcc.sim += done / sim.mcu.freq;
    this.speedAcc.wall += dt / 1000;
    this.view = sim.view();
    this.updateSound();
    this.emit();
    const st = useEditor.getState().sim;
    if (this.speedAcc.wall > 0.25 || st.seconds === 0) {
      this.patch({ seconds: sim.seconds, speed: this.speedAcc.wall ? Math.min(1, this.speedAcc.sim / this.speedAcc.wall) : 0 });
      this.speedAcc = { sim: 0, wall: 0 };
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  private emit(): void {
    for (const l of this.listeners) l();
  }

  /** Перерисовать снимок без хода времени (после нажатия кнопки на паузе). */
  refresh(): void {
    if (!this.sim) return;
    this.view = this.sim.view();
    this.emit();
    this.patch({});
  }

  press(id: string, down: boolean): void {
    this.sim?.press(id, down);
    if (!this.running) this.refresh();
  }

  set(id: string, key: string, value: number): void {
    this.sim?.set(id, key, value);
    if (!this.running) this.refresh();
  }

  /** Действие устройства: провести катушкой над целью. */
  act(id: string, key: string): void {
    this.sim?.act(id, key);
    if (!this.running) this.refresh();
  }

  serialWrite(text: string): void {
    this.sim?.serialWrite(text);
  }

  /** Кнопка схемы под пальцем: id устройства или null. */
  buttonOf(compId: string): string | null {
    const d = this.sim?.devices.find((x) => x.comp.id === compId && x.press);
    return d?.id ?? null;
  }

  private updateSound(): void {
    const ctx = this.audio;
    if (!ctx || !this.view) return;
    const want = new Map<string, number>();
    if (this.sound) for (const d of this.view.devices) if (d.kind === 'buzzer' && d.on && d.hz) want.set(d.id, Math.min(8000, Math.max(40, d.hz)));
    for (const [id, t] of this.tones)
      if (!want.has(id)) {
        t.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.01);
        t.osc.stop(ctx.currentTime + 0.05);
        this.tones.delete(id);
      }
    for (const [id, hz] of want) {
      let t = this.tones.get(id);
      if (!t) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        gain.gain.value = 0.04;
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        t = { osc, gain };
        this.tones.set(id, t);
      }
      t.osc.frequency.setTargetAtTime(hz, ctx.currentTime, 0.005);
    }
  }

  private silence(): void {
    for (const t of this.tones.values()) {
      try {
        t.osc.stop();
      } catch {
        /* уже остановлен */
      }
    }
    this.tones.clear();
  }
}

export const simRuntime = new SimRuntime();

// Открыли другой проект — симуляция прежнего останавливается.
if (typeof window !== 'undefined')
  useEditor.subscribe((s, prev) => {
    if (s.project !== prev.project && simRuntime.sim && (s.project.meta.created !== prev.project.meta.created || s.project.meta.name !== prev.project.meta.name)) simRuntime.stop();
  });
