/* Только для сборки в WebAssembly: общий буфер, через который симулятор передаёт строки и посылки пульта. */
#include "vac_core.h"

static char sim_buf[2048];

char *sim_buffer(void) { return sim_buf; }
