/*
 * Ядро прошивки: синхронизация с сетью, модули реле и регуляторы МР248 (ШИМ) турбин с плавным
 * и поочерёдным пуском, проверка симисторов и реле по току, регулятор расхода (ПИ, вторая
 * турбина — по потребности), очистка фильтра ударами клапанов через SSR в нуле сети (оба разом,
 * режимы и «Авто», мощная очистка при закрытом шланге, удары при остановке и после
 * инструмента), паспорт фильтров А и Б, розетка инструмента (автозапуск, предел тока),
 * электроды и поплавок бака, журнал наработки, измерения и защиты.
 * Не зависит от Arduino: железо — через vac_hal.h.
 */
#include "vac_core.h"

vac_settings_t vac_cfg;
vac_state_t vac;

/* Трансформаторы тока SCT-013 с нагрузкой внутри: турбины — 020 (1 В на 20 А), инструмент — 030 (1 В на 30 А). */
static const float CT_MV_PER_A[3] = {50.0f, 50.0f, 1000.0f / 30.0f};
static const int CT_PIN[3] = {PIN_CT1, PIN_CT2, PIN_CT3};
/* Детектор нуля: порог = Uбэ·(47к + 10к)/10к, выпрямитель −1,4 В, трансформатор 230/9 В, на холостом ходу +15 %. */
#define ZC_VTH 3.705f
#define ZC_KTR (230.0f / (9.0f * 1.41421356f * 1.15f))
/* Раскачка электродов: полупериод в тактах по 100 мкс (600 мкс — 833 Гц). */
#define WL_HALF 6
/* Электроника, модули и клапаны в общем токе, А. */
#define SELF_AMPS 0.4f


/* ---------------- синхронизация, импульсы, раскачка (прерывания) ---------------- */

static volatile uint32_t zc_rise, zc_count;
static volatile uint32_t zc_width = 1800;   /* ширина импульса нуля, мкс */
static volatile uint32_t zc_half = 10000;   /* полупериод, мкс */
static volatile uint8_t tick_div, wl_div, wl_lvl;
static volatile uint32_t wl_edge, wl_phase;
/*
 * Клапаны: SSR G3MB включается и выключается в нуле сети, поэтому удар — целое число
 * полупериодов. Вход SSR подаём заранее (до нуля), снимаем за 1 мс до нуля, на котором удар
 * должен кончиться: открыт ровно vlv_n полупериодов, считая от первого нуля.
 */
static volatile uint8_t vlv_req, vlv_on;    /* маска: удар заказан; вход SSR подан */
static volatile uint16_t vlv_ms;            /* длина удара, мс */
static volatile uint32_t vlv_off_at;
/* Без таблицы: её константы ушли бы во флеш, а код в прерывании должен работать и во время записи во флеш. */
#define VLV_PIN(ch) ((ch) ? PIN_VLV2 : PIN_VLV1)

VAC_ISR void vac_on_pin(int pin, int level, uint32_t us) {
  if (pin != PIN_ZC) return;
  if (level) {
    /* Начало импульса: до перехода через ноль — половина его ширины. */
    uint32_t per = us - zc_rise;
    zc_rise = us;
    if (per > 7000 && per < 12500) zc_half = (zc_half * 7 + per) / 8;
    zc_count++;
  } else {
    uint32_t w = us - zc_rise;
    if (w > 100 && w < 5000) zc_width = (zc_width * 3 + w) / 4;
  }
}

VAC_ISR void vac_tick(void) {
  uint32_t now = hal_micros();
  if (vlv_req) {
    /* Ближайший ноль, до которого ещё не меньше 0,3 мс, — с него SSR откроется. */
    uint32_t half = zc_half, z = zc_rise + zc_width / 2;
    for (int i = 0; i < 4 && (int32_t)(z - now) < 300; i++) z += half;
    uint32_t n = (vlv_ms * 1000u + half / 2) / half;
    if (n < 1) n = 1;
    vlv_off_at = z + n * half - 1000;
    for (int ch = 0; ch < 2; ch++)
      if (vlv_req & (1 << ch)) hal_pin_write(VLV_PIN(ch), 1);
    vlv_on = vlv_req;
    vlv_req = 0;
  } else if (vlv_on && (int32_t)(now - vlv_off_at) >= 0) {
    for (int ch = 0; ch < 2; ch++) hal_pin_write(VLV_PIN(ch), 0);
    vlv_on = 0;
  }
  /* Электроды: переменный ток через воду (конденсатор 1 мкФ не пропускает постоянный — нет электролиза). */
  if (++wl_div >= WL_HALF) {
    wl_div = 0;
    wl_lvl ^= 1;
    hal_pin_write(PIN_WL_DRV, wl_lvl);
    wl_edge = now;
    wl_phase++;
  }
  if (++tick_div >= 10) {
    tick_div = 0;
    link_encoder_poll();
  }
}


/* ---------------- настройки ---------------- */

#define CFG_MAGIC 0x5653
#define CFG_VERSION 4

/* CRC-16/CCITT по всему, что до поля crc. */
static uint16_t cfg_crc(const vac_settings_t *s) {
  const uint8_t *p = (const uint8_t *)s;
  unsigned n = (unsigned)((const uint8_t *)&s->crc - p);
  uint16_t c = 0xFFFF;
  for (unsigned i = 0; i < n; i++) {
    c ^= (uint16_t)(p[i] << 8);
    for (int b = 0; b < 8; b++) c = (uint16_t)(c & 0x8000 ? (c << 1) ^ 0x1021 : c << 1);
  }
  return c;
}

/* Режимы очистки по умолчанию: уставка, ударов, промежуток, удар, пауза, флаги. */
static const vac_preset_t PRESET_DEF[N_PRESETS] = {
    {32, 0, 0, 0, 0, PF_HOSE, 0},      /* Авто: всё подбирает сам */
    {36, 3, 15, 40, 300, PF_HOSE, 0},  /* Бетон, штроба: как у Hilti — три удара по 40 мс через 0,3 с */
    {30, 1, 30, 40, 0, 0, 0},          /* Бурение с присоской: реже, по закрытому шлангу — нет */
    {32, 2, 20, 50, 0, PF_HOSE, 0},    /* Гипс, шпаклёвка: липкая пыль */
    {28, 1, 60, 40, 0, PF_HOSE, 0},    /* Уборка */
    {30, 2, 30, 40, 0, PF_HOSE, 0},    /* Мешок */
    {30, 0, 0, 0, 0, PF_NOCLEAN, 0},   /* Вода: мокрый фильтр ударами не отбить */
};

static void cfg_defaults(void) {
  vac_settings_t d = {0};
  d.magic = CFG_MAGIC;
  d.version = CFG_VERSION;
  d.mode = VAC_AUTO;
  d.power = 80;
  d.t2 = 1;
  d.softstart = 20;
  d.clean_off = 1;
  d.preset = PR_AUTO;
  d.clean_auto = 1;
  d.hose_auto = 1;
  d.strong_n = 4;
  d.thr = 115;
  for (int i = 0; i < N_PRESETS; i++) d.pr[i] = PRESET_DEF[i];
  d.min_speed = 12;
  d.hose_mm = 36;
  d.mains_cal = 1000;
  d.flow_k10 = 216;
  d.brush_h = 800;
  d.wl_mv = 300;
  d.stagger_ms = 1500;
  d.tool_auto = 1;
  d.tool_thr = 3;
  d.tool_runon = 4;
  d.tool_end = 3;
  d.limit_a = 24;
  d.tool_delay = 500;
  d.dev_id = (uint16_t)(hal_rand32() & 0xFFFF);
  vac_cfg = d;
}

/* Настройки прошивки 3.x (одна копия) — только для переноса. */
typedef struct {
  uint16_t magic;
  uint8_t version, mode, sp, power, t2, softstart, clean_auto, clean_off, pulses, preset;
  uint16_t imp_ms, pause_ms, thr, boost_ms, period, tap_s;
  uint8_t psp[4];
  uint16_t pper[4], ptap[4];
  uint8_t min_speed, hose_mm;
  int16_t zc_shift_us;
  uint16_t mains_cal, flow_k10, brush_h, wl_mv, stagger_ms;
  float r_new;
  uint32_t pulse_count, hours[2], whours[2];
  uint16_t rhist[30];
  uint8_t nrh, remote_on;
  uint32_t remote_id;
  uint8_t remote_key[16];
  uint32_t remote_ctr;
  uint8_t crc;
} cfg_v3_t;

static int migrate_v3(void) {
  cfg_v3_t o;
  if (hal_settings_load(&o, sizeof o) != (int)sizeof o || o.magic != CFG_MAGIC || o.version != 3) return 0;
  const uint8_t *p = (const uint8_t *)&o;
  unsigned n = (unsigned)((const uint8_t *)&o.crc - p);
  uint8_t c = 0x5A;
  for (unsigned i = 0; i < n; i++) c = (uint8_t)((c << 1 | c >> 7) ^ p[i]);
  if (c != o.crc) return 0;
  cfg_defaults();
  vac_cfg.mode = o.mode;
  vac_cfg.power = o.power;
  vac_cfg.t2 = o.t2;
  vac_cfg.softstart = o.softstart;
  vac_cfg.clean_off = o.clean_off;
  vac_cfg.clean_auto = o.clean_auto;
  /* Старые пресеты «бетон, бурение, гипс, уборка» — их уставки расхода. */
  for (int i = 0; i < 4; i++)
    if (o.psp[i] >= 10 && o.psp[i] <= 60) vac_cfg.pr[PR_CONCRETE + i].sp = o.psp[i];
  if (o.sp >= 10 && o.sp <= 60) vac_cfg.pr[PR_AUTO].sp = o.sp;
  vac_cfg.min_speed = o.min_speed;
  vac_cfg.hose_mm = o.hose_mm;
  vac_cfg.zc_shift_us = o.zc_shift_us;
  vac_cfg.mains_cal = o.mains_cal;
  vac_cfg.flow_k10 = o.flow_k10;
  vac_cfg.brush_h = o.brush_h;
  vac_cfg.wl_mv = o.wl_mv;
  vac_cfg.stagger_ms = o.stagger_ms;
  vac_cfg.f[0].r_new = vac_cfg.f[0].r_base = o.r_new;
  if (o.r_new > 0) vac_cfg.f[0].state = FS_NEW;
  vac_cfg.pulse_count = o.pulse_count;
  for (int k = 0; k < 2; k++) vac_cfg.hours[k] = o.hours[k], vac_cfg.whours[k] = o.whours[k];
  for (int i = 0; i < 30 && i < N_RHIST; i++) vac_cfg.rhist[i] = o.rhist[i];
  vac_cfg.nrh = o.nrh;
  if (o.remote_on) {
    vac_ble_t *b = &vac_cfg.ble[0];
    b->kind = BLE_REMOTE;
    b->num = 1;
    b->id = o.remote_id;
    for (int i = 0; i < 16; i++) b->key[i] = o.remote_key[i];
    b->ctr = o.remote_ctr;
  }
  return 1;
}

static int cfg_valid(const vac_settings_t *s) { return s->magic == CFG_MAGIC && s->version == CFG_VERSION && s->crc == cfg_crc(s); }

/* Из двух копий — целая и более новая; нет ни одной — перенос с 3.x или заводские. */
static void cfg_load(void) {
  static vac_settings_t a, b;
  int ra = hal_settings_load2(0, &a, sizeof a) == (int)sizeof a && cfg_valid(&a);
  int rb = hal_settings_load2(1, &b, sizeof b) == (int)sizeof b && cfg_valid(&b);
  if (ra && (!rb || (int32_t)(a.seq - b.seq) > 0)) vac_cfg = a;
  else if (rb) vac_cfg = b;
  else if (migrate_v3()) hal_log("Настройки перенесены с прошивки 3.x");
  else cfg_defaults();
  if (vac_cfg.preset >= N_PRESETS) vac_cfg.preset = PR_AUTO;
  if (vac_cfg.filt >= N_FILTERS) vac_cfg.filt = 0;
}

void vac_save_settings(void) {
  vac_cfg.seq++;
  vac_cfg.crc = cfg_crc(&vac_cfg);
  hal_settings_save2((int)(vac_cfg.seq & 1), &vac_cfg, sizeof vac_cfg);
}

/* Отложенная запись: энкодер крутят быстро, а флеш-память любит редкие записи. */
static uint32_t now_ms, save_at;
void vac_save_soon(void) {
  save_at = now_ms + 2000;
  if (!save_at) save_at = 1;
}
uint32_t vac_now_ms(void) { return now_ms; }

#define SP (vac_cfg.pr[vac_cfg.preset].sp)
#define PRESET (vac_cfg.pr[vac_cfg.preset])
#define FILT (vac_cfg.f[vac_cfg.filt])

/* Резервная копия: настройки шестнадцатеричной строкой. */
int vac_cfg_export(char *out, int len) {
  static const char H[] = "0123456789abcdef";
  vac_cfg.crc = cfg_crc(&vac_cfg);
  const uint8_t *p = (const uint8_t *)&vac_cfg;
  int n = (int)sizeof vac_cfg;
  if (len < n * 2 + 1) return 0;
  for (int i = 0; i < n; i++) out[2 * i] = H[p[i] >> 4], out[2 * i + 1] = H[p[i] & 15];
  out[2 * n] = 0;
  return 2 * n;
}

static int hexv(char c) { return c >= '0' && c <= '9' ? c - '0' : c >= 'a' && c <= 'f' ? c - 'a' + 10 : c >= 'A' && c <= 'F' ? c - 'A' + 10 : -1; }

int vac_cfg_import(const char *hex) {
  static vac_settings_t s;
  uint8_t *p = (uint8_t *)&s;
  for (int i = 0; i < (int)sizeof s; i++) {
    int hi = hexv(hex[2 * i]), lo = hi < 0 ? -1 : hexv(hex[2 * i + 1]);
    if (hi < 0 || lo < 0) return 1;
    p[i] = (uint8_t)(hi << 4 | lo);
  }
  if (!cfg_valid(&s)) return 2;
  uint32_t seq = vac_cfg.seq;
  vac_cfg = s;
  vac_cfg.seq = seq;
  vac_save_settings();
  hal_log("Настройки восстановлены из резервной копии");
  return 0;
}

/* ---------------- измерения ---------------- */

/* Токи: выборки без привязки к сети (шаг 1037 мкс), СКЗ за 200 мс; пики — для проверок реле. */
static uint32_t next_sample;
static float ct_offset[3] = {1650, 1650, 1650};
static float ct_sum2[3], ct_peak[3];
static uint32_t ct_n;

static void sample_currents(uint32_t us) {
  if ((int32_t)(us - next_sample) < 0) return;
  next_sample += 1037;
  if ((int32_t)(us - next_sample) > 5000) next_sample = us + 1037;
  for (int i = 0; i < 3; i++) {
    float mv = (float)hal_adc_mv(CT_PIN[i]);
    ct_offset[i] += (mv - ct_offset[i]) * (1.0f / 256);
    float d = mv - ct_offset[i];
    ct_sum2[i] += d * d;
    float a = d < 0 ? -d : d;
    if (a > ct_peak[i]) ct_peak[i] = a;
  }
  ct_n++;
}

