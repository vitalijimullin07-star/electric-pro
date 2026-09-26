/*
 * Панель: экран OLED 128×64, энкодер с кнопкой и три кнопки («Пуск/Стоп», «Режим»,
 * «Продувка»). Поворот энкодера на главном экране — мощность, нажатие — меню
 * настроек, долгое нажатие — выход из меню.
 */
#include "vac_core.h"

/* ---------------- энкодер (опрос из прерывания раз в 1 мс) ---------------- */

static volatile uint8_t enc_prev = 3;
static volatile int8_t enc_acc;
static volatile int16_t enc_steps;

VAC_ISR void ui_encoder_poll(void) {
  /* Таблица переходов квадратурного кода: +1 — по часовой. Без таблицы в памяти программ (прерывание). */
  uint8_t s = (uint8_t)((hal_pin_read(PIN_ENC_A) << 1) | hal_pin_read(PIN_ENC_B));
  uint8_t idx = (uint8_t)((enc_prev << 2) | s);
  int8_t d = 0;
  if (idx == 13 || idx == 4 || idx == 2 || idx == 11) d = 1;
  else if (idx == 14 || idx == 8 || idx == 1 || idx == 7) d = -1;
  enc_prev = s;
  enc_acc = (int8_t)(enc_acc + d);
  if (enc_acc >= 4) {
    enc_steps++;
    enc_acc = (int8_t)(enc_acc - 4);
  } else if (enc_acc <= -4) {
    enc_steps--;
    enc_acc = (int8_t)(enc_acc + 4);
  }
}

/* ---------------- кнопки ---------------- */

enum { B_START, B_MODE, B_PURGE, B_ENC, B_N };
static const int BTN_PIN[B_N] = {PIN_K_START, PIN_K_MODE, PIN_K_PURGE, PIN_ENC_SW};
static uint8_t btn_hist[B_N], btn_state[B_N];
static uint32_t btn_down_ms[B_N];
static uint8_t btn_long_done[B_N];

/* ---------------- меню ---------------- */

enum {
  M_POWER, M_TURB, M_RUNON, M_TOOL, M_PURGE_PA, M_PULSES, M_PULSE_MS, M_PURGE_STOP, M_SPEED, M_HOSE,
  M_SOFT, M_MAINS, M_ZC, M_FLOWK, M_DISPLAY, M_HOURS, M_EXIT, M_COUNT
};
static const char *const M_LABEL[M_COUNT] = {
    "Мощность", "Турбины", "Выбег (авто)", "Порог инструм.", "Автопродувка", "Импульсов", "Импульс",
    "Продувка в стоп", "Скорость возд.", "Шланг", "Плавный пуск", "Сеть", "Сдвиг нуля", "Расходомер k",
    "Экран", "Наработка", "← Выход"};
static const uint8_t HOSES[] = {27, 32, 36, 38, 50};

static int in_menu, menu_sel, menu_top, menu_edit;
static uint32_t last_draw, msg_until, menu_idle;
static char msg[40];
static int cfg_dirty;

static void show_msg(const char *s, uint32_t ms) {
  msg[0] = 0;
  str_cat(msg, s);
  msg_until = ms;
}

static void menu_value(int i, char *out) {
  char n[16];
  out[0] = 0;
  switch (i) {
  case M_POWER: str_cat(out, fmt_int(n, vac_cfg.power)), str_cat(out, " %"); break;
  case M_TURB: str_cat(out, vac_cfg.turbines == 0 ? "обе" : vac_cfg.turbines == 1 ? "Т1" : "Т2"); break;
  case M_RUNON: str_cat(out, fmt_int(n, vac_cfg.runon)), str_cat(out, " с"); break;
  case M_TOOL: str_cat(out, fmt_num(n, vac_cfg.tool_ma / 1000.0f, 1)), str_cat(out, " А"); break;
  case M_PURGE_PA:
    if (!vac_cfg.purge_pa) str_cat(out, "выкл");
    else str_cat(out, fmt_int(n, vac_cfg.purge_pa)), str_cat(out, " Па");
    break;
  case M_PULSES: str_cat(out, fmt_int(n, vac_cfg.purge_pulses)); break;
  case M_PULSE_MS: str_cat(out, fmt_int(n, vac_cfg.purge_ms10 * 10)), str_cat(out, " мс"); break;
  case M_PURGE_STOP: str_cat(out, vac_cfg.purge_stop ? "да" : "нет"); break;
  case M_SPEED:
    if (!vac_cfg.min_speed) str_cat(out, "выкл");
    else str_cat(out, fmt_int(n, vac_cfg.min_speed)), str_cat(out, " м/с");
    break;
  case M_HOSE: str_cat(out, fmt_int(n, vac_cfg.hose_mm)), str_cat(out, " мм"); break;
  case M_SOFT: str_cat(out, fmt_num(n, vac_cfg.softstart / 10.0f, 1)), str_cat(out, " с"); break;
  case M_MAINS: str_cat(out, fmt_num(n, vac.mains_v, 0)), str_cat(out, " В"); break;
  case M_ZC: str_cat(out, fmt_int(n, vac_cfg.zc_shift_us)), str_cat(out, " мкс"); break;
  case M_FLOWK: str_cat(out, fmt_num(n, vac_cfg.flow_k10 / 10.0f, 1)); break;
  case M_DISPLAY: str_cat(out, vac_cfg.display ? "1,3″" : "0,96″"); break;
  case M_HOURS:
    str_cat(out, fmt_int(n, (long)(vac_cfg.hours1 / 3600))), str_cat(out, "/");
    str_cat(out, fmt_int(n, (long)(vac_cfg.hours2 / 3600))), str_cat(out, " ч");
    break;
  default: break;
  }
}

