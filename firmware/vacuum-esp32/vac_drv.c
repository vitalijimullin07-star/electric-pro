/*
 * Драйверы и мелочи ядра: экран SSD1306/SH1106 по I²C, датчики Sensirion SDP810,
 * математика без libm, числа и строки без printf (ядро собирается и для браузера).
 */
#include "vac_core.h"
#include "vac_font.h"

/* ---------------- без стандартной библиотеки (сборка в WebAssembly) ---------------- */

#if defined(__wasm__)
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
void *memmove(void *d, const void *s, unsigned long n) {
  unsigned char *p = (unsigned char *)d;
  const unsigned char *q = (const unsigned char *)s;
  if (p < q)
    while (n--) *p++ = *q++;
  else {
    p += n;
    q += n;
    while (n--) *--p = *--q;
  }
  return d;
}
#endif

/* ---------------- математика ---------------- */

float v_sqrtf(float x) { return x > 0 ? __builtin_sqrtf(x) : 0; }

/* Натуральный логарифм: x = m·2^e, ln m = 2·atanh((m−1)/(m+1)). */
float v_logf(float x) {
  if (x <= 0) return -1e30f;
  union {
    float f;
    uint32_t u;
  } v = {x};
  int e = (int)((v.u >> 23) & 0xff) - 127;
  v.u = (v.u & 0x007fffff) | 0x3f800000;
  float m = v.f;
  if (m > 1.41421356f) {
    m *= 0.5f;
    e++;
  }
  float z = (m - 1) / (m + 1);
  float z2 = z * z;
  float s = z * (2.0f + z2 * (0.6666667f + z2 * (0.4f + z2 * (0.2857143f + z2 * 0.2222222f))));
  return s + (float)e * 0.69314718f;
}

/* Синус для 0…π/2 и шире (ряд Тейлора после приведения). */
float v_sinf(float x) {
  const float PI = 3.14159265f;
  while (x > PI) x -= 2 * PI;
  while (x < -PI) x += 2 * PI;
  if (x > PI / 2) x = PI - x;
  if (x < -PI / 2) x = -PI - x;
  float x2 = x * x;
  return x * (1 - x2 / 6 * (1 - x2 / 20 * (1 - x2 / 42 * (1 - x2 / 72))));
}

/* ---------------- строки и числа ---------------- */

int str_len(const char *s) {
  int n = 0;
  while (s[n]) n++;
  return n;
}

char *str_cat(char *dst, const char *src) {
  char *d = dst + str_len(dst);
  while ((*d++ = *src++)) {
  }
  return dst;
}

int str_eq(const char *a, const char *b) {
  while (*a && *a == *b) a++, b++;
  return *a == *b;
}

int str_starts(const char *s, const char *prefix) {
  while (*prefix)
    if (*s++ != *prefix++) return 0;
  return 1;
}

long str_to_int(const char *s) {
  long v = 0;
  int neg = 0;
  while (*s == ' ') s++;
  if (*s == '-') neg = 1, s++;
  while (*s >= '0' && *s <= '9') v = v * 10 + (*s++ - '0');
  return neg ? -v : v;
}

char *fmt_int(char *out, long v) {
  char tmp[16];
  int n = 0, neg = v < 0;
  unsigned long u = neg ? (unsigned long)(-v) : (unsigned long)v;
  do tmp[n++] = (char)('0' + u % 10), u /= 10;
  while (u);
  char *p = out;
  if (neg) *p++ = '-';
  while (n) *p++ = tmp[--n];
  *p = 0;
  return out;
}

char *fmt_num(char *out, float v, int decimals) {
  long mul = decimals == 0 ? 1 : decimals == 1 ? 10 : decimals == 2 ? 100 : 1000;
  int neg = v < 0;
  if (neg) v = -v;
  long x = (long)(v * mul + 0.5f);
  char *p = out;
  if (neg && x) *p++ = '-';
  fmt_int(p, x / mul);
  if (decimals) {
    p += str_len(p);
    *p++ = ',';
    long f = x % mul;
    for (long d = mul / 10; d; d /= 10) *p++ = (char)('0' + (f / d) % 10);
    *p = 0;
  }
  return out;
}

/* ---------------- экран 128×64 ---------------- */

#define OLED_ADDR 0x3C
static uint8_t fb[8][128];
static int oled_col0;
int oled_ok;

static int oled_cmd(const uint8_t *c, int n) {
  uint8_t buf[32];
  buf[0] = 0x00;
  for (int i = 0; i < n; i++) buf[i + 1] = c[i];
  return hal_i2c_write(0, OLED_ADDR, buf, n + 1);
}

void oled_init(int sh1106) {
  static const uint8_t ssd[] = {0xAE, 0xD5, 0x80, 0xA8, 0x3F, 0xD3, 0x00, 0x40, 0x8D, 0x14, 0x20, 0x02, 0xA1, 0xC8, 0xDA, 0x12, 0x81, 0xCF, 0xD9, 0xF1, 0xDB, 0x40, 0xA4, 0xA6};
  static const uint8_t sh[] = {0xAE, 0xD5, 0x80, 0xA8, 0x3F, 0xD3, 0x00, 0x40, 0xAD, 0x8B, 0xA1, 0xC8, 0xDA, 0x12, 0x81, 0xCF, 0xD9, 0x22, 0xDB, 0x35, 0xA4, 0xA6};
  oled_col0 = sh1106 ? 2 : 0;
  oled_ok = oled_cmd(sh1106 ? sh : ssd, sh1106 ? (int)sizeof sh : (int)sizeof ssd) == 0;
  oled_clear();
  oled_flush();
  static const uint8_t on[] = {0xAF};
  if (oled_ok) oled_cmd(on, 1);
}

