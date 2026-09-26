/*
 * Ядро прошивки: синхронизация с сетью, фазовое управление турбинами с плавным
 * пуском, автопуск от инструмента, продувка фильтра, измерения и защиты.
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

/* Схема: трансформаторы тока 1000:1, нагрузки 82, 82 и 33 Ом. */
static const float CT_OHMS[3] = {82.0f, 82.0f, 33.0f};
static const int CT_PIN[3] = {PIN_CT1, PIN_CT2, PIN_CT3};
/* Детектор нуля: порог = Uбэ·(47к + 10к)/10к, выпрямитель −1,4 В, трансформатор 230/9 В, на холостом ходу +15 %. */
#define ZC_VTH 3.705f
#define ZC_KTR (230.0f / (9.0f * 1.41421356f * 1.15f))

/* ---------------- синхронизация и импульсы (прерывания) ---------------- */

static volatile uint32_t zc_rise, zc_count;
static volatile uint32_t zc_width = 1800;   /* ширина импульса нуля, мкс */
static volatile uint32_t zc_half = 10000;   /* полупериод, мкс */
static volatile uint32_t fire_at[2], gate_off[2];
static volatile uint8_t armed[2], gate_on[2];
static volatile uint16_t fire_delay[2] = {0xFFFF, 0xFFFF}; /* 0xFFFF — не включать */
static volatile uint8_t tick_div;
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
  if (++tick_div >= 10) {
    tick_div = 0;
    ui_encoder_poll();
  }
}

/* ---------------- настройки ---------------- */

#define CFG_MAGIC 0x5643
#define CFG_VERSION 1

static uint8_t cfg_crc(const vac_settings_t *s) {
  const uint8_t *p = (const uint8_t *)s;
  uint8_t c = 0x5A;
  for (unsigned i = 0; i < sizeof(vac_settings_t) - 1; i++) c = (uint8_t)((c << 1 | c >> 7) ^ p[i]);
  return c;
}

static void cfg_defaults(void) {
  vac_settings_t d = {0};
  d.magic = CFG_MAGIC;
  d.version = CFG_VERSION;
  d.power = 80;
  d.turbines = 0;
  d.mode = VAC_MANUAL;
  d.runon = 5;
  d.softstart = 20;
  d.tool_ma = 400;
  d.purge_pa = 350;
  d.purge_pulses = 3;
  d.purge_ms10 = 15;
  d.purge_stop = 1;
  d.min_speed = 20;
  d.hose_mm = 36;
  d.display = 0;
  d.zc_shift_us = 0;
  d.mains_cal = 1000;
  d.flow_k10 = 216;
  vac_cfg = d;
}

void vac_save_settings(void) {
  vac_cfg.crc = cfg_crc(&vac_cfg);
  hal_settings_save(&vac_cfg, sizeof vac_cfg);
}

/* ---------------- измерения ---------------- */

/* Токи: выборки без привязки к сети (шаг 1037 мкс), СКЗ за 200 мс. */
static uint32_t next_sample;
static float ct_offset[3] = {1650, 1650, 1650};
static float ct_sum2[3];
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
  }
  ct_n++;
}

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

static uint32_t now_ms;
static uint32_t last_zc_ms, seen_zc;
static int zc_ok;
static int want_prev;
static uint32_t start_ms;
static uint32_t runon_until;
static uint32_t lock_until[2];
static uint8_t cnt_over[2], cnt_nocur[2], cnt_leak[2], cnt_tool_on, cnt_tool_off;
static uint32_t lowair_since, blocked_since, filter_since, run_since;
static uint32_t last_purge_ms;
static int purge_step, purge_spin, purge_phase;
static uint32_t purge_t;
static uint32_t hours_dirty_ms;
static int sdp_err[2];
static float filter_norm;       /* перепад на фильтре, приведённый к 200 м³/ч */
static int filter_check;        /* проверить фильтр после продувки */
static uint32_t worked_ms;      /* сколько работали с последнего пуска */

