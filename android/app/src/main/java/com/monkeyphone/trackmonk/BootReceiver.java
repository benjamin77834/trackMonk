package com.monkeyphone.trackmonk;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) {
            // Reiniciar servicio de ubicación al encender el teléfono
            SharedPreferences prefs = context.getSharedPreferences("trackmonk", Context.MODE_PRIVATE);
            String deviceId = prefs.getString("deviceId", "");
            if (!deviceId.isEmpty()) {
                Intent serviceIntent = new Intent(context, LocationService.class);
                if (Build.VERSION.SDK_INT >= 26) {
                    context.startForegroundService(serviceIntent);
                } else {
                    context.startService(serviceIntent);
                }
            }
        }
    }
}
