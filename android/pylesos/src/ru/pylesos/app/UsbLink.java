package ru.pylesos.app;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.hardware.usb.UsbConstants;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbEndpoint;
import android.hardware.usb.UsbInterface;
import android.hardware.usb.UsbManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;

import org.json.JSONObject;

/**
 * Кабель к плате (OTG): родной USB ESP32-S3 (USB-Serial/JTAG, 303A:1001) как последовательный порт для прошивки
 * из приложения. Только байты и линии DTR/RTS — протокол загрузчика в странице (src/pylesos/apk/esp-flash.ts).
 * При сбросе чипа плата пропадает с шины и появляется снова — reopen() ждёт её и подключается заново.
 * События странице: {"t":"usb","s":"open|closed|nodevice|denied|detached|error"} и {"t":"usb","rx":"base64"}.
 */
final class UsbLink {
    static final int VID = 0x303A;
    private static final String ACT_PERM = "ru.pylesos.app.USB_PERMISSION";
    private final MainActivity act;
    private final UsbManager um;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private UsbDeviceConnection conn;
    private UsbInterface ctrl, data;
    private UsbEndpoint in, out;
    private Thread reader;
    private volatile boolean running;
    private boolean receivers;
    /** Номер устройства на шине: после сброса у платы новый — так видно, что она переподключилась. */
    private int lastId = -1;

