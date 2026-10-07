/*
 * Контроллер строительного пылесоса «S3» на ESP32-S3-DevKitC-1 N16R8 (плата на готовых модулях,
 * src/core/examples/vacuum-s3/mod.ts) — обвязка для Arduino-ESP32 3.x. Вся логика — в ядре
 * (vac_core.c, vac_link.c, vac_drv.c), здесь только железо: таймер 100 мкс, прерывание детектора
 * нуля, АЦП, I²C, ШИМ регуляторов МР248, UART1 к отдельной плате экрана (если она есть), зуммер,
 * настройки во флеше (две копии), приём пульта и меток по Bluetooth (реклама, без соединения)
 * и сеть Wi-Fi для телефона — только по команде «wifi on» (экран: «Телефон»), со случайным
 * паролем и QR-кодом на экране: приложение «Пылесос S3» (src/pylesos, app_page.h — собирает
 * npm run build), обновление прошивок контроллера и экрана (файл проверяется: чужой не запишется;
 * новая прошивка, которая не проработала 30 с, при следующем сбросе откатывается на старую),
 * резервная копия настроек. Телефон по Bluetooth (то же приложение с сайта, Chrome на Android):
 * служба BLE_SVC — команды строками, состояние и журнал уведомлениями (строки до «\n» кусками
 * по MTU); команды и чтение — только после сопряжения с кодом с экрана «Телефон».
 * Экран 3,5″ ILI9488 с касанием — прямо на контроллере (lcd_s3.cpp): интерфейс пульта
 * (firmware/vacuum-panel, копия в src/panel — sync-panel.sh) работает отдельной задачей.
 *
 * Arduino IDE: плата «ESP32S3 Dev Module», Flash Size 16 МБ, Partition Scheme «16M Flash
 * (3MB APP/9.9MB FATFS)», PSRAM «OPI PSRAM» (для экрана), USB CDC On Boot — Enabled (монитор
 * порта и прошивка — через разъём USB платы DevKitC, тот, что подписан USB).
 * arduino-cli: --fqbn esp32:esp32:esp32s3:CDCOnBoot=cdc,FlashSize=16M,PartitionScheme=app3M_fat9M_16MB,PSRAM=opi
 * Первая прошивка: держать BOOT, нажать RST, отпустить BOOT (или просто загрузить — DevKitC
 * обычно входит в загрузчик сам).
 */
#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEScan.h>
#include <BLEServer.h>
#include <BLESecurity.h>
#include <BLEUtils.h>
#include <Preferences.h>
#include <Update.h>
#include <WebServer.h>
#include <WiFi.h>
#include "esp_ota_ops.h"
#include "vac_core.h"
#include "app_page.h"

/* Метка прошивки: по ней страница обновления узнаёт файл («чужой» не запишется). */
extern "C" const char VAC_MARK[] __attribute__((used)) = "VACFW:S3-CTRL:" VAC_VERSION;
/* Метку экрана собираем из двух кусков: целиком её в прошивке контроллера быть не должно. */
static char panel_mark[16];

extern Preferences prefs;
extern volatile int wifi_req;
extern char wifi_ssid[24], wifi_pass[12];
extern volatile int uart_mute;
void lcd_start();
void lcd_poll_tx();
static WebServer server(80);
static hw_timer_t *tick_timer;
static bool wifi_on, app_valid;

static void IRAM_ATTR on_tick(void) { vac_tick(); }

/* Новая прошивка подтверждает себя сама после 30 с работы (иначе загрузчик откатит её при сбросе). */
bool verifyRollbackLater() { return true; }

/* ---------------- пульт и метки ---------------- */

/* Посылки приходят в задаче Bluetooth — в ядро их передаёт loop() через очередь. */
struct RemotePkt {
  uint8_t len;
  int8_t rssi;
  uint8_t data[29];
};
static QueueHandle_t remote_q;

