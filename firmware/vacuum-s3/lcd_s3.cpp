/*
 * Экран на контроллере: ILI9488 3,5″ 480×320 по SPI (по этой шине — только 18 бит на точку) и
 * касание XPT2046 на той же шине. Интерфейс — тот же, что у отдельной платы с экраном
 * (firmware/vacuum-panel: panel_main.c, panel_s3.c, gfx.c, fonts.c — копия в src/panel, её
 * обновляет sync-panel.sh): он рисует кадр 800×480 в PSRAM, здесь кадр уменьшается в 0,6 раза
 * (480×288, полосы по 16 точек сверху и снизу) и уходит на экран только изменившимися полосами.
 * Строки контроллера интерфейс получает из hal_uart_write (те же, что идут по UART), его
 * команды — через кольцо в loop() (vac_uart_local). Всё это — отдельной задачей на ядре 0: ядро
 * прошивки (loop на ядре 1) не ждёт отрисовку.
 *
 * Касание: XPT2046 опрашивается только когда P14 расширителя (T_IRQ) в «0» — без касания и
 * без экрана ложных нажатий нет. Калибровка: «lcd cal» в мониторе порта или удержание пальца
 * 8 с — три крестика; хранится во флеше. «lcd flip» — экран на 180°, «lcd rgb» — поменять
 * местами красный и синий, «lcd off|on» — не рисовать (экран не подключён).
 */
#include <Arduino.h>
#include <Preferences.h>
#include <SPI.h>
#include "esp_heap_caps.h"
#include "vac_core.h"
#include "src/panel/panel_ui.h"
#include "src/panel/gfx.h"
#include "src/panel/fonts.h"

extern Preferences prefs;

#define LCD_HZ 26000000
#define TOUCH_HZ 2000000
#define SW 480 /* уменьшенный кадр */
#define SH 288
#define SY 16  /* поле сверху */

static SPIClass spi(FSPI);
static uint16_t *fb, *cur, *prev, *keep;

/* ---------------- кольца между ядрами (один пишет, один читает) ---------------- */

template <int N> struct Ring {
  volatile uint32_t w = 0, r = 0;
  uint8_t b[N];
  void put(const uint8_t *d, int n) {
    for (int i = 0; i < n; i++) {
      uint32_t nw = (w + 1) % N;
      if (nw == r) return; /* переполнено — остаток теряем (строки повторяются каждые 100 мс) */
      b[w] = d[i];
      w = nw;
    }
  }
  int get() {
    if (r == w) return -1;
    int c = b[r];
    r = (r + 1) % N;
    return c;
  }
};
static Ring<8192> rx; /* контроллер → интерфейс */
static Ring<1024> tx; /* интерфейс → контроллер */

static volatile int cmd_flip, cmd_rgb, cmd_cal, cmd_off = -1;
static uint8_t flags; /* бит 0 — на 180°, бит 1 — RGB вместо BGR, бит 2 — выключен */
static bool started;

extern "C" {
void lcd_rx_put(const char *data, int len) {
  if (started) rx.put((const uint8_t *)data, len);
}
void phal_uart_write(const char *s, int len) { tx.put((const uint8_t *)s, len); }
void phal_log(const char *line) { Serial.println(line); }

void hal_lcd(const char *c) {
  if (!strcmp(c, "lcd flip")) cmd_flip = 1;
  else if (!strcmp(c, "lcd rgb")) cmd_rgb = 1;
  else if (!strcmp(c, "lcd cal")) cmd_cal = 1;
  else if (!strcmp(c, "lcd off")) cmd_off = 1;
  else if (!strcmp(c, "lcd on")) cmd_off = 0;
  else Serial.println("lcd flip | lcd rgb | lcd cal | lcd off | lcd on");
}
}

/* Команды интерфейса — ядру (из loop(), ядро 1), своим буфером строк: плата экрана по UART может говорить одновременно. */
void lcd_poll_tx() {
  int c;
  while ((c = tx.get()) >= 0) vac_uart_local(c);
}

/* ---------------- ILI9488 ---------------- */

static inline void cs(int v) { digitalWrite(PIN_LCD_CS, v); }
static inline void dc(int v) { digitalWrite(PIN_LCD_DC, v); }

