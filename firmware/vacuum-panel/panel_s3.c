/*
 * Экраны пульта для контроллера «S3» (firmware/vacuum-s3): «Работа», «Режим», «Очистка»
 * (режимы очистки и их удары), «Фильтр» (паспорт фильтров А и Б, замер, мешок, фильтр
 * клапанов), «Розетка» (автозапуск, предел тока, устройства Bluetooth), «Журнал», «Телефон»
 * (сеть Wi-Fi и QR-код для обновления и резервной копии), выбор режима. Поверх любого экрана —
 * окно перегрузки розетки (решение обязательно) и подсказка мощной очистки («закройте шланг»).
 * Подписи по бокам экрана — три слева и три справа — стоят напротив физических кнопок корпуса:
 * нажатие кнопки (строка «E k=N» от контроллера) и касание подписи делают одно и то же, подпись
 * на мгновение подсвечивается. Энкодер внизу посередине меняет выделенное значение, его
 * кнопка — выбор (работает и в перчатках, без касаний). «Выкл» на контроллере гасит экран
 * («P off»), любая кнопка или касание — будит. Значения приходят от контроллера строками,
 * команды уходят туда же; пока ответ не пришёл, пульт показывает новое значение сразу (поле
 * «придерживается» 0,6 с).
 */
#include "panel_int.h"
#include "gfx.h"
#include "qr.h"

/* Метка прошивки: по ней контроллер и сам экран узнают файл при обновлении. Внутри прошивки
 * контроллера (экран на нём самом, sync-panel.sh задаёт PANEL_IN_CTRL) её быть не должно: иначе
 * файл контроллера приняли бы за прошивку экрана. */
#ifdef PANEL_IN_CTRL
static const char PANEL_MARK[] = "Экран на контроллере, интерфейс " PANEL_VERSION;
#else
const char PANEL_MARK[] __attribute__((used)) = "VACFW:PANEL:" PANEL_VERSION;
#endif

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

#define NPR 7
/* Строка «S»: состояние (каждые 100 мс). */
static struct {
  int have;
  uint32_t at;
  int st, sl;         /* турбины включены кнопками; «Выкл» (сон) */
  char md, cl;        /* режим: a — авто, m — ручной; очистка: a — авто, o — выкл */
  int pr;             /* режим очистки 0…6 */
  int e1, e2, k1, k2; /* турбины включены, реле замкнуты */
  int ru;             /* турбины крутятся */
  int pg, pn, sd;     /* очистка (1 — серия, 2 — мощная, 4 — перед остановкой), удар, очистка перед остановкой */
  int hz, hc;         /* мощная ждёт закрытый шланг; шланг закрыт */
  int nx;             /* до серии, с */
  int wl, fs, bt, bp; /* вода: 0/1/2; поплавок; пульт Bluetooth: 0/1/2; окно привязки */
  int so, tl, ov, cp, au; /* розетка; инструмент (1 — розетка, 2 — метка); перегрузка; ограничение турбин; автозапуск */
  float f, sp, pw, v, va, p1, p2, i1, i2, t1, t2, fl, dp, r, ra, sm, mv, ta, ia;
  uint32_t fa;
} S = {.md = 'a', .cl = 'a', .sp = 32, .pw = 80, .t1 = 25, .t2 = 25};

/* Строка «F»: розетка, замер фильтра, «Авто», удары, клапаны, метки (каждые 0,5 с). */
static struct {
  int oc, o1;          /* перегрузка: предложение — турбины до oc %, o1 — одна турбина */
  float ot, ou;        /* перегрузка: ток инструмента и турбин, А */
  int fm, fx, fg;      /* замер фильтра: 1 — идёт, 2 — готов; осталось, с; похоже на другой фильтр */
  float fq, fp;        /* замер: R и насколько близко к новому, % */
  int dl, dk, ev, nn, im; /* «Авто»: пыли, вид пыли, промежуток, ударов, длина удара */
  float ih, dh;        /* сила удара, %; провал разрежения, % */
  int v1, v2, tg, tb, wf;
  long pc;
} F = {.fg = -1, .ih = 100};

/* Строка «C»: настройки. */
static struct {
  int have;
  int coff, ha, sn, thr, dpo, dpc, t2, wl, bl, bt;
  int ps[NPR][6];      /* режимы: уставка, ударов, промежуток, удар, пауза, флаги */
  int ta, tt, tr, te, tm, tf, td; /* розетка: автозапуск, порог ×0,1 А, выбег, удары после, предел, без пылесоса, задержка */
  int fi, bg, ip;      /* какой фильтр стоит, мешок, ударов с замены фильтра клапанов */
  float rb;
  float fr[2][5];      /* фильтры А, Б: R нового, R сейчас, моек, часов, ударов */
  int fst[2];          /* каким поставили: 1 — новый, 2 — отмыт, 3 — продут */
  int dk[4], dn[4];    /* устройства Bluetooth: вид (1 — пульт, 2 — метка), номер */
  int wf;
} C = {.coff = 1, .ha = 1, .sn = 4, .thr = 115, .t2 = 1, .wl = 300, .bl = 800,
       .ps = {{32, 0, 0, 0, 0, 1}, {36, 3, 15, 40, 300, 1}, {30, 1, 30, 40, 0, 0}, {32, 2, 20, 50, 0, 1}, {28, 1, 60, 40, 0, 1}, {30, 2, 30, 40, 0, 1}, {30, 0, 0, 0, 0, 2}},
       .ta = 1, .tt = 3, .tr = 4, .te = 3, .tm = 24, .td = 500};

/* Строка «J»: журнал. */
static struct {
  int have;
  float h1, w1, h2, w2;
  float rh[30];
  int nrh;
} J;

/* Строка «W»: сеть для телефона. */
static char wifi_ssid[28], wifi_pass[16];
static qr_t qr;
static int qr_ok;

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

#define NF 32
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
    {"Клапан 1 неисправен", ""},
    {"Клапан 2 неисправен", ""},
    {"Фильтр порван или не стоит", "пыль идёт в турбины — проверьте фильтр"},
    {"Нет связи с кнопками", "расширитель PCA9555 не отвечает"},
    {"Электроды: проверьте", "вода на верхнем без нижнего — грязь или обрыв"},
    {"Проверьте фильтр клапанов", "удар ослаб — фильтр на входе клапанов забит"},
    {"Фильтр не отбивается", "липкая пыль: мощная очистка (шланг ладонью) или мойка"},
    {"Удар слабый", "широкий шланг: закройте его ладонью на 2 с — мощная очистка"},
};
/* Порядок важности: какую неисправность показать на экране «Работа». */
static const uint8_t FAULT_ORDER[NF] = {21, 22, 23, 26, 20, 0, 11, 12, 1, 2, 7, 8, 14, 13, 9, 10, 24, 25, 15, 31, 30, 29, 3, 4, 5, 6, 16, 17, 18, 19, 27, 28};
#define F_FILTER_BIT 15
#define F_TORN_BIT 26
#define F_URGENT ((1UL << 20) | (1UL << 21) | (1UL << 22) | (1UL << 23) | (1UL << 26))

static const char *const VERR[7] = {"", "обрыв катушки или её провода", "замыкание катушки — клапан отключён", "не открывается: заклинил, нет 230 В, обрыв катушки или SSR", "ключ пробит — клапан всегда открыт",
                                     "тарелка не садится: грязь в седле, пружины", "магнит не держит тарелку: обрыв, нет 230 В, SSR"};

