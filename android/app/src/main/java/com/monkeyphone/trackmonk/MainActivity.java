package com.monkeyphone.trackmonk;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Log;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import java.io.File;
import java.io.IOException;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

public class MainActivity extends AppCompatActivity {
    private WebView webView;
    private static final int PERMISSION_REQUEST = 100;
    private static final int FILE_CHOOSER_REQUEST = 200;
    private ValueCallback<Uri[]> fileUploadCallback;
    private Uri cameraPhotoUri;

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
                // Inyectar código para capturar el deviceId
                injectBridge(view);
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                callback.invoke(origin, true, false);
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileUploadCallback != null) {
                    fileUploadCallback.onReceiveValue(null);
                }
                fileUploadCallback = callback;

                // Abrir cámara directamente
                Intent cameraIntent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                try {
                    File photoFile = createImageFile();
                    cameraPhotoUri = FileProvider.getUriForFile(MainActivity.this, getPackageName() + ".fileprovider", photoFile);
                    cameraIntent.putExtra(MediaStore.EXTRA_OUTPUT, cameraPhotoUri);
                } catch (IOException e) {
                    Log.e("TrackMonk", "Error creating image file", e);
                }

                // También opción de galería
                Intent galleryIntent = new Intent(Intent.ACTION_GET_CONTENT);
                galleryIntent.setType("image/*");

                Intent chooser = Intent.createChooser(galleryIntent, "Seleccionar imagen");
                chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[]{cameraIntent});
                startActivityForResult(chooser, FILE_CHOOSER_REQUEST);
                return true;
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
            Log.d("TrackMonk", "DeviceId saved: " + deviceId);
            // Iniciar servicio si no está corriendo
            startLocationService();
        }
    }

    private void injectBridge(WebView view) {
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
            "  // Reintentar cada 3 segundos por si el login es async" +
            "  if (!window._trackMonkInterval) {" +
            "    window._trackMonkInterval = setInterval(function() {" +
            "      var id = localStorage.getItem('deviceId');" +
            "      if (id && window.TrackMonkBridge) {" +
            "        window.TrackMonkBridge.saveDeviceId(id);" +
            "      }" +
            "    }, 3000);" +
            "  }" +
            "})();", null);
    }

    private void requestPermissions() {
        String[] perms;
        if (Build.VERSION.SDK_INT >= 34) {
            perms = new String[]{
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION,
                Manifest.permission.POST_NOTIFICATIONS,
                Manifest.permission.FOREGROUND_SERVICE_LOCATION,
                Manifest.permission.CAMERA
            };
        } else if (Build.VERSION.SDK_INT >= 33) {
            perms = new String[]{
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION,
                Manifest.permission.POST_NOTIFICATIONS,
                Manifest.permission.CAMERA
            };
        } else {
            perms = new String[]{
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION,
                Manifest.permission.CAMERA
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

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_CHOOSER_REQUEST) {
            if (fileUploadCallback == null) return;
            Uri[] results = null;
            if (resultCode == Activity.RESULT_OK) {
                if (data != null && data.getData() != null) {
                    results = new Uri[]{data.getData()};
                } else if (cameraPhotoUri != null) {
                    results = new Uri[]{cameraPhotoUri};
                }
            }
            fileUploadCallback.onReceiveValue(results);
            fileUploadCallback = null;
        }
    }

    private File createImageFile() throws IOException {
        String timeStamp = new SimpleDateFormat("yyyyMMdd_HHmmss", Locale.getDefault()).format(new Date());
        String fileName = "TRACKMONK_" + timeStamp;
        File storageDir = getExternalFilesDir(Environment.DIRECTORY_PICTURES);
        return File.createTempFile(fileName, ".jpg", storageDir);
    }
}
