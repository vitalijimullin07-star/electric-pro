/*
 * Контроллер строительного пылесоса «S3» на ESP32-S3: две турбины Domel 1600 Вт
 * (реле 16 А + симистор BTA24 с фазовым управлением через MOC3023) с регулятором
 * расхода воздуха, один фильтр 180×320 и два клапана продувки 230 В (MOC3063 + BTA08):
 * отбивка «как у Hilti» (удар каждые N секунд, клапаны по очереди), серии по сопротивлению
 * фильтра R и очистка при выключении. Датчики: токи турбин и клапанов, температуры
 * двигателей, разрежение, перепад на фильтре и расход, электроды уровня и перелива в баке,
 * поплавок. Кнопки у экрана, «Турбина 1», «Турбина 2», «Выкл» и кнопка энкодера — через
 * расширитель PCA9555; энкодер — на выводах модуля; беспроводной пульт — Bluetooth.
 * Экран 7″ 800×480 — отдельная плата ESP32-S3 по UART (firmware/vacuum-s3-panel).
 */
#ifndef VAC_CORE_H
#define VAC_CORE_H
#include <stdint.h>
#include "vac_hal.h"

#ifdef __cplusplus
extern "C" {
#endif

#define VAC_VERSION "3.0"

/* ---- выводы ESP32-S3-WROOM-1 (как на плате src/core/examples/vacuum-s3) ---- */
/*
 * Верх модуля — к оптронам и реле, низ — к разъёму датчиков и USB, правый бок — к середине
 * платы. IO45 и IO46 (выводы режима загрузки) нагружены без подтяжки вверх: зуммер и
 * раскачка электродов. АЦП — только АЦП1 (IO1–IO10): АЦП2 занят радио.
 */
#define PIN_Y1 41       /* клапан 1: MOC3063 (U3) → BTA08 */
#define PIN_Y2 40       /* клапан 2: MOC3063 (U4) */
#define PIN_T1 39       /* турбина 1: MOC3023 (U1) → BTA24 */
#define PIN_T2 38       /* турбина 2: MOC3023 (U2) */
#define PIN_RL1 37      /* реле K1 турбины 1 (ключ AO3400) */
#define PIN_RL2 36      /* реле K2 турбины 2 */
#define PIN_LED 1       /* светодиод состояния */
#define PIN_BOOT 0
#define PIN_CT1 4       /* ток турбины 1: ТТ 1000:1, нагрузка 68 Ом на середину 1,65 В */
#define PIN_CT2 5       /* ток турбины 2 */
#define PIN_CT3 6       /* ток клапанов (общий провод, нагрузка 200 Ом) */
#define PIN_NTC1 7      /* термистор турбины 1 (10к B3950, верхнее плечо 10к) */
#define PIN_NTC2 8
#define PIN_WL1 3       /* электрод уровня E1 (делитель 100к/100к) */
#define PIN_WL_DRV 46   /* раскачка электродов: меандр 1 кГц → 1 кОм → 1 мкФ → E0 */
#define PIN_WL2 9       /* электрод перелива E2 */
#define PIN_VAC 10      /* разрежение MPX5050DP через делитель 6,8к/10к */
#define PIN_SDA 11      /* I²C: SDP810 (0x25), SDP811 (0x26), PCA9555 (0x20) */
#define PIN_SCL 12
#define PIN_PNL_TX 13   /* UART1 → пульт */
#define PIN_PNL_RX 14   /* UART1 ← пульт */
#define PANEL_BAUD 115200
#define PIN_ENC_A 21
#define PIN_ENC_B 47
#define PIN_ZC 48       /* детектор нуля сети (1 — около нуля) */
#define PIN_BUZZER 45   /* ключ зуммера (база через 1 кОм) */

#define SDP_FILTER 0x25 /* SDP810-500Pa: перепад на фильтре */
#define SDP_FLOW 0x26   /* SDP811-125Pa: расходомер (сопло Вентури) */
#define EXP_ADDR 0x20   /* PCA9555: A0–A2 на земле */

/* Входы расширителя (биты порта 0 и 1, активный уровень — 0). */
enum {
  K_1 = 0, K_2, K_3, K_4, K_5, K_6, /* кнопки у экрана: 1–3 слева сверху вниз, 4–6 справа */
  K_T1 = 6, K_T2 = 7,               /* «Турбина 1», «Турбина 2» */
  K_OFF = 8, K_ENC = 9,             /* «Выкл», кнопка энкодера */
  K_FLOAT = 15,                     /* поплавок бака (замкнут на землю — бак полон) */
};

/* ---- настройки (хранятся в памяти ESP32) ---- */
#define N_PRESETS 4
#define N_RHIST 30
typedef struct {
  uint16_t magic;
  uint8_t version;
  uint8_t mode;          /* VAC_MANUAL, VAC_AUTO */
  uint8_t sp;            /* уставка расхода, л/с (авто) */
  uint8_t power;         /* мощность в ручном, % (30…100) */
  uint8_t t2;            /* вторая турбина может помогать регулятору (авто) */
  uint8_t softstart;     /* плавный пуск, ×0,1 с */
  uint8_t clean_auto;    /* автоочистка: по порогу R и по периоду пресета */
  uint8_t clean_off;     /* очистка при выключении */
  uint8_t pulses;        /* ударов в серии */
  uint8_t preset;        /* последний пресет (0xFF — свой) */
  uint16_t imp_ms;       /* импульс клапана, мс */
  uint16_t pause_ms;     /* пауза между ударами, мс */
  uint16_t thr;          /* порог R, % от R нового фильтра */
  uint16_t boost_ms;     /* разгон турбин перед серией, мс */
  uint16_t period;       /* период серий, с (0 — только по порогу) */
  uint16_t tap_s;        /* отбивка: один удар каждые N с работы (0 — выкл.) */
  uint8_t psp[N_PRESETS];
  uint16_t pper[N_PRESETS];
  uint16_t ptap[N_PRESETS];
  uint8_t min_speed;     /* скорость воздуха в шланге для тревоги, м/с (0 — выкл.) */
  uint8_t hose_mm;       /* внутренний диаметр шланга, мм */
  int16_t zc_shift_us;   /* поправка момента нуля, мкс */
  uint16_t mains_cal;    /* калибровка напряжения сети, ‰ */
  uint16_t flow_k10;     /* коэффициент расходомера ×10: Q[м³/ч] = k·√Δp */
  uint16_t brush_h;      /* ресурс щёток, приведённые часы */
  uint16_t wl_mv;        /* порог электродов, мВ размаха */
  uint16_t stagger_ms;   /* пуск второй турбины после первой, мс */
  float r_new;           /* R нового фильтра (0 — ещё не обучен) */
  uint32_t pulse_count;  /* ударов клапанов всего */
  uint32_t hours[2];     /* наработка турбин, с */
  uint32_t whours[2];    /* приведённая наработка (с учётом мощности и нагрева), с */
  uint16_t rhist[N_RHIST]; /* R после продувки по сменам, ×10, старые — первыми */
  uint8_t nrh;
  uint8_t remote_on;     /* беспроводной пульт привязан */
  uint32_t remote_id;
  uint8_t remote_key[16];
  uint32_t remote_ctr;   /* последний принятый счётчик (защита от повтора) */
  uint8_t crc;
} vac_settings_t;

extern vac_settings_t vac_cfg;

/* ---- состояние для пульта, порта и веб-страницы ---- */
enum { VAC_STANDBY = 0, VAC_ACTIVE = 1 };
enum { VAC_MANUAL = 0, VAC_AUTO = 1 };
enum { PURGE_NONE = 0, PURGE_SERIES = 1, PURGE_FULL = 2, PURGE_TAP = 3, PURGE_OFF = 4 };
/* Турбина: реле и симистор; TS_HOLD — реле 1 замкнуто при закрытом симисторе (питание клапанов на продувку). */
enum { TS_OFF = 0, TS_CLOSE, TS_CHECK, TS_RUN, TS_STOP, TS_OPEN, TS_HOLD };
/* Вода в баке. */
enum { WL_DRY = 0, WL_LEVEL = 1, WL_OVERFLOW = 2 };

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
  F_NOCUR1 = 1 << 9,      /* нет тока турбины 1: щётки, обрыв, реле, симистор */
  F_NOCUR2 = 1 << 10,
  F_LEAK1 = 1 << 11,      /* ток при закрытом симисторе: пробит — реле разомкнуто */
  F_LEAK2 = 1 << 12,
  F_LOWAIR = 1 << 13,     /* мало воздуха в шланге */
  F_BLOCKED = 1 << 14,    /* шланг или вход забит */
  F_FILTER = 1 << 15,     /* фильтр пора мыть: после продувки R выше порога мойки */
  F_MAINS = 1 << 16,      /* напряжение сети вне 190…250 В */
  F_SDP_F = 1 << 17,      /* нет связи с датчиком перепада */
  F_SDP_Q = 1 << 18,      /* нет связи с расходомером */
  F_VAC = 1 << 19,        /* датчик разрежения вне диапазона */
  F_WATER = 1 << 20,      /* бак полон (электрод уровня или поплавок) — турбины стоп */
  F_OVERFLOW = 1 << 21,   /* перелив: вода на верхнем электроде — аварийный стоп */
  F_WELD1 = 1 << 22,      /* ток после размыкания реле 1: реле сварилось и пробит симистор */
  F_WELD2 = 1 << 23,
  F_VALVE1 = 1 << 24,     /* клапан 1: нет тока катушки или не втягивается */
  F_VALVE2 = 1 << 25,
  F_TORN = 1 << 26,       /* фильтр порван или не стоит: R упало, перепада нет */
  F_EXP = 1 << 27,        /* нет связи с расширителем кнопок */
  F_PROBE = 1 << 28,      /* электроды: вода на верхнем без нижнего — грязь или обрыв */
};
#define F_LAST F_PROBE

