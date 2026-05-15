const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const webPush = require('web-push');
const pool = require('./db');

const app = express();
const PORT = process.env.PORT || 3001;

const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || 'BOo4F6f4rAON57Om4re4hwCvpObP8OKAgpMsPnpJQJHy2siXrnrUB7oAw5h3MnAZLmztiIdPbs9BbP07V5ymCIk';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || 'akPJeydoIlbCtMKbRyEhTOmb6MjJZP8NrFSYIgf1kXg';
const VAPID_EMAIL = process.env.VAPID_EMAIL || 'mailto:soporte@locationtracker.net';

webPush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE);

const tokens = {}; // token -> { userId, role, companyId, name }

app.use(cors());
app.use(express.json());

function hashPass(p) { return crypto.createHash('sha256').update(p).digest('hex'); }

// ============ AUTH ============

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'username y password requeridos' });
  let conn;
  try {
    conn = await pool.getConnection();
    const rows = await conn.query('SELECT * FROM users WHERE username = ? AND is_active = 1', [username]);
    if (rows.length === 0) return res.status(401).json({ error: 'Credenciales inválidas' });
    const user = rows[0];
    if (user.password_hash !== hashPass(password)) return res.status(401).json({ error: 'Credenciales inválidas' });
    const token = crypto.randomBytes(32).toString('hex');
    tokens[token] = { userId: user.id, role: user.role, companyId: user.company_id, name: user.name };
    res.json({ success: true, token, role: user.role, name: user.name, companyId: user.company_id });
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  } finally { if (conn) conn.release(); }
});

function auth(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (!token || !tokens[token]) return res.status(401).json({ error: 'No autorizado' });
  req.user = tokens[token];
  next();
}

function superOnly(req, res, next) {
  if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'Solo super admin' });
  next();
}

// Helper: filtrar por empresa según rol
function companyFilter(req) {
  if (req.user.role === 'super_admin') return { sql: '', params: [] };
  return { sql: ' AND company_id = ?', params: [req.user.companyId] };
}

// Login para drivers (vista usuario)
app.post('/api/auth/driver-login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'username y password requeridos' });
  let conn;
  try {
    conn = await pool.getConnection();
    const rows = await conn.query("SELECT u.*, c.slug as company_slug FROM users u LEFT JOIN companies c ON c.id=u.company_id WHERE u.username=? AND u.is_active=1", [username]);
    if (rows.length === 0) return res.status(401).json({ error: 'Credenciales inválidas' });
    const user = rows[0];
    if (user.password_hash !== hashPass(password)) return res.status(401).json({ error: 'Credenciales inválidas' });
    // Verificar si el dispositivo está bloqueado
    const devices = await conn.query('SELECT id, is_blocked FROM devices WHERE user_id=?', [user.id]);
    if (devices.length > 0 && devices[0].is_blocked) {
      return res.status(403).json({ error: 'Dispositivo bloqueado. Contacta al administrador.' });
    }
    res.json({
      success: true,
      userId: user.id,
      name: user.name,
      role: user.role,
      companyId: user.company_id,
      companySlug: user.company_slug,
      deviceId: devices.length > 0 ? devices[0].id : null,
    });
  } catch (err) { res.status(500).json({ error: 'Error interno' }); }
  finally { if (conn) conn.release(); }
});

// Bloquear/desbloquear dispositivo (admin)
app.put('/api/devices/:id/block', auth, async (req, res) => {
  const { blocked } = req.body;
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.query('UPDATE devices SET is_blocked=? WHERE id=?', [blocked ? 1 : 0, req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Error interno' }); }
  finally { if (conn) conn.release(); }
});

// ============ VAPID ============

app.get('/api/vapid-public-key', (req, res) => {
  res.json({ publicKey: VAPID_PUBLIC });
});

// ============ COMPANIES (super admin only) ============

app.get('/api/companies', auth, superOnly, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    res.json(await conn.query('SELECT * FROM companies ORDER BY name'));
  } catch (err) { res.status(500).json({ error: 'Error interno' }); }
  finally { if (conn) conn.release(); }
});

app.post('/api/companies', auth, superOnly, async (req, res) => {
  const { name, slug, contact_email, contact_phone } = req.body;
  if (!name || !slug) return res.status(400).json({ error: 'name y slug requeridos' });
  let conn;
  try {
    conn = await pool.getConnection();
    const result = await conn.query('INSERT INTO companies (name, slug, contact_email, contact_phone) VALUES (?, ?, ?, ?)',
      [name, slug, contact_email || '', contact_phone || '']);
    res.json({ success: true, id: Number(result.insertId) });
  } catch (err) { res.status(500).json({ error: 'Error: slug duplicado o error interno' }); }
  finally { if (conn) conn.release(); }
});

app.put('/api/companies/:id', auth, superOnly, async (req, res) => {
  const { name, contact_email, contact_phone, is_active, plan, max_devices, expires_at, demo_until, auto_track_enabled, auto_track_interval } = req.body;
  let conn;
  try {
    conn = await pool.getConnection();
    const fields = []; const vals = [];
    if (name) { fields.push('name=?'); vals.push(name); }
    if (contact_email !== undefined) { fields.push('contact_email=?'); vals.push(contact_email); }
    if (contact_phone !== undefined) { fields.push('contact_phone=?'); vals.push(contact_phone); }
    if (is_active !== undefined) { fields.push('is_active=?'); vals.push(is_active); }
    if (plan) { fields.push('plan=?'); vals.push(plan); }
    if (max_devices !== undefined) { fields.push('max_devices=?'); vals.push(max_devices); }
    if (expires_at !== undefined) { fields.push('expires_at=?'); vals.push(expires_at || null); }
    if (demo_until !== undefined) { fields.push('demo_until=?'); vals.push(demo_until || null); }
    if (auto_track_enabled !== undefined) { fields.push('auto_track_enabled=?'); vals.push(auto_track_enabled); }
    if (auto_track_interval !== undefined) { fields.push('auto_track_interval=?'); vals.push(auto_track_interval); }
    if (fields.length) { vals.push(req.params.id); await conn.query('UPDATE companies SET ' + fields.join(',') + ' WHERE id=?', vals); }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Error interno' }); }
  finally { if (conn) conn.release(); }
});

app.delete('/api/companies/:id', auth, superOnly, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.query('DELETE FROM companies WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Error interno' }); }
  finally { if (conn) conn.release(); }
});

// ============ USERS (super admin + company admin for own company) ============

app.get('/api/users', auth, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    let sql = 'SELECT u.id, u.username, u.name, u.role, u.is_active, u.company_id, c.name as company_name FROM users u LEFT JOIN companies c ON c.id = u.company_id WHERE 1=1';
    const params = [];
    if (req.user.role !== 'super_admin') { sql += ' AND u.company_id = ?'; params.push(req.user.companyId); }
    sql += ' ORDER BY u.name';
    res.json(await conn.query(sql, params));
  } catch (err) { res.status(500).json({ error: 'Error interno' }); }
  finally { if (conn) conn.release(); }
});

app.post('/api/users', auth, async (req, res) => {
  const { username, password, name, role, company_id } = req.body;
  if (!username || !password || !name) return res.status(400).json({ error: 'username, password y name requeridos' });
  // company_admin solo puede crear company_admin de su empresa
  const finalRole = req.user.role === 'super_admin' ? (role || 'company_admin') : 'company_admin';
  const finalCompany = req.user.role === 'super_admin' ? company_id : req.user.companyId;
  if (!finalCompany && finalRole === 'company_admin') return res.status(400).json({ error: 'company_id requerido' });
  let conn;
  try {
    conn = await pool.getConnection();
    const result = await conn.query('INSERT INTO users (username, password_hash, name, role, company_id) VALUES (?, ?, ?, ?, ?)',
      [username, hashPass(password), name, finalRole, finalCompany || null]);
    res.json({ success: true, id: Number(result.insertId) });
  } catch (err) { res.status(500).json({ error: 'Username duplicado o error interno' }); }
  finally { if (conn) conn.release(); }
});

