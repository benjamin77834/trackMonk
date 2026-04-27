let leafletMap = null;
let mapMarkers = [];
let searchTimeout = null;
let adminToken = sessionStorage.getItem('adminToken') || '';
let currentRole = sessionStorage.getItem('adminRole') || '';
let allDevices = [];

// ============ AUTH ============

async function adminLogin() {
  var username = document.getElementById('admin-username') ? document.getElementById('admin-username').value : 'admin';
  var password = document.getElementById('admin-password').value;
  if (!password) return;
  try {
    var res = await fetch(API_BASE + '/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username, password: password }),
    });
    var data = await res.json();
    if (data.success) {
      adminToken = data.token;
      currentRole = data.role;
      sessionStorage.setItem('adminToken', adminToken);
      sessionStorage.setItem('adminRole', data.role);
      document.getElementById('login-page').style.display = 'none';
      document.getElementById('dashboard').style.display = 'flex';
      if (data.role === 'super_admin') document.querySelectorAll('.nav-super').forEach(function(el) { el.style.display = 'flex'; });
      loadDevices();
      loadAlertCount();
    } else { setStatus('login', 'Credenciales inválidas', 'error'); }
  } catch (err) { setStatus('login', 'Error de conexión', 'error'); }
}

function adminLogout() {
  sessionStorage.removeItem('adminToken');
  sessionStorage.removeItem('adminRole');
  adminToken = '';
  location.reload();
}

function af(url, opts = {}) {
  opts.headers = opts.headers || {};
  opts.headers['x-admin-token'] = adminToken;
  return fetch(url, opts);
}

// ============ INIT ============

function init() {
  if (adminToken) {
    af(`${API_BASE}/api/devices`).then(r => {
      if (r.ok) {
        document.getElementById('login-page').style.display = 'none';
        document.getElementById('dashboard').style.display = 'flex';
        if (currentRole === 'super_admin') document.querySelectorAll('.nav-super').forEach(function(el) { el.style.display = 'flex'; });
        loadDevices();
        loadAlertCount();
      } else { sessionStorage.removeItem('adminToken'); adminToken = ''; }
    }).catch(() => {});
  }
}

// ============ NAVIGATION ============

function navigate(page) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  event.currentTarget.classList.add('active');
  document.getElementById('page-' + page).classList.add('active');
  document.getElementById('page-title').textContent =
    { devices: 'Dispositivos', map: 'Mapa', trips: 'Viajes', alerts: 'Alertas', search: 'Buscar', companies: 'Empresas', users: 'Usuarios', settings: 'Configuración' }[page];
  closeDetailDirect();
  if (page === 'map') setTimeout(() => { initMap(); loadAllOnMap(); }, 100);
  if (page === 'trips') loadTrips();
  if (page === 'alerts') loadAlerts();
  if (page === 'companies') loadCompanies();
  if (page === 'users') loadUsers();
  if (page === 'settings') loadSettings();
  // Close sidebar on mobile
  document.querySelector('.sidebar').classList.remove('open');
}

function toggleSidebar() {
  document.querySelector('.sidebar').classList.toggle('open');
}

// ============ STATUS ============

function setStatus(target, msg, type) {
  const el = document.getElementById(target === 'login' ? 'status-login' : 'status');
  el.textContent = msg;
  el.className = 'status status-' + (type || 'info');
}
function updateStatus(msg, type) { setStatus('main', msg, type); }

// ============ DEVICES ============

async function loadDevices() {
  try {
    const res = await af(`${API_BASE}/api/devices`);
    allDevices = await res.json();
    const list = document.getElementById('devices-list');
    list.innerHTML = '';
    allDevices.forEach(d => {
      const hasPush = d.endpoint_len > 0 || true; // we don't have this field, check below
      list.innerHTML += `
        <div class="card">
          <div class="card-title">${esc(d.person_name || d.device_name)}</div>
          ${d.phone ? `<div class="card-meta">📞 ${esc(d.phone)}</div>` : ''}
          ${d.company ? `<div class="card-meta">🏢 ${esc(d.company)}</div>` : ''}
          ${d.vehicle ? `<div class="card-meta">🚗 ${esc(d.vehicle)}</div>` : ''}
          <div class="card-meta" style="color:#555;">${esc(d.device_name)} · ID ${d.id}</div>
          <div class="card-actions">
            <button onclick="trackDevice(${d.id})" class="btn btn-danger btn-sm">📍 Trackear</button>
            <button onclick="sendMessage(${d.id})" class="btn btn-accent2 btn-sm">💬 Mensaje</button>
            <button onclick="sendInstallLink(${d.id})" class="btn btn-secondary btn-sm" title="Enviar link de instalación">📲</button>
            <button onclick="viewOnMap(${d.id})" class="btn btn-secondary btn-sm">🗺️ Mapa</button>
            <button onclick="viewHistory(${d.id})" class="btn btn-secondary btn-sm">📋</button>
            <button onclick="editDevice(${d.id})" class="btn btn-secondary btn-sm">✏️</button>
            <button onclick="deleteDevice(${d.id},'${esc(d.person_name || d.device_name)}')" class="btn btn-danger btn-sm">🗑️</button>
          </div>
        </div>`;
    });
    if (allDevices.length === 0) list.innerHTML = '<div class="empty">No hay dispositivos registrados</div>';
    updateStatus(`${allDevices.length} dispositivos`, 'info');
  } catch (err) { updateStatus('Error cargando', 'error'); }
}

async function deleteDevice(id, name) {
  if (!confirm('¿Eliminar "' + name + '" y todo su historial?')) return;
  await af(`${API_BASE}/api/devices/${id}`, { method: 'DELETE' });
  updateStatus('Dispositivo eliminado', 'success');
  loadDevices();
}

async function editDevice(id) {
  const res = await af(`${API_BASE}/api/devices/${id}`);
  const d = await res.json();
  if (!d) return;
  showDetail(`
    <h3>✏️ Editar dispositivo</h3>
    <div class="form-group"><label>Dispositivo</label><input id="ed-name" value="${esc(d.device_name||'')}"></div>
    <div class="form-group"><label>Persona</label><input id="ed-person" value="${esc(d.person_name||'')}"></div>
    <div class="form-row">
      <div class="form-group"><label>Teléfono</label><input id="ed-phone" value="${esc(d.phone||'')}"></div>
      <div class="form-group"><label>Empresa</label><input id="ed-company" value="${esc(d.company||'')}"></div>
    </div>
    <div class="form-group"><label>Vehículo</label><input id="ed-vehicle" value="${esc(d.vehicle||'')}"></div>
    <button onclick="saveDevice(${id})" class="btn btn-primary" style="width:100%;margin-top:0.5rem;">Guardar</button>
  `);
}

