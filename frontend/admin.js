// ============================================================
// TrackMonk Admin - v2 Clean Rewrite
// ============================================================

var adminToken = sessionStorage.getItem('adminToken') || '';
var currentRole = sessionStorage.getItem('adminRole') || '';
var allDevices = [];
var leafletMap = null;
var mapMarkers = [];
var searchTimeout = null;

// ============ HELPERS ============

function esc(t) { if (!t) return ''; var d = document.createElement('div'); d.textContent = t; return d.innerHTML; }

function af(url, opts) {
  opts = opts || {};
  opts.headers = opts.headers || {};
  opts.headers['x-admin-token'] = adminToken;
  return fetch(url, opts);
}

function updateStatus(msg, type) {
  var el = document.getElementById('status');
  el.textContent = msg || '';
  el.className = 'status status-' + (type || 'info');
}

function showDetail(html) {
  document.getElementById('detail-panel').innerHTML = html;
  document.getElementById('detail-overlay').style.display = 'flex';
}

function closeDetail(e) { if (e.target === document.getElementById('detail-overlay')) closeDetailDirect(); }
function closeDetailDirect() { document.getElementById('detail-overlay').style.display = 'none'; }

function toggleSidebar() { document.querySelector('.sidebar').classList.toggle('open'); }

function downloadCSV(filename, csv) {
  var blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

// ============ AUTH ============

async function adminLogin() {
  var username = document.getElementById('admin-username').value.trim();
  var password = document.getElementById('admin-password').value;
  if (!username || !password) return;
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
      sessionStorage.setItem('adminRole', currentRole);
      showDashboard();
    } else {
      document.getElementById('status-login').textContent = 'Credenciales inválidas';
      document.getElementById('status-login').className = 'status status-error';
    }
  } catch (e) {
    document.getElementById('status-login').textContent = 'Error de conexión';
    document.getElementById('status-login').className = 'status status-error';
  }
}

function adminLogout() {
  sessionStorage.clear();
  adminToken = '';
  currentRole = '';
  location.reload();
}

function showDashboard() {
  document.getElementById('login-page').style.display = 'none';
  document.getElementById('dashboard').style.display = 'flex';
  if (currentRole === 'super_admin') {
    document.querySelectorAll('.nav-super').forEach(function(el) { el.style.display = 'flex'; });
  }
  loadDashboard();
  loadDevices();
  loadAlertCount();
}

// ============ INIT ============

function init() {
  if (adminToken) {
    af(API_BASE + '/api/devices').then(function(r) {
      if (r.ok) { showDashboard(); }
      else { sessionStorage.clear(); adminToken = ''; }
    }).catch(function() {});
  }
}

// ============ NAVIGATION ============

function navigate(page) {
  document.querySelectorAll('.nav-item').forEach(function(n) { n.classList.remove('active'); });
  document.querySelectorAll('.page').forEach(function(p) { p.classList.remove('active'); });
  if (event && event.currentTarget) event.currentTarget.classList.add('active');
  var pageEl = document.getElementById('page-' + page);
  if (pageEl) pageEl.classList.add('active');
  var titles = { dashboard:'Dashboard', devices:'Dispositivos', map:'Mapa', trips:'Viajes', alerts:'Alertas', search:'Buscar', companies:'Empresas', users:'Usuarios', settings:'Configuración' };
  document.getElementById('page-title').textContent = titles[page] || page;
  closeDetailDirect();
  document.querySelector('.sidebar').classList.remove('open');

  if (page === 'dashboard') loadDashboard();
  if (page === 'map') setTimeout(function() { initMap(); loadAllOnMap(); }, 150);
  if (page === 'trips') loadTrips();
  if (page === 'alerts') loadAlerts();
  if (page === 'companies') loadCompanies();
  if (page === 'users') loadUsers();
  if (page === 'settings') loadSettings();
}

// ============ DASHBOARD ============

async function loadDashboard() {
  try {
    var res = await af(API_BASE + '/api/metrics');
    var m = await res.json();
    var metrics = document.getElementById('dashboard-metrics');
    metrics.innerHTML =
      '<div class="card" style="text-align:center;"><div style="font-size:2rem;font-weight:800;color:#111;">' + m.devices + '</div><div class="card-meta">Dispositivos</div></div>' +
      '<div class="card" style="text-align:center;"><div style="font-size:2rem;font-weight:800;color:#22c55e;">' + m.devicesWithPush + '</div><div class="card-meta">Con push activo</div></div>' +
      '<div class="card" style="text-align:center;"><div style="font-size:2rem;font-weight:800;color:#ef4444;">' + m.alertsActive + '</div><div class="card-meta">Alertas activas</div></div>' +
      '<div class="card" style="text-align:center;"><div style="font-size:2rem;font-weight:800;color:#3b82f6;">' + m.tripsActive + '</div><div class="card-meta">Viajes activos</div></div>' +
      '<div class="card" style="text-align:center;"><div style="font-size:2rem;font-weight:800;color:#111;">' + m.tripsMonth + '</div><div class="card-meta">Viajes (30 días)</div></div>' +
      '<div class="card" style="text-align:center;"><div style="font-size:2rem;font-weight:800;color:#111;">$' + m.costsMonth.toLocaleString('es-MX',{minimumFractionDigits:0}) + '</div><div class="card-meta">Gastos (30 días)</div></div>' +
      '<div class="card" style="text-align:center;"><div style="font-size:2rem;font-weight:800;color:#22c55e;">' + m.locationsToday + '</div><div class="card-meta">Ubicaciones hoy</div></div>';

    // Alertas recientes
    var alertRes = await af(API_BASE + '/api/alerts/recent');
    var alerts = await alertRes.json();
    var dashAlerts = document.getElementById('dash-alerts');
    if (!alerts.length) { dashAlerts.innerHTML = '<p class="card-meta">Sin alertas recientes</p>'; }
    else {
      var typeIcons = { accident:'🚗💥', robbery:'🔫', breakdown:'🔧', help:'🆘', other:'⚠️' };
      dashAlerts.innerHTML = '';
      alerts.forEach(function(a) {
        var dt = new Date(a.created_at);
        var statusColor = a.status==='active'?'#ef4444':a.status==='attending'?'#eab308':'#22c55e';
        dashAlerts.innerHTML += '<div style="display:flex;justify-content:space-between;align-items:center;padding:0.4rem 0;border-bottom:1px solid #eee;font-size:0.85rem;">' +
          '<span>' + (typeIcons[a.alert_type]||'⚠️') + ' ' + esc(a.person_name||a.device_name) + '</span>' +
          '<span style="color:' + statusColor + ';font-size:0.75rem;">' + dt.toLocaleDateString('es-MX',{day:'numeric',month:'short'}) + '</span></div>';
      });
    }

    // Viajes activos
    var tripRes = await af(API_BASE + '/api/trips/active');
    var trips = await tripRes.json();
    var dashTrips = document.getElementById('dash-trips');
    if (!trips.length) { dashTrips.innerHTML = '<p class="card-meta">Sin viajes activos</p>'; }
    else {
      dashTrips.innerHTML = '';
      trips.forEach(function(t) {
        dashTrips.innerHTML += '<div style="padding:0.4rem 0;border-bottom:1px solid #eee;font-size:0.85rem;">' +
          '<div style="font-weight:600;">' + esc(t.person_name||t.device_name) + '</div>' +
          '<div class="card-meta">' + esc(t.origin) + ' → ' + esc(t.destination) + '</div></div>';
      });
    }
  } catch (e) { updateStatus('Error cargando dashboard', 'error'); }
}