static int clampi(int v, int lo, int hi) { return v < lo ? lo : v > hi ? hi : v; }

static void menu_change(int i, int d) {
  switch (i) {
  case M_POWER: vac_cfg.power = (uint8_t)clampi(vac_cfg.power + d * 5, 30, 100); break;
  case M_TURB: vac_cfg.turbines = (uint8_t)((vac_cfg.turbines + 3 + d) % 3); break;
  case M_RUNON: vac_cfg.runon = (uint8_t)clampi(vac_cfg.runon + d, 0, 30); break;
  case M_TOOL: vac_cfg.tool_ma = (uint16_t)clampi(vac_cfg.tool_ma + d * 100, 100, 3000); break;
  case M_PURGE_PA: vac_cfg.purge_pa = (uint16_t)clampi(vac_cfg.purge_pa + d * 25, 0, 800); break;
  case M_PULSES: vac_cfg.purge_pulses = (uint8_t)clampi(vac_cfg.purge_pulses + d, 1, 6); break;
  case M_PULSE_MS: vac_cfg.purge_ms10 = (uint8_t)clampi(vac_cfg.purge_ms10 + d, 5, 50); break;
  case M_PURGE_STOP: vac_cfg.purge_stop = !vac_cfg.purge_stop; break;
  case M_SPEED: vac_cfg.min_speed = (uint8_t)clampi(vac_cfg.min_speed + d, 0, 30); break;
  case M_HOSE: {
    int k = 0;
    for (int j = 0; j < 5; j++)
      if (HOSES[j] == vac_cfg.hose_mm) k = j;
    vac_cfg.hose_mm = HOSES[clampi(k + d, 0, 4)];
    break;
  }
  case M_SOFT: vac_cfg.softstart = (uint8_t)clampi(vac_cfg.softstart + d * 5, 5, 60); break;
  case M_MAINS:
    /* Поправка ±1 В: калибровка по вольтметру. */
    if (vac.mains_v > 50) vac_cfg.mains_cal = (uint16_t)clampi((int)(vac_cfg.mains_cal * (vac.mains_v + d) / vac.mains_v + 0.5f), 800, 1200);
    vac.mains_v += (float)d;
    break;
  case M_ZC: vac_cfg.zc_shift_us = (int16_t)clampi(vac_cfg.zc_shift_us + d * 50, -1500, 1500); break;
  case M_FLOWK: vac_cfg.flow_k10 = (uint16_t)clampi(vac_cfg.flow_k10 + d, 50, 600); break;
  case M_DISPLAY:
    vac_cfg.display = !vac_cfg.display;
    oled_init(vac_cfg.display);
    break;
  default: break;
  }
  cfg_dirty = 1;
}

static void menu_click(uint32_t ms) {
  if (menu_sel == M_EXIT) {
    in_menu = 0;
    if (cfg_dirty) vac_save_settings(), cfg_dirty = 0;
    return;
  }
  if (menu_sel == M_HOURS) {
    show_msg("Наработка: Т1/Т2, часы", ms + 1500);
    return;
  }
  menu_edit = !menu_edit;
  if (!menu_edit && cfg_dirty) vac_save_settings(), cfg_dirty = 0;
}

/* ---------------- экран ---------------- */

static void draw_menu(void) {
  oled_clear();
  oled_fill(0, 0, 128, 9, 1);
  oled_text(2, 1, menu_edit ? "НАСТРОЙКА: ◀ ▶" : "НАСТРОЙКИ", 1, 1);
  if (menu_sel < menu_top) menu_top = menu_sel;
  if (menu_sel > menu_top + 5) menu_top = menu_sel - 5;
  for (int r = 0; r < 6 && menu_top + r < M_COUNT; r++) {
    int i = menu_top + r;
    int y = 10 + r * 9;
    int sel = i == menu_sel;
    if (sel) oled_fill(0, y - 1, 128, 9, 1);
    oled_text(2, y, M_LABEL[i], 1, sel);
    char v[24];
    menu_value(i, v);
    if (sel && menu_edit) {
      char t[28] = "<";
      str_cat(t, v);
      str_cat(t, ">");
      oled_text(126 - oled_text_width(t, 1), y, t, 1, 1);
    } else if (v[0])
      oled_text(126 - oled_text_width(v, 1), y, v, 1, sel);
  }
}

