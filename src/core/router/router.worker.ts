import type { Project } from '../model/types';
import { autorouteWithZones, type ZoneRouteOptions, type ZoneRouteResult } from './zone-aware';

/* Web Worker: автотрассировка в фоне, чтобы интерфейс не замирал. */

export type WorkerIn = { type: 'route'; project: Project; options: Omit<ZoneRouteOptions, 'progress'> };
export type WorkerOut =
  | { type: 'progress'; iteration: number; conflicts: number; fraction: number }
  | { type: 'done'; result: ZoneRouteResult }
  | { type: 'error'; message: string };

self.onmessage = async (e: MessageEvent<WorkerIn>) => {
  const msg = e.data;
  if (msg.type !== 'route') return;
  try {
    const result = await autorouteWithZones(msg.project, {
      ...msg.options,
      yieldEvery: 1000,
      progress: (info) => {
        (self as unknown as Worker).postMessage({ type: 'progress', ...info } satisfies WorkerOut);
      },
    });
    (self as unknown as Worker).postMessage({ type: 'done', result } satisfies WorkerOut);
  } catch (err) {
    (self as unknown as Worker).postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) } satisfies WorkerOut);
  }
};
