import type { Project } from '../model/types';
import { planVariant, runVariant, type SearchOptions, type VariantResult } from './variants';
import { autorouteWithZones, type ZoneRouteOptions, type ZoneRouteResult } from './zone-aware';
import type { WorkerIn, WorkerOut } from './router.worker';

export interface RouteJob {
  promise: Promise<ZoneRouteResult>;
  cancel(): void;
}

type Progress = (info: { iteration: number; conflicts: number; fraction: number }) => void;

/** Автотрассировка в основном потоке: медленнее для интерфейса, но работает где угодно. */
function runInline(project: Project, options: Omit<ZoneRouteOptions, 'progress'>, onProgress?: Progress): RouteJob {
  let cancelled = false;
  const promise = autorouteWithZones(project, {
    ...options,
    yieldEvery: 2,
    progress: (i) => {
      if (cancelled) throw new Error('Отменено');
      onProgress?.(i);
    },
  });
  return { promise, cancel: () => (cancelled = true) };
}

/**
 * Запускает автотрассировку в воркере. Если воркер создать нельзя (изолированная
 * страница, строгие правила безопасности) или он упал до первого сообщения —
 * разводит в основном потоке.
 */
export function startAutoroute(project: Project, options: Omit<ZoneRouteOptions, 'progress'>, onProgress?: Progress): RouteJob {
  let worker: Worker;
  try {
    if (typeof Worker === 'undefined') throw new Error('нет воркеров');
    worker = new Worker(new URL('./router.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return runInline(project, options, onProgress);
  }
  let done = false;
  let heard = false;
  let fallback: RouteJob | null = null;
  const promise = new Promise<ZoneRouteResult>((resolve, reject) => {
    const toInline = () => {
      done = true;
      worker.terminate();
      fallback = runInline(project, options, onProgress);
      fallback.promise.then(resolve, reject);
    };
    worker.onmessage = (e: MessageEvent<WorkerOut>) => {
      heard = true;
      const m = e.data;
      if (m.type === 'progress') onProgress?.(m);
      else if (m.type === 'done') {
        done = true;
        worker.terminate();
        resolve(m.result);
      } else if (m.type === 'error') {
        done = true;
        worker.terminate();
        reject(new Error(m.message));
      }
    };
    worker.onerror = (e) => {
      e.preventDefault?.();
      if (!heard) toInline();
      else {
        done = true;
        worker.terminate();
        reject(new Error(e.message || 'Ошибка воркера'));
      }
    };
    try {
      worker.postMessage({ type: 'route', project, options } satisfies WorkerIn);
    } catch {
      toInline();
    }
  });
  return {
    promise,
    cancel: () => {
      if (fallback) fallback.cancel();
      else if (!done) {
        done = true;
        worker.terminate();
      }
    },
  };
}

/* ---------------- перебор вариантов на всех ядрах ---------------- */

/** Сколько потоков: по числу ядер, но не больше, чем выдержит память (≈ по 2 на гигабайт). */
export function searchThreads(): number {
  const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { deviceMemory?: number }) : undefined;
  const cores = nav?.hardwareConcurrency || 4;
  const mem = nav?.deviceMemory;
  return Math.max(1, Math.min(cores, 16, mem ? Math.max(1, Math.floor(mem * 2)) : 16));
}

export interface SearchProgress {
  /** Проверено вариантов. */
  done: number;
  /** Сейчас считаются: номер → доля. */
  running: Map<number, number>;
  threads: number;
  /** Сколько миллисекунд осталось до конца отведённого времени. */
  leftMs: number;
}

export interface SearchJob {
  /** Остановить: считающиеся варианты бросаются, найденные остаются. */
  stop(): void;
  promise: Promise<void>;
  threads: number;
}

/**
 * Перебор: воркеры по числу ядер берут варианты по очереди, пока не выйдет время
 * (или не будет проверено maxVariants). Каждый готовый вариант — в onResult.
 */
export function startVariantSearch(
  project: Project,
  options: SearchOptions,
  cfg: { timeMs: number; threads?: number; maxVariants?: number; inline?: boolean; onResult: (r: VariantResult) => void; onProgress?: (p: SearchProgress) => void; onError?: (message: string) => void },
): SearchJob {
  const threads = Math.max(1, cfg.threads ?? searchThreads());
  const maxVariants = cfg.maxVariants ?? 400;
  const deadline = Date.now() + cfg.timeMs;
  const running = new Map<number, number>();
  let next = 0;
  let done = 0;
  let stopped = false;
  const workers: Worker[] = [];
  let resolveAll: () => void = () => undefined;
  const promise = new Promise<void>((r) => (resolveAll = r));
  const report = () => cfg.onProgress?.({ done, running: new Map(running), threads, leftMs: Math.max(0, deadline - Date.now()) });
  let timer: ReturnType<typeof setInterval> | undefined;
  let hard: ReturnType<typeof setTimeout> | undefined;

  const finishIfIdle = () => {
    if (inlineRunning) return;
    if (running.size === 0 && !retry.length && (stopped || next >= maxVariants || Date.now() >= deadline)) {
      for (const w of workers) w.terminate();
      workers.length = 0;
      clearInterval(timer);
      clearTimeout(hard);
      resolveAll();
    }
  };

  // Номера вариантов, которые надо посчитать заново (воркер упал, не начав).
  const retry: number[] = [];
  // Сколько идут варианты каждого вида (расстановка с нуля дольше): не начинать тот,
  // что заведомо не успеет к сроку, — иначе его всё равно придётся бросить.
  const took = new Map<string, number[]>();
  let got = 0;
  const kind = (index: number) => {
    const j = planVariant(index, project, options);
    return `${j.start}/${j.layers}`;
  };
  const noteTime = (r: VariantResult) => {
    const k = kind(r.index);
    (took.get(k) ?? took.set(k, []).get(k)!).push(r.ms);
    got++;
  };
  const expected = (index: number): number => {
    const own = took.get(kind(index));
    const all = own?.length ? own : [...took.values()].flat();
    return all.length ? all.reduce((a, b) => a + b, 0) / all.length : 0;
  };
  const nextIndex = (): number | null => {
    if (retry.length) return retry.shift()!;
    if (stopped || next >= maxVariants || Date.now() >= deadline) return null;
    if (deadline - Date.now() < expected(next) * 0.6) return null;
    return next++;
  };
  let inlineRunning = false;
  // Без воркеров (тесты, страница с диска, строгие правила) — по очереди в этом потоке.
  const runInline = async () => {
    if (inlineRunning) return;
    inlineRunning = true;
    for (;;) {
      const idx = stopped ? null : nextIndex();
      if (idx === null) break;
      const job = planVariant(idx, project, options);
      running.set(job.index, 0);
      report();
      try {
        const r = await runVariant(
          project,
          options,
          job,
          (f) => {
            // «Остановить» прерывает и начатый вариант.
            if (stopped) throw new Error('остановлено');
            running.set(job.index, f);
          },
          { inline: true },
        );
        noteTime(r);
        if (!stopped) cfg.onResult(r);
      } catch (e) {
        if (!stopped) cfg.onError?.((e as Error).message);
      }
      running.delete(job.index);
      done++;
      report();
      await new Promise((r) => setTimeout(r, 0));
    }
    clearInterval(timer);
    clearTimeout(hard);
    resolveAll();
  };
  if (cfg.inline || typeof Worker === 'undefined') {
    void runInline();
    return { stop: () => (stopped = true), promise, threads: 1 };
  }

  const heard = new Set<Worker>();
  const feed = (w: Worker) => {
    const idx = nextIndex();
    if (idx === null) {
      w.terminate();
      const i = workers.indexOf(w);
      if (i >= 0) workers.splice(i, 1);
      finishIfIdle();
      return;
    }
    const job = planVariant(idx, project, options);
    running.set(job.index, 0);
    (w as Worker & { job?: number }).job = job.index;
    w.postMessage({ type: 'variant', project, options, job } satisfies WorkerIn);
    report();
  };

  for (let t = 0; t < threads; t++) {
    let w: Worker;
    try {
      w = new Worker(new URL('./router.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      break;
    }
    w.onmessage = (e: MessageEvent<WorkerOut>) => {
      heard.add(w);
      const m = e.data;
      const idx = (w as Worker & { job?: number }).job ?? -1;
      if (m.type === 'variant-progress') {
        running.set(m.index, m.fraction);
        return;
      }
      if (m.type === 'variant-done') {
        running.delete(m.result.index);
        done++;
        noteTime(m.result);
        if (!stopped) cfg.onResult(m.result);
      } else if (m.type === 'error') {
        running.delete(idx);
        done++;
        cfg.onError?.(m.message);
      } else return;
      report();
      feed(w);
    };
    w.onerror = (e) => {
      e.preventDefault?.();
      const idx = (w as Worker & { job?: number }).job ?? -1;
      running.delete(idx);
      w.terminate();
      const i = workers.indexOf(w);
      if (i >= 0) workers.splice(i, 1);
      if (!heard.has(w)) {
        // Воркер не запустился (страница с диска, запрет) — вариант посчитаем в другом месте.
        if (idx >= 0) retry.push(idx);
        if (!workers.length) void runInline();
        return;
      }
      cfg.onError?.(e.message || 'ошибка воркера');
      finishIfIdle();
    };
    workers.push(w);
  }
  if (!workers.length) {
    void runInline();
    return { stop: () => (stopped = true), promise, threads: 1 };
  }
  for (const w of workers) feed(w);
  // Раз в полсекунды — прогресс; после срока — даём досчитать начатое, но не дольше половины
  // срока. Если к тому времени нет ни одного готового варианта — ждём первый (без карточек
  // остаться хуже, чем подождать; «Остановить» всегда под рукой).
  timer = setInterval(() => {
    report();
    finishIfIdle();
  }, 500);
  const hardStop = () => {
    if (!got && running.size && !stopped) {
      hard = setTimeout(hardStop, 1000);
      return;
    }
    stopped = true;
    running.clear();
    finishIfIdle();
  };
  hard = setTimeout(hardStop, cfg.timeMs * 1.5 + 5000);
  return {
    stop: () => {
      stopped = true;
      running.clear();
      finishIfIdle();
    },
    promise,
    threads: workers.length,
  };
}
