/* Прослойка vac_hal.h для Arduino-ESP32 3.x (в отдельном файле — препроцессор .ino её не трогает). */
#include <Arduino.h>
#include <Preferences.h>
#include <Wire.h>
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

static TwoWire &bus_of(int bus) { return bus ? Wire1 : Wire; }

int hal_i2c_begin(int bus, int sda, int scl, uint32_t hz) { return bus_of(bus).begin(sda, scl, hz) ? 0 : 1; }

int hal_i2c_write(int bus, int addr, const uint8_t *data, int len) {
  TwoWire &w = bus_of(bus);
  w.beginTransmission((uint8_t)addr);
  w.write(data, (size_t)len);
  return w.endTransmission();
}

int hal_i2c_read(int bus, int addr, uint8_t *data, int len) {
  TwoWire &w = bus_of(bus);
  if (w.requestFrom((uint8_t)addr, (size_t)len) != (size_t)len) return 1;
  for (int i = 0; i < len; i++) data[i] = (uint8_t)w.read();
  return 0;
}

void hal_tone(int pin, uint32_t hz) {
  if (!tone_attached) {
    ledcAttach(pin, 2000, 8);
    tone_attached = 1;
  }
  ledcWriteTone(pin, hz);
}

void hal_log(const char *line) { Serial.println(line); }

int hal_settings_load(void *buf, int len) { return (int)prefs.getBytes("cfg", buf, (size_t)len); }
void hal_settings_save(const void *buf, int len) { prefs.putBytes("cfg", buf, (size_t)len); }

}  // extern "C"