/* Пик тока с последнего сброса, А (СКЗ синусоиды с таким пиком). */
static float peak_amps(int i) { return ct_peak[i] > 12 ? ct_peak[i] / CT_MV_PER_A[i] / 1.41421356f : 0; }

static float ntc_temp(int mv, int *bad) {
  /* 3,3 В — 10 кОм — вход — NTC 10 кОм (B = 3950) — земля. */
  if (mv > 3150 || mv < 25) {
    *bad = 1;
    return 0;
  }
  *bad = 0;
  float r = 10000.0f * (float)mv / (3300.0f - (float)mv);
  float inv = 1.0f / 298.15f + v_logf(r / 10000.0f) / 3950.0f;
  return 1.0f / inv - 273.15f;
}

/* Разрежение: MPX5100DP, Uвых = 5 В·(0,009·P + 0,04), делитель 10/(6,8+10); без сглаживания. */
static float vacuum_raw(int *bad) {
  int mv = hal_adc_mv(PIN_VAC);
  float vout = (float)mv / 1000.0f * (16.8f / 10.0f);
  if (bad) *bad = vout < 0.05f;
  float kpa = (vout / 5.0f - 0.04f) / 0.009f;
  return kpa < 0 ? 0 : kpa;
}

/* ---------------- состояние управления ---------------- */

static uint32_t last_zc_ms, seen_zc;
static int zc_ok;
static uint32_t ts_t[2];         /* время входа в состояние реле/симистора */
static uint32_t on_since[2];     /* когда турбина пошла в работу (для поочерёдного пуска) */
static uint32_t lock_until[2];
static uint8_t cnt_over[2], cnt_nocur[2];
static uint32_t lowair_since, blocked_since, run_since, torn_since, stop_ms;
static uint32_t hours_dirty_ms;
static int sdp_err[2];
static uint32_t worked_ms;       /* сколько работали с последнего пуска */
static float wacc[2];            /* доли приведённой секунды */
static int shift_logged;         /* в этой смене уже есть точка R в журнале */
static uint32_t pulse_quiet_until; /* после удара поток не устоялся — R не меряем */

/* Регулятор расхода: u — суммарная мощность в % одной турбины (до 200 с двумя).
 * Коэффициенты: % на л/с и % на л/с за секунду. */
#define KP 2.0f
#define KI 1.6f
static float u_pid = 60, e_prev;
static int pwm_sent[2] = {-1, -1};
static uint32_t dual_since, single_since;
static float q_single;           /* сколько дала одна турбина на полной мощности, л/с */
static uint32_t start_ms;
static int spin_prev;

/* Очистка: этапы. */
enum { PH_HOSE, PH_SPIN, PH_OPEN, PH_PAUSE, PH_MEASURE, PH_SETTLE };
static int ph, purge_spin, pulse_i, pulses_now, after_purge;
/* Ударов по одному клапану в этой серии (проверка): они не в счёт ударов серии. */
static int diag_n;
static uint8_t spin_mask;        /* какие турбины крутятся во время очистки */
static uint8_t pulse_mask;       /* клапаны этого удара (биты): 3 — оба, 1 или 2 — проверка по одному */
static uint32_t ph_t, pulse_t, purge_t0, last_series_ms, series_s;
static float rec_target;         /* пауза: ждём, пока разрежение вернётся к этому, кПа */
static float r_prev_pulse;       /* «Авто»: R перед этим ударом серии */
static float strong_peak;        /* мощная: наибольшее разрежение при закрытом шланге */
static uint32_t hose_since, hose_open_since, block_allow_at;
static uint8_t hose_need_open;   /* после мощной очистки — ждём, пока шланг откроют */
static uint8_t diag_req, diag_bad_dp;
static float diag_depth[2];
static uint32_t diag_pulses = 60; /* ударов после последней проверки по одному (первая серия — с проверкой) */
enum { AFTER_NONE, AFTER_STOP, AFTER_SLEEP };

/* Удар: быстрые отсчёты (каждые 2 мс, пока открыто и 0,15 с после). */
static uint32_t watch_until, fast_us;
static float pa_before, pa_min, pc_before, pc_min;
static int t_front, fast_n;
static uint8_t valve_bad_dp;     /* ударов подряд без броска перепада */
/* «Авто»: подбор удара и паузы, оценка пыли. */
static uint16_t imp_auto = 40;
static float r_ref;              /* R, от которого считается рост до серии */
static float r_grow;             /* рост R за секунду (сглаженный) */
static float n_auto = 2;         /* ударов, которые помогали в последних сериях */
static uint8_t stuck_n;          /* серий подряд, которые почти не помогли */
static uint32_t push_at;         /* «Авто»: R после серии выше нормы, а удары помогают — следующая серия скоро */
static uint8_t pushed;           /* эта серия — добивающая: по ней рост R не считаем */
static uint8_t weak_in, strong_in; /* удары серии без обратного потока и с ним */
static uint8_t weak_n;           /* серий подряд со слабыми ударами */
static float band_k = 1;         /* «Авто»: доля порога роста R; фильтр не удаётся вернуть к норме — бьём чаще */
static float depth_ema;          /* провал разрежения при ударе (фильтр клапанов) */
/* Розетка и инструмент. */
static uint32_t tool_on_since, tool_low_since, tool_start_at, runon_until, sock_check_until;
static uint8_t sock_lock;
static float ov_tot[15], ov_tl[15];
static int ov_n, ov_i;
/* Замер фильтра. */
static uint8_t fm_kind, fm_filt, fm_started;
static uint32_t fm_t0;
static float fm_sum, fm_prev_base;
static int fm_cnt;
static uint32_t wifi_until;

static int is_warning(uint32_t bit) {
  return !!(bit & (F_LOWAIR | F_BLOCKED | F_FILTER | F_MAINS | F_WARM1 | F_WARM2 | F_NTC1 | F_NTC2 | F_VALVE1 | F_VALVE2 | F_PROBE | F_EXP | F_SDP_F | F_SDP_Q | F_VAC | F_INTAKE | F_STUCK | F_WEAK));
}

static void set_fault(uint32_t bit, int on) {
  if (on && !(vac.faults & bit)) {
    vac.faults |= bit;
    char line[96] = "! ";
    str_cat(line, vac_fault_text(bit));
    hal_log(line);
    vac_beep(is_warning(bit) ? 2 : 3);
  } else if (!on && (vac.faults & bit)) {
    vac.faults &= ~bit;
    char line[96] = "  снято: ";
    str_cat(line, vac_fault_text(bit));
    hal_log(line);
  }
}

const char *vac_fault_text(uint32_t bit) {
  switch (bit) {
  case F_NO_ZC: return "Нет синхронизации с сетью";
  case F_HOT1: return "Перегрев турбины 1";
  case F_HOT2: return "Перегрев турбины 2";
  case F_WARM1: return "Турбина 1 горячая";
  case F_WARM2: return "Турбина 2 горячая";
  case F_NTC1: return "Датчик темп. 1";
  case F_NTC2: return "Датчик темп. 2";
  case F_OVER1: return "Перегрузка турбины 1";
  case F_OVER2: return "Перегрузка турбины 2";
  case F_NOCUR1: return "Нет тока турбины 1";
  case F_NOCUR2: return "Нет тока турбины 2";
  case F_LEAK1: return "Пробит симистор 1 (реле разомкнуто)";
  case F_LEAK2: return "Пробит симистор 2 (реле разомкнуто)";
  case F_LOWAIR: return "Мало воздуха";
  case F_BLOCKED: return "Шланг/вход забит";
  case F_FILTER: return "Фильтр: пора мыть";
  case F_MAINS: return "Напряжение сети";
  case F_SDP_F: return "Нет датчика фильтра";
  case F_SDP_Q: return "Нет расходомера";
  case F_VAC: return "Датчик разрежения";
  case F_WATER: return "Бак полон";
  case F_OVERFLOW: return "Перелив! Аварийный стоп";
  case F_WELD1: return "Реле 1 сварилось — выключите сеть";
  case F_WELD2: return "Реле 2 сварилось — выключите сеть";
  case F_VALVE1: return "Клапан 1 неисправен";
  case F_VALVE2: return "Клапан 2 неисправен";
  case F_TORN: return "Фильтр порван или не стоит";
  case F_EXP: return "Нет связи с кнопками";
  case F_PROBE: return "Электроды: проверьте";
  case F_INTAKE: return "Проверьте фильтр клапанов";
  case F_STUCK: return "Фильтр не отбивается";
  case F_WEAK: return "Удар слабый: шланг широкий";
  }
  return "?";
}

static const char *verr_text(int e) {
  switch (e) {
  case VE_STUCK: return "не открывается (заклинил, нет напряжения, обрыв катушки или SSR)";
  }
  return "";
}

static void valve_fault(int k, int err) {
  uint32_t bit = k ? F_VALVE2 : F_VALVE1;
  if (err && vac.verr[k] != err) {
    vac.verr[k] = (uint8_t)err;
    char line[160] = "  клапан ";
    str_cat(line, k ? "2: " : "1: ");
    hal_log(str_cat(line, verr_text(err)));
  }
  if (!err) vac.verr[k] = VE_OK;
  set_fault(bit, !!err);
}

/* ---------------- звук и светодиод ---------------- */

/* Пары «частота, длительность мс»; 0 Гц — пауза, BEEP_END — конец. */
#define BEEP_END 0xFFFF
static const uint16_t BEEP_CLICK[] = {2700, 15, BEEP_END};
static const uint16_t BEEP_OK[] = {2000, 60, 0, 40, 2700, 80, BEEP_END};
static const uint16_t BEEP_WARN[] = {1500, 250, BEEP_END};
static const uint16_t BEEP_ALARM[] = {3000, 150, 0, 100, 3000, 150, 0, 100, 3000, 300, BEEP_END};
static const uint16_t *beep_seq;
static int beep_i;
static uint32_t beep_next;

void vac_beep(int kind) {
  const uint16_t *s = kind == 0 ? BEEP_CLICK : kind == 1 ? BEEP_OK : kind == 2 ? BEEP_WARN : BEEP_ALARM;
  if (beep_seq == BEEP_ALARM && kind < 3) return;
  beep_seq = s;
  beep_i = 0;
  beep_next = now_ms;
}

static void beep_poll(void) {
  if (!beep_seq || (int32_t)(now_ms - beep_next) < 0) return;
  uint16_t hz = beep_seq[beep_i];
  if (hz == BEEP_END) {
    hal_tone(PIN_BUZZER, 0);
    beep_seq = 0;
    return;
  }
  hal_tone(PIN_BUZZER, hz);
  beep_next = now_ms + beep_seq[beep_i + 1];
  beep_i += 2;
}

static uint16_t exp_out = EXP_LCD_RST | EXP_LED, exp_sent = 0xFFFF;

/* Светодиод — на выходе P13 расширителя (горит при «0»); пишем только изменения. */
static void led(void) {
  uint32_t t = now_ms;
  int on;
  if (vac.faults & ~(uint32_t)(F_LOWAIR | F_FILTER | F_WARM1 | F_WARM2)) on = (t / 100) & 1;  /* неисправность — часто */
  else if (vac.sleep) on = t % 5000 < 40;                                                     /* сон — вспышка раз в 5 с */
  else if (vac.running) on = 1;
  else on = t % 2000 < 100;                                                                   /* готов — раз в 2 с */
  exp_out = (uint16_t)(on ? exp_out & ~EXP_LED : exp_out | EXP_LED);
  if (exp_out != exp_sent && exp_write(exp_out) == 0) exp_sent = exp_out;
}

/* ---------------- команды ---------------- */

static const char *mode_name(int m) { return m == VAC_AUTO ? "авто (расход)" : "ручной"; }
static const char *const PRESET_NAME[N_PRESETS] = {"авто", "бетон, штроба", "бурение", "гипс", "уборка", "мешок", "вода"};

static int blocked_by_fault(void) { return !!(vac.faults & (F_WATER | F_OVERFLOW | F_TORN | F_WELD1 | F_WELD2)); }

static void sync_state(void) { vac.state = !vac.sleep && (vac.en[0] || vac.en[1]) ? VAC_ACTIVE : VAC_STANDBY; }

static void purge_finish(const char *why) {
  vac.purging = PURGE_NONE;
  vac.pulse_no = 0;
  vac.valve[0] = vac.valve[1] = 0;
  vac.hose_wait = 0;
  purge_spin = 0;
  vac.shutdown = 0;
  hal_log(why);
  int after = after_purge;
  after_purge = AFTER_NONE;
  if (after == AFTER_SLEEP) vac_power_off(1);
}

/* Длина удара: мощная — не короче 60 мс; режим задал — его; иначе — подобранная. */
static uint16_t imp_for(int kind) {
  if (kind == PURGE_STRONG) return imp_auto > 60 ? imp_auto : 60;
  if (kind == PURGE_SERIES && PRESET.imp) return PRESET.imp;
  return imp_auto;
}

/* n — ударов (0 — «Авто»: пока удар ещё сбрасывает сопротивление, не больше 4). */
static void purge_begin(int kind, int after, int n) {
  vac.purging = (uint8_t)kind;
  after_purge = after;
  pulses_now = n;
  pulse_i = 0;
  diag_n = 0;
  weak_in = strong_in = 0;
  purge_t0 = ph_t = now_ms;
  vac.pulse_no = 0;
  vac.imp_now = imp_for(kind);
  spin_mask = (uint8_t)((vac.pcmd[0] > 0 || vac.en[0] ? 1 : 0) | (vac.pcmd[1] > 0 || vac.en[1] ? 2 : 0));
  if (!spin_mask) spin_mask = (uint8_t)(1 | (vac_cfg.t2 ? 2 : 0));
  purge_spin = 1;
  vac.r_before = vac.r_now;
  r_prev_pulse = vac.r_now;
  rec_target = 0;
  /* Проверка клапанов по одному — в первой серии после включения и потом раз в 60 ударов. */
  if (kind != PURGE_STRONG && diag_pulses >= 60) diag_req = 1;
  if (kind == PURGE_STRONG) {
    strong_peak = vac.vacuum_kpa;
    ph = vac.running && vac.hose_closed ? PH_PAUSE : PH_HOSE;
    vac.hose_wait = ph == PH_HOSE;
  } else
    ph = vac.running ? PH_PAUSE : PH_SPIN;
}

