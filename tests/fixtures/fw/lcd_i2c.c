/* ЖК 16×2 через PCF8574 (0x27): P0=RS, P1=RW, P2=E, P3=подсветка, P4–P7=D4–D7. */
#include "common.h"
static void pcf(uint8_t v) { twi_start(0x27 << 1); twi_write(v | 0x08); twi_stop(); }
static void nib(uint8_t n, uint8_t rs) { uint8_t v = (n << 4) | rs; pcf(v | 4); _delay_us(1); pcf(v); _delay_us(50); }
static void lcd(uint8_t b, uint8_t rs) { nib(b >> 4, rs); nib(b & 15, rs); }
static void text(const char *s) { while (*s) lcd(*s++, 1); }
int main(void) {
  twi_init(); _delay_ms(50);
  nib(3, 0); _delay_ms(5); nib(3, 0); _delay_us(150); nib(3, 0); nib(2, 0);
  lcd(0x28, 0); lcd(0x0C, 0); lcd(0x01, 0); _delay_ms(2); lcd(0x06, 0);
  text("Hello, Plata!"); lcd(0xC0, 0); text("I2C LCD 1602");
  for (;;);
}
