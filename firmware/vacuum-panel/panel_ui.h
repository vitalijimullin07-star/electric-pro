/*
 * Пульт пылесоса: интерфейс на экране 800×480 с сенсором (плата ESP32-S3 с экраном).
 * Ядро не знает про железо: рисует в кадр RGB565 в памяти, получает касания и байты
 * от контроллера, отправляет команды через phal_uart_write. На ESP32-S3 его вызывает
 * vacuum-panel.ino (hal_s3.cpp), в симуляции Plata — редактор (сборка в WebAssembly).
 * Одна прошивка — для обоих контроллеров: на ESP32 (firmware/vacuum-esp32, экраны —
 * panel_ui.c) и «S3» (firmware/vacuum-s3, экраны — panel_s3.c); какой подключён, пульт
 * узнаёт по строке состояния (panel_main.c).
 *
 * Связь с контроллером — UART 115200, текстовые строки:
 *   контроллер → пульт: «S …» состояние (каждые 100 мс), «C …» настройки, «J …» журнал,
 *                        «E enc=±N», «E sw», «E hold» — энкодер и его кнопка (у ESP32 —
 *                        «Пуск турбин»); у «S3» ещё «E k=N» / «E kh=N» — кнопки 1–6 у экрана
 *                        (1–3 слева сверху вниз, 4–6 справа), нажатие и удержание, и
 *                        «P off» / «P on» — экран погасить (кнопка «Выкл») и зажечь;
 *   пульт → контроллер: команды (mode, sp, pw, t1, t2, t2allow, clean, coff, tap, set, purge,
 *                        filter new, pulses reset, preset, remote pair, off, wake, ack, export,
 *                        get; у ESP32 — ещё sock, runon) и «hi» раз в 0,5 с.
 */
#ifndef PANEL_UI_H
#define PANEL_UI_H
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define PANEL_VERSION "4.0"

/* Кадр 800×480 RGB565 (строки подряд). */
void ui_setup(uint16_t *fb);
/* Экран 3,5″ 480×320 на самом контроллере «S3» (6.0): кадр 480×320, свой интерфейс. */
void ui_setup_t35(uint16_t *fb);
/* Вызывать часто (раз в 10…20 мс); 1 — кадр перерисован, его пора вывести на экран. */
int ui_loop(uint32_t ms);
/* Касание: down = 1 — палец на экране (нажатие и движение), 0 — отпущен. */
void ui_touch(int x, int y, int down);
/* Байт от контроллера. */
void ui_rx(int ch);
/* Контроллер «выключил» пылесос: подсветку можно погасить (касание всё равно будит). */
int ui_sleeping(void);

/* Прослойка железа пульта. */
void phal_uart_write(const char *s, int len);
void phal_log(const char *line);

#ifdef __cplusplus
}
#endif
#endif
