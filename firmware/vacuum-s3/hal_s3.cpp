/* Прослойка vac_hal.h для Arduino-ESP32 3.x на ESP32-S3 (в отдельном файле — препроцессор .ino её не трогает). */
#include <Arduino.h>
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

void hal_tone(int pin, uint32_t hz) {
  if (!tone_attached) {
    ledcAttach(pin, 2000, 8);
    tone_attached = 1;
  }
  ledcWriteTone(pin, hz);
}

/* К экрану — UART1 (Serial — это USB-C: монитор порта и прошивка). */
void hal_uart_begin(int tx, int rx, uint32_t baud) { Serial1.begin(baud, SERIAL_8N1, rx, tx); }
/* Пока идёт прошивка экрана, строки ядра в UART не идут (там — куски файла). */
volatile int uart_mute;
void hal_uart_write(const char *data, int len) {
  if (!uart_mute) Serial1.write((const uint8_t *)data, (size_t)len);
}

void hal_log(const char *line) { Serial.println(line); }

/* Две копии настроек («cfg0», «cfg1»), запись по очереди; «cfg» — одна копия прошивки 3.x. */
int hal_settings_load(void *buf, int len) { return prefs.isKey("cfg") ? (int)prefs.getBytes("cfg", buf, (size_t)len) : 0; }
int hal_settings_load2(int slot, void *buf, int len) {
  const char *k = slot ? "cfg1" : "cfg0";
  return prefs.isKey(k) ? (int)prefs.getBytes(k, buf, (size_t)len) : 0;
}
void hal_settings_save2(int slot, const void *buf, int len) { prefs.putBytes(slot ? "cfg1" : "cfg0", buf, (size_t)len); }

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