// ============ DEVICES ============

async function loadDevices() {
  try {
    var res = await af(API_BASE + '/api/devices');
    allDevices = await res.json();
    var list = document.getElementById('devices-list');
    list.innerHTML = '';
    allDevices.forEach(function(d) {
      list.innerHTML += '<div class="card">' +
        '<div class="card-title">' + esc(d.person_name || d.device_name) + '</div>' +
        (d.phone ? '<div class="card-meta">📞 ' + esc(d.phone) + '</div>' : '') +
        (d.company_name ? '<div class="card-meta">🏢 ' + esc(d.company_name) + '</div>' : '') +
        (d.vehicle ? '<div class="card-meta">🚗 ' + esc(d.vehicle) + '</div>' : '') +
        '<div class="card-meta" style="color:#aaa;">' + esc(d.device_name) + ' · ID ' + d.id + '</div>' +
        '<div class="card-actions">' +
          '<button onclick="trackDevice(' + d.id + ')" class="btn btn-danger btn-sm">📍 Trackear</button>' +
          '<button onclick="sendMessage(' + d.id + ')" class="btn btn-accent2 btn-sm">💬</button>' +
          '<button onclick="viewOnMap(' + d.id + ')" class="btn btn-secondary btn-sm">🗺️</button>' +
          '<button onclick="viewHistory(' + d.id + ')" class="btn btn-secondary btn-sm">📋</button>' +
          '<button onclick="editDevice(' + d.id + ')" class="btn btn-secondary btn-sm">✏️</button>' +
          '<button onclick="deleteDevice(' + d.id + ')" class="btn btn-danger btn-sm">🗑️</button>' +
        '</div></div>';
    });
    if (!allDevices.length) list.innerHTML = '<div class="empty">No hay dispositivos</div>';
    updateStatus(allDevices.length + ' dispositivos', 'info');
    // Update map filter
    var sel = document.getElementById('map-device-filter');
    if (sel && sel.options.length <= 1) {
      allDevices.forEach(function(d) {
        var o = document.createElement('option');
        o.value = d.id;
        o.textContent = (d.person_name || d.device_name) + (d.vehicle ? ' - ' + d.vehicle : '');
        sel.appendChild(o);
      });
    }
  } catch (e) { updateStatus('Error cargando', 'error'); }
}

async function deleteDevice(id) {
  var d = allDevices.find(function(x) { return x.id === id; });
  if (!confirm('¿Eliminar "' + (d ? d.person_name || d.device_name : id) + '" y todo su historial?')) return;
  await af(API_BASE + '/api/devices/' + id, { method: 'DELETE' });
  updateStatus('Eliminado', 'success');
  loadDevices();
}

async function editDevice(id) {
  var res = await af(API_BASE + '/api/devices/' + id);
  var d = await res.json();
  if (!d) return;
  showDetail(
    '<h3>✏️ Editar dispositivo</h3>' +
    '<div class="form-group"><label>Dispositivo</label><input id="ed-name" value="' + esc(d.device_name || '') + '"></div>' +
    '<div class="form-group"><label>Persona</label><input id="ed-person" value="' + esc(d.person_name || '') + '"></div>' +
    '<div class="form-row"><div class="form-group"><label>Teléfono</label><input id="ed-phone" value="' + esc(d.phone || '') + '"></div>' +
    '<div class="form-group"><label>Vehículo</label><input id="ed-vehicle" value="' + esc(d.vehicle || '') + '"></div></div>' +
    '<button onclick="saveDevice(' + id + ')" class="btn btn-primary" style="width:100%;margin-top:0.5rem;">Guardar</button>'
  );
}

async function saveDevice(id) {
  await af(API_BASE + '/api/devices/' + id, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_name: document.getElementById('ed-name').value, person_name: document.getElementById('ed-person').value, phone: document.getElementById('ed-phone').value, vehicle: document.getElementById('ed-vehicle').value }),
  });
  closeDetailDirect(); updateStatus('Actualizado', 'success'); loadDevices();
}

async function viewHistory(deviceId) {
  var res = await af(API_BASE + '/api/locations/' + deviceId + '?limit=100');
  var locations = await res.json();
  var d = allDevices.find(function(x) { return x.id === deviceId; }) || {};
  var html = '<h3>📋 ' + esc(d.person_name || d.device_name) + '</h3>';
  if (!locations.length) { html += '<div class="empty">Sin historial</div>'; showDetail(html); return; }
  html += '<p class="card-meta">' + locations.length + ' registros</p>';
  locations.forEach(function(loc, i) {
    var dt = new Date(loc.recorded_at);
    var latest = i === 0;
    html += '<div class="history-item' + (latest ? ' history-latest' : '') + '"><div>' +
      '<span style="color:' + (latest ? '#22c55e' : '#999') + '">' + (latest ? '🔴 ÚLTIMA' : '📌') + '</span> ' +
      dt.toLocaleDateString('es-MX', {weekday:'short',day:'numeric',month:'short'}) + ' <span style="color:#888">' + dt.toLocaleTimeString('es-MX') + '</span></div>' +
      '<a href="https://www.google.com/maps?q=' + loc.latitude + ',' + loc.longitude + '" target="_blank">🗺️</a></div>';
  });
  html += '<button onclick="viewOnMap(' + deviceId + ');closeDetailDirect();" class="btn btn-accent2" style="width:100%;margin-top:0.75rem;">🗺️ Ver en mapa</button>';
  showDetail(html);
}

async function sendMessage(deviceId) {
  var d = allDevices.find(function(x) { return x.id === deviceId; }) || {};
  showDetail(
    '<h3>💬 Mensaje a ' + esc(d.person_name || d.device_name) + '</h3>' +
    '<div class="form-group"><label>Título</label><input id="msg-title" value="TrackMonk"></div>' +
    '<div class="form-group"><label>Mensaje</label><input id="msg-body" placeholder="Escribe..."></div>' +
    '<button onclick="doSendMessage(' + deviceId + ')" class="btn btn-accent2" style="width:100%;margin-top:0.5rem;">Enviar</button>'
  );
}

async function doSendMessage(deviceId) {
  var title = document.getElementById('msg-title').value.trim() || 'TrackMonk';
  var body = document.getElementById('msg-body').value.trim();
  if (!body) { updateStatus('Escribe un mensaje', 'error'); return; }
  var res = await af(API_BASE + '/api/push-message/' + deviceId, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: title, body: body }),
  });
  var data = await res.json();
  if (data.success) { closeDetailDirect(); updateStatus('Enviado ✓', 'success'); }
  else updateStatus('Error: ' + (data.error || ''), 'error');
}

