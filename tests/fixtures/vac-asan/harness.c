/*
 * Проверка памяти ядра прошивки «S3» (firmware/vacuum-s3): ядро собирается обычным gcc с AddressSanitizer
 * и UBSan, прослойка железа — заглушки ниже. В поля состояния и настроек кладутся предельные значения
 * (огромные, отрицательные, NaN, полные истории), и ядро выполняет все команды и выдаёт все строки
 * экрану, журнал, JSON состояния и CSV «чёрного ящика»: переполнение любого буфера строки ловит ASan.
 * Запуск — tests/vacuum-s3-asan.test.ts.
 */
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "vac_core.h"

static uint64_t now_us = 1000;
static uint8_t pins[64];
static int adc[64];
static size_t log_max, uart_max, uart_cur, json_max;
static unsigned long logs;

void hal_pin_mode(int pin, int mode) { (void)pin, (void)mode; }
void hal_pin_write(int pin, int level) { pins[pin & 63] = (uint8_t)level; }
int hal_pin_read(int pin) { return pins[pin & 63]; }
void hal_pin_irq(int pin) { (void)pin; }
uint32_t hal_micros(void) { return (uint32_t)now_us; }
uint32_t hal_millis(void) { return (uint32_t)(now_us / 1000); }
int hal_adc_mv(int pin) { return adc[pin & 63]; }
int hal_i2c_begin(int bus, int sda, int scl, uint32_t hz) { (void)bus, (void)sda, (void)scl, (void)hz; return 0; }
int hal_i2c_write(int bus, int addr, const uint8_t *data, int len) { (void)bus, (void)addr, (void)data, (void)len; return 2; }
int hal_i2c_read(int bus, int addr, uint8_t *data, int len) { (void)bus, (void)addr, (void)data, (void)len; return 2; }
void hal_pwm(int pin, uint32_t hz, int permille) { (void)pin, (void)hz, (void)permille; }
void hal_tone(int pin, uint32_t hz) { (void)pin, (void)hz; }
void hal_uart_begin(int tx, int rx, uint32_t baud) { (void)tx, (void)rx, (void)baud; }
void hal_uart_write(const char *data, int len) {
  for (int i = 0; i < len; i++) {
    if (data[i] == '\n') uart_cur = 0;
    else if (++uart_cur > uart_max) uart_max = uart_cur;
  }
}
void hal_lcd(const char *cmd) { (void)cmd; }
void hal_log(const char *line) {
  size_t n = strlen(line);
  if (n > log_max) log_max = n;
  logs++;
  if (getenv("VAC_ASAN_LOG")) printf("%s\n", line);
}
static uint8_t nvs[8][4096];
static int nvs_len[8];
int hal_settings_load2(int slot, void *buf, int len) {
  if (nvs_len[slot & 7] != len) return 0;
  memcpy(buf, nvs[slot & 7], (size_t)len);
  return len;
}
void hal_settings_save2(int slot, const void *buf, int len) {
  if (len > 4096) abort();
  memcpy(nvs[slot & 7], buf, (size_t)len);
  nvs_len[slot & 7] = len;
}
int hal_settings_load(void *buf, int len) { (void)buf, (void)len; return 0; }
void hal_voice_begin(int on) { (void)on; }
void hal_voice_write(const uint8_t *data, int len) { (void)data, (void)len; }
static uint8_t bb[4096][32];
static uint32_t bb_n;
void hal_bb_append(const void *rec, int len) {
  if (len <= 0 || len % 32) abort();
  for (int o = 0; o < len; o += 32) memcpy(bb[bb_n++ % 4096], (const uint8_t *)rec + o, 32);
}
int hal_bb_read(uint32_t index, void *rec, int len) {
  if (index >= bb_n || index >= 4096 || len != 32) return 1;
  memcpy(rec, bb[index], 32);
  return 0;
}
uint32_t hal_bb_count(void) { return bb_n < 4096 ? bb_n : 4096; }
static uint32_t rnd = 12345;
uint32_t hal_rand32(void) { return rnd = rnd * 1103515245u + 12345u; }
void hal_wifi(int on, const char *ssid, const char *pass) { (void)on, (void)ssid, (void)pass; }

