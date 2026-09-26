/*
 * Драйверы и мелочи ядра: датчики Sensirion SDP810,
 * математика без libm, числа и строки без printf (ядро собирается и для браузера).
 */
#include "vac_core.h"

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
