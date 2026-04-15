let deviceId = localStorage.getItem('deviceId');
let pushSubscription = null;

// ============ INICIALIZACIÓN ============

async function init() {
  updateStatus('Inicializando...');

  if (!('serviceWorker' in navigator)) {
    updateStatus('Service Workers no soportado en este navegador', 'error');
    return;
  }

  if (!('PushManager' in window)) {
    updateStatus('Push Notifications no soportadas en este navegador', 'error');
    return;
  }

  try {
    const registration = await navigator.serviceWorker.register('/sw.js');
    console.log('Service Worker registrado');

    navigator.serviceWorker.addEventListener('message', handleSWMessage);

    pushSubscription = await registration.pushManager.getSubscription();

    if (pushSubscription && deviceId) {
      updateStatus('Dispositivo registrado y listo', 'success');
      showDashboard();
      loadDevices();
    } else {
      showRegistration();
      updateStatus('Registra tu dispositivo para comenzar');
    }
  } catch (err) {
    console.error('Error en init:', err);
    updateStatus('Error inicializando: ' + err.message, 'error');
  }
}

// ============ REGISTRO DE DISPOSITIVO ============

async function registerDevice() {
  const nameInput = document.getElementById('device-name');
  const deviceName = nameInput.value.trim();

  if (!deviceName) {
    updateStatus('Ingresa un nombre para el dispositivo', 'error');
    return;
  }

  updateStatus('Registrando dispositivo...');

  try {
    const vapidRes = await fetch(`${API_BASE}/api/vapid-public-key`);
    const { publicKey } = await vapidRes.json();

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      updateStatus('Necesitas permitir notificaciones para usar la app', 'error');
      return;
    }

    try {
      await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
        });
      });
    } catch (e) {
      updateStatus('Necesitas permitir acceso a ubicación', 'error');
      return;
    }

    const registration = await navigator.serviceWorker.ready;
    pushSubscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });

    const res = await fetch(`${API_BASE}/api/devices/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceName,
        subscription: pushSubscription.toJSON(),
      }),
    });

    const data = await res.json();

    if (data.success) {
      deviceId = String(data.deviceId);
      localStorage.setItem('deviceId', deviceId);
      await saveDeviceIdToCache(deviceId);

      updateStatus('Dispositivo registrado correctamente', 'success');
      showDashboard();
      loadDevices();
    } else {
      updateStatus('Error registrando: ' + (data.error || 'desconocido'), 'error');
    }
  } catch (err) {
    console.error('Error registrando:', err);
    updateStatus('Error: ' + err.message, 'error');
  }
}

// ============ DASHBOARD ============

async function loadDevices() {
  try {
    const res = await fetch(`${API_BASE}/api/devices`);
    const devices = await res.json();

    const list = document.getElementById('devices-list');
    list.innerHTML = '';

    devices.forEach((device) => {
      const card = document.createElement('div');
      card.className = 'device-card';
      const isMe = String(device.id) === deviceId;
      card.innerHTML = `
        <div class="device-info">
          <span class="device-name">${escapeHtml(device.device_name)} ${isMe ? '<span class="badge">TÚ</span>' : ''}</span>
          <span class="device-date">Registrado: ${new Date(device.created_at).toLocaleString()}</span>
        </div>
        <div class="device-actions">
          <button onclick="trackDevice(${device.id})" class="btn btn-track">📍 Trackear</button>
          <button onclick="viewHistory(${device.id})" class="btn btn-history">📋 Historial</button>
        </div>
      `;
      list.appendChild(card);
    });

    if (devices.length === 0) {
      list.innerHTML = '<p class="empty">No hay dispositivos registrados</p>';
    }
  } catch (err) {
    console.error('Error cargando dispositivos:', err);
  }
}

async function trackDevice(targetDeviceId) {
  updateStatus('Enviando solicitud de ubicación...');

  try {
    const res = await fetch(`${API_BASE}/api/track/${targetDeviceId}`, { method: 'POST' });
    const data = await res.json();

    if (data.success) {
      updateStatus('Push enviado. Esperando respuesta...', 'success');
      pollTrackingStatus(data.requestId, targetDeviceId);
    } else {
      updateStatus('Error: ' + (data.error || 'desconocido'), 'error');
    }
  } catch (err) {
    updateStatus('Error enviando push: ' + err.message, 'error');
  }
}

async function pollTrackingStatus(requestId, targetDeviceId) {
  let attempts = 0;
  const maxAttempts = 30;

  const interval = setInterval(async () => {
    attempts++;

    try {
      const res = await fetch(`${API_BASE}/api/track-status/${requestId}`);
      const data = await res.json();

      if (data && data.status === 'received' && data.latitude) {
        clearInterval(interval);
        updateStatus('Ubicación recibida', 'success');
        showLocationOnMap(data.latitude, data.longitude, data.accuracy);
      } else if (attempts >= maxAttempts) {
        clearInterval(interval);
        const locRes = await fetch(`${API_BASE}/api/locations/${targetDeviceId}/latest`);
        const locData = await locRes.json();
        if (locData && locData.latitude) {
          updateStatus('Timeout - mostrando última ubicación conocida', 'warning');
          showLocationOnMap(locData.latitude, locData.longitude, locData.accuracy);
        } else {
          updateStatus('No se recibió respuesta del dispositivo', 'error');
        }
      }
    } catch (err) {
      // seguir intentando
    }
  }, 1000);
}

function showLocationOnMap(lat, lng, accuracy) {
  const mapContainer = document.getElementById('map-container');
  mapContainer.style.display = 'block';
  mapContainer.innerHTML = `
    <div class="location-result">
      <h3>📍 Ubicación encontrada</h3>
      <p><strong>Latitud:</strong> ${lat}</p>
      <p><strong>Longitud:</strong> ${lng}</p>
      ${accuracy ? `<p><strong>Precisión:</strong> ${Math.round(accuracy)}m</p>` : ''}
      <p><strong>Hora:</strong> ${new Date().toLocaleString()}</p>
      <a href="https://www.google.com/maps?q=${lat},${lng}" target="_blank" class="btn btn-map">
        🗺️ Ver en Google Maps
      </a>
    </div>
  `;
}

async function viewHistory(targetDeviceId) {
  try {
    const res = await fetch(`${API_BASE}/api/locations/${targetDeviceId}?limit=20`);
    const locations = await res.json();

    const mapContainer = document.getElementById('map-container');
    mapContainer.style.display = 'block';

    if (locations.length === 0) {
      mapContainer.innerHTML = '<p class="empty">No hay historial de ubicaciones</p>';
      return;
    }

    let html = '<h3>📋 Historial de ubicaciones</h3><div class="history-list">';
    locations.forEach((loc) => {
      html += `
        <div class="history-item">
          <span>${new Date(loc.timestamp).toLocaleString()}</span>
          <span>${loc.latitude.toFixed(6)}, ${loc.longitude.toFixed(6)}</span>
          <a href="https://www.google.com/maps?q=${loc.latitude},${loc.longitude}" target="_blank">🗺️</a>
        </div>
      `;
    });
    html += '</div>';
    mapContainer.innerHTML = html;
  } catch (err) {
    console.error('Error cargando historial:', err);
  }
}

// ============ SERVICE WORKER MESSAGES ============

function handleSWMessage(event) {
  const data = event.data;

  if (data.type === 'get-device-id') {
    event.ports[0].postMessage({ deviceId });
  }

  if (data.type === 'get-location') {
    getLocationAndSend(data.requestId, data.deviceId);
  }
}

async function getLocationAndSend(requestId, devId) {
  try {
    const position = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      });
    });

    await fetch(`${API_BASE}/api/location`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: devId || deviceId,
        requestId,
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
      }),
    });

    console.log('Ubicación enviada al servidor');
  } catch (err) {
    console.error('Error obteniendo/enviando ubicación:', err);
  }
}

// ============ UI HELPERS ============

function showRegistration() {
  document.getElementById('registration-section').style.display = 'block';
  document.getElementById('dashboard-section').style.display = 'none';
}

function showDashboard() {
  document.getElementById('registration-section').style.display = 'none';
  document.getElementById('dashboard-section').style.display = 'block';
}

function updateStatus(message, type = 'info') {
  const el = document.getElementById('status');
  el.textContent = message;
  el.className = 'status status-' + type;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function saveDeviceIdToCache(id) {
  try {
    const cache = await caches.open('app-data');
    const response = new Response(JSON.stringify({ deviceId: id }));
    await cache.put('/device-id', response);
  } catch (e) {
    // ignore
  }
}

// ============ INIT ============
document.addEventListener('DOMContentLoaded', init);
