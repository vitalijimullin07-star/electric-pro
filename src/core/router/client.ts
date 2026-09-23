import type { Project } from '../model/types';
import { autoroute, type RouteOptions, type RouteResult } from './autoroute';
import type { WorkerIn, WorkerOut } from './router.worker';

export interface RouteJob {
  promise: Promise<RouteResult>;
  cancel(): void;
}

/** Запускает автотрассировку в воркере; если воркеры недоступны — в основном потоке. */
export function startAutoroute(project: Project, options: Omit<RouteOptions, 'progress'>, onProgress?: (info: { iteration: number; conflicts: number; fraction: number }) => void): RouteJob {
  if (typeof Worker === 'undefined') {
    let cancelled = false;
    const promise = autoroute(project, {
      ...options,
      progress: (i) => {
        if (cancelled) throw new Error('Отменено');
        onProgress?.(i);
      },
    });
    return { promise, cancel: () => (cancelled = true) };
  }
  const worker = new Worker(new URL('./router.worker.ts', import.meta.url), { type: 'module' });
  let done = false;
  const promise = new Promise<RouteResult>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<WorkerOut>) => {
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
      done = true;
      worker.terminate();
      reject(new Error(e.message || 'Ошибка воркера'));
    };
    worker.postMessage({ type: 'route', project, options } satisfies WorkerIn);
  });
  return {
    promise,
    cancel: () => {
      if (!done) {
        done = true;
        worker.terminate();
      }
    },
  };
}
