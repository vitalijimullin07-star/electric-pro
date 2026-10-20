/* Только для сборки в WebAssembly: кадр (800×480, у телефона — крупнее) и мелочи без стандартной библиотеки. */
#if defined(__wasm__)
#include "panel_ui.h"
#include "gfx.h"

static uint16_t frame[GW * GH * PANEL_SCALE * PANEL_SCALE];

uint16_t *sim_frame(void) { return frame; }
void sim_setup(void) { ui_setup(frame); }
/* Экран 3,5″ (480×320) на контроллере. */
void sim_setup_t35(void) { ui_setup_t35(frame); }
/* Размер кадра в памяти (в sim_scale() раз больше точек интерфейса; касания — в точках интерфейса). */
int sim_width(void) { return g_width() * g_scale(); }
int sim_height(void) { return g_height() * g_scale(); }
int sim_scale(void) { return g_scale(); }

void *memset(void *d, int c, unsigned long n) {
  unsigned char *p = (unsigned char *)d;
  while (n--) *p++ = (unsigned char)c;
  return d;
}
void *memcpy(void *d, const void *s, unsigned long n) {
  unsigned char *p = (unsigned char *)d;
  const unsigned char *q = (const unsigned char *)s;
  while (n--) *p++ = *q++;
  return d;
}
#endif