app.delete('/api/users/:id', auth, superOnly, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.query('DELETE FROM users WHERE id = ? AND role != ?', [req.params.id, 'super_admin']);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Error interno' }); }
  finally { if (conn) conn.release(); }
});

const fs = require('fs');
const path = require('path');

const AUTO_TRACK_KEY = process.env.AUTO_TRACK_KEY || 'trackmonk-auto-2026';
const CONFIG_FILE = path.join(__dirname, 'config.json');

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); }
  catch (e) { return { autoTrackEnabled: true, autoTrackInterval: 5 }; }
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

// ============ CONFIG (super admin) ============

app.get('/api/config', auth, superOnly, (req, res) => {
  res.json(loadConfig());
});

app.put('/api/config', auth, superOnly, (req, res) => {
  const cfg = loadConfig();
  if (req.body.autoTrackEnabled !== undefined) cfg.autoTrackEnabled = req.body.autoTrackEnabled;
  if (req.body.autoTrackInterval !== undefined) cfg.autoTrackInterval = parseInt(req.body.autoTrackInterval) || 30;
  saveConfig(cfg);

  // Actualizar cron real
  const { execSync } = require('child_process');
  try {
    if (cfg.autoTrackEnabled) {
      const interval = cfg.autoTrackInterval;
      const cronExpr = interval >= 60 ? '0 */' + Math.floor(interval / 60) + ' * * *' : '*/' + interval + ' * * *';
      execSync('(crontab -l 2>/dev/null | grep -v auto-track; echo "' + cronExpr + ' /home/ec2-user/trackMonk/backend/auto-track.sh") | crontab -');
    } else {
      // Desactivar: quitar el cron
      execSync('(crontab -l 2>/dev/null | grep -v auto-track) | crontab -');
    }
  } catch (e) { console.error('Error actualizando cron:', e.message); }

  res.json({ success: true, config: cfg });
});

// ============ AUTO TRACK (cron) ============

app.post('/api/auto-track', async (req, res) => {
  const { key, companyId } = req.body;
  if (key !== AUTO_TRACK_KEY) return res.status(401).json({ error: 'No autorizado' });
  const cfg = loadConfig();
  if (!cfg.autoTrackEnabled) return res.json({ success: true, sent: 0, failed: 0, total: 0, skipped: true, reason: 'disabled' });
  let conn;
  try {
    conn = await pool.getConnection();
    // Obtener empresas con auto-track activo
    let companies;
    if (companyId) {
      companies = await conn.query('SELECT * FROM companies WHERE id=? AND auto_track_enabled=1 AND is_active=1', [companyId]);
    } else {
      companies = await conn.query('SELECT * FROM companies WHERE auto_track_enabled=1 AND is_active=1');
    }
    let totalSent = 0, totalFailed = 0, totalDevices = 0;
    for (const company of companies) {
      const devices = await conn.query("SELECT * FROM devices WHERE company_id=? AND endpoint != '' AND LENGTH(endpoint) > 0", [company.id]);
      for (const d of devices) {
        totalDevices++;
        try {
          const r = await conn.query('INSERT INTO tracking_requests (device_id, status) VALUES (?, ?)', [d.id, 'sent']);
          await webPush.sendNotification(
            { endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } },
            JSON.stringify({ type: 'track-location', requestId: Number(r.insertId), title: 'Ubicación', body: 'Actualizando ubicación' })
          );
          totalSent++;
        } catch (e) { totalFailed++; }
      }
    }
    res.json({ success: true, sent: totalSent, failed: totalFailed, total: totalDevices, companies: companies.length });
  } catch (err) { res.status(500).json({ error: 'Error interno' }); }
  finally { if (conn) conn.release(); }
});

// ============ DASHBOARD METRICS ============

app.get('/api/metrics', auth, async (req, res) => {
  const cf = companyFilter(req);
  let conn;
  try {
    conn = await pool.getConnection();
    const devCount = await conn.query('SELECT COUNT(*) as c FROM devices WHERE 1=1' + cf.sql, cf.params);
    const devWithPush = await conn.query("SELECT COUNT(*) as c FROM devices WHERE endpoint != '' AND LENGTH(endpoint) > 0" + cf.sql, cf.params);
    const alertsActive = await conn.query("SELECT COUNT(*) as c FROM alerts a JOIN devices d ON d.id=a.device_id WHERE a.status='active'" + (cf.sql ? cf.sql.replace('company_id', 'd.company_id') : ''), cf.params);
    const tripsActive = await conn.query("SELECT COUNT(*) as c FROM trips t JOIN devices d ON d.id=t.device_id WHERE t.status='active'" + (cf.sql ? cf.sql.replace('company_id', 'd.company_id') : ''), cf.params);
    const tripsMonth = await conn.query("SELECT COUNT(*) as c FROM trips t JOIN devices d ON d.id=t.device_id WHERE t.started_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)" + (cf.sql ? cf.sql.replace('company_id', 'd.company_id') : ''), cf.params);
    const costsMonth = await conn.query("SELECT COALESCE(SUM(tc.amount),0) as total FROM trip_costs tc JOIN trips t ON t.id=tc.trip_id JOIN devices d ON d.id=t.device_id WHERE tc.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)" + (cf.sql ? cf.sql.replace('company_id', 'd.company_id') : ''), cf.params);
    const locationsToday = await conn.query("SELECT COUNT(*) as c FROM locations l JOIN devices d ON d.id=l.device_id WHERE l.recorded_at >= CURDATE()" + (cf.sql ? cf.sql.replace('company_id', 'd.company_id') : ''), cf.params);

    res.json({
      devices: Number(devCount[0].c),
      devicesWithPush: Number(devWithPush[0].c),
      alertsActive: Number(alertsActive[0].c),
      tripsActive: Number(tripsActive[0].c),
      tripsMonth: Number(tripsMonth[0].c),
      costsMonth: parseFloat(costsMonth[0].total),
      locationsToday: Number(locationsToday[0].c),
    });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }); }
  finally { if (conn) conn.release(); }
});

// Últimas alertas para dashboard
app.get('/api/alerts/recent', auth, async (req, res) => {
  const cf = companyFilter(req);
  let conn;
  try {
    conn = await pool.getConnection();
    let sql = "SELECT a.*, d.person_name, d.device_name, d.phone FROM alerts a JOIN devices d ON d.id=a.device_id WHERE 1=1";
    const params = [];
    if (cf.sql) { sql += cf.sql.replace('company_id', 'd.company_id'); params.push(...cf.params); }
    sql += ' ORDER BY a.created_at DESC LIMIT 5';
    res.json(await conn.query(sql, params));
  } catch (err) { res.status(500).json({ error: 'Error interno' }); }
  finally { if (conn) conn.release(); }
});

// Viajes activos para dashboard
app.get('/api/trips/active', auth, async (req, res) => {
  const cf = companyFilter(req);
  let conn;
  try {
    conn = await pool.getConnection();
    let sql = "SELECT t.*, d.person_name, d.device_name, d.vehicle FROM trips t JOIN devices d ON d.id=t.device_id WHERE t.status='active'";
    const params = [];
    if (cf.sql) { sql += cf.sql.replace('company_id', 'd.company_id'); params.push(...cf.params); }
    sql += ' ORDER BY t.started_at DESC LIMIT 5';
    res.json(await conn.query(sql, params));
  } catch (err) { res.status(500).json({ error: 'Error interno' }); }
  finally { if (conn) conn.release(); }
});

// ============ DEMO / PLANES ============

