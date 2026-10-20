package ru.pylesos.app;

import android.content.Context;

import org.json.JSONObject;

import java.io.BufferedWriter;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStreamWriter;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Arrays;
import java.util.Date;
import java.util.Locale;

/**
 * Запись в телефон, пока пылесос на связи: раз в секунду выбранные поля состояния в CSV по дням
 * (files/rec/ГГГГ-ММ-ДД.csv). Пишется службой и при закрытом окне; графики и выгрузка читают отсюда.
 */
final class Recorder {
    /** Поля vac_status_json (src/pylesos/protocol.ts), порядок = столбцы после времени. */
    static final String[] FIELDS = {
        "state", "running", "purging", "power", "p1", "p2", "i1", "i2", "itotal", "mains", "vacuum", "flow", "speed",
        "filter", "r", "t1", "t2", "intake", "pulses", "water", "load", "w1", "w2", "kg", "faults", "itool", "ta", "rh", "pa"
    };
    private static Recorder inst;
    private final File dir;
    private BufferedWriter w;
    private String day = "";
    private long last, lastFlush;

    private Recorder(Context c) {
        dir = new File(c.getFilesDir(), "rec");
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
    }

    static synchronized Recorder get(Context c) {
        if (inst == null) inst = new Recorder(c);
        return inst;
    }

    static String header() {
        return "t," + String.join(",", FIELDS);
    }

    synchronized void onStatus(String json) {
        long now = System.currentTimeMillis();
        if (now - last < 1000) return;
        last = now;
        try {
            JSONObject o = new JSONObject(json);
            StringBuilder sb = new StringBuilder();
            sb.append(now / 1000);
            for (String f : FIELDS) {
                sb.append(',');
                double v = o.optDouble(f, 0);
                if (v == Math.rint(v) && Math.abs(v) < 1e12) sb.append((long) v);
                else sb.append(String.format(Locale.ROOT, "%.3f", v).replaceAll("0+$", "").replaceAll("\\.$", ""));
            }
            String d = new SimpleDateFormat("yyyy-MM-dd", Locale.ROOT).format(new Date(now));
            if (!d.equals(day) || w == null) {
                close();
                day = d;
                File f = new File(dir, d + ".csv");
                boolean fresh = !f.exists();
                w = new BufferedWriter(new OutputStreamWriter(new FileOutputStream(f, true), StandardCharsets.UTF_8));
                if (fresh) w.write(header() + "\n");
            }
            w.write(sb.append('\n').toString());
            if (now - lastFlush > 10_000) {
                w.flush();
                lastFlush = now;
            }
        } catch (Exception ignored) {
            /* не состояние */
        }
    }

    synchronized void flush() {
        try {
            if (w != null) w.flush();
        } catch (IOException ignored) {
            /* диск */
        }
    }

    private void close() {
        try {
            if (w != null) w.close();
        } catch (IOException ignored) {
            /* уже закрыт */
        }
        w = null;
    }

    File file(String day) {
        if (!day.matches("\\d{4}-\\d{2}-\\d{2}")) return null;
        flush();
        return new File(dir, day + ".csv");
    }

    /** Последние строки сегодняшней (или последней) записи с заголовком. */
    synchronized String tail(int lines) {
        flush();
        File[] fs = dir.listFiles((d, n) -> n.endsWith(".csv"));
        if (fs == null || fs.length == 0) return header() + "\n";
        Arrays.sort(fs);
        File f = fs[fs.length - 1];
        try (RandomAccessFile raf = new RandomAccessFile(f, "r")) {
            long len = raf.length();
            long from = Math.max(0, len - (long) lines * 140);
            raf.seek(from);
            byte[] b = new byte[(int) (len - from)];
            raf.readFully(b);
            String s = new String(b, StandardCharsets.UTF_8);
            if (from > 0) {
                int nl = s.indexOf('\n');
                s = nl >= 0 ? s.substring(nl + 1) : "";
                s = header() + "\n" + s;
            }
            return s;
        } catch (IOException e) {
            return header() + "\n";
        }
    }

    synchronized String days() {
        File[] fs = dir.listFiles((d, n) -> n.endsWith(".csv"));
        if (fs == null) return "";
        Arrays.sort(fs);
        StringBuilder sb = new StringBuilder();
        for (File f : fs) sb.append(f.getName().replace(".csv", "")).append(' ').append(f.length()).append('\n');
        return sb.toString();
    }
}
