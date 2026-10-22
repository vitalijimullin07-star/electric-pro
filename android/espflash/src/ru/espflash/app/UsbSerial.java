package ru.espflash.app;

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
 * Последовательный порт по кабелю OTG: плата ESP32 с родным USB (Espressif 303A — USB-Serial/JTAG, класс CDC)
 * или с переходником USB-UART: WCH CH340/CH341 (свой протокол), CH343/CH9102 (CDC), Silicon Labs CP210x, FTDI.
 * Только байты, скорость и линии DTR/RTS — протокол загрузчика ESP32 в странице (src/pylesos/apk/esp-flash.ts).
 * События странице: {"t":"usb","s":"open|closed|nodevice|denied|detached|error", kind, name, vid, pid} и
 * {"t":"usb","rx":"base64"}.
 */
final class UsbSerial {
    private static final String ACT_PERM = "ru.espflash.app.USB_PERMISSION";
    static final int VID_ESPRESSIF = 0x303A, VID_WCH = 0x1A86, VID_SILABS = 0x10C4, VID_FTDI = 0x0403;

    /** Вид переходника: cdc — класс CDC-ACM (родной USB ESP32-S3/C3/C6, CH343, CH9102), ch34x, cp210x, ftdi. */
    private String kind = "";
    private final MainActivity act;
    private final UsbManager um;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private UsbDeviceConnection conn;
    private UsbInterface ctrl, data;
    private UsbEndpoint in, out;
    private Thread reader;
    private volatile boolean running;
    private boolean receivers;
    private int lastId = -1;
    private int baud = 115200;
    private boolean dtr, rts;