static const char *fault_hint(int b) {
  if (b == 24) return VERR[F.v1 >= 0 && F.v1 < 7 ? F.v1 : 0];
  if (b == 25) return VERR[F.v2 >= 0 && F.v2 < 7 ? F.v2 : 0];
  return FAULT[b].hint;
}

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

static int filter_warn(void) { return S.fl > 70 || ((S.fa >> F_FILTER_BIT) & 1) || ((S.fa >> F_TORN_BIT) & 1) || ((S.fa >> 30) & 1); }

/* ---------------- состояние интерфейса ---------------- */

enum { W_WORK, W_MODE, W_CLEAN, W_FILTER, W_FILTER2, W_TOOL, W_BLE, W_PHONE, W_LOG, W_PRESET };
enum { Z_NONE = -1, Z_KL = 0, Z_KR = 3, Z_TAB = 6, Z_ITEM = 12, Z_CARD = 24, Z_FLOW = 32, Z_FBAR = 33, Z_FBOX = 34 };
#define NTABS 5

static int screen = W_WORK;
static int pressed = Z_NONE, touch_down;
static int flash_zone = Z_NONE;
static uint32_t flash_till;
static int mode_focus = 2, clean_sel, preset_sel, log_view, log_range = 7, f2_sel, tool_sel, ble_sel;
static int dirty = 1;
static uint32_t drawn_at, hb_at, get_at, sec_at;
static int link_prev, sleep_prev, ov_prev, pg_prev, fm_prev;
static char toast_s[96];
static uint32_t toast_till;
static int confirm_zone = Z_NONE;
static uint32_t confirm_till;

static const char *const PRESET_NAME[NPR] = {"Авто", "Бетон, штроба", "Бурение", "Гипс, шпаклёвка", "Уборка", "Мешок", "Вода"};

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
  char s[96] = "Нажмите ещё раз: ";
  toast(cat(s, what));
  return 0;
}

/* ---------------- разбор строк контроллера ---------------- */

static void s_field(const char *k, const char *v) {
  if (seq(k, "e1")) detected = 1;
  if (held(k)) return;
  float x = pnum(v);
  int i = (int)x;
  if (seq(k, "st")) S.st = i;
  else if (seq(k, "sl")) S.sl = i;
  else if (seq(k, "md")) S.md = v[0];
  else if (seq(k, "cl")) S.cl = v[0];
  else if (seq(k, "pr")) S.pr = clampi(i, 0, NPR - 1);
  else if (seq(k, "e1")) S.e1 = i;
  else if (seq(k, "e2")) S.e2 = i;
  else if (seq(k, "k1")) S.k1 = i;
  else if (seq(k, "k2")) S.k2 = i;
  else if (seq(k, "ru")) S.ru = i;
  else if (seq(k, "pg")) S.pg = i;
  else if (seq(k, "pn")) S.pn = i;
  else if (seq(k, "hz")) S.hz = i;
  else if (seq(k, "hc")) S.hc = i;
  else if (seq(k, "sd")) S.sd = i;
  else if (seq(k, "nx")) S.nx = i;
  else if (seq(k, "wl")) S.wl = i;
  else if (seq(k, "fs")) S.fs = i;
  else if (seq(k, "bt")) S.bt = i;
  else if (seq(k, "bp")) S.bp = i;
  else if (seq(k, "so")) S.so = i;
  else if (seq(k, "tl")) S.tl = i;
  else if (seq(k, "ov")) S.ov = i;
  else if (seq(k, "cp")) S.cp = i;
  else if (seq(k, "au")) S.au = i;
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
  else if (seq(k, "sm")) S.sm = x;
  else if (seq(k, "mv")) S.mv = x;
  else if (seq(k, "ta")) S.ta = x;
  else if (seq(k, "ia")) S.ia = x;
  else if (seq(k, "fa")) S.fa = (uint32_t)pint(v);
}

static void f_field(const char *k, const char *v) {
  float x = pnum(v);
  int i = (int)pint(v);
  if (seq(k, "oc")) F.oc = i;
  else if (seq(k, "o1")) F.o1 = i;
  else if (seq(k, "ot")) F.ot = x;
  else if (seq(k, "ou")) F.ou = x;
  else if (seq(k, "fm")) F.fm = i;
  else if (seq(k, "fx")) F.fx = i;
  else if (seq(k, "fq")) F.fq = x;
  else if (seq(k, "fp")) F.fp = x;
  else if (seq(k, "fg")) F.fg = i;
  else if (seq(k, "dl")) F.dl = i;
  else if (seq(k, "dk")) F.dk = i;
  else if (seq(k, "ev")) F.ev = i;
  else if (seq(k, "nn")) F.nn = i;
  else if (seq(k, "im")) F.im = i;
  else if (seq(k, "ih")) F.ih = x;
  else if (seq(k, "dh")) F.dh = x;
  else if (seq(k, "v1")) F.v1 = i;
  else if (seq(k, "v2")) F.v2 = i;
  else if (seq(k, "tg")) F.tg = i;
  else if (seq(k, "tb")) F.tb = i;
  else if (seq(k, "wf")) F.wf = i;
  else if (seq(k, "pc")) F.pc = pint(v);
}

/* «12/3/4» → числа по слэшам. */
static int slash(const char *v, float *out, int n) {
  int got = 0;
  while (*v && got < n) {
    out[got++] = pnum(v);
    while (*v && *v != '/') v++;
    if (*v) v++;
  }
  return got;
}

static void c_field(const char *k, const char *v) {
  if (held(k)) return;
  int x = (int)pint(v);
  if (seq(k, "coff")) C.coff = x;
  else if (seq(k, "ha")) C.ha = x;
  else if (seq(k, "sn")) C.sn = x;
  else if (seq(k, "thr")) C.thr = x;
  else if (seq(k, "dpo")) C.dpo = x;
  else if (seq(k, "dpc")) C.dpc = x;
  else if (seq(k, "t2")) C.t2 = x;
  else if (seq(k, "wl")) C.wl = x;
  else if (seq(k, "bl")) C.bl = x;
  else if (seq(k, "bt")) C.bt = x;
  else if (seq(k, "ta")) C.ta = x;
  else if (seq(k, "tt")) C.tt = x;
  else if (seq(k, "tr")) C.tr = x;
  else if (seq(k, "te")) C.te = x;
  else if (seq(k, "tm")) C.tm = x;
  else if (seq(k, "tf")) C.tf = x;
  else if (seq(k, "td")) C.td = x;
  else if (seq(k, "fi")) C.fi = x;
  else if (seq(k, "bg")) C.bg = x;
  else if (seq(k, "ip")) C.ip = x;
  else if (seq(k, "rb")) C.rb = pnum(v);
  else if (seq(k, "wf")) C.wf = x;
  else if (k[0] == 'P' && k[1] >= '0' && k[1] < '0' + NPR && !k[2]) {
    float f[6];
    int n = slash(v, f, 6), i = k[1] - '0';
    for (int j = 0; j < n; j++) C.ps[i][j] = (int)f[j];
  } else if (k[0] == 'F' && (k[1] == 'A' || k[1] == 'B') && !k[2]) {
    float f[6] = {0};
    int i = k[1] == 'B';
    slash(v, f, 6);
    for (int j = 0; j < 5; j++) C.fr[i][j] = f[j];
    C.fst[i] = (int)f[5];
  } else if (k[0] == 'D' && k[1] >= '0' && k[1] <= '3' && !k[2]) {
    float f[2] = {0};
    slash(v, f, 2);
    C.dk[k[1] - '0'] = (int)f[0];
    C.dn[k[1] - '0'] = (int)f[1];
  } else
    s_field(k, v); /* pw, md, cl, pr — общие со строкой состояния */
}

