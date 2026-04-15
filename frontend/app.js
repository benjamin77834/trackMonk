let deviceId = localStorage.getItem('deviceId');
let pushSubscription = null;
let hasPush = ('PushManager' in window);
let isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
let leafletMap = null;
let mapMarkers = [];
let searchTimeout = null;

// ============ DETECCIÓN iOS ============

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

// ============ INICIALIZACIÓN ============

async function init() {
  updateStatus('Inicializando...');

  // iOS en Safari sin instalar como PWA: no tiene push
  if (isIOS() && !isStandalone && !hasPush) {
    if (deviceId) {
      // Ya registrado antes, mostrar dashboard sin push
      updateStatus('Abre desde pantalla de inicio para notificaciones push', 'warning');
      showDashboard();
      loadDevices();
      return;
    }
    showInstallPrompt();
    return;
  }

  if (!('serviceWorker' in navigator)) {
    // Sin SW pero podemos funcionar sin push
    if (deviceId) {
      updateStatus('Modo limitado - sin notificaciones push', 'warning');
      showDashboard();
      loadDevices();
    } else {
      showRegistration();
      updateStatus('Registra tu dispositivo para comenzar');
    }
    return;
  }

  try {
    const registration = await navigator.serviceWorker.register('/sw.js');
    navigator.serviceWorker.addEventListener('message', handleSWMessage);

    if (hasPush) {
      pushSubscription = await registration.pushManager.getSubscription();
    }

    if (deviceId) {
      updateStatus('Dispositivo registrado y listo', 'success');
      showDashboard();
      loadDevices();
    } else {
      showRegistration();
      updateStatus('Registra tu dispositivo para comenzar');
    }
  } catch (err) {
    console.error('Error en init:', err);
    if (deviceId) {
      showDashboard();
      loadDevices();
    } else {
      showRegistration();
    }
    updateStatus('Iniciado con funcionalidad limitada', 'warning');
  }
}

function showInstallPrompt() {
  document.getElementById('registration-section').style.display = 'none';
  document.getElementById('dashboard-section').style.display = 'none';
  document.getElementById('install-section').style.display = 'block';
  updateStatus('Instala la app para continuar', 'warning');
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

  updateStatus('Registrando dispositivo...');

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

    // Intentar push solo si está disponible
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
        console.warn('Push no disponible, continuando sin push:', e);
      }
    }

    // Registrar con o sin push
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

      // Enviar ubicación inicial
      sendMyLocation();

      updateStatus(subscription ? 'Registrado con notificaciones push' : 'Registrado (sin push - abre la app para enviar ubicación)', 'success');
      showDashboard();
      loadDevices();
    } else {
      updateStatus('Error: ' + (data.error || 'desconocido'), 'error');
    }
  } catch (err) {
    console.error('Error registrando:', err);
    updateStatus('Error: ' + err.message, 'error');
  }
}

// Enviar mi ubicación manualmente
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
    updateStatus('Ubicación enviada', 'success');
  } catch (err) {
    updateStatus('Error enviando ubicación: ' + err.message, 'error');
  }
}

// ============ TABS ============

function switchTab(tab) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelector(`.tab[onclick="switchTab('${tab}')"]`).classList.add('active');
  document.getElementById('tab-' + tab).classList.add('active');
  document.getElementById('detail-panel').style.display = 'none';

  if (tab === 'map') {
    setTimeout(() => {
      initMap();
      loadAllOnMap();
    }, 100);
  }
}

// ============ DISPOSITIVOS ============