/* Самая важная неисправность (для нижней строки). */
static uint32_t top_fault(void) {
  static const uint32_t order[] = {F_NO_ZC, F_LEAK1, F_LEAK2, F_HOT1, F_HOT2, F_OVER1, F_OVER2, F_BLOCKED, F_LOWAIR, F_NOCUR1, F_NOCUR2,
                                   F_FILTER, F_WARM1, F_WARM2, F_NTC1, F_NTC2, F_MAINS, F_SDP_F, F_SDP_Q, F_VAC};
  for (unsigned i = 0; i < sizeof order / sizeof order[0]; i++)
    if (vac.faults & order[i]) return order[i];
  return 0;
}

static void turbine_line(int k, int y) {
  char s[28], n[12];
  s[0] = 0;
  str_cat(s, k ? "2:" : "1:");
  uint32_t hot = k ? F_HOT2 : F_HOT1, over = k ? F_OVER2 : F_OVER1;
  if (vac.faults & hot) str_cat(s, "ПЕРЕГРЕВ");
  else if (vac.faults & over) str_cat(s, "ПЕРЕГРУЗ");
  else if (vac.pcmd[k] > 0) str_cat(s, fmt_num(n, vac.amps[k], 1)), str_cat(s, "А");
  else str_cat(s, "стоп");
  oled_text(66, y, s, 1, 0);
  if (!(vac.faults & (k ? F_NTC2 : F_NTC1))) {
    s[0] = 0;
    str_cat(s, fmt_num(n, vac.temp[k], 0));
    str_cat(s, "°");
  } else {
    s[0] = 0;
    str_cat(s, "--°");
  }
  oled_text(127 - oled_text_width(s, 1), y, s, 1, 0);
}

static void draw_main(uint32_t ms) {
  char s[40], n[16];
  oled_clear();
  /* Шапка: режим, состояние, сеть. */
  oled_fill(0, 0, 128, 9, 1);
  s[0] = 0;
  str_cat(s, vac.mode == VAC_AUTO ? "АВТО " : "РУЧН ");
  if (vac.purging) str_cat(s, "ПРОДУВКА");
  else if (vac.state == VAC_STANDBY) str_cat(s, vac.running ? "ОСТАНОВ" : "СТОП");
  else if (vac.running && vac.runon_left) str_cat(s, "ВЫБЕГ "), str_cat(s, fmt_int(n, vac.runon_left)), str_cat(s, "с");
  else if (vac.running) str_cat(s, "РАБОТА");
  else str_cat(s, "ЖДУ ИНСТР.");
  oled_text(2, 1, s, 1, 1);
  s[0] = 0;
  if (vac.mains_v > 1) str_cat(s, fmt_num(n, vac.mains_v, 0)), str_cat(s, "В");
  else str_cat(s, "---В");
  oled_text(126 - oled_text_width(s, 1), 1, s, 1, 1);

  /* Заданная мощность крупно, справа — турбины: ток и температура. */
  s[0] = 0;
  str_cat(s, fmt_int(n, vac_cfg.power));
  str_cat(s, "%");
  oled_text(0, 10, s, 2, 0);
  turbine_line(0, 10);
  turbine_line(1, 19);
  /* Фактическая мощность — полоска. */
  float p = vac.pcmd[0] > vac.pcmd[1] ? vac.pcmd[0] : vac.pcmd[1];
  oled_frame(0, 27, 128, 4);
  oled_fill(1, 28, (int)(126 * p / 100), 2, 1);

  s[0] = 0;
  str_cat(s, "Разреж. ");
  str_cat(s, fmt_num(n, vac.vacuum_kpa, 1));
  str_cat(s, " кПа");
  oled_text(0, 32, s, 1, 0);
  s[0] = 0;
  str_cat(s, "Воздух ");
  str_cat(s, fmt_num(n, vac.flow_m3h, 0));
  str_cat(s, "м³/ч ");
  str_cat(s, fmt_num(n, vac.speed_ms, 0));
  str_cat(s, "м/с");
  oled_text(0, 40, s, 1, 0);
  s[0] = 0;
  str_cat(s, "Фильтр ");
  str_cat(s, fmt_num(n, vac.filter_pa, 0));
  str_cat(s, "Па");
  oled_text(0, 48, s, 1, 0);
  if (vac_cfg.purge_pa) {
    /* Полоска: перепад относительно порога автопродувки. */
    float f = vac.filter_pa / (float)vac_cfg.purge_pa;
    oled_frame(80, 49, 48, 6);
    oled_fill(81, 50, (int)(46 * (f > 1 ? 1 : f < 0 ? 0 : f)), 4, 1);
  }

  /* Нижняя строка: сообщение, неисправность (тревоги мигают) или подсказка. */
  s[0] = 0;
  uint32_t f = top_fault();
  const uint32_t quiet = F_LOWAIR | F_FILTER | F_WARM1 | F_WARM2 | F_NTC1 | F_NTC2 | F_MAINS | F_SDP_F | F_SDP_Q | F_VAC;
  if (msg_until && (int32_t)(msg_until - ms) > 0) str_cat(s, msg);
  else if (f) {
    if ((ms / 400) & 1 || (f & quiet)) str_cat(s, "! "), str_cat(s, vac_fault_text(f));
  } else if (vac.state == VAC_ACTIVE && vac.mode == VAC_AUTO) {
    str_cat(s, "Инструмент ");
    str_cat(s, fmt_num(n, vac.tool_amps, 1));
    str_cat(s, " А");
  } else if (vac.state == VAC_STANDBY)
    str_cat(s, "Кнопка «Пуск» — старт");
  oled_text(0, 56, s, 1, 0);
}

