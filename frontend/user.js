var deviceId = localStorage.getItem('deviceId');
var driverUserId = localStorage.getItem('driverUserId');
var driverCompanySlug = localStorage.getItem('driverCompanySlug');
var pushSubscription = null;
var hasPush = ('PushManager' in window);
var isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
var deferredPrompt = null;
var pollingInterval = null;
var POLLING_MINUTES = 5; // Enviar ubicación cada 5 minutos automáticamente

function isIOS() { return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
function isAndroid() { return /Android/.test(navigator.userAgent); }

window.addEventListener('beforeinstallprompt', function(e) { e.preventDefault(); deferredPrompt = e; });

// ============ INIT ============

async function init() {
  updateStatus('Inicializando...');
  if (!driverUserId) { showDriverLogin(); return; }

  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('/sw.js');
      navigator.serviceWorker.addEventListener('message', handleSWMessage);
      if (hasPush) { var reg = await navigator.serviceWorker.ready; pushSubscription = await reg.pushManager.getSubscription(); }
    } catch (e) {}
  }

  if (deviceId) { await saveDeviceIdToCache(deviceId); showRegistered(); startPolling(); registerPeriodicSync(); }
  else { showRegistration(); updateStatus('Registra tu dispositivo'); }
}

// ============ POLLING (fallback automático) ============

function startPolling() {
  if (pollingInterval) return;
  // Enviar ubicación inmediatamente
  sendLocationSilent();
  // Luego cada 3 minutos
  pollingInterval = setInterval(sendLocationSilent, 3 * 60 * 1000);
  // Mantener tab vivo en background
  keepAlive();
}

// Evita que Chrome suspenda el tab en background
function keepAlive() {
  // 1. Web Lock — mantiene el proceso activo
  if (navigator.locks) {
    navigator.locks.request('trackmonk-alive', { mode: 'shared' }, function() {
      return new Promise(function() {}); // nunca se resuelve = lock permanente
    });
  }
  // 2. Ping silencioso cada 20s para que Chrome no mate el tab
  setInterval(function() {
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'keepalive' });
    }
  }, 20000);
}

// Periodic Background Sync — funciona con PWA instalada en Chrome Android
async function registerPeriodicSync() {
  if (!('serviceWorker' in navigator)) return;
  try {
    var reg = await navigator.serviceWorker.ready;
    if ('periodicSync' in reg) {
      var status = await navigator.permissions.query({ name: 'periodic-background-sync' });
      if (status.state === 'granted') {
        await reg.periodicSync.register('send-location', { minInterval: 5 * 60 * 1000 }); // cada 5 min mínimo
      }
    }
  } catch(e) { /* No soportado o no permitido */ }
}

async function sendLocationSilent() {
  if (!deviceId) return;
  try {
    var pos;
    try {
      pos = await new Promise(function(ok, fail) {
        navigator.geolocation.getCurrentPosition(ok, fail, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
      });
    } catch(e) {
      // Fallback: baja precisión (WiFi/celular) para Firefox
      pos = await new Promise(function(ok, fail) {
        navigator.geolocation.getCurrentPosition(ok, fail, { enableHighAccuracy: false, timeout: 20000, maximumAge: 120000 });
      });
    }
    var payload = { deviceId: deviceId, latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy, speed: pos.coords.speed || null };
    try {
      await fetch(API_BASE + '/api/location', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      sendOfflineQueue();
    } catch(e) {
      saveOffline(payload);
    }
    var lastEl = document.getElementById('last-sent');
    if (lastEl) lastEl.textContent = 'Última actualización: ' + new Date().toLocaleTimeString('es-MX');
  } catch (e) { /* silencioso */ }
}

function saveOffline(payload) {
  try {
    var queue = JSON.parse(localStorage.getItem('offlineQueue') || '[]');
    queue.push(payload);
    if (queue.length > 100) queue = queue.slice(-100); // máximo 100
    localStorage.setItem('offlineQueue', JSON.stringify(queue));
  } catch(e) {}
}

async function sendOfflineQueue() {
  try {
    var queue = JSON.parse(localStorage.getItem('offlineQueue') || '[]');
    if (!queue.length) return;
    for (var i = 0; i < queue.length; i++) {
      try { await fetch(API_BASE + '/api/location', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(queue[i]) }); }
      catch(e) { break; } // si falla, dejar el resto para después
    }
    localStorage.removeItem('offlineQueue');
  } catch(e) {}
}

// ============ DRIVER LOGIN ============

function showDriverLogin() {
  document.getElementById('driver-login-section').style.display = 'block';
  document.getElementById('install-section').style.display = 'none';
  document.getElementById('registration-section').style.display = 'none';
  document.getElementById('registered-section').style.display = 'none';
  updateStatus('');
}

async function driverLogin() {
  var username = document.getElementById('driver-username').value.trim();
  var password = document.getElementById('driver-password').value;
  if (!username || !password) { updateStatus('Ingresa usuario y contraseña', 'error'); return; }
  updateStatus('Verificando...');
  try {
    var res = await fetch(API_BASE + '/api/auth/driver-login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username, password: password }),
    });
    var data = await res.json();
    if (data.success) {
      driverUserId = String(data.userId);
      driverCompanySlug = data.companySlug || '';
      localStorage.setItem('driverUserId', driverUserId);
      localStorage.setItem('driverCompanySlug', driverCompanySlug);
      localStorage.setItem('driverName', data.name || username);
      if (data.deviceId) { deviceId = String(data.deviceId); localStorage.setItem('deviceId', deviceId); await saveDeviceIdToCache(deviceId); }
      document.getElementById('driver-login-section').style.display = 'none';
      if ('serviceWorker' in navigator) { try { await navigator.serviceWorker.register('/sw.js'); navigator.serviceWorker.addEventListener('message', handleSWMessage); } catch(e){} }
      if (deviceId) { showRegistered(); startPolling(); } else { showRegistration(); updateStatus('Registra tu dispositivo'); }
    } else { updateStatus('Credenciales inválidas', 'error'); }
  } catch (err) { updateStatus('Error de conexión', 'error'); }
}