// Registrar empresa demo
app.post('/api/demo/register', async (req, res) => {
  const { companyName, contactName, email, phone } = req.body;
  if (!companyName || !email) return res.status(400).json({ error: 'companyName y email requeridos' });
  const slug = companyName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
  let conn;
  try {
    conn = await pool.getConnection();
    // Crear empresa demo
    const result = await conn.query(
      "INSERT INTO companies (name, slug, contact_email, contact_phone, plan, max_devices, demo_until) VALUES (?, ?, ?, ?, 'demo', 2, DATE_ADD(NOW(), INTERVAL 7 DAY))",
      [companyName, slug + '-' + Date.now(), email, phone || '']);
    const companyId = Number(result.insertId);
    // Crear usuario admin de la empresa
    const crypto = require('crypto');
    const tempPass = 'demo' + Math.floor(Math.random() * 9000 + 1000);
    const hash = crypto.createHash('sha256').update(tempPass).digest('hex');
    await conn.query(
      "INSERT INTO users (company_id, username, password_hash, name, role) VALUES (?, ?, ?, ?, 'company_admin')",
      [companyId, email, hash, contactName || companyName]);
    // Crear un usuario driver de prueba
    const driverPass = 'driver' + Math.floor(Math.random() * 9000 + 1000);
    const driverHash = crypto.createHash('sha256').update(driverPass).digest('hex');
    await conn.query(
      "INSERT INTO users (company_id, username, password_hash, name, role) VALUES (?, ?, ?, ?, 'driver')",
      [companyId, 'driver-' + slug, driverHash, 'Conductor Demo']);
    res.json({
      success: true,
      companyId,
      adminUser: email,
      adminPass: tempPass,
      driverUser: 'driver-' + slug,
      driverPass: driverPass,
      demoUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString('es-MX'),
    });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error creando demo' }); }
  finally { if (conn) conn.release(); }
});

// ============ DEVICES ============

app.post('/api/devices/register', async (req, res) => {
  const { deviceName, subscription, companySlug, userId } = req.body;
  if (!deviceName) return res.status(400).json({ error: 'deviceName requerido' });
  let conn;
  try {
    conn = await pool.getConnection();
    let companyId = 1;
    if (companySlug) {
      const companies = await conn.query('SELECT id FROM companies WHERE slug = ?', [companySlug]);
      if (companies.length > 0) companyId = companies[0].id;
    }
    // Verificar límites de la empresa
    const company = await conn.query('SELECT * FROM companies WHERE id=?', [companyId]);
    if (company.length > 0) {
      const c = company[0];
      // Verificar si el demo expiró
      if (c.plan === 'demo' && c.demo_until && new Date(c.demo_until) < new Date()) {
        return res.status(403).json({ error: 'El periodo de prueba ha expirado. Contacta al administrador para activar un plan.' });
      }
      // Verificar si el plan expiró
      if (c.expires_at && new Date(c.expires_at) < new Date()) {
        return res.status(403).json({ error: 'Tu plan ha expirado. Contacta al administrador.' });
      }
      // Verificar límite de dispositivos (solo si no es update)
      if (userId) {
        const existing = await conn.query('SELECT id FROM devices WHERE user_id=?', [userId]);
        if (existing.length > 0) {
          // Es update, permitir
          const did = existing[0].id;
          if (subscription && subscription.endpoint) {
            await conn.query('UPDATE devices SET device_name=?, endpoint=?, p256dh=?, auth=? WHERE id=?', [deviceName, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, did]);
          } else {
            await conn.query('UPDATE devices SET device_name=? WHERE id=?', [deviceName, did]);
          }
          return res.json({ success: true, deviceId: did });
        }
      }
      const deviceCount = await conn.query('SELECT COUNT(*) as cnt FROM devices WHERE company_id=?', [companyId]);
      if (deviceCount[0].cnt >= c.max_devices) {
        return res.status(403).json({ error: 'Límite de dispositivos alcanzado (' + c.max_devices + '). Actualiza tu plan.' });
      }
    }
    if (subscription && subscription.endpoint) {
      const existing = await conn.query('SELECT id FROM devices WHERE endpoint = ?', [subscription.endpoint]);
      if (existing.length > 0) {
        const did = existing[0].id;
        await conn.query('UPDATE devices SET device_name=?, p256dh=?, auth=?, user_id=? WHERE id=?', [deviceName, subscription.keys.p256dh, subscription.keys.auth, userId || null, did]);
        return res.json({ success: true, deviceId: did });
      }
      const result = await conn.query("INSERT INTO devices (company_id, device_name, endpoint, p256dh, auth, user_id) VALUES (?, ?, ?, ?, ?, ?)", [companyId, deviceName, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, userId || null]);
      return res.json({ success: true, deviceId: Number(result.insertId) });
    }
    const result = await conn.query("INSERT INTO devices (company_id, device_name, endpoint, p256dh, auth, user_id) VALUES (?, ?, '', '', '', ?)", [companyId, deviceName, userId || null]);
    res.json({ success: true, deviceId: Number(result.insertId) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }); }
  finally { if (conn) conn.release(); }
});

// Actualizar perfil desde el usuario (público)
app.put('/api/devices/:id/profile', async (req, res) => {
  const { device_name, person_name, phone, company, vehicle } = req.body;
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.query('UPDATE devices SET device_name=?, person_name=?, phone=?, vehicle=? WHERE id=?',
      [device_name||'', person_name||'', phone||'', vehicle||'', req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Error interno' }); }
  finally { if (conn) conn.release(); }
});

app.put('/api/devices/:id/push', async (req, res) => {
  const { subscription } = req.body;
  if (!subscription || !subscription.endpoint) return res.status(400).json({ error: 'subscription requerida' });
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.query('UPDATE devices SET endpoint=?, p256dh=?, auth=? WHERE id=?',
      [subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Error interno' }); }
  finally { if (conn) conn.release(); }
});

app.put('/api/devices/:id', auth, async (req, res) => {
  const { device_name, person_name, phone, vehicle } = req.body;
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.query('UPDATE devices SET device_name=?, person_name=?, phone=?, vehicle=? WHERE id=?',
      [device_name||'', person_name||'', phone||'', vehicle||'', req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Error interno' }); }
  finally { if (conn) conn.release(); }
});

app.get('/api/devices', auth, async (req, res) => {
  const cf = companyFilter(req);
  let conn;
  try {
    conn = await pool.getConnection();
    const sql = 'SELECT d.*, c.name as company_name FROM devices d JOIN companies c ON c.id=d.company_id WHERE 1=1' + cf.sql + ' ORDER BY d.person_name';
    res.json(await conn.query(sql, cf.params));
  } catch (err) { res.status(500).json({ error: 'Error interno' }); }
  finally { if (conn) conn.release(); }
});

app.get('/api/devices/search', auth, async (req, res) => {
  const { q } = req.query;
  if (!q) return res.json([]);
  const cf = companyFilter(req);
  const term = '%' + q + '%';
  let conn;
  try {
    conn = await pool.getConnection();
    const sql = 'SELECT d.*, c.name as company_name FROM devices d JOIN companies c ON c.id=d.company_id WHERE (d.device_name LIKE ? OR d.phone LIKE ? OR d.person_name LIKE ? OR d.vehicle LIKE ?)' + cf.sql + ' LIMIT 50';
    res.json(await conn.query(sql, [term, term, term, term, ...cf.params]));
  } catch (err) { res.status(500).json({ error: 'Error interno' }); }
  finally { if (conn) conn.release(); }
});

app.get('/api/devices/:id', async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const rows = await conn.query('SELECT d.*, c.name as company_name FROM devices d JOIN companies c ON c.id=d.company_id WHERE d.id=?', [req.params.id]);
    res.json(rows[0] || null);
  } catch (err) { res.status(500).json({ error: 'Error interno' }); }
  finally { if (conn) conn.release(); }
});

app.delete('/api/devices/:id', auth, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.query('DELETE FROM devices WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Error interno' }); }
  finally { if (conn) conn.release(); }
});

// ============ TRACKING ============

app.post('/api/track/:deviceId', auth, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const devices = await conn.query('SELECT * FROM devices WHERE id=?', [req.params.deviceId]);
    if (!devices.length) return res.status(404).json({ error: 'No encontrado' });
    const d = devices[0];
    if (!d.endpoint || d.endpoint.length === 0) return res.status(400).json({ error: 'Sin push activado' });
    const result = await conn.query('INSERT INTO tracking_requests (device_id, status) VALUES (?, ?)', [d.id, 'sent']);
    const requestId = Number(result.insertId);
    await webPush.sendNotification(
      { endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } },
      JSON.stringify({ type: 'track-location', requestId, title: 'Ubicación solicitada', body: 'Se ha solicitado tu ubicación' })
    );
    res.json({ success: true, requestId });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error push' }); }
  finally { if (conn) conn.release(); }
});

