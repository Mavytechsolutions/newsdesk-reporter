package com.apbja.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/** APBJA: shows the APBJA app from the server, full screen. */
public class MainActivity extends Activity {
    private static final int PICK = 41;
    private WebView web;
    private ValueCallback<Uri[]> pending;
    private String home;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        home = getString(R.string.app_url);
        web = new WebView(this);
        web.setBackgroundColor(Color.WHITE);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUserAgentString(s.getUserAgentString() + " APBJA-Android/1");
        CookieManager.getInstance().setAcceptCookie(true);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                String scheme = u.getScheme() == null ? "" : u.getScheme();
                if (u.toString().startsWith(home) && !u.getPath().startsWith("/download")) return false;
                if (scheme.equals("tel")) { open(new Intent(Intent.ACTION_DIAL, u)); return true; }
                open(new Intent(Intent.ACTION_VIEW, u)); // WhatsApp, maps, web links open outside
                return true;
            }
            @Override
            public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
                if (r.isForMainFrame()) showOffline();
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
                if (pending != null) pending.onReceiveValue(null);
                pending = cb;
                Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("image/*");
                try { startActivityForResult(Intent.createChooser(i, "Choose photo"), PICK); }
                catch (ActivityNotFoundException ex) { pending = null; return false; }
                return true;
            }
        });

        if (saved != null) web.restoreState(saved); else web.loadUrl(home);
    }

    private void open(Intent i) {
        try { startActivity(i); } catch (ActivityNotFoundException ignored) { }
    }

    private void showOffline() {
        String html = "<html><head><meta name='viewport' content='width=device-width,initial-scale=1'></head>"
            + "<body style='margin:0;font-family:sans-serif;background:#d6001c;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center'>"
            + "<div style='padding:24px'><h2>No connection</h2><p>Check your internet and try again.</p>"
            + "<a href='" + home + "' style='display:inline-block;margin-top:12px;background:#fff;color:#d6001c;padding:14px 28px;border-radius:12px;font-weight:bold;text-decoration:none'>Try again</a></div></body></html>";
        web.loadDataWithBaseURL(home, html, "text/html", "utf-8", home);
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        if (req == PICK && pending != null) {
            Uri[] r = null;
            if (res == RESULT_OK && data != null && data.getData() != null) r = new Uri[]{ data.getData() };
            pending.onReceiveValue(r);
            pending = null;
            return;
        }
        super.onActivityResult(req, res, data);
    }

    @Override
    public void onBackPressed() {
        web.evaluateJavascript("(window.appBack&&window.appBack())?'1':'0'", r -> {
            if (r == null || !r.contains("1")) { if (web.canGoBack()) web.goBack(); else finish(); }
        });
    }

    @Override protected void onSaveInstanceState(Bundle out) { super.onSaveInstanceState(out); web.saveState(out); }
    @Override protected void onResume() { super.onResume(); web.onResume(); }
    @Override protected void onPause() { web.onPause(); super.onPause(); }
}