function driverLogout() {
  localStorage.clear(); deviceId = null; driverUserId = null; driverCompanySlug = null;
  caches.delete('app-data').catch(function(){}); showDriverLogin();
}

// ============ INSTALL ============

function showInstallPrompt() {
  if (isIOS()) {
    document.getElementById('install-section').style.display = 'block';
    document.getElementById('registration-section').style.display = 'none';
    document.getElementById('registered-section').style.display = 'none';
    document.getElementById('install-ios').style.display = 'block';
    updateStatus('Instala la app para notificaciones', 'warning');
  } else { showRegistration(); }
}

function showRegistration() {
  document.getElementById('driver-login-section').style.display = 'none';
  document.getElementById('install-section').style.display = 'none';
  document.getElementById('registration-section').style.display = 'block';
  document.getElementById('registered-section').style.display = 'none';
  var tip = document.getElementById('android-firefox-tip');
  if (tip && isAndroid()) tip.style.display = 'block';
}

async function showRegistered() {
  document.getElementById('driver-login-section').style.display = 'none';
  document.getElementById('install-section').style.display = 'none';
  document.getElementById('registration-section').style.display = 'none';
  document.getElementById('registered-section').style.display = 'block';

  try {
    var res = await fetch(API_BASE + '/api/devices/' + deviceId);
    var d = await res.json();
    if (d) document.getElementById('registered-name').textContent = (d.person_name || d.device_name) + ' — ' + (d.phone || '');
  } catch (e) {}

  var hasPushActive = false;
  if (hasPush && 'serviceWorker' in navigator) {
    try {
      var reg = await navigator.serviceWorker.ready;
      var sub = await reg.pushManager.getSubscription();
      if (sub) {
        hasPushActive = true;
        // Siempre actualizar la subscription en el backend (por si cambió de navegador)
        try {
          await fetch(API_BASE + '/api/devices/' + deviceId + '/push', {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subscription: sub.toJSON() }),
          });
        } catch(e) {}
      } else {
        // No hay subscription, intentar suscribir automáticamente
        try {
          var vapidRes = await fetch(API_BASE + '/api/vapid-public-key'); var vk = await vapidRes.json();
          var permission = await Notification.requestPermission();
          if (permission === 'granted') {
            pushSubscription = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vk.publicKey) });
            await fetch(API_BASE + '/api/devices/' + deviceId + '/push', {
              method: 'PUT', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ subscription: pushSubscription.toJSON() }),
            });
            hasPushActive = true;
          }
        } catch(e) {}
      }
    } catch(e){}
  }
  var pushBtn = document.getElementById('activate-push-btn');
  if (pushBtn) pushBtn.style.display = hasPushActive ? 'none' : 'block';
  updateStatus(hasPushActive ? 'Dispositivo activo con push ✓' : 'Dispositivo activo (sin push)', hasPushActive ? 'success' : 'warning');

  loadMyTrip();
  loadUnreadCount();
  loadChatUnread();
  setInterval(loadUnreadCount, 30000);
  setInterval(loadChatUnread, 30000);
  setInterval(loadMyTrip, 60000);

  // Mostrar botón de descarga según plataforma
  var dlCard = document.getElementById('download-app-card');
  if (dlCard) {
    // Si estamos dentro de la app nativa (WebView), ocultar instrucciones
    if (window.TrackMonkBridge) {
      dlCard.style.display = 'none';
    } else if (isAndroid()) {
      document.getElementById('download-apk-btn').style.display = 'block';
      document.getElementById('install-instructions').style.display = 'block';
    } else if (isIOS()) {
      document.getElementById('ios-install-instructions').style.display = 'block';
    } else {
      dlCard.style.display = 'none';
    }
  }
}

// ============ REGISTRO ============