/* Остановка: после работы — сначала n ударов (турбины ещё крутятся), потом стоп. */
static void stop_all(int after, int n, uint32_t min_work) {
  int clean = n > 0 && vac.running && worked_ms > min_work && zc_ok && !blocked_by_fault() && vac.purging != PURGE_OFF && !(PRESET.flags & PF_NOCLEAN);
  vac.en[0] = vac.en[1] = 0;
  vac.auto_started = 0;
  runon_until = 0;
  tool_start_at = 0;
  vac.cap = 0;
  sync_state();
  if (clean) {
    if (vac.purging) purge_finish("Очистка прервана: очистка перед остановкой");
    purge_begin(PURGE_OFF, after, n);
    vac.shutdown = 1;
    hal_log("Очистка фильтра перед остановкой");
    return;
  }
  if (after == AFTER_SLEEP) vac_power_off(1);
}

void vac_turbine(int k, int on) {
  if (vac.sleep) vac_wake();
  vac.auto_started = 0;
  runon_until = 0;
  if (on && vac.purging == PURGE_OFF) {
    after_purge = AFTER_NONE;
    purge_finish("Очистка перед остановкой прервана: пуск");
  }
  if (on && blocked_by_fault()) {
    hal_log("Пуск запрещён: сначала устраните аварию");
    vac_beep(2);
    return;
  }
  int n_off = vac_cfg.clean_off ? vac_cfg.tool_end : 0;
  if (k < 0) {
    if (on) {
      vac.en[0] = 1;
      vac.en[1] = vac_cfg.t2;
    } else {
      stop_all(AFTER_STOP, n_off, 30000);
      vac_beep(0);
      return;
    }
  } else {
    if (!on && vac.en[k] && !vac.en[k ^ 1]) {
      stop_all(AFTER_STOP, n_off, 30000);
      hal_log(k ? "Турбина 2: стоп" : "Турбина 1: стоп");
      vac_beep(0);
      return;
    }
    vac.en[k] = (uint8_t)on;
  }
  sync_state();
  char line[64] = "";
  if (k < 0) str_cat(line, vac.mode == VAC_AUTO ? "Пуск: авто по расходу" : "Пуск: ручной");
  else str_cat(line, k ? (on ? "Турбина 2: пуск" : "Турбина 2: стоп") : (on ? "Турбина 1: пуск" : "Турбина 1: стоп"));
  hal_log(line);
  vac_beep(on ? 1 : 0);
}

void vac_start_stop(void) {
  if (vac.state == VAC_ACTIVE) vac_turbine(-1, 0);
  else vac_turbine(-1, 1);
}

void vac_set_mode(int m) {
  if (m != VAC_AUTO && m != VAC_MANUAL) return;
  if (m == vac.mode) return;
  vac.mode = (uint8_t)m;
  vac_cfg.mode = (uint8_t)m;
  vac_save_soon();
  char line[48] = "Режим: ";
  hal_log(str_cat(line, mode_name(m)));
  vac_beep(0);
}

void vac_power_off(int now) {
  if (vac.sleep) return;
  if (!now && vac.purging == PURGE_OFF) {
    after_purge = AFTER_SLEEP;
    return;
  }
  if (!now && vac.running) {
    /* Очистка перед сном — или сразу сон (stop_all сам вызовет vac_power_off(1)). */
    stop_all(AFTER_SLEEP, vac_cfg.clean_off ? vac_cfg.tool_end : 0, 30000);
    return;
  }
  if (vac.purging) {
    after_purge = AFTER_NONE;
    purge_finish("Очистка прервана: выключение");
  }
  vac.en[0] = vac.en[1] = 0;
  vac.auto_started = 0;
  vac.sleep = 1;
  vac.pairing = 0;
  vac.cap = 0;
  sync_state();
  hal_log("Выключено: турбины стоят, реле разомкнуты, экран погашен. Проснуться — любая кнопка");
  link_send("P off");
  vac_save_soon();
}

void vac_wake(void) {
  if (!vac.sleep) return;
  vac.sleep = 0;
  sync_state();
  hal_log("Включено");
  link_send("P on");
  vac_beep(1);
}

void vac_purge_now(int kind) {
  if (vac.purging && vac.purging != PURGE_OFF) {
    /* Повторная команда — отмена. */
    after_purge = AFTER_NONE;
    purge_finish(vac.purging == PURGE_STRONG ? "Мощная очистка отменена" : "Продувка отменена");
    vac_beep(0);
    return;
  }
  if (!zc_ok) {
    hal_log("Продувка невозможна: нет сети");
    return;
  }
  if (vac.faults & (F_WATER | F_OVERFLOW)) {
    hal_log("Продувка невозможна: бак полон");
    vac_beep(2);
    return;
  }
  if (vac.purging == PURGE_OFF) purge_finish("Очистка перед остановкой прервана");
  if (kind == PURGE_STRONG) {
    purge_begin(PURGE_STRONG, AFTER_NONE, vac_cfg.strong_n);
    hal_log(vac.hose_wait ? "Мощная очистка: закройте шланг ладонью" : "Мощная очистка: шланг закрыт — бью");
  } else {
    purge_begin(PURGE_SERIES, AFTER_NONE, PRESET.n);
    hal_log(vac.running ? "Продувка: серия ударов" : "Продувка: разгон турбин");
  }
  vac_beep(0);
}

/* Точка R в журнал смен: первая продувка смены — новая точка, дальше — обновляем её. */
static void rhist_put(float r) {
  uint16_t v = (uint16_t)(r * 10 + 0.5f);
  if (!shift_logged || !vac_cfg.nrh) {
    if (vac_cfg.nrh == N_RHIST) {
      for (int i = 1; i < N_RHIST; i++) vac_cfg.rhist[i - 1] = vac_cfg.rhist[i];
      vac_cfg.nrh--;
    }
    vac_cfg.rhist[vac_cfg.nrh++] = v;
    shift_logged = 1;
  } else
    vac_cfg.rhist[vac_cfg.nrh - 1] = v;
}

/* R, с которым сравнивать фильтр: после установки, с мешком — вместе с мешком. */
static float r_clean(void) { return FILT.r_base > 0 ? FILT.r_base + (vac_cfg.bag ? vac_cfg.r_bag : 0) : 0; }

/*
 * Порог по перепаду: перепад на фильтре растёт с расходом как Q², поэтому порог и «чистый»
 * перепад — при расходе уставки (Δp = R·Q²/100): сравнение не зависит от шланга и мощности.
 */
static float sp_ls(void) { return PRESET.sp ? (float)PRESET.sp : 32.0f; }
static float r_of_dp(float pa) { return pa * 100.0f / (sp_ls() * sp_ls()); }
static float dp_of_r(float r) { return r * sp_ls() * sp_ls() / 100.0f; }
/* Перепад чистого фильтра (паспорт: новый, отмытый) при расходе уставки, Па; 0 — не мерили. */
float vac_dp_clean(void) { return dp_of_r(FILT.r_new > 0 ? FILT.r_new : r_clean()); }

/* Промежуток «Авто»: за сколько R вырастет на порог при нынешнем росте (8…90 с). */
static void auto_plan(void) {
  float band = (float)(vac_cfg.thr > 100 ? vac_cfg.thr - 100 : 15) / 100.0f * band_k;
  float every = r_grow > 1e-6f && r_ref > 0 ? r_ref * band / r_grow : 90;
  vac.every_now = (uint16_t)(PRESET.every ? PRESET.every : every < 8 ? 8 : every > 90 ? 90 : every);
  vac.n_now = (uint8_t)(PRESET.n ? PRESET.n : (int)(n_auto + 0.5f) < 1 ? 1 : (int)(n_auto + 0.5f));
  if (!vac.purging) vac.imp_now = PRESET.imp ? PRESET.imp : imp_auto;
  if (r_ref > 0 && r_grow > 0) {
    float pct_min = r_grow * 60.0f / r_ref * 100.0f;
    vac.dust_lvl = pct_min < 5 ? 1 : pct_min < 20 ? 2 : 3;
  }
}

/* Конец серии (и мощной очистки): R после ударов, рост R, оценка пыли, паспорт фильтра. */
static void series_done(void) {
  vac.purges++;
  uint32_t dt = now_ms - last_series_ms;
  int strong = vac.purging == PURGE_STRONG;
  last_series_ms = now_ms;
  series_s = 0;
  int measured = vac.flow_ls > 8 && vac.r_now > 0;
  if (measured) {
    vac.r_after = vac.r_now;
    if (!strong && !pushed && r_ref > 0 && dt > 3000 && dt < 600000) {
      float g = (vac.r_before - r_ref) / ((float)dt / 1000.0f);
      if (g < 0) g = 0;
      r_grow = r_grow > 0 ? r_grow + (g - r_grow) * 0.5f : g;
    }
    r_ref = vac.r_after;
    if (!strong && !PRESET.n) n_auto += ((float)(pulse_i - diag_n) - n_auto) * 0.3f;
    float base = r_clean();
    /* Серия помогла, если R упал хотя бы на 3 %. «Не отбивается» — только когда удары
     * подряд перестали помогать, а R высокий; пыль липнет быстрее, чем отбивается, — это
     * повод бить чаще (ниже), а не неисправность. */
    float drop = vac.r_before > 0 ? (vac.r_before - vac.r_after) / vac.r_before : 0;
    push_at = 0;
    if (base > 0 && vac.r_before > base * 1.05f) {
      float eff = (vac.r_before - vac.r_after) / (vac.r_before - base);
      vac.dust_kind = eff >= 0.6f ? 1 : eff >= 0.3f ? 2 : 3;
      /* «Авто»: R ещё выше нормы (чистый + порог или порог перепада), а серия помогла — добиваем через 8 с. */
      float band = (float)(vac_cfg.thr > 100 ? vac_cfg.thr - 100 : 15) / 100.0f;
      float high = vac_cfg.dp_on ? r_of_dp(vac_cfg.dp_on) : base * (1 + band);
      if (!strong && !PRESET.every && drop >= 0.03f && vac.r_after > high) push_at = now_ms + 8000;
      /* Добили до конца, а к норме не вернулись: пыль налипает между сериями — серии чаще
       * (меньше налипло — легче сбить). Вернулись — понемногу реже. */
      if (!strong && !push_at) {
        if (vac.r_after > base * (1 + band)) band_k = band_k * 0.7f < 0.25f ? 0.25f : band_k * 0.7f;
        else band_k = band_k * 1.2f > 1 ? 1 : band_k * 1.2f;
      }
      /* Удары перестали помогать, а R больше чистого в 1,6 раза — три раза подряд: липкая
       * пыль, обычным ударом не сбить — подсказка «мощная очистка». */
      if (!push_at && vac.r_after > base * 1.6f) {
        /* Слабые удары — дело в шланге, а не в пыли: «не отбивается» не ставим. */
        if (!(vac.faults & F_WEAK) && ++stuck_n >= 3) set_fault(F_STUCK, 1);
      } else if (vac.r_after < base * 1.3f) {
        stuck_n = 0;
        set_fault(F_STUCK, 0);
      }
    }
    float rf = vac.r_after - (vac_cfg.bag ? vac_cfg.r_bag : 0);
    /* Фильтр не мерили — R нового узнаём по самой чистой продувке. */
    if (FILT.r_new <= 0 || rf < FILT.r_new) {
      FILT.r_new = rf;
      if (FILT.r_base <= 0 || rf < FILT.r_base) FILT.r_base = rf;
      if (!FILT.state) FILT.state = FS_NEW;
    }
    float wash = FILT.r_new * 2.5f;
    if (rf > wash) set_fault(F_FILTER, 1);
    else if (rf < wash * 0.9f) set_fault(F_FILTER, 0);
    rhist_put(rf);
  }
  /* Две серии подряд только со слабыми ударами — подсказка про мощную очистку. */
  if (!strong) {
    if (weak_in && !strong_in) {
      if (++weak_n >= 2 && !(vac.faults & F_WEAK)) {
        set_fault(F_WEAK, 1);
        hal_log("  в баке мало разрежения: закройте шланг ладонью на 2 с — мощная очистка (или шланг 36–38 мм)");
      }
    } else if (strong_in) {
      weak_n = 0;
      set_fault(F_WEAK, 0);
    }
  }
  pushed = 0;
  auto_plan();
  if (!hours_dirty_ms) hours_dirty_ms = now_ms;
  if (strong) {
    hose_need_open = 1;
    block_allow_at = now_ms + 6000;
  }
  char line[96] = "", n[12];
  str_cat(line, strong ? "Мощная очистка закончена" : "Продувка закончена");
  if (measured && vac.r_before > 0) {
    str_cat(line, ": R ");
    str_cat(line, fmt_num(n, vac.r_before, 1));
    str_cat(line, " → ");
    str_cat(line, fmt_num(n, vac.r_after, 1));
  } else if (strong)
    str_cat(line, " — откройте шланг");
  purge_finish(line);
}

/* ---------------- удар ---------------- */

/* Открыть клапаны маски: SSR откроются в ближайшем нуле сети на vac.imp_now (целыми полупериодами). */
static void fire(uint8_t mask) {
  pulse_mask = mask;
  vac.valve[0] = mask & 1;
  vac.valve[1] = (mask >> 1) & 1;
  vlv_ms = vac.imp_now;
  vlv_req = mask;
  pulse_i++;
  if (mask != 3) diag_n++;
  vac.pulse_no = (uint8_t)pulse_i;
  pulse_t = ph_t = now_ms;
  pa_before = pa_min = vac.filter_pa;
  pc_before = pc_min = vac.vacuum_kpa;
  t_front = -1;
  fast_n = 0;
  /* До нуля сети — до полупериода, плюс округление до полупериода. */
  watch_until = now_ms + vac.imp_now + 20 + 150;
  if (!watch_until) watch_until = 1;
  fast_us = hal_micros() - 2000;
  ph = PH_OPEN;
  vac_cfg.pulse_count++;
  vac_cfg.in_pulses++;
  FILT.pulses++;
  diag_pulses++;
}

/* Быстрые отсчёты во время удара: перепад на фильтре, разрежение. */
static void fast_sample(void) {
  float pa;
  if (sdp_read(SDP_FILTER, &pa) == 0 && pa < pa_min) {
    /* Обратный перепад: самый глубокий момент — «фронт» удара. */
    pa_min = pa;
    t_front = (int)(now_ms - pulse_t);
  }
  float pc = vacuum_raw(0);
  if (pc < pc_min) pc_min = pc;
  fast_n++;
}

/*
 * Сила удара — насколько легко воздух входит через клапаны и их фильтр. Обратный перепад на
 * фильтре rev = kф·Qобр², рабочий Δp = kф·Q², значит Qобр²/Q² = rev/Δp, а Qобр² ≈ разрежение/kкл:
 * s = rev·Q²/(Δp·разрежение) ∝ 1/kкл — от загрузки фильтра не зависит. Эталон — первые 20 ударов
 * с новым фильтром клапанов; упала сила — сначала проверка клапанов по одному, потом «фильтр клапанов».
 */