app.post('/api/track-all', auth, async (req, res) => {
  const cf = companyFilter(req);
  let conn;
  try {
    conn = await pool.getConnection();
    const devices = await conn.query("SELECT * FROM devices WHERE endpoint != '' AND LENGTH(endpoint) > 0" + cf.sql, cf.params);
    const noPush = await conn.query("SELECT id, device_name, person_name FROM devices WHERE (endpoint = '' OR endpoint IS NULL OR LENGTH(endpoint) = 0)" + cf.sql, cf.params);
    const results = [];
    for (const d of devices) {
      try {
        const r = await conn.query('INSERT INTO tracking_requests (device_id, status) VALUES (?, ?)', [d.id, 'sent']);
        await webPush.sendNotification(
          { endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } },
          JSON.stringify({ type: 'track-location', requestId: Number(r.insertId), title: 'Ubicación solicitada', body: 'Se ha solicitado tu ubicación' })
        );
        results.push({ id: d.id, name: d.person_name || d.device_name, requestId: Number(r.insertId), status: 'sent' });
      } catch (e) { results.push({ id: d.id, name: d.person_name || d.device_name, status: 'failed' }); }
    }
    noPush.forEach(d => results.push({ id: d.id, name: d.person_name || d.device_name, status: 'no_push' }));
    res.json({ success: true, sent: results.filter(r=>r.status==='sent').length, failed: results.filter(r=>r.status==='failed').length, noPush: noPush.length, total: results.length, results });
  } catch (err) { res.status(500).json({ error: 'Error interno' }); }
  finally { if (conn) conn.release(); }
});

app.post('/api/track-all/check', auth, async (req, res) => {
  const { requestIds } = req.body;
  if (!requestIds || !requestIds.length) return res.json([]);
  let conn;
  try {
    conn = await pool.getConnection();
    const ph = requestIds.map(() => '?').join(',');
    res.json(await conn.query('SELECT tr.id as requestId, tr.device_id, tr.status, d.person_name, d.device_name FROM tracking_requests tr JOIN devices d ON d.id=tr.device_id WHERE tr.id IN (' + ph + ')', requestIds));
  } catch (err) { res.status(500).json({ error: 'Error interno' }); }
  finally { if (conn) conn.release(); }
});

app.get('/api/track-status/:requestId', auth, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const rows = await conn.query('SELECT tr.*, l.latitude, l.longitude, l.accuracy, l.recorded_at as location_timestamp FROM tracking_requests tr LEFT JOIN locations l ON l.device_id=tr.device_id AND l.recorded_at>=tr.created_at WHERE tr.id=? ORDER BY l.recorded_at DESC LIMIT 1', [req.params.requestId]);
    res.json(rows[0] || null);
  } catch (err) { res.status(500).json({ error: 'Error interno' }); }
  finally { if (conn) conn.release(); }
});

// ============ LOCATIONS ============

app.post('/api/location', async (req, res) => {
  const { deviceId, requestId, latitude, longitude, accuracy, speed } = req.body;
  if (!deviceId || latitude == null || longitude == null) return res.status(400).json({ error: 'Faltan datos' });
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.query('INSERT INTO locations (device_id, latitude, longitude, accuracy, speed) VALUES (?, ?, ?, ?, ?)', [deviceId, latitude, longitude, accuracy || null, speed || null]);
    if (requestId) await conn.query("UPDATE tracking_requests SET status='received', responded_at=NOW() WHERE id=?", [requestId]);

    // Verificar geocercas
    checkGeofences(conn, deviceId, latitude, longitude);

    // Verificar velocidad máxima
    if (speed && speed > 0) {
      const speedKmh = speed * 3.6; // m/s a km/h
      const device = await conn.query('SELECT company_id FROM devices WHERE id=?', [deviceId]);
      if (device.length) {
        const company = await conn.query('SELECT max_speed_kmh, contact_phone FROM companies WHERE id=?', [device[0].company_id]);
        if (company.length && company[0].max_speed_kmh && speedKmh > company[0].max_speed_kmh) {
          console.log('⚠️ VELOCIDAD: Dispositivo ' + deviceId + ' a ' + Math.round(speedKmh) + ' km/h (máx: ' + company[0].max_speed_kmh + ')');
        }
      }
    }

    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Error interno' }); }
  finally { if (conn) conn.release(); }
});

// Verificar si el dispositivo salió/entró de una geocerca
async function checkGeofences(conn, deviceId, lat, lng) {
  try {
    const device = await conn.query('SELECT company_id FROM devices WHERE id=?', [deviceId]);
    if (!device.length) return;
    const companyId = device[0].company_id;
    const fences = await conn.query('SELECT * FROM geofences WHERE company_id=? AND is_active=1', [companyId]);

    for (const fence of fences) {
      const distance = getDistanceKm(lat, lng, fence.latitude, fence.longitude) * 1000; // metros
      const isInside = distance <= fence.radius_meters;

      // Obtener última alerta para este dispositivo y geocerca
      const lastAlert = await conn.query('SELECT event_type FROM geofence_alerts WHERE geofence_id=? AND device_id=? ORDER BY created_at DESC LIMIT 1', [fence.id, deviceId]);
      const wasInside = lastAlert.length === 0 || lastAlert[0].event_type === 'enter';

      if (!isInside && wasInside && fence.alert_on_exit) {
        await conn.query('INSERT INTO geofence_alerts (geofence_id, device_id, event_type, latitude, longitude) VALUES (?, ?, ?, ?, ?)', [fence.id, deviceId, 'exit', lat, lng]);
        console.log('⚠️ GEOCERCA: Dispositivo ' + deviceId + ' salió de "' + fence.name + '"');
      } else if (isInside && !wasInside && fence.alert_on_enter) {
        await conn.query('INSERT INTO geofence_alerts (geofence_id, device_id, event_type, latitude, longitude) VALUES (?, ?, ?, ?, ?)', [fence.id, deviceId, 'enter', lat, lng]);
      }
    }
  } catch (e) { console.error('Geofence check error:', e.message); }
}

