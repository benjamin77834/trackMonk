let deviceId = localStorage.getItem('deviceId');
let pushSubscription = null;
let hasPush = ('PushManager' in window);
let isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

// ============ INIT ============

async function init() {
  updateStatus('Inicializando...');

  if (isIOS() && !isStandalone && !hasPush && !deviceId) {
    showInstallPrompt();
    return;
  }

  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js');
      navigator.serviceWorker.addEventListener('message', handleSWMessage);
      if (hasPush) {
        pushSubscription = await registration.pushManager.getSubscription();
      }
    } catch (e) {
      console.warn('SW error:', e);
    }
  }

  if (deviceId) {
    showRegistered();
  } else {
    showRegistration();
    updateStatus('Registra tu dispositivo para comenzar');
  }
}

function showInstallPrompt() {
  document.getElementById('install-section').style.display = 'block';
  document.getElementById('registration-section').style.display = 'none';
  document.getElementById('registered-section').style.display = 'none';
  updateStatus('Instala la app para continuar', 'warning');
}

function showRegistration() {
  document.getElementById('install-section').style.display = 'none';
  document.getElementById('registration-section').style.display = 'block';
  document.getElementById('registered-section').style.display = 'none';
}

async function showRegistered() {
  document.getElementById('install-section').style.display = 'none';
  document.getElementById('registration-section').style.display = 'none';
  document.getElementById('registered-section').style.display = 'block';

  // Cargar datos del dispositivo
  try {
    const res = await fetch(`${API_BASE}/api/devices/${deviceId}`);
    const d = await res.json();
    if (d) {
      document.getElementById('registered-name').textContent =
        `${d.person_name || d.device_name} — ${d.phone || ''}`;
    }
  } catch (e) { /* ignore */ }

  updateStatus('Dispositivo activo y listo', 'success');
}

// ============ REGISTRO ============

async function registerDevice() {
  const deviceName = document.getElementById('reg-device-name').value.trim();
  const personName = document.getElementById('reg-person-name').value.trim();
  const phone = document.getElementById('reg-phone').value.trim();
  const company = document.getElementById('reg-company').value.trim();
  const vehicle = document.getElementById('reg-vehicle').value.trim();

  if (!deviceName) {
    updateStatus('Ingresa un nombre para el dispositivo', 'error');
    return;
  }

  updateStatus('Registrando...');

  try {
    // Pedir ubicación
    try {
      await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000 });
      });
    } catch (e) {
      updateStatus('Necesitas permitir acceso a ubicación', 'error');
      return;
    }

    let subscription = null;

    if (hasPush && 'serviceWorker' in navigator) {
      try {
        const vapidRes = await fetch(`${API_BASE}/api/vapid-public-key`);
        const { publicKey } = await vapidRes.json();

        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
          const registration = await navigator.serviceWorker.ready;
          pushSubscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(publicKey),
          });
          subscription = pushSubscription.toJSON();
        }
      } catch (e) {
        console.warn('Push no disponible:', e);
      }
    }

    const res = await fetch(`${API_BASE}/api/devices/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceName, subscription }),
    });
    const data = await res.json();

    if (data.success) {
      deviceId = String(data.deviceId);
      localStorage.setItem('deviceId', deviceId);
      await saveDeviceIdToCache(deviceId);

      // Guardar perfil
      if (personName || phone || company || vehicle) {
        await fetch(`${API_BASE}/api/devices/${deviceId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ device_name: deviceName, person_name: personName, phone, company, vehicle }),
        });
      }

      sendMyLocation();
      showRegistered();
    } else {
      updateStatus('Error: ' + (data.error || 'desconocido'), 'error');
    }
  } catch (err) {
    updateStatus('Error: ' + err.message, 'error');
  }
}

// ============ ENVIAR UBICACIÓN ============

async function sendMyLocation() {
  if (!deviceId) return;
  try {
    const position = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
    });
    await fetch(`${API_BASE}/api/location`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId, latitude: position.coords.latitude,
        longitude: position.coords.longitude, accuracy: position.coords.accuracy,
      }),
    });
    updateStatus('Ubicación enviada ✓', 'success');
    document.getElementById('last-sent').textContent = 'Última: ' + new Date().toLocaleString();
  } catch (err) {
    updateStatus('Error enviando ubicación: ' + err.message, 'error');
  }
}

// ============ SERVICE WORKER ============

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
      navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
    });
    await fetch(`${API_BASE}/api/location`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: devId || deviceId, requestId,
        latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy,
      }),
    });
  } catch (err) {
    console.error('Error enviando ubicación:', err);
  }
}

// ============ HELPERS ============

function updateStatus(message, type = 'info') {
  const el = document.getElementById('status');
  el.textContent = message;
  el.className = 'status status-' + type;
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

async function saveDeviceIdToCache(id) {
  try {
    const cache = await caches.open('app-data');
    await cache.put('/device-id', new Response(JSON.stringify({ deviceId: id })));
  } catch (e) { /* ignore */ }
}

document.addEventListener('DOMContentLoaded', init);
