/*
 * Вход пульта: байты от контроллера разбирают оба интерфейса, а на экране — тот, чей
 * контроллер на связи. Пока контроллер «S3» не узнан (в его строке «S» есть поле e1),
 * работает интерфейс контроллера на ESP32 — он же показывает «ждём контроллер…».
 */
#include "panel_int.h"

static uint16_t *frame;
static int s3_on, t35;

void ui_setup(uint16_t *fb) {
  frame = fb;
  v1_setup(fb);
}

/* Экран 3,5″ на контроллере: кадр 480×320, сразу интерфейс «S3» 6.0. */
void ui_setup_t35(uint16_t *fb) {
  frame = fb;
  t35 = 1;
  t35_setup(fb);
}

int ui_loop(uint32_t ms) {
  if (t35) return t35_loop(ms);
  if (!s3_on && s3_detected()) {
    s3_on = 1;
    s3_setup(frame);
  }
  return s3_on ? s3_loop(ms) : v1_loop(ms);
}

void ui_touch(int x, int y, int down) {
  if (t35) t35_touch(x, y, down);
  else if (s3_on) s3_touch(x, y, down);
  else v1_touch(x, y, down);
}

void ui_rx(int ch) {
  if (t35) return t35_rx(ch);
  v1_rx(ch);
  s3_rx(ch);
}

int ui_sleeping(void) { return t35 ? t35_sleeping() : s3_on && s3_sleeping(); }
