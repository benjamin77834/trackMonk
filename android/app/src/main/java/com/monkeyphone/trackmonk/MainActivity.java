package com.monkeyphone.trackmonk;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

public class MainActivity extends AppCompatActivity {
    private WebView webView;
    private static final int PERMISSION_REQUEST = 100;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(webView = new WebView(this));

        // Configurar WebView
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setGeolocationEnabled(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setDatabaseEnabled(true);

        // Bridge para guardar deviceId en SharedPreferences
        webView.addJavascriptInterface(new WebBridge(), "TrackMonkBridge");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                // Inyectar código para capturar el deviceId cuando se guarde en localStorage
                view.evaluateJavascript(
                    "(function() {" +
                    "  var origSet = Storage.prototype.setItem;" +
                    "  Storage.prototype.setItem = function(key, value) {" +
                    "    origSet.call(this, key, value);" +
                    "    if (key === 'deviceId' && window.TrackMonkBridge) {" +
                    "      window.TrackMonkBridge.saveDeviceId(value);" +
                    "    }" +
                    "  };" +
                    "  var existing = localStorage.getItem('deviceId');" +
                    "  if (existing && window.TrackMonkBridge) {" +
                    "    window.TrackMonkBridge.saveDeviceId(existing);" +
                    "  }" +
                    "})();", null);
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                callback.invoke(origin, true, false);
            }
        });

        // Pedir permisos
        requestPermissions();

        // Cargar la web app
        webView.loadUrl("https://tracker.monkeyfon.com/index.html");
    }

    // Bridge JS -> Native
    class WebBridge {
        @JavascriptInterface
        public void saveDeviceId(String deviceId) {
            SharedPreferences prefs = getSharedPreferences("trackmonk", Context.MODE_PRIVATE);
            prefs.edit().putString("deviceId", deviceId).apply();
            // Iniciar servicio si no está corriendo
            startLocationService();
        }
    }

    private void requestPermissions() {
        String[] perms;
        if (Build.VERSION.SDK_INT >= 34) {
            perms = new String[]{
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION,
                Manifest.permission.POST_NOTIFICATIONS,
                Manifest.permission.FOREGROUND_SERVICE_LOCATION
            };
        } else if (Build.VERSION.SDK_INT >= 33) {
            perms = new String[]{
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION,
                Manifest.permission.POST_NOTIFICATIONS
            };
        } else {
            perms = new String[]{
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION
            };
        }

        boolean needRequest = false;
        for (String p : perms) {
            if (ContextCompat.checkSelfPermission(this, p) != PackageManager.PERMISSION_GRANTED) {
                needRequest = true;
                break;
            }
        }
        if (needRequest) {
            ActivityCompat.requestPermissions(this, perms, PERMISSION_REQUEST);
        } else {
            requestBackgroundAndStart();
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == PERMISSION_REQUEST) {
            requestBackgroundAndStart();
        }
    }

    private void requestBackgroundAndStart() {
        // Pedir background location por separado (Android 10+)
        if (Build.VERSION.SDK_INT >= 29) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_BACKGROUND_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.ACCESS_BACKGROUND_LOCATION}, 101);
            }
        }
        // Iniciar servicio de ubicación
        startLocationService();
    }

    private void startLocationService() {
        Intent intent = new Intent(this, LocationService.class);
        if (Build.VERSION.SDK_INT >= 26) {
            startForegroundService(intent);
        } else {
            startService(intent);
        }
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            moveTaskToBack(true);
        }
    }
}
