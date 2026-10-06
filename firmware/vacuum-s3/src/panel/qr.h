/* Копия ../vacuum-panel/qr.h (sync-panel.sh) — не править здесь. */
/* QR-код для экрана пульта: строка → матрица модулей (1 — тёмный). */
#ifndef PANEL_QR_H
#define PANEL_QR_H
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define QR_MAX 37 /* версия 5 */

typedef struct {
  int size;
  uint8_t m[QR_MAX][QR_MAX];
} qr_t;

/* Размер стороны в модулях, 0 — строка не поместилась (больше 106 знаков). */
int qr_encode(const char *text, qr_t *q);

#ifdef __cplusplus
}
#endif
#endif
