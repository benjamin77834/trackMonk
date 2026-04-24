let deviceId = localStorage.getItem('deviceId');
let pushSubscription = null;
let hasPush = ('PushManager' in window);
let isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
let deferredPrompt = null; // Para el prompt nativo de instalación en Android/Chrome

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isAndroid() {
  return /Android/.test(navigator.userAgent);
}

function getPlatform() {
  if (isIOS()) return 'ios';
  if (isAndroid()) return 'android';
  return 'desktop';
}

// Capturar el evento beforeinstallprompt (Chrome/Edge/Android)
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  // Si estamos en la pantalla de instalación, mostrar el botón nativo
  const nativeBtn = document.getElementById('install-native-btn');
  if (nativeBtn) nativeBtn.style.display = 'block';
});

// ============ INIT ============

async function init() {
  updateStatus('Inicializando...');

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
    // Mostrar banner de instalación si no está instalada como PWA
    if (!isStandalone) showInstallBanner();
  } else {
    // Si es iOS sin PWA y sin push, mostrar instrucciones completas primero
    if (isIOS() && !isStandalone && !hasPush) {
      showInstallPrompt();
      return;
    }
    showRegistration();
    updateStatus('Registra tu dispositivo para comenzar');
    // Mostrar banner de instalación
    if (!isStandalone) showInstallBanner();
  }
}

function showInstallBanner() {
  const banner = document.getElementById('install-banner');
  if (banner) banner.style.display = 'block';
}

async function nativeInstall() {
  const prompt = deferredPrompt || window._deferredPrompt;
  if (!prompt) return;
  prompt.prompt();
  const result = await prompt.userChoice;
  deferredPrompt = null;
  window._deferredPrompt = null;
  if (result.outcome === 'accepted') {
    updateStatus('App instalada ✓', 'success');
    document.getElementById('install-banner').style.display = 'none';
  }
}

function showInstallPrompt() {
  // Solo bloquear en iOS sin PWA (donde push no funciona sin instalar)
  if (isIOS()) {
    document.getElementById('install-section').style.display = 'block';
    document.getElementById('registration-section').style.display = 'none';
    document.getElementById('registered-section').style.display = 'none';
    document.getElementById('install-ios').style.display = 'block';
    updateStatus('Instala la app para recibir notificaciones', 'warning');
  } else {
    // Android/Desktop: ir directo al registro, push funciona sin instalar
    showRegistration();
    updateStatus('Registra tu dispositivo para comenzar');
  }
}

function showRegistration() {
  document.getElementById('install-section').style.display = 'none';
  document.getElementById('registration-section').style.display = 'block';
  document.getElementById('registered-section').style.display = 'none';
  // Mostrar tip de Firefox en Android
  var tip = document.getElementById('android-firefox-tip');
  if (tip && isAndroid()) tip.style.display = 'block';
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

  // Verificar si tiene push activo
  let hasPushActive = false;
  if (hasPush && 'serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      hasPushActive = !!sub;
    } catch (e) { /* ignore */ }
  }

  const pushBtn = document.getElementById('activate-push-btn');
  if (pushBtn) {
    pushBtn.style.display = hasPushActive ? 'none' : 'block';
  }

  updateStatus(hasPushActive ? 'Dispositivo activo con push ✓' : 'Dispositivo activo (sin push)', hasPushActive ? 'success' : 'warning');

  // Cargar viaje activo
  loadMyTrip();
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

// ============ ACTIVAR PUSH ============