static void j_field(const char *k, const char *v) {
  if (seq(k, "h1")) J.h1 = pnum(v);
  else if (seq(k, "w1")) J.w1 = pnum(v);
  else if (seq(k, "h2")) J.h2 = pnum(v);
  else if (seq(k, "w2")) J.w2 = pnum(v);
  else if (seq(k, "rh")) {
    J.nrh = 0;
    while (*v && J.nrh < 30) {
      J.rh[J.nrh++] = pnum(v);
      while (*v && *v != '/') v++;
      if (*v) v++;
    }
  }
}

/* «W s=Pylesos-S3-1A2B p=k7f3m9q2» — сеть для телефона и QR-код «подключиться». */
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
  if (type == 'W' && s[1] == ' ') {
    w_line(s + 2);
    dirty = 1;
    return;
  }
  if ((type != 'S' && type != 'C' && type != 'J' && type != 'F') || (s[1] != ' ' && s[1])) return;
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
    else if (type == 'F') f_field(k, v);
    else if (type == 'C') c_field(k, v);
    else j_field(k, v);
  }
  if (type == 'S') {
    S.have = 1;
    S.at = now;
    alarms_update();
  } else if (type == 'C')
    C.have = 1;
  else if (type == 'J')
    J.have = 1;
  dirty = 1;
}

static char rx_line[720];
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
  C.ps[S.pr][0] = (int)S.sp;
  hold("sp");
  send_int("sp ", (int)S.sp);
}

static void change_pw(int d) {
  S.pw = (float)clampi((int)(S.pw + 0.5f) + d * 5, 30, 100);
  hold("pw");
  send_int("pw ", (int)S.pw);
}

/* Режим очистки i целиком: «pset I SP N EVERY IMP PAUSE FLAGS». */
static void send_pset(int i) {
  char s[80] = "pset ", k[4] = "P0";
  k[1] = (char)('0' + i);
  hold(k);
  catn(s, (float)i, 0);
  for (int j = 0; j < 6; j++) cat(s, " "), catn(s, (float)C.ps[i][j], 0);
  cmd(s);
}

static void set_preset(int i) {
  i = clampi(i, 0, NPR - 1);
  S.pr = i;
  hold("pr");
  S.sp = (float)C.ps[i][0];
  hold("sp");
  send_int("preset ", i);
}

static void purge(int strong) {
  cmd(strong ? "purge strong" : "purge");
  if (S.pg && S.pg != 4) toast("Очистка остановлена");
  else toast(strong ? "Мощная очистка: закройте шланг ладонью" : "Продувка: серия ударов");
}

static void filter_cmd(const char *what) {
  char s[40] = "filter ";
  cat(s, C.fi ? "б " : "а ");
  cmd(cat(s, what));
}

/* ---------------- значения в списках ---------------- */

/* «Очистка»: 0 — режим, 1 — ударов, 2 — промежуток, 3 — удар, 4 — пауза, 5 — мощная по шлангу, 6 — при остановке. */
#define NCLEAN 7
static const char *const CLEAN_LABEL[NCLEAN] = {"Режим", "Ударов в серии", "Промежуток", "Длина удара", "Пауза между ударами", "Мощная по закрытому шлангу", "Удары при остановке"};

static void change_clean(int i, int d) {
  int *p = C.ps[S.pr];
  switch (i) {
  case 0: set_preset(S.pr + d); return;
  case 1: p[1] = clampi(p[1] + d, 0, 10); break;
  case 2: p[2] = p[2] + d * 5 < 5 ? (d > 0 ? 5 : 0) : clampi(p[2] + d * 5, 0, 120); break;
  case 3: p[3] = p[3] + d * 5 < 20 ? (d > 0 ? 20 : 0) : clampi(p[3] + d * 5, 0, 300); break;
  case 4: p[4] = p[4] + d * 50 < 100 ? (d > 0 ? 100 : 0) : clampi(p[4] + d * 50, 0, 3000); break;
  case 5: p[5] ^= 1; break;
  case 6:
    C.coff = !C.coff;
    hold("coff");
    send_int("coff ", C.coff);
    return;
  }
  send_pset(S.pr);
}

static void clean_value(int i, char *s) {
  const int *p = C.ps[S.pr];
  s[0] = 0;
  switch (i) {
  case 0: cat(s, PRESET_NAME[S.pr]); break;
  case 1: p[1] ? catn(s, (float)p[1], 0) : cat(s, "сам"); break;
  case 2: p[2] ? cat(catn(s, (float)p[2], 0), " с") : cat(s, "сам"); break;
  case 3: p[3] ? cat(catn(s, (float)p[3], 0), " мс") : cat(s, "сам"); break;
  case 4: p[4] ? cat(catn(s, (float)p[4], 0), " мс") : cat(s, "ждать разрежение"); break;
  case 5: cat(s, (p[5] & 1) && C.ha ? "вкл" : "выкл"); break;
  case 6: cat(s, C.coff ? "вкл" : "выкл"); break;
  }
}

/* «Розетка»: 0 — автозапуск, 1 — порог, 2 — задержка, 3 — выбег, 4 — удары после, 5 — предел, 6 — без пылесоса. */
#define NTOOL 7
static const char *const TOOL_LABEL[NTOOL] = {"Автозапуск от инструмента", "Порог тока инструмента", "Пуск турбин через", "Выбег после инструмента", "Ударов после инструмента", "Предел общего тока", "Розетка и без пылесоса"};
static const char *const TOOL_KEY[NTOOL] = {"ta", "tt", "td", "tr", "te", "tm", "tf"};
static const char *const TOOL_CMD[NTOOL] = {"tool auto ", "tool thr ", "tool delay ", "tool runon ", "tool end ", "tool limit ", "tool free "};

static int *tool_val(int i) {
  int *v[NTOOL] = {&C.ta, &C.tt, &C.td, &C.tr, &C.te, &C.tm, &C.tf};
  return v[i];
}

static void change_tool(int i, int d) {
  int *v = tool_val(i);
  switch (i) {
  case 0:
  case 6: *v = !*v; break;
  case 1: *v = clampi(*v + d, 1, 50); break;
  case 2: *v = clampi(*v + d * 100, 0, 3000); break;
  case 3: *v = clampi(*v + d, 0, 30); break;
  case 4: *v = clampi(*v + d, 0, 10); break;
  case 5: *v = clampi(*v + d, 10, 32); break;
  }
  hold(TOOL_KEY[i]);
  send_int(TOOL_CMD[i], *v);
}

static void tool_value(int i, char *s) {
  int v = *tool_val(i);
  s[0] = 0;
  switch (i) {
  case 0:
  case 6: cat(s, v ? "вкл" : "выкл"); break;
  case 1: cat(catn(s, (float)v / 10.0f, 1), " А"); break;
  case 2: cat(catn(s, (float)v / 1000.0f, 1), " с"); break;
  case 3: cat(catn(s, (float)v, 0), " с"); break;
  case 4: catn(s, (float)v, 0); break;
  case 5: cat(catn(s, (float)v, 0), " А"); break;
  }
}

/*
 * «Фильтр · ещё»: 0 — мешок, 1 — новый мешок, 2 — фильтр клапанов заменён, 3 — очистка по перепаду
 * (порог, Па при расходе уставки; «авто» — по росту R), 4 — порог «авто», 5 — ударов мощной, 6 — сила удара.
 */
