/* Прослойка vac_hal.h для Arduino-ESP32 3.x на ESP32-S3 (в отдельном файле — препроцессор .ino её не трогает). */
#include <Arduino.h>
#include <FFat.h>
#include <Preferences.h>
#include <Wire.h>
#include "esp_random.h"
#include "esp_timer.h"
#include "soc/gpio_reg.h"
#include "vac_core.h"

Preferences prefs;
static int tone_attached;

extern "C" {
void hal_pin_mode(int pin, int mode) { pinMode(pin, mode == HAL_OUT ? OUTPUT : mode == HAL_IN_PULLUP ? INPUT_PULLUP : INPUT); }

/* Прямая запись в регистры: безопасно в прерывании и во время записи во флеш. */
void IRAM_ATTR hal_pin_write(int pin, int level) {
  if (pin < 32) REG_WRITE(level ? GPIO_OUT_W1TS_REG : GPIO_OUT_W1TC_REG, 1UL << pin);
  else REG_WRITE(level ? GPIO_OUT1_W1TS_REG : GPIO_OUT1_W1TC_REG, 1UL << (pin - 32));
}

int IRAM_ATTR hal_pin_read(int pin) {
  if (pin < 32) return (REG_READ(GPIO_IN_REG) >> pin) & 1;
  return (REG_READ(GPIO_IN1_REG) >> (pin - 32)) & 1;
}

uint32_t IRAM_ATTR hal_micros(void) { return (uint32_t)esp_timer_get_time(); }
uint32_t hal_millis(void) { return millis(); }

static void IRAM_ATTR on_zc(void) { vac_on_pin(PIN_ZC, hal_pin_read(PIN_ZC), hal_micros()); }

void hal_pin_irq(int pin) {
  if (pin == PIN_ZC) attachInterrupt(pin, on_zc, CHANGE);
}

int hal_adc_mv(int pin) { return analogReadMilliVolts(pin); }

int hal_i2c_begin(int bus, int sda, int scl, uint32_t hz) { return Wire.begin(sda, scl, hz) ? 0 : 1; }

int hal_i2c_write(int bus, int addr, const uint8_t *data, int len) {
  Wire.beginTransmission((uint8_t)addr);
  Wire.write(data, (size_t)len);
  return Wire.endTransmission();
}

int hal_i2c_read(int bus, int addr, uint8_t *data, int len) {
  if (Wire.requestFrom((uint8_t)addr, (size_t)len) != (size_t)len) return 1;
  for (int i = 0; i < len; i++) data[i] = (uint8_t)Wire.read();
  return 0;
}

/* ШИМ регуляторов МР248: 20 кГц, 10 бит (каналы LEDC назначает ядро Arduino). */
static uint32_t pwm_attached;
void hal_pwm(int pin, uint32_t hz, int permille) {
  uint32_t bit = 1UL << (pin & 31);
  if (!(pwm_attached & bit)) {
    ledcAttach(pin, hz, 10);
    pwm_attached |= bit;
  }
  ledcWrite(pin, (uint32_t)(permille < 0 ? 0 : permille > 1000 ? 1023 : permille * 1023 / 1000));
}

void hal_tone(int pin, uint32_t hz) {
  if (!tone_attached) {
    ledcAttach(pin, 2000, 8);
    tone_attached = 1;
  }
  ledcWriteTone(pin, hz);
}

/* К экрану — UART1 (Serial — это USB-C: монитор порта и прошивка). */
static uint32_t uart_baud_set;
void hal_uart_begin(int tx, int rx, uint32_t baud) {
  uart_baud_set = baud;
  Serial1.begin(baud, SERIAL_8N1, rx, tx);
}
/* Пока идёт прошивка экрана, строки ядра в UART не идут (там — куски файла). */
volatile int uart_mute;
void lcd_rx_put(const char *data, int len);
/* Голос: линия 5 кабеля пульта (IO13) — к DFPlayer Mini, 9600. Экран тогда только на контроллере. */
static int voice_on;
void hal_voice_begin(int on) {
  voice_on = on;
  Serial1.end();
  Serial1.begin(on ? 9600 : uart_baud_set, SERIAL_8N1, PIN_PNL_RX, PIN_PNL_TX);
}
void hal_voice_write(const uint8_t *data, int len) {
  if (voice_on) Serial1.write(data, (size_t)len);
}

void hal_uart_write(const char *data, int len) {
  if (!uart_mute && !voice_on) Serial1.write((const uint8_t *)data, (size_t)len);
  /* Те же строки — интерфейсу пульта на экране контроллера (lcd_s3.cpp). */
  lcd_rx_put(data, len);
}

/* Журнал: в порт и телефону (Wi-Fi /l и Bluetooth) — см. phone_log в vacuum-s3.ino. */
void phone_log(const char *line);
void hal_log(const char *line) {
  Serial.println(line);
  phone_log(line);
}

/* Две копии настроек («cfg0», «cfg1»), запись по очереди; «cfg» — одна копия прошивки 3.x. */
int hal_settings_load(void *buf, int len) { return prefs.isKey("cfg") ? (int)prefs.getBytes("cfg", buf, (size_t)len) : 0; }
int hal_settings_load2(int slot, void *buf, int len) {
  char k[8] = "cfg0";
  k[3] = (char)('0' + (slot & 7));
  return prefs.isKey(k) ? (int)prefs.getBytes(k, buf, (size_t)len) : 0;
}
/* Слоты 0, 1 — настройки 5.x, 2, 3 — настройки 6.0 (vac_ext). */
void hal_settings_save2(int slot, const void *buf, int len) {
  char k[8] = "cfg0";
  k[3] = (char)('0' + (slot & 7));
  prefs.putBytes(k, buf, (size_t)len);
}

uint32_t hal_rand32(void) { return esp_random(); }

/* Сеть для телефона включает и выключает скетч (там же страница): здесь — только флаг. */
volatile int wifi_req = -1;
char wifi_ssid[24], wifi_pass[12];
void hal_wifi(int on, const char *ssid, const char *pass) {
  if (on) {
    strlcpy(wifi_ssid, ssid, sizeof wifi_ssid);
    strlcpy(wifi_pass, pass, sizeof wifi_pass);
  }
  wifi_req = on ? 1 : 0;
}

}  // extern "C"