async function registerDevice() {
  var deviceName = document.getElementById('reg-device-name').value.trim();
  var personName = document.getElementById('reg-person-name').value.trim();
  var phone = document.getElementById('reg-phone').value.trim();
  var company = document.getElementById('reg-company').value.trim();
  var vehicle = document.getElementById('reg-vehicle').value.trim();
  if (!deviceName) { updateStatus('Ingresa nombre del dispositivo', 'error'); return; }
  updateStatus('Registrando...');
  try {
    // 1. Pedir permiso de GPS (no bloquea registro si falla)
    var gpsOk = false;
    try { await new Promise(function(ok, fail) { navigator.geolocation.getCurrentPosition(ok, fail, { enableHighAccuracy: true, timeout: 20000 }); }); gpsOk = true; } catch(e) { console.log('GPS no disponible aún, continuando registro...'); }

    // 2. Registrar SW si no está registrado
    if ('serviceWorker' in navigator) {
      try { await navigator.serviceWorker.register('/sw.js'); } catch(e) {}
    }

    // 3. Intentar suscribir push (no bloquea si falla)
    var subscription = null;
    if (hasPush && 'serviceWorker' in navigator) {
      try {
        var vapidRes = await fetch(API_BASE + '/api/vapid-public-key'); var vk = await vapidRes.json();
        var permission = await Notification.requestPermission();
        if (permission === 'granted') {
          var reg = await navigator.serviceWorker.ready;
          pushSubscription = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vk.publicKey) });
          subscription = pushSubscription.toJSON();
        }
      } catch(e) { console.log('Push subscription failed, continuing without push:', e); }
    }

    // 4. Registrar dispositivo en backend
    var res = await fetch(API_BASE + '/api/devices/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceName: deviceName, subscription: subscription, companySlug: driverCompanySlug, userId: driverUserId }),
    });
    var data = await res.json();
    if (data.success) {
      deviceId = String(data.deviceId); localStorage.setItem('deviceId', deviceId);
      await saveDeviceIdToCache(deviceId);
      if (personName || phone || company || vehicle) {
        await fetch(API_BASE + '/api/devices/' + deviceId + '/profile', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ device_name: deviceName, person_name: personName, phone: phone, company: company, vehicle: vehicle }),
        });
      }
      sendMyLocation(); showRegistered(); startPolling();
      if (!gpsOk) updateStatus('Registrado ✓ (activa ubicación en ajustes)', 'warning');
    } else { updateStatus('Error: ' + (data.error || ''), 'error'); }
  } catch (err) { updateStatus('Error: ' + err.message, 'error'); }
}

// ============ ACTIVAR PUSH ============

async function activatePush() {
  updateStatus('Activando notificaciones...');
  try {
    if (!('serviceWorker' in navigator) || !hasPush) { updateStatus('Tu navegador no soporta push', 'error'); return; }
    var vapidRes = await fetch(API_BASE + '/api/vapid-public-key'); var vk = await vapidRes.json();
    var permission = await Notification.requestPermission();
    if (permission !== 'granted') { updateStatus('Permite notificaciones', 'error'); return; }
    var reg = await navigator.serviceWorker.ready;
    pushSubscription = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vk.publicKey) });
    await fetch(API_BASE + '/api/devices/' + deviceId + '/push', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: pushSubscription.toJSON() }),
    });
    updateStatus('Push activado ✓', 'success');
    var pushBtn = document.getElementById('activate-push-btn');
    if (pushBtn) pushBtn.style.display = 'none';
  } catch (err) { updateStatus('Error: ' + err.message, 'error'); }
}

// ============ ENVIAR UBICACIÓN ============

async function sendMyLocation() {
  if (!deviceId) return;
  updateStatus('Obteniendo GPS...', 'warning');
  try {
    var position;
    try {
      position = await new Promise(function(ok, fail) { navigator.geolocation.getCurrentPosition(ok, fail, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }); });
    } catch(e) {
      // Fallback baja precisión para Firefox
      position = await new Promise(function(ok, fail) { navigator.geolocation.getCurrentPosition(ok, fail, { enableHighAccuracy: false, timeout: 20000, maximumAge: 60000 }); });
    }
    await fetch(API_BASE + '/api/location', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: deviceId, latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy, speed: position.coords.speed || null }),
    });
    updateStatus('Ubicación enviada ✓', 'success');
    document.getElementById('last-sent').textContent = 'Última: ' + new Date().toLocaleString();
  } catch (err) {
    if (err.code === 1) {
      updateStatus('⚠️ GPS bloqueado. Toca 🔒 en la barra → Permisos → Ubicación → Permitir. O usa Chrome.', 'error');
    } else {
      updateStatus('GPS no disponible. Verifica que el GPS esté encendido.', 'error');
    }
  }
}

// ============ EMERGENCIA ============

function showEmergencyPanel() {
  var panel = document.getElementById('emergency-panel');
  if (panel.style.display === 'block') { panel.style.display = 'none'; return; }
  panel.style.display = 'block';
  panel.innerHTML = '<div style="background:#fff;border:2px solid #ef4444;border-radius:12px;padding:1rem;"><h3 style="color:#ef4444;text-align:center;margin-bottom:0.75rem;">🚨 Tipo de emergencia</h3><div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;"><button onclick="sendAlert(\'accident\')" style="padding:1rem;background:#fee2e2;border:1px solid #fca5a5;border-radius:10px;cursor:pointer;font-weight:600;color:#991b1b;">🚗💥<br>Accidente</button><button onclick="sendAlert(\'robbery\')" style="padding:1rem;background:#fef9c3;border:1px solid #fde047;border-radius:10px;cursor:pointer;font-weight:600;color:#854d0e;">🔫<br>Robo</button><button onclick="sendAlert(\'breakdown\')" style="padding:1rem;background:#dbeafe;border:1px solid #93c5fd;border-radius:10px;cursor:pointer;font-weight:600;color:#1e40af;">🔧<br>Avería</button><button onclick="sendAlert(\'help\')" style="padding:1rem;background:#fce7f3;border:1px solid #f9a8d4;border-radius:10px;cursor:pointer;font-weight:600;color:#9d174d;">🆘<br>Auxilio</button></div><input id="alert-message" type="text" placeholder="Mensaje (opcional)" style="width:100%;margin-top:0.75rem;padding:0.6rem;border:1px solid #e0e0e0;border-radius:8px;"><button onclick="document.getElementById(\'emergency-panel\').style.display=\'none\'" style="width:100%;margin-top:0.5rem;padding:0.5rem;background:#f0f0f0;border:none;border-radius:8px;color:#666;cursor:pointer;">Cancelar</button></div>';
}

