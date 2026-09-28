/*
 * Экраны пульта для контроллера «S3» (firmware/vacuum-s3): «Работа», «Режим», «Очистка»,
 * «Фильтр», «Журнал», «Пресеты». Подписи по бокам экрана — три слева и три справа — стоят
 * напротив физических кнопок корпуса: нажатие кнопки (строка «E k=N» от контроллера) и касание
 * подписи делают одно и то же, подпись на мгновение подсвечивается. Энкодер внизу посередине
 * меняет выделенное значение, его кнопка — выбор (работает и в перчатках, без касаний).
 * «Выкл» на контроллере гасит экран («P off»), любая кнопка или касание — будит.
 * Значения приходят от контроллера строками, команды уходят туда же; пока ответ не
 * пришёл, пульт показывает новое значение сразу (поле «придерживается» 0,6 с).
 */
#include "panel_int.h"
#include "gfx.h"

/* ---------------- цвета макета ---------------- */

#define C_BG HEX(0x080808)
#define C_TEXT HEX(0xe8e8e4)
#define C_KEY HEX(0xb8b8b3)
#define C_ICON HEX(0x6a6a65)
#define C_DIM HEX(0x7a7a75)
#define C_SUB HEX(0x8a8a85)
#define C_GREY HEX(0x9a9a94)
#define C_WARN HEX(0xe8a33d)
#define C_WARN2 HEX(0xc98b2d)
#define C_RED HEX(0xe0533d)
#define C_TRACK HEX(0x1e1e1c)
#define C_FILL HEX(0x5a5a55)
#define C_TAB HEX(0x141412)
#define C_LINE HEX(0x171715)
#define C_INK HEX(0x0b0b0a)
#define C_GREEN HEX(0x1d6b52)
#define C_GREEN_T HEX(0xbff0dc)
#define C_GREEN_C HEX(0xdff5ec)
#define C_OFF HEX(0x3a3a35)
#define C_WBOX HEX(0x33290f)
#define C_PRESS HEX(0x1c1c1a)
#define C_TOAST HEX(0x2b2b26)
#define C_GAUGE0 HEX(0x4d4d49)

/* ---------------- строки и числа (без стандартной библиотеки) ---------------- */

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

/* Число с запятой, dec знаков после запятой. */
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

