/* Копия ../vacuum-panel/panel_t35.c (sync-panel.sh) — не править здесь. */
#define PANEL_IN_CTRL 1
/*
 * Интерфейс экрана 3,5″ (ILI9488 480×320 с касанием) на самом контроллере «S3», прошивка 6.0.
 * Снизу — пять вкладок: «Главная» (расход, турбины Т1 и Т2, какую мощность меняем — Т1, Т2 или
 * обе, пуск), «Очистка» (режим, удары, клапаны — оба, по очереди, только 1 или 2, разгон турбин,
 * мощная очистка), «Фильтр» (фильтры А и Б, прогноз мойки, обслуживание с записью «что сделали»
 * и замером, история), «Графики» (10 минут, час, 4 часа; отметки ударов; осциллограф удара) и
 * «Меню» (настройки, первый пуск, живая схема, обслуживание, отчёт смены, журнал, голос, весы,
 * часы, связь, розетка, паспорт). Поверх — окна перегрузки розетки, мощной очистки и аварий.
 * Значения приходят от контроллера строками (S, F, C, J, X, G, M, Q, R, T, H, O, W — см.
 * panel_ui.h и vac_ext.c) и хранятся по имени поля, команды уходят строками; изменённое на экране
 * значение «придерживается» 0,8 с, пока ответ не пришёл.
 */
#include "panel_int.h"
#include "gfx.h"
#include "qr.h"

#define SW_ 480
#define SH_ 320
#define TOPH 30   /* строка состояния */
#define NAVY 270  /* вкладки снизу */
#define CY0 (TOPH + 4)
#define CY1 (NAVY - 4)

/* ---------------- цвета ---------------- */

#define K_BG HEX(0x0b0d10)
#define K_BAR HEX(0x101318)
#define K_CARD HEX(0x161a20)
#define K_CARD2 HEX(0x1e232b)
#define K_PRESS HEX(0x2a313b)
#define K_LINE HEX(0x262b33)
#define K_TEXT HEX(0xeef1f5)
#define K_SUB HEX(0xa3abb6)
#define K_DIM HEX(0x6c7480)
#define K_FAINT HEX(0x353c46)
#define K_ACC HEX(0x2dd4b0)
#define K_ACC_D HEX(0x103f36)
#define K_T1 HEX(0x4cb0ff)
#define K_T2 HEX(0xb48cff)
#define K_WARN HEX(0xf5ae42)
#define K_WARN_D HEX(0x3b2b10)
#define K_RED HEX(0xff5d4f)
#define K_RED_D HEX(0x3d1612)
#define K_GREEN HEX(0x43d17f)
#define K_GREEN_D HEX(0x113a24)
#define K_INK HEX(0x06120f)

/* ---------------- строки и числа ---------------- */

static int slen(const char *s) {
  int n = 0;
  while (s[n]) n++;
  return n;
}

static int seq(const char *a, const char *b) {
  while (*a && *a == *b) a++, b++;
  return *a == *b;
}

static int starts(const char *s, const char *p) {
  while (*p)
    if (*s++ != *p++) return 0;
  return 1;
}

static char *cat(char *d, const char *s) {
  char *p = d + slen(d);
  while ((*p++ = *s++)) {
  }
  return d;
}

static char *fnum(char *out, float v, int dec) {
  char *p = out;
  long scale = 1;
  for (int i = 0; i < dec; i++) scale *= 10;
  long x = (long)(v * (float)scale + (v < 0 ? -0.5f : 0.5f));
  if (x < 0) *p++ = '-', x = -x;
  long ip = x / scale, fp = x % scale;
  char tmp[12];
  int n = 0;
  do tmp[n++] = (char)('0' + ip % 10), ip /= 10;
  while (ip && n < 11);
  while (n) *p++ = tmp[--n];
  if (dec) {
    *p++ = ',';
    for (long d = scale / 10; d; d /= 10) *p++ = (char)('0' + (fp / d) % 10);
  }
  *p = 0;
  return out;
}

static char *catn(char *d, float v, int dec) {
  char n[20];
  return cat(d, fnum(n, v, dec));
}

/* «1 234 567» — тысячи через узкий пробел. */
static char *catk(char *d, long v) {
  char t[24], o[32];
  int n = 0, k = 0;
  if (v < 0) v = -v, cat(d, "-");
  do t[n++] = (char)('0' + v % 10), v /= 10;
  while (v && n < 20);
  for (int i = n - 1; i >= 0; i--) {
    o[k++] = t[i];
    if (i && i % 3 == 0) o[k++] = ' ';
  }
  o[k] = 0;
  return cat(d, o);
}

static float pnum(const char *s) {
  float sign = 1, v = 0, k = 0;
  if (*s == '-') sign = -1, s++;
  for (; *s; s++) {
    if (*s >= '0' && *s <= '9') {
      if (k > 0) v += (float)(*s - '0') * k, k *= 0.1f;
      else v = v * 10 + (float)(*s - '0');
    } else if ((*s == '.' || *s == ',') && k == 0)
      k = 0.1f;
    else
      break;
  }
  return sign * v;
}

static long pint(const char *s) {
  long v = 0, sign = 1;
  if (*s == '-') sign = -1, s++;
  while (*s >= '0' && *s <= '9') v = v * 10 + (*s++ - '0');
  return sign * v;
}

static int clampi(int v, int lo, int hi) { return v < lo ? lo : v > hi ? hi : v; }
static float clampf(float v, float lo, float hi) { return v < lo ? lo : v > hi ? hi : v; }
static int ri(float v) { return (int)(v < 0 ? v - 0.5f : v + 0.5f); }

/* ---------------- значения от контроллера: имя поля → значение ---------------- */

/* Ключ — буква строки и имя поля: «Sf» — расход из «S», «CP0» — режим очистки 0 из «C». */
#define NKV 384
typedef struct {
  char k[8];
  char v[44];
  float f;
  uint32_t hold;
} kv_t;
static kv_t KV[NKV];
static uint32_t now;

static unsigned khash(const char *k) {
  unsigned h = 2166136261u;
  while (*k) h = (h ^ (unsigned char)*k++) * 16777619u;
  return h;
}

static kv_t *kv_find(const char *k, int make) {
  unsigned i = khash(k) % NKV;
  for (int n = 0; n < NKV; n++, i = (i + 1) % NKV) {
    if (!KV[i].k[0]) {
      if (!make) return 0;
      int j = 0;
      while (k[j] && j < 7) KV[i].k[j] = k[j], j++;
      KV[i].k[j] = 0;
      return &KV[i];
    }
    if (seq(KV[i].k, k)) return &KV[i];
  }
  return 0;
}

static float V(const char *k) {
  kv_t *e = kv_find(k, 0);
  return e ? e->f : 0;
}
static int Vi(const char *k) { return ri(V(k)); }
static int Vh(const char *k) { return kv_find(k, 0) != 0; }
static const char *Vs(const char *k) {
  kv_t *e = kv_find(k, 0);
  return e ? e->v : "";
}
/* Элемент списка через «/»: VL("CP0", 2). */
static float VL(const char *k, int idx) {
  const char *v = Vs(k);
  while (idx > 0 && *v) {
    while (*v && *v != '/') v++;
    if (*v) v++;
    idx--;
  }
  return *v ? pnum(v) : 0;
}

static void kv_set(const char *k, const char *v, int local) {
  kv_t *e = kv_find(k, 1);
  if (!e) return;
  if (!local && e->hold && (int32_t)(e->hold - now) > 0) return;
  int j = 0;
  while (v[j] && j < (int)sizeof e->v - 1) e->v[j] = v[j], j++;
  e->v[j] = 0;
  e->f = pnum(v);
  if (local) e->hold = now + 800, e->hold += !e->hold;
}

/* Поменяли на экране: показать сразу, ответ контроллера 0,8 с не перезаписывает. */
static void local_f(const char *k, float v, int dec) {
  char n[20];
  kv_set(k, fnum(n, v, dec), 1);
  kv_find(k, 0)->f = v;
}

/* Графики и осциллограф. */
#define HMAX 240
static float hv[HMAX];
static int hn, hm = -1, hr, hdt = 5, hp[64], hpn;
static uint32_t h_at;
#define OMAX 160
static int16_t oa[OMAX], ob[OMAX];
static int on_;

/* Сеть для телефона и QR-код. */
static char wifi_ssid[28], wifi_pass[16];
static qr_t qr;
static int qr_ok;

static int link_ok(void) { return Vh("S_at") && now - (uint32_t)V("S_at") < 1500; }

/* ---------------- неисправности ---------------- */

#define NF 32
static const struct {
  const char *text, *hint;
} FAULT[NF] = {
    {"Нет синхронизации с сетью", "проверьте сеть 230 В и детектор нуля"},
    {"Перегрев турбины 1", "отключена до остывания"},
    {"Перегрев турбины 2", "отключена до остывания"},
    {"Турбина 1 горячая", "мощность снижена до 70 %"},
    {"Турбина 2 горячая", "мощность снижена до 70 %"},
    {"Датчик температуры 1", "обрыв или замыкание термистора"},
    {"Датчик температуры 2", "обрыв или замыкание термистора"},
    {"Перегрузка турбины 1", "отключена на 30 с"},
    {"Перегрузка турбины 2", "отключена на 30 с"},
    {"Нет тока турбины 1", "щётки, обмотка, реле или регулятор"},
    {"Нет тока турбины 2", "щётки, обмотка, реле или регулятор"},
    {"Пробит симистор 1", "реле разомкнуто, турбина 1 заблокирована"},
    {"Пробит симистор 2", "реле разомкнуто, турбина 2 заблокирована"},
    {"Мало воздуха", "шланг перегнут или насадка прижата"},
    {"Шланг или вход забит", "проверьте шланг и вход в бак"},
    {"Фильтр: пора мыть", "продувка уже не восстанавливает"},
    {"Напряжение сети", "вне 190…250 В"},
    {"Нет датчика фильтра", "SDP810 не отвечает"},
    {"Нет расходомера", "SDP811 не отвечает"},
    {"Датчик разрежения", "нет сигнала MPX5100DP"},
    {"Бак полон", "слейте воду — турбины остановлены"},
    {"Перелив!", "вода у верхнего электрода — аварийный стоп"},
    {"Реле 1 сварилось", "выключите пылесос выключателем сети"},
    {"Реле 2 сварилось", "выключите пылесос выключателем сети"},
    {"Клапан 1 неисправен", ""},
    {"Клапан 2 неисправен", ""},
    {"Фильтр порван или не стоит", "пыль идёт в турбины — проверьте фильтр"},
    {"Нет связи с кнопками", "расширитель PCA9555 не отвечает"},
    {"Электроды: проверьте", "вода на верхнем без нижнего"},
    {"Проверьте фильтр клапанов", "удар ослаб — фильтр на входе клапанов забит"},
    {"Фильтр не отбивается", "мощная очистка (шланг ладонью) или мойка"},
    {"Удар слабый", "закройте шланг ладонью на 2 с — мощная очистка"},
};
static const uint8_t FAULT_ORDER[NF] = {21, 22, 23, 26, 20, 0, 11, 12, 1, 2, 7, 8, 14, 13, 9, 10, 24, 25, 15, 31, 30, 29, 3, 4, 5, 6, 16, 17, 18, 19, 27, 28};
#define F_URGENT ((1UL << 20) | (1UL << 21) | (1UL << 22) | (1UL << 23) | (1UL << 26))
static const char *const VERR[7] = {"", "обрыв катушки", "замыкание катушки", "не открывается: заклинил, нет 230 В, SSR", "ключ пробит — всегда открыт", "тарелка не садится: грязь в седле, пружины", "магнит не держит: обрыв, нет 230 В, SSR"};

static uint32_t faults(void) { return (uint32_t)pint(Vs("Sfa")); }

static const char *fault_hint(int b) {
  if (b == 24) return VERR[clampi(Vi("Fv1"), 0, 6)];
  if (b == 25) return VERR[clampi(Vi("Fv2"), 0, 6)];
  return FAULT[b].hint;
}

static int top_fault(void) {
  uint32_t fa = faults();
  for (int i = 0; i < NF; i++)
    if (fa & (1UL << FAULT_ORDER[i])) return FAULT_ORDER[i];
  return -1;
}

static int fault_count(void) {
  uint32_t fa = faults();
  int n = 0;
  for (int i = 0; i < NF; i++) n += (fa >> i) & 1;
  return n;
}

/* Журнал аварий на экране: когда появилась и когда снята (часы контроллера, если есть). */
#define NALARM 24
static struct {
  uint8_t bit;
  uint32_t on, off, t;
} AL[NALARM];
static int nal;
static uint32_t fa_prev, ack_mask;

static void alarms_update(void) {
  uint32_t fa = faults(), ch = fa ^ fa_prev;
  for (int b = 0; b < NF; b++) {
    if (!(ch & (1UL << b))) continue;
    if (fa & (1UL << b)) {
      if (nal == NALARM) {
        for (int i = 1; i < NALARM; i++) AL[i - 1] = AL[i];
        nal--;
      }
      AL[nal].bit = (uint8_t)b, AL[nal].on = now, AL[nal].off = 0, AL[nal].t = (uint32_t)pint(Vs("Ftm"));
      nal++;
      ack_mask &= ~(1UL << b);
    } else
      for (int i = nal - 1; i >= 0; i--)
        if (AL[i].bit == b && !AL[i].off) {
          AL[i].off = now ? now : 1;
          break;
        }
  }
  fa_prev = fa;
}

/* ---------------- состояние интерфейса ---------------- */

enum {
  SC_HOME, SC_CLEAN, SC_FILTER, SC_CHART, SC_MENU, /* вкладки */
  SC_SET, SC_WIZ, SC_SVC, SC_SCHEME, SC_MAINT, SC_REPORT, SC_LOG, SC_VOICE, SC_SCALE, SC_CLOCK, SC_LINK, SC_TOOL, SC_ABOUT, SC_OSC, SC_N
};
static int screen = SC_HOME, back_to = SC_HOME;
static int dirty = 1;
static uint32_t drawn_at, hb_at, get_at, anim_at;
static int link_prev = -1, sleep_prev = -1;
static char toast_s[200];
static uint32_t toast_till;
static int scroll[SC_N];
static int list_h; /* высота содержимого списка (последний кадр) */

/* Регулировка на «Главной»: 0 — обе, 1 — Т1, 2 — Т2 (у контроллера — rsel). */
static int rsel;

static void cmd(const char *s) {
  phal_uart_write(s, slen(s));
  phal_uart_write("\n", 1);
}

static void cmdi(const char *head, long v) {
  char s[192] = "";
  cmd(catn(cat(s, head), (float)v, 0));
}

static void toast(const char *s) {
  int i = 0;
  while (s[i] && i < (int)sizeof toast_s - 1) toast_s[i] = s[i], i++;
  toast_s[i] = 0;
  toast_till = now + 2600;
  toast_till += !toast_till;
  dirty = 1;
}

/* ---------------- разбор строк ---------------- */

static void slash_ints(const char *v, int *out, int max, int *n) {
  *n = 0;
  while (*v && *n < max) {
    out[(*n)++] = (int)pint(v);
    while (*v && *v != '/') v++;
    if (*v) v++;
  }
}

static void h_line(char *p) {
  /* H m=0 r=0 n=120 dt=5 v=1,2/3,4… p=12/40 */
  int m = -1, r = 0;
  for (char *q = p; *q;) {
    while (*q == ' ') q++;
    char *k = q;
    while (*q && *q != '=' && *q != ' ') q++;
    if (*q != '=') {
      while (*q && *q != ' ') q++;
      continue;
    }
    *q++ = 0;
    char *v = q;
    while (*q && *q != ' ') q++;
    if (*q) *q++ = 0;
    if (seq(k, "m")) m = (int)pint(v);
    else if (seq(k, "r")) r = (int)pint(v);
    else if (seq(k, "dt")) hdt = (int)pint(v);
    else if (seq(k, "v")) {
      hn = 0;
      while (*v && hn < HMAX) {
        hv[hn++] = pnum(v);
        while (*v && *v != '/') v++;
        if (*v) v++;
      }
    } else if (seq(k, "p"))
      slash_ints(v, hp, 64, &hpn);
  }
  hm = m, hr = r, h_at = now;
}

static void o_line(char *p) {
  for (char *q = p; *q;) {
    while (*q == ' ') q++;
    char *k = q;
    while (*q && *q != '=' && *q != ' ') q++;
    if (*q != '=') {
      while (*q && *q != ' ') q++;
      continue;
    }
    *q++ = 0;
    char *v = q;
    while (*q && *q != ' ') q++;
    if (*q) *q++ = 0;
    if (seq(k, "a") || seq(k, "b")) {
      int16_t *dst = k[0] == 'a' ? oa : ob;
      int n = 0;
      while (*v && n < OMAX) {
        dst[n++] = (int16_t)pint(v);
        while (*v && *v != '/') v++;
        if (*v) v++;
      }
      on_ = n;
    } else {
      char key[8] = "O";
      int j = 0;
      while (k[j] && j < 5) key[1 + j] = k[j], j++;
      key[1 + j] = 0;
      kv_set(key, v, 0);
    }
  }
}

static void w_line(char *s) {
  char *ps = 0, *pp = 0;
  for (char *p = s; *p; p++) {
    if (p[0] == 's' && p[1] == '=' && (p == s || p[-1] == ' ')) ps = p + 2;
    if (p[0] == 'p' && p[1] == '=' && (p == s || p[-1] == ' ')) pp = p + 2;
  }
  if (!ps || !pp) return;
  int n = 0;
  while (ps[n] && ps[n] != ' ' && n < (int)sizeof wifi_ssid - 1) wifi_ssid[n] = ps[n], n++;
  wifi_ssid[n] = 0;
  n = 0;
  while (pp[n] && pp[n] != ' ' && n < (int)sizeof wifi_pass - 1) wifi_pass[n] = pp[n], n++;
  wifi_pass[n] = 0;
  char t[80] = "WIFI:T:WPA;S:";
  cat(cat(cat(cat(t, wifi_ssid), ";P:"), wifi_pass), ";;");
  qr_ok = qr_encode(t, &qr) > 0;
}

static void go(int sc);
static void home_adjust(int d);
static void start_stop(void);

