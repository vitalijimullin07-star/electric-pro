/*
 * Пульт: связь с платой экрана по UART2 и органы, подключённые к контроллеру, —
 * энкодер с кнопкой и кнопка «Пуск турбин». Пока пульт на связи, повороты и нажатия
 * уходят ему строками «E …» (он решает, что менять на своём экране); без пульта энкодер
 * сам меняет уставку расхода (авто) или мощность (ручной).
 * Каждые 100 мс пульту уходит строка состояния «S …», настройки «C …» — после каждого
 * изменения, журнал «J …» — раз в 10 с. Числа — с запятой.
 */
#include "vac_core.h"

/* ---------------- энкодер (опрос из прерывания раз в 1 мс) ---------------- */

static volatile uint8_t enc_prev = 3;
static volatile int8_t enc_acc;
static volatile int16_t enc_steps;

VAC_ISR void link_encoder_poll(void) {
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

enum { B_START, B_ENC, B_N };
static const int BTN_PIN[B_N] = {PIN_K_START, PIN_ENC_SW};
static uint8_t btn_hist[B_N], btn_state[B_N], btn_long[B_N];
static uint32_t btn_down_ms[B_N];
#define HOLD_MS 800

/* ---------------- строки пульту ---------------- */

static uint32_t panel_seen, t_status, t_journal, t_btn;
static int panel_was;

void link_send(const char *line) {
  hal_uart_write(line, str_len(line));
  hal_uart_write("\n", 1);
}

int link_panel_ok(void) { return panel_seen && (int32_t)(hal_millis() - panel_seen) < 2000; }

void link_on_hello(void) {
  panel_seen = hal_millis();
  if (!panel_seen) panel_seen = 1; /* 0 — «пульта ещё не было» */
}

static void kv(char *out, const char *k, float v, int dec) {
  char n[20];
  str_cat(out, " ");
  str_cat(out, k);
  str_cat(out, "=");
  str_cat(out, fmt_num(n, v, dec));
}

static void kc(char *out, const char *k, char c) {
  char s[4] = {' ', 0, 0, 0};
  str_cat(out, s);
  str_cat(out, k);
  s[0] = '=', s[1] = c;
  str_cat(out, s);
}

static char mode_char(int m) { return m == VAC_AUTO ? 'a' : m == VAC_MANUAL ? 'm' : 'o'; }

static void send_status(void) {
  char s[400] = "S";
  kv(s, "st", vac.state, 0);
  kc(s, "md", mode_char(vac.mode));
  kc(s, "cl", vac_cfg.clean_auto ? 'a' : 'o');
  kv(s, "so", vac_cfg.socket, 0);
  kv(s, "ru", vac.running, 0);
  kv(s, "to", vac.tool_on, 0);
  kv(s, "ro", vac.runon_left, 0);
  kv(s, "pg", vac.purging, 0);
  kv(s, "pn", vac.pulse_no, 0);
  kv(s, "nx", vac.next_series, 0);
  kv(s, "pe", vac_cfg.period, 0);
  kv(s, "pr", vac_cfg.preset < N_PRESETS ? vac_cfg.preset : -1, 0);
  kv(s, "f", vac.flow_ls, 1);
  kv(s, "sp", vac_cfg.sp, 0);
  kv(s, "pw", vac_cfg.power, 0);
  kv(s, "v", vac.speed_ms, 1);
  kv(s, "va", vac.vacuum_kpa, 1);
  kv(s, "p1", vac.pcmd[0], 0);
  kv(s, "p2", vac.pcmd[1], 0);
  kv(s, "t1", vac.temp[0], 0);
  kv(s, "t2", vac.temp[1], 0);
  kv(s, "fl", vac.load, 0);
  kv(s, "r", vac.r_now, 1);
  kv(s, "ra", vac.r_after, 1);
  kv(s, "rn", vac_cfg.r_new, 1);
  kv(s, "rw", vac_cfg.r_new * 2.5f, 1);
  kv(s, "sm", vac.r_before > 0 && vac.r_after > 0 ? (vac.r_before - vac.r_after) / vac.r_before * 100 : 0, 0);
  kv(s, "pc", (float)vac_cfg.pulse_count, 0);
  kv(s, "fa", (float)vac.faults, 0);
  kv(s, "mv", vac.mains_v, 0);
  link_send(s);
}

void link_send_config(void) {
  char s[400] = "C";
  kv(s, "n", vac_cfg.pulses, 0);
  kv(s, "imp", vac_cfg.imp_ms, 0);
  kv(s, "pause", vac_cfg.pause_ms, 0);
  kv(s, "thr", vac_cfg.thr, 0);
  kv(s, "boost", vac_cfg.boost_ms, 0);
  kv(s, "ro", vac_cfg.runon, 0);
  kv(s, "t2", vac_cfg.t2, 0);
  kv(s, "bl", vac_cfg.brush_h, 0);
  kv(s, "sp", vac_cfg.sp, 0);
  kv(s, "pw", vac_cfg.power, 0);
  kv(s, "so", vac_cfg.socket, 0);
  kc(s, "md", mode_char(vac.mode));
  kc(s, "cl", vac_cfg.clean_auto ? 'a' : 'o');
  kv(s, "pr", vac_cfg.preset < N_PRESETS ? vac_cfg.preset : -1, 0);
  for (int i = 0; i < N_PRESETS; i++) {
    char k[4] = {'P', (char)('0' + i), 0, 0}, n[12];
    str_cat(s, " ");
    str_cat(s, k);
    str_cat(s, "=");
    str_cat(s, fmt_int(n, vac_cfg.psp[i]));
    str_cat(s, "/");
    str_cat(s, fmt_int(n, vac_cfg.pper[i]));
  }
  link_send(s);
}

void link_send_journal(void) {
  char s[400] = "J", n[12];
  kv(s, "h1", vac_cfg.hours[0] / 3600.0f, 1);
  kv(s, "w1", vac_cfg.whours[0] / 3600.0f, 1);
  kv(s, "h2", vac_cfg.hours[1] / 3600.0f, 1);
  kv(s, "w2", vac_cfg.whours[1] / 3600.0f, 1);
  str_cat(s, " rh=");
  for (int i = 0; i < vac_cfg.nrh; i++) {
    if (i) str_cat(s, "/");
    str_cat(s, fmt_num(n, vac_cfg.rhist[i] / 10.0f, 1));
  }
  link_send(s);
  t_journal = hal_millis();
}

/* ---------------- без пульта: энкодер меняет уставку или мощность ---------------- */

static void local_step(int d) {
  char s[40], n[12];
  s[0] = 0;
  if (vac.mode == VAC_AUTO) {
    int v = vac_cfg.sp + d;
    vac_cfg.sp = (uint8_t)(v < 10 ? 10 : v > 60 ? 60 : v);
    str_cat(s, "Уставка "), str_cat(s, fmt_int(n, vac_cfg.sp)), str_cat(s, " л/с");
  } else if (vac.mode == VAC_MANUAL) {
    int v = vac_cfg.power + d * 5;
    vac_cfg.power = (uint8_t)(v < 30 ? 30 : v > 100 ? 100 : v);
    str_cat(s, "Мощность "), str_cat(s, fmt_int(n, vac_cfg.power)), str_cat(s, " %");
  } else
    return;
  hal_log(s);
  vac_save_settings();
}

/* ---------------- опрос ---------------- */

void link_init(void) {
  for (int i = 0; i < B_N; i++) {
    hal_pin_mode(BTN_PIN[i], HAL_IN_PULLUP);
    btn_hist[i] = 0xFF;
  }
  hal_pin_mode(PIN_ENC_A, HAL_IN_PULLUP);
  hal_pin_mode(PIN_ENC_B, HAL_IN_PULLUP);
  enc_prev = (uint8_t)((hal_pin_read(PIN_ENC_A) << 1) | hal_pin_read(PIN_ENC_B));
  hal_uart_begin(PIN_PNL_TX, PIN_PNL_RX, PANEL_BAUD);
}

void link_poll(uint32_t ms) {
  /* Кнопки: опрос раз в 10 мс, дребезг — три одинаковых отсчёта. */
  if (ms - t_btn >= 10) {
    t_btn = ms;
    for (int i = 0; i < B_N; i++) {
      btn_hist[i] = (uint8_t)((btn_hist[i] << 1) | (hal_pin_read(BTN_PIN[i]) ? 1 : 0));
      int down = (btn_hist[i] & 7) == 0, up = (btn_hist[i] & 7) == 7;
      if (down && !btn_state[i]) {
        btn_state[i] = 1;
        btn_down_ms[i] = ms;
        btn_long[i] = 0;
        if (i == B_ENC) {
          vac_beep(0);
          if (link_panel_ok()) link_send("E sw");
        }
      } else if (down && btn_state[i] && !btn_long[i] && ms - btn_down_ms[i] >= HOLD_MS && i == B_START) {
        /* Удержание «Пуск турбин» — пресеты на пульте. */
        btn_long[i] = 1;
        vac_beep(1);
        if (link_panel_ok()) link_send("E hold");
      } else if (up && btn_state[i]) {
        btn_state[i] = 0;
        if (i == B_START && !btn_long[i]) vac_start_stop();
      }
    }
  }
  /* Энкодер. */
  int16_t st = enc_steps;
  if (st) {
    enc_steps = (int16_t)(enc_steps - st);
    if (link_panel_ok()) {
      char s[24] = "E enc=", n[8];
      link_send(str_cat(s, fmt_int(n, st)));
    } else
      local_step(st);
  }
  int ok = link_panel_ok();
  if (ok != panel_was) {
    panel_was = ok;
    vac.panel = (uint8_t)ok;
    hal_log(ok ? "Пульт на связи" : "Нет связи с пультом");
    if (ok) link_send_config(), link_send_journal();
  }
  if (ms - t_status >= 100) {
    t_status = ms;
    send_status();
  }
  if (ok && ms - t_journal >= 10000) link_send_journal();
}