#define NF2 7
static const char *const F2_LABEL[NF2] = {"Мешок в баке", "Новый мешок — замер", "Фильтр клапанов заменён", "Очистка при перепаде", "«Авто»: серия, когда R выросло на", "Мощная очистка: ударов", "Сила удара (фильтр клапанов)"};

static void change_f2(int i, int d) {
  if (i == 3) {
    /* Из «авто» вверх — с чистого перепада ×1,5 (или 100 Па), шаг 10 Па; ниже 20 — снова «авто». */
    int v = C.dpo;
    if (!v) v = d > 0 ? (C.dpc > 0 ? (C.dpc * 3 / 2 + 5) / 10 * 10 : 100) : 0;
    else v += d * 10;
    if (v < 20) v = 0;
    if (v > 2000) v = 2000;
    C.dpo = v;
    hold("dpo");
    send_int("set dp ", C.dpo);
  } else if (i == 4) {
    C.thr = clampi(C.thr + d * 5, 105, 200);
    hold("thr");
    send_int("set thr ", C.thr);
  } else if (i == 5) {
    C.sn = clampi(C.sn + d, 1, 10);
    hold("sn");
    send_int("set strong ", C.sn);
  }
}

static void f2_value(int i, char *s) {
  s[0] = 0;
  switch (i) {
  case 0: cat(s, C.bg ? "стоит" : "нет"); break;
  case 1: cat(s, C.rb > 0 ? "замерен" : "—"); break;
  case 2: cat(catn(s, (float)C.ip, 0), " ударов назад"); break;
  case 3:
    if (!C.dpo) cat(s, "авто");
    else cat(catn(s, (float)C.dpo, 0), " Па");
    if (C.dpc > 0) cat(catn(cat(s, " · чистый "), (float)C.dpc, 0), " Па");
    break;
  case 4: cat(catn(s, (float)(C.thr - 100), 0), " %"); break;
  case 5: catn(s, (float)C.sn, 0); break;
  case 6: cat(catn(s, F.ih, 0), " %"); break;
  }
}

static void f2_select(int i) {
  if (i == 0) {
    C.bg = !C.bg;
    hold("bg");
    send_int("bag ", C.bg);
  } else if (i == 1) {
    cmd("bag new");
    toast("Замер мешка: 20 с, шланг открыт");
  } else if (i == 2) {
    cmd("intake new");
    toast("Фильтр клапанов новый: сила удара — за 20 ударов");
  }
}

/* ---------------- энкодер (события от контроллера) ---------------- */

static void encoder(int d) {
  if (!d) return;
  if (S.ov) return; /* окно перегрузки — только кнопками решения */
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
  case W_FILTER2: change_f2(f2_sel, d); break;
  case W_TOOL: change_tool(tool_sel, d); break;
  case W_BLE: ble_sel = clampi(ble_sel + d, 0, 3); break;
  case W_PRESET: preset_sel = clampi(preset_sel + d, 0, NPR - 1); break;
  case W_LOG: log_range = d > 0 ? 30 : 7; break;
  default: break;
  }
  dirty = 1;
}

static void enc_click(void) {
  if (S.ov) return;
  switch (screen) {
  case W_WORK: go(W_MODE); break;
  case W_MODE: mode_focus = mode_focus == 2 ? 3 : 2; break;
  case W_CLEAN: clean_sel = (clean_sel + 1) % NCLEAN; break;
  case W_FILTER2: f2_sel = (f2_sel + 1) % NF2; break;
  case W_TOOL: tool_sel = (tool_sel + 1) % NTOOL; break;
  case W_BLE: ble_sel = (ble_sel + 1) % 4; break;
  case W_PRESET:
    set_preset(preset_sel);
    if (!S.st) cmd("start");
    go(W_WORK);
    break;
  default: go(W_WORK); break;
  }
  dirty = 1;
}