    private final BroadcastReceiver rcv = new BroadcastReceiver() {
        @Override
        public void onReceive(Context c, Intent i) {
            if (ACT_PERM.equals(i.getAction())) {
                UsbDevice d = i.getParcelableExtra(UsbManager.EXTRA_DEVICE);
                if (d != null && i.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)) connect(d);
                else emit("denied", null);
            } else if (UsbManager.ACTION_USB_DEVICE_DETACHED.equals(i.getAction())) {
                UsbDevice d = i.getParcelableExtra(UsbManager.EXTRA_DEVICE);
                if (d != null && conn != null && d.getDeviceId() == lastId) {
                    close();
                    emit("detached", null);
                }
            }
        }
    };

    UsbSerial(MainActivity act) {
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

    private static boolean hasCdc(UsbDevice d) {
        for (int k = 0; k < d.getInterfaceCount(); k++)
            if (d.getInterface(k).getInterfaceClass() == UsbConstants.USB_CLASS_CDC_DATA) return true;
        return false;
    }

    /** Плата на шине: сначала известные производители, потом любое устройство CDC. */
    private UsbDevice find() {
        if (um == null) return null;
        UsbDevice any = null;
        for (UsbDevice d : um.getDeviceList().values()) {
            int v = d.getVendorId();
            if (v == VID_ESPRESSIF || v == VID_WCH || v == VID_SILABS || v == VID_FTDI) return d;
            if (any == null && hasCdc(d)) any = d;
        }
        return any;
    }

    synchronized void open() {
        register();
        UsbDevice d = find();
        if (d == null) {
            emit("nodevice", null);
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

    /** Родной USB чипа после сброса пропадает с шины и появляется снова: ждать (до ms) и подключиться. */
    void reopen(int ms) {
        close();
        long t0 = System.currentTimeMillis(), until = t0 + ms;
        Runnable poll = new Runnable() {
            @Override
            public void run() {
                UsbDevice d = find();
                if (d != null && d.getDeviceId() == lastId && System.currentTimeMillis() - t0 < 3000) d = null;
                if (d != null) {
                    if (um.hasPermission(d)) connect(d);
                    else ask(d);
                } else if (System.currentTimeMillis() < until) ui.postDelayed(this, 150);
                else emit("nodevice", null);
            }
        };
        ui.postDelayed(poll, 300);
    }

    private synchronized void connect(UsbDevice d) {
        close();
        lastId = d.getDeviceId();
        int v = d.getVendorId(), p = d.getProductId();
        if (hasCdc(d)) kind = "cdc";
        else if (v == VID_WCH) kind = "ch34x";
        else if (v == VID_SILABS) kind = "cp210x";
        else if (v == VID_FTDI) kind = "ftdi";
        else kind = "cdc";
        for (int k = 0; k < d.getInterfaceCount(); k++) {
            UsbInterface f = d.getInterface(k);
            if (f.getInterfaceClass() == UsbConstants.USB_CLASS_COMM && ctrl == null) ctrl = f;
            boolean dataIf = "cdc".equals(kind) ? f.getInterfaceClass() == UsbConstants.USB_CLASS_CDC_DATA : true;
            if (!dataIf || data != null) continue;
            UsbEndpoint bi = null, bo = null;
            for (int e = 0; e < f.getEndpointCount(); e++) {
                UsbEndpoint ep = f.getEndpoint(e);
                if (ep.getType() != UsbConstants.USB_ENDPOINT_XFER_BULK) continue;
                if (ep.getDirection() == UsbConstants.USB_DIR_IN) bi = ep;
                else bo = ep;
            }
            if (bi != null && bo != null) {
                data = f;
                in = bi;
                out = bo;
            }
        }
        conn = um.openDevice(d);
        if (conn == null || data == null || !conn.claimInterface(data, true)) {
            close();
            emit("error", null);
            return;
        }
        if (ctrl != null && ctrl != data) conn.claimInterface(ctrl, true);
        try {
            init();
        } catch (Exception e) {
            close();
            emit("error", null);
            return;
        }
        running = true;
        final UsbDeviceConnection c = conn;
        final UsbEndpoint ep = in;
        final boolean ftdi = "ftdi".equals(kind);
        final int mps = Math.max(ep.getMaxPacketSize(), 8);
        reader = new Thread(() -> {
            byte[] buf = new byte[16384];
            byte[] clean = new byte[16384];
            while (running) {
                int n = c.bulkTransfer(ep, buf, buf.length, 100);
                if (n <= 0) continue;
                if (!ftdi) emitRx(buf, n);
                else {
                    // FTDI: в начале каждого пакета — два байта состояния линий.
                    int m = 0;
                    for (int i = 0; i < n; i += mps)
                        for (int j = i + 2; j < Math.min(i + mps, n); j++) clean[m++] = buf[j];
                    if (m > 0) emitRx(clean, m);
                }
            }
        }, "usb-rx");
        reader.start();
        emit("open", d);
    }

    /* ---------------- переходники ---------------- */

    private int ifc() {
        return data != null ? data.getId() : 0;
    }

    private void vendorOut(int req, int value, int index) throws Exception {
        if (conn.controlTransfer(0x40, req, value, index, null, 0, 500) < 0) throw new Exception("USB: команда " + req);
    }

    private void init() throws Exception {
        switch (kind) {
            case "ch34x":
                // Как в драйвере Linux ch341 и usb-serial-for-android: версия, сброс, скорость, 8N1, линии.
                byte[] v = new byte[2];
                conn.controlTransfer(0xC0, 0x5F, 0, 0, v, 2, 500);
                vendorOut(0xA1, 0, 0);
                setBaud(baud);
                vendorOut(0x9A, 0x2518, 0x00C3);
                vendorOut(0xA1, 0x501F, 0xD90A);
                setBaud(baud);
                break;
            case "cp210x":
                if (conn.controlTransfer(0x41, 0x00, 1, ifc(), null, 0, 500) < 0) throw new Exception("CP210x");
                conn.controlTransfer(0x41, 0x03, 0x0800, ifc(), null, 0, 500);
                setBaud(baud);
                break;
            case "ftdi":
                conn.controlTransfer(0x40, 0x00, 0, ifc() + 1, null, 0, 500);
                conn.controlTransfer(0x40, 0x04, 0x0008, ifc() + 1, null, 0, 500);
                setBaud(baud);
                break;
            default:
                setBaud(baud);
        }
        lines(false, false);
    }

    /** Скорость порта. У родного USB чипа она ни на что не влияет — команда безвредна. */
    synchronized boolean setBaud(int b) {
        UsbDeviceConnection c = conn;
        if (c == null) return false;
        baud = b;
        try {
            switch (kind) {
                case "ch34x": {
                    long factor;
                    int divisor;
                    if (b == 921600) {
                        divisor = 7;
                        factor = 0xF300;
                    } else {
                        factor = 1532620800L / b;
                        divisor = 3;
                        while (factor > 0xFFF0 && divisor > 0) {
                            factor >>= 3;
                            divisor--;
                        }
                        if (factor > 0xFFF0) return false;
                        factor = 0x10000 - factor;
                    }
                    divisor |= 0x0080; // иначе CH341A ждёт полного буфера
                    vendorOut(0x9A, 0x1312, (int) ((factor & 0xFF00) | divisor));
                    vendorOut(0x9A, 0x0F2C, (int) (factor & 0xFF));
                    return true;
                }
                case "cp210x": {
                    byte[] d = {(byte) b, (byte) (b >> 8), (byte) (b >> 16), (byte) (b >> 24)};
                    return c.controlTransfer(0x41, 0x1E, 0, ifc(), d, 4, 500) >= 0;
                }
                case "ftdi": {
                    int div = ((24000000 << 1) / b + 1) >> 1;
                    int sub = div & 7;
                    div >>= 3;
                    if (div > 0x3FFF) return false;
                    int value = div, index = 0;
                    switch (sub) {
                        case 4: value |= 0x4000; break;
                        case 2: value |= 0x8000; break;
                        case 1: value |= 0xC000; break;
                        case 3: index = 1; break;
                        case 5: value |= 0x4000; index = 1; break;
                        case 6: value |= 0x8000; index = 1; break;
                        case 7: value |= 0xC000; index = 1; break;
                        default: break;
                    }
                    return c.controlTransfer(0x40, 0x03, value, index, null, 0, 500) >= 0;
                }
                default: {
                    byte[] d = {(byte) b, (byte) (b >> 8), (byte) (b >> 16), (byte) (b >> 24), 0, 0, 8};
                    int idx = ctrl != null ? ctrl.getId() : 0;
                    return c.controlTransfer(0x21, 0x20, 0, idx, d, 7, 500) >= 0;
                }
            }
        } catch (Exception e) {
            return false;
        }
    }

    /** Линии DTR и RTS: ими сбрасывают чип и входят в загрузчик (EN и IO0 через транзисторы платы). */
    synchronized void lines(boolean d, boolean r) {
        UsbDeviceConnection c = conn;
        if (c == null) return;
        dtr = d;
        rts = r;
        switch (kind) {
            case "ch34x":
                c.controlTransfer(0x40, 0xA4, ~((d ? 0x20 : 0) | (r ? 0x40 : 0)) & 0xFFFF, 0, null, 0, 500);
                break;
            case "cp210x":
                c.controlTransfer(0x41, 0x07, 0x0300 | (d ? 1 : 0) | (r ? 2 : 0), ifc(), null, 0, 500);
                break;
            case "ftdi":
                c.controlTransfer(0x40, 0x01, 0x0300 | (d ? 1 : 0) | (r ? 2 : 0), ifc() + 1, null, 0, 500);
                break;
            default: {
                int idx = ctrl != null ? ctrl.getId() : 0;
                c.controlTransfer(0x21, 0x22, (d ? 1 : 0) | (r ? 2 : 0), idx, null, 0, 500);
            }
        }
    }

    boolean write(String b64) {
        UsbDeviceConnection c = conn;
        UsbEndpoint o = out;
        if (c == null || o == null) return false;
        byte[] b = Base64.decode(b64, Base64.NO_WRAP);
        int off = 0;
        while (off < b.length) {
            int n = Math.min(16384, b.length - off);
            int r = c.bulkTransfer(o, b, off, n, 3000);
            if (r <= 0) return false;
            off += r;
        }
        return true;
    }

    synchronized void close() {
        running = false;
        if (conn != null) {
            try {
                if (data != null) conn.releaseInterface(data);
                if (ctrl != null && ctrl != data) conn.releaseInterface(ctrl);
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

    private static final String[] KIND_NAME = {"cdc", "USB (CDC)", "ch34x", "CH340/CH341", "cp210x", "CP210x", "ftdi", "FTDI"};

    private void emit(String s, UsbDevice d) {
        try {
            JSONObject o = new JSONObject().put("t", "usb").put("s", s);
            if (d != null) {
                String name = kind;
                for (int i = 0; i < KIND_NAME.length; i += 2) if (KIND_NAME[i].equals(kind)) name = KIND_NAME[i + 1];
                if (d.getVendorId() == VID_ESPRESSIF) name = "родной USB ESP32";
                else if (d.getVendorId() == VID_WCH && "cdc".equals(kind)) name = "CH343/CH9102";
                o.put("kind", kind).put("name", name).put("vid", d.getVendorId()).put("pid", d.getProductId());
                String prod = Build.VERSION.SDK_INT >= 21 ? d.getProductName() : null;
                if (prod != null) o.put("product", prod);
            }
            act.emit(o.toString());
        } catch (Exception ignored) {
            /* не JSON */
        }
    }

    private void emitRx(byte[] b, int n) {
        try {
            act.emit(new JSONObject().put("t", "usb").put("rx", Base64.encodeToString(b, 0, n, Base64.NO_WRAP)).toString());
        } catch (Exception ignored) {
            /* не JSON */
        }
    }
}