static void intake_update(float s) {
  if (vac_cfg.in_base <= 0 || vac_cfg.in_pulses <= 20) {
    uint32_t n = vac_cfg.in_pulses ? vac_cfg.in_pulses : 1;
    vac_cfg.in_base = vac_cfg.in_base <= 0 ? s : vac_cfg.in_base + (s - vac_cfg.in_base) / (float)n;
    depth_ema = vac_cfg.in_base;
  } else
    depth_ema += (s - depth_ema) * 0.2f;
  vac.in_health = vac_cfg.in_base > 0 ? depth_ema / vac_cfg.in_base * 100.0f : 100;
  if (vac.in_health < 70 && !(vac.faults & F_INTAKE) && !diag_req && diag_pulses > 4) diag_req = 1;
  else if (vac.in_health > 85) set_fault(F_INTAKE, 0);
}

/* Итог удара: открылся ли клапан (провал перепада), сила удара, подбор длины. */
static void pulse_eval(void) {
  watch_until = 0;
  float depth = pc_before > 1 ? (pc_before - pc_min) / pc_before : 0;
  if (depth < 0) depth = 0;
  vac.depth = depth;
  int meaningful = pc_before > 3 && !(vac.faults & F_VAC);
  int dp_ok = (vac.faults & F_SDP_F) || pa_before < 40 || pa_min < pa_before * 0.5f;
  if (pulse_mask == 3) {
    /* Оба разом: перепад должен провалиться. */
    if (meaningful && !dp_ok) {
      if (++valve_bad_dp >= 2 && !diag_req) diag_req = 1;
      diag_bad_dp = 1;
    } else
      valve_bad_dp = 0;
    float rev = -pa_min;
    /* Клапаны открылись (рабочий перепад пропал), а обратного потока через фильтр почти нет:
     * удар слабый — воздух клапанов выпивают турбины (широкий шланг, в баке мало разрежения). */
    if (vac.purging == PURGE_SERIES && !(vac.faults & F_SDP_F) && pa_before >= 20 && pa_min < pa_before * 0.5f) {
      if (rev < pa_before * 0.6f && rev < 150) weak_in++;
      else strong_in++;
    }
    if (meaningful && dp_ok && pa_before > 20 && vac.flow_ls > 8 && rev > 0 && rev < 450)
      intake_update(rev * vac.flow_ls * vac.flow_ls / (pa_before * pc_before * 1000.0f));
    /* «Авто»: удар — до самого глубокого обратного перепада и ещё 15 мс, не дольше нужного. */
    if (vac.purging == PURGE_SERIES && !PRESET.imp && meaningful && t_front >= 0) {
      int want = t_front + 15;
      imp_auto = (uint16_t)(want < 25 ? 25 : want > 80 ? 80 : want);
    }
    return;
  }
  /* Проверка по одному: удар только клапаном k — перепад должен провалиться. */
  int k = pulse_mask == 1 ? 0 : 1;
  diag_depth[k] = meaningful ? depth : -1;
  if (meaningful && !dp_ok) valve_fault(k, VE_STUCK);
  else if (meaningful && vac.verr[k]) valve_fault(k, VE_OK);
  if (k == 1) {
    diag_req = 0;
    diag_bad_dp = 0;
    diag_pulses = 0;
    valve_bad_dp = 0;
    /* Клапаны открываются, а удар слабый — забит фильтр клапанов. */
    if (!(vac.faults & (F_VALVE1 | F_VALVE2)) && vac.in_health < 70) set_fault(F_INTAKE, 1);
  }
}

/* ---------------- этапы очистки (каждые 10 мс) ---------------- */

static void purge_step(uint32_t ms) {
  if (watch_until && ph != PH_OPEN && (int32_t)(ms - watch_until) >= 0) pulse_eval();
  switch (ph) {
  case PH_HOSE:
    /* Мощная: ждём, пока шланг закроют ладонью (15 с; всего — не дольше 30 с). */
    vac.hose_wait = 1;
    if (vac.running && vac.hose_closed && hose_since && ms - hose_since >= 500) {
      vac.hose_wait = 0;
      strong_peak = vac.vacuum_kpa;
      ph = PH_PAUSE;
      ph_t = ms;
    } else if ((!pulse_i && ms - purge_t0 > 15000) || ms - purge_t0 > 30000)
      purge_finish(pulse_i ? "Мощная очистка прервана: шланг открыт" : "Мощная очистка отменена: шланг не закрыли");
    break;
  case PH_SPIN:
    /* Турбины должны раскрутиться: разрежение — это сила удара. */
    if (vac.running && ms - run_since >= 3000) {
      vac.r_before = r_prev_pulse = vac.r_now;
      ph = PH_PAUSE;
      ph_t = ms;
    } else if (ms - ph_t > 10000)
      purge_finish("Продувка отменена: турбины не раскрутились");
    break;
  case PH_OPEN:
    /* SSR закрылись (удар — целыми полупериодами от ближайшего нуля). */
    if (!vlv_req && !vlv_on && ms - pulse_t >= 5) {
      vac.valve[0] = vac.valve[1] = 0;
      rec_target = pc_before * 0.9f;
      pulse_quiet_until = ms + 600;
      ph = PH_PAUSE;
      ph_t = ms;
    }
    break;
  case PH_PAUSE: {
    if (watch_until) break;
    uint32_t dt = ms - ph_t;
    int ready;
    if (vac.purging == PURGE_STRONG && pulse_i < pulses_now) {
      /* Шланг открыли (поток пошёл) — ждём, пока закроют снова. */
      if (vac.speed_ms > 8 && hose_open_since && ms - hose_open_since > 800) {
        ph = PH_HOSE;
        break;
      }
      if (vac.vacuum_kpa > strong_peak) strong_peak = vac.vacuum_kpa;
      ready = pulse_i == 0 ? dt >= 300 : dt >= 300 && (vac.vacuum_kpa >= strong_peak * 0.9f || dt >= 1500);
    } else if (pulse_i == 0)
      ready = 1;
    else if (vac.purging == PURGE_SERIES && PRESET.pause)
      ready = dt >= PRESET.pause;
    else
      ready = dt >= 150 && (vac.vacuum_kpa >= rec_target || dt >= 800);
    if (!ready) break;
    if (vac.purging == PURGE_SERIES && !pulses_now && pulse_i - diag_n >= 1 && !diag_req) {
      /* «Авто»: после удара меряем R — стоит ли бить ещё. */
      ph = PH_MEASURE;
      ph_t = ms;
      break;
    }
    int more = pulse_i - diag_n < (pulses_now ? pulses_now : 1) || (diag_req && pulse_i < 2 && vac.purging != PURGE_STRONG);
    if (more) {
      uint8_t mask = 3;
      if (diag_req && vac.purging != PURGE_STRONG && pulse_i < 2) mask = pulse_i == 0 ? 1 : 2;
      fire(mask);
    } else {
      ph = PH_SETTLE;
      ph_t = ms;
    }
    break;
  }
  case PH_MEASURE:
    if (ms - ph_t < 600) break;
    {
      float r = vac.flow_ls > 8 ? 100.0f * vac.filter_pa / (vac.flow_ls * vac.flow_ls) : 0;
      float drop = r_prev_pulse > 0 && r > 0 ? (r_prev_pulse - r) / r_prev_pulse : 0;
      if (r > 0) r_prev_pulse = r;
      /* Бьём, пока удар ещё снижает R (не больше 8 ударов за серию). */
      if (pulse_i - diag_n < 8 && drop >= 0.02f) fire(3);
      else ph = PH_SETTLE, ph_t = ms;
    }
    break;
  case PH_SETTLE:
    /* Поток устанавливается — меряем R после ударов (перед остановкой — не ждём). */
    if (watch_until) break;
    if (vac.purging == PURGE_OFF) {
      vac.purges++;
      purge_finish("Очистка перед остановкой закончена");
    } else if (ms - ph_t >= 1000 && (int32_t)(ms - pulse_quiet_until) >= 700)
      series_done();
    break;
  }
}

/* ---------------- турбины: реле и симистор ---------------- */

/*
 * Реле замыкается и размыкается только без тока (симистор закрыт) — контакты не горят.
 * После замыкания 60 мс меряем ток при закрытом симисторе: есть — симистор пробит, реле
 * размыкаем. После остановки — то же перед размыканием и после: ток есть и после размыкания —
 * реле сварилось и симистор пробит, остановить может только выключатель сети.
 * hold — держать реле замкнутым при закрытом симисторе (сейчас не нужно: клапаны питаются
 * от сети до реле турбин).
 */
static void turbine_fsm(int k, int want, int hold, uint32_t ms) {
  int pin = k ? PIN_RL2 : PIN_RL1;
  uint32_t dt = ms - ts_t[k];
  switch (vac.ts[k]) {
  case TS_OFF:
    if ((want || hold) && !(vac.faults & (k ? F_WELD2 : F_WELD1)) && !(lock_until[k] && (int32_t)(lock_until[k] - ms) > 0 && (vac.faults & (k ? F_LEAK2 : F_LEAK1)))) {
      vac.relay[k] = 1;
      hal_pin_write(pin, 1);
      vac.ts[k] = TS_CLOSE;
      ts_t[k] = ms;
    }
    break;
  case TS_CLOSE:
    if (!want && !hold) {
      vac.relay[k] = 0;
      hal_pin_write(pin, 0);
      vac.ts[k] = TS_OFF;
    } else if (dt >= 30) {
      ct_peak[k] = 0;
      vac.ts[k] = TS_CHECK;
      ts_t[k] = ms;
    }
    break;
  case TS_CHECK:
    if (dt < 60 && (want || hold)) break;
    if (peak_amps(k) > 1.5f) {
      set_fault(k ? F_LEAK2 : F_LEAK1, 1);
      lock_until[k] = ms + 60000;
      vac.relay[k] = 0;
      hal_pin_write(pin, 0);
      vac.ts[k] = TS_OPEN;
      ts_t[k] = ms;
    } else if (!want && !hold) {
      vac.relay[k] = 0;
      hal_pin_write(pin, 0);
      vac.ts[k] = TS_OFF;
    } else {
      set_fault(k ? F_LEAK2 : F_LEAK1, 0);
      vac.ts[k] = want ? TS_RUN : TS_HOLD;
      ts_t[k] = ms;
      on_since[k] = ms;
    }
    break;
  case TS_HOLD:
    if (want) {
      vac.ts[k] = TS_RUN;
      ts_t[k] = on_since[k] = ms;
    } else if (!hold) {
      vac.ts[k] = TS_STOP;
      ts_t[k] = ms;
    }
    break;
  case TS_RUN:
    if (!want) {
      vac.ts[k] = TS_STOP;
      ts_t[k] = ms;
    }
    break;
  case TS_STOP:
    /* 40 мс — симистор закрылся на нуле тока; дальше 60 мс ток должен быть нулевым. */
    if (dt == 40 || (dt > 40 && dt < 50)) ct_peak[k] = 0;
    if (dt < 100) break;
    if (peak_amps(k) > 1.5f) {
      set_fault(k ? F_LEAK2 : F_LEAK1, 1);
      lock_until[k] = ms + 60000;
    } else if (hold) {
      vac.ts[k] = TS_HOLD;
      ts_t[k] = ms;
      break;
    }
    vac.relay[k] = 0;
    hal_pin_write(pin, 0);
    vac.ts[k] = TS_OPEN;
    ts_t[k] = ms;
    break;
  case TS_OPEN:
    if (dt >= 20 && dt < 30) ct_peak[k] = 0;
    if (dt < 110) break;
    if (peak_amps(k) > 1.5f) set_fault(k ? F_WELD2 : F_WELD1, 1);
    vac.ts[k] = TS_OFF;
    ts_t[k] = ms;
    break;
  }
}

/* ---------------- розетка и инструмент ---------------- */

/*
 * Розетка — через реле K3 (30 А): под напряжением, пока пылесос включён и разрешён автозапуск
 * (или турбины работают, или разрешено «без пылесоса»). Каждый раз при подаче 0,5 с смотрим
 * ток: есть — инструмент оставили включённым, розетку снимаем (иначе он раскрутится в руках).
 */
static int sock_should(void) {
  if (vac.sleep || sock_lock || vac.ov || !zc_ok) return 0;
  return vac_cfg.tool_auto || vac.state == VAC_ACTIVE || vac.running || vac_cfg.sock_free;
}

static void tool_event(int on) {
  uint32_t ms = now_ms;
  if (on) {
    tool_on_since = ms;
    ov_n = 0;
    runon_until = 0;
    if (vac_cfg.tool_auto && !vac.sleep && vac.state == VAC_STANDBY && !blocked_by_fault()) {
      tool_start_at = ms + vac_cfg.tool_delay;
      if (!tool_start_at) tool_start_at = 1;
      hal_log(vac.tool == 2 ? "Метка: инструмент работает — пуск турбин" : "Инструмент включён — пуск турбин");
    } else
      hal_log(vac.tool == 2 ? "Метка: инструмент работает" : "Инструмент включён");
    return;
  }
  tool_start_at = 0;
  hal_log("Инструмент выключен");
  if (vac.auto_started && vac.state == VAC_ACTIVE) {
    runon_until = ms + (uint32_t)vac_cfg.tool_runon * 1000;
    if (!runon_until) runon_until = 1;
    char line[96] = "Выбег ", n[8];
    str_cat(line, fmt_int(n, vac_cfg.tool_runon));
    hal_log(str_cat(line, " с, потом удары и стоп"));
  }
}

void vac_tag_tool(int n, int on) {
  if (n < 0 || n >= N_BLE) return;
  uint8_t bit = (uint8_t)(1 << n);
  if (on) vac.tags_on |= bit;
  else vac.tags_on &= (uint8_t)~bit;
  if (vac.tags_on && !vac.tool) {
    vac.tool = 2;
    tool_event(1);
  } else if (!vac.tags_on && vac.tool == 2) {
    vac.tool = 0;
    tool_event(0);
  }
}

static void tool_control(uint32_t ms) {
  int s = sock_should();
  if (s && !vac.sock) sock_check_until = ms + 500;
  vac.sock = (uint8_t)s;
  hal_pin_write(PIN_RL3, s);
  /* Автозапуск: инструмент включился — через задержку пускаем турбины. */
  if (tool_start_at && (int32_t)(ms - tool_start_at) >= 0) {
    tool_start_at = 0;
    if (vac.tool && vac.state == VAC_STANDBY && !vac.sleep) {
      vac_turbine(-1, 1);
      vac.auto_started = vac.state == VAC_ACTIVE;
    }
  }
  /* Выбег после инструмента, потом удары и стоп. */
  if (runon_until && (int32_t)(ms - runon_until) >= 0) {
    runon_until = 0;
    if (vac.auto_started && !vac.tool) {
      hal_log("Выбег закончен");
      stop_all(AFTER_STOP, vac_cfg.tool_end, 2000);
    }
  }
}