function getDistanceKm(lat1, lng1, lat2, lng2) {
  var R = 6371;
  var dLat = (lat2 - lat1) * Math.PI / 180;
  var dLng = (lng2 - lng1) * Math.PI / 180;
  var a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2) * Math.sin(dLng/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ============ GEOFENCES ============

app.get('/api/geofences', auth, async (req, res) => {
  const cf = companyFilter(req);
  let conn;
  try {
    conn = await pool.getConnection();
    res.json(await conn.query('SELECT * FROM geofences WHERE 1=1' + cf.sql + ' ORDER BY name', cf.params));
  } catch (err) { res.status(500).json({ error: 'Error interno' }); }
  finally { if (conn) conn.release(); }
});

app.post('/api/geofences', auth, async (req, res) => {
  const { name, latitude, longitude, radius_meters, alert_on_exit, alert_on_enter, company_id } = req.body;
  if (!name || !latitude || !longitude) return res.status(400).json({ error: 'Faltan datos' });
  const cid = req.user.role === 'super_admin' ? (company_id || 1) : req.user.companyId;
  let conn;
  try {
    conn = await pool.getConnection();
    const r = await conn.query('INSERT INTO geofences (company_id, name, latitude, longitude, radius_meters, alert_on_exit, alert_on_enter) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [cid, name, latitude, longitude, radius_meters || 500, alert_on_exit !== undefined ? alert_on_exit : 1, alert_on_enter || 0]);
    res.json({ success: true, id: Number(r.insertId) });
  } catch (err) { res.status(500).json({ error: 'Error interno' }); }
  finally { if (conn) conn.release(); }
});

app.delete('/api/geofences/:id', auth, async (req, res) => {
  let conn;
  try { conn = await pool.getConnection(); await conn.query('DELETE FROM geofences WHERE id=?', [req.params.id]); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: 'Error interno' }); }
  finally { if (conn) conn.release(); }
});

app.get('/api/geofence-alerts', auth, async (req, res) => {
  const cf = companyFilter(req);
  let conn;
  try {
    conn = await pool.getConnection();
    let sql = 'SELECT ga.*, g.name as fence_name, d.person_name, d.device_name FROM geofence_alerts ga JOIN geofences g ON g.id=ga.geofence_id JOIN devices d ON d.id=ga.device_id WHERE 1=1';
    const params = [];
    if (cf.sql) { sql += cf.sql.replace('company_id', 'd.company_id'); params.push(...cf.params); }
    sql += ' ORDER BY ga.created_at DESC LIMIT 50';
    res.json(await conn.query(sql, params));
  } catch (err) { res.status(500).json({ error: 'Error interno' }); }
  finally { if (conn) conn.release(); }
});

// Kilometraje de un dispositivo entre fechas
app.get('/api/mileage/:deviceId', auth, async (req, res) => {
  const { from, to } = req.query;
  let conn;
  try {
    conn = await pool.getConnection();
    let sql = 'SELECT latitude, longitude, recorded_at FROM locations WHERE device_id=?';
    const params = [req.params.deviceId];
    if (from) { sql += ' AND recorded_at >= ?'; params.push(from + ' 00:00:00'); }
    if (to) { sql += ' AND recorded_at <= ?'; params.push(to + ' 23:59:59'); }
    sql += ' ORDER BY recorded_at ASC';
    const locs = await conn.query(sql, params);

    var totalKm = 0;
    for (var i = 1; i < locs.length; i++) {
      totalKm += getDistanceKm(locs[i-1].latitude, locs[i-1].longitude, locs[i].latitude, locs[i].longitude);
    }
    res.json({ deviceId: req.params.deviceId, totalKm: Math.round(totalKm * 10) / 10, points: locs.length, from: from, to: to });
  } catch (err) { res.status(500).json({ error: 'Error interno' }); }
  finally { if (conn) conn.release(); }
});

app.get('/api/locations/:deviceId', auth, async (req, res) => {
  const { from, to } = req.query;
  let conn;
  try {
    conn = await pool.getConnection();
    let sql = 'SELECT *, DATE(recorded_at) as day FROM locations WHERE device_id=?';
    const params = [req.params.deviceId];
    if (from) { sql += ' AND recorded_at >= ?'; params.push(from + ' 00:00:00'); }
    if (to) { sql += ' AND recorded_at <= ?'; params.push(to + ' 23:59:59'); }
    sql += ' ORDER BY recorded_at DESC LIMIT ?';
    params.push(parseInt(req.query.limit) || 200);
    res.json(await conn.query(sql, params));
  } catch (err) { res.status(500).json({ error: 'Error interno' }); }
  finally { if (conn) conn.release(); }
});

// Resumen de tracks por día
app.get('/api/locations/:deviceId/daily', auth, async (req, res) => {
  const { from, to } = req.query;
  let conn;
  try {
    conn = await pool.getConnection();
    let sql = 'SELECT DATE(recorded_at) as day, COUNT(*) as points, MIN(recorded_at) as first_time, MAX(recorded_at) as last_time FROM locations WHERE device_id=?';
    const params = [req.params.deviceId];
    if (from) { sql += ' AND recorded_at >= ?'; params.push(from + ' 00:00:00'); }
    if (to) { sql += ' AND recorded_at <= ?'; params.push(to + ' 23:59:59'); }
    sql += ' GROUP BY DATE(recorded_at) ORDER BY day DESC LIMIT 30';
    res.json(await conn.query(sql, params));
  } catch (err) { res.status(500).json({ error: 'Error interno' }); }
  finally { if (conn) conn.release(); }
});

app.get('/api/locations/:deviceId/latest', auth, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const rows = await conn.query('SELECT * FROM locations WHERE device_id=? ORDER BY recorded_at DESC LIMIT 1', [req.params.deviceId]);
    res.json(rows[0] || null);
  } catch (err) { res.status(500).json({ error: 'Error interno' }); }
  finally { if (conn) conn.release(); }
});

app.get('/api/my-locations/:deviceId', async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    res.json(await conn.query('SELECT recorded_at, latitude, longitude, accuracy FROM locations WHERE device_id=? ORDER BY recorded_at DESC LIMIT ?', [req.params.deviceId, parseInt(req.query.limit) || 50]));
  } catch (err) { res.status(500).json({ error: 'Error interno' }); }
  finally { if (conn) conn.release(); }
});

app.get('/api/locations-all/latest', auth, async (req, res) => {
  const cf = companyFilter(req);
  let conn;
  try {
    conn = await pool.getConnection();
    const sql = 'SELECT d.id, d.device_name, d.company_id, d.phone, d.person_name, d.vehicle, c.name as company_name, l.latitude, l.longitude, l.accuracy, l.recorded_at FROM devices d JOIN companies c ON c.id=d.company_id INNER JOIN locations l ON l.id=(SELECT l2.id FROM locations l2 WHERE l2.device_id=d.id ORDER BY l2.recorded_at DESC LIMIT 1) WHERE 1=1' + cf.sql;
    res.json(await conn.query(sql, cf.params));
  } catch (err) { res.status(500).json({ error: 'Error interno' }); }
  finally { if (conn) conn.release(); }
});

// ============ MESSAGES ============