class RemoteScan : public BLEAdvertisedDeviceCallbacks {
  void onResult(BLEAdvertisedDevice dev) override {
    if (!dev.haveManufacturerData()) return;
    String md = dev.getManufacturerData();
    /* Код компании 0xFFFF (для разработки), дальше «VR…», «VT…» или «VP…». */
    if (md.length() < 5 || (uint8_t)md[0] != 0xFF || (uint8_t)md[1] != 0xFF || md[2] != 'V') return;
    RemotePkt p;
    p.len = (uint8_t)min((int)md.length() - 2, (int)sizeof p.data);
    p.rssi = (int8_t)dev.getRSSI();
    memcpy(p.data, md.c_str() + 2, p.len);
    xQueueSend(remote_q, &p, 0);
  }
};

static void ble_setup() {
  remote_q = xQueueCreate(8, sizeof(RemotePkt));
  /* Имя — как у сети Wi-Fi: «Pylesos-S3-XXXX». */
  static const char H[] = "0123456789ABCDEF";
  char name[20] = "Pylesos-S3-";
  for (int i = 0; i < 4; i++) name[11 + i] = H[(vac_cfg.dev_id >> (12 - 4 * i)) & 15];
  name[15] = 0;
  BLEDevice::init(name);
  BLEScan *scan = BLEDevice::getScan();
  scan->setAdvertisedDeviceCallbacks(new RemoteScan(), true);
  scan->setActiveScan(false);
  scan->setInterval(160);
  scan->setWindow(80); /* половина эфира — Wi-Fi тоже бывает нужен */
  scan->start(0, nullptr, false);
}

/* ---------------- журнал для телефона ---------------- */

/* Последние строки журнала с номерами: Wi-Fi отдаёт их по /l?n=…, Bluetooth — уведомлениями. */
#define LOG_N 48
#define LOG_LEN 200
static char log_ring[LOG_N][LOG_LEN];
static int32_t log_seq; /* номер следующей строки */
static int32_t ble_log_sent;
static portMUX_TYPE log_mux = portMUX_INITIALIZER_UNLOCKED;

extern "C" void phone_log(const char *line) {
  portENTER_CRITICAL(&log_mux);
  strlcpy(log_ring[log_seq % LOG_N], line, LOG_LEN);
  log_seq++;
  portEXIT_CRITICAL(&log_mux);
}

static void json_str(String &out, const char *s) {
  out += '"';
  for (; *s; s++) {
    if (*s == '"' || *s == '\\') out += '\\';
    if ((uint8_t)*s >= 0x20) out += *s;
  }
  out += '"';
}

/* {"n":следующий,"lines":[…]} — строки начиная с from (если отстали больше, чем помним, — с самой старой). */
static void phone_log_json(int32_t from, String &out) {
  char line[LOG_LEN];
  int32_t end = log_seq;
  out = "{\"n\":";
  out += String(end);
  out += ",\"lines\":[";
  if (from >= 0) {
    if (from < end - LOG_N) from = end - LOG_N;
    for (int32_t i = from; i < end; i++) {
      portENTER_CRITICAL(&log_mux);
      memcpy(line, log_ring[i % LOG_N], LOG_LEN);
      portEXIT_CRITICAL(&log_mux);
      if (i > from) out += ',';
      json_str(out, line);
    }
  }
  out += "]}";
}

/* ---------------- телефон по Bluetooth ---------------- */

#define BLE_SVC "5a3c0001-8d2e-4f1b-9a37-6b0e4c2d7f10"
#define BLE_CMD "5a3c0002-8d2e-4f1b-9a37-6b0e4c2d7f10"
#define BLE_STAT "5a3c0003-8d2e-4f1b-9a37-6b0e4c2d7f10"
#define BLE_LOG "5a3c0004-8d2e-4f1b-9a37-6b0e4c2d7f10"

static BLEServer *ble_srv;
static BLECharacteristic *ch_stat, *ch_log;
static volatile bool phone_on;
/* Команды приходят в задаче Bluetooth — в ядро их передаёт loop(). */
struct PhoneCmd {
  char s[184];
};
static QueueHandle_t phone_q;

class PhoneServer : public BLEServerCallbacks {
  void onConnect(BLEServer *) override {
    phone_on = true;
    ble_log_sent = log_seq;
  }
  void onDisconnect(BLEServer *) override { phone_on = false; }
};

class PhoneCmdCb : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *c) override {
    String v = c->getValue();
    PhoneCmd m;
    int n = 0;
    for (unsigned i = 0; i < v.length() && n < (int)sizeof m.s - 1; i++)
      if (v[i] != '\n' && v[i] != '\r') m.s[n++] = v[i];
    m.s[n] = 0;
    if (n) xQueueSend(phone_q, &m, 0);
  }
};