/* Перегрузка: розетку — прочь, на экране выбор: снизить турбины (до скольких — считаем) или оставить выключенной. */
static void overload_trip(float tl, float turb) {
  vac.ov = OV_TRIP;
  vac.ov_tool = tl;
  vac.ov_turb = turb < 0 ? 0 : turb;
  vac.ov_cap = 0;
  vac.ov_one = 0;
  float allowed = (float)vac_cfg.limit_a - tl - SELF_AMPS - 0.5f;
  float pmax = vac.pcmd[0] > vac.pcmd[1] ? vac.pcmd[0] : vac.pcmd[1];
  int nt = (vac.pcmd[0] > 0) + (vac.pcmd[1] > 0);
  if (allowed > 0.5f && vac.ov_turb > 0.5f && pmax > 0) {
    /* Ток турбины при фазовом управлении падает медленно: на 30 % мощности — около 2/3 полного,
     * примерно как кубический корень из мощности. */
    float r = allowed / vac.ov_turb, p = pmax * r * r * r;
    if (p >= 30) vac.ov_cap = (uint8_t)((p > 95 ? 95 : (int)p) / 5 * 5);
    else if (nt == 2) {
      r = allowed / (vac.ov_turb / 2), p = pmax * r * r * r;
      if (p >= 30) vac.ov_cap = (uint8_t)((p > 100 ? 100 : (int)p) / 5 * 5), vac.ov_one = 1;
    }
  }
  vac.tool = 0;
  ov_n = 0;
  runon_until = 0;
  char line[160] = "! Перегрузка: инструмент ", n[12];
  str_cat(line, fmt_num(n, tl, 1)), str_cat(line, " А + турбины "), str_cat(line, fmt_num(n, vac.ov_turb, 1));
  str_cat(line, " А > предел "), str_cat(line, fmt_int(n, vac_cfg.limit_a)), str_cat(line, " А — розетка отключена");
  hal_log(line);
  vac_beep(3);
}

/* ---------------- управление (каждые 10 мс) ---------------- */

static void control(void) {
  uint32_t ms = now_ms;
  /* Синхронизация: импульсы нуля идут каждые 10 мс. */
  if (zc_count != seen_zc) {
    seen_zc = zc_count;
    last_zc_ms = ms;
  }
  zc_ok = ms - last_zc_ms < 60;
  set_fault(F_NO_ZC, !zc_ok && ms > 500);

  /* Авария, при которой турбины должны стоять: кнопки турбин гасим — пуск только заново. */
  if (blocked_by_fault() && (vac.en[0] || vac.en[1] || purge_spin)) {
    vac.en[0] = vac.en[1] = 0;
    vac.auto_started = 0;
    if (vac.purging) {
      after_purge = AFTER_NONE;
      purge_finish("Очистка прервана: авария");
    }
    sync_state();
  }
  int want = vac.state == VAC_ACTIVE && zc_ok;
  int spin = want || (purge_spin && zc_ok);
  if (spin && !spin_prev) {
    start_ms = ms;
    worked_ms = 0;
    vac.dual = 0;
    if (u_pid > 100) u_pid = 100;
  }
  spin_prev = spin;

  if (vac.purging) purge_step(ms);
  else if (watch_until && (int32_t)(ms - watch_until) >= 0)
    pulse_eval();
  int boost = vac.purging == PURGE_STRONG || (vac.purging && ph == PH_SPIN);

  /* Цели турбин: основная — первая включённая, вторая помогает регулятору. */
  float tgt[2] = {0, 0};
  int p = vac.en[0] ? 0 : 1, s = p ^ 1;
  int pair = vac.en[0] && vac.en[1];
  int softstart_ms = vac_cfg.softstart * 100 + 1500;
  float cap = vac.cap ? (float)vac.cap : 100;
  if (want && vac.mode == VAC_AUTO && !(vac.faults & F_SDP_Q)) {
    /* ПИ по расходу: разгон пройден — регулируем. */
    int settled = vac.running && ms - start_ms > (uint32_t)softstart_ms && !vac.purging && !vac.hose_closed;
    float e = (float)SP - vac.flow_ls;
    if (settled) {
      u_pid += KP * (e - e_prev) + KI * e * 0.01f;
      float hi = pair ? 2 * cap : cap;
      if (u_pid > hi) u_pid = hi;
      if (u_pid < 30) u_pid = 30;
      /* Вторая турбина: одной не хватает (полная мощность 2 с, а расхода мало) — включаем;
       * уставку снизили ниже того, что давала одна, или двух много даже на минимуме — выключаем. */
      if (!vac.dual && pair && u_pid >= cap - 0.5f && e > 0.5f) {
        if (!dual_since) dual_since = ms;
        if (ms - dual_since > 2000) {
          vac.dual = 1, dual_since = 0, q_single = vac.flow_ls;
          hal_log("Регулятор: вторая турбина включена");
        }
      } else
        dual_since = 0;
      int enough = (float)SP < q_single * 0.9f || (u_pid <= 60.5f && e < -2);
      if (vac.dual && (enough || !pair)) {
        if (!single_since) single_since = ms;
        if (ms - single_since > 5000 || !pair) {
          vac.dual = 0, single_since = 0;
          u_pid = u_pid > cap ? cap : u_pid < 60 ? 60 : u_pid;
          hal_log("Регулятор: хватает одной турбины");
        }
      } else
        single_since = 0;
    }
    e_prev = e;
    if (vac.dual) tgt[p] = tgt[s] = u_pid / 2;
    else tgt[p] = u_pid > 100 ? 100 : u_pid;
  } else if (want) {
    for (int k = 0; k < 2; k++) tgt[k] = vac.en[k] ? vac_cfg.power : 0;
    vac.dual = (uint8_t)pair;
  }
  if (purge_spin && (!want || boost))
    for (int k = 0; k < 2; k++)
      if (spin_mask & (1 << k)) tgt[k] = 100;

  float rate = 10.0f / (vac_cfg.softstart ? vac_cfg.softstart : 1); /* % за 10 мс */
  int any = 0;
  for (int k = 0; k < 2; k++) {
    float target = tgt[k];
    if (target > 0 && target < 30) target = 30;
    if (target > cap) target = cap;
    if (vac.faults & (k ? F_WARM2 : F_WARM1)) target = target > 70 ? 70 : target;
    if (vac.faults & (k ? F_NTC2 : F_NTC1)) target = target > 70 ? 70 : target;
    int locked = (vac.faults & (k ? F_HOT2 : F_HOT1)) || (lock_until[k] && (int32_t)(lock_until[k] - ms) > 0);
    /* Поочерёдный пуск: вторая — после разгона первой (бросок тока — по одному). */
    int other_starting = vac.ts[k ^ 1] >= TS_CLOSE && vac.ts[k ^ 1] <= TS_RUN && vac.pcmd[k ^ 1] > 0 && ms - on_since[k ^ 1] < vac_cfg.stagger_ms;
    int first = k == 0 || tgt[0] <= 0 || vac.ts[0] == TS_RUN;
    int on = spin && target > 0 && !locked && (vac.ts[k] == TS_RUN || (first && !other_starting));
    turbine_fsm(k, on, 0, ms);
    float pw = vac.pcmd[k];
    if (vac.ts[k] != TS_RUN || !on)
      pw = 0;
    else {
      if (pw < 20) pw = 20;
      if (pw < target) pw = pw + rate > target ? target : pw + rate;
      else if (pw > target) pw = pw - 2 < target ? target : pw - 2;
    }
    vac.pcmd[k] = pw;
    /* МР248: мощность — доля от напряжения на входе (0…3,3 В), то есть заполнение ШИМ. */
    int duty = pw < 15 ? 0 : (int)(pw * 10.0f + 0.5f);
    if (duty > 1000) duty = 1000;
    if (duty != pwm_sent[k]) hal_pwm(k ? PIN_T2 : PIN_T1, PWM_HZ, duty), pwm_sent[k] = duty;
    if (pw > 0) any = 1;
  }
  if (any && !vac.running) run_since = ms;
  if (!any && vac.running) stop_ms = ms;
  vac.running = (uint8_t)any;
  if (any) worked_ms += 10;
  if (!any && vac.purging && ph != PH_SPIN && ph != PH_HOSE) purge_finish("Очистка прервана: турбины остановлены");

  tool_control(ms);
  led();
}

/* ---------------- электроды и поплавок ---------------- */

static uint32_t wl_done_phase;
static float wl_hi[2], wl_lo[2];
static uint8_t wl_have;
static uint32_t level_since, level_gone, over_since, probe_since;
static uint16_t float_hist;

/* Отсчёт АЦП электродов в середине полупериода раскачки (в «1» и в «0»). */
static void water_sample(void) {
  uint32_t ph0 = wl_phase;
  if (ph0 == wl_done_phase) return;
  uint32_t dt = hal_micros() - wl_edge;
  if (dt < 250 || dt > WL_HALF * 100 - 50) return;
  wl_done_phase = ph0;
  int lv = wl_lvl;
  float a = (float)hal_adc_mv(PIN_WL1), b = (float)hal_adc_mv(PIN_WL2);
  if (lv) wl_hi[0] = a, wl_hi[1] = b, wl_have |= 1;
  else wl_lo[0] = a, wl_lo[1] = b, wl_have |= 2;
  if (wl_have == 3) {
    wl_have = 0;
    for (int i = 0; i < 2; i++) {
      float d = wl_hi[i] - wl_lo[i];
      if (d < 0) d = 0;
      vac.wl_mv[i] += (d - vac.wl_mv[i]) * 0.2f;
    }
  }
}

/* Уровень (каждые 100 мс): E1 или поплавок — стоп турбин; E2 — перелив, аварийный стоп. */
static void water_logic(uint32_t ms) {
  float thr = (float)vac_cfg.wl_mv;
  int e1 = vac.wl_mv[0] > thr ? 1 : vac.wl_mv[0] < thr * 0.6f ? 0 : -1;
  int e2 = vac.wl_mv[1] > thr ? 1 : vac.wl_mv[1] < thr * 0.6f ? 0 : -1;
  int fl = vac.float_on;
  if (e2 == 1) {
    if (!over_since) over_since = ms;
  } else if (e2 == 0)
    over_since = 0;
  int over = over_since && ms - over_since >= 300;
  if (over && !(vac.faults & F_OVERFLOW)) {
    set_fault(F_OVERFLOW, 1);
    vac.water = WL_OVERFLOW;
  }
  int level = e1 == 1 || fl;
  if (level) {
    level_gone = 0;
    if (!level_since) level_since = ms;
  } else if (e1 == 0 && !fl) {
    level_since = 0;
    if (!level_gone) level_gone = ms;
  }
  if (level_since && ms - level_since >= 1000 && !(vac.faults & F_WATER)) {
    set_fault(F_WATER, 1);
    hal_log(fl && e1 != 1 ? "Бак полон (поплавок)" : "Бак полон (электрод уровня)");
  }
  /* Снимаем, когда воду слили: оба электрода сухие 3 с, поплавок опущен. */
  if (!over_since && level_gone && ms - level_gone >= 3000) {
    set_fault(F_WATER, 0);
    set_fault(F_OVERFLOW, 0);
  }
  vac.water = (uint8_t)((vac.faults & F_OVERFLOW) ? WL_OVERFLOW : (vac.faults & F_WATER) ? WL_LEVEL : WL_DRY);
  /* Верхний мокрый, нижний сухой дольше 5 с — грязь на верхнем или обрыв нижнего. */
  if (e2 == 1 && e1 == 0) {
    if (!probe_since) probe_since = ms;
  } else
    probe_since = 0;
  if (probe_since && ms - probe_since > 5000) set_fault(F_PROBE, 1);
  else if (e1 == 1 || (e2 == 0 && !probe_since)) set_fault(F_PROBE, 0);
}

/* Поплавок — вход расширителя (читает vac_link.c); дребезг — 8 одинаковых отсчётов. */
static void float_update(void) {
  float_hist = (uint16_t)((float_hist << 1) | ((vac.keys >> K_FLOAT) & 1));
  if ((float_hist & 0xFF) == 0xFF) vac.float_on = 1;
  else if ((float_hist & 0xFF) == 0) vac.float_on = 0;
}

/* ---------------- датчики (каждые 50 мс) ---------------- */

static int sens_phase;
static uint32_t load_since, fm_done_at;

/* Замер фильтра закончен: R в паспорт, насколько он близок к новому, не другой ли это фильтр. */
static uint8_t fm_prev_state;
static void fm_done(void) {
  float R = fm_cnt ? fm_sum / (float)fm_cnt : 0;
  char line[120] = "", n[12];
  if (fm_kind == 9) {
    float rb = R - FILT.r_base;
    vac_cfg.r_bag = rb > 0 ? rb : 0;
    vac_cfg.bag = 1;
    str_cat(line, "Мешок: добавка к R "), str_cat(line, fmt_num(n, vac_cfg.r_bag, 1));
  } else {
    float Rf = R - (vac_cfg.bag ? vac_cfg.r_bag : 0);
    vac_filter_t *f = &vac_cfg.f[fm_filt];
    fm_prev_state = f->state;
    if (fm_kind == FS_NEW) {
      f->r_new = f->r_base = Rf;
      f->washes = 0, f->work_s = 0, f->pulses = 0;
    } else {
      f->r_base = Rf;
      if (fm_kind == FS_WASHED) f->washes++;
      if (f->r_new <= 0) f->r_new = Rf;
    }
    f->state = fm_kind;
    vac.fm_r = Rf;
    vac.fm_pct = f->r_new > 0 && Rf > 0 ? (f->r_new / Rf * 100 > 100 ? 100 : f->r_new / Rf * 100) : 100;
    /* Похоже на другой фильтр: от своего прошлого R далеко, к R другого — близко. */
    const vac_filter_t *o = &vac_cfg.f[fm_filt ^ 1];
    vac.fguess = -1;
    if (fm_kind != FS_NEW && o->r_base > 0 && fm_prev_base > 0) {
      float d_own = Rf - fm_prev_base, d_oth = Rf - o->r_base;
      if (d_own < 0) d_own = -d_own;
      if (d_oth < 0) d_oth = -d_oth;
      if (d_own > fm_prev_base * 0.3f && d_oth < o->r_base * 0.12f) vac.fguess = (int8_t)(fm_filt ^ 1);
    }
    set_fault(F_FILTER, 0);
    set_fault(F_TORN, 0);
    set_fault(F_STUCK, 0);
    stuck_n = 0;
    band_k = 1;
    r_ref = R;
    vac.r_after = R;
    str_cat(line, "Фильтр "), str_cat(line, fm_filt ? "Б" : "А"), str_cat(line, ": R "), str_cat(line, fmt_num(n, Rf, 1));
    str_cat(line, ", от нового "), str_cat(line, fmt_num(n, vac.fm_pct, 0)), str_cat(line, " %");
    if (f->r_new > 0 && Rf > f->r_new * 1.8f) str_cat(line, " — пора менять");
  }
  hal_log(line);
  vac.fmeas = FM_DONE;
  fm_done_at = now_ms;
  vac_beep(1);
  vac_save_soon();
  if (fm_started) {
    fm_started = 0;
    stop_all(AFTER_STOP, 0, 0);
  }
}

