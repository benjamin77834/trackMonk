// Service Worker - TrackMonk
// Estrategia de tracking:
// 1. Push llega → intenta obtener ubicación desde cliente abierto (focus para despertar)
// 2. Si no hay cliente → notificación interactiva (openWindow no funciona sin interacción)

var API_BASE = 'https://api-tracker.monkeyfon.com';

self.addEventListener('install', function(event) {
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(clients.claim());
});

// Periodic Background Sync — envía ubicación aunque la app esté cerrada
self.addEventListener('periodicsync', function(event) {
  if (event.tag === 'send-location') {
    event.waitUntil(sendLocationFromSW());
  }
});

function sendLocationFromSW() {
  return getDeviceIdFromCache().then(function(deviceId) {
    if (!deviceId) return;
    return clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(allClients) {
      if (allClients.length > 0) {
        allClients[0].postMessage({ type: 'send-location-silent' });
        return;
      }
    });
  });
}

self.addEventListener('fetch', function(event) {
  // Network first, cache fallback - solo para recursos estáticos
  if (event.request.method !== 'GET') return;
  if (event.request.url.indexOf('/api/') !== -1) return;

  event.respondWith(
    fetch(event.request).then(function(response) {
      if (response && response.status === 200 && response.type === 'basic') {
        var clone = response.clone();
        caches.open('trackmonk-v1').then(function(cache) {
          cache.put(event.request, clone);
        });
      }
      return response;
    }).catch(function() {
      return caches.match(event.request);
    })
  );
});

self.addEventListener('push', function(event) {
  if (!event.data) return;
  var data = event.data.json();

  if (data.type === 'track-location') {
    event.waitUntil(handleTrackLocation(data.requestId));
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
  return getDeviceIdFromCache().then(function(deviceId) {
    return clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(allClients) {
      if (allClients.length > 0 && deviceId) {
        // Hay cliente en background → despertarlo con focus y pedirle ubicación
        var client = allClients[0];

        // Enviar mensaje a TODOS los clientes (por si uno responde)
        allClients.forEach(function(c) {
          c.postMessage({
            type: 'get-location',
            requestId: requestId,
            deviceId: deviceId,
          });
        });

        // Intentar hacer focus para despertar el tab
        if (client.focus) {
          return client.focus().then(function() {
            return self.registration.showNotification('📍 Enviando ubicación...', {
              body: 'GPS automático activado',
              icon: '/icon-192.png',
              tag: 'location-request-' + requestId,
              data: { type: 'track-location', requestId: requestId, autoSent: true },
              silent: true,
            });
          }).catch(function() {
            // Focus falló, mostrar notificación normal
            return showFallbackNotification(requestId, deviceId);
          });
        }

        // Si no puede hacer focus, notificación silenciosa (el mensaje ya se envió)
        return self.registration.showNotification('📍 Enviando ubicación...', {
          body: 'GPS automático activado',
          icon: '/icon-192.png',
          tag: 'location-request-' + requestId,
          data: { type: 'track-location', requestId: requestId, autoSent: true },
          silent: true,
        });
      }

      // No hay cliente abierto → notificación para que toque
      return showFallbackNotification(requestId, deviceId);
    });
  });
}

function showFallbackNotification(requestId, deviceId) {
  return self.registration.showNotification('📍 Toca para enviar ubicación', {
    body: 'Tu empresa solicita tu ubicación.',
    icon: '/icon-192.png',
    tag: 'location-request-' + requestId,
    requireInteraction: true,
    data: { type: 'track-location', requestId: requestId, deviceId: deviceId },
    actions: [{ action: 'send', title: '📍 Enviar' }],
  });
}

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  var notifData = event.notification.data || {};

  if (notifData.type === 'track-location') {
    if (notifData.autoSent) return;

    event.waitUntil(
      getDeviceIdFromCache().then(function(deviceId) {
        deviceId = deviceId || notifData.deviceId;
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

function getDeviceIdFromCache() {
  return caches.open('app-data').then(function(cache) {
    return cache.match('/device-id').then(function(response) {
      if (response) return response.json().then(function(data) { return data.deviceId; });
      return null;
    });
  }).catch(function() { return null; });
}
