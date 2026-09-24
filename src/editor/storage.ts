/*
 * Хранилище браузера с защитой: в изолированных страницах (claude.ai, встраивание
 * в iframe без allow-same-origin, приватный режим) даже обращение к localStorage
 * бросает исключение. Тогда редактор работает без автосохранения.
 */

function storage(): Storage | null {
  try {
    const s = window.localStorage;
    // Проверка записи: в некоторых режимах объект есть, но писать нельзя.
    const k = '__plata_probe__';
    s.setItem(k, '1');
    s.removeItem(k);
    return s;
  } catch {
    return null;
  }
}

let cached: Storage | null | undefined;
function get(): Storage | null {
  if (cached === undefined) cached = typeof window === 'undefined' ? null : storage();
  return cached;
}

export const safeStorage = {
  available(): boolean {
    return get() !== null;
  },
  getItem(key: string): string | null {
    try {
      return get()?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string): boolean {
    try {
      const s = get();
      if (!s) return false;
      s.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  },
  removeItem(key: string): void {
    try {
      get()?.removeItem(key);
    } catch {
      /* нет доступа */
    }
  },
};
