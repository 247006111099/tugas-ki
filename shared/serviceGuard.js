// Middleware untuk Service Nilai & Service Transkrip.
// Lapis 1: X-Gateway-Secret (service tidak bisa diakses langsung).
// Lapis 2: verifikasi ulang tanda tangan + masa berlaku token (assume breach).
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { GATEWAY_SECRET, JWT_SECRET, JWT_ISSUER } = require('./config');

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a || '')).digest();
  const hb = crypto.createHash('sha256').update(String(b || '')).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function serviceGuard(req, res, next) {
  if (!safeEqual(req.get('x-gateway-secret'), GATEWAY_SECRET)) {
    return res.status(403).json({ error: 'Akses langsung ke service ditolak (gateway secret tidak valid)' });
  }
  const m = /^Bearer (.+)$/.exec(req.get('authorization') || '');
  if (!m) return res.status(401).json({ error: 'Token tidak ada' });
  try {
    const p = jwt.verify(m[1], JWT_SECRET, { algorithms: ['HS256'], issuer: JWT_ISSUER });
    if (!p.sub || !p.role) throw new Error('klaim tidak lengkap');
    req.auth = p; // { sub, role, typ, ... }
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Token tidak valid atau kedaluwarsa' });
  }
}

module.exports = { serviceGuard };
