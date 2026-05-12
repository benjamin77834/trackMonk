// Service Worker - TrackMonk

var API_BASE = 'https://api-tracker.monkeyfon.com';

self.addEventListener('install', function(event) {
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(clients.claim());
});

// Periodic Background Sync
self.addEventListener('periodicsync', function(event) {
  if (event.tag === 'send-location') {
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(allClients) {
        if (allClients.length > 0) {
          allClients[0].postMessage({ type: 'send-location-silent' });
        }
      })
    );
  }
});

self.addEventListener('fetch', function(event) {
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
    event.waitUntil(
      // Mostrar notificación Y pedir ubicación al mismo tiempo
      Promise.all([
        self.registration.showNotification('📍 Enviando ubicación...', {
          body: 'Obteniendo GPS...',
          icon: '/icons/icon-192.png',
          tag: 'location-request-' + data.requestId,
          silent: true,
          data: { type: 'track-location', requestId: data.requestId },
        }),
        tryGetLocation(data.requestId)
      ])
    );
  }

  if (data.type === 'custom-message') {
    event.waitUntil(
      self.registration.showNotification(data.title || 'TrackMonk', {
        body: data.body || '',
        icon: '/icons/icon-192.png',
        tag: 'custom-message',
      })
    );
  }
});

function tryGetLocation(requestId) {
  return clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(allClients) {
    if (allClients.length > 0) {
      return getDeviceIdFromCache().then(function(deviceId) {
        if (!deviceId) return;
        // Enviar a todos los clientes
        allClients.forEach(function(client) {
          client.postMessage({
            type: 'get-location',
            requestId: requestId,
            deviceId: deviceId,
          });
        });
      });
    }
    // No hay clientes — intentar abrir location-reporter automáticamente
    return getDeviceIdFromCache().then(function(deviceId) {
      if (!deviceId) return;
      return clients.openWindow('/location-reporter.html?requestId=' + requestId + '&deviceId=' + deviceId + '&auto=1').catch(function() {
        // Si falla, la notificación ya está visible para que toquen
      });
    });
  });
}

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  var notifData = event.notification.data || {};

  if (notifData.type === 'track-location' && notifData.requestId) {
    event.waitUntil(
      getDeviceIdFromCache().then(function(deviceId) {
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
