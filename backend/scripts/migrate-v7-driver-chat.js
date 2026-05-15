const pool = require('../db');

async function migrate() {
  let conn;
  try {
    conn = await pool.getConnection();
    
    // Tabla de mensajes entre conductores
    await conn.query(`
      CREATE TABLE IF NOT EXISTS driver_messages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        from_device_id INT NOT NULL,
        to_device_id INT NOT NULL,
        body TEXT NOT NULL,
        is_read TINYINT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_from (from_device_id),
        INDEX idx_to (to_device_id),
        INDEX idx_created (created_at)
      )
    `);

    console.log('✅ Migración v7 completada: driver_messages');
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    if (conn) conn.release();
    process.exit();
  }
}

migrate();