static void go(int w) {
  screen = w;
  if (w == W_MODE) mode_focus = S.md == 'm' ? 3 : 2;
  if (w == W_PRESET) preset_sel = S.pr;
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
  if (!k->label[0]) return;
  int top = 26 + 104 * i;
  int z = (side ? Z_KR : Z_KL) + i;
  int lit = pressed == z || (flash_zone == z && (int32_t)(flash_till - now) > 0);
  if (lit) g_rrect(side ? 654 : 6, (float)top + 4, 140, 96, 10, C_PRESS);
  char l1[64], l2[64], ic[24] = "";
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
  static const char *const T[NTABS] = {"Работа", "Очистка", "Фильтр", "Розетка", "Журнал"};
  for (int i = 0; i < NTABS; i++) {
    float x = 150.0f + (float)i * 100;
    int a = i == on;
    g_rrect(x + 2, 435.7f, 96, 30.3f, 6, a ? C_KEY : pressed == Z_TAB + i ? C_TOAST : C_TAB);
    g_text_at(&F_S14, (int)(x + 50), 456, T[i], a ? C_INK : C_DIM, 1);
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
    char s[64] = "‹ ";
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

/* Карточка: small_first — подпись сверху (фильтр), иначе название сверху (режимы). */
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

/* Кратко о режиме очистки: «3×40 мс каждые 15 с». */
static char *preset_short(char *s, int i) {
  const int *p = C.ps[i];
  s[0] = 0;
  catn(s, (float)p[0], 0), cat(s, " л/с · ");
  if (p[5] & 2) return cat(s, "без очистки");
  if (!p[1] && !p[2] && !p[3]) return cat(s, "всё подбирает сам");
  p[1] ? catn(s, (float)p[1], 0) : cat(s, "n");
  cat(s, "×");
  p[3] ? cat(catn(s, (float)p[3], 0), " мс") : cat(s, "удар");
  cat(s, " · ");
  return p[2] ? cat(cat(catn(s, (float)p[2], 0), " с"), "") : cat(s, "по R");
}

/* ---------------- экран «Работа» ---------------- */

static void state_text(char *out, int *warn) {
  out[0] = 0;
  *warn = 0;
  if (!link_ok()) return;
  if (S.wl == 2) cat(out, "перелив!"), *warn = 1;
  else if (S.wl == 1) cat(out, "бак полон"), *warn = 1;
  else if (S.pg == 4) cat(out, S.au ? "удары после инструмента" : "очистка перед остановкой"), *warn = 1;
  else if (S.pg == 2) cat(out, S.hz ? "закройте шланг ладонью" : "мощная очистка"), *warn = 1;
  else if (S.pg) cat(out, "продувка"), *warn = 1;
  else if (!S.st) cat(out, C.ta ? "ждёт инструмент" : "стоп");
  else if (S.au) cat(out, S.tl ? "автозапуск" : "выбег");
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
  char s[120], st[48];
  int warn = filter_warn(), lk = link_ok(), fb = top_fault();
  skey_t L[3] = {{"Режим", "⚙", 0}, {"Очистка", "≈", 0}, {warn ? "Фильтр !" : "Фильтр", "▤", warn}};
  skey_t R[3] = {{"Журнал", "▦", 0}, {"Продуть", "⚡", 0}, {lk && fb >= 0 ? "Сброс аварий" : "Мощная очистка", lk && fb >= 0 ? "✕" : "⚡⚡", 0}};
  keys(L, R);

  /* Верх: режим, состояние, беспроводной пульт или метка. */
  const char *badge = !lk ? "нет связи" : S.md == 'a' ? "Авто" : "Ручной";
  int off = !lk || !S.st, stw;
  const char *bt = lk && F.tg ? "метка" : lk && S.bt == 2 ? "пульт" : "";
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
    if (S.cp) cat(s, " · огр. "), catn(s, (float)S.cp, 0), cat(s, " %");
  } else
    cat(s, "ждём контроллер…");
  g_text_at(&F_M16, 400, 149, s, S.cp ? C_WARN : C_SUB, 1);

  gauge(314, S.p1, 0);
  gauge(486, S.p2, 1);

  /* Неисправность — плашкой под турбинами; иначе — розетка и инструмент. */
  if (lk && fb >= 0) {
    s[0] = 0;
    cat(cat(s, "! "), FAULT[fb].text);
    int n = fault_count();
    if (n > 1) cat(s, "  +"), catn(s, (float)(n - 1), 0);
    warnbox(190, 324, 420, s, fault_hint(fb), (F_URGENT >> fb) & 1 ? 2 : 0);
  } else if (lk && (S.so || S.tl)) {
    s[0] = 0;
    cat(s, S.so ? "розетка вкл" : "розетка выкл");
    if (S.tl == 2) cat(s, " · метка: инструмент работает");
    else if (S.tl) cat(s, " · инструмент "), catn(s, S.ta, 1), cat(s, " А");
    cat(s, " · всего "), catn(s, S.ia, 1), cat(s, " / "), catn(s, (float)C.tm, 0), cat(s, " А");
    hint(345, s, S.ia > C.tm * 0.9f ? C_WARN : C_ICON);
  }

  /* Фильтр: загрузка до серии, ход очистки. */
  s[0] = 0;
  uint16_t rc = C_SUB;
  if (S.pg && S.pn) {
    cat(s, "удар "), catn(s, (float)S.pn, 0);
    if (S.pg == 2) cat(s, "/"), catn(s, (float)C.sn, 0);
    rc = C_WARN;
  } else if (S.pg) {
    cat(s, S.pg == 2 && S.hz ? "ждёт шланг" : "разгон");
    rc = C_WARN;
  } else {
    catn(s, S.fl, 0), cat(s, " %");
    if (S.nx && S.ru && S.cl == 'a') cat(s, " · серия через "), catn(s, (float)S.nx, 0), cat(s, " с");
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
  item(7, "Телефон: обновление и копия", F.wf ? "Wi-Fi вкл" : "›", 0, 0);
  tabs(0);
}

/* ---------------- «Очистка» ---------------- */

static void scr_clean(void) {
  char s[120];
  skey_t L[3] = {{"Вверх", "▲", 0}, {"Вниз", "▼", 0}, {"Авто / выкл", "⇄", 0}};
  skey_t R[3] = {{"Продуть", "⚡", 0}, {"Мощная", "⚡⚡", 0}, {"Назад", "←", 0}};
  keys(L, R);
  s[0] = 0;
  cat(cat(cat(s, "Очистка · "), PRESET_NAME[S.pr]), S.cl == 'a' ? "" : " · выкл");
  header(s);
  for (int i = 0; i < NCLEAN; i++) {
    clean_value(i, s);
    item(i, CLEAN_LABEL[i], s, i == clean_sel, 0);
  }
  hint(352, "энкодер меняет выделенное, его кнопка — следующее; «сам» — подбирает «Авто»", C_ICON);
  s[0] = 0;
  uint16_t c = C_ICON;
  if (S.pg && S.pg != 4) {
    cat(s, S.pg == 2 ? (S.hz ? "мощная очистка: закройте шланг ладонью" : "идёт мощная очистка") : "идёт продувка");
    if (S.pn) cat(s, ": удар "), catn(s, (float)S.pn, 0);
    c = C_WARN;
  } else if (C.ps[S.pr][5] & 2)
    cat(s, "вода: мокрый фильтр ударами не отбить — очистка только кнопкой");
  else if (S.cl != 'a')
    cat(s, "автоочистка выключена — только кнопкой «Продуть»");
  else {
    static const char *const DL[4] = {"", "мало", "средне", "много"}, *const DK[4] = {"", "сухая", "средняя", "липкая"};
    cat(s, "сейчас: "), catn(s, (float)(F.nn ? F.nn : 1), 0), cat(s, " × "), catn(s, (float)F.im, 0), cat(s, " мс каждые ");
    catn(s, (float)F.ev, 0), cat(s, " с");
    if (F.dl) cat(cat(s, " · пыли "), DL[clampi(F.dl, 0, 3)]);
    if (F.dk) cat(cat(s, ", "), DK[clampi(F.dk, 0, 3)]);
  }
  hint(374, s, c);
  tabs(1);
}

/* ---------------- «Фильтр» ---------------- */

static void filter_card(int i, float x, float y) {
  char a[48], b[64];
  int on = C.fi == i;
  float rn = C.fr[i][0], rb = C.fr[i][1];
  g_rrect(x, y, 238, 92, 8, on ? C_GREEN : pressed == Z_CARD + i ? C_TOAST : C_TAB);
  a[0] = 0;
  cat(a, i ? "Фильтр Б" : "Фильтр А");
  if (on) cat(a, " · стоит");
  g_text_at(&F_S16, (int)x + 12, (int)y + 25, a, on ? C_GREEN_C : C_TEXT, 0);
  b[0] = 0;
  if (rn > 0) {
    cat(b, "R нового "), catn(b, rn, 1), cat(b, " · сейчас "), catn(b, rb, 1);
  } else
    cat(b, "не мерили");
  g_text_at(&F_M13, (int)x + 12, (int)y + 47, b, on ? C_GREEN_C : C_DIM, 0);
  b[0] = 0;
  catn(b, C.fr[i][2], 0), cat(b, " моек · "), catn(b, C.fr[i][3], C.fr[i][3] < 10 ? 1 : 0), cat(b, " ч · ");
  catn(b, C.fr[i][4], 0), cat(b, " ударов");
  g_text_at(&F_M13, (int)x + 12, (int)y + 67, b, on ? C_GREEN_C : C_DIM, 0);
  static const char *const ST[4] = {"", "поставлен новым", "отмыт", "продут"};
  const char *st = ST[clampi(C.fst[i], 0, 3)];
  if (rn > 0 && rb > rn * 1.8f) st = "пора менять";
  if (st[0]) g_text_at(&F_S13, (int)x + 12, (int)y + 86, st, rn > 0 && rb > rn * 1.8f ? C_WARN : on ? C_GREEN_T : C_ICON, 0);
}

static void scr_filter(void) {
  char a[96], b[96];
  int guess = F.fg >= 0 && F.fg <= 1 && F.fm == 2;
  char sw[24] = "";
  if (guess) cat(cat(sw, "Это фильтр "), F.fg ? "Б" : "А");
  else cat(cat(sw, "Стоит "), C.fi ? "А ⇄ Б" : "Б ⇄ А");
  skey_t L[3] = {{"Поставил новый", "✓", 0}, {"Поставил отмытый", "≈", 0}, {"Продул сам", "↺", 0}};
  skey_t R[3] = {{guess ? sw : C.fi ? "Стоит А" : "Стоит Б", "⇄", guess}, {"Ещё", "…", 0}, {"Назад", "←", 0}};
  keys(L, R);
  a[0] = 0;
  cat(cat(a, "Фильтр 180×320 · стоит "), C.fi ? "Б" : "А");
  if (C.bg) cat(a, " · мешок");
  header(a);
  int wash = (S.fa >> F_FILTER_BIT) & 1, torn = (S.fa >> F_TORN_BIT) & 1, stuck = (S.fa >> 30) & 1;
  if (F.fm == 1) {
    a[0] = 0;
    cat(cat(a, "Замер: ещё "), fnum(b, (float)F.fx, 0)), cat(a, " с");
    warnbox(MID_L, 51.3f, MID_R - MID_L, a, "шланг открыт, без инструмента — меряю сопротивление", 0);
  } else if (guess) {
    a[0] = 0;
    cat(cat(a, "Похоже, это фильтр "), F.fg ? "Б" : "А");
    warnbox(MID_L, 51.3f, MID_R - MID_L, a, "замер близок к нему — если так, нажмите «Это фильтр …»", 0);
  } else if (F.fm == 2) {
    a[0] = 0;
    b[0] = 0;
    cat(cat(a, "Замер: от нового "), fnum(b, F.fp, 0)), cat(a, " %");
    int bad = F.fp < 56;
    warnbox(MID_L, 51.3f, MID_R - MID_L, a, bad ? "сопротивление выше нового почти вдвое — пора менять" : "паспорт фильтра обновлён", bad ? 0 : 1);
  } else if (torn) warnbox(MID_L, 51.3f, MID_R - MID_L, "! Фильтр порван или не стоит", "перепада почти нет — пыль идёт в турбины", 2);
  else if (stuck) warnbox(MID_L, 51.3f, MID_R - MID_L, "! Фильтр не отбивается", "липкая пыль — мощная очистка (шланг ладонью) или мойка", 0);
  else if (wash) warnbox(MID_L, 51.3f, MID_R - MID_L, "! Пора помыть", "продувка перестала восстанавливать сопротивление", 0);
  else {
    a[0] = 0;
    if (S.ra > 0) cat(cat(catn(cat(a, "продувка снимает "), S.sm, 0), " %"), " сопротивления");
    else cat(a, "поставили фильтр — нажмите слева, какой, и он замерится");
    warnbox(MID_L, 51.3f, MID_R - MID_L, S.fl > 70 ? "Фильтр загружен" : "Фильтр в норме", a, S.fl > 70 ? 0 : 1);
  }
  a[0] = 0;
  cat(catn(a, S.fl, 0), " %");
  int wr = g_text_w(&F_M15, a, 0);
  g_bar(MID_L, 116, (float)(MID_R - MID_L - wr - 12), 12, S.fl / 100.0f, C_TRACK, filter_warn() ? C_WARN2 : C_FILL);
  g_text_at(&F_M15, MID_R, 127, a, filter_warn() ? C_WARN2 : C_SUB, 2);
  filter_card(0, MID_L, 140);
  filter_card(1, MID_L + 246, 140);
  const char *lab[4] = {"R сейчас", "после удара", "перепад, Па", "сила удара"};
  for (int i = 0; i < 4; i++) {
    b[0] = 0;
    if (i == 0) S.r > 0 ? catn(b, S.r, 1) : cat(b, "—");
    else if (i == 1) S.ra > 0 ? catn(b, S.ra, 1) : cat(b, "—");
    else if (i == 2) catn(b, S.dp, 0);
    else cat(catn(b, F.ih, 0), " %");
    card(MID_L + (float)(i & 1) * 246, 241 + (float)(i >> 1) * 64.7f, 238, lab[i], b, 0, 1, 0);
  }
  tabs(2);
}

static void scr_filter2(void) {
  char s[48];
  skey_t L[3] = {{"Вверх", "▲", 0}, {"Вниз", "▼", 0}, {"Выбрать", "✓", 0}};
  skey_t R[3] = {{"", "", 0}, {"", "", 0}, {"Назад", "←", 0}};
  keys(L, R);
  header("Фильтр · ещё");
  for (int i = 0; i < NF2; i++) {
    f2_value(i, s);
    item(i, F2_LABEL[i], s, i == f2_sel, 0);
  }
  hint(352, "перепад — при расходе уставки; чистый — по замеру нового фильтра («Фильтр → новый»)", C_ICON);
  hint(374, "мешок: пылесос помнит его сопротивление; фильтр клапанов поменяли — отметьте здесь", C_ICON);
  tabs(2);
}

/* ---------------- «Розетка» и устройства ---------------- */

static void scr_tool(void) {
  char s[120];
  skey_t L[3] = {{"Вверх", "▲", 0}, {"Вниз", "▼", 0}, {"Изменить", "✎", 0}};
  skey_t R[3] = {{"Устройства Bluetooth", "⌁", 0}, {S.so ? "Розетку выключить" : "Розетку включить", "✓", 0}, {"Назад", "←", 0}};
  keys(L, R);
  header(S.so ? "Розетка инструмента · вкл" : "Розетка инструмента · выкл");
  for (int i = 0; i < NTOOL; i++) {
    tool_value(i, s);
    item(i, TOOL_LABEL[i], s, i == tool_sel, 0);
  }
  s[0] = 0;
  if (S.tl == 2) cat(s, "метка: инструмент работает");
  else if (S.tl) cat(s, "инструмент "), catn(s, S.ta, 1), cat(s, " А");
  else cat(s, "инструмент не работает");
  cat(s, " · турбины "), catn(s, S.i1 + S.i2, 1), cat(s, " А · всего "), catn(s, S.ia, 1), cat(s, " из "), catn(s, (float)C.tm, 0), cat(s, " А");
  hint(352, s, S.ia > C.tm * 0.9f ? C_WARN : C_SUB);
  hint(374, "пусковой бросок не в счёт: решает средний ток за 3 с после первых 2 с", C_ICON);
  tabs(3);
}

static void scr_ble(void) {
  char s[96];
  skey_t L[3] = {{"Вверх", "▲", 0}, {"Вниз", "▼", 0}, {"Отвязать", "✕", 0}};
  skey_t R[3] = {{S.bp ? "Привязка идёт…" : "Привязать", "⌁", S.bp}, {"", "", 0}, {"Назад", "←", 0}};
  keys(L, R);
  header("Устройства Bluetooth");
  for (int i = 0; i < 4; i++) {
    char l[32] = "";
    s[0] = 0;
    if (C.dk[i] == 1) {
      cat(l, "Пульт "), catn(l, (float)C.dn[i], 0);
      cat(s, S.bt == 2 ? "на связи" : "привязан");
    } else if (C.dk[i] == 2) {
      cat(l, "Метка "), catn(l, (float)C.dn[i], 0);
      cat(s, (F.tg >> i) & 1 ? "инструмент работает" : "ждёт");
      if ((F.tb >> i) & 1) cat(s, " · батарея!");
    } else
      cat(l, "— свободно —");
    item(i, l, s, i == ble_sel, 0);
  }
  hint(230, S.bp ? "окно привязки открыто 60 с: пульт — обе кнопки 5 с, метка — её кнопка 5 с, рядом с пылесосом" : "до 4 устройств: пульт и метки на аккумуляторный инструмент", S.bp ? C_WARN : C_ICON);
  hint(252, "метка включает пылесос, когда инструмент заработал, и выключает с выбегом", C_ICON);
  tabs(3);
}

/* ---------------- «Телефон»: Wi-Fi и QR-код ---------------- */

static void scr_phone(void) {
  char s[80];
  skey_t L[3] = {{"", "", 0}, {"", "", 0}, {"", "", 0}};
  skey_t R[3] = {{F.wf ? "Выключить Wi-Fi" : "Включить Wi-Fi", "⌁", 0}, {"", "", 0}, {"Назад", "←", 0}};
  keys(L, R);
  header("Телефон: обновление и резервная копия");
  if (!F.wf || !qr_ok) {
    hint(120, "пылесос включит свою сеть Wi-Fi со случайным паролем на 30 минут", C_SUB);
    hint(146, "на экране появится QR-код: наведите камеру телефона — он подключится сам", C_SUB);
    hint(172, "страница: состояние, прошивки контроллера и экрана, копия настроек", C_ICON);
    hint(198, "обновлять — при остановленных турбинах; настройки и паспорта фильтров сохранятся", C_ICON);
    tabs(0);
    return;
  }
  int n = qr.size, m = 290 / (n + 8), size = m * (n + 8);
  int x0 = MID_L + 6, y0 = 58;
  g_fill(x0, y0, size, size, HEX(0xffffff));
  for (int y = 0; y < n; y++)
    for (int x = 0; x < n; x++)
      if (qr.m[y][x]) g_fill(x0 + (x + 4) * m, y0 + (y + 4) * m, m, m, HEX(0x000000));
  int tx = x0 + size + 18;
  g_text_at(&F_S16, tx, 90, "Наведите камеру телефона", C_TEXT, 0);
  g_text_at(&F_S13, tx, 118, "или подключитесь вручную:", C_SUB, 0);
  s[0] = 0;
  g_text_at(&F_M15, tx, 150, cat(cat(s, "сеть "), wifi_ssid), C_TEXT, 0);
  s[0] = 0;
  g_text_at(&F_M15, tx, 176, cat(cat(s, "пароль "), wifi_pass), C_TEXT, 0);
  g_text_at(&F_M15, tx, 214, "http://192.168.4.1", C_GREEN_T, 0);
  g_text_at(&F_S13, tx, 250, "сеть выключится сама", C_ICON, 0);
  g_text_at(&F_S13, tx, 270, "через 30 минут", C_ICON, 0);
  tabs(0);
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
  char s[120], t[48];
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
    tabs(4);
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
  cat(s, "сила удара "), catn(s, F.ih, 0), cat(s, " % · ударов "), catn(s, (float)F.pc, 0);
  hint(326, s, C_ICON);
  tabs(4);
}

/* ---------------- выбор режима очистки ---------------- */

static void scr_preset(void) {
  char s[64];
  skey_t L[3] = {{"Вверх", "▲", 0}, {"Вниз", "▼", 0}, {"Назад", "←", 0}};
  skey_t R[3] = {{"", "", 0}, {"", "", 0}, {"Пуск", "▶", 0}};
  keys(L, R);
  header("Режим очистки");
  for (int i = 0; i < NPR; i++) {
    int row = i >> 1, col = i & 1;
    card(MID_L + (float)col * 246, 55.3f + (float)row * 64.7f, 238, PRESET_NAME[i], preset_short(s, i), i == preset_sel, 0, pressed == Z_CARD + i);
  }
  s[0] = 0;
  cat(cat(cat(s, "сейчас «"), PRESET_NAME[S.pr]), "» · энкодер — выбор, его кнопка или «Пуск» — применить");
  hint(330, s, C_ICON);
  tabs(1);
}

/* ---------------- окна поверх экрана ---------------- */

/* Перегрузка розетки: решение обязательно (розетка выключена, пока не выбрали). */
static void overlay_ov(void) {
  char s[120];
  /* Кнопки экрана под окном не действуют — убираем их подписи. */
  g_fill(0, 0, 150, 420, C_BG);
  g_fill(650, 0, 150, 420, C_BG);
  g_rrect(150, 40, 500, 330, 12, HEX(0x1a0f0c));
  g_rrect(150, 40, 500, 6, 3, C_RED);
  if (S.ov == 2) {
    g_text_at(&F_S20, 400, 88, "Инструмент был включён", C_RED, 1);
    hint(128, "когда подали розетку, инструмент сразу потянул ток —", C_TEXT);
    hint(150, "он мог раскрутиться в руках. Розетка снова выключена.", C_TEXT);
    hint(196, "Выключите инструмент выключателем,", C_WARN);
    hint(218, "затем нажмите «Включить розетку».", C_WARN);
  } else {
    g_text_at(&F_S20, 400, 88, "Перегрузка по току — розетка отключена", C_RED, 1);
    s[0] = 0;
    cat(s, "инструмент "), catn(s, F.ot, 1), cat(s, " А + турбины "), catn(s, F.ou, 1), cat(s, " А — больше предела "), catn(s, (float)C.tm, 0), cat(s, " А");
    hint(128, s, C_TEXT);
    hint(174, "Выключите инструмент, затем выберите справа:", C_WARN);
    s[0] = 0;
    if (F.oc) {
      cat(s, F.o1 ? "работать одной турбиной на " : "снизить турбины до "), catn(s, (float)F.oc, 0), cat(s, " % и включить розетку");
      hint(206, s, C_SUB);
    } else
      hint(206, "турбины не снизить настолько — розетку можно только оставить выключенной", C_SUB);
    hint(232, "или оставить розетку выключенной (включить — «Розетка»)", C_SUB);
  }
  /* Кнопки решения — справа, напротив физических кнопок. */
  char l1[40] = "";
  if (S.ov == 2) cat(l1, "Включить розетку");
  else if (F.oc) cat(catn(cat(l1, F.o1 ? "Одна турбина " : "Турбины "), (float)F.oc, 0), " % и розетку");
  skey_t R[3] = {{l1, "✓", 1}, {"Оставить выключенной", "✕", 0}, {"", "", 0}};
  for (int i = 0; i < 3; i++) softkey(1, i, &R[i]);
}

/* Мощная очистка: подсказка «закройте шланг», ход ударов, «Отмена». */
static void overlay_strong(void) {
  char s[64];
  g_rrect(190, 160, 420, 150, 12, HEX(0x0f1a14));
  g_text_at(&F_S20, 400, 200, "Мощная очистка", C_GREEN_T, 1);
  if (S.hz) {
    hint(236, "Закройте шланг ладонью или пробкой", C_WARN);
    hint(260, "удары начнутся сами, как только шланг закрыт", C_SUB);
  } else {
    s[0] = 0;
    cat(s, "удар "), catn(s, (float)S.pn, 0), cat(s, " из "), catn(s, (float)C.sn, 0), cat(s, " · разрежение "), catn(s, S.va, 1), cat(s, " кПа");
    hint(236, s, C_TEXT);
    hint(260, "держите шланг закрытым", C_SUB);
  }
  skey_t R = {"Отмена", "✕", 0};
  g_fill(650, 26 + 208, 150, 104, C_BG);
  softkey(1, 2, &R);
}

/* ---------------- сон ---------------- */

static void scr_sleep(void) {
  g_text_at(&F_S20, 400, 230, "Выключено", C_ICON, 1);
  g_text_at(&F_S13, 400, 258, "любая кнопка, касание или пульт — включить", HEX(0x3a3a36), 1);
}

/* ---------------- кадр ---------------- */

static int modal(void) { return link_ok() && S.ov; }
static int strong_on(void) { return link_ok() && S.pg == 2; }

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
  case W_FILTER2: scr_filter2(); break;
  case W_TOOL: scr_tool(); break;
  case W_BLE: scr_ble(); break;
  case W_PHONE: scr_phone(); break;
  case W_LOG: scr_log(); break;
  case W_PRESET: scr_preset(); break;
  }
  if (modal()) overlay_ov();
  else if (strong_on()) overlay_strong();
  if (toast_till) {
    int w = g_text_w(&F_S14, toast_s, 0) + 36;
    g_rrect((float)(400 - w / 2), 372, (float)w, 30, 15, C_TOAST);
    g_text_at(&F_S14, 400, 392, toast_s, C_TEXT, 1);
  }
}

