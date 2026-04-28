// Service Worker - TrackMonk

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
    // Mostrar notificación y intentar obtener ubicación
    event.waitUntil(
      self.registration.showNotification(data.title || 'Ubicación solicitada', {
        body: data.body || 'Toca para enviar tu ubicación',
        icon: '/icon-192.png',
        tag: 'location-request-' + data.requestId,
        requireInteraction: true,
        data: { type: 'track-location', requestId: data.requestId },
      }).then(function() {
        // Intentar enviar ubicación si hay un cliente abierto
        return tryGetLocation(data.requestId);
      })
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

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  var notifData = event.notification.data || {};

  if (notifData.type === 'track-location' && notifData.requestId) {
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

function tryGetLocation(requestId) {
  return clients.matchAll({ type: 'window' }).then(function(allClients) {
    if (allClients.length > 0) {
      // Hay un cliente abierto, pedirle la ubicación
      return getDeviceId().then(function(deviceId) {
        if (!deviceId) return;
        allClients[0].postMessage({
          type: 'get-location',
          requestId: requestId,
          deviceId: deviceId,
        });
      });
    }
    // No hay clientes abiertos - la ubicación se enviará cuando toquen la notificación
    return Promise.resolve();
  });
}

function getDeviceId() {
  return clients.matchAll({ type: 'window' }).then(function(allClients) {
    // Primero intentar desde un cliente activo
    if (allClients.length > 0) {
      return new Promise(function(resolve) {
        var channel = new MessageChannel();
        channel.port1.onmessage = function(event) { resolve(event.data.deviceId); };
        allClients[0].postMessage({ type: 'get-device-id' }, [channel.port2]);
        setTimeout(function() { resolve(null); }, 3000);
      }).then(function(id) {
        if (id) return id;
        // Fallback al cache
        return getDeviceIdFromCache();
      });
    }
    // Sin clientes, usar cache
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
