/*
 * Контроллер строительного пылесоса «S3» на ESP32-S3-WROOM-1 — обвязка для Arduino-ESP32 3.x.
 * Вся логика — в ядре (vac_core.c, vac_link.c, vac_drv.c), здесь только железо: таймер 100 мкс,
 * прерывание детектора нуля, АЦП, I²C, UART1 к экрану (firmware/vacuum-s3-panel), зуммер,
 * настройки во флеше, приём беспроводного пульта по Bluetooth (реклама, без соединения),
 * страница управления и обновление прошивки по Wi-Fi (точка доступа «Pylesos-S3-xxxx»).
 *
 * Arduino IDE: плата «ESP32S3 Dev Module», Flash Size 8 МБ, Partition Scheme «8M with spiffs»
 * (или любая с двумя разделами приложения — для обновления по воздуху), USB CDC On Boot —
 * Enabled (монитор порта и прошивка — через USB-C на плате).
 * arduino-cli: --fqbn esp32:esp32:esp32s3:CDCOnBoot=cdc,FlashSize=8M,PartitionScheme=default_8MB
 * Первая прошивка: держать «Загрузка» (SB11), нажать «Сброс» (SB10), отпустить «Загрузка».
 */
#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEScan.h>
#include <Preferences.h>
#include <Update.h>
#include <WebServer.h>
#include <WiFi.h>
#include "vac_core.h"

extern Preferences prefs;
static WebServer server(80);
static hw_timer_t *tick_timer;

static void IRAM_ATTR on_tick(void) { vac_tick(); }

/* ---------------- беспроводной пульт ---------------- */

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
    /* Код компании 0xFFFF (для разработки), дальше «VR…» или «VP…». */
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
  BLEDevice::init("");
  BLEScan *scan = BLEDevice::getScan();
  scan->setAdvertisedDeviceCallbacks(new RemoteScan(), true);
  scan->setActiveScan(false);
  scan->setInterval(160);
  scan->setWindow(80); /* половина эфира — Wi-Fi тоже нужен */
  scan->start(0, nullptr, false);
}

/* ---------------- страница управления ---------------- */

