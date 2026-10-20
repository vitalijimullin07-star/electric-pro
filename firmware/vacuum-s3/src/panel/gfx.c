/* Копия ../vacuum-panel/gfx.c (sync-panel.sh) — не править здесь. */
#define PANEL_IN_CTRL 1
#include "gfx.h"

static uint16_t *fb;
/*
 * Размер кадра в точках интерфейса (800×480 у пульта 7″, 480×320 у экрана 3,5″ на контроллере).
 * Сам кадр — в GS раз больше по каждой оси: приложение для телефона рисует тот же интерфейс
 * чётче (PANEL_SCALE 3, шрифты — fonts_hd.c); у пульта и контроллера GS = 1. Координаты на входе
 * — в точках интерфейса, окно отсечения и всё ниже — в точках кадра.
 */
#define GS PANEL_SCALE
#define S(v) ((v) *= GS)
static int gw = GW, gh = GH, pw = GW * GS, ph = GH * GS;
static int cx0, cy0, cx1 = GW * GS, cy1 = GH * GS;

void g_init(uint16_t *buf) { g_init_size(buf, GW, GH); }

void g_init_size(uint16_t *buf, int w, int h) {
  fb = buf;
  gw = w, gh = h;
  pw = w * GS, ph = h * GS;
  g_noclip();
}

int g_width(void) { return gw; }
int g_height(void) { return gh; }
int g_scale(void) { return GS; }

void g_clip(int x0, int y0, int x1, int y1) {
  S(x0), S(y0), S(x1), S(y1);
  cx0 = x0 < 0 ? 0 : x0, cy0 = y0 < 0 ? 0 : y0;
  cx1 = x1 > pw ? pw : x1, cy1 = y1 > ph ? ph : y1;
}

void g_noclip(void) { cx0 = 0, cy0 = 0, cx1 = pw, cy1 = ph; }

float g_sqrt(float x) { return x > 0 ? __builtin_sqrtf(x) : 0; }

static inline uint16_t mix(uint16_t bg, uint16_t fg, int a) {
  /* a: 0…256. Каналы разносятся по 32-битному слову, чтобы умножение не перетекало между ними. */
  uint32_t b = (bg | ((uint32_t)bg << 16)) & 0x07E0F81Fu, f = (fg | ((uint32_t)fg << 16)) & 0x07E0F81Fu;
  uint32_t k = (uint32_t)(a + 4) >> 3;
  uint32_t r = ((f * k + b * (32 - k)) >> 5) & 0x07E0F81Fu;
  return (uint16_t)(r | (r >> 16));
}

static inline void blend(int x, int y, uint16_t c, int a) {
  if (x < cx0 || x >= cx1 || y < cy0 || y >= cy1 || a <= 0) return;
  uint16_t *p = fb + y * pw + x;
  *p = a >= 256 ? c : mix(*p, c, a);
}

void g_fill(int x, int y, int w, int h, uint16_t c) {
  S(x), S(y), S(w), S(h);
  if (x < cx0) w -= cx0 - x, x = cx0;
  if (y < cy0) h -= cy0 - y, y = cy0;
  if (x + w > cx1) w = cx1 - x;
  if (y + h > cy1) h = cy1 - y;
  if (w <= 0 || h <= 0) return;
  for (int j = 0; j < h; j++) {
    uint16_t *p = fb + (y + j) * pw + x;
    for (int i = 0; i < w; i++) p[i] = c;
  }
}

void g_dim(int x, int y, int w, int h, uint16_t c, int alpha) {
  S(x), S(y), S(w), S(h);
  if (x < cx0) w -= cx0 - x, x = cx0;
  if (y < cy0) h -= cy0 - y, y = cy0;
  if (x + w > cx1) w = cx1 - x;
  if (y + h > cy1) h = cy1 - y;
  for (int j = 0; j < h; j++) {
    uint16_t *p = fb + (y + j) * pw + x;
    for (int i = 0; i < w; i++) p[i] = mix(p[i], c, alpha);
  }
}


/* Покрытие точки по расстоянию до края (d > 0 — снаружи). */
static inline int cover(float d) {
  if (d <= -0.5f) return 256;
  if (d >= 0.5f) return 0;
  return (int)((0.5f - d) * 256);
}

