// Audit log: setiap keputusan akses dicatat ke tabel audit_log + stdout.
const db = require('../shared/db');

const insert = db.prepare(
  'INSERT INTO audit_log (ts, subject, endpoint, device, result, reason) VALUES (?,?,?,?,?,?)'
);

function audit({ subject, method, path, device, result, reason }) {
  const ts = new Date().toISOString();
  const endpoint = `${method} ${path}`;
  insert.run(ts, subject || 'anonymous', endpoint, device || null, result, reason);
  console.log(`[AUDIT] ${ts} subject=${subject || 'anonymous'} ${endpoint} device=${device || '-'} ${result.toUpperCase()} (${reason})`);
}

module.exports = { audit };