static const char PAGE[] PROGMEM = R"HTML(<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Пылесос S3</title>
<style>body{font:16px system-ui;margin:16px;background:#111;color:#eee}b{font-size:22px}
button{font-size:18px;margin:4px;padding:10px 14px;border-radius:8px;border:0;background:#2b6cb0;color:#fff}
td{padding:3px 10px}.bad{color:#f66}a{color:#8cf}</style></head><body><h2>Пылесос S3</h2>
<div><button onclick="c('t1 1')">Турбина 1</button><button onclick="c('t2 1')">Турбина 2</button><button onclick="c('stop')">Стоп</button>
<button onclick="c('mode a')">Авто</button><button onclick="c('mode m')">Ручной</button>
<button onclick="c('purge')">Продувка</button><button onclick="c('off')">Выкл</button><button onclick="c('wake')">Вкл</button></div>
<p>Уставка расхода: <input type="range" min="10" max="60" step="1" id="q" onchange="c('sp '+this.value)"> <b id="qv"></b></p>
<p>Мощность в ручном: <input type="range" min="30" max="100" step="5" id="p" onchange="c('pw '+this.value)"> <b id="pv"></b></p>
<p>Отбивка, удар каждые: <input type="range" min="0" max="120" step="5" id="tp" onchange="c('tap '+this.value)"> <b id="tv"></b></p>
<table id="t"></table><p class="bad" id="f"></p><p><a href="/update">Обновить прошивку</a></p>
<script>
const L={state:'Работа',sleep:'Выключен',mode:'Режим: 0 ручной, 1 авто',en1:'Турбина 1',en2:'Турбина 2',k1:'Реле 1',k2:'Реле 2',sp:'Уставка, л/с',p1:'Т1, %',p2:'Т2, %',
i1:'Ток Т1, А',i2:'Ток Т2, А',iv:'Ток клапанов, А',t1:'Т1, °C',t2:'Т2, °C',mains:'Сеть, В',vacuum:'Разрежение, кПа',flow:'Расход, л/с',speed:'Скорость, м/с',
filter:'Фильтр, Па',r:'R фильтра',load:'Загрузка фильтра, %',water:'Вода: 0 нет, 1 полон, 2 перелив',e1:'Электрод уровня, мВ',e2:'Электрод перелива, мВ',float:'Поплавок',panel:'Экран на связи',remote:'Пульт Bluetooth'};
function c(x){fetch('/c?q='+encodeURIComponent(x)).then(u)}
function u(){fetch('/s').then(r=>r.json()).then(s=>{
document.getElementById('t').innerHTML=Object.keys(L).map(k=>'<tr><td>'+L[k]+'</td><td><b>'+s[k]+'</b></td></tr>').join('');
document.getElementById('pv').textContent=s.power+' %';document.getElementById('p').value=s.power;
document.getElementById('qv').textContent=s.sp+' л/с';document.getElementById('q').value=s.sp;
document.getElementById('tv').textContent=s.tap?s.tap+' с':'выкл';document.getElementById('tp').value=s.tap;
document.getElementById('f').textContent=s.faults?'Неисправности: код '+s.faults:''})}
setInterval(u,1000);u();
</script></body></html>)HTML";

static const char UPDATE_PAGE[] PROGMEM = R"HTML(<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Прошивка</title>
<style>body{font:16px system-ui;margin:16px;background:#111;color:#eee}</style></head><body>
<h2>Обновление прошивки</h2><p>Файл .bin из Arduino IDE («Скетч → Экспорт бинарного файла»). Турбины остановятся.</p>
<form method="POST" action="/update" enctype="multipart/form-data"><input type="file" name="fw" accept=".bin"> <input type="submit" value="Загрузить"></form>
</body></html>)HTML";

static void web_setup() {
  uint8_t mac[6];
  WiFi.macAddress(mac);
  char ssid[24];
  snprintf(ssid, sizeof ssid, "Pylesos-S3-%02X%02X", mac[4], mac[5]);
  WiFi.softAP(ssid, "12345678");
  server.on("/", []() { server.send_P(200, "text/html; charset=utf-8", PAGE); });
  server.on("/s", []() {
    char buf[800];
    vac_status_json(buf, sizeof buf);
    server.send(200, "application/json", buf);
  });
  server.on("/c", []() {
    vac_command(server.arg("q").c_str());
    server.send(200, "text/plain", "ok");
  });
  server.on("/update", HTTP_GET, []() { server.send_P(200, "text/html; charset=utf-8", UPDATE_PAGE); });
  server.on(
      "/update", HTTP_POST,
      []() {
        server.sendHeader("Connection", "close");
        server.send(200, "text/plain; charset=utf-8", Update.hasError() ? "Ошибка обновления" : "Готово, перезагрузка");
        delay(300);
        if (!Update.hasError()) ESP.restart();
      },
      []() {
        HTTPUpload &up = server.upload();
        if (up.status == UPLOAD_FILE_START) {
          vac_power_off(1); /* турбины и клапаны — стоп, реле разомкнуты */
          Update.begin(UPDATE_SIZE_UNKNOWN);
        } else if (up.status == UPLOAD_FILE_WRITE) {
          Update.write(up.buf, up.currentSize);
        } else if (up.status == UPLOAD_FILE_END) {
          Update.end(true);
        }
      });
  server.begin();
  Serial.printf("Wi-Fi: сеть %s, пароль 12345678, страница http://192.168.4.1\n", ssid);
}

void setup() {
  Serial.begin(115200);
  analogReadResolution(12);
  analogSetAttenuation(ADC_11db);
  prefs.begin("vac", false);
  vac_setup();
  tick_timer = timerBegin(1000000);
  timerAttachInterrupt(tick_timer, &on_tick);
  timerAlarm(tick_timer, 100, true, 0);
  web_setup();
  ble_setup();
}

void loop() {
  while (Serial.available()) vac_serial(Serial.read());
  while (Serial1.available()) vac_uart(Serial1.read());
  RemotePkt p;
  while (xQueueReceive(remote_q, &p, 0) == pdTRUE) vac_remote(p.data, p.len, p.rssi);
  vac_loop();
  server.handleClient();
}