/* ---------------- касания и кнопки ---------------- */

static int list_len(void) {
  switch (screen) {
  case W_MODE: return 8;
  case W_CLEAN: return NCLEAN;
  case W_FILTER2: return NF2;
  case W_TOOL: return NTOOL;
  case W_BLE: return 4;
  }
  return 0;
}

static int hit(int x, int y) {
  if (y >= 26 && y < 338 && (x < 150 || x >= 650)) return (x < 150 ? Z_KL : Z_KR) + (y - 26) / 104;
  if (x >= 150 && x < 650 && y >= 426) return Z_TAB + clampi((x - 150) / 100, 0, NTABS - 1);
  if (x < MID_L - 8 || x >= MID_R + 8) return Z_NONE;
  int n = list_len();
  if (n && y >= LIST_Y && y < LIST_Y + n * ITEM_H) return Z_ITEM + (y - LIST_Y) / ITEM_H;
  if (screen == W_PRESET && y >= 55 && y < 55 + 4 * 65) {
    int i = ((y - 55) / 65) * 2 + (x >= 400);
    return i < NPR ? Z_CARD + i : Z_NONE;
  }
  if (screen == W_FILTER && y >= 140 && y < 232) return Z_CARD + (x >= 400);
  if (screen == W_WORK && y >= 14 && y < 160) return Z_FLOW;
  if (screen == W_WORK && y >= 320 && y < 378 && top_fault() >= 0) return Z_FBOX;
  if (screen == W_WORK && y >= 398 && y < 434) return Z_FBAR;
  return Z_NONE;
}

