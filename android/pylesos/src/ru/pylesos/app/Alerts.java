package ru.pylesos.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.HashMap;
import java.util.Map;

/**
 * Уведомления и голос: неисправности из состояния (поле faults — биты, тексты и фразы из protocol.ts),
 * фразы пылесоса («@V N» или демо), потеря и возврат связи. Работают и при закрытом окне.
 */
final class Alerts {
    static final int ID_LINK = 1, ID_LOST = 2;
    private static final String CH_LINK = "link", CH_ALERT = "alert", CH_INFO = "info";
    private static Alerts inst;

    private final Context c;
    private final NotificationManager nm;
    /** бит → {текст, авария, фраза}. */
    private final Map<Long, Object[]> faults = new HashMap<>();
    private String[] phrases = new String[0];
    private long prevFaults = -1;
    private long prevDemo = -1;
    private final Map<Long, Long> saidAt = new HashMap<>();
    /** Пылесос сам присылает фразы («@V N») — тогда по битам неисправностей не озвучиваем. */
    private boolean deviceSpeaks, demoSpeaks;
    /** 0 — молчать, 1 — только аварии, 2 — аварии и предупреждения, 3 — всё. */
    private int voiceLevel = 2;
    private boolean alarmStream = true, vibrate = true;

    private Alerts(Context c) {
        this.c = c.getApplicationContext();
        nm = (NotificationManager) this.c.getSystemService(Context.NOTIFICATION_SERVICE);
        loadTables();
        loadSettings();
    }

    static synchronized Alerts get(Context c) {
        if (inst == null) inst = new Alerts(c);
        return inst;
    }

