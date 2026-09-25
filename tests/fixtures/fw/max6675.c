/* MAX6675 программным SPI: CS=D10, SO=D12, SCK=D13; температура ×4. */
#include "common.h"
int main(void) {
  uart_init(); DDRB |= (1 << 2) | (1 << 5); PORTB |= 1 << 2; _delay_ms(10);
  for (;;) {
    PORTB &= ~(1 << 2); _delay_us(2);
    uint16_t v = 0;
    for (uint8_t i = 0; i < 16; i++) { PORTB |= 1 << 5; _delay_us(1); v = (v << 1) | ((PINB >> 4) & 1); PORTB &= ~(1 << 5); _delay_us(1); }
    PORTB |= 1 << 2;
    uart_str("Q="); uart_num(v >> 3); uart_str("\r\n");
    _delay_ms(250);
  }
}
