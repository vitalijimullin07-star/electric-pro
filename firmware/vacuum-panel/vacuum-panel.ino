/*
 * Пульт пылесоса: плата ESP32-S3 с RGB-экраном 800×480 и сенсором GT911 — обвязка для
 * Arduino-ESP32 3.x. Весь интерфейс — в ядре (panel_main.c, panel_ui.c, panel_s3.c, gfx.c,
 * fonts.c): оно рисует кадр в памяти, здесь только экран, сенсор, UART к контроллеру и
 * подсветка. Одна прошивка — для обоих контроллеров (на ESP32 и «S3»): пульт узнаёт свой
 * по строкам, которые тот присылает.
 *
 * Плата выбирается ниже (PANEL_BOARD): 7 — Sunton ESP32-8048S070C (7″, для пылесоса «S3»),
 * 5 — Sunton ESP32-8048S050C (5″). Выводы взяты из распространённых описаний этих плат и НЕ
 * проверены на железе: сверьте со схемой своей платы (у Waveshare ESP32-S3-Touch-LCD они другие).
 *
 * Arduino IDE: плата «ESP32S3 Dev Module», PSRAM — «OPI PSRAM», Flash — по модулю.
 * Связь с контроллером: TX пульта (PANEL_TX) → RX контроллера, RX пульта (PANEL_RX) ← TX
 * контроллера (у «S3» — IO14 и IO13, у ESP32 — IO15 и IO23), общая земля и 5 В — по кабелю X1.
 *
 * Обновление экрана — через контроллер «S3» (страница на телефоне): строки «U b» (начало),
 * «U d <base64>» (кусок, ответ «U a»), «U e» (конец: метка прошивки экрана есть — записываем
 * и перезапускаемся, нет — «U bad»), «U x» — отмена. Новая прошивка, которая не проработала
 * 30 с, при следующем сбросе откатывается на старую.
 * Arduino IDE: Partition Scheme — с двумя разделами приложения (8M with spiffs / 16M …).
 */
#include <Arduino.h>
#include <Update.h>
#include <Wire.h>
#include "esp_ota_ops.h"
#include "gfx.h"
#include "fonts.h"
#include "esp_heap_caps.h"
#include "esp_lcd_panel_ops.h"
#include "esp_lcd_panel_rgb.h"
#include "panel_ui.h"

#ifndef PANEL_BOARD
#define PANEL_BOARD 7
#endif

/* ---- экран: 16 линий данных RGB565 (B0…B4, G0…G5, R0…R4) ---- */
#define LCD_BL 2
#define LCD_PCLK_HZ 16000000
#if PANEL_BOARD == 7
#define LCD_PCLK 42
#define LCD_HSYNC 39
#define LCD_VSYNC 40
#define LCD_DE 41
static const int LCD_DATA[16] = {15, 7, 6, 5, 4, 9, 46, 3, 8, 16, 1, 14, 21, 47, 48, 45};
#define H_FRONT 210
#define H_PULSE 30
#define H_BACK 16
#define V_FRONT 22
#define V_PULSE 13
#define V_BACK 10
#else
#define LCD_PCLK 42
#define LCD_HSYNC 39
#define LCD_VSYNC 41
#define LCD_DE 40
static const int LCD_DATA[16] = {8, 3, 46, 9, 1, 5, 6, 7, 15, 16, 4, 45, 48, 47, 21, 14};
#define H_FRONT 8
#define H_PULSE 4
#define H_BACK 8
#define V_FRONT 8
#define V_PULSE 4
#define V_BACK 8
#endif

/* ---- сенсор GT911 ---- */
#define TOUCH_SDA 19
#define TOUCH_SCL 20
#define TOUCH_RST 38

/* ---- UART к контроллеру (свободные выводы на разъёме платы) ---- */
#define PANEL_TX 17
#define PANEL_RX 18

static esp_lcd_panel_handle_t lcd;
static uint16_t *frame;
static uint8_t gt_addr = 0x5D;