app.post('/api/push-message/:deviceId', auth, async (req, res) => {
  const { title, body } = req.body;
  if (!body) return res.status(400).json({ error: 'body requerido' });
  let conn;
  try {
    conn = await pool.getConnection();
    const devices = await conn.query('SELECT * FROM devices WHERE id=?', [req.params.deviceId]);
    if (!devices.length) return res.status(404).json({ error: 'No encontrado' });
    await conn.query('INSERT INTO messages (device_id, title, body) VALUES (?, ?, ?)', [req.params.deviceId, title || 'TrackMonk', body]);
    const d = devices[0];
    if (d.endpoint && d.endpoint.length > 0) {
      try { await webPush.sendNotification({ endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } }, JSON.stringify({ type: 'custom-message', title: title || 'TrackMonk', body })); } catch (e) {}
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Error interno' }); }
  finally { if (conn) conn.release(); }
});

app.get('/api/my-messages/:deviceId', async (req, res) => {
  let conn;
  try { conn = await pool.getConnection(); res.json(await conn.query('SELECT * FROM messages WHERE device_id=? ORDER BY created_at DESC LIMIT 50', [req.params.deviceId])); }
  catch (err) { res.status(500).json({ error: 'Error interno' }); }
  finally { if (conn) conn.release(); }
});

// Todos los mensajes con respuestas (admin)
app.get('/api/messages/all', auth, async (req, res) => {
  const cf = companyFilter(req);
  let conn;
  try {
    conn = await pool.getConnection();
    let sql = "SELECT m.*, d.person_name, d.device_name, d.phone FROM messages m JOIN devices d ON d.id=m.device_id WHERE 1=1";
    const params = [];
    if (cf.sql) { sql += cf.sql.replace('company_id', 'd.company_id'); params.push(...cf.params); }
    sql += ' ORDER BY m.created_at DESC LIMIT 100';
    res.json(await conn.query(sql, params));
  } catch (err) { res.status(500).json({ error: 'Error interno' }); }
  finally { if (conn) conn.release(); }
});

// Mensajes con respuestas pendientes (admin)
app.get('/api/messages/with-replies', auth, async (req, res) => {
  const cf = companyFilter(req);
  let conn;
  try {
    conn = await pool.getConnection();
    let sql = "SELECT m.*, d.person_name, d.device_name, d.phone FROM messages m JOIN devices d ON d.id=m.device_id WHERE m.reply IS NOT NULL";
    const params = [];
    if (cf.sql) { sql += cf.sql.replace('company_id', 'd.company_id'); params.push(...cf.params); }
    sql += ' ORDER BY m.replied_at DESC LIMIT 50';
    res.json(await conn.query(sql, params));
  } catch (err) { res.status(500).json({ error: 'Error interno' }); }
  finally { if (conn) conn.release(); }
});

app.put('/api/my-messages/:id/read', async (req, res) => {
  let conn;
  try { conn = await pool.getConnection(); await conn.query('UPDATE messages SET is_read=1 WHERE id=?', [req.params.id]); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: 'Error interno' }); }
  finally { if (conn) conn.release(); }
});

app.post('/api/my-messages/:id/reply', async (req, res) => {
  const { reply } = req.body;
  if (!reply) return res.status(400).json({ error: 'reply requerido' });
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.query('UPDATE messages SET reply=?, replied_at=NOW(), is_read=1 WHERE id=?', [reply, req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Error interno' }); }
  finally { if (conn) conn.release(); }
});

app.get('/api/my-messages/:deviceId/unread', async (req, res) => {
  let conn;
  try { conn = await pool.getConnection(); const r = await conn.query("SELECT COUNT(*) as count FROM messages WHERE device_id=? AND is_read=0", [req.params.deviceId]); res.json({ count: Number(r[0].count) }); }
  catch (err) { res.status(500).json({ error: 'Error interno' }); }
  finally { if (conn) conn.release(); }
});

// ============ ALERTS ============

app.post('/api/alerts', async (req, res) => {
  const { deviceId, alert_type, message, latitude, longitude, accuracy } = req.body;
  if (!deviceId || !alert_type) return res.status(400).json({ error: 'deviceId y alert_type requeridos' });
  let conn;
  try {
    conn = await pool.getConnection();
    const result = await conn.query('INSERT INTO alerts (device_id, alert_type, message, latitude, longitude, accuracy) VALUES (?, ?, ?, ?, ?, ?)',
      [deviceId, alert_type, message || '', latitude || null, longitude || null, accuracy || null]);
    // Notificar por SMS al admin de la empresa
    const devices = await conn.query('SELECT d.*, c.contact_email, c.contact_phone FROM devices d JOIN companies c ON c.id=d.company_id WHERE d.id=?', [deviceId]);
    if (devices.length > 0) {
      const d = devices[0];
      const typeLabels = { accident:'ACCIDENTE', robbery:'ROBO/ASALTO', breakdown:'AVERIA', help:'AUXILIO' };
      const alertMsg = '🚨 ALERTA ' + (typeLabels[alert_type]||alert_type) + ' - ' + (d.person_name||d.device_name) + (d.phone ? ' Tel:'+d.phone : '') + (latitude ? ' Maps:https://www.google.com/maps?q='+latitude+','+longitude : '');
      console.log(alertMsg);
      // Enviar SMS via Lambda si hay teléfono de contacto de la empresa
      if (d.contact_phone) {
        sendAlertSMS(d.contact_phone, alertMsg);
      }
    }
    res.json({ success: true, alertId: Number(result.insertId) });
  } catch (err) { res.status(500).json({ error: 'Error interno' }); }
  finally { if (conn) conn.release(); }
});

// Enviar SMS de alerta via Lambda
function sendAlertSMS(phone, message) {
  const { spawn } = require('child_process');
  var formattedPhone = phone.replace(/[^0-9]/g, '');

  var script = 'import boto3,json; c=boto3.client("lambda",region_name="us-east-1"); r=c.invoke(FunctionName="envi_sms_python",InvocationType="Event",Payload=json.dumps({"msisdn":"' + formattedPhone + '","message":"' + message.replace(/"/g, '\\"').replace(/\n/g, ' ').substring(0, 140) + '"})); print(r["StatusCode"])';

  var proc = spawn('python3', ['-c', script], { env: Object.assign({}, process.env, { HOME: '/home/ec2-user' }) });
  proc.stdout.on('data', function(data) { console.log('SMS resultado: ' + data.toString().trim()); });
  proc.stderr.on('data', function(data) { console.error('SMS error: ' + data.toString().trim()); });
  proc.on('close', function(code) { if (code !== 0) console.error('SMS proceso terminó con código: ' + code); });
}

app.get('/api/alerts', auth, async (req, res) => {
  const { status } = req.query;
  const cf = companyFilter(req);
  let conn;
  try {
    conn = await pool.getConnection();
    let sql = 'SELECT a.*, d.person_name, d.device_name, d.phone, d.vehicle, d.company_id FROM alerts a JOIN devices d ON d.id=a.device_id WHERE 1=1';
    const params = [];
    if (status) { sql += ' AND a.status=?'; params.push(status); }
    if (cf.sql) { sql += cf.sql.replace('company_id', 'd.company_id'); params.push(...cf.params); }
    sql += ' ORDER BY a.created_at DESC LIMIT 100';
    res.json(await conn.query(sql, params));
  } catch (err) { res.status(500).json({ error: 'Error interno' }); }
  finally { if (conn) conn.release(); }
});

app.get('/api/alerts/active-count', auth, async (req, res) => {
  const cf = companyFilter(req);
  let conn;
  try {
    conn = await pool.getConnection();
    let sql = "SELECT COUNT(*) as count FROM alerts a JOIN devices d ON d.id=a.device_id WHERE a.status='active'";
    const params = [];
    if (cf.sql) { sql += cf.sql.replace('company_id', 'd.company_id'); params.push(...cf.params); }
    const r = await conn.query(sql, params);
    res.json({ count: Number(r[0].count) });
  } catch (err) { res.status(500).json({ error: 'Error interno' }); }
  finally { if (conn) conn.release(); }
});

app.put('/api/alerts/:id', auth, async (req, res) => {
  const { status, resolved_by } = req.body;
  let conn;
  try {
    conn = await pool.getConnection();
    if (status === 'resolved') await conn.query("UPDATE alerts SET status=?, resolved_at=NOW(), resolved_by=? WHERE id=?", [status, resolved_by || req.user.name, req.params.id]);
    else await conn.query('UPDATE alerts SET status=? WHERE id=?', [status, req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Error interno' }); }
  finally { if (conn) conn.release(); }
});

app.get('/api/my-alerts/:deviceId', async (req, res) => {
  let conn;
  try { conn = await pool.getConnection(); res.json(await conn.query('SELECT * FROM alerts WHERE device_id=? ORDER BY created_at DESC LIMIT 20', [req.params.deviceId])); }
  catch (err) { res.status(500).json({ error: 'Error interno' }); }
  finally { if (conn) conn.release(); }
});

// ============ TRIPS ============

app.post('/api/trips', auth, async (req, res) => {
  const { device_id, origin, destination, cargo, notes } = req.body;
  if (!device_id || !origin || !destination) return res.status(400).json({ error: 'Faltan datos' });
  let conn;
  try {
    conn = await pool.getConnection();
    const r = await conn.query('INSERT INTO trips (device_id, origin, destination, cargo, notes) VALUES (?, ?, ?, ?, ?)', [device_id, origin, destination, cargo||'', notes||'']);
    res.json({ success: true, tripId: Number(r.insertId) });
  } catch (err) { res.status(500).json({ error: 'Error interno' }); }
  finally { if (conn) conn.release(); }
});

app.get('/api/trips', auth, async (req, res) => {
  const { status, device_id } = req.query;
  const cf = companyFilter(req);
  let conn;
  try {
    conn = await pool.getConnection();
    let sql = 'SELECT t.*, d.person_name, d.device_name, d.vehicle, d.phone, d.company_id, (SELECT SUM(amount) FROM trip_costs WHERE trip_id=t.id) as total_cost, (SELECT COUNT(*) FROM trip_locations WHERE trip_id=t.id) as location_count FROM trips t JOIN devices d ON d.id=t.device_id WHERE 1=1';
    const params = [];
    if (status) { sql += ' AND t.status=?'; params.push(status); }
    if (device_id) { sql += ' AND t.device_id=?'; params.push(device_id); }
    if (cf.sql) { sql += cf.sql.replace('company_id', 'd.company_id'); params.push(...cf.params); }
    sql += ' ORDER BY t.started_at DESC LIMIT 100';
    res.json(await conn.query(sql, params));
  } catch (err) { res.status(500).json({ error: 'Error interno' }); }
  finally { if (conn) conn.release(); }
});

app.get('/api/trips/:id', auth, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const trips = await conn.query('SELECT t.*, d.person_name, d.device_name, d.vehicle, d.phone FROM trips t JOIN devices d ON d.id=t.device_id WHERE t.id=?', [req.params.id]);
    if (!trips.length) return res.status(404).json({ error: 'No encontrado' });
    const trip = trips[0];
    trip.costs = await conn.query('SELECT * FROM trip_costs WHERE trip_id=? ORDER BY created_at', [req.params.id]);
    trip.locations = await conn.query('SELECT * FROM trip_locations WHERE trip_id=? ORDER BY recorded_at', [req.params.id]);
    trip.total_cost = trip.costs.reduce((s, c) => s + parseFloat(c.amount), 0);
    res.json(trip);
  } catch (err) { res.status(500).json({ error: 'Error interno' }); }
  finally { if (conn) conn.release(); }
});

app.put('/api/trips/:id', auth, async (req, res) => {
  const { status, origin, destination, cargo, notes } = req.body;
  let conn;
  try {
    conn = await pool.getConnection();
    if (status === 'completed') await conn.query("UPDATE trips SET status=?, completed_at=NOW() WHERE id=?", [status, req.params.id]);
    else if (status) await conn.query('UPDATE trips SET status=? WHERE id=?', [status, req.params.id]);
    const fields = []; const vals = [];
    if (origin) { fields.push('origin=?'); vals.push(origin); }
    if (destination) { fields.push('destination=?'); vals.push(destination); }
    if (cargo !== undefined) { fields.push('cargo=?'); vals.push(cargo); }
    if (notes !== undefined) { fields.push('notes=?'); vals.push(notes); }
    if (fields.length) { vals.push(req.params.id); await conn.query('UPDATE trips SET ' + fields.join(',') + ' WHERE id=?', vals); }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Error interno' }); }
  finally { if (conn) conn.release(); }
});

app.post('/api/trips/:id/costs', auth, async (req, res) => {
  const { concept, amount } = req.body;
  if (!concept || amount == null) return res.status(400).json({ error: 'Faltan datos' });
  let conn;
  try { conn = await pool.getConnection(); await conn.query('INSERT INTO trip_costs (trip_id, concept, amount) VALUES (?, ?, ?)', [req.params.id, concept, amount]); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: 'Error interno' }); }
  finally { if (conn) conn.release(); }
});

app.delete('/api/trip-costs/:id', auth, async (req, res) => {
  let conn;
  try { conn = await pool.getConnection(); await conn.query('DELETE FROM trip_costs WHERE id=?', [req.params.id]); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: 'Error interno' }); }
  finally { if (conn) conn.release(); }
});

app.post('/api/trips/:id/location', async (req, res) => {
  const { latitude, longitude, accuracy } = req.body;
  if (latitude == null || longitude == null) return res.status(400).json({ error: 'Faltan datos' });
  let conn;
  try { conn = await pool.getConnection(); await conn.query('INSERT INTO trip_locations (trip_id, latitude, longitude, accuracy) VALUES (?, ?, ?, ?)', [req.params.id, latitude, longitude, accuracy || null]); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: 'Error interno' }); }
  finally { if (conn) conn.release(); }
});

