/*
 * Демо симуляции Plata (Arduino Nano):
 *   D13 — светодиод мигает раз в секунду, D6 — светодиод «дышит» (ШИМ),
 *   D2 — кнопка на землю: пока нажата, горит D12 и пищит зуммер на D11 (1 кГц),
 *   A0 — потенциометр, D4 — DHT22, ЖК 1602 по I2C (0x27) на A4/A5.
 *   Раз в полсекунды: показания на ЖК и в монитор порта (9600).
 */
#include "common.h"
static void pcf(uint8_t v) { twi_start(0x27 << 1); twi_write(v | 0x08); twi_stop(); }
static void nib(uint8_t n, uint8_t rs) { uint8_t v = (n << 4) | rs; pcf(v | 4); pcf(v); }
static void lcd(uint8_t b, uint8_t rs) { nib(b >> 4, rs); nib(b & 15, rs); }
static void lcd_text(const char *s) { while (*s) lcd(*s++, 1); }
static void lcd_num(long v, uint8_t frac) {
  char b[12]; int i = 0; uint8_t neg = v < 0; if (neg) v = -v;
  do { b[i++] = '0' + v % 10; v /= 10; if (frac && i == 1) b[i++] = '.'; } while (v || (frac && i < 3));
  if (neg) b[i++] = '-';
  while (i) lcd(b[--i], 1);
}
static unsigned adc_read(uint8_t ch) { ADMUX = (1 << REFS0) | ch; ADCSRA = (1 << ADEN) | (1 << ADSC) | 7; while (ADCSRA & (1 << ADSC)); return ADC; }
static uint16_t wait_level(uint8_t level) { TCNT1 = 0; while (((PIND >> 4) & 1) != level) if (TCNT1 > 400) return 0xFFFF; return TCNT1; }
static uint8_t dht(int16_t *t, uint16_t *h) {
  uint8_t d[5] = { 0 };
  DDRD |= 1 << 4; PORTD &= ~(1 << 4); _delay_ms(2); DDRD &= ~(1 << 4); PORTD |= 1 << 4;
  if (wait_level(0) == 0xFFFF || wait_level(1) == 0xFFFF || wait_level(0) == 0xFFFF) return 0;
  for (uint8_t i = 0; i < 40; i++) {
    if (wait_level(1) == 0xFFFF) return 0;
    uint16_t hi = wait_level(0);
    d[i / 8] <<= 1; if (hi > 80 || hi == 0xFFFF) d[i / 8] |= 1;
  }
  if ((uint8_t)(d[0] + d[1] + d[2] + d[3]) != d[4]) return 0;
  *h = (d[0] << 8) | d[1]; *t = ((d[2] & 0x7F) << 8) | d[3]; if (d[2] & 0x80) *t = -*t;
  return 1;
}
int main(void) {
  uart_init(); twi_init();
  DDRB |= (1 << 5) | (1 << 4) | (1 << 3); DDRD |= 1 << 6; PORTD |= 1 << 2;
  TCCR0A = (1 << COM0A1) | (1 << WGM01) | (1 << WGM00); TCCR0B = (1 << CS01) | (1 << CS00);
  TCCR2A = (1 << WGM21); TCCR2B = (1 << CS22); OCR2A = 124;
  TCCR1A = 0; TCCR1B = (1 << CS11);
  _delay_ms(50); nib(3, 0); _delay_ms(5); nib(3, 0); nib(3, 0); nib(2, 0);
  lcd(0x28, 0); lcd(0x0C, 0); lcd(0x01, 0); _delay_ms(2); lcd(0x06, 0);
  lcd_text("Plata simulation");
  uart_str("Plata simulation demo\r\n");
  uint16_t tick = 0; uint8_t br = 0; int8_t dir = 4;
  for (;;) {
    uint8_t pressed = !(PIND & (1 << 2));
    if (pressed) { PORTB |= 1 << 4; TCCR2A |= 1 << COM2A0; } else { PORTB &= ~(1 << 4); TCCR2A &= ~(1 << COM2A0); PORTB &= ~(1 << 3); }
    br += dir; if (br > 248 || br < 4) dir = -dir; OCR0A = br;
    _delay_ms(10);
    if (++tick % 50 == 0) {
      PORTB ^= 1 << 5;
      int16_t t = 0; uint16_t h = 0; uint8_t ok = dht(&t, &h);
      unsigned a = adc_read(0);
      lcd(0x80, 0);
      if (ok) { lcd_text("T="); lcd_num(t, 1); lcd(0xDF, 1); lcd_text("C H="); lcd_num(h / 10, 0); lcd_text("%  "); } else lcd_text("DHT22: no data  ");
      lcd(0xC0, 0); lcd_text("A0="); lcd_num(a, 0); lcd_text(pressed ? " BTN:1  " : " BTN:0  ");
      uart_str("T="); uart_num(t); uart_str(" H="); uart_num(h); uart_str(" A0="); uart_num(a); uart_str(pressed ? " BTN=1\r\n" : " BTN=0\r\n");
    }
  }
}