async function saveDevice(id) {
  await af(`${API_BASE}/api/devices/${id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      device_name: document.getElementById('ed-name').value,
      person_name: document.getElementById('ed-person').value,
      phone: document.getElementById('ed-phone').value,
      company: document.getElementById('ed-company').value,
      vehicle: document.getElementById('ed-vehicle').value,
    }),
  });
  closeDetailDirect(); updateStatus('Actualizado', 'success'); loadDevices();
}

async function viewHistory(deviceId) {
  const [devRes, locRes] = await Promise.all([
    af(`${API_BASE}/api/devices/${deviceId}`),
    af(`${API_BASE}/api/locations/${deviceId}?limit=100`),
  ]);
  const device = await devRes.json();
  const locations = await locRes.json();
  let html = `<h3>📋 ${esc(device.person_name || device.device_name)}</h3>`;
  if (locations.length === 0) { html += '<div class="empty">Sin historial</div>'; }
  else {
    html += `<p class="card-meta">${locations.length} registros</p>`;
    locations.forEach((loc, i) => {
      const date = new Date(loc.recorded_at);
      html += `<div class="history-item ${i===0?'history-latest':''}">
        <div><span style="color:${i===0?'#66cc66':'#ccc'}">${i===0?'🔴 ÚLTIMA':'📌'}</span>
        ${date.toLocaleDateString('es-MX',{weekday:'short',day:'numeric',month:'short'})}
        <span style="color:#888">${date.toLocaleTimeString('es-MX')}</span></div>
        <a href="https://www.google.com/maps?q=${loc.latitude},${loc.longitude}" target="_blank">🗺️</a>
      </div>`;
    });
    html += `<button onclick="viewOnMap(${deviceId});closeDetailDirect();" class="btn btn-accent2" style="width:100%;margin-top:0.75rem;">🗺️ Ver recorrido</button>`;
  }
  showDetail(html);
}

async function sendMessage(deviceId) {
  const d = allDevices.find(x => x.id === deviceId) || {};
  showDetail(`
    <h3>💬 Mensaje a ${esc(d.person_name || d.device_name || '')}</h3>
    <div class="form-group"><label>Título</label><input id="msg-title" value="TrackMonk"></div>
    <div class="form-group"><label>Mensaje</label><input id="msg-body" placeholder="Escribe el mensaje..."></div>
    <button onclick="doSendMessage(${deviceId})" class="btn btn-accent2" style="width:100%;margin-top:0.5rem;">Enviar</button>
  `);
}

async function doSendMessage(deviceId) {
  const title = document.getElementById('msg-title').value.trim() || 'TrackMonk';
  const body = document.getElementById('msg-body').value.trim();
  if (!body) { updateStatus('Escribe un mensaje', 'error'); return; }
  const res = await af(`${API_BASE}/api/push-message/${deviceId}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, body }),
  });
  const data = await res.json();
  if (data.success) { closeDetailDirect(); updateStatus('Mensaje enviado ✓', 'success'); }
  else updateStatus('Error: ' + (data.error || ''), 'error');
}