class PhoneSecurity : public BLESecurityCallbacks {
  void onPassKeyNotify(uint32_t) override { hal_log("Телефон: введите код с экрана «Телефон»"); }
  bool onSecurityRequest() override { return true; }
  bool onConfirmPIN(uint32_t) override { return false; }
  uint32_t onPassKeyRequest() override { return vac.ble_code; }
};

static void phone_setup() {
  phone_q = xQueueCreate(6, sizeof(PhoneCmd));
  /* Код — с экрана: Android спрашивает его при первом сопряжении, дальше телефон помнит пылесос. */
  BLESecurity *sec = new BLESecurity();
  sec->setPassKey(true, vac.ble_code);
  sec->setCapability(ESP_IO_CAP_OUT);
  sec->setAuthenticationMode(true, true, true);
  BLEDevice::setSecurityCallbacks(new PhoneSecurity());
  ble_srv = BLEDevice::createServer();
  ble_srv->setCallbacks(new PhoneServer());
  ble_srv->advertiseOnDisconnect(true);
  BLEService *svc = ble_srv->createService(BLE_SVC);
  BLECharacteristic *cmd = svc->createCharacteristic(BLE_CMD, BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_AUTHEN);
  cmd->setAccessPermissions(ESP_GATT_PERM_WRITE_ENC_MITM);
  cmd->setCallbacks(new PhoneCmdCb());
  /* Состояние читается только после сопряжения: чтение и вызывает окно с кодом. */
  ch_stat = svc->createCharacteristic(BLE_STAT, BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_READ_AUTHEN | BLECharacteristic::PROPERTY_NOTIFY);
  ch_stat->setAccessPermissions(ESP_GATT_PERM_READ_ENC_MITM);
  ch_stat->setValue("ok");
  ch_log = svc->createCharacteristic(BLE_LOG, BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_READ_AUTHEN | BLECharacteristic::PROPERTY_NOTIFY);
  ch_log->setAccessPermissions(ESP_GATT_PERM_READ_ENC_MITM);
  ch_log->setValue("ok");
  svc->start();
  BLEAdvertising *adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(BLE_SVC);
  adv->setScanResponse(true);
  BLEDevice::startAdvertising();
}

/* Строка кусками по MTU, в конце «\n». */
static void ble_send_line(BLECharacteristic *c, const char *s, int n) {
  uint16_t mtu = ble_srv->getPeerMTU(ble_srv->getConnId());
  int part = mtu > 23 ? mtu - 3 : 20;
  if (part > 240) part = 240;
  static uint8_t buf[244];
  for (int i = 0; i < n + 1; i += part) {
    int k = n + 1 - i < part ? n + 1 - i : part;
    for (int j = 0; j < k; j++) buf[j] = i + j < n ? (uint8_t)s[i + j] : '\n';
    c->setValue(buf, k);
    c->notify();
  }
}

static void phone_poll() {
  PhoneCmd m;
  while (xQueueReceive(phone_q, &m, 0) == pdTRUE) vac_command(m.s);
  vac.phone = phone_on;
  if (!phone_on) return;
  static uint32_t last;
  if (millis() - last >= 500) {
    last = millis();
    static char buf[1800];
    int n = vac_status_json(buf, sizeof buf);
    if (n > 0) ble_send_line(ch_stat, buf, n);
  }
  /* Журнал — по строке за проход. */
  if (ble_log_sent < log_seq) {
    if (ble_log_sent < log_seq - LOG_N) ble_log_sent = log_seq - LOG_N;
    char line[LOG_LEN];
    portENTER_CRITICAL(&log_mux);
    memcpy(line, log_ring[ble_log_sent % LOG_N], LOG_LEN);
    portEXIT_CRITICAL(&log_mux);
    ble_log_sent++;
    ble_send_line(ch_log, line, strlen(line));
  }
}

/* ---------------- проверка файла прошивки по метке ---------------- */