    void ensureChannels() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationChannel link = new NotificationChannel(CH_LINK, "Связь с пылесосом", NotificationManager.IMPORTANCE_LOW);
        link.setShowBadge(false);
        NotificationChannel alert = new NotificationChannel(CH_ALERT, "Аварии и предупреждения", NotificationManager.IMPORTANCE_HIGH);
        alert.setSound(null, null); // звучит голос, а не сигнал
        alert.enableVibration(true);
        NotificationChannel info = new NotificationChannel(CH_INFO, "Сообщения пылесоса", NotificationManager.IMPORTANCE_DEFAULT);
        info.setSound(null, null);
        nm.createNotificationChannel(link);
        nm.createNotificationChannel(alert);
        nm.createNotificationChannel(info);
    }

    synchronized void loadTables() {
        faults.clear();
        try {
            JSONObject t = new JSONObject(Bridge.prefs(c).getString("tables", "{}"));
            JSONArray f = t.optJSONArray("faults");
            if (f != null)
                for (int i = 0; i < f.length(); i++) {
                    JSONArray r = f.getJSONArray(i);
                    faults.put(r.getLong(0), new Object[] {r.getString(1), r.optBoolean(2), r.optInt(3)});
                }
            JSONArray p = t.optJSONArray("phrases");
            if (p != null) {
                phrases = new String[p.length()];
                for (int i = 0; i < p.length(); i++) phrases[i] = p.getString(i);
            }
        } catch (Exception ignored) {
            /* без таблиц — общие тексты */
        }
    }

    synchronized void loadSettings() {
        try {
            JSONObject o = new JSONObject(Bridge.prefs(c).getString("alerts", "{}"));
            voiceLevel = o.optInt("voice", 2);
            alarmStream = o.optBoolean("alarm", true);
            vibrate = o.optBoolean("vibrate", true);
        } catch (Exception ignored) {
            /* по умолчанию */
        }
    }

    private Notification.Builder builder(String ch) {
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(c, ch) : new Notification.Builder(c);
        return b.setSmallIcon(R.drawable.ic_stat).setContentIntent(VacService.openApp(c)).setColor(0xFF3CC8B4);
    }

    Notification linkNotification(String title, String text) {
        return builder(CH_LINK).setContentTitle(title).setContentText(text).setOngoing(true).build();
    }

    void updateLink(String state, String name) {
        String t;
        switch (state) {
            case "on": t = "На связи: " + name; break;
            case "scan": t = "Поиск пылесоса…"; break;
            case "wait": t = "Пылесос не рядом — подключусь, когда появится"; break;
            case "connecting": t = "Подключение…"; break;
            case "pairing": t = "Сопряжение: код — на экране пылесоса"; break;
            case "btoff": t = "Bluetooth выключен"; break;
            case "noperm": t = "Нет разрешения на Bluetooth"; break;
            case "notfound": t = "Пылесос не найден — ищу дальше"; break;
            default: return;
        }
        nm.notify(ID_LINK, linkNotification("Пылесос S3", t));
    }

    void linkLost() {
        nm.notify(ID_LOST, builder(CH_INFO).setContentTitle("Связь с пылесосом потеряна").setContentText("Подключусь сам, когда он снова будет рядом").setAutoCancel(true).build());
    }

    void linkBack() {
        nm.cancel(ID_LOST);
    }

    /** Состояние (JSON vac_status_json): новые биты faults — уведомление и голос, ушедшие — убрать. */
    synchronized void onStatus(String json, boolean demo) {
        long f;
        try {
            f = new JSONObject(json).optLong("faults", 0) & 0xFFFFFFFFL;
        } catch (Exception e) {
            return;
        }
        long prev = demo ? prevDemo : prevFaults;
        if (demo) prevDemo = f;
        else prevFaults = f;
        if (prev < 0) prev = 0;
        for (int b = 0; b < 32; b++) {
            long bit = 1L << b;
            boolean on = (f & bit) != 0, was = (prev & bit) != 0;
            if (on && !was) fault(bit, demo);
            else if (!on && was) nm.cancel(100 + b);
        }
    }

    private void fault(long bit, boolean demo) {
        Object[] d = faults.get(bit);
        String text = d != null ? (String) d[0] : "Неисправность (код " + Long.numberOfTrailingZeros(bit) + ")";
        boolean severe = d != null && (Boolean) d[1];
        int phrase = d != null ? (Integer) d[2] : 0;
        int id = 100 + Long.numberOfTrailingZeros(bit);
        nm.notify(id, builder(CH_ALERT).setContentTitle(severe ? "Авария" : "Внимание").setContentText(text)
                .setStyle(new Notification.BigTextStyle().bigText(text)).setAutoCancel(true)
                .setCategory(severe ? Notification.CATEGORY_ALARM : Notification.CATEGORY_STATUS).build());
        if (vibrate) buzz(severe);
        // Голос: по пылесосу (он присылает «@V N») или по таблице; одно и то же — не чаще раза в минуту.
        if ((demo ? demoSpeaks : deviceSpeaks) || voiceLevel < (severe ? 1 : 2)) return;
        long now = System.currentTimeMillis();
        Long last = saidAt.get(bit);
        if (last != null && now - last < 60_000) return;
        saidAt.put(bit, now);
        Voice.get(c).say(phrase > 0 ? phrase : null, text, severe && alarmStream);
    }

    /** Фраза пылесоса N: говорим её и показываем текст. */
    synchronized void onVoice(int n, boolean demo) {
        if (demo) demoSpeaks = true;
        else deviceSpeaks = true;
        String text = n > 0 && n < phrases.length ? phrases[n] : "";
        if (voiceLevel >= 1) Voice.get(c).say(n, text, false);
        if (!text.isEmpty())
            nm.notify(300 + n, builder(CH_INFO).setContentTitle("Пылесос").setContentText(text).setAutoCancel(true).build());
    }

    @SuppressWarnings("deprecation")
    private void buzz(boolean severe) {
        Vibrator v = (Vibrator) c.getSystemService(Context.VIBRATOR_SERVICE);
        if (v == null || !v.hasVibrator()) return;
        long[] p = severe ? new long[] {0, 400, 200, 400, 200, 400} : new long[] {0, 250};
        if (Build.VERSION.SDK_INT >= 26) v.vibrate(VibrationEffect.createWaveform(p, -1));
        else v.vibrate(p, -1);
    }
}