async function sendAlert(alertType) {
  updateStatus('Enviando alerta...', 'warning');
  try {
    var position = await new Promise(function(ok, fail) { navigator.geolocation.getCurrentPosition(ok, fail, { enableHighAccuracy: true, timeout: 10000 }); });
    var msg = document.getElementById('alert-message'); var message = msg ? msg.value.trim() : '';
    await fetch(API_BASE + '/api/alerts', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: deviceId, alert_type: alertType, message: message, latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy }) });
    updateStatus('🚨 Alerta enviada', 'error'); document.getElementById('emergency-panel').style.display = 'none';
  } catch (err) {
    try { await fetch(API_BASE + '/api/alerts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceId: deviceId, alert_type: alertType }) });
      updateStatus('🚨 Alerta enviada (sin ubicación)', 'error'); document.getElementById('emergency-panel').style.display = 'none';
    } catch(e) { updateStatus('Error', 'error'); }
  }
}

// ============ NOTIFICACIONES ============

async function loadUnreadCount() {
  if (!deviceId) return;
  try { var res = await fetch(API_BASE + '/api/my-messages/' + deviceId + '/unread'); var data = await res.json();
    var badge = document.getElementById('unread-badge');
    var prevCount = parseInt(badge ? badge.textContent : '0') || 0;
    if (badge && data.count > 0) {
      badge.textContent = data.count;
      badge.style.display = 'inline';
      // Sonar si hay nuevos mensajes
      if (data.count > prevCount) playNotificationSound();
    }
    else if (badge) { badge.style.display = 'none'; }
  } catch(e) {}
}

function playNotificationSound() {
  try {
    var ctx = new (window.AudioContext || window.webkitAudioContext)();
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    osc.type = 'sine';
    gain.gain.value = 0.3;
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
    osc.stop(ctx.currentTime + 0.3);
    // Segundo tono
    setTimeout(function() {
      var osc2 = ctx.createOscillator();
      var gain2 = ctx.createGain();
      osc2.connect(gain2); gain2.connect(ctx.destination);
      osc2.frequency.value = 1100;
      osc2.type = 'sine';
      gain2.gain.value = 0.3;
      osc2.start();
      gain2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
      osc2.stop(ctx.currentTime + 0.3);
    }, 150);
  } catch(e) {}
}

async function viewMyMessages() {
  var c = document.getElementById('my-messages');
  if (c.style.display === 'block') { c.style.display = 'none'; return; }
  c.style.display = 'block'; c.innerHTML = '<p style="color:#888;text-align:center;">Cargando...</p>';
  try {
    var res = await fetch(API_BASE + '/api/my-messages/' + deviceId); var messages = await res.json();
    if (!messages.length) { c.innerHTML = '<div style="background:#fff;border:1px solid #e0e0e0;border-radius:12px;padding:1.5rem;text-align:center;color:#aaa;">Sin notificaciones</div>'; return; }
    var html = '<div style="background:#fff;border:1px solid #e0e0e0;border-radius:12px;padding:1rem;"><h3 style="font-size:1rem;margin-bottom:0.75rem;">🔔 Notificaciones</h3>';
    messages.forEach(function(m) { var d = new Date(m.created_at); var u = !m.is_read;
      html += '<div style="padding:0.75rem;margin-bottom:0.5rem;border-radius:8px;border:1px solid ' + (u?'#22c55e':'#e0e0e0') + ';background:' + (u?'#dcfce7':'#f9f9f9') + ';">';
      html += '<div style="display:flex;justify-content:space-between;"><strong style="font-size:0.9rem;">' + (u?'🟢 ':'') + escapeHtml(m.title) + '</strong><span style="font-size:0.7rem;color:#999;">' + d.toLocaleDateString('es-MX',{day:'numeric',month:'short'}) + '</span></div>';
      html += '<p style="font-size:0.85rem;color:#444;margin-top:0.25rem;">' + escapeHtml(m.body) + '</p>';
      if (m.reply) {
        html += '<div style="margin-top:0.5rem;padding:0.5rem;background:#e0f2fe;border-radius:6px;font-size:0.8rem;"><strong>Tu respuesta:</strong> ' + escapeHtml(m.reply) + '</div>';
      } else {
        html += '<div style="margin-top:0.5rem;display:flex;gap:0.3rem;" id="reply-box-' + m.id + '"><input type="text" placeholder="Responder..." style="flex:1;padding:0.4rem 0.6rem;border:1px solid #e0e0e0;border-radius:6px;font-size:0.8rem;" id="reply-' + m.id + '"><button onclick="replyMessage(' + m.id + ')" style="padding:0.4rem 0.8rem;background:#22c55e;color:#fff;border:none;border-radius:6px;font-size:0.8rem;cursor:pointer;">Enviar</button></div>';
      }
      html += '</div>';
    });
    html += '</div>'; c.innerHTML = html;
    messages.filter(function(m){return !m.is_read;}).forEach(function(m){ fetch(API_BASE+'/api/my-messages/'+m.id+'/read',{method:'PUT'}); });
    setTimeout(function(){ var b=document.getElementById('unread-badge'); if(b) b.style.display='none'; }, 1000);
  } catch(e) { c.innerHTML = '<p style="color:#ef4444;text-align:center;">Error</p>'; }
}

