/* Общие помощники тестовых прошивок: UART 9600 и I2C (TWI) 100 кГц. F_CPU = 16 МГц. */
#include <avr/io.h>
#include <util/delay.h>
static void uart_init(void) { UBRR0H = 0; UBRR0L = 103; UCSR0B = (1 << TXEN0) | (1 << RXEN0); UCSR0C = (1 << UCSZ01) | (1 << UCSZ00); }
static void uart_put(char c) { while (!(UCSR0A & (1 << UDRE0))); UDR0 = c; }
static void uart_str(const char *s) { while (*s) uart_put(*s++); }
static void uart_num(long v) { char b[12]; int i = 0; if (v < 0) { uart_put('-'); v = -v; } do { b[i++] = '0' + v % 10; v /= 10; } while (v); while (i) uart_put(b[--i]); }
static void twi_init(void) { TWSR = 0; TWBR = 72; TWCR = (1 << TWEN); }
static uint8_t twi_start(uint8_t addr) { TWCR = (1 << TWINT) | (1 << TWSTA) | (1 << TWEN); while (!(TWCR & (1 << TWINT))); TWDR = addr; TWCR = (1 << TWINT) | (1 << TWEN); while (!(TWCR & (1 << TWINT))); uint8_t st = TWSR & 0xF8; return st == 0x18 || st == 0x40; }
static void twi_write(uint8_t v) { TWDR = v; TWCR = (1 << TWINT) | (1 << TWEN); while (!(TWCR & (1 << TWINT))); }
static uint8_t twi_read(uint8_t ack) { TWCR = (1 << TWINT) | (1 << TWEN) | (ack ? (1 << TWEA) : 0); while (!(TWCR & (1 << TWINT))); return TWDR; }
static void twi_stop(void) { TWCR = (1 << TWINT) | (1 << TWSTO) | (1 << TWEN); _delay_us(10); }