async function sendInstallLink(deviceId) {
  const d = allDevices.find(x => x.id === deviceId) || {};
  const msg = 'Instala TrackMonk en tu teléfono: Abre este link en Firefox (Android) o Safari (iPhone) → tracker.monkeyfon.com';
  // Enviar por push
  try {
    await af(`${API_BASE}/api/push-message/${deviceId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '📲 Instala TrackMonk', body: 'Abre tracker.monkeyfon.com y toca "Instalar aplicación"' }),
    });
    updateStatus('Link de instalación enviado por push ✓', 'success');
  } catch (e) {
    updateStatus('Error enviando', 'error');
  }
}

// ============ TRACKING ============

async function trackAll() {
  updateStatus('Enviando push a todos...', 'warning');
  const res = await af(`${API_BASE}/api/track-all`, { method: 'POST' });
  const data = await res.json();
  if (!data.success) { updateStatus('Error', 'error'); return; }

  updateStatus('Push: ' + data.sent + ' OK, ' + data.failed + ' fallidos, ' + data.noPush + ' sin push', 'success');

  var sentResults = data.results.filter(function(r) { return r.status === 'sent'; });
  var failedResults = data.results.filter(function(r) { return r.status === 'failed'; });
  var noPushResults = data.results.filter(function(r) { return r.status === 'no_push'; });

  var html = '<h3>📍 Trackeo masivo</h3>';
  html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.5rem;margin-bottom:1rem;text-align:center;">';
  html += '<div style="background:#dcfce7;padding:0.75rem;border-radius:8px;"><div style="font-size:1.3rem;font-weight:700;color:#16a34a;">' + data.sent + '</div><div style="font-size:0.75rem;color:#666;">Enviados</div></div>';
  html += '<div style="background:#fee2e2;padding:0.75rem;border-radius:8px;"><div style="font-size:1.3rem;font-weight:700;color:#ef4444;">' + data.failed + '</div><div style="font-size:0.75rem;color:#666;">Fallidos</div></div>';
  html += '<div style="background:#fef9c3;padding:0.75rem;border-radius:8px;"><div style="font-size:1.3rem;font-weight:700;color:#a16207;">' + data.noPush + '</div><div style="font-size:0.75rem;color:#666;">Sin push</div></div>';
  html += '</div>';

  if (sentResults.length > 0) {
    html += '<div style="margin-bottom:0.75rem;"><strong style="color:#16a34a;">✅ Enviados</strong>';
    sentResults.forEach(function(r) {
      html += '<div id="track-result-' + r.id + '" style="display:flex;justify-content:space-between;padding:0.4rem 0;border-bottom:1px solid #e0e0e0;font-size:0.85rem;">';
      html += '<span>' + esc(r.name) + '</span><span class="track-status" style="color:#a16207;">⏳ Esperando...</span></div>';
    });
    html += '</div>';
  }
  if (failedResults.length > 0) {
    html += '<div style="margin-bottom:0.75rem;"><strong style="color:#ef4444;">❌ Fallidos</strong>';
    failedResults.forEach(function(r) { html += '<div style="padding:0.4rem 0;border-bottom:1px solid #e0e0e0;font-size:0.85rem;">' + esc(r.name) + '</div>'; });
    html += '</div>';
  }
  if (noPushResults.length > 0) {
    html += '<div><strong style="color:#a16207;">⚠️ Sin push</strong>';
    noPushResults.forEach(function(r) { html += '<div style="padding:0.4rem 0;border-bottom:1px solid #e0e0e0;font-size:0.85rem;">' + esc(r.name) + '</div>'; });
    html += '</div>';
  }

  html += '<button onclick="closeDetailDirect();" class="btn btn-accent2" style="width:100%;margin-top:1rem;">🗺️ Cerrar y ver mapa</button>';
  showDetail(html);

  // Polling para ver quién respondió
  var requestIds = sentResults.map(function(r) { return r.requestId; }).filter(Boolean);
  if (requestIds.length > 0) pollTrackAll(requestIds, sentResults);
}

function pollTrackAll(requestIds, sentResults) {
  var attempts = 0;
  var resolved = {};
  var interval = setInterval(async function() {
    attempts++;
    try {
      var res = await af(API_BASE + '/api/track-all/check', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestIds: requestIds }),
      });
      var statuses = await res.json();
      statuses.forEach(function(s) {
        if (s.status === 'received' && !resolved[s.requestId]) {
          resolved[s.requestId] = true;
          var el = document.getElementById('track-result-' + s.device_id);
          if (el) {
            var sp = el.querySelector('.track-status');
            if (sp) { sp.textContent = '✅ Respondió'; sp.style.color = '#16a34a'; }
          }
        }
      });
      var count = Object.keys(resolved).length;
      updateStatus('Trackeo: ' + count + '/' + requestIds.length + ' respondieron', 'success');
      if (count >= requestIds.length || attempts >= 30) {
        clearInterval(interval);
        sentResults.forEach(function(r) {
          if (r.requestId && !resolved[r.requestId]) {
            var el = document.getElementById('track-result-' + r.id);
            if (el) { var sp = el.querySelector('.track-status'); if (sp) { sp.textContent = '⏰ Sin respuesta'; sp.style.color = '#ef4444'; } }
          }
        });
      }
    } catch (e) {}
  }, 2000);
}

async function trackDevice(id) {
  updateStatus('Enviando push...', 'warning');
  const res = await af(`${API_BASE}/api/track/${id}`, { method: 'POST' });
  const data = await res.json();
  if (data.success) { updateStatus('Push enviado, esperando...', 'success'); pollStatus(data.requestId, id); }
  else updateStatus('Error: ' + (data.error || ''), 'error');
}

async function pollStatus(requestId, deviceId) {
  let attempts = 0;
  const interval = setInterval(async () => {
    attempts++;
    try {
      const res = await af(`${API_BASE}/api/track-status/${requestId}`);
      const data = await res.json();
      if (data && data.status === 'received' && data.latitude) {
        clearInterval(interval);
        updateStatus('Ubicación recibida ✓', 'success');
        showTrackResult(deviceId, data.latitude, data.longitude, data.accuracy);
      } else if (attempts >= 30) {
        clearInterval(interval);
        const locRes = await af(`${API_BASE}/api/locations/${deviceId}/latest`);
        const loc = await locRes.json();
        if (loc && loc.latitude) { updateStatus('Última ubicación conocida', 'warning'); showTrackResult(deviceId, loc.latitude, loc.longitude, loc.accuracy); }
        else updateStatus('Sin respuesta', 'error');
      }
    } catch (e) {}
  }, 1000);
}

async function showTrackResult(deviceId, lat, lng, accuracy) {
  const d = allDevices.find(x => x.id === deviceId) || {};
  // Switch to map
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item')[1].classList.add('active');
  document.getElementById('page-map').classList.add('active');
  document.getElementById('page-title').textContent = 'Mapa';
  setTimeout(() => {
    initMap(); clearMarkers();
    const marker = L.marker([lat, lng]).addTo(leafletMap);
    marker.bindPopup(`<strong>📍 ${esc(d.person_name || d.device_name || '')}</strong><br>${accuracy ? '±' + Math.round(accuracy) + 'm<br>' : ''}🕐 ${new Date().toLocaleString()}`).openPopup();
    mapMarkers.push(marker);
    leafletMap.setView([lat, lng], 16);
  }, 200);
}

// ============ MAP ============

function initMap() {
  if (leafletMap) { leafletMap.invalidateSize(); return; }
  var mapEl = document.getElementById('map');
  if (!mapEl) return;
  leafletMap = L.map('map').setView([19.4326, -99.1332], 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(leafletMap);
  setTimeout(function() { if (leafletMap) leafletMap.invalidateSize(); }, 500);
}

function clearMarkers() { mapMarkers.forEach(m => leafletMap.removeLayer(m)); mapMarkers = []; }

async function loadAllOnMap() {
  initMap();
  const res = await af(`${API_BASE}/api/locations-all/latest`);
  const data = await res.json();
  clearMarkers();
  if (data.length === 0) { updateStatus('Sin ubicaciones', 'warning'); return; }
  const bounds = [];
  data.forEach(d => {
    const m = L.marker([d.latitude, d.longitude]).addTo(leafletMap);
    m.bindPopup(`<strong>${esc(d.person_name||d.device_name)}</strong><br>${d.phone?'📞 '+esc(d.phone)+'<br>':''}${d.vehicle?'🚗 '+esc(d.vehicle)+'<br>':''}🕐 ${new Date(d.recorded_at).toLocaleString()}`);
    // Etiqueta visible siempre
    m.bindTooltip(esc(d.person_name || d.device_name) + (d.vehicle ? ' - ' + esc(d.vehicle) : ''), { permanent: true, direction: 'top', offset: [0, -10], className: 'map-label' });
    mapMarkers.push(m); bounds.push([d.latitude, d.longitude]);
  });
  leafletMap.fitBounds(bounds, { padding: [30, 30] });
  updateStatus(`${data.length} en mapa`, 'success');
}

async function viewOnMap(deviceId) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item')[1].classList.add('active');
  document.getElementById('page-map').classList.add('active');
  document.getElementById('page-title').textContent = 'Mapa';
  setTimeout(async () => {
    initMap();
    const [devRes, locRes] = await Promise.all([
      af(`${API_BASE}/api/devices/${deviceId}`), af(`${API_BASE}/api/locations/${deviceId}?limit=100`),
    ]);
    const device = await devRes.json(); const locations = await locRes.json();
    clearMarkers();
    if (locations.length === 0) { updateStatus('Sin ubicaciones', 'warning'); return; }
    const latlngs = locations.map(l => [l.latitude, l.longitude]).reverse();
    const poly = L.polyline(latlngs, { color: '#e94560', weight: 3 }).addTo(leafletMap);
    mapMarkers.push(poly);
    const bounds = [];
    locations.forEach((loc, i) => {
      const latest = i === 0;
      const m = L.circleMarker([loc.latitude, loc.longitude], {
        radius: latest ? 12 : 5, color: latest ? '#e94560' : '#8888cc',
        fillColor: latest ? '#e94560' : '#8888cc', fillOpacity: 0.8,
      }).addTo(leafletMap);
      const dt = new Date(loc.recorded_at);
      m.bindPopup(`<strong>${esc(device.person_name||device.device_name)}</strong><br>📅 ${dt.toLocaleDateString('es-MX',{weekday:'short',day:'numeric',month:'short'})}<br>🕐 ${dt.toLocaleTimeString('es-MX')}${latest?'<br><em style="color:green">● Última</em>':''}`);
      mapMarkers.push(m); bounds.push([loc.latitude, loc.longitude]);
    });
    leafletMap.fitBounds(bounds, { padding: [30, 30] });
    if (mapMarkers[1]) mapMarkers[1].openPopup();
    updateStatus(`${locations.length} puntos`, 'success');
  }, 200);
}

// ============ TRIPS ============

async function loadTrips() {
  const status = document.getElementById('trip-filter').value;
  const res = await af(`${API_BASE}/api/trips?status=${status}`);
  const trips = await res.json();
  const list = document.getElementById('trips-list');
  list.innerHTML = '';
  if (trips.length === 0) { list.innerHTML = '<div class="empty">No hay viajes</div>'; return; }
  trips.forEach(t => {
    const statusBadge = { active: 'badge-active', completed: 'badge-completed', cancelled: 'badge-cancelled' }[t.status] || '';
    const statusLabel = { active: '🟢 Activo', completed: '✅ Completado', cancelled: '❌ Cancelado' }[t.status] || t.status;
    list.innerHTML += `
      <div class="trip-card">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:0.5rem;">
          <div>
            <div class="card-title">${esc(t.person_name || t.device_name)} <span class="card-badge ${statusBadge}">${statusLabel}</span></div>
            ${t.vehicle ? `<div class="card-meta">🚗 ${esc(t.vehicle)}</div>` : ''}
            ${t.cargo ? `<div class="card-meta">📦 ${esc(t.cargo)}</div>` : ''}
          </div>
          <div style="text-align:right;">
            <div style="font-size:1.1rem;font-weight:700;color:#fff;">$${parseFloat(t.total_cost || 0).toLocaleString('es-MX', {minimumFractionDigits:2})}</div>
            <div class="card-meta">${t.location_count || 0} puntos</div>
          </div>
        </div>
        <div class="trip-route">
          <span class="dot dot-start"></span>
          <span style="font-size:0.85rem;">${esc(t.origin)}</span>
          <span class="line"></span>
          <span style="font-size:0.85rem;">${esc(t.destination)}</span>
          <span class="dot dot-end"></span>
        </div>
        <div class="card-meta">📅 ${new Date(t.started_at).toLocaleDateString('es-MX', {weekday:'short',day:'numeric',month:'short',year:'numeric'})}
          ${t.completed_at ? ' → ' + new Date(t.completed_at).toLocaleDateString('es-MX', {day:'numeric',month:'short'}) : ''}</div>
        <div class="card-actions">
          <button onclick="viewTrip(${t.id})" class="btn btn-primary btn-sm">📋 Detalle</button>
          <button onclick="viewTripOnMap(${t.id})" class="btn btn-accent2 btn-sm">🗺️ Mapa</button>
          ${t.status === 'active' ? `<button onclick="completeTrip(${t.id})" class="btn btn-success btn-sm">✅ Completar</button>` : ''}
          ${t.status === 'active' ? `<button onclick="cancelTrip(${t.id})" class="btn btn-secondary btn-sm">❌</button>` : ''}
        </div>
      </div>`;
  });
}

function showNewTripForm() {
  let deviceOpts = allDevices.map(d => `<option value="${d.id}">${esc(d.person_name || d.device_name)} - ${esc(d.vehicle || d.device_name)}</option>`).join('');
  showDetail(`
    <h3>➕ Nuevo viaje</h3>
    <div class="form-group"><label>Dispositivo / Conductor</label><select id="trip-device">${deviceOpts}</select></div>
    <div class="form-row">
      <div class="form-group"><label>Origen</label><input id="trip-origin" placeholder="Ej: CDMX"></div>
      <div class="form-group"><label>Destino</label><input id="trip-dest" placeholder="Ej: Guadalajara"></div>
    </div>
    <div class="form-group"><label>Carga</label><input id="trip-cargo" placeholder="Ej: 20 cajas de producto X"></div>
    <div class="form-group"><label>Notas</label><textarea id="trip-notes" placeholder="Notas adicionales..."></textarea></div>
    <button onclick="createTrip()" class="btn btn-primary" style="width:100%;margin-top:0.5rem;">Crear viaje</button>
  `);
}

async function createTrip() {
  const res = await af(`${API_BASE}/api/trips`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      device_id: document.getElementById('trip-device').value,
      origin: document.getElementById('trip-origin').value,
      destination: document.getElementById('trip-dest').value,
      cargo: document.getElementById('trip-cargo').value,
      notes: document.getElementById('trip-notes').value,
    }),
  });
  const data = await res.json();
  if (data.success) { closeDetailDirect(); updateStatus('Viaje creado', 'success'); loadTrips(); }
  else updateStatus('Error: ' + (data.error || ''), 'error');
}

async function viewTrip(tripId) {
  var res = await af(API_BASE + '/api/trips/' + tripId);
  var t = await res.json();
  var costsHtml = '';
  if (t.costs && t.costs.length > 0) {
    costsHtml = '<table style="width:100%;border-collapse:collapse;font-size:0.85rem;margin-top:0.5rem;"><tr style="background:#f5f5f5;"><th style="text-align:left;padding:0.5rem;border-bottom:2px solid #e0e0e0;">Concepto</th><th style="text-align:left;padding:0.5rem;border-bottom:2px solid #e0e0e0;">Fecha</th><th style="text-align:right;padding:0.5rem;border-bottom:2px solid #e0e0e0;">Monto</th><th style="padding:0.5rem;border-bottom:2px solid #e0e0e0;width:40px;"></th></tr>';
    t.costs.forEach(function(c) {
      var d = new Date(c.created_at);
      costsHtml += '<tr><td style="padding:0.5rem;border-bottom:1px solid #eee;">' + esc(c.concept) + '</td><td style="padding:0.5rem;border-bottom:1px solid #eee;color:#666;font-size:0.8rem;">' + d.toLocaleDateString('es-MX',{day:'numeric',month:'short'}) + ' ' + d.toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'}) + '</td><td style="padding:0.5rem;border-bottom:1px solid #eee;text-align:right;font-weight:600;">$' + parseFloat(c.amount).toLocaleString('es-MX',{minimumFractionDigits:2}) + '</td><td style="padding:0.5rem;border-bottom:1px solid #eee;"><button onclick="deleteCost(' + c.id + ',' + tripId + ')" class="btn btn-danger btn-sm" style="padding:0.2rem 0.4rem;">🗑️</button></td></tr>';
    });
    costsHtml += '</table>';
  } else {
    costsHtml = '<p style="color:#999;text-align:center;padding:1rem;">Sin gastos registrados</p>';
  }
  var html = '<h3>📋 Viaje #' + t.id + '</h3>';
  html += '<div class="card-meta">👤 ' + esc(t.person_name || t.device_name) + (t.vehicle ? ' · 🚗 ' + esc(t.vehicle) : '') + '</div>';
  html += '<div class="trip-route" style="margin:0.75rem 0;"><span class="dot dot-start"></span><span>' + esc(t.origin) + '</span><span class="line"></span><span>' + esc(t.destination) + '</span><span class="dot dot-end"></span></div>';
  if (t.cargo) html += '<div class="card-meta">📦 ' + esc(t.cargo) + '</div>';
  if (t.notes) html += '<div class="card-meta">📝 ' + esc(t.notes) + '</div>';
  html += '<div style="margin:1rem 0;padding:1rem;background:#f0fdf4;border:2px solid #bbf7d0;border-radius:10px;text-align:center;">';
  html += '<div style="font-size:0.8rem;color:#16a34a;font-weight:600;">Costo total</div>';
  html += '<div style="font-size:2rem;font-weight:800;color:#111;">$' + parseFloat(t.total_cost || 0).toLocaleString('es-MX', {minimumFractionDigits:2}) + '</div>';
  html += '<div style="font-size:0.75rem;color:#666;">' + (t.costs ? t.costs.length : 0) + ' gastos · ' + (t.locations ? t.locations.length : 0) + ' ubicaciones</div>';
  html += '</div>';
  html += costsHtml;
  html += '<div style="margin-top:0.75rem;display:flex;gap:0.5rem;flex-wrap:wrap;">';
  html += '<button onclick="exportTripCosts(' + tripId + ')" class="btn btn-secondary btn-sm" style="flex:1;">📥 Gastos CSV</button>';
  html += '<button onclick="exportTripFull(' + tripId + ')" class="btn btn-secondary btn-sm" style="flex:1;">📥 Reporte completo</button>';
  html += '</div>';
  html += '<div style="margin-top:1rem;padding-top:0.75rem;border-top:1px solid #e0e0e0;">';
  html += '<div style="font-size:0.85rem;font-weight:600;margin-bottom:0.5rem;">Agregar gasto</div>';
  html += '<div class="form-row"><div class="form-group"><label>Concepto</label><input id="cost-concept" placeholder="Ej: Gasolina, Caseta..."></div><div class="form-group"><label>Monto $</label><input id="cost-amount" type="number" step="0.01" placeholder="0.00"></div></div>';
  html += '<button onclick="addCost(' + tripId + ')" class="btn btn-primary btn-sm">Agregar</button>';
  html += '</div>';
  html += '<button onclick="viewTripOnMap(' + tripId + ');closeDetailDirect();" class="btn btn-accent2" style="width:100%;margin-top:1rem;">🗺️ Ver recorrido en mapa</button>';
  showDetail(html);
  window._currentTrip = t;
}

async function addCost(tripId) {
  const concept = document.getElementById('cost-concept').value.trim();
  const amount = parseFloat(document.getElementById('cost-amount').value);
  if (!concept || isNaN(amount)) { updateStatus('Llena concepto y monto', 'error'); return; }
  await af(`${API_BASE}/api/trips/${tripId}/costs`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ concept, amount }),
  });
  viewTrip(tripId); // reload detail
}

async function deleteCost(costId, tripId) {
  await af(`${API_BASE}/api/trip-costs/${costId}`, { method: 'DELETE' });
  viewTrip(tripId);
}

async function completeTrip(tripId) {
  await af(`${API_BASE}/api/trips/${tripId}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'completed' }),
  });
  updateStatus('Viaje completado', 'success'); loadTrips();
}

