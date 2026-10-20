/*
 * Графика пульта: кадр RGB565 в памяти (800×480 у пульта 7″, 480×320 у экрана 3,5″),
 * сглаженные фигуры и текст, окно отсечения.
 * Без библиотек — собирается и для ESP32-S3, и в WebAssembly для симуляции.
 */
#ifndef PANEL_GFX_H
#define PANEL_GFX_H
#include <stdint.h>
#include "fonts.h"

#ifdef __cplusplus
extern "C" {
#endif

#define GW 800
#define GH 480
/* Во сколько раз кадр крупнее точек интерфейса: 1 у пульта и контроллера, 3 — у приложения для
 * телефона (vacuum-panel-hd.wasm, тот же интерфейс чётко на экране телефона). */
#ifndef PANEL_SCALE
#define PANEL_SCALE 1
#endif
#define RGB565(r, g, b) ((uint16_t)((((r) & 0xF8) << 8) | (((g) & 0xFC) << 3) | ((b) >> 3)))
#define HEX(h) RGB565(((h) >> 16) & 255, ((h) >> 8) & 255, (h) & 255)

/* Крупные знаки (fonts_hd.c): размеры не помещаются в байт. */
typedef struct {
  uint16_t cp;
  uint16_t w, h;
  int16_t x, y;
  uint16_t adv;
  uint32_t off;
} phglyph_t;

typedef struct {
  const phglyph_t *glyphs;
  uint16_t count;
  uint16_t size, ascent, descent;
  const uint8_t *bits;
} phfont_t;

/* Пара «шрифт → он же крупнее», в конце {0, 0}. */
typedef struct {
  const pfont_t *lo;
  const phfont_t *hi;
} phpair_t;

#if PANEL_SCALE > 1
extern const phpair_t G_HD[];
#endif

void g_init(uint16_t *fb);
/* Кадр другого размера (экран 3,5″ на контроллере — 480×320). */
void g_init_size(uint16_t *fb, int w, int h);
int g_width(void);
int g_height(void);
/* Кадр в памяти — g_width()·g_scale() × g_height()·g_scale(). */
int g_scale(void);
/* Окно отсечения [x0, x1) × [y0, y1): рисование только внутри (прокрутка списков). */
void g_clip(int x0, int y0, int x1, int y1);
void g_noclip(void);
/* Смешать прямоугольник с цветом c (alpha 0…256): затемнение под окнами. */
void g_dim(int x, int y, int w, int h, uint16_t c, int alpha);
/* Контур скруглённого прямоугольника толщиной t (внутрь). */
void g_rrect_line(float x, float y, float w, float h, float r, float t, uint16_t c);
void g_fill(int x, int y, int w, int h, uint16_t c);
/* Закрашенный прямоугольник со скруглёнными (сглаженными) углами. */
void g_rrect(float x, float y, float w, float h, float r, uint16_t c);
/* Полоса со скруглёнными концами: фон bg, слева доля frac цветом fg (обрезана по форме полосы). */
void g_bar(float x, float y, float w, float h, float frac, uint16_t bg, uint16_t fg);
/* Кольцо: окружность радиуса r толщиной w. */
void g_ring(float cx, float cy, float r, float w, uint16_t c);
/* Дуга по часовой стрелке от «12 часов», доля 0…1, скруглённые концы. */
void g_arc(float cx, float cy, float r, float w, float frac, uint16_t c);
/* Дуга от a0 (доля оборота от «12 часов» по часовой) длиной span (доля оборота). */
void g_arc2(float cx, float cy, float r, float w, float a0, float span, uint16_t c);
/* Закрашенный круг. */
void g_circle(float cx, float cy, float r, uint16_t c);
/* sin(2π·f) — для поворотов (лопасти турбин на схеме). */
float g_sin_turn(float f);
/* Отрезок толщиной w со скруглёнными концами. */
void g_line(float x0, float y0, float x1, float y1, float w, uint16_t c);

/* Текст UTF-8 от точки (x, базовая линия); spacing — добавка к шагу. Возвращает x конца. */
int g_text(const pfont_t *f, int x, int base, const char *s, uint16_t c, int spacing);
int g_text_w(const pfont_t *f, const char *s, int spacing);
/* Выравнивание: 0 — влево от x, 1 — по центру x, 2 — вправо до x. */
int g_text_at(const pfont_t *f, int x, int base, const char *s, uint16_t c, int align);

float g_sqrt(float x);

#ifdef __cplusplus
}
#endif
#endif