function exportDevices() {
  var csv = 'ID,Nombre,Persona,Teléfono,Vehículo,Empresa,Registrado\n';
  allDevices.forEach(function(d) {
    csv += d.id + ',"' + (d.device_name||'') + '","' + (d.person_name||'') + '","' + (d.phone||'') + '","' + (d.vehicle||'') + '","' + (d.company_name||'') + '","' + new Date(d.created_at).toLocaleString('es-MX') + '"\n';
  });
  downloadCSV('dispositivos.csv', csv);
}

// ============ TRACKING ============

async function trackDevice(id) {
  updateStatus('Enviando push...', 'warning');
  try {
    var res = await af(API_BASE + '/api/track/' + id, { method: 'POST' });
    var data = await res.json();
    if (data.success) { updateStatus('Push enviado, esperando...', 'success'); pollStatus(data.requestId, id); }
    else updateStatus('Error: ' + (data.error || ''), 'error');
  } catch (e) { updateStatus('Error: ' + e.message, 'error'); }
}

async function trackAll() {
  updateStatus('Enviando push a todos...', 'warning');
  var res = await af(API_BASE + '/api/track-all', { method: 'POST' });
  var data = await res.json();
  if (!data.success) { updateStatus('Error', 'error'); return; }
  var html = '<h3>📍 Trackeo masivo</h3>';
  html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.5rem;margin-bottom:1rem;text-align:center;">';
  html += '<div style="background:#dcfce7;padding:0.75rem;border-radius:8px;"><div style="font-size:1.3rem;font-weight:700;color:#16a34a;">' + data.sent + '</div><div style="font-size:0.75rem;color:#666;">Enviados</div></div>';
  html += '<div style="background:#fee2e2;padding:0.75rem;border-radius:8px;"><div style="font-size:1.3rem;font-weight:700;color:#ef4444;">' + data.failed + '</div><div style="font-size:0.75rem;color:#666;">Fallidos</div></div>';
  html += '<div style="background:#fef9c3;padding:0.75rem;border-radius:8px;"><div style="font-size:1.3rem;font-weight:700;color:#a16207;">' + data.noPush + '</div><div style="font-size:0.75rem;color:#666;">Sin push</div></div>';
  html += '</div>';
  data.results.forEach(function(r) {
    var color = r.status === 'sent' ? '#a16207' : r.status === 'failed' ? '#ef4444' : '#999';
    var label = r.status === 'sent' ? '⏳ Esperando' : r.status === 'failed' ? '❌ Falló' : '⚠️ Sin push';
    html += '<div id="tr-' + r.id + '" style="display:flex;justify-content:space-between;padding:0.4rem 0;border-bottom:1px solid #eee;font-size:0.85rem;"><span>' + esc(r.name) + '</span><span class="tr-st" style="color:' + color + ';">' + label + '</span></div>';
  });
  html += '<button onclick="closeDetailDirect()" class="btn btn-secondary" style="width:100%;margin-top:1rem;">Cerrar</button>';
  showDetail(html);
  // Poll
  var ids = data.results.filter(function(r) { return r.requestId; }).map(function(r) { return r.requestId; });
  if (ids.length) pollTrackAll(ids, data.results);
}

function pollStatus(requestId, deviceId) {
  var attempts = 0;
  var iv = setInterval(async function() {
    attempts++;
    try {
      var res = await af(API_BASE + '/api/track-status/' + requestId);
      var data = await res.json();
      if (data && data.status === 'received' && data.latitude) {
        clearInterval(iv); updateStatus('Ubicación recibida ✓', 'success');
        viewOnMap(deviceId);
      } else if (attempts >= 30) {
        clearInterval(iv); updateStatus('Sin respuesta (30s)', 'warning');
      }
    } catch (e) {}
  }, 1000);
}

function pollTrackAll(ids, results) {
  var attempts = 0;
  var resolved = {};
  var iv = setInterval(async function() {
    attempts++;
    try {
      var res = await af(API_BASE + '/api/track-all/check', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestIds: ids }),
      });
      var statuses = await res.json();
      statuses.forEach(function(s) {
        if (s.status === 'received' && !resolved[s.requestId]) {
          resolved[s.requestId] = true;
          var el = document.getElementById('tr-' + s.device_id);
          if (el) { var sp = el.querySelector('.tr-st'); if (sp) { sp.textContent = '✅ Respondió'; sp.style.color = '#16a34a'; } }
        }
      });
      var count = Object.keys(resolved).length;
      updateStatus('Trackeo: ' + count + '/' + ids.length + ' respondieron', 'success');
      if (count >= ids.length || attempts >= 30) {
        clearInterval(iv);
        results.forEach(function(r) {
          if (r.requestId && !resolved[r.requestId]) {
            var el = document.getElementById('tr-' + r.id);
            if (el) { var sp = el.querySelector('.tr-st'); if (sp) { sp.textContent = '⏰ Sin respuesta'; sp.style.color = '#ef4444'; } }
          }
        });
      }
    } catch (e) {}
  }, 2000);
}

// ============ MAP ============

