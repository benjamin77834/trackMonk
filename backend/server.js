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
  const { name, contact_email, contact_phone, is_active } = req.body;
  let conn;
  try {
    conn = await pool.getConnection();
    const fields = []; const vals = [];
    if (name) { fields.push('name=?'); vals.push(name); }
    if (contact_email !== undefined) { fields.push('contact_email=?'); vals.push(contact_email); }
    if (contact_phone !== undefined) { fields.push('contact_phone=?'); vals.push(contact_phone); }
    if (is_active !== undefined) { fields.push('is_active=?'); vals.push(is_active); }
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

// ============ DEVICES ============

app.post('/api/devices/register', async (req, res) => {
  const { deviceName, subscription, companySlug } = req.body;
  if (!deviceName) return res.status(400).json({ error: 'deviceName requerido' });
  let conn;
  try {
    conn = await pool.getConnection();
    // Buscar empresa por slug
    let companyId = 1; // default
    if (companySlug) {
      const companies = await conn.query('SELECT id FROM companies WHERE slug = ?', [companySlug]);
      if (companies.length > 0) companyId = companies[0].id;
    }
    if (subscription && subscription.endpoint) {
      const existing = await conn.query('SELECT id FROM devices WHERE endpoint = ?', [subscription.endpoint]);
      if (existing.length > 0) {
        const deviceId = existing[0].id;
        await conn.query('UPDATE devices SET device_name=?, p256dh=?, auth=? WHERE id=?',
          [deviceName, subscription.keys.p256dh, subscription.keys.auth, deviceId]);
        return res.json({ success: true, deviceId });
      }
      const result = await conn.query('INSERT INTO devices (company_id, device_name, endpoint, p256dh, auth) VALUES (?, ?, ?, ?, ?)',
        [companyId, deviceName, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth]);
      return res.json({ success: true, deviceId: Number(result.insertId) });
    }
    const result = await conn.query("INSERT INTO devices (company_id, device_name, endpoint, p256dh, auth) VALUES (?, ?, '', '', '')", [companyId, deviceName]);
    res.json({ success: true, deviceId: Number(result.insertId) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error interno' }); }
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
  const { deviceId, requestId, latitude, longitude, accuracy } = req.body;
  if (!deviceId || latitude == null || longitude == null) return res.status(400).json({ error: 'Faltan datos' });
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.query('INSERT INTO locations (device_id, latitude, longitude, accuracy) VALUES (?, ?, ?, ?)', [deviceId, latitude, longitude, accuracy || null]);
    if (requestId) await conn.query("UPDATE tracking_requests SET status='received', responded_at=NOW() WHERE id=?", [requestId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Error interno' }); }
  finally { if (conn) conn.release(); }
});

app.get('/api/locations/:deviceId', auth, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    res.json(await conn.query('SELECT * FROM locations WHERE device_id=? ORDER BY recorded_at DESC LIMIT ?', [req.params.deviceId, parseInt(req.query.limit) || 50]));
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

app.put('/api/my-messages/:id/read', async (req, res) => {
  let conn;
  try { conn = await pool.getConnection(); await conn.query('UPDATE messages SET is_read=1 WHERE id=?', [req.params.id]); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: 'Error interno' }); }
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
    res.json({ success: true, alertId: Number(result.insertId) });
  } catch (err) { res.status(500).json({ error: 'Error interno' }); }
  finally { if (conn) conn.release(); }
});

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
  try { conn = await pool.getConnection(); res.json(await conn.query("SELECT t.*, (SELECT SUM(amount) FROM trip_costs WHERE trip_id=t.id) as total_cost FROM trips t WHERE t.device_id=? AND t.status='active' ORDER BY t.started_at DESC", [req.params.deviceId])); }
  catch (err) { res.status(500).json({ error: 'Error interno' }); }
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

app.listen(PORT, '0.0.0.0', () => {
  console.log('TrackMonk API v2 corriendo en puerto ' + PORT);
});
