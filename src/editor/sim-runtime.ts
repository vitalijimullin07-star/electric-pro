import { Simulation, type SimView } from '@core/sim';
import { findMcu } from '@core/sim/circuit';
import { useEditor } from './store';

/*
 * Исполнитель симуляции в редакторе: крутит эмулятор по кадрам (не дольше ~12 мс
 * вычислений на кадр, чтобы интерфейс не подвисал), раздаёт снимок холсту и панели,
 * играет звук зуммеров, копит историю показаний установки для графиков. Проект
 * берётся на момент запуска: правки схемы — после «Сброса».
 */

/** Самое короткое нажатие кнопки во времени симуляции, с. */
const MIN_PRESS = 0.12;
const BUDGET_MS = 12;

type Listener = () => void;

/** Показания установки для графиков: раз в 0,1 с времени симуляции, последние ~2 минуты. */
export interface SimHistory {
  t: number[];
  s: Record<string, number[]>;
}
const HISTORY_MAX = 1200;

function readPref(key: string, def: string): string {
  try {
    return localStorage.getItem(key) ?? def;
  } catch {
    return def;
  }
}

function writePref(key: string, v: string): void {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* хранилище недоступно — настройка на этот сеанс */
  }
}

/** Карточка параметров на холсте: деталь или цепь и точка экрана, откуда её открыли. */
export interface SimTune {
  comp?: string;
  net?: string;
  x: number;
  y: number;
}

class SimRuntime {
  sim: Simulation | null = null;
  view: SimView | null = null;
  private raf = 0;
  private last = 0;
  private listeners = new Set<Listener>();
  private audio: AudioContext | null = null;
  private tones = new Map<string, { osc: OscillatorNode; gain: GainNode }>();
  private speedAcc = { sim: 0, wall: 0 };
  private startId = 0;
  sound = true;
  history: SimHistory = { t: [], s: {} };
  /** Аналоговый расчёт схемы (токи и напряжения, номиналы на ходу), шаг и шум — на следующий запуск. */
  analog = readPref('plata.sim.analog', '1') === '1';
  analogDt = Number(readPref('plata.sim.dt', '2e-6')) || 2e-6;
  noise = readPref('plata.sim.noise', '1') === '1';
  /** Масштаб времени: 1 — реальное, 0,01 — замедление в 100 раз (видно быстрые процессы), 10 — ускорение. */
  timeScale = 1;
  /** Проект, с которым согласована симуляция («в проект» из ручек номинала не требует сброса). */
  synced: unknown = null;
  /** Карточка параметров детали или цепи (тройной щелчок или удержание на плате и схеме). */
  tune: SimTune | null = null;

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

  /** Запуск с начала (прошивка из проекта). Прошивка ESP32 (WebAssembly) компилируется асинхронно. */
  start(): void {
    const s = useEditor.getState();
    const fw = s.project.firmware;
    this.stop(true);
    const withMcu = !!findMcu(s.project);
    if (!fw && withMcu) {
      this.patch({ error: 'Сначала загрузите прошивку (.hex или .wasm). Без контроллера на схеме симуляция идёт и без прошивки.', status: 'off' });
      return;
    }
    // Звук разрешается только из обработчика нажатия — заводим его сразу, до ожидания.
    try {
      this.audio ??= new AudioContext();
      void this.audio.resume();
    } catch {
      this.audio = null;
    }
    const id = ++this.startId;
    const project = s.project;
    this.patch({ status: 'loading', error: null, seconds: 0, speed: 0 });
    Simulation.create(project, { analog: this.analog, analogDt: this.analogDt }).then(
      (sim) => {
        if (id !== this.startId) return;
        this.sim = sim;
        this.synced = project;
        // Голос пылесоса: фразы DFPlayer произносит браузер.
        sim.onVoice = (_track, text, volume) => this.say(text, volume);
        if (sim.analog) sim.analog.engine.noise = this.noise;
        this.history = { t: [], s: {} };
        this.view = sim.view();
        this.patch({ status: 'running', error: null, seconds: 0, speed: 0 });
        useEditor
          .getState()
          .setMessage(
            sim.noMcu
              ? 'Симуляция схемы без контроллера: схема включается с нуля, как при подаче питания. Кнопки и тумблеры на плате нажимаются касанием; тройной щелчок или удержание на детали — её параметры на ходу; осциллограф и генераторы — на вкладке «Симуляция → Цепь».'
              : `Симуляция идёт: ${fw?.name}. Кнопки на плате нажимаются касанием, тройной щелчок или удержание на детали — её параметры на ходу; монитор порта — на вкладке «Симуляция»; «Во весь экран» — пульт и графики.`,
          );
        this.last = performance.now();
        this.loop();
      },
      (e: Error) => {
        if (id !== this.startId) return;
        this.sim = null;
        this.patch({ error: e.message, status: 'off' });
      },
    );
  }

