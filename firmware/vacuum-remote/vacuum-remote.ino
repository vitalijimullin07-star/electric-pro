/*
 * Беспроводной пульт пылесоса «S3»: ESP32-C3 (например, плата ESP32-C3 SuperMini), две кнопки
 * и энкодер с кнопкой, питание — аккумулятор 3,7 В через стабилизатор платы.
 *
 * Пульт не держит соединение: он спит (десятки микроампер) и просыпается от кнопки или поворота
 * энкодера, передаёт событие короткой рекламой Bluetooth (данные производителя «VR», повтор
 * 150 мс для надёжности) и через 3 с тишины снова засыпает. Контроллер (firmware/vacuum-s3)
 * слушает эфир, проверяет подпись SipHash-2-4 ключом пульта и счётчик (повтор или чужая посылка
 * не пройдут).
 *
 * Кнопка 1: коротко — пуск/стоп турбин, удержание 1 с — очистка фильтра.
 * Кнопка 2: коротко — вторая турбина вкл/выкл, удержание — режим авто/ручной.
 * Энкодер: мощность (ручной) или уставка расхода (авто); нажатие — очистка фильтра.
 * Привязка: на контроллере — «Выкл» + «Турбина 1» 3 с (или «Настройки → Пульт» на экране), затем
 * на пульте зажать обе кнопки на 5 с, пульт — рядом с контроллером (ключ идёт слабым сигналом).
 *
 * Выводы (пробуждение из сна — только GPIO0–GPIO5): кнопка 1 — GPIO0, кнопка 2 — GPIO1,
 * кнопка энкодера — GPIO3, энкодер A/B — GPIO4/GPIO5 (все — на землю, подтяжки внутри),
 * светодиод платы — GPIO8 (светит нулём).
 * Arduino IDE: плата «ESP32C3 Dev Module», USB CDC On Boot — Enabled.
 * arduino-cli: --fqbn esp32:esp32:esp32c3:CDCOnBoot=cdc
 */
#include <Arduino.h>
#include <BLEAdvertising.h>
#include <BLEDevice.h>
#include <Preferences.h>
#include "esp_bt.h"
#include "esp_mac.h"
#include "esp_sleep.h"
#include "remote_btn.h"

#define PIN_B1 0
#define PIN_B2 1
#define PIN_ESW 3
#define PIN_EA 4
#define PIN_EB 5
#define PIN_LED 8
#define IDLE_MS 3000
#define HOLD_MS 1000
#define PAIR_MS 5000

enum { EV_B1 = 1, EV_B1_HOLD, EV_B2, EV_B2_HOLD, EV_ENC, EV_ENC_SW };

static Preferences prefs;
static uint8_t key[16];
static uint32_t remote_id;
RTC_DATA_ATTR static uint32_t counter; /* переживает сон; копия — во флеше */
static BLEAdvertising *adv;

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

/* Данные производителя: код компании 0xFFFF и посылка. */
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

static void send_event(int ev, int arg) {
  uint8_t p[17] = {'V', 'R', 1};
  counter++;
  put32(p + 3, remote_id);
  put32(p + 7, counter);
  p[11] = (uint8_t)ev;
  p[12] = (uint8_t)(int8_t)arg;
  put32(p + 13, (uint32_t)siphash24(key, p + 3, 10));
  digitalWrite(PIN_LED, LOW);
  broadcast(p, sizeof p, 150);
  digitalWrite(PIN_LED, HIGH);
  prefs.putUInt("ctr", counter);
}

static void send_pairing(void) {
  uint8_t p[23] = {'V', 'P', 1};
  put32(p + 3, remote_id);
  memcpy(p + 7, key, 16);
  /* Ключ — только слабым сигналом: услышит контроллер рядом, а не соседний двор. */
  esp_ble_tx_power_set(ESP_BLE_PWR_TYPE_ADV, ESP_PWR_LVL_N12);
  for (int i = 0; i < 10; i++) {
    digitalWrite(PIN_LED, i & 1);
    broadcast(p, sizeof p, 300);
  }
  esp_ble_tx_power_set(ESP_BLE_PWR_TYPE_ADV, ESP_PWR_LVL_P9);
  digitalWrite(PIN_LED, HIGH);
}

/* ---------------- кнопки и энкодер ---------------- */

static Btn b1 = {PIN_B1}, b2 = {PIN_B2}, bsw = {PIN_ESW};
static uint8_t enc_prev;
static int8_t enc_acc;
static int enc_steps;
static uint32_t last_act;

static void poll_encoder(void) {
  uint8_t s = (uint8_t)((digitalRead(PIN_EA) << 1) | digitalRead(PIN_EB));
  uint8_t idx = (uint8_t)((enc_prev << 2) | s);
  int d = 0;
  if (idx == 13 || idx == 4 || idx == 2 || idx == 11) d = 1;
  else if (idx == 14 || idx == 8 || idx == 1 || idx == 7) d = -1;
  enc_prev = s;
  enc_acc += d;
  if (enc_acc >= 4) enc_steps++, enc_acc -= 4;
  else if (enc_acc <= -4) enc_steps--, enc_acc += 4;
}