/*
 * «Чёрный ящик»: записи по 32 байта в /bb.bin на разделе FAT (9 МБ). Файл до 4 МБ, потом он
 * становится /bb0.bin (старый стирается) — хранится последних 4–8 МБ, это годы работы.
 */
static int bb_ok = -1;
static uint32_t bb_n0, bb_n1;
static const uint32_t BB_MAX = 4u << 20;
static void bb_open(void) {
  if (bb_ok >= 0) return;
  bb_ok = FFat.begin(true) ? 1 : 0;
  if (!bb_ok) return;
  File f = FFat.open("/bb0.bin", "r");
  bb_n0 = f ? (uint32_t)f.size() / 32 : 0;
  if (f) f.close();
  f = FFat.open("/bb.bin", "r");
  bb_n1 = f ? (uint32_t)f.size() / 32 : 0;
  if (f) f.close();
}
void hal_bb_append(const void *rec, int len) {
  bb_open();
  if (!bb_ok || len != 32) return;
  if (bb_n1 * 32 >= BB_MAX) {
    FFat.remove("/bb0.bin");
    FFat.rename("/bb.bin", "/bb0.bin");
    bb_n0 = bb_n1, bb_n1 = 0;
  }
  File f = FFat.open("/bb.bin", "a");
  if (!f) return;
  f.write((const uint8_t *)rec, 32);
  f.close();
  bb_n1++;
}
uint32_t hal_bb_count(void) {
  bb_open();
  return bb_n0 + bb_n1;
}
int hal_bb_read(uint32_t index, void *rec, int len) {
  bb_open();
  if (!bb_ok || len != 32 || index >= bb_n0 + bb_n1) return 1;
  File f = FFat.open(index < bb_n0 ? "/bb0.bin" : "/bb.bin", "r");
  if (!f) return 1;
  f.seek((index < bb_n0 ? index : index - bb_n0) * 32);
  int n = (int)f.read((uint8_t *)rec, 32);
  f.close();
  return n == 32 ? 0 : 1;
}