async function cancelTrip(tripId) {
  if (!confirm('¿Cancelar este viaje?')) return;
  await af(`${API_BASE}/api/trips/${tripId}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'cancelled' }),
  });
  updateStatus('Viaje cancelado', 'warning'); loadTrips();
}

async function viewTripOnMap(tripId) {
  const res = await af(`${API_BASE}/api/trips/${tripId}`);
  const t = await res.json();
  // Switch to map
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item')[1].classList.add('active');
  document.getElementById('page-map').classList.add('active');
  document.getElementById('page-title').textContent = 'Mapa';
  setTimeout(() => {
    initMap(); clearMarkers();
    if (!t.locations || t.locations.length === 0) { updateStatus('Sin ubicaciones en este viaje', 'warning'); return; }
    const latlngs = t.locations.map(l => [l.latitude, l.longitude]);
    const poly = L.polyline(latlngs, { color: '#e94560', weight: 3 }).addTo(leafletMap);
    mapMarkers.push(poly);
    const bounds = [];
    t.locations.forEach((loc, i) => {
      const first = i === 0; const last = i === t.locations.length - 1;
      const m = L.circleMarker([loc.latitude, loc.longitude], {
        radius: (first || last) ? 10 : 4,
        color: first ? '#22c55e' : last ? '#e94560' : '#8888cc',
        fillColor: first ? '#22c55e' : last ? '#e94560' : '#8888cc', fillOpacity: 0.8,
      }).addTo(leafletMap);
      const dt = new Date(loc.recorded_at);
      m.bindPopup(`${first ? '🟢 Inicio' : last ? '🔴 Último punto' : '📌'}<br>🕐 ${dt.toLocaleString('es-MX')}`);
      mapMarkers.push(m); bounds.push([loc.latitude, loc.longitude]);
    });
    leafletMap.fitBounds(bounds, { padding: [30, 30] });
    updateStatus(`Viaje: ${esc(t.origin)} → ${esc(t.destination)} · ${t.locations.length} puntos`, 'success');
  }, 200);
}

// ============ ALERTS ============

async function loadAlertCount() {
  try {
    var res = await af(`${API_BASE}/api/alerts/active-count`);
    var data = await res.json();
    // Badge en sidebar
    var badge = document.getElementById('alert-count-badge');
    if (badge && data.count > 0) { badge.textContent = data.count; badge.style.display = 'inline'; }
    else if (badge) { badge.style.display = 'none'; }
    // Alarma en top-bar
    var alarm = document.getElementById('alert-alarm');
    var alarmCount = document.getElementById('alert-alarm-count');
    if (alarm && data.count > 0) {
      alarm.style.display = 'block';
      alarmCount.textContent = data.count;
    } else if (alarm) {
      alarm.style.display = 'none';
    }
  } catch (e) {}
  setTimeout(loadAlertCount, 15000);
}

async function loadAlerts() {
  var status = document.getElementById('alert-filter').value;
  var res = await af(`${API_BASE}/api/alerts?status=${status}`);
  var alerts = await res.json();
  var list = document.getElementById('alerts-list');
  list.innerHTML = '';

  if (alerts.length === 0) { list.innerHTML = '<div class="empty">No hay alertas</div>'; return; }

  var typeLabels = { accident: '🚗💥 Accidente', robbery: '🔫 Robo / Asalto', breakdown: '🔧 Avería', help: '🆘 Auxilio', other: '⚠️ Otro' };
  var statusLabels = { active: '🔴 Activa', attending: '🟡 Atendiendo', resolved: '✅ Resuelta' };
  var statusBadges = { active: 'badge-active', attending: 'badge-completed', resolved: 'badge-completed' };

  alerts.forEach(function(a) {
    var date = new Date(a.created_at);
    var cardStyle = a.status === 'active' ? 'border-left:4px solid #ef4444;' : a.status === 'attending' ? 'border-left:4px solid #eab308;' : 'border-left:4px solid #22c55e;';
    list.innerHTML += '<div class="trip-card" style="' + cardStyle + '">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:0.5rem;">' +
        '<div>' +
          '<div class="card-title">' + (typeLabels[a.alert_type] || a.alert_type) + '</div>' +
          '<div class="card-meta">👤 ' + esc(a.person_name || a.device_name) + (a.phone ? ' · 📞 ' + esc(a.phone) : '') + '</div>' +
          (a.vehicle ? '<div class="card-meta">🚗 ' + esc(a.vehicle) + '</div>' : '') +
          (a.message ? '<div class="card-meta">💬 ' + esc(a.message) + '</div>' : '') +
          '<div class="card-meta">🕐 ' + date.toLocaleString('es-MX') + '</div>' +
        '</div>' +
        '<div><span class="card-badge ' + (statusBadges[a.status] || '') + '" style="' + (a.status === 'active' ? 'background:#fee2e2;color:#ef4444;' : '') + '">' + (statusLabels[a.status] || a.status) + '</span></div>' +
      '</div>' +
      '<div class="card-actions">' +
        (a.latitude ? '<button onclick="viewAlertOnMap(' + a.latitude + ',' + a.longitude + ',\'' + esc(a.person_name || a.device_name) + '\')" class="btn btn-accent2 btn-sm">🗺️ Ver ubicación</button>' : '') +
        (a.status === 'active' ? '<button onclick="updateAlert(' + a.id + ',\'attending\')" class="btn btn-primary btn-sm">🟡 Atender</button>' : '') +
        (a.status !== 'resolved' ? '<button onclick="updateAlert(' + a.id + ',\'resolved\')" class="btn btn-success btn-sm">✅ Resolver</button>' : '') +
        (a.phone ? '<a href="tel:' + esc(a.phone) + '" class="btn btn-secondary btn-sm">📞 Llamar</a>' : '') +
      '</div>' +
    '</div>';
  });
}

async function updateAlert(alertId, status) {
  await af(`${API_BASE}/api/alerts/${alertId}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: status }),
  });
  updateStatus('Alerta actualizada', 'success');
  loadAlerts();
  loadAlertCount();
}