static void wcmd(uint8_t c, const uint8_t *d = nullptr, int n = 0) {
  spi.beginTransaction(SPISettings(LCD_HZ, MSBFIRST, SPI_MODE0));
  cs(0);
  dc(0);
  spi.write(c);
  dc(1);
  if (n) spi.writeBytes(d, n);
  cs(1);
  spi.endTransaction();
}

static void madctl() {
  /* Альбомная ориентация: MV; на 180° — ещё MX и MY; BGR — у большинства модулей. */
  uint8_t m = (flags & 1) ? 0xE0 : 0x20;
  if (!(flags & 2)) m |= 0x08;
  wcmd(0x36, &m, 1);
}

static void lcd_init() {
  static const uint8_t pg[] = {0x00, 0x03, 0x09, 0x08, 0x16, 0x0A, 0x3F, 0x78, 0x4C, 0x09, 0x0A, 0x08, 0x16, 0x1A, 0x0F};
  static const uint8_t ng[] = {0x00, 0x16, 0x19, 0x03, 0x0F, 0x05, 0x32, 0x45, 0x46, 0x04, 0x0E, 0x0D, 0x35, 0x37, 0x0F};
  wcmd(0x01); /* программный сброс */
  delay(130);
  wcmd(0xE0, pg, sizeof pg);
  wcmd(0xE1, ng, sizeof ng);
  const uint8_t p1[] = {0x17, 0x15}, p2[] = {0x41}, vc[] = {0x00, 0x12, 0x80}, pf[] = {0x66}, im[] = {0x00}, fr[] = {0xA0}, inv[] = {0x02},
                df[] = {0x02, 0x02, 0x3B}, em[] = {0xC6}, adj[] = {0xA9, 0x51, 0x2C, 0x82};
  wcmd(0xC0, p1, 2);
  wcmd(0xC1, p2, 1);
  wcmd(0xC5, vc, 3);
  madctl();
  wcmd(0x3A, pf, 1); /* 18 бит на точку — по SPI другого нет */
  wcmd(0xB0, im, 1);
  wcmd(0xB1, fr, 1);
  wcmd(0xB4, inv, 1);
  wcmd(0xB6, df, 3);
  wcmd(0xB7, em, 1);
  wcmd(0xF7, adj, 4);
  wcmd(0x11);
  delay(120);
  wcmd(0x29);
}

static void window(int x0, int y0, int x1, int y1) {
  const uint8_t ca[] = {(uint8_t)(x0 >> 8), (uint8_t)x0, (uint8_t)(x1 >> 8), (uint8_t)x1};
  const uint8_t ra[] = {(uint8_t)(y0 >> 8), (uint8_t)y0, (uint8_t)(y1 >> 8), (uint8_t)y1};
  wcmd(0x2A, ca, 4);
  wcmd(0x2B, ra, 4);
}

/* Прямоугольник из кадра 480×288 (строки src шириной SW) → экран, RGB565 → RGB666. */
static void push_rect(const uint16_t *src, int x0, int y0, int x1, int y1) {
  static uint8_t line[SW * 3];
  window(x0, y0 + SY, x1, y1 + SY);
  spi.beginTransaction(SPISettings(LCD_HZ, MSBFIRST, SPI_MODE0));
  cs(0);
  dc(0);
  spi.write(0x2C);
  dc(1);
  for (int y = y0; y <= y1; y++) {
    const uint16_t *p = src + y * SW;
    int n = 0;
    for (int x = x0; x <= x1; x++) {
      uint16_t c = p[x];
      line[n++] = (uint8_t)((c >> 8) & 0xF8);
      line[n++] = (uint8_t)((c >> 3) & 0xFC);
      line[n++] = (uint8_t)(c << 3);
    }
    spi.writeBytes(line, n);
  }
  cs(1);
  spi.endTransaction();
}

static void fill_band(int y0, int h) {
  static uint8_t z[SW * 3];
  memset(z, 0, sizeof z);
  window(0, y0, SW - 1, y0 + h - 1);
  spi.beginTransaction(SPISettings(LCD_HZ, MSBFIRST, SPI_MODE0));
  cs(0);
  dc(0);
  spi.write(0x2C);
  dc(1);
  for (int i = 0; i < h; i++) spi.writeBytes(z, sizeof z);
  cs(1);
  spi.endTransaction();
}

/* ---------------- кадр 800×480 → 480×288 (блоки 5×5 → 3×3, усреднение по площади) ---------------- */

