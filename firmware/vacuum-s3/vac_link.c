/*
 * Органы управления и связь: кнопки через расширитель PCA9555 (шесть у экрана, «Турбина 1»,
 * «Турбина 2», «Выкл», кнопка энкодера), энкодер на выводах модуля, пульт с экраном по UART
 * и беспроводной пульт по Bluetooth.
 *
 * Пока экран на связи, кнопки у экрана, повороты и нажатия энкодера уходят ему строками «E …»
 * (он решает, что они значат на текущем экране: подписи кнопок — на краях экрана рядом с ними);
 * без экрана энкодер сам меняет уставку расхода (авто) или мощность (ручной), кнопка энкодера —
 * пуск и стоп. «Турбина 1/2» и «Выкл» работают всегда и сразу.
 * Каждые 100 мс экрану уходит строка состояния «S …», настройки «C …» — после каждого изменения,
 * журнал «J …» — раз в 10 с. Числа — с запятой.
 *
 * Беспроводной пульт (ESP32-C3, firmware/vacuum-remote) не держит соединение: каждое нажатие —
 * короткая реклама Bluetooth с данными производителя «VR»: номер пульта, счётчик, событие и
 * подпись SipHash-2-4 ключом, который пульт передал при привязке («VP», только в окне привязки
 * и рядом с контроллером). Посылка со старым счётчиком (повтор) или чужой подписью не принимается.
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

/* ---------------- кнопки на расширителе ---------------- */

#define N_KEYS 10 /* K_1…K_6, K_T1, K_T2, K_OFF, K_ENC */
#define HOLD_MS 800
#define HOLD_OFF_MS 2000
static uint8_t key_hist[N_KEYS], key_down[N_KEYS], key_long[N_KEYS];
static uint32_t key_t[N_KEYS];
static uint32_t t_keys, exp_fail;
static uint16_t exp_in = 0xFFFF;

/* ---------------- строки пульту ---------------- */

static uint32_t panel_seen, t_status, t_journal;
static int panel_was;
static uint32_t pair_until, remote_seen;
static uint8_t remote_unsaved;

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

static char mode_char(int m) { return m == VAC_AUTO ? 'a' : 'm'; }

static void send_status(void) {
  char s[480] = "S";
  kv(s, "st", vac.state, 0);
  kv(s, "sl", vac.sleep, 0);
  kc(s, "md", mode_char(vac.mode));
  kc(s, "cl", vac_cfg.clean_auto ? 'a' : 'o');
  kv(s, "e1", vac.en[0], 0);
  kv(s, "e2", vac.en[1], 0);
  kv(s, "k1", vac.relay[0], 0);
  kv(s, "k2", vac.relay[1], 0);
  kv(s, "ru", vac.running, 0);
  kv(s, "pg", vac.purging, 0);
  kv(s, "pn", vac.pulse_no, 0);
  kv(s, "sd", vac.shutdown, 0);
  kv(s, "nx", vac.next_series, 0);
  kv(s, "nt", vac.next_tap, 0);
  kv(s, "tp", vac_cfg.tap_s, 0);
  kv(s, "pe", vac_cfg.period, 0);
  kv(s, "pr", vac_cfg.preset < N_PRESETS ? vac_cfg.preset : -1, 0);
  kv(s, "f", vac.flow_ls, 1);
  kv(s, "sp", vac_cfg.sp, 0);
  kv(s, "pw", vac_cfg.power, 0);
  kv(s, "v", vac.speed_ms, 1);
  kv(s, "va", vac.vacuum_kpa, 1);
  kv(s, "p1", vac.pcmd[0], 0);
  kv(s, "p2", vac.pcmd[1], 0);
  kv(s, "i1", vac.amps[0], 1);
  kv(s, "i2", vac.amps[1], 1);
  kv(s, "t1", vac.temp[0], 0);
  kv(s, "t2", vac.temp[1], 0);
  kv(s, "fl", vac.load, 0);
  kv(s, "dp", vac.filter_pa, 0);
  kv(s, "r", vac.r_now, 1);
  kv(s, "ra", vac.r_after, 1);
  kv(s, "rn", vac_cfg.r_new, 1);
  kv(s, "rw", vac_cfg.r_new * 2.5f, 1);
  kv(s, "sm", vac.r_before > 0 && vac.r_after > 0 ? (vac.r_before - vac.r_after) / vac.r_before * 100 : 0, 0);
  kv(s, "pc", (float)vac_cfg.pulse_count, 0);
  kv(s, "wl", vac.water, 0);
  kv(s, "fs", vac.float_on, 0);
  kv(s, "bt", vac.remote, 0);
  kv(s, "bp", vac.pairing, 0);
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
  kv(s, "t2", vac_cfg.t2, 0);
  kv(s, "coff", vac_cfg.clean_off, 0);
  kv(s, "tap", vac_cfg.tap_s, 0);
  kv(s, "wl", vac_cfg.wl_mv, 0);
  kv(s, "bl", vac_cfg.brush_h, 0);
  kv(s, "sp", vac_cfg.sp, 0);
  kv(s, "pw", vac_cfg.power, 0);
  kv(s, "bt", vac_cfg.remote_on, 0);
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
    str_cat(s, "/");
    str_cat(s, fmt_int(n, vac_cfg.ptap[i]));
  }
  link_send(s);
}

