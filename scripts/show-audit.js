// Menampilkan N baris terakhir audit log: node scripts/show-audit.js [N]
const db = require('../shared/db');
const n = Number(process.argv[2] || 20);
console.table(db.prepare('SELECT ts, subject, endpoint, device, result, reason FROM audit_log ORDER BY id DESC LIMIT ?').all(n).reverse());
