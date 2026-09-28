/*
 * Ядро прошивки: синхронизация с сетью, реле и фазовое управление турбинами с плавным
 * и поочерёдным пуском, проверка симисторов и реле по току, регулятор расхода (ПИ, вторая
 * турбина — по потребности), отбивка фильтра ударами клапанов (по времени, по R, при
 * выключении), обучение сопротивления фильтра, электроды и поплавок бака, пресеты,
 * журнал наработки, измерения и защиты.
 * Не зависит от Arduino: железо — через vac_hal.h.
 */
#include "vac_core.h"

vac_settings_t vac_cfg;
vac_state_t vac;

/*
 * Мощность (% от полной) → задержка включения симистора в долях 1/10000 полупериода:
 * P(α) = 1 − α/π + sin 2α / 2π для активной нагрузки.
 */
static const uint16_t PHASE[101] = {
    10000, 8840, 8531, 8310, 8132, 7980, 7846, 7724, 7612, 7508, 7411, 7319, 7231, 7147, 7067, 6990, 6915, 6842, 6772, 6704, 6637,
    6572,  6508, 6445, 6384, 6324, 6264, 6206, 6149, 6092, 6036, 5980, 5926, 5871, 5818, 5765, 5712, 5659, 5607, 5556, 5504, 5453,
    5402,  5351, 5301, 5251, 5200, 5150, 5100, 5050, 5000, 4950, 4900, 4850, 4800, 4749, 4699, 4649, 4598, 4547, 4496, 4444, 4393,
    4341,  4288, 4235, 4182, 4129, 4074, 4020, 3964, 3908, 3851, 3794, 3736, 3676, 3616, 3555, 3492, 3428, 3363, 3296, 3228, 3158,
    3085,  3010, 2933, 2853, 2769, 2681, 2589, 2492, 2388, 2276, 2154, 2020, 1868, 1690, 1469, 1160, 0};

/* Схема: трансформаторы тока 1000:1, нагрузки 68, 68 и 200 Ом на середину 1,65 В. */
static const float CT_OHMS[3] = {68.0f, 68.0f, 200.0f};
static const int CT_PIN[3] = {PIN_CT1, PIN_CT2, PIN_CT3};
/* Детектор нуля: порог = Uбэ·(47к + 10к)/10к, выпрямитель −1,4 В, трансформатор 230/9 В, на холостом ходу +15 %. */
#define ZC_VTH 3.705f
#define ZC_KTR (230.0f / (9.0f * 1.41421356f * 1.15f))
/* Раскачка электродов: полупериод в тактах по 100 мкс (600 мкс — 833 Гц). */
#define WL_HALF 6

/* ---------------- синхронизация, импульсы, раскачка (прерывания) ---------------- */

static volatile uint32_t zc_rise, zc_count;
static volatile uint32_t zc_width = 1800;   /* ширина импульса нуля, мкс */
static volatile uint32_t zc_half = 10000;   /* полупериод, мкс */
static volatile uint32_t fire_at[2], gate_off[2];
static volatile uint8_t armed[2], gate_on[2];
static volatile uint16_t fire_delay[2] = {0xFFFF, 0xFFFF}; /* 0xFFFF — не включать */
static volatile uint8_t tick_div, wl_div, wl_lvl;
static volatile uint32_t wl_edge, wl_phase;
/* Без таблицы: её константы ушли бы во флеш, а код в прерывании должен работать и во время записи во флеш. */
#define GATE_PIN(ch) ((ch) ? PIN_T2 : PIN_T1)

VAC_ISR void vac_on_pin(int pin, int level, uint32_t us) {
  if (pin != PIN_ZC) return;
  if (level) {
    /* Начало импульса: до перехода через ноль — половина его ширины. */
    uint32_t per = us - zc_rise;
    zc_rise = us;
    if (per > 7000 && per < 12500) zc_half = (zc_half * 7 + per) / 8;
    uint32_t t0 = us + zc_width / 2 + (uint32_t)(int32_t)vac_cfg.zc_shift_us;
    for (int ch = 0; ch < 2; ch++) {
      uint16_t d = fire_delay[ch];
      if (d == 0xFFFF) {
        armed[ch] = 0;
        continue;
      }
      fire_at[ch] = t0 + d;
      armed[ch] = 1;
    }
    zc_count++;
  } else {
    uint32_t w = us - zc_rise;
    if (w > 100 && w < 5000) zc_width = (zc_width * 3 + w) / 4;
  }
}

