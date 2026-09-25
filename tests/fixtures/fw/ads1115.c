/* ADS1115 (0x48): однократное измерение AIN0 относительно земли, ±4,096 В → сырое значение. */
#include "common.h"
int main(void) {
  uart_init(); twi_init();
  for (;;) {
    twi_start(0x48 << 1); twi_write(1); twi_write(0xC3); twi_write(0x83); twi_stop();
    _delay_ms(10);
    twi_start(0x48 << 1); twi_write(0); twi_start((0x48 << 1) | 1);
    uint8_t hi = twi_read(1), lo = twi_read(0); twi_stop();
    uart_str("R="); uart_num((int16_t)((hi << 8) | lo)); uart_str("\r\n");
    _delay_ms(200);
  }
}
