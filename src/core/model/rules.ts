import type { DesignRules, NetClass, Project } from './types';

export const DEFAULT_CLASS = 'Default';

/** Правила под типовой китайский завод (2 слоя, стандартная технология). */
export const FACTORY_RULES: DesignRules = {
  minClearance: 0.2,
  minTrackWidth: 0.2,
  minViaDiameter: 0.6,
  minViaDrill: 0.3,
  minDrill: 0.3,
  minAnnularRing: 0.13,
  edgeClearance: 0.3,
  holeToHole: 0.5,
  classClearances: [],
  maskMargin: 0.05,
  tentVias: true,
};

/** Правила для самодельной платы (ЛУТ, фоторезист): всё крупнее. */
export const HOMEMADE_RULES: DesignRules = {
  minClearance: 0.3,
  minTrackWidth: 0.4,
  minViaDiameter: 1.6,
  minViaDrill: 0.6,
  minDrill: 0.6,
  minAnnularRing: 0.3,
  edgeClearance: 1.0,
  holeToHole: 0.3,
  classClearances: [],
  maskMargin: 0.1,
  tentVias: false,
};

export const RULE_PRESETS: { id: string; name: string; rules: DesignRules }[] = [
  { id: 'factory', name: 'Завод (стандарт, 2 слоя)', rules: FACTORY_RULES },
  { id: 'homemade', name: 'Дома: ЛУТ или фоторезист', rules: HOMEMADE_RULES },
];

export function defaultNetClasses(homemade = false): Record<string, NetClass> {
  return homemade
    ? {
        Default: { name: 'Default', description: 'Сигнальные цепи', clearance: 0.3, trackWidth: 0.6, viaDiameter: 2.0, viaDrill: 0.8 },
        Power: { name: 'Power', description: 'Питание и земля', clearance: 0.3, trackWidth: 0.8, viaDiameter: 2.0, viaDrill: 0.8 },
      }
    : {
        Default: { name: 'Default', description: 'Сигнальные цепи', clearance: 0.2, trackWidth: 0.25, viaDiameter: 0.6, viaDrill: 0.3 },
        Power: { name: 'Power', description: 'Питание и земля', clearance: 0.2, trackWidth: 0.5, viaDiameter: 0.8, viaDrill: 0.4 },
      };
}

/** Класс для цепей 230 В: широкие дорожки и зазор 6 мм до всего остального. */
export const MAINS_CLASS: NetClass = {
  name: 'Mains',
  description: 'Сеть 230 В',
  clearance: 0.3,
  trackWidth: 0.8,
  viaDiameter: 2.0,
  viaDrill: 0.8,
  color: '#ff8a3d',
};
export const MAINS_CLEARANCE = 6.0;

export function netClassOf(p: Project, netId: string | null | undefined): NetClass {
  const n = netId ? p.nets[netId] : undefined;
  return (n && p.netClasses[n.netClass]) || p.netClasses[DEFAULT_CLASS] || Object.values(p.netClasses)[0];
}

/**
 * Требуемый зазор между медью двух классов: наибольшее из минимального зазора,
 * зазоров обоих классов и особого правила для пары классов.
 */
export function requiredClearance(rules: DesignRules, a: NetClass | null, b: NetClass | null): number {
  let c = rules.minClearance;
  if (a) c = Math.max(c, a.clearance);
  if (b) c = Math.max(c, b.clearance);
  if (a && b && a.name !== b.name) {
    for (const r of rules.classClearances) {
      const hit =
        (r.a === a.name && (r.b === b.name || r.b === '*')) ||
        (r.b === a.name && (r.a === b.name || r.a === '*')) ||
        (r.a === b.name && r.b === '*') ||
        (r.b === b.name && r.a === '*');
      if (hit) c = Math.max(c, r.clearance);
    }
  }
  return c;
}

/** Наибольший зазор, который вообще может потребоваться (радиус поиска соседей). */
export function maxClearance(p: Project): number {
  let c = p.rules.minClearance;
  for (const k of Object.values(p.netClasses)) c = Math.max(c, k.clearance);
  for (const r of p.rules.classClearances) c = Math.max(c, r.clearance);
  return c;
}