static void lcd_begin() {
  esp_lcd_rgb_panel_config_t cfg = {};
  cfg.clk_src = LCD_CLK_SRC_DEFAULT;
  cfg.timings.pclk_hz = LCD_PCLK_HZ;
  cfg.timings.h_res = 800;
  cfg.timings.v_res = 480;
  cfg.timings.hsync_pulse_width = H_PULSE;
  cfg.timings.hsync_back_porch = H_BACK;
  cfg.timings.hsync_front_porch = H_FRONT;
  cfg.timings.vsync_pulse_width = V_PULSE;
  cfg.timings.vsync_back_porch = V_BACK;
  cfg.timings.vsync_front_porch = V_FRONT;
  cfg.timings.flags.pclk_active_neg = 1;
  cfg.data_width = 16;
  cfg.bits_per_pixel = 16;
  cfg.num_fbs = 1;
  cfg.psram_trans_align = 64;
  cfg.hsync_gpio_num = LCD_HSYNC;
  cfg.vsync_gpio_num = LCD_VSYNC;
  cfg.de_gpio_num = LCD_DE;
  cfg.pclk_gpio_num = LCD_PCLK;
  cfg.disp_gpio_num = -1;
  for (int i = 0; i < 16; i++) cfg.data_gpio_nums[i] = LCD_DATA[i];
  cfg.flags.fb_in_psram = 1;
  ESP_ERROR_CHECK(esp_lcd_new_rgb_panel(&cfg, &lcd));
  ESP_ERROR_CHECK(esp_lcd_panel_reset(lcd));
  ESP_ERROR_CHECK(esp_lcd_panel_init(lcd));
  pinMode(LCD_BL, OUTPUT);
  digitalWrite(LCD_BL, HIGH);
}

/* ---- GT911: регистр 0x814E — готовность и число касаний, 0x8150 — первая точка ---- */
static bool gt_read(uint16_t reg, uint8_t *buf, int n) {
  Wire.beginTransmission(gt_addr);
  Wire.write(reg >> 8);
  Wire.write(reg & 0xFF);
  if (Wire.endTransmission(false)) return false;
  if (Wire.requestFrom((int)gt_addr, n) != n) return false;
  for (int i = 0; i < n; i++) buf[i] = Wire.read();
  return true;
}

static void gt_clear() {
  Wire.beginTransmission(gt_addr);
  Wire.write(0x81);
  Wire.write(0x4E);
  Wire.write(0);
  Wire.endTransmission();
}

static void touch_begin() {
  pinMode(TOUCH_RST, OUTPUT);
  digitalWrite(TOUCH_RST, LOW);
  delay(10);
  digitalWrite(TOUCH_RST, HIGH);
  delay(60);
  Wire.begin(TOUCH_SDA, TOUCH_SCL, 400000);
  uint8_t id[4];
  if (!gt_read(0x8140, id, 4)) {
    gt_addr = 0x14; /* адрес зависит от уровня INT при сбросе */
    if (!gt_read(0x8140, id, 4)) Serial.println("GT911 не отвечает: проверьте TOUCH_SDA/SCL/RST");
  }
}

static void touch_poll() {
  static bool was;
  uint8_t st;
  if (!gt_read(0x814E, &st, 1) || !(st & 0x80)) return;
  int n = st & 0x0F;
  if (n) {
    uint8_t p[4];
    if (gt_read(0x8150, p, 4)) {
      int x = p[0] | (p[1] << 8), y = p[2] | (p[3] << 8);
      ui_touch(x, y, 1);
      was = true;
    }
  } else if (was) {
    ui_touch(0, 0, 0);
    was = false;
  }
  gt_clear();
}

/* ---- обновление через провод пульта ---- */

bool verifyRollbackLater() { return true; }

static bool upd_on, upd_found;
static uint32_t upd_bytes;
static int upd_got;
static char upd_mark[16];

static int b64v(char c) {
  if (c >= 'A' && c <= 'Z') return c - 'A';
  if (c >= 'a' && c <= 'z') return c - 'a' + 26;
  if (c >= '0' && c <= '9') return c - '0' + 52;
  if (c == '+') return 62;
  if (c == '/') return 63;
  return -1;
}

static void upd_screen(const char *text) {
  g_fill(0, 0, GW, GH, HEX(0x080808));
  g_text_at(&F_S20, 400, 220, "Обновление экрана", HEX(0xe8e8e4), 1);
  g_text_at(&F_S14, 400, 252, text, HEX(0x8a8a85), 1);
  esp_lcd_panel_draw_bitmap(lcd, 0, 0, 800, 480, frame);
}