function viewAlertOnMap(lat, lng, name) {
  document.querySelectorAll('.nav-item').forEach(function(n) { n.classList.remove('active'); });
  document.querySelectorAll('.page').forEach(function(p) { p.classList.remove('active'); });
  document.querySelectorAll('.nav-item')[1].classList.add('active');
  document.getElementById('page-map').classList.add('active');
  document.getElementById('page-title').textContent = 'Mapa';
  setTimeout(function() {
    initMap(); clearMarkers();
    var marker = L.marker([lat, lng]).addTo(leafletMap);
    marker.bindPopup('<strong>🚨 ' + esc(name) + '</strong><br>Alerta de emergencia').openPopup();
    mapMarkers.push(marker);
    leafletMap.setView([lat, lng], 16);
  }, 200);
}

// ============ SEARCH ============

function searchDevices() {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(async () => {
    const q = document.getElementById('search-input').value.trim();
    const results = document.getElementById('search-results');
    if (!q) { results.innerHTML = ''; return; }
    const res = await af(`${API_BASE}/api/devices/search?q=${encodeURIComponent(q)}`);
    const devices = await res.json();
    results.innerHTML = '';
    if (devices.length === 0) { results.innerHTML = '<div class="empty">Sin resultados</div>'; return; }
    devices.forEach(d => {
      results.innerHTML += `<div class="card" style="margin-bottom:0.75rem;">
        <div class="card-title">${esc(d.person_name || d.device_name)}</div>
        ${d.phone ? `<div class="card-meta">📞 ${esc(d.phone)}</div>` : ''}
        ${d.company ? `<div class="card-meta">🏢 ${esc(d.company)}</div>` : ''}
        ${d.vehicle ? `<div class="card-meta">🚗 ${esc(d.vehicle)}</div>` : ''}
        <div class="card-actions">
          <button onclick="trackDevice(${d.id})" class="btn btn-danger btn-sm">📍</button>
          <button onclick="viewOnMap(${d.id})" class="btn btn-accent2 btn-sm">🗺️</button>
          <button onclick="viewHistory(${d.id})" class="btn btn-secondary btn-sm">📋</button>
        </div>
      </div>`;
    });
  }, 300);
}