void g_rrect(float x, float y, float w, float h, float r, uint16_t c) {
  S(x), S(y), S(w), S(h), S(r);
  if (r > w / 2) r = w / 2;
  if (r > h / 2) r = h / 2;
  int x0 = (int)x, y0 = (int)y, x1 = (int)(x + w + 0.999f), y1 = (int)(y + h + 0.999f);
  float cx = x + w / 2, cy = y + h / 2, hw = w / 2 - r, hh = h / 2 - r;
  for (int j = y0; j < y1; j++) {
    if (j < cy0 || j >= cy1) continue;
    float py = j + 0.5f - cy;
    float qy = (py < 0 ? -py : py) - hh;
    for (int i = x0; i < x1; i++) {
      float px = i + 0.5f - cx;
      float qx = (px < 0 ? -px : px) - hw;
      float d;
      if (qx > 0 && qy > 0) d = g_sqrt(qx * qx + qy * qy) - r;
      else d = (qx > qy ? qx : qy) - r;
      /* Прямые края тоже сглаживаются по расстоянию — дробные координаты не «прыгают». */
      blend(i, j, c, cover(d));
    }
  }
}

void g_rrect_line(float x, float y, float w, float h, float r, float t, uint16_t c) {
  /* Контур: расстояние до края скруглённого прямоугольника меньше толщины t (внутрь). */
  S(x), S(y), S(w), S(h), S(r), S(t);
  if (r > w / 2) r = w / 2;
  if (r > h / 2) r = h / 2;
  int x0 = (int)x, y0 = (int)y, x1 = (int)(x + w + 0.999f), y1 = (int)(y + h + 0.999f);
  float cx = x + w / 2, cy = y + h / 2, hw = w / 2 - r, hh = h / 2 - r;
  for (int j = y0; j < y1; j++) {
    float py = j + 0.5f - cy;
    float qy = (py < 0 ? -py : py) - hh;
    for (int i = x0; i < x1; i++) {
      float px = i + 0.5f - cx;
      float qx = (px < 0 ? -px : px) - hw;
      float d;
      if (qx > 0 && qy > 0) d = g_sqrt(qx * qx + qy * qy) - r;
      else d = (qx > qy ? qx : qy) - r;
      if (d < -t - 1) continue;
      float e = d + t / 2;
      blend(i, j, c, cover((e < 0 ? -e : e) - t / 2));
    }
  }
}

void g_bar(float x, float y, float w, float h, float frac, uint16_t bg, uint16_t fg) {
  S(x), S(y), S(w), S(h);
  float r = h / 2, cut = x + w * (frac < 0 ? 0 : frac > 1 ? 1 : frac);
  float cx = x + w / 2, cy = y + h / 2, hw = w / 2 - r;
  for (int j = (int)y; j < (int)(y + h + 0.999f); j++) {
    float py = j + 0.5f - cy;
    for (int i = (int)x; i < (int)(x + w + 0.999f); i++) {
      float px = i + 0.5f - cx;
      float qx = (px < 0 ? -px : px) - hw, qy = py < 0 ? -py : py;
      float d = qx > 0 ? g_sqrt(qx * qx + qy * qy) - r : qy - r;
      float k = cut - (float)i;
      int a = k <= 0 ? 0 : k >= 1 ? 256 : (int)(k * 256);
      blend(i, j, a >= 256 ? fg : a <= 0 ? bg : mix(bg, fg, a), cover(d));
    }
  }
}

void g_ring(float cx, float cy, float r, float w, uint16_t c) {
  S(cx), S(cy), S(r), S(w);
  float R = r + w / 2 + 1;
  for (int j = (int)(cy - R); j <= (int)(cy + R); j++)
    for (int i = (int)(cx - R); i <= (int)(cx + R); i++) {
      float dx = i + 0.5f - cx, dy = j + 0.5f - cy;
      float d = g_sqrt(dx * dx + dy * dy) - r;
      blend(i, j, c, cover((d < 0 ? -d : d) - w / 2));
    }
}

/* Угол точки от «12 часов» по часовой, доля оборота 0…1 (приближение atan2 с точностью ~0,1°). */
static float turn_of(float dx, float dy) {
  float ax = dx < 0 ? -dx : dx, ay = dy < 0 ? -dy : dy;
  float mn = ax < ay ? ax : ay, mx = ax < ay ? ay : ax;
  if (mx == 0) return 0;
  float a = mn / mx, s = a * a;
  float t = ((-0.0464964749f * s + 0.15931422f) * s - 0.327622764f) * s * a + a; /* atan(a), рад */
  if (ay > ax) t = 1.5707963f - t;
  /* t — угол от оси X; переводим: от «вверх» по часовой. */
  float ang;
  if (dx >= 0 && dy < 0) ang = 1.5707963f - t;      /* I четверть (вверх-вправо) */
  else if (dx >= 0) ang = 1.5707963f + t;           /* вниз-вправо */
  else if (dy >= 0) ang = 4.712389f - t;            /* вниз-влево */
  else ang = 4.712389f + t;                         /* вверх-влево */
  return ang / 6.2831853f;
}