/* ---------------- опрос ---------------- */

void ui_init(void) {
  for (int i = 0; i < B_N; i++) {
    hal_pin_mode(BTN_PIN[i], HAL_IN_PULLUP);
    btn_hist[i] = 0xFF;
    btn_state[i] = 0;
  }
  hal_pin_mode(PIN_ENC_A, HAL_IN_PULLUP);
  hal_pin_mode(PIN_ENC_B, HAL_IN_PULLUP);
  enc_prev = (uint8_t)((hal_pin_read(PIN_ENC_A) << 1) | hal_pin_read(PIN_ENC_B));
  oled_init(vac_cfg.display);
}

static uint32_t t_btn;

void ui_poll(uint32_t ms) {
  /* Кнопки: опрос раз в 10 мс, дребезг — три одинаковых отсчёта. */
  if (ms - t_btn >= 10) {
    t_btn = ms;
    for (int i = 0; i < B_N; i++) {
      btn_hist[i] = (uint8_t)((btn_hist[i] << 1) | (hal_pin_read(BTN_PIN[i]) ? 1 : 0));
      int down = (btn_hist[i] & 7) == 0, up = (btn_hist[i] & 7) == 7;
      if (down && !btn_state[i]) {
        btn_state[i] = 1;
        btn_down_ms[i] = ms;
        btn_long_done[i] = 0;
        menu_idle = ms;
        if (i == B_START) vac_start_stop();
        if (i == B_MODE) vac_toggle_mode();
        if (i == B_PURGE) vac_purge_now();
      } else if (up && btn_state[i]) {
        btn_state[i] = 0;
        if (i == B_ENC && !btn_long_done[i]) {
          vac_beep(0);
          if (!in_menu) {
            in_menu = 1;
            menu_sel = 0;
            menu_top = 0;
            menu_edit = 0;
          } else
            menu_click(ms);
        }
      } else if (down && btn_state[i] && i == B_ENC && !btn_long_done[i] && ms - btn_down_ms[i] > 800) {
        /* Долгое нажатие: выход из меню. */
        btn_long_done[i] = 1;
        if (in_menu) {
          in_menu = 0;
          if (cfg_dirty) vac_save_settings(), cfg_dirty = 0;
          vac_beep(1);
        }
      }
    }
  }
  /* Энкодер. */
  int16_t st = enc_steps;
  if (st) {
    enc_steps = (int16_t)(enc_steps - st);
    ui_encoder_step(st);
    menu_idle = ms;
  }
  if (in_menu && ms - menu_idle > 30000) {
    in_menu = 0;
    if (cfg_dirty) vac_save_settings(), cfg_dirty = 0;
  }
  if (ms - last_draw >= 150) {
    last_draw = ms;
    if (in_menu) draw_menu();
    else draw_main(ms);
    oled_flush();
  }
}

void ui_encoder_step(int dir) {
  if (!in_menu) {
    int p = clampi(vac_cfg.power + dir * 5, 30, 100);
    if (p != vac_cfg.power) {
      vac_cfg.power = (uint8_t)p;
      cfg_dirty = 1;
      char s[24], n[8];
      s[0] = 0;
      str_cat(s, "Мощность ");
      str_cat(s, fmt_int(n, p));
      str_cat(s, " %");
      show_msg(s, hal_millis() + 1200);
    }
    return;
  }
  if (menu_edit) menu_change(menu_sel, dir);
  else menu_sel = clampi(menu_sel + dir, 0, M_COUNT - 1);
}
