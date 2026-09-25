/* Параллельный ЖК как в LiquidCrystal lcd(12, 11, 5, 4, 3, 2): RS=D12, E=D11, D4=D5, D5=D4, D6=D3, D7=D2. */
#include "common.h"
static void put4(uint8_t n) {
  if (n & 1) PORTD |= 1 << 5; else PORTD &= ~(1 << 5);
  if (n & 2) PORTD |= 1 << 4; else PORTD &= ~(1 << 4);
  if (n & 4) PORTD |= 1 << 3; else PORTD &= ~(1 << 3);
  if (n & 8) PORTD |= 1 << 2; else PORTD &= ~(1 << 2);
  PORTB |= 1 << 3; _delay_us(1); PORTB &= ~(1 << 3); _delay_us(50);
}
static void lcd(uint8_t b, uint8_t rs) { if (rs) PORTB |= 1 << 4; else PORTB &= ~(1 << 4); put4(b >> 4); put4(b & 15); }
int main(void) {
  DDRB |= (1 << 4) | (1 << 3); DDRD |= 0x3C; _delay_ms(50);
  PORTB &= ~(1 << 4); put4(3); _delay_ms(5); put4(3); put4(3); put4(2);
  lcd(0x28, 0); lcd(0x0C, 0); lcd(0x01, 0); _delay_ms(2); lcd(0x06, 0);
  const char *s = "Parallel LCD"; while (*s) lcd(*s++, 1);
  for (;;);
}
