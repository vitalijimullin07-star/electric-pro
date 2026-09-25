/* DHT22 на D2: запрос, приём 40 бит по длительности импульсов (таймер 1, 0,5 мкс), вывод T и H ×10. */
#include "common.h"
static uint16_t wait_level(uint8_t level) { TCNT1 = 0; while (((PIND >> 2) & 1) != level) if (TCNT1 > 400) return 0xFFFF; return TCNT1; }
int main(void) {
  uart_init(); TCCR1A = 0; TCCR1B = (1 << CS11);
  _delay_ms(100);
  for (;;) {
    uint8_t d[5] = { 0 };
    DDRD |= 1 << 2; PORTD &= ~(1 << 2); _delay_ms(2);
    DDRD &= ~(1 << 2); PORTD |= 1 << 2;
    uint8_t ok = wait_level(0) != 0xFFFF && wait_level(1) != 0xFFFF && wait_level(0) != 0xFFFF;
    for (uint8_t i = 0; ok && i < 40; i++) {
      if (wait_level(1) == 0xFFFF) { ok = 0; break; }
      uint16_t hi = wait_level(0);
      if (hi == 0xFFFF && i != 39) { ok = 0; break; }
      d[i / 8] <<= 1; if (hi > 80 || hi == 0xFFFF) d[i / 8] |= 1;
    }
    if (ok && (uint8_t)(d[0] + d[1] + d[2] + d[3]) == d[4]) {
      int16_t t = ((d[2] & 0x7F) << 8) | d[3]; if (d[2] & 0x80) t = -t;
      uart_str("T="); uart_num(t); uart_str(" H="); uart_num((d[0] << 8) | d[1]); uart_str("\r\n");
    } else uart_str("DHT ERR\r\n");
    _delay_ms(500);
  }
}