struct MarkScan {
  const char *mark;
  int got;       /* совпало знаков подряд */
  bool found;
  void feed(const uint8_t *d, size_t n) {
    int len = strlen(mark);
    for (size_t i = 0; i < n && !found; i++) {
      if (d[i] == (uint8_t)mark[got]) {
        if (++got == len) found = true;
      } else
        got = d[i] == (uint8_t)mark[0] ? 1 : 0;
    }
  }
};

/* ---------------- прошивка экрана: через UART кусками base64 с подтверждением ---------------- */

static const char B64[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

static int b64(const uint8_t *in, int n, char *out) {
  int o = 0;
  for (int i = 0; i < n; i += 3) {
    uint32_t v = (uint32_t)in[i] << 16 | (i + 1 < n ? (uint32_t)in[i + 1] << 8 : 0) | (i + 2 < n ? in[i + 2] : 0);
    out[o++] = B64[(v >> 18) & 63];
    out[o++] = B64[(v >> 12) & 63];
    out[o++] = i + 1 < n ? B64[(v >> 6) & 63] : '=';
    out[o++] = i + 2 < n ? B64[v & 63] : '=';
  }
  out[o] = 0;
  return o;
}

/* Строка от экрана «U …» (ждём до ms). */
static bool panel_reply(const char *want, uint32_t ms) {
  char line[48];
  int n = 0;
  uint32_t t0 = millis();
  while (millis() - t0 < ms) {
    while (Serial1.available()) {
      int c = Serial1.read();
      if (c == '\n') {
        line[n] = 0;
        n = 0;
        if (!strncmp(line, want, strlen(want))) return true;
        if (!strncmp(line, "U err", 5) || !strncmp(line, "U bad", 5)) return false;
      } else if (c != '\r' && n < (int)sizeof line - 1)
        line[n++] = (char)c;
    }
    delay(1);
  }
  return false;
}

static bool panel_send(const uint8_t *d, size_t n) {
  char line[280] = "U d ";
  for (size_t i = 0; i < n; i += 192) {
    int k = n - i > 192 ? 192 : (int)(n - i);
    b64(d + i, k, line + 4);
    Serial1.print(line);
    Serial1.print('\n');
    if (!panel_reply("U a", 3000)) return false;
  }
  return true;
}

/* ---------------- страница для телефона ---------------- */

/* Страница — приложение «Пылесос S3» целиком (app_page.h, gzip): состояние /s, команды /c, журнал /l. */

static MarkScan fw_scan, fwp_scan;
static bool fw_ok, fwp_ok, fwp_started;
static String fw_msg;

static void web_setup() {
  server.on("/", []() {
    server.sendHeader("Content-Encoding", "gzip");
    server.sendHeader("Cache-Control", "no-cache");
    server.send_P(200, "text/html; charset=utf-8", (const char *)APP_PAGE_GZ, APP_PAGE_GZ_LEN);
  });
  server.on("/l", []() {
    static String out;
    phone_log_json(server.hasArg("n") ? server.arg("n").toInt() : -1, out);
    server.send(200, "application/json; charset=utf-8", out);
  });
  server.on("/s", []() {
    static char buf[1800];
    vac_status_json(buf, sizeof buf);
    server.send(200, "application/json", buf);
  });
  server.on("/c", []() {
    vac_command(server.arg("q").c_str());
    server.send(200, "text/plain", "ok");
  });
  server.on("/cfg", HTTP_GET, []() {
    static char hex[sizeof(vac_settings_t) * 2 + 4];
    vac_cfg_export(hex, sizeof hex);
    server.send(200, "text/plain; charset=utf-8", hex);
  });
  server.on("/cfg", HTTP_POST, []() {
    int r = vac_cfg_import(server.arg("plain").c_str());
    server.send(200, "text/plain; charset=utf-8", r ? "Файл не подошёл: другая версия или испорчен" : "Настройки восстановлены");
  });
  /* Контроллер: пишем во второй раздел приложения, в конце — проверка метки. */
  server.on(
      "/fw", HTTP_POST,
      []() {
        server.sendHeader("Connection", "close");
        server.send(200, "text/plain; charset=utf-8", fw_msg);
        if (fw_ok) {
          delay(300);
          ESP.restart();
        }
      },
      []() {
        HTTPUpload &up = server.upload();
        if (up.status == UPLOAD_FILE_START) {
          vac_power_off(1); /* турбины стоп, реле разомкнуты */
          fw_scan = {VAC_MARK, 0, false};
          fw_ok = Update.begin(UPDATE_SIZE_UNKNOWN);
          fw_msg = fw_ok ? "" : "Нет места для обновления: схема разделов без второго приложения";
        } else if (up.status == UPLOAD_FILE_WRITE && fw_ok) {
          fw_scan.feed(up.buf, up.currentSize);
          if (Update.write(up.buf, up.currentSize) != up.currentSize) fw_ok = false, fw_msg = "Ошибка записи";
        } else if (up.status == UPLOAD_FILE_END && fw_ok) {
          if (!fw_scan.found) {
            Update.abort();
            fw_ok = false;
            fw_msg = "Это не прошивка контроллера «S3» — ничего не записано";
          } else if (Update.end(true)) {
            fw_msg = "Готово: перезагрузка. Если новая прошивка не запустится — вернётся старая";
          } else
            fw_ok = false, fw_msg = "Ошибка обновления";
        }
      });
  /* Экран: пересылаем по проводу пульта; метку проверяет и экран, и мы. */
  server.on(
      "/fwp", HTTP_POST,
      []() {
        uart_mute = 0;
        server.send(200, "text/plain; charset=utf-8", fw_msg);
      },
      []() {
        HTTPUpload &up = server.upload();
        if (up.status == UPLOAD_FILE_START) {
          vac_power_off(1);
          fwp_scan = {panel_mark, 0, false};
          uart_mute = 1; /* ядро молчит в UART, пока идёт прошивка экрана */
          delay(50);
          Serial1.print("U b 0\n");
          fwp_ok = fwp_started = panel_reply("U ok", 3000);
          fw_msg = fwp_ok ? "" : "Экран не отвечает на обновление (старая прошивка экрана?)";
        } else if (up.status == UPLOAD_FILE_WRITE && fwp_ok) {
          fwp_scan.feed(up.buf, up.currentSize);
          if (!panel_send(up.buf, up.currentSize)) fwp_ok = false, fw_msg = "Обрыв связи с экраном";
        } else if (up.status == UPLOAD_FILE_END && fwp_started) {
          if (!fwp_ok || !fwp_scan.found) {
            Serial1.print("U x\n");
            if (fwp_ok) fw_msg = "Это не прошивка экрана — ничего не записано";
            fwp_ok = false;
          } else {
            Serial1.print("U e\n");
            fwp_ok = panel_reply("U done", 10000);
            fw_msg = fwp_ok ? "Экран обновлён и перезапускается" : "Экран не принял файл";
          }
        }
      });
}

static void wifi_poll() {
  int r = wifi_req;
  if (r < 0) return;
  wifi_req = -1;
  if (r && !wifi_on) {
    WiFi.softAP(wifi_ssid, wifi_pass);
    server.begin();
    wifi_on = true;
  } else if (!r && wifi_on) {
    server.stop();
    WiFi.softAPdisconnect(true);
    WiFi.mode(WIFI_OFF);
    wifi_on = false;
  }
}

void setup() {
  Serial.begin(115200);
  analogReadResolution(12);
  analogSetAttenuation(ADC_11db);
  prefs.begin("vac", false);
  strcpy(panel_mark, "VACFW:");
  strcat(panel_mark, "PANEL:");
  vac_setup();
  Serial.println(VAC_MARK);
  tick_timer = timerBegin(1000000);
  timerAttachInterrupt(tick_timer, &on_tick);
  timerAlarm(tick_timer, 100, true, 0);
  web_setup();
  ble_setup();
  phone_setup();
  lcd_start();
}

void loop() {
  while (Serial.available()) vac_serial(Serial.read());
  while (Serial1.available()) vac_uart(Serial1.read());
  lcd_poll_tx();
  RemotePkt p;
  while (xQueueReceive(remote_q, &p, 0) == pdTRUE) vac_remote(p.data, p.len, p.rssi);
  vac_loop();
  phone_poll();
  wifi_poll();
  if (wifi_on) server.handleClient();
  /* Проработали 30 с — прошивка годная, откат больше не нужен. */
  if (!app_valid && millis() > 30000) {
    app_valid = true;
    esp_ota_mark_app_valid_cancel_rollback();
  }
}
