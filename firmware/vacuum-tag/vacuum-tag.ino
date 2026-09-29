/*
 * Метка на аккумуляторный инструмент для пылесоса «S3»: ESP32-C3 (плата ESP32-C3 SuperMini),
 * акселерометр LIS3DH (I²C 0x18), кнопка, аккумулятор 300 мА·ч с зарядкой TP4056 (USB-C).
 * Крепится на инструмент хомутом или магнитом.
 *
 * Мотор инструмента даёт ровную частую вибрацию: метка считает её уровень (СКЗ ускорения без
 * постоянной составляющей) окнами по 50 мс. Выше порога в 5 окнах из 6 подряд (0,3 с) — «инструмент
 * заработал», ниже 0,6 порога 1 с — «встал»; одиночный толчок (уронили, стукнули, переложили)
 * даёт одно-два окна и ничего не включает. Пока инструмент работает — посылка «работает» раз
 * в 2 с (контроллер без неё через 6 с считает инструмент остановленным).
 * Посылки — короткой рекламой Bluetooth, как у пульта (firmware/vacuum-remote): «VT» 1 номер[4]
 * счётчик[4] событие заряд подпись[4], подпись SipHash-2-4 своим ключом; привязка — «VP» 2
 * номер[4] ключ[16] 2 слабым сигналом, рядом с пылесосом.
 * В покое метка спит (единицы микроампер): акселерометр на 10 Гц будит её прерыванием от движения.
 *
 * Кнопка: удержание 5 с — привязка (на пылесосе открыть «Розетка → Устройства → Привязать»);
 * два коротких нажатия, пока инструмент работает, — запомнить его вибрацию (порог — 40 % от
 * неё); одно короткое — мигнуть зарядом (1–4 вспышки).
 * Выводы (пробуждение из сна — только GPIO0–GPIO5): прерывание LIS3DH INT1 — GPIO3, кнопка —
 * GPIO2 (на землю), SDA — GPIO6, SCL — GPIO7, батарея — GPIO1 (делитель 100к/100к), светодиод
 * платы — GPIO8 (светит нулём).
 * Arduino IDE: плата «ESP32C3 Dev Module», USB CDC On Boot — Enabled.
 * arduino-cli: --fqbn esp32:esp32:esp32c3:CDCOnBoot=cdc
 */
#include <Arduino.h>
#include <BLEAdvertising.h>
#include <BLEDevice.h>
#include <Preferences.h>
#include <Wire.h>
#include "esp_bt.h"
#include "esp_mac.h"
#include "esp_sleep.h"

#define PIN_INT 3
#define PIN_BTN 2
#define PIN_SDA 6
#define PIN_SCL 7
#define PIN_BAT 1
#define PIN_LED 8
#define LIS 0x18
#define PAIR_MS 5000
#define IDLE_MS 10000

enum { EV_START = 1, EV_STOP = 2, EV_RUN = 3, EV_BATT = 4 };

static Preferences prefs;
static uint8_t key[16];
static uint32_t tag_id;
RTC_DATA_ATTR static uint32_t counter; /* переживает сон; копия — во флеше */
static BLEAdvertising *adv;
static float thr_mg = 60; /* порог вибрации, мг СКЗ */

/* ---------------- SipHash-2-4 (как в контроллере, vac_drv.c) ---------------- */

#define ROTL(x, b) (uint64_t)(((x) << (b)) | ((x) >> (64 - (b))))
#define SIPROUND                                                     \
  do {                                                               \
    v0 += v1, v1 = ROTL(v1, 13), v1 ^= v0, v0 = ROTL(v0, 32);          \
    v2 += v3, v3 = ROTL(v3, 16), v3 ^= v2;                           \
    v0 += v3, v3 = ROTL(v3, 21), v3 ^= v0;                           \
    v2 += v1, v1 = ROTL(v1, 17), v1 ^= v2, v2 = ROTL(v2, 32);          \
  } while (0)

