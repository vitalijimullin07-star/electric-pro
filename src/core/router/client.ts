import type { Project } from '../model/types';
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
      } else {
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