async function replyMessage(messageId) {
  var input = document.getElementById('reply-' + messageId);
  var reply = input ? input.value.trim() : '';
  if (!reply) return;
  try {
    await fetch(API_BASE + '/api/my-messages/' + messageId + '/reply', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reply: reply }),
    });
    var box = document.getElementById('reply-box-' + messageId);
    if (box) box.innerHTML = '<div style="padding:0.5rem;background:#e0f2fe;border-radius:6px;font-size:0.8rem;"><strong>Tu respuesta:</strong> ' + escapeHtml(reply) + '</div>';
  } catch(e) {}
}

// ============ MI VIAJE ============

async function loadMyTrip() {
  if (!deviceId) return;
  var c = document.getElementById('my-trip');
  try {
    var res = await fetch(API_BASE + '/api/my-trips/' + deviceId); var trips = await res.json();
    if (!trips.length) { c.style.display = 'none'; return; }
    c.style.display = 'block'; var t = trips[0];
    var costsRes = await fetch(API_BASE + '/api/my-trips/' + t.id + '/costs'); var costs = await costsRes.json();
    var total = costs.reduce(function(s,c){return s+parseFloat(c.amount);},0);
    var costsHtml = ''; costs.forEach(function(co){ costsHtml += '<div style="display:flex;justify-content:space-between;padding:0.3rem 0;border-bottom:1px solid #e0e0e0;font-size:0.8rem;"><span>'+escapeHtml(co.concept)+'</span><span>$'+parseFloat(co.amount).toFixed(2)+'</span></div>'; });
    c.innerHTML = '<div style="background:#fff;border:1px solid #e0e0e0;border-radius:12px;padding:1rem;"><h3 style="font-size:1rem;margin-bottom:0.5rem;">🚛 Viaje activo</h3><div style="display:flex;align-items:center;gap:0.5rem;margin:0.5rem 0;"><span style="width:10px;height:10px;border-radius:50%;background:#22c55e;"></span><span style="font-size:0.85rem;">'+escapeHtml(t.origin)+'</span><span style="flex:1;height:2px;background:#e0e0e0;"></span><span style="font-size:0.85rem;">'+escapeHtml(t.destination)+'</span><span style="width:10px;height:10px;border-radius:50%;background:#ef4444;"></span></div>'+(t.cargo?'<div style="font-size:0.8rem;color:#888;">📦 '+escapeHtml(t.cargo)+'</div>':'')+'<div style="text-align:center;margin:0.75rem 0;padding:0.75rem;background:#f5f5f5;border-radius:8px;"><div style="font-size:0.75rem;color:#888;">Gastos</div><div style="font-size:1.3rem;font-weight:700;">$'+total.toLocaleString('es-MX',{minimumFractionDigits:2})+'</div></div>'+costsHtml+'<div style="margin-top:0.75rem;border-top:1px solid #e0e0e0;padding-top:0.75rem;"><div style="font-size:0.85rem;font-weight:600;margin-bottom:0.5rem;">Agregar gasto</div><div style="display:flex;gap:0.5rem;"><select id="cost-type" style="flex:1;padding:0.5rem;border:1px solid #e0e0e0;border-radius:8px;font-size:0.85rem;"><option value="Gasolina">⛽ Gasolina</option><option value="Caseta">🛣️ Caseta</option><option value="Comida">🍔 Comida</option><option value="Hospedaje">🏨 Hospedaje</option><option value="Mantenimiento">🔧 Mantenimiento</option><option value="Otro">📝 Otro</option></select><input id="cost-amount-user" type="number" step="0.01" placeholder="$0.00" style="width:100px;padding:0.5rem;border:1px solid #e0e0e0;border-radius:8px;font-size:0.85rem;"></div><input id="cost-note-user" type="text" placeholder="Nota (opcional)" style="width:100%;margin-top:0.5rem;padding:0.5rem;border:1px solid #e0e0e0;border-radius:8px;font-size:0.85rem;"><button onclick="addMyTripCost('+t.id+')" style="width:100%;margin-top:0.5rem;padding:0.6rem;background:#22c55e;color:#fff;border:none;border-radius:8px;font-weight:600;cursor:pointer;">Agregar gasto</button><button onclick="takePhoto('+t.id+')" style="width:100%;margin-top:0.5rem;padding:0.6rem;background:#f59e0b;color:#fff;border:none;border-radius:8px;font-weight:600;cursor:pointer;">📷 Foto de evidencia</button><button onclick="showSignaturePad('+t.id+')" style="width:100%;margin-top:0.5rem;padding:0.6rem;background:#3b82f6;color:#fff;border:none;border-radius:8px;font-weight:600;cursor:pointer;">✍️ Firma de entrega</button><button onclick="completeMyTrip('+t.id+')" style="width:100%;margin-top:0.75rem;padding:0.7rem;background:#ef4444;color:#fff;border:none;border-radius:8px;font-weight:600;cursor:pointer;">✅ Terminar viaje</button></div></div>';
  } catch(e) { c.style.display = 'none'; }
}
async function addMyTripCost(tripId) {
  var type = document.getElementById('cost-type').value;
  var amount = parseFloat(document.getElementById('cost-amount-user').value);
  var note = document.getElementById('cost-note-user').value.trim();
  if (isNaN(amount) || amount <= 0) { updateStatus('Monto inválido', 'error'); return; }
  var concept = note ? type + ' - ' + note : type;
  await fetch(API_BASE + '/api/my-trips/' + tripId + '/costs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ concept: concept, amount: amount }) });
  updateStatus('Gasto agregado ✓', 'success');
  document.getElementById('cost-amount-user').value = '';
  document.getElementById('cost-note-user').value = '';
  loadMyTrip();
}

async function completeMyTrip(tripId) {
  if (!confirm('¿Terminar este viaje?')) return;
  try {
    await fetch(API_BASE + '/api/my-trips/' + tripId + '/complete', { method: 'PUT' });
    updateStatus('Viaje completado ✓', 'success');
    loadMyTrip();
  } catch(e) { updateStatus('Error', 'error'); }
}

// ============ FOTOS Y FIRMA (opcional) ============

function takePhoto(tripId) {
  var input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.capture = 'environment';
  input.onchange = function(e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(ev) {
      uploadEvidence(tripId, 'photo', 'Foto de evidencia', ev.target.result);
    };
    reader.readAsDataURL(file);
  };
  input.click();
}

function showSignaturePad(tripId) {
  var panel = document.getElementById('emergency-panel');
  panel.style.display = 'block';
  panel.innerHTML = '<div style="background:#fff;border:2px solid #3b82f6;border-radius:12px;padding:1rem;text-align:center;">' +
    '<h3 style="color:#3b82f6;margin-bottom:0.5rem;">✍️ Firma de entrega</h3>' +
    '<canvas id="sig-canvas" width="300" height="150" style="border:1px solid #ddd;border-radius:8px;touch-action:none;"></canvas>' +
    '<div style="margin-top:0.5rem;display:flex;gap:0.5rem;">' +
      '<button onclick="clearSignature()" style="flex:1;padding:0.5rem;background:#f0f0f0;border:none;border-radius:8px;cursor:pointer;">Borrar</button>' +
      '<button onclick="saveSignature(\'' + tripId + '\')" style="flex:1;padding:0.5rem;background:#22c55e;color:#fff;border:none;border-radius:8px;cursor:pointer;">Guardar</button>' +
    '</div>' +
    '<button onclick="document.getElementById(\'emergency-panel\').style.display=\'none\'" style="width:100%;margin-top:0.5rem;padding:0.5rem;background:#f0f0f0;border:none;border-radius:8px;color:#666;cursor:pointer;">Cancelar</button>' +
  '</div>';
  // Init canvas drawing
  setTimeout(initSignatureCanvas, 100);
}

function initSignatureCanvas() {
  var canvas = document.getElementById('sig-canvas');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  var drawing = false;
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';

  function getPos(e) {
    var rect = canvas.getBoundingClientRect();
    var touch = e.touches ? e.touches[0] : e;
    return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
  }

  canvas.addEventListener('mousedown', function(e) { drawing = true; var p = getPos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); });
  canvas.addEventListener('mousemove', function(e) { if (!drawing) return; var p = getPos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); });
  canvas.addEventListener('mouseup', function() { drawing = false; });
  canvas.addEventListener('touchstart', function(e) { e.preventDefault(); drawing = true; var p = getPos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); });
  canvas.addEventListener('touchmove', function(e) { e.preventDefault(); if (!drawing) return; var p = getPos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); });
  canvas.addEventListener('touchend', function() { drawing = false; });
}

