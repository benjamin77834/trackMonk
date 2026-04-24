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

  await conn.end();
  console.log('Migración v4 (mensajes) completada.');
}

migrate().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