void link_send_journal(void) {
  char s[400] = "J", n[12];
  kv(s, "h1", vac_cfg.hours[0] / 3600.0f, 1);
  kv(s, "w1", vac_cfg.whours[0] / 3600.0f, 1);
  kv(s, "h2", vac_cfg.hours[1] / 3600.0f, 1);
  kv(s, "w2", vac_cfg.whours[1] / 3600.0f, 1);
  kv(s, "vi1", vac.valve_in[0], 2);
  kv(s, "vh1", vac.valve_hold[0], 2);
  kv(s, "vi2", vac.valve_in[1], 2);
  kv(s, "vh2", vac.valve_hold[1], 2);
  str_cat(s, " rh=");
  for (int i = 0; i < vac_cfg.nrh; i++) {
    if (i) str_cat(s, "/");
    str_cat(s, fmt_num(n, vac_cfg.rhist[i] / 10.0f, 1));
  }
  link_send(s);
  t_journal = hal_millis();
}

/* ---------------- без экрана: энкодер меняет уставку или мощность ---------------- */

static void local_step(int d) {
  char s[40], n[12];
  s[0] = 0;
  if (vac.mode == VAC_AUTO) {
    int v = vac_cfg.sp + d;
    vac_cfg.sp = (uint8_t)(v < 10 ? 10 : v > 60 ? 60 : v);
    vac_cfg.preset = 0xFF;
    str_cat(s, "Уставка "), str_cat(s, fmt_int(n, vac_cfg.sp)), str_cat(s, " л/с");
  } else {
    int v = vac_cfg.power + d * 5;
    vac_cfg.power = (uint8_t)(v < 30 ? 30 : v > 100 ? 100 : v);
    str_cat(s, "Мощность "), str_cat(s, fmt_int(n, vac_cfg.power)), str_cat(s, " %");
  }
  hal_log(s);
  vac_save_soon();
  if (link_panel_ok()) link_send_config();
}

/* ---------------- окно привязки беспроводного пульта ---------------- */

void link_pair(int seconds) {
  pair_until = seconds > 0 ? hal_millis() + (uint32_t)seconds * 1000 : 0;
  vac.pairing = seconds > 0;
  hal_log(seconds > 0 ? "Привязка пульта: зажмите на пульте обе кнопки на 5 с (до 60 с, пульт — рядом)" : "Привязка пульта закрыта");
  if (seconds > 0) vac_beep(1);
}

/* ---------------- нажатия ---------------- */

