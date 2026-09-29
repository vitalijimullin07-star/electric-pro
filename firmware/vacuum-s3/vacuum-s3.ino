/*
 * Контроллер строительного пылесоса «S3» на ESP32-S3-WROOM-1 — обвязка для Arduino-ESP32 3.x.
 * Вся логика — в ядре (vac_core.c, vac_link.c, vac_drv.c), здесь только железо: таймер 100 мкс,
 * прерывание детектора нуля, АЦП, I²C, UART1 к экрану (firmware/vacuum-panel), зуммер,
 * настройки во флеше (две копии), приём пульта и меток по Bluetooth (реклама, без соединения)
 * и сеть Wi-Fi для телефона — только по команде «wifi on» (экран: «Телефон»), со случайным
 * паролем и QR-кодом на экране: страница управления, обновление прошивок контроллера и экрана
 * (файл проверяется: чужой не запишется; новая прошивка, которая не проработала 30 с, при
 * следующем сбросе откатывается на старую), резервная копия настроек.
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
#include "esp_ota_ops.h"
#include "vac_core.h"

/* Метка прошивки: по ней страница обновления узнаёт файл («чужой» не запишется). */
extern "C" const char VAC_MARK[] __attribute__((used)) = "VACFW:S3-CTRL:" VAC_VERSION;
/* Метку экрана собираем из двух кусков: целиком её в прошивке контроллера быть не должно. */
static char panel_mark[16];

extern Preferences prefs;
extern volatile int wifi_req;
extern char wifi_ssid[24], wifi_pass[12];
extern volatile int uart_mute;
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
  BLEDevice::init("");
  BLEScan *scan = BLEDevice::getScan();
  scan->setAdvertisedDeviceCallbacks(new RemoteScan(), true);
  scan->setActiveScan(false);
  scan->setInterval(160);
  scan->setWindow(80); /* половина эфира — Wi-Fi тоже бывает нужен */
  scan->start(0, nullptr, false);
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

static const char PAGE[] PROGMEM = R"HTML(<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Пылесос S3</title>
<style>body{font:16px system-ui;margin:16px;background:#111;color:#eee}b{font-size:20px}h3{margin:18px 0 6px}
button,input[type=submit]{font-size:17px;margin:4px;padding:10px 14px;border-radius:8px;border:0;background:#2b6cb0;color:#fff}
td{padding:3px 10px}.bad{color:#f66}a{color:#8cf}progress{width:100%;height:18px}</style></head><body><h2>Пылесос S3</h2>
<div><button onclick="c('start')">Пуск</button><button onclick="c('stop')">Стоп</button><button onclick="c('purge')">Продуть</button>
<button onclick="c('purge strong')">Мощная (закрыть шланг)</button><button onclick="c('sock on')">Розетка вкл</button><button onclick="c('off')">Выкл</button></div>
<table id="t"></table><p class="bad" id="f"></p>
<h3>Обновление</h3><p>Турбины остановятся. Файл проверяется: прошивка не того устройства не запишется, а новая прошивка,
которая не проработала 30 с, при сбросе откатится на старую. Настройки и паспорта фильтров сохраняются.</p>
<p>Контроллер (vacuum-s3-app.bin): <input type="file" id="fc" accept=".bin"> <button onclick="up('fc','/fw')">Загрузить</button></p>
<p>Экран (vacuum-panel-app.bin), через провод пульта, около 3 минут: <input type="file" id="fp" accept=".bin"> <button onclick="up('fp','/fwp')">Загрузить</button></p>
<progress id="pr" max="100" value="0"></progress><p id="m"></p>
<h3>Резервная копия настроек</h3><p><a href="/cfg" download="pylesos-s3-nastroyki.txt">Скачать</a> ·
восстановить: <input type="file" id="fb" accept=".txt"> <button onclick="rb()">Загрузить</button></p>
<script>
const L={state:'Работа',preset:'Режим очистки',sock:'Розетка',tool:'Инструмент',itool:'Ток инструмента, А',itotal:'Общий ток, А',cap:'Ограничение турбин, %',
p1:'Т1, %',p2:'Т2, %',i1:'Ток Т1, А',i2:'Ток Т2, А',t1:'Т1, °C',t2:'Т2, °C',mains:'Сеть, В',vacuum:'Разрежение, кПа',flow:'Расход, л/с',
filter:'Фильтр, Па',r:'R фильтра',filt:'Фильтр (0 — А, 1 — Б)',washes:'Моек',intake:'Сила удара, %',imp:'Удар, мс',every:'Промежуток, с',n:'Ударов',
water:'Вода',imag:'Ток магнитов, А'};
function c(x){fetch('/c?q='+encodeURIComponent(x)).then(u)}
function u(){fetch('/s').then(r=>r.json()).then(s=>{
document.getElementById('t').innerHTML=Object.keys(L).map(k=>'<tr><td>'+L[k]+'</td><td><b>'+s[k]+'</b></td></tr>').join('');
document.getElementById('f').textContent=s.faults?'Неисправности: код '+s.faults:''})}
function up(id,url){const f=document.getElementById(id).files[0];if(!f)return;const x=new XMLHttpRequest(),d=new FormData();d.append('fw',f);
x.upload.onprogress=e=>{document.getElementById('pr').value=e.loaded/e.total*100};x.onload=()=>{document.getElementById('m').textContent=x.responseText};
x.open('POST',url);x.send(d);document.getElementById('m').textContent='Загрузка…'}
function rb(){const f=document.getElementById('fb').files[0];if(!f)return;f.text().then(t=>fetch('/cfg',{method:'POST',body:t.trim()}).then(r=>r.text()).then(t=>document.getElementById('m').textContent=t))}
setInterval(u,1000);u();
</script></body></html>)HTML";

static MarkScan fw_scan, fwp_scan;
static bool fw_ok, fwp_ok, fwp_started;
static String fw_msg;

static void web_setup() {
  server.on("/", []() { server.send_P(200, "text/html; charset=utf-8", PAGE); });
  server.on("/s", []() {
    static char buf[1200];
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
}

void loop() {
  while (Serial.available()) vac_serial(Serial.read());
  while (Serial1.available()) vac_uart(Serial1.read());
  RemotePkt p;
  while (xQueueReceive(remote_q, &p, 0) == pdTRUE) vac_remote(p.data, p.len, p.rssi);
  vac_loop();
  wifi_poll();
  if (wifi_on) server.handleClient();
  /* Проработали 30 с — прошивка годная, откат больше не нужен. */
  if (!app_valid && millis() > 30000) {
    app_valid = true;
    esp_ota_mark_app_valid_cancel_rollback();
  }
}