VAC_ISR void vac_tick(void) {
  uint32_t now = hal_micros();
  for (int ch = 0; ch < 2; ch++) {
    if (armed[ch] && (int32_t)(now - fire_at[ch]) >= 0) {
      armed[ch] = 0;
      if ((int32_t)(now - fire_at[ch]) < 2000) {
        hal_pin_write(GATE_PIN(ch), 1);
        gate_on[ch] = 1;
        gate_off[ch] = now + 300;
      }
    }
    if (gate_on[ch] && (int32_t)(now - gate_off[ch]) >= 0) {
      hal_pin_write(GATE_PIN(ch), 0);
      gate_on[ch] = 0;
    }
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
#define CFG_VERSION 3

static uint8_t cfg_crc(const vac_settings_t *s) {
  const uint8_t *p = (const uint8_t *)s;
  unsigned n = (unsigned)((const uint8_t *)&s->crc - p);
  uint8_t c = 0x5A;
  for (unsigned i = 0; i < n; i++) c = (uint8_t)((c << 1 | c >> 7) ^ p[i]);
  return c;
}

/* Пресеты: бетон (сухая резка), бурение, гипс, уборка — уставка, период серий, отбивка. */
static const uint8_t PRESET_SP[N_PRESETS] = {36, 30, 32, 28};
static const uint16_t PRESET_PER[N_PRESETS] = {0, 0, 0, 60};
static const uint16_t PRESET_TAP[N_PRESETS] = {15, 30, 20, 0};

static void cfg_defaults(void) {
  vac_settings_t d = {0};
  d.magic = CFG_MAGIC;
  d.version = CFG_VERSION;
  d.mode = VAC_AUTO;
  d.sp = 32;
  d.power = 80;
  d.t2 = 1;
  d.softstart = 20;
  d.clean_auto = 1;
  d.clean_off = 1;
  d.pulses = 4;
  d.preset = 0xFF;
  d.imp_ms = 100;
  d.pause_ms = 400;
  d.thr = 150;
  d.boost_ms = 500;
  d.period = 0;
  d.tap_s = 0;
  for (int i = 0; i < N_PRESETS; i++) d.psp[i] = PRESET_SP[i], d.pper[i] = PRESET_PER[i], d.ptap[i] = PRESET_TAP[i];
  d.min_speed = 12;
  d.hose_mm = 36;
  d.zc_shift_us = 0;
  d.mains_cal = 1000;
  d.flow_k10 = 216;
  d.brush_h = 800;
  d.wl_mv = 300;
  d.stagger_ms = 1500;
  vac_cfg = d;
}

void vac_save_settings(void) {
  vac_cfg.crc = cfg_crc(&vac_cfg);
  hal_settings_save(&vac_cfg, sizeof vac_cfg);
}

/* Отложенная запись: энкодер крутят быстро, а флеш-память любит редкие записи. */
static uint32_t now_ms, save_at;
void vac_save_soon(void) {
  save_at = now_ms + 2000;
  if (!save_at) save_at = 1;
}
uint32_t vac_now_ms(void) { return now_ms; }

/* ---------------- измерения ---------------- */

/* Токи: выборки без привязки к сети (шаг 1037 мкс), СКЗ за 200 мс; пики — для проверок реле. */
static uint32_t next_sample;
static float ct_offset[3] = {1650, 1650, 1650};
static float ct_sum2[3], ct_peak[3];
static uint32_t ct_n;
/* Удар клапана: ток в первые 40 мс (втягивание) и дальше (удержание). */
static int vk = -1;
static uint32_t v_open_us;
static float v_s2[2];
static uint32_t v_n[2];

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
    if (i == 2 && vk >= 0) {
      int late = us - v_open_us >= 40000;
      v_s2[late] += d * d;
      v_n[late]++;
    }
  }
  ct_n++;
}

/* Пик тока с последнего сброса, А (СКЗ синусоиды с таким пиком). */
static float peak_amps(int i) { return ct_peak[i] > 12 ? ct_peak[i] / CT_OHMS[i] / 1.41421356f : 0; }

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

/* ---------------- состояние управления ---------------- */

static uint32_t last_zc_ms, seen_zc;
static int zc_ok;
static uint32_t ts_t[2];         /* время входа в состояние реле/симистора */
static uint32_t on_since[2];     /* когда турбина пошла в работу (для поочерёдного пуска) */
static uint32_t lock_until[2];
static uint8_t cnt_over[2], cnt_nocur[2];
static uint32_t lowair_since, blocked_since, run_since, torn_since, vleak_since;
static uint32_t hours_dirty_ms;
static int sdp_err[2];
static uint32_t worked_ms;       /* сколько работали с последнего пуска */
static float wacc[2];            /* доли приведённой секунды */
static int shift_logged;         /* в этой смене уже есть точка R в журнале */
static uint32_t pulse_quiet_until; /* после удара поток не устоялся — R не меряем */
static uint8_t valve_bad[2];     /* ударов подряд без нормального тока */
static float pa_before, pa_min;  /* перепад перед ударом и наименьший во время удара */
static uint8_t valve_no_dp[2];   /* ударов подряд без броска перепада */

/* Регулятор расхода: u — суммарная мощность в % одной турбины (до 200 с двумя).
 * Коэффициенты: % на л/с и % на л/с за секунду. */
#define KP 2.0f
#define KI 1.6f
static float u_pid = 60, e_prev;
static uint32_t dual_since, single_since;
static float q_single;           /* сколько дала одна турбина на полной мощности, л/с */
static uint32_t start_ms;
static int spin_prev;

/* Продувка: этапы. */
enum { PH_SPIN, PH_BOOST, PH_OPEN, PH_PAUSE, PH_GAP, PH_SETTLE };
static int ph, purge_spin, series_left, pulse_i, pulses_now, next_valve, after_purge;
static uint8_t spin_mask;        /* какие турбины крутятся во время продувки */
static uint32_t ph_t, last_series_ms, series_s, tap_s;
enum { AFTER_NONE, AFTER_STOP, AFTER_SLEEP };

static int is_warning(uint32_t bit) {
  return !!(bit & (F_LOWAIR | F_BLOCKED | F_FILTER | F_MAINS | F_WARM1 | F_WARM2 | F_NTC1 | F_NTC2 | F_VALVE1 | F_VALVE2 | F_PROBE | F_EXP | F_SDP_F | F_SDP_Q | F_VAC));
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
  case F_VALVE1: return "Клапан 1 не срабатывает";
  case F_VALVE2: return "Клапан 2 не срабатывает";
  case F_TORN: return "Фильтр порван или не стоит";
  case F_EXP: return "Нет связи с кнопками";
  case F_PROBE: return "Электроды: проверьте";
  }
  return "?";
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

static void led(void) {
  uint32_t t = now_ms;
  int on;
  if (vac.faults & ~(uint32_t)(F_LOWAIR | F_FILTER | F_WARM1 | F_WARM2)) on = (t / 100) & 1;  /* неисправность — часто */
  else if (vac.sleep) on = t % 5000 < 40;                                                     /* сон — вспышка раз в 5 с */
  else if (vac.running) on = 1;
  else on = t % 2000 < 100;                                                                   /* готов — раз в 2 с */
  hal_pin_write(PIN_LED, on);
}