static uint64_t le64(const uint8_t *p) {
  uint64_t v = 0;
  for (int i = 7; i >= 0; i--) v = (v << 8) | p[i];
  return v;
}

static uint64_t siphash24(const uint8_t k[16], const uint8_t *data, int len) {
  uint64_t k0 = le64(k), k1 = le64(k + 8);
  uint64_t v0 = 0x736f6d6570736575ULL ^ k0, v1 = 0x646f72616e646f6dULL ^ k1;
  uint64_t v2 = 0x6c7967656e657261ULL ^ k0, v3 = 0x7465646279746573ULL ^ k1;
  int full = len & ~7;
  for (int i = 0; i < full; i += 8) {
    uint64_t m = le64(data + i);
    v3 ^= m;
    SIPROUND;
    SIPROUND;
    v0 ^= m;
  }
  uint64_t b = (uint64_t)len << 56;
  for (int i = 0; i < (len & 7); i++) b |= (uint64_t)data[full + i] << (8 * i);
  v3 ^= b;
  SIPROUND;
  SIPROUND;
  v0 ^= b;
  v2 ^= 0xff;
  SIPROUND;
  SIPROUND;
  SIPROUND;
  SIPROUND;
  return v0 ^ v1 ^ v2 ^ v3;
}

static void put32(uint8_t *p, uint32_t v) {
  for (int i = 0; i < 4; i++) p[i] = (uint8_t)(v >> (8 * i));
}

/* ---------------- эфир ---------------- */

static void broadcast(const uint8_t *pkt, int len, int ms) {
  String md;
  md += (char)0xFF;
  md += (char)0xFF;
  for (int i = 0; i < len; i++) md += (char)pkt[i];
  BLEAdvertisementData d;
  d.setFlags(0x06);
  d.setManufacturerData(md);
  adv->setAdvertisementData(d);
  adv->setMinInterval(32); /* 20 мс */
  adv->setMaxInterval(40);
  adv->start();
  delay(ms);
  adv->stop();
}

/* Заряд, %: 3,3 В — 0, 4,15 В — 100 (делитель пополам). */
static int battery(void) {
  int mv = analogReadMilliVolts(PIN_BAT) * 2;
  int p = (mv - 3300) * 100 / 850;
  return p < 1 ? 1 : p > 100 ? 100 : p;
}

static void send_event(int ev) {
  uint8_t p[17] = {'V', 'T', 1};
  counter++;
  put32(p + 3, tag_id);
  put32(p + 7, counter);
  p[11] = (uint8_t)ev;
  p[12] = (uint8_t)battery();
  put32(p + 13, (uint32_t)siphash24(key, p + 3, 10));
  digitalWrite(PIN_LED, LOW);
  broadcast(p, sizeof p, 120);
  digitalWrite(PIN_LED, HIGH);
  if ((counter & 15) == 0) prefs.putUInt("ctr", counter);
}

static void send_pairing(void) {
  uint8_t p[24] = {'V', 'P', 2};
  put32(p + 3, tag_id);
  memcpy(p + 7, key, 16);
  p[23] = 2; /* вид устройства: метка */
  /* Ключ — только слабым сигналом: услышит пылесос рядом, а не соседний. */
  esp_ble_tx_power_set(ESP_BLE_PWR_TYPE_ADV, ESP_PWR_LVL_N12);
  for (int i = 0; i < 10; i++) {
    digitalWrite(PIN_LED, i & 1);
    broadcast(p, sizeof p, 300);
  }
  esp_ble_tx_power_set(ESP_BLE_PWR_TYPE_ADV, ESP_PWR_LVL_P9);
  digitalWrite(PIN_LED, HIGH);
}

/* ---------------- LIS3DH ---------------- */

static void lis_w(uint8_t reg, uint8_t v) {
  Wire.beginTransmission(LIS);
  Wire.write(reg);
  Wire.write(v);
  Wire.endTransmission();
}

