/* Копия ../vacuum-panel/panel_int.h (sync-panel.sh) — не править здесь. */
/*
 * Внутреннее: два интерфейса пульта в одной прошивке — для контроллера на ESP32
 * (panel_ui.c, firmware/vacuum-esp32) и для контроллера «S3» (panel_s3.c, firmware/vacuum-s3).
 * Какой из них на экране, решает panel_main.c по строкам контроллера.
 */
#ifndef PANEL_INT_H
#define PANEL_INT_H
#include "panel_ui.h"

#ifdef __cplusplus
extern "C" {
#endif

void v1_setup(uint16_t *fb);
int v1_loop(uint32_t ms);
void v1_touch(int x, int y, int down);
void v1_rx(int ch);

void s3_setup(uint16_t *fb);
int s3_loop(uint32_t ms);
void s3_touch(int x, int y, int down);
void s3_rx(int ch);
/* Контроллер «S3» узнан: в его строке состояния есть поле e1 (турбина 1 включена). */
int s3_detected(void);
int s3_sleeping(void);

/* Экран 3,5″ 480×320 на самом контроллере «S3» (прошивка 6.0): свой интерфейс (panel_t35.c). */
void t35_setup(uint16_t *fb);
int t35_loop(uint32_t ms);
void t35_touch(int x, int y, int down);
void t35_rx(int ch);
int t35_sleeping(void);

#ifdef __cplusplus
}
#endif
#endif