static void set_fault(uint32_t bit, int on) {
  if (on && !(vac.faults & bit)) {
    vac.faults |= bit;
    char line[80] = "! ";
    str_cat(line, vac_fault_text(bit));
    hal_log(line);
    vac_beep(bit & (F_LOWAIR | F_BLOCKED | F_FILTER | F_MAINS | F_WARM1 | F_WARM2 | F_NTC1 | F_NTC2) ? 2 : 3);
  } else if (!on && (vac.faults & bit)) {
    vac.faults &= ~bit;
    char line[80] = "  снято: ";
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
  case F_LEAK1: return "Пробит симистор 1";
  case F_LEAK2: return "Пробит симистор 2";
  case F_LOWAIR: return "Мало воздуха";
  case F_BLOCKED: return "Шланг/бак забит";
  case F_FILTER: return "Фильтр забит";
  case F_MAINS: return "Напряжение сети";
  case F_SDP_F: return "Нет датчика фильтра";
  case F_SDP_Q: return "Нет расходомера";
  case F_VAC: return "Датчик разрежения";
  }
  return "?";
}

/* ---------------- звук ---------------- */

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

/* ---------------- команды ---------------- */

void vac_start_stop(void) {
  if (vac.state == VAC_STANDBY) {
    vac.state = VAC_ACTIVE;
    hal_log(vac.mode == VAC_AUTO ? "Пуск: авто — ждём инструмент" : "Пуск: ручной");
    vac_beep(1);
  } else {
    vac.state = VAC_STANDBY;
    runon_until = 0;
    hal_log("Стоп");
    vac_beep(0);
  }
}

void vac_toggle_mode(void) {
  vac.mode = vac.mode == VAC_MANUAL ? VAC_AUTO : VAC_MANUAL;
  vac_cfg.mode = vac.mode;
  vac_save_settings();
  hal_log(vac.mode == VAC_AUTO ? "Режим: авто от инструмента" : "Режим: ручной");
  vac_beep(0);
}

void vac_purge_now(void) {
  if (vac.purging) {
    /* Повторное нажатие — отмена. */
    vac.purging = 0;
    purge_spin = 0;
    hal_log("Продувка отменена");
    vac_beep(0);
    return;
  }
  vac.purging = 1;
  purge_step = 0;
  purge_phase = 0;
  purge_t = now_ms;
  purge_spin = 1;
  worked_ms = 0;
  hal_log(vac.running ? "Продувка фильтра" : "Продувка: разгон турбин");
  vac_beep(0);
}

/* ---------------- управление (каждые 10 мс) ---------------- */

static int turbine_selected(int k) { return vac_cfg.turbines == 0 || vac_cfg.turbines == k + 1; }

