/* Только для сборки в WebAssembly: кадр 800×480 и мелочи без стандартной библиотеки. */
#if defined(__wasm__)
#include "panel_ui.h"
#include "gfx.h"

static uint16_t frame[GW * GH];

uint16_t *sim_frame(void) { return frame; }
void sim_setup(void) { ui_setup(frame); }

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