static void on_line(char *s) {
  char type = s[0];
  if (!type || (s[1] != ' ' && s[1])) return;
  if (type == 'E') {
    const char *e = s + 2;
    if (starts(e, "enc=")) {
      int d = (int)pint(e + 4);
      if (screen == SC_HOME) home_adjust(d);
      else scroll[screen] = clampi(scroll[screen] + d * 26, 0, 4000);
    } else if (seq(e, "sw")) {
      if (screen == SC_HOME) start_stop();
      else go(SC_HOME);
    } else if (seq(e, "hold"))
      go(SC_HOME);
    else if (starts(e, "k=") || starts(e, "kh=")) {
      /* Кнопки 1–6 у экрана (на корпусе): 1–3 — вкладки, 4 — пуск/стоп, 5 — продувка, 6 — мощная. */
      int k = (int)pint(e + (e[1] == 'h' ? 3 : 2));
      if (t35_sleeping()) cmd("wake");
      else if (k >= 1 && k <= 3) go(k - 1);
      else if (k == 4) start_stop();
      else if (k == 5) cmd("purge"), toast("Продувка: серия ударов");
      else if (k == 6) cmd("purge strong"), toast("Мощная очистка: закройте шланг ладонью");
    }
    dirty = 1;
    return;
  }
  if (type == 'P') {
    kv_set("Ssl", seq(s + 2, "off") ? "1" : "0", 1);
    if (seq(s + 2, "on")) go(SC_HOME);
    dirty = 1;
    return;
  }
  if (type == 'W') {
    w_line(s + 2);
    dirty = 1;
    return;
  }
  if (type == 'H') {
    h_line(s + 2);
    if (screen == SC_CHART) dirty = 1;
    return;
  }
  if (type == 'O') {
    o_line(s + 2);
    if (screen == SC_OSC || screen == SC_CHART) dirty = 1;
    return;
  }
  if (!(type == 'S' || type == 'F' || type == 'C' || type == 'J' || type == 'X' || type == 'G' || type == 'M' || type == 'Q' || type == 'R' || type == 'T')) return;
  if (type == 'Q') {
    /* История — целиком заново: старые записи стираются. */
    for (int i = 0; i < 12; i++) {
      char k[6] = {'Q', 'e', (char)('0' + i / 10), (char)('0' + i % 10), 0, 0};
      kv_t *e = kv_find(k, 0);
      if (e) e->v[0] = 0, e->f = 0;
    }
  }
  char *p = s + 1;
  while (*p) {
    while (*p == ' ') p++;
    char *k = p;
    while (*p && *p != '=' && *p != ' ') p++;
    if (*p != '=') {
      while (*p && *p != ' ') p++;
      continue;
    }
    *p++ = 0;
    char *v = p;
    while (*p && *p != ' ') p++;
    if (*p) *p++ = 0;
    char key[8];
    key[0] = type;
    int j = 0;
    while (k[j] && j < 6) key[1 + j] = k[j], j++;
    key[1 + j] = 0;
    kv_set(key, v, 0);
    /* C повторяет поля состояния (pw, md, cl, pr): пусть «S» тоже их видит. */
    if (type == 'C' && (seq(k, "pw") || seq(k, "md") || seq(k, "cl") || seq(k, "pr"))) key[0] = 'S', kv_set(key, v, 0);
  }
  if (type == 'S') {
    char n[16];
    kv_set("S_at", fnum(n, (float)now, 0), 0);
    kv_find("S_at", 0)->f = (float)now;
    alarms_update();
  }
  if (type == 'X' && !(kv_find("Xrs", 0) && kv_find("Xrs", 0)->hold && (int32_t)(kv_find("Xrs", 0)->hold - now) > 0)) rsel = clampi(Vi("Xrs"), 0, 2);
  dirty = 1;
}

static char rx_line[2400];
static int rx_len;

void t35_rx(int ch) {
  if (ch == '\r') return;
  if (ch == '\n') {
    rx_line[rx_len] = 0;
    if (rx_len) on_line(rx_line);
    rx_len = 0;
    return;
  }
  if (rx_len < (int)sizeof rx_line - 1) rx_line[rx_len++] = (char)ch;
}

int t35_sleeping(void) { return Vi("Ssl") && link_ok(); }

/* ---------------- касания: зоны прошлого кадра ---------------- */

enum { ZT_NONE, ZT_TAB, ZT_BACK, ZT_BTN, ZT_MINUS, ZT_PLUS, ZT_SEG, ZT_TOG, ZT_ROWBTN, ZT_CHOICE, ZT_OPT, ZT_LIST, ZT_SHEETBG, ZT_BLOCK };
typedef struct {
  int16_t x, y, w, h;
  uint8_t t;
  int16_t a, b;
} zone_t;
#define NZ 128
static zone_t Z[NZ];
static int nz;
static struct {
  int t, a, b;
} pz;
static int touch_down, dragging, drag_y0, drag_s0, drag_list;
static uint32_t press_at, repeat_at;
static int repeats;

static void zone(int x, int y, int w, int h, int t, int a, int b) {
  if (nz >= NZ) return;
  /* Видна только часть в окне списка: зона обрезается по нему. */
  Z[nz].x = (int16_t)x, Z[nz].y = (int16_t)y, Z[nz].w = (int16_t)w, Z[nz].h = (int16_t)h;
  Z[nz].t = (uint8_t)t, Z[nz].a = (int16_t)a, Z[nz].b = (int16_t)b;
  nz++;
}

static int is_p(int t, int a, int b) { return touch_down && !dragging && pz.t == t && pz.a == a && pz.b == b; }

static int hit(int x, int y, int skip_list) {
  for (int i = nz - 1; i >= 0; i--) {
    const zone_t *z = &Z[i];
    if (skip_list && z->t == ZT_LIST) continue;
    if (x >= z->x && x < z->x + z->w && y >= z->y && y < z->y + z->h) return i;
  }
  return -1;
}

/* ---------------- рисование: основа ---------------- */

static void txt(const pfont_t *f, int x, int base, const char *s, uint16_t c, int align) { g_text_at(f, x, base, s, c, align); }

static void icon(const pfont_t *f, int x, int y, const char *ic, uint16_t c) { g_text(f, x, y + f->size, ic, c, 0); }

static void icon_c(const pfont_t *f, int cx, int cy, const char *ic, uint16_t c) { g_text(f, cx - f->size / 2, cy + f->size / 2, ic, c, 0); }

/* Перенос текста по словам в ширину w: строк не больше maxl; возвращает число строк. */
static int wrap(const pfont_t *f, int x, int base, int w, int lh, const char *s, uint16_t c, int maxl, int align) {
  char line[160];
  int lines = 0;
  while (*s && lines < maxl) {
    int n = 0, last_sp = -1;
    const char *p = s;
    line[0] = 0;
    while (*p && *p != '\n') {
      int k = 1;
      while ((p[k] & 0xC0) == 0x80) k++;
      if (n + k >= (int)sizeof line - 1) break;
      for (int i = 0; i < k; i++) line[n + i] = p[i];
      line[n + k] = 0;
      if (g_text_w(f, line, 0) > w && last_sp >= 0) break;
      if (*p == ' ') last_sp = n;
      n += k, p += k;
    }
    if (*p && *p != '\n' && last_sp >= 0) {
      line[last_sp] = 0;
      s += last_sp + 1;
    } else {
      line[n] = 0;
      s = p;
      if (*s == '\n') s++;
    }
    if (lines == maxl - 1 && *s) {
      /* Последняя строка — с многоточием. */
      while (n > 0 && g_text_w(f, line, 0) + g_text_w(f, "…", 0) > w) {
        n--;
        while (n > 0 && (line[n] & 0xC0) == 0x80) n--;
        line[n] = 0;
      }
      cat(line, "…");
    }
    if (base > -40) txt(f, align == 1 ? x + w / 2 : align == 2 ? x + w : x, base, line, c, align);
    base += lh;
    lines++;
  }
  return lines;
}

static int wrap_lines(const pfont_t *f, int w, const char *s) {
  /* Число строк без рисования: рисуем далеко за экраном. */
  return wrap(f, 0, -10000, w, 0, s, 0, 20, 0);
}

static void card(int x, int y, int w, int h, uint16_t c) { g_rrect((float)x, (float)y, (float)w, (float)h, 10, c); }

/* Кнопка: стиль 0 — обычная, 1 — главная (бирюзовая), 2 — опасная, 3 — предупреждение, 4 — тихая. */
static void button(int x, int y, int w, int h, const char *label, const char *ic, int style, int t, int a, int b) {
  int p = is_p(t, a, b);
  uint16_t bg = style == 1 ? K_ACC : style == 2 ? K_RED : style == 3 ? K_WARN : style == 4 ? K_BG : K_CARD2;
  uint16_t fg = style == 1 || style == 3 ? K_INK : K_TEXT;
  if (p) bg = style == 1 ? HEX(0x6fe8cf) : style == 2 ? HEX(0xff8a7f) : style == 3 ? HEX(0xffc979) : K_PRESS;
  g_rrect((float)x, (float)y, (float)w, (float)h, h > 40 ? 12 : 9, bg);
  if (style == 4) g_rrect_line((float)x, (float)y, (float)w, (float)h, h > 40 ? 12 : 9, 1.2f, K_FAINT);
  const pfont_t *f = h >= 44 ? &F_D17 : &F_D15;
  int tw = label ? g_text_w(f, label, 0) : 0, iw = ic ? (h >= 44 ? 24 : 18) : 0;
  int gap = ic && label && label[0] ? 8 : 0;
  int x0 = x + (w - tw - iw - gap) / 2;
  if (ic) icon(iw == 24 ? &F_I24 : &F_I18, x0, y + (h - iw) / 2, ic, fg);
  if (label) txt(f, x0 + iw + gap, y + h / 2 + (f->size * 7) / 20, label, fg, 0);
  zone(x, y, w, h, t, a, b);
}

/* Сегменты «А | Б | В»: выбранный — светлый. opts — через «|». */
static void segs(int x, int y, int w, int h, const char *opts, int sel, int t, int a, uint16_t acc) {
  int n = 1;
  for (const char *p = opts; *p; p++) n += *p == '|';
  g_rrect((float)x, (float)y, (float)w, (float)h, h / 2.0f, K_CARD2);
  const char *p = opts;
  for (int i = 0; i < n; i++) {
    char lab[80];
    int k = 0;
    while (*p && *p != '|' && k < (int)sizeof lab - 1) lab[k++] = *p++;
    lab[k] = 0;
    if (*p == '|') p++;
    int x0 = x + w * i / n, x1 = x + w * (i + 1) / n;
    int on = i == sel, pr = is_p(t, a, i);
    if (on) g_rrect((float)x0 + 3, (float)y + 3, (float)(x1 - x0 - 6), (float)h - 6, (h - 6) / 2.0f, acc);
    else if (pr) g_rrect((float)x0 + 3, (float)y + 3, (float)(x1 - x0 - 6), (float)h - 6, (h - 6) / 2.0f, K_PRESS);
    const pfont_t *f = g_text_w(&F_D15, lab, 0) > x1 - x0 - 10 ? &F_N12 : &F_D15;
    txt(f, (x0 + x1) / 2, y + h / 2 + (f->size * 7) / 20, lab, on ? K_INK : K_SUB, 1);
    zone(x0, y, x1 - x0, h, t, a, i);
  }
}

/* Переключатель вкл/выкл. */
static void toggle(int x, int y, int on, int t, int a) {
  g_rrect((float)x, (float)y, 46, 26, 13, on ? K_ACC : K_FAINT);
  g_circle(on ? (float)x + 33 : (float)x + 13, (float)y + 13, 10, on ? K_INK : K_SUB);
  zone(x - 8, y - 10, 62, 46, t, a, 0);
}

/* Полоса с подписью доли. */
static void meter(int x, int y, int w, float frac, uint16_t c) { g_bar((float)x, (float)y, (float)w, 8, clampf(frac, 0, 1), K_FAINT, c); }

/* ---------------- списки настроек ---------------- */

enum { R_HEAD, R_NUM, R_SEG, R_TOG, R_CHOICE, R_BTN, R_INFO, R_TEXT, R_BAR };
typedef struct {
  uint8_t kind;
  int16_t id;
  const char *label;
  char sub[128];
  char val[64];
  const char *opts;     /* R_SEG, R_CHOICE: «А|Б|В» */
  int sel;
  float v, mn, mx, st;  /* R_NUM: значение, пределы, шаг */
  const char *cmd;      /* R_NUM: команда (к ней — новое значение); 0 — обработчик экрана */
  const char *tk;       /* поле, которое сразу показать новым */
  const char *ic;
  uint16_t col;
} row_t;
#define NROW 48
static row_t RW[NROW];
static int nrw;
/* Обработчик экрана: id строки, новое значение (число, номер варианта, вкл/выкл; кнопка — 0). */
static void (*row_fn)(int id, float v);

/* Копия с пределом (строки списка — в своих буферах). */
static void cpy(char *d, int n, const char *s) {
  int i = 0;
  while (s[i] && i < n - 1) d[i] = s[i], i++;
  /* Не рвать букву UTF-8 пополам: следующий байт — продолжение буквы, значит, назад к её началу. */
  while (i > 0 && (s[i] & 0xC0) == 0x80) i--;
  d[i] = 0;
}

static row_t *row_new(int kind, int id, const char *label, const char *sub) {
  if (nrw >= NROW) nrw = NROW - 1;
  row_t *r = &RW[nrw++];
  r->kind = (uint8_t)kind, r->id = (int16_t)id, r->label = label;
  r->sub[0] = 0, r->val[0] = 0;
  if (sub) cpy(r->sub, sizeof r->sub, sub);
  r->opts = 0, r->sel = 0, r->cmd = 0, r->tk = 0, r->ic = 0, r->col = K_ACC;
  r->v = r->mn = r->mx = r->st = 0;
  return r;
}

static void r_head(const char *label) { row_new(R_HEAD, -1, label, 0); }

/* Пояснение: строка должна жить дольше кадра (литерал или таблица). */
static void r_text(const char *s) { row_new(R_TEXT, -1, s, 0); }

static void r_info(const char *label, const char *val, uint16_t col) {
  row_t *r = row_new(R_INFO, -1, label, 0);
  cpy(r->val, sizeof r->val, val);
  r->col = col;
}

/* Число: показ — val (готовая строка); −/+ меняют v на шаг st в пределах [mn, mx]. */
static row_t *r_num(int id, const char *label, const char *sub, float v, float mn, float mx, float st, const char *val) {
  row_t *r = row_new(R_NUM, id, label, sub);
  r->v = v, r->mn = mn, r->mx = mx, r->st = st;
  cpy(r->val, sizeof r->val, val);
  return r;
}

static void r_seg(int id, const char *label, const char *sub, const char *opts, int sel) {
  row_t *r = row_new(R_SEG, id, label, sub);
  r->opts = opts, r->sel = sel;
}

static void r_tog(int id, const char *label, const char *sub, int on) {
  row_t *r = row_new(R_TOG, id, label, sub);
  r->sel = on;
}

static void r_choice(int id, const char *label, const char *sub, const char *opts, int sel) {
  row_t *r = row_new(R_CHOICE, id, label, sub);
  r->opts = opts, r->sel = sel;
  /* Подпись выбранного варианта. */
  const char *p = opts;
  for (int i = 0; i < sel && *p; i++) {
    while (*p && *p != '|') p++;
    if (*p) p++;
  }
  int k = 0;
  while (p[k] && p[k] != '|' && k < (int)sizeof r->val - 1) r->val[k] = p[k], k++;
  r->val[k] = 0;
}

static void r_btn(int id, const char *label, const char *ic, uint16_t col) {
  row_t *r = row_new(R_BTN, id, label, 0);
  r->ic = ic, r->col = col;
}

static void r_bar(const char *label, const char *val, float frac, uint16_t col) {
  row_t *r = row_new(R_BAR, -1, label, 0);
  cpy(r->val, sizeof r->val, val);
  r->v = frac, r->col = col;
}

static int row_h(const row_t *r, int w) {
  switch (r->kind) {
  case R_HEAD: return 30;
  case R_INFO: return 32;
  case R_TEXT: return wrap_lines(&F_N14, w - 24, r->label) * 19 + 12;
  case R_BAR: return 46;
  case R_SEG: return r->sub[0] ? 96 : 80;
  default: return r->sub[0] ? 58 : 50;
  }
}

/* Окно выбора варианта (поверх экрана). */
static struct {
  int open, row, sel, n;
  const char *opts;
  const char *title;
} sheet;

static void draw_row(row_t *r, int i, int x, int y, int w) {
  int h = row_h(r, w);
  if (r->kind == R_HEAD) {
    txt(&F_D13, x + 6, y + 22, r->label, K_ACC, 0);
    return;
  }
  if (r->kind == R_TEXT) {
    wrap(&F_N14, x + 12, y + 19, w - 24, 19, r->label, K_SUB, 20, 0);
    return;
  }
  int pressed_row = (r->kind == R_CHOICE || r->kind == R_BTN || r->kind == R_TOG) && is_p(r->kind == R_CHOICE ? ZT_CHOICE : r->kind == R_BTN ? ZT_ROWBTN : ZT_TOG, i, 0);
  if (r->kind == R_BTN) {
    uint16_t bg = pressed_row ? K_PRESS : K_CARD;
    g_rrect((float)x, (float)y, (float)w, (float)h - 6, 10, bg);
    int tw = g_text_w(&F_D17, r->label, 0) + (r->ic ? 30 : 0);
    int x0 = x + (w - tw) / 2;
    if (r->ic) icon(&F_I24, x0, y + (h - 6 - 24) / 2, r->ic, r->col);
    txt(&F_D17, x0 + (r->ic ? 30 : 0), y + (h - 6) / 2 + 6, r->label, r->col == K_ACC ? K_TEXT : r->col, 0);
    zone(x, y, w, h - 6, ZT_ROWBTN, i, 0);
    return;
  }
  g_rrect((float)x, (float)y, (float)w, (float)h - 6, 10, pressed_row ? K_PRESS : K_CARD);
  int ty = r->kind == R_SEG ? y + 22 : r->sub[0] ? y + 24 : y + 29;
  if (r->kind == R_INFO) {
    txt(&F_N14, x + 12, y + 21, r->label, K_SUB, 0);
    txt(&F_D15, x + w - 12, y + 21, r->val, r->col == K_ACC ? K_TEXT : r->col, 2);
    return;
  }
  if (r->kind == R_BAR) {
    txt(&F_N14, x + 12, y + 19, r->label, K_SUB, 0);
    txt(&F_D15, x + w - 12, y + 19, r->val, K_TEXT, 2);
    meter(x + 12, y + 28, w - 24, r->v, r->col);
    return;
  }
  /* Подпись слева: две строки, если есть пояснение. */
  int lw = r->kind == R_NUM ? w - 200 : r->kind == R_SEG ? w - 24 : w - 110;
  wrap(&F_D15, x + 12, ty, lw, 18, r->label, K_TEXT, 1, 0);
  if (r->sub[0]) wrap(&F_N12, x + 12, ty + 18, lw, 15, r->sub, K_DIM, 1, 0);
  if (r->kind == R_NUM) {
    int bx = x + w - 188;
    button(bx, y + (h - 6 - 36) / 2, 44, 36, 0, IC_MINUS, 0, ZT_MINUS, i, 0);
    button(x + w - 56, y + (h - 6 - 36) / 2, 44, 36, 0, IC_PLUS, 0, ZT_PLUS, i, 0);
    const pfont_t *f = g_text_w(&F_D17, r->val, 0) > 88 ? &F_D13 : &F_D17;
    txt(f, bx + 44 + 44, y + (h - 6) / 2 + 6, r->val, K_TEXT, 1);
  } else if (r->kind == R_TOG) {
    toggle(x + w - 62, y + (h - 6 - 26) / 2, r->sel, ZT_TOG, i);
  } else if (r->kind == R_CHOICE) {
    int vw = g_text_w(&F_D15, r->val, 0);
    if (vw > 150) vw = 150;
    txt(&F_D15, x + w - 34, y + (h - 6) / 2 + 5, r->val, K_ACC, 2);
    icon(&F_I18, x + w - 28, y + (h - 6 - 18) / 2, IC_CHEV, K_DIM);
    zone(x, y, w, h - 6, ZT_CHOICE, i, 0);
  } else if (r->kind == R_SEG) {
    segs(x + 12, y + h - 6 - 40, w - 24, 32, r->opts, r->sel, ZT_SEG, i, K_ACC);
  }
}