static void control(void) {
  uint32_t ms = now_ms;
  /* Синхронизация: импульсы нуля идут каждые 10 мс. */
  if (zc_count != seen_zc) {
    seen_zc = zc_count;
    last_zc_ms = ms;
  }
  zc_ok = ms - last_zc_ms < 60;
  set_fault(F_NO_ZC, !zc_ok && ms > 500);

  int want = 0;
  if (vac.state == VAC_ACTIVE) want = vac.mode == VAC_MANUAL || vac.tool_on || (runon_until && (int32_t)(runon_until - ms) > 0);
  /* Остановка после долгой работы — сначала продувка фильтра (турбины ещё крутятся). */
  if (!want && want_prev && vac_cfg.purge_stop && worked_ms > 30000 && !vac.purging && zc_ok) vac_purge_now();
  if (purge_spin) want = 1;
  if (!zc_ok) want = 0;
  if (want && !want_prev) {
    start_ms = ms;
    worked_ms = 0;
  }
  want_prev = want;
  vac.runon_left = runon_until && (int32_t)(runon_until - ms) > 0 && !vac.tool_on ? (uint16_t)((runon_until - ms + 999) / 1000) : 0;

  /* Розетка инструмента: под напряжением, пока пылесос включён. */
  vac.outlet_on = vac.state == VAC_ACTIVE && zc_ok;
  hal_pin_write(PIN_OUTLET, vac.outlet_on);

  float rate = 10.0f / (vac_cfg.softstart ? vac_cfg.softstart : 1); /* % за 10 мс */
  int both = vac_cfg.turbines == 0;
  int any = 0;
  for (int k = 0; k < 2; k++) {
    float target = vac_cfg.power;
    if (vac.faults & (k ? F_WARM2 : F_WARM1)) target = target > 70 ? 70 : target;
    if (vac.faults & (k ? F_NTC2 : F_NTC1)) target = target > 70 ? 70 : target;
    if (vac.purging && target < 70) target = 70;
    int locked = (vac.faults & (k ? F_HOT2 : F_HOT1)) || (lock_until[k] && (int32_t)(lock_until[k] - ms) > 0);
    int on = want && turbine_selected(k) && !locked && (!both || k == 0 || ms - start_ms >= 1000);
    float p = vac.pcmd[k];
    if (!on)
      p = 0;
    else {
      if (p < 20) p = 20;
      if (p < target) p = p + rate > target ? target : p + rate;
      else if (p > target) p = p - 2 < target ? target : p - 2;
    }
    vac.pcmd[k] = p;
    int idx = (int)(p + 0.5f);
    if (idx > 100) idx = 100;
    fire_delay[k] = p < 15 ? 0xFFFF : (uint16_t)((uint32_t)PHASE[idx] * zc_half / 10000);
    if (p > 0) any = 1;
  }
  if (any && !vac.running) run_since = ms;
  vac.running = any;
  if (any) worked_ms += 10;

  /* Продувка: импульсы по очереди на клапаны, пауза 0,7 с. */
  if (vac.purging) {
    if (purge_step == 0 && purge_phase == 0 && ms - run_since < 3000) {
      /* ждём разгона турбин */
    } else if (purge_phase == 0) {
      int v = purge_step & 1;
      vac.valve[v] = 1;
      vac.valve[!v] = 0;
      purge_t = ms;
      purge_phase = 1;
    } else if (purge_phase == 1 && ms - purge_t >= (uint32_t)vac_cfg.purge_ms10 * 10) {
      vac.valve[0] = vac.valve[1] = 0;
      purge_t = ms;
      purge_phase = 2;
    } else if (purge_phase == 2 && ms - purge_t >= 700) {
      purge_phase = 0;
      if (++purge_step >= vac_cfg.purge_pulses * 2) {
        vac.purging = 0;
        purge_spin = 0;
        vac.purges++;
        last_purge_ms = ms;
        filter_check = 1;
        filter_since = 0;
        hal_log("Продувка закончена");
      }
    }
  } else
    vac.valve[0] = vac.valve[1] = 0;
  hal_pin_write(PIN_Y1, vac.valve[0]);
  hal_pin_write(PIN_Y2, vac.valve[1]);
}

/* ---------------- датчики (каждые 50 мс) ---------------- */

static int sens_phase;

