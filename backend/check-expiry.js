const mariadb = require('mariadb');
const { spawn } = require('child_process');

const pool = mariadb.createPool({
  host: 'localhost', port: 3306, user: 'operador', password: 'operador01', database: 'trackmonk_v2', connectionLimit: 2,
});

async function checkExpiry() {
  let conn;
  try {
    conn = await pool.getConnection();

    // Empresas que vencen en 3 días
    const expiringSoon = await conn.query(
      "SELECT id, name, contact_phone, plan, expires_at FROM companies WHERE expires_at IS NOT NULL AND expires_at BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 3 DAY) AND is_active=1 AND plan != 'demo'"
    );

    for (const c of expiringSoon) {
      if (c.contact_phone) {
        const msg = 'TrackMonk: Tu plan ' + c.plan + ' vence el ' + new Date(c.expires_at).toLocaleDateString('es-MX') + '. Renueva para no perder el servicio. tracker.monkeyfon.com/planes.html';
        sendSMS(c.contact_phone, msg);
        console.log('Aviso enviado a ' + c.name + ' (' + c.contact_phone + ') - vence ' + c.expires_at);
      }
    }

    // Empresas que ya vencieron (ayer)
    const expired = await conn.query(
      "SELECT id, name, contact_phone, plan FROM companies WHERE expires_at IS NOT NULL AND expires_at < CURDATE() AND is_active=1 AND plan != 'demo'"
    );

    for (const c of expired) {
      if (c.contact_phone) {
        const msg = 'TrackMonk: Tu plan ha vencido. Renueva ahora para seguir usando el servicio. tracker.monkeyfon.com/planes.html';
        sendSMS(c.contact_phone, msg);
        console.log('Aviso vencimiento a ' + c.name + ' (' + c.contact_phone + ')');
      }
    }

    // Demos que vencen mañana
    const demosExpiring = await conn.query(
      "SELECT id, name, contact_phone FROM companies WHERE demo_until IS NOT NULL AND demo_until BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 1 DAY) AND plan='demo' AND is_active=1"
    );

    for (const c of demosExpiring) {
      if (c.contact_phone) {
        const msg = 'TrackMonk: Tu demo gratuito termina mañana. Contrata un plan para seguir trackeando: tracker.monkeyfon.com/planes.html';
        sendSMS(c.contact_phone, msg);
        console.log('Aviso demo a ' + c.name);
      }
    }

    console.log('Check completado: ' + expiringSoon.length + ' por vencer, ' + expired.length + ' vencidos, ' + demosExpiring.length + ' demos');
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    if (conn) conn.release();
    pool.end();
  }
}

function sendSMS(phone, message) {
  var formattedPhone = phone.replace(/[^0-9]/g, '');
  var script = 'import boto3,json; c=boto3.client("lambda",region_name="us-east-1"); c.invoke(FunctionName="envi_sms_python",InvocationType="Event",Payload=json.dumps({"msisdn":"' + formattedPhone + '","message":"' + message.replace(/"/g, '') + '"}))';
  var proc = spawn('python3', ['-c', script]);
  proc.on('close', function() {});
}

checkExpiry();
