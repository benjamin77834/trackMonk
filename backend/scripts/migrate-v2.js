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

  console.log('Migrando tabla devices - agregando campos de perfil...');

  const columns = await conn.query('SHOW COLUMNS FROM devices');
  const colNames = columns.map(c => c.Field);

  if (!colNames.includes('company')) {
    await conn.query("ALTER TABLE devices ADD COLUMN company VARCHAR(255) DEFAULT ''");
    console.log('  + company');
  }
  if (!colNames.includes('phone')) {
    await conn.query("ALTER TABLE devices ADD COLUMN phone VARCHAR(50) DEFAULT ''");
    console.log('  + phone');
  }
  if (!colNames.includes('person_name')) {
    await conn.query("ALTER TABLE devices ADD COLUMN person_name VARCHAR(255) DEFAULT ''");
    console.log('  + person_name');
  }
  if (!colNames.includes('vehicle')) {
    await conn.query("ALTER TABLE devices ADD COLUMN vehicle VARCHAR(255) DEFAULT ''");
    console.log('  + vehicle');
  }

  await conn.end();
  console.log('Migración completada.');
}

migrate().catch((err) => {
  console.error('Error en migración:', err.message);
  process.exit(1);
});
