/* Общее для экранов приложения. */
import type { VacStatus } from '../protocol';
import type { DemoWorld } from '../demo-core';
import type { DemoApkLink } from './demo-apk';
import type { Osc, PurgeSeries, SampleRing } from './history';

export type Tab = 'home' | 'sensors' | 'charts' | 'log' | 'settings';
export type Sub = 'strikes' | 'update' | 'all' | 'screen' | null;

export type LogKind = 'fault' | 'series' | 'set' | 'link' | 'log';
export interface LogItem {
  t: number;
  text: string;
  kind: LogKind;
}

export interface Ctx {
  s: VacStatus;
  send: (cmd: string) => void;
  mode: 'demo' | 'device';
  linkState: string;
  linkName: string;
  demo: DemoApkLink | null;
  world: DemoWorld | null;
  ring: SampleRing;
  series: PurgeSeries[];
  oscs: Osc[];
  log: LogItem[];
  /** Растёт раз в секунду — для перерисовки графиков. */
  tick: number;
  go: (tab: Tab) => void;
  open: (sub: Sub) => void;
  setMode: (m: 'demo' | 'device') => void;
  clearLog: () => void;
}
