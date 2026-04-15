const express = require('express');
const cors = require('cors');
const webPush = require('web-push');
const pool = require('./db');

const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3001;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'TrackMonk2026';

const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || 'BOo4F6f4rAON57Om4re4hwCvpObP8OKAgpMsPnpJQJHy2siXrnrUB7oAw5h3MnAZLmztiIdPbs9BbP07V5ymCIk';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || 'akPJeydoIlbCtMKbRyEhTOmb6MjJZP8NrFSYIgf1kXg';
const VAPID_EMAIL = process.env.VAPID_EMAIL || 'mailto:soporte@locationtracker.net';

webPush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE);

// Tokens activos de admin (en memoria)
const adminTokens = new Set();

app.use(cors());
app.use(express.json());

// ============ AUTH ============

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    const token = crypto.randomBytes(32).toString('hex');
    adminTokens.add(token);
    res.json({ success: true, token });
  } else {
    res.status(401).json({ error: 'Contraseña incorrecta' });
  }
});

function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (token && adminTokens.has(token)) {
    return next();
  }
  res.status(401).json({ error: 'No autorizado' });
}

// ============ VAPID ============

app.get('/api/vapid-public-key', (req, res) => {
  res.json({ publicKey: VAPID_PUBLIC });
});

// ============ DISPOSITIVOS ============

