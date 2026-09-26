/* Прослойка panel_ui.h для Arduino-ESP32 3.x (в отдельном файле — препроцессор .ino её не трогает). */
#include <Arduino.h>
#include "panel_ui.h"

extern "C" {
void phal_uart_write(const char *s, int len) { Serial1.write((const uint8_t *)s, (size_t)len); }
void phal_log(const char *line) { Serial.println(line); }
}