static void sensors(void) {
  uint32_t ms = now_ms;
  /* Разрежение: MPX5050DP, Uвых = 5 В·(0,018·P + 0,04), делитель 10/(6,8+10). */
  int mv = hal_adc_mv(PIN_VAC);
  float vout = (float)mv / 1000.0f * (16.8f / 10.0f);
  float kpa = (vout / 5.0f - 0.04f) / 0.018f;
  set_fault(F_VAC, vout < 0.05f && ms > 2000);
  if (kpa < 0) kpa = 0;
  vac.vacuum_kpa += (kpa - vac.vacuum_kpa) * 0.3f;

  /* SDP810: перепад на фильтре (шина 0) и расходомер (шина 1). */
  for (int b = 0; b < 2; b++) {
    float pa;
    if (sdp_read(b, &pa) == 0) {
      sdp_err[b] = 0;
      if (b == 0) vac.filter_pa += (pa - vac.filter_pa) * 0.4f;
      else {
        if (pa < 0) pa = 0;
        float q = (float)vac_cfg.flow_k10 / 10.0f * v_sqrtf(pa);
        vac.flow_m3h += (q - vac.flow_m3h) * 0.4f;
        float d = (float)vac_cfg.hose_mm / 1000.0f;
        vac.speed_ms = vac.flow_m3h / 3600.0f / (3.14159265f * d * d / 4.0f);
      }
    } else if (++sdp_err[b] == 20) {
      sdp_start(b);
    }
    set_fault(b ? F_SDP_Q : F_SDP_F, sdp_err[b] >= 20);
  }

  /* Температуры — через раз (100 мс). */
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

  /* Фильтр: перепад, приведённый к 200 м³/ч, против порога автопродувки. */
  if (vac.flow_m3h > 60) {
    float r = 200.0f / vac.flow_m3h;
    filter_norm = vac.filter_pa * r * r;
  }
  if (up && vac_cfg.purge_pa && vac.flow_m3h > 60 && filter_norm > vac_cfg.purge_pa) {
    if (!filter_since) filter_since = ms;
  } else
    filter_since = 0;
  if (filter_since && ms - filter_since > 3000) {
    if (filter_check && ms - last_purge_ms < 15000) {
      set_fault(F_FILTER, 1);
      filter_check = 0;
    } else if (!vac.purging && (!last_purge_ms || ms - last_purge_ms > 60000)) {
      hal_log("Автопродувка: фильтр засорился");
      vac_purge_now();
    }
    filter_since = 0;
  }
  if (up && filter_norm < vac_cfg.purge_pa * 0.8f) set_fault(F_FILTER, 0);
  if (filter_check && ms - last_purge_ms > 15000) filter_check = 0;
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
  vac.tool_amps = amps[2];

  /* Инструмент: включился — пылесос следом, выключился — выбег. */
  float thr = (float)vac_cfg.tool_ma / 1000.0f;
  if (vac.outlet_on && amps[2] > thr) {
    cnt_tool_off = 0;
    if (!vac.tool_on && ++cnt_tool_on >= 1) {
      vac.tool_on = 1;
      runon_until = 0;
      if (vac.mode == VAC_AUTO && vac.state == VAC_ACTIVE) hal_log("Инструмент включён — пуск турбин");
    }
  } else if (amps[2] < thr * 0.7f || !vac.outlet_on) {
    cnt_tool_on = 0;
    if (vac.tool_on && ++cnt_tool_off >= 2) {
      vac.tool_on = 0;
      runon_until = ms + (uint32_t)vac_cfg.runon * 1000;
      if (vac.mode == VAC_AUTO && vac.state == VAC_ACTIVE) hal_log("Инструмент выключен — выбег");
    }
  }

  /* Защиты по току. */
  for (int k = 0; k < 2; k++) {
    float a = amps[k];
    uint32_t over = k ? F_OVER2 : F_OVER1, nocur = k ? F_NOCUR2 : F_NOCUR1, leak = k ? F_LEAK2 : F_LEAK1;
    int settled = vac.pcmd[k] > 0 && ms - start_ms > (uint32_t)vac_cfg.softstart * 100 + 1500 + (k && vac_cfg.turbines == 0 ? 1000 : 0);
    if (settled && a > 9.0f) {
      if (++cnt_over[k] >= 5) {
        set_fault(over, 1);
        lock_until[k] = ms + 30000;
      }
    } else
      cnt_over[k] = 0;
    if (!settled && vac.pcmd[k] == 0 && lock_until[k] && (int32_t)(lock_until[k] - ms) <= 0) {
      lock_until[k] = 0;
      set_fault(over, 0);
    }
    if (settled && vac.pcmd[k] >= 40 && a < 0.8f) {
      if (++cnt_nocur[k] >= 15) set_fault(nocur, 1);
    } else {
      cnt_nocur[k] = 0;
      if (settled && a > 1.5f) set_fault(nocur, 0);
    }
    if (vac.pcmd[k] == 0 && a > 1.5f) {
      if (++cnt_leak[k] >= 5) set_fault(leak, 1);
    } else if (vac.pcmd[k] == 0 || a < 1.0f) {
      cnt_leak[k] = 0;
      if (vac.pcmd[k] == 0) set_fault(leak, 0);
    }
  }
}