// Registrar dispositivo
app.post('/api/devices/register', async (req, res) => {
  const { deviceName, subscription } = req.body;
  if (!deviceName) {
    return res.status(400).json({ error: 'deviceName es requerido' });
  }

  let conn;
  try {
    conn = await pool.getConnection();

    // Si tiene suscripción push, buscar por endpoint
    if (subscription && subscription.endpoint) {
      const existing = await conn.query('SELECT id FROM devices WHERE endpoint = ?', [subscription.endpoint]);

      let deviceId;
      if (existing.length > 0) {
        deviceId = existing[0].id;
        await conn.query('UPDATE devices SET device_name = ?, p256dh = ?, auth = ? WHERE id = ?',
          [deviceName, subscription.keys.p256dh, subscription.keys.auth, deviceId]);
      } else {
        const result = await conn.query(
          'INSERT INTO devices (device_name, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)',
          [deviceName, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth]);
        deviceId = Number(result.insertId);
      }
      return res.json({ success: true, deviceId });
    }

    // Sin push: registrar solo con nombre
    const result = await conn.query(
      "INSERT INTO devices (device_name, endpoint, p256dh, auth) VALUES (?, '', '', '')",
      [deviceName]);
    res.json({ success: true, deviceId: Number(result.insertId) });
  } catch (err) {
    console.error('Error registrando dispositivo:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  } finally {
    if (conn) conn.release();
  }
});

// Actualizar perfil del dispositivo
app.put('/api/devices/:deviceId', async (req, res) => {
  const { deviceId } = req.params;
  const { device_name, company, phone, person_name, vehicle } = req.body;

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.query(
      `UPDATE devices SET device_name = ?, company = ?, phone = ?, person_name = ?, vehicle = ? WHERE id = ?`,
      [device_name || '', company || '', phone || '', person_name || '', vehicle || '', deviceId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Error actualizando dispositivo:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  } finally {
    if (conn) conn.release();
  }
});

// Listar dispositivos (con campos nuevos)
app.get('/api/devices', requireAdmin, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const devices = await conn.query(
      'SELECT id, device_name, company, phone, person_name, vehicle, created_at, updated_at FROM devices ORDER BY updated_at DESC'
    );
    res.json(devices);
  } catch (err) {
    console.error('Error listando dispositivos:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  } finally {
    if (conn) conn.release();
  }
});

// Buscar dispositivos por nombre, teléfono o empresa
app.get('/api/devices/search', requireAdmin, async (req, res) => {
  const { q } = req.query;
  if (!q) return res.json([]);

  let conn;
  try {
    conn = await pool.getConnection();
    const term = `%${q}%`;
    const devices = await conn.query(
      `SELECT id, device_name, company, phone, person_name, vehicle, created_at
       FROM devices
       WHERE device_name LIKE ? OR phone LIKE ? OR person_name LIKE ? OR company LIKE ? OR vehicle LIKE ?
       ORDER BY person_name ASC LIMIT 50`,
      [term, term, term, term, term]
    );
    res.json(devices);
  } catch (err) {
    console.error('Error buscando dispositivos:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  } finally {
    if (conn) conn.release();
  }
});

// Obtener un dispositivo por ID
app.get('/api/devices/:deviceId', async (req, res) => {
  const { deviceId } = req.params;
  let conn;
  try {
    conn = await pool.getConnection();
    const rows = await conn.query(
      'SELECT id, device_name, company, phone, person_name, vehicle, created_at FROM devices WHERE id = ?',
      [deviceId]);
    res.json(rows[0] || null);
  } catch (err) {
    console.error('Error obteniendo dispositivo:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  } finally {
    if (conn) conn.release();
  }
});

// ============ TRACKING ============

app.post('/api/track/:deviceId', requireAdmin, async (req, res) => {
  const { deviceId } = req.params;
  let conn;
  try {
    conn = await pool.getConnection();
    const devices = await conn.query('SELECT * FROM devices WHERE id = ?', [deviceId]);
    if (devices.length === 0) return res.status(404).json({ error: 'Dispositivo no encontrado' });

    const device = devices[0];
    const result = await conn.query('INSERT INTO tracking_requests (device_id, status) VALUES (?, ?)', [deviceId, 'sent']);
    const requestId = Number(result.insertId);

    const pushSubscription = { endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } };
    const payload = JSON.stringify({
      type: 'track-location', requestId,
      title: 'Solicitud de ubicación', body: 'Se ha solicitado tu ubicación',
    });

    await webPush.sendNotification(pushSubscription, payload);
    res.json({ success: true, requestId });
  } catch (err) {
    console.error('Error enviando push:', err);
    res.status(500).json({ error: 'Error enviando notificación push' });
  } finally {
    if (conn) conn.release();
  }
});

app.get('/api/track-status/:requestId', requireAdmin, async (req, res) => {
  const { requestId } = req.params;
  let conn;
  try {
    conn = await pool.getConnection();
    const rows = await conn.query(
      `SELECT tr.*, l.latitude, l.longitude, l.accuracy, l.recorded_at as location_timestamp
       FROM tracking_requests tr
       LEFT JOIN locations l ON l.device_id = tr.device_id AND l.recorded_at >= tr.created_at
       WHERE tr.id = ? ORDER BY l.recorded_at DESC LIMIT 1`, [requestId]);
    res.json(rows[0] || null);
  } catch (err) {
    console.error('Error obteniendo estado:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  } finally {
    if (conn) conn.release();
  }
});

// ============ UBICACIONES ============

app.post('/api/location', async (req, res) => {
  const { deviceId, requestId, latitude, longitude, accuracy } = req.body;
  if (!deviceId || latitude == null || longitude == null) {
    return res.status(400).json({ error: 'deviceId, latitude y longitude son requeridos' });
  }

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.query('INSERT INTO locations (device_id, latitude, longitude, accuracy) VALUES (?, ?, ?, ?)',
      [deviceId, latitude, longitude, accuracy || null]);

    if (requestId) {
      await conn.query('UPDATE tracking_requests SET status = ?, responded_at = NOW() WHERE id = ?', ['received', requestId]);
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Error guardando ubicación:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  } finally {
    if (conn) conn.release();
  }
});

app.get('/api/locations/:deviceId', requireAdmin, async (req, res) => {
  const { deviceId } = req.params;
  const limit = parseInt(req.query.limit) || 50;
  let conn;
  try {
    conn = await pool.getConnection();
    const locations = await conn.query(
      'SELECT * FROM locations WHERE device_id = ? ORDER BY recorded_at DESC LIMIT ?', [deviceId, limit]);
    res.json(locations);
  } catch (err) {
    console.error('Error obteniendo ubicaciones:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  } finally {
    if (conn) conn.release();
  }
});

app.get('/api/locations/:deviceId/latest', requireAdmin, async (req, res) => {
  const { deviceId } = req.params;
  let conn;
  try {
    conn = await pool.getConnection();
    const locations = await conn.query(
      'SELECT * FROM locations WHERE device_id = ? ORDER BY recorded_at DESC LIMIT 1', [deviceId]);
    res.json(locations[0] || null);
  } catch (err) {
    console.error('Error obteniendo última ubicación:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  } finally {
    if (conn) conn.release();
  }
});

// Última ubicación de TODOS los dispositivos (para mapa general)
app.get('/api/locations-all/latest', requireAdmin, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const rows = await conn.query(
      `SELECT d.id, d.device_name, d.company, d.phone, d.person_name, d.vehicle,
              l.latitude, l.longitude, l.accuracy, l.recorded_at
       FROM devices d
       INNER JOIN locations l ON l.id = (
         SELECT l2.id FROM locations l2 WHERE l2.device_id = d.id ORDER BY l2.recorded_at DESC LIMIT 1
       )`
    );
    res.json(rows);
  } catch (err) {
    console.error('Error obteniendo todas las ubicaciones:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  } finally {
    if (conn) conn.release();
  }
});

// Trackear TODOS los dispositivos (campaña masiva)
app.post('/api/track-all', requireAdmin, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const devices = await conn.query("SELECT * FROM devices WHERE endpoint != ''");

    let sent = 0, failed = 0;

    for (const device of devices) {
      try {
        const result = await conn.query('INSERT INTO tracking_requests (device_id, status) VALUES (?, ?)', [device.id, 'sent']);
        const requestId = Number(result.insertId);

        const pushSubscription = { endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } };
        const payload = JSON.stringify({
          type: 'track-location', requestId,
          title: 'Solicitud de ubicación', body: 'Se ha solicitado tu ubicación',
        });

        await webPush.sendNotification(pushSubscription, payload);
        sent++;
      } catch (err) {
        console.error(`Error push device ${device.id}:`, err.statusCode || err.message);
        failed++;
      }
    }

    res.json({ success: true, sent, failed, total: devices.length });
  } catch (err) {
    console.error('Error en track-all:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  } finally {
    if (conn) conn.release();
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Location Tracker API corriendo en puerto ${PORT}`);
});