// ============ SETTINGS ============

async function loadSettings() {
  try {
    var res = await af(API_BASE + '/api/config');
    var cfg = await res.json();
    document.getElementById('cfg-enabled').value = String(cfg.autoTrackEnabled !== false);
    document.getElementById('cfg-interval').value = String(cfg.autoTrackInterval || 30);
    document.getElementById('cfg-status').textContent = 'Configuración cargada';
  } catch (e) { document.getElementById('cfg-status').textContent = 'Error cargando'; }
}

async function saveSettings() {
  var enabled = document.getElementById('cfg-enabled').value === 'true';
  var interval = parseInt(document.getElementById('cfg-interval').value);
  try {
    await af(API_BASE + '/api/config', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ autoTrackEnabled: enabled, autoTrackInterval: interval }),
    });
    document.getElementById('cfg-status').textContent = '✅ Guardado — ' + (enabled ? 'Activo cada ' + interval + ' min' : 'Desactivado');
    document.getElementById('cfg-status').style.color = enabled ? '#22c55e' : '#ef4444';
  } catch (e) { document.getElementById('cfg-status').textContent = 'Error guardando'; }
}

async function testAutoTrack() {
  document.getElementById('cfg-status').textContent = 'Enviando...';
  try {
    var res = await fetch(API_BASE + '/api/auto-track', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'trackmonk-auto-2026' }),
    });
    var data = await res.json();
    if (data.skipped) { document.getElementById('cfg-status').textContent = '⚠️ Auto-track desactivado'; }
    else { document.getElementById('cfg-status').textContent = '✅ Enviado: ' + data.sent + ' OK, ' + data.failed + ' fallidos de ' + data.total; }
    document.getElementById('cfg-status').style.color = '#22c55e';
  } catch (e) { document.getElementById('cfg-status').textContent = 'Error'; }
}

// ============ COMPANIES ============

async function loadCompanies() {
  var res = await af(API_BASE + '/api/companies');
  var companies = await res.json();
  var list = document.getElementById('companies-list');
  list.innerHTML = '';
  if (!companies.length) { list.innerHTML = '<div class="empty">No hay empresas</div>'; return; }
  companies.forEach(function(c) {
    var planLabels = { demo: '🆓 Demo', basic: '📦 Básico', pro: '⭐ Pro', enterprise: '🏆 Enterprise' };
    var planColors = { demo: 'background:#dbeafe;color:#1e40af;', basic: 'background:#dcfce7;color:#16a34a;', pro: 'background:#fef9c3;color:#a16207;', enterprise: 'background:#fce7f3;color:#9d174d;' };
    list.innerHTML += '<div class="card"><div class="card-title">' + esc(c.name) + ' <span class="card-badge" style="' + (planColors[c.plan]||'') + '">' + (planLabels[c.plan]||c.plan) + '</span></div>' +
      '<div class="card-meta">🔗 ' + esc(c.slug) + '</div>' +
      '<div class="card-meta">📱 ' + (c.max_devices || 0) + ' dispositivos máx</div>' +
      '<div class="card-meta">' + (c.auto_track_enabled ? '🟢 Auto-track cada ' + (c.auto_track_interval || 30) + ' min' : '⚪ Auto-track desactivado') + '</div>' +
      (c.contact_email ? '<div class="card-meta">📧 ' + esc(c.contact_email) + '</div>' : '') +
      (c.expires_at ? '<div class="card-meta">📅 Vence: ' + new Date(c.expires_at).toLocaleDateString('es-MX') + '</div>' : '') +
      (c.demo_until ? '<div class="card-meta">🆓 Demo hasta: ' + new Date(c.demo_until).toLocaleDateString('es-MX') + '</div>' : '') +
      '<div class="card-meta">' + (c.is_active ? '<span style="color:#22c55e;">● Activa</span>' : '<span style="color:#ef4444;">● Inactiva</span>') + '</div>' +
      '<div class="card-actions">' +
        '<button onclick="editCompany(' + c.id + ')" class="btn btn-secondary btn-sm">✏️ Editar</button>' +
        '<button onclick="deleteCompany(' + c.id + ',\'' + esc(c.name) + '\')" class="btn btn-danger btn-sm">🗑️</button>' +
      '</div></div>';
  });
}