static void act(int z) {
  int kl = z >= Z_KL && z < Z_KL + 3 ? z - Z_KL : -1, kr = z >= Z_KR && z < Z_KR + 3 ? z - Z_KR : -1;
  /* Окно перегрузки: только его кнопки. */
  if (modal()) {
    if (kr == 0 && (S.ov == 2 || F.oc)) {
      cmd(S.ov == 2 ? "sock on" : "sock cap");
      toast(S.ov == 2 ? "Розетка включена" : "Турбины ограничены, розетка включена");
    } else if (kr == 1) {
      cmd("sock off");
      toast("Розетка выключена — включить: «Розетка»");
    }
    dirty = 1;
    return;
  }
  if (strong_on() && kr == 2) {
    purge(1);
    dirty = 1;
    return;
  }
  if (z >= Z_TAB && z < Z_TAB + NTABS) {
    static const uint8_t T[NTABS] = {W_WORK, W_CLEAN, W_FILTER, W_TOOL, W_LOG};
    if (T[z - Z_TAB] == W_LOG) log_view = 0;
    go(T[z - Z_TAB]);
    return;
  }
  int it = z >= Z_ITEM && z < Z_CARD ? z - Z_ITEM : -1;
  if (kr == 2 && screen != W_WORK && screen != W_PRESET) {
    go(screen == W_FILTER2 ? W_FILTER : screen == W_BLE ? W_TOOL : screen == W_PHONE ? W_MODE : W_WORK);
    return;
  }
  switch (screen) {
  case W_WORK:
    if (kl == 0 || z == Z_FLOW) go(W_MODE);
    else if (kl == 1) go(W_CLEAN);
    else if (kl == 2 || z == Z_FBAR) go(W_FILTER);
    else if (kr == 0) log_view = 0, go(W_LOG);
    else if (kr == 1) purge(0);
    else if ((kr == 2 && top_fault() >= 0) || z == Z_FBOX) {
      cmd("ack");
      toast("Аварии сброшены");
    } else if (kr == 2)
      purge(1);
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
      go(W_PHONE);
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
      if (it == clean_sel && (it == 5 || it == 6)) change_clean(it, 1);
      else if (it == clean_sel && it == 0) go(W_PRESET);
      clean_sel = it;
    }
    break;
  case W_FILTER:
    if (kl == 0 && confirmed(z, "поставил новый фильтр")) {
      filter_cmd("new");
      toast("Замер нового фильтра: 20 с");
    } else if (kl == 1 && confirmed(z, "поставил отмытый фильтр")) {
      filter_cmd("washed");
      toast("Замер отмытого фильтра: 20 с");
    } else if (kl == 2 && confirmed(z, "продул фильтр сам")) {
      filter_cmd("blown");
      toast("Замер продутого фильтра: 20 с");
    } else if (kr == 0) {
      if (F.fg >= 0 && F.fm == 2) cmd("filter swap"), F.fg = -1, toast("Замер записан другому фильтру");
      else {
        C.fi = !C.fi;
        hold("fi");
        cmd(C.fi ? "filter б use" : "filter а use");
      }
    } else if (kr == 1)
      go(W_FILTER2);
    else if (z == Z_CARD || z == Z_CARD + 1) {
      C.fi = z - Z_CARD;
      hold("fi");
      cmd(C.fi ? "filter б use" : "filter а use");
    }
    break;
  case W_FILTER2:
    if (kl == 0) f2_sel = (f2_sel + NF2 - 1) % NF2;
    else if (kl == 1) f2_sel = (f2_sel + 1) % NF2;
    else if (kl == 2) f2_select(f2_sel);
    else if (it >= 0) {
      if (it == f2_sel) f2_select(it);
      f2_sel = it;
    }
    break;
  case W_TOOL:
    if (kl == 0) tool_sel = (tool_sel + NTOOL - 1) % NTOOL;
    else if (kl == 1) tool_sel = (tool_sel + 1) % NTOOL;
    else if (kl == 2) change_tool(tool_sel, 1);
    else if (kr == 0) go(W_BLE);
    else if (kr == 1) {
      cmd(S.so ? "sock off" : "sock on");
      toast(S.so ? "Розетка выключена" : "Розетка включена");
    } else if (it >= 0) {
      if (it == tool_sel && (it == 0 || it == 6)) change_tool(it, 1);
      tool_sel = it;
    }
    break;
  case W_BLE:
    if (kl == 0) ble_sel = (ble_sel + 3) % 4;
    else if (kl == 1) ble_sel = (ble_sel + 1) % 4;
    else if (kl == 2 && C.dk[ble_sel] && confirmed(z, "отвязать устройство")) {
      send_int("ble forget ", ble_sel);
      C.dk[ble_sel] = 0;
      toast("Устройство отвязано");
    } else if (kr == 0) {
      cmd("ble pair");
      toast("Привязка: пульт — обе кнопки 5 с, метка — кнопка 5 с, рядом");
    } else if (it >= 0)
      ble_sel = it;
    break;
  case W_PHONE:
    if (kr == 0) {
      cmd(F.wf ? "wifi off" : "wifi on");
      toast(F.wf ? "Wi-Fi выключен" : "Wi-Fi включается…");
    }
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
    if (kl == 0) preset_sel = (preset_sel + NPR - 1) % NPR;
    else if (kl == 1) preset_sel = (preset_sel + 1) % NPR;
    else if (kl == 2) go(W_CLEAN);
    else if (kr == 2) {
      set_preset(preset_sel);
      if (!S.st) cmd("start");
      char s[64] = "Режим «";
      toast(cat(cat(s, PRESET_NAME[preset_sel]), "»"));
      go(W_WORK);
    } else if (z >= Z_CARD && z < Z_CARD + NPR) {
      if (preset_sel == z - Z_CARD) {
        set_preset(preset_sel);
        go(W_WORK);
      } else
        preset_sel = z - Z_CARD;
    }
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
  phal_log(PANEL_MARK);
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
  if (S.ov != ov_prev || S.pg != pg_prev || F.fm != fm_prev) ov_prev = S.ov, pg_prev = S.pg, fm_prev = F.fm, dirty = 1;
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