/* ---------------- команды ---------------- */

static const char *mode_name(int m) { return m == VAC_AUTO ? "авто (расход)" : "ручной"; }

static int blocked_by_fault(void) { return !!(vac.faults & (F_WATER | F_OVERFLOW | F_TORN | F_WELD1 | F_WELD2)); }

static void sync_state(void) { vac.state = !vac.sleep && (vac.en[0] || vac.en[1]) ? VAC_ACTIVE : VAC_STANDBY; }

static void purge_finish(const char *why) {
  vac.purging = PURGE_NONE;
  vac.pulse_no = 0;
  vac.valve[0] = vac.valve[1] = 0;
  purge_spin = 0;
  vac.shutdown = 0;
  hal_log(why);
  int after = after_purge;
  after_purge = AFTER_NONE;
  if (after == AFTER_SLEEP) vac_power_off(1);
}

/* Остановка: после долгой работы — сначала очистка (турбины ещё крутятся), потом стоп. */
static void stop_all(int after) {
  int clean = vac_cfg.clean_off && vac.running && worked_ms > 30000 && zc_ok && !blocked_by_fault() && vac.purging != PURGE_OFF;
  vac.en[0] = vac.en[1] = 0;
  sync_state();
  if (clean) {
    if (vac.purging) purge_finish("Продувка прервана: очистка перед остановкой");
    vac.purging = PURGE_OFF;
    vac.shutdown = 1;
    after_purge = after;
    series_left = 1;
    pulses_now = vac_cfg.pulses * 2;
    spin_mask = (uint8_t)((vac.pcmd[0] > 0 ? 1 : 0) | (vac.pcmd[1] > 0 ? 2 : 0));
    purge_spin = 1;
    ph = PH_BOOST;
    ph_t = now_ms;
    vac.r_before = vac.r_now;
    hal_log("Очистка фильтра перед остановкой");
    return;
  }
  if (after == AFTER_SLEEP) vac_power_off(1);
}