function showNewCompanyForm() {
  showDetail('<h3>➕ Nueva empresa</h3>' +
    '<div class="form-group"><label>Nombre</label><input id="co-name"></div>' +
    '<div class="form-group"><label>Slug (URL única)</label><input id="co-slug" placeholder="ej: mi-empresa"></div>' +
    '<div class="form-row"><div class="form-group"><label>Email</label><input id="co-email"></div>' +
    '<div class="form-group"><label>Teléfono</label><input id="co-phone"></div></div>' +
    '<button onclick="createCompany()" class="btn btn-primary" style="width:100%;margin-top:0.5rem;">Crear</button>');
}

async function createCompany() {
  var res = await af(API_BASE + '/api/companies', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: document.getElementById('co-name').value, slug: document.getElementById('co-slug').value, contact_email: document.getElementById('co-email').value, contact_phone: document.getElementById('co-phone').value }),
  });
  var data = await res.json();
  if (data.success) { closeDetailDirect(); updateStatus('Empresa creada', 'success'); loadCompanies(); }
  else updateStatus('Error: ' + (data.error || ''), 'error');
}

async function deleteCompany(id, name) {
  if (!confirm('¿Eliminar empresa "' + name + '" y todos sus datos?')) return;
  await af(API_BASE + '/api/companies/' + id, { method: 'DELETE' });
  updateStatus('Empresa eliminada', 'success'); loadCompanies();
}

async function editCompany(id) {
  var res = await af(API_BASE + '/api/companies');
  var companies = await res.json();
  var c = companies.find(function(x) { return x.id === id; });
  if (!c) return;
  showDetail('<h3>✏️ Editar empresa</h3>' +
    '<div class="form-group"><label>Nombre</label><input id="co-name" value="' + esc(c.name) + '"></div>' +
    '<div class="form-row"><div class="form-group"><label>Email</label><input id="co-email" value="' + esc(c.contact_email || '') + '"></div>' +
    '<div class="form-group"><label>Teléfono</label><input id="co-phone" value="' + esc(c.contact_phone || '') + '"></div></div>' +
    '<div class="form-row"><div class="form-group"><label>Plan</label><select id="co-plan"><option value="demo"' + (c.plan==='demo'?' selected':'') + '>Demo</option><option value="basic"' + (c.plan==='basic'?' selected':'') + '>Básico ($299)</option><option value="pro"' + (c.plan==='pro'?' selected':'') + '>Pro ($799)</option><option value="enterprise"' + (c.plan==='enterprise'?' selected':'') + '>Enterprise ($1,999)</option></select></div>' +
    '<div class="form-group"><label>Máx dispositivos</label><input id="co-max" type="number" value="' + (c.max_devices || 2) + '"></div></div>' +
    '<div class="form-row"><div class="form-group"><label>Vence (plan)</label><input id="co-expires" type="date" value="' + (c.expires_at ? c.expires_at.substring(0,10) : '') + '"></div>' +
    '<div class="form-group"><label>Demo hasta</label><input id="co-demo-until" type="date" value="' + (c.demo_until ? c.demo_until.substring(0,10) : '') + '"></div></div>' +
    '<div class="form-group"><label>Activa</label><select id="co-active"><option value="1"' + (c.is_active?' selected':'') + '>Sí</option><option value="0"' + (!c.is_active?' selected':'') + '>No</option></select></div>' +
    '<div style="margin-top:1rem;padding-top:1rem;border-top:1px solid #e0e0e0;"><h4 style="margin-bottom:0.5rem;">📍 Auto-Track</h4></div>' +
    '<div class="form-row"><div class="form-group"><label>Auto-track</label><select id="co-autotrack"><option value="1"' + (c.auto_track_enabled?' selected':'') + '>✅ Activado</option><option value="0"' + (!c.auto_track_enabled?' selected':'') + '>❌ Desactivado</option></select></div>' +
    '<div class="form-group"><label>Intervalo (min)</label><select id="co-autointerval"><option value="5"' + (c.auto_track_interval==5?' selected':'') + '>5 min</option><option value="10"' + (c.auto_track_interval==10?' selected':'') + '>10 min</option><option value="15"' + (c.auto_track_interval==15?' selected':'') + '>15 min</option><option value="30"' + ((c.auto_track_interval==30||!c.auto_track_interval)?' selected':'') + '>30 min</option><option value="60"' + (c.auto_track_interval==60?' selected':'') + '>1 hora</option><option value="120"' + (c.auto_track_interval==120?' selected':'') + '>2 horas</option></select></div></div>' +
    '<button onclick="saveCompany(' + id + ')" class="btn btn-primary" style="width:100%;margin-top:0.5rem;">Guardar</button>');
}

async function saveCompany(id) {
  await af(API_BASE + '/api/companies/' + id, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: document.getElementById('co-name').value,
      contact_email: document.getElementById('co-email').value,
      contact_phone: document.getElementById('co-phone').value,
      plan: document.getElementById('co-plan').value,
      max_devices: parseInt(document.getElementById('co-max').value) || 2,
      expires_at: document.getElementById('co-expires').value || null,
      demo_until: document.getElementById('co-demo-until').value || null,
      is_active: parseInt(document.getElementById('co-active').value),
      auto_track_enabled: parseInt(document.getElementById('co-autotrack').value),
      auto_track_interval: parseInt(document.getElementById('co-autointerval').value) || 30,
    }),
  });
  closeDetailDirect(); updateStatus('Empresa actualizada', 'success'); loadCompanies();
}

// ============ USERS ============

