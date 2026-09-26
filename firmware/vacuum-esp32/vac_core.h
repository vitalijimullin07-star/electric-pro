/*
 * Контроллер строительного пылесоса на ESP32: две турбины (фазовое управление через
 * MOC3023 и BTA41) с регулятором расхода воздуха, розетка инструмента с автопуском и
 * уборкой остатка, два клапана импульсной продувки фильтра (серии ударов, обучение
 * сопротивления фильтра R), датчики тока, температуры двигателей, разрежения, перепада
 * на фильтре и расхода. Пульт — плата ESP32-S3 с сенсорным экраном 800×480 по UART
 * (firmware/vacuum-panel); энкодер и кнопка «Пуск турбин» подключены к контроллеру.
 */
#ifndef VAC_CORE_H
#define VAC_CORE_H
#include <stdint.h>
#include "vac_hal.h"

#ifdef __cplusplus
extern "C" {
#endif

#define VAC_VERSION "2.0"

/* ---- выводы ESP32-WROOM-32E ---- */
/*
 * Выводы — по сторонам модуля: верхний ряд (к оптронам и датчикам) — ключи симисторов и
 * входы АЦП1, левый торец — клапан 1, приём от пульта, зуммер, нижний ряд (к разъёмам) —
 * шины I²C, энкодер, кнопка, передача на пульт, детектор нуля. Выводы, которые ПЗУ дёргает при загрузке
 * (IO5, IO12, IO14, IO15, IO2), не стоят на ключах розетки и клапанов; IO12 держит низкий
 * уровень светодиод оптрона — модуль грузится с питанием флеш-памяти 3,3 В.
 */
#define PIN_T1 12       /* турбина 1: светодиод MOC3023 (U1) */
#define PIN_T2 27       /* турбина 2: MOC3023 (U2) */
#define PIN_OUTLET 26   /* розетка инструмента: MOC3063 (U3) */
#define PIN_Y1 13       /* клапан продувки 1: MOC3063 (U4) → BT134W */
#define PIN_Y2 25       /* клапан продувки 2: MOC3063 (U5) → BT134W */
#define PIN_ZC 4        /* детектор нуля сети (1 — около нуля) */
#define PIN_CT1 36      /* ток турбины 1 (ТТ1, нагрузка 82 Ом) */
#define PIN_CT2 39      /* ток турбины 2 (ТТ2, нагрузка 82 Ом) */
#define PIN_CT3 34      /* ток инструмента (ТТ3, нагрузка 33 Ом) */
#define PIN_VAC 35      /* разрежение MPX5050DP через делитель 6,8к/10к */
#define PIN_NTC1 32     /* термистор турбины 1 (10к B3950, верхнее плечо 10к) */
#define PIN_NTC2 33     /* термистор турбины 2 */
#define PIN_SDA0 18     /* I²C 0: SDP810-500Pa (перепад на фильтре) */
#define PIN_SCL0 5
#define PIN_SDA1 16     /* I²C 1: SDP810-125Pa (расходомер) */
#define PIN_SCL1 17
#define PIN_ENC_A 19
#define PIN_ENC_B 21
#define PIN_ENC_SW 22
#define PIN_K_START 14  /* «Пуск турбин»: коротко — пуск/стоп, удержание — пресеты на пульте */
#define PIN_PNL_TX 23   /* UART2 → пульт (RX платы с экраном) */
#define PIN_PNL_RX 15   /* UART2 ← пульт (TX платы с экраном) */
#define PANEL_BAUD 115200
#define PIN_BUZZER 2    /* ключ зуммера (база через 1 кОм) */

/* ---- настройки (хранятся в памяти ESP32) ---- */
#define N_PRESETS 4
#define N_RHIST 30
typedef struct {
  uint16_t magic;
  uint8_t version;
  uint8_t mode;          /* VAC_MANUAL, VAC_AUTO, VAC_OFF */
  uint8_t last_mode;     /* режим, в который включает «Пуск» из «Выкл» */
  uint8_t sp;            /* уставка расхода, л/с (авто) */
  uint8_t power;         /* мощность в ручном, % (30…100) */
  uint8_t socket;        /* розетка: турбины работают, пока включён инструмент */
  uint8_t runon;         /* уборка остатка после инструмента, с */
  uint8_t t2;            /* вторая турбина разрешена */
  uint8_t softstart;     /* плавный пуск, ×0,1 с */
  uint8_t clean_auto;    /* автоочистка: по порогу R и по периоду пресета */
  uint8_t pulses;        /* ударов в серии */
  uint8_t preset;        /* последний пресет (0xFF — свой) */
  uint16_t imp_ms;       /* импульс клапана, мс */
  uint16_t pause_ms;     /* пауза между ударами, мс */
  uint16_t thr;          /* порог R, % от R нового фильтра */
  uint16_t boost_ms;     /* разгон турбин перед серией, мс */
  uint16_t period;       /* период серий, с (0 — только по порогу) */
  uint8_t psp[N_PRESETS];
  uint16_t pper[N_PRESETS];
  uint16_t tool_ma;      /* порог тока инструмента, мА */
  uint8_t min_speed;     /* скорость воздуха в шланге для тревоги, м/с (0 — выкл.) */
  uint8_t hose_mm;       /* внутренний диаметр шланга, мм */
  int16_t zc_shift_us;   /* поправка момента нуля, мкс */
  uint16_t mains_cal;    /* калибровка напряжения сети, ‰ */
  uint16_t flow_k10;     /* коэффициент расходомера ×10: Q[м³/ч] = k·√Δp */
  uint16_t brush_h;      /* ресурс щёток, приведённые часы */
  float r_new;           /* R нового фильтра (0 — ещё не обучен) */
  uint32_t pulse_count;  /* ударов клапанов всего */
  uint32_t hours[2];     /* наработка турбин, с */
  uint32_t whours[2];    /* приведённая наработка (с учётом мощности и нагрева), с */
  uint16_t rhist[N_RHIST]; /* R после продувки по сменам, ×10, старые — первыми */
  uint8_t nrh;
  uint8_t crc;
} vac_settings_t;

extern vac_settings_t vac_cfg;

/* ---- состояние для пульта, порта и веб-страницы ---- */
enum { VAC_STANDBY = 0, VAC_ACTIVE = 1 };
enum { VAC_MANUAL = 0, VAC_AUTO = 1, VAC_OFF = 2 };
enum { PURGE_NONE = 0, PURGE_SERIES = 1, PURGE_FULL = 2 };

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
  F_FILTER = 1 << 15,     /* фильтр пора мыть: после продувки R выше порога мойки */
  F_MAINS = 1 << 16,      /* напряжение сети вне 190…250 В */
  F_SDP_F = 1 << 17,      /* нет связи с датчиком перепада */
  F_SDP_Q = 1 << 18,      /* нет связи с расходомером */
  F_VAC = 1 << 19,        /* датчик разрежения вне диапазона */
};