/* Возвращает: 0 — ничего, 1 — короткое нажатие (при отпускании), 2 — удержание. */
static int poll_btn(Btn &b, uint32_t now) {
  bool pressed = digitalRead(b.pin) == LOW;
  if (pressed && !b.down) {
    b.down = true;
    b.hold = false;
    b.t = now;
  } else if (pressed && b.down && !b.hold && now - b.t >= HOLD_MS) {
    b.hold = true;
    return 2;
  } else if (!pressed && b.down) {
    b.down = false;
    if (!b.hold && now - b.t > 30) return 1;
  }
  return 0;
}

static void go_sleep(void) {
  adv->stop();
  const uint64_t mask = (1ULL << PIN_B1) | (1ULL << PIN_B2) | (1ULL << PIN_ESW) | (1ULL << PIN_EA) | (1ULL << PIN_EB);
  esp_deep_sleep_enable_gpio_wakeup(mask, ESP_GPIO_WAKEUP_GPIO_LOW);
  esp_deep_sleep_start();
}

void setup() {
  pinMode(PIN_LED, OUTPUT);
  digitalWrite(PIN_LED, HIGH);
  const int in[] = {PIN_B1, PIN_B2, PIN_ESW, PIN_EA, PIN_EB};
  for (int p : in) pinMode(p, INPUT_PULLUP);
  enc_prev = (uint8_t)((digitalRead(PIN_EA) << 1) | digitalRead(PIN_EB));

  prefs.begin("remote", false);
  if (prefs.getBytes("key", key, 16) != 16) {
    /* Первое включение: свой ключ из аппаратного генератора случайных чисел. */
    esp_fill_random(key, 16);
    prefs.putBytes("key", key, 16);
  }
  uint32_t saved = prefs.getUInt("ctr", 0);
  if (counter < saved) counter = saved;
  uint8_t mac[6];
  esp_read_mac(mac, ESP_MAC_BT);
  remote_id = (uint32_t)mac[2] << 24 | (uint32_t)mac[3] << 16 | (uint32_t)mac[4] << 8 | mac[5];

  BLEDevice::init("");
  esp_ble_tx_power_set(ESP_BLE_PWR_TYPE_ADV, ESP_PWR_LVL_P9);
  adv = BLEDevice::getAdvertising();
  /* Реклама без соединения (у ESP32-C3 библиотека BLE работает на NimBLE, у S3 — на Bluedroid). */
#if defined(CONFIG_NIMBLE_ENABLED)
  adv->setAdvertisementType(BLE_GAP_CONN_MODE_NON);
#else
  adv->setAdvertisementType(ADV_TYPE_NONCONN_IND);
#endif
  last_act = millis();

  /* Проснулись от кнопки, а её уже отпустили (короткий щелчок быстрее загрузки) — это нажатие. */
  if (esp_sleep_get_wakeup_cause() == ESP_SLEEP_WAKEUP_GPIO) {
    uint64_t st = esp_sleep_get_gpio_wakeup_status();
    if ((st >> PIN_B1 & 1) && digitalRead(PIN_B1) == HIGH) send_event(EV_B1, 0);
    else if ((st >> PIN_B2 & 1) && digitalRead(PIN_B2) == HIGH) send_event(EV_B2, 0);
    else if ((st >> PIN_ESW & 1) && digitalRead(PIN_ESW) == HIGH) send_event(EV_ENC_SW, 0);
  }
}

void loop() {
  uint32_t now = millis();
  poll_encoder();
  int e1 = poll_btn(b1, now), e2 = poll_btn(b2, now), es = poll_btn(bsw, now);
  if (b1.down || b2.down || bsw.down || enc_steps) last_act = now;
  /* Обе кнопки 5 с — привязка. */
  if (b1.down && b2.down && now - b1.t > PAIR_MS && now - b2.t > PAIR_MS) {
    send_pairing();
    b1.hold = b2.hold = true;
    while (digitalRead(PIN_B1) == LOW || digitalRead(PIN_B2) == LOW) delay(10);
    b1.down = b2.down = false;
    last_act = millis();
    return;
  }
  if (b1.down && b2.down) return; /* ждём привязку, одиночные события не шлём */
  if (e1) send_event(e1 == 2 ? EV_B1_HOLD : EV_B1, 0);
  if (e2) send_event(e2 == 2 ? EV_B2_HOLD : EV_B2, 0);
  if (es == 1) send_event(EV_ENC_SW, 0);
  if (enc_steps) {
    /* Повороты копим 60 мс — одна посылка на несколько щелчков. */
    static uint32_t first;
    if (!first) first = now;
    if (now - first >= 60) {
      int n = enc_steps > 20 ? 20 : enc_steps < -20 ? -20 : enc_steps;
      enc_steps = 0;
      first = 0;
      send_event(EV_ENC, n);
    }
  }
  if (now - last_act > IDLE_MS) go_sleep();
  delay(1);
}
