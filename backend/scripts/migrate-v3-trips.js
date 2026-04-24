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

  console.log('Creando tabla "trips"...');
  await conn.query(`
    CREATE TABLE IF NOT EXISTS trips (
      id INT AUTO_INCREMENT PRIMARY KEY,
      device_id INT NOT NULL,
      origin VARCHAR(255) NOT NULL,
      destination VARCHAR(255) NOT NULL,
      cargo VARCHAR(500) DEFAULT '',
      status ENUM('active', 'completed', 'cancelled') DEFAULT 'active',
      notes TEXT,
      started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME NULL,
      FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
    )
  `);

  console.log('Creando tabla "trip_costs"...');
  await conn.query(`
    CREATE TABLE IF NOT EXISTS trip_costs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      trip_id INT NOT NULL,
      concept VARCHAR(255) NOT NULL,
      amount DECIMAL(10,2) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE
    )
  `);

  console.log('Creando tabla "trip_locations"...');
  await conn.query(`
    CREATE TABLE IF NOT EXISTS trip_locations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      trip_id INT NOT NULL,
      latitude DOUBLE NOT NULL,
      longitude DOUBLE NOT NULL,
      accuracy DOUBLE,
      recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE
    )
  `);

  await conn.end();
  console.log('Migración v3 (viajes) completada.');
}

migrate().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
