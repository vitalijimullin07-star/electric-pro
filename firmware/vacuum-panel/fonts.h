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

#ifdef __cplusplus
extern "C" {
#endif

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
extern const pfont_t F_N12;
extern const pfont_t F_N14;
extern const pfont_t F_N16;
extern const pfont_t F_D13;
extern const pfont_t F_D15;
extern const pfont_t F_D17;
extern const pfont_t F_D20;
extern const pfont_t F_D24;
extern const pfont_t F_B30;
extern const pfont_t F_B44;
extern const pfont_t F_B60;
extern const pfont_t F_I18;
extern const pfont_t F_I24;
extern const pfont_t F_I32;
extern const pfont_t F_I44;

/* Иконки: строка UTF-8 знака U+E000 + номер (g_text со шрифтом F_I18…F_I44). */
#define IC_HOME "\xEE\x80\x80"
#define IC_CLEAN "\xEE\x80\x81"
#define IC_FILTER "\xEE\x80\x82"
#define IC_CHART "\xEE\x80\x83"
#define IC_GRID "\xEE\x80\x84"
#define IC_FAN "\xEE\x80\x85"
#define IC_VALVE "\xEE\x80\x86"
#define IC_PLUG "\xEE\x80\x87"
#define IC_DROP "\xEE\x80\x88"
#define IC_SCALE "\xEE\x80\x89"
#define IC_SPEAKER "\xEE\x80\x8A"
#define IC_CLOCK "\xEE\x80\x8B"
#define IC_WIFI "\xEE\x80\x8C"
#define IC_BT "\xEE\x80\x8D"
#define IC_PHONE "\xEE\x80\x8E"
#define IC_WRENCH "\xEE\x80\x8F"
#define IC_FLAG "\xEE\x80\x90"
#define IC_REPORT "\xEE\x80\x91"
#define IC_LIST "\xEE\x80\x92"
#define IC_INFO "\xEE\x80\x93"
#define IC_WARN "\xEE\x80\x94"
#define IC_CHECK "\xEE\x80\x95"
#define IC_CROSS "\xEE\x80\x96"
#define IC_BACK "\xEE\x80\x97"
#define IC_CHEV "\xEE\x80\x98"
#define IC_PLUS "\xEE\x80\x99"
#define IC_MINUS "\xEE\x80\x9A"
#define IC_POWER "\xEE\x80\x9B"
#define IC_PLAY "\xEE\x80\x9C"
#define IC_STOP "\xEE\x80\x9D"
#define IC_HAND "\xEE\x80\x9E"
#define IC_GEAR "\xEE\x80\x9F"
#define IC_BELL "\xEE\x80\xA0"
#define IC_THERMO "\xEE\x80\xA1"
#define IC_BOLT "\xEE\x80\xA2"
#define IC_TANK "\xEE\x80\xA3"
#define IC_HOSE "\xEE\x80\xA4"
#define IC_SCHEME "\xEE\x80\xA5"
#define IC_LOOP "\xEE\x80\xA6"
#define IC_CALENDAR "\xEE\x80\xA7"
#define IC_SUN "\xEE\x80\xA8"
#define IC_MIC "\xEE\x80\xA9"
#define IC_TURBO "\xEE\x80\xAA"
#define IC_EDIT "\xEE\x80\xAB"
#define IC_DOT "\xEE\x80\xAC"
#define IC_BRUSH "\xEE\x80\xAD"
#define IC_VACUUM "\xEE\x80\xAE"

#ifdef __cplusplus
}
#endif
#endif
