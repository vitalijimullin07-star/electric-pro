/* Кнопка пульта (в заголовке — чтобы прототипы, которые Arduino ставит в начало .ino, знали тип). */
#ifndef REMOTE_BTN_H
#define REMOTE_BTN_H
#include <stdint.h>

struct Btn {
  int pin;
  bool down;
  bool hold;
  uint32_t t;
};

#endif