/* Список в окне (x, y, w, h) с прокруткой scroll[screen]. */
static void draw_list(int x, int y, int w, int h) {
  int total = 0;
  for (int i = 0; i < nrw; i++) total += row_h(&RW[i], w);
  list_h = total;
  int maxs = total - h + 8;
  if (maxs < 0) maxs = 0;
  if (scroll[screen] > maxs) scroll[screen] = maxs;
  if (scroll[screen] < 0) scroll[screen] = 0;
  zone(x, y, w, h, ZT_LIST, 0, 0);
  g_clip(x, y, x + w, y + h);
  int nz0 = nz;
  int yy = y - scroll[screen];
  for (int i = 0; i < nrw; i++) {
    int rh = row_h(&RW[i], w);
    if (yy + rh > y && yy < y + h) draw_row(&RW[i], i, x, yy, w);
    yy += rh;
  }
  /* Зоны строк — только в видимой части. */
  for (int i = nz0; i < nz; i++) {
    zone_t *z = &Z[i];
    int y0 = z->y < y ? y : z->y, y1 = z->y + z->h > y + h ? y + h : z->y + z->h;
    if (y1 <= y0) z->h = 0;
    else z->y = (int16_t)y0, z->h = (int16_t)(y1 - y0);
  }
  g_noclip();
  /* Полоса прокрутки. */
  if (maxs > 0) {
    float frac = (float)h / (float)total, pos = (float)scroll[screen] / (float)maxs;
    int bh = (int)(h * frac);
    if (bh < 24) bh = 24;
    g_rrect((float)(x + w + 2), (float)(y + (h - bh) * pos), 3, (float)bh, 1.5f, K_FAINT);
  }
}

/* −/+ у числа: шаг, при удержании — быстрее. */
static void row_step(int i, int dir) {
  if (i < 0 || i >= nrw) return;
  row_t *r = &RW[i];
  if (r->kind != R_NUM) return;
  float st = r->st * (repeats > 12 ? 10 : 1);
  float nv = r->v + dir * st;
  /* К ровному шагу. */
  nv = (float)ri(nv / r->st) * r->st;
  nv = clampf(nv, r->mn, r->mx);
  if (nv == r->v) return;
  r->v = nv;
  if (r->cmd) {
    if (r->tk) local_f(r->tk, nv, 0);
    cmdi(r->cmd, ri(nv));
  } else if (row_fn)
    row_fn(r->id, nv);
  dirty = 1;
}

/* ---------------- кнопки экранов ---------------- */

enum {
  B_T1 = 1, B_T2, B_START, B_PURGE, B_STRONG, B_MODE, B_RSEL, B_MINUS, B_PLUS, B_OV_YES, B_OV_NO, B_STRONG_X, B_ACK, B_WAKE,
  B_SVC, B_CHART_M, B_CHART_R, B_OSC, B_MENU0, B_WIZ, B_TILE, B_SHEET_X, B_FA, B_GAUGE
};

/* ---------------- строка состояния и вкладки ---------------- */

static const char *const SC_TITLE[SC_N] = {"", "", "", "", "", "Настройки", "Первый пуск", "Обслуживание фильтра", "Схема", "Обслуживание", "Отчёт смены", "Журнал", "Голос", "Весы", "Часы", "Связь", "Розетка", "Паспорт пылесоса", "Удар клапана"};

static int is_tab(int sc) { return sc <= SC_MENU; }

/* Время контроллера (секунды от 2000) → «14:30» и «07.10». */
static void clock_str(uint32_t t, char *hm, char *dm) {
  uint32_t days = t / 86400u, r = t % 86400u;
  int h = (int)(r / 3600), mi = (int)(r % 3600 / 60);
  int y = 2000;
  static const uint8_t MD[12] = {31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};
  for (;;) {
    uint32_t n = (y % 4 == 0 && (y % 100 || y % 400 == 0)) ? 366 : 365;
    if (days < n) break;
    days -= n, y++;
  }
  int m = 0;
  for (;;) {
    uint32_t n = MD[m] + (m == 1 && y % 4 == 0 && (y % 100 || y % 400 == 0));
    if (days < n || m == 11) break;
    days -= n, m++;
  }
  if (hm) {
    hm[0] = 0;
    if (h < 10) cat(hm, "0");
    catn(hm, (float)h, 0), cat(hm, ":");
    if (mi < 10) cat(hm, "0");
    catn(hm, (float)mi, 0);
  }
  if (dm) {
    dm[0] = 0;
    if (days + 1 < 10) cat(dm, "0");
    catn(dm, (float)(days + 1), 0), cat(dm, ".");
    if (m + 1 < 10) cat(dm, "0");
    catn(dm, (float)(m + 1), 0);
  }
}

/* Что сейчас происходит — одной строкой; *col — цвет. */
static void state_text(char *s, uint16_t *col) {
  s[0] = 0;
  *col = K_SUB;
  int tf = top_fault();
  if (!link_ok()) return (void)(cat(s, "Нет связи с контроллером"), *col = K_RED);
  if (Vi("Ssl")) return (void)cat(s, "Выключен");
  if (tf >= 0 && (F_URGENT & (1UL << tf))) return (void)(cat(s, FAULT[tf].text), *col = K_RED);
  int pg = Vi("Spg");
  if (Vi("Sts")) return (void)(cat(s, "Проверка первого пуска"), *col = K_ACC);
  if (pg == 2) return (void)(cat(s, Vi("Shz") ? "Мощная: закройте шланг" : "Мощная очистка"), *col = K_ACC);
  if (pg) {
    cat(s, pg == 4 ? "Очистка перед остановкой" : "Очистка");
    if (Vi("Sbo") && !Vi("Spn")) cat(s, " · разгон");
    else if (Vi("Spn")) catn(cat(s, " · удар "), V("Spn"), 0);
    *col = K_ACC;
    return;
  }
  if (tf >= 0) return (void)(cat(s, FAULT[tf].text), *col = K_WARN);
  if (Vi("Sru")) {
    cat(s, Vs("Smd")[0] == 'm' ? "Работа · ручной" : "Работа · авто");
    if (Vi("Stl")) cat(s, " · инструмент");
    *col = K_GREEN;
    return;
  }
  if (Vi("Sst")) return (void)(cat(s, "Пуск…"), *col = K_GREEN);
  cat(s, "Готов");
}

static void top_bar(void) {
  g_fill(0, 0, SW_, TOPH, K_BAR);
  char s[192], hm[8], dm[8];
  uint16_t col;
  int x = 12;
  if (!is_tab(screen)) {
    button(2, 0, 44, TOPH, 0, IC_BACK, 4, ZT_BACK, 0, 0);
    g_fill(2, 0, 44, TOPH, K_BAR);
    icon(&F_I18, 14, 6, IC_BACK, K_TEXT);
    txt(&F_D15, 46, 21, SC_TITLE[screen], K_TEXT, 0);
    x = 48 + g_text_w(&F_D15, SC_TITLE[screen], 0) + 16;
    state_text(s, &col);
    if (col == K_RED || col == K_WARN) {
      g_circle((float)x, 15, 4, col);
      wrap(&F_N12, x + 10, 19, 300 - x, 14, s, col, 1, 0);
    }
  } else {
    state_text(s, &col);
    g_circle(16, 15, 5, col);
    wrap(&F_D15, 28, 21, 290, 16, s, col == K_SUB ? K_TEXT : col, 1, 0);
  }
  /* Справа: часы, вес, связь, голос. */
  int rx = SW_ - 10;
  uint32_t tm = (uint32_t)pint(Vs("Ftm"));
  if (tm) {
    clock_str(tm, hm, dm);
    txt(&F_D15, rx, 21, hm, K_TEXT, 2);
    rx -= g_text_w(&F_D15, hm, 0) + 10;
  }
  if (Vi("Xsk") && V("Fkg") >= 0 && Vi("Xsc")) {
    s[0] = 0;
    catn(s, V("Fkg"), 1), cat(s, " кг");
    txt(&F_N14, rx, 20, s, K_SUB, 2);
    rx -= g_text_w(&F_N14, s, 0) + 8;
  }
  if (Vi("Swf") || Vi("Fwf")) icon(&F_I18, rx - 18, 6, IC_WIFI, K_SUB), rx -= 24;
  if (Vi("Sbt")) icon(&F_I18, rx - 18, 6, IC_BT, Vi("Sbt") == 2 ? K_T1 : K_DIM), rx -= 24;
  if (Vi("Xvo")) icon(&F_I18, rx - 18, 6, IC_SPEAKER, K_DIM), rx -= 24;
  (void)rx;
}

static int filter_warn(void) {
  uint32_t fa = faults();
  return V("Sfl") > 85 || (fa >> 15 & 1) || (fa >> 26 & 1) || (fa >> 30 & 1);
}

static void nav(void) {
  g_fill(0, NAVY, SW_, SH_ - NAVY, K_BAR);
  g_fill(0, NAVY, SW_, 1, K_LINE);
  static const char *const LAB[5] = {"Главная", "Очистка", "Фильтр", "Графики", "Меню"};
  static const char *const IC[5] = {IC_HOME, IC_CLEAN, IC_FILTER, IC_CHART, IC_GRID};
  int cur = is_tab(screen) ? screen : back_to;
  for (int i = 0; i < 5; i++) {
    int x0 = i * 96, on = i == cur, p = is_p(ZT_TAB, i, 0);
    uint16_t c = on ? K_ACC : K_SUB;
    if (on || p) g_rrect((float)x0 + 22, NAVY + 5, 52, 28, 14, on ? K_ACC_D : K_PRESS);
    icon_c(&F_I24, x0 + 48, NAVY + 19, IC[i], c);
    txt(&F_N12, x0 + 48, NAVY + 45, LAB[i], on ? K_TEXT : K_DIM, 1);
    int badge = (i == 2 && filter_warn()) || (i == 4 && fault_count() > 0);
    if (badge) g_circle((float)x0 + 72, NAVY + 9, 4.5f, i == 4 && (faults() & F_URGENT) ? K_RED : K_WARN);
    zone(x0, NAVY, 96, SH_ - NAVY, ZT_TAB, i, 0);
  }
}

/* ---------------- «Главная» ---------------- */

static int manual(void) { return Vs("Smd")[0] == 'm'; }

/* Ручная мощность турбины k (0 — Т1, 1 — Т2). */
static float man_pw(int k) { return k ? (Vh("Sq2") ? V("Sq2") : V("Spw")) : V("Spw"); }

static void home_adjust(int d) {
  if (!d) return;
  if (!manual()) {
    int sp = clampi(Vi("Ssp") + d, 10, 60);
    local_f("Ssp", (float)sp, 0);
    cmdi("sp ", sp);
    return;
  }
  /* Ручной: Т1, Т2 или обе — по выбору. */
  if (rsel == 0) {
    int pw = clampi(ri(man_pw(0)) + d * 5, 30, 100);
    local_f("Spw", (float)pw, 0), local_f("Sq2", (float)pw, 0);
    cmdi("pw ", pw);
  } else {
    int k = rsel - 1;
    int pw = clampi(ri(man_pw(k)) + d * 5, 30, 100);
    local_f(k ? "Sq2" : "Spw", (float)pw, 0);
    cmdi(k ? "pw2 " : "pw1 ", pw);
  }
  dirty = 1;
}

static void start_stop(void) {
  int st = Vi("Sst");
  local_f("Sst", st ? 0 : 1, 0);
  cmd(st ? "stop" : "start");
  toast(st ? "Остановка" : "Пуск");
}

static void turbine_tile(int k, int x, int y, int w, int h) {
  int on = Vi(k ? "Se2" : "Se1");
  float p = V(k ? "Sp2" : "Sp1"), wt = V(k ? "Sw2" : "Sw1"), t = V(k ? "St2" : "St1");
  uint16_t tc = k ? K_T2 : K_T1;
  int sel = manual() && (rsel == 0 || rsel == k + 1);
  int pr = is_p(ZT_BTN, B_T1 + k, 0);
  g_rrect((float)x, (float)y, (float)w, (float)h, 12, pr ? K_PRESS : K_CARD);
  if (sel && on) g_rrect_line((float)x, (float)y, (float)w, (float)h, 12, 2, tc);
  /* Лопасти: вращаются, пока турбина крутится. */
  float cx = (float)x + 24, cy = (float)y + 24;
  g_circle(cx, cy, 16, on && p > 0 ? HEX(0x0f2233) : K_CARD2);
  static float ang[2];
  if (p > 0) ang[k] += p / 100.0f * 0.11f;
  for (int b = 0; b < 3; b++) {
    float a = ang[k] + b / 3.0f;
    float sx = g_sin_turn(a), sy = -g_sin_turn(a + 0.25f);
    g_line(cx + sx * 3, cy + sy * 3, cx + sx * 12, cy + sy * 12, 4.5f, p > 0 ? tc : K_DIM);
  }
  g_circle(cx, cy, 3.5f, K_BG);
  txt(&F_D17, x + 48, y + 22, k ? "Турбина 2" : "Турбина 1", on ? K_TEXT : K_SUB, 0);
  txt(&F_N12, x + 48, y + 38, on ? (p > 0 ? "работает" : "включена") : "выключена", on ? tc : K_DIM, 0);
  char s[192] = "";
  if (on) {
    catn(s, p, 0), cat(s, " %");
    txt(&F_B30, x + 12, y + h - 12, s, K_TEXT, 0);
    s[0] = 0;
    if (wt > 20) catn(s, wt, 0), cat(s, " Вт");
    else cat(s, "— Вт");
    txt(&F_D13, x + w - 10, y + h - 30, s, K_SUB, 2);
    s[0] = 0;
    catn(s, t, 0), cat(s, " °C");
    txt(&F_D13, x + w - 10, y + h - 12, s, t > 85 ? K_RED : t > 70 ? K_WARN : K_DIM, 2);
  } else
    txt(&F_N12, x + 12, y + h - 14, "коснитесь, чтобы включить", K_DIM, 0);
  zone(x, y, w, h, ZT_BTN, B_T1 + k, 0);
}

static void scr_home(void) {
  char s[192];
  /* Расход: дуга 270°, отметка уставки. */
  float cx = 94, cy = 124, r = 72;
  float flow = V("Sf"), sp = V("Ssp");
  g_arc2(cx, cy, r, 13, 0.625f, 0.75f, K_FAINT);
  float frac = clampf(flow / 60.0f, 0, 1);
  uint16_t gc = faults() & ((1UL << 13) | (1UL << 14)) ? K_WARN : K_ACC;
  if (frac > 0.005f) g_arc2(cx, cy, r, 13, 0.625f, 0.75f * frac, gc);
  if (!manual()) {
    float a = 0.625f + 0.75f * clampf(sp / 60.0f, 0, 1);
    float mx = cx + (r + 12) * g_sin_turn(a), my = cy - (r + 12) * g_sin_turn(a + 0.25f);
    g_circle(mx, my, 4, K_TEXT);
  }
  txt(&F_N12, (int)cx, (int)cy - 36, "расход", K_DIM, 1);
  fnum(s, flow, flow < 10 ? 1 : 0);
  txt(&F_B44, (int)cx, (int)cy + 14, s, K_TEXT, 1);
  txt(&F_N14, (int)cx, (int)cy + 34, "л/с", K_SUB, 1);
  s[0] = 0;
  catn(s, V("Sv"), 0), cat(s, " м/с · "), catn(s, V("Sva"), 1), cat(s, " кПа");
  txt(&F_N12, (int)cx, (int)cy + 62, s, K_DIM, 1);
  zone((int)(cx - r), (int)(cy - r), (int)(2 * r), (int)(2 * r), ZT_BTN, B_GAUGE, 0);
  /* Под шкалой: −, уставка или мощность, +. */
  button(6, 212, 50, 50, 0, IC_MINUS, 0, ZT_BTN, B_MINUS, 0);
  button(132, 212, 50, 50, 0, IC_PLUS, 0, ZT_BTN, B_PLUS, 0);
  if (!manual()) {
    txt(&F_N12, 94, 230, "уставка", K_DIM, 1);
    s[0] = 0;
    catn(s, sp, 0), cat(s, " л/с");
  } else {
    txt(&F_N12, 94, 230, rsel == 0 ? "Т1 и Т2" : rsel == 1 ? "Т1" : "Т2", rsel == 1 ? K_T1 : rsel == 2 ? K_T2 : K_DIM, 1);
    s[0] = 0;
    if (rsel == 0 && ri(man_pw(0)) != ri(man_pw(1))) catn(s, man_pw(0), 0), cat(s, "/"), catn(s, man_pw(1), 0), cat(s, " %");
    else catn(s, man_pw(rsel == 2), 0), cat(s, " %");
  }
  txt(&F_D20, 94, 254, s, K_TEXT, 1);

  /* Посередине: режим, турбины, что регулируем. */
  segs(196, CY0, 140, 34, "Авто|Ручной", manual(), ZT_BTN, B_MODE, K_ACC);
  turbine_tile(0, 196, 74, 140, 82);
  turbine_tile(1, 196, 160, 140, 82);
  if (manual()) segs(196, 246, 140, 22, "Т1|Обе|Т2", rsel == 0 ? 1 : rsel == 1 ? 0 : 2, ZT_BTN, B_RSEL, K_ACC);
  else txt(&F_N12, 266, 261, Vi("Cbt") ? "мощность — по расходу" : "мощность — по расходу", K_DIM, 1);

  /* Справа: пуск/стоп, продувка, мощная. */
  int st = Vi("Sst");
  int pr = is_p(ZT_BTN, B_START, 0);
  uint16_t bc = st ? (pr ? HEX(0xff8a7f) : K_RED) : (pr ? HEX(0x6fe8cf) : K_ACC);
  g_rrect(344, CY0, 130, 100, 16, bc);
  icon_c(&F_I44, 409, CY0 + 38, IC_POWER, K_INK);
  txt(&F_D20, 409, CY0 + 88, st ? "Стоп" : "Пуск", K_INK, 1);
  zone(344, CY0, 130, 100, ZT_BTN, B_START, 0);
  int pg = Vi("Spg");
  button(344, 140, 130, 50, pg && pg != 2 ? "Стоп" : "Продувка", IC_CLEAN, pg && pg != 2 ? 3 : 0, ZT_BTN, B_PURGE, 0);
  button(344, 196, 130, 50, pg == 2 ? "Отмена" : "Мощная", IC_TURBO, pg == 2 ? 3 : 0, ZT_BTN, B_STRONG, 0);
  /* Внизу справа: фильтр — R и до серии. */
  s[0] = 0;
  if (V("Sr") > 0) cat(s, "фильтр R "), catn(s, V("Sr"), 1);
  if (Vi("Snx") > 0 && !pg && Vi("Sru")) cat(s, " · "), catn(s, V("Snx"), 0), cat(s, " с");
  txt(&F_N12, 409, 262, s, filter_warn() ? K_WARN : K_DIM, 1);
}

