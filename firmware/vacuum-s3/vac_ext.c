/*
 * Ядро 6.0: настройки 6.0 (отдельная запись — настройки 5.x не трогаются), часы DS3231, весы
 * NAU7802 (тензодатчик под колесом бака), голос (DFPlayer Mini по линии 5 кабеля пульта),
 * «чёрный ящик» (записи по 32 байта на флеш), графики для экрана (кольца за 10 минут и 4 часа),
 * осциллограф удара, паспорт пылесоса (мастер первого пуска), обслуживание фильтра с историей
 * (что сделали и сколько это вернуло), прогноз мойки, напоминания (щётки, фильтр клапанов,
 * уплотнения тарелок, осмотр фильтра), отчёт смены.
 * Экрану — строки X (настройки 6.0), G (паспорт), M (обслуживание), Q (история фильтра),
 * R (отчёт), H (график), O (удар), T (проверка) — только если экран сказал «hi2» (новый
 * интерфейс 3,5″): старому пульту 7″ они не нужны.
 */
#include "vac_core.h"

vac_ext_t vac_ext;

#define EXT_MAGIC 0x5836
#define EXT_VERSION 1

static uint32_t now(void) { return vac_now_ms(); }

/* ---------------- числа и строки ---------------- */

float str_to_float(const char *s) {
  float sign = 1, v = 0, k = 0;
  while (*s == ' ') s++;
  if (*s == '-') sign = -1, s++;
  for (; *s; s++) {
    if (*s >= '0' && *s <= '9') {
      if (k > 0) v += (float)(*s - '0') * k, k *= 0.1f;
      else v = v * 10 + (float)(*s - '0');
    } else if ((*s == '.' || *s == ',') && k == 0)
      k = 0.1f;
    else
      break;
  }
  return sign * v;
}

static void kvf(char *out, const char *k, float v, int dec) {
  char n[20];
  str_cat(out, " "), str_cat(out, k), str_cat(out, "="), str_cat(out, fmt_num(n, v, dec));
}

static void kvi(char *out, const char *k, long v) {
  char n[16];
  str_cat(out, " "), str_cat(out, k), str_cat(out, "="), str_cat(out, fmt_int(n, v));
}

static int ext_panel; /* экран 3,5″ (новый интерфейс) на связи: ему — строки 6.0 */
static uint32_t ext_panel_at;

/* ---------------- настройки 6.0 ---------------- */

static uint16_t crc16(const void *d, unsigned n) {
  const uint8_t *p = (const uint8_t *)d;
  uint16_t c = 0xFFFF;
  for (unsigned i = 0; i < n; i++) {
    c ^= (uint16_t)(p[i] << 8);
    for (int b = 0; b < 8; b++) c = (uint16_t)(c & 0x8000 ? (c << 1) ^ 0x1021 : c << 1);
  }
  return c;
}

static unsigned crc_len(void) { return (unsigned)((const uint8_t *)&vac_ext.crc - (const uint8_t *)&vac_ext); }

static void ext_defaults(void) {
  vac_ext_t d;
  uint8_t *p = (uint8_t *)&d;
  for (unsigned i = 0; i < sizeof d; i++) p[i] = 0;
  d.magic = EXT_MAGIC;
  d.version = EXT_VERSION;
  d.vmode = VM_BOTH;
  d.boost = 0;   /* разгон к обычной серии — для опытов; к мощной — boost2 */
  d.boost_ms = 1200;
  d.boost2 = 1;
  d.autotune = 0;
  d.voice = 2;
  d.volume = 22;
  d.clicks = 1;
  d.hose_len = 5;
  d.tank_l = 30;
  d.intake_lim = 20000;
  d.seal_lim = 50000;
  d.filt_lim = 40;
  d.wash_k = 180;
  d.sc_full = 450;
  d.sc_bag = 150;
  vac_ext = d;
}

static int ext_valid(const vac_ext_t *e) {
  return e->magic == EXT_MAGIC && e->version == EXT_VERSION && e->crc == crc16(e, (unsigned)((const uint8_t *)&e->crc - (const uint8_t *)e));
}

static uint8_t ext_dirty;

void ext_save(void) {
  vac_ext.seq++;
  vac_ext.crc = crc16(&vac_ext, crc_len());
  hal_settings_save2(2 + (int)(vac_ext.seq & 1), &vac_ext, sizeof vac_ext);
  ext_dirty = 0;
}

static void ext_changed(void) {
  ext_dirty = 1;
  vac_save_soon();
}

static void ext_load(void) {
  static vac_ext_t a, b;
  int ra = hal_settings_load2(2, &a, sizeof a) == (int)sizeof a && ext_valid(&a);
  int rb = hal_settings_load2(3, &b, sizeof b) == (int)sizeof b && ext_valid(&b);
  if (ra && (!rb || (int32_t)(a.seq - b.seq) > 0)) vac_ext = a;
  else if (rb) vac_ext = b;
  else ext_defaults();
  if (vac_ext.vmode > VM_TWO) vac_ext.vmode = VM_BOTH;
  if (vac_ext.boost_ms < 300 || vac_ext.boost_ms > 5000) vac_ext.boost_ms = 1200;
  if (vac_ext.volume > 30) vac_ext.volume = 22;
  if (vac_ext.nsvc > N_FSVC) vac_ext.nsvc = 0;
}

/* ---------------- часы ---------------- */

static const uint8_t MDAYS[12] = {31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};

static int leap(int y) { return (y % 4 == 0 && y % 100 != 0) || y % 400 == 0; }

static uint32_t to_secs(int y, int mo, int d, int h, int mi, int s) {
  uint32_t days = 0;
  for (int i = 2000; i < y; i++) days += leap(i) ? 366 : 365;
  for (int i = 1; i < mo; i++) days += MDAYS[i - 1] + (i == 2 && leap(y));
  days += (uint32_t)(d - 1);
  return days * 86400u + (uint32_t)h * 3600u + (uint32_t)mi * 60u + (uint32_t)s;
}

static void from_secs(uint32_t t, int *y, int *mo, int *d, int *h, int *mi, int *s) {
  uint32_t days = t / 86400u, r = t % 86400u;
  *h = (int)(r / 3600), *mi = (int)(r % 3600 / 60), *s = (int)(r % 60);
  int yy = 2000;
  for (;;) {
    uint32_t n = leap(yy) ? 366 : 365;
    if (days < n) break;
    days -= n, yy++;
  }
  int m = 1;
  for (;;) {
    uint32_t n = MDAYS[m - 1] + (m == 2 && leap(yy));
    if (days < n) break;
    days -= n, m++;
  }
  *y = yy, *mo = m, *d = (int)days + 1;
}

/* «07.10 14:30» */
static char *time_str(char *out, uint32_t t) {
  int y, mo, d, h, mi, s;
  out[0] = 0;
  if (!t) return str_cat(out, "—");
  from_secs(t, &y, &mo, &d, &h, &mi, &s);
  char n[6];
  str_cat(out, d < 10 ? "0" : ""), str_cat(out, fmt_int(n, d)), str_cat(out, ".");
  str_cat(out, mo < 10 ? "0" : ""), str_cat(out, fmt_int(n, mo)), str_cat(out, ".");
  str_cat(out, fmt_int(n, y)), str_cat(out, " ");
  str_cat(out, h < 10 ? "0" : ""), str_cat(out, fmt_int(n, h)), str_cat(out, ":");
  str_cat(out, mi < 10 ? "0" : ""), str_cat(out, fmt_int(n, mi));
  return out;
}