async function loadDevices() {
  try {
    const res = await fetch(`${API_BASE}/api/devices`);
    const devices = await res.json();
    const list = document.getElementById('devices-list');
    list.innerHTML = '';

    devices.forEach((device) => {
      const isMe = String(device.id) === deviceId;
      const card = document.createElement('div');
      card.className = 'device-card';
      card.innerHTML = `
        <div class="device-info">
          <span class="device-name">
            ${escapeHtml(device.person_name || device.device_name)}
            ${isMe ? '<span class="badge">TÚ</span>' : ''}
          </span>
          ${device.phone ? `<span class="device-meta">📞 ${escapeHtml(device.phone)}</span>` : ''}
          ${device.company ? `<span class="device-meta">🏢 ${escapeHtml(device.company)}</span>` : ''}
          ${device.vehicle ? `<span class="device-meta">🚗 ${escapeHtml(device.vehicle)}</span>` : ''}
          <span class="device-date">${escapeHtml(device.device_name)}</span>
        </div>
        <div class="device-actions">
          <button onclick="trackDevice(${device.id})" class="btn btn-track">📍</button>
          <button onclick="viewOnMap(${device.id})" class="btn btn-history">�️</button>
          <button onclick="editDevice(${device.id})" class="btn btn-small">✏️</button>
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

async function editDevice(id) {
  try {
    const res = await fetch(`${API_BASE}/api/devices/${id}`);
    const d = await res.json();
    if (!d) return;

    const panel = document.getElementById('detail-panel');
    panel.style.display = 'block';
    panel.innerHTML = `
      <h3>✏️ Editar dispositivo</h3>
      <div class="form-group"><label>Dispositivo</label><input type="text" id="edit-device-name" value="${escapeHtml(d.device_name || '')}"></div>
      <div class="form-group"><label>Persona</label><input type="text" id="edit-person-name" value="${escapeHtml(d.person_name || '')}"></div>
      <div class="form-group"><label>Teléfono</label><input type="tel" id="edit-phone" value="${escapeHtml(d.phone || '')}"></div>
      <div class="form-group"><label>Empresa</label><input type="text" id="edit-company" value="${escapeHtml(d.company || '')}"></div>
      <div class="form-group"><label>Vehículo</label><input type="text" id="edit-vehicle" value="${escapeHtml(d.vehicle || '')}"></div>
      <button onclick="saveDevice(${id})" class="btn btn-primary">Guardar</button>
    `;
    panel.scrollIntoView({ behavior: 'smooth' });
  } catch (err) {
    console.error('Error:', err);
  }
}

async function saveDevice(id) {
  try {
    await fetch(`${API_BASE}/api/devices/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device_name: document.getElementById('edit-device-name').value,
        person_name: document.getElementById('edit-person-name').value,
        phone: document.getElementById('edit-phone').value,
        company: document.getElementById('edit-company').value,
        vehicle: document.getElementById('edit-vehicle').value,
      }),
    });
    document.getElementById('detail-panel').style.display = 'none';
    updateStatus('Dispositivo actualizado', 'success');
    loadDevices();
  } catch (err) {
    updateStatus('Error guardando: ' + err.message, 'error');
  }
}

// ============ TRACKING ============

async function trackAll() {
  updateStatus('Enviando push a todos los dispositivos...');
  try {
    const res = await fetch(`${API_BASE}/api/track-all`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      updateStatus(`Push enviado a ${data.sent} dispositivos (${data.failed} fallidos). Esperando respuestas...`, 'success');
      // Esperar unos segundos y cargar el mapa con las ubicaciones nuevas
      setTimeout(() => {
        switchTab('map');
        setTimeout(() => loadAllOnMap(), 500);
      }, 10000);
    } else {
      updateStatus('Error: ' + (data.error || 'desconocido'), 'error');
    }
  } catch (err) {
    updateStatus('Error: ' + err.message, 'error');
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
  const interval = setInterval(async () => {
    attempts++;
    try {
      const res = await fetch(`${API_BASE}/api/track-status/${requestId}`);
      const data = await res.json();
      if (data && data.status === 'received' && data.latitude) {
        clearInterval(interval);
        updateStatus('Ubicación recibida', 'success');
        showSingleOnMap(data.latitude, data.longitude, data.accuracy);
      } else if (attempts >= 30) {
        clearInterval(interval);
        const locRes = await fetch(`${API_BASE}/api/locations/${targetDeviceId}/latest`);
        const locData = await locRes.json();
        if (locData && locData.latitude) {
          updateStatus('Mostrando última ubicación conocida', 'warning');
          showSingleOnMap(locData.latitude, locData.longitude, locData.accuracy);
        } else {
          updateStatus('No se recibió respuesta', 'error');
        }
      }
    } catch (err) { /* retry */ }
  }, 1000);
}

// ============ MAPA ============

function initMap() {
  if (leafletMap) return;
  const mapEl = document.getElementById('map');
  if (!mapEl) return;
  leafletMap = L.map('map').setView([19.4326, -99.1332], 12); // CDMX default
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap'
  }).addTo(leafletMap);
}

function clearMapMarkers() {
  mapMarkers.forEach(m => leafletMap.removeLayer(m));
  mapMarkers = [];
}

async function loadAllOnMap() {
  initMap();
  try {
    const res = await fetch(`${API_BASE}/api/locations-all/latest`);
    const data = await res.json();
    clearMapMarkers();

    if (data.length === 0) {
      updateStatus('No hay ubicaciones registradas', 'warning');
      return;
    }

    const bounds = [];
    data.forEach(d => {
      const marker = L.marker([d.latitude, d.longitude]).addTo(leafletMap);
      marker.bindPopup(`
        <strong>${escapeHtml(d.person_name || d.device_name)}</strong><br>
        ${d.phone ? '📞 ' + escapeHtml(d.phone) + '<br>' : ''}
        ${d.company ? '🏢 ' + escapeHtml(d.company) + '<br>' : ''}
        ${d.vehicle ? '🚗 ' + escapeHtml(d.vehicle) + '<br>' : ''}
        🕐 ${new Date(d.recorded_at).toLocaleString()}
      `);
      mapMarkers.push(marker);
      bounds.push([d.latitude, d.longitude]);
    });

    if (bounds.length > 0) {
      leafletMap.fitBounds(bounds, { padding: [30, 30] });
    }
  } catch (err) {
    console.error('Error cargando mapa:', err);
  }
}

