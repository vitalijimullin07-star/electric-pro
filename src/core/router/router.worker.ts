import type { Project } from '../model/types';
import { runVariant, type SearchOptions, type VariantJob, type VariantResult } from './variants';
import { autorouteWithZones, type ZoneRouteOptions, type ZoneRouteResult } from './zone-aware';

/* Web Worker: автотрассировка и варианты «расстановка + трассировка» в фоне, чтобы интерфейс не замирал. */

export type WorkerIn =
  | { type: 'route'; project: Project; options: Omit<ZoneRouteOptions, 'progress'> }
  | { type: 'variant'; project: Project; options: SearchOptions; job: VariantJob };
export type WorkerOut =
  | { type: 'progress'; iteration: number; conflicts: number; fraction: number }
  | { type: 'done'; result: ZoneRouteResult }
  | { type: 'variant-progress'; index: number; fraction: number }
  | { type: 'variant-done'; result: VariantResult }
  | { type: 'error'; message: string };

const post = (m: WorkerOut) => (self as unknown as Worker).postMessage(m);

self.onmessage = async (e: MessageEvent<WorkerIn>) => {
  const msg = e.data;
  try {
    if (msg.type === 'route') {
      const result = await autorouteWithZones(msg.project, {
        ...msg.options,
        yieldEvery: 1000,
        progress: (info) => post({ type: 'progress', ...info }),
      });
      post({ type: 'done', result });
    } else if (msg.type === 'variant') {
      let last = 0;
      const result = await runVariant(msg.project, msg.options, msg.job, (fraction) => {
        // Не чаще раза в 2 %: сообщения между потоками не бесплатны.
        if (fraction - last >= 0.02 || fraction >= 1) {
          last = fraction;
          post({ type: 'variant-progress', index: msg.job.index, fraction });
        }
      });
      post({ type: 'variant-done', result });
    }
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
