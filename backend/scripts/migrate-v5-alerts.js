const mariadb = require('mariadb');

const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_PORT = parseInt(process.env.DB_PORT) || 3306;
const DB_USER = process.env.DB_USER || 'operador';
const DB_PASS = process.env.DB_PASSWORD || 'operador01';
const DB_NAME = process.env.DB_NAME || 'location_tracker';

async function migrate() {
  const conn = await mariadb.createConnection({
    host: DB_HOST, port: DB_PORT, user: DB_USER, password: DB_PASS, database: DB_NAME,
  });

  console.log('Creando tabla "alerts"...');
  await conn.query(`
    CREATE TABLE IF NOT EXISTS alerts (
      id INT AUTO_INCREMENT PRIMARY KEY,
      device_id INT NOT NULL,
      alert_type ENUM('accident', 'robbery', 'breakdown', 'help', 'other') NOT NULL,
      message TEXT,
      latitude DOUBLE,
      longitude DOUBLE,
      accuracy DOUBLE,
      status ENUM('active', 'attending', 'resolved') DEFAULT 'active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      resolved_at DATETIME NULL,
      resolved_by VARCHAR(255),
      FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
    )
  `);

  await conn.end();
  console.log('Migración v5 (alertas) completada.');
}

migrate().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