/* ---------------- «Очистка» ---------------- */

#define NPR 7
static const char PRESETS[] = "Авто|Бетон, штроба|Бурение|Гипс, шпаклёвка|Уборка|Мешок|Вода";

enum {
  C_PRESET = 1, C_AUTO, C_N, C_EVERY, C_IMP, C_PAUSE, C_HOSE, C_COFF, C_VMODE, C_DIP, C_AT, C_BOOST, C_BOOSTMS, C_BOOST2, C_STRONGN, C_THR, C_DP,
  C_DO_PURGE, C_DO_STRONG, C_DO_OSC, C_VKIND
};

static int preset_cur(void) { return clampi(Vi("Spr"), 0, NPR - 1); }

static int pval(int j) {
  char k[4] = {'C', 'P', (char)('0' + preset_cur()), 0};
  return ri(VL(k, j));
}

static void send_pset(int j, int v) {
  int i = preset_cur(), p[6];
  for (int q = 0; q < 6; q++) p[q] = pval(q);
  p[j] = v;
  char s[192] = "pset ", k[4] = {'C', 'P', (char)('0' + i), 0}, loc[40] = "";
  catn(s, (float)i, 0);
  for (int q = 0; q < 6; q++) {
    cat(s, " "), catn(s, (float)p[q], 0);
    if (q) cat(loc, "/");
    catn(loc, (float)p[q], 0);
  }
  kv_set(k, loc, 1);
  cmd(s);
}

static void clean_row(int id, float v) {
  int x = ri(v);
  switch (id) {
  case C_PRESET:
    local_f("Spr", (float)x, 0);
    cmdi("preset ", x);
    break;
  case C_AUTO:
    kv_set("Scl", x ? "o" : "a", 1);
    cmd(x ? "clean o" : "clean a");
    break;
  case C_N: send_pset(1, x); break;
  case C_EVERY: send_pset(2, x && x < 5 ? 5 : x); break;
  case C_IMP: send_pset(3, x && x < 20 ? (v > pval(3) ? 20 : 0) : x); break;
  case C_PAUSE: send_pset(4, x && x < 100 ? (v > pval(4) ? 100 : 0) : x); break;
  case C_HOSE:
    send_pset(5, (pval(5) & ~1) | (x ? 1 : 0));
    if (x && !Vi("Cha")) local_f("Cha", 1, 0), cmd("hauto 1");
    break;
  case C_COFF: local_f("Ccoff", (float)x, 0), cmdi("coff ", x); break;
  case C_VMODE: local_f("Xvm", (float)x, 0), cmdi("set vmode ", x); break;
  case C_AT: local_f("Xat", (float)x, 0), cmdi("set autotune ", x); break;
  case C_BOOST: local_f("Xbo", (float)x, 0), cmdi("set boost ", x); break;
  case C_BOOST2: local_f("Xb2", (float)x, 0), cmdi("set boost2 ", x); break;
  case C_DP: {
    int cur = Vi("Cdpo"), dpc = Vi("Cdpc");
    int nv = !cur && x > 0 ? (dpc > 0 ? (dpc * 3 / 2 + 5) / 10 * 10 : 100) : x < 20 ? 0 : x;
    local_f("Cdpo", (float)nv, 0);
    cmdi("set dp ", nv);
    break;
  }
  case C_VKIND: kv_set("Xvk", x ? "1" : "0", 1), cmd(x ? "set valves pulse" : "set valves plate"); break;
  case C_DO_PURGE: cmd("purge"), toast("Продувка: серия ударов"); break;
  case C_DO_STRONG: cmd("purge strong"), toast("Мощная очистка: закройте шланг ладонью"); break;
  case C_DO_OSC: cmd("osc"), back_to = SC_CLEAN, go(SC_OSC); break;
  }
  dirty = 1;
}

static void build_clean(void) {
  char s[192];
  row_fn = clean_row;
  int pg = Vi("Spg");
  s[0] = 0;
  if (pg) cat(s, pg == 2 ? "мощная очистка идёт" : "идёт серия ударов");
  else if (Vs("Scl")[0] == 'o') cat(s, "автоочистка выключена");
  else if (Vi("Snx") > 0) catn(cat(s, "через "), V("Snx"), 0), cat(s, " с");
  else cat(s, "по загрузке фильтра");
  r_info("Следующая серия", s, pg ? K_ACC : K_ACC);
  if (V("Sra") > 0) {
    s[0] = 0;
    catn(s, V("Sr") > 0 ? V("Sra") / (1 - V("Ssm") / 100 + 0.0001f) : 0, 1);
    s[0] = 0;
    cat(s, "−"), catn(s, V("Ssm"), 0), cat(s, " % R, сейчас "), catn(s, V("Sra"), 1);
    r_info("Последняя серия", s, K_ACC);
  }
  s[0] = 0;
  catn(s, V("Fih"), 0), cat(s, " %");
  r_bar("Сила удара (фильтр клапанов)", s, V("Fih") / 100.0f, V("Fih") < 70 ? K_WARN : K_ACC);

  r_head("Режим очистки");
  r_choice(C_PRESET, "Что убираем", "уставка, удары и промежуток — свои у каждого", PRESETS, preset_cur());
  r_seg(C_AUTO, "Автоочистка", 0, "Включена|Выключена", Vs("Scl")[0] == 'o');
  int n = pval(1), ev = pval(2), imp = pval(3), pa = pval(4);
  s[0] = 0;
  if (n) catn(s, (float)n, 0);
  else cat(s, "сам");
  r_num(C_N, "Ударов в серии", "0 — подбирает «Авто»", (float)n, 0, 10, 1, s);
  s[0] = 0;
  if (ev) catn(s, (float)ev, 0), cat(s, " с");
  else cat(s, "сам");
  r_num(C_EVERY, "Промежуток между сериями", "0 — по росту сопротивления", (float)ev, 0, 600, 5, s);
  s[0] = 0;
  if (imp) catn(s, (float)imp, 0), cat(s, " мс");
  else cat(s, "сам");
  r_num(C_IMP, "Длина удара", "0 — по фронту обратного перепада", (float)imp, 0, 300, 5, s);
  s[0] = 0;
  if (pa) catn(s, (float)pa, 0), cat(s, " мс");
  else cat(s, "ждать");
  r_num(C_PAUSE, "Пауза между ударами", "0 — пока разрежение не вернётся", (float)pa, 0, 3000, 50, s);
  r_tog(C_HOSE, "Мощная по закрытому шлангу", "закрыли шланг ладонью на 2 с — серия на полной", (pval(5) & 1) && Vi("Cha"));
  r_tog(C_COFF, "Удары при остановке", "фильтр чистый к следующему пуску", Vi("Ccoff"));

  r_head("Клапаны");
  r_choice(C_VMODE, "Какие клапаны бьют", "для опытов: что лучше отбивает ваш фильтр", "Оба сразу|По очереди|Только клапан 1|Только клапан 2", clampi(Vi("Xvm"), 0, 3));
  s[0] = 0;
  catn(s, V("Xdip"), 0), cat(s, " %");
  r_num(C_DIP, "Турбины на удар слабее на", "обратный поток через фильтр сильнее", V("Xdip"), 0, 90, 5, s)->cmd = "set dip ";
  RW[nrw - 1].tk = "Xdip";
  s[0] = 0;
  if (Vi("Xatb") >= 0 && Vh("Xatb")) catn(cat(s, "лучше всего пока "), V("Xatb"), 0), cat(s, " %");
  else cat(s, "пробует 0, 40, 70 и 90 % и запоминает лучший");
  r_tog(C_AT, "Самонастройка сброса", s, Vi("Xat"));
  r_seg(C_VKIND, "Клапаны", 0, "Тарельчатые|Импульсные", Vi("Xvk") == 1);

  r_head("Разгон турбин");
  r_tog(C_BOOST, "Разгон перед серией", "удары — на полной мощности", Vi("Xbo"));
  s[0] = 0;
  catn(s, V("Xbm") / 1000.0f, 1), cat(s, " с");
  r_num(C_BOOSTMS, "Время разгона до полной", "плавно, но быстро", V("Xbm"), 300, 5000, 100, s)->cmd = "set boostms ";
  RW[nrw - 1].tk = "Xbm";
  r_seg(C_BOOST2, "Вторая турбина к ударам", "если работает одна", "Нет|К мощной|Всегда", clampi(Vi("Xb2"), 0, 2));

  r_head("Мощная очистка и «Авто»");
  s[0] = 0;
  catn(s, V("Csn"), 0);
  r_num(C_STRONGN, "Ударов в мощной очистке", 0, V("Csn"), 1, 10, 1, s)->cmd = "set strong ";
  RW[nrw - 1].tk = "Csn";
  s[0] = 0;
  catn(cat(s, "+"), V("Cthr") - 100, 0), cat(s, " %");
  r_num(C_THR, "«Авто»: серия, когда R выросло на", 0, V("Cthr"), 105, 200, 5, s)->cmd = "set thr ";
  RW[nrw - 1].tk = "Cthr";
  s[0] = 0;
  if (Vi("Cdpo")) catn(s, V("Cdpo"), 0), cat(s, " Па");
  else cat(s, "авто");
  char sub[96] = "0 — «авто»";
  if (Vi("Cdpc") > 0) catn(cat(sub, " · чистый "), V("Cdpc"), 0), cat(sub, " Па");
  r_num(C_DP, "Серия при перепаде", sub, V("Cdpo"), 0, 2000, 10, s);

  r_head("Сейчас");
  r_btn(C_DO_PURGE, "Продувка — серия ударов", IC_CLEAN, K_ACC);
  r_btn(C_DO_STRONG, "Мощная очистка", IC_TURBO, K_ACC);
  r_btn(C_DO_OSC, "Последний удар — осциллограф", IC_CHART, K_ACC);
}

/* ---------------- «Фильтр» ---------------- */

enum { F_SVC = 1, F_SWAP, F_BAG, F_BAGNEW, F_INTAKE, F_WASHK };

static const char *const SV_NAME[8] = {"обстучал", "продул", "пропылесосил", "промыл", "щётка", "другое", "", "новый"};

static void svc_what(char *s, int mask) {
  s[0] = 0;
  if (mask & 128) return (void)cat(s, "новый");
  for (int b = 0; b < 6; b++)
    if (mask & (1 << b)) {
      if (s[0]) cat(s, ", ");
      cat(s, SV_NAME[b]);
    }
  if (!s[0]) cat(s, "—");
}

static void filter_row(int id, float v) {
  switch (id) {
  case F_SVC: back_to = SC_FILTER, go(SC_SVC); break;
  case F_SWAP: cmd("filter swap"), toast("Стоит другой фильтр — замер по нему"); break;
  case F_BAG: local_f("Cbg", v, 0), cmdi("bag ", ri(v)); break;
  case F_BAGNEW: cmd("bag new"), toast("Замер мешка: 20 с, шланг открыт"); break;
  case F_INTAKE: cmd("intake new"), toast("Фильтр клапанов новый"); break;
  }
  dirty = 1;
}

static void filter_card(int i, int x, int y, int w, int h) {
  const char *k = i ? "CFB" : "CFA";
  int on = Vi("Cfi") == i;
  float rn = VL(k, 0), rb = VL(k, 1), wash = VL(k, 2), hrs = VL(k, 3);
  float rnow = on ? V("Sr") : rb;
  g_rrect((float)x, (float)y, (float)w, (float)h, 12, K_CARD);
  if (on) g_rrect_line((float)x, (float)y, (float)w, (float)h, 12, 2, K_ACC);
  icon(&F_I24, x + 10, y + 10, IC_FILTER, on ? K_ACC : K_DIM);
  txt(&F_D17, x + 42, y + 28, i ? "Фильтр Б" : "Фильтр А", on ? K_TEXT : K_SUB, 0);
  if (on) {
    g_rrect((float)x + w - 66, (float)y + 12, 56, 20, 10, K_ACC_D);
    txt(&F_N12, x + w - 38, y + 26, "стоит", K_ACC, 1);
  }
  char s[192] = "";
  if (rnow > 0) catn(s, rnow, 1);
  else cat(s, "—");
  txt(&F_B30, x + 12, y + 72, s, K_TEXT, 0);
  int tw = g_text_w(&F_B30, s, 0);
  txt(&F_N12, x + 18 + tw, y + 72, "R", K_DIM, 0);
  s[0] = 0;
  if (rn > 0 && rnow > 0) {
    float pct = rn / rnow * 100;
    catn(s, pct > 100 ? 100 : pct, 0), cat(s, " % от нового");
    meter(x + 12, y + 82, w - 24, pct / 100, pct < 55 ? K_RED : pct < 75 ? K_WARN : K_ACC);
  } else
    cat(s, "новым не мерили");
  txt(&F_N12, x + w - 12, y + 72, s, K_SUB, 2);
  s[0] = 0;
  catn(s, hrs, 1), cat(s, " ч · моек "), catn(s, wash, 0);
  txt(&F_N12, x + 12, y + h - 8, s, K_DIM, 0);
}

static void build_filter(void) {
  char s[192], what[160];
  row_fn = filter_row;
  s[0] = 0;
  catn(s, V("Sfl"), 0), cat(s, " %");
  r_bar("Загрузка до серии", s, V("Sfl") / 100.0f, V("Sfl") > 85 ? K_WARN : K_ACC);
  s[0] = 0;
  catn(s, V("Sdp"), 0), cat(s, " Па при "), catn(s, V("Sf"), 1), cat(s, " л/с");
  r_info("Перепад на фильтре", s, K_ACC);
  s[0] = 0;
  float fc = Vh("Ffc") ? V("Ffc") : -1;
  if (fc >= 0) cat(s, "через ~"), catn(s, fc, fc < 10 ? 1 : 0), cat(s, " ч работы");
  else cat(s, "копит данные (4 серии)");
  r_info("Мойка фильтра", s, fc >= 0 && fc < 2 ? K_WARN : K_ACC);
  r_btn(F_SVC, "Обслуживание фильтра", IC_WRENCH, K_ACC);
  r_text("Снял фильтр, обстучал, продул, промыл или поставил новый — отметьте здесь: пылесос замерит его и запомнит, сколько это вернуло.");
  r_head("История обслуживания");
  int any = 0;
  for (int i = 11; i >= 0; i--) {
    char k[6] = {'Q', 'e', (char)('0' + i / 10), (char)('0' + i % 10), 0, 0};
    const char *v = Vs(k);
    if (!v[0]) continue;
    /* дата_время/часы/что/R до/R после */
    char date[24];
    int n = 0;
    while (v[n] && v[n] != '/' && n < 23) date[n] = v[n] == '_' ? ' ' : v[n], n++;
    date[n] = 0;
    if (n > 10) date[5] = 0; /* «07.10.2026 14:30» → «07.10» */
    float hrs = VL(k, 1), rb = VL(k, 3), ra = VL(k, 4);
    int mask = ri(VL(k, 2));
    svc_what(what, mask);
    s[0] = 0;
    cat(s, date[0] && date[0] != '-' ? date : "—"), cat(s, " · "), cat(s, what);
    char val[64] = "";
    if (!(mask & 128)) catn(val, rb, 1), cat(val, " → ");
    catn(val, ra, 1);
    (void)hrs;
    r_info("", val, ra < rb || (mask & 128) ? K_GREEN : K_WARN);
    /* Подпись собрана здесь же — храним её в строке списка (sub), а не на стеке. */
    cpy(RW[nrw - 1].sub, sizeof RW[nrw - 1].sub, s);
    RW[nrw - 1].label = RW[nrw - 1].sub;
    any = 1;
  }
  if (!any) r_text("Записей пока нет.");
  r_head("Ещё");
  r_btn(F_SWAP, "Поставил другой фильтр (А ↔ Б)", IC_LOOP, K_ACC);
  r_tog(F_BAG, "Мешок в баке", "сухая уборка: мешок добавляет сопротивление", Vi("Cbg"));
  r_btn(F_BAGNEW, "Новый мешок — замер", IC_CHECK, K_ACC);
  s[0] = 0;
  catk(s, Vi("Cip")), cat(s, " ударов");
  r_info("Фильтр клапанов: с замены", s, K_ACC);
  r_btn(F_INTAKE, "Фильтр клапанов заменён", IC_CHECK, K_ACC);
}

static void scr_filter(void) {
  filter_card(0, 6, CY0, 230, 96);
  filter_card(1, 244, CY0, 230, 96);
  build_filter();
  draw_list(6, CY0 + 102, 462, CY1 - CY0 - 102);
}

/* ---------------- «Графики» ---------------- */

static int chart_m, chart_r;
static uint32_t chart_req;
static const char *const CH_NAME[8] = {"Расход", "Разрежение", "Фильтр R", "Мощность", "Нагрев", "Вес", "Перепад", "Ток"};
static const char *const CH_UNIT[8] = {"л/с", "кПа", "", "Вт", "°C", "кг", "Па", "А"};

static void chart_request(void) {
  char s[24] = "hist ";
  catn(s, (float)chart_m, 0), cat(s, " "), catn(s, (float)chart_r, 0);
  cmd(s);
  chart_req = now;
}

/* Ось и линия: значения vals[0..n), справа — новое. */
static void plot(int x, int y, int w, int h, const float *vals, int n, uint16_t c, float *lo_out, float *hi_out, int fixlo) {
  float lo = 1e9f, hi = -1e9f;
  for (int i = 0; i < n; i++) lo = vals[i] < lo ? vals[i] : lo, hi = vals[i] > hi ? vals[i] : hi;
  if (n == 0) lo = 0, hi = 1;
  if (fixlo && lo > 0) lo = 0;
  if (hi - lo < 1e-3f) hi = lo + 1;
  float pad = (hi - lo) * 0.08f;
  hi += pad;
  if (!fixlo) lo -= pad;
  *lo_out = lo, *hi_out = hi;
  for (int g = 1; g < 4; g++) g_fill(x, y + h * g / 4, w, 1, K_LINE);
  if (n < 2) return;
  float px = 0, py = 0;
  for (int i = 0; i < n; i++) {
    float xx = (float)x + (float)w * (float)i / (float)(n - 1);
    float yy = (float)(y + h) - (vals[i] - lo) / (hi - lo) * (float)h;
    if (i) g_line(px, py, xx, yy, 2.2f, c);
    px = xx, py = yy;
  }
}

