/*
 * Прослойка между ядром прошивки и железом. На ESP32 её реализует vacuum-esp32.ino
 * (Arduino-ESP32 3.x), в симуляции Plata — редактор (src/core/sim/esp32.ts), а ядро
 * (vac_core.c, vac_ui.c, vac_drv.c) одно и то же.
 */
#ifndef VAC_HAL_H
#define VAC_HAL_H
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#if defined(ESP_PLATFORM)
#include "esp_attr.h"
/* Код и данные, которые нужны в прерываниях, — во внутренней памяти (работают и во время записи во флеш). */
#define VAC_ISR IRAM_ATTR
#else
#define VAC_ISR
#endif

enum { HAL_IN = 0, HAL_OUT = 1, HAL_IN_PULLUP = 2 };

void hal_pin_mode(int pin, int mode);
/* Запись и чтение вывода — в том числе из прерываний. */
void hal_pin_write(int pin, int level);
int hal_pin_read(int pin);
/* Прерывание по обоим фронтам вывода: ядро получит vac_on_pin(). */
void hal_pin_irq(int pin);

uint32_t hal_micros(void);
uint32_t hal_millis(void);

/* Напряжение на входе АЦП, мВ (ослабление 11 дБ, калибровка eFuse). */
int hal_adc_mv(int pin);

/* I²C: 0 — успешно, иначе ошибка (нет ответа). */
int hal_i2c_begin(int bus, int sda, int scl, uint32_t hz);
int hal_i2c_write(int bus, int addr, const uint8_t *data, int len);
int hal_i2c_read(int bus, int addr, uint8_t *data, int len);

/* Меандр на выводе (зуммер), 0 — выключить. */
void hal_tone(int pin, uint32_t hz);

/* UART к пульту: байты от него ядро получает через vac_uart(). */
void hal_uart_begin(int tx, int rx, uint32_t baud);
void hal_uart_write(const char *data, int len);

/* Строка в монитор порта (без перевода строки). */
void hal_log(const char *line);

/* Настройки в энергонезависимой памяти: load возвращает число прочитанных байт. */
int hal_settings_load(void *buf, int len);
void hal_settings_save(const void *buf, int len);

#ifdef __cplusplus
}
#endif
#endif