function initMap() {
  if (leafletMap) { leafletMap.invalidateSize(); return; }
  var el = document.getElementById('map');
  if (!el) return;
  leafletMap = L.map('map').setView([19.4326, -99.1332], 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(leafletMap);
  setTimeout(function() { if (leafletMap) leafletMap.invalidateSize(); }, 500);
}

function clearMarkers() { mapMarkers.forEach(function(m) { leafletMap.removeLayer(m); }); mapMarkers = []; }

async function loadAllOnMap() {
  initMap();
  // Set default dates
  var today = new Date();
  var twoDaysAgo = new Date(today.getTime() - 2*24*60*60*1000);
  var fromEl = document.getElementById('map-date-from');
  var toEl = document.getElementById('map-date-to');
  if (fromEl && !fromEl.value) fromEl.value = twoDaysAgo.toISOString().split('T')[0];
  if (toEl && !toEl.value) toEl.value = today.toISOString().split('T')[0];

  try {
    var res = await af(API_BASE + '/api/locations-all/latest');
    var data = await res.json();
    clearMarkers();
    if (!data.length) { updateStatus('Sin ubicaciones', 'warning'); return; }
    var bounds = [];
    data.forEach(function(d) {
      var m = L.marker([d.latitude, d.longitude]).addTo(leafletMap);
      m.bindPopup('<strong>' + esc(d.person_name || d.device_name) + '</strong><br>' +
        (d.phone ? '📞 ' + esc(d.phone) + '<br>' : '') +
        (d.vehicle ? '🚗 ' + esc(d.vehicle) + '<br>' : '') +
        '🕐 ' + new Date(d.recorded_at).toLocaleString('es-MX'));
      m.bindTooltip(esc(d.person_name || d.device_name) + (d.vehicle ? ' - ' + esc(d.vehicle) : ''), { permanent: true, direction: 'top', offset: [0, -10], className: 'map-label' });
      mapMarkers.push(m);
      bounds.push([d.latitude, d.longitude]);
    });
    leafletMap.fitBounds(bounds, { padding: [30, 30] });
    updateStatus(data.length + ' en mapa', 'success');
  } catch (e) { updateStatus('Error cargando mapa', 'error'); }
}

function viewOnMap(deviceId) {
  var sel = document.getElementById('map-device-filter');
  if (sel) sel.value = deviceId;
  filterMapByDevice();
}

async function filterMapByDevice() {
  var sel = document.getElementById('map-device-filter');
  var deviceId = sel ? sel.value : 'all';
  var from = document.getElementById('map-date-from').value;
  var to = document.getElementById('map-date-to').value;

  // Switch to map page
  document.querySelectorAll('.nav-item').forEach(function(n) { n.classList.remove('active'); });
  document.querySelectorAll('.page').forEach(function(p) { p.classList.remove('active'); });
  document.querySelectorAll('.nav-item')[1].classList.add('active');
  document.getElementById('page-map').classList.add('active');
  document.getElementById('page-title').textContent = 'Mapa';

  setTimeout(async function() {
    initMap(); clearMarkers();
    if (deviceId === 'all') { loadAllOnMap(); return; }

    try {
      var url = API_BASE + '/api/locations/' + deviceId + '?limit=200';
      if (from) url += '&from=' + from;
      if (to) url += '&to=' + to;
      var devRes = await af(API_BASE + '/api/devices/' + deviceId);
      var locRes = await af(url);
      var device = await devRes.json();
      var locations = await locRes.json();
      if (!locations.length) { updateStatus('Sin ubicaciones en ese rango', 'warning'); return; }

      // Draw route line
      var latlngs = locations.map(function(l) { return [l.latitude, l.longitude]; }).reverse();
      var poly = L.polyline(latlngs, { color: '#22c55e', weight: 3 }).addTo(leafletMap);
      mapMarkers.push(poly);

      var bounds = [];
      locations.forEach(function(loc, i) {
        var latest = i === 0;
        var dt = new Date(loc.recorded_at);
        var m = L.circleMarker([loc.latitude, loc.longitude], {
          radius: latest ? 12 : 5,
          color: latest ? '#ef4444' : '#22c55e',
          fillColor: latest ? '#ef4444' : '#22c55e',
          fillOpacity: 0.8,
        }).addTo(leafletMap);
        m.bindPopup('<strong>' + esc(device.person_name || device.device_name) + '</strong><br>📅 ' +
          dt.toLocaleDateString('es-MX', {weekday:'short',day:'numeric',month:'short'}) + '<br>🕐 ' +
          dt.toLocaleTimeString('es-MX') + (latest ? '<br><em style="color:#ef4444;">● Última</em>' : ''));
        if (latest) m.bindTooltip('ÚLTIMA', { permanent: true, direction: 'top', className: 'map-label' });
        mapMarkers.push(m);
        bounds.push([loc.latitude, loc.longitude]);
      });
      leafletMap.fitBounds(bounds, { padding: [30, 30] });
      if (mapMarkers[1]) mapMarkers[1].openPopup();
      updateStatus(locations.length + ' puntos de ' + esc(device.person_name || device.device_name), 'success');
    } catch (e) { updateStatus('Error', 'error'); }
  }, 200);
}

// ============ TRIPS ============

async function loadTrips() {
  var status = document.getElementById('trip-filter').value;
  var res = await af(API_BASE + '/api/trips?status=' + status);
  var trips = await res.json();
  var list = document.getElementById('trips-list');
  list.innerHTML = '';
  if (!trips.length) { list.innerHTML = '<div class="empty">No hay viajes</div>'; return; }
  var statusLabels = { active: '🟢 Activo', completed: '✅ Completado', cancelled: '❌ Cancelado' };
  var statusBadges = { active: 'badge-active', completed: 'badge-completed', cancelled: 'badge-cancelled' };
  trips.forEach(function(t) {
    list.innerHTML += '<div class="trip-card">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:0.5rem;">' +
        '<div><div class="card-title">' + esc(t.person_name || t.device_name) + ' <span class="card-badge ' + (statusBadges[t.status]||'') + '">' + (statusLabels[t.status]||t.status) + '</span></div>' +
        (t.vehicle ? '<div class="card-meta">🚗 ' + esc(t.vehicle) + '</div>' : '') +
        (t.cargo ? '<div class="card-meta">📦 ' + esc(t.cargo) + '</div>' : '') + '</div>' +
        '<div style="text-align:right;"><div style="font-size:1.1rem;font-weight:700;">$' + parseFloat(t.total_cost||0).toLocaleString('es-MX',{minimumFractionDigits:2}) + '</div>' +
        '<div class="card-meta">' + (t.location_count||0) + ' puntos</div></div>' +
      '</div>' +
      '<div class="trip-route"><span class="dot dot-start"></span><span style="font-size:0.85rem;">' + esc(t.origin) + '</span><span class="line"></span><span style="font-size:0.85rem;">' + esc(t.destination) + '</span><span class="dot dot-end"></span></div>' +
      '<div class="card-meta">📅 ' + new Date(t.started_at).toLocaleDateString('es-MX',{weekday:'short',day:'numeric',month:'short',year:'numeric'}) + (t.completed_at ? ' → ' + new Date(t.completed_at).toLocaleDateString('es-MX',{day:'numeric',month:'short'}) : '') + '</div>' +
      '<div class="card-actions">' +
        '<button onclick="viewTrip(' + t.id + ')" class="btn btn-primary btn-sm">📋 Detalle</button>' +
        '<button onclick="viewTripOnMap(' + t.id + ')" class="btn btn-accent2 btn-sm">🗺️ Mapa</button>' +
        (t.status==='active' ? '<button onclick="completeTrip(' + t.id + ')" class="btn btn-success btn-sm">✅</button><button onclick="cancelTrip(' + t.id + ')" class="btn btn-secondary btn-sm">❌</button>' : '') +
      '</div></div>';
  });
}

function showNewTripForm() {
  var opts = allDevices.map(function(d) { return '<option value="' + d.id + '">' + esc(d.person_name || d.device_name) + ' - ' + esc(d.vehicle || d.device_name) + '</option>'; }).join('');
  showDetail(
    '<h3>➕ Nuevo viaje</h3>' +
    '<div class="form-group"><label>Conductor</label><select id="trip-device">' + opts + '</select></div>' +
    '<div class="form-row"><div class="form-group"><label>Origen</label><input id="trip-origin" placeholder="Ej: CDMX"></div><div class="form-group"><label>Destino</label><input id="trip-dest" placeholder="Ej: Guadalajara"></div></div>' +
    '<div class="form-group"><label>Carga</label><input id="trip-cargo" placeholder="Ej: 20 cajas"></div>' +
    '<div class="form-group"><label>Notas</label><textarea id="trip-notes" placeholder="Notas..."></textarea></div>' +
    '<button onclick="createTrip()" class="btn btn-primary" style="width:100%;margin-top:0.5rem;">Crear viaje</button>'
  );
}

async function createTrip() {
  var res = await af(API_BASE + '/api/trips', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_id: document.getElementById('trip-device').value, origin: document.getElementById('trip-origin').value, destination: document.getElementById('trip-dest').value, cargo: document.getElementById('trip-cargo').value, notes: document.getElementById('trip-notes').value }),
  });
  var data = await res.json();
  if (data.success) { closeDetailDirect(); updateStatus('Viaje creado', 'success'); loadTrips(); }
  else updateStatus('Error: ' + (data.error||''), 'error');
}