typedef struct {
  uint8_t state;          /* VAC_STANDBY / VAC_ACTIVE */
  uint8_t mode;           /* VAC_MANUAL / VAC_AUTO */
  uint8_t sleep;          /* «Выкл»: турбины стоят, реле разомкнуты, экран погашен */
  uint8_t en[2];          /* турбины, включённые кнопками «Турбина 1/2» */
  uint8_t ts[2];          /* состояние реле и симистора (TS_…) */
  uint8_t relay[2];       /* реле замкнуто */
  uint8_t running;        /* турбины сейчас работают */
  uint8_t purging;        /* PURGE_… */
  uint8_t pulse_no;       /* номер удара в серии (0 — разгон или нет серии) */
  uint8_t valve[2];
  uint8_t dual;           /* регулятор включил вторую турбину */
  uint8_t panel;          /* пульт на связи */
  uint8_t water;          /* WL_DRY / WL_LEVEL / WL_OVERFLOW */
  uint8_t float_on;       /* поплавок поднят */
  uint8_t shutdown;       /* идёт очистка перед выключением */
  uint8_t remote;         /* 0 — нет, 1 — привязан, 2 — на связи (посылка за 10 с) */
  uint8_t pairing;        /* открыто окно привязки пульта */
  uint16_t keys;          /* входы расширителя (1 — нажато) */
  float pcmd[2];          /* текущая мощность турбин, % (с плавным пуском) */
  float amps[2];          /* ток турбин, А */
  float valve_amps;       /* ток клапанов, А (скользящее СКЗ) */
  float valve_in[2], valve_hold[2]; /* последний удар: ток втягивания и удержания, А */
  float wl_mv[2];         /* размах сигнала электродов E1, E2, мВ */
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
  uint16_t next_series;   /* секунд до серии по периоду */
  uint16_t next_tap;      /* секунд до удара отбивки */
  int8_t remote_rssi;
  uint32_t uptime_s;
  uint32_t purges;        /* серий за включение */
} vac_state_t;