// Public trip routes for user
app.get('/api/my-trips/:deviceId', async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    // Buscar por device_id o por user_id del dispositivo
    var trips = await conn.query("SELECT t.*, (SELECT SUM(amount) FROM trip_costs WHERE trip_id=t.id) as total_cost FROM trips t WHERE t.device_id=? AND t.status='active' ORDER BY t.started_at DESC", [req.params.deviceId]);
    if (trips.length === 0) {
      // Fallback: buscar por user_id
      var devices = await conn.query('SELECT user_id FROM devices WHERE id=?', [req.params.deviceId]);
      if (devices.length > 0 && devices[0].user_id) {
        var userDevices = await conn.query('SELECT id FROM devices WHERE user_id=?', [devices[0].user_id]);
        var deviceIds = userDevices.map(function(d) { return d.id; });
        if (deviceIds.length > 0) {
          var ph = deviceIds.map(function() { return '?'; }).join(',');
          trips = await conn.query("SELECT t.*, (SELECT SUM(amount) FROM trip_costs WHERE trip_id=t.id) as total_cost FROM trips t WHERE t.device_id IN (" + ph + ") AND t.status='active' ORDER BY t.started_at DESC", deviceIds);
        }
      }
    }
    res.json(trips);
  } catch (err) { res.status(500).json({ error: 'Error interno' }); }
  finally { if (conn) conn.release(); }
});

app.get('/api/my-trips/:tripId/costs', async (req, res) => {
  let conn;
  try { conn = await pool.getConnection(); res.json(await conn.query('SELECT * FROM trip_costs WHERE trip_id=? ORDER BY created_at DESC', [req.params.tripId])); }
  catch (err) { res.status(500).json({ error: 'Error interno' }); }
  finally { if (conn) conn.release(); }
});

app.post('/api/my-trips/:tripId/costs', async (req, res) => {
  const { concept, amount } = req.body;
  if (!concept || amount == null) return res.status(400).json({ error: 'Faltan datos' });
  let conn;
  try { conn = await pool.getConnection(); await conn.query('INSERT INTO trip_costs (trip_id, concept, amount) VALUES (?, ?, ?)', [req.params.tripId, concept, amount]); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: 'Error interno' }); }
  finally { if (conn) conn.release(); }
});