function clearSignature() {
  var canvas = document.getElementById('sig-canvas');
  if (canvas) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
}

function saveSignature(tripId) {
  var canvas = document.getElementById('sig-canvas');
  if (!canvas) return;
  var dataUrl = canvas.toDataURL('image/png');
  uploadEvidence(tripId, 'signature', 'Firma de entrega', dataUrl);
  document.getElementById('emergency-panel').style.display = 'none';
}

async function uploadEvidence(tripId, type, description, imageData) {
  updateStatus('Subiendo ' + (type === 'photo' ? 'foto' : 'firma') + '...', 'warning');
  try {
    var pos = null;
    try { pos = await new Promise(function(ok, fail) { navigator.geolocation.getCurrentPosition(ok, fail, { timeout: 5000 }); }); } catch(e) {}
    await fetch(API_BASE + '/api/my-trips/' + tripId + '/evidence', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: deviceId, type: type, description: description, image_data: imageData,
        latitude: pos ? pos.coords.latitude : null, longitude: pos ? pos.coords.longitude : null,
      }),
    });
    updateStatus((type === 'photo' ? '📷 Foto' : '✍️ Firma') + ' guardada ✓', 'success');
  } catch(e) { updateStatus('Error subiendo', 'error'); }
}

// ============ HISTORIAL ============