static float pnum(const char *s) {
  float sign = 1, v = 0, k = 0;
  if (*s == '-') sign = -1, s++;
  for (; *s; s++) {
    if (*s >= '0' && *s <= '9') {
      if (k > 0) {
        v += (float)(*s - '0') * k;
        k *= 0.1f;
      } else
        v = v * 10 + (float)(*s - '0');
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

/* ---------------- данные от контроллера ---------------- */

static uint32_t now;
static int detected;

/* Строка «S»: состояние. */
static struct {
  int have;
  uint32_t at;
  int st, sl;         /* турбины включены кнопками; «Выкл» (сон) */
  char md, cl;        /* режим: a — авто, m — ручной; очистка: a — авто, o — выкл */
  int e1, e2, k1, k2; /* турбины включены, реле замкнуты */
  int ru;             /* турбины крутятся */
  int pg, pn, sd;     /* продувка (1 — серия, 2 — полная, 3 — удар отбивки, 4 — перед остановкой), удар, очистка перед сном */
  int nx, nt, tp;     /* до серии по периоду, до удара отбивки, период отбивки, с */
  int pe, pr;         /* период серий, с; пресет (−1 — свой) */
  int wl, fs, bt, bp; /* вода: 0/1/2; поплавок; пульт Bluetooth: 0/1/2; окно привязки */
  float f, sp, pw, v, va, p1, p2, i1, i2, t1, t2, fl, dp, r, ra, rn, rw, sm, mv;
  long pc;
  uint32_t fa;
} S = {.md = 'a', .cl = 'a', .pr = -1, .sp = 32, .pw = 80, .t1 = 25, .t2 = 25};

/* Строка «C»: настройки. */
static struct {
  int have;
  int n, imp, pause, thr, boost, t2, coff, tap, wl, bl, bt;
  int psp[4], per[4], ptp[4];
} C = {0, 4, 100, 400, 150, 500, 1, 1, 0, 300, 800, 0, {36, 30, 32, 28}, {0, 0, 0, 60}, {15, 30, 20, 0}};

/* Строка «J»: журнал. */
static struct {
  int have;
  float h1, w1, h2, w2, vi1, vh1, vi2, vh2;
  float rh[30];
  int nrh;
} J;

/* Поле, которое только что изменили на пульте, не перезаписывается старым ответом. */
#define NHOLD 8
static char hold_key[NHOLD][8];
static uint32_t hold_till[NHOLD];

static void hold(const char *k) {
  int slot = 0;
  for (int i = 0; i < NHOLD; i++) {
    if (seq(hold_key[i], k)) {
      slot = i;
      break;
    }
    if ((int32_t)(hold_till[i] - hold_till[slot]) < 0) slot = i;
  }
  int n = 0;
  while (k[n] && n < 7) hold_key[slot][n] = k[n], n++;
  hold_key[slot][n] = 0;
  hold_till[slot] = now + 600;
}

static int held(const char *k) {
  for (int i = 0; i < NHOLD; i++)
    if (seq(hold_key[i], k) && (int32_t)(hold_till[i] - now) > 0) return 1;
  return 0;
}

static int link_ok(void) { return S.have && now - S.at < 1500; }

/* ---------------- неисправности ---------------- */

#define NF 29
static const struct {
  const char *text, *hint;
} FAULT[NF] = {
    {"Нет синхронизации с сетью", "проверьте сеть 230 В и детектор нуля"},
    {"Перегрев турбины 1", "турбина 1 отключена до остывания"},
    {"Перегрев турбины 2", "турбина 2 отключена до остывания"},
    {"Турбина 1 горячая", "мощность снижена до 70 %"},
    {"Турбина 2 горячая", "мощность снижена до 70 %"},
    {"Датчик температуры 1", "обрыв или замыкание термистора"},
    {"Датчик температуры 2", "обрыв или замыкание термистора"},
    {"Перегрузка турбины 1", "турбина 1 отключена на 30 с"},
    {"Перегрузка турбины 2", "турбина 2 отключена на 30 с"},
    {"Нет тока турбины 1", "щётки, обрыв обмотки, реле или симистор"},
    {"Нет тока турбины 2", "щётки, обрыв обмотки, реле или симистор"},
    {"Пробит симистор 1", "реле разомкнуто, турбина 1 заблокирована"},
    {"Пробит симистор 2", "реле разомкнуто, турбина 2 заблокирована"},
    {"Мало воздуха", "шланг перегнут или насадка прижата"},
    {"Шланг или вход забит", "проверьте шланг и вход в бак"},
    {"Фильтр: пора мыть", "продувка не восстанавливает сопротивление"},
    {"Напряжение сети", "вне 190…250 В"},
    {"Нет датчика фильтра", "SDP810 на разъёме X2"},
    {"Нет расходомера", "SDP811 на разъёме X3"},
    {"Датчик разрежения", "нет сигнала MPX5050DP"},
    {"Бак полон", "слейте воду — турбины остановлены"},
    {"Перелив!", "вода у верхнего электрода — аварийный стоп"},
    {"Реле 1 сварилось", "выключите пылесос выключателем сети"},
    {"Реле 2 сварилось", "выключите пылесос выключателем сети"},
    {"Клапан 1 не срабатывает", "катушка, предохранитель FU2 или симистор"},
    {"Клапан 2 не срабатывает", "катушка, предохранитель FU2 или симистор"},
    {"Фильтр порван или не стоит", "пыль идёт в турбины — проверьте фильтр"},
    {"Нет связи с кнопками", "расширитель PCA9555 не отвечает"},
    {"Электроды: проверьте", "вода на верхнем без нижнего — грязь или обрыв"},
};
/* Порядок важности: какую неисправность показать на экране «Работа». */
static const uint8_t FAULT_ORDER[NF] = {21, 22, 23, 26, 20, 0, 11, 12, 1, 2, 7, 8, 14, 13, 9, 10, 24, 25, 15, 3, 4, 5, 6, 16, 17, 18, 19, 27, 28};
#define F_FILTER_BIT 15
#define F_TORN_BIT 26
#define F_URGENT ((1UL << 20) | (1UL << 21) | (1UL << 22) | (1UL << 23) | (1UL << 26))

static int top_fault(void) {
  for (int i = 0; i < NF; i++)
    if (S.fa & (1UL << FAULT_ORDER[i])) return FAULT_ORDER[i];
  return -1;
}

static int fault_count(void) {
  int n = 0;
  for (int i = 0; i < NF; i++) n += (S.fa >> i) & 1;
  return n;
}

/* Журнал аварий на пульте: когда появилась и когда снята. */
#define NALARM 16
static struct {
  uint8_t bit;
  uint32_t on, off;
} AL[NALARM];
static int nal;
static uint32_t fa_prev;

static void alarms_update(void) {
  uint32_t ch = S.fa ^ fa_prev;
  for (int b = 0; b < NF; b++) {
    if (!(ch & (1UL << b))) continue;
    if (S.fa & (1UL << b)) {
      if (nal == NALARM) {
        for (int i = 1; i < NALARM; i++) AL[i - 1] = AL[i];
        nal--;
      }
      AL[nal].bit = (uint8_t)b;
      AL[nal].on = now;
      AL[nal].off = 0;
      nal++;
    } else
      for (int i = nal - 1; i >= 0; i--)
        if (AL[i].bit == b && !AL[i].off) {
          AL[i].off = now ? now : 1;
          break;
        }
  }
  fa_prev = S.fa;
}

static int filter_warn(void) { return S.fl > 70 || ((S.fa >> F_FILTER_BIT) & 1) || ((S.fa >> F_TORN_BIT) & 1); }

/* ---------------- состояние интерфейса ---------------- */

enum { W_WORK, W_MODE, W_CLEAN, W_FILTER, W_LOG, W_PRESET };
enum { Z_NONE = -1, Z_KL = 0, Z_KR = 3, Z_TAB = 6, Z_ITEM = 10, Z_CARD = 20, Z_FLOW = 24, Z_FBAR = 25 };

static int screen = W_WORK;
static int pressed = Z_NONE, touch_down;
static int flash_zone = Z_NONE;
static uint32_t flash_till;
static int mode_focus = 2, clean_sel, preset_sel, preset_edit, log_view, log_range = 7;
static int dirty = 1;
static uint32_t drawn_at, hb_at, get_at, sec_at;
static int link_prev, sleep_prev;
static char toast_s[80];
static uint32_t toast_till;
static int confirm_zone = Z_NONE;
static uint32_t confirm_till;

#define NCLEAN 7
static const char *const CLEAN_LABEL[NCLEAN] = {"Ударов в серии", "Импульс", "Пауза", "Порог R", "Разгон", "Отбивка: удар каждые", "Очистка при выключении"};
static const char *const CLEAN_UNIT[NCLEAN] = {"", " мс", " мс", " %", " мс", " с", ""};
static const char *const CLEAN_KEY[NCLEAN] = {"n", "imp", "pause", "thr", "boost", "tap", "coff"};
static const int CLEAN_MIN[NCLEAN] = {1, 20, 100, 110, 0, 0, 0}, CLEAN_MAX[NCLEAN] = {10, 500, 3000, 300, 3000, 120, 1}, CLEAN_STEP[NCLEAN] = {1, 10, 50, 5, 100, 5, 1};
static const char *const PRESET_NAME[4] = {"Штробление бетона", "Бурение", "Гипс", "Уборка"};
static const char *const PRESET_KEY[4] = {"Бетон", "Бурение", "Гипс", "Уборка"};

static int *clean_val(int i) {
  int *v[NCLEAN] = {&C.n, &C.imp, &C.pause, &C.thr, &C.boost, &C.tap, &C.coff};
  return v[i];
}

static void cmd(const char *s) {
  phal_uart_write(s, slen(s));
  phal_uart_write("\n", 1);
}

static void toast(const char *s) {
  toast_s[0] = 0;
  cat(toast_s, s);
  toast_till = now + 2500;
  if (!toast_till) toast_till = 1;
  dirty = 1;
}

/* Опасные действия — вторым нажатием за 3 с. */
static int confirmed(int zone, const char *what) {
  if (confirm_zone == zone && (int32_t)(confirm_till - now) > 0) {
    confirm_zone = Z_NONE;
    return 1;
  }
  confirm_zone = zone;
  confirm_till = now + 3000;
  char s[80] = "Нажмите ещё раз: ";
  toast(cat(s, what));
  return 0;
}

/* ---------------- разбор строк контроллера ---------------- */

static void s_field(const char *k, const char *v) {
  if (seq(k, "e1")) detected = 1;
  if (held(k)) return;
  float x = pnum(v);
  if (seq(k, "st")) S.st = (int)x;
  else if (seq(k, "sl")) S.sl = (int)x;
  else if (seq(k, "md")) S.md = v[0];
  else if (seq(k, "cl")) S.cl = v[0];
  else if (seq(k, "e1")) S.e1 = (int)x;
  else if (seq(k, "e2")) S.e2 = (int)x;
  else if (seq(k, "k1")) S.k1 = (int)x;
  else if (seq(k, "k2")) S.k2 = (int)x;
  else if (seq(k, "ru")) S.ru = (int)x;
  else if (seq(k, "pg")) S.pg = (int)x;
  else if (seq(k, "pn")) S.pn = (int)x;
  else if (seq(k, "sd")) S.sd = (int)x;
  else if (seq(k, "nx")) S.nx = (int)x;
  else if (seq(k, "nt")) S.nt = (int)x;
  else if (seq(k, "tp")) S.tp = (int)x;
  else if (seq(k, "pe")) S.pe = (int)x;
  else if (seq(k, "pr")) S.pr = (int)x;
  else if (seq(k, "wl")) S.wl = (int)x;
  else if (seq(k, "fs")) S.fs = (int)x;
  else if (seq(k, "bt")) S.bt = (int)x;
  else if (seq(k, "bp")) S.bp = (int)x;
  else if (seq(k, "f")) S.f = x;
  else if (seq(k, "sp")) S.sp = x;
  else if (seq(k, "pw")) S.pw = x;
  else if (seq(k, "v")) S.v = x;
  else if (seq(k, "va")) S.va = x;
  else if (seq(k, "p1")) S.p1 = x;
  else if (seq(k, "p2")) S.p2 = x;
  else if (seq(k, "i1")) S.i1 = x;
  else if (seq(k, "i2")) S.i2 = x;
  else if (seq(k, "t1")) S.t1 = x;
  else if (seq(k, "t2")) S.t2 = x;
  else if (seq(k, "fl")) S.fl = x;
  else if (seq(k, "dp")) S.dp = x;
  else if (seq(k, "r")) S.r = x;
  else if (seq(k, "ra")) S.ra = x;
  else if (seq(k, "rn")) S.rn = x;
  else if (seq(k, "rw")) S.rw = x;
  else if (seq(k, "sm")) S.sm = x;
  else if (seq(k, "mv")) S.mv = x;
  else if (seq(k, "pc")) S.pc = pint(v);
  else if (seq(k, "fa")) S.fa = (uint32_t)pint(v);
}

static void c_field(const char *k, const char *v) {
  if (held(k)) return;
  int x = (int)pint(v);
  if (seq(k, "n")) C.n = x;
  else if (seq(k, "imp")) C.imp = x;
  else if (seq(k, "pause")) C.pause = x;
  else if (seq(k, "thr")) C.thr = x;
  else if (seq(k, "boost")) C.boost = x;
  else if (seq(k, "t2")) C.t2 = x;
  else if (seq(k, "coff")) C.coff = x;
  else if (seq(k, "tap")) C.tap = x;
  else if (seq(k, "wl")) C.wl = x;
  else if (seq(k, "bl")) C.bl = x;
  else if (seq(k, "bt")) C.bt = x;
  else if (k[0] == 'P' && k[1] >= '0' && k[1] <= '3' && !k[2]) {
    /* P0=36/0/15: расход, л/с; период серий, с; отбивка, с */
    int i = k[1] - '0';
    C.psp[i] = x;
    while (*v && *v != '/') v++;
    if (*v) C.per[i] = (int)pint(++v);
    while (*v && *v != '/') v++;
    if (*v) C.ptp[i] = (int)pint(++v);
  } else if (!seq(k, "tp"))
    s_field(k, v); /* sp, pw, md, cl, pr — общие со строкой состояния */
}

static void j_field(const char *k, const char *v) {
  if (seq(k, "h1")) J.h1 = pnum(v);
  else if (seq(k, "w1")) J.w1 = pnum(v);
  else if (seq(k, "h2")) J.h2 = pnum(v);
  else if (seq(k, "w2")) J.w2 = pnum(v);
  else if (seq(k, "vi1")) J.vi1 = pnum(v);
  else if (seq(k, "vh1")) J.vh1 = pnum(v);
  else if (seq(k, "vi2")) J.vi2 = pnum(v);
  else if (seq(k, "vh2")) J.vh2 = pnum(v);
  else if (seq(k, "rh")) {
    J.nrh = 0;
    while (*v && J.nrh < 30) {
      J.rh[J.nrh++] = pnum(v);
      while (*v && *v != '/') v++;
      if (*v) v++;
    }
  }
}

static void go(int w);
static void encoder(int d);
static void enc_click(void);
static void act(int z);

/* Физическая кнопка у экрана: 1–3 — слева сверху вниз, 4–6 — справа. */
static void side_key(int n) {
  if (n < 1 || n > 6) return;
  int z = n <= 3 ? Z_KL + n - 1 : Z_KR + n - 4;
  flash_zone = z;
  flash_till = now + 180;
  act(z);
}

static void on_line(char *s) {
  char type = s[0];
  if (type == 'E' && s[1] == ' ') {
    const char *e = s + 2;
    if (starts(e, "enc=")) encoder((int)pint(e + 4));
    else if (seq(e, "sw")) enc_click();
    else if (seq(e, "hold")) go(W_PRESET);
    else if (starts(e, "k=")) side_key((int)pint(e + 2));
    else if (starts(e, "kh=")) side_key((int)pint(e + 3));
    dirty = 1;
    return;
  }
  if (type == 'P' && s[1] == ' ') {
    if (seq(s + 2, "off")) S.sl = 1, hold("sl");
    else if (seq(s + 2, "on")) S.sl = 0, hold("sl"), go(W_WORK);
    dirty = 1;
    return;
  }
  if ((type != 'S' && type != 'C' && type != 'J') || (s[1] != ' ' && s[1])) return;
  char *p = s + 1;
  while (*p) {
    while (*p == ' ') p++;
    char *k = p;
    while (*p && *p != '=' && *p != ' ') p++;
    if (*p != '=') continue;
    *p++ = 0;
    char *v = p;
    while (*p && *p != ' ') p++;
    if (*p) *p++ = 0;
    if (type == 'S') s_field(k, v);
    else if (type == 'C') c_field(k, v);
    else j_field(k, v);
  }
  if (type == 'S') {
    S.have = 1;
    S.at = now;
    alarms_update();
  } else if (type == 'C')
    C.have = 1;
  else
    J.have = 1;
  dirty = 1;
}

static char rx_line[520];
static int rx_len;

void s3_rx(int ch) {
  if (ch == '\r') return;
  if (ch == '\n') {
    rx_line[rx_len] = 0;
    if (rx_len) on_line(rx_line);
    rx_len = 0;
    return;
  }
  if (rx_len < (int)sizeof rx_line - 1) rx_line[rx_len++] = (char)ch;
}

int s3_detected(void) { return detected; }
int s3_sleeping(void) { return S.sl && link_ok(); }

/* ---------------- команды ---------------- */

static void send_int(const char *head, int v) {
  char s[40] = "";
  cat(s, head);
  catn(s, (float)v, 0);
  cmd(s);
}

static void set_mode(char m) {
  S.md = m;
  hold("md");
  char s[8] = "mode a";
  s[5] = m;
  cmd(s);
}

static void turbine(int k) {
  int on = !(k ? S.e2 : S.e1);
  if (k) S.e2 = on, hold("e2");
  else S.e1 = on, hold("e1");
  send_int(k ? "t2 " : "t1 ", on);
}

static void change_sp(int d) {
  S.sp = (float)clampi((int)(S.sp + 0.5f) + d, 10, 60);
  hold("sp");
  send_int("sp ", (int)S.sp);
}

static void change_pw(int d) {
  S.pw = (float)clampi((int)(S.pw + 0.5f) + d * 5, 30, 100);
  hold("pw");
  send_int("pw ", (int)S.pw);
}

static void change_clean(int i, int d) {
  int *v = clean_val(i);
  if (i == 6) *v = !*v;
  else *v = clampi(*v + d * CLEAN_STEP[i], CLEAN_MIN[i], CLEAN_MAX[i]);
  if (i == 5 && *v > 0 && *v < 5) *v = d > 0 ? 5 : 0;
  hold(CLEAN_KEY[i]);
  char s[40] = "";
  if (i == 5) cat(s, "tap ");
  else if (i == 6) cat(s, "coff ");
  else cat(cat(cat(s, "set "), CLEAN_KEY[i]), " ");
  catn(s, (float)*v, 0);
  cmd(s);
}

static void send_preset(int i) {
  char k[4] = "P0", s[48] = "preset set ";
  k[1] = (char)('0' + i);
  hold(k);
  catn(s, (float)i, 0);
  cat(s, " ");
  catn(s, (float)C.psp[i], 0);
  cat(s, " ");
  catn(s, (float)C.per[i], 0);
  cat(s, " ");
  catn(s, (float)C.ptp[i], 0);
  cmd(s);
}

static void purge(int full) {
  cmd(full ? "purge full" : "purge");
  toast(S.pg && S.pg != 3 ? "Продувка остановлена" : full ? "Полная продувка: три серии" : "Продувка: серия ударов");
}

static void apply_preset(void) {
  send_int("preset ", preset_sel);
  S.pr = preset_sel;
  hold("pr");
  S.sp = (float)C.psp[preset_sel];
  hold("sp");
  S.md = 'a';
  hold("md");
  char s[60] = "Пресет «";
  cat(cat(s, PRESET_KEY[preset_sel]), "»");
  toast(s);
  go(W_WORK);
}

/* ---------------- энкодер (события от контроллера) ---------------- */

static void encoder(int d) {
  if (!d) return;
  switch (screen) {
  case W_WORK:
    if (S.md == 'a') change_sp(d);
    else change_pw(d);
    break;
  case W_MODE:
    if (mode_focus == 2) change_sp(d);
    else change_pw(d);
    break;
  case W_CLEAN: change_clean(clean_sel, d); break;
  case W_PRESET:
    if (preset_edit) {
      int t = C.ptp[preset_sel] + d * 5;
      C.ptp[preset_sel] = t < 5 ? (d > 0 ? 5 : 0) : clampi(t, 0, 120);
    } else
      C.psp[preset_sel] = clampi(C.psp[preset_sel] + d, 10, 60);
    send_preset(preset_sel);
    break;
  case W_LOG: log_range = d > 0 ? 30 : 7; break;
  default: break;
  }
  dirty = 1;
}

static void enc_click(void) {
  switch (screen) {
  case W_WORK: go(W_MODE); break;
  case W_MODE: mode_focus = mode_focus == 2 ? 3 : 2; break;
  case W_CLEAN: clean_sel = (clean_sel + 1) % NCLEAN; break;
  case W_PRESET: apply_preset(); break;
  default: go(W_WORK); break;
  }
  dirty = 1;
}

static void go(int w) {
  screen = w;
  if (w == W_MODE) mode_focus = S.md == 'm' ? 3 : 2;
  if (w == W_PRESET) {
    preset_sel = S.pr >= 0 && S.pr < 4 ? S.pr : 0;
    preset_edit = 0;
  }
  confirm_zone = Z_NONE;
  dirty = 1;
}

/* ---------------- отрисовка: общие элементы ---------------- */

typedef struct {
  const char *label, *icon;
  int warn;
} skey_t;

#define MID_L 158
#define MID_R 642
#define LIST_Y 51
#define ITEM_H 40

/* Подпись не шире w: перенос по пробелу на вторую строку. */
static void split(const char *s, const pfont_t *f, int w, char *l1, char *l2) {
  l1[0] = l2[0] = 0;
  cat(l1, s);
  if (g_text_w(f, s, 0) <= w) return;
  for (int i = slen(l1) - 1; i > 0; i--)
    if (l1[i] == ' ') {
      l1[i] = 0;
      if (g_text_w(f, l1, 0) <= w) {
        cat(l2, l1 + i + 1);
        return;
      }
      l1[i] = ' ';
    }
}

static void softkey(int side, int i, const skey_t *k) {
  int top = 26 + 104 * i;
  int z = (side ? Z_KR : Z_KL) + i;
  int lit = pressed == z || (flash_zone == z && (int32_t)(flash_till - now) > 0);
  if (lit) g_rrect(side ? 654 : 6, (float)top + 4, 140, 96, 10, C_PRESS);
  char l1[48], l2[48], ic[24] = "";
  split(k->label, &F_S15, 118, l1, l2);
  int lines = l2[0] ? 2 : 1;
  float y0 = (float)top + (104 - (14.3f + 19.5f * (float)lines)) / 2;
  if (side) cat(cat(ic, k->icon), " ▶");
  else cat(cat(ic, "◀ "), k->icon);
  int x = side ? 786 : 14, al = side ? 2 : 0;
  g_text_at(&F_S11, x, (int)(y0 + 11.5f), ic, C_ICON, al);
  uint16_t c = k->warn ? C_WARN : C_KEY;
  g_text_at(&F_S15, x, (int)(y0 + 29.8f), l1, c, al);
  if (lines == 2) g_text_at(&F_S15, x, (int)(y0 + 49.3f), l2, c, al);
}

static void keys(const skey_t *L, const skey_t *R) {
  for (int i = 0; i < 3; i++) {
    softkey(0, i, &L[i]);
    softkey(1, i, &R[i]);
  }
}

static void tabs(int on) {
  static const char *const T[4] = {"Работа", "Очистка", "Фильтр", "Журнал"};
  for (int i = 0; i < 4; i++) {
    float x = 150.0f + (float)i * 127;
    int act = i == on;
    g_rrect(x, 435.7f, 119, 30.3f, 6, act ? C_KEY : pressed == Z_TAB + i ? C_TOAST : C_TAB);
    g_text_at(&F_S14, (int)(x + 59.5f), 456, T[i], act ? C_INK : C_DIM, 1);
  }
}

static void header(const char *s) { g_text_at(&F_S20, 400, 37, s, C_TEXT, 1); }

/* Строка списка: выделенная (sel) — светлая плашка, в фокусе энкодера — значение в ‹ ›. */
static void item(int i, const char *label, const char *value, int sel, int focus) {
  int y = LIST_Y + i * ITEM_H;
  if (sel) g_rrect(MID_L, (float)y, MID_R - MID_L, ITEM_H, 5, C_KEY);
  else {
    if (focus || pressed == Z_ITEM + i) g_rrect(MID_L, (float)y, MID_R - MID_L, ITEM_H - 1, 5, focus ? C_TRACK : C_PRESS);
    g_fill(MID_L, y + ITEM_H - 1, MID_R - MID_L, 1, C_LINE);
  }
  g_text_at(&F_M18, MID_L + 12, y + 26, label, sel ? C_INK : C_GREY, 0);
  if (focus) {
    char s[40] = "‹ ";
    cat(cat(s, value), " ›");
    g_text_at(&F_M18, MID_R - 12, y + 26, s, C_WARN, 2);
  } else
    g_text_at(&F_M18, MID_R - 12, y + 26, value, sel ? C_INK : C_TEXT, 2);
}

/* Плашка-предупреждение (warnbox макета); ok — спокойный вариант, 2 — авария (красная). */
static void warnbox(float x, float y, float w, const char *title, const char *text, int ok) {
  uint16_t edge = ok == 1 ? C_GREEN : ok == 2 ? C_RED : C_WARN;
  g_rrect(x, y, w, 51.7f, 5, edge);
  g_rrect(x + 3, y, w - 3, 51.7f, 4, ok == 1 ? C_TAB : C_WBOX);
  g_text_at(&F_S16, (int)x + 15, (int)y + 23, title, ok == 1 ? C_GREEN_T : ok == 2 ? C_RED : C_WARN, 0);
  g_text_at(&F_S13, (int)x + 15, (int)y + 41, text, C_GREY, 0);
}

/* Карточка: small_first — подпись сверху (фильтр), иначе название сверху (пресеты). */
static void card(float x, float y, float w, const char *a, const char *b, int on, int small_first, int press) {
  g_rrect(x, y, w, 56.7f, 7, on ? C_GREEN : press ? C_TOAST : C_TAB);
  if (small_first) {
    g_text_at(&F_M13, (int)x + 12, (int)y + 25, a, on ? C_GREEN_C : C_DIM, 0);
    g_text_at(&F_S16, (int)x + 12, (int)y + 44, b, on ? C_GREEN_C : C_TEXT, 0);
  } else {
    g_text_at(&F_S16, (int)x + 12, (int)y + 25, a, on ? C_GREEN_C : C_TEXT, 0);
    g_text_at(&F_M13, (int)x + 12, (int)y + 44, b, on ? C_GREEN_C : C_DIM, 0);
  }
}

static void hint(int base, const char *s, uint16_t c) { g_text_at(&F_S13, 400, base, s, c, 1); }

/* ---------------- экран «Работа» ---------------- */

static void state_text(char *out, int *warn) {
  out[0] = 0;
  *warn = 0;
  if (!link_ok()) return;
  if (S.wl == 2) cat(out, "перелив!"), *warn = 1;
  else if (S.wl == 1) cat(out, "бак полон"), *warn = 1;
  else if (S.pg == 4) cat(out, "очистка перед остановкой"), *warn = 1;
  else if (S.pg == 3) cat(out, "удар отбивки"), *warn = 1;
  else if (S.pg) cat(out, S.pg == 2 ? "полная продувка" : "продувка"), *warn = 1;
  else if (!S.st) cat(out, "стоп");
  else if (S.e1 && S.e2) cat(out, "турбины 1 и 2");
  else cat(out, S.e1 ? "турбина 1" : "турбина 2");
}

static void gauge(float cx, float pct, int k) {
  const float cy = 224.6f;
  char s[40];
  int p = (int)(pct + 0.5f);
  int en = k ? S.e2 : S.e1, rl = k ? S.k2 : S.k1;
  float amps = k ? S.i2 : S.i1;
  g_ring(cx, cy, 46, 9, C_TRACK);
  if (p > 0) g_arc(cx, cy, 46, 9, (float)p / 100.0f, C_TEXT);
  g_text_at(&F_M27, (int)cx, (int)(cy - 2), link_ok() ? fnum(s, (float)p, 0) : "—", p ? C_TEXT : C_GAUGE0, 1);
  g_text_at(&F_M13, (int)cx, (int)(cy + 18), "%", C_ICON, 1);
  s[0] = 0;
  cat(s, k ? "турбина 2" : "турбина 1");
  if (p > 0) cat(s, " · "), catn(s, amps, 1), cat(s, " А");
  else if (en && rl) cat(s, " · пуск");
  else if (!en) cat(s, " · выкл");
  g_text_at(&F_S13, (int)cx, 301, s, en ? C_DIM : C_ICON, 1);
}

static void scr_work(void) {
  char s[96], st[48];
  int warn = filter_warn(), lk = link_ok();
  skey_t L[3] = {{"Режим", "⚙", 0}, {"Очистка", "≈", 0}, {warn ? "Фильтр !" : "Фильтр", "▤", warn}};
  skey_t R[3] = {{"Журнал", "▦", 0}, {"Продуть", "⚡", 0}, {"Сброс", "✕", 0}};
  keys(L, R);

  /* Верх: режим, состояние, беспроводной пульт. */
  const char *badge = !lk ? "нет связи" : S.md == 'a' ? "Авто" : "Ручной";
  int off = !lk || !S.st, stw;
  const char *bt = lk && S.bt == 2 ? "пульт" : "";
  state_text(st, &stw);
  int bw = g_text_w(&F_S14, badge, 0) + 24;
  int w1 = st[0] ? g_text_w(&F_M14, st, 0) : 0, w2 = bt[0] ? g_text_w(&F_M14, bt, 0) : 0;
  int x = 400 - (bw + (w1 ? 10 + w1 : 0) + (w2 ? 10 + w2 : 0)) / 2;
  if (pressed == Z_FLOW) g_rrect(MID_L, 14, MID_R - MID_L, 142, 10, C_PRESS);
  g_rrect((float)x, 18, (float)bw, 22.3f, 11, off ? C_OFF : C_GREEN);
  g_text_at(&F_S14, x + 12, 34, badge, !lk ? C_WARN : off ? C_GREY : C_GREEN_T, 0);
  x += bw;
  if (w1) g_text_at(&F_M14, x + 10, 34, st, stw ? C_WARN : C_DIM, 0), x += 10 + w1;
  if (w2) g_text_at(&F_M14, x + 10, 34, bt, C_GREEN_T, 0);

  /* Расход крупно. */
  char f[16] = "—";
  if (S.have) fnum(f, S.f, 1);
  int wf = g_text_w(&F_M82, f, -2) - 2, ws = g_text_w(&F_M22, " л/с", 0);
  int fx = 400 - (wf + ws) / 2;
  g_text(&F_M82, fx, 115, f, lk ? C_TEXT : C_GAUGE0, -2);
  g_text(&F_M22, fx + wf, 115, " л/с", C_DIM, 0);

  /* Уставка или мощность, скорость воздуха, разрежение. */
  s[0] = 0;
  if (S.have) {
    if (S.md == 'a') cat(s, "уставка "), catn(s, S.sp, 0);
    else cat(s, "мощность "), catn(s, S.pw, 0), cat(s, " %");
    cat(s, " · "), catn(s, S.v, 0), cat(s, " м/с · "), catn(s, S.va, 1), cat(s, " кПа");
  } else
    cat(s, "ждём контроллер…");
  g_text_at(&F_M16, 400, 149, s, C_SUB, 1);

  gauge(314, S.p1, 0);
  gauge(486, S.p2, 1);

  /* Неисправность — плашкой под турбинами. */
  int fb = top_fault();
  if (lk && fb >= 0) {
    s[0] = 0;
    cat(cat(s, "! "), FAULT[fb].text);
    int n = fault_count();
    if (n > 1) cat(s, "  +"), catn(s, (float)(n - 1), 0);
    warnbox(190, 324, 420, s, FAULT[fb].hint, (F_URGENT >> fb) & 1 ? 2 : 0);
  }

  /* Фильтр: загрузка, ход продувки или время до удара отбивки. */
  s[0] = 0;
  uint16_t rc = C_SUB;
  if (S.pg && S.pn) {
    cat(s, "удар ");
    catn(s, (float)S.pn, 0);
    if (S.pg != 3) cat(s, "/"), catn(s, (float)(S.pg == 4 ? C.n * 2 : C.n), 0);
    rc = C_WARN;
  } else if (S.pg) {
    cat(s, "разгон");
    rc = C_WARN;
  } else {
    catn(s, S.fl, 0), cat(s, " %");
    if (S.tp && S.ru) cat(s, " · удар через "), catn(s, (float)S.nt, 0), cat(s, " с");
  }
  int wl = g_text_w(&F_M14, "Фильтр", 0), wr = g_text_w(&F_M14, s, 0);
  if (pressed == Z_FBAR) g_rrect(146, 400, 508, 32, 8, C_PRESS);
  g_text_at(&F_M14, 150, 421, "Фильтр", C_SUB, 0);
  float tx = 150.0f + (float)wl + 12, tw = 650.0f - (float)wr - 12 - tx;
  g_bar(tx, 409.9f, tw, 12, S.fl / 100.0f, C_TRACK, warn ? C_WARN2 : C_FILL);
  g_text_at(&F_M14, 650, 421, s, rc, 2);
  tabs(0);
}

/* ---------------- «Режим» ---------------- */

static void scr_mode(void) {
  char s[40];
  skey_t L[3] = {{"Авто", "1", 0}, {"Ручной", "2", 0}, {"Выкл", "✕", 0}};
  skey_t R[3] = {{S.e1 ? "Турбина 1 стоп" : "Турбина 1 пуск", "1", 0}, {S.e2 ? "Турбина 2 стоп" : "Турбина 2 пуск", "2", 0}, {"Назад", "←", 0}};
  keys(L, R);
  header("Режим работы");
  item(0, "Авто — ПИД по расходу", S.md == 'a' ? "✓" : "", S.md == 'a', 0);
  item(1, "Ручной — фиксированная мощность", S.md == 'm' ? "✓" : "", S.md == 'm', 0);
  s[0] = 0;
  item(2, "Уставка расхода", cat(catn(s, S.sp, 0), " л/с"), 0, mode_focus == 2);
  s[0] = 0;
  item(3, "Мощность в ручном", cat(catn(s, S.pw, 0), " %"), 0, mode_focus == 3);
  item(4, "Турбина 1", S.e1 ? "вкл" : "выкл", 0, 0);
  item(5, "Турбина 2", S.e2 ? "вкл" : "выкл", 0, 0);
  item(6, "Вторая помогает регулятору", C.t2 ? "да" : "нет", 0, 0);
  item(7, "Пульт Bluetooth", S.bp ? "привязка…" : S.bt == 2 ? "на связи" : S.bt || C.bt ? "привязан" : "привязать", 0, 0);
  tabs(0);
}

/* ---------------- «Очистка» ---------------- */

static void scr_clean(void) {
  char s[96];
  skey_t L[3] = {{"Вверх", "▲", 0}, {"Вниз", "▼", 0}, {"Авто / выкл", "⇄", 0}};
  skey_t R[3] = {{"Продуть", "⚡", 0}, {"Полная", "⚡⚡", 0}, {"Назад", "←", 0}};
  keys(L, R);
  header(S.cl == 'a' ? "Очистка · авто" : "Очистка · выкл");
  for (int i = 0; i < NCLEAN; i++) {
    s[0] = 0;
    int v = *clean_val(i);
    if (i == 6) cat(s, v ? "вкл" : "выкл");
    else if (i == 5 && !v) cat(s, "выкл");
    else catn(s, (float)v, 0), cat(s, CLEAN_UNIT[i]);
    item(i, CLEAN_LABEL[i], s, i == clean_sel, 0);
  }
  hint(352, "энкодер меняет выделенный параметр, его кнопка — следующий", C_ICON);
  s[0] = 0;
  uint16_t c = C_ICON;
  if (S.pg && S.pg != 3) {
    cat(s, S.pg == 4 ? "очистка перед остановкой" : S.pg == 2 ? "идёт полная продувка" : "идёт продувка");
    if (S.pn) cat(s, ": удар "), catn(s, (float)S.pn, 0);
    c = C_WARN;
  } else if (S.cl != 'a')
    cat(s, C.tap ? "серии выключены, отбивка по времени работает" : "автоочистка выключена — только кнопкой «Продуть»");
  else {
    if (S.pe) cat(s, "серия каждые "), catn(s, (float)S.pe, 0), cat(s, " с и по порогу R");
    else cat(s, "серия по порогу R");
    if (C.tap) cat(s, " · удар каждые "), catn(s, (float)C.tap, 0), cat(s, " с");
  }
  hint(374, s, c);
  tabs(1);
}

/* ---------------- «Фильтр» ---------------- */

static void scr_filter(void) {
  char a[40], b[40];
  skey_t L[3] = {{"Фильтр новый", "✓", 0}, {"Сброс счётчика", "↺", 0}, {"История", "▦", 0}};
  skey_t R[3] = {{"Продуть", "⚡", 0}, {"Полная", "⚡⚡", 0}, {"Назад", "←", 0}};
  keys(L, R);
  header("Фильтр 180×320");
  int wash = (S.fa >> F_FILTER_BIT) & 1, torn = (S.fa >> F_TORN_BIT) & 1;
  a[0] = 0;
  if (S.ra > 0) cat(cat(catn(cat(a, "продувка снимает "), S.sm, 0), " %"), " сопротивления");
  else cat(a, "продувка восстанавливает сопротивление");
  if (torn) warnbox(MID_L, 51.3f, MID_R - MID_L, "! Фильтр порван или не стоит", "перепада почти нет — пыль идёт в турбины", 2);
  else if (wash) warnbox(MID_L, 51.3f, MID_R - MID_L, "! Пора обслужить", "продувка перестала восстанавливать сопротивление", 0);
  else if (S.rn <= 0) warnbox(MID_L, 51.3f, MID_R - MID_L, "Обучение", "R нового фильтра определится после первой продувки", 1);
  else if (S.fl > 70) warnbox(MID_L, 51.3f, MID_R - MID_L, "Фильтр загружен", "скоро продувка — или нажмите «Продуть»", 0);
  else warnbox(MID_L, 51.3f, MID_R - MID_L, "Фильтр в норме", a, 1);

  a[0] = 0;
  cat(catn(a, S.fl, 0), " %");
  int wr = g_text_w(&F_M15, a, 0);
  g_bar(MID_L, 116, (float)(MID_R - MID_L - wr - 12), 12, S.fl / 100.0f, C_TRACK, filter_warn() ? C_WARN2 : C_FILL);
  g_text_at(&F_M15, MID_R, 127, a, filter_warn() ? C_WARN2 : C_SUB, 2);

  const char *lab[6] = {"R сейчас", "после удара", "R нового", "порог мойки", "перепад, Па", "ударов"};
  for (int i = 0; i < 6; i++) {
    b[0] = 0;
    float v[4] = {S.r, S.ra, S.rn, S.rw};
    if (i < 4) {
      if (v[i] > 0) catn(b, v[i], 1);
      else cat(b, "—");
    } else if (i == 4)
      catn(b, S.dp, 0);
    else
      catn(b, (float)S.pc, 0);
    card(MID_L + (float)(i & 1) * 246, 140.5f + (float)(i >> 1) * 64.7f, 238, lab[i], b, 0, 1, 0);
  }
  tabs(2);
}

/* ---------------- «Журнал» ---------------- */

static char *hours(char *out, float h) {
  out[0] = 0;
  return cat(catn(out, h, h < 10 ? 1 : 0), " ч");
}

static void chart(float x, float y, float w, float h, int range) {
  int n = J.nrh < range ? J.nrh : range;
  const float *v = J.rh + (J.nrh - n);
  if (n < 2) {
    hint((int)(y + h / 2 + 5), n ? "точка появляется после каждой смены" : "данных пока нет", C_ICON);
    return;
  }
  float lo = v[0], hi = v[0];
  for (int i = 1; i < n; i++) {
    if (v[i] < lo) lo = v[i];
    if (v[i] > hi) hi = v[i];
  }
  if (hi - lo < 1) hi = lo + 1;
  float px = 0, py = 0;
  for (int i = 0; i < n; i++) {
    float cx = x + 4 + (w - 8) * (float)i / (float)(n - 1);
    float cy = y + h - 8 - (h - 16) * (v[i] - lo) / (hi - lo);
    if (i) g_line(px, py, cx, cy, 2, C_WARN2);
    px = cx, py = cy;
  }
}

static void scr_log(void) {
  char s[96], t[48];
  skey_t L[3] = {{"Смены", "▤", 0}, {"Аварии", "!", 0}, {"Экспорт", "↓", 0}};
  skey_t R[3] = {{"Неделя", "7", 0}, {"Месяц", "30", 0}, {"Назад", "←", 0}};
  keys(L, R);
  if (log_view == 1) {
    header("Журнал · аварии");
    if (!nal) hint(90, "аварий не было", C_ICON);
    for (int i = 0; i < nal && i < 8; i++) {
      int k = nal - 1 - i;
      s[0] = 0;
      if (!AL[k].off) cat(s, "идёт");
      else {
        uint32_t ago = (now - AL[k].on) / 1000;
        if (ago < 60) catn(s, (float)ago, 0), cat(s, " с назад");
        else if (ago < 3600) catn(s, (float)(ago / 60), 0), cat(s, " мин назад");
        else catn(s, (float)(ago / 3600), 0), cat(s, " ч назад");
      }
      item(i, FAULT[AL[k].bit].text, s, 0, 0);
    }
    tabs(3);
    return;
  }
  header("Журнал");
  item(0, "Турбина 1 · наработка", hours(s, J.h1), 0, 0);
  item(1, "Турбина 1 · приведённые", hours(s, J.w1), 0, 0);
  item(2, "Турбина 2 · приведённые", hours(s, J.w2), 0, 0);
  int k2 = J.w2 > J.w1;
  float left = (float)C.bl - (k2 ? J.w2 : J.w1);
  t[0] = 0;
  cat(t, k2 ? "Щётки турбины 2" : "Щётки турбины 1");
  s[0] = 0;
  if (left > 0) cat(s, "через "), catn(s, left, 0), cat(s, " ч");
  else cat(s, "пора менять");
  item(3, t, s, 0, 0);
  s[0] = 0;
  cat(s, "R чистый по сменам · последние "), catn(s, (float)log_range, 0);
  g_text_at(&F_S13, MID_L, 233, s, C_DIM, 0);
  chart(MID_L, 238.4f, MID_R - MID_L, 62, log_range);
  s[0] = 0;
  cat(s, "клапаны, ток втягивания / удержания: 1 — ");
  catn(s, J.vi1, 2), cat(s, " / "), catn(s, J.vh1, 2), cat(s, " А, 2 — ");
  catn(s, J.vi2, 2), cat(s, " / "), catn(s, J.vh2, 2), cat(s, " А");
  hint(326, s, C_ICON);
  tabs(3);
}

/* ---------------- «Пресеты» ---------------- */

static void scr_preset(void) {
  char s[64];
  skey_t L[3] = {{"Бетон", "1", 0}, {"Бурение", "2", 0}, {"Гипс", "3", 0}};
  skey_t R[3] = {{"Уборка", "4", 0}, {preset_edit ? "Правка: отбивка" : "Правка", "✎", 0}, {"Пуск", "▶", 0}};
  keys(L, R);
  header("Пресеты");
  for (int i = 0; i < 4; i++) {
    int sel = i == preset_sel;
    s[0] = 0;
    if (sel && !preset_edit) cat(s, "‹"), catn(s, (float)C.psp[i], 0), cat(s, "›");
    else catn(s, (float)C.psp[i], 0);
    cat(s, " л/с · ");
    if (sel && preset_edit) cat(s, "‹");
    if (C.ptp[i]) cat(s, "удар "), catn(s, (float)C.ptp[i], 0), cat(s, " с");
    else if (C.per[i]) cat(s, "серия "), catn(s, (float)C.per[i], 0), cat(s, " с");
    else cat(s, "по порогу");
    if (sel && preset_edit) cat(s, "›");
    card(MID_L + (float)(i & 1) * 246, 55.3f + (float)(i >> 1) * 64.7f, 238, PRESET_NAME[i], s, sel, 0, pressed == Z_CARD + i);
  }
  hint(201, preset_edit ? "энкодер меняет отбивку · «Правка» — расход" : "энкодер меняет расход · «Правка» — отбивку", C_ICON);
  s[0] = 0;
  if (S.pr >= 0 && S.pr < 4) cat(cat(cat(s, "сейчас работает «"), PRESET_KEY[S.pr]), "» · «Пуск» — применить");
  else cat(s, "«Пуск» — применить и включить");
  hint(222, s, C_ICON);
  tabs(0);
}

/* ---------------- сон ---------------- */

static void scr_sleep(void) {
  g_text_at(&F_S20, 400, 230, "Выключено", C_ICON, 1);
  g_text_at(&F_S13, 400, 258, "любая кнопка, касание или пульт — включить", HEX(0x3a3a36), 1);
}

/* ---------------- кадр ---------------- */

static void draw(void) {
  g_fill(0, 0, GW, GH, C_BG);
  if (s3_sleeping()) {
    scr_sleep();
    return;
  }
  switch (screen) {
  case W_WORK: scr_work(); break;
  case W_MODE: scr_mode(); break;
  case W_CLEAN: scr_clean(); break;
  case W_FILTER: scr_filter(); break;
  case W_LOG: scr_log(); break;
  case W_PRESET: scr_preset(); break;
  }
  if (toast_till) {
    int w = g_text_w(&F_S14, toast_s, 0) + 36;
    g_rrect((float)(400 - w / 2), 372, (float)w, 30, 15, C_TOAST);
    g_text_at(&F_S14, 400, 392, toast_s, C_TEXT, 1);
  }
}

/* ---------------- касания и кнопки ---------------- */

static int list_len(void) {
  if (screen == W_MODE) return 8;
  if (screen == W_CLEAN) return NCLEAN;
  return 0;
}

static int hit(int x, int y) {
  if (y >= 26 && y < 338 && (x < 150 || x >= 650)) return (x < 150 ? Z_KL : Z_KR) + (y - 26) / 104;
  if (x >= 150 && x < 650 && y >= 426) return Z_TAB + clampi((x - 150) / 127, 0, 3);
  if (x < MID_L - 8 || x >= MID_R + 8) return Z_NONE;
  int n = list_len();
  if (n && y >= LIST_Y && y < LIST_Y + n * ITEM_H) return Z_ITEM + (y - LIST_Y) / ITEM_H;
  if (screen == W_PRESET && y >= 55 && y < 185) return Z_CARD + ((y - 55) / 65) * 2 + (x >= 400);
  if (screen == W_WORK && y >= 14 && y < 160) return Z_FLOW;
  if (screen == W_WORK && y >= 398 && y < 434) return Z_FBAR;
  return Z_NONE;
}

static void pair_remote(void) {
  cmd("remote pair");
  toast("Привязка: зажмите обе кнопки пульта на 5 с рядом с пылесосом");
}

static void act(int z) {
  if (z >= Z_TAB && z < Z_TAB + 4) {
    static const uint8_t T[4] = {W_WORK, W_CLEAN, W_FILTER, W_LOG};
    if (T[z - Z_TAB] == W_LOG) log_view = 0;
    go(T[z - Z_TAB]);
    return;
  }
  int kl = z >= Z_KL && z < Z_KL + 3 ? z - Z_KL : -1, kr = z >= Z_KR && z < Z_KR + 3 ? z - Z_KR : -1;
  int it = z >= Z_ITEM && z < Z_CARD ? z - Z_ITEM : -1;
  if (kr == 2 && screen != W_WORK && screen != W_PRESET) {
    go(W_WORK);
    return;
  }
  switch (screen) {
  case W_WORK:
    if (kl == 0 || z == Z_FLOW) go(W_MODE);
    else if (kl == 1) go(W_CLEAN);
    else if (kl == 2 || z == Z_FBAR) go(W_FILTER);
    else if (kr == 0) log_view = 0, go(W_LOG);
    else if (kr == 1) purge(0);
    else if (kr == 2) {
      cmd("ack");
      toast(S.fa ? "Аварии сброшены" : "Аварий нет");
    }
    break;
  case W_MODE:
    if (kl == 0 || it == 0) set_mode('a');
    else if (kl == 1 || it == 1) set_mode('m');
    else if (kl == 2 && confirmed(z, "выключить (с очисткой фильтра)")) {
      cmd("off");
      toast("Выключение: очистка фильтра и сон");
    } else if (kr == 0 || it == 4) turbine(0);
    else if (kr == 1 || it == 5) turbine(1);
    else if (it == 6) {
      C.t2 = !C.t2;
      hold("t2");
      send_int("t2allow ", C.t2);
    } else if (it == 7)
      pair_remote();
    else if (it == 2 || it == 3)
      mode_focus = it;
    break;
  case W_CLEAN:
    if (kl == 0) clean_sel = (clean_sel + NCLEAN - 1) % NCLEAN;
    else if (kl == 1) clean_sel = (clean_sel + 1) % NCLEAN;
    else if (kl == 2) {
      S.cl = S.cl == 'a' ? 'o' : 'a';
      hold("cl");
      cmd(S.cl == 'a' ? "clean a" : "clean o");
    } else if (kr == 0) purge(0);
    else if (kr == 1) purge(1);
    else if (it >= 0) {
      if (it == clean_sel && it == 6) change_clean(6, 1);
      clean_sel = it;
    }
    break;
  case W_FILTER:
    if (kl == 0 && confirmed(z, "фильтр новый")) {
      cmd("filter new");
      toast("Фильтр новый: R нового — после продувки");
    } else if (kl == 1 && confirmed(z, "сброс счётчика ударов")) {
      cmd("pulses reset");
      S.pc = 0;
      toast("Счётчик ударов сброшен");
    } else if (kl == 2)
      log_view = 0, go(W_LOG);
    else if (kr == 0) purge(0);
    else if (kr == 1) purge(1);
    break;
  case W_LOG:
    if (kl == 0) log_view = 0;
    else if (kl == 1) log_view = 1;
    else if (kl == 2) {
      cmd("export");
      toast("Журнал выгружен в порт USB контроллера");
    } else if (kr == 0) log_range = 7, log_view = 0;
    else if (kr == 1) log_range = 30, log_view = 0;
    break;
  case W_PRESET:
    if (kl >= 0) preset_sel = kl;
    else if (kr == 0) preset_sel = 3;
    else if (kr == 1) preset_edit = !preset_edit;
    else if (kr == 2) apply_preset();
    else if (z >= Z_CARD && z < Z_CARD + 4) preset_sel = z - Z_CARD;
    break;
  }
  dirty = 1;
}

void s3_touch(int x, int y, int down) {
  if (s3_sleeping()) {
    /* Экран погашен: касание будит контроллер, само касание ничего не нажимает. */
    if (down && !touch_down) cmd("wake");
    touch_down = down;
    pressed = Z_NONE;
    return;
  }
  if (down && !touch_down) {
    touch_down = 1;
    pressed = hit(x, y);
    dirty = 1;
  } else if (down) {
    if (pressed != Z_NONE && hit(x, y) != pressed) pressed = Z_NONE, dirty = 1;
  } else if (touch_down) {
    touch_down = 0;
    int z = pressed;
    pressed = Z_NONE;
    if (z != Z_NONE) act(z);
    dirty = 1;
  }
}

/* ---------------- вход ---------------- */

void s3_setup(uint16_t *fb) {
  g_init(fb);
  phal_log("Пульт пылесоса S3: экран 800×480, кнопки у экрана и энкодер — через контроллер");
  dirty = 1;
}

int s3_loop(uint32_t ms) {
  now = ms;
  if (ms - hb_at >= 500) {
    hb_at = ms;
    cmd("hi");
  }
  int lk = link_ok();
  if (lk != link_prev) {
    link_prev = lk;
    dirty = 1;
    if (lk) cmd("get"), get_at = ms;
  }
  if (lk && !C.have && ms - get_at > 2000) cmd("get"), get_at = ms;
  int sl = s3_sleeping();
  if (sl != sleep_prev) sleep_prev = sl, dirty = 1;
  if (toast_till && (int32_t)(toast_till - ms) <= 0) toast_till = 0, dirty = 1;
  if (flash_zone != Z_NONE && (int32_t)(flash_till - ms) <= 0) flash_zone = Z_NONE, dirty = 1;
  if (ms - sec_at >= 1000) {
    sec_at = ms;
    if (screen == W_LOG) dirty = 1;
  }
  if (dirty && ms - drawn_at >= 40) {
    draw();
    dirty = 0;
    drawn_at = ms;
    return 1;
  }
  return 0;
}
