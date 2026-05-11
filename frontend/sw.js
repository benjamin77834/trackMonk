// Service Worker - TrackMonk
// Estrategia de tracking:
// 1. Push llega → intenta obtener ubicación desde cliente abierto
// 2. Si no hay cliente → abre location-reporter automáticamente (sin toque)
// 3. Notificación como fallback visual si lo anterior falla

var API_BASE = 'https://api-tracker.monkeyfon.com';

self.addEventListener('install', function(event) {
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', function(event) {
  // Pass through
});

self.addEventListener('push', function(event) {
  if (!event.data) return;
  var data = event.data.json();

  if (data.type === 'track-location') {
    event.waitUntil(
      handleTrackLocation(data.requestId)
    );
  }

  if (data.type === 'custom-message') {
    event.waitUntil(
      self.registration.showNotification(data.title || 'TrackMonk', {
        body: data.body || '',
        icon: '/icon-192.png',
        tag: 'custom-message',
      })
    );
  }
});

function handleTrackLocation(requestId) {
  return getDeviceId().then(function(deviceId) {
    // Paso 1: Intentar desde un cliente abierto
    return clients.matchAll({ type: 'window' }).then(function(allClients) {
      if (allClients.length > 0 && deviceId) {
        // Hay cliente abierto → pedirle ubicación directamente
        allClients[0].postMessage({
          type: 'get-location',
          requestId: requestId,
          deviceId: deviceId,
        });
        // Mostrar notificación silenciosa (se cierra sola si responde)
        return self.registration.showNotification('📍 Enviando ubicación...', {
          body: 'Obteniendo GPS automáticamente...',
          icon: '/icon-192.png',
          tag: 'location-request-' + requestId,
          data: { type: 'track-location', requestId: requestId, autoSent: true },
          silent: true,
        });
      }

      // Paso 2: No hay cliente abierto → abrir location-reporter automáticamente
      if (deviceId) {
        return clients.openWindow('/location-reporter.html?requestId=' + requestId + '&deviceId=' + deviceId + '&auto=1')
          .then(function() {
            // Notificación informativa (el reporter ya está enviando)
            return self.registration.showNotification('📍 Enviando ubicación...', {
              body: 'Se abrió el GPS automáticamente.',
              icon: '/icon-192.png',
              tag: 'location-request-' + requestId,
              data: { type: 'track-location', requestId: requestId, autoSent: true },
              silent: true,
            });
          })
          .catch(function() {
            // Si openWindow falla (restricción del navegador), mostrar notificación interactiva
            return showFallbackNotification(requestId);
          });
      }

      // Paso 3: No tenemos deviceId → notificación para que toque
      return showFallbackNotification(requestId);
    });
  });
}

function showFallbackNotification(requestId) {
  return self.registration.showNotification('📍 Toca aquí para enviar tu ubicación', {
    body: 'Tu empresa solicita tu ubicación. Toca esta notificación.',
    icon: '/icon-192.png',
    tag: 'location-request-' + requestId,
    requireInteraction: true,
    data: { type: 'track-location', requestId: requestId },
    actions: [{ action: 'send', title: '📍 Enviar ubicación' }],
  });
}

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  var notifData = event.notification.data || {};

  if (notifData.type === 'track-location' && notifData.requestId) {
    // Si ya se envió automáticamente, solo cerrar
    if (notifData.autoSent) return;

    // Abrir location-reporter para enviar ubicación
    event.waitUntil(
      getDeviceId().then(function(deviceId) {
        if (deviceId) {
          return clients.openWindow('/location-reporter.html?requestId=' + notifData.requestId + '&deviceId=' + deviceId);
        }
        return clients.openWindow('/');
      })
    );
  } else {
    event.waitUntil(
      clients.matchAll({ type: 'window' }).then(function(clientList) {
        for (var i = 0; i < clientList.length; i++) {
          if ('focus' in clientList[i]) return clientList[i].focus();
        }
        return clients.openWindow('/');
      })
    );
  }
});

function getDeviceId() {
  return clients.matchAll({ type: 'window' }).then(function(allClients) {
    if (allClients.length > 0) {
      return new Promise(function(resolve) {
        var channel = new MessageChannel();
        channel.port1.onmessage = function(event) { resolve(event.data.deviceId); };
        allClients[0].postMessage({ type: 'get-device-id' }, [channel.port2]);
        setTimeout(function() { resolve(null); }, 3000);
      }).then(function(id) {
        if (id) return id;
        return getDeviceIdFromCache();
      });
    }
    return getDeviceIdFromCache();
  });
}

function getDeviceIdFromCache() {
  return caches.open('app-data').then(function(cache) {
    return cache.match('/device-id').then(function(response) {
      if (response) return response.json().then(function(data) { return data.deviceId; });
      return null;
    });
  }).catch(function() { return null; });
}
