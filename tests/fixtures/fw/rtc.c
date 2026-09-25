/* DS3231 (0x68): чтение секунд, минут, часов (BCD) → чч:мм:сс. */
#include "common.h"
static void two(uint8_t bcd) { uart_put('0' + (bcd >> 4)); uart_put('0' + (bcd & 15)); }
int main(void) {
  uart_init(); twi_init();
  for (;;) {
    twi_start(0x68 << 1); twi_write(0); twi_start((0x68 << 1) | 1);
    uint8_t s = twi_read(1), m = twi_read(1), h = twi_read(0); twi_stop();
    two(h & 0x3F); uart_put(':'); two(m); uart_put(':'); two(s & 0x7F); uart_str("\r\n");
    _delay_ms(1000);
  }
}
