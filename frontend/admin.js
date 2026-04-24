let leafletMap = null;
let mapMarkers = [];
let searchTimeout = null;
let adminToken = sessionStorage.getItem('adminToken') || '';
let allDevices = [];

// ============ AUTH ============

async function adminLogin() {
  const password = document.getElementById('admin-password').value;
  if (!password) return;
  try {
    const res = await fetch(`${API_BASE}/api/admin/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    const data = await res.json();
    if (data.success) {
      adminToken = data.token;
      sessionStorage.setItem('adminToken', adminToken);
      document.getElementById('login-page').style.display = 'none';
      document.getElementById('dashboard').style.display = 'flex';
      loadDevices();
    } else { setStatus('login', 'Contraseña incorrecta', 'error'); }
  } catch (err) { setStatus('login', 'Error de conexión', 'error'); }
}

function adminLogout() {
  sessionStorage.removeItem('adminToken');
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
        loadDevices();
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
    { devices: 'Dispositivos', map: 'Mapa', trips: 'Viajes', search: 'Buscar' }[page];
  closeDetailDirect();
  if (page === 'map') setTimeout(() => { initMap(); loadAllOnMap(); }, 100);
  if (page === 'trips') loadTrips();
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
            <button onclick="viewOnMap(${d.id})" class="btn btn-secondary btn-sm">🗺️ Mapa</button>
            <button onclick="viewHistory(${d.id})" class="btn btn-secondary btn-sm">📋</button>
            <button onclick="editDevice(${d.id})" class="btn btn-secondary btn-sm">✏️</button>
          </div>
        </div>`;
    });
    if (allDevices.length === 0) list.innerHTML = '<div class="empty">No hay dispositivos registrados</div>';
    updateStatus(`${allDevices.length} dispositivos`, 'info');
  } catch (err) { updateStatus('Error cargando', 'error'); }
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

// ============ TRACKING ============

async function trackAll() {
  updateStatus('Enviando push a todos...', 'warning');
  const res = await af(`${API_BASE}/api/track-all`, { method: 'POST' });
  const data = await res.json();
  if (data.success) {
    updateStatus(`Push: ${data.sent} OK, ${data.failed} fallidos`, 'success');
    setTimeout(() => { navigate.call(document.querySelectorAll('.nav-item')[1], 'map'); }, 8000);
  } else updateStatus('Error', 'error');
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
  leafletMap = L.map('map').setView([19.4326, -99.1332], 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(leafletMap);
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
  const res = await af(`${API_BASE}/api/trips/${tripId}`);
  const t = await res.json();
  let costsHtml = '';
  if (t.costs && t.costs.length > 0) {
    costsHtml = '<table><tr><th>Concepto</th><th>Monto</th><th></th></tr>';
    t.costs.forEach(c => {
      costsHtml += `<tr><td>${esc(c.concept)}</td><td>$${parseFloat(c.amount).toFixed(2)}</td>
        <td><button onclick="deleteCost(${c.id},${tripId})" class="btn btn-secondary btn-sm">🗑️</button></td></tr>`;
    });
    costsHtml += '</table>';
  }
  showDetail(`
    <h3>📋 Viaje #${t.id}</h3>
    <div class="card-meta">👤 ${esc(t.person_name || t.device_name)} ${t.vehicle ? '· 🚗 ' + esc(t.vehicle) : ''}</div>
    <div class="trip-route" style="margin:0.75rem 0;">
      <span class="dot dot-start"></span><span>${esc(t.origin)}</span>
      <span class="line"></span><span>${esc(t.destination)}</span><span class="dot dot-end"></span>
    </div>
    ${t.cargo ? `<div class="card-meta">📦 ${esc(t.cargo)}</div>` : ''}
    ${t.notes ? `<div class="card-meta">📝 ${esc(t.notes)}</div>` : ''}
    <div style="margin:1rem 0;padding:1rem;background:var(--bg);border-radius:8px;text-align:center;">
      <div style="font-size:0.8rem;color:var(--text2);">Costo total</div>
      <div style="font-size:1.5rem;font-weight:700;color:#fff;">$${parseFloat(t.total_cost || 0).toLocaleString('es-MX', {minimumFractionDigits:2})}</div>
    </div>
    ${costsHtml}
    <div style="margin-top:1rem;padding-top:0.75rem;border-top:1px solid var(--border);">
      <div style="font-size:0.85rem;font-weight:600;color:#fff;margin-bottom:0.5rem;">Agregar costo</div>
      <div class="form-row">
        <div class="form-group"><label>Concepto</label><input id="cost-concept" placeholder="Ej: Gasolina, Caseta..."></div>
        <div class="form-group"><label>Monto $</label><input id="cost-amount" type="number" step="0.01" placeholder="0.00"></div>
      </div>
      <button onclick="addCost(${tripId})" class="btn btn-primary btn-sm">Agregar</button>
    </div>
    <div style="margin-top:1rem;">
      <div class="card-meta">${t.locations ? t.locations.length : 0} ubicaciones registradas</div>
      <button onclick="viewTripOnMap(${tripId});closeDetailDirect();" class="btn btn-accent2" style="width:100%;margin-top:0.5rem;">🗺️ Ver recorrido</button>
    </div>
  `);
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

document.addEventListener('DOMContentLoaded', init);