static float sin_turn(float f) {
  /* sin(2π·f), f в 0…1: парабола Бхаскары с поправкой. */
  f -= (float)(int)f;
  float x = f < 0.5f ? f : f - 0.5f;
  float y = 16 * x * (0.5f - x) / (1.25f - 4 * x * (0.5f - x));
  return f < 0.5f ? y : -y;
}

void g_arc(float cx, float cy, float r, float w, float frac, uint16_t c) {
  if (frac <= 0) return;
  if (frac >= 1) {
    g_ring(cx, cy, r, w, c);
    return;
  }
  S(cx), S(cy), S(r), S(w);
  float ex = cx + r * sin_turn(frac), ey = cy - r * sin_turn(frac + 0.25f);
  float sx = cx, sy = cy - r;
  float R = r + w / 2 + 1;
  for (int j = (int)(cy - R); j <= (int)(cy + R); j++)
    for (int i = (int)(cx - R); i <= (int)(cx + R); i++) {
      float dx = i + 0.5f - cx, dy = j + 0.5f - cy;
      float dist = g_sqrt(dx * dx + dy * dy);
      float d;
      if (turn_of(dx, dy) <= frac) d = (dist > r ? dist - r : r - dist) - w / 2;
      else {
        float d1 = g_sqrt((i + 0.5f - sx) * (i + 0.5f - sx) + (j + 0.5f - sy) * (j + 0.5f - sy));
        float d2 = g_sqrt((i + 0.5f - ex) * (i + 0.5f - ex) + (j + 0.5f - ey) * (j + 0.5f - ey));
        d = (d1 < d2 ? d1 : d2) - w / 2;
      }
      blend(i, j, c, cover(d));
    }
}

void g_arc2(float cx, float cy, float r, float w, float a0, float span, uint16_t c) {
  /* Дуга от a0 (доля оборота от «12 часов» по часовой) длиной span, скруглённые концы. */
  if (span <= 0) return;
  if (span >= 1) {
    g_ring(cx, cy, r, w, c);
    return;
  }
  S(cx), S(cy), S(r), S(w);
  a0 -= (float)(int)a0;
  if (a0 < 0) a0 += 1;
  float a1 = a0 + span;
  float sx = cx + r * sin_turn(a0), sy = cy - r * sin_turn(a0 + 0.25f);
  float ex = cx + r * sin_turn(a1), ey = cy - r * sin_turn(a1 + 0.25f);
  float R = r + w / 2 + 1;
  for (int j = (int)(cy - R); j <= (int)(cy + R); j++)
    for (int i = (int)(cx - R); i <= (int)(cx + R); i++) {
      float dx = i + 0.5f - cx, dy = j + 0.5f - cy;
      float dist = g_sqrt(dx * dx + dy * dy);
      float rel = turn_of(dx, dy) - a0;
      if (rel < 0) rel += 1;
      float d;
      if (rel <= span) d = (dist > r ? dist - r : r - dist) - w / 2;
      else {
        float d1 = g_sqrt((i + 0.5f - sx) * (i + 0.5f - sx) + (j + 0.5f - sy) * (j + 0.5f - sy));
        float d2 = g_sqrt((i + 0.5f - ex) * (i + 0.5f - ex) + (j + 0.5f - ey) * (j + 0.5f - ey));
        d = (d1 < d2 ? d1 : d2) - w / 2;
      }
      blend(i, j, c, cover(d));
    }
}

float g_sin_turn(float f) { return sin_turn(f); }

void g_circle(float cx, float cy, float r, uint16_t c) { g_rrect(cx - r, cy - r, 2 * r, 2 * r, r, c); }

void g_line(float x0, float y0, float x1, float y1, float w, uint16_t c) {
  S(x0), S(y0), S(x1), S(y1), S(w);
  float minx = (x0 < x1 ? x0 : x1) - w, maxx = (x0 < x1 ? x1 : x0) + w;
  float miny = (y0 < y1 ? y0 : y1) - w, maxy = (y0 < y1 ? y1 : y0) + w;
  float vx = x1 - x0, vy = y1 - y0, l2 = vx * vx + vy * vy;
  for (int j = (int)miny; j <= (int)maxy; j++)
    for (int i = (int)minx; i <= (int)maxx; i++) {
      float px = i + 0.5f - x0, py = j + 0.5f - y0;
      float t = l2 > 0 ? (px * vx + py * vy) / l2 : 0;
      if (t < 0) t = 0;
      if (t > 1) t = 1;
      float dx = px - t * vx, dy = py - t * vy;
      /* Толщину берём по наибольшему покрытию: соседние отрезки ломаной не темнеют в стыках. */
      int a = cover(g_sqrt(dx * dx + dy * dy) - w / 2);
      if (i >= cx0 && i < cx1 && j >= cy0 && j < cy1 && a > 0) {
        uint16_t *p = fb + j * pw + i;
        if (*p != c) *p = a >= 256 ? c : mix(*p, c, a);
      }
    }
}