static void scr_chart(void) {
  char s[192];
  for (int i = 0; i < 8; i++) {
    int x = 6 + (i % 4) * 117, y = CY0 + (i / 4) * 30;
    int on = i == chart_m, p = is_p(ZT_BTN, B_CHART_M, i);
    g_rrect((float)x, (float)y, 112, 26, 13, on ? K_ACC : p ? K_PRESS : K_CARD2);
    txt(&F_D13, x + 56, y + 18, CH_NAME[i], on ? K_INK : K_SUB, 1);
    zone(x, y, 112, 26, ZT_BTN, B_CHART_M, i);
  }
  segs(6, CY0 + 62, 330, 28, "10 минут|1 час|4 часа", chart_r, ZT_BTN, B_CHART_R, K_ACC);
  button(344, CY0 + 62, 130, 28, "Удар", IC_VALVE, 0, ZT_BTN, B_OSC, 0);
  int x = 44, y = CY0 + 100, w = 424, h = CY1 - y - 16;
  g_rrect(6, (float)y - 6, 468, (float)h + 26, 10, K_CARD);
  if (hm != chart_m || hr != chart_r || hn < 2) {
    txt(&F_N14, x + w / 2, y + h / 2, hm == chart_m && hr == chart_r ? "данных пока мало — график через минуту" : "загрузка…", K_DIM, 1);
    return;
  }
  float lo, hi;
  plot(x, y, w, h, hv, hn, chart_m == 3 ? K_WARN : chart_m == 4 ? K_RED : K_ACC, &lo, &hi, chart_m != 2 && chart_m != 6);
  /* Отметки ударов: секунды назад → x. */
  float span = (float)(hn - 1) * (float)hdt;
  for (int i = 0; i < hpn; i++) {
    float t = (float)hp[i];
    if (t > span) continue;
    int px = x + w - (int)(t / span * (float)w);
    g_fill(px, y, 1, h, K_FAINT);
    g_circle((float)px, (float)y + 3, 2.5f, K_T2);
  }
  s[0] = 0;
  catn(s, hi, hi < 20 ? 1 : 0);
  txt(&F_N12, x - 6, y + 10, s, K_DIM, 2);
  s[0] = 0;
  catn(s, lo, hi < 20 ? 1 : 0);
  txt(&F_N12, x - 6, y + h, s, K_DIM, 2);
  txt(&F_N12, x - 6, y + h / 2 + 4, CH_UNIT[chart_m], K_DIM, 2);
  static const char *const SPAN[3] = {"−10 мин", "−1 ч", "−4 ч"};
  txt(&F_N12, x, y + h + 14, SPAN[chart_r], K_DIM, 0);
  txt(&F_N12, x + w, y + h + 14, "сейчас", K_DIM, 2);
  s[0] = 0;
  cat(s, CH_NAME[chart_m]), cat(s, ": "), catn(s, hv[hn - 1], hv[hn - 1] < 20 ? 1 : 0), cat(s, " "), cat(s, CH_UNIT[chart_m]);
  txt(&F_D13, x + w / 2, y + h + 14, s, K_TEXT, 1);
}

/* ---------------- осциллограф удара ---------------- */

static void scr_osc(void) {
  char s[192];
  if (!on_) {
    txt(&F_D17, 240, 140, "Ударов ещё не было", K_SUB, 1);
    txt(&F_N14, 240, 166, "запустите продувку — здесь будет её последний удар", K_DIM, 1);
    button(150, 190, 180, 44, "Продувка", IC_CLEAN, 1, ZT_BTN, B_PURGE, 0);
    return;
  }
  int m = Vi("Om");
  s[0] = 0;
  catn(cat(s, "Удар №"), V("Ok"), 0), cat(s, " · "), cat(s, m == 3 ? "оба клапана" : m == 1 ? "клапан 1" : "клапан 2");
  catn(cat(s, " · "), V("Oi"), 0), cat(s, " мс");
  txt(&F_D15, 12, CY0 + 18, s, K_TEXT, 0);
  s[0] = 0;
  catn(cat(s, "провал разрежения "), V("Od"), 0), cat(s, " % · обратный перепад "), catn(s, V("Orv"), 0), cat(s, " Па · фронт "), catn(s, V("Otf"), 0), cat(s, " мс");
  txt(&F_N12, 12, CY0 + 38, s, K_SUB, 0);
  int x = 44, y = CY0 + 52, w = 388, h = CY1 - y - 20;
  g_rrect(6, (float)y - 6, 468, (float)h + 28, 10, K_CARD);
  static float va[OMAX], vb[OMAX];
  for (int i = 0; i < on_; i++) va[i] = oa[i] / 10.0f, vb[i] = ob[i];
  float lo, hi, lo2, hi2;
  plot(x, y, w, h, va, on_, K_ACC, &lo, &hi, 1);
  /* Перепад — своя шкала справа. */
  float mn = 1e9f, mx = -1e9f;
  for (int i = 0; i < on_; i++) mn = vb[i] < mn ? vb[i] : mn, mx = vb[i] > mx ? vb[i] : mx;
  lo2 = mn - (mx - mn) * 0.08f - 1, hi2 = mx + (mx - mn) * 0.08f + 1;
  float px = 0, py = 0;
  for (int i = 0; i < on_; i++) {
    float xx = (float)x + (float)w * (float)i / (float)(on_ - 1 > 0 ? on_ - 1 : 1);
    float yy = (float)(y + h) - (vb[i] - lo2) / (hi2 - lo2) * (float)h;
    if (i) g_line(px, py, xx, yy, 1.8f, K_WARN);
    px = xx, py = yy;
  }
  /* Ноль перепада и конец удара. */
  if (lo2 < 0 && hi2 > 0) g_fill(x, (int)((float)(y + h) - (0 - lo2) / (hi2 - lo2) * (float)h), w, 1, K_FAINT);
  float tot = (float)(on_ - 1) * 2;
  float imp = V("Oi");
  if (imp > 0 && imp < tot) {
    int ix = x + (int)(imp / tot * (float)w);
    g_fill(ix, y, 1, h, K_T2);
    txt(&F_N12, ix + 4, y + 12, "конец удара", K_T2, 0);
  }
  s[0] = 0;
  catn(s, hi, 1);
  txt(&F_N12, x - 6, y + 10, s, K_ACC, 2);
  txt(&F_N12, x - 6, y + h / 2, "кПа", K_ACC, 2);
  s[0] = 0;
  catn(s, lo, 1);
  txt(&F_N12, x - 6, y + h, s, K_ACC, 2);
  s[0] = 0;
  catn(s, hi2, 0);
  txt(&F_N12, x + w + 6, y + 10, s, K_WARN, 0);
  txt(&F_N12, x + w + 6, y + h / 2, "Па", K_WARN, 0);
  s[0] = 0;
  catn(s, lo2, 0);
  txt(&F_N12, x + w + 6, y + h, s, K_WARN, 0);
  txt(&F_N12, x, y + h + 16, "0", K_DIM, 0);
  s[0] = 0;
  catn(s, tot, 0), cat(s, " мс");
  txt(&F_N12, x + w, y + h + 16, s, K_DIM, 2);
  txt(&F_N12, x + w / 2, y + h + 16, "— разрежение    — перепад на фильтре", K_DIM, 1);
}

/* ---------------- «Меню» ---------------- */

static const struct {
  const char *label, *ic;
  int sc;
} TILES[12] = {
    {"Настройки", IC_GEAR, SC_SET},       {"Первый пуск", IC_FLAG, SC_WIZ},  {"Схема", IC_SCHEME, SC_SCHEME},  {"Обслуживание", IC_WRENCH, SC_MAINT},
    {"Отчёт смены", IC_REPORT, SC_REPORT}, {"Журнал", IC_LIST, SC_LOG},       {"Голос", IC_SPEAKER, SC_VOICE}, {"Весы", IC_SCALE, SC_SCALE},
    {"Часы", IC_CLOCK, SC_CLOCK},         {"Связь", IC_WIFI, SC_LINK},       {"Розетка", IC_PLUG, SC_TOOL},   {"Паспорт", IC_INFO, SC_ABOUT},
};

static int maint_due(void) { return V("Mb1") >= 90 || V("Mb2") >= 90 || V("Min") >= 90 || V("Mse") >= 90 || V("Mfl") >= 100; }

static void scr_menu(void) {
  for (int i = 0; i < 12; i++) {
    int c = i % 4, r = i / 4;
    int x = 6 + c * 118, y = CY0 + r * 78, w = 112, h = 72;
    int p = is_p(ZT_BTN, B_TILE, i);
    g_rrect((float)x, (float)y, (float)w, (float)h, 12, p ? K_PRESS : K_CARD);
    icon_c(&F_I32, x + w / 2, y + 28, TILES[i].ic, K_ACC);
    txt(&F_D13, x + w / 2, y + 62, TILES[i].label, K_TEXT, 1);
    int badge = (TILES[i].sc == SC_LOG && fault_count()) || (TILES[i].sc == SC_WIZ && Vh("Gdone") && !Vi("Gdone")) || (TILES[i].sc == SC_MAINT && maint_due());
    if (badge) g_circle((float)x + w - 14, (float)y + 14, 5, TILES[i].sc == SC_LOG && (faults() & F_URGENT) ? K_RED : K_WARN);
    zone(x, y, w, h, ZT_BTN, B_TILE, i);
  }
}

/* ---------------- «Настройки» ---------------- */

enum { S_LCDCAL = 1, S_VOICE, S_PRESETRESET, S_FTYPE, S_T2 };

static void set_row(int id, float v) {
  switch (id) {
  case S_LCDCAL: cmd("lcd cal"), toast("Калибровка касания: коснитесь крестиков"); break;
  case S_VOICE: back_to = SC_SET, go(SC_VOICE); break;
  case S_PRESETRESET: cmd("preset reset"), toast("Режимы очистки — как с завода"); break;
  case S_FTYPE: local_f("Xft", v, 0), cmdi("pass ftype ", ri(v)); break;
  case S_T2: local_f("Ct2", v, 0), cmdi("t2allow ", ri(v)); break;
  }
  dirty = 1;
}

/* Число с командой: показ — значение × k (dec знаков) и единица. */
static void r_cnum(const char *label, const char *sub, const char *tk, float mn, float mx, float st, float k, int dec, const char *unit, const char *c) {
  char s[192] = "";
  float v = V(tk);
  catn(s, v * k, dec);
  if (unit) cat(s, unit);
  row_t *r = r_num(0, label, sub, v, mn, mx, st, s);
  r->cmd = c, r->tk = tk;
}

static void set_row_ext(int id, float v);

static void build_set(void) {
  row_fn = set_row_ext;
  r_head("Турбины");
  r_cnum("Мощность Т1 (ручной режим)", 0, "Spw", 30, 100, 5, 1, 0, " %", "pw1 ");
  r_cnum("Мощность Т2 (ручной режим)", 0, "Sq2", 30, 100, 5, 1, 0, " %", "pw2 ");
  r_tog(S_T2, "Вторая помогает в «Авто»", "регулятор включит её, если одной мало", Vi("Ct2"));
  r_cnum("Плавный пуск", "до полной мощности", "Xss", 5, 100, 5, 0.1f, 1, " с", "set soft ");
  r_cnum("Вторая — после первой через", "бросок тока — по одной", "Xsg", 0, 5000, 100, 0.001f, 1, " с", "set stag ");
  r_head("Шланг и воздух");
  r_cnum("Диаметр шланга", "внутренний", "Xhm", 20, 60, 1, 1, 0, " мм", "pass hose ");
  r_cnum("Длина шланга", 0, "Xhl", 1, 30, 1, 1, 0, " м", "pass hosel ");
  r_cnum("Скорость в шланге не ниже", "иначе — «мало воздуха»", "Xms", 0, 30, 1, 1, 0, " м/с", "set minspeed ");
  r_tog(100, "Класс M", "тревога, если в шланге меньше 20 м/с", Vi("Xcm"));
  r_head("Фильтр и бак");
  r_choice(S_FTYPE, "Тип фильтра", 0, "Полиэстер|С мембраной PTFE|Бумажный|Нетканый", clampi(Vi("Xft"), 0, 3));
  r_cnum("«Пора мыть», когда R выросло в", "от нового фильтра", "Xwk", 120, 400, 10, 0.01f, 2, " раза", "set washk ");
  r_cnum("Объём бака", 0, "Xtk", 5, 200, 5, 1, 0, " л", "pass tank ");
  r_cnum("Порог электродов", "вода — сигнал меньше", "Cwl", 50, 1500, 10, 1, 0, " мВ", "set wl ");
  r_head("Ресурсы и напоминания");
  r_cnum("Щётки турбин", "приведённые часы", "Cbl", 100, 3000, 50, 1, 0, " ч", "set brushh ");
  r_cnum("Фильтр клапанов", "ударов", "Xil", 1000, 200000, 1000, 1, 0, "", "set intakelim ");
  r_cnum("Уплотнения и пружины тарелок", "проверить через ударов", "Xsl", 1000, 500000, 5000, 1, 0, "", "set seallim ");
  r_cnum("Осмотр фильтра", "через часов работы", "Xfl", 2, 500, 2, 1, 0, " ч", "set filtlim ");
  r_head("Экран и звук");
  r_tog(101, "Щелчок на касание", 0, Vi("Xck"));
  r_btn(S_VOICE, "Голосовые сообщения", IC_SPEAKER, K_ACC);
  r_btn(S_LCDCAL, "Калибровка касания", IC_HAND, K_ACC);
  r_head("Сброс");
  r_btn(S_PRESETRESET, "Режимы очистки — как с завода", IC_LOOP, K_WARN);
}

static void set_row_ext(int id, float v) {
  if (id == 100) local_f("Xcm", v, 0), cmdi("set classm ", ri(v));
  else if (id == 101) local_f("Xck", v, 0), cmdi("set clicks ", ri(v));
  else set_row(id, v);
}

/* ---------------- «Обслуживание» ---------------- */

enum { M_BR1 = 1, M_BR2, M_SEALS, M_INTAKE, M_FILTER };

static void maint_row(int id, float v) {
  (void)v;
  static const char *const C[] = {"", "maint brush1", "maint brush2", "maint seals", "intake new", "maint filter"};
  static const char *const T[] = {"", "Щётки Т1: отсчёт заново", "Щётки Т2: отсчёт заново", "Уплотнения проверены", "Фильтр клапанов новый", "Фильтр осмотрен"};
  if (id >= M_BR1 && id <= M_FILTER) cmd(C[id]), toast(T[id]);
  dirty = 1;
}

static void maint_bar(const char *label, float pct, const char *extra) {
  char s[192] = "";
  catn(s, pct, 0), cat(s, " %");
  if (extra) cat(cat(s, " · "), extra);
  r_bar(label, s, pct / 100.0f, pct >= 100 ? K_RED : pct >= 85 ? K_WARN : K_ACC);
}

static void build_maint(void) {
  char a[96], b[96];
  row_fn = maint_row;
  r_text("Полоса — сколько выработано до следующего обслуживания. Сделали — отметьте кнопкой, счёт пойдёт заново.");
  r_head("Турбины");
  a[0] = 0, catn(a, V("Mh1"), 0), cat(a, " ч");
  maint_bar("Щётки Т1", V("Mb1"), a);
  b[0] = 0, catn(b, V("Mh2"), 0), cat(b, " ч");
  maint_bar("Щётки Т2", V("Mb2"), b);
  r_btn(M_BR1, "Заменил щётки Т1", IC_CHECK, K_ACC);
  r_btn(M_BR2, "Заменил щётки Т2", IC_CHECK, K_ACC);
  r_head("Клапаны");
  maint_bar("Фильтр клапанов", V("Min"), 0);
  maint_bar("Уплотнения и пружины тарелок", V("Mse"), 0);
  r_btn(M_INTAKE, "Заменил фильтр клапанов", IC_CHECK, K_ACC);
  r_btn(M_SEALS, "Проверил уплотнения и пружины", IC_CHECK, K_ACC);
  r_head("Фильтр");
  a[0] = 0, catn(a, V("Mfh"), 1), cat(a, " ч");
  maint_bar("Осмотр фильтра", V("Mfl"), a);
  r_btn(M_FILTER, "Осмотрел фильтр", IC_CHECK, K_ACC);
  r_head("Наработка");
  a[0] = 0, catn(a, V("Jh1"), 1), cat(a, " ч · приведённых "), catn(a, V("Jw1"), 1);
  r_info("Турбина 1", a, K_ACC);
  b[0] = 0, catn(b, V("Jh2"), 1), cat(b, " ч · приведённых "), catn(b, V("Jw2"), 1);
  r_info("Турбина 2", b, K_ACC);
  a[0] = 0, catk(a, (long)pint(Vs("Fpc")));
  r_info("Ударов клапанов всего", a, K_ACC);
}

/* ---------------- «Отчёт смены» ---------------- */

static void report_row(int id, float v) {
  (void)v;
  if (id == 1) cmd("report reset"), toast("Новая смена");
  dirty = 1;
}

static void hours_str(char *s, float h) {
  s[0] = 0;
  int hh = (int)h, mm = (int)((h - (float)hh) * 60 + 0.5f);
  if (hh) catn(s, (float)hh, 0), cat(s, " ч ");
  catn(s, (float)mm, 0), cat(s, " мин");
}

static void build_report(void) {
  char s[192];
  row_fn = report_row;
  const char *t0 = Vs("Rt0");
  s[0] = 0;
  for (int i = 0; t0[i] && i < 40; i++) {
    char c[2] = {t0[i] == '_' ? ' ' : t0[i], 0};
    cat(s, c);
  }
  r_info("Смена с", s[0] ? s : "—", K_ACC);
  hours_str(s, V("Ron")), r_info("Включён", s, K_ACC);
  hours_str(s, V("Rrun")), r_info("Турбины работали", s, K_ACC);
  hours_str(s, V("Rtool")), r_info("Инструмент работал", s, K_ACC);
  s[0] = 0, catn(s, V("Rser"), 0), cat(s, " · ударов "), catn(s, V("Rpul"), 0);
  r_info("Серий очистки", s, K_ACC);
  s[0] = 0, catn(s, V("Rkwh"), 2), cat(s, " кВт·ч");
  r_info("Электроэнергия турбин", s, K_ACC);
  s[0] = 0;
  if (V("Rkg") >= 0 && Vh("Rkg")) catn(s, V("Rkg"), 1), cat(s, " кг");
  else cat(s, "нет весов");
  r_info("Собрано в бак", s, K_ACC);
  s[0] = 0, catn(s, V("Rflow"), 1), cat(s, " л/с");
  r_info("Средний расход", s, K_ACC);
  s[0] = 0, catn(s, V("Rtmax"), 0), cat(s, " °C");
  r_info("Нагрев турбин, наибольший", s, V("Rtmax") > 85 ? K_WARN : K_ACC);
  s[0] = 0, catn(s, (float)nal, 0);
  r_info("Аварий и предупреждений", s, nal ? K_WARN : K_ACC);
  r_btn(1, "Начать новую смену", IC_REPORT, K_ACC);
}

/* ---------------- «Журнал» ---------------- */

static void log_row(int id, float v) {
  (void)v;
  if (id == 1) cmd("ack"), ack_mask = faults(), toast("Аварии сброшены");
  dirty = 1;
}