    private final BroadcastReceiver rcv = new BroadcastReceiver() {
        @Override
        public void onReceive(Context c, Intent i) {
            if (ACT_PERM.equals(i.getAction())) {
                UsbDevice d = i.getParcelableExtra(UsbManager.EXTRA_DEVICE);
                if (d != null && i.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)) connect(d);
                else emit("denied");
            } else if (UsbManager.ACTION_USB_DEVICE_DETACHED.equals(i.getAction())) {
                UsbDevice d = i.getParcelableExtra(UsbManager.EXTRA_DEVICE);
                if (d != null && d.getVendorId() == VID && conn != null) {
                    close();
                    emit("detached");
                }
            }
        }
    };

    UsbLink(MainActivity act) {
        this.act = act;
        um = (UsbManager) act.getSystemService(Context.USB_SERVICE);
    }

    private void register() {
        if (receivers) return;
        IntentFilter f = new IntentFilter(ACT_PERM);
        f.addAction(UsbManager.ACTION_USB_DEVICE_DETACHED);
        if (Build.VERSION.SDK_INT >= 33) act.registerReceiver(rcv, f, Context.RECEIVER_NOT_EXPORTED);
        else act.registerReceiver(rcv, f);
        receivers = true;
    }

    private UsbDevice find() {
        if (um == null) return null;
        for (UsbDevice d : um.getDeviceList().values()) if (d.getVendorId() == VID) return d;
        return null;
    }

    /** Найти плату и подключиться (первый раз Android спросит разрешение). */
    synchronized void open() {
        register();
        UsbDevice d = find();
        if (d == null) {
            emit("nodevice");
            return;
        }
        if (um.hasPermission(d)) connect(d);
        else ask(d);
    }

    private void ask(UsbDevice d) {
        Intent i = new Intent(ACT_PERM).setPackage(act.getPackageName());
        int fl = Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0;
        um.requestPermission(d, PendingIntent.getBroadcast(act, 0, i, fl | PendingIntent.FLAG_UPDATE_CURRENT));
    }

    /** После сброса чипа: ждать, пока плата снова появится на шине (до ms), и подключиться. */
    void reopen(int ms) {
        close();
        long t0 = System.currentTimeMillis(), until = t0 + ms;
        Runnable poll = new Runnable() {
            @Override
            public void run() {
                UsbDevice d = find();
                // Старое устройство ещё в списке — ждём новое (через 3 с берём какое есть).
                if (d != null && d.getDeviceId() == lastId && System.currentTimeMillis() - t0 < 3000) d = null;
                if (d != null) {
                    if (um.hasPermission(d)) connect(d);
                    else ask(d);
                } else if (System.currentTimeMillis() < until) ui.postDelayed(this, 150);
                else emit("nodevice");
            }
        };
        ui.postDelayed(poll, 300);
    }

    private synchronized void connect(UsbDevice d) {
        close();
        lastId = d.getDeviceId();
        // CDC: управление (класс 2) — линии DTR/RTS, данные (класс 10) — две конечные точки bulk.
        for (int k = 0; k < d.getInterfaceCount(); k++) {
            UsbInterface f = d.getInterface(k);
            if (f.getInterfaceClass() == UsbConstants.USB_CLASS_COMM && ctrl == null) ctrl = f;
            if (f.getInterfaceClass() == UsbConstants.USB_CLASS_CDC_DATA && data == null) {
                for (int e = 0; e < f.getEndpointCount(); e++) {
                    UsbEndpoint ep = f.getEndpoint(e);
                    if (ep.getType() != UsbConstants.USB_ENDPOINT_XFER_BULK) continue;
                    if (ep.getDirection() == UsbConstants.USB_DIR_IN) in = ep;
                    else out = ep;
                }
                data = f;
            }
        }
        conn = um.openDevice(d);
        if (conn == null || data == null || in == null || out == null || !conn.claimInterface(data, true)) {
            close();
            emit("error");
            return;
        }
        if (ctrl != null) conn.claimInterface(ctrl, true);
        running = true;
        final UsbDeviceConnection c = conn;
        final UsbEndpoint ep = in;
        reader = new Thread(() -> {
            byte[] buf = new byte[4096];
            while (running) {
                int n = c.bulkTransfer(ep, buf, buf.length, 100);
                if (n > 0) emitRx(buf, n);
            }
        }, "usb-rx");
        reader.start();
        emit("open");
    }

    /** Записать байты (base64). false — кабель отключён. */
    boolean write(String b64) {
        UsbDeviceConnection c = conn;
        if (c == null) return false;
        byte[] b = Base64.decode(b64, Base64.NO_WRAP);
        int off = 0;
        while (off < b.length) {
            int n = Math.min(16384, b.length - off);
            int r = c.bulkTransfer(out, b, off, n, 3000);
            if (r <= 0) return false;
            off += r;
        }
        return true;
    }

    /** Линии DTR и RTS (SET_CONTROL_LINE_STATE): ими USB-Serial/JTAG сбрасывает чип и входит в загрузчик. */
    void lines(boolean dtr, boolean rts) {
        UsbDeviceConnection c = conn;
        if (c == null) return;
        int idx = ctrl != null ? ctrl.getId() : 0;
        c.controlTransfer(0x21, 0x22, (dtr ? 1 : 0) | (rts ? 2 : 0), idx, null, 0, 500);
    }

    synchronized void close() {
        running = false;
        if (conn != null) {
            try {
                if (data != null) conn.releaseInterface(data);
                if (ctrl != null) conn.releaseInterface(ctrl);
            } catch (Exception ignored) {
                /* уже отключена */
            }
            conn.close();
        }
        conn = null;
        ctrl = data = null;
        in = out = null;
    }

    void shutdown() {
        close();
        if (receivers) {
            try {
                act.unregisterReceiver(rcv);
            } catch (Exception ignored) {
                /* не был */
            }
            receivers = false;
        }
    }

    private void emit(String s) {
        try {
            act.onVac(new JSONObject().put("t", "usb").put("s", s).toString());
        } catch (Exception ignored) {
            /* не JSON */
        }
    }

    private void emitRx(byte[] b, int n) {
        try {
            act.onVac(new JSONObject().put("t", "usb").put("rx", Base64.encodeToString(b, 0, n, Base64.NO_WRAP)).toString());
        } catch (Exception ignored) {
            /* не JSON */
        }
    }
}
