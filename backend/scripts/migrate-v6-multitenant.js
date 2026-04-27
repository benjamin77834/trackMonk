const mariadb = require('mariadb');

const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_PORT = parseInt(process.env.DB_PORT) || 3306;
const DB_USER = process.env.DB_USER || 'operador';
const DB_PASS = process.env.DB_PASSWORD || 'operador01';
const DB_NAME = 'trackmonk_v2';

async function migrate() {
  const conn = await mariadb.createConnection({
    host: DB_HOST, port: DB_PORT, user: DB_USER, password: DB_PASS,
  });

  console.log(`Creando base de datos "${DB_NAME}"...`);
  await conn.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8 COLLATE utf8_general_ci`);
  await conn.query(`USE \`${DB_NAME}\``);

  // Empresas
  console.log('Creando tabla "companies"...');
  await conn.query(`
    CREATE TABLE IF NOT EXISTS companies (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      slug VARCHAR(100) NOT NULL UNIQUE,
      logo_url VARCHAR(500) DEFAULT '',
      contact_email VARCHAR(255) DEFAULT '',
      contact_phone VARCHAR(50) DEFAULT '',
      is_active TINYINT DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Usuarios admin (super_admin y company_admin)
  console.log('Creando tabla "users"...');
  await conn.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      company_id INT NULL,
      username VARCHAR(100) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      name VARCHAR(255) NOT NULL,
      role ENUM('super_admin', 'company_admin') NOT NULL,
      is_active TINYINT DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL
    )
  `);

  // Dispositivos (ahora con company_id)
  console.log('Creando tabla "devices"...');
  await conn.query(`
    CREATE TABLE IF NOT EXISTS devices (
      id INT AUTO_INCREMENT PRIMARY KEY,
      company_id INT NOT NULL,
      device_name VARCHAR(255) NOT NULL,
      person_name VARCHAR(255) DEFAULT '',
      phone VARCHAR(50) DEFAULT '',
      vehicle VARCHAR(255) DEFAULT '',
      endpoint TEXT,
      p256dh TEXT,
      auth VARCHAR(255) DEFAULT '',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NULL,
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
    )
  `);

  // Ubicaciones
  console.log('Creando tabla "locations"...');
  await conn.query(`
    CREATE TABLE IF NOT EXISTS locations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      device_id INT NOT NULL,
      latitude DOUBLE NOT NULL,
      longitude DOUBLE NOT NULL,
      accuracy DOUBLE,
      recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
    )
  `);

  // Tracking requests
  console.log('Creando tabla "tracking_requests"...');
  await conn.query(`
    CREATE TABLE IF NOT EXISTS tracking_requests (
      id INT AUTO_INCREMENT PRIMARY KEY,
      device_id INT NOT NULL,
      status ENUM('pending', 'sent', 'received', 'failed') DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      responded_at DATETIME NULL,
      FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
    )
  `);

  // Viajes
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

  // Costos de viaje
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

  // Ubicaciones de viaje
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

  // Mensajes
  console.log('Creando tabla "messages"...');
  await conn.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id INT AUTO_INCREMENT PRIMARY KEY,
      device_id INT NOT NULL,
      title VARCHAR(255) NOT NULL,
      body TEXT NOT NULL,
      is_read TINYINT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
    )
  `);

  // Alertas
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

  // Crear super admin por defecto
  console.log('Creando super admin...');
  const crypto = require('crypto');
  const hash = crypto.createHash('sha256').update('Altima2020$').digest('hex');
  await conn.query(
    "INSERT IGNORE INTO users (username, password_hash, name, role) VALUES ('admin', ?, 'Super Admin', 'super_admin')",
    [hash]
  );

  // Crear empresa demo
  console.log('Creando empresa demo...');
  await conn.query(
    "INSERT IGNORE INTO companies (name, slug, contact_email) VALUES ('MonkeyPhone', 'monkeyphone', 'soporte@monkeyfon.com')"
  );

  await conn.end();
  console.log('');
  console.log('Base de datos "trackmonk_v2" creada con todas las tablas.');
  console.log('Super admin: admin / Altima2020$');
  console.log('Empresa demo: MonkeyPhone (slug: monkeyphone)');
}

migrate().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