static void build_log(void) {
  char s[192], hm[8], dm[8];
  row_fn = log_row;
  if (fault_count()) r_btn(1, "Сбросить аварии", IC_CHECK, K_WARN);
  r_head("Сейчас");
  int any = 0;
  for (int i = 0; i < NF; i++) {
    int b = FAULT_ORDER[i];
    if (!(faults() & (1UL << b))) continue;
    row_t *r = row_new(R_INFO, -1, FAULT[b].text, 0);
    cat(r->val, (F_URGENT & (1UL << b)) ? "авария" : "внимание");
    r->col = (F_URGENT & (1UL << b)) ? K_RED : K_WARN;
    if (fault_hint(b)[0]) r_text(fault_hint(b));
    any = 1;
  }
  if (!any) r_text("Всё в порядке.");
  r_head("История (с включения экрана)");
  for (int i = nal - 1; i >= 0; i--) {
    s[0] = 0;
    if (AL[i].t) clock_str(AL[i].t, hm, dm), cat(cat(cat(s, dm), " "), hm);
    else catn(s, (float)((now - AL[i].on) / 60000), 0), cat(s, " мин назад");
    cat(s, AL[i].off ? " · снята" : " · идёт");
    row_t *r = row_new(R_INFO, -1, FAULT[AL[i].bit].text, 0);
    cat(r->val, s);
    r->col = AL[i].off ? K_DIM : K_WARN;
  }
  if (!nal) r_text("Пусто.");
  r_text("«Чёрный ящик» контроллера пишет состояние каждую минуту и все события на флеш-память (годы работы). Скачать: телефон по Wi-Fi → /bb.csv.");
}

/* ---------------- «Голос» ---------------- */

static void voice_row(int id, float v) {
  int x = ri(v);
  if (id == 1) local_f("Xvo", (float)x, 0), cmdi("voice ", x);
  else if (id == 2) local_f("Xvv", (float)x, 0), cmdi("voice vol ", x);
  else if (id == 3) cmd("voice test 36"), toast("Должно прозвучать «Пылесос готов к работе»");
  else if (id == 4) cmd("voice test 1"), toast("«Бак полон»");
  dirty = 1;
}

static void build_voice(void) {
  char s[192];
  row_fn = voice_row;
  r_seg(1, "Голос", "что говорить", "Выкл|Тревоги|+ внимание|Всё", clampi(Vi("Xvo"), 0, 3));
  s[0] = 0, catn(s, V("Xvv"), 0);
  r_num(2, "Громкость", "0…30", V("Xvv"), 0, 30, 1, s);
  r_btn(3, "Проверить голос", IC_PLAY, K_ACC);
  r_btn(4, "Проверить тревогу", IC_BELL, K_ACC);
  r_text("Плеер DFPlayer Mini с динамиком 3 Вт — на линии 5 кабеля пульта (IO13, 9600 бод). Фразы — файлы /mp3/0001.mp3… на карте microSD (папка voice в архиве). Одно и то же сообщение — не чаще раза в 30 с, тревоги — первыми.");
}

/* ---------------- «Весы» ---------------- */

static float cal_kg = 10;

static void scale_row(int id, float v) {
  char s[192] = "";
  if (id == 1) cmd("scale tare"), toast("Ноль: пустой бак");
  else if (id == 2) cal_kg = v;
  else if (id == 3) cmd(catn(cat(s, "scale cal "), cal_kg, 1)), toast("Калибровка записана");
  else if (id == 4) local_f("Xsf", v, 1), cmd(catn(cat(s, "scale full "), v, 1));
  else if (id == 5) local_f("Xsb", v, 1), cmd(catn(cat(s, "scale bag "), v, 1));
  dirty = 1;
}

static void build_scale(void) {
  char s[192];
  row_fn = scale_row;
  r_btn(1, "Ноль — бак пустой", IC_SCALE, K_ACC);
  s[0] = 0, catn(s, cal_kg, 1), cat(s, " кг");
  r_num(2, "Груз для калибровки", "известной массы, в бак", cal_kg, 0.5f, 50, 0.5f, s);
  r_btn(3, "Калибровать этим грузом", IC_CHECK, K_ACC);
  r_head("Предупреждать");
  s[0] = 0, catn(s, V("Xsf"), 1), cat(s, " кг");
  r_num(4, "Бак тяжёлый с", "пора опорожнить", V("Xsf"), 1, 100, 0.5f, s);
  s[0] = 0, catn(s, V("Xsb"), 1), cat(s, " кг");
  r_num(5, "Мешок полон с", "если мешок стоит", V("Xsb"), 1, 60, 0.5f, s);
  r_text("Тензодатчик — под колесом бака (между баком и колесом), модуль NAU7802 — на шине I²C контроллера (адрес 0x2A). Порядок: пустой бак → «Ноль», груз известной массы → «Калибровать».");
}

static void scr_scale(void) {
  char s[192] = "";
  card(6, CY0, 468, 70, K_CARD);
  icon(&F_I44, 20, CY0 + 13, IC_SCALE, K_ACC);
  if (!Vi("Xsk")) txt(&F_D17, 76, CY0 + 44, "Весы не найдены (NAU7802)", K_WARN, 0);
  else if (!Vi("Xsc")) txt(&F_D17, 76, CY0 + 44, "Нужна калибровка", K_WARN, 0);
  else {
    catn(s, V("Fkg"), 1);
    txt(&F_B44, 76, CY0 + 54, s, K_TEXT, 0);
    txt(&F_D17, 84 + g_text_w(&F_B44, s, 0), CY0 + 54, "кг в баке", K_SUB, 0);
  }
  build_scale();
  draw_list(6, CY0 + 76, 462, CY1 - CY0 - 76);
}

/* ---------------- «Часы» ---------------- */

static int ck[5]; /* год, месяц, день, час, минута */

static void clock_load(void) {
  uint32_t t = (uint32_t)pint(Vs("Ftm"));
  if (!t) t = 846374400u; /* 2026-10-27 — что-то разумное */
  uint32_t days = t / 86400u, r = t % 86400u;
  ck[3] = (int)(r / 3600), ck[4] = (int)(r % 3600 / 60);
  int y = 2000;
  static const uint8_t MD[12] = {31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};
  for (;;) {
    uint32_t n = (y % 4 == 0 && (y % 100 || y % 400 == 0)) ? 366 : 365;
    if (days < n) break;
    days -= n, y++;
  }
  int m = 0;
  for (;;) {
    uint32_t n = MD[m] + (m == 1 && y % 4 == 0);
    if (days < n || m == 11) break;
    days -= n, m++;
  }
  ck[0] = y, ck[1] = m + 1, ck[2] = (int)days + 1;
}

static void clock_row(int id, float v) {
  if (id >= 1 && id <= 5) ck[id - 1] = ri(v);
  else if (id == 6) {
    char s[192] = "time ";
    catn(s, (float)ck[0], 0), cat(s, "-"), catn(s, (float)ck[1], 0), cat(s, "-"), catn(s, (float)ck[2], 0);
    cat(s, " "), catn(s, (float)ck[3], 0), cat(s, ":"), catn(s, (float)ck[4], 0);
    cmd(s);
    toast("Часы установлены");
  }
  dirty = 1;
}

static void build_clock(void) {
  char s[192];
  row_fn = clock_row;
  static const char *const L[5] = {"Год", "Месяц", "День", "Час", "Минута"};
  static const int MN[5] = {2024, 1, 1, 0, 0}, MX[5] = {2099, 12, 31, 23, 59};
  for (int i = 0; i < 5; i++) {
    s[0] = 0;
    if (i && ck[i] < 10) cat(s, "0");
    catn(s, (float)ck[i], 0);
    r_num(i + 1, L[i], 0, (float)ck[i], (float)MN[i], (float)MX[i], 1, s);
  }
  r_btn(6, "Установить", IC_CHECK, K_ACC);
  r_text(Vi("Xrtc") ? "Модуль часов DS3231 на шине I²C (0x68): время идёт и без питания." : "Модуля часов нет: время будет идти до выключения. Поставьте DS3231 на шину I²C (адрес 0x68).");
}

/* ---------------- «Связь» ---------------- */

static void link_row(int id, float v) {
  if (id == 1) local_f("Fwf", v, 0), cmd(ri(v) ? "wifi on" : "wifi off");
  else if (id == 2) cmd("ble pair"), toast("Привязка 60 с: нажмите кнопку на пульте или метке");
  else if (id >= 10 && id < 14) cmdi("ble forget ", id - 10), toast("Устройство забыто");
  dirty = 1;
}

static void build_link(void) {
  char s[192];
  row_fn = link_row;
  r_tog(1, "Wi-Fi для телефона", "приложение «Пылесос S3», обновление, копия настроек", Vi("Fwf"));
  if (Vi("Fwf") && wifi_ssid[0]) {
    r_info("Сеть", wifi_ssid, K_ACC);
    r_info("Пароль", wifi_pass, K_ACC);
    r_info("Адрес", "192.168.4.1", K_ACC);
  }
  s[0] = 0, catn(s, V("Cbk"), 0);
  r_info("Код Bluetooth для телефона", Vi("Cbk") ? s : "—", K_ACC);
  r_btn(2, Vi("Sbp") ? "Привязка идёт…" : "Привязать пульт или метку", IC_BT, K_ACC);
  for (int i = 0; i < 4; i++) {
    char k[4] = {'C', 'D', (char)('0' + i), 0};
    int kind = ri(VL(k, 0));
    if (!kind) continue;
    s[0] = 0;
    cat(s, kind == 1 ? "Пульт" : "Метка на инструмент");
    catn(cat(s, " №"), VL(k, 1), 0);
    row_t *r = row_new(R_BTN, 10 + i, "", 0);
    cat(r->sub, "Забыть: "), cat(r->sub, s);
    r->label = r->sub, r->ic = IC_CROSS, r->col = K_WARN;
  }
}

static void scr_link(void) {
  build_link();
  int qr_on = Vi("Fwf") && qr_ok;
  draw_list(6, CY0, qr_on ? 290 : 462, CY1 - CY0);
  if (qr_on) {
    int size = qr.size, px = 160 / (size + 2);
    int w = px * (size + 2), x0 = 306 + (168 - w) / 2, y0 = CY0 + 10;
    g_rrect((float)x0 - 4, (float)y0 - 4, (float)w + 8, (float)w + 8, 8, 0xFFFF);
    for (int y = 0; y < size; y++)
      for (int x = 0; x < size; x++)
        if (qr.m[y][x]) g_fill(x0 + (x + 1) * px, y0 + (y + 1) * px, px, px, 0);
    txt(&F_N12, 306 + 84, y0 + w + 22, "камерой телефона —", K_DIM, 1);
    txt(&F_N12, 306 + 84, y0 + w + 38, "подключиться к сети", K_DIM, 1);
  }
}

/* ---------------- «Розетка» ---------------- */

static void tool_row(int id, float v) {
  int x = ri(v);
  if (id == 1) local_f("Cta", (float)x, 0), cmdi("tool auto ", x);
  else if (id == 2) local_f("Ctf", (float)x, 0), cmdi("tool free ", x);
  else if (id == 3) cmd("sock on"), toast("Розетка включена");
  else if (id == 4) cmd("sock off"), toast("Розетка выключена");
  dirty = 1;
}

static void build_tool(void) {
  char s[192];
  row_fn = tool_row;
  s[0] = 0;
  cat(s, Vi("Sso") ? "включена" : "выключена");
  if (Vi("Stl")) cat(s, " · работает "), catn(s, V("Sta"), 1), cat(s, " А");
  r_info("Розетка", s, Vi("Stl") ? K_GREEN : K_ACC);
  r_btn(Vi("Sso") ? 4 : 3, Vi("Sso") ? "Выключить розетку" : "Включить розетку", IC_PLUG, K_ACC);
  r_tog(1, "Автозапуск от инструмента", "пылесос включается вместе с инструментом", Vi("Cta"));
  r_cnum("Порог тока инструмента", 0, "Ctt", 1, 50, 1, 0.1f, 1, " А", "tool thr ");
  r_cnum("Турбины — через", "после пуска инструмента", "Ctd", 0, 3000, 100, 0.001f, 1, " с", "tool delay ");
  r_cnum("Выбег после инструмента", 0, "Ctr", 0, 30, 1, 1, 0, " с", "tool runon ");
  r_cnum("Ударов после инструмента", 0, "Cte", 0, 10, 1, 1, 0, "", "tool end ");
  r_cnum("Предел общего тока", "розетка + турбины", "Ctm", 10, 32, 1, 1, 0, " А", "tool limit ");
  r_tog(2, "Розетка и без пылесоса", "инструмент работает, турбины стоят", Vi("Ctf"));
}

/* ---------------- «Паспорт» ---------------- */

static void about_row(int id, float v) {
  (void)v;
  if (id == 1) back_to = SC_MENU, go(SC_WIZ);
  dirty = 1;
}

static const char *ok3(int v) { return v == 1 ? "исправен" : v == 2 ? "неисправен" : "не проверяли"; }

static void build_about(void) {
  char s[192];
  row_fn = about_row;
  const char *dt = Vs("Gdt");
  s[0] = 0;
  if (Vi("Gdone")) {
    cat(s, "пройден ");
    for (int i = 0; dt[i] && i < 10; i++) {
      char c[2] = {dt[i], 0};
      cat(s, c);
    }
  } else
    cat(s, "не пройден");
  r_info("Первый пуск", s, Vi("Gdone") ? K_GREEN : K_WARN);
  for (int k = 0; k < 2; k++) {
    char key[4] = {'G', 'w', (char)('1' + k), 0};
    r_head(k ? "Турбина 2" : "Турбина 1");
    s[0] = 0;
    catn(s, V(key), 0), cat(s, " Вт · ");
    key[1] = 'q', catn(s, V(key), 1), cat(s, " л/с");
    r_info("Открытый шланг", s, K_ACC);
    s[0] = 0;
    key[1] = 'v', catn(s, V(key), 1), cat(s, " кПа");
    r_info("Шланг закрыт: разрежение", s, K_ACC);
    s[0] = 0;
    key[1] = 'r', catn(s, V(key), 0), cat(s, " Вт");
    r_info("Мощность на полной (замер)", s, K_ACC);
    key[1] = 'k';
    r_info(k ? "Клапан 2" : "Клапан 1", ok3(Vi(key)), Vi(key) == 2 ? K_RED : K_ACC);
  }
  r_head("Остальное");
  r_info("Магниты держат при закрытом шланге", ok3(Vi("Gho")), Vi("Gho") == 2 ? K_RED : K_ACC);
  s[0] = 0, catn(s, V("Grn"), 1);
  r_info("Новый фильтр: R", V("Grn") > 0 ? s : "—", K_ACC);
  s[0] = 0, catn(s, V("Gzo"), 1), cat(s, " кПа");
  r_info("Поправка нуля разрежения", s, K_ACC);
  r_info("Интерфейс экрана", PANEL_VERSION, K_DIM);
  r_btn(1, "Пройти первый пуск", IC_FLAG, K_ACC);
}

/* ---------------- мастер «Первый пуск» ---------------- */

/* Шаги: 0 — вступление, 1 — шланг и бак, 2 — датчики, 3–4 — турбины, 5–6 — клапаны, 7 — магниты,
 * 8 — новый фильтр, 9 — готово. */
enum { W_INTRO, W_PASS, W_ZERO, W_T1, W_T2, W_V1, W_V2, W_HOLD, W_FILT, W_DONE, W_N };
static int wiz;
static const char *const W_TITLE[W_N] = {"Первый пуск", "Шланг, бак, фильтр", "Датчики", "Турбина 1", "Турбина 2", "Клапан 1", "Клапан 2", "Магниты тарелок", "Новый фильтр", "Готово"};
static const char *const W_TEST[W_N] = {0, 0, "test zero", "test t1", "test t2", "test v1", "test v2", "test hold", "test filter", 0};
static const int W_TID[W_N] = {0, 0, 1, 2, 3, 4, 5, 6, 7, 0};
static const char *const W_TEXT[W_N] = {
    "Пылесос проверит датчики, каждую турбину, оба клапана и магниты, запомнит новый фильтр — это паспорт: с ним видно, когда что-то стало хуже. Займёт 3–4 минуты. Нужен открытый шланг без насадки и ладонь, чтобы закрыть его по просьбе.",
    "",
    "Турбины стоят. Пылесос запомнит «ноль» датчиков разрежения, перепада и расхода и проверит часы, весы, кнопки и синхронизацию с сетью.",
    "Шланг открыт, без насадки. Турбина 1 — на полной 8 с: мощность и расход. Потом закройте шланг ладонью — предельное разрежение.",
    "То же для турбины 2: шланг открыт, потом — закрыть ладонью, когда попросит.",
    "Шланг открыт. Обе турбины 4 с, потом удар только клапаном 1: перепад на фильтре должен провалиться.",
    "То же для клапана 2.",
    "Турбины на полной, шланг закройте ладонью на 6 с: магниты должны удержать тарелки при самом сильном разрежении.",
    "Поставьте новый (или чистый) фильтр, шланг открыт. Замер сопротивления — около 20 с: это «эталон» для процентов и прогноза мойки.",
    "Паспорт готов. Его можно посмотреть в «Меню → Паспорт», мастер — пройти снова в любой момент.",
};

static void wiz_row(int id, float v) {
  if (id == 1) local_f("Xhm", v, 0), cmdi("pass hose ", ri(v));
  else if (id == 2) local_f("Xhl", v, 0), cmdi("pass hosel ", ri(v));
  else if (id == 3) local_f("Xtk", v, 0), cmdi("pass tank ", ri(v));
  else if (id == 4) local_f("Xft", v, 0), cmdi("pass ftype ", ri(v));
  else if (id == 5) back_to = SC_WIZ, clock_load(), go(SC_CLOCK);
  dirty = 1;
}

static int wiz_test_here(void) { return W_TID[wiz] && Vi("Tid") == W_TID[wiz] && Vi("Sts") == W_TID[wiz]; }

static void wiz_go(int step) {
  if (W_TID[wiz]) cmd("test stop");
  wiz = clampi(step, 0, W_N - 1);
  scroll[SC_WIZ] = 0;
  kv_set("Tph", "0", 0), kv_set("Tid", "0", 0);
  dirty = 1;
}

/* Результат проверки — строками. */
static void wiz_result(char *out) {
  out[0] = 0;
  float v0 = V("Tv0"), v1 = V("Tv1"), v2 = V("Tv2"), v3 = V("Tv3");
  switch (wiz) {
  case W_ZERO: {
    int b = ri(v3);
    static const char *const N[8] = {"разрежение", "перепад", "расход", "часы", "весы", "кнопки", "сеть", "термисторы"};
    for (int i = 0; i < 8; i++) cat(cat(cat(out, b >> i & 1 ? "✓ " : "× "), N[i]), i == 3 ? "\n" : "   ");
    catn(cat(out, "\nноль разрежения "), v0, 1), cat(out, " кПа");
    break;
  }
  case W_T1:
  case W_T2:
    catn(out, v1, 0), cat(out, " Вт, "), catn(out, v0, 1), cat(out, " л/с на открытом шланге");
    if (v2 > 0) catn(cat(out, "\nшланг закрыт: "), v2, 1), cat(out, " кПа, "), catn(out, v3, 0), cat(out, " Вт");
    break;
  case W_V1:
  case W_V2: catn(cat(out, "провал разрежения "), v0, 0), cat(out, " %, обратный перепад "), catn(out, v1, 0), cat(out, " Па"); break;
  case W_HOLD: catn(cat(out, "разрежение до "), v0, 1), cat(out, " кПа, срывов тарелок: "), catn(out, v1, 0); break;
  case W_FILT: catn(cat(out, "сопротивление нового фильтра R = "), v0, 1); break;
  }
}

