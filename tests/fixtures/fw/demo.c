/* Демо: «Plata OK» в порт, D13 мигает 5 Гц, ШИМ 25 % на D6, кнопка D2 → светодиод D12, 'a' — значение A0, остальное — эхо заглавными. */
#include "common.h"
static unsigned adc_read(uint8_t ch) { ADMUX = (1 << REFS0) | ch; ADCSRA = (1 << ADEN) | (1 << ADSC) | 7; while (ADCSRA & (1 << ADSC)); return ADC; }
int main(void) {
  uart_init(); uart_str("Plata OK\r\n");
  DDRB |= (1 << 5) | (1 << 4); PORTD |= (1 << 2); DDRD |= (1 << 6);
  TCCR0A = (1 << COM0A1) | (1 << WGM01) | (1 << WGM00); TCCR0B = (1 << CS01) | (1 << CS00); OCR0A = 64;
  unsigned t = 0;
  for (;;) {
    if (!(PIND & (1 << 2))) PORTB |= (1 << 4); else PORTB &= ~(1 << 4);
    if (UCSR0A & (1 << RXC0)) { char c = UDR0; if (c == 'a') { uart_str("A0="); uart_num(adc_read(0)); uart_str("\r\n"); } else uart_put(c >= 'a' && c <= 'z' ? c - 32 : c); }
    _delay_ms(1);
    if (++t >= 100) { t = 0; PORTB ^= (1 << 5); }
  }
}
