/* OLED SSD1306 128×64 по I2C (0x3C): рамка по краю и диагональ. */
#include "common.h"
static void cmd(uint8_t c) { twi_start(0x3C << 1); twi_write(0x00); twi_write(c); twi_stop(); }
int main(void) {
  twi_init(); _delay_ms(10);
  const uint8_t init[] = { 0xAE, 0x20, 0x00, 0x21, 0, 127, 0x22, 0, 7, 0x8D, 0x14, 0xA1, 0xC8, 0xAF };
  for (uint8_t i = 0; i < sizeof init; i++) cmd(init[i]);
  twi_start(0x3C << 1); twi_write(0x40);
  for (uint16_t i = 0; i < 1024; i++) {
    uint8_t x = i & 127, page = i >> 7, v = 0;
    if (x == 0 || x == 127) v = 0xFF;
    if (page == 0) v |= 0x01;
    if (page == 7) v |= 0x80;
    if (x >> 3 == page * 2) v |= 1 << (x & 7);
    twi_write(v);
  }
  twi_stop();
  for (;;);
}