async function viewTrip(tripId) {
  var res = await af(API_BASE + '/api/trips/' + tripId);
  var t = await res.json();
  window._currentTrip = t;
  var costsHtml = '';
  if (t.costs && t.costs.length) {
    costsHtml = '<table style="width:100%;border-collapse:collapse;font-size:0.85rem;margin-top:0.5rem;"><tr style="background:#f5f5f5;"><th style="text-align:left;padding:0.5rem;border-bottom:2px solid #e0e0e0;">Concepto</th><th style="text-align:left;padding:0.5rem;border-bottom:2px solid #e0e0e0;">Fecha</th><th style="text-align:right;padding:0.5rem;border-bottom:2px solid #e0e0e0;">Monto</th><th style="width:40px;"></th></tr>';
    t.costs.forEach(function(c) {
      var d = new Date(c.created_at);
      costsHtml += '<tr><td style="padding:0.5rem;border-bottom:1px solid #eee;">' + esc(c.concept) + '</td><td style="padding:0.5rem;border-bottom:1px solid #eee;color:#666;font-size:0.8rem;">' + d.toLocaleDateString('es-MX',{day:'numeric',month:'short'}) + ' ' + d.toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'}) + '</td><td style="padding:0.5rem;border-bottom:1px solid #eee;text-align:right;font-weight:600;">$' + parseFloat(c.amount).toLocaleString('es-MX',{minimumFractionDigits:2}) + '</td><td style="padding:0.5rem;"><button onclick="deleteCost(' + c.id + ',' + tripId + ')" class="btn btn-danger btn-sm" style="padding:0.2rem 0.4rem;">🗑️</button></td></tr>';
    });
    costsHtml += '</table>';
  } else { costsHtml = '<p style="color:#999;text-align:center;padding:1rem;">Sin gastos</p>'; }

  showDetail(
    '<h3>📋 Viaje #' + t.id + '</h3>' +
    '<div class="card-meta">👤 ' + esc(t.person_name || t.device_name) + (t.vehicle ? ' · 🚗 ' + esc(t.vehicle) : '') + '</div>' +
    '<div class="trip-route" style="margin:0.75rem 0;"><span class="dot dot-start"></span><span>' + esc(t.origin) + '</span><span class="line"></span><span>' + esc(t.destination) + '</span><span class="dot dot-end"></span></div>' +
    (t.cargo ? '<div class="card-meta">📦 ' + esc(t.cargo) + '</div>' : '') +
    (t.notes ? '<div class="card-meta">📝 ' + esc(t.notes) + '</div>' : '') +
    '<div style="margin:1rem 0;padding:1rem;background:#f0fdf4;border:2px solid #bbf7d0;border-radius:10px;text-align:center;">' +
      '<div style="font-size:0.8rem;color:#16a34a;font-weight:600;">Costo total</div>' +
      '<div style="font-size:2rem;font-weight:800;color:#111;">$' + parseFloat(t.total_cost||0).toLocaleString('es-MX',{minimumFractionDigits:2}) + '</div>' +
      '<div style="font-size:0.75rem;color:#666;">' + (t.costs?t.costs.length:0) + ' gastos · ' + (t.locations?t.locations.length:0) + ' ubicaciones</div></div>' +
    costsHtml +
    '<div style="margin-top:0.75rem;display:flex;gap:0.5rem;flex-wrap:wrap;">' +
      '<button onclick="exportTripCosts(' + tripId + ')" class="btn btn-secondary btn-sm" style="flex:1;">📥 Gastos CSV</button>' +
      '<button onclick="exportTripFull(' + tripId + ')" class="btn btn-secondary btn-sm" style="flex:1;">📥 Reporte</button></div>' +
    '<div style="margin-top:1rem;padding-top:0.75rem;border-top:1px solid #e0e0e0;">' +
      '<div style="font-size:0.85rem;font-weight:600;margin-bottom:0.5rem;">Agregar gasto</div>' +
      '<div class="form-row"><div class="form-group"><label>Concepto</label><input id="cost-concept" placeholder="Gasolina, Caseta..."></div><div class="form-group"><label>Monto $</label><input id="cost-amount" type="number" step="0.01" placeholder="0.00"></div></div>' +
      '<button onclick="addCost(' + tripId + ')" class="btn btn-primary btn-sm">Agregar</button></div>' +
    '<button onclick="viewTripOnMap(' + tripId + ');closeDetailDirect();" class="btn btn-accent2" style="width:100%;margin-top:1rem;">🗺️ Ver recorrido</button>'
  );
}

