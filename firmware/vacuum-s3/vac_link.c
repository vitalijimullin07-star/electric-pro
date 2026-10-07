/*
 * Органы управления и связь: кнопки через расширитель PCA9555 (шесть у экрана, «Турбина 1»,
 * «Турбина 2», «Выкл», кнопка энкодера), энкодер на выводах модуля, пульт с экраном по UART
 * и устройства Bluetooth — беспроводной пульт и метки на инструмент (до 4 вместе).
 *
 * Пока экран на связи, кнопки у экрана, повороты и нажатия энкодера уходят ему строками «E …»
 * (он решает, что они значат на текущем экране: подписи кнопок — на краях экрана рядом с ними);
 * без экрана энкодер сам меняет уставку расхода (авто) или мощность (ручной), кнопка энкодера —
 * пуск и стоп. «Турбина 1/2» и «Выкл» работают всегда и сразу.
 * Экрану уходят строки: «S …» — состояние каждые 100 мс, «F …» — фильтр, розетка, удары,
 * устройства каждые 0,5 с, «C …» — настройки после каждого изменения, «J …» — журнал раз в
 * 10 с, «W …» — сеть Wi-Fi для телефона (экран рисует QR-код). Числа — с запятой.
 *
 * Устройства Bluetooth не держат соединение: каждое событие — короткая реклама с данными
 * производителя: «VR» (пульт) или «VT» (метка) — номер устройства, счётчик, событие и подпись
 * SipHash-2-4 ключом, который устройство передало при привязке («VP», только в окне привязки
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

static uint32_t panel_seen, t_status, t_slow, t_journal;
static int panel_was, wifi_was;
static uint32_t pair_until, remote_seen;
static uint8_t ble_unsaved;

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

static void ki(char *out, const char *k, long v) {
  char n[16];
  str_cat(out, " ");
  str_cat(out, k);
  str_cat(out, "=");
  str_cat(out, fmt_int(n, v));
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
  char s[520] = "S";
  ki(s, "st", vac.state);
  ki(s, "sl", vac.sleep);
  kc(s, "md", mode_char(vac.mode));
  kc(s, "cl", vac_cfg.clean_auto ? 'a' : 'o');
  ki(s, "pr", vac_cfg.preset);
  ki(s, "e1", vac.en[0]);
  ki(s, "e2", vac.en[1]);
  ki(s, "k1", vac.relay[0]);
  ki(s, "k2", vac.relay[1]);
  ki(s, "ru", vac.running);
  ki(s, "pg", vac.purging);
  ki(s, "pn", vac.pulse_no);
  ki(s, "hz", vac.hose_wait);
  ki(s, "hc", vac.hose_closed);
  ki(s, "sd", vac.shutdown);
  ki(s, "nx", vac.next_series);
  kv(s, "f", vac.flow_ls, 1);
  ki(s, "sp", vac_cfg.pr[vac_cfg.preset].sp);
  ki(s, "pw", vac_cfg.power);
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
  kv(s, "sm", vac.r_before > 0 && vac.r_after > 0 ? (vac.r_before - vac.r_after) / vac.r_before * 100 : 0, 0);
  ki(s, "wl", vac.water);
  ki(s, "fs", vac.float_on);
  ki(s, "bt", vac.remote);
  ki(s, "bp", vac.pairing);
  ki(s, "fa", (long)vac.faults);
  kv(s, "mv", vac.mains_v, 0);
  ki(s, "so", vac.sock);
  ki(s, "tl", vac.tool);
  kv(s, "ta", vac.tool_amps, 1);
  kv(s, "ia", vac.total_amps, 1);
  ki(s, "ov", vac.ov);
  ki(s, "cp", vac.cap);
  ki(s, "au", vac.auto_started);
  link_send(s);
}

/* Реже: розетка, замер фильтра, «Авто», сила удара, клапаны, метки, сеть для телефона. */
static void send_slow(void) {
  char s[400] = "F";
  ki(s, "oc", vac.ov_cap);
  ki(s, "o1", vac.ov_one);
  kv(s, "ot", vac.ov_tool, 1);
  kv(s, "ou", vac.ov_turb, 1);
  ki(s, "fm", vac.fmeas);
  ki(s, "fx", vac.fm_left);
  kv(s, "fq", vac.fm_r, 1);
  kv(s, "fp", vac.fm_pct, 0);
  ki(s, "fg", vac.fguess);
  ki(s, "dl", vac.dust_lvl);
  ki(s, "dk", vac.dust_kind);
  ki(s, "ev", vac.every_now);
  ki(s, "nn", vac.n_now);
  ki(s, "im", vac.imp_now ? vac.imp_now : vac_cfg.pr[vac_cfg.preset].imp);
  kv(s, "ih", vac.in_health, 0);
  kv(s, "dh", vac.depth * 100, 0);
  ki(s, "v1", vac.verr[0]);
  ki(s, "v2", vac.verr[1]);
  ki(s, "tg", vac.tags_on);
  ki(s, "tb", vac.tag_low);
  ki(s, "wf", vac.wifi);
  ki(s, "pc", (long)vac_cfg.pulse_count);
  link_send(s);
}

