package ru.pylesos.app;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Окно приложения: WebView с интерфейсом из assets/www (как с сайта https://app.pylesos/), мост
 * «PylesosNative» для страницы и приём событий службы (VacService) — строки состояния, журнала, голос.
 */
public final class MainActivity extends Activity implements VacService.Listener {
    static final String HOST = "app.pylesos";
    private static final String TAG = "Pylesos";
    private WebView web;
    private boolean ready;
    private UsbLink usb;

    /** Кабель к плате (прошивка по OTG). */
    synchronized UsbLink usb() {
        if (usb == null) usb = new UsbLink(this);
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
        ws.setDatabaseEnabled(true);
        ws.setMediaPlaybackRequiresUserGesture(false);
        ws.setAllowFileAccess(false);
        ws.setAllowContentAccess(false);
        ws.setTextZoom(100);
        ws.setSupportZoom(false);
        web.setBackgroundColor(0xFF0E1317);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                Log.i(TAG, m.message() + " @" + m.sourceId() + ":" + m.lineNumber());
                return true;
            }
        });
        web.addJavascriptInterface(new Bridge(this), "PylesosNative");
        Alerts.get(this).ensureChannels();
        setContentView(web);
        web.loadUrl("https://" + HOST + "/index.html");
        askPermissions();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
        VacService.listener = this;
        // Окно открыли — служба быстрее ищет пылесос (если он не на связи).
        if (Bridge.wantLink(this) && hasBlePermissions()) VacService.command(this, VacService.ACT_HURRY, null);
    }

    @Override
    protected void onPause() {
        super.onPause();
        // web.onPause() не зовём: страница продолжает принимать данные и в фоне (её держит служба).
    }

    @Override
    protected void onDestroy() {
        if (VacService.listener == this) VacService.listener = null;
        if (usb != null) usb.shutdown();
        web.destroy();
        super.onDestroy();
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        web.evaluateJavascript("window.__vacBack ? String(window.__vacBack()) : 'false'", (r) -> {
            if (!"\"true\"".equals(r)) moveTaskToBack(true);
        });
    }

    /** Событие от службы → страница (window.__vac(строка JSON)). */
    @Override
    public void onVac(String json) {
        runOnUiThread(() -> {
            if (ready) web.evaluateJavascript("window.__vac&&window.__vac(" + JSONObject.quote(json) + ")", null);
        });
    }

    void pageReady() {
        runOnUiThread(() -> ready = true);
    }

    /* ---------------- разрешения ---------------- */

    static final int REQ_PERMS = 7;

    boolean hasBlePermissions() {
        for (String p : blePermissions()) if (checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) return false;
        return true;
    }

    static String[] blePermissions() {
        if (Build.VERSION.SDK_INT >= 31) return new String[] {Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT};
        return new String[] {Manifest.permission.ACCESS_FINE_LOCATION};
    }

    void askPermissions() {
        List<String> need = new ArrayList<>();
        for (String p : blePermissions()) if (checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) need.add(p);
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
            need.add(Manifest.permission.POST_NOTIFICATIONS);
        if (!need.isEmpty()) requestPermissions(need.toArray(new String[0]), REQ_PERMS);
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] res) {
        super.onRequestPermissionsResult(code, perms, res);
        if (code == REQ_PERMS) {
            onVac(VacService.linkJson());
            if (Bridge.wantLink(this) && hasBlePermissions()) VacService.command(this, VacService.ACT_CONNECT, null);
        }
    }

    /* ---------------- экран ---------------- */

    @SuppressWarnings("deprecation")
    void fullscreen(boolean on) {
        runOnUiThread(() -> {
            if (Build.VERSION.SDK_INT >= 30) {
                WindowInsetsController c = getWindow().getInsetsController();
                if (c == null) return;
                if (on) {
                    c.hide(WindowInsets.Type.systemBars());
                    c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                } else c.show(WindowInsets.Type.systemBars());
            } else {
                View d = getWindow().getDecorView();
                d.setSystemUiVisibility(on
                        ? View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        : 0);
            }
        });
    }

    void keepOn(boolean on) {
        runOnUiThread(() -> {
            if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        });
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
            try {
                InputStream in = getAssets().open("www" + path);
                Map<String, String> h = new HashMap<>();
                h.put("Access-Control-Allow-Origin", "*");
                h.put("Cache-Control", "no-cache");
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
                /* нечем открыть — остаёмся */
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
        if (p.endsWith(".wasm")) return "application/wasm";
        if (p.endsWith(".json")) return "application/json";
        if (p.endsWith(".woff2")) return "font/woff2";
        if (p.endsWith(".mp3")) return "audio/mpeg";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".png")) return "image/png";
        return "application/octet-stream";
    }
}