/* ---------------- текст ---------------- */

static int utf8_next(const char **ps) {
  const unsigned char *s = (const unsigned char *)*ps;
  int c = *s;
  if (!c) return 0;
  if (c < 0x80) {
    *ps += 1;
    return c;
  }
  if ((c & 0xE0) == 0xC0 && s[1]) {
    *ps += 2;
    return ((c & 0x1F) << 6) | (s[1] & 0x3F);
  }
  if ((c & 0xF0) == 0xE0 && s[1] && s[2]) {
    *ps += 3;
    return ((c & 0x0F) << 12) | ((s[1] & 0x3F) << 6) | (s[2] & 0x3F);
  }
  *ps += 1;
  return '?';
}

static const pglyph_t *find(const pfont_t *f, int cp) {
  int lo = 0, hi = f->count - 1;
  while (lo <= hi) {
    int m = (lo + hi) >> 1;
    int v = f->glyphs[m].cp;
    if (v == cp) return &f->glyphs[m];
    if (v < cp) lo = m + 1;
    else hi = m - 1;
  }
  return 0;
}

#if GS > 1
/* Тот же шрифт в GS раз крупнее (fonts_hd.c): растр знака оттуда, шаг — от обычного, чтобы
 * строки ложились точно как на экране пылесоса. */
static const phfont_t *hd_of(const pfont_t *f) {
  for (int i = 0; G_HD[i].lo; i++)
    if (G_HD[i].lo == f) return G_HD[i].hi;
  return 0;
}

static const phglyph_t *hfind(const phfont_t *f, int cp) {
  int lo = 0, hi = f->count - 1;
  while (lo <= hi) {
    int m = (lo + hi) >> 1;
    int v = f->glyphs[m].cp;
    if (v == cp) return &f->glyphs[m];
    if (v < cp) lo = m + 1;
    else hi = m - 1;
  }
  return 0;
}
#endif

int g_text(const pfont_t *f, int x, int base, const char *s, uint16_t c, int spacing) {
  int cp;
#if GS > 1
  const phfont_t *hf = hd_of(f);
#endif
  while ((cp = utf8_next(&s))) {
    const pglyph_t *g = find(f, cp);
    if (!g) g = find(f, '?'), cp = '?';
    if (!g) continue;
#if GS > 1
    const phglyph_t *hg = hf ? hfind(hf, cp) : 0;
    if (hg) {
      const uint8_t *hb = hf->bits + hg->off;
      int n = 0;
      for (int j = 0; j < hg->h; j++)
        for (int i = 0; i < hg->w; i++, n++) {
          int v = (hb[n >> 1] >> ((n & 1) ? 0 : 4)) & 15;
          if (v) blend(x * GS + hg->x + i, base * GS + hg->y + j, c, v == 15 ? 256 : v * 17);
        }
      x += g->adv + spacing;
      continue;
    }
#endif
    const uint8_t *bits = f->bits + g->off;
    int n = 0;
    for (int j = 0; j < g->h; j++)
      for (int i = 0; i < g->w; i++, n++) {
        int v = (bits[n >> 1] >> ((n & 1) ? 0 : 4)) & 15;
        if (!v) continue;
#if GS > 1
        /* Крупного шрифта нет — точка знака становится квадратом GS×GS. */
        for (int b = 0; b < GS * GS; b++)
          blend((x + g->x + i) * GS + b % GS, (base + g->y + j) * GS + b / GS, c, v == 15 ? 256 : v * 17);
#else
        blend(x + g->x + i, base + g->y + j, c, v == 15 ? 256 : v * 17);
#endif
      }
    x += g->adv + spacing;
  }
  return x;
}

int g_text_w(const pfont_t *f, const char *s, int spacing) {
  int w = 0, cp, n = 0;
  while ((cp = utf8_next(&s))) {
    const pglyph_t *g = find(f, cp);
    if (!g) g = find(f, '?');
    if (g) w += g->adv + spacing, n++;
  }
  return n ? w - spacing : 0;
}

int g_text_at(const pfont_t *f, int x, int base, const char *s, uint16_t c, int align) {
  int w = g_text_w(f, s, 0);
  if (align == 1) x -= w / 2;
  else if (align == 2) x -= w;
  return g_text(f, x, base, s, c, 0);
}
