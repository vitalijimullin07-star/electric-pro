/*
 * Приложение «Пылесос S3» для телефона: что присылает контроллер и что ему отправлять.
 * Состояние — JSON из vac_status_json (firmware/vacuum-s3/vac_core.c), команды — те же строки,
 * что в порт (vac_command), сообщения — строки журнала (hal_log). Одинаково для всех видов связи:
 * демо (прошивка в браузере), Wi-Fi пылесоса (страница с самого пылесоса) и Bluetooth.
 */

export interface VacStatus {
  ver: string;
  state: number;
  sleep: number;
  mode: number;
  preset: number;
  en1: number;
  en2: number;
  k1: number;
  k2: number;
  sock: number;
  running: number;
  purging: number;
  sp: number;
  power: number;
  p1: number;
  p2: number;
  i1: number;
  i2: number;
  itool: number;
  itotal: number;
  tool: number;
  ov: number;
  cap: number;
  t1: number;
  t2: number;
  mains: number;
  vacuum: number;
  flow: number;
  speed: number;
  filter: number;
  r: number;
  load: number;
  filt: number;
  rnew: number;
  washes: number;
  intake: number;
  imp: number;
  every: number;
  n: number;
  water: number;
  float: number;
  panel: number;
  remote: number;
  vk: number;
  hold: number;
  reseat: number;
  v1: number;
  v2: number;
  vo1: number;
  vo2: number;
  pno: number;
  hose: number;
  hwait: number;
  dual: number;
  dip: number;
  dpon: number;
  thr: number;
  clean: number;
  coff: number;
  hauto: number;
  strong: number;
  t2a: number;
  pn: number;
  pe: number;
  pi: number;
  pp: number;
  psp: number;
  phose: number;
  fst: number;
  rbase: number;
  fwork: number;
  fpulses: number;
  bag: number;
  pulses: number;
  h1: number;
  h2: number;
  tauto: number;
  tthr: number;
  runon: number;
  tend: number;
  limit: number;
  sfree: number;
  hosemm: number;
  /** Телефон на связи по Bluetooth, сеть Wi-Fi для телефона включена. */
  phone: number;
  wifi: number;
  faults: number;
}

export const PRESETS = ['Авто', 'Бетон, штроба', 'Бурение', 'Гипс, шпаклёвка', 'Уборка', 'Мешок', 'Вода'];
export const PRESET_HINTS = [
  'Всё подбирает сам: когда бить, сколько и как долго',
  'Три удара через 0,5 с, серия каждые 15 с',
  'Реже, мощная очистка по закрытому шлангу выключена (присоска)',
  'Липкая пыль: удар длиннее',
  'Редкие удары',
  'С мешком в баке',
  'Мокрая уборка: без ударов',
];

/** Неисправности: бит → текст (как vac_fault_text в прошивке). */
export const FAULTS: [number, string][] = [
  [1 << 0, 'Нет синхронизации с сетью'],
  [1 << 1, 'Перегрев турбины 1'],
  [1 << 2, 'Перегрев турбины 2'],
  [1 << 3, 'Турбина 1 горячая — мощность снижена'],
  [1 << 4, 'Турбина 2 горячая — мощность снижена'],
  [1 << 5, 'Датчик температуры 1'],
  [1 << 6, 'Датчик температуры 2'],
  [1 << 7, 'Перегрузка турбины 1'],
  [1 << 8, 'Перегрузка турбины 2'],
  [1 << 9, 'Нет тока турбины 1: щётки, обрыв, реле, регулятор'],
  [1 << 10, 'Нет тока турбины 2: щётки, обрыв, реле, регулятор'],
  [1 << 11, 'Пробит симистор 1 (реле разомкнуто)'],
  [1 << 12, 'Пробит симистор 2 (реле разомкнуто)'],
  [1 << 13, 'Мало воздуха в шланге'],
  [1 << 14, 'Шланг или вход забит'],
  [1 << 15, 'Фильтр: пора мыть'],
  [1 << 16, 'Напряжение сети вне 190…250 В'],
  [1 << 17, 'Нет датчика перепада на фильтре'],
  [1 << 18, 'Нет расходомера'],
  [1 << 19, 'Датчик разрежения'],
  [1 << 20, 'Бак полон — турбины стоп'],
  [1 << 21, 'Перелив! Аварийный стоп'],
  [1 << 22, 'Реле 1 сварилось — выключите сеть'],
  [1 << 23, 'Реле 2 сварилось — выключите сеть'],
  [1 << 24, 'Клапан 1 неисправен'],
  [1 << 25, 'Клапан 2 неисправен'],
  [1 << 26, 'Фильтр порван или не стоит'],
  [1 << 27, 'Нет связи с кнопками'],
  [1 << 28, 'Электроды бака: проверьте'],
  [1 << 29, 'Проверьте фильтр клапанов'],
  [1 << 30, 'Фильтр не отбивается — помойте'],
  [2 ** 31, 'Удар слабый: шланг широкий — закройте шланг для мощной очистки'],
];

