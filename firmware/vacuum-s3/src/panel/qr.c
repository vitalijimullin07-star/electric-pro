/* Копия ../vacuum-panel/qr.c (sync-panel.sh) — не править здесь. */
#define PANEL_IN_CTRL 1
/*
 * QR-код (ISO/IEC 18004) без стандартной библиотеки: байтовый режим, коррекция L, версии 1–5
 * (до 106 знаков) — хватает на строку сети Wi-Fi «WIFI:T:WPA;S:…;P:…;;», которую камера
 * телефона понимает как «подключиться». Маска выбирается по штрафам стандарта.
 */
#include "qr.h"

/* Данных и коррекции (кодовых слов) для уровня L, версии 1–5 — один блок. */
static const uint8_t DATA_CW[6] = {0, 19, 34, 55, 80, 108};
static const uint8_t ECC_CW[6] = {0, 7, 10, 15, 20, 26};
static const uint8_t ALIGN[6] = {0, 0, 18, 22, 26, 30};

/* ---------------- Рида — Соломона в GF(256), многочлен 0x11D ---------------- */

static uint8_t gf_mul(uint8_t a, uint8_t b) {
  uint8_t r = 0;
  while (b) {
    if (b & 1) r ^= a;
    a = (uint8_t)((a << 1) ^ (a & 0x80 ? 0x1D : 0));
    b >>= 1;
  }
  return r;
}

static void rs_ecc(const uint8_t *data, int n, uint8_t *ecc, int k) {
  uint8_t gen[32] = {0};
  /* Порождающий многочлен ∏(x − αⁱ), i = 0…k−1 (старший коэффициент 1 не храним). */
  gen[k - 1] = 1;
  uint8_t root = 1;
  for (int i = 0; i < k; i++) {
    for (int j = 0; j < k; j++) {
      gen[j] = gf_mul(gen[j], root);
      if (j + 1 < k) gen[j] ^= gen[j + 1];
    }
    root = gf_mul(root, 2);
  }
  for (int i = 0; i < k; i++) ecc[i] = 0;
  for (int i = 0; i < n; i++) {
    uint8_t f = data[i] ^ ecc[0];
    for (int j = 0; j < k - 1; j++) ecc[j] = ecc[j + 1];
    ecc[k - 1] = 0;
    for (int j = 0; j < k; j++) ecc[j] ^= gf_mul(gen[j], f);
  }
}

/* ---------------- матрица ---------------- */

static uint8_t fn[QR_MAX][QR_MAX]; /* служебные модули (не данные) */

static void setm(qr_t *q, int x, int y, int dark, int func) {
  q->m[y][x] = (uint8_t)dark;
  if (func) fn[y][x] = 1;
}

static void finder(qr_t *q, int cx, int cy) {
  for (int dy = -4; dy <= 4; dy++)
    for (int dx = -4; dx <= 4; dx++) {
      int x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= q->size || y >= q->size) continue;
      int d = dx < 0 ? -dx : dx, e = dy < 0 ? -dy : dy, r = d > e ? d : e;
      setm(q, x, y, r != 2 && r != 4, 1);
    }
}

static void align(qr_t *q, int cx, int cy) {
  for (int dy = -2; dy <= 2; dy++)
    for (int dx = -2; dx <= 2; dx++) {
      int d = dx < 0 ? -dx : dx, e = dy < 0 ? -dy : dy, r = d > e ? d : e;
      setm(q, cx + dx, cy + dy, r != 1, 1);
    }
}

/* Формат: уровень L (01) и маска, BCH(15,5), маска 0x5412. */
static void format_bits(qr_t *q, int mask) {
  int data = (1 << 3) | mask;
  int rem = data;
  for (int i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >> 9) * 0x537);
  int bits = ((data << 10) | rem) ^ 0x5412;
  int n = q->size;
  for (int i = 0; i <= 5; i++) setm(q, 8, i, (bits >> i) & 1, 1);
  setm(q, 8, 7, (bits >> 6) & 1, 1);
  setm(q, 8, 8, (bits >> 7) & 1, 1);
  setm(q, 7, 8, (bits >> 8) & 1, 1);
  for (int i = 9; i < 15; i++) setm(q, 14 - i, 8, (bits >> i) & 1, 1);
  for (int i = 0; i < 8; i++) setm(q, n - 1 - i, 8, (bits >> i) & 1, 1);
  for (int i = 8; i < 15; i++) setm(q, 8, n - 15 + i, (bits >> i) & 1, 1);
  setm(q, 8, n - 8, 1, 1); /* тёмный модуль */
}

static int mask_bit(int m, int x, int y) {
  switch (m) {
  case 0: return (x + y) % 2 == 0;
  case 1: return y % 2 == 0;
  case 2: return x % 3 == 0;
  case 3: return (x + y) % 3 == 0;
  case 4: return (x / 3 + y / 2) % 2 == 0;
  case 5: return x * y % 2 + x * y % 3 == 0;
  case 6: return (x * y % 2 + x * y % 3) % 2 == 0;
  default: return ((x + y) % 2 + x * y % 3) % 2 == 0;
  }
}