void oled_clear(void) {
  for (int p = 0; p < 8; p++)
    for (int x = 0; x < 128; x++) fb[p][x] = 0;
}

/* Постранично: подходит и SSD1306, и SH1106 (у него 132 столбца, видимые — со второго). */
void oled_flush(void) {
  if (!oled_ok) return;
  for (int p = 0; p < 8; p++) {
    uint8_t c[3] = {(uint8_t)(0xB0 | p), (uint8_t)(oled_col0 & 0x0F), (uint8_t)(0x10 | (oled_col0 >> 4))};
    if (oled_cmd(c, 3)) {
      oled_ok = 0;
      return;
    }
    for (int x = 0; x < 128; x += 32) {
      uint8_t buf[33];
      buf[0] = 0x40;
      for (int i = 0; i < 32; i++) buf[i + 1] = fb[p][x + i];
      hal_i2c_write(0, OLED_ADDR, buf, 33);
    }
  }
}

void oled_pixel(int x, int y, int on) {
  if (x < 0 || x >= 128 || y < 0 || y >= 64) return;
  if (on)
    fb[y >> 3][x] |= (uint8_t)(1 << (y & 7));
  else
    fb[y >> 3][x] &= (uint8_t)~(1 << (y & 7));
}

void oled_fill(int x, int y, int w, int h, int on) {
  for (int j = y; j < y + h; j++)
    for (int i = x; i < x + w; i++) oled_pixel(i, j, on);
}

void oled_frame(int x, int y, int w, int h) {
  for (int i = x; i < x + w; i++) oled_pixel(i, y, 1), oled_pixel(i, y + h - 1, 1);
  for (int j = y; j < y + h; j++) oled_pixel(x, j, 1), oled_pixel(x + w - 1, j, 1);
}

/* Следующий знак UTF-8. */
static uint32_t utf8_next(const char **ps) {
  const uint8_t *s = (const uint8_t *)*ps;
  uint32_t c = *s++;
  if (c >= 0xE0 && s[0] && s[1]) {
    c = ((c & 0x0F) << 12) | ((uint32_t)(s[0] & 0x3F) << 6) | (s[1] & 0x3F);
    s += 2;
  } else if (c >= 0xC0 && s[0]) {
    c = ((c & 0x1F) << 6) | (s[0] & 0x3F);
    s += 1;
  }
  *ps = (const char *)s;
  return c;
}

static const uint8_t *glyph(uint32_t c) {
  int lo = 0, hi = VAC_FONT_COUNT - 1;
  while (lo <= hi) {
    int mid = (lo + hi) / 2;
    if (VAC_FONT_CODES[mid] == c) return VAC_FONT_BITS[mid];
    if (VAC_FONT_CODES[mid] < c)
      lo = mid + 1;
    else
      hi = mid - 1;
  }
  return VAC_FONT_BITS[0x3F - 0x20]; /* «?» */
}

int oled_text_width(const char *s, int scale) {
  int n = 0;
  while (*s) {
    utf8_next(&s);
    n++;
  }
  return n * 5 * scale;
}

/* Текст шрифтом 5×8 (scale — увеличение); возвращает x после строки. */
int oled_text(int x, int y, const char *s, int scale, int invert) {
  while (*s) {
    const uint8_t *g = glyph(utf8_next(&s));
    for (int cx = 0; cx < 5; cx++)
      for (int cy = 0; cy < 8; cy++) {
        int on = (g[cx] >> cy) & 1;
        if (invert) on = !on;
        for (int a = 0; a < scale; a++)
          for (int b = 0; b < scale; b++) oled_pixel(x + cx * scale + a, y + cy * scale + b, on);
      }
    x += 5 * scale;
  }
  return x;
}

/* ---------------- Sensirion SDP810 (I²C 0x25) ---------------- */

#define SDP_ADDR 0x25

static uint8_t crc8(const uint8_t *d, int n) {
  uint8_t crc = 0xFF;
  for (int i = 0; i < n; i++) {
    crc ^= d[i];
    for (int b = 0; b < 8; b++) crc = (uint8_t)(crc & 0x80 ? (crc << 1) ^ 0x31 : crc << 1);
  }
  return crc;
}

/* Непрерывное измерение перепада с усреднением до чтения (команда 0x3615). */
int sdp_start(int bus) {
  const uint8_t cmd[2] = {0x36, 0x15};
  return hal_i2c_write(bus, SDP_ADDR, cmd, 2);
}

int sdp_read(int bus, float *pa) {
  uint8_t d[9];
  if (hal_i2c_read(bus, SDP_ADDR, d, 9)) return 1;
  if (crc8(d, 2) != d[2] || crc8(d + 6, 2) != d[8]) return 2;
  int16_t raw = (int16_t)((d[0] << 8) | d[1]);
  int16_t scale = (int16_t)((d[6] << 8) | d[7]);
  if (scale <= 0) return 3;
  *pa = (float)raw / (float)scale;
  return 0;
}