  /** Произнести фразу голосом браузера (громкость 0…30, как у DFPlayer). */
  private say(text: string, volume: number): void {
    try {
      const synth = globalThis.speechSynthesis;
      if (!synth || !text || !volume) return;
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'ru-RU';
      u.volume = Math.max(0, Math.min(1, volume / 30));
      u.rate = 1.05;
      const ru = synth.getVoices().find((v) => v.lang.startsWith('ru'));
      if (ru) u.voice = ru;
      synth.speak(u);
    } catch {
      /* голоса в браузере нет — не страшно */
    }
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
    this.startId++;
    this.tune = null;
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
    const target = Math.round((dt / 1000) * sim.mcu.freq * this.timeScale);
    // Порция — 1 мс времени контроллера (у AVR 16 000 тактов, у ESP32 такт — микросекунда).
    const slice = Math.max(100, Math.round(sim.mcu.freq / 1000));
    const t0 = performance.now();
    // Кадр и так медленный (отрисовка на слабом устройстве) — расчёту можно отдать больше,
    // иначе время в симуляции ползёт: не больше 60 % кадра и не больше 40 мс.
    const budget = Math.min(40, Math.max(BUDGET_MS, this.frameMs * 0.6));
    let done = 0;
    while (done < target && performance.now() - t0 < budget) {
      const n = Math.min(slice, target - done);
      sim.run(n);
      done += n;
    }
    this.speedAcc.sim += done / sim.mcu.freq;
    this.speedAcc.wall += dt / 1000;
    this.view = sim.view();
    this.record();
    this.updateSound();
    this.emit();
    const st = useEditor.getState().sim;
    if (this.speedAcc.wall > 0.25 || st.seconds === 0) {
      // Скорость — от заданной (при замедлении ×0,01 полная — это 1 % реальной).
      this.patch({ seconds: sim.seconds, speed: this.speedAcc.wall ? Math.min(1, this.speedAcc.sim / (this.speedAcc.wall * this.timeScale)) : 0 });
      this.speedAcc = { sim: 0, wall: 0 };
    }
    this.frameMs = this.frameMs * 0.8 + Math.min(100, dt) * 0.2;
    this.raf = requestAnimationFrame(this.loop);
  };
  /** Средняя длительность кадра, мс. */
  private frameMs = 16;

  private emit(): void {
    for (const l of this.listeners) l();
  }

  /** Во весь экран: пульт, мнемосхема установки, графики. */
  setFull(on: boolean): void {
    this.patch({ full: on });
  }