typedef struct {
  uint8_t state;          /* VAC_STANDBY / VAC_ACTIVE (кнопка «Пуск турбин») */
  uint8_t mode;           /* VAC_MANUAL / VAC_AUTO / VAC_OFF */
  uint8_t running;        /* турбины сейчас работают */
  uint8_t purging;        /* PURGE_NONE / PURGE_SERIES / PURGE_FULL */
  uint8_t pulse_no;       /* номер удара в серии (0 — разгон или нет серии) */
  uint8_t tool_on;        /* инструмент включён (по току) */
  uint8_t outlet_on;      /* на розетку подано напряжение */
  uint8_t valve[2];
  uint8_t dual;           /* регулятор включил вторую турбину */
  uint8_t panel;          /* пульт на связи */
  float pcmd[2];          /* текущая мощность турбин, % (с плавным пуском) */
  float amps[2];          /* ток турбин, А */
  float tool_amps;
  float temp[2];          /* температура двигателей, °C */
  float mains_v;          /* напряжение сети, В */
  float mains_hz;
  float vacuum_kpa;       /* разрежение на входе турбин */
  float filter_pa;        /* перепад на фильтре */
  float flow_m3h;         /* расход воздуха */
  float flow_ls;          /* он же, л/с */
  float speed_ms;         /* скорость воздуха в шланге */
  float r_now;            /* сопротивление фильтра R = 100·Δp/Q² (Q в л/с) */
  float r_before, r_after;/* до и после последней серии */
  float load;             /* загрузка фильтра, % до порога R */
  uint32_t faults;
  uint16_t runon_left;    /* секунд уборки остатка */
  uint16_t next_series;   /* секунд до серии по периоду */
  uint32_t uptime_s;
  uint32_t purges;        /* серий за включение */
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
/* Байт из монитора порта (USB). */
void vac_serial(int ch);
/* Байт от пульта (UART2). */
void vac_uart(int ch);
/* Команда строкой (монитор порта, пульт, веб-страница): help — список. */
void vac_command(const char *cmd);
/* Состояние в JSON для веб-страницы; возвращает длину. */
int vac_status_json(char *buf, int len);

/* ---- общее для частей ядра ---- */
void vac_save_settings(void);
void vac_start_stop(void);
void vac_set_mode(int mode);
void vac_purge_now(int kind);
const char *vac_fault_text(uint32_t bit);
void vac_beep(int kind);  /* 0 — щелчок, 1 — подтверждение, 2 — предупреждение, 3 — тревога */

/* vac_link.c: энкодер, кнопка, связь с пультом */
void link_init(void);
void link_poll(uint32_t ms);
void link_encoder_poll(void);
/* Пульт на связи (строка «hi» не дольше 2 с назад). */
int link_panel_ok(void);
void link_send(const char *line);
/* Строки настроек («C») и журнала («J») — сразу. */
void link_send_config(void);
void link_send_journal(void);
void link_on_hello(void);

/* vac_drv.c: датчики, вспомогательное */
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
