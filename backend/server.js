const express = require('express');
const cors = require('cors');
const webPush = require('web-push');
const pool = require('./db');

const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3001;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Altima2020$';

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

// Actualizar push subscription de un dispositivo existente
app.put('/api/devices/:deviceId/push', async (req, res) => {
  const { deviceId } = req.params;
  const { subscription } = req.body;

  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: 'subscription es requerida' });
  }

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.query(
      'UPDATE devices SET endpoint = ?, p256dh = ?, auth = ? WHERE id = ?',
      [subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, deviceId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Error actualizando push:', err);
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

    if (!device.endpoint || device.endpoint.length === 0) {
      return res.status(400).json({ error: 'Este dispositivo no tiene push notifications activadas' });
    }

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

// Historial de ubicaciones de MI dispositivo (público, solo el propio)
app.get('/api/my-locations/:deviceId', async (req, res) => {
  const { deviceId } = req.params;
  const limit = parseInt(req.query.limit) || 50;
  let conn;
  try {
    conn = await pool.getConnection();
    const locations = await conn.query(
      'SELECT recorded_at, latitude, longitude, accuracy FROM locations WHERE device_id = ? ORDER BY recorded_at DESC LIMIT ?', [deviceId, limit]);
    res.json(locations);
  } catch (err) {
    console.error('Error obteniendo ubicaciones:', err);
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

// Enviar mensaje push personalizado a un dispositivo
app.post('/api/push-message/:deviceId', requireAdmin, async (req, res) => {
  const { deviceId } = req.params;
  const { title, body } = req.body;

  if (!body) return res.status(400).json({ error: 'body es requerido' });

  let conn;
  try {
    conn = await pool.getConnection();
    const devices = await conn.query('SELECT * FROM devices WHERE id = ?', [deviceId]);
    if (devices.length === 0) return res.status(404).json({ error: 'Dispositivo no encontrado' });

    const device = devices[0];
    if (!device.endpoint || device.endpoint.length === 0) {
      return res.status(400).json({ error: 'Este dispositivo no tiene push activado' });
    }

    const pushSubscription = { endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } };
    const payload = JSON.stringify({
      type: 'custom-message',
      title: title || 'TrackMonk',
      body: body,
    });

    await webPush.sendNotification(pushSubscription, payload);
    res.json({ success: true });
  } catch (err) {
    console.error('Error enviando mensaje:', err);
    res.status(500).json({ error: 'Error enviando mensaje push' });
  } finally {
    if (conn) conn.release();
  }
});

// Trackear TODOS los dispositivos (campaña masiva)
app.post('/api/track-all', requireAdmin, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const devices = await conn.query("SELECT * FROM devices WHERE endpoint != '' AND endpoint IS NOT NULL AND LENGTH(endpoint) > 0");

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

// ============ VIAJES ============

// Crear viaje
app.post('/api/trips', requireAdmin, async (req, res) => {
  const { device_id, origin, destination, cargo, notes } = req.body;
  if (!device_id || !origin || !destination) {
    return res.status(400).json({ error: 'device_id, origin y destination son requeridos' });
  }
  let conn;
  try {
    conn = await pool.getConnection();
    const result = await conn.query(
      'INSERT INTO trips (device_id, origin, destination, cargo, notes) VALUES (?, ?, ?, ?, ?)',
      [device_id, origin, destination, cargo || '', notes || '']);
    res.json({ success: true, tripId: Number(result.insertId) });
  } catch (err) {
    console.error('Error creando viaje:', err);
    res.status(500).json({ error: 'Error interno' });
  } finally { if (conn) conn.release(); }
});

// Listar viajes (con filtro opcional por status y device)
app.get('/api/trips', requireAdmin, async (req, res) => {
  const { status, device_id } = req.query;
  let conn;
  try {
    conn = await pool.getConnection();
    let sql = `SELECT t.*, d.person_name, d.device_name, d.vehicle, d.phone,
               (SELECT SUM(amount) FROM trip_costs WHERE trip_id = t.id) as total_cost,
               (SELECT COUNT(*) FROM trip_locations WHERE trip_id = t.id) as location_count
               FROM trips t JOIN devices d ON d.id = t.device_id WHERE 1=1`;
    const params = [];
    if (status) { sql += ' AND t.status = ?'; params.push(status); }
    if (device_id) { sql += ' AND t.device_id = ?'; params.push(device_id); }
    sql += ' ORDER BY t.started_at DESC LIMIT 100';
    const trips = await conn.query(sql, params);
    res.json(trips);
  } catch (err) {
    console.error('Error listando viajes:', err);
    res.status(500).json({ error: 'Error interno' });
  } finally { if (conn) conn.release(); }
});

// Obtener un viaje con costos y ubicaciones
app.get('/api/trips/:tripId', requireAdmin, async (req, res) => {
  const { tripId } = req.params;
  let conn;
  try {
    conn = await pool.getConnection();
    const trips = await conn.query(
      `SELECT t.*, d.person_name, d.device_name, d.vehicle, d.phone
       FROM trips t JOIN devices d ON d.id = t.device_id WHERE t.id = ?`, [tripId]);
    if (trips.length === 0) return res.status(404).json({ error: 'Viaje no encontrado' });
    const trip = trips[0];
    trip.costs = await conn.query('SELECT * FROM trip_costs WHERE trip_id = ? ORDER BY created_at', [tripId]);
    trip.locations = await conn.query('SELECT * FROM trip_locations WHERE trip_id = ? ORDER BY recorded_at', [tripId]);
    trip.total_cost = trip.costs.reduce((sum, c) => sum + parseFloat(c.amount), 0);
    res.json(trip);
  } catch (err) {
    console.error('Error obteniendo viaje:', err);
    res.status(500).json({ error: 'Error interno' });
  } finally { if (conn) conn.release(); }
});

// Actualizar viaje (completar, cancelar, editar)
app.put('/api/trips/:tripId', requireAdmin, async (req, res) => {
  const { tripId } = req.params;
  const { status, origin, destination, cargo, notes } = req.body;
  let conn;
  try {
    conn = await pool.getConnection();
    if (status === 'completed') {
      await conn.query('UPDATE trips SET status = ?, completed_at = NOW() WHERE id = ?', [status, tripId]);
    } else if (status) {
      await conn.query('UPDATE trips SET status = ? WHERE id = ?', [status, tripId]);
    }
    if (origin || destination || cargo !== undefined || notes !== undefined) {
      const fields = []; const vals = [];
      if (origin) { fields.push('origin = ?'); vals.push(origin); }
      if (destination) { fields.push('destination = ?'); vals.push(destination); }
      if (cargo !== undefined) { fields.push('cargo = ?'); vals.push(cargo); }
      if (notes !== undefined) { fields.push('notes = ?'); vals.push(notes); }
      if (fields.length > 0) {
        vals.push(tripId);
        await conn.query(`UPDATE trips SET ${fields.join(', ')} WHERE id = ?`, vals);
      }
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Error actualizando viaje:', err);
    res.status(500).json({ error: 'Error interno' });
  } finally { if (conn) conn.release(); }
});

// Agregar costo a un viaje
app.post('/api/trips/:tripId/costs', requireAdmin, async (req, res) => {
  const { tripId } = req.params;
  const { concept, amount } = req.body;
  if (!concept || amount == null) return res.status(400).json({ error: 'concept y amount requeridos' });
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.query('INSERT INTO trip_costs (trip_id, concept, amount) VALUES (?, ?, ?)', [tripId, concept, amount]);
    res.json({ success: true });
  } catch (err) {
    console.error('Error agregando costo:', err);
    res.status(500).json({ error: 'Error interno' });
  } finally { if (conn) conn.release(); }
});

// Eliminar costo
app.delete('/api/trip-costs/:costId', requireAdmin, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.query('DELETE FROM trip_costs WHERE id = ?', [req.params.costId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  } finally { if (conn) conn.release(); }
});

// Agregar ubicación a un viaje (desde el dispositivo)
app.post('/api/trips/:tripId/location', async (req, res) => {
  const { tripId } = req.params;
  const { latitude, longitude, accuracy } = req.body;
  if (latitude == null || longitude == null) return res.status(400).json({ error: 'latitude y longitude requeridos' });
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.query('INSERT INTO trip_locations (trip_id, latitude, longitude, accuracy) VALUES (?, ?, ?, ?)',
      [tripId, latitude, longitude, accuracy || null]);
    res.json({ success: true });
  } catch (err) {
    console.error('Error guardando ubicación de viaje:', err);
    res.status(500).json({ error: 'Error interno' });
  } finally { if (conn) conn.release(); }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Location Tracker API corriendo en puerto ${PORT}`);
});