static const uint8_t WT[3][5] = {{3, 2, 0, 0, 0}, {0, 1, 3, 1, 0}, {0, 0, 0, 2, 3}};

static void shrink() {
  for (int by = 0; by < SH / 3; by++)
    for (int bx = 0; bx < SW / 3; bx++) {
      /* Сначала по строкам: 5 строк × 3 точки, суммы с весами (×5). */
      uint16_t hr[5][3], hg[5][3], hb[5][3];
      for (int a = 0; a < 5; a++) {
        const uint16_t *s = fb + (by * 5 + a) * GW + bx * 5;
        uint16_t r[5], g[5], b[5];
        for (int i = 0; i < 5; i++) r[i] = s[i] >> 11, g[i] = (s[i] >> 5) & 63, b[i] = s[i] & 31;
        for (int o = 0; o < 3; o++) {
          uint16_t sr = 0, sg = 0, sb = 0;
          for (int i = 0; i < 5; i++)
            if (WT[o][i]) sr += WT[o][i] * r[i], sg += WT[o][i] * g[i], sb += WT[o][i] * b[i];
          hr[a][o] = sr, hg[a][o] = sg, hb[a][o] = sb;
        }
      }
      for (int oy = 0; oy < 3; oy++) {
        uint16_t *d = cur + (by * 3 + oy) * SW + bx * 3;
        for (int ox = 0; ox < 3; ox++) {
          uint32_t sr = 0, sg = 0, sb = 0;
          for (int a = 0; a < 5; a++)
            if (WT[oy][a]) sr += WT[oy][a] * hr[a][ox], sg += WT[oy][a] * hg[a][ox], sb += WT[oy][a] * hb[a][ox];
          d[ox] = (uint16_t)(((sr + 12) / 25) << 11 | ((sg + 12) / 25) << 5 | ((sb + 12) / 25));
        }
      }
    }
}

/* Изменившиеся полосы (до 16 строк) — на экран; всё — после смены ориентации и калибровки. */
static void push(bool all) {
  shrink();
  for (int y = 0; y < SH;) {
    int x0 = SW, x1 = -1, y1 = y;
    for (; y1 < SH && y1 < y + 16; y1++) {
      const uint16_t *a = cur + y1 * SW, *b = prev + y1 * SW;
      if (!all && !memcmp(a, b, SW * 2)) {
        if (x1 >= 0) break;
        continue;
      }
      int l = 0, r = SW - 1;
      if (!all) {
        while (a[l] == b[l]) l++;
        while (a[r] == b[r]) r--;
      }
      if (l < x0) x0 = l;
      if (r > x1) x1 = r;
    }
    if (x1 >= 0) {
      int ys = y;
      while (ys < y1 && !all && !memcmp(cur + ys * SW, prev + ys * SW, SW * 2)) ys++;
      push_rect(cur, x0, ys, x1, y1 - 1);
      for (int k = ys; k < y1; k++) memcpy(prev + k * SW, cur + k * SW, SW * 2);
    }
    y = y1;
  }
}

/* ---------------- касание XPT2046 ---------------- */

struct TCal {
  float ax, bx, ay, by;
  uint8_t swap, ok;
};
static TCal cal = {-480.0f / 3400, 480.0f * 3700 / 3400, -320.0f / 3400, 320.0f * 3700 / 3400, 1, 0};

static int xpt(uint8_t c) {
  uint8_t d[3] = {c, 0, 0};
  digitalWrite(PIN_TOUCH_CS, 0);
  spi.transferBytes(d, d, 3);
  digitalWrite(PIN_TOUCH_CS, 1);
  return ((d[1] << 8) | d[2]) >> 3;
}

/* Сырые координаты (среднее 4 отсчётов) или false, если нет касания. */
static bool touch_raw(int *rx_, int *ry_) {
  if (!(vac.keys & (1u << K_TOUCH))) return false;
  spi.beginTransaction(SPISettings(TOUCH_HZ, MSBFIRST, SPI_MODE0));
  int z1 = xpt(0xB1), z2 = xpt(0xC1);
  int sx = 0, sy = 0;
  for (int i = 0; i < 4; i++) sx += xpt(0xD1), sy += xpt(0x91);
  xpt(0x90); /* последней — команда с PD = 00: T_IRQ снова следит за касанием */
  spi.endTransaction();
  sx /= 4, sy /= 4;
  int z = z1 + 4095 - z2;
  if (z < 300 || sx < 60 || sx > 4040 || sy < 60 || sy > 4040) return false;
  *rx_ = sx, *ry_ = sy;
  return true;
}

