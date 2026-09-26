/*
 * Контроллер строительного пылесоса на ESP32-WROOM-32E — обвязка для Arduino-ESP32 3.x.
 * Вся логика — в ядре (vac_core.c, vac_link.c, vac_drv.c), здесь только железо:
 * выводы, таймер 100 мкс, прерывание детектора нуля, АЦП, две шины I²C, UART2 к пульту
 * (плата ESP32-S3 с экраном, firmware/vacuum-panel), зуммер, настройки во флеше и
 * страница управления по Wi-Fi (точка доступа «Pylesos»).
 *
 * Arduino IDE: плата «ESP32 Dev Module», Flash 4 МБ, Partition Scheme — Default.
 * Первая прошивка — через разъём X6 (5V, GND, TX, RX) и переходник USB-UART:
 * держать BOOT, нажать RESET, отпустить BOOT, затем «Загрузка».
 */
#include <Arduino.h>
#include <Preferences.h>
#include <WebServer.h>
#include <WiFi.h>
#include <Wire.h>
#include "vac_core.h"

extern Preferences prefs;
static WebServer server(80);
static hw_timer_t *tick_timer;

static void IRAM_ATTR on_tick(void) { vac_tick(); }

/* ---------------- страница управления ---------------- */

static const char PAGE[] PROGMEM = R"HTML(<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Пылесос</title>
<style>body{font:16px system-ui;margin:16px;background:#111;color:#eee}b{font-size:22px}
button{font-size:18px;margin:4px;padding:10px 14px;border-radius:8px;border:0;background:#2b6cb0;color:#fff}
td{padding:3px 10px}.bad{color:#f66}</style></head><body><h2>Пылесос</h2>
<div><button onclick="c('start')">Пуск</button><button onclick="c('stop')">Стоп</button>
<button onclick="c('mode a')">Авто</button><button onclick="c('mode m')">Ручной</button>
<button onclick="c('purge')">Продувка</button></div>
<p>Уставка расхода: <input type="range" min="10" max="60" step="1" id="q" onchange="c('sp '+this.value)"> <b id="qv"></b></p>
<p>Мощность в ручном: <input type="range" min="30" max="100" step="5" id="p" onchange="c('pw '+this.value)"> <b id="pv"></b></p>
<table id="t"></table><p class="bad" id="f"></p>
<script>
const L={state:'Включён',mode:'Режим: 0 ручной, 1 авто, 2 выкл',sp:'Уставка, л/с',running:'Турбины',p1:'Т1, %',p2:'Т2, %',i1:'Ток Т1, А',i2:'Ток Т2, А',tool:'Инструмент, А',
t1:'Т1, °C',t2:'Т2, °C',mains:'Сеть, В',vacuum:'Разрежение, кПа',flow:'Расход, л/с',speed:'Скорость, м/с',filter:'Фильтр, Па',r:'R фильтра',load:'Загрузка фильтра, %',runon:'Уборка остатка, с',panel:'Пульт на связи'};
function c(x){fetch('/c?q='+encodeURIComponent(x)).then(u)}
function u(){fetch('/s').then(r=>r.json()).then(s=>{
document.getElementById('t').innerHTML=Object.keys(L).map(k=>'<tr><td>'+L[k]+'</td><td><b>'+s[k]+'</b></td></tr>').join('');
document.getElementById('pv').textContent=s.power+' %';document.getElementById('p').value=s.power;
document.getElementById('qv').textContent=s.sp+' л/с';document.getElementById('q').value=s.sp;
document.getElementById('f').textContent=s.faults?'Неисправности: код '+s.faults:''})}
setInterval(u,1000);u();
</script></body></html>)HTML";

static void web_setup() {
  uint8_t mac[6];
  WiFi.macAddress(mac);
  char ssid[24];
  snprintf(ssid, sizeof ssid, "Pylesos-%02X%02X", mac[4], mac[5]);
  WiFi.softAP(ssid, "12345678");
  server.on("/", []() { server.send_P(200, "text/html; charset=utf-8", PAGE); });
  server.on("/s", []() {
    char buf[512];
    vac_status_json(buf, sizeof buf);
    server.send(200, "application/json", buf);
  });
  server.on("/c", []() {
    vac_command(server.arg("q").c_str());
    server.send(200, "text/plain", "ok");
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
}

void loop() {
  while (Serial.available()) vac_serial(Serial.read());
  while (Serial2.available()) vac_uart(Serial2.read());
  vac_loop();
  server.handleClient();
}
