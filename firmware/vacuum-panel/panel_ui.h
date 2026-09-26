/*
 * Пульт пылесоса: интерфейс на экране 800×480 с сенсором (плата ESP32-S3 с экраном).
 * Ядро не знает про железо: рисует в кадр RGB565 в памяти, получает касания и байты
 * от контроллера, отправляет команды через phal_uart_write. На ESP32-S3 его вызывает
 * vacuum-panel.ino (hal_s3.cpp), в симуляции Plata — редактор (сборка в WebAssembly).
 *
 * Связь с контроллером — UART 115200, текстовые строки:
 *   контроллер → пульт: «S …» состояние (каждые 100 мс), «C …» настройки, «J …» журнал,
 *                        «E enc=±N», «E sw», «E hold» — энкодер и кнопка «Пуск турбин»;
 *   пульт → контроллер: команды (mode, sp, pw, sock, runon, t2, clean, set, purge,
 *                        filter new, pulses reset, preset, ack, export, get) и «hi» раз в 0,5 с.
 */
#ifndef PANEL_UI_H
#define PANEL_UI_H
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define PANEL_VERSION "1.0"

/* Кадр 800×480 RGB565 (строки подряд). */
void ui_setup(uint16_t *fb);
/* Вызывать часто (раз в 10…20 мс); 1 — кадр перерисован, его пора вывести на экран. */
int ui_loop(uint32_t ms);
/* Касание: down = 1 — палец на экране (нажатие и движение), 0 — отпущен. */
void ui_touch(int x, int y, int down);
/* Байт от контроллера. */
void ui_rx(int ch);

/* Прослойка железа пульта. */
void phal_uart_write(const char *s, int len);
void phal_log(const char *line);

#ifdef __cplusplus
}
#endif
#endif