static void fm_begin(int filt, int kind) {
  if (vac.purging) {
    after_purge = AFTER_NONE;
    purge_finish("Очистка прервана: замер фильтра");
  }
  if (kind != 9) vac_cfg.filt = (uint8_t)filt;
  fm_kind = (uint8_t)kind;
  fm_filt = vac_cfg.filt;
  fm_prev_base = vac_cfg.f[fm_filt].r_base;
  vac.fmeas = FM_MEASURE;
  vac.fguess = -1;
  fm_t0 = 0, fm_sum = 0, fm_cnt = 0;
  vac.fm_left = 20;
  fm_started = 0;
  if (!vac.running && vac.state == VAC_STANDBY && !blocked_by_fault()) {
    vac_turbine(-1, 1);
    fm_started = vac.state == VAC_ACTIVE;
  }
  hal_log("Замер фильтра: 20 с, шланг открыт, без инструмента");
}

static void fm_step(uint32_t ms) {
  if (vac.fmeas == FM_DONE && ms - fm_done_at > 15000) vac.fmeas = FM_NONE;
  if (vac.fmeas != FM_MEASURE) return;
  if (!fm_t0) fm_t0 = ms;
  uint32_t el = ms - fm_t0;
  vac.fm_left = (uint8_t)(el >= 20000 ? 0 : (20000 - el) / 1000);
  /* Первые 5 с поток устанавливается, потом 15 с копим R. */
  if (vac.running && el > 5000 && !vac.purging && vac.flow_ls > 8 && !(vac.faults & F_SDP_F)) {
    fm_sum += 100.0f * vac.filter_pa / (vac.flow_ls * vac.flow_ls);
    fm_cnt++;
  }
  if (el >= 20000 && fm_cnt >= 50) fm_done();
  else if (el > 40000) {
    vac.fmeas = FM_NONE;
    hal_log("Замер фильтра не удался: нет потока");
    if (fm_started) fm_started = 0, stop_all(AFTER_STOP, 0, 0);
  }
}

static void sensors(void) {
  uint32_t ms = now_ms;
  int vbad;
  float kpa = vacuum_raw(&vbad);
  set_fault(F_VAC, vbad && ms > 2000);
  vac.vacuum_kpa += (kpa - vac.vacuum_kpa) * 0.3f;

  /* SDP810 (перепад на фильтре) и SDP811 (расходомер) на одной шине. */
  for (int b = 0; b < 2; b++) {
    float pa;
    int addr = b ? SDP_FLOW : SDP_FILTER;
    if (sdp_read(addr, &pa) == 0) {
      sdp_err[b] = 0;
      if (b == 0) vac.filter_pa += (pa - vac.filter_pa) * 0.4f;
      else {
        if (pa < 0) pa = 0;
        float q = (float)vac_cfg.flow_k10 / 10.0f * v_sqrtf(pa);
        vac.flow_m3h += (q - vac.flow_m3h) * 0.4f;
        vac.flow_ls = vac.flow_m3h / 3.6f;
        float d = (float)vac_cfg.hose_mm / 1000.0f;
        vac.speed_ms = vac.flow_m3h / 3600.0f / (3.14159265f * d * d / 4.0f);
      }
    } else if (++sdp_err[b] == 20) {
      sdp_start(addr);
    }
    set_fault(b ? F_SDP_Q : F_SDP_F, sdp_err[b] >= 20);
  }

  /* Сопротивление фильтра R = 100·Δp/Q²: от расхода почти не зависит, растёт с пылью. */
  int pulsing = vac.valve[0] || vac.valve[1] || (int32_t)(pulse_quiet_until - ms) > 0;
  if (vac.flow_ls > 8 && !pulsing && !(vac.faults & F_SDP_F)) {
    float r = 100.0f * vac.filter_pa / (vac.flow_ls * vac.flow_ls);
    vac.r_now = vac.r_now > 0 ? vac.r_now + (r - vac.r_now) * 0.3f : r;
    /* Фильтр порван или не стоит: воздух идёт, а перепада почти нет (или R вдвое ниже нового). */
    int torn = vac.filter_pa < 8 || (FILT.r_new > 0 && vac.r_now < FILT.r_new * 0.45f);
    if (torn && vac.running && ms - run_since > 5000) {
      if (!torn_since) torn_since = ms;
    } else
      torn_since = 0;
    if (torn_since && ms - torn_since > 4000) set_fault(F_TORN, 1);
  } else
    torn_since = 0;

  /* Температуры — через раз (100 мс); там же — электроды. */
  if (++sens_phase & 1) {
    for (int k = 0; k < 2; k++) {
      int bad;
      float t = ntc_temp(hal_adc_mv(k ? PIN_NTC2 : PIN_NTC1), &bad);
      set_fault(k ? F_NTC2 : F_NTC1, bad);
      if (bad) continue;
      vac.temp[k] += (t - vac.temp[k]) * 0.5f;
      uint32_t hot = k ? F_HOT2 : F_HOT1, warm = k ? F_WARM2 : F_WARM1;
      if (vac.temp[k] >= 110) set_fault(hot, 1);
      else if (vac.temp[k] < 80) set_fault(hot, 0);
      if (vac.temp[k] >= 95) set_fault(warm, 1);
      else if (vac.temp[k] < 90) set_fault(warm, 0);
    }
    water_logic(ms);
  }

  /* Шланг закрыт: воздуха почти нет, а разрежение высокое (ладонь, присоска, забит). */
  int closed = vac.running && vac.speed_ms < 4 && vac.vacuum_kpa > 5 && !(vac.faults & F_SDP_Q);
  if (closed) {
    hose_open_since = 0;
    if (!hose_since) hose_since = ms;
  } else {
    hose_since = 0;
    if (!hose_open_since) hose_open_since = ms;
  }
  vac.hose_closed = hose_since && ms - hose_since >= 300;
  if (hose_need_open && vac.speed_ms > 8) hose_need_open = 0;

  /* Воздух: проверки после разгона. */
  int up = vac.running && ms - run_since > 4000 && !vac.purging;
  if (up && vac_cfg.min_speed && vac.speed_ms < vac_cfg.min_speed && !vac.hose_closed) {
    if (!lowair_since) lowair_since = ms;
  } else
    lowair_since = 0;
  set_fault(F_LOWAIR, lowair_since && ms - lowair_since > 3000);
  int strong_ok = vac_cfg.hose_auto && (PRESET.flags & PF_HOSE) && zc_ok && vac.fmeas != FM_MEASURE;
  if (up && vac.state == VAC_ACTIVE && strong_ok && !hose_need_open && hose_since && ms - hose_since >= 2000) {
    hal_log("Шланг закрыт 2 с — мощная очистка");
    purge_begin(PURGE_STRONG, AFTER_NONE, vac_cfg.strong_n);
    vac_beep(0);
  }
  if (up && vac.vacuum_kpa > 14 && vac.speed_ms < 8 && (int32_t)(ms - block_allow_at) >= 0 && (!strong_ok || hose_need_open)) {
    if (!blocked_since) blocked_since = ms;
  } else
    blocked_since = 0;
  set_fault(F_BLOCKED, blocked_since && ms - blocked_since > 2000);

  /* Автоочистка: серия по режиму — через промежуток или когда R вырос на порог. */
  if (r_ref <= 0 && up && vac.r_now > 0 && ms - run_since > 6000) r_ref = vac.r_now, auto_plan();
  float band = (float)(vac_cfg.thr > 100 ? vac_cfg.thr - 100 : 15) / 100.0f * (PRESET.every ? 1 : band_k);
  /* Порог перепада задан: заполнение — от чистого фильтра до порога. */
  float r_on = vac_cfg.dp_on ? r_of_dp(vac_cfg.dp_on) : 0, r0 = r_clean();
  /* Порог ниже чистого фильтра — серии шли бы одна за другой: не ниже чистого + 5 %. */
  if (r_on > 0 && r0 > 0 && r_on < r0 * 1.05f) r_on = r0 * 1.05f;
  if (r_on > 0 && vac.r_now > 0) {
    float l = r0 > 0 && r_on > r0 ? (vac.r_now - r0) / (r_on - r0) * 100.0f : vac.r_now / r_on * 100.0f;
    vac.load = l < 0 ? 0 : l > 100 ? 100 : l;
  } else if (r_ref > 0 && vac.r_now > 0) {
    float l = (vac.r_now - r_ref) / (r_ref * band) * 100.0f;
    vac.load = l < 0 ? 0 : l > 100 ? 100 : l;
  }
  int can = up && vac.state == VAC_ACTIVE && vac_cfg.clean_auto && !(PRESET.flags & PF_NOCLEAN) && vac.fmeas != FM_MEASURE && zc_ok && !vac.hose_closed;
  float grown = r_ref > 0 && vac.r_now > 0 ? (vac.r_now - r_ref) / (r_ref * band) : 0;
  vac.next_series = 0;
  if (can) {
    uint16_t every = PRESET.every ? PRESET.every : vac.every_now ? vac.every_now : 90;
    vac.next_series = (uint16_t)(series_s < every ? every - series_s : 0);
    /* По перепаду: серия, когда перепад (при расходе уставки) дошёл до порога; по времени — только
     * если промежуток задан режимом. Без порога — по росту R от прошлой серии и по времени. */
    int due_time = series_s >= every && (!r_on || PRESET.every);
    int due_r = r_on > 0 ? vac.r_now >= r_on && ms - last_series_ms > 6000 : PRESET.every ? grown >= 2 : grown >= 1 && ms - last_series_ms > 6000;
    int due_push = push_at && (int32_t)(ms - push_at) >= 0;
    if (due_r) {
      if (!load_since) load_since = ms;
    } else
      load_since = 0;
    if (due_time || due_push || (load_since && ms - load_since > 1500)) {
      load_since = 0;
      push_at = 0;
      pushed = (uint8_t)due_push;
      hal_log(due_push ? "Очистка: фильтр ещё грязный — добиваю" : due_time ? "Очистка по времени" : r_on > 0 ? "Очистка: перепад на фильтре дошёл до порога" : "Очистка: сопротивление фильтра выросло");
      purge_begin(PURGE_SERIES, AFTER_NONE, PRESET.n);
    }
  } else
    load_since = 0, push_at = 0;
  fm_step(ms);
  float_update();
}

/* ---------------- токи (каждые 200 мс) ---------------- */

static void currents(void) {
  uint32_t ms = now_ms;
  if (ct_n < 20) return;
  float amps[3];
  for (int i = 0; i < 3; i++) {
    float rms2 = ct_sum2[i] / (float)ct_n - 9.0f; /* шум АЦП ~3 мВ */
    float mv = rms2 > 0 ? v_sqrtf(rms2) : 0;
    amps[i] = mv / CT_MV_PER_A[i];
    ct_sum2[i] = 0;
  }
  ct_n = 0;
  vac.amps[0] = amps[0];
  vac.amps[1] = amps[1];
  vac.tool_amps = amps[2] > 0.08f ? amps[2] : 0;
  vac.total_amps = amps[0] + amps[1] + vac.tool_amps + SELF_AMPS;

  /* Защиты по току (только в работе: при разомкнутом реле ток — это авария реле, её ловит turbine_fsm). */
  for (int k = 0; k < 2; k++) {
    float a = amps[k];
    uint32_t over = k ? F_OVER2 : F_OVER1, nocur = k ? F_NOCUR2 : F_NOCUR1;
    int settled = vac.ts[k] == TS_RUN && vac.pcmd[k] > 0 && ms - on_since[k] > (uint32_t)vac_cfg.softstart * 100 + 1500;
    if (settled && a > 9.0f) {
      if (++cnt_over[k] >= 5) {
        set_fault(over, 1);
        lock_until[k] = ms + 30000;
      }
    } else
      cnt_over[k] = 0;
    if (vac.ts[k] == TS_OFF && lock_until[k] && (int32_t)(lock_until[k] - ms) <= 0) {
      lock_until[k] = 0;
      set_fault(over, 0);
    }
    if (settled && vac.pcmd[k] >= 40 && a < 0.8f) {
      if (++cnt_nocur[k] >= 15) set_fault(nocur, 1);
    } else {
      cnt_nocur[k] = 0;
      if (settled && a > 1.5f) set_fault(nocur, 0);
    }
  }

  /* Инструмент в розетке. */
  float thr = (float)vac_cfg.tool_thr * 0.1f;
  if (vac.sock && (int32_t)(sock_check_until - ms) > 0 && vac.tool_amps > thr && vac.tool != 1) {
    /* Розетку только что подали, а ток уже есть — инструмент оставили включённым. */
    vac.ov = OV_TOOL_ON;
    sock_check_until = 0;
    hal_log("! Инструмент был включён, когда подали розетку — выключите его и включите розетку на экране");
    vac_beep(3);
  } else if (vac.sock && vac.tool_amps > thr) {
    tool_low_since = 0;
    if (vac.tool != 1) {
      int had = vac.tool;
      vac.tool = 1;
      if (!had) tool_event(1);
      else tool_on_since = ms, ov_n = 0;
    }
  } else if (vac.tool == 1) {
    if (!tool_low_since) tool_low_since = ms;
    if (ms - tool_low_since >= 600 || !vac.sock) {
      tool_low_since = 0;
      vac.tool = vac.tags_on ? 2 : 0;
      if (!vac.tool) tool_event(0);
    }
  }
  /* Предел общего тока: пусковой бросок (первые 2 с) не в счёт, дальше — среднее за 3 с. */
  if (vac.sock && vac.tool == 1 && ms - tool_on_since > 2000 && !vac.ov) {
    ov_tot[ov_i] = vac.total_amps;
    ov_tl[ov_i] = vac.tool_amps;
    ov_i = (ov_i + 1) % 15;
    if (ov_n < 15) ov_n++;
    if (ov_n == 15) {
      float t = 0, tl = 0;
      for (int i = 0; i < 15; i++) t += ov_tot[i], tl += ov_tl[i];
      t /= 15, tl /= 15;
      if (t > (float)vac_cfg.limit_a) overload_trip(tl, t - tl - SELF_AMPS);
    }
  } else
    ov_n = 0;
}

/* ---------------- раз в секунду ---------------- */

static char serial_line[1100], uart_line[160];
static int serial_len, uart_len;
static uint32_t last_status_ms;


static void mains(void) {
  /* Напряжение сети по ширине импульса нуля: Uвыпр = Uпорог / sin(π·w/2T). */
  uint32_t w = zc_width, half = zc_half;
  if (!zc_ok || !half) {
    vac.mains_v = 0;
    vac.mains_hz = 0;
    return;
  }
  float s = v_sinf(3.14159265f * (float)w / (2.0f * (float)half));
  float vpk = s > 0.05f ? ZC_VTH / s : 0;
  float v = (vpk + 1.4f) * ZC_KTR * (float)vac_cfg.mains_cal / 1000.0f;
  vac.mains_v += (v - vac.mains_v) * (vac.mains_v < 1 ? 1.0f : 0.5f);
  vac.mains_hz = 500000.0f / (float)half;
  set_fault(F_MAINS, vac.mains_v < 190 || vac.mains_v > 250);
}

