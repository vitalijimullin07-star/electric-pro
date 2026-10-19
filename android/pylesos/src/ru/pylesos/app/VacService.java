package ru.pylesos.app;

import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.PendingIntent;
import android.app.Service;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanFilter;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.ParcelUuid;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.Collections;
import java.util.UUID;

/**
 * Связь с пылесосом по Bluetooth LE в фоне (служба переднего плана): поиск, подключение к запомненному
 * пылесосу (автоматически, когда он рядом), сопряжение по коду с его экрана, приём строк состояния и журнала,
 * команды. Состояние идёт в запись (Recorder) и уведомления (Alerts) даже при закрытом окне.
 */
@SuppressLint("MissingPermission")
public final class VacService extends Service {
    interface Listener {
        void onVac(String json);
    }

    static volatile Listener listener;

    static final String ACT_CONNECT = "connect", ACT_HURRY = "hurry", ACT_STOP = "stop", ACT_FORGET = "forget", ACT_SEND = "send";
    static final UUID SVC = UUID.fromString("5a3c0001-8d2e-4f1b-9a37-6b0e4c2d7f10");
    static final UUID CMD = UUID.fromString("5a3c0002-8d2e-4f1b-9a37-6b0e4c2d7f10");
    static final UUID STATUS = UUID.fromString("5a3c0003-8d2e-4f1b-9a37-6b0e4c2d7f10");
    static final UUID LOG = UUID.fromString("5a3c0004-8d2e-4f1b-9a37-6b0e4c2d7f10");
    static final UUID CCCD = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");

    /** off — не ищем; btoff — Bluetooth выключен; noperm — нет разрешения; scan — ищем; wait — ждём, когда пылесос появится
     *  (Android подключит сам); connecting, pairing — подключаемся; on — на связи. */
    static volatile String state = "off";
    static volatile String devName = "";
    private static final Object histLock = new Object();
    private static String lastStatus = "";
    private static final ArrayDeque<String> lastLog = new ArrayDeque<>();

    private static VacService inst;
    private final Handler h = new Handler(Looper.getMainLooper());
    private BluetoothAdapter ad;
    private BluetoothGatt gatt;
    private BluetoothGattCharacteristic cCmd, cStatus, cLog;
    private ScanCallback scanCb;
    private boolean stopping, ready;
    private final ArrayDeque<Runnable> ops = new ArrayDeque<>();
    private boolean opBusy;
    private Runnable opTimeout;
    private final Joiner jStatus = new Joiner(this::onStatusLine), jLog = new Joiner(this::onLogLine);