/* ---------------- раз в секунду ---------------- */

static char serial_line[64];
static int serial_len;
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
  str_cat(out, vac.state == VAC_ACTIVE ? (vac.mode == VAC_AUTO ? "АВТО" : "РУЧН") : "СТОП");
  str_cat(out, vac.running ? " работа" : " стоит");
  str_cat(out, " P="), str_cat(out, fmt_int(n, (long)(vac.pcmd[0] > vac.pcmd[1] ? vac.pcmd[0] : vac.pcmd[1]))), str_cat(out, "%");
  str_cat(out, " I1="), str_cat(out, fmt_num(n, vac.amps[0], 2));
  str_cat(out, " I2="), str_cat(out, fmt_num(n, vac.amps[1], 2));
  str_cat(out, " Iинстр="), str_cat(out, fmt_num(n, vac.tool_amps, 2));
  str_cat(out, " t1="), str_cat(out, fmt_num(n, vac.temp[0], 0));
  str_cat(out, " t2="), str_cat(out, fmt_num(n, vac.temp[1], 0));
  str_cat(out, " U="), str_cat(out, fmt_num(n, vac.mains_v, 0));
  str_cat(out, " разр="), str_cat(out, fmt_num(n, vac.vacuum_kpa, 1));
  str_cat(out, " Q="), str_cat(out, fmt_num(n, vac.flow_m3h, 0));
  str_cat(out, " v="), str_cat(out, fmt_num(n, vac.speed_ms, 1));
  str_cat(out, " фильтр="), str_cat(out, fmt_num(n, vac.filter_pa, 0));
}