void vac_turbine(int k, int on) {
  if (vac.sleep) vac_wake();
  if (on && vac.purging == PURGE_OFF) {
    after_purge = AFTER_NONE;
    purge_finish("Очистка перед остановкой прервана: пуск");
  }
  if (on && blocked_by_fault()) {
    hal_log("Пуск запрещён: сначала устраните аварию");
    vac_beep(2);
    return;
  }
  if (k < 0) {
    if (on) {
      vac.en[0] = 1;
      vac.en[1] = vac_cfg.t2;
    } else {
      stop_all(AFTER_STOP);
      vac_beep(0);
      return;
    }
  } else {
    if (!on && vac.en[k] && !vac.en[k ^ 1]) {
      stop_all(AFTER_STOP);
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
    stop_all(AFTER_SLEEP);
    return;
  }
  if (vac.purging) {
    after_purge = AFTER_NONE;
    purge_finish("Продувка прервана: выключение");
  }
  vac.en[0] = vac.en[1] = 0;
  vac.sleep = 1;
  vac.pairing = 0;
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

static void purge_begin(int kind, int after) {
  vac.purging = (uint8_t)kind;
  after_purge = after;
  series_left = kind == PURGE_FULL ? 3 : 1;
  pulses_now = kind == PURGE_TAP ? 1 : vac_cfg.pulses;
  ph = kind == PURGE_TAP ? PH_BOOST : PH_SPIN;
  ph_t = now_ms;
  purge_spin = kind != PURGE_TAP;
  spin_mask = (uint8_t)((vac.pcmd[0] > 0 || vac.en[0] ? 1 : 0) | (vac.pcmd[1] > 0 || vac.en[1] ? 2 : 0));
  if (!spin_mask) spin_mask = (uint8_t)(1 | (vac_cfg.t2 ? 2 : 0));
  vac.pulse_no = 0;
}

void vac_purge_now(int kind) {
  if (vac.purging && vac.purging != PURGE_TAP) {
    /* Повторная команда — отмена. */
    after_purge = AFTER_NONE;
    purge_finish("Продувка отменена");
    vac_beep(0);
    return;
  }
  if (vac.purging == PURGE_TAP) purge_finish("Удар отбивки прерван");
  if (!zc_ok) {
    hal_log("Продувка невозможна: нет сети");
    return;
  }
  if (vac.faults & (F_WATER | F_OVERFLOW)) {
    hal_log("Продувка невозможна: бак полон");
    vac_beep(2);
    return;
  }
  purge_begin(kind == PURGE_FULL ? PURGE_FULL : PURGE_SERIES, AFTER_NONE);
  hal_log(kind == PURGE_FULL ? "Полная продувка: три серии" : vac.running ? "Продувка: серия ударов" : "Продувка: разгон турбин");
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

/* Конец серии: R после ударов, обучение R нового фильтра, порог мойки. */
static void series_done(void) {
  vac.purges++;
  last_series_ms = now_ms;
  series_s = 0;
  if (vac.flow_ls > 8 && vac.r_now > 0) {
    vac.r_after = vac.r_now;
    if (vac_cfg.r_new <= 0 || vac.r_after < vac_cfg.r_new) vac_cfg.r_new = vac.r_after;
    float wash = vac_cfg.r_new * 2.5f;
    if (vac.r_after > wash) set_fault(F_FILTER, 1);
    else if (vac.r_after < wash * 0.9f) set_fault(F_FILTER, 0);
    rhist_put(vac.r_after);
  }
  if (!hours_dirty_ms) hours_dirty_ms = now_ms;
  char line[80] = "Продувка закончена: R ", n[12];
  str_cat(line, fmt_num(n, vac.r_before, 1));
  str_cat(line, " → ");
  str_cat(line, fmt_num(n, vac.r_after, 1));
  purge_finish(line);
}

/* Клапаны под напряжением: реле K1 замкнуто и проверено (турбина 1 работает или реле держится на продувку). */
static int valves_ready(void) { return vac.relay[0] && (vac.ts[0] == TS_RUN || vac.ts[0] == TS_HOLD); }

/* Удар: клапаны по очереди — каждый продувает свою половину фильтра. */
static void valve_open(int k) {
  vac.valve[k] = 1;
  pa_before = pa_min = vac.filter_pa;
}

/* Клапан закрылся: ток катушки (втягивание и удержание) и бросок перепада на фильтре. */
static void valve_closed(int k) {
  if (vk != k) return;
  float in = v_n[0] ? v_sqrtf(v_s2[0] / (float)v_n[0]) / CT_OHMS[2] : 0;
  float hold = v_n[1] ? v_sqrtf(v_s2[1] / (float)v_n[1]) / CT_OHMS[2] : in;
  vk = -1;
  vac.valve_in[k] = in;
  vac.valve_hold[k] = hold;
  /* Нет тока — обрыв катушки, предохранитель FU2 или симистор; ток втягивания не падает — якорь не втянулся. */
  int bad = in < 0.08f || (vac_cfg.imp_ms >= 80 && in > 0.25f && hold > in * 0.92f);
  valve_bad[k] = bad ? (uint8_t)(valve_bad[k] + 1) : 0;
  /* Воздух пошёл обратно через фильтр — перепад на нём проседает; не просел — клапан не открылся. */
  int dp_bad = vac_cfg.imp_ms >= 80 && pa_before > 60 && !(vac.faults & F_SDP_F) && pa_min > pa_before * 0.9f;
  valve_no_dp[k] = dp_bad ? (uint8_t)(valve_no_dp[k] + 1) : 0;
  if (valve_bad[k] >= 3 || valve_no_dp[k] >= 3) set_fault(k ? F_VALVE2 : F_VALVE1, 1);
  else if (!bad && !dp_bad) set_fault(k ? F_VALVE2 : F_VALVE1, 0);
}

/* Этапы продувки (каждые 10 мс). */
static void purge_step(uint32_t ms) {
  switch (ph) {
  case PH_SPIN:
    /* Турбины должны раскрутиться: разрежение — это сила удара. */
    if (vac.running && ms - run_since >= 3000) {
      vac.r_before = vac.r_now;
      ph = PH_BOOST;
      ph_t = ms;
    } else if (ms - ph_t > 10000)
      purge_finish("Продувка отменена: турбины не раскрутились");
    break;
  case PH_BOOST:
    /* Разгон перед серией; удар отбивки — сразу, как только у клапанов есть питание. */
    if (ms - ph_t >= (vac.purging == PURGE_TAP ? 0u : vac_cfg.boost_ms) && vac.running && valves_ready()) {
      pulse_i = 0;
      ph = PH_OPEN;
      ph_t = ms;
      valve_open(next_valve);
      vac.pulse_no = 1;
    } else if (ms - ph_t > (uint32_t)vac_cfg.boost_ms + 5000) {
      after_purge = after_purge == AFTER_SLEEP ? AFTER_SLEEP : AFTER_NONE;
      purge_finish("Продувка отменена: нет питания клапанов (реле K1)");
    }
    break;
  case PH_OPEN:
    if (ms - ph_t >= vac_cfg.imp_ms) {
      int k = vac.valve[1] ? 1 : 0;
      vac.valve[0] = vac.valve[1] = 0;
      next_valve = k ^ 1;
      vac_cfg.pulse_count++;
      pulse_quiet_until = ms + 1500;
      ph = PH_PAUSE;
      ph_t = ms;
    }
    break;
  case PH_PAUSE:
    if (ms - ph_t < vac_cfg.pause_ms) break;
    if (pulse_i + 1 < pulses_now && !valves_ready()) break;
    if (++pulse_i < pulses_now) {
      valve_open(next_valve);
      vac.pulse_no = (uint8_t)(pulse_i + 1);
      ph = PH_OPEN;
    } else if (vac.purging == PURGE_TAP) {
      vac.purging = PURGE_NONE;
      vac.pulse_no = 0;
      return;
    } else if (--series_left > 0) {
      vac.pulse_no = 0;
      ph = PH_GAP;
    } else {
      vac.pulse_no = 0;
      ph = PH_SETTLE;
    }
    ph_t = ms;
    break;
  case PH_GAP:
    if (ms - ph_t >= 2000) ph = PH_BOOST, ph_t = ms;
    break;
  case PH_SETTLE:
    /* Поток устанавливается — меряем R после ударов (перед остановкой — не ждём). */
    if (vac.purging == PURGE_OFF) {
      vac.purges++;
      purge_finish("Очистка перед остановкой закончена");
    } else if (ms - ph_t >= 2000)
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
 * Клапаны питаются после реле K1 (через FU2): в «Выкл» они обесточены, даже если пробит их
 * симистор; на продувку реле K1 держится замкнутым (hold) и без турбины 1.
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
    if (vac.purging) {
      after_purge = AFTER_NONE;
      purge_finish("Продувка прервана: авария");
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
  int boost = vac.purging && vac.purging != PURGE_TAP && ph >= PH_BOOST && ph <= PH_GAP;
  int valve_power = vac.purging != PURGE_NONE;

  /* Цели турбин: основная — первая включённая, вторая помогает регулятору. */
  float tgt[2] = {0, 0};
  int p = vac.en[0] ? 0 : 1, s = p ^ 1;
  int pair = vac.en[0] && vac.en[1];
  int softstart_ms = vac_cfg.softstart * 100 + 1500;
  if (want && vac.mode == VAC_AUTO && !(vac.faults & F_SDP_Q)) {
    /* ПИ по расходу: разгон пройден — регулируем. */
    int settled = vac.running && ms - start_ms > (uint32_t)softstart_ms && !vac.purging;
    float e = (float)vac_cfg.sp - vac.flow_ls;
    if (settled) {
      u_pid += KP * (e - e_prev) + KI * e * 0.01f;
      float hi = pair ? 200 : 100;
      if (u_pid > hi) u_pid = hi;
      if (u_pid < 30) u_pid = 30;
      /* Вторая турбина: одной не хватает (полная мощность 2 с, а расхода мало) — включаем;
       * уставку снизили ниже того, что давала одна, или двух много даже на минимуме — выключаем. */
      if (!vac.dual && pair && u_pid >= 99.5f && e > 0.5f) {
        if (!dual_since) dual_since = ms;
        if (ms - dual_since > 2000) {
          vac.dual = 1, dual_since = 0, q_single = vac.flow_ls;
          hal_log("Регулятор: вторая турбина включена");
        }
      } else
        dual_since = 0;
      int enough = (float)vac_cfg.sp < q_single * 0.9f || (u_pid <= 60.5f && e < -2);
      if (vac.dual && (enough || !pair)) {
        if (!single_since) single_since = ms;
        if (ms - single_since > 5000 || !pair) {
          vac.dual = 0, single_since = 0;
          u_pid = u_pid > 100 ? 100 : u_pid < 60 ? 60 : u_pid;
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
    if (target > 100) target = 100;
    if (vac.faults & (k ? F_WARM2 : F_WARM1)) target = target > 70 ? 70 : target;
    if (vac.faults & (k ? F_NTC2 : F_NTC1)) target = target > 70 ? 70 : target;
    int locked = (vac.faults & (k ? F_HOT2 : F_HOT1)) || (lock_until[k] && (int32_t)(lock_until[k] - ms) > 0);
    /* Поочерёдный пуск: вторая — после разгона первой (бросок тока — по одному). */
    int other_starting = vac.ts[k ^ 1] >= TS_CLOSE && vac.ts[k ^ 1] <= TS_RUN && vac.pcmd[k ^ 1] > 0 && ms - on_since[k ^ 1] < vac_cfg.stagger_ms;
    int first = k == 0 || tgt[0] <= 0 || vac.ts[0] == TS_RUN;
    int on = spin && target > 0 && !locked && (vac.ts[k] == TS_RUN || (first && !other_starting));
    turbine_fsm(k, on, k == 0 && valve_power, ms);
    float pw = vac.pcmd[k];
    if (vac.ts[k] != TS_RUN || !on)
      pw = 0;
    else {
      if (pw < 20) pw = 20;
      if (pw < target) pw = pw + rate > target ? target : pw + rate;
      else if (pw > target) pw = pw - 2 < target ? target : pw - 2;
    }
    vac.pcmd[k] = pw;
    int idx = (int)(pw + 0.5f);
    if (idx > 100) idx = 100;
    fire_delay[k] = pw < 15 ? 0xFFFF : (uint16_t)((uint32_t)PHASE[idx] * zc_half / 10000);
    if (pw > 0) any = 1;
  }
  if (any && !vac.running) run_since = ms;
  vac.running = (uint8_t)any;
  if (any) worked_ms += 10;
  if (!any && vac.purging && ph != PH_SPIN && vac.purging != PURGE_TAP) purge_finish("Продувка прервана: турбины остановлены");

  /* Клапаны: ток катушки меряем от открытия до закрытия. */
  for (int k = 0; k < 2; k++) {
    int pin = k ? PIN_Y2 : PIN_Y1;
    static uint8_t was[2];
    if (vac.valve[k] && !was[k]) {
      vk = k;
      v_open_us = hal_micros();
      v_s2[0] = v_s2[1] = 0;
      v_n[0] = v_n[1] = 0;
    } else if (!vac.valve[k] && was[k])
      valve_closed(k);
    was[k] = vac.valve[k];
    hal_pin_write(pin, vac.valve[k]);
  }
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
static uint32_t load_since;

static void sensors(void) {
  uint32_t ms = now_ms;
  /* Разрежение: MPX5050DP, Uвых = 5 В·(0,018·P + 0,04), делитель 10/(6,8+10). */
  int mv = hal_adc_mv(PIN_VAC);
  float vout = (float)mv / 1000.0f * (16.8f / 10.0f);
  float kpa = (vout / 5.0f - 0.04f) / 0.018f;
  set_fault(F_VAC, vout < 0.05f && ms > 2000);
  if (kpa < 0) kpa = 0;
  vac.vacuum_kpa += (kpa - vac.vacuum_kpa) * 0.3f;

  /* SDP810 (перепад на фильтре) и SDP811 (расходомер) на одной шине. */
  for (int b = 0; b < 2; b++) {
    float pa;
    int addr = b ? SDP_FLOW : SDP_FILTER;
    if (sdp_read(addr, &pa) == 0) {
      sdp_err[b] = 0;
      if (b == 0) {
        vac.filter_pa += (pa - vac.filter_pa) * 0.4f;
        if ((vac.valve[0] || vac.valve[1]) && vac.filter_pa < pa_min) pa_min = vac.filter_pa;
      }
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
    if (vac_cfg.r_new > 0) {
      float top = vac_cfg.r_new * ((float)vac_cfg.thr / 100.0f - 1.0f);
      float l = top > 0 ? (vac.r_now - vac_cfg.r_new) / top * 100.0f : 0;
      vac.load = l < 0 ? 0 : l > 100 ? 100 : l;
    }
    /* Фильтр порван или не стоит: воздух идёт, а перепада почти нет (или R вдвое ниже нового). */
    int torn = vac.filter_pa < 8 || (vac_cfg.r_new > 0 && vac.r_now < vac_cfg.r_new * 0.45f);
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

  /* Воздух: проверки после разгона. */
  int up = vac.running && ms - run_since > 4000 && !vac.purging;
  if (up && vac_cfg.min_speed && vac.speed_ms < vac_cfg.min_speed) {
    if (!lowair_since) lowair_since = ms;
  } else
    lowair_since = 0;
  set_fault(F_LOWAIR, lowair_since && ms - lowair_since > 3000);
  if (up && vac.vacuum_kpa > 14 && vac.speed_ms < 8) {
    if (!blocked_since) blocked_since = ms;
  } else
    blocked_since = 0;
  set_fault(F_BLOCKED, blocked_since && ms - blocked_since > 2000);

  /* Автоочистка: отбивка по времени, серии по периоду пресета и по порогу R. */
  if (up && vac.state == VAC_ACTIVE) {
    if (vac_cfg.tap_s && tap_s >= vac_cfg.tap_s) {
      tap_s = 0;
      purge_begin(PURGE_TAP, AFTER_NONE);
    } else if (vac_cfg.clean_auto && vac_cfg.period && series_s >= vac_cfg.period) {
      hal_log("Очистка по периоду");
      vac_purge_now(PURGE_SERIES);
    } else if (vac_cfg.clean_auto && vac_cfg.r_new > 0 && vac.load >= 100 && ms - last_series_ms > 10000) {
      if (!load_since) load_since = ms;
      if (ms - load_since > 2000) {
        load_since = 0;
        hal_log("Очистка по порогу R");
        vac_purge_now(PURGE_SERIES);
      }
    } else
      load_since = 0;
  }
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
    amps[i] = mv / CT_OHMS[i]; /* 1000:1 → мА вторичной = А первичной */
    ct_sum2[i] = 0;
  }
  ct_n = 0;
  vac.amps[0] = amps[0];
  vac.amps[1] = amps[1];
  vac.valve_amps = amps[2];

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
  /* Ток клапанов без команды 1 с — пробит симистор клапана (клапан открыт, воздух уходит мимо). */
  if (!vac.valve[0] && !vac.valve[1] && vk < 0 && amps[2] > 0.25f) {
    if (!vleak_since) vleak_since = ms;
    if (ms - vleak_since > 1000) set_fault(F_VALVE1, 1), set_fault(F_VALVE2, 1);
  } else
    vleak_since = 0;
}

/* ---------------- раз в секунду ---------------- */

static char serial_line[96], uart_line[96];
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
  str_cat(out, vac.purging ? " продувка" : vac.running ? " работа" : " стоит");
  str_cat(out, " P="), str_cat(out, fmt_int(n, (long)(vac.pcmd[0] > vac.pcmd[1] ? vac.pcmd[0] : vac.pcmd[1]))), str_cat(out, "%");
  str_cat(out, " P1="), str_cat(out, fmt_int(n, (long)vac.pcmd[0])), str_cat(out, "%");
  str_cat(out, " P2="), str_cat(out, fmt_int(n, (long)vac.pcmd[1])), str_cat(out, "%");
  str_cat(out, " K="), str_cat(out, vac.relay[0] ? "1" : "0"), str_cat(out, vac.relay[1] ? "1" : "0");
  str_cat(out, " I1="), str_cat(out, fmt_num(n, vac.amps[0], 2));
  str_cat(out, " I2="), str_cat(out, fmt_num(n, vac.amps[1], 2));
  str_cat(out, " Iкл="), str_cat(out, fmt_num(n, vac.valve_amps, 2));
  str_cat(out, " t1="), str_cat(out, fmt_num(n, vac.temp[0], 0));
  str_cat(out, " t2="), str_cat(out, fmt_num(n, vac.temp[1], 0));
  str_cat(out, " U="), str_cat(out, fmt_num(n, vac.mains_v, 0));
  str_cat(out, " разр="), str_cat(out, fmt_num(n, vac.vacuum_kpa, 1));
  str_cat(out, " Q="), str_cat(out, fmt_num(n, vac.flow_ls, 1));
  str_cat(out, " уст="), str_cat(out, fmt_int(n, vac_cfg.sp));
  str_cat(out, " v="), str_cat(out, fmt_num(n, vac.speed_ms, 1));
  str_cat(out, " фильтр="), str_cat(out, fmt_num(n, vac.filter_pa, 0));
  str_cat(out, " R="), str_cat(out, fmt_num(n, vac.r_now, 1));
  str_cat(out, " E1="), str_cat(out, fmt_int(n, (long)vac.wl_mv[0]));
  str_cat(out, " E2="), str_cat(out, fmt_int(n, (long)vac.wl_mv[1]));
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
  if (vac.running && !vac.purging) series_s++, tap_s++;
  vac.next_series = vac_cfg.clean_auto && vac_cfg.period && vac.running ? (uint16_t)(series_s < vac_cfg.period ? vac_cfg.period - series_s : 0) : 0;
  vac.next_tap = vac_cfg.tap_s && vac.running ? (uint16_t)(tap_s < vac_cfg.tap_s ? vac_cfg.tap_s - tap_s : 0) : 0;
  /* Наработку — в память раз в 10 минут или после остановки. */
  if (hours_dirty_ms && ((!vac.running && now_ms - hours_dirty_ms > 5000) || now_ms - hours_dirty_ms > 600000)) {
    vac_save_settings();
    hours_dirty_ms = 0;
  }
  if (vac.running || vac.state == VAC_ACTIVE || now_ms - last_status_ms > 10000) {
    char line[300];
    status_line(line);
    hal_log(line);
    last_status_ms = now_ms;
  }
}

/* ---------------- вход ---------------- */

void vac_setup(void) {
  vac_settings_t s;
  int n = hal_settings_load(&s, sizeof s);
  if (n == (int)sizeof s && s.magic == CFG_MAGIC && s.version == CFG_VERSION && s.crc == cfg_crc(&s))
    vac_cfg = s;
  else
    cfg_defaults();
  vac.mode = vac_cfg.mode == VAC_MANUAL ? VAC_MANUAL : VAC_AUTO;
  vac.state = VAC_STANDBY;
  vac.temp[0] = vac.temp[1] = 25;
  vac.remote = vac_cfg.remote_on ? 1 : 0;

  const int outs[] = {PIN_T1, PIN_T2, PIN_Y1, PIN_Y2, PIN_RL1, PIN_RL2, PIN_LED, PIN_WL_DRV, PIN_BUZZER};
  for (unsigned i = 0; i < sizeof outs / sizeof outs[0]; i++) {
    hal_pin_write(outs[i], 0);
    hal_pin_mode(outs[i], HAL_OUT);
  }
  hal_pin_mode(PIN_ZC, HAL_IN);
  hal_pin_irq(PIN_ZC);

  hal_i2c_begin(0, PIN_SDA, PIN_SCL, 400000);
  sdp_start(SDP_FILTER);
  sdp_start(SDP_FLOW);
  link_init();

  now_ms = hal_millis();
  next_sample = hal_micros();
  hal_log("Контроллер пылесоса S3 " VAC_VERSION ", ESP32-S3. Команды: help");
  char line[120] = "Настройки: режим ", n2[12];
  str_cat(line, mode_name(vac.mode));
  str_cat(line, ", уставка ");
  str_cat(line, fmt_int(n2, vac_cfg.sp));
  str_cat(line, " л/с, мощность ");
  str_cat(line, fmt_int(n2, vac_cfg.power));
  str_cat(line, " %, пульт Bluetooth: ");
  str_cat(line, vac_cfg.remote_on ? "привязан" : "нет");
  hal_log(line);
}

static uint32_t t10, t50, t200, t1000;

void vac_loop(void) {
  now_ms = hal_millis();
  sample_currents(hal_micros());
  water_sample();
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

static void line_in(char *buf, int *len, int ch) {
  if (ch == '\r') return;
  if (ch == '\n') {
    buf[*len] = 0;
    if (*len) vac_command(buf);
    *len = 0;
    return;
  }
  if (*len < 95) buf[(*len)++] = (char)ch;
}

void vac_serial(int ch) { line_in(serial_line, &serial_len, ch); }
void vac_uart(int ch) { line_in(uart_line, &uart_len, ch); }

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
  str_cat(line, ", R нового: "), str_cat(line, fmt_num(n, vac_cfg.r_new, 1));
  hal_log(line);
  line[0] = 0;
  str_cat(line, "  клапаны, ток втягивания/удержания, А: ");
  for (int k = 0; k < 2; k++) {
    if (k) str_cat(line, "; ");
    str_cat(line, fmt_num(n, vac.valve_in[k], 2)), str_cat(line, "/"), str_cat(line, fmt_num(n, vac.valve_hold[k], 2));
  }
  hal_log(line);
  line[0] = 0;
  str_cat(line, "  R по сменам:");
  for (int i = 0; i < vac_cfg.nrh; i++) str_cat(line, " "), str_cat(line, fmt_num(n, vac_cfg.rhist[i] / 10.0f, 1));
  hal_log(line);
}

static void apply_preset(int i) {
  static const char *const NAME[N_PRESETS] = {"бетон", "бурение", "гипс", "уборка"};
  char line[48] = "Пресет: ";
  vac_cfg.preset = (uint8_t)i;
  vac_cfg.sp = vac_cfg.psp[i];
  vac_cfg.period = vac_cfg.pper[i];
  vac_cfg.tap_s = vac_cfg.ptap[i];
  vac_cfg.clean_auto = 1;
  series_s = tap_s = 0;
  vac_set_mode(VAC_AUTO);
  hal_log(str_cat(line, NAME[i]));
  if (vac.state == VAC_STANDBY) vac_turbine(-1, 1);
  cfg_changed();
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
    hal_log("  clean a|o, coff 0|1, tap 0…120, set n|imp|pause|thr|boost|period|wl|stag N, purge [full],");
    hal_log("  filter new, pulses reset, preset 0…3, preset set I SP PERIOD TAP, remote pair|forget, ack, export");
  } else if (str_eq(c, "status")) {
    status_line(line);
    hal_log(line);
    for (uint32_t b = 1; b && b <= F_LAST; b <<= 1)
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
    if (in_range(v, 10, 60)) vac_cfg.sp = (uint8_t)v, vac_cfg.preset = 0xFF, cfg_changed();
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
    hal_log(v ? "Очистка при выключении включена" : "Очистка при выключении выключена");
    cfg_changed();
  } else if (str_starts(c, "tap ")) {
    if (!in_range(v, 0, 120)) return;
    vac_cfg.tap_s = (uint16_t)(v && v < 5 ? 5 : v);
    tap_s = 0;
    line[0] = 0;
    char n[12];
    if (vac_cfg.tap_s) str_cat(line, "Отбивка: удар каждые "), str_cat(line, fmt_int(n, vac_cfg.tap_s)), str_cat(line, " с");
    else str_cat(line, "Отбивка по времени выключена");
    hal_log(line);
    cfg_changed();
  } else if (str_starts(c, "set ")) {
    const char *b = word(a);
    long x = str_to_int(b);
    if (str_starts(a, "n ") && in_range(x, 1, 10)) vac_cfg.pulses = (uint8_t)x;
    else if (str_starts(a, "imp ") && in_range(x, 20, 500)) vac_cfg.imp_ms = (uint16_t)x;
    else if (str_starts(a, "pause ") && in_range(x, 100, 3000)) vac_cfg.pause_ms = (uint16_t)x;
    else if (str_starts(a, "thr ") && in_range(x, 110, 300)) vac_cfg.thr = (uint16_t)x;
    else if (str_starts(a, "boost ") && in_range(x, 0, 3000)) vac_cfg.boost_ms = (uint16_t)x;
    else if (str_starts(a, "period ") && in_range(x, 0, 600)) vac_cfg.period = (uint16_t)x;
    else if (str_starts(a, "wl ") && in_range(x, 50, 1500)) vac_cfg.wl_mv = (uint16_t)x;
    else if (str_starts(a, "stag ") && in_range(x, 0, 5000)) vac_cfg.stagger_ms = (uint16_t)x;
    else return;
    cfg_changed();
  } else if (str_eq(c, "purge")) {
    vac_purge_now(PURGE_SERIES);
  } else if (str_eq(c, "purge full")) {
    vac_purge_now(PURGE_FULL);
  } else if (str_eq(c, "filter new")) {
    vac_cfg.r_new = 0;
    vac.r_after = vac.r_before = vac.load = 0;
    set_fault(F_FILTER, 0);
    set_fault(F_TORN, 0);
    hal_log("Фильтр новый: R нового определится после продувки");
    vac_save_soon();
  } else if (str_eq(c, "pulses reset")) {
    vac_cfg.pulse_count = 0;
    hal_log("Счётчик ударов сброшен");
    vac_save_soon();
  } else if (str_starts(c, "preset set ")) {
    const char *b = word(a), *d = word(b), *e = word(d);
    long i = str_to_int(b), sp = str_to_int(d), per = str_to_int(e), tap = *word(e) ? str_to_int(word(e)) : 0;
    if (in_range(i, 0, N_PRESETS - 1) && in_range(sp, 10, 60) && in_range(per, 0, 600) && in_range(tap, 0, 120)) {
      vac_cfg.psp[i] = (uint8_t)sp;
      vac_cfg.pper[i] = (uint16_t)per;
      vac_cfg.ptap[i] = (uint16_t)tap;
      if (vac_cfg.preset == i) vac_cfg.sp = (uint8_t)sp, vac_cfg.period = (uint16_t)per, vac_cfg.tap_s = (uint16_t)tap;
      cfg_changed();
    }
  } else if (str_starts(c, "preset ")) {
    if (in_range(v, 0, N_PRESETS - 1)) apply_preset((int)v);
  } else if (str_eq(c, "remote pair")) {
    link_pair(60);
  } else if (str_eq(c, "remote forget")) {
    vac_cfg.remote_on = 0;
    vac_cfg.remote_id = 0;
    vac.remote = 0;
    hal_log("Беспроводной пульт отвязан");
    vac_save_soon();
    link_send_config();
  } else if (str_eq(c, "ack")) {
    /* Сброс защёлкнутых аварий: перегрузка и пробой (блокировка), «пора мыть», порванный фильтр, клапаны. */
    lock_until[0] = lock_until[1] = 0;
    valve_bad[0] = valve_bad[1] = valve_no_dp[0] = valve_no_dp[1] = 0;
    const uint32_t ack = F_OVER1 | F_OVER2 | F_LEAK1 | F_LEAK2 | F_FILTER | F_TORN | F_VALVE1 | F_VALVE2 | F_NOCUR1 | F_NOCUR2;
    for (uint32_t b = 1; b && b <= F_LAST; b <<= 1)
      if (ack & b) set_fault(b, 0);
    hal_log("Аварии сброшены");
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
  char out[760];
  out[0] = 0;
  str_cat(out, "{");
  json_num(out, "state", vac.state, 0);
  json_num(out, "sleep", vac.sleep, 0);
  json_num(out, "mode", vac.mode, 0);
  json_num(out, "en1", vac.en[0], 0);
  json_num(out, "en2", vac.en[1], 0);
  json_num(out, "k1", vac.relay[0], 0);
  json_num(out, "k2", vac.relay[1], 0);
  json_num(out, "running", vac.running, 0);
  json_num(out, "purging", vac.purging, 0);
  json_num(out, "sp", vac_cfg.sp, 0);
  json_num(out, "power", vac_cfg.power, 0);
  json_num(out, "tap", vac_cfg.tap_s, 0);
  json_num(out, "p1", vac.pcmd[0], 0);
  json_num(out, "p2", vac.pcmd[1], 0);
  json_num(out, "i1", vac.amps[0], 2);
  json_num(out, "i2", vac.amps[1], 2);
  json_num(out, "iv", vac.valve_amps, 2);
  json_num(out, "t1", vac.temp[0], 1);
  json_num(out, "t2", vac.temp[1], 1);
  json_num(out, "mains", vac.mains_v, 0);
  json_num(out, "vacuum", vac.vacuum_kpa, 2);
  json_num(out, "flow", vac.flow_ls, 1);
  json_num(out, "speed", vac.speed_ms, 1);
  json_num(out, "filter", vac.filter_pa, 0);
  json_num(out, "r", vac.r_now, 1);
  json_num(out, "load", vac.load, 0);
  json_num(out, "water", vac.water, 0);
  json_num(out, "e1", vac.wl_mv[0], 0);
  json_num(out, "e2", vac.wl_mv[1], 0);
  json_num(out, "float", vac.float_on, 0);
  json_num(out, "panel", vac.panel, 0);
  json_num(out, "remote", vac.remote, 0);
  json_num(out, "faults", (float)vac.faults, 0);
  int n = str_len(out);
  out[n - 1] = '}';
  if (n + 1 > len) return 0;
  for (int i = 0; i <= n; i++) buf[i] = out[i];
  return n;
}
