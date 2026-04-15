const express = require('express');
const cors = require('cors');
const webPush = require('web-push');
const pool = require('./db');

const app = express();
const PORT = process.env.PORT || 3001;

// VAPID keys propias del location tracker (independientes de monkeyapp)
const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || 'BOo4F6f4rAON57Om4re4hwCvpObP8OKAgpMsPnpJQJHy2siXrnrUB7oAw5h3MnAZLmztiIdPbs9BbP07V5ymCIk';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || 'akPJeydoIlbCtMKbRyEhTOmb6MjJZP8NrFSYIgf1kXg';
const VAPID_EMAIL = process.env.VAPID_EMAIL || 'mailto:soporte@locationtracker.net';

webPush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE);

app.use(cors());
app.use(express.json());

// ============ API ROUTES ============

// Clave pública VAPID para el frontend
app.get('/api/vapid-public-key', (req, res) => {
  res.json({ publicKey: VAPID_PUBLIC });
});

// Registrar dispositivo
app.post('/api/devices/register', async (req, res) => {
  const { deviceName, subscription } = req.body;

  if (!deviceName || !subscription) {
    return res.status(400).json({ error: 'deviceName y subscription son requeridos' });
  }

  let conn;
  try {
    conn = await pool.getConnection();

    const existing = await conn.query(
      'SELECT id FROM devices WHERE endpoint = ?',
      [subscription.endpoint]
    );

    let deviceId;
    if (existing.length > 0) {
      deviceId = existing[0].id;
      await conn.query(
        'UPDATE devices SET device_name = ?, p256dh = ?, auth = ? WHERE id = ?',
        [deviceName, subscription.keys.p256dh, subscription.keys.auth, deviceId]
      );
    } else {
      const result = await conn.query(
        'INSERT INTO devices (device_name, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)',
        [deviceName, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth]
      );
      deviceId = Number(result.insertId);
    }

    res.json({ success: true, deviceId });
  } catch (err) {
    console.error('Error registrando dispositivo:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  } finally {
    if (conn) conn.release();
  }
});

// Listar dispositivos
app.get('/api/devices', async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const devices = await conn.query(
      'SELECT id, device_name, created_at, updated_at FROM devices ORDER BY updated_at DESC'
    );
    res.json(devices);
  } catch (err) {
    console.error('Error listando dispositivos:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  } finally {
    if (conn) conn.release();
  }
});

// Enviar push para pedir ubicación
app.post('/api/track/:deviceId', async (req, res) => {
  const { deviceId } = req.params;

  let conn;
  try {
    conn = await pool.getConnection();

    const devices = await conn.query('SELECT * FROM devices WHERE id = ?', [deviceId]);
    if (devices.length === 0) {
      return res.status(404).json({ error: 'Dispositivo no encontrado' });
    }

    const device = devices[0];

    const result = await conn.query(
      'INSERT INTO tracking_requests (device_id, status) VALUES (?, ?)',
      [deviceId, 'sent']
    );
    const requestId = Number(result.insertId);

    const pushSubscription = {
      endpoint: device.endpoint,
      keys: { p256dh: device.p256dh, auth: device.auth },
    };

    const payload = JSON.stringify({
      type: 'track-location',
      requestId,
      title: 'Solicitud de ubicación',
      body: 'Se ha solicitado tu ubicación',
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

// Recibir ubicación del dispositivo
app.post('/api/location', async (req, res) => {
  const { deviceId, requestId, latitude, longitude, accuracy } = req.body;

  if (!deviceId || latitude == null || longitude == null) {
    return res.status(400).json({ error: 'deviceId, latitude y longitude son requeridos' });
  }

  let conn;
  try {
    conn = await pool.getConnection();

    await conn.query(
      'INSERT INTO locations (device_id, latitude, longitude, accuracy) VALUES (?, ?, ?, ?)',
      [deviceId, latitude, longitude, accuracy || null]
    );

    if (requestId) {
      await conn.query(
        'UPDATE tracking_requests SET status = ?, responded_at = NOW() WHERE id = ?',
        ['received', requestId]
      );
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Error guardando ubicación:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  } finally {
    if (conn) conn.release();
  }
});

// Historial de ubicaciones
app.get('/api/locations/:deviceId', async (req, res) => {
  const { deviceId } = req.params;
  const limit = parseInt(req.query.limit) || 50;

  let conn;
  try {
    conn = await pool.getConnection();
    const locations = await conn.query(
      'SELECT * FROM locations WHERE device_id = ? ORDER BY recorded_at DESC LIMIT ?',
      [deviceId, limit]
    );
    res.json(locations);
  } catch (err) {
    console.error('Error obteniendo ubicaciones:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  } finally {
    if (conn) conn.release();
  }
});

// Última ubicación
app.get('/api/locations/:deviceId/latest', async (req, res) => {
  const { deviceId } = req.params;

  let conn;
  try {
    conn = await pool.getConnection();
    const locations = await conn.query(
      'SELECT * FROM locations WHERE device_id = ? ORDER BY recorded_at DESC LIMIT 1',
      [deviceId]
    );
    res.json(locations[0] || null);
  } catch (err) {
    console.error('Error obteniendo última ubicación:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  } finally {
    if (conn) conn.release();
  }
});

// Estado de tracking request
app.get('/api/track-status/:requestId', async (req, res) => {
  const { requestId } = req.params;

  let conn;
  try {
    conn = await pool.getConnection();
    const rows = await conn.query(
      `SELECT tr.*, l.latitude, l.longitude, l.accuracy, l.recorded_at as location_timestamp
       FROM tracking_requests tr
       LEFT JOIN locations l ON l.device_id = tr.device_id AND l.recorded_at >= tr.created_at
       WHERE tr.id = ?
       ORDER BY l.recorded_at DESC LIMIT 1`,
      [requestId]
    );
    res.json(rows[0] || null);
  } catch (err) {
    console.error('Error obteniendo estado:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  } finally {
    if (conn) conn.release();
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Location Tracker API corriendo en puerto ${PORT}`);
});
