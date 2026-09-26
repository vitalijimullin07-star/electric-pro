/*
 * Графика пульта: кадр 800×480 RGB565 в памяти, сглаженные фигуры и текст.
 * Без библиотек — собирается и для ESP32-S3, и в WebAssembly для симуляции.
 */
#ifndef PANEL_GFX_H
#define PANEL_GFX_H
#include <stdint.h>
#include "fonts.h"

#define GW 800
#define GH 480
#define RGB565(r, g, b) ((uint16_t)((((r) & 0xF8) << 8) | (((g) & 0xFC) << 3) | ((b) >> 3)))
#define HEX(h) RGB565(((h) >> 16) & 255, ((h) >> 8) & 255, (h) & 255)

void g_init(uint16_t *fb);
void g_fill(int x, int y, int w, int h, uint16_t c);
/* Закрашенный прямоугольник со скруглёнными (сглаженными) углами. */
void g_rrect(float x, float y, float w, float h, float r, uint16_t c);
/* Полоса со скруглёнными концами: фон bg, слева доля frac цветом fg (обрезана по форме полосы). */
void g_bar(float x, float y, float w, float h, float frac, uint16_t bg, uint16_t fg);
/* Кольцо: окружность радиуса r толщиной w. */
void g_ring(float cx, float cy, float r, float w, uint16_t c);
/* Дуга по часовой стрелке от «12 часов», доля 0…1, скруглённые концы. */
void g_arc(float cx, float cy, float r, float w, float frac, uint16_t c);
/* Отрезок толщиной w со скруглёнными концами. */
void g_line(float x0, float y0, float x1, float y1, float w, uint16_t c);

/* Текст UTF-8 от точки (x, базовая линия); spacing — добавка к шагу. Возвращает x конца. */
int g_text(const pfont_t *f, int x, int base, const char *s, uint16_t c, int spacing);
int g_text_w(const pfont_t *f, const char *s, int spacing);
/* Выравнивание: 0 — влево от x, 1 — по центру x, 2 — вправо до x. */
int g_text_at(const pfont_t *f, int x, int base, const char *s, uint16_t c, int align);

float g_sqrt(float x);

#endif