static void each_second(void) {
  vac.uptime_s++;
  mains();
  for (int k = 0; k < 2; k++)
    if (vac.pcmd[k] > 0) {
      if (k) vac_cfg.hours2++;
      else vac_cfg.hours1++;
      if (!hours_dirty_ms) hours_dirty_ms = now_ms;
    }
  /* Наработку — в память раз в 10 минут или после остановки. */
  if (hours_dirty_ms && ((!vac.running && now_ms - hours_dirty_ms > 5000) || now_ms - hours_dirty_ms > 600000)) {
    vac_save_settings();
    hours_dirty_ms = 0;
  }
  if (vac.running || vac.state == VAC_ACTIVE || now_ms - last_status_ms > 10000) {
    char line[200];
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
  vac.mode = vac_cfg.mode;
  vac.state = VAC_STANDBY;
  vac.temp[0] = vac.temp[1] = 25;

  const int outs[] = {PIN_T1, PIN_T2, PIN_OUTLET, PIN_Y1, PIN_Y2};
  for (unsigned i = 0; i < sizeof outs / sizeof outs[0]; i++) {
    hal_pin_write(outs[i], 0);
    hal_pin_mode(outs[i], HAL_OUT);
  }
  hal_pin_mode(PIN_ZC, HAL_IN);
  hal_pin_irq(PIN_ZC);
  hal_pin_mode(PIN_BUZZER, HAL_OUT);
  hal_pin_write(PIN_BUZZER, 0);

  hal_i2c_begin(0, PIN_SDA0, PIN_SCL0, 400000);
  hal_i2c_begin(1, PIN_SDA1, PIN_SCL1, 100000);
  sdp_start(0);
  sdp_start(1);
  ui_init();

  now_ms = hal_millis();
  next_sample = hal_micros();
  hal_log("Контроллер пылесоса " VAC_VERSION ", ESP32. Команды: help");
  char line[80] = "Настройки: мощность ";
  char n2[12];
  str_cat(line, fmt_int(n2, vac_cfg.power));
  str_cat(line, "%, режим ");
  str_cat(line, vac.mode == VAC_AUTO ? "авто" : "ручной");
  hal_log(line);
}

static uint32_t t10, t50, t200, t1000;

void vac_loop(void) {
  now_ms = hal_millis();
  sample_currents(hal_micros());
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
  ui_poll(now_ms);
  beep_poll();
}

void vac_serial(int ch) {
  if (ch == '\r') return;
  if (ch == '\n') {
    serial_line[serial_len] = 0;
    if (serial_len) vac_command(serial_line);
    serial_len = 0;
    return;
  }
  if (serial_len < (int)sizeof serial_line - 1) serial_line[serial_len++] = (char)ch;
}

void vac_command(const char *c) {
  char line[200];
  if (str_eq(c, "help")) {
    hal_log("Команды: status, start, stop, auto, manual, purge, power 30…100, turbines 0|1|2");
  } else if (str_eq(c, "status")) {
    status_line(line);
    hal_log(line);
    for (uint32_t b = 1; b && b <= F_VAC; b <<= 1)
      if (vac.faults & b) {
        line[0] = 0;
        str_cat(line, "  ! ");
        str_cat(line, vac_fault_text(b));
        hal_log(line);
      }
  } else if (str_eq(c, "start")) {
    if (vac.state == VAC_STANDBY) vac_start_stop();
  } else if (str_eq(c, "stop")) {
    if (vac.state == VAC_ACTIVE) vac_start_stop();
  } else if (str_eq(c, "auto")) {
    if (vac.mode != VAC_AUTO) vac_toggle_mode();
  } else if (str_eq(c, "manual")) {
    if (vac.mode != VAC_MANUAL) vac_toggle_mode();
  } else if (str_eq(c, "purge")) {
    vac_purge_now();
  } else if (str_starts(c, "power ")) {
    long p = str_to_int(c + 6);
    if (p >= 30 && p <= 100) {
      vac_cfg.power = (uint8_t)p;
      vac_save_settings();
      hal_log("Мощность задана");
    }
  } else if (str_starts(c, "turbines ")) {
    long t = str_to_int(c + 9);
    if (t >= 0 && t <= 2) {
      vac_cfg.turbines = (uint8_t)t;
      vac_save_settings();
      hal_log("Турбины заданы");
    }
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
  char out[480];
  out[0] = 0;
  str_cat(out, "{");
  json_num(out, "state", vac.state, 0);
  json_num(out, "mode", vac.mode, 0);
  json_num(out, "running", vac.running, 0);
  json_num(out, "purging", vac.purging, 0);
  json_num(out, "power", vac_cfg.power, 0);
  json_num(out, "p1", vac.pcmd[0], 0);
  json_num(out, "p2", vac.pcmd[1], 0);
  json_num(out, "i1", vac.amps[0], 2);
  json_num(out, "i2", vac.amps[1], 2);
  json_num(out, "tool", vac.tool_amps, 2);
  json_num(out, "t1", vac.temp[0], 1);
  json_num(out, "t2", vac.temp[1], 1);
  json_num(out, "mains", vac.mains_v, 0);
  json_num(out, "vacuum", vac.vacuum_kpa, 2);
  json_num(out, "flow", vac.flow_m3h, 0);
  json_num(out, "speed", vac.speed_ms, 1);
  json_num(out, "filter", vac.filter_pa, 0);
  json_num(out, "runon", vac.runon_left, 0);
  json_num(out, "faults", (float)vac.faults, 0);
  int n = str_len(out);
  out[n - 1] = '}';
  if (n + 1 > len) return 0;
  for (int i = 0; i <= n; i++) buf[i] = out[i];
  return n;
}