    static void command(Context c, String action, String arg) {
        Intent i = new Intent(c, VacService.class).setAction(action);
        if (arg != null) i.putExtra("arg", arg);
        if (ACT_SEND.equals(action) || ACT_STOP.equals(action) || ACT_FORGET.equals(action)) {
            // Команды — только работающей службе (не поднимаем её ради них).
            VacService s = inst;
            if (s != null) s.h.post(() -> s.handle(action, arg));
            return;
        }
        if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i);
        else c.startService(i);
    }

    /** Состояние связи для страницы. */
    static String linkJson() {
        try {
            return new JSONObject().put("t", "link").put("s", state).put("name", devName).toString();
        } catch (Exception e) {
            return "{}";
        }
    }

    /** Что уже пришло (для страницы, открытой позже): связь, последнее состояние, журнал. */
    static String snapshot() {
        try {
            JSONObject o = new JSONObject().put("link", state).put("name", devName);
            synchronized (histLock) {
                o.put("status", lastStatus);
                o.put("log", new JSONArray(lastLog));
            }
            return o.toString();
        } catch (Exception e) {
            return "{}";
        }
    }

    private static void emit(String json) {
        Listener l = listener;
        if (l != null) l.onVac(json);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        inst = this;
        BluetoothManager bm = (BluetoothManager) getSystemService(BLUETOOTH_SERVICE);
        ad = bm != null ? bm.getAdapter() : null;
        Alerts.get(this).ensureChannels();
        IntentFilter f = new IntentFilter();
        f.addAction(BluetoothAdapter.ACTION_STATE_CHANGED);
        f.addAction(BluetoothDevice.ACTION_BOND_STATE_CHANGED);
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(rx, f, Context.RECEIVER_EXPORTED);
        else registerReceiver(rx, f);
    }

    @Override
    public void onDestroy() {
        try {
            unregisterReceiver(rx);
        } catch (Exception ignored) {
            /* уже снят */
        }
        closeGatt();
        stopScan();
        Recorder.get(this).flush();
        inst = null;
        setState("off");
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Notification n = Alerts.get(this).linkNotification("Пылесос S3", "Поиск пылесоса…");
        if (Build.VERSION.SDK_INT >= 29) startForeground(Alerts.ID_LINK, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE);
        else startForeground(Alerts.ID_LINK, n);
        String action = intent != null && intent.getAction() != null ? intent.getAction() : ACT_CONNECT;
        handle(action, intent != null ? intent.getStringExtra("arg") : null);
        return START_STICKY;
    }

    private void handle(String action, String arg) {
        switch (action) {
            case ACT_SEND:
                if (arg != null) send(arg);
                break;
            case ACT_STOP:
                stopping = true;
                closeGatt();
                stopScan();
                setState("off");
                stopForeground(true);
                stopSelf();
                break;
            case ACT_FORGET:
                closeGatt();
                stopScan();
                stopping = false;
                begin(false);
                break;
            case ACT_HURRY:
                if (!"on".equals(state) && !"connecting".equals(state) && !"pairing".equals(state)) begin(true);
                break;
            default:
                stopping = false;
                if (gatt == null) begin(true);
        }
    }

    /* ---------------- поиск и подключение ---------------- */

    private String remembered() {
        return Bridge.prefs(this).getString("addr", "");
    }

    /** Начать: запомненный пылесос — короткий поиск, потом ждём его (Android подключит, когда появится); новый — поиск. */
    private void begin(boolean quick) {
        if (ad == null) {
            setState("nobt");
            return;
        }
        if (!hasPerms()) {
            setState("noperm");
            return;
        }
        if (!ad.isEnabled()) {
            setState("btoff");
            return;
        }
        stopScan();
        startScan(quick ? 20_000 : 60_000);
    }

    private boolean hasPerms() {
        for (String p : MainActivity.blePermissions()) if (checkSelfPermission(p) != android.content.pm.PackageManager.PERMISSION_GRANTED) return false;
        return true;
    }

    private void startScan(long ms) {
        BluetoothLeScanner sc = ad.getBluetoothLeScanner();
        if (sc == null) return;
        String addr = remembered();
        ScanFilter.Builder fb = new ScanFilter.Builder();
        if (!addr.isEmpty()) fb.setDeviceAddress(addr);
        else fb.setServiceUuid(new ParcelUuid(SVC));
        ScanSettings st = new ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build();
        scanCb = new ScanCallback() {
            @Override
            public void onScanResult(int type, ScanResult r) {
                if (gatt != null) return;
                stopScan();
                connect(r.getDevice(), false);
            }

            @Override
            public void onScanFailed(int code) {
                fallback();
            }
        };
        try {
            sc.startScan(Collections.singletonList(fb.build()), st, scanCb);
            setState("scan");
        } catch (Exception e) {
            fallback();
            return;
        }
        h.postDelayed(scanEnd, ms);
    }

    private final Runnable scanEnd = () -> {
        if (scanCb != null) {
            stopScan();
            fallback();
        }
    };

    /** Не нашли сразу: запомненный — ждём в фоне (autoConnect), новый — ещё поищем позже. */
    private void fallback() {
        if (stopping || gatt != null) return;
        String addr = remembered();
        if (!addr.isEmpty()) {
            try {
                connect(ad.getRemoteDevice(addr), true);
                setState("wait");
            } catch (Exception e) {
                setState("off");
            }
        } else {
            setState("notfound");
            h.postDelayed(() -> {
                if (!stopping && gatt == null) begin(false);
            }, 30_000);
        }
    }

    private void stopScan() {
        h.removeCallbacks(scanEnd);
        if (scanCb != null && ad != null) {
            try {
                BluetoothLeScanner sc = ad.getBluetoothLeScanner();
                if (sc != null) sc.stopScan(scanCb);
            } catch (Exception ignored) {
                /* Bluetooth выключили */
            }
        }
        scanCb = null;
    }

    private void connect(BluetoothDevice d, boolean auto) {
        closeGatt();
        ready = false;
        devName = d.getName() != null ? d.getName() : "пылесос";
        if (!auto) setState("connecting");
        gatt = d.connectGatt(this, auto, cb, BluetoothDevice.TRANSPORT_LE);
    }

    private void closeGatt() {
        ops.clear();
        opBusy = false;
        if (opTimeout != null) h.removeCallbacks(opTimeout);
        if (gatt != null) {
            try {
                gatt.disconnect();
                gatt.close();
            } catch (Exception ignored) {
                /* уже закрыт */
            }
        }
        gatt = null;
        cCmd = cStatus = cLog = null;
        ready = false;
    }

    private final BluetoothGattCallback cb = new BluetoothGattCallback() {
        @Override
        public void onConnectionStateChange(BluetoothGatt g, int status, int newState) {
            h.post(() -> {
                if (g != gatt) return;
                if (newState == BluetoothProfile.STATE_CONNECTED) {
                    setState("connecting");
                    discovering = false;
                    if (!g.requestMtu(247)) discover(g);
                    // Ответа на MTU нет (бывает) — всё равно ищем службы.
                    h.postDelayed(() -> {
                        if (g == gatt && !discovering) discover(g);
                    }, 2500);
                } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                    boolean was = ready;
                    BluetoothDevice d = g.getDevice();
                    closeGatt();
                    if (stopping) return;
                    if (was) Alerts.get(VacService.this).linkLost();
                    // Пылесос пропал: ждём его — Android подключит сам, когда он снова будет рядом.
                    h.postDelayed(() -> {
                        if (!stopping && gatt == null) {
                            connect(d, true);
                            setState("wait");
                        }
                    }, 1500);
                }
            });
        }

        @Override
        public void onMtuChanged(BluetoothGatt g, int mtu, int status) {
            h.post(() -> {
                if (g == gatt && !discovering) discover(g);
            });
        }

        @Override
        public void onServicesDiscovered(BluetoothGatt g, int status) {
            h.post(() -> {
                if (g != gatt) return;
                BluetoothGattService s = g.getService(SVC);
                if (s == null) {
                    setState("noservice");
                    return;
                }
                cCmd = s.getCharacteristic(CMD);
                cStatus = s.getCharacteristic(STATUS);
                cLog = s.getCharacteristic(LOG);
                if (cCmd == null || cStatus == null || cLog == null) {
                    setState("noservice");
                    return;
                }
                // Чтение зашифровано: первое обращение вызывает сопряжение (код — на экране пылесоса).
                enqueue(() -> {
                    if (!gatt.readCharacteristic(cStatus)) opDone();
                });
                enqueue(() -> subscribe(cStatus));
                enqueue(() -> subscribe(cLog));
                enqueue(() -> {
                    ready = true;
                    BluetoothDevice d = gatt.getDevice();
                    Bridge.prefs(VacService.this).edit().putString("addr", d.getAddress()).putString("name", devName).putBoolean("link", true).apply();
                    setState("on");
                    Alerts.get(VacService.this).linkBack();
                    opDone();
                });
            });
        }

        @Override
        public void onCharacteristicRead(BluetoothGatt g, BluetoothGattCharacteristic c, byte[] value, int status) {
            h.post(() -> afterRead(g, status));
        }

        @SuppressWarnings("deprecation")
        @Override
        public void onCharacteristicRead(BluetoothGatt g, BluetoothGattCharacteristic c, int status) {
            if (Build.VERSION.SDK_INT < 33) h.post(() -> afterRead(g, status));
        }

        @Override
        public void onCharacteristicChanged(BluetoothGatt g, BluetoothGattCharacteristic c, byte[] value) {
            changed(c.getUuid(), value);
        }

        @SuppressWarnings("deprecation")
        @Override
        public void onCharacteristicChanged(BluetoothGatt g, BluetoothGattCharacteristic c) {
            if (Build.VERSION.SDK_INT < 33) changed(c.getUuid(), c.getValue());
        }

        @Override
        public void onCharacteristicWrite(BluetoothGatt g, BluetoothGattCharacteristic c, int status) {
            h.post(VacService.this::opDone);
        }

        @Override
        public void onDescriptorWrite(BluetoothGatt g, BluetoothGattDescriptor d, int status) {
            h.post(VacService.this::opDone);
        }
    };

    private boolean discovering;

    private void discover(BluetoothGatt g) {
        discovering = true;
        g.discoverServices();
    }

    private void afterRead(BluetoothGatt g, int status) {
        if (g != gatt) return;
        if (status == 5 || status == 15 || status == 137) {
            // Нужна пара: Android спросит код (он на экране пылесоса), после сопряжения читаем ещё раз.
            setState("pairing");
            BluetoothDevice d = g.getDevice();
            if (d.getBondState() == BluetoothDevice.BOND_NONE) d.createBond();
            return;
        }
        opDone();
    }

    private final BroadcastReceiver rx = new BroadcastReceiver() {
        @Override
        public void onReceive(Context c, Intent i) {
            String a = i.getAction();
            if (BluetoothAdapter.ACTION_STATE_CHANGED.equals(a)) {
                int s = i.getIntExtra(BluetoothAdapter.EXTRA_STATE, 0);
                if (s == BluetoothAdapter.STATE_OFF) {
                    closeGatt();
                    stopScan();
                    setState("btoff");
                } else if (s == BluetoothAdapter.STATE_ON && !stopping) begin(true);
            } else if (BluetoothDevice.ACTION_BOND_STATE_CHANGED.equals(a)) {
                int b = i.getIntExtra(BluetoothDevice.EXTRA_BOND_STATE, 0);
                if (gatt != null && "pairing".equals(state)) {
                    if (b == BluetoothDevice.BOND_BONDED) {
                        setState("connecting");
                        opBusy = false;
                        if (!gatt.readCharacteristic(cStatus)) opDone();
                        else opBusy = true;
                    } else if (b == BluetoothDevice.BOND_NONE) {
                        // Код не ввели или ввели неверно — пробуем ещё раз через несколько секунд.
                        BluetoothDevice d = gatt.getDevice();
                        closeGatt();
                        h.postDelayed(() -> {
                            if (!stopping && gatt == null) connect(d, false);
                        }, 4000);
                    }
                }
            }
        }
    };

    @SuppressWarnings("deprecation")
    private void subscribe(BluetoothGattCharacteristic c) {
        if (gatt == null) {
            opDone();
            return;
        }
        gatt.setCharacteristicNotification(c, true);
        BluetoothGattDescriptor d = c.getDescriptor(CCCD);
        if (d == null) {
            opDone();
            return;
        }
        boolean ok;
        if (Build.VERSION.SDK_INT >= 33) ok = gatt.writeDescriptor(d, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE) == 0;
        else {
            d.setValue(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
            ok = gatt.writeDescriptor(d);
        }
        if (!ok) opDone();
    }

    /* ---------------- очередь операций GATT (по одной) ---------------- */

    private void enqueue(Runnable r) {
        ops.add(r);
        if (!opBusy) next();
    }

    private void next() {
        Runnable r = ops.poll();
        if (r == null) return;
        opBusy = true;
        opTimeout = () -> {
            // Ответа нет: не ждём вечно (кроме сопряжения — там ждём пользователя).
            if (!"pairing".equals(state)) opDone();
        };
        h.postDelayed(opTimeout, 8000);
        r.run();
    }

    private void opDone() {
        if (opTimeout != null) h.removeCallbacks(opTimeout);
        opBusy = false;
        next();
    }

    @SuppressWarnings("deprecation")
    private void send(String line) {
        if (gatt == null || cCmd == null || !ready) return;
        String l = line.length() > 180 ? line.substring(0, 180) : line;
        byte[] data = (l + "\n").getBytes(StandardCharsets.UTF_8);
        enqueue(() -> {
            if (gatt == null) {
                opDone();
                return;
            }
            boolean ok;
            if (Build.VERSION.SDK_INT >= 33) ok = gatt.writeCharacteristic(cCmd, data, BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT) == 0;
            else {
                cCmd.setWriteType(BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT);
                cCmd.setValue(data);
                ok = gatt.writeCharacteristic(cCmd);
            }
            if (!ok) opDone();
        });
    }

    /* ---------------- приём строк ---------------- */

    private void changed(UUID u, byte[] v) {
        if (v == null) return;
        if (STATUS.equals(u)) jStatus.push(v);
        else if (LOG.equals(u)) jLog.push(v);
    }

    private void onStatusLine(String line) {
        synchronized (histLock) {
            lastStatus = line;
        }
        Recorder.get(this).onStatus(line);
        Alerts.get(this).onStatus(line, false);
        try {
            emit(new JSONObject().put("t", "status").put("j", line).toString());
        } catch (Exception ignored) {
            /* не JSON — пропускаем */
        }
    }

    private void onLogLine(String line) {
        synchronized (histLock) {
            lastLog.add(line);
            while (lastLog.size() > 400) lastLog.poll();
        }
        // Голос пылесоса: строка «@V N» — та же фраза, что сказал его плеер.
        if (line.startsWith("@V ")) {
            try {
                Alerts.get(this).onVoice(Integer.parseInt(line.substring(3).trim()), false);
            } catch (NumberFormatException ignored) {
                /* не номер */
            }
        }
        try {
            emit(new JSONObject().put("t", "log").put("l", line).toString());
        } catch (Exception ignored) {
            /* пропускаем */
        }
    }

    private void setState(String s) {
        state = s;
        emit(linkJson());
        Alerts.get(this).updateLink(s, devName);
    }

    /** Склейка строк из уведомлений: куски по MTU, строка кончается «\n» (UTF-8 может разрезаться). */
    static final class Joiner {
        interface Sink {
            void line(String s);
        }

        private final ByteArrayOutputStream buf = new ByteArrayOutputStream();
        private final Sink sink;

        Joiner(Sink sink) {
            this.sink = sink;
        }

        synchronized void push(byte[] v) {
            for (byte b : v) {
                if (b == '\n') {
                    String s = new String(buf.toByteArray(), StandardCharsets.UTF_8);
                    buf.reset();
                    if (!s.isEmpty()) sink.line(s);
                } else buf.write(b);
            }
            if (buf.size() > 16000) buf.reset();
        }
    }

    static PendingIntent openApp(Context c) {
        Intent i = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(c, 0, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }
}