async function viewMyHistory() {
  var c = document.getElementById('my-history');
  if (c.style.display === 'block') { c.style.display = 'none'; return; }
  c.style.display = 'block'; c.innerHTML = '<p style="color:#888;text-align:center;">Cargando...</p>';
  try {
    var res = await fetch(API_BASE + '/api/my-locations/' + deviceId + '?limit=50'); var locations = await res.json();
    if (!locations.length) { c.innerHTML = '<div style="background:#fff;border:1px solid #e0e0e0;border-radius:12px;padding:1.5rem;text-align:center;color:#aaa;">Sin historial</div>'; return; }
    var html = '<div style="background:#fff;border:1px solid #e0e0e0;border-radius:12px;padding:1rem;"><h3 style="font-size:1rem;margin-bottom:0.5rem;">📋 Mi historial</h3>';
    locations.forEach(function(loc, i) { var d = new Date(loc.recorded_at);
      html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:0.5rem 0;border-bottom:1px solid #e0e0e0;font-size:0.8rem;'+(i===0?'background:#dcfce7;padding:0.5rem;border-radius:6px;margin-bottom:0.25rem;':'')+'"><div><span style="color:'+(i===0?'#22c55e':'#999')+'">'+(i===0?'🔴 ÚLTIMA':'📌')+'</span> '+d.toLocaleDateString('es-MX',{weekday:'short',day:'numeric',month:'short'})+' <span style="color:#888;">'+d.toLocaleTimeString('es-MX')+'</span></div><a href="https://www.google.com/maps?q='+loc.latitude+','+loc.longitude+'" target="_blank">🗺️</a></div>';
    });
    html += '</div>'; c.innerHTML = html;
  } catch(e) { c.innerHTML = '<p style="color:#ef4444;text-align:center;">Error</p>'; }
}

// ============ SERVICE WORKER ============

function handleSWMessage(event) {
  if (event.data.type === 'get-device-id') event.ports[0].postMessage({ deviceId: deviceId });
  if (event.data.type === 'get-location') getLocationAndSend(event.data.requestId, event.data.deviceId);
  if (event.data.type === 'send-location-silent') sendLocationSilent();
}

async function getLocationAndSend(requestId, devId) {
  try {
    var pos = await new Promise(function(ok,fail){ navigator.geolocation.getCurrentPosition(ok,fail,{enableHighAccuracy:true,timeout:15000,maximumAge:0}); });
    await fetch(API_BASE+'/api/location',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({deviceId:devId||deviceId,requestId:requestId,latitude:pos.coords.latitude,longitude:pos.coords.longitude,accuracy:pos.coords.accuracy})});
  } catch(e){}
}

// ============ HELPERS ============

function resetDevice() {
  if (confirm('¿Re-registrar dispositivo?')) { localStorage.removeItem('deviceId'); deviceId = null; showRegistration(); }
}

async function installApp() {
  var p = deferredPrompt || window._deferredPrompt;
  if (p) { p.prompt(); var r = await p.userChoice; deferredPrompt = null; if (r.outcome==='accepted') { updateStatus('Instalada ✓','success'); var ic=document.getElementById('install-app-card'); if(ic) ic.style.display='none'; } return; }
  var hint = document.getElementById('install-app-hint');
  if (isIOS()) hint.innerHTML = 'Safari → Compartir (📤) → Agregar a inicio';
  else if (isAndroid()) hint.innerHTML = 'Menú ⋮ → Agregar a pantalla de inicio';
  else hint.innerHTML = 'Busca ⬇️ en la barra de direcciones';
  hint.style.color = '#ef4444';
}

function updateStatus(message, type) {
  var el = document.getElementById('status');
  el.textContent = message;
  el.className = 'status status-' + (type || 'info');
}

function escapeHtml(text) { if (!text) return ''; var d = document.createElement('div'); d.textContent = text; return d.innerHTML; }

