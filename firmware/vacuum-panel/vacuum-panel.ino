/*
 * Пульт пылесоса: плата ESP32-S3 с RGB-экраном 800×480 и сенсором GT911 — обвязка для
 * Arduino-ESP32 3.x. Весь интерфейс — в ядре (panel_ui.c, gfx.c, fonts.c): оно рисует
 * кадр в памяти, здесь только экран, сенсор, UART к контроллеру и подсветка.
 *
 * Плата по умолчанию — Sunton ESP32-8048S050C (5″, ESP32-S3-WROOM-1 N16R8). Выводы ниже
 * взяты из её распространённых описаний и НЕ проверены на железе: сверьте со схемой своей
 * платы (у 7″ ESP32-8048S070C и у Waveshare ESP32-S3-Touch-LCD они другие).
 *
 * Arduino IDE: плата «ESP32S3 Dev Module», PSRAM — «OPI PSRAM», Flash — по модулю.
 * Связь с контроллером: TX пульта (PANEL_TX) → IO15 контроллера, RX пульта (PANEL_RX) ←
 * IO23 контроллера, общая земля и 5 В — по кабелю X1.
 */
#include <Arduino.h>
#include <Wire.h>
#include "esp_heap_caps.h"
#include "esp_lcd_panel_ops.h"
#include "esp_lcd_panel_rgb.h"
#include "panel_ui.h"

/* ---- экран: 16 линий данных RGB565 (B0…B4, G0…G5, R0…R4) ---- */
#define LCD_PCLK 42
#define LCD_HSYNC 39
#define LCD_VSYNC 41
#define LCD_DE 40
#define LCD_BL 2
static const int LCD_DATA[16] = {8, 3, 46, 9, 1, 5, 6, 7, 15, 16, 4, 45, 48, 47, 21, 14};
#define LCD_PCLK_HZ 16000000

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
  cfg.timings.hsync_pulse_width = 4;
  cfg.timings.hsync_back_porch = 8;
  cfg.timings.hsync_front_porch = 8;
  cfg.timings.vsync_pulse_width = 4;
  cfg.timings.vsync_back_porch = 8;
  cfg.timings.vsync_front_porch = 8;
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
  while (Serial1.available()) ui_rx(Serial1.read());
  uint32_t ms = millis();
  if (ms - t_touch >= 15) {
    t_touch = ms;
    touch_poll();
  }
  if (ui_loop(ms)) esp_lcd_panel_draw_bitmap(lcd, 0, 0, 800, 480, frame);
  delay(1);
}
