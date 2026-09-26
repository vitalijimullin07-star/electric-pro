/* Шрифты пульта: сглаживание 4 бита на точку, знаки по возрастанию кода. */
#ifndef PANEL_FONTS_H
#define PANEL_FONTS_H
#include <stdint.h>

typedef struct {
  uint16_t cp;      /* код знака (Юникод) */
  uint8_t w, h;     /* размер растра */
  int8_t x, y;      /* смещение растра от точки на базовой линии */
  uint8_t adv;      /* шаг */
  uint32_t off;     /* начало растра в bits (растр — по 2 точки в байте, строки подряд) */
} pglyph_t;

typedef struct {
  const pglyph_t *glyphs;
  uint16_t count;
  uint8_t size, ascent, descent;
  const uint8_t *bits;
} pfont_t;

extern const pfont_t F_S11;
extern const pfont_t F_S12;
extern const pfont_t F_S13;
extern const pfont_t F_S14;
extern const pfont_t F_S15;
extern const pfont_t F_S16;
extern const pfont_t F_S20;
extern const pfont_t F_M13;
extern const pfont_t F_M14;
extern const pfont_t F_M15;
extern const pfont_t F_M16;
extern const pfont_t F_M18;
extern const pfont_t F_M22;
extern const pfont_t F_M27;
extern const pfont_t F_M82;

#endif
