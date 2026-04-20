// Service Worker - TrackMonk
var API_URL = '';

self.addEventListener('install', function(event) {
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', function(event) {
  // Pass through all requests - required for PWA installability
});

self.addEventListener('push', function(event) {
  if (!event.data) return;

  var data = event.data.json();

  if (data.type === 'track-location') {
    event.waitUntil(
      self.registration.showNotification(data.title || 'Ubicación solicitada', {
        body: data.body || 'Obteniendo tu ubicación...',
        icon: '/icons/icon-192.png',
        tag: 'location-request',
        data: { requestId: data.requestId },
      })
    );
    event.waitUntil(getAndSendLocation(data.requestId));
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

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(function(clientList) {
      for (var i = 0; i < clientList.length; i++) {
        if ('focus' in clientList[i]) return clientList[i].focus();
      }
      return clients.openWindow('/');
    })
  );
});

function getApiBase() {
  return 'https://api-tracker.monkeyfon.com';
}

function getAndSendLocation(requestId) {
  return getDeviceId().then(function(deviceId) {
    if (!deviceId) return;

    return clients.matchAll({ type: 'window' }).then(function(allClients) {
      if (allClients.length > 0) {
        allClients[0].postMessage({
          type: 'get-location',
          requestId: requestId,
          deviceId: deviceId,
        });
      } else {
        return clients.openWindow(
          '/location-reporter.html?requestId=' + requestId + '&deviceId=' + deviceId
        );
      }
    });
  });
}

function getDeviceId() {
  return clients.matchAll({ type: 'window' }).then(function(allClients) {
    if (allClients.length > 0) {
      return new Promise(function(resolve) {
        var channel = new MessageChannel();
        channel.port1.onmessage = function(event) { resolve(event.data.deviceId); };
        allClients[0].postMessage({ type: 'get-device-id' }, [channel.port2]);
        setTimeout(function() { resolve(null); }, 3000);
      });
    }

    return caches.open('app-data').then(function(cache) {
      return cache.match('/device-id').then(function(response) {
        if (response) return response.json().then(function(data) { return data.deviceId; });
        return null;
      });
    }).catch(function() { return null; });
  });
}