/* Время идёт, прерывание таймера — каждые 100 мкс, ноль сети — каждые 10 мс (импульс 1,8 мс). */
static void run_ms(uint32_t ms) {
  for (uint32_t i = 0; i < ms * 10; i++) {
    now_us += 100;
    uint32_t ph = (uint32_t)(now_us % 10000);
    int zc = ph < 1800;
    if (zc != pins[PIN_ZC]) pins[PIN_ZC] = (uint8_t)zc, vac_on_pin(PIN_ZC, zc, (uint32_t)now_us);
    vac_tick();
    if (i % 5 == 0) vac_loop();
  }
}

static void cmd(const char *c) {
  vac_command(c);
  run_ms(20);
}

/* Предельные значения во всех числах, которые печатаются. */
static void extremes(float f) {
  vac.pcmd[0] = vac.pcmd[1] = f;
  vac.amps[0] = vac.amps[1] = vac.tool_amps = vac.total_amps = f;
  vac.temp[0] = vac.temp[1] = f;
  vac.mains_v = vac.mains_hz = f;
  vac.vacuum_kpa = vac.filter_pa = vac.flow_m3h = vac.flow_ls = vac.speed_ms = f;
  vac.r_now = vac.r_before = vac.r_after = vac.load = vac.depth = vac.in_health = f;
  vac.watts[0] = vac.watts[1] = vac.kg = f;
  vac.air_t = vac.air_rh = vac.air_hpa = f;
  vac.ov_tool = vac.ov_turb = vac.fm_r = vac.fm_pct = vac.fc_hours = f;
  vac.uac_mv = vac.uac_crest = f;
  vac.wl_mv[0] = vac.wl_mv[1] = f;
  for (int i = 0; i < 4; i++) vac.test_val[i] = f, vac.ads_mv[i] = f;
  vac.faults = 0xFFFFFFFFu;
  vac.next_series = 65535, vac.imp_now = 65535, vac.every_now = 65535, vac.n_now = 255;
  vac.time_s = 0xFFFFFFF0u, vac.uptime_s = 0x7FFFFFF0u, vac.purges = 0xFFFFFFFFu, vac.osc_n = 65535;
  vac.air_ok = 2, vac.ads_ok = 1, vac.uac = 1, vac.rtc_ok = 1, vac.scale_ok = 1;
  vac.test_id = TEST_FILTER, vac.test_ph = TP_FAIL, vac.test_left = 255;
}

static void cfg_extremes(void) {
  vac_cfg.nrh = N_RHIST;
  for (int i = 0; i < N_RHIST; i++) vac_cfg.rhist[i] = 65535;
  for (int i = 0; i < N_FILTERS; i++) {
    vac_cfg.f[i].r_new = vac_cfg.f[i].r_base = -1e30f;
    vac_cfg.f[i].work_s = vac_cfg.f[i].pulses = 0xFFFFFFFFu;
    vac_cfg.f[i].washes = 65535, vac_cfg.f[i].state = 255;
  }
  for (int i = 0; i < N_PRESETS; i++) {
    vac_preset_t *r = &vac_cfg.pr[i];
    r->sp = 255, r->n = 255, r->every = 65535, r->imp = 65535, r->pause = 65535, r->flags = 255;
  }
  for (int i = 0; i < N_BLE; i++) vac_cfg.ble[i].kind = BLE_TAG, vac_cfg.ble[i].num = 255;
  vac_cfg.hours[0] = vac_cfg.hours[1] = vac_cfg.whours[0] = vac_cfg.whours[1] = 0xFFFFFFFFu;
  vac_cfg.pulse_count = vac_cfg.in_pulses = 0xFFFFFFFFu;
  vac_cfg.r_bag = 1e30f, vac_cfg.in_base = 1e-30f;
  vac_cfg.thr = 65535, vac_cfg.dp_on = 65535, vac_cfg.wl_mv = 65535, vac_cfg.brush_h = 65535, vac_cfg.stagger_ms = 65535;
  vac_cfg.tool_delay = 65535, vac_cfg.zc_shift_us = -32768, vac_cfg.mains_cal = 65535, vac_cfg.flow_k10 = 65535;
  vac_ext.nsvc = N_FSVC;
  for (int i = 0; i < N_FSVC; i++) {
    vac_fsvc_t *e = &vac_ext.svc[i];
    e->t = 0xFFFFFF00u, e->hours = 65535, e->mask = 255, e->r_before = e->r_after = 65535;
  }
  vac_ext.pw2 = 255, vac_ext.boost_ms = 65535, vac_ext.intake_lim = vac_ext.seal_lim = 0xFFFFFFFFu;
  vac_ext.filt_lim = vac_ext.wash_k = vac_ext.sc_full = vac_ext.sc_bag = 65535, vac_ext.sc_k = -1e-30f;
  for (int k = 0; k < 2; k++) vac_ext.t_open_w[k] = vac_ext.t_open_q[k] = vac_ext.t_seal[k] = vac_ext.t_rated[k] = 65535;
  vac_ext.pass_t = 0xFFFFFF00u, vac_ext.vac_off10 = -128, vac_ext.last_svc_work = 0;
  for (int i = 0; i < 4; i++) vac_ext.at_score[i] = 1e30f;
}

