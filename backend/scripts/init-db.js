const mariadb = require('mariadb');

const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_PORT = parseInt(process.env.DB_PORT) || 3306;
const DB_USER = process.env.DB_USER || 'operador';
const DB_PASS = process.env.DB_PASSWORD || 'operador01';
const DB_NAME = process.env.DB_NAME || 'location_tracker';

async function initDatabase() {
  const conn = await mariadb.createConnection({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASS,
  });

  console.log(`Creando base de datos "${DB_NAME}"...`);
  await conn.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await conn.query(`USE \`${DB_NAME}\``);

  console.log('Creando tabla "devices"...');
  await conn.query(`
    CREATE TABLE IF NOT EXISTS devices (
      id INT AUTO_INCREMENT PRIMARY KEY,
      device_name VARCHAR(255) NOT NULL,
      endpoint TEXT NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  console.log('Creando tabla "locations"...');
  await conn.query(`
    CREATE TABLE IF NOT EXISTS locations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      device_id INT NOT NULL,
      latitude DOUBLE NOT NULL,
      longitude DOUBLE NOT NULL,
      accuracy DOUBLE,
      timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
    )
  `);

  console.log('Creando tabla "tracking_requests"...');
  await conn.query(`
    CREATE TABLE IF NOT EXISTS tracking_requests (
      id INT AUTO_INCREMENT PRIMARY KEY,
      device_id INT NOT NULL,
      status ENUM('pending', 'sent', 'received', 'failed') DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      responded_at TIMESTAMP NULL,
      FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
    )
  `);

  await conn.end();
  console.log('');
  console.log('Base de datos "location_tracker" inicializada correctamente.');
  console.log('Tablas: devices, locations, tracking_requests');
}

initDatabase().catch((err) => {
  console.error('Error inicializando la base de datos:', err.message);
  process.exit(1);
});
