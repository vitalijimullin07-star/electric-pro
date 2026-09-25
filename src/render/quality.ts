/*
 * Качество графики: на мощном телефоне и компьютере — полное разрешение экрана,
 * свечение выделения, блики на меди и анимация; на слабом — только нужное,
 * чтобы не грелось и не садило батарею. «Авто» выбирает по устройству и
 * понижает качество на ходу, если кадры рисуются слишком долго.
 */

export type QualityMode = 'auto' | 'high' | 'balanced' | 'eco';
export type QualityLevel = 'high' | 'balanced' | 'eco';

export interface GfxProfile {
  level: QualityLevel;
  /** Предел плотности пикселей холста (devicePixelRatio). */
  dprCap: number;
  /** Свечение выделения, подсветки цепи и контура платы. */
  glow: boolean;
  /** Блики на дорожках и ободок площадок. */
  sheen: boolean;
  /** Тени и градиенты фона и платы. */
  shadows: boolean;
  /** Бегущий пунктир выделения, пульсация отметок ошибок. */
  animate: boolean;
  /** Сглаживание в 3D-виде. */
  antialias3d: boolean;
}

export const GFX: Record<QualityLevel, GfxProfile> = {
  high: { level: 'high', dprCap: 3, glow: true, sheen: true, shadows: true, animate: true, antialias3d: true },
  balanced: { level: 'balanced', dprCap: 2, glow: true, sheen: true, shadows: true, animate: false, antialias3d: true },
  eco: { level: 'eco', dprCap: 1, glow: false, sheen: false, shadows: false, animate: false, antialias3d: false },
};

export const QUALITY_NAMES: Record<QualityMode, string> = {
  auto: 'Авто',
  high: 'Максимальное',
  balanced: 'Сбалансированное',
  eco: 'Экономное',
};

interface NavigatorHints {
  hardwareConcurrency?: number;
  deviceMemory?: number;
  connection?: { saveData?: boolean };
}

/** Уровень по возможностям устройства: ядра, память, режим экономии трафика. */
export function detectLevel(nav: NavigatorHints | undefined = typeof navigator !== 'undefined' ? (navigator as NavigatorHints) : undefined): QualityLevel {
  if (!nav) return 'balanced';
  const cores = nav.hardwareConcurrency ?? 4;
  const mem = nav.deviceMemory ?? 4;
  if (nav.connection?.saveData || cores <= 2 || mem <= 2) return 'eco';
  if (cores >= 8 && mem >= 6) return 'high';
  return 'balanced';
}

const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Профиль для режима: auto берёт уровень, подобранный на ходу. */
export function gfxProfile(mode: QualityMode, autoLevel: QualityLevel): GfxProfile {
  const p = GFX[mode === 'auto' ? autoLevel : mode];
  return reducedMotion() ? { ...p, animate: false } : p;
}

const DOWN: Record<QualityLevel, QualityLevel> = { high: 'balanced', balanced: 'eco', eco: 'eco' };

/**
 * Подстройка в режиме «Авто»: средняя длительность кадра больше порога
 * два десятка кадров подряд — уровень ниже.
 */
export class AdaptiveQuality {
  private avg = 0;
  private slow = 0;
  constructor(public level: QualityLevel = detectLevel()) {}

  /** Учесть длительность кадра, мс. Возвращает true, если уровень понижен. */
  sample(ms: number): boolean {
    this.avg = this.avg ? this.avg * 0.85 + ms * 0.15 : ms;
    const limit = this.level === 'high' ? 22 : this.level === 'balanced' ? 34 : Infinity;
    this.slow = this.avg > limit ? this.slow + 1 : 0;
    if (this.slow < 20) return false;
    this.level = DOWN[this.level];
    this.slow = 0;
    this.avg = 0;
    return true;
  }
}
