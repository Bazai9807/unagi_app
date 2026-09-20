package ru.unagi.mobile;

import android.app.Activity;
import android.os.Bundle;
import android.graphics.Color;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import java.io.IOException;

/** Offline application shell. No JavaScript bridge or remote navigation. */
public final class MainActivity extends Activity {
    private WebView web;
    private static final String HOST = "app.unagi.local";

    // Scripts are packaged assets only; navigation, file access and remote requests are blocked.
    @android.annotation.SuppressLint("SetJavaScriptEnabled")
    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        web = new WebView(this);
        web.setBackgroundColor(Color.rgb(247, 245, 240));
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportZoom(false);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !isLocal(request);
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if (!isLocal(request)) return empty(403, "Forbidden");
                String path = request.getUrl().getPath();
                if (path == null || path.contains("..")) return empty(400, "Bad Request");
                if (path.equals("/")) path = "/index.html";
                String mime = path.endsWith(".css") ? "text/css" : path.endsWith(".js") ? "text/javascript" :
                    path.endsWith(".json") ? "application/json" : path.endsWith(".svg") ? "image/svg+xml" : "text/html";
                try { return new WebResourceResponse(mime, "UTF-8", getAssets().open("www" + path)); }
                catch (IOException e) { return empty(404, "Not Found"); }
            }
        });
        FrameLayout container = new FrameLayout(this);
        container.setBackgroundColor(Color.rgb(247, 245, 240));
        container.addView(web, new FrameLayout.LayoutParams(-1, -1));
        setContentView(container);
        // Target SDK 36 enforces edge-to-edge. Keep the web UI clear of system bars and keyboard.
        container.setOnApplyWindowInsetsListener((view, insets) -> {
            if (android.os.Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            } else {
                view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                    insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            }
            return insets;
        });
        web.loadUrl("https://" + HOST + "/index.html");
        if (android.os.Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(0, this::handleBack);
        }
    }
    private boolean isLocal(WebResourceRequest request) {
        return "https".equals(request.getUrl().getScheme()) && HOST.equals(request.getUrl().getHost());
    }
    private WebResourceResponse empty(int status, String message) {
        return new WebResourceResponse("text/plain", "UTF-8", status, message, null,
            new java.io.ByteArrayInputStream(new byte[0]));
    }
    private void handleBack() {
        web.evaluateJavascript("window.UnagiApp ? window.UnagiApp.back() : false", handled -> {
            if (!"true".equals(handled)) moveTaskToBack(true);
        });
    }
    // API 33+ uses the platform OnBackInvokedDispatcher registered above.
    // Keep this legacy override solely for Android 8–12; no AndroidX dependency is needed.
    @android.annotation.SuppressLint("GestureBackNavigation")
    @Override public void onBackPressed() { handleBack(); }
    @Override protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }
}
