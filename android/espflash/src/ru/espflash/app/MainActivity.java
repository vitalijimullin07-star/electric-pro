package ru.espflash.app;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.util.Log;
import android.view.View;
import android.webkit.ConsoleMessage;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * Окно «Прошивальщика ESP32»: WebView с интерфейсом из assets/www (как с сайта https://app.espflash/), мост
 * «EspNative» (кабель и выбор файлов). События странице — window.__esp(строка JSON).
 */
public final class MainActivity extends Activity {
    static final String HOST = "app.espflash";
    private static final String TAG = "EspFlash";
    private WebView web;
    private boolean ready;
    private UsbSerial usb;

    synchronized UsbSerial usb() {
        if (usb == null) usb = new UsbSerial(this);
        return usb;
    }

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        WebView.setWebContentsDebuggingEnabled((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0);
        web = new WebView(this);
        WebSettings ws = web.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setAllowFileAccess(false);
        ws.setAllowContentAccess(false);
        ws.setTextZoom(100);
        ws.setSupportZoom(false);
        web.setBackgroundColor(0xFF101418);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                Log.i(TAG, m.message() + " @" + m.sourceId() + ":" + m.lineNumber());
                return true;
            }
        });
        web.addJavascriptInterface(new Bridge(this), "EspNative");
        setContentView(web);
        web.loadUrl("https://" + HOST + "/index.html");
    }

    @Override
    protected void onDestroy() {
        if (usb != null) usb.shutdown();
        web.destroy();
        super.onDestroy();
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        web.evaluateJavascript("window.__espBack ? String(window.__espBack()) : 'false'", (r) -> {
            if (!"\"true\"".equals(r)) moveTaskToBack(true);
        });
    }

    /** Событие странице (window.__esp(строка JSON)). */
    void emit(String json) {
        runOnUiThread(() -> {
            if (ready) web.evaluateJavascript("window.__esp&&window.__esp(" + JSONObject.quote(json) + ")", null);
        });
    }

    void pageReady() {
        runOnUiThread(() -> ready = true);
    }

    /* ---------------- выбор файла ---------------- */

    static final int REQ_FILE = 8;
    static final int FILE_MAX = 16 << 20;
    /** Выбранный файл — страница берёт его запросом /__picked. */
    private volatile byte[] picked;

    void pickFile() {
        runOnUiThread(() -> {
            Intent i = new Intent(Intent.ACTION_GET_CONTENT);
            i.addCategory(Intent.CATEGORY_OPENABLE);
            i.setType("*/*");
            try {
                startActivityForResult(Intent.createChooser(i, "Файл прошивки (.bin)"), REQ_FILE);
            } catch (Exception e) {
                fileEvent(null, 0, "нет приложения для выбора файлов");
            }
        });
    }

    @Override
    protected void onActivityResult(int code, int result, Intent data) {
        super.onActivityResult(code, result, data);
        if (code != REQ_FILE) return;
        Uri u = data != null && result == RESULT_OK ? data.getData() : null;
        if (u == null) {
            fileEvent(null, 0, "");
            return;
        }
        new Thread(() -> {
            String name = "файл";
            try (Cursor c = getContentResolver().query(u, new String[] {OpenableColumns.DISPLAY_NAME}, null, null, null)) {
                if (c != null && c.moveToFirst() && !c.isNull(0)) name = c.getString(0);
            } catch (Exception ignored) {
                /* имя не узнали — не беда */
            }
            try (InputStream in = getContentResolver().openInputStream(u)) {
                if (in == null) throw new IOException("файл не открылся");
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buf = new byte[65536];
                for (int n; (n = in.read(buf)) > 0; ) {
                    out.write(buf, 0, n);
                    if (out.size() > FILE_MAX) throw new IOException("файл больше 16 МБ — это не прошивка");
                }
                picked = out.toByteArray();
                fileEvent(name, picked.length, null);
            } catch (Exception e) {
                fileEvent(name, 0, String.valueOf(e.getMessage()));
            }
        }, "pick").start();
    }

    private void fileEvent(String name, int len, String err) {
        try {
            JSONObject o = new JSONObject().put("t", "file").put("len", len);
            if (name != null) o.put("name", name);
            if (err != null) o.put("err", err);
            emit(o.toString());
        } catch (Exception ignored) {
            /* JSON из строк и чисел не падает */
        }
    }

    /* ---------------- страница из assets/www ---------------- */

    private final class Client extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
            Uri u = req.getUrl();
            if (!HOST.equals(u.getHost())) return null;
            String path = u.getPath();
            if (path == null || path.equals("/") || path.isEmpty()) path = "/index.html";
            if (path.contains("..")) return notFound();
            Map<String, String> h = new HashMap<>();
            h.put("Cache-Control", "no-store");
            if (path.equals("/__picked")) {
                byte[] b = picked;
                if (b == null) return notFound();
                return new WebResourceResponse("application/octet-stream", null, 200, "OK", h, new ByteArrayInputStream(b));
            }
            try {
                InputStream in = getAssets().open("www" + path);
                String mime = mime(path);
                return new WebResourceResponse(mime, mime.startsWith("text/") || mime.endsWith("javascript") ? "utf-8" : null, 200, "OK", h, in);
            } catch (IOException e) {
                return notFound();
            }
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
            Uri u = req.getUrl();
            if (HOST.equals(u.getHost())) return false;
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, u));
            } catch (Exception ignored) {
                /* нечем открыть */
            }
            return true;
        }
    }

    private static WebResourceResponse notFound() {
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not found", new HashMap<>(), new ByteArrayInputStream(new byte[0]));
    }

    static String mime(String path) {
        String p = path.toLowerCase();
        if (p.endsWith(".html")) return "text/html";
        if (p.endsWith(".js") || p.endsWith(".mjs")) return "text/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".json")) return "application/json";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".png")) return "image/png";
        return "application/octet-stream";
    }
}