static int bcd(uint8_t b) { return (b >> 4) * 10 + (b & 15); }
static uint8_t tobcd(int v) { return (uint8_t)(v / 10 << 4 | v % 10); }

static int rtc_read(uint32_t *t) {
  uint8_t reg = 0, r[7];
  if (hal_i2c_write(0, RTC_ADDR, &reg, 1) || hal_i2c_read(0, RTC_ADDR, r, 7)) return -1;
  int s = bcd(r[0] & 0x7F), mi = bcd(r[1] & 0x7F), h = bcd(r[2] & 0x3F), d = bcd(r[4] & 0x3F), mo = bcd(r[5] & 0x1F), y = 2000 + bcd(r[6]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return -2;
  *t = y >= 2024 ? to_secs(y, mo, d, h, mi, s) : 0; /* до 2024 — часы не выставлены */
  return 0;
}

static int rtc_write(uint32_t t) {
  int y, mo, d, h, mi, s;
  from_secs(t, &y, &mo, &d, &h, &mi, &s);
  uint8_t w[8] = {0, tobcd(s), tobcd(mi), tobcd(h), 1, tobcd(d), tobcd(mo), tobcd(y - 2000)};
  return hal_i2c_write(0, RTC_ADDR, w, 8);
}

static void time_set(uint32_t t) {
  vac.time_s = t;
  if (vac.rtc_ok) rtc_write(t);
}

/* ---------------- весы NAU7802 ---------------- */

static int nau_w(uint8_t reg, uint8_t v) {
  uint8_t d[2] = {reg, v};
  return hal_i2c_write(0, SCALE_ADDR, d, 2);
}

static int nau_r(uint8_t reg, uint8_t *v, int n) {
  if (hal_i2c_write(0, SCALE_ADDR, &reg, 1)) return -1;
  return hal_i2c_read(0, SCALE_ADDR, v, n);
}

static int32_t sc_raw;
static float sc_avg;
static uint8_t sc_have, sc_heavy, sc_bagfull;

static int scale_init(void) {
  uint8_t v;
  if (nau_w(0x00, 0x01)) return -1;              /* сброс регистров */
  nau_w(0x00, 0x02);                             /* PUD: питание цифровой части */
  int ok = 0;
  for (int i = 0; i < 50 && !ok; i++)
    if (nau_r(0x00, &v, 1) == 0 && (v & 0x08)) ok = 1; /* PUR: готов */
  if (!ok) return -2;
  nau_w(0x01, 0x27);                             /* LDO 3,3 В, усиление 128 */
  nau_w(0x00, 0x86);                             /* PUD, PUA, AVDDS — внутренний LDO */
  nau_w(0x15, 0x30);                             /* без тактирования прерывателя (по даташиту) */
  nau_w(0x1C, 0x80);                             /* конденсатор PGA */
  nau_w(0x02, 0x04);                             /* 10 отсчётов/с, калибровка смещения */
  for (int i = 0; i < 100; i++)
    if (nau_r(0x02, &v, 1) == 0 && !(v & 0x04)) break;
  nau_w(0x00, 0x96);                             /* CS: непрерывные измерения */
  return 0;
}

static void scale_poll(void) {
  uint8_t st, r[3];
  if (!vac.scale_ok || nau_r(0x00, &st, 1) || !(st & 0x20)) return;
  if (nau_r(0x12, r, 3)) return;
  int32_t raw = (int32_t)((uint32_t)r[0] << 24 | (uint32_t)r[1] << 16 | (uint32_t)r[2] << 8) >> 8;
  sc_raw = raw;
  sc_avg = sc_have ? sc_avg + ((float)raw - sc_avg) * 0.25f : (float)raw;
  sc_have = 1;
  vac.kg = vac_ext.sc_k > 0 ? (sc_avg - (float)vac_ext.sc_tare) / vac_ext.sc_k : -1;
}

float ext_scale_kg(void) { return vac.scale_ok && vac_ext.sc_k > 0 ? vac.kg : -1; }

/* ---------------- голос: DFPlayer Mini ---------------- */

/* Уровень сообщения: 1 — тревога, 2 — предупреждение, 3 — событие. */
static const uint8_t PH_LEVEL[V_COUNT] = {
    0, 1, 1, 2, 1, 2, 2, 1, 2, /* —, бак полон, перелив, мыть фильтр, порван, мало воздуха, забит, перегрев, горячая */
    1, 2, 2, 2, 3, 3, 2, 2,    /* перегрузка, клапан, тарелка не садится, магнит не держит, закройте шланг, мощная закончена, фильтр клапанов, удар слабый */
    2, 2, 3, 2, 2, 2, 1, 1,    /* не отбивается, сеть, замер готов, щётки, мешок полон, бак тяжёлый, реле сварилось, симистор */
    2, 3, 2, 3, 2, 1, 2, 3,    /* инструмент включён, первый пуск, респиратор, проверка хорошо, плохо, нет синхронизации, датчик, готов */
    3, 3, 3, 3, 2, 2,          /* обслуживание, серия, остановка, привет, нет тока, турбина изношена */
};

/* Длина фразы (mp3 из voice/make-voice.py), ×0,1 с: следующая — после конца этой (вывода BUSY у
 * плеера нет — линия одна). */
static const uint8_t PH_LEN[V_COUNT] = {
    0, 21, 21, 13, 29, 25, 17, 27, 27, 24, 21, 42, 26, 17, 22, 16, 35, 45, 23, 16,
    17, 12, 24, 38, 26, 31, 22, 17, 12, 16, 19, 14, 14, 19, 12, 18, 23, 26, 36,
};

static uint8_t vq[6], vq_n;
static uint32_t v_next, v_boot_at, v_last[V_COUNT];
static uint8_t v_inited, v_line;

static void dfp(uint8_t cmd, uint16_t arg) {
  uint8_t f[10] = {0x7E, 0xFF, 0x06, cmd, 0x00, (uint8_t)(arg >> 8), (uint8_t)arg, 0, 0, 0xEF};
  uint16_t sum = (uint16_t)(0 - (0xFF + 0x06 + cmd + 0x00 + (arg >> 8) + (arg & 0xFF)));
  f[7] = (uint8_t)(sum >> 8), f[8] = (uint8_t)sum;
  hal_voice_write(f, 10);
}

/* Линия 5 кабеля пульта — голосу, только если по UART1 не говорит пульт 7″ отдельной платой
 * (экран тогда на самом контроллере). Пульт заговорил — голос отдаёт линию. */
static uint32_t ub_last;
static uint8_t v_blocked;

static void voice_line(void) {
  int on = vac_ext.voice > 0 && !v_blocked && vac.uptime_s >= 3;
  if (on != v_line) {
    hal_voice_begin(on);
    v_line = (uint8_t)on;
    v_inited = 0;
    v_boot_at = now() + 1500; /* плееру нужно до 1,5 с после включения */
  }
}

void ext_say(int ph) {
  if (ph <= 0 || ph >= V_COUNT || !vac_ext.voice || PH_LEVEL[ph] > vac_ext.voice) return;
  uint32_t t = now();
  /* Одно и то же — не чаще раза в 30 с (тревоги — в 15 с). */
  uint32_t gap = PH_LEVEL[ph] == 1 ? 15000 : 30000;
  if (v_last[ph] && t - v_last[ph] < gap) return;
  v_last[ph] = t ? t : 1;
  for (int i = 0; i < vq_n; i++)
    if (vq[i] == ph) return;
  if (vq_n < (int)sizeof vq) vq[vq_n++] = (uint8_t)ph;
  else if (PH_LEVEL[ph] == 1) vq[vq_n - 1] = (uint8_t)ph; /* тревога вытесняет последнее */
}

static void voice_poll(void) {
  voice_line();
  if (!v_line) {
    vq_n = 0;
    return;
  }
  uint32_t t = now();
  if ((int32_t)(t - v_boot_at) < 0) return;
  if (!v_inited) {
    dfp(0x06, vac_ext.volume); /* громкость */
    v_inited = 1;
    v_next = t + 200;
    return;
  }
  if (!vq_n || (int32_t)(t - v_next) < 0) return;
  /* Тревоги — первыми. */
  int best = 0;
  for (int i = 1; i < vq_n; i++)
    if (PH_LEVEL[vq[i]] < PH_LEVEL[vq[best]]) best = i;
  int ph = vq[best];
  for (int i = best + 1; i < vq_n; i++) vq[i - 1] = vq[i];
  vq_n--;
  dfp(0x12, (uint16_t)ph); /* /mp3/00NN.mp3 */
  v_next = t + (uint32_t)PH_LEN[ph] * 100 + 600;
}

void ext_fault(uint32_t bit, int on) {
  ext_event(on ? EV_FAULT_ON : EV_FAULT_OFF, 0, (float)(bit ? __builtin_ctz(bit) : 0));
  if (!on) return;
  int ph = 0;
  switch (bit) {
  case F_WATER: ph = V_TANK_FULL; break;
  case F_OVERFLOW: ph = V_OVERFLOW; break;
  case F_FILTER: ph = V_FILTER_WASH; break;
  case F_TORN: ph = V_FILTER_TORN; break;
  case F_LOWAIR: ph = V_LOW_AIR; break;
  case F_BLOCKED: ph = V_BLOCKED; break;
  case F_HOT1: case F_HOT2: ph = V_HOT; break;
  case F_WARM1: case F_WARM2: ph = V_WARM; break;
  case F_OVER1: case F_OVER2: ph = V_OVERLOAD; break;
  case F_VALVE1: ph = vac.verr[0] == VE_NOCLOSE ? V_NOCLOSE : vac.verr[0] == VE_HOLD ? V_HOLD : V_VALVE; break;
  case F_VALVE2: ph = vac.verr[1] == VE_NOCLOSE ? V_NOCLOSE : vac.verr[1] == VE_HOLD ? V_HOLD : V_VALVE; break;
  case F_INTAKE: ph = V_INTAKE; break;
  case F_WEAK: ph = V_WEAK; break;
  case F_STUCK: ph = V_STUCK; break;
  case F_MAINS: ph = V_MAINS; break;
  case F_WELD1: case F_WELD2: ph = V_WELD; break;
  case F_LEAK1: case F_LEAK2: ph = V_TRIAC; break;
  case F_NO_ZC: ph = V_NO_SYNC; break;
  case F_NOCUR1: case F_NOCUR2: ph = V_NOCUR; break;
  case F_SDP_F: case F_SDP_Q: case F_VAC: case F_NTC1: case F_NTC2: case F_EXP: case F_PROBE: ph = V_SENSOR; break;
  }
  if (ph) ext_say(ph);
}

/* ---------------- «чёрный ящик» и графики ---------------- */

typedef struct {
  uint32_t t;            /* часы (секунды от 2000) или 0 */
  uint8_t type, a;       /* EV_…, параметр */
  uint16_t b;            /* параметр */
  uint16_t flow10, vac10, r10, watts, dp, amps10, kg10;
  int8_t t1, t2;
  uint16_t pulses;       /* ударов всего (младшие 16 бит) */
  uint8_t state, faults_n;
  uint32_t up;           /* секунды от включения */
} bb_rec_t;

typedef char bb_size_check[sizeof(bb_rec_t) == 32 ? 1 : -1];

void ext_event(int kind, int a, float b) {
  bb_rec_t r;
  uint8_t *p = (uint8_t *)&r;
  for (unsigned i = 0; i < sizeof r; i++) p[i] = 0;
  r.t = vac.time_s;
  r.type = (uint8_t)kind, r.a = (uint8_t)a, r.b = (uint16_t)(b < 0 ? 0 : b > 65535 ? 65535 : b);
  r.flow10 = (uint16_t)(vac.flow_ls * 10), r.vac10 = (uint16_t)(vac.vacuum_kpa * 10), r.r10 = (uint16_t)(vac.r_now * 10);
  r.watts = (uint16_t)(vac.watts[0] + vac.watts[1]);
  r.dp = (uint16_t)(vac.filter_pa < 0 ? 0 : vac.filter_pa), r.amps10 = (uint16_t)(vac.total_amps * 10);
  float kg = ext_scale_kg();
  r.kg10 = (uint16_t)(kg > 0 ? kg * 10 : 0);
  r.t1 = (int8_t)vac.temp[0], r.t2 = (int8_t)vac.temp[1];
  r.pulses = (uint16_t)vac_cfg.pulse_count;
  r.state = (uint8_t)(vac.running | vac.purging << 1 | vac.tool << 4 | vac.sleep << 6);
  int fn = 0;
  for (uint32_t f = vac.faults; f; f &= f - 1) fn++;
  r.faults_n = (uint8_t)fn;
  r.up = vac.uptime_s;
  hal_bb_append(&r, sizeof r);
}

/* Строка CSV «чёрного ящика» (Excel по-русски: «;» и запятая): index = 0xFFFFFFFF — заголовок.
 * Длина строки или 0, если записи нет. */
int vac_bb_csv(uint32_t index, char *out, int len) {
  static const char *const EV[8] = {"замер", "авария", "снята", "серия", "фильтр", "проверка", "включение", "инструмент"};
  char n[20], tb[24];
  if (len < 400) return 0;
  out[0] = 0;
  if (index == 0xFFFFFFFFu) {
    str_cat(out, "время;с от включения;событие;что;расход, л/с;разрежение, кПа;R фильтра;мощность турбин, Вт;перепад, Па;ток, А;в баке, кг;t1, °C;t2, °C;ударов;работа;очистка;инструмент;аварий\r\n");
    return str_len(out);
  }
  bb_rec_t r;
  if (hal_bb_read(index, &r, sizeof r)) return 0;
  time_str(tb, r.t);
  if (r.t) {
    char sec[4] = {':', (char)('0' + r.t % 60 / 10), (char)('0' + r.t % 10), 0};
    str_cat(tb, sec);
  }
  str_cat(out, tb), str_cat(out, ";");
  str_cat(out, fmt_int(n, (long)r.up)), str_cat(out, ";");
  str_cat(out, r.type < 8 ? EV[r.type] : "?"), str_cat(out, ";");
  if (r.type == EV_FAULT_ON || r.type == EV_FAULT_OFF) str_cat(out, vac_fault_text(1UL << (r.b & 31)));
  else if (r.type == EV_SERIES) str_cat(out, r.a == PURGE_STRONG ? "мощная" : "серия"), str_cat(out, ", R после "), str_cat(out, fmt_num(n, r.b / 10.0f, 1));
  else if (r.type == EV_FILTER) str_cat(out, "обслуживание, R после "), str_cat(out, fmt_num(n, r.b / 10.0f, 1));
  else if (r.type == EV_TEST) str_cat(out, "проверка "), str_cat(out, fmt_int(n, r.a)), str_cat(out, r.b ? " — исправно" : " — не прошла");
  str_cat(out, ";");
  str_cat(out, fmt_num(n, r.flow10 / 10.0f, 1)), str_cat(out, ";");
  str_cat(out, fmt_num(n, r.vac10 / 10.0f, 1)), str_cat(out, ";");
  str_cat(out, fmt_num(n, r.r10 / 10.0f, 1)), str_cat(out, ";");
  str_cat(out, fmt_int(n, r.watts)), str_cat(out, ";");
  str_cat(out, fmt_int(n, r.dp)), str_cat(out, ";");
  str_cat(out, fmt_num(n, r.amps10 / 10.0f, 1)), str_cat(out, ";");
  str_cat(out, r.kg10 ? fmt_num(n, r.kg10 / 10.0f, 1) : ""), str_cat(out, ";");
  str_cat(out, fmt_int(n, r.t1)), str_cat(out, ";");
  str_cat(out, fmt_int(n, r.t2)), str_cat(out, ";");
  str_cat(out, fmt_int(n, r.pulses)), str_cat(out, ";");
  str_cat(out, r.state & 1 ? "да" : ""), str_cat(out, ";");
  str_cat(out, r.state >> 1 & 7 ? "да" : ""), str_cat(out, ";");
  str_cat(out, r.state >> 4 & 3 ? "да" : ""), str_cat(out, ";");
  str_cat(out, fmt_int(n, r.faults_n)), str_cat(out, "\r\n");
  return str_len(out);
}

/* Графики: 8 величин, кольцо 120 точек по 5 с (10 минут) и 240 по минуте (4 часа). */
#define HN 8
#define HF 120
#define HS 240
static int16_t hf[HN][HF], hs[HN][HS];
static uint16_t hf_i, hs_i, hf_cnt, hs_cnt;
static float hacc[HN];
static int hacc_n;
static const char *const HNAME[HN] = {"Расход, л/с", "Разрежение, кПа", "Фильтр R", "Мощность, Вт", "Нагрев, °C", "Вес, кг", "Перепад, Па", "Ток, А"};
static const float HK[HN] = {10, 10, 10, 1, 10, 10, 1, 10}; /* множитель хранения */

/* Удары: время (с от включения) последних 64 — отметки на графиках. */
static uint32_t pulse_t[64];
static uint8_t pulse_i;

void ext_pulse_marker(void) { pulse_t[pulse_i++ & 63] = vac.uptime_s; }

static float hist_now(int m) {
  switch (m) {
  case 0: return vac.flow_ls;
  case 1: return vac.vacuum_kpa;
  case 2: return vac.r_now;
  case 3: return vac.watts[0] + vac.watts[1];
  case 4: return vac.temp[0] > vac.temp[1] ? vac.temp[0] : vac.temp[1];
  case 5: return ext_scale_kg() > 0 ? ext_scale_kg() : 0;
  case 6: return vac.filter_pa;
  default: return vac.total_amps;
  }
}

static void hist_tick(void) {
  /* Каждые 5 с. */
  for (int m = 0; m < HN; m++) {
    float v = hist_now(m) * HK[m];
    hf[m][hf_i] = (int16_t)(v > 32767 ? 32767 : v < -32767 ? -32767 : v);
    hacc[m] += hist_now(m);
  }
  hf_i = (uint16_t)((hf_i + 1) % HF);
  if (hf_cnt < HF) hf_cnt++;
  if (++hacc_n >= 12) {
    for (int m = 0; m < HN; m++) {
      float v = hacc[m] / (float)hacc_n * HK[m];
      hs[m][hs_i] = (int16_t)(v > 32767 ? 32767 : v < -32767 ? -32767 : v);
      hacc[m] = 0;
    }
    hacc_n = 0;
    hs_i = (uint16_t)((hs_i + 1) % HS);
    if (hs_cnt < HS) hs_cnt++;
  }
}

static void send_hist(int m, int range) {
  if (m < 0 || m >= HN) return;
  static char s[2200];
  char n[16];
  s[0] = 0;
  str_cat(s, "H");
  kvi(s, "m", m), kvi(s, "r", range);
  int slow = range != 0;
  int cnt = slow ? hs_cnt : hf_cnt, size = slow ? HS : HF, head = slow ? hs_i : hf_i;
  int want = range == 2 ? HS : range == 1 ? 60 : HF;
  if (cnt > want) cnt = want;
  kvi(s, "n", cnt), kvi(s, "dt", slow ? 60 : 5);
  str_cat(s, " v=");
  for (int i = 0; i < cnt; i++) {
    int idx = (head - cnt + i + size) % size;
    int16_t raw = slow ? hs[m][idx] : hf[m][idx];
    if (i) str_cat(s, "/");
    str_cat(s, fmt_num(n, (float)raw / HK[m], HK[m] > 1 ? 1 : 0));
  }
  /* Удары за этот отрезок: секунды назад. */
  str_cat(s, " p=");
  uint32_t span = (uint32_t)cnt * (slow ? 60u : 5u);
  int first = 1;
  for (int i = 0; i < 64; i++) {
    uint32_t t = pulse_t[(pulse_i - 1 - i) & 63];
    if (!t || vac.uptime_s - t > span) continue;
    if (!first) str_cat(s, "/");
    str_cat(s, fmt_int(n, (long)(vac.uptime_s - t)));
    first = 0;
  }
  link_send(s);
  (void)HNAME;
}

/* ---------------- осциллограф удара ---------------- */

#define OSC_N 160
static int16_t osc_a[OSC_N], osc_b[OSC_N];
static uint16_t osc_len;
static uint8_t osc_mask, osc_on;
static uint16_t osc_imp;

void ext_osc_begin(uint8_t mask, uint16_t imp) {
  osc_len = 0;
  osc_mask = mask;
  osc_imp = imp;
  osc_on = 1;
  ext_pulse_marker();
}

void ext_osc_sample(float kpa, float pa) {
  if (!osc_on || osc_len >= OSC_N) return;
  osc_a[osc_len] = (int16_t)(kpa * 10);
  osc_b[osc_len] = (int16_t)(pa < -32000 ? -32000 : pa > 32000 ? 32000 : pa);
  osc_len++;
}

static float osc_depth, osc_rev;
static int osc_front;

static void send_osc(void) {
  static char s[2200];
  char n[12];
  s[0] = 0;
  str_cat(s, "O");
  kvi(s, "k", vac.osc_n), kvi(s, "n", osc_len), kvi(s, "dt", 2), kvi(s, "m", osc_mask), kvi(s, "i", osc_imp);
  kvf(s, "d", osc_depth * 100, 0), kvf(s, "rv", osc_rev, 0), kvi(s, "tf", osc_front);
  str_cat(s, " a=");
  for (int i = 0; i < osc_len; i++) {
    if (i) str_cat(s, "/");
    str_cat(s, fmt_int(n, osc_a[i]));
  }
  str_cat(s, " b=");
  for (int i = 0; i < osc_len; i++) {
    if (i) str_cat(s, "/");
    str_cat(s, fmt_int(n, osc_b[i]));
  }
  link_send(s);
}

void ext_osc_end(float depth, float rev, int t_front) {
  osc_on = 0;
  osc_depth = depth, osc_rev = rev, osc_front = t_front;
  vac.osc_n++;
  if (ext_panel) send_osc();
}

/* ---------------- отчёт смены ---------------- */

static struct {
  uint32_t t0, up0;     /* начало смены: часы и секунды от включения */
  uint32_t run_s, tool_s, series, pulses0;
  float wh, kg0, tmax, flow_sum;
  uint32_t flow_n, faults;
} rep;

static void report_reset(void) {
  rep.t0 = vac.time_s, rep.up0 = vac.uptime_s;
  rep.run_s = rep.tool_s = rep.series = 0;
  rep.pulses0 = vac_cfg.pulse_count;
  rep.wh = 0, rep.tmax = 0, rep.flow_sum = 0, rep.flow_n = 0, rep.faults = 0;
  float kg = ext_scale_kg();
  rep.kg0 = kg > 0 ? kg : 0;
}

/* ---------------- фильтр: обслуживание, прогноз ---------------- */

static float svc_r_before;
static uint8_t svc_pending;

void ext_svc_done(float r_after) {
  if (!svc_pending) return;
  svc_pending = 0;
  if (vac_ext.nsvc == N_FSVC) {
    for (int i = 1; i < N_FSVC; i++) vac_ext.svc[i - 1] = vac_ext.svc[i];
    vac_ext.nsvc--;
  }
  vac_fsvc_t *e = &vac_ext.svc[vac_ext.nsvc++];
  e->t = vac.time_s;
  e->hours = (uint16_t)(vac_cfg.f[vac_cfg.filt].work_s / 360);
  e->mask = vac.svc_mask;
  e->r_before = (uint16_t)(svc_r_before * 10);
  e->r_after = (uint16_t)(r_after * 10);
  vac_ext.last_svc_work = vac_cfg.f[vac_cfg.filt].work_s;
  char line[120] = "Обслуживание фильтра записано: R ", n[12];
  str_cat(line, fmt_num(n, svc_r_before, 1)), str_cat(line, " → "), str_cat(line, fmt_num(n, r_after, 1));
  hal_log(line);
  ext_event(EV_FILTER, vac.svc_mask, r_after * 10);
  ext_say(V_FILTER_SERVICE);
  ext_changed();
  ext_send_lines(); /* история — экрану сразу: он показывает «было → стало» */
}

/* Прогноз: R после серий от наработки фильтра — прямая по последним точкам. */
#define FC_N 12
static float fc_h[FC_N], fc_r[FC_N];
static int fc_n;

void ext_series_done(float r_after) {
  ext_event(EV_SERIES, vac.purging, r_after * 10);
  rep.series++;
  if (r_after <= 0) return;
  if (fc_n == FC_N) {
    for (int i = 1; i < FC_N; i++) fc_h[i - 1] = fc_h[i], fc_r[i - 1] = fc_r[i];
    fc_n--;
  }
  fc_h[fc_n] = (float)vac_cfg.f[vac_cfg.filt].work_s / 3600.0f;
  fc_r[fc_n] = r_after;
  fc_n++;
  vac.fc_hours = -1;
  const vac_filter_t *f = &vac_cfg.f[vac_cfg.filt];
  if (fc_n < 4 || f->r_new <= 0) return;
  float sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (int i = 0; i < fc_n; i++) sx += fc_h[i], sy += fc_r[i], sxx += fc_h[i] * fc_h[i], sxy += fc_h[i] * fc_r[i];
  float den = (float)fc_n * sxx - sx * sx;
  if (den < 1e-6f) return;
  float k = ((float)fc_n * sxy - sx * sy) / den;
  float lim = f->r_new * (float)vac_ext.wash_k / 100.0f;
  if (k > 0.01f) {
    float h = (lim - r_after) / k;
    vac.fc_hours = h < 0 ? 0 : h;
  }
}

/* ---------------- строки экрану ---------------- */

static void send_x(void) {
  char s[400] = "X";
  kvi(s, "pw2", vac_ext.pw2 ? vac_ext.pw2 : vac_cfg.power);
  kvi(s, "rs", vac_ext.rsel), kvi(s, "vm", vac_ext.vmode), kvi(s, "bo", vac_ext.boost), kvi(s, "bm", vac_ext.boost_ms), kvi(s, "b2", vac_ext.boost2);
  kvi(s, "at", vac_ext.autotune), kvi(s, "dip", vac_cfg.dip), kvi(s, "vk", vac_cfg.vlv_kind);
  static const uint8_t AT_DIP[4] = {0, 40, 70, 90};
  int best = 0;
  for (int i = 1; i < 4; i++)
    if (vac_ext.at_score[i] > vac_ext.at_score[best]) best = i;
  kvi(s, "atb", vac_ext.at_score[best] > 0 ? AT_DIP[best] : -1);
  kvi(s, "vo", vac_ext.voice), kvi(s, "vv", vac_ext.volume), kvi(s, "ck", vac_ext.clicks), kvi(s, "cm", vac_ext.classm);
  kvi(s, "sk", vac.scale_ok), kvi(s, "sc", vac_ext.sc_k > 0), kvf(s, "sf", vac_ext.sc_full / 10.0f, 1), kvf(s, "sb", vac_ext.sc_bag / 10.0f, 1);
  kvi(s, "rtc", vac.rtc_ok), kvi(s, "hm", vac_cfg.hose_mm), kvi(s, "hl", vac_ext.hose_len), kvi(s, "tk", vac_ext.tank_l), kvi(s, "ft", vac_ext.ftype);
  kvi(s, "ms", vac_cfg.min_speed), kvi(s, "ss", vac_cfg.softstart), kvi(s, "sg", vac_cfg.stagger_ms), kvi(s, "wk", vac_ext.wash_k);
  kvi(s, "il", (long)vac_ext.intake_lim), kvi(s, "sl", (long)vac_ext.seal_lim), kvi(s, "fl", vac_ext.filt_lim);
  link_send(s);
}

static void send_g(void) {
  char s[300] = "G", tb[24];
  kvi(s, "done", vac_ext.pass_t != 0);
  time_str(tb, vac_ext.pass_t > 1 ? vac_ext.pass_t : 0);
  for (char *p = tb; *p; p++)
    if (*p == ' ') *p = '_';
  str_cat(s, " dt="), str_cat(s, tb);
  for (int k = 0; k < 2; k++) {
    char key[4] = {'w', (char)('1' + k), 0, 0};
    kvi(s, key, vac_ext.t_open_w[k]);
    key[0] = 'q', kvf(s, key, vac_ext.t_open_q[k] / 10.0f, 1);
    key[0] = 'v', kvf(s, key, vac_ext.t_seal[k] / 10.0f, 1);
    key[0] = 'r', kvi(s, key, vac_ext.t_rated[k]);
    key[0] = 'k', kvi(s, key, vac_ext.v_ok[k]);
  }
  kvi(s, "ho", vac_ext.hold_ok), kvi(s, "se", vac_ext.sensors), kvf(s, "rn", vac_cfg.f[vac_cfg.filt].r_new, 1), kvf(s, "zo", vac_ext.vac_off10 / 10.0f, 1);
  link_send(s);
}

static float pct(float used, float lim) { return lim > 0 ? used / lim * 100.0f : 0; }

static void send_m(void) {
  char s[200] = "M";
  for (int k = 0; k < 2; k++) {
    float used = (float)(vac_cfg.whours[k] - vac_ext.brush_base[k]) / 3600.0f;
    kvf(s, k ? "b2" : "b1", pct(used, vac_cfg.brush_h), 0);
    kvf(s, k ? "h2" : "h1", used, 0);
  }
  kvf(s, "in", pct((float)vac_cfg.in_pulses, (float)vac_ext.intake_lim), 0);
  kvf(s, "se", pct((float)(vac_cfg.pulse_count - vac_ext.seal_base), (float)vac_ext.seal_lim), 0);
  float fh = (float)(vac_cfg.f[vac_cfg.filt].work_s - vac_ext.last_svc_work) / 3600.0f;
  kvf(s, "fl", pct(fh, vac_ext.filt_lim), 0), kvf(s, "fh", fh, 1);
  kvi(s, "bl", vac_cfg.brush_h);
  kvf(s, "fc", vac.fc_hours, 1);
  link_send(s);
}

static void send_q(void) {
  /* История обслуживания: Q n=… e0=t/часы/что/R до/R после … */
  static char s[900];
  char n[16], tb[24];
  s[0] = 0;
  str_cat(s, "Q");
  kvi(s, "n", vac_ext.nsvc);
  for (int i = 0; i < vac_ext.nsvc; i++) {
    const vac_fsvc_t *e = &vac_ext.svc[i];
    char k[6] = {' ', 'e', (char)('0' + i / 10), (char)('0' + i % 10), '=', 0};
    str_cat(s, k);
    time_str(tb, e->t);
    for (char *p = tb; *p; p++)
      if (*p == ' ') *p = '_';
    str_cat(s, tb), str_cat(s, "/");
    str_cat(s, fmt_num(n, e->hours / 10.0f, 1)), str_cat(s, "/");
    str_cat(s, fmt_int(n, e->mask)), str_cat(s, "/");
    str_cat(s, fmt_num(n, e->r_before / 10.0f, 1)), str_cat(s, "/");
    str_cat(s, fmt_num(n, e->r_after / 10.0f, 1));
  }
  link_send(s);
}

static void send_r(void) {
  char s[300] = "R", tb[24];
  time_str(tb, rep.t0);
  for (char *p = tb; *p; p++)
    if (*p == ' ') *p = '_';
  str_cat(s, " t0="), str_cat(s, tb);
  kvf(s, "on", (float)(vac.uptime_s - rep.up0) / 3600.0f, 2);
  kvf(s, "run", rep.run_s / 3600.0f, 2), kvf(s, "tool", rep.tool_s / 3600.0f, 2);
  kvi(s, "ser", (long)rep.series), kvi(s, "pul", (long)(vac_cfg.pulse_count - rep.pulses0));
  kvf(s, "kwh", rep.wh / 1000.0f, 2);
  float kg = ext_scale_kg();
  kvf(s, "kg", kg > 0 && rep.kg0 > 0 ? kg - rep.kg0 : -1, 1);
  kvf(s, "tmax", rep.tmax, 0), kvf(s, "flow", rep.flow_n ? rep.flow_sum / (float)rep.flow_n : 0, 1), kvi(s, "fa", (long)rep.faults);
  link_send(s);
}

void ext_send_lines(void) {
  if (!ext_panel) return;
  send_x();
  send_g();
  send_m();
  send_q();
  send_r();
}

/* Строка «T»: проверка первого пуска (пока идёт и пока экран не закрыл результат). */
static void send_t(void) {
  char s[160] = "T";
  kvi(s, "id", vac.test_id), kvi(s, "ph", vac.test_ph), kvi(s, "left", vac.test_left);
  for (int i = 0; i < 4; i++) {
    char k[3] = {'v', (char)('0' + i), 0};
    kvf(s, k, vac.test_val[i], 1);
  }
  link_send(s);
}

void ext_json(char *out) {
  char n[16];
  (void)n;
  /* json_num в vac_core — свой; здесь проще целыми строками. */
  float kg = ext_scale_kg();
  char b[220] = "\"w1\":";
  str_cat(b, fmt_int(n, (long)vac.watts[0])), str_cat(b, ",\"w2\":"), str_cat(b, fmt_int(n, (long)vac.watts[1]));
  str_cat(b, ",\"kg\":"), str_cat(b, fmt_int(n, (long)(kg * 10))), str_cat(b, ",\"time\":"), str_cat(b, fmt_int(n, (long)vac.time_s));
  str_cat(b, ",\"vmode\":"), str_cat(b, fmt_int(n, vac_ext.vmode)), str_cat(b, ",\"boost\":"), str_cat(b, fmt_int(n, vac_ext.boost));
  str_cat(b, ",\"voice\":"), str_cat(b, fmt_int(n, vac_ext.voice)), str_cat(b, ",\"test\":"), str_cat(b, fmt_int(n, vac.test_id));
  str_cat(b, ",\"pass\":"), str_cat(b, vac_ext.pass_t ? "1" : "0"), str_cat(b, ",");
  str_cat(out, b);
}

/* ---------------- команды ---------------- */

static int in(long v, long lo, long hi) { return v >= lo && v <= hi; }

int ext_command(const char *c, const char *a) {
  long v = str_to_int(a);
  char line[120], n[16];
  line[0] = 0;
  if (str_eq(c, "hi2")) {
    /* Экран 3,5″ (новый интерфейс): он же — пульт, плюс строки 6.0. */
    link_on_hello();
    if (!ext_panel) ext_panel = 1, ext_send_lines();
    ext_panel_at = now();
    return 1;
  }
  if (str_starts(c, "time")) {
    /* time 2026-10-07 14:30[:05] */
    const char *p = a;
    int f[6] = {0, 0, 0, 0, 0, 0}, k = 0;
    while (*p && k < 6) {
      if (*p >= '0' && *p <= '9') {
        f[k] = (int)str_to_int(p);
        while (*p >= '0' && *p <= '9') p++;
        k++;
      } else
        p++;
    }
    if (k >= 5 && in(f[0], 2024, 2099) && in(f[1], 1, 12) && in(f[2], 1, 31) && in(f[3], 0, 23) && in(f[4], 0, 59)) {
      time_set(to_secs(f[0], f[1], f[2], f[3], f[4], f[5]));
      if (!rep.t0) rep.t0 = vac.time_s;
    }
    hal_log(str_cat(str_cat(line, vac.rtc_ok ? "Часы: " : "Время (без модуля часов — до выключения): "), time_str(line + 80, vac.time_s)));
    return 1;
  }
  if (str_starts(c, "set ")) {
    if (str_starts(a, "vmode ") && in(str_to_int(a + 6), 0, 3)) vac_ext.vmode = (uint8_t)str_to_int(a + 6);
    else if (str_starts(a, "boost ") && in(str_to_int(a + 6), 0, 1)) vac_ext.boost = (uint8_t)str_to_int(a + 6);
    else if (str_starts(a, "boostms ") && in(str_to_int(a + 8), 300, 5000)) vac_ext.boost_ms = (uint16_t)str_to_int(a + 8);
    else if (str_starts(a, "boost2 ") && in(str_to_int(a + 7), 0, 2)) vac_ext.boost2 = (uint8_t)str_to_int(a + 7);
    else if (str_starts(a, "autotune ") && in(str_to_int(a + 9), 0, 1)) vac_ext.autotune = (uint8_t)str_to_int(a + 9);
    else if (str_starts(a, "rsel ") && in(str_to_int(a + 5), 0, 2)) vac_ext.rsel = (uint8_t)str_to_int(a + 5);
    else if (str_starts(a, "classm ")) vac_ext.classm = str_to_int(a + 7) ? 1 : 0;
    else if (str_starts(a, "clicks ")) vac_ext.clicks = str_to_int(a + 7) ? 1 : 0;
    else if (str_starts(a, "washk ") && in(str_to_int(a + 6), 120, 400)) vac_ext.wash_k = (uint16_t)str_to_int(a + 6);
    else if (str_starts(a, "intakelim ") && in(str_to_int(a + 10), 1000, 200000)) vac_ext.intake_lim = (uint32_t)str_to_int(a + 10);
    else if (str_starts(a, "seallim ") && in(str_to_int(a + 8), 1000, 500000)) vac_ext.seal_lim = (uint32_t)str_to_int(a + 8);
    else if (str_starts(a, "filtlim ") && in(str_to_int(a + 8), 2, 500)) vac_ext.filt_lim = (uint16_t)str_to_int(a + 8);
    else if (str_starts(a, "minspeed ") && in(str_to_int(a + 9), 0, 30)) vac_cfg.min_speed = (uint8_t)str_to_int(a + 9);
    else if (str_starts(a, "soft ") && in(str_to_int(a + 5), 5, 100)) vac_cfg.softstart = (uint8_t)str_to_int(a + 5);
    else if (str_starts(a, "brushh ") && in(str_to_int(a + 7), 100, 3000)) vac_cfg.brush_h = (uint16_t)str_to_int(a + 7);
    else
      return 0; /* остальное «set …» — ядру */
    ext_changed();
    ext_send_lines();
    return 1;
  }
  if (str_starts(c, "pass ")) {
    /* Паспорт: pass hose 36 | hosel 5 | tank 30 | ftype 0 | done */
    const char *b = a;
    while (*b && *b != ' ') b++;
    long x = str_to_int(b);
    if (str_starts(a, "hose ") && in(x, 20, 60)) vac_cfg.hose_mm = (uint8_t)x;
    else if (str_starts(a, "hosel ") && in(x, 1, 30)) vac_ext.hose_len = (uint8_t)x;
    else if (str_starts(a, "tank ") && in(x, 5, 200)) vac_ext.tank_l = (uint8_t)x;
    else if (str_starts(a, "ftype ") && in(x, 0, 3)) vac_ext.ftype = (uint8_t)x;
    else if (str_eq(a, "done")) {
      vac_ext.pass_t = vac.time_s ? vac.time_s : 1;
      hal_log("Первый пуск: паспорт пылесоса сохранён");
      ext_say(V_TEST_OK);
    } else if (str_eq(a, "reset"))
      vac_ext.pass_t = 0;
    else
      return 1;
    ext_changed();
    ext_send_lines();
    return 1;
  }
  if (str_starts(c, "fsvc")) {
    /* Обслуживание фильтра: fsvc begin (начали — напомнить про респиратор), fsvc new, fsvc N (маска SV_…) */
    if (str_eq(a, "begin")) {
      ext_say(V_MASK);
      hal_log("Обслуживание фильтра: остановите пылесос, наденьте респиратор FFP2/FFP3");
      return 1;
    }
    int mask = str_eq(a, "new") ? SV_NEW : (int)v;
    if (!mask) return 1;
    const vac_filter_t *f = &vac_cfg.f[vac_cfg.filt];
    svc_r_before = vac.r_after > 0 ? vac.r_after : vac.r_now > 0 ? vac.r_now : f->r_base;
    svc_pending = 1;
    vac.svc_mask = (uint8_t)mask;
    vac_fm_start(mask & SV_NEW ? FS_NEW : mask & SV_WASH ? FS_WASHED : FS_BLOWN);
    return 1;
  }
  if (str_starts(c, "maint ")) {
    if (str_eq(a, "brush1") || str_eq(a, "brush2")) vac_ext.brush_base[a[5] - '1'] = vac_cfg.whours[a[5] - '1'];
    else if (str_eq(a, "seals")) vac_ext.seal_base = vac_cfg.pulse_count;
    else if (str_eq(a, "filter")) vac_ext.last_svc_work = vac_cfg.f[vac_cfg.filt].work_s;
    else
      return 1;
    hal_log("Обслуживание отмечено");
    ext_changed();
    ext_send_lines();
    return 1;
  }
  if (str_starts(c, "voice")) {
    /* voice 0…3 | voice vol N | voice test N */
    if (str_starts(a, "vol ") && in(str_to_int(a + 4), 0, 30)) {
      vac_ext.volume = (uint8_t)str_to_int(a + 4);
      if (v_line) dfp(0x06, vac_ext.volume);
    } else if (str_starts(a, "test")) {
      long ph = str_to_int(a + 4);
      if (in(ph, 1, V_COUNT - 1)) {
        uint32_t keep = v_last[ph];
        v_last[ph] = 0;
        int lvl = vac_ext.voice;
        if (!lvl) {
          hal_log("Голос выключен: voice 1…3");
          return 1;
        }
        vac_ext.voice = 3;
        ext_say((int)ph);
        vac_ext.voice = (uint8_t)lvl;
        (void)keep;
      }
      return 1;
    } else if (in(v, 0, 3) && *a)
      vac_ext.voice = (uint8_t)v;
    else
      return 1;
    ext_changed();
    ext_send_lines();
    return 1;
  }
  if (str_starts(c, "scale")) {
    /* scale tare | scale cal 12,5 | scale full 45 | scale bag 15 */
    if (str_eq(a, "tare")) {
      vac_ext.sc_tare = (int32_t)sc_avg;
      hal_log("Весы: ноль — пустой бак");
    } else if (str_starts(a, "cal ")) {
      float kg = str_to_float(a + 4);
      float d = sc_avg - (float)vac_ext.sc_tare;
      if (kg > 0.5f && (d > 50 || d < -50)) {
        vac_ext.sc_k = d / kg;
        hal_log(str_cat(str_cat(line, "Весы откалиброваны: "), fmt_num(n, kg, 1)));
      } else
        hal_log("Весы: сначала «scale tare» с пустым баком, потом груз и «scale cal кг»");
    } else if (str_starts(a, "full ")) vac_ext.sc_full = (uint16_t)(str_to_float(a + 5) * 10);
    else if (str_starts(a, "bag ")) vac_ext.sc_bag = (uint16_t)(str_to_float(a + 4) * 10);
    else {
      char m[64] = "Весы: ";
      hal_log(str_cat(str_cat(str_cat(m, vac.scale_ok ? "сырой " : "нет модуля NAU7802 "), fmt_int(n, sc_raw)), ""));
      return 1;
    }
    ext_changed();
    ext_send_lines();
    return 1;
  }
  if (str_starts(c, "hist ")) {
    long m = str_to_int(a);
    const char *b = a;
    while (*b && *b != ' ') b++;
    send_hist((int)m, (int)str_to_int(b));
    return 1;
  }
  if (str_eq(c, "osc")) {
    if (vac.osc_n) send_osc();
    return 1;
  }
  if (str_eq(c, "report reset")) {
    report_reset();
    ext_send_lines();
    return 1;
  }
  if (str_eq(c, "get ext")) {
    ext_panel = 1;
    ext_send_lines();
    return 1;
  }
  if (str_eq(c, "bb")) {
    char m[80] = "Чёрный ящик: записей ";
    hal_log(str_cat(m, fmt_int(n, (long)hal_bb_count())));
    return 1;
  }
  return 0;
}

/* ---------------- вход ---------------- */

void ext_setup(void) {
  ext_load();
  vac.kg = -1;
  vac.fc_hours = -1;
}

void ext_start(void) {
  uint32_t t;
  vac.rtc_ok = rtc_read(&t) == 0;
  if (vac.rtc_ok) vac.time_s = t;
  vac.scale_ok = scale_init() == 0;
  report_reset();
  voice_line();
  char line[120] = "6.0: часы ";
  str_cat(line, vac.rtc_ok ? "есть" : "нет"), str_cat(line, ", весы "), str_cat(line, vac.scale_ok ? "есть" : "нет");
  str_cat(line, ", голос "), str_cat(line, vac_ext.voice ? "включён (DFPlayer по линии 5 кабеля пульта)" : "выключен");
  hal_log(line);
  ext_event(EV_POWER, 1, 0);
}

static uint32_t t_t, t_hist, t_rtc;
static uint8_t was_sleep;
static uint8_t said_brush;

void ext_loop(uint32_t ms) {
  scale_poll();
  voice_poll();
  /* Пока проверка идёт — экрану её строка каждые 200 мс. */
  if (ext_panel && vac.test_id && ms - t_t >= 200) t_t = ms, send_t();
  if (ext_panel && ms - ext_panel_at > 3000) ext_panel = 0;
  (void)t_hist;
}

void ext_second(void) {
  uint32_t ub = vac_uart_bytes();
  if (ub - ub_last > 16 && !v_blocked) {
    v_blocked = 1;
    if (vac_ext.voice) hal_log("Голос выключен: по линии 5 кабеля пульта говорит пульт отдельной платой");
  }
  ub_last = ub;
  /* Часы: секунда к секунде, с модулем — сверка раз в 10 минут. */
  if (vac.time_s) vac.time_s++;
  if (vac.rtc_ok && vac.uptime_s - t_rtc >= 600) {
    uint32_t t;
    t_rtc = vac.uptime_s;
    if (rtc_read(&t) == 0 && t) vac.time_s = t;
  }
  /* Смена: «Выкл» → включили снова — новый отчёт. */
  if (was_sleep && !vac.sleep) report_reset();
  was_sleep = vac.sleep;
  if (vac.running) {
    rep.run_s++;
    rep.wh += (vac.watts[0] + vac.watts[1]) / 3600.0f;
    if (vac.flow_ls > 1) rep.flow_sum += vac.flow_ls, rep.flow_n++;
  }
  if (vac.tool) rep.tool_s++;
  /* Весы заработали (откалибровали) посреди смены — собранное считаем с этого момента. */
  if (rep.kg0 <= 0 && ext_scale_kg() > 0) rep.kg0 = ext_scale_kg();
  float tm = vac.temp[0] > vac.temp[1] ? vac.temp[0] : vac.temp[1];
  if (vac.running && tm > rep.tmax) rep.tmax = tm;
  /* Мощность турбины на полной (замер ведётся всё время): для паспорта и перегрузки. */
  for (int k = 0; k < 2; k++)
    if (vac.pcmd[k] >= 98 && vac.watts[k] > 200) {
      float r = vac_ext.t_rated[k] ? (float)vac_ext.t_rated[k] : vac.watts[k];
      r += (vac.watts[k] - r) * 0.05f;
      vac_ext.t_rated[k] = (uint16_t)r;
    }
  /* Графики — раз в 5 с, «чёрный ящик» — раз в минуту в работе (иначе — раз в 10 минут). */
  if (vac.uptime_s % 5 == 0 && !vac.sleep) hist_tick();
  if ((vac.running || vac.state == VAC_ACTIVE) ? vac.uptime_s % 60 == 0 : vac.uptime_s % 600 == 0) ext_event(EV_SAMPLE, 0, 0);
  /* Весы: бак тяжёлый, мешок полон. */
  float kg = ext_scale_kg();
  if (kg > 0 && vac_ext.sc_full && kg * 10 > vac_ext.sc_full) {
    if (!sc_heavy) sc_heavy = 1, ext_say(V_HEAVY), hal_log("! Бак тяжёлый — опорожните");
  } else if (kg >= 0 && kg * 10 < vac_ext.sc_full * 0.9f)
    sc_heavy = 0;
  if (kg > 0 && vac_cfg.bag && vac_ext.sc_bag && kg * 10 > vac_ext.sc_bag) {
    if (!sc_bagfull) sc_bagfull = 1, ext_say(V_BAG_FULL), hal_log("! Мешок полон (по весу)");
  } else if (kg >= 0 && kg * 10 < vac_ext.sc_bag * 0.9f)
    sc_bagfull = 0;
  /* Щётки: ресурс выработан — раз за включение. */
  for (int k = 0; k < 2; k++)
    if (!said_brush && vac_cfg.brush_h && (vac_cfg.whours[k] - vac_ext.brush_base[k]) / 3600 >= vac_cfg.brush_h) said_brush = 1, ext_say(V_BRUSHES);
  if (ext_panel && vac.uptime_s % 10 == 0) send_m(), send_r();
  if (ext_dirty && !vac.running && vac.uptime_s % 30 == 0) ext_save();
}