static void key_event(int i, int hold) {
  char s[16] = "E k=", n[6];
  if (vac.sleep) {
    /* Сон: любая кнопка будит; «Турбина 1/2» — сразу и пускает. */
    vac_wake();
    if (!hold && (i == K_T1 || i == K_T2)) vac_turbine(i == K_T2, 1);
    return;
  }
  switch (i) {
  case K_T1:
  case K_T2:
    if (!hold) vac_turbine(i == K_T2, !vac.en[i == K_T2]);
    break;
  case K_OFF:
    /* «Выкл»: коротко — очистка и сон, удержание 2 с — сразу. */
    vac_power_off(hold);
    break;
  case K_ENC:
    vac_beep(0);
    if (link_panel_ok()) link_send(hold ? "E hold" : "E sw");
    else if (hold) vac_purge_now(PURGE_SERIES);
    else vac_start_stop();
    break;
  default:
    vac_beep(0);
    if (link_panel_ok()) {
      s[0] = 0;
      str_cat(s, hold ? "E kh=" : "E k=");
      link_send(str_cat(s, fmt_int(n, i + 1)));
    } else if (!hold) {
      /* Без экрана: 1 — продувка, 2 — авто/ручной, 3 — отбивка по времени вкл/выкл. */
      if (i == K_1) vac_purge_now(PURGE_SERIES);
      else if (i == K_2) vac_set_mode(vac.mode == VAC_AUTO ? VAC_MANUAL : VAC_AUTO);
      else if (i == K_3) vac_command(vac_cfg.tap_s ? "tap 0" : "tap 20");
    }
  }
}

static void poll_keys(uint32_t ms) {
  uint16_t in;
  if (exp_read(&in) == 0) {
    exp_in = in;
    exp_fail = 0;
  } else if (++exp_fail > 50) {
    exp_in = 0xFFFF; /* нет связи — всё отпущено */
  }
  if (exp_fail == 51) vac.faults |= F_EXP, hal_log("! Нет связи с кнопками (PCA9555)");
  if (!exp_fail && (vac.faults & F_EXP)) vac.faults &= ~(uint32_t)F_EXP, hal_log("  снято: Нет связи с кнопками");
  vac.keys = (uint16_t)~exp_in;
  /* Кнопки: дребезг — три одинаковых отсчёта по 10 мс; удержание — 0,8 с («Выкл» — 2 с). */
  for (int i = 0; i < N_KEYS; i++) {
    key_hist[i] = (uint8_t)((key_hist[i] << 1) | ((exp_in >> i) & 1));
    int down = (key_hist[i] & 7) == 0, up = (key_hist[i] & 7) == 7;
    uint32_t hold_ms = i == K_OFF ? HOLD_OFF_MS : HOLD_MS;
    if (down && !key_down[i]) {
      key_down[i] = 1;
      key_t[i] = ms;
      key_long[i] = 0;
      /* «Турбина 1/2» — по нажатию, без ожидания отпускания. */
      if (i == K_T1 || i == K_T2) key_event(i, 0), key_long[i] = 1;
    } else if (down && key_down[i] && !key_long[i] && ms - key_t[i] >= hold_ms) {
      key_long[i] = 1;
      key_event(i, 1);
    } else if (up && key_down[i]) {
      key_down[i] = 0;
      if (!key_long[i]) key_event(i, 0);
    }
  }
  /* «Выкл» + «Турбина 1» вместе 3 с — окно привязки беспроводного пульта. */
  if (key_down[K_OFF] && key_down[K_T1] && ms - key_t[K_OFF] > 3000 && ms - key_t[K_T1] > 3000 && !vac.pairing) {
    key_long[K_OFF] = 1;
    link_pair(60);
  }
}

/* ---------------- беспроводной пульт ---------------- */

static uint32_t le32(const uint8_t *p) { return (uint32_t)p[0] | (uint32_t)p[1] << 8 | (uint32_t)p[2] << 16 | (uint32_t)p[3] << 24; }

/*
 * «VR» 1 id[4] счётчик[4] событие арг подпись[4] — 17 байт; подпись — младшие 4 байта
 * SipHash-2-4(ключ, id…арг). «VP» 1 id[4] ключ[16] — привязка.
 * События: 1 — кнопка 1, 2 — её удержание, 3 — кнопка 2, 4 — её удержание, 5 — энкодер
 * (арг — шаги со знаком), 6 — нажатие энкодера.
 */