static bool lis_xyz(float *x, float *y, float *z) {
  Wire.beginTransmission(LIS);
  Wire.write(0x28 | 0x80); /* OUT_X_L, дальше подряд */
  if (Wire.endTransmission(false)) return false;
  if (Wire.requestFrom(LIS, 6) != 6) return false;
  int16_t v[3];
  for (int i = 0; i < 3; i++) {
    uint8_t lo = Wire.read(), hi = Wire.read();
    v[i] = (int16_t)(lo | hi << 8) >> 4; /* 12 бит, ±4 g — 2 мг на единицу */
  }
  *x = v[0] * 2.0f, *y = v[1] * 2.0f, *z = v[2] * 2.0f;
  return true;
}

/* Работа: 400 Гц, ±4 g, высокое разрешение. */
static void lis_run(void) {
  lis_w(0x20, 0x77); /* CTRL_REG1: 400 Гц, X Y Z */
  lis_w(0x23, 0x18); /* CTRL_REG4: ±4 g, высокое разрешение */
  lis_w(0x22, 0x00); /* CTRL_REG3: прерываний нет */
}

/* Сон: 10 Гц малого потребления, прерывание INT1 от движения (фильтр — без силы тяжести). */
static void lis_sleep(void) {
  lis_w(0x20, 0x2F); /* 10 Гц, малое потребление */
  lis_w(0x21, 0x01); /* CTRL_REG2: фильтр высоких частот на прерывание 1 */
  lis_w(0x22, 0x40); /* CTRL_REG3: IA1 → INT1 */
  lis_w(0x24, 0x08); /* CTRL_REG5: прерывание защёлкнуто */
  lis_w(0x32, 0x06); /* INT1_THS: ~100 мг при ±4 g */
  lis_w(0x33, 0x01); /* INT1_DURATION */
  lis_w(0x30, 0x2A); /* INT1_CFG: X, Y или Z выше порога */
}

/* ---------------- вибрация ---------------- */

static float mean[3];
static float acc2;
static int acc_n;
static uint8_t hist;      /* последние окна: 1 — выше порога */
static int low_windows;
static bool running;
static uint32_t last_beat, last_act;
static bool calibrating;
static float cal_sum;
static int cal_n;

/* Окно 50 мс: СКЗ без постоянной составляющей (сила тяжести, наклон). */
static void window(float rms) {
  if (calibrating) {
    cal_sum += rms, cal_n++;
    if (cal_n >= 100) {
      calibrating = false;
      thr_mg = cal_sum / cal_n * 0.4f;
      if (thr_mg < 15) thr_mg = 15;
      prefs.putFloat("thr", thr_mg);
      for (int i = 0; i < 3; i++) digitalWrite(PIN_LED, LOW), delay(80), digitalWrite(PIN_LED, HIGH), delay(80);
    }
  }
  hist = (uint8_t)((hist << 1) | (rms > thr_mg));
  int on = __builtin_popcount(hist & 0x3F);
  if (!running && on >= 5) {
    running = true;
    low_windows = 0;
    send_event(EV_START);
    last_beat = millis();
  } else if (running) {
    low_windows = rms < thr_mg * 0.6f ? low_windows + 1 : 0;
    if (low_windows >= 20) {
      running = false;
      send_event(EV_STOP);
      send_event(EV_STOP);
    }
  }
  if (running || rms > thr_mg * 0.5f) last_act = millis();
}

static void go_sleep(void) {
  adv->stop();
  prefs.putUInt("ctr", counter);
  lis_sleep();
  uint8_t src;
  Wire.beginTransmission(LIS);
  Wire.write(0x31); /* INT1_SRC — сброс защёлки */
  Wire.endTransmission(false);
  Wire.requestFrom(LIS, 1);
  src = Wire.read();
  (void)src;
  esp_deep_sleep_enable_gpio_wakeup(1ULL << PIN_INT, ESP_GPIO_WAKEUP_GPIO_HIGH);
  esp_deep_sleep_enable_gpio_wakeup(1ULL << PIN_BTN, ESP_GPIO_WAKEUP_GPIO_LOW);
  esp_deep_sleep_start();
}

