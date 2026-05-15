package com.monkeyphone.trackmonk;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.location.Location;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;
import androidx.core.app.NotificationCompat;
import com.google.android.gms.location.*;
import org.json.JSONObject;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

public class LocationService extends Service {
    private static final String TAG = "TrackMonkLocation";
    private static final String CHANNEL_ID = "trackmonk_location";
    private static final int NOTIFICATION_ID = 1;
    private static final long INTERVAL_MS = 5 * 60 * 1000; // 5 minutos
    private static final String API_BASE = "https://api-tracker.monkeyfon.com";

    private FusedLocationProviderClient fusedClient;
    private LocationCallback locationCallback;
    private Handler handler;
    private Runnable sendRunnable;
    private Location lastLocation;

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        fusedClient = LocationServices.getFusedLocationProviderClient(this);
        handler = new Handler(Looper.getMainLooper());
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        startForeground(NOTIFICATION_ID, buildNotification("Tracking activo"));
        startLocationUpdates();
        startPeriodicSend();
        return START_STICKY;
    }

    private void startLocationUpdates() {
        LocationRequest request = new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 60000)
            .setMinUpdateIntervalMillis(30000)
            .setMinUpdateDistanceMeters(10)
            .build();

        locationCallback = new LocationCallback() {
            @Override
            public void onLocationResult(LocationResult result) {
                if (result != null && result.getLastLocation() != null) {
                    lastLocation = result.getLastLocation();
                }
            }
        };

        try {
            fusedClient.requestLocationUpdates(request, locationCallback, Looper.getMainLooper());
        } catch (SecurityException e) {
            Log.e(TAG, "No location permission", e);
        }
    }

    private void startPeriodicSend() {
        sendRunnable = new Runnable() {
            @Override
            public void run() {
                sendLocation();
                handler.postDelayed(this, INTERVAL_MS);
            }
        };
        // Enviar primera vez después de 10 segundos
        handler.postDelayed(sendRunnable, 10000);
    }

    private void sendLocation() {
        if (lastLocation == null) return;
        String deviceId = getSavedDeviceId();
        if (deviceId == null || deviceId.isEmpty()) return;

        new Thread(() -> {
            try {
                JSONObject json = new JSONObject();
                json.put("deviceId", deviceId);
                json.put("latitude", lastLocation.getLatitude());
                json.put("longitude", lastLocation.getLongitude());
                json.put("accuracy", lastLocation.getAccuracy());
                if (lastLocation.hasSpeed()) {
                    json.put("speed", lastLocation.getSpeed());
                }

                URL url = new URL(API_BASE + "/api/location");
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setDoOutput(true);
                conn.setConnectTimeout(10000);
                conn.setReadTimeout(10000);

                OutputStream os = conn.getOutputStream();
                os.write(json.toString().getBytes(StandardCharsets.UTF_8));
                os.close();

                int code = conn.getResponseCode();
                Log.d(TAG, "Location sent: " + code + " lat=" + lastLocation.getLatitude());
                conn.disconnect();

                // Actualizar notificación
                updateNotification("Última: " + new java.text.SimpleDateFormat("HH:mm", java.util.Locale.getDefault()).format(new java.util.Date()));
            } catch (Exception e) {
                Log.e(TAG, "Error sending location", e);
            }
        }).start();
    }

    private String getSavedDeviceId() {
        // Leer deviceId del WebView localStorage via SharedPreferences
        SharedPreferences prefs = getSharedPreferences("trackmonk", Context.MODE_PRIVATE);
        return prefs.getString("deviceId", "");
    }

    private Notification buildNotification(String text) {
        Intent intent = new Intent(this, MainActivity.class);
        PendingIntent pi = PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_IMMUTABLE);

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("🐵 TrackMonk")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentIntent(pi)
            .setOngoing(true)
            .setSilent(true)
            .build();
    }

    private void updateNotification(String text) {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        nm.notify(NOTIFICATION_ID, buildNotification(text));
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Tracking GPS", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Envío de ubicación en segundo plano");
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            nm.createNotificationChannel(channel);
        }
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        if (fusedClient != null && locationCallback != null) {
            fusedClient.removeLocationUpdates(locationCallback);
        }
        if (handler != null && sendRunnable != null) {
            handler.removeCallbacks(sendRunnable);
        }
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
