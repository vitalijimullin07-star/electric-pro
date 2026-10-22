package ru.pylesos.app;

import android.bluetooth.BluetoothAdapter;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.webkit.JavascriptInterface;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;

/** Мост для страницы: window.PylesosNative.*. Все аргументы и ответы — строки и числа. */
final class Bridge {
    private final MainActivity act;

    Bridge(MainActivity act) {
        this.act = act;
    }

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences("pylesos", Context.MODE_PRIVATE);
    }

    /** Пользователь хочет связь с пылесосом (нажал «Подключить» или пылесос уже был привязан). */
    static boolean wantLink(Context c) {
        return prefs(c).getBoolean("link", false);
    }

    @JavascriptInterface
    public String info() {
        try {
            JSONObject o = new JSONObject();
            o.put("app", BuildInfo.VERSION);
            o.put("sdk", Build.VERSION.SDK_INT);
            o.put("perm", act.hasBlePermissions());
            o.put("want", wantLink(act));
            o.put("device", prefs(act).getString("addr", ""));
            o.put("name", prefs(act).getString("name", ""));
            return o.toString();
        } catch (Exception e) {
            return "{}";
        }
    }

    /** Страница загрузилась и готова принимать события. */
    @JavascriptInterface
    public String ready() {
        act.pageReady();
        return VacService.snapshot();
    }

    @JavascriptInterface
    public void connect() {
        prefs(act).edit().putBoolean("link", true).apply();
        if (!act.hasBlePermissions()) {
            act.askPermissions();
            return;
        }
        BluetoothAdapter ad = BluetoothAdapter.getDefaultAdapter();
        if (ad != null && !ad.isEnabled()) {
            try {
                act.startActivity(new Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE));
            } catch (Exception ignored) {
                /* нет разрешения — служба скажет «Bluetooth выключен» */
            }
        }
        VacService.command(act, VacService.ACT_CONNECT, null);
    }

    /** Отключиться и больше не искать (до «Подключить»). */
    @JavascriptInterface
    public void disconnect() {
        prefs(act).edit().putBoolean("link", false).apply();
        VacService.command(act, VacService.ACT_STOP, null);
    }

    /** Забыть пылесос: следующий «Подключить» найдёт любой. */
    @JavascriptInterface
    public void forget() {
        prefs(act).edit().remove("addr").remove("name").apply();
        VacService.command(act, VacService.ACT_FORGET, null);
    }

    /** Выбрать свой файл прошивки: ответ — событие {t:'file', name, len} или {t:'file', err}, данные — /__picked. */
    @JavascriptInterface
    public void pickFile() {
        act.pickFile();
    }

    @JavascriptInterface
    public void send(String line) {
        VacService.command(act, VacService.ACT_SEND, line);
    }

    /** Таблицы для службы: неисправности (бит, текст, авария, фраза) и фразы голоса — из protocol.ts. */
    @JavascriptInterface
    public void setTables(String json) {
        prefs(act).edit().putString("tables", json).apply();
        Alerts.get(act).loadTables();
    }

    /** Настройки уведомлений: {"voice":0..3,"alarm":true,"vibrate":true}. */
    @JavascriptInterface
    public void setAlerts(String json) {
        prefs(act).edit().putString("alerts", json).apply();
        Alerts.get(act).loadSettings();
    }

    /** Состояние из демо (прошивка в телефоне): уведомления и голос — как от настоящего. */
    @JavascriptInterface
    public void demoStatus(String json) {
        Alerts.get(act).onStatus(json, true);
    }

    /** Голос пылесоса: фраза N (номер V_… = файл voice/00NN.mp3). */
    @JavascriptInterface
    public void voice(int n) {
        Alerts.get(act).onVoice(n, true);
    }

    @JavascriptInterface
    public void speak(String text) {
        Voice.get(act).say(null, text, false);
    }

    /** Последние строки записи (CSV с заголовком) — для графиков после перезапуска. */
    @JavascriptInterface
    public String recTail(int lines) {
        return Recorder.get(act).tail(lines);
    }

    /** Список дней записи: «2026-10-19 12345» (имя и размер) по строкам. */
    @JavascriptInterface
    public String recDays() {
        return Recorder.get(act).days();
    }

    @JavascriptInterface
    public void shareRec(String day) {
        File f = Recorder.get(act).file(day);
        if (f != null && f.exists()) share("pylesos-" + day + ".csv", null, f);
    }

    /** Поделиться текстом как файлом (CSV журнала, отчёт). */
    @JavascriptInterface
    public void shareText(String name, String text) {
        share(name, text, null);
    }

    private void share(String name, String text, File src) {
        try {
            File dir = new File(act.getCacheDir(), "share");
            //noinspection ResultOfMethodCallIgnored
            dir.mkdirs();
            String safe = name.replaceAll("[^A-Za-z0-9._-]", "_");
            File out = new File(dir, safe);
            try (FileOutputStream os = new FileOutputStream(out)) {
                if (src != null) java.nio.file.Files.copy(src.toPath(), os);
                else os.write(text.getBytes(StandardCharsets.UTF_8));
            }
            Uri uri = Uri.parse("content://" + ShareProvider.AUTHORITY + "/" + safe);
            Intent i = new Intent(Intent.ACTION_SEND);
            i.setType(safe.endsWith(".csv") ? "text/csv" : "text/plain");
            i.putExtra(Intent.EXTRA_STREAM, uri);
            i.putExtra(Intent.EXTRA_SUBJECT, name);
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            act.startActivity(Intent.createChooser(i, "Отправить " + name).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION));
        } catch (Exception ignored) {
            /* некуда отправить */
        }
    }

    @JavascriptInterface
    public void fullscreen(boolean on) {
        act.fullscreen(on);
    }

    @JavascriptInterface
    public void keepOn(boolean on) {
        act.keepOn(on);
    }

    /** Настройки уведомлений приложения в Android (громкость, звук, на заблокированном экране). */
    @JavascriptInterface
    public void openNotifySettings() {
        try {
            Intent i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, act.getPackageName());
            act.startActivity(i);
        } catch (Exception e) {
            act.startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + act.getPackageName())));
        }
    }

    @JavascriptInterface
    public void askPermissions() {
        act.askPermissions();
    }

    /* ---------------- кабель к плате (OTG): прошивка ESP32-S3 из приложения ---------------- */

    @JavascriptInterface
    public void usbOpen() {
        act.usb().open();
    }

    /** После сброса чипа плата переподключается к шине: дождаться и открыть снова. */
    @JavascriptInterface
    public void usbReopen(int ms) {
        act.usb().reopen(ms);
    }

    @JavascriptInterface
    public boolean usbWrite(String b64) {
        return act.usb().write(b64);
    }

    @JavascriptInterface
    public void usbLines(boolean dtr, boolean rts) {
        act.usb().lines(dtr, rts);
    }

    @JavascriptInterface
    public void usbClose() {
        act.usb().close();
    }
}