async function viewOnMap(deviceId) {
  switchTab('map');
  setTimeout(async () => {
    initMap();
    try {
      const [devRes, locRes] = await Promise.all([
        fetch(`${API_BASE}/api/devices/${deviceId}`),
        fetch(`${API_BASE}/api/locations/${deviceId}?limit=50`),
      ]);
      const device = await devRes.json();
      const locations = await locRes.json();

      clearMapMarkers();

      if (locations.length === 0) {
        updateStatus('No hay ubicaciones para este dispositivo', 'warning');
        return;
      }

      const bounds = [];
      // Dibujar recorrido (línea)
      const latlngs = locations.map(l => [l.latitude, l.longitude]).reverse();
      const polyline = L.polyline(latlngs, { color: '#e94560', weight: 3 }).addTo(leafletMap);
      mapMarkers.push(polyline);

      // Marcadores en cada punto
      locations.forEach((loc, i) => {
        const isLatest = i === 0;
        const marker = L.circleMarker([loc.latitude, loc.longitude], {
          radius: isLatest ? 10 : 5,
          color: isLatest ? '#e94560' : '#8888cc',
          fillColor: isLatest ? '#e94560' : '#8888cc',
          fillOpacity: 0.8,
        }).addTo(leafletMap);
        marker.bindPopup(`
          <strong>${escapeHtml(device.person_name || device.device_name)}</strong><br>
          🕐 ${new Date(loc.recorded_at).toLocaleString()}<br>
          ${isLatest ? '<em>Última ubicación</em>' : ''}
        `);
        mapMarkers.push(marker);
        bounds.push([loc.latitude, loc.longitude]);
      });

      if (bounds.length > 0) {
        leafletMap.fitBounds(bounds, { padding: [30, 30] });
      }

      // Abrir popup del más reciente
      if (mapMarkers.length > 1) mapMarkers[1].openPopup();

      updateStatus(`Mostrando ${locations.length} puntos de ${escapeHtml(device.person_name || device.device_name)}`, 'success');
    } catch (err) {
      console.error('Error:', err);
    }
  }, 200);
}

function showSingleOnMap(lat, lng, accuracy) {
  switchTab('map');
  setTimeout(() => {
    initMap();
    clearMapMarkers();
    const marker = L.marker([lat, lng]).addTo(leafletMap);
    marker.bindPopup(`
      <strong>📍 Ubicación actual</strong><br>
      ${accuracy ? 'Precisión: ' + Math.round(accuracy) + 'm<br>' : ''}
      🕐 ${new Date().toLocaleString()}
    `).openPopup();
    mapMarkers.push(marker);
    leafletMap.setView([lat, lng], 16);
  }, 200);
}

// ============ BÚSQUEDA ============

function searchDevices() {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(async () => {
    const q = document.getElementById('search-input').value.trim();
    const results = document.getElementById('search-results');

    if (!q) { results.innerHTML = ''; return; }

    try {
      const res = await fetch(`${API_BASE}/api/devices/search?q=${encodeURIComponent(q)}`);
      const devices = await res.json();
      results.innerHTML = '';

      if (devices.length === 0) {
        results.innerHTML = '<p class="empty">Sin resultados</p>';
        return;
      }

      devices.forEach(d => {
        const card = document.createElement('div');
        card.className = 'device-card';
        card.innerHTML = `
          <div class="device-info">
            <span class="device-name">${escapeHtml(d.person_name || d.device_name)}</span>
            ${d.phone ? `<span class="device-meta">📞 ${escapeHtml(d.phone)}</span>` : ''}
            ${d.company ? `<span class="device-meta">🏢 ${escapeHtml(d.company)}</span>` : ''}
            ${d.vehicle ? `<span class="device-meta">🚗 ${escapeHtml(d.vehicle)}</span>` : ''}
          </div>
          <div class="device-actions">
            <button onclick="trackDevice(${d.id})" class="btn btn-track">📍</button>
            <button onclick="viewOnMap(${d.id})" class="btn btn-history">🗺️</button>
          </div>
        `;
        results.appendChild(card);
      });
    } catch (err) {
      console.error('Error buscando:', err);
    }
  }, 300);
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
    console.error('Error obteniendo/enviando ubicación:', err);
  }
}

// ============ UI HELPERS ============

function showRegistration() {
  document.getElementById('registration-section').style.display = 'block';
  document.getElementById('dashboard-section').style.display = 'none';
  const installEl = document.getElementById('install-section');
  if (installEl) installEl.style.display = 'none';
}

function showDashboard() {
  document.getElementById('registration-section').style.display = 'none';
  document.getElementById('dashboard-section').style.display = 'block';
  const installEl = document.getElementById('install-section');
  if (installEl) installEl.style.display = 'none';
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

// ============ INIT ============
document.addEventListener('DOMContentLoaded', init);