function urlBase64ToUint8Array(base64String) {
  var padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  var rawData = window.atob(base64); var outputArray = new Uint8Array(rawData.length);
  for (var i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

async function saveDeviceIdToCache(id) {
  try { var cache = await caches.open('app-data'); await cache.put('/device-id', new Response(JSON.stringify({ deviceId: id }))); } catch(e){}
}

// ============ DRIVER CHAT ============

var chatContacts = [];
var chatCurrentContact = null;

async function openDriverChat() {
  var c = document.getElementById('driver-chat');
  if (c.style.display === 'block' && !chatCurrentContact) { c.style.display = 'none'; return; }
  c.style.display = 'block';
  chatCurrentContact = null;
  c.innerHTML = '<p style="color:#888;text-align:center;">Cargando...</p>';
  try {
    var res = await fetch(API_BASE + '/api/driver-chat/contacts/' + deviceId);
    chatContacts = await res.json();
    var unreadRes = await fetch(API_BASE + '/api/driver-chat/' + deviceId + '/unread');
    var unread = await unreadRes.json();
    var unreadMap = {};
    unread.forEach(function(u) { unreadMap[u.from_device_id] = u.count; });

    if (!chatContacts.length) {
      c.innerHTML = '<div style="background:#fff;border:1px solid #e0e0e0;border-radius:12px;padding:1.5rem;text-align:center;color:#aaa;">Sin compañeros en tu empresa</div>';
      return;
    }
    var html = '<div style="background:#fff;border:1px solid #e0e0e0;border-radius:12px;padding:1rem;"><h3 style="font-size:1rem;margin-bottom:0.75rem;">💬 Chat con compañeros</h3>';
    chatContacts.forEach(function(ct) {
      var badge = unreadMap[ct.id] ? '<span style="background:#3b82f6;color:#fff;font-size:0.7rem;padding:0.1rem 0.5rem;border-radius:10px;margin-left:0.5rem;">' + unreadMap[ct.id] + '</span>' : '';
      html += '<div onclick="openConversation(' + ct.id + ')" style="display:flex;justify-content:space-between;align-items:center;padding:0.75rem;margin-bottom:0.5rem;background:#f9f9f9;border-radius:8px;cursor:pointer;">';
      html += '<div><strong>' + escapeHtml(ct.person_name || ct.device_name) + '</strong>';
      if (ct.vehicle) html += '<br><span style="font-size:0.75rem;color:#888;">🚗 ' + escapeHtml(ct.vehicle) + '</span>';
      html += '</div><div>' + badge + ' →</div></div>';
    });
    html += '</div>';
    c.innerHTML = html;
  } catch(e) { c.innerHTML = '<p style="color:#ef4444;text-align:center;">Error cargando</p>'; }
}

async function openConversation(otherDeviceId) {
  chatCurrentContact = otherDeviceId;
  var ct = chatContacts.find(function(x) { return x.id === otherDeviceId; }) || {};
  var c = document.getElementById('driver-chat');
  c.innerHTML = '<p style="color:#888;text-align:center;">Cargando...</p>';
  try {
    var res = await fetch(API_BASE + '/api/driver-chat/' + deviceId + '/' + otherDeviceId);
    var messages = await res.json();
    var html = '<div style="background:#fff;border:1px solid #e0e0e0;border-radius:12px;padding:1rem;">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem;"><button onclick="openDriverChat()" style="background:none;border:none;font-size:1.2rem;cursor:pointer;">←</button><strong>' + escapeHtml(ct.person_name || ct.device_name) + '</strong><span></span></div>';
    html += '<div id="chat-messages" style="max-height:300px;overflow-y:auto;margin-bottom:0.75rem;padding:0.5rem;background:#f5f5f5;border-radius:8px;">';
    if (!messages.length) {
      html += '<p style="text-align:center;color:#aaa;font-size:0.85rem;">Sin mensajes aún</p>';
    } else {
      messages.forEach(function(m) {
        var isMine = m.from_device_id == deviceId;
        var align = isMine ? 'flex-end' : 'flex-start';
        var bg = isMine ? '#dcfce7' : '#e0e7ff';
        var time = new Date(m.created_at).toLocaleTimeString('es-MX', {hour:'2-digit',minute:'2-digit'});
        html += '<div style="display:flex;justify-content:' + align + ';margin-bottom:0.4rem;">';
        html += '<div style="max-width:80%;padding:0.5rem 0.75rem;background:' + bg + ';border-radius:12px;font-size:0.85rem;">';
        html += escapeHtml(m.body) + '<div style="font-size:0.65rem;color:#999;margin-top:0.2rem;">' + time + '</div>';
        html += '</div></div>';
      });
    }
    html += '</div>';
    html += '<div style="display:flex;gap:0.4rem;"><input type="text" id="chat-input" placeholder="Escribe..." style="flex:1;padding:0.5rem 0.75rem;border:1px solid #e0e0e0;border-radius:8px;font-size:0.85rem;" onkeydown="if(event.key===\'Enter\')sendDriverMsg(' + otherDeviceId + ')"><button onclick="sendDriverMsg(' + otherDeviceId + ')" style="padding:0.5rem 1rem;background:#22c55e;color:#fff;border:none;border-radius:8px;font-weight:600;cursor:pointer;">Enviar</button></div>';
    html += '</div>';
    c.innerHTML = html;
    // Scroll al final
    var msgDiv = document.getElementById('chat-messages');
    if (msgDiv) msgDiv.scrollTop = msgDiv.scrollHeight;
  } catch(e) { c.innerHTML = '<p style="color:#ef4444;">Error</p>'; }
}

async function sendDriverMsg(otherDeviceId) {
  var input = document.getElementById('chat-input');
  var body = input ? input.value.trim() : '';
  if (!body) return;
  input.value = '';
  try {
    await fetch(API_BASE + '/api/driver-chat/' + deviceId + '/' + otherDeviceId, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: body }),
    });
    openConversation(otherDeviceId);
  } catch(e) { updateStatus('Error enviando', 'error'); }
}

async function loadChatUnread() {
  if (!deviceId) return;
  try {
    var res = await fetch(API_BASE + '/api/driver-chat/' + deviceId + '/unread');
    var data = await res.json();
    var total = data.reduce(function(sum, u) { return sum + u.count; }, 0);
    var badge = document.getElementById('chat-badge');
    if (badge) {
      if (total > 0) { badge.textContent = total; badge.style.display = 'inline'; }
      else { badge.style.display = 'none'; }
    }
  } catch(e) {}
}

document.addEventListener('DOMContentLoaded', init);