static void scr_wiz(void) {
  char s[200];
  /* Шаги — точками сверху. */
  for (int i = 0; i < W_N; i++) g_circle(240 - (W_N - 1) * 9 + i * 18, CY0 + 8, i == wiz ? 5 : 3.5f, i < wiz ? K_ACC : i == wiz ? K_TEXT : K_FAINT);
  txt(&F_D20, 240, CY0 + 40, W_TITLE[wiz], K_TEXT, 1);
  int y = CY0 + 52;
  if (wiz == W_PASS) {
    row_fn = wiz_row;
    char v[16];
    v[0] = 0, catn(v, V("Xhm"), 0), cat(v, " мм");
    r_num(1, "Диаметр шланга", "внутренний: скорость воздуха считается по нему", V("Xhm"), 20, 60, 1, v);
    v[0] = 0, catn(v, V("Xhl"), 0), cat(v, " м");
    r_num(2, "Длина шланга", 0, V("Xhl"), 1, 30, 1, v);
    v[0] = 0, catn(v, V("Xtk"), 0), cat(v, " л");
    r_num(3, "Объём бака", 0, V("Xtk"), 5, 200, 5, v);
    r_choice(4, "Фильтр", 0, "Полиэстер|С мембраной PTFE|Бумажный|Нетканый", clampi(Vi("Xft"), 0, 3));
    r_btn(5, "Часы…", IC_CLOCK, K_ACC);
    draw_list(6, y, 462, CY1 - y - 52);
  } else {
    int lines = wrap(&F_N14, 20, y + 14, 440, 19, W_TEXT[wiz], K_SUB, 4, 1);
    y += lines * 19 + 10;
    if (W_TID[wiz]) {
      int here = wiz_test_here(), ph = here ? Vi("Tph") : 0;
      int cy = y + 52;
      if (ph == 1 || ph == 2) {
        g_ring(240, (float)cy, 34, 6, K_FAINT);
        static float spin;
        spin += 0.04f;
        g_arc2(240, (float)cy, 34, 6, spin, 0.25f, ph == 2 ? K_WARN : K_ACC);
        s[0] = 0, catn(s, V("Tleft"), 0);
        txt(&F_D24, 240, cy + 9, s, K_TEXT, 1);
        if (ph == 2) {
          icon(&F_I32, 120, cy - 16, IC_HAND, K_WARN);
          txt(&F_D17, 290, cy + 6, "Закройте шланг ладонью", K_WARN, 0);
        }
      } else if (ph == 3 || ph == 4) {
        g_circle(240 - 150, (float)cy, 22, ph == 3 ? K_GREEN_D : K_RED_D);
        icon_c(&F_I24, 240 - 150, cy, ph == 3 ? IC_CHECK : IC_CROSS, ph == 3 ? K_GREEN : K_RED);
        txt(&F_D17, 240 - 118, cy - 8, ph == 3 ? "Исправно" : "Не прошло", ph == 3 ? K_GREEN : K_RED, 0);
        wiz_result(s);
        wrap(&F_N14, 240 - 118, cy + 14, 330, 18, s, K_TEXT, 4, 0);
      } else
        button(160, cy - 26, 160, 50, "Проверить", IC_PLAY, 1, ZT_BTN, B_WIZ, 10);
    }
  }
  /* Внизу: назад, пропустить / далее. */
  int ph = wiz_test_here() ? Vi("Tph") : 0;
  if (wiz > 0) button(6, CY1 - 46, 120, 46, "Назад", IC_BACK, 0, ZT_BTN, B_WIZ, 1);
  if (ph == 1 || ph == 2) button(354, CY1 - 46, 120, 46, "Стоп", IC_STOP, 3, ZT_BTN, B_WIZ, 3);
  else if (ph == 4) {
    button(204, CY1 - 46, 140, 46, "Ещё раз", IC_LOOP, 0, ZT_BTN, B_WIZ, 10);
    button(354, CY1 - 46, 120, 46, "Дальше", IC_CHEV, 0, ZT_BTN, B_WIZ, 2);
  } else if (wiz == W_DONE)
    button(304, CY1 - 46, 170, 46, "Сохранить", IC_CHECK, 1, ZT_BTN, B_WIZ, 4);
  else
    button(334, CY1 - 46, 140, 46, W_TID[wiz] && ph != 3 ? "Пропустить" : "Дальше", IC_CHEV, W_TID[wiz] && ph != 3 ? 4 : 1, ZT_BTN, B_WIZ, 2);
}

static void wiz_act(int b) {
  if (b == 1) wiz_go(wiz - 1);
  else if (b == 2) wiz_go(wiz + 1);
  else if (b == 3) cmd("test stop"), kv_set("Tph", "0", 1);
  else if (b == 4) cmd("pass done"), wiz_go(0), toast("Паспорт сохранён"), go(SC_MENU);
  else if (b == 10 && W_TEST[wiz]) {
    if (wiz == W_ZERO && Vi("Sru")) {
      toast("Сначала остановите турбины");
      return;
    }
    cmd(W_TEST[wiz]);
    char n[4] = {(char)('0' + W_TID[wiz]), 0};
    kv_set("Tid", n, 1), kv_set("Sts", n, 1), kv_set("Tph", "1", 1);
  }
  dirty = 1;
}

/* ---------------- мастер «Обслуживание фильтра» ---------------- */

static int svc_step, svc_mask, svc_meas;
static const char *const SV_LONG[6] = {"Обстучал ладонью", "Продул воздухом", "Пропылесосил", "Промыл водой", "Почистил щёткой", "Другое"};
static const char *const SV_IC[6] = {IC_HAND, IC_FAN, IC_CLEAN, IC_DROP, IC_BRUSH, IC_EDIT};

static void svc_start(void) { svc_step = 0, svc_mask = 0, svc_meas = 0; }

static void scr_svc(void) {
  char s[192];
  int y = CY0 + 6;
  for (int i = 0; i < 4; i++) g_circle(240 - 27 + i * 18, (float)y + 2, i == svc_step ? 5 : 3.5f, i < svc_step ? K_ACC : i == svc_step ? K_TEXT : K_FAINT);
  y += 20;
  if (svc_step == 0) {
    icon_c(&F_I44, 240, y + 30, IC_WARN, K_WARN);
    txt(&F_D20, 240, y + 82, "Остановите пылесос", K_TEXT, 1);
    wrap(&F_N14, 40, y + 108, 400, 19, "Наденьте респиратор FFP2 или FFP3 и очки. Снимите фильтр. Обстукивайте и продувайте на улице, против ветра.", K_SUB, 3, 1);
    button(150, CY1 - 50, 180, 50, "Начать", IC_PLAY, 1, ZT_BTN, B_SVC, 1);
  } else if (svc_step == 1) {
    txt(&F_D20, 240, y + 20, "Что с фильтром?", K_TEXT, 1);
    button(30, y + 44, 200, 120, "Новый", IC_PLUS, 0, ZT_BTN, B_SVC, 2);
    button(250, y + 44, 200, 120, "Обслужил", IC_WRENCH, 0, ZT_BTN, B_SVC, 3);
    txt(&F_N12, 130, y + 186, "поставил новый фильтр", K_DIM, 1);
    txt(&F_N12, 350, y + 186, "этот же — после чистки", K_DIM, 1);
  } else if (svc_step == 2) {
    txt(&F_D20, 240, y + 20, "Что сделали? (можно несколько)", K_TEXT, 1);
    for (int i = 0; i < 6; i++) {
      int c = i % 3, r = i / 3, x = 6 + c * 158, yy = y + 36 + r * 74;
      int on = svc_mask >> i & 1, p = is_p(ZT_BTN, B_SVC, 20 + i);
      g_rrect((float)x, (float)yy, 152, 66, 12, on ? K_ACC_D : p ? K_PRESS : K_CARD);
      if (on) g_rrect_line((float)x, (float)yy, 152, 66, 12, 2, K_ACC);
      icon(&F_I24, x + 10, yy + 10, SV_IC[i], on ? K_ACC : K_SUB);
      if (on) icon(&F_I18, x + 124, yy + 8, IC_CHECK, K_ACC);
      txt(&F_D15, x + 12, yy + 56, SV_LONG[i], on ? K_TEXT : K_SUB, 0);
      zone(x, yy, 152, 66, ZT_BTN, B_SVC, 20 + i);
    }
    button(6, CY1 - 46, 120, 46, "Назад", IC_BACK, 0, ZT_BTN, B_SVC, 9);
    button(334, CY1 - 46, 140, 46, "Дальше", IC_CHEV, svc_mask ? 1 : 4, ZT_BTN, B_SVC, 4);
  } else {
    int fm = Vi("Ffm");
    if (!svc_meas) {
      txt(&F_D20, 240, y + 24, "Поставьте фильтр на место", K_TEXT, 1);
      wrap(&F_N14, 40, y + 52, 400, 19, "Закройте крышку, шланг — открыт, без насадки. Турбины включатся сами: замер сопротивления около 20 с.", K_SUB, 3, 1);
      button(6, CY1 - 46, 120, 46, "Назад", IC_BACK, 0, ZT_BTN, B_SVC, 9);
      button(304, CY1 - 50, 170, 50, "Замерить", IC_PLAY, 1, ZT_BTN, B_SVC, 5);
    } else if (fm == 1 || (fm == 0 && now - (uint32_t)svc_meas < 3000)) {
      g_ring(240, (float)y + 70, 40, 7, K_FAINT);
      static float spin;
      spin += 0.04f;
      g_arc2(240, (float)y + 70, 40, 7, spin, 0.25f, K_ACC);
      s[0] = 0, catn(s, V("Ffx"), 0);
      txt(&F_D24, 240, y + 79, s, K_TEXT, 1);
      txt(&F_N14, 240, y + 140, "замер: шланг открыт, ничего не трогайте", K_SUB, 1);
    } else {
      float r = V("Ffq"), pct = V("Ffp");
      g_circle(80, (float)y + 50, 26, K_GREEN_D);
      icon_c(&F_I32, 80, y + 50, IC_CHECK, K_GREEN);
      txt(&F_D20, 120, y + 44, "Записано", K_GREEN, 0);
      svc_what(s, svc_mask);
      txt(&F_N14, 120, y + 66, s, K_SUB, 0);
      s[0] = 0;
      cat(s, "R = "), catn(s, r, 1);
      if (pct > 0) cat(s, " · "), catn(s, pct > 100 ? 100 : pct, 0), cat(s, " % от нового");
      txt(&F_B30, 40, y + 130, s, K_TEXT, 0);
      /* Что дало обслуживание — последняя запись истории. */
      for (int i = 11; i >= 0; i--) {
        char k[6] = {'Q', 'e', (char)('0' + i / 10), (char)('0' + i % 10), 0, 0};
        if (!Vs(k)[0]) continue;
        float rb = VL(k, 3), ra = VL(k, 4);
        if (rb > 0 && !(svc_mask & 128)) {
          s[0] = 0;
          cat(s, "было "), catn(s, rb, 1), cat(s, " → стало "), catn(s, ra, 1);
          if (ra < rb) cat(s, " (−"), catn(s, (rb - ra) / rb * 100, 0), cat(s, " %)");
          txt(&F_D15, 40, y + 160, s, ra < rb ? K_GREEN : K_WARN, 0);
        }
        break;
      }
      button(304, CY1 - 50, 170, 50, "Готово", IC_CHECK, 1, ZT_BTN, B_SVC, 6);
    }
  }
}

static void svc_act(int b) {
  if (b == 1) cmd("fsvc begin"), svc_step = 1;
  else if (b == 2) svc_mask = 128, svc_step = 3;
  else if (b == 3) svc_mask = 0, svc_step = 2;
  else if (b >= 20 && b < 26) svc_mask ^= 1 << (b - 20);
  else if (b == 4 && svc_mask) svc_step = 3;
  else if (b == 4) toast("Отметьте, что сделали");
  else if (b == 9) svc_step = svc_step == 3 && svc_mask != 128 ? 2 : 1;
  else if (b == 5) {
    if (svc_mask & 128) cmd("fsvc new");
    else cmdi("fsvc ", svc_mask);
    svc_meas = (int)(now ? now : 1);
    kv_set("Ffm", "1", 1);
  } else if (b == 6)
    svc_start(), go(SC_FILTER);
  dirty = 1;
}

/* ---------------- живая схема ---------------- */

static float flow_phase;

/* Точки потока по отрезку. */
static void flow_dots(float x0, float y0, float x1, float y1, float speed, uint16_t c) {
  float dx = x1 - x0, dy = y1 - y0, len = g_sqrt(dx * dx + dy * dy);
  if (len < 1 || speed <= 0) return;
  float step = 18, off = flow_phase * speed;
  off -= (float)(int)(off / step) * step;
  for (float t = off; t < len; t += step) g_circle(x0 + dx * t / len, y0 + dy * t / len, 2.2f, c);
}

static void scr_scheme(void) {
  char s[192];
  float q = V("Sf");
  int ru = Vi("Sru"), vl = Vi("Svl"), hd = Vi("Shd");
  float sp = q / 20.0f;
  /* Сеть и розетка — слева сверху. */
  s[0] = 0, catn(s, V("Smv"), 0), cat(s, " В · всего "), catn(s, V("Sia"), 1), cat(s, " А");
  icon(&F_I18, 8, CY0 + 2, IC_BOLT, K_WARN);
  txt(&F_D13, 30, CY0 + 16, s, K_TEXT, 0);
  s[0] = 0;
  cat(s, Vi("Sso") ? "розетка вкл" : "розетка выкл");
  if (Vi("Stl")) cat(s, " · "), catn(s, V("Sta"), 1), cat(s, " А");
  icon(&F_I18, 8, CY0 + 26, IC_PLUG, Vi("Stl") ? K_GREEN : K_DIM);
  txt(&F_N12, 30, CY0 + 40, s, K_SUB, 0);
  /* Шланг → бак. */
  g_line(12, 206, 84, 206, 12, K_FAINT);
  flow_dots(12, 206, 84, 206, sp, K_ACC);
  icon(&F_I24, 12, 170, IC_HOSE, K_SUB);
  s[0] = 0, catn(s, V("Sv"), 0), cat(s, " м/с");
  txt(&F_N12, 12, 230, s, K_DIM, 0);
  /* Бак: вода по электродам, вес снизу. */
  g_rrect(84, 110, 92, 140, 10, K_CARD2);
  int wl = Vi("Swl");
  if (wl) g_rrect(88, wl == 2 ? 122 : 196, 84, wl == 2 ? 124 : 50, 7, HEX(0x153a5c));
  txt(&F_D13, 130, 132, "бак", K_SUB, 1);
  if (Vi("Xsk") && Vi("Xsc")) {
    s[0] = 0, catn(s, V("Fkg"), 1), cat(s, " кг");
    icon(&F_I18, 92, 224, IC_SCALE, K_SUB);
    txt(&F_D13, 114, 238, s, K_TEXT, 0);
  }
  if (Vi("Sfs")) txt(&F_N12, 130, 150, "поплавок!", K_WARN, 1);
  /* Бак → фильтр. */
  g_line(176, 140, 204, 140, 10, K_FAINT);
  flow_dots(176, 140, 204, 140, sp, K_ACC);
  /* Коробка фильтра, клапаны сверху. */
  g_rrect(204, 92, 102, 156, 10, K_CARD2);
  uint16_t fc = filter_warn() ? K_WARN : K_SUB;
  for (int i = 0; i < 7; i++) g_line(216 + i * 13, 120, 222 + i * 13, 204, 2, fc);
  if (hd) txt(&F_N12, 255, 112, "магниты держат", K_T1, 1);
  s[0] = 0, catn(s, V("Sdp"), 0), cat(s, " Па");
  txt(&F_D13, 255, 224, s, K_TEXT, 1);
  s[0] = 0, cat(s, "R "), catn(s, V("Sr"), 1);
  txt(&F_N12, 255, 240, s, K_DIM, 1);
  for (int k = 0; k < 2; k++) {
    int x = 220 + k * 42, open = vl >> k & 1;
    g_fill(x + 12, open ? 76 : 82, 4, open ? 16 : 10, K_FAINT);
    g_rrect((float)x, open ? 62.0f : 70.0f, 28, 12, 4, open ? K_ACC : hd ? K_T1 : K_FAINT);
    txt(&F_N12, x + 14, 58, k ? "К2" : "К1", open ? K_ACC : K_DIM, 1);
    if (open)
      for (int j = 0; j < 3; j++) g_line((float)x + 6 + j * 8, 36, (float)x + 6 + j * 8, 46, 2, K_ACC);
  }
  /* Фильтр → турбины. */
  g_line(306, 170, 326, 170, 10, K_FAINT);
  g_line(326, 100, 326, 210, 10, K_FAINT);
  flow_dots(306, 170, 326, 170, sp, K_ACC);
  s[0] = 0, catn(s, V("Sva"), 1), cat(s, " кПа");
  txt(&F_N12, 316, 252, s, K_DIM, 1);
  for (int k = 0; k < 2; k++) {
    float cy = k ? 210.0f : 100.0f, cx = 362;
    float p = V(k ? "Sp2" : "Sp1");
    uint16_t tc = k ? K_T2 : K_T1;
    g_line(326, cy, 336, cy, 10, K_FAINT);
    g_circle(cx, cy, 28, K_CARD2);
    g_ring(cx, cy, 28, 2, p > 0 ? tc : K_FAINT);
    static float ang[2];
    if (p > 0) ang[k] += p / 100.0f * 0.13f;
    for (int b = 0; b < 5; b++) {
      float a = ang[k] + b / 5.0f;
      g_line(cx + g_sin_turn(a) * 6, cy - g_sin_turn(a + 0.25f) * 6, cx + g_sin_turn(a + 0.05f) * 20, cy - g_sin_turn(a + 0.3f) * 20, 3.5f, p > 0 ? tc : K_DIM);
    }
    s[0] = 0, catn(s, p, 0), cat(s, " %");
    txt(&F_D15, 398, (int)cy - 8, s, p > 0 ? K_TEXT : K_DIM, 0);
    s[0] = 0, catn(s, V(k ? "Sw2" : "Sw1"), 0), cat(s, " Вт");
    txt(&F_N12, 398, (int)cy + 8, s, K_SUB, 0);
    s[0] = 0, catn(s, V(k ? "St2" : "St1"), 0), cat(s, " °C");
    txt(&F_N12, 398, (int)cy + 23, s, K_DIM, 0);
  }
  if (!ru) txt(&F_N12, 240, CY1 - 2, "турбины стоят", K_DIM, 1);
}