async function activatePush() {
  updateStatus('Activando notificaciones...');
  try {
    if (!('serviceWorker' in navigator) || !hasPush) {
      updateStatus('Tu navegador no soporta push. Instala la app como PWA.', 'error');
      return;
    }

    const vapidRes = await fetch(`${API_BASE}/api/vapid-public-key`);
    const { publicKey } = await vapidRes.json();

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      updateStatus('Necesitas permitir notificaciones', 'error');
      return;
    }

    const registration = await navigator.serviceWorker.ready;
    pushSubscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });

    // Actualizar la suscripción en el dispositivo existente
    const sub = pushSubscription.toJSON();
    await fetch(`${API_BASE}/api/devices/${deviceId}/push`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: sub }),
    });

    updateStatus('Push activado ✓', 'success');
    const pushBtn = document.getElementById('activate-push-btn');
    if (pushBtn) pushBtn.style.display = 'none';
  } catch (err) {
    updateStatus('Error activando push: ' + err.message, 'error');
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

// ============ MI VIAJE ACTIVO ============

async function loadMyTrip() {
  if (!deviceId) return;
  const container = document.getElementById('my-trip');
  try {
    const res = await fetch(`${API_BASE}/api/my-trips/${deviceId}`);
    const trips = await res.json();

    if (trips.length === 0) {
      container.style.display = 'none';
      return;
    }

    container.style.display = 'block';
    const t = trips[0]; // viaje activo más reciente

    // Cargar costos
    const costsRes = await fetch(`${API_BASE}/api/my-trips/${t.id}/costs`);
    const costs = await costsRes.json();
    const totalCost = costs.reduce((sum, c) => sum + parseFloat(c.amount), 0);

    let costsHtml = '';
    if (costs.length > 0) {
      costsHtml = '<div style="margin-top:0.5rem;">';
      costs.forEach(c => {
        costsHtml += `<div style="display:flex;justify-content:space-between;padding:0.3rem 0;border-bottom:1px solid #1a1a4e;font-size:0.8rem;">
          <span>${escapeHtml(c.concept)}</span><span>$${parseFloat(c.amount).toFixed(2)}</span>
        </div>`;
      });
      costsHtml += '</div>';
    }

    container.innerHTML = `
      <div style="background:#16213e;border:1px solid #1a1a4e;border-radius:12px;padding:1rem;">
        <h3 style="color:#fff;font-size:1rem;margin-bottom:0.5rem;">🚛 Viaje activo</h3>
        <div style="display:flex;align-items:center;gap:0.5rem;margin:0.5rem 0;">
          <span style="width:10px;height:10px;border-radius:50%;background:#22c55e;"></span>
          <span style="font-size:0.85rem;">${escapeHtml(t.origin)}</span>
          <span style="flex:1;height:2px;background:#252550;"></span>
          <span style="font-size:0.85rem;">${escapeHtml(t.destination)}</span>
          <span style="width:10px;height:10px;border-radius:50%;background:#e94560;"></span>
        </div>
        ${t.cargo ? `<div style="font-size:0.8rem;color:#888;">📦 ${escapeHtml(t.cargo)}</div>` : ''}
        <div style="text-align:center;margin:0.75rem 0;padding:0.75rem;background:#0f0f23;border-radius:8px;">
          <div style="font-size:0.75rem;color:#888;">Gastos totales</div>
          <div style="font-size:1.3rem;font-weight:700;color:#fff;">$${totalCost.toLocaleString('es-MX', {minimumFractionDigits:2})}</div>
        </div>
        ${costsHtml}
        <div style="margin-top:0.75rem;padding-top:0.75rem;border-top:1px solid #1a1a4e;">
          <div style="font-size:0.85rem;color:#fff;margin-bottom:0.5rem;">Agregar gasto</div>
          <div style="display:flex;gap:0.5rem;">
            <select id="cost-type" style="flex:1;padding:0.5rem;border:1px solid #2a2a5e;border-radius:8px;background:#0f0f23;color:#fff;font-size:0.85rem;">
              <option value="Gasolina">⛽ Gasolina</option>
              <option value="Caseta">🛣️ Caseta</option>
              <option value="Comida">🍔 Comida</option>
              <option value="Hospedaje">🏨 Hospedaje</option>
              <option value="Mantenimiento">🔧 Mantenimiento</option>
              <option value="Otro">📝 Otro</option>
            </select>
            <input id="cost-amount-user" type="number" step="0.01" placeholder="$0.00" style="width:100px;padding:0.5rem;border:1px solid #2a2a5e;border-radius:8px;background:#0f0f23;color:#fff;font-size:0.85rem;">
          </div>
          <input id="cost-note-user" type="text" placeholder="Nota (opcional)" style="width:100%;margin-top:0.5rem;padding:0.5rem;border:1px solid #2a2a5e;border-radius:8px;background:#0f0f23;color:#fff;font-size:0.85rem;">
          <button onclick="addMyTripCost(${t.id})" style="width:100%;margin-top:0.5rem;padding:0.6rem;background:#e94560;color:#fff;border:none;border-radius:8px;font-weight:600;cursor:pointer;">Agregar gasto</button>
        </div>
      </div>
    `;
  } catch (err) {
    container.style.display = 'none';
  }
}

async function addMyTripCost(tripId) {
  const type = document.getElementById('cost-type').value;
  const amount = parseFloat(document.getElementById('cost-amount-user').value);
  const note = document.getElementById('cost-note-user').value.trim();

  if (isNaN(amount) || amount <= 0) {
    updateStatus('Ingresa un monto válido', 'error');
    return;
  }

  const concept = note ? `${type} - ${note}` : type;

  try {
    const res = await fetch(`${API_BASE}/api/my-trips/${tripId}/costs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ concept, amount }),
    });
    const data = await res.json();
    if (data.success) {
      updateStatus('Gasto agregado ✓', 'success');
      document.getElementById('cost-amount-user').value = '';
      document.getElementById('cost-note-user').value = '';
      loadMyTrip(); // recargar
    } else {
      updateStatus('Error agregando gasto', 'error');
    }
  } catch (err) {
    updateStatus('Error: ' + err.message, 'error');
  }
}

// ============ MI HISTORIAL ============

async function viewMyHistory() {
  const container = document.getElementById('my-history');

  if (container.style.display === 'block') {
    container.style.display = 'none';
    return;
  }

  container.style.display = 'block';
  container.innerHTML = '<p style="color:#888; text-align:center;">Cargando...</p>';

  try {
    const res = await fetch(`${API_BASE}/api/my-locations/${deviceId}?limit=50`);
    const locations = await res.json();

    if (locations.length === 0) {
      container.innerHTML = '<p style="color:#888; text-align:center;">Sin historial aún</p>';
      return;
    }

    let html = '<h3 style="margin-bottom:0.5rem;">📋 Mi historial</h3>';
    html += '<div class="history-list">';

    locations.forEach((loc, i) => {
      const date = new Date(loc.recorded_at);
      const isLatest = i === 0;
      html += `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:0.5rem 0; border-bottom:1px solid #1a1a4e; font-size:0.8rem; flex-wrap:wrap; gap:0.3rem; ${isLatest ? 'background:#1a3e1a; padding:0.5rem; border-radius:6px; margin-bottom:0.25rem;' : ''}">
          <div>
            <span style="color:${isLatest ? '#66cc66' : '#ccc'};">${isLatest ? '🔴 ÚLTIMA' : '📌'}</span>
            <span>${date.toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
            <span style="color:#888;">${date.toLocaleTimeString('es-MX')}</span>
          </div>
          <a href="https://www.google.com/maps?q=${loc.latitude},${loc.longitude}" target="_blank" style="text-decoration:none;">🗺️ Ver</a>
        </div>
      `;
    });

    html += '</div>';
    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = '<p style="color:#cc6666; text-align:center;">Error cargando historial</p>';
  }
}

// ============ HELPERS ============

function resetDevice() {
  if (confirm('¿Seguro que quieres re-registrar este dispositivo?')) {
    localStorage.clear();
    deviceId = null;
    caches.delete('app-data').catch(() => {});
    showRegistration();
    updateStatus('Registra tu dispositivo de nuevo');
  }
}

function updateStatus(message, type = 'info') {
  const el = document.getElementById('status');
  el.textContent = message;
  el.className = 'status status-' + type;
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
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