static void status_line(char *out) {
  char n[16];
  out[0] = 0;
  str_cat(out, vac.sleep ? "ВЫКЛ" : vac.state == VAC_ACTIVE ? (vac.mode == VAC_AUTO ? "АВТО" : "РУЧН") : "СТОП");
  str_cat(out, vac.purging ? " очистка" : vac.running ? " работа" : " стоит");
  str_cat(out, " P1="), str_cat(out, fmt_int(n, (long)vac.pcmd[0])), str_cat(out, "%");
  str_cat(out, " P2="), str_cat(out, fmt_int(n, (long)vac.pcmd[1])), str_cat(out, "%");
  str_cat(out, " K="), str_cat(out, vac.relay[0] ? "1" : "0"), str_cat(out, vac.relay[1] ? "1" : "0"), str_cat(out, vac.sock ? "1" : "0");
  str_cat(out, " I1="), str_cat(out, fmt_num(n, vac.amps[0], 2));
  str_cat(out, " I2="), str_cat(out, fmt_num(n, vac.amps[1], 2));
  str_cat(out, " Iинстр="), str_cat(out, fmt_num(n, vac.tool_amps, 2));
  str_cat(out, " Iвсего="), str_cat(out, fmt_num(n, vac.total_amps, 1));
  str_cat(out, " t1="), str_cat(out, fmt_num(n, vac.temp[0], 0));
  str_cat(out, " t2="), str_cat(out, fmt_num(n, vac.temp[1], 0));
  str_cat(out, " U="), str_cat(out, fmt_num(n, vac.mains_v, 0));
  str_cat(out, " разр="), str_cat(out, fmt_num(n, vac.vacuum_kpa, 1));
  str_cat(out, " Q="), str_cat(out, fmt_num(n, vac.flow_ls, 1));
  str_cat(out, " уст="), str_cat(out, fmt_int(n, SP));
  str_cat(out, " v="), str_cat(out, fmt_num(n, vac.speed_ms, 1));
  str_cat(out, " фильтр="), str_cat(out, fmt_num(n, vac.filter_pa, 0));
  str_cat(out, " R="), str_cat(out, fmt_num(n, vac.r_now, 1));
  str_cat(out, " E1="), str_cat(out, fmt_int(n, (long)vac.wl_mv[0]));
  str_cat(out, " E2="), str_cat(out, fmt_int(n, (long)vac.wl_mv[1]));
}

static void wifi_set(int on) {
  if (on) {
    static const char A[] = "abcdefghjkmnpqrstuvwxyz23456789";
    for (int i = 0; i < 8; i++) vac.pass[i] = A[hal_rand32() % (sizeof A - 1)];
    vac.pass[8] = 0;
    static const char H[] = "0123456789ABCDEF";
    vac.ssid[0] = 0;
    str_cat(vac.ssid, "Pylesos-S3-");
    char h[5] = {H[(vac_cfg.dev_id >> 12) & 15], H[(vac_cfg.dev_id >> 8) & 15], H[(vac_cfg.dev_id >> 4) & 15], H[vac_cfg.dev_id & 15], 0};
    str_cat(vac.ssid, h);
    hal_wifi(1, vac.ssid, vac.pass);
    vac.wifi = 1;
    wifi_until = now_ms + 30u * 60 * 1000;
    char line[96] = "Wi-Fi для телефона: сеть ";
    str_cat(str_cat(str_cat(line, vac.ssid), ", пароль "), vac.pass);
    hal_log(str_cat(line, ", страница http://192.168.4.1 (30 мин)"));
  } else if (vac.wifi) {
    hal_wifi(0, "", "");
    vac.wifi = 0;
    vac.pass[0] = 0;
    hal_log("Wi-Fi выключен");
  }
  link_send_config();
}

static void each_second(void) {
  vac.uptime_s++;
  mains();
  for (int k = 0; k < 2; k++)
    if (vac.pcmd[k] > 0) {
      /* Приведённые часы: износ щёток растёт с мощностью и нагревом. */
      float p = vac.pcmd[k] / 100.0f;
      float w = p * v_sqrtf(p) * (vac.temp[k] > 90 ? 1.5f : 1.0f);
      vac_cfg.hours[k]++;
      wacc[k] += w;
      while (wacc[k] >= 1) vac_cfg.whours[k]++, wacc[k] -= 1;
      if (!hours_dirty_ms) hours_dirty_ms = now_ms;
    }
  if (vac.running) FILT.work_s++;
  if (vac.running && !vac.purging) series_s++;
  /* Наработку — в память раз в 10 минут или после остановки. */
  if (hours_dirty_ms && ((!vac.running && now_ms - hours_dirty_ms > 5000) || now_ms - hours_dirty_ms > 600000)) {
    vac_save_settings();
    hours_dirty_ms = 0;
  }
  if (vac.wifi && (int32_t)(now_ms - wifi_until) >= 0) wifi_set(0);
  if (vac.running || vac.state == VAC_ACTIVE || now_ms - last_status_ms > 10000) {
    char line[360];
    status_line(line);
    hal_log(line);
    last_status_ms = now_ms;
  }
}

/* ---------------- вход ---------------- */

void vac_setup(void) {
  cfg_load();
  vac.mode = vac_cfg.mode == VAC_MANUAL ? VAC_MANUAL : VAC_AUTO;
  vac.state = VAC_STANDBY;
  vac.temp[0] = vac.temp[1] = 25;
  vac.fguess = -1;
  vac.in_health = 100;
  depth_ema = vac_cfg.in_base;
  auto_plan();

  const int outs[] = {PIN_VLV1, PIN_VLV2, PIN_RL1, PIN_RL2, PIN_RL3, PIN_WL_DRV, PIN_BUZZER};
  for (unsigned i = 0; i < sizeof outs / sizeof outs[0]; i++) {
    hal_pin_write(outs[i], 0);
    hal_pin_mode(outs[i], HAL_OUT);
  }
  for (int k = 0; k < 2; k++) hal_pwm(k ? PIN_T2 : PIN_T1, PWM_HZ, 0), pwm_sent[k] = 0;
  hal_pin_mode(PIN_ZC, HAL_IN);
  hal_pin_irq(PIN_ZC);

  hal_i2c_begin(0, PIN_SDA, PIN_SCL, 400000);
  if (exp_init(exp_out) == 0) exp_sent = exp_out;
  sdp_start(SDP_FILTER);
  sdp_start(SDP_FLOW);
  link_init();

  now_ms = hal_millis();
  next_sample = hal_micros();
  hal_log("Контроллер пылесоса S3 " VAC_VERSION " (плата на модулях), ESP32-S3. Команды: help");
  char line[160] = "Настройки: режим ", n2[12];
  str_cat(line, mode_name(vac.mode));
  str_cat(line, ", очистка «"), str_cat(line, PRESET_NAME[vac_cfg.preset]), str_cat(line, "», уставка ");
  str_cat(line, fmt_int(n2, SP));
  str_cat(line, " л/с, фильтр "), str_cat(line, vac_cfg.filt ? "Б" : "А");
  str_cat(line, ", устройств Bluetooth: ");
  str_cat(line, fmt_int(n2, link_ble_count(BLE_REMOTE) + link_ble_count(BLE_TAG)));
  hal_log(line);
}

static uint32_t t10, t50, t200, t1000;

void vac_loop(void) {
  now_ms = hal_millis();
  uint32_t us = hal_micros();
  sample_currents(us);
  water_sample();
  if (watch_until && us - fast_us >= 2000) {
    fast_us = us;
    fast_sample();
  }
  if (now_ms - t10 >= 10) {
    t10 = now_ms;
    control();
  }
  if (now_ms - t50 >= 50) {
    t50 = now_ms;
    sensors();
  }
  if (now_ms - t200 >= 200) {
    t200 = now_ms;
    currents();
  }
  if (now_ms - t1000 >= 1000) {
    t1000 += 1000;
    if (now_ms - t1000 > 1000) t1000 = now_ms;
    each_second();
  }
  if (save_at && (int32_t)(now_ms - save_at) >= 0) {
    save_at = 0;
    vac_save_settings();
  }
  link_poll(now_ms);
  beep_poll();
}

static void line_in(char *buf, int *len, int max, int ch) {
  if (ch == '\r') return;
  if (ch == '\n') {
    buf[*len] = 0;
    if (*len) vac_command(buf);
    *len = 0;
    return;
  }
  if (*len < max - 1) buf[(*len)++] = (char)ch;
}

void vac_serial(int ch) { line_in(serial_line, &serial_len, (int)sizeof serial_line, ch); }
void vac_uart(int ch) { line_in(uart_line, &uart_len, (int)sizeof uart_line, ch); }
/* Экран на самом контроллере (lcd_s3.cpp): свой буфер — его строки не смешаются с байтами UART. */
static char lcd_line[160];
static int lcd_len;
void vac_uart_local(int ch) { line_in(lcd_line, &lcd_len, (int)sizeof lcd_line, ch); }

/* Следующее слово строки. */
static const char *word(const char *s) {
  while (*s && *s != ' ') s++;
  while (*s == ' ') s++;
  return s;
}

static int in_range(long v, long lo, long hi) { return v >= lo && v <= hi; }

static void cfg_changed(void) {
  vac_save_soon();
  link_send_config();
}

static void export_journal(void) {
  char line[200], n[16];
  hal_log("Журнал пылесоса:");
  for (int k = 0; k < 2; k++) {
    line[0] = 0;
    str_cat(line, k ? "  турбина 2: " : "  турбина 1: ");
    str_cat(line, fmt_num(n, vac_cfg.hours[k] / 3600.0f, 1)), str_cat(line, " ч, приведённые ");
    str_cat(line, fmt_num(n, vac_cfg.whours[k] / 3600.0f, 1)), str_cat(line, " ч");
    hal_log(line);
  }
  line[0] = 0;
  str_cat(line, "  ударов клапанов: "), str_cat(line, fmt_int(n, (long)vac_cfg.pulse_count));
  str_cat(line, ", с замены фильтра клапанов: "), str_cat(line, fmt_int(n, (long)vac_cfg.in_pulses));
  str_cat(line, ", сила удара "), str_cat(line, fmt_num(n, vac.in_health, 0)), str_cat(line, " %");
  hal_log(line);
  for (int i = 0; i < N_FILTERS; i++) {
    const vac_filter_t *f = &vac_cfg.f[i];
    line[0] = 0;
    str_cat(line, i ? "  фильтр Б" : "  фильтр А"), str_cat(line, vac_cfg.filt == i ? " (стоит): " : ": ");
    str_cat(line, "R нового "), str_cat(line, fmt_num(n, f->r_new, 1));
    str_cat(line, ", R сейчас "), str_cat(line, fmt_num(n, f->r_base, 1));
    str_cat(line, ", моек "), str_cat(line, fmt_int(n, f->washes));
    str_cat(line, ", "), str_cat(line, fmt_num(n, f->work_s / 3600.0f, 1)), str_cat(line, " ч, ударов "), str_cat(line, fmt_int(n, (long)f->pulses));
    hal_log(line);
  }
  line[0] = 0;
  str_cat(line, "  R по сменам:");
  for (int i = 0; i < vac_cfg.nrh; i++) str_cat(line, " "), str_cat(line, fmt_num(n, vac_cfg.rhist[i] / 10.0f, 1));
  hal_log(line);
}

static void apply_preset(int i) {
  char line[64] = "Режим очистки: ";
  vac_cfg.preset = (uint8_t)i;
  series_s = 0;
  auto_plan();
  hal_log(str_cat(line, PRESET_NAME[i]));
  cfg_changed();
}

/* «filter а|б new|washed|blown» — какой фильтр поставили и каким. */
static void filter_cmd(const char *a) {
  int filt = a[0] == 'b' || a[0] == 'B' || str_starts(a, "б") || str_starts(a, "Б") ? 1 : a[0] == 'a' || a[0] == 'A' || str_starts(a, "а") || str_starts(a, "А") ? 0 : -1;
  const char *b = filt < 0 ? a : word(a);
  if (filt < 0) filt = vac_cfg.filt;
  int kind = str_eq(b, "new") ? FS_NEW : str_eq(b, "washed") ? FS_WASHED : str_eq(b, "blown") ? FS_BLOWN : str_eq(b, "use") ? 0 : -1;
  if (kind < 0) return;
  if (!kind) {
    vac_cfg.filt = (uint8_t)filt;
    hal_log(filt ? "Стоит фильтр Б" : "Стоит фильтр А");
    cfg_changed();
    return;
  }
  fm_begin(filt, kind);
  link_send_config();
}

