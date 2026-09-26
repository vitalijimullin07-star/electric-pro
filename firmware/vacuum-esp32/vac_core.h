/*
 * Контроллер строительного пылесоса на ESP32: две турбины (фазовое управление через
 * MOC3023 и BTA41), розетка инструмента с автопуском, два клапана продувки фильтра,
 * датчики тока (трансформаторы тока), температуры двигателей (NTC), разрежения
 * (MPX5050DP), перепада на фильтре и расхода воздуха (SDP810), экран OLED, энкодер
 * и три кнопки на панели.
 */
#ifndef VAC_CORE_H
#define VAC_CORE_H
#include <stdint.h>
#include "vac_hal.h"

#ifdef __cplusplus
extern "C" {
#endif

#define VAC_VERSION "1.0"

/* ---- выводы ESP32-WROOM-32E ---- */
#define PIN_T1 25       /* турбина 1: светодиод MOC3023 (U1) */
#define PIN_T2 26       /* турбина 2: MOC3023 (U2) */
#define PIN_OUTLET 27   /* розетка инструмента: MOC3063 (U3) */
#define PIN_Y1 13       /* клапан продувки 1: MOC3063 (U4) → BT134W */
#define PIN_Y2 4        /* клапан продувки 2: MOC3063 (U5) → BT134W */
#define PIN_ZC 23       /* детектор нуля сети (1 — около нуля) */
#define PIN_CT1 36      /* ток турбины 1 (ТТ1, нагрузка 82 Ом) */
#define PIN_CT2 39      /* ток турбины 2 (ТТ2, нагрузка 82 Ом) */
#define PIN_CT3 34      /* ток инструмента (ТТ3, нагрузка 33 Ом) */
#define PIN_VAC 35      /* разрежение MPX5050DP через делитель 6,8к/10к */
#define PIN_NTC1 32     /* термистор турбины 1 (10к B3950, верхнее плечо 10к) */
#define PIN_NTC2 33     /* термистор турбины 2 */
#define PIN_SDA0 21     /* I²C 0: экран и SDP810-500Pa (перепад на фильтре) */
#define PIN_SCL0 22
#define PIN_SDA1 16     /* I²C 1: SDP810-125Pa (расходомер) */
#define PIN_SCL1 17
#define PIN_ENC_A 18
#define PIN_ENC_B 19
#define PIN_ENC_SW 5
#define PIN_K_START 14  /* «Пуск/Стоп» */
#define PIN_K_MODE 12   /* «Режим» (без внешней подтяжки: IO12 — вывод настройки) */
#define PIN_K_PURGE 15  /* «Продувка» */
#define PIN_BUZZER 2

/* ---- настройки (хранятся в памяти ESP32) ---- */
typedef struct {
  uint16_t magic;
  uint8_t version;
  uint8_t power;         /* мощность, % (30…100) */
  uint8_t turbines;      /* 0 — обе, 1 — только Т1, 2 — только Т2 */
  uint8_t mode;          /* 0 — ручной, 1 — авто от инструмента */
  uint8_t runon;         /* выбег после инструмента, с */
  uint8_t softstart;     /* плавный пуск, ×0,1 с */
  uint16_t tool_ma;      /* порог тока инструмента, мА */
  uint16_t purge_pa;     /* автопродувка при перепаде на фильтре, Па (0 — выкл.) */
  uint8_t purge_pulses;  /* импульсов на каждый клапан */
  uint8_t purge_ms10;    /* длительность импульса, ×10 мс */
  uint8_t purge_stop;    /* продувка после остановки */
  uint8_t min_speed;     /* скорость воздуха в шланге для тревоги, м/с (0 — выкл.) */
  uint8_t hose_mm;       /* внутренний диаметр шланга, мм */
  uint8_t display;       /* 0 — SSD1306 0,96″, 1 — SH1106 1,3″ */
  int16_t zc_shift_us;   /* поправка момента нуля, мкс */
  uint16_t mains_cal;    /* калибровка напряжения сети, ‰ */
  uint16_t flow_k10;     /* коэффициент расходомера ×10: Q[м³/ч] = k·√Δp */
  uint32_t hours1;       /* наработка турбины 1, с */
  uint32_t hours2;
  uint8_t crc;
} vac_settings_t;

extern vac_settings_t vac_cfg;

/* ---- состояние для экрана, порта и веб-страницы ---- */
enum { VAC_STANDBY = 0, VAC_ACTIVE = 1 };
enum { VAC_MANUAL = 0, VAC_AUTO = 1 };

/* Неисправности: биты. */
enum {
  F_NO_ZC = 1 << 0,       /* нет синхронизации с сетью */
  F_HOT1 = 1 << 1,        /* перегрев турбины 1 (отключена) */
  F_HOT2 = 1 << 2,
  F_WARM1 = 1 << 3,       /* турбина 1 горячая — мощность снижена */
  F_WARM2 = 1 << 4,
  F_NTC1 = 1 << 5,        /* датчик температуры 1 неисправен */
  F_NTC2 = 1 << 6,
  F_OVER1 = 1 << 7,       /* перегрузка по току турбины 1 */
  F_OVER2 = 1 << 8,
  F_NOCUR1 = 1 << 9,      /* нет тока турбины 1: щётки, обрыв, симистор */
  F_NOCUR2 = 1 << 10,
  F_LEAK1 = 1 << 11,      /* ток при выключенной турбине: пробит симистор */
  F_LEAK2 = 1 << 12,
  F_LOWAIR = 1 << 13,     /* мало воздуха в шланге */
  F_BLOCKED = 1 << 14,    /* шланг или бак забит */
  F_FILTER = 1 << 15,     /* фильтр забит и после продувки */
  F_MAINS = 1 << 16,      /* напряжение сети вне 190…250 В */
  F_SDP_F = 1 << 17,      /* нет связи с датчиком перепада */
  F_SDP_Q = 1 << 18,      /* нет связи с расходомером */
  F_VAC = 1 << 19,        /* датчик разрежения вне диапазона */
};

typedef struct {
  uint8_t state;          /* VAC_STANDBY / VAC_ACTIVE */
  uint8_t mode;           /* VAC_MANUAL / VAC_AUTO */
  uint8_t running;        /* турбины сейчас работают */
  uint8_t purging;        /* идёт продувка */
  uint8_t tool_on;        /* инструмент включён (по току) */
  uint8_t outlet_on;      /* на розетку подано напряжение */
  uint8_t valve[2];
  float pcmd[2];          /* текущая мощность турбин, % (с плавным пуском) */
  float amps[2];          /* ток турбин, А */
  float tool_amps;
  float temp[2];          /* температура двигателей, °C */
  float mains_v;          /* напряжение сети, В */
  float mains_hz;
  float vacuum_kpa;       /* разрежение на входе турбин */
  float filter_pa;        /* перепад на фильтре */
  float flow_m3h;         /* расход воздуха */
  float speed_ms;         /* скорость воздуха в шланге */
  uint32_t faults;
  uint16_t runon_left;    /* секунд до остановки после инструмента */
  uint32_t uptime_s;
  uint32_t purges;        /* продувок за включение */
} vac_state_t;

extern vac_state_t vac;

/* ---- вход в ядро ---- */
void vac_setup(void);
/* Вызывать как можно чаще (не реже раза в миллисекунду). */
void vac_loop(void);
/* Прерывание таймера каждые 100 мкс: импульсы на симисторы, опрос энкодера. */
void vac_tick(void);
/* Прерывание по фронту вывода (детектор нуля). */
void vac_on_pin(int pin, int level, uint32_t us);
/* Байт из монитора порта: команды help, status, start, stop, auto, manual, purge, power N. */
void vac_serial(int ch);
/* Команда строкой (монитор порта, веб-страница). */
void vac_command(const char *cmd);
/* Состояние в JSON для веб-страницы; возвращает длину. */
int vac_status_json(char *buf, int len);

/* ---- общее для частей ядра ---- */
void vac_save_settings(void);
void vac_start_stop(void);
void vac_toggle_mode(void);
void vac_purge_now(void);
const char *vac_fault_text(uint32_t bit);
void vac_beep(int kind);  /* 0 — щелчок, 1 — подтверждение, 2 — предупреждение, 3 — тревога */

/* vac_ui.c */
void ui_init(void);
void ui_poll(uint32_t ms);
void ui_encoder_step(int dir);
void ui_encoder_poll(void);

/* vac_drv.c: экран, датчики, вспомогательное */
void oled_init(int sh1106);
void oled_clear(void);
void oled_flush(void);
void oled_pixel(int x, int y, int on);
void oled_fill(int x, int y, int w, int h, int on);
void oled_frame(int x, int y, int w, int h);
int oled_text(int x, int y, const char *s, int scale, int invert);
int oled_text_width(const char *s, int scale);
extern int oled_ok;

int sdp_start(int bus);
/* Перепад, Па; 0 — успешно. */
int sdp_read(int bus, float *pa);

float v_logf(float x);
float v_sinf(float x);
float v_sqrtf(float x);
/* Число с запятой: fmt_num(buf, 12.34, 1) → "12,3". */
char *fmt_num(char *out, float v, int decimals);
char *fmt_int(char *out, long v);
char *str_cat(char *dst, const char *src);
int str_len(const char *s);
int str_eq(const char *a, const char *b);
int str_starts(const char *s, const char *prefix);
long str_to_int(const char *s);

#ifdef __cplusplus
}
#endif
#endif
