let leafletMap = null;
let mapMarkers = [];
let searchTimeout = null;
let adminToken = sessionStorage.getItem('adminToken') || '';

// ============ AUTH ============

async function adminLogin() {
  const password = document.getElementById('admin-password').value;
  if (!password) return;
  try {
    const res = await fetch(`${API_BASE}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    const data = await res.json();
    if (data.success) {
      adminToken = data.token;
      sessionStorage.setItem('adminToken', adminToken);
      showDashboard();
      loadDevices();
    } else {
      updateStatus('Contraseña incorrecta', 'error');
    }
  } catch (err) {
    updateStatus('Error de conexión', 'error');
  }
}

function adminFetch(url, options = {}) {
  options.headers = options.headers || {};
  options.headers['x-admin-token'] = adminToken;
  return fetch(url, options);
}

function showDashboard() {
  document.getElementById('login-section').style.display = 'none';
  document.getElementById('dashboard-section').style.display = 'block';
}

// ============ INIT ============

function init() {
  if (adminToken) {
    adminFetch(`${API_BASE}/api/devices`).then(res => {
      if (res.ok) { showDashboard(); loadDevices(); }
      else { sessionStorage.removeItem('adminToken'); adminToken = ''; }
    }).catch(() => {});
  }
}

// ============ TABS ============

function switchTab(tab) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelector(`.tab[onclick="switchTab('${tab}')"]`).classList.add('active');
  document.getElementById('tab-' + tab).classList.add('active');
  document.getElementById('detail-panel').style.display = 'none';
  if (tab === 'map') setTimeout(() => { initMap(); loadAllOnMap(); }, 100);
}

// ============ DISPOSITIVOS ============

async function loadDevices() {
  try {
    const res = await adminFetch(`${API_BASE}/api/devices`);
    const devices = await res.json();
    const list = document.getElementById('devices-list');
    list.innerHTML = '';

    devices.forEach((d) => {
      const card = document.createElement('div');
      card.className = 'device-card';
      card.innerHTML = `
        <div class="device-info">
          <span class="device-name">${esc(d.person_name || d.device_name)}</span>
          ${d.phone ? `<span class="device-meta">📞 ${esc(d.phone)}</span>` : ''}
          ${d.company ? `<span class="device-meta">🏢 ${esc(d.company)}</span>` : ''}
          ${d.vehicle ? `<span class="device-meta">🚗 ${esc(d.vehicle)}</span>` : ''}
          <span class="device-date">${esc(d.device_name)} — ID: ${d.id}</span>
        </div>
        <div class="device-actions">
          <button onclick="trackDevice(${d.id})" class="btn btn-track" title="Trackear">📍</button>
          <button onclick="viewOnMap(${d.id})" class="btn btn-history" title="Recorrido en mapa">🗺️</button>
          <button onclick="viewHistory(${d.id})" class="btn btn-small" title="Historial">📋</button>
          <button onclick="editDevice(${d.id})" class="btn btn-small" title="Editar">✏️</button>
        </div>
      `;
      list.appendChild(card);
    });

    if (devices.length === 0) {
      list.innerHTML = '<p class="empty">No hay dispositivos registrados</p>';
    }
    updateStatus(`${devices.length} dispositivos registrados`, 'info');
  } catch (err) {
    updateStatus('Error cargando dispositivos', 'error');
  }
}

// ============ HISTORIAL ============

async function viewHistory(deviceId) {
  try {
    const [devRes, locRes] = await Promise.all([
      adminFetch(`${API_BASE}/api/devices/${deviceId}`),
      adminFetch(`${API_BASE}/api/locations/${deviceId}?limit=100`),
    ]);
    const device = await devRes.json();
    const locations = await locRes.json();

    const panel = document.getElementById('detail-panel');
    panel.style.display = 'block';

    if (locations.length === 0) {
      panel.innerHTML = `<h3>📋 ${esc(device.person_name || device.device_name)}</h3><p class="empty">Sin historial de ubicaciones</p>`;
      panel.scrollIntoView({ behavior: 'smooth' });
      return;
    }

    let html = `
      <h3>📋 Historial — ${esc(device.person_name || device.device_name)}</h3>
      <p style="color:#888; font-size:0.8rem; margin-bottom:0.75rem;">
        ${esc(device.phone || '')} ${device.vehicle ? '• 🚗 ' + esc(device.vehicle) : ''}
        • ${locations.length} registros
      </p>
      <div class="history-list">
    `;

    locations.forEach((loc, i) => {
      const date = new Date(loc.recorded_at);
      const isFirst = i === 0;
      html += `
        <div class="history-item ${isFirst ? 'history-latest' : ''}">
          <div>
            <span style="color:${isFirst ? '#66cc66' : '#ccc'};">${isFirst ? '🔴 ÚLTIMA' : '📌'}</span>
            <span>${date.toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span>
            <span style="color:#888;">${date.toLocaleTimeString('es-MX')}</span>
          </div>
          <div style="display:flex; align-items:center; gap:0.5rem;">
            <span style="font-size:0.8rem; color:#999;">${loc.latitude.toFixed(5)}, ${loc.longitude.toFixed(5)}</span>
            ${loc.accuracy ? '<span style="font-size:0.7rem; color:#666;">±' + Math.round(loc.accuracy) + 'm</span>' : ''}
            <a href="https://www.google.com/maps?q=${loc.latitude},${loc.longitude}" target="_blank" style="text-decoration:none;">🗺️</a>
          </div>
        </div>
      `;
    });

    html += '</div>';
    html += `<button onclick="viewOnMap(${deviceId})" class="btn btn-primary" style="margin-top:0.75rem; background:#1a73e8;">🗺️ Ver recorrido en mapa</button>`;
    panel.innerHTML = html;
    panel.scrollIntoView({ behavior: 'smooth' });
  } catch (err) {
    updateStatus('Error cargando historial', 'error');
  }
}

// ============ EDITAR ============

async function editDevice(id) {
  try {
    const res = await adminFetch(`${API_BASE}/api/devices/${id}`);
    const d = await res.json();
    if (!d) return;
    const panel = document.getElementById('detail-panel');
    panel.style.display = 'block';
    panel.innerHTML = `
      <h3>✏️ Editar dispositivo #${id}</h3>
      <div class="form-group"><label>Dispositivo</label><input type="text" id="edit-device-name" value="${esc(d.device_name || '')}"></div>
      <div class="form-group"><label>Persona</label><input type="text" id="edit-person-name" value="${esc(d.person_name || '')}"></div>
      <div class="form-group"><label>Teléfono</label><input type="tel" id="edit-phone" value="${esc(d.phone || '')}"></div>
      <div class="form-group"><label>Empresa</label><input type="text" id="edit-company" value="${esc(d.company || '')}"></div>
      <div class="form-group"><label>Vehículo</label><input type="text" id="edit-vehicle" value="${esc(d.vehicle || '')}"></div>
      <button onclick="saveDevice(${id})" class="btn btn-primary">Guardar</button>
    `;
    panel.scrollIntoView({ behavior: 'smooth' });
  } catch (err) { updateStatus('Error cargando dispositivo', 'error'); }
}

async function saveDevice(id) {
  try {
    await adminFetch(`${API_BASE}/api/devices/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
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
  } catch (err) { updateStatus('Error guardando', 'error'); }
}

// ============ TRACKING ============

async function trackAll() {
  updateStatus('Enviando push a todos...');
  try {
    const res = await adminFetch(`${API_BASE}/api/track-all`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      updateStatus(`Push enviado: ${data.sent} OK, ${data.failed} fallidos de ${data.total}`, 'success');
      setTimeout(() => { switchTab('map'); setTimeout(() => loadAllOnMap(), 500); }, 8000);
    } else { updateStatus('Error: ' + (data.error || ''), 'error'); }
  } catch (err) { updateStatus('Error: ' + err.message, 'error'); }
}

async function trackDevice(id) {
  updateStatus('Enviando push...');
  try {
    const res = await adminFetch(`${API_BASE}/api/track/${id}`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      updateStatus('Push enviado. Esperando respuesta...', 'success');
      pollStatus(data.requestId, id);
    } else { updateStatus('Error: ' + (data.error || ''), 'error'); }
  } catch (err) { updateStatus('Error: ' + err.message, 'error'); }
}

async function pollStatus(requestId, deviceId) {
  let attempts = 0;
  const interval = setInterval(async () => {
    attempts++;
    try {
      const res = await adminFetch(`${API_BASE}/api/track-status/${requestId}`);
      const data = await res.json();
      if (data && data.status === 'received' && data.latitude) {
        clearInterval(interval);
        updateStatus('Ubicación recibida', 'success');
        // Mostrar en mapa con info del dispositivo
        showTrackResult(deviceId, data.latitude, data.longitude, data.accuracy);
      } else if (attempts >= 30) {
        clearInterval(interval);
        const locRes = await adminFetch(`${API_BASE}/api/locations/${deviceId}/latest`);
        const loc = await locRes.json();
        if (loc && loc.latitude) {
          updateStatus('Mostrando última ubicación conocida', 'warning');
          showTrackResult(deviceId, loc.latitude, loc.longitude, loc.accuracy);
        } else {
          updateStatus('Sin respuesta del dispositivo', 'error');
        }
      }
    } catch (e) { /* retry */ }
  }, 1000);
}

async function showTrackResult(deviceId, lat, lng, accuracy) {
  // Obtener info del dispositivo
  let deviceName = 'Dispositivo';
  try {
    const res = await adminFetch(`${API_BASE}/api/devices/${deviceId}`);
    const d = await res.json();
    if (d) deviceName = d.person_name || d.device_name;
  } catch (e) {}

  switchTab('map');
  setTimeout(() => {
    initMap();
    clearMarkers();
    const marker = L.marker([lat, lng]).addTo(leafletMap);
    marker.bindPopup(`
      <strong>📍 ${esc(deviceName)}</strong><br>
      ${accuracy ? 'Precisión: ' + Math.round(accuracy) + 'm<br>' : ''}
      🕐 ${new Date().toLocaleString()}
    `).openPopup();
    mapMarkers.push(marker);
    leafletMap.setView([lat, lng], 16);
  }, 200);
}

// ============ MAPA ============

function initMap() {
  if (leafletMap) return;
  leafletMap = L.map('map').setView([19.4326, -99.1332], 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap'
  }).addTo(leafletMap);
}

function clearMarkers() {
  mapMarkers.forEach(m => leafletMap.removeLayer(m));
  mapMarkers = [];
}

async function loadAllOnMap() {
  initMap();
  try {
    const res = await adminFetch(`${API_BASE}/api/locations-all/latest`);
    const data = await res.json();
    clearMarkers();

    if (data.length === 0) { updateStatus('No hay ubicaciones', 'warning'); return; }

    const bounds = [];
    data.forEach(d => {
      const marker = L.marker([d.latitude, d.longitude]).addTo(leafletMap);
      marker.bindPopup(`
        <strong>${esc(d.person_name || d.device_name)}</strong><br>
        ${d.phone ? '📞 ' + esc(d.phone) + '<br>' : ''}
        ${d.company ? '🏢 ' + esc(d.company) + '<br>' : ''}
        ${d.vehicle ? '🚗 ' + esc(d.vehicle) + '<br>' : ''}
        🕐 ${new Date(d.recorded_at).toLocaleString()}
      `);
      mapMarkers.push(marker);
      bounds.push([d.latitude, d.longitude]);
    });

    leafletMap.fitBounds(bounds, { padding: [30, 30] });
    updateStatus(`${data.length} dispositivos en el mapa`, 'success');
  } catch (err) { updateStatus('Error cargando mapa', 'error'); }
}

async function viewOnMap(deviceId) {
  switchTab('map');
  setTimeout(async () => {
    initMap();
    try {
      const [devRes, locRes] = await Promise.all([
        adminFetch(`${API_BASE}/api/devices/${deviceId}`),
        adminFetch(`${API_BASE}/api/locations/${deviceId}?limit=100`),
      ]);
      const device = await devRes.json();
      const locations = await locRes.json();
      clearMarkers();

      if (locations.length === 0) { updateStatus('Sin ubicaciones para este dispositivo', 'warning'); return; }

      // Línea del recorrido (de más antiguo a más reciente)
      const latlngs = locations.map(l => [l.latitude, l.longitude]).reverse();
      const polyline = L.polyline(latlngs, { color: '#e94560', weight: 3 }).addTo(leafletMap);
      mapMarkers.push(polyline);

      const bounds = [];
      locations.forEach((loc, i) => {
        const isLatest = i === 0;
        const date = new Date(loc.recorded_at);
        const marker = L.circleMarker([loc.latitude, loc.longitude], {
          radius: isLatest ? 12 : 5,
          color: isLatest ? '#e94560' : '#8888cc',
          fillColor: isLatest ? '#e94560' : '#8888cc',
          fillOpacity: 0.8,
        }).addTo(leafletMap);
        marker.bindPopup(`
          <strong>${esc(device.person_name || device.device_name)}</strong><br>
          📅 ${date.toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' })}<br>
          🕐 ${date.toLocaleTimeString('es-MX')}<br>
          ${isLatest ? '<em style="color:green;">● Última ubicación</em>' : ''}
        `);
        mapMarkers.push(marker);
        bounds.push([loc.latitude, loc.longitude]);
      });

      leafletMap.fitBounds(bounds, { padding: [30, 30] });
      if (mapMarkers.length > 1) mapMarkers[1].openPopup();
      updateStatus(`${locations.length} puntos de ${esc(device.person_name || device.device_name)}`, 'success');
    } catch (err) { updateStatus('Error', 'error'); }
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
      const res = await adminFetch(`${API_BASE}/api/devices/search?q=${encodeURIComponent(q)}`);
      const devices = await res.json();
      results.innerHTML = '';
      if (devices.length === 0) { results.innerHTML = '<p class="empty">Sin resultados</p>'; return; }
      devices.forEach(d => {
        const card = document.createElement('div');
        card.className = 'device-card';
        card.innerHTML = `
          <div class="device-info">
            <span class="device-name">${esc(d.person_name || d.device_name)}</span>
            ${d.phone ? `<span class="device-meta">📞 ${esc(d.phone)}</span>` : ''}
            ${d.company ? `<span class="device-meta">🏢 ${esc(d.company)}</span>` : ''}
            ${d.vehicle ? `<span class="device-meta">🚗 ${esc(d.vehicle)}</span>` : ''}
          </div>
          <div class="device-actions">
            <button onclick="trackDevice(${d.id})" class="btn btn-track">📍</button>
            <button onclick="viewOnMap(${d.id})" class="btn btn-history">🗺️</button>
            <button onclick="viewHistory(${d.id})" class="btn btn-small">📋</button>
          </div>
        `;
        results.appendChild(card);
      });
    } catch (err) { updateStatus('Error buscando', 'error'); }
  }, 300);
}

// ============ HELPERS ============

function updateStatus(message, type = 'info') {
  const el = document.getElementById('status');
  el.textContent = message;
  el.className = 'status status-' + type;
}

function esc(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

document.addEventListener('DOMContentLoaded', init);
