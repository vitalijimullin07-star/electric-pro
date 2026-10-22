package ru.espflash.app;

import android.os.Build;
import android.webkit.JavascriptInterface;

import org.json.JSONObject;

/** Мост для страницы: window.EspNative.*. Все аргументы и ответы — строки, числа и логические. */
final class Bridge {
    private final MainActivity act;

    Bridge(MainActivity act) {
        this.act = act;
    }

    @JavascriptInterface
    public String info() {
        try {
            return new JSONObject().put("app", BuildInfo.VERSION).put("sdk", Build.VERSION.SDK_INT).put("device", Build.MANUFACTURER + " " + Build.MODEL).toString();
        } catch (Exception e) {
            return "{}";
        }
    }

    /** Страница загрузилась — можно слать события. */
    @JavascriptInterface
    public void ready() {
        act.pageReady();
    }

    @JavascriptInterface
    public void usbOpen() {
        act.usb().open();
    }

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
    public boolean usbBaud(int baud) {
        return act.usb().setBaud(baud);
    }

    @JavascriptInterface
    public void usbClose() {
        act.usb().close();
    }

    /** Выбрать файл: ответ — событие {t:'file', name, len} или {t:'file', err}, данные — запросом /__picked. */
    @JavascriptInterface
    public void pickFile() {
        act.pickFile();
    }
}