void setup() {
  pinMode(PIN_LED, OUTPUT);
  digitalWrite(PIN_LED, HIGH);
  pinMode(PIN_BTN, INPUT_PULLUP);
  pinMode(PIN_INT, INPUT);
  analogReadResolution(12);
  prefs.begin("tag", false);
  if (prefs.getBytes("key", key, 16) != 16) {
    /* Первое включение: свой ключ из аппаратного генератора случайных чисел. */
    esp_fill_random(key, 16);
    prefs.putBytes("key", key, 16);
  }
  uint32_t saved = prefs.getUInt("ctr", 0);
  if (counter < saved) counter = saved + 16; /* после сброса — с запасом: вдруг последние не записаны */
  thr_mg = prefs.getFloat("thr", 60);
  uint8_t mac[6];
  esp_read_mac(mac, ESP_MAC_BT);
  tag_id = (uint32_t)mac[2] << 24 | (uint32_t)mac[3] << 16 | (uint32_t)mac[4] << 8 | mac[5];

  Wire.begin(PIN_SDA, PIN_SCL, 400000);
  lis_run();
  BLEDevice::init("");
  esp_ble_tx_power_set(ESP_BLE_PWR_TYPE_ADV, ESP_PWR_LVL_P9);
  adv = BLEDevice::getAdvertising();
#if defined(CONFIG_NIMBLE_ENABLED)
  adv->setAdvertisementType(BLE_GAP_CONN_MODE_NON);
#else
  adv->setAdvertisementType(ADV_TYPE_NONCONN_IND);
#endif
  last_act = millis();
}

void loop() {
  static uint32_t t_sample, btn_t, click_t;
  static bool btn_down, btn_long;
  static int clicks;
  uint32_t now = millis();
  /* 400 Гц: отсчёт, своя постоянная составляющая по каждой оси (≈0,3 с). */
  if (micros() - t_sample >= 2500) {
    t_sample = micros();
    float v[3];
    if (lis_xyz(&v[0], &v[1], &v[2])) {
      float s = 0;
      for (int i = 0; i < 3; i++) {
        mean[i] += (v[i] - mean[i]) * 0.01f;
        float d = v[i] - mean[i];
        s += d * d;
      }
      acc2 += s, acc_n++;
      if (acc_n >= 20) {
        window(sqrtf(acc2 / acc_n));
        acc2 = 0, acc_n = 0;
      }
    }
  }
  if (running && now - last_beat >= 2000) {
    last_beat = now;
    send_event(EV_RUN);
  }
  /* Кнопка. */
  bool down = digitalRead(PIN_BTN) == LOW;
  if (down && !btn_down) btn_down = true, btn_long = false, btn_t = now;
  else if (down && btn_down && !btn_long && now - btn_t >= PAIR_MS) {
    btn_long = true;
    send_pairing();
  } else if (!down && btn_down) {
    btn_down = false;
    if (!btn_long && now - btn_t > 30) {
      clicks = now - click_t < 1000 ? clicks + 1 : 1;
      click_t = now;
      if (clicks == 2 && running) {
        calibrating = true, cal_sum = 0, cal_n = 0; /* 5 с вибрации — новый порог */
        clicks = 0;
      }
    }
  }
  if (clicks == 1 && now - click_t > 1000) {
    clicks = 0;
    int n = (battery() + 24) / 25;
    for (int i = 0; i < n; i++) digitalWrite(PIN_LED, LOW), delay(150), digitalWrite(PIN_LED, HIGH), delay(250);
  }
  if (btn_down) last_act = now;
  if (!running && !btn_down && !calibrating && now - last_act > IDLE_MS) go_sleep();
}