static void upd_line(const char *s) {
  char n[32];
  if (!strncmp(s, "U b", 3)) {
    upd_on = Update.begin(UPDATE_SIZE_UNKNOWN);
    upd_found = false, upd_got = 0, upd_bytes = 0;
    strcpy(upd_mark, "VACFW:");
    strcat(upd_mark, "PANEL:");
    Serial1.print(upd_on ? "U ok\n" : "U err\n");
    upd_screen("приём файла от контроллера…");
  } else if (!strncmp(s, "U d ", 4) && upd_on) {
    uint8_t buf[200];
    int k = 0, acc = 0, bits = 0, len = strlen(upd_mark);
    for (const char *p = s + 4; *p && *p != '='; p++) {
      int v = b64v(*p);
      if (v < 0) continue;
      acc = (acc << 6) | v, bits += 6;
      if (bits >= 8) bits -= 8, buf[k++] = (uint8_t)(acc >> bits);
    }
    for (int i = 0; i < k && !upd_found; i++) {
      if (buf[i] == (uint8_t)upd_mark[upd_got]) {
        if (++upd_got == len) upd_found = true;
      } else
        upd_got = buf[i] == (uint8_t)upd_mark[0] ? 1 : 0;
    }
    if (Update.write(buf, k) != (size_t)k) {
      Update.abort();
      upd_on = false;
      Serial1.print("U err\n");
      return;
    }
    upd_bytes += k;
    Serial1.print("U a\n");
    if ((upd_bytes & 0xFFFF) < (uint32_t)k) {
      snprintf(n, sizeof n, "принято %u КБ", (unsigned)(upd_bytes / 1024));
      upd_screen(n);
    }
  } else if (!strncmp(s, "U e", 3) && upd_on) {
    upd_on = false;
    if (!upd_found) {
      Update.abort();
      Serial1.print("U bad\n");
      upd_screen("это не прошивка экрана — не записана");
    } else if (Update.end(true)) {
      Serial1.print("U done\n");
      upd_screen("готово, перезапуск");
      delay(500);
      ESP.restart();
    } else
      Serial1.print("U bad\n");
  } else if (!strncmp(s, "U x", 3)) {
    if (upd_on) Update.abort();
    upd_on = false;
  }
}

void setup() {
  Serial.begin(115200);
  Serial1.begin(115200, SERIAL_8N1, PANEL_RX, PANEL_TX);
  frame = (uint16_t *)heap_caps_malloc(800 * 480 * 2, MALLOC_CAP_SPIRAM);
  if (!frame) {
    Serial.println("Нет PSRAM: включите OPI PSRAM в настройках платы");
    for (;;) delay(1000);
  }
  lcd_begin();
  touch_begin();
  ui_setup(frame);
  esp_lcd_panel_draw_bitmap(lcd, 0, 0, 800, 480, frame);
}

void loop() {
  static uint32_t t_touch;
  static int dark;
  /* Строки «U …» — обновление экрана, остальное — интерфейсу. */
  static char line[300];
  static int ll;
  while (Serial1.available()) {
    int c = Serial1.read();
    if (c == '\n') {
      line[ll] = 0;
      if (ll >= 3 && line[0] == 'U' && line[1] == ' ') upd_line(line);
      else {
        for (int i = 0; i < ll; i++) ui_rx(line[i]);
        ui_rx('\n');
      }
      ll = 0;
    } else if (ll < (int)sizeof line - 1)
      line[ll++] = (char)c;
  }
  if (upd_on) return; /* во время обновления экран показывает только ход */
  uint32_t ms = millis();
  if (ms - t_touch >= 15) {
    t_touch = ms;
    touch_poll();
  }
  if (ui_loop(ms)) esp_lcd_panel_draw_bitmap(lcd, 0, 0, 800, 480, frame);
  static bool valid;
  if (!valid && ms > 30000) valid = true, esp_ota_mark_app_valid_cancel_rollback();
  /* «Выкл» на контроллере — подсветку гасим (экран 7″ — это ватт с лишним). */
  int sl = ui_sleeping();
  if (sl != dark) {
    dark = sl;
    digitalWrite(LCD_BL, sl ? LOW : HIGH);
  }
  delay(1);
}
