/* Только для сборки в WebAssembly: общий буфер, через который симулятор передаёт строки. */
#include "vac_core.h"

static char sim_buf[512];

char *sim_buffer(void) { return sim_buf; }