static void apply_mask(qr_t *q, int m) {
  for (int y = 0; y < q->size; y++)
    for (int x = 0; x < q->size; x++)
      if (!fn[y][x] && mask_bit(m, x, y)) q->m[y][x] ^= 1;
}

/* Штрафы стандарта: ряды одного цвета, квадраты 2×2, узор как у искателя, доля тёмных. */
static long penalty(const qr_t *q) {
  int n = q->size;
  long p = 0;
  for (int pass = 0; pass < 2; pass++)
    for (int a = 0; a < n; a++) {
      int run = 1;
      uint16_t hist = 0;
      for (int b = 0; b < n; b++) {
        int c = pass ? q->m[b][a] : q->m[a][b];
        if (b) {
          int prev = pass ? q->m[b - 1][a] : q->m[a][b - 1];
          if (c == prev) {
            if (++run == 5) p += 3;
            else if (run > 5) p++;
          } else
            run = 1;
        }
        hist = (uint16_t)(((hist << 1) | c) & 0x7FF);
        if (b >= 10 && (hist == 0x5D || hist == 0x5D0)) p += 40;
      }
    }
  int dark = 0;
  for (int y = 0; y < n; y++)
    for (int x = 0; x < n; x++) {
      dark += q->m[y][x];
      if (x + 1 < n && y + 1 < n) {
        int c = q->m[y][x];
        if (q->m[y][x + 1] == c && q->m[y + 1][x] == c && q->m[y + 1][x + 1] == c) p += 3;
      }
    }
  int total = n * n, k = 0;
  while ((dark * 20 - total * 10) > total * (k + 1) || (total * 10 - dark * 20) > total * (k + 1)) k++;
  return p + k * 10;
}

int qr_encode(const char *text, qr_t *q) {
  int len = 0;
  while (text[len]) len++;
  int ver = 1;
  while (ver <= 5 && len + 2 > DATA_CW[ver]) ver++;
  if (ver > 5) return 0;
  int dcw = DATA_CW[ver], ecw = ECC_CW[ver];
  /* Биты данных: режим 0100, длина (8 бит), байты, конец, выравнивание, заполнители. */
  uint8_t cw[134] = {0};
  int bit = 0;
#define PUT(v, nb)                                                  \
  for (int i_ = (nb) - 1; i_ >= 0; i_--, bit++)                     \
    if (((v) >> i_) & 1) cw[bit >> 3] |= (uint8_t)(0x80 >> (bit & 7));
  PUT(4, 4);
  PUT(len, 8);
  for (int i = 0; i < len; i++) PUT((uint8_t)text[i], 8);
  int cap = dcw * 8;
  for (int i = 0; i < 4 && bit < cap; i++) bit++;
  bit = (bit + 7) & ~7;
  for (int i = bit / 8, pad = 0; i < dcw; i++, pad ^= 1) cw[i] = pad ? 0x11 : 0xEC;
#undef PUT
  rs_ecc(cw, dcw, cw + dcw, ecw);
  int total = dcw + ecw;

  q->size = 17 + 4 * ver;
  int n = q->size;
  for (int y = 0; y < n; y++)
    for (int x = 0; x < n; x++) q->m[y][x] = 0, fn[y][x] = 0;
  finder(q, 3, 3);
  finder(q, n - 4, 3);
  finder(q, 3, n - 4);
  for (int i = 8; i < n - 8; i++) setm(q, i, 6, i % 2 == 0, 1), setm(q, 6, i, i % 2 == 0, 1);
  if (ver >= 2) align(q, ALIGN[ver], ALIGN[ver]);
  format_bits(q, 0); /* место под формат — служебное */

  /* Данные — змейкой по парам столбцов снизу вверх и обратно, столбец 6 пропускаем. */
  int k = 0;
  for (int right = n - 1; right >= 1; right -= 2) {
    if (right == 6) right = 5;
    for (int vert = 0; vert < n; vert++)
      for (int j = 0; j < 2; j++) {
        int x = right - j;
        int up = ((right + 1) & 2) == 0;
        int y = up ? n - 1 - vert : vert;
        if (fn[y][x]) continue;
        if (k < total * 8) q->m[y][x] = (cw[k >> 3] >> (7 - (k & 7))) & 1;
        k++;
      }
  }
  /* Маска с наименьшим штрафом. */
  int best = 0;
  long best_p = -1;
  for (int m = 0; m < 8; m++) {
    apply_mask(q, m);
    format_bits(q, m);
    long p = penalty(q);
    if (best_p < 0 || p < best_p) best_p = p, best = m;
    apply_mask(q, m);
  }
  apply_mask(q, best);
  format_bits(q, best);
  return q->size;
}
