/*
 * Драйверы и мелочи ядра: датчики Sensirion SDP810/SDP811, расширитель PCA9555,
 * подпись посылок беспроводного пульта (SipHash-2-4), математика без libm, числа
 * и строки без printf (ядро собирается и для браузера).
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

/* ---------------- Sensirion SDP810 (0x25) и SDP811 (0x26) на одной шине ---------------- */

static uint8_t crc8(const uint8_t *d, int n) {
  uint8_t crc = 0xFF;
  for (int i = 0; i < n; i++) {
    crc ^= d[i];
    for (int b = 0; b < 8; b++) crc = (uint8_t)(crc & 0x80 ? (crc << 1) ^ 0x31 : crc << 1);
  }
  return crc;
}

/* Непрерывное измерение перепада с усреднением до чтения (команда 0x3615). */
int sdp_start(int addr) {
  const uint8_t cmd[2] = {0x36, 0x15};
  return hal_i2c_write(0, addr, cmd, 2);
}

int sdp_read(int addr, float *pa) {
  uint8_t d[9];
  if (hal_i2c_read(0, addr, d, 9)) return 1;
  if (crc8(d, 2) != d[2] || crc8(d + 6, 2) != d[8]) return 2;
  int16_t raw = (int16_t)((d[0] << 8) | d[1]);
  int16_t scale = (int16_t)((d[6] << 8) | d[7]);
  if (scale <= 0) return 3;
  *pa = (float)raw / (float)scale;
  return 0;
}

/* ---------------- PCA9555 / TCA9555 (0x20): входы, кроме P12 (сброс экрана) и P13 (светодиод) ---------------- */

/* Выходы: сначала значения (регистры 2, 3), потом направление (6, 7: 1 — вход). */
int exp_init(uint16_t out) {
  if (exp_write(out)) return 1;
  const uint8_t cfg[3] = {0x06, (uint8_t)~(EXP_OUTS & 0xFF), (uint8_t)~(EXP_OUTS >> 8)};
  return hal_i2c_write(0, EXP_ADDR, cfg, 3);
}

int exp_write(uint16_t out) {
  const uint8_t d[3] = {0x02, (uint8_t)(out | ~EXP_OUTS), (uint8_t)((out | ~EXP_OUTS) >> 8)};
  return hal_i2c_write(0, EXP_ADDR, d, 3);
}

int exp_read(uint16_t *in) {
  const uint8_t reg = 0x00; /* входной порт 0, следом — порт 1 */
  uint8_t d[2];
  if (hal_i2c_write(0, EXP_ADDR, &reg, 1)) return 1;
  if (hal_i2c_read(0, EXP_ADDR, d, 2)) return 2;
  *in = (uint16_t)(d[0] | (d[1] << 8));
  return 0;
}

/* ---------------- SipHash-2-4 ---------------- */

#define ROTL(x, b) (uint64_t)(((x) << (b)) | ((x) >> (64 - (b))))
#define SIPROUND                                                                                                                                     \
  do {                                                                                                                                               \
    v0 += v1, v1 = ROTL(v1, 13), v1 ^= v0, v0 = ROTL(v0, 32);                                                                                          \
    v2 += v3, v3 = ROTL(v3, 16), v3 ^= v2;                                                                                                           \
    v0 += v3, v3 = ROTL(v3, 21), v3 ^= v0;                                                                                                           \
    v2 += v1, v1 = ROTL(v1, 17), v1 ^= v2, v2 = ROTL(v2, 32);                                                                                          \
  } while (0)

static uint64_t le64(const uint8_t *p) {
  uint64_t v = 0;
  for (int i = 7; i >= 0; i--) v = (v << 8) | p[i];
  return v;
}

uint64_t siphash24(const uint8_t key[16], const uint8_t *data, int len) {
  uint64_t k0 = le64(key), k1 = le64(key + 8);
  uint64_t v0 = 0x736f6d6570736575ULL ^ k0, v1 = 0x646f72616e646f6dULL ^ k1;
  uint64_t v2 = 0x6c7967656e657261ULL ^ k0, v3 = 0x7465646279746573ULL ^ k1;
  int full = len & ~7;
  for (int i = 0; i < full; i += 8) {
    uint64_t m = le64(data + i);
    v3 ^= m;
    SIPROUND;
    SIPROUND;
    v0 ^= m;
  }
  uint64_t b = (uint64_t)len << 56;
  for (int i = 0; i < (len & 7); i++) b |= (uint64_t)data[full + i] << (8 * i);
  v3 ^= b;
  SIPROUND;
  SIPROUND;
  v0 ^= b;
  v2 ^= 0xff;
  SIPROUND;
  SIPROUND;
  SIPROUND;
  SIPROUND;
  return v0 ^ v1 ^ v2 ^ v3;
}