async function loadUsers() {
  var res = await af(API_BASE + '/api/users');
  var users = await res.json();
  var list = document.getElementById('users-list');
  list.innerHTML = '';
  if (!users.length) { list.innerHTML = '<div class="empty">No hay usuarios</div>'; return; }
  users.forEach(function(u) {
    var roleBadge = u.role === 'super_admin' ? '<span class="card-badge" style="background:#fee2e2;color:#ef4444;">Super Admin</span>' : '<span class="card-badge badge-active">Admin Empresa</span>';
    list.innerHTML += '<div class="card"><div class="card-title">' + esc(u.name) + ' ' + roleBadge + '</div>' +
      '<div class="card-meta">👤 ' + esc(u.username) + '</div>' +
      (u.company_name ? '<div class="card-meta">🏢 ' + esc(u.company_name) + '</div>' : '') +
      '<div class="card-meta">' + (u.is_active ? '<span style="color:#22c55e;">● Activo</span>' : '<span style="color:#ef4444;">● Inactivo</span>') + '</div>' +
      '<div class="card-actions">' +
        (u.role !== 'super_admin' ? '<button onclick="deleteUser(' + u.id + ',\'' + esc(u.name) + '\')" class="btn btn-danger btn-sm">🗑️</button>' : '') +
      '</div></div>';
  });
}

function showNewUserForm() {
  // Cargar empresas para el select
  af(API_BASE + '/api/companies').then(function(r) { return r.json(); }).then(function(companies) {
    var opts = companies.map(function(c) { return '<option value="' + c.id + '">' + esc(c.name) + '</option>'; }).join('');
    showDetail('<h3>➕ Nuevo usuario</h3>' +
      '<div class="form-group"><label>Nombre</label><input id="usr-name"></div>' +
      '<div class="form-group"><label>Usuario</label><input id="usr-username"></div>' +
      '<div class="form-group"><label>Contraseña</label><input id="usr-password" type="password"></div>' +
      '<div class="form-group"><label>Empresa</label><select id="usr-company">' + opts + '</select></div>' +
      '<div class="form-group"><label>Rol</label><select id="usr-role"><option value="driver">Conductor</option><option value="company_admin">Admin Empresa</option>' + (currentRole === 'super_admin' ? '<option value="super_admin">Super Admin</option>' : '') + '</select></div>' +
      '<button onclick="createUser()" class="btn btn-primary" style="width:100%;margin-top:0.5rem;">Crear</button>');
  });
}

async function createUser() {
  var res = await af(API_BASE + '/api/users', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: document.getElementById('usr-name').value, username: document.getElementById('usr-username').value, password: document.getElementById('usr-password').value, company_id: document.getElementById('usr-company').value, role: document.getElementById('usr-role').value }),
  });
  var data = await res.json();
  if (data.success) { closeDetailDirect(); updateStatus('Usuario creado', 'success'); loadUsers(); }
  else updateStatus('Error: ' + (data.error || ''), 'error');
}

async function deleteUser(id, name) {
  if (!confirm('¿Eliminar usuario "' + name + '"?')) return;
  await af(API_BASE + '/api/users/' + id, { method: 'DELETE' });
  updateStatus('Usuario eliminado', 'success'); loadUsers();
}

// ============ DETAIL PANEL ============

function showDetail(html) {
  document.getElementById('detail-panel').innerHTML = html;
  document.getElementById('detail-overlay').style.display = 'flex';
}

function closeDetail(event) {
  if (event.target === document.getElementById('detail-overlay')) closeDetailDirect();
}

function closeDetailDirect() {
  document.getElementById('detail-overlay').style.display = 'none';
}

// ============ HELPERS ============

function esc(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ============ EXPORT CSV ============

function downloadCSV(filename, csvContent) {
  var blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
  var link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
}

function exportTripCosts(tripId) {
  var t = window._currentTrip;
  if (!t) return;
  var csv = 'Concepto,Fecha,Monto\n';
  (t.costs || []).forEach(function(c) {
    csv += '"' + (c.concept||'').replace(/"/g,'""') + '","' + new Date(c.created_at).toLocaleString('es-MX') + '",$' + parseFloat(c.amount).toFixed(2) + '\n';
  });
  csv += '\n,TOTAL,$' + parseFloat(t.total_cost || 0).toFixed(2) + '\n';
  downloadCSV('gastos-viaje-' + tripId + '.csv', csv);
}

function exportTripFull(tripId) {
  var t = window._currentTrip;
  if (!t) return;
  var csv = 'REPORTE DE VIAJE #' + t.id + '\n';
  csv += 'Conductor,"' + (t.person_name || t.device_name) + '"\n';
  csv += 'Vehículo,"' + (t.vehicle || '') + '"\n';
  csv += 'Origen,"' + t.origin + '"\n';
  csv += 'Destino,"' + t.destination + '"\n';
  csv += 'Carga,"' + (t.cargo || '') + '"\n';
  csv += 'Estado,' + t.status + '\n';
  csv += 'Inicio,"' + new Date(t.started_at).toLocaleString('es-MX') + '"\n';
  csv += 'Fin,"' + (t.completed_at ? new Date(t.completed_at).toLocaleString('es-MX') : 'En curso') + '"\n';
  csv += 'Costo Total,$' + parseFloat(t.total_cost || 0).toFixed(2) + '\n';
  csv += '\nGASTOS\nConcepto,Fecha,Monto\n';
  (t.costs || []).forEach(function(c) {
    csv += '"' + (c.concept||'').replace(/"/g,'""') + '","' + new Date(c.created_at).toLocaleString('es-MX') + '",$' + parseFloat(c.amount).toFixed(2) + '\n';
  });
  csv += '\nUBICACIONES\nLatitud,Longitud,Fecha\n';
  (t.locations || []).forEach(function(l) {
    csv += l.latitude + ',' + l.longitude + ',"' + new Date(l.recorded_at).toLocaleString('es-MX') + '"\n';
  });
  downloadCSV('reporte-viaje-' + tripId + '.csv', csv);
}

function exportAlerts() {
  var typeLabels = { accident: 'Accidente', robbery: 'Robo/Asalto', breakdown: 'Avería', help: 'Auxilio', other: 'Otro' };
  af(API_BASE + '/api/alerts?status=' + (document.getElementById('alert-filter').value || '')).then(function(r) { return r.json(); }).then(function(alerts) {
    var csv = 'ID,Tipo,Persona,Teléfono,Vehículo,Mensaje,Latitud,Longitud,Estado,Fecha,Resuelto por\n';
    alerts.forEach(function(a) {
      csv += a.id + ',"' + (typeLabels[a.alert_type]||a.alert_type) + '","' + (a.person_name||a.device_name) + '","' + (a.phone||'') + '","' + (a.vehicle||'') + '","' + (a.message||'').replace(/"/g,'""') + '",' + (a.latitude||'') + ',' + (a.longitude||'') + ',' + a.status + ',"' + new Date(a.created_at).toLocaleString('es-MX') + '","' + (a.resolved_by||'') + '"\n';
    });
    downloadCSV('alertas.csv', csv);
  });
}

function exportDevices() {
  var csv = 'ID,Nombre,Persona,Teléfono,Vehículo,Empresa,Registrado\n';
  allDevices.forEach(function(d) {
    csv += d.id + ',"' + (d.device_name||'') + '","' + (d.person_name||'') + '","' + (d.phone||'') + '","' + (d.vehicle||'') + '","' + (d.company_name||'') + '","' + new Date(d.created_at).toLocaleString('es-MX') + '"\n';
  });
  downloadCSV('dispositivos.csv', csv);
}

document.addEventListener('DOMContentLoaded', init);