/* ---------------- окна поверх ---------------- */

static int ov_on(void) { return link_ok() && Vi("Sov"); }
static int strong_on(void) { return link_ok() && Vi("Spg") == 2; }
static int urgent_on(void) { return link_ok() && (faults() & F_URGENT & ~ack_mask); }

static void dim_all(void) { g_dim(0, 0, SW_, SH_, 0, 150); }

static void overlay_ov(void) {
  char s[192];
  dim_all();
  card(30, 34, 420, 252, HEX(0x1c1210));
  g_rrect(30, 34, 420, 5, 2.5f, K_RED);
  icon(&F_I32, 46, 52, IC_PLUG, K_RED);
  if (Vi("Sov") == 2) {
    txt(&F_D20, 88, 76, "Инструмент был включён", K_RED, 0);
    wrap(&F_N14, 46, 112, 388, 19, "Когда подали розетку, инструмент сразу потянул ток — он мог раскрутиться в руках. Розетка снова выключена. Выключите инструмент выключателем и включите розетку.", K_TEXT, 5, 0);
    button(46, 222, 190, 50, "Включить", IC_CHECK, 1, ZT_BTN, B_OV_YES, 0);
  } else {
    txt(&F_D20, 88, 76, "Перегрузка — розетка выключена", K_RED, 0);
    s[0] = 0;
    cat(s, "Инструмент "), catn(s, V("Fot"), 1), cat(s, " А + турбины "), catn(s, V("Fou"), 1), cat(s, " А — больше предела "), catn(s, V("Ctm"), 0), cat(s, " А. Выключите инструмент и выберите:");
    wrap(&F_N14, 46, 112, 388, 19, s, K_TEXT, 4, 0);
    if (Vi("Foc")) {
      s[0] = 0;
      cat(s, Vi("Fo1") ? "Одна турбина " : "Турбины "), catn(s, V("Foc"), 0), cat(s, " %");
      button(46, 222, 220, 50, s, IC_CHECK, 1, ZT_BTN, B_OV_YES, 0);
    } else
      txt(&F_N12, 46, 200, "турбины не снизить настолько", K_SUB, 0);
  }
  button(276, 222, 158, 50, "Без розетки", IC_CROSS, 0, ZT_BTN, B_OV_NO, 0);
}

static void overlay_strong(void) {
  char s[192];
  int hz = Vi("Shz");
  card(60, NAVY - 112, 360, 104, HEX(0x0f1d18));
  g_rrect_line(60, NAVY - 112, 360, 104, 10, 1.5f, K_ACC);
  icon(&F_I32, 74, NAVY - 100, hz ? IC_HAND : IC_TURBO, hz ? K_WARN : K_ACC);
  txt(&F_D17, 116, NAVY - 82, "Мощная очистка", K_ACC, 0);
  s[0] = 0;
  if (hz) cat(s, "закройте шланг ладонью — удары начнутся сами");
  else catn(cat(s, "удар "), V("Spn"), 0), cat(s, " из "), catn(s, V("Csn"), 0), cat(s, " · "), catn(s, V("Sva"), 1), cat(s, " кПа");
  txt(&F_N14, 116, NAVY - 60, s, hz ? K_WARN : K_TEXT, 0);
  button(300, NAVY - 50, 108, 36, "Отмена", 0, 0, ZT_BTN, B_STRONG_X, 0);
}

static void overlay_urgent(void) {
  int b = -1;
  uint32_t fa = faults() & F_URGENT & ~ack_mask;
  for (int i = 0; i < NF; i++)
    if (fa & (1UL << FAULT_ORDER[i])) {
      b = FAULT_ORDER[i];
      break;
    }
  if (b < 0) return;
  dim_all();
  card(40, 50, 400, 210, K_RED_D);
  g_rrect(40, 50, 400, 5, 2.5f, K_RED);
  icon_c(&F_I44, 240, 100, b == 20 || b == 21 ? IC_DROP : IC_WARN, K_RED);
  txt(&F_D24, 240, 154, FAULT[b].text, K_TEXT, 1);
  wrap(&F_N14, 60, 180, 360, 19, fault_hint(b), K_SUB, 2, 1);
  button(170, 206, 140, 44, "Понятно", IC_CHECK, 0, ZT_BTN, B_ACK, 0);
}

static void draw_sheet(void) {
  dim_all();
  int n = sheet.n, oh = 42, h = n * oh + 56;
  if (h > 290) h = 290;
  int y0 = (SH_ - h) / 2;
  card(70, y0, 340, h, K_CARD);
  txt(&F_D15, 86, y0 + 30, sheet.title, K_SUB, 0);
  button(370, y0 + 8, 32, 32, 0, IC_CROSS, 4, ZT_BTN, B_SHEET_X, 0);
  const char *p = sheet.opts;
  for (int i = 0; i < n; i++) {
    char lab[96];
    int k = 0;
    while (*p && *p != '|' && k < (int)sizeof lab - 1) lab[k++] = *p++;
    lab[k] = 0;
    if (*p == '|') p++;
    int y = y0 + 46 + i * oh;
    if (y + oh > y0 + h) break;
    int on = i == sheet.sel, pr = is_p(ZT_OPT, i, 0);
    if (on || pr) g_rrect(78, (float)y, 324, (float)oh - 4, 8, on ? K_ACC_D : K_PRESS);
    txt(&F_D17, 94, y + 26, lab, on ? K_ACC : K_TEXT, 0);
    if (on) icon(&F_I18, 374, y + 10, IC_CHECK, K_ACC);
    zone(78, y, 324, oh - 4, ZT_OPT, i, 0);
  }
}

static void scr_sleep(void) {
  char hm[8], dm[8];
  uint32_t tm = (uint32_t)pint(Vs("Ftm"));
  if (tm) {
    clock_str(tm, hm, dm);
    txt(&F_B60, 240, 170, hm, K_FAINT, 1);
  }
  txt(&F_D17, 240, 220, "Выключен", K_DIM, 1);
  txt(&F_N12, 240, 244, "коснитесь экрана — включить", K_FAINT, 1);
}

/* ---------------- кадр ---------------- */

static void draw(void) {
  nz = 0;
  nrw = 0;
  g_noclip();
  g_fill(0, 0, SW_, SH_, K_BG);
  if (t35_sleeping()) {
    scr_sleep();
    return;
  }
  top_bar();
  switch (screen) {
  case SC_HOME: scr_home(); break;
  case SC_CLEAN: build_clean(), draw_list(6, CY0, 462, CY1 - CY0); break;
  case SC_FILTER: scr_filter(); break;
  case SC_CHART: scr_chart(); break;
  case SC_MENU: scr_menu(); break;
  case SC_SET: build_set(), draw_list(6, CY0, 462, CY1 - CY0); break;
  case SC_WIZ: scr_wiz(); break;
  case SC_SVC: scr_svc(); break;
  case SC_SCHEME: scr_scheme(); break;
  case SC_MAINT: build_maint(), draw_list(6, CY0, 462, CY1 - CY0); break;
  case SC_REPORT: build_report(), draw_list(6, CY0, 462, CY1 - CY0); break;
  case SC_LOG: build_log(), draw_list(6, CY0, 462, CY1 - CY0); break;
  case SC_VOICE: build_voice(), draw_list(6, CY0, 462, CY1 - CY0); break;
  case SC_SCALE: scr_scale(); break;
  case SC_CLOCK: build_clock(), draw_list(6, CY0, 462, CY1 - CY0); break;
  case SC_LINK: scr_link(); break;
  case SC_TOOL: build_tool(), draw_list(6, CY0, 462, CY1 - CY0); break;
  case SC_ABOUT: build_about(), draw_list(6, CY0, 462, CY1 - CY0); break;
  case SC_OSC: scr_osc(); break;
  }
  nav();
  if (toast_till) {
    int w = g_text_w(&F_D15, toast_s, 0) + 32;
    if (w > 460) w = 460;
    g_rrect((float)(240 - w / 2), NAVY - 46, (float)w, 36, 18, HEX(0x2c333d));
    wrap(&F_D15, 240 - w / 2 + 16, NAVY - 23, w - 32, 16, toast_s, K_TEXT, 1, 0);
  }
  /* Окна: зоны под ними не действуют. */
  int modal = sheet.open || ov_on() || urgent_on();
  if (modal) nz = 0, zone(0, 0, SW_, SH_, ZT_BLOCK, 0, 0);
  if (strong_on() && !modal) overlay_strong();
  if (!link_ok()) {
    dim_all();
    card(90, 110, 300, 90, K_CARD);
    txt(&F_D17, 240, 148, "Нет связи с контроллером", K_WARN, 1);
    txt(&F_N12, 240, 172, "ждём строки состояния…", K_DIM, 1);
  } else if (ov_on())
    overlay_ov();
  else if (urgent_on())
    overlay_urgent();
  else if (sheet.open)
    draw_sheet();
}

/* ---------------- действия ---------------- */

static void go(int sc) {
  if (sc < 0 || sc >= SC_N) return;
  if (is_tab(sc)) back_to = sc;
  if (sc != screen) {
    if (screen == SC_WIZ && sc != SC_CLOCK && W_TID[wiz]) cmd("test stop");
    scroll[sc] = 0;
  }
  if (sc == SC_SVC && screen != SC_SVC) svc_start();
  if (sc == SC_CLOCK) clock_load();
  if (sc == SC_CHART) chart_request();
  if (sc == SC_OSC) cmd("osc");
  if (sc == SC_WIZ && screen != SC_CLOCK) wiz_go(0);
  screen = sc;
  sheet.open = 0;
  dirty = 1;
}

static void open_sheet(int i) {
  row_t *r = &RW[i];
  sheet.open = 1, sheet.row = r->id, sheet.sel = r->sel, sheet.opts = r->opts, sheet.title = r->label;
  sheet.n = 1;
  for (const char *p = r->opts; *p; p++) sheet.n += *p == '|';
  /* Обработчик — того экрана, что открыл окно. */
  dirty = 1;
}

static void act(const zone_t *z) {
  int t = z->t, a = z->a, b = z->b;
  /* Строки списка — из этого же кадра. */
  if ((t == ZT_MINUS || t == ZT_PLUS || t == ZT_SEG || t == ZT_TOG || t == ZT_ROWBTN || t == ZT_CHOICE) && (a < 0 || a >= nrw)) return;
  if (t == ZT_CHOICE && (RW[a].kind != R_CHOICE || !RW[a].opts)) return;
  switch (t) {
  case ZT_TAB: go(a); return;
  case ZT_BACK:
    if (screen == SC_CLOCK && back_to == SC_WIZ) {
      screen = SC_WIZ, dirty = 1;
      return;
    }
    if (screen == SC_OSC && back_to == SC_CLEAN) return go(SC_CLEAN);
    if (screen == SC_SVC) return go(SC_FILTER);
    if (screen == SC_VOICE && back_to == SC_SET) return go(SC_SET);
    go(is_tab(back_to) ? back_to : SC_MENU);
    if (!is_tab(screen)) go(SC_MENU);
    return;
  case ZT_MINUS: row_step(a, -1); return;
  case ZT_PLUS: row_step(a, 1); return;
  case ZT_SEG:
    if (row_fn) row_fn(RW[a].id, (float)b);
    return;
  case ZT_TOG:
    if (row_fn) row_fn(RW[a].id, (float)!RW[a].sel);
    return;
  case ZT_ROWBTN:
    if (row_fn) row_fn(RW[a].id, 0);
    return;
  case ZT_CHOICE: open_sheet(a); return;
  case ZT_OPT:
    sheet.open = 0;
    if (row_fn) row_fn(sheet.row, (float)a);
    dirty = 1;
    return;
  case ZT_BTN: break;
  default: return;
  }
  switch (a) {
  case B_T1:
  case B_T2: {
    int k = a - B_T1, on = !Vi(k ? "Se2" : "Se1");
    local_f(k ? "Se2" : "Se1", (float)on, 0);
    cmdi(k ? "t2 " : "t1 ", on);
    break;
  }
  case B_START: start_stop(); break;
  case B_PURGE:
    cmd("purge");
    toast(Vi("Spg") && Vi("Spg") != 2 ? "Очистка остановлена" : "Продувка: серия ударов");
    break;
  case B_STRONG:
  case B_STRONG_X:
    cmd("purge strong");
    toast(Vi("Spg") == 2 ? "Мощная очистка отменена" : "Мощная очистка: закройте шланг ладонью");
    break;
  case B_MODE: {
    char s[8] = "mode a";
    s[5] = b ? 'm' : 'a';
    kv_set("Smd", b ? "m" : "a", 1);
    cmd(s);
    break;
  }
  case B_RSEL:
    rsel = b == 1 ? 0 : b == 0 ? 1 : 2;
    local_f("Xrs", (float)rsel, 0);
    cmdi("set rsel ", rsel);
    break;
  case B_MINUS: home_adjust(-1); break;
  case B_PLUS: home_adjust(1); break;
  case B_GAUGE: go(SC_SCHEME), back_to = SC_HOME; break;
  case B_OV_YES:
    cmd(Vi("Sov") == 2 ? "sock on" : "sock cap");
    toast(Vi("Sov") == 2 ? "Розетка включена" : "Турбины ограничены, розетка включена");
    break;
  case B_OV_NO: cmd("sock off"), toast("Розетка выключена"); break;
  case B_ACK:
    ack_mask |= faults() & F_URGENT;
    cmd("ack");
    break;
  case B_SVC: svc_act(b); break;
  case B_WIZ: wiz_act(b); break;
  case B_CHART_M: chart_m = b, chart_request(); break;
  case B_CHART_R: chart_r = b, chart_request(); break;
  case B_OSC: back_to = SC_CHART, go(SC_OSC); break;
  case B_TILE:
    back_to = SC_MENU;
    go(TILES[b].sc);
    break;
  case B_SHEET_X: sheet.open = 0; break;
  }
  dirty = 1;
}

/* Окно выбора: касание мимо — закрыть. */
void t35_touch(int x, int y, int down) {
  if (t35_sleeping()) {
    if (down && !touch_down) cmd("wake");
    touch_down = down;
    return;
  }
  if (down && !touch_down) {
    touch_down = 1;
    dragging = 0;
    press_at = now, repeat_at = now + 450, repeats = 0;
    int i = hit(x, y, 1);
    if (i >= 0 && Z[i].t == ZT_BLOCK) i = -1;
    if (i < 0 && sheet.open) {
      sheet.open = 0, pz.t = ZT_NONE, dirty = 1;
      return;
    }
    pz.t = i >= 0 ? Z[i].t : ZT_NONE, pz.a = i >= 0 ? Z[i].a : 0, pz.b = i >= 0 ? Z[i].b : 0;
    /* Список под пальцем — для прокрутки. */
    drag_list = 0;
    for (int k = 0; k < nz; k++)
      if (Z[k].t == ZT_LIST && x >= Z[k].x && x < Z[k].x + Z[k].w && y >= Z[k].y && y < Z[k].y + Z[k].h) drag_list = 1;
    drag_y0 = y, drag_s0 = scroll[screen];
    dirty = 1;
  } else if (down) {
    int dy = y - drag_y0;
    if (drag_list && !sheet.open && (dragging || dy > 8 || dy < -8)) {
      dragging = 1, pz.t = ZT_NONE;
      int ns = drag_s0 - dy;
      if (ns != scroll[screen]) scroll[screen] = ns, dirty = 1;
      return;
    }
    int i = hit(x, y, 1);
    if (pz.t != ZT_NONE && (i < 0 || Z[i].t != pz.t || Z[i].a != pz.a || Z[i].b != pz.b)) pz.t = ZT_NONE, dirty = 1;
  } else if (touch_down) {
    touch_down = 0;
    int was_drag = dragging;
    dragging = 0;
    /* Действие — только если под пальцем та же зона, что при нажатии (и в нынешнем кадре). */
    int i = hit(x, y, 1);
    int same = i >= 0 && Z[i].t == pz.t && Z[i].a == pz.a && Z[i].b == pz.b;
    if (!was_drag && same && pz.t != ZT_NONE && !(repeats && (pz.t == ZT_MINUS || pz.t == ZT_PLUS))) act(&Z[i]);
    pz.t = ZT_NONE;
    dirty = 1;
  }
}

/* ---------------- вход ---------------- */

static uint16_t *t35_fb;

void t35_setup(uint16_t *fb) {
  t35_fb = fb;
  g_init_size(fb, SW_, SH_);
  kv_set("Smd", "a", 0), kv_set("Ssp", "32", 0), kv_set("Spw", "80", 0), kv_set("Sq2", "80", 0);
  kv_set("Xbm", "1200", 0), kv_set("Xvv", "22", 0), kv_set("Xhm", "36", 0), kv_set("Xhl", "5", 0), kv_set("Xtk", "30", 0);
  phal_log("Экран 3,5″ 480×320: интерфейс пылесоса S3 6.0");
  dirty = 1;
}

int t35_loop(uint32_t ms) {
  now = ms;
  if (ms - hb_at >= 500) {
    hb_at = ms;
    cmd("hi2");
  }
  int lk = link_ok();
  if (lk != link_prev) {
    link_prev = lk;
    dirty = 1;
    if (lk) cmd("get"), cmd("get ext"), get_at = ms;
  }
  if (lk && (!Vh("Cpr") || !Vh("Xvm")) && ms - get_at > 2000) cmd("get"), cmd("get ext"), get_at = ms;
  int sl = t35_sleeping();
  if (sl != sleep_prev) sleep_prev = sl, dirty = 1;
  if (toast_till && (int32_t)(toast_till - ms) <= 0) toast_till = 0, dirty = 1;
  /* −/+ при удержании — повтор. */
  if (touch_down && !dragging && (pz.t == ZT_MINUS || pz.t == ZT_PLUS || (pz.t == ZT_BTN && (pz.a == B_MINUS || pz.a == B_PLUS))) && (int32_t)(ms - repeat_at) >= 0) {
    repeat_at = ms + (repeats > 8 ? 70 : 130);
    repeats++;
    if (pz.t == ZT_BTN) home_adjust(pz.a == B_PLUS ? 1 : -1);
    else row_step(pz.a, pz.t == ZT_PLUS ? 1 : -1);
  }
  /* Графики — обновлять; анимация турбин и схемы — 10 кадров в секунду. */
  if (screen == SC_CHART && ms - chart_req > (chart_r ? 30000u : 5000u)) chart_request();
  int anim = (screen == SC_HOME && (V("Sp1") > 0 || V("Sp2") > 0)) || screen == SC_SCHEME || (screen == SC_WIZ && (Vi("Tph") == 1 || Vi("Tph") == 2)) || (screen == SC_SVC && svc_meas);
  if (anim && ms - anim_at >= 100) {
    anim_at = ms;
    flow_phase += 1;
    dirty = 1;
  }
  if (dirty && ms - drawn_at >= 40) {
    draw();
    dirty = 0;
    drawn_at = ms;
    return 1;
  }
  return 0;
}