void vac_remote(const uint8_t *d, int len, int rssi) {
  if (len >= 23 && d[0] == 'V' && d[1] == 'P' && d[2] == 1) {
    if (!vac.pairing) return;
    if (rssi < -70) {
      hal_log("Привязка: пульт далеко — поднесите ближе");
      return;
    }
    vac_cfg.remote_id = le32(d + 3);
    for (int i = 0; i < 16; i++) vac_cfg.remote_key[i] = d[7 + i];
    vac_cfg.remote_ctr = 0;
    vac_cfg.remote_on = 1;
    vac.remote = 2;
    remote_seen = hal_millis();
    link_pair(0);
    vac_save_settings();
    hal_log("Беспроводной пульт привязан");
    vac_beep(1);
    link_send_config();
    return;
  }
  if (len < 17 || d[0] != 'V' || d[1] != 'R' || d[2] != 1 || !vac_cfg.remote_on) return;
  if (le32(d + 3) != vac_cfg.remote_id) return;
  uint32_t ctr = le32(d + 7);
  if (ctr <= vac_cfg.remote_ctr) return; /* повтор той же посылки или перехваченная старая */
  uint64_t mac = siphash24(vac_cfg.remote_key, d + 3, 10);
  if ((uint32_t)mac != le32(d + 13)) return;
  vac_cfg.remote_ctr = ctr;
  if (++remote_unsaved >= 32) remote_unsaved = 0, vac_save_soon();
  vac.remote = 2;
  vac.remote_rssi = (int8_t)(rssi < -127 ? -127 : rssi > 0 ? 0 : rssi);
  remote_seen = hal_millis();
  int ev = d[11], arg = (int8_t)d[12];
  if (vac.sleep && ev != 5) {
    vac_wake();
    if (ev != 1) return;
  }
  switch (ev) {
  case 1: vac_start_stop(); break;
  case 2: vac_purge_now(PURGE_SERIES); break;
  case 3: vac_turbine(1, !vac.en[1]); break;
  case 4: vac_set_mode(vac.mode == VAC_AUTO ? VAC_MANUAL : VAC_AUTO); break;
  case 5: if (arg) local_step(arg); break;
  case 6: vac_purge_now(PURGE_SERIES); break;
  }
}

/* ---------------- опрос ---------------- */

void link_init(void) {
  for (int i = 0; i < N_KEYS; i++) key_hist[i] = 0xFF;
  hal_pin_mode(PIN_ENC_A, HAL_IN_PULLUP);
  hal_pin_mode(PIN_ENC_B, HAL_IN_PULLUP);
  enc_prev = (uint8_t)((hal_pin_read(PIN_ENC_A) << 1) | hal_pin_read(PIN_ENC_B));
  hal_uart_begin(PIN_PNL_TX, PIN_PNL_RX, PANEL_BAUD);
}

void link_poll(uint32_t ms) {
  if (ms - t_keys >= 10) {
    t_keys = ms;
    poll_keys(ms);
  }
  /* Энкодер. */
  int16_t st = enc_steps;
  if (st) {
    enc_steps = (int16_t)(enc_steps - st);
    if (vac.sleep) vac_wake();
    else if (link_panel_ok()) {
      char s[24] = "E enc=", n[8];
      link_send(str_cat(s, fmt_int(n, st)));
    } else
      local_step(st);
  }
  if (pair_until && (int32_t)(ms - pair_until) >= 0) link_pair(0);
  if (vac.remote == 2 && ms - remote_seen > 10000) vac.remote = vac_cfg.remote_on ? 1 : 0;
  int ok = link_panel_ok();
  if (ok != panel_was) {
    panel_was = ok;
    vac.panel = (uint8_t)ok;
    hal_log(ok ? "Экран на связи" : "Нет связи с экраном");
    if (ok) link_send_config(), link_send_journal(), link_send(vac.sleep ? "P off" : "P on");
  }
  if (ms - t_status >= 100) {
    t_status = ms;
    send_status();
  }
  if (ok && ms - t_journal >= 10000) link_send_journal();
}
