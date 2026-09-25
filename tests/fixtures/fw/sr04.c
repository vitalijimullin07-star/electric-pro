/* HC-SR04: TRIG=D9, ECHO=D8; длительность эха таймером 1 (0,5 мкс) → см. */
#include "common.h"
int main(void) {
  uart_init(); DDRB |= 1 << 1; TCCR1A = 0; TCCR1B = (1 << CS11);
  for (;;) {
    PORTB |= 1 << 1; _delay_us(12); PORTB &= ~(1 << 1);
    TCNT1 = 0; while (!(PINB & 1)) if (TCNT1 > 60000) break;
    TCNT1 = 0; while (PINB & 1) if (TCNT1 > 60000) break;
    uint16_t us = TCNT1 / 2;
    uart_str("D="); uart_num(us / 58); uart_str("\r\n");
    _delay_ms(60);
  }
}