async function addCost(tripId) {
  var concept = document.getElementById('cost-concept').value.trim();
  var amount = parseFloat(document.getElementById('cost-amount').value);
  if (!concept || isNaN(amount)) { updateStatus('Llena concepto y monto', 'error'); return; }
  await af(API_BASE + '/api/trips/' + tripId + '/costs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ concept: concept, amount: amount }) });
  viewTrip(tripId);
}

async function deleteCost(costId, tripId) { await af(API_BASE + '/api/trip-costs/' + costId, { method: 'DELETE' }); viewTrip(tripId); }
async function completeTrip(id) { await af(API_BASE + '/api/trips/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'completed' }) }); updateStatus('Completado', 'success'); loadTrips(); }
async function cancelTrip(id) { if (!confirm('¿Cancelar?')) return; await af(API_BASE + '/api/trips/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'cancelled' }) }); loadTrips(); }

async function viewTripOnMap(tripId) {
  var res = await af(API_BASE + '/api/trips/' + tripId);
  var t = await res.json();
  document.querySelectorAll('.nav-item').forEach(function(n){n.classList.remove('active');});
  document.querySelectorAll('.page').forEach(function(p){p.classList.remove('active');});
  document.querySelectorAll('.nav-item')[1].classList.add('active');
  document.getElementById('page-map').classList.add('active');
  document.getElementById('page-title').textContent = 'Mapa';
  setTimeout(function() {
    initMap(); clearMarkers();
    if (!t.locations || !t.locations.length) { updateStatus('Sin ubicaciones', 'warning'); return; }
    var latlngs = t.locations.map(function(l){return [l.latitude,l.longitude];});
    var poly = L.polyline(latlngs, { color: '#22c55e', weight: 3 }).addTo(leafletMap);
    mapMarkers.push(poly);
    var bounds = [];
    t.locations.forEach(function(loc, i) {
      var first = i===0, last = i===t.locations.length-1;
      var m = L.circleMarker([loc.latitude, loc.longitude], { radius: (first||last)?10:4, color: first?'#22c55e':last?'#ef4444':'#888', fillColor: first?'#22c55e':last?'#ef4444':'#888', fillOpacity:0.8 }).addTo(leafletMap);
      m.bindPopup((first?'🟢 Inicio':last?'🔴 Último':'📌') + '<br>🕐 ' + new Date(loc.recorded_at).toLocaleString('es-MX'));
      mapMarkers.push(m); bounds.push([loc.latitude, loc.longitude]);
    });
    leafletMap.fitBounds(bounds, { padding: [30, 30] });
    updateStatus('Viaje: ' + esc(t.origin) + ' → ' + esc(t.destination) + ' · ' + t.locations.length + ' puntos', 'success');
  }, 200);
}

function exportTripCosts(tripId) {
  var t = window._currentTrip; if (!t) return;
  var csv = 'Concepto,Fecha,Monto\n';
  (t.costs||[]).forEach(function(c) { csv += '"' + (c.concept||'') + '","' + new Date(c.created_at).toLocaleString('es-MX') + '",$' + parseFloat(c.amount).toFixed(2) + '\n'; });
  csv += '\n,TOTAL,$' + parseFloat(t.total_cost||0).toFixed(2) + '\n';
  downloadCSV('gastos-viaje-' + tripId + '.csv', csv);
}

function exportTripFull(tripId) {
  var t = window._currentTrip; if (!t) return;
  var csv = 'REPORTE VIAJE #' + t.id + '\nConductor,"' + (t.person_name||t.device_name) + '"\nVehículo,"' + (t.vehicle||'') + '"\nOrigen,"' + t.origin + '"\nDestino,"' + t.destination + '"\nCarga,"' + (t.cargo||'') + '"\nEstado,' + t.status + '\nCosto Total,$' + parseFloat(t.total_cost||0).toFixed(2) + '\n\nGASTOS\nConcepto,Fecha,Monto\n';
  (t.costs||[]).forEach(function(c) { csv += '"' + (c.concept||'') + '","' + new Date(c.created_at).toLocaleString('es-MX') + '",$' + parseFloat(c.amount).toFixed(2) + '\n'; });
  csv += '\nUBICACIONES\nLatitud,Longitud,Fecha\n';
  (t.locations||[]).forEach(function(l) { csv += l.latitude + ',' + l.longitude + ',"' + new Date(l.recorded_at).toLocaleString('es-MX') + '"\n'; });
  downloadCSV('reporte-viaje-' + tripId + '.csv', csv);
}

// ============ ALERTS ============

async function loadAlertCount() {
  try {
    var res = await af(API_BASE + '/api/alerts/active-count');
    var data = await res.json();
    var badge = document.getElementById('alert-count-badge');
    var alarm = document.getElementById('alert-alarm');
    var alarmCount = document.getElementById('alert-alarm-count');
    if (badge) { if (data.count > 0) { badge.textContent = data.count; badge.style.display = 'inline'; } else badge.style.display = 'none'; }
    if (alarm) { if (data.count > 0) { alarm.style.display = 'block'; alarmCount.textContent = data.count; } else alarm.style.display = 'none'; }
  } catch (e) {}
  setTimeout(loadAlertCount, 15000);
}

async function loadAlerts() {
  var status = document.getElementById('alert-filter').value;
  var res = await af(API_BASE + '/api/alerts?status=' + status);
  var alerts = await res.json();
  var list = document.getElementById('alerts-list');
  list.innerHTML = '';
  if (!alerts.length) { list.innerHTML = '<div class="empty">No hay alertas</div>'; return; }
  var typeLabels = { accident:'🚗💥 Accidente', robbery:'🔫 Robo', breakdown:'🔧 Avería', help:'🆘 Auxilio', other:'⚠️ Otro' };
  var statusLabels = { active:'🔴 Activa', attending:'🟡 Atendiendo', resolved:'✅ Resuelta' };
  alerts.forEach(function(a) {
    var dt = new Date(a.created_at);
    var border = a.status==='active'?'border-left:4px solid #ef4444;':a.status==='attending'?'border-left:4px solid #eab308;':'border-left:4px solid #22c55e;';
    list.innerHTML += '<div class="trip-card" style="' + border + '">' +
      '<div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:0.5rem;">' +
        '<div><div class="card-title">' + (typeLabels[a.alert_type]||a.alert_type) + '</div>' +
        '<div class="card-meta">👤 ' + esc(a.person_name||a.device_name) + (a.phone?' · 📞 '+esc(a.phone):'') + '</div>' +
        (a.vehicle?'<div class="card-meta">🚗 '+esc(a.vehicle)+'</div>':'') +
        (a.message?'<div class="card-meta">💬 '+esc(a.message)+'</div>':'') +
        '<div class="card-meta">🕐 '+dt.toLocaleString('es-MX')+'</div></div>' +
        '<div><span class="card-badge" style="'+(a.status==='active'?'background:#fee2e2;color:#ef4444;':'')+'">'+( statusLabels[a.status]||a.status)+'</span></div></div>' +
      '<div class="card-actions">' +
        (a.latitude?'<button onclick="viewAlertOnMap('+a.latitude+','+a.longitude+',\''+esc(a.person_name||a.device_name)+'\')" class="btn btn-accent2 btn-sm">🗺️ Ubicación</button>':'') +
        (a.status==='active'?'<button onclick="updateAlert('+a.id+',\'attending\')" class="btn btn-primary btn-sm">🟡 Atender</button>':'') +
        (a.status!=='resolved'?'<button onclick="updateAlert('+a.id+',\'resolved\')" class="btn btn-success btn-sm">✅ Resolver</button>':'') +
        (a.phone?'<a href="tel:'+esc(a.phone)+'" class="btn btn-secondary btn-sm">📞 Llamar</a>':'') +
      '</div></div>';
  });
}

async function updateAlert(id, status) {
  await af(API_BASE + '/api/alerts/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: status }) });
  updateStatus('Alerta actualizada', 'success'); loadAlerts(); loadAlertCount();
}

function viewAlertOnMap(lat, lng, name) {
  document.querySelectorAll('.nav-item').forEach(function(n){n.classList.remove('active');});
  document.querySelectorAll('.page').forEach(function(p){p.classList.remove('active');});
  document.querySelectorAll('.nav-item')[1].classList.add('active');
  document.getElementById('page-map').classList.add('active');
  document.getElementById('page-title').textContent = 'Mapa';
  setTimeout(function() {
    initMap(); clearMarkers();
    var m = L.marker([lat, lng]).addTo(leafletMap);
    m.bindPopup('<strong>🚨 ' + esc(name) + '</strong><br>Alerta de emergencia').openPopup();
    mapMarkers.push(m); leafletMap.setView([lat, lng], 16);
  }, 200);
}

function exportAlerts() {
  var typeLabels = { accident:'Accidente', robbery:'Robo', breakdown:'Avería', help:'Auxilio', other:'Otro' };
  af(API_BASE + '/api/alerts?status=' + (document.getElementById('alert-filter').value||'')).then(function(r){return r.json();}).then(function(alerts) {
    var csv = 'ID,Tipo,Persona,Teléfono,Vehículo,Mensaje,Lat,Lng,Estado,Fecha\n';
    alerts.forEach(function(a) { csv += a.id+',"'+(typeLabels[a.alert_type]||a.alert_type)+'","'+(a.person_name||a.device_name)+'","'+(a.phone||'')+'","'+(a.vehicle||'')+'","'+(a.message||'')+'",'+(a.latitude||'')+','+(a.longitude||'')+','+a.status+',"'+new Date(a.created_at).toLocaleString('es-MX')+'"\n'; });
    downloadCSV('alertas.csv', csv);
  });
}

// ============ SEARCH ============

function searchDevices() {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(async function() {
    var q = document.getElementById('search-input').value.trim();
    var results = document.getElementById('search-results');
    if (!q) { results.innerHTML = ''; return; }
    var res = await af(API_BASE + '/api/devices/search?q=' + encodeURIComponent(q));
    var devices = await res.json();
    results.innerHTML = '';
    if (!devices.length) { results.innerHTML = '<div class="empty">Sin resultados</div>'; return; }
    devices.forEach(function(d) {
      results.innerHTML += '<div class="card" style="margin-bottom:0.75rem;">' +
        '<div class="card-title">' + esc(d.person_name || d.device_name) + '</div>' +
        (d.phone?'<div class="card-meta">📞 '+esc(d.phone)+'</div>':'') +
        (d.vehicle?'<div class="card-meta">🚗 '+esc(d.vehicle)+'</div>':'') +
        '<div class="card-actions">' +
          '<button onclick="trackDevice('+d.id+')" class="btn btn-danger btn-sm">📍</button>' +
          '<button onclick="viewOnMap('+d.id+')" class="btn btn-accent2 btn-sm">🗺️</button>' +
          '<button onclick="viewHistory('+d.id+')" class="btn btn-secondary btn-sm">📋</button>' +
        '</div></div>';
    });
  }, 300);
}

// ============ COMPANIES (super admin) ============

async function loadCompanies() {
  var res = await af(API_BASE + '/api/companies');
  var companies = await res.json();
  var list = document.getElementById('companies-list');
  list.innerHTML = '';
  if (!companies.length) { list.innerHTML = '<div class="empty">No hay empresas</div>'; return; }
  var planLabels = { demo:'🆓 Demo', basic:'📦 Básico', pro:'⭐ Pro', enterprise:'🏆 Enterprise' };
  var planColors = { demo:'background:#dbeafe;color:#1e40af;', basic:'background:#dcfce7;color:#16a34a;', pro:'background:#fef9c3;color:#a16207;', enterprise:'background:#fce7f3;color:#9d174d;' };
  companies.forEach(function(c) {
    list.innerHTML += '<div class="card">' +
      '<div class="card-title">' + esc(c.name) + ' <span class="card-badge" style="' + (planColors[c.plan]||'') + '">' + (planLabels[c.plan]||c.plan) + '</span></div>' +
      '<div class="card-meta">🔗 ' + esc(c.slug) + ' · 📱 ' + (c.max_devices||0) + ' máx</div>' +
      '<div class="card-meta">' + (c.auto_track_enabled ? '🟢 Auto-track ' + (c.auto_track_interval||30) + 'min' : '⚪ Auto-track off') + '</div>' +
      (c.contact_email?'<div class="card-meta">📧 '+esc(c.contact_email)+'</div>':'') +
      (c.demo_until?'<div class="card-meta">🆓 Demo hasta: '+new Date(c.demo_until).toLocaleDateString('es-MX')+'</div>':'') +
      '<div class="card-meta">' + (c.is_active?'<span style="color:#22c55e;">● Activa</span>':'<span style="color:#ef4444;">● Inactiva</span>') + '</div>' +
      '<div class="card-actions"><button onclick="editCompany('+c.id+')" class="btn btn-secondary btn-sm">✏️ Editar</button><button onclick="deleteCompany('+c.id+',\''+esc(c.name)+'\')" class="btn btn-danger btn-sm">🗑️</button></div></div>';
  });
}

function showNewCompanyForm() {
  showDetail('<h3>➕ Nueva empresa</h3><div class="form-group"><label>Nombre</label><input id="co-name"></div><div class="form-group"><label>Slug</label><input id="co-slug" placeholder="mi-empresa"></div><div class="form-row"><div class="form-group"><label>Email</label><input id="co-email"></div><div class="form-group"><label>Teléfono</label><input id="co-phone"></div></div><button onclick="createCompany()" class="btn btn-primary" style="width:100%;margin-top:0.5rem;">Crear</button>');
}

async function createCompany() {
  var res = await af(API_BASE + '/api/companies', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: document.getElementById('co-name').value, slug: document.getElementById('co-slug').value, contact_email: document.getElementById('co-email').value, contact_phone: document.getElementById('co-phone').value }) });
  var data = await res.json();
  if (data.success) { closeDetailDirect(); updateStatus('Empresa creada', 'success'); loadCompanies(); }
  else updateStatus('Error: ' + (data.error||''), 'error');
}

async function editCompany(id) {
  var res = await af(API_BASE + '/api/companies'); var companies = await res.json();
  var c = companies.find(function(x){return x.id===id;}); if (!c) return;
  showDetail('<h3>✏️ Editar empresa</h3>' +
    '<div class="form-group"><label>Nombre</label><input id="co-name" value="'+esc(c.name)+'"></div>' +
    '<div class="form-row"><div class="form-group"><label>Email</label><input id="co-email" value="'+esc(c.contact_email||'')+'"></div><div class="form-group"><label>Teléfono</label><input id="co-phone" value="'+esc(c.contact_phone||'')+'"></div></div>' +
    '<div class="form-row"><div class="form-group"><label>Plan</label><select id="co-plan"><option value="demo"'+(c.plan==='demo'?' selected':'')+'>Demo</option><option value="basic"'+(c.plan==='basic'?' selected':'')+'>Básico</option><option value="pro"'+(c.plan==='pro'?' selected':'')+'>Pro</option><option value="enterprise"'+(c.plan==='enterprise'?' selected':'')+'>Enterprise</option></select></div><div class="form-group"><label>Máx dispositivos</label><input id="co-max" type="number" value="'+(c.max_devices||2)+'"></div></div>' +
    '<div class="form-row"><div class="form-group"><label>Vence</label><input id="co-expires" type="date" value="'+(c.expires_at?c.expires_at.substring(0,10):'')+'"></div><div class="form-group"><label>Demo hasta</label><input id="co-demo-until" type="date" value="'+(c.demo_until?c.demo_until.substring(0,10):'')+'"></div></div>' +
    '<div class="form-row"><div class="form-group"><label>Auto-track</label><select id="co-autotrack"><option value="1"'+(c.auto_track_enabled?' selected':'')+'>✅ On</option><option value="0"'+(!c.auto_track_enabled?' selected':'')+'>❌ Off</option></select></div><div class="form-group"><label>Intervalo</label><select id="co-autointerval"><option value="5"'+(c.auto_track_interval==5?' selected':'')+'>5min</option><option value="10"'+(c.auto_track_interval==10?' selected':'')+'>10min</option><option value="15"'+(c.auto_track_interval==15?' selected':'')+'>15min</option><option value="30"'+((c.auto_track_interval==30||!c.auto_track_interval)?' selected':'')+'>30min</option><option value="60"'+(c.auto_track_interval==60?' selected':'')+'>1h</option><option value="120"'+(c.auto_track_interval==120?' selected':'')+'>2h</option></select></div></div>' +
    '<div class="form-group"><label>Activa</label><select id="co-active"><option value="1"'+(c.is_active?' selected':'')+'>Sí</option><option value="0"'+(!c.is_active?' selected':'')+'>No</option></select></div>' +
    '<button onclick="saveCompany('+id+')" class="btn btn-primary" style="width:100%;margin-top:0.5rem;">Guardar</button>');
}

async function saveCompany(id) {
  await af(API_BASE + '/api/companies/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: document.getElementById('co-name').value, contact_email: document.getElementById('co-email').value, contact_phone: document.getElementById('co-phone').value, plan: document.getElementById('co-plan').value, max_devices: parseInt(document.getElementById('co-max').value)||2, expires_at: document.getElementById('co-expires').value||null, demo_until: document.getElementById('co-demo-until').value||null, auto_track_enabled: parseInt(document.getElementById('co-autotrack').value), auto_track_interval: parseInt(document.getElementById('co-autointerval').value)||30, is_active: parseInt(document.getElementById('co-active').value) }) });
  closeDetailDirect(); updateStatus('Actualizada', 'success'); loadCompanies();
}

async function deleteCompany(id, name) { if (!confirm('¿Eliminar "'+name+'"?')) return; await af(API_BASE+'/api/companies/'+id,{method:'DELETE'}); updateStatus('Eliminada','success'); loadCompanies(); }

// ============ USERS ============

async function loadUsers() {
  var res = await af(API_BASE + '/api/users'); var users = await res.json();
  var list = document.getElementById('users-list'); list.innerHTML = '';
  if (!users.length) { list.innerHTML = '<div class="empty">No hay usuarios</div>'; return; }
  users.forEach(function(u) {
    var roleLabels = { super_admin:'🔴 Super Admin', company_admin:'🟢 Admin', driver:'🔵 Conductor' };
    list.innerHTML += '<div class="card"><div class="card-title">' + esc(u.name) + ' <span class="card-badge badge-active">' + (roleLabels[u.role]||u.role) + '</span></div>' +
      '<div class="card-meta">👤 ' + esc(u.username) + '</div>' +
      (u.company_name?'<div class="card-meta">🏢 '+esc(u.company_name)+'</div>':'') +
      '<div class="card-actions">' + (u.role!=='super_admin'?'<button onclick="sendInvite(\''+esc(u.name)+'\',\''+esc(u.username)+'\')" class="btn btn-success btn-sm">📲 WhatsApp</button><button onclick="deleteUser('+u.id+',\''+esc(u.name)+'\')" class="btn btn-danger btn-sm">🗑️</button>':'') + '</div></div>';
  });
}

function showNewUserForm() {
  af(API_BASE+'/api/companies').then(function(r){return r.json();}).then(function(companies) {
    var opts = companies.map(function(c){return '<option value="'+c.id+'">'+esc(c.name)+'</option>';}).join('');
    showDetail('<h3>➕ Nuevo usuario</h3>' +
      '<div class="form-group"><label>Nombre</label><input id="usr-name"></div>' +
      '<div class="form-group"><label>Usuario</label><input id="usr-username"></div>' +
      '<div class="form-group"><label>Contraseña</label><input id="usr-password" type="password"></div>' +
      '<div class="form-group"><label>Empresa</label><select id="usr-company">'+opts+'</select></div>' +
      '<div class="form-group"><label>Rol</label><select id="usr-role"><option value="driver">Conductor</option><option value="company_admin">Admin Empresa</option>'+(currentRole==='super_admin'?'<option value="super_admin">Super Admin</option>':'')+'</select></div>' +
      '<button onclick="createUser()" class="btn btn-primary" style="width:100%;margin-top:0.5rem;">Crear</button>');
  });
}

async function createUser() {
  var name = document.getElementById('usr-name').value;
  var username = document.getElementById('usr-username').value;
  var password = document.getElementById('usr-password').value;
  var company_id = document.getElementById('usr-company').value;
  var role = document.getElementById('usr-role').value;
  var res = await af(API_BASE+'/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name,username:username,password:password,company_id:company_id,role:role})});
  var data = await res.json();
  if (data.success) {
    // Mostrar credenciales y link de WhatsApp
    var msg = '🐵 *TrackMonk*\n\nHola ' + name + ', ya tienes acceso al tracking.\n\n📱 Abre: tracker.monkeyfon.com\n👤 Usuario: ' + username + '\n🔑 Contraseña: ' + password + '\n\n' + (role === 'driver' ? 'Inicia sesión y registra tu dispositivo.' : 'Accede al panel admin: tracker.monkeyfon.com/admin.html');
    var waLink = 'https://wa.me/?text=' + encodeURIComponent(msg);
    showDetail(
      '<h3>✅ Usuario creado</h3>' +
      '<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:1rem;margin:1rem 0;">' +
        '<p style="font-weight:600;">Credenciales:</p>' +
        '<div style="background:#fff;padding:0.5rem;border-radius:6px;margin:0.5rem 0;font-family:monospace;">👤 ' + esc(username) + '</div>' +
        '<div style="background:#fff;padding:0.5rem;border-radius:6px;margin:0.5rem 0;font-family:monospace;">🔑 ' + esc(password) + '</div>' +
      '</div>' +
      '<a href="' + waLink + '" target="_blank" class="btn btn-success" style="display:block;text-align:center;width:100%;padding:0.8rem;text-decoration:none;font-size:1rem;">📲 Enviar por WhatsApp</a>' +
      '<button onclick="closeDetailDirect();loadUsers();" class="btn btn-secondary" style="width:100%;margin-top:0.5rem;">Cerrar</button>'
    );
  }
  else updateStatus('Error: '+(data.error||''),'error');
}

async function deleteUser(id,name) { if (!confirm('¿Eliminar "'+name+'"?')) return; await af(API_BASE+'/api/users/'+id,{method:'DELETE'}); updateStatus('Eliminado','success'); loadUsers(); }

function sendInvite(name, username) {
  var msg = '🐵 *TrackMonk*\n\nHola ' + name + ', ya tienes acceso al tracking.\n\n📱 Abre: tracker.monkeyfon.com\n👤 Usuario: ' + username + '\n🔑 Contraseña: (la que te dieron)\n\nInicia sesión y registra tu dispositivo para que podamos ver tu ubicación.';
  window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank');
}

// ============ SETTINGS ============

async function loadSettings() {
  try {
    var res = await af(API_BASE + '/api/config'); var cfg = await res.json();
    document.getElementById('cfg-enabled').value = String(cfg.autoTrackEnabled !== false);
    document.getElementById('cfg-interval').value = String(cfg.autoTrackInterval || 30);
    document.getElementById('cfg-status').textContent = 'Configuración cargada';
  } catch (e) {}
}

async function saveSettings() {
  var enabled = document.getElementById('cfg-enabled').value === 'true';
  var interval = parseInt(document.getElementById('cfg-interval').value);
  await af(API_BASE + '/api/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ autoTrackEnabled: enabled, autoTrackInterval: interval }) });
  document.getElementById('cfg-status').textContent = '✅ Guardado — ' + (enabled ? 'Activo cada ' + interval + ' min' : 'Desactivado');
  document.getElementById('cfg-status').style.color = enabled ? '#22c55e' : '#ef4444';
}

async function testAutoTrack() {
  document.getElementById('cfg-status').textContent = 'Enviando...';
  var res = await fetch(API_BASE + '/api/auto-track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'trackmonk-auto-2026' }) });
  var data = await res.json();
  document.getElementById('cfg-status').textContent = data.skipped ? '⚠️ Desactivado' : '✅ Enviado: ' + data.sent + ' OK, ' + data.failed + ' fallidos';
}

// ============ BOOT ============

document.addEventListener('DOMContentLoaded', init);