static const char *const CMDS[] = {
    "help", "status", "export", "get", "get ext", "mains", "mains cal 0", "mains shift 300", "bb", "osc", "report reset", "scale",
    "time 2099-12-31 23:59:59", "time", "voice test 1", "fsvc begin", "ack", "cfg export", "ble code", "wifi on", "wifi off", "sock none",
    "sock auto", "sock yes", "set dp 20", "set dp 0", "lcd", "hi", "hi2", "pass done", "maint seals",
};

int main(void) {
  for (int p = 0; p < 64; p++) adc[p] = 1650;
  vac_setup();
  run_ms(3000);
  cmd("t1 1");
  run_ms(3000);
  /* Длинная непонятная команда из порта. */
  char longc[1099];
  memset(longc, 'x', sizeof longc - 1);
  longc[sizeof longc - 1] = 0;
  for (int i = 0; i < 400; i++) memcpy(longc + i * 2, "ы", 2);
  cmd(longc);
  const float F[] = {1e30f, -1e30f, NAN, INFINITY, -INFINITY, 123456789.0f, -98765.4321f, 0};
  static char buf[4096];
  for (unsigned v = 0; v < sizeof F / sizeof F[0]; v++) {
    cfg_extremes();
    extremes(F[v]);
    /* Графики: кольца по 5 с и по минуте, отметки ударов. */
    for (uint32_t s = 0; s < 240 * 60 + 60; s += 5) {
      vac.uptime_s = 0x7FFF0000u + s;
      ext_second();
      if (s % 30 == 0) ext_pulse_marker();
    }
    extremes(F[v]);
    ext_osc_begin(3, 65535);
    for (int i = 0; i < 400; i++) ext_osc_sample(F[v], F[v]);
    ext_osc_end(F[v], F[v], 0x7FFFFFFF);
    for (unsigned c = 0; c < sizeof CMDS / sizeof CMDS[0]; c++) {
      cfg_extremes();
      extremes(F[v]);
      vac_command(CMDS[c]);
    }
    for (int m = -1; m < 9; m++)
      for (int r = 0; r < 3; r++) {
        char h[24];
        snprintf(h, sizeof h, "hist %d %d", m, r);
        vac_command(h);
      }
    link_send_config();
    link_send_journal();
    ext_send_lines();
    /* Строки экрану S, F, J — из опроса связи (время опроса — вперёд, без хода ядра). */
    vac_command("hi");
    for (int i = 1; i <= 3; i++) {
      cfg_extremes();
      extremes(F[v]);
      link_poll(hal_millis() + 20000u * (uint32_t)i);
    }
    int n = vac_status_json(buf, sizeof buf);
    if (n <= 0 || (size_t)n != strlen(buf) || buf[n - 1] != '}') {
      printf("FAIL json %d\n", n);
      return 1;
    }
    if ((size_t)n > json_max) json_max = (size_t)n;
    for (int i = 0; i < 40; i++) ext_event(i % 8, 255, F[v]);
    vac.purging = 0, vac.valve[0] = vac.valve[1] = 0;
    run_ms(200);
    cfg_extremes();
    extremes(F[v]);
    for (uint32_t i = 0; i < hal_bb_count(); i++) {
      for (int t = 0; t < 8; t++) {
        bb[i][4] = (uint8_t)t, bb[i][6] = 0xFF, bb[i][7] = 0xFF;
        if (vac_bb_csv(i, buf, 512) >= 512) {
          printf("FAIL csv\n");
          return 1;
        }
      }
    }
    if (!vac_bb_csv(0xFFFFFFFFu, buf, 512)) return 1;
    /* Цикл со всем этим: строки состояния экрану, секунда, токи. */
    run_ms(1200);
  }
  printf("ok logs=%lu log_max=%zu uart_max=%zu json_max=%zu\n", logs, log_max, uart_max, json_max);
  return 0;
}