app.put('/api/my-trips/:tripId/complete', async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.query("UPDATE trips SET status='completed', completed_at=NOW() WHERE id=?", [req.params.tripId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Error interno' }); }
  finally { if (conn) conn.release(); }
});

// Subir foto de evidencia o firma (público, desde conductor)
app.post('/api/my-trips/:tripId/evidence', async (req, res) => {
  const { deviceId, type, description, image_data, latitude, longitude } = req.body;
  if (!deviceId || !type || !image_data) return res.status(400).json({ error: 'Faltan datos' });
  let conn;
  try {
    // Subir a S3
    const { exec } = require('child_process');
    const filename = 'evidence/' + req.params.tripId + '/' + Date.now() + '-' + type + '.png';
    
    // Extraer base64
    var base64Data = image_data;
    if (base64Data.startsWith('data:')) base64Data = base64Data.split(',')[1];
    
    // Guardar temporalmente y subir
    const fs = require('fs');
    const tmpFile = '/tmp/trackmonk-' + Date.now() + '.png';
    fs.writeFileSync(tmpFile, Buffer.from(base64Data, 'base64'));
    
    const s3Url = 'https://trackmonk-evidence.s3.amazonaws.com/' + filename;
    
    await new Promise(function(resolve, reject) {
      exec('aws s3 cp ' + tmpFile + ' s3://trackmonk-evidence/' + filename + ' --acl public-read --content-type image/png', function(err) {
        fs.unlinkSync(tmpFile);
        if (err) reject(err); else resolve();
      });
    });

    conn = await pool.getConnection();
    await conn.query('INSERT INTO trip_evidence (trip_id, device_id, type, description, image_url, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [req.params.tripId, deviceId, type, description || '', s3Url, latitude || null, longitude || null]);
    res.json({ success: true, url: s3Url });
  } catch (err) { console.error('Evidence upload error:', err); res.status(500).json({ error: 'Error subiendo' }); }
  finally { if (conn) conn.release(); }
});

// Ver evidencias de un viaje (admin)
app.get('/api/trips/:tripId/evidence', auth, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    var rows = await conn.query('SELECT id, type, description, image_url, latitude, longitude, created_at FROM trip_evidence WHERE trip_id=? ORDER BY created_at DESC', [req.params.tripId]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Error interno' }); }
  finally { if (conn) conn.release(); }
});

// Ver imagen individual
app.get('/api/evidence/:id/image', async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    var rows = await conn.query('SELECT image_data FROM trip_evidence WHERE id=?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'No encontrado' });
    var imgData = rows[0].image_data;
    if (imgData.startsWith('data:')) {
      var parts = imgData.split(',');
      var mime = parts[0].match(/:(.*?);/)[1];
      var buffer = Buffer.from(parts[1], 'base64');
      res.set('Content-Type', mime);
      res.send(buffer);
    } else {
      res.set('Content-Type', 'image/png');
      res.send(Buffer.from(imgData, 'base64'));
    }
  } catch (err) { res.status(500).json({ error: 'Error interno' }); }
  finally { if (conn) conn.release(); }
});

// ============ PAYMENT WEBHOOK ============

app.post('/api/payment-webhook', async (req, res) => {
  console.log('Payment webhook:', JSON.stringify(req.body));
  const { spawn } = require('child_process');
  var payload = JSON.stringify(req.body);
  var proc = spawn('python3', ['-c', 'import boto3,json; c=boto3.client("lambda",region_name="us-east-1"); c.invoke(FunctionName="trackmonk_postback",InvocationType="Event",Payload=json.dumps(' + JSON.stringify(req.body) + '))']);
  proc.on('close', function() {});
  res.json({ success: true });
});

// Generar link de pago (admin)
app.post('/api/payments/create', auth, async (req, res) => {
  const { company_id, plan } = req.body;
  if (!company_id || !plan) return res.status(400).json({ error: 'company_id y plan requeridos' });
  const { spawn } = require('child_process');
  
  var payload = JSON.stringify({ company_id: company_id, plan: plan, email: '' });
  var script = 'import boto3,json; c=boto3.client("lambda",region_name="us-east-1"); r=c.invoke(FunctionName="trackmonk_pago",Payload=json.dumps(' + payload + ')); print(r["Payload"].read().decode())';
  
  var proc = spawn('python3', ['-c', script]);
  var output = '';
  proc.stdout.on('data', function(d) { output += d.toString(); });
  proc.on('close', function() {
    try {
      var result = JSON.parse(output);
      var body = JSON.parse(result.body || '{}');
      res.json(body);
    } catch(e) { res.status(500).json({ error: 'Error procesando pago', detail: output }); }
  });
});

// ============ DRIVER CHAT (entre conductores) ============

// Listar compañeros de la misma empresa
app.get('/api/driver-chat/contacts/:deviceId', async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const device = await conn.query('SELECT company_id FROM devices WHERE id=?', [req.params.deviceId]);
    if (!device.length) return res.status(404).json({ error: 'Dispositivo no encontrado' });
    const companyId = device[0].company_id;
    // Todos los dispositivos de la misma empresa excepto el actual
    const contacts = await conn.query(
      'SELECT id, device_name, person_name, phone, vehicle FROM devices WHERE company_id=? AND id!=? ORDER BY person_name',
      [companyId, req.params.deviceId]
    );
    res.json(contacts);
  } catch (err) { res.status(500).json({ error: 'Error interno' }); }
  finally { if (conn) conn.release(); }
});

// Obtener conversación entre dos conductores
app.get('/api/driver-chat/:deviceId/:otherDeviceId', async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const messages = await conn.query(
      'SELECT * FROM driver_messages WHERE (from_device_id=? AND to_device_id=?) OR (from_device_id=? AND to_device_id=?) ORDER BY created_at DESC LIMIT 50',
      [req.params.deviceId, req.params.otherDeviceId, req.params.otherDeviceId, req.params.deviceId]
    );
    // Marcar como leídos los que me enviaron
    await conn.query(
      'UPDATE driver_messages SET is_read=1 WHERE from_device_id=? AND to_device_id=? AND is_read=0',
      [req.params.otherDeviceId, req.params.deviceId]
    );
    res.json(messages.reverse());
  } catch (err) { res.status(500).json({ error: 'Error interno' }); }
  finally { if (conn) conn.release(); }
});

// Enviar mensaje a otro conductor
app.post('/api/driver-chat/:deviceId/:otherDeviceId', async (req, res) => {
  const { body } = req.body;
  if (!body) return res.status(400).json({ error: 'body requerido' });
  let conn;
  try {
    conn = await pool.getConnection();
    // Verificar que son de la misma empresa
    const devices = await conn.query('SELECT id, company_id, person_name, device_name FROM devices WHERE id IN (?,?)', [req.params.deviceId, req.params.otherDeviceId]);
    if (devices.length < 2) return res.status(404).json({ error: 'Dispositivo no encontrado' });
    if (devices[0].company_id !== devices[1].company_id) return res.status(403).json({ error: 'No son de la misma empresa' });

    await conn.query('INSERT INTO driver_messages (from_device_id, to_device_id, body) VALUES (?, ?, ?)',
      [req.params.deviceId, req.params.otherDeviceId, body]);

    // Enviar push al destinatario si tiene push activo
    const target = await conn.query('SELECT * FROM devices WHERE id=?', [req.params.otherDeviceId]);
    if (target.length && target[0].endpoint && target[0].endpoint.length > 0) {
      const sender = devices.find(d => d.id == req.params.deviceId);
      const senderName = sender ? (sender.person_name || sender.device_name) : 'Compañero';
      try {
        await webPush.sendNotification(
          { endpoint: target[0].endpoint, keys: { p256dh: target[0].p256dh, auth: target[0].auth } },
          JSON.stringify({ type: 'custom-message', title: '💬 ' + senderName, body: body })
        );
      } catch (e) { /* push falló, no importa */ }
    }

    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Error interno' }); }
  finally { if (conn) conn.release(); }
});

// Mensajes no leídos del chat entre conductores
app.get('/api/driver-chat/:deviceId/unread', async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const rows = await conn.query(
      'SELECT from_device_id, COUNT(*) as count FROM driver_messages WHERE to_device_id=? AND is_read=0 GROUP BY from_device_id',
      [req.params.deviceId]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Error interno' }); }
  finally { if (conn) conn.release(); }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('TrackMonk API v2 corriendo en puerto ' + PORT);
});
