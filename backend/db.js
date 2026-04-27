const mariadb = require('mariadb');

const pool = mariadb.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'operador',
  password: process.env.DB_PASSWORD || 'operador01',
  database: process.env.DB_NAME || 'trackmonk_v2',
  connectionLimit: 10,
});

module.exports = pool;