void vac_command(const char *c) {
  char line[240];
  const char *a = word(c);
  long v = str_to_int(a);
  if (str_eq(c, "hi")) {
    link_on_hello();
  } else if (str_eq(c, "get")) {
    link_on_hello();
    link_send_config();
    link_send_journal();
  } else if (str_eq(c, "help")) {
    hal_log("Команды: status, start, stop, t1 0|1, t2 0|1, off [now], wake, mode a|m, sp 10…60, pw 30…100, t2allow 0|1,");
    hal_log("  preset 0…6, pset I SP N EVERY IMP PAUSE FLAGS, set n|every|imp|pause|thr|dp|strong|wl|stag N (dp — порог перепада, Па, 0 — авто), clean a|o, coff 0|1, hauto 0|1,");
    hal_log("  purge, purge strong, filter а|б new|washed|blown|use, filter swap, bag 0|1|new, intake new, pulses reset,");
    hal_log("  tool auto|thr|runon|end|limit|delay|free N, sock cap|off|on, ble pair, ble forget N, wifi on|off, cfg export|import, ack, export");
    hal_log("  lcd flip (экран на 180°), lcd cal (калибровка касания), lcd off|on (экран на контроллере)");
  } else if (str_eq(c, "status")) {
    status_line(line);
    hal_log(line);
    for (uint32_t b = 1; b && b <= (uint32_t)F_LAST; b <<= 1)
      if (vac.faults & b) {
        line[0] = 0;
        str_cat(line, "  ! ");
        str_cat(line, vac_fault_text(b));
        hal_log(line);
      }
  } else if (str_eq(c, "start")) {
    if (vac.state == VAC_STANDBY) vac_turbine(-1, 1);
  } else if (str_eq(c, "stop")) {
    if (vac.state == VAC_ACTIVE) vac_turbine(-1, 0);
  } else if (str_starts(c, "t1 ") || str_starts(c, "t2 ")) {
    vac_turbine(c[1] == '2', v ? 1 : 0);
  } else if (str_eq(c, "off")) {
    vac_power_off(0);
  } else if (str_eq(c, "off now")) {
    vac_power_off(1);
  } else if (str_eq(c, "wake")) {
    vac_wake();
  } else if (str_starts(c, "mode ") || str_eq(c, "auto") || str_eq(c, "manual")) {
    char m = str_eq(c, "auto") ? 'a' : str_eq(c, "manual") ? 'm' : a[0];
    if (m == 'a' || m == 'm') vac_set_mode(m == 'a' ? VAC_AUTO : VAC_MANUAL), link_send_config();
  } else if (str_starts(c, "sp ")) {
    if (in_range(v, 10, 60)) SP = (uint8_t)v, cfg_changed();
  } else if (str_starts(c, "pw ") || str_starts(c, "power ")) {
    if (in_range(v, 30, 100)) vac_cfg.power = (uint8_t)v, cfg_changed();
  } else if (str_starts(c, "t2allow ")) {
    vac_cfg.t2 = v ? 1 : 0, cfg_changed();
  } else if (str_starts(c, "clean ")) {
    vac_cfg.clean_auto = a[0] == 'a';
    hal_log(vac_cfg.clean_auto ? "Автоочистка включена" : "Автоочистка выключена");
    cfg_changed();
  } else if (str_starts(c, "coff ")) {
    vac_cfg.clean_off = v ? 1 : 0;
    hal_log(v ? "Удары при остановке включены" : "Удары при остановке выключены");
    cfg_changed();
  } else if (str_starts(c, "hauto ")) {
    vac_cfg.hose_auto = v ? 1 : 0;
    hal_log(v ? "Мощная очистка по закрытому шлангу: включена" : "Мощная очистка по закрытому шлангу: выключена");
    cfg_changed();
  } else if (str_starts(c, "set ")) {
    const char *b = word(a);
    long x = str_to_int(b);
    if (str_starts(a, "n ") && in_range(x, 0, 10)) PRESET.n = (uint8_t)x;
    else if (str_starts(a, "every ") && in_range(x, 0, 600)) PRESET.every = (uint16_t)(x && x < 5 ? 5 : x);
    else if (str_starts(a, "imp ") && in_range(x, 0, 300)) PRESET.imp = (uint16_t)(x && x < 20 ? 20 : x);
    else if (str_starts(a, "pause ") && in_range(x, 0, 3000)) PRESET.pause = (uint16_t)(x && x < 100 ? 100 : x);
    else if (str_starts(a, "hose ")) PRESET.flags = (uint8_t)(x ? PRESET.flags | PF_HOSE : PRESET.flags & ~PF_HOSE);
    else if (str_starts(a, "thr ") && in_range(x, 105, 200)) vac_cfg.thr = (uint16_t)x;
    else if (str_starts(a, "dp ") && (x == 0 || in_range(x, 20, 2000))) {
      vac_cfg.dp_on = (uint16_t)x;
      char line[160] = "Очистка ", n[12];
      if (!x) str_cat(line, "по росту сопротивления фильтра («авто»)");
      else {
        str_cat(line, "по перепаду: "), str_cat(line, fmt_int(n, x)), str_cat(line, " Па при "), str_cat(line, fmt_int(n, (long)sp_ls())), str_cat(line, " л/с");
        if (vac_dp_clean() > 0) str_cat(line, ", чистый фильтр — "), str_cat(line, fmt_int(n, (long)(vac_dp_clean() + 0.5f))), str_cat(line, " Па");
      }
      hal_log(line);
    }
    else if (str_starts(a, "strong ") && in_range(x, 1, 10)) vac_cfg.strong_n = (uint8_t)x;
    else if (str_starts(a, "wl ") && in_range(x, 50, 1500)) vac_cfg.wl_mv = (uint16_t)x;
    else if (str_starts(a, "stag ") && in_range(x, 0, 5000)) vac_cfg.stagger_ms = (uint16_t)x;
    else return;
    auto_plan();
    cfg_changed();
  } else if (str_starts(c, "pset ")) {
    /* pset I SP N EVERY IMP PAUSE FLAGS */
    long f[7];
    const char *p = a;
    for (int i = 0; i < 7; i++) f[i] = str_to_int(p), p = word(p);
    if (in_range(f[0], 0, N_PRESETS - 1) && in_range(f[1], 10, 60) && in_range(f[2], 0, 10) && in_range(f[3], 0, 600) && in_range(f[4], 0, 300) && in_range(f[5], 0, 3000) && in_range(f[6], 0, 255)) {
      vac_preset_t *r = &vac_cfg.pr[f[0]];
      r->sp = (uint8_t)f[1], r->n = (uint8_t)f[2], r->every = (uint16_t)f[3], r->imp = (uint16_t)f[4], r->pause = (uint16_t)f[5], r->flags = (uint8_t)f[6];
      auto_plan();
      cfg_changed();
    }
  } else if (str_eq(c, "preset reset")) {
    for (int i = 0; i < N_PRESETS; i++) vac_cfg.pr[i] = PRESET_DEF[i];
    auto_plan();
    hal_log("Режимы очистки — заводские");
    cfg_changed();
  } else if (str_starts(c, "preset ")) {
    if (in_range(v, 0, N_PRESETS - 1)) apply_preset((int)v);
  } else if (str_eq(c, "purge")) {
    vac_purge_now(PURGE_SERIES);
  } else if (str_eq(c, "purge full") || str_eq(c, "purge strong")) {
    vac_purge_now(PURGE_STRONG);
  } else if (str_eq(c, "filter new")) {
    fm_begin(vac_cfg.filt, FS_NEW);
    link_send_config();
  } else if (str_eq(c, "filter swap")) {
    /* Замер оказался другого фильтра: переносим его в паспорт другого, свой — как было. */
    if (vac.fguess >= 0 && fm_kind != 9) {
      vac_filter_t *f = &vac_cfg.f[fm_filt], *o = &vac_cfg.f[vac.fguess];
      o->r_base = vac.fm_r;
      o->state = fm_kind;
      if (fm_kind == FS_WASHED) o->washes++, f->washes = f->washes ? f->washes - 1 : 0;
      f->r_base = fm_prev_base;
      f->state = fm_prev_state;
      vac_cfg.filt = (uint8_t)vac.fguess;
      vac.fm_pct = o->r_new > 0 ? (o->r_new / vac.fm_r * 100 > 100 ? 100 : o->r_new / vac.fm_r * 100) : 100;
      fm_filt = vac_cfg.filt;
      vac.fguess = -1;
      hal_log(vac_cfg.filt ? "Замер записан фильтру Б" : "Замер записан фильтру А");
      cfg_changed();
    }
  } else if (str_starts(c, "filter ")) {
    filter_cmd(a);
  } else if (str_eq(c, "bag new")) {
    fm_begin(vac_cfg.filt, 9);
  } else if (str_starts(c, "bag ")) {
    vac_cfg.bag = v ? 1 : 0;
    hal_log(v ? "Мешок стоит" : "Без мешка");
    cfg_changed();
  } else if (str_eq(c, "intake new")) {
    vac_cfg.in_base = 0;
    vac_cfg.in_pulses = 0;
    vac.in_health = 100;
    set_fault(F_INTAKE, 0);
    hal_log("Фильтр клапанов новый: сила удара определится за 20 ударов");
    cfg_changed();
  } else if (str_eq(c, "pulses reset")) {
    vac_cfg.pulse_count = 0;
    hal_log("Счётчик ударов сброшен");
    vac_save_soon();
  } else if (str_starts(c, "tool ")) {
    const char *b = word(a);
    long x = str_to_int(b);
    if (str_starts(a, "auto ")) vac_cfg.tool_auto = x ? 1 : 0;
    else if (str_starts(a, "thr ") && in_range(x, 1, 50)) vac_cfg.tool_thr = (uint8_t)x;
    else if (str_starts(a, "runon ") && in_range(x, 0, 30)) vac_cfg.tool_runon = (uint8_t)x;
    else if (str_starts(a, "end ") && in_range(x, 0, 10)) vac_cfg.tool_end = (uint8_t)x;
    else if (str_starts(a, "limit ") && in_range(x, 10, 32)) vac_cfg.limit_a = (uint8_t)x;
    else if (str_starts(a, "delay ") && in_range(x, 0, 3000)) vac_cfg.tool_delay = (uint16_t)x;
    else if (str_starts(a, "free ")) vac_cfg.sock_free = x ? 1 : 0;
    else return;
    cfg_changed();
  } else if (str_eq(c, "sock cap")) {
    /* Решение по перегрузке: турбины ограничить и включить розетку. */
    if (vac.ov == OV_TRIP && vac.ov_cap) {
      vac.cap = vac.ov_cap;
      if (vac.ov_one && vac.en[0] && vac.en[1]) vac.en[1] = 0, sync_state();
      vac.ov = OV_NONE;
      sock_lock = 0;
      char s[160] = "Турбины ограничены до ", n[8];
      str_cat(str_cat(s, fmt_int(n, vac.cap)), " %");
      if (vac.ov_one) str_cat(s, ", работает одна");
      hal_log(str_cat(s, " — розетка включена"));
    }
  } else if (str_eq(c, "sock off")) {
    vac.ov = OV_NONE;
    sock_lock = 1;
    hal_log("Розетка выключена (включить — на экране «Розетка»)");
  } else if (str_eq(c, "sock on")) {
    vac.ov = OV_NONE;
    sock_lock = 0;
    hal_log("Розетка включена");
  } else if (str_eq(c, "ble pair") || str_eq(c, "remote pair")) {
    link_pair(60);
  } else if (str_starts(c, "ble forget ")) {
    if (in_range(v, 0, N_BLE - 1) && vac_cfg.ble[v].kind) {
      vac_cfg.ble[v].kind = BLE_NONE;
      vac.tags_on &= (uint8_t)~(1 << v);
      hal_log("Устройство отвязано");
      vac_save_settings();
      link_send_config();
    }
  } else if (str_eq(c, "remote forget")) {
    for (int i = 0; i < N_BLE; i++)
      if (vac_cfg.ble[i].kind == BLE_REMOTE) vac_cfg.ble[i].kind = BLE_NONE;
    vac.remote = 0;
    hal_log("Беспроводной пульт отвязан");
    vac_save_settings();
    link_send_config();
  } else if (str_eq(c, "wifi on")) {
    wifi_set(1);
  } else if (str_eq(c, "wifi off")) {
    wifi_set(0);
  } else if (str_eq(c, "cfg export")) {
    static char hex[sizeof(vac_settings_t) * 2 + 4];
    vac_cfg_export(hex, (int)sizeof hex);
    hal_log("Настройки (резервная копия):");
    hal_log(hex);
  } else if (str_starts(c, "cfg import ")) {
    int r = vac_cfg_import(a + 7);
    if (r) hal_log(r == 1 ? "Резервная копия не прочитана" : "Резервная копия от другой версии или испорчена");
    else vac.mode = vac_cfg.mode == VAC_MANUAL ? VAC_MANUAL : VAC_AUTO, auto_plan(), link_send_config();
  } else if (str_eq(c, "ack")) {
    /* Сброс защёлкнутых аварий: перегрузка и пробой (блокировка), «пора мыть», порванный фильтр, клапаны. */
    lock_until[0] = lock_until[1] = 0;
    valve_bad_dp = 0;
    stuck_n = 0;
    band_k = 1;
    const uint32_t ack = F_OVER1 | F_OVER2 | F_LEAK1 | F_LEAK2 | F_FILTER | F_TORN | F_VALVE1 | F_VALVE2 | F_NOCUR1 | F_NOCUR2 | F_STUCK;
    for (uint32_t b = 1; b && b <= (uint32_t)F_LAST; b <<= 1)
      if (ack & b) set_fault(b, 0);
    vac.verr[0] = vac.verr[1] = VE_OK;
    /* Клапаны проверятся по одному в ближайшей серии. */
    diag_req = 1;
    hal_log("Аварии сброшены");
  } else if (str_starts(c, "lcd")) {
    hal_lcd(c);
  } else if (str_eq(c, "export")) {
    export_journal();
  } else {
    line[0] = 0;
    str_cat(line, "Не понял: ");
    str_cat(line, c);
    str_cat(line, " (help — список команд)");
    hal_log(line);
  }
}

static char *json_num(char *out, const char *key, float v, int dec) {
  char n[20];
  str_cat(out, "\"");
  str_cat(out, key);
  str_cat(out, "\":");
  fmt_num(n, v, dec);
  for (char *p = n; *p; p++)
    if (*p == ',') *p = '.';
  return str_cat(out, n), str_cat(out, ",");
}

int vac_status_json(char *buf, int len) {
  char out[1100];
  out[0] = 0;
  str_cat(out, "{");
  json_num(out, "state", vac.state, 0);
  json_num(out, "sleep", vac.sleep, 0);
  json_num(out, "mode", vac.mode, 0);
  json_num(out, "preset", vac_cfg.preset, 0);
  json_num(out, "en1", vac.en[0], 0);
  json_num(out, "en2", vac.en[1], 0);
  json_num(out, "k1", vac.relay[0], 0);
  json_num(out, "k2", vac.relay[1], 0);
  json_num(out, "sock", vac.sock, 0);
  json_num(out, "running", vac.running, 0);
  json_num(out, "purging", vac.purging, 0);
  json_num(out, "sp", SP, 0);
  json_num(out, "power", vac_cfg.power, 0);
  json_num(out, "p1", vac.pcmd[0], 0);
  json_num(out, "p2", vac.pcmd[1], 0);
  json_num(out, "i1", vac.amps[0], 2);
  json_num(out, "i2", vac.amps[1], 2);
  json_num(out, "itool", vac.tool_amps, 2);
  json_num(out, "itotal", vac.total_amps, 1);
  json_num(out, "tool", vac.tool, 0);
  json_num(out, "ov", vac.ov, 0);
  json_num(out, "cap", vac.cap, 0);
  json_num(out, "t1", vac.temp[0], 1);
  json_num(out, "t2", vac.temp[1], 1);
  json_num(out, "mains", vac.mains_v, 0);
  json_num(out, "vacuum", vac.vacuum_kpa, 2);
  json_num(out, "flow", vac.flow_ls, 1);
  json_num(out, "speed", vac.speed_ms, 1);
  json_num(out, "filter", vac.filter_pa, 0);
  json_num(out, "r", vac.r_now, 1);
  json_num(out, "load", vac.load, 0);
  json_num(out, "filt", vac_cfg.filt, 0);
  json_num(out, "rnew", FILT.r_new, 1);
  json_num(out, "washes", FILT.washes, 0);
  json_num(out, "intake", vac.in_health, 0);
  json_num(out, "imp", vac.imp_now, 0);
  json_num(out, "every", vac.every_now, 0);
  json_num(out, "n", vac.n_now, 0);
  json_num(out, "water", vac.water, 0);
  json_num(out, "e1", vac.wl_mv[0], 0);
  json_num(out, "e2", vac.wl_mv[1], 0);
  json_num(out, "float", vac.float_on, 0);
  json_num(out, "panel", vac.panel, 0);
  json_num(out, "remote", vac.remote, 0);
  char fa[16];
  str_cat(str_cat(str_cat(out, "\"faults\":"), fmt_int(fa, (long)vac.faults)), ",");
  int n = str_len(out);
  out[n - 1] = '}';
  if (n + 1 > len) return 0;
  for (int i = 0; i <= n; i++) buf[i] = out[i];
  return n;
}