/* Точка экрана 480×320 по сырым. */
static void to_screen(int rx_, int ry_, int *x, int *y) {
  float u = cal.swap ? ry_ : rx_, v = cal.swap ? rx_ : ry_;
  *x = (int)(cal.ax * u + cal.bx);
  *y = (int)(cal.ay * v + cal.by);
}

/* ---------------- калибровка ---------------- */

static const int CX[3] = {40, 440, 40}, CY[3] = {40, 40, 280};

static void cal_draw(int i) {
  g_fill(0, 0, GW, GH, 0);
  /* Крестик в точке экрана (CX, CY) — в кадре 800×480 это (CX/0,6, (CY − 16)/0,6). */
  float x = CX[i] / 0.6f, y = (CY[i] - SY) / 0.6f;
  g_line(x - 30, y, x + 30, y, 4, 0xFFFF);
  g_line(x, y - 30, x, y + 30, 4, 0xFFFF);
  g_text_at(&F_S20, GW / 2, GH / 2 - 20, "Калибровка касания", 0xFFFF, 1);
  g_text_at(&F_S16, GW / 2, GH / 2 + 20, i == 0 ? "коснитесь центра крестика и отпустите" : "теперь — следующего", 0xC618, 1);
  push(true);
}

static int cal_i = -1, cal_n;
static long cal_sx, cal_sy;
static int cal_raw[3][2];
static bool cal_down;
static uint32_t cal_t0;

static void cal_start() {
  memcpy(keep, fb, GW * GH * 2);
  cal_i = 0;
  cal_n = 0;
  cal_down = false;
  cal_t0 = millis();
  cal_draw(0);
  Serial.println("Калибровка касания: три крестика");
}

static void cal_finish(bool ok) {
  if (ok) {
    /* Ось экрана x — та сырая, что сильнее менялась от точки 0 к точке 1. */
    int dx0 = abs(cal_raw[1][0] - cal_raw[0][0]), dx1 = abs(cal_raw[1][1] - cal_raw[0][1]);
    cal.swap = dx1 > dx0;
    float u0 = cal.swap ? cal_raw[0][1] : cal_raw[0][0], u1 = cal.swap ? cal_raw[1][1] : cal_raw[1][0];
    float v0 = cal.swap ? cal_raw[0][0] : cal_raw[0][1], v2 = cal.swap ? cal_raw[2][0] : cal_raw[2][1];
    if (fabsf(u1 - u0) > 300 && fabsf(v2 - v0) > 200) {
      cal.ax = (CX[1] - CX[0]) / (u1 - u0);
      cal.bx = CX[0] - cal.ax * u0;
      cal.ay = (CY[2] - CY[0]) / (v2 - v0);
      cal.by = CY[0] - cal.ay * v0;
      cal.ok = 1;
      prefs.putBytes("tcal", &cal, sizeof cal);
      Serial.println("Калибровка касания сохранена");
    } else
      Serial.println("Калибровка не удалась: точки слишком близко");
  }
  memcpy(fb, keep, GW * GH * 2);
  cal_i = -1;
  push(true);
}

static void cal_step() {
  int rx_, ry_;
  bool t = touch_raw(&rx_, &ry_);
  if (t) {
    cal_down = true;
    cal_sx += rx_, cal_sy += ry_, cal_n++;
  } else if (cal_down) {
    cal_down = false;
    if (cal_n >= 3) {
      cal_raw[cal_i][0] = (int)(cal_sx / cal_n), cal_raw[cal_i][1] = (int)(cal_sy / cal_n);
      if (++cal_i == 3) return cal_finish(true);
      cal_draw(cal_i);
    }
    cal_sx = cal_sy = cal_n = 0;
  }
  if (millis() - cal_t0 > 60000) cal_finish(false);
}

/* ---------------- задача экрана ---------------- */