void link_send_config(void) {
  char s[620] = "C";
  const vac_settings_t *c = &vac_cfg;
  ki(s, "coff", c->clean_off);
  ki(s, "ha", c->hose_auto);
  ki(s, "sn", c->strong_n);
  ki(s, "thr", c->thr);
  ki(s, "dpo", c->dp_on);
  ki(s, "dpc", (long)(vac_dp_clean() + 0.5f));
  ki(s, "t2", c->t2);
  ki(s, "wl", c->wl_mv);
  ki(s, "bl", c->brush_h);
  ki(s, "pw", c->power);
  kc(s, "md", mode_char(vac.mode));
  kc(s, "cl", c->clean_auto ? 'a' : 'o');
  ki(s, "pr", c->preset);
  for (int i = 0; i < N_PRESETS; i++) {
    /* P0=32/0/0/0/0/1: уставка, ударов, промежуток, удар, пауза, флаги */
    const vac_preset_t *r = &c->pr[i];
    char k[4] = {'P', (char)('0' + i), 0, 0}, n[12];
    str_cat(s, " "), str_cat(s, k), str_cat(s, "=");
    long f[6] = {r->sp, r->n, r->every, r->imp, r->pause, r->flags};
    for (int j = 0; j < 6; j++) {
      if (j) str_cat(s, "/");
      str_cat(s, fmt_int(n, f[j]));
    }
  }
  ki(s, "ta", c->tool_auto);
  ki(s, "tt", c->tool_thr);
  ki(s, "tr", c->tool_runon);
  ki(s, "te", c->tool_end);
  ki(s, "tm", c->limit_a);
  ki(s, "tf", c->sock_free);
  ki(s, "td", c->tool_delay);
  ki(s, "fi", c->filt);
  ki(s, "bg", c->bag);
  kv(s, "rb", c->r_bag, 1);
  ki(s, "ip", (long)c->in_pulses);
  for (int i = 0; i < N_FILTERS; i++) {
    /* FA=R нового/R сейчас/моек/часов/ударов/каким поставили */
    const vac_filter_t *f = &c->f[i];
    char n[16];
    str_cat(s, i ? " FB=" : " FA=");
    str_cat(s, fmt_num(n, f->r_new, 1)), str_cat(s, "/");
    str_cat(s, fmt_num(n, f->r_base, 1)), str_cat(s, "/");
    str_cat(s, fmt_int(n, f->washes)), str_cat(s, "/");
    str_cat(s, fmt_num(n, f->work_s / 3600.0f, 1)), str_cat(s, "/");
    str_cat(s, fmt_int(n, (long)f->pulses)), str_cat(s, "/");
    str_cat(s, fmt_int(n, f->state));
  }
  for (int i = 0; i < N_BLE; i++) {
    /* D0=вид/номер: 1 — пульт, 2 — метка, 0 — пусто */
    char k[5] = {' ', 'D', (char)('0' + i), '=', 0}, n[8];
    str_cat(s, k);
    str_cat(s, fmt_int(n, c->ble[i].kind)), str_cat(s, "/"), str_cat(s, fmt_int(n, c->ble[i].num));
  }
  ki(s, "bt", link_ble_count(BLE_REMOTE));
  ki(s, "wf", vac.wifi);
  ki(s, "bk", (int)vac.ble_code);
  link_send(s);
  if (vac.wifi) {
    char w[64] = "W s=";
    str_cat(str_cat(str_cat(w, vac.ssid), " p="), vac.pass);
    link_send(w);
  }
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

/* ---------------- без экрана: энкодер меняет уставку или мощность ---------------- */

static void local_step(int d) {
  char s[40], n[12];
  s[0] = 0;
  if (vac.mode == VAC_AUTO) {
    int v = vac_cfg.pr[vac_cfg.preset].sp + d;
    vac_cfg.pr[vac_cfg.preset].sp = (uint8_t)(v < 10 ? 10 : v > 60 ? 60 : v);
    str_cat(s, "Уставка "), str_cat(s, fmt_int(n, vac_cfg.pr[vac_cfg.preset].sp)), str_cat(s, " л/с");
  } else {
    int v = vac_cfg.power + d * 5;
    vac_cfg.power = (uint8_t)(v < 30 ? 30 : v > 100 ? 100 : v);
    str_cat(s, "Мощность "), str_cat(s, fmt_int(n, vac_cfg.power)), str_cat(s, " %");
  }
  hal_log(s);
  vac_save_soon();
  if (link_panel_ok()) link_send_config();
}

/* ---------------- привязка устройств Bluetooth ---------------- */

void link_pair(int seconds) {
  pair_until = seconds > 0 ? hal_millis() + (uint32_t)seconds * 1000 : 0;
  vac.pairing = seconds > 0;
  hal_log(seconds > 0 ? "Привязка: на пульте зажмите обе кнопки на 5 с, на метке — кнопку 5 с (до 60 с, рядом)" : "Привязка закрыта");
  if (seconds > 0) vac_beep(1);
}

int link_ble_count(int kind) {
  int n = 0;
  for (int i = 0; i < N_BLE; i++) n += vac_cfg.ble[i].kind == kind;
  return n;
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
      /* Без экрана: 1 — продувка, 2 — авто/ручной, 3 — мощная очистка. */
      if (i == K_1) vac_purge_now(PURGE_SERIES);
      else if (i == K_2) vac_set_mode(vac.mode == VAC_AUTO ? VAC_MANUAL : VAC_AUTO);
      else if (i == K_3) vac_purge_now(PURGE_STRONG);
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
  /* «Выкл» + «Турбина 1» вместе 3 с — окно привязки устройства Bluetooth. */
  if (key_down[K_OFF] && key_down[K_T1] && ms - key_t[K_OFF] > 3000 && ms - key_t[K_T1] > 3000 && !vac.pairing) {
    key_long[K_OFF] = 1;
    link_pair(60);
  }
}

/* ---------------- посылки Bluetooth ---------------- */

static uint32_t tag_last[N_BLE];

static uint32_t le32(const uint8_t *p) { return (uint32_t)p[0] | (uint32_t)p[1] << 8 | (uint32_t)p[2] << 16 | (uint32_t)p[3] << 24; }

/* Привязка: тот же номер — заменить, иначе — в свободное место (номер среди своего вида — следующий). */
static void pair_device(int kind, uint32_t id, const uint8_t *key) {
  int slot = -1;
  for (int i = 0; i < N_BLE; i++)
    if (vac_cfg.ble[i].kind && vac_cfg.ble[i].id == id) slot = i;
  if (slot < 0)
    for (int i = 0; i < N_BLE; i++)
      if (!vac_cfg.ble[i].kind) {
        slot = i;
        break;
      }
  if (slot < 0) {
    hal_log("Привязка: список полон (4 устройства) — отвяжите лишнее");
    vac_beep(2);
    return;
  }
  vac_ble_t *b = &vac_cfg.ble[slot];
  int num = 0;
  for (int i = 0; i < N_BLE; i++)
    if (i != slot && vac_cfg.ble[i].kind == kind && vac_cfg.ble[i].num > num) num = vac_cfg.ble[i].num;
  if (!(b->kind == kind && b->id == id)) b->num = (uint8_t)(num + 1);
  b->kind = (uint8_t)kind;
  b->id = id;
  for (int i = 0; i < 16; i++) b->key[i] = key[i];
  b->ctr = 0;
  link_pair(0);
  vac_save_settings();
  char line[48] = "", n[6];
  str_cat(line, kind == BLE_TAG ? "Метка " : "Пульт ");
  str_cat(line, fmt_int(n, b->num));
  hal_log(str_cat(line, kind == BLE_TAG ? " привязана" : " привязан"));
  vac_beep(1);
  if (kind == BLE_REMOTE) vac.remote = 2, remote_seen = hal_millis();
  link_send_config();
}

/* Своя посылка: номер привязан, счётчик новый, подпись сходится. Возвращает номер в списке или −1. */
static int check_signed(const uint8_t *d, int kind) {
  uint32_t id = le32(d + 3);
  for (int i = 0; i < N_BLE; i++) {
    vac_ble_t *b = &vac_cfg.ble[i];
    if (b->kind != kind || b->id != id) continue;
    uint32_t ctr = le32(d + 7);
    if (ctr <= b->ctr) return -1; /* повтор той же посылки или перехваченная старая */
    uint64_t mac = siphash24(b->key, d + 3, 10);
    if ((uint32_t)mac != le32(d + 13)) return -1;
    b->ctr = ctr;
    if (++ble_unsaved >= 32) ble_unsaved = 0, vac_save_soon();
    return i;
  }
  return -1;
}

/*
 * «VR» 1 id[4] счётчик[4] событие арг подпись[4] — 17 байт; подпись — младшие 4 байта
 * SipHash-2-4(ключ, id…арг). «VT» — то же у метки. «VP» 1 id[4] ключ[16] — привязка пульта,
 * «VP» 2 id[4] ключ[16] вид — привязка метки (вид 2).
 * События пульта: 1 — кнопка 1, 2 — её удержание, 3 — кнопка 2, 4 — её удержание, 5 — энкодер
 * (арг — шаги со знаком), 6 — нажатие энкодера. Метки: 1 — инструмент заработал, 2 — встал,
 * 3 — работает (раз в 2 с), 4 — заряд; арг — заряд батареи, %.
 */
void vac_remote(const uint8_t *d, int len, int rssi) {
  if (len >= 23 && d[0] == 'V' && d[1] == 'P' && (d[2] == 1 || d[2] == 2)) {
    if (!vac.pairing) return;
    if (rssi < -70) {
      hal_log("Привязка: устройство далеко — поднесите ближе");
      return;
    }
    int kind = d[2] == 2 && len >= 24 && d[23] == BLE_TAG ? BLE_TAG : BLE_REMOTE;
    pair_device(kind, le32(d + 3), d + 7);
    return;
  }
  if (len < 17 || d[0] != 'V' || d[2] != 1) return;
  if (d[1] == 'T') {
    int i = check_signed(d, BLE_TAG);
    if (i < 0) return;
    int ev = d[11], batt = d[12];
    tag_last[i] = hal_millis();
    if (batt && batt < 15) vac.tag_low |= (uint8_t)(1 << i);
    else if (batt) vac.tag_low &= (uint8_t)~(1 << i);
    if (vac.sleep) return;
    if (ev == 1 || ev == 3) vac_tag_tool(i, 1);
    else if (ev == 2) vac_tag_tool(i, 0);
    return;
  }
  if (d[1] != 'R') return;
  if (check_signed(d, BLE_REMOTE) < 0) return;
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
  vac.remote = link_ble_count(BLE_REMOTE) ? 1 : 0;
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
  if (vac.remote == 2 && ms - remote_seen > 10000) vac.remote = link_ble_count(BLE_REMOTE) ? 1 : 0;
  /* Метка молчит 6 с (посылка «работает» — раз в 2 с): инструмент считаем остановленным. */
  for (int i = 0; i < N_BLE; i++)
    if ((vac.tags_on & (1 << i)) && ms - tag_last[i] > 6000) {
      hal_log("Метка молчит — инструмент считаем остановленным");
      vac_tag_tool(i, 0);
    }
  int ok = link_panel_ok();
  if (ok != panel_was) {
    panel_was = ok;
    vac.panel = (uint8_t)ok;
    hal_log(ok ? "Экран на связи" : "Нет связи с экраном");
    if (ok) link_send_config(), link_send_journal(), link_send(vac.sleep ? "P off" : "P on");
  }
  if (vac.wifi != wifi_was) wifi_was = vac.wifi, link_send_config();
  if (ms - t_status >= 100) {
    t_status = ms;
    send_status();
  }
  if (ms - t_slow >= 500) {
    t_slow = ms;
    send_slow();
  }
  if (ok && ms - t_journal >= 10000) link_send_journal();
}