extern vac_state_t vac;

/* ---- вход в ядро ---- */
void vac_setup(void);
/* Вызывать как можно чаще (не реже раза в миллисекунду). */
void vac_loop(void);
/* Прерывание таймера каждые 100 мкс: импульсы на симисторы, раскачка электродов, энкодер. */
void vac_tick(void);
/* Прерывание по фронту вывода (детектор нуля). */
void vac_on_pin(int pin, int level, uint32_t us);
/* Байт из монитора порта (USB). */
void vac_serial(int ch);
/* Байт от пульта (UART1). */
void vac_uart(int ch);
/* Посылка беспроводного пульта: данные производителя из рекламы Bluetooth (без кода компании). */
void vac_remote(const uint8_t *data, int len, int rssi);
/* Команда строкой (монитор порта, пульт, веб-страница): help — список. */
void vac_command(const char *cmd);
/* Состояние в JSON для веб-страницы; возвращает длину. */
int vac_status_json(char *buf, int len);

/* ---- общее для частей ядра ---- */
void vac_save_settings(void);
void vac_save_soon(void);
/* Турбина k: включить или выключить (кнопки «Турбина 1/2», пульт); k = −1 — все включённые. */
void vac_turbine(int k, int on);
void vac_start_stop(void);
void vac_set_mode(int mode);
void vac_purge_now(int kind);
/* «Выкл»: очистка (если турбины работали) и сон; now = 1 — сразу. */
void vac_power_off(int now);
void vac_wake(void);
const char *vac_fault_text(uint32_t bit);
void vac_beep(int kind);  /* 0 — щелчок, 1 — подтверждение, 2 — предупреждение, 3 — тревога */
uint32_t vac_now_ms(void);

/* vac_link.c: кнопки, энкодер, связь с пультом и беспроводным пультом */
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
/* Окно привязки беспроводного пульта, с (0 — закрыть). */
void link_pair(int seconds);

/* vac_drv.c: датчики, расширитель, подпись посылок, вспомогательное */
int sdp_start(int addr);
/* Перепад, Па; 0 — успешно. */
int sdp_read(int addr, float *pa);
/* Входы PCA9555 (16 бит, как есть); 0 — успешно. */
int exp_read(uint16_t *in);
/* SipHash-2-4: подпись посылок беспроводного пульта. */
uint64_t siphash24(const uint8_t key[16], const uint8_t *data, int len);

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