  private record(): void {
    const v = this.view;
    const p = v?.plant;
    if (!v || !p) return;
    const h = this.history;
    if (h.t.length && v.seconds - h.t[h.t.length - 1] < 0.1) return;
    const m = p.motors;
    const vals: Record<string, number> = {
      rpm1: m[0]?.rpm ?? 0,
      rpm2: m[1]?.rpm ?? 0,
      amps1: m[0]?.amps ?? 0,
      amps2: m[1]?.amps ?? 0,
      temp1: m[0]?.temp ?? 0,
      temp2: m[1]?.temp ?? 0,
      vacuum: p.air.vacuum,
      flow: p.air.flow,
      filter: p.air.filterDp,
      volts: p.mains.volts,
      tool: p.tool?.amps ?? 0,
    };
    h.t.push(v.seconds);
    for (const [k, x] of Object.entries(vals)) (h.s[k] ??= []).push(x);
    if (h.t.length > HISTORY_MAX) {
      h.t.splice(0, 200);
      for (const a of Object.values(h.s)) a.splice(0, 200);
    }
  }

  /** Перерисовать снимок без хода времени (после нажатия кнопки на паузе). */
  refresh(): void {
    if (!this.sim) return;
    this.view = this.sim.view();
    this.emit();
    this.patch({});
  }

  /** Когда (по времени симуляции) нажата кнопка: отпускание не раньше чем через MIN_PRESS. */
  private pressedAt = new Map<string, number>();

  press(id: string, down: boolean): void {
    const sim = this.sim;
    if (!sim) return;
    if (down) this.pressedAt.set(id, sim.seconds);
    else {
      // Симуляция идёт медленнее реального времени: короткий щелчок в ней — миллисекунды, и
      // прошивка отбросит его как дребезг. Держим кнопку хотя бы 0,12 с времени симуляции.
      const at = this.pressedAt.get(id);
      this.pressedAt.delete(id);
      const left = at === undefined ? 0 : MIN_PRESS - (sim.seconds - at);
      if (left > 0 && this.running) {
        const wait = Math.min(2000, (left * 1000) / Math.max(0.05, useEditor.getState().sim.speed || 0.05));
        setTimeout(() => {
          if (this.sim === sim && !this.pressedAt.has(id)) this.press(id, false);
        }, wait);
        return;
      }
    }
    sim.press(id, down);
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

  /** Касание экрана пульта (координаты кадра). */
  touch(id: string, x: number, y: number, down: boolean): void {
    this.sim?.touch(id, x, y, down);
    if (!this.running) this.refresh();
  }

  /** Настройки аналогового расчёта: включение и шаг — со следующего запуска, шум — сразу. */
  setAnalogPrefs(o: { analog?: boolean; dt?: number; noise?: boolean; timeScale?: number }): void {
    if (o.timeScale !== undefined) this.timeScale = o.timeScale;
    if (o.analog !== undefined) writePref('plata.sim.analog', (this.analog = o.analog) ? '1' : '0');
    if (o.dt !== undefined) writePref('plata.sim.dt', String((this.analogDt = o.dt)));
    if (o.noise !== undefined) {
      writePref('plata.sim.noise', (this.noise = o.noise) ? '1' : '0');
      if (this.sim?.analog) this.sim.analog.engine.noise = o.noise;
    }
    this.patch({});
  }

  /** Открыть карточку параметров детали или цепи (идёт симуляция). */
  openTune(t: SimTune): void {
    if (!this.sim) return;
    this.tune = t;
    this.emit();
    this.patch({});
  }

  closeTune(): void {
    if (!this.tune) return;
    this.tune = null;
    this.emit();
    this.patch({});
  }

  /** Номинал детали в аналоговом расчёте (без записи в проект). */
  analogSet(comp: string, key: string, value: number): void {
    this.sim?.analog?.set(comp, key, value);
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
    try {
      globalThis.speechSynthesis?.cancel();
    } catch {
      /* нет голоса */
    }
  }
}

export const simRuntime = new SimRuntime();

// Открыли другой проект — симуляция прежнего останавливается.
if (typeof window !== 'undefined')
  useEditor.subscribe((s, prev) => {
    if (s.project !== prev.project && simRuntime.sim && (s.project.meta.created !== prev.project.meta.created || s.project.meta.name !== prev.project.meta.name)) simRuntime.stop();
  });