static void lcd_task(void *) {
  pinMode(PIN_LCD_CS, OUTPUT);
  pinMode(PIN_TOUCH_CS, OUTPUT);
  pinMode(PIN_LCD_DC, OUTPUT);
  digitalWrite(PIN_LCD_CS, 1);
  digitalWrite(PIN_TOUCH_CS, 1);
  spi.begin(PIN_SPI_SCK, PIN_SPI_MISO, PIN_SPI_MOSI, -1);
  lcd_init();
  fill_band(0, 320);
  memset(prev, 0, SW * SH * 2);
  ui_setup(fb);
  bool all = true, sleeping = false, down = false;
  int lx = 0, ly = 0, hx = 0, hy = 0, miss = 0;
  uint32_t t_touch = 0, hold_t0 = 0;
  for (;;) {
    uint32_t ms = millis();
    int c;
    while ((c = rx.get()) >= 0) ui_rx(c);
    if (cmd_flip) cmd_flip = 0, flags ^= 1, prefs.putUChar("lcdf", flags), madctl(), fill_band(0, 320), all = true;
    if (cmd_rgb) cmd_rgb = 0, flags ^= 2, prefs.putUChar("lcdf", flags), madctl(), all = true;
    if (cmd_off >= 0) flags = (uint8_t)(cmd_off ? flags | 4 : flags & ~4), cmd_off = -1, prefs.putUChar("lcdf", flags), all = true;
    if (cmd_cal && cal_i < 0) {
      cmd_cal = 0;
      if (down) ui_touch(lx, ly, 0), down = false;
      cal_start();
    }
    if (cal_i >= 0) {
      /* Пока калибровка — интерфейс не рисует (кадр с крестиками), строки только разбирает. */
      if (ms - t_touch >= 20) t_touch = ms, cal_step();
      vTaskDelay(pdMS_TO_TICKS(10));
      continue;
    }
    bool drawn = ui_loop(ms) != 0;
    if (ms - t_touch >= 20) {
      t_touch = ms;
      int rx_, ry_;
      if (touch_raw(&rx_, &ry_)) {
        int x, y;
        to_screen(rx_, ry_, &x, &y);
        /* Экран 480×320 → кадр интерфейса 800×480. */
        lx = constrain((int)(x / 0.6f), 0, GW - 1);
        ly = constrain((int)((y - SY) / 0.6f), 0, GH - 1);
        ui_touch(lx, ly, 1);
        miss = 0;
        if (!down || abs(lx - hx) > 40 || abs(ly - hy) > 40) hold_t0 = ms, hx = lx, hy = ly;
        down = true;
        /* Палец 8 с на одном месте — калибровка (если касание совсем мимо, кнопками её не вызвать). */
        if (ms - hold_t0 > 8000) ui_touch(lx, ly, 0), down = false, cal_start();
      } else if (down && ++miss >= 2) {
        /* Отпускание — после двух пустых опросов: T_IRQ мог попасть на время замера. */
        ui_touch(lx, ly, 0);
        down = false;
      }
    }
    bool sl = ui_sleeping() != 0;
    if (!(flags & 4)) {
      /* Подсветка у экрана всегда от 3,3 В — «сон» показываем чёрным экраном (кадр интерфейса не трогаем). */
      if (sl && !sleeping) fill_band(0, 320), memset(prev, 0, SW * SH * 2);
      else if (!sl && (drawn || all || sleeping)) push(all || sleeping), all = false;
    }
    sleeping = sl;
    vTaskDelay(pdMS_TO_TICKS(10));
  }
}

void lcd_start() {
  fb = (uint16_t *)heap_caps_malloc(GW * GH * 2, MALLOC_CAP_SPIRAM);
  keep = (uint16_t *)heap_caps_malloc(GW * GH * 2, MALLOC_CAP_SPIRAM);
  cur = (uint16_t *)heap_caps_malloc(SW * SH * 2, MALLOC_CAP_SPIRAM);
  prev = (uint16_t *)heap_caps_malloc(SW * SH * 2, MALLOC_CAP_SPIRAM);
  if (!fb || !keep || !cur || !prev) {
    Serial.println("Экран на контроллере выключен: нет PSRAM (плата N16R8, в настройках сборки — OPI PSRAM)");
    return;
  }
  memset(fb, 0, GW * GH * 2);
  flags = prefs.getUChar("lcdf", 0);
  if (prefs.isKey("tcal")) prefs.getBytes("tcal", &cal, sizeof cal);
  if (!cal.ok) Serial.println("Касание экрана не откалибровано: lcd cal (или палец 8 с на экране)");
  started = true;
  xTaskCreatePinnedToCore(lcd_task, "lcd", 12288, nullptr, 1, nullptr, 0);
}
