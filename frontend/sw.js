// Service Worker - maneja push notifications y obtiene ubicación
// Importa la config con la URL del API
importScripts('/config.js');

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('push', (event) => {
  if (!event.data) return;

  const data = event.data.json();

  if (data.type === 'track-location') {
    event.waitUntil(
      self.registration.showNotification(data.title || 'Ubicación solicitada', {
        body: data.body || 'Obteniendo tu ubicación...',
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-72.png',
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
        badge: '/icons/icon-72.png',
        tag: 'custom-message',
      })
    );
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      return clients.openWindow('/');
    })
  );
});

async function getAndSendLocation(requestId) {
  try {
    const deviceId = await getDeviceId();
    if (!deviceId) {
      console.error('No se encontró deviceId');
      return;
    }

    const allClients = await clients.matchAll({ type: 'window' });

    if (allClients.length > 0) {
      allClients[0].postMessage({
        type: 'get-location',
        requestId,
        deviceId,
      });
    } else {
      await clients.openWindow(
        '/location-reporter.html?requestId=' + requestId + '&deviceId=' + deviceId
      );
    }
  } catch (err) {
    console.error('Error obteniendo ubicación:', err);
  }
}

async function getDeviceId() {
  const allClients = await clients.matchAll({ type: 'window' });
  for (const client of allClients) {
    return new Promise((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = (event) => resolve(event.data.deviceId);
      client.postMessage({ type: 'get-device-id' }, [channel.port2]);
      setTimeout(() => resolve(null), 3000);
    });
  }

  try {
    const cache = await caches.open('app-data');
    const response = await cache.match('/device-id');
    if (response) {
      const data = await response.json();
      return data.deviceId;
    }
  } catch (e) {
    // ignore
  }

  return null;
}