/** Аварии (красные), остальное — предупреждения. */
export const SEVERE = (1 << 1) | (1 << 2) | (1 << 7) | (1 << 8) | (1 << 11) | (1 << 12) | (1 << 21) | (1 << 22) | (1 << 23) | (1 << 26) | (1 << 0);

export const VERR = [
  '',
  'обрыв катушки или её провода',
  'замыкание катушки',
  'не открывается: заклинил, нет 230 В или SSR',
  'ключ пробит',
  'тарелка не садится: грязь в седле, пружины',
  'магнит не держит тарелку: обрыв, нет 230 В, SSR, слабый магнит',
];

export const FILTER_STATES = ['не мерили', 'новый', 'отмытый', 'продутый'];

export function faultList(s: VacStatus): { text: string; severe: boolean }[] {
  const out: { text: string; severe: boolean }[] = [];
  const f = s.faults >>> 0;
  for (const [bit, text] of FAULTS)
    if ((f & bit) >>> 0) {
      let t = text;
      if (bit === 1 << 24 && VERR[s.v1]) t += `: ${VERR[s.v1]}`;
      if (bit === 1 << 25 && VERR[s.v2]) t += `: ${VERR[s.v2]}`;
      out.push({ text: t, severe: ((SEVERE >>> 0) & bit) >>> 0 !== 0 });
    }
  return out;
}

/** Состояние словами — для заголовка. */
export function stateText(s: VacStatus): string {
  if (s.sleep) return 'Выключен';
  if (s.reseat) return 'Тарелка садится — турбины сброшены';
  if (s.hwait) return 'Закройте шланг ладонью — мощная очистка';
  if (s.purging === 2) return `Мощная очистка, удар ${s.pno}`;
  if (s.purging === 4) return 'Очистка перед остановкой';
  if (s.purging) return s.pno ? `Очистка: удар ${s.pno}` : 'Очистка: разгон';
  if (s.running) return s.tool ? 'Работа с инструментом' : 'Работа';
  if (s.tool) return 'Инструмент — пуск';
  return 'Стоит';
}

/** Насколько забит фильтр, %: R сейчас против R нового (100 — как новый). */
export function filterClean(s: VacStatus): number | null {
  if (!(s.rnew > 0) || !(s.r > 0)) return null;
  return Math.max(0, Math.min(100, Math.round((s.rnew / s.r) * 100)));
}

/** Разбор JSON от контроллера: числа «как есть», не хватает полей — нули. */
export function parseStatus(text: string): VacStatus | null {
  try {
    const o = JSON.parse(text) as Partial<VacStatus>;
    if (typeof o !== 'object' || o === null || typeof o.state !== 'number') return null;
    return o as VacStatus;
  } catch {
    return null;
  }
}

/** Связь с пылесосом: одна для демо, Wi-Fi и Bluetooth. */
export interface Link {
  readonly kind: 'demo' | 'wifi' | 'ble';
  readonly title: string;
  send(cmd: string): void;
  close(): void;
  onStatus: ((s: VacStatus) => void) | null;
  onLog: ((line: string) => void) | null;
  onClose: ((why: string) => void) | null;
}
