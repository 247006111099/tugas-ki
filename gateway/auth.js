// Bagian Policy Administrator (PA): login, refresh, logout, token service.
const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../shared/db');
const cfg = require('../shared/config');
const { audit } = require('./audit');
const { isRegisteredDevice } = require('./policy');

const router = express.Router();

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function signAccess(user) {
  return jwt.sign({ sub: String(user.id), role: user.role, typ: 'access' }, cfg.JWT_SECRET, {
    algorithm: 'HS256', expiresIn: cfg.ACCESS_TOKEN_TTL, issuer: cfg.JWT_ISSUER,
  });
}

function signService(clientId) {
  return jwt.sign({ sub: clientId, role: 'service', typ: 'service' }, cfg.JWT_SECRET, {
    algorithm: 'HS256', expiresIn: cfg.SERVICE_TOKEN_TTL, issuer: cfg.JWT_ISSUER,
  });
}

function reply(req, res, { status, subject, result, reason, body }) {
  audit({
    subject, method: req.method, path: `/auth${req.path}`,
    device: req.get('x-device-id'), result, reason,
  });
  res.status(status).json(body || { error: reason });
}

// Pesan error login sengaja generik agar tidak membocorkan keberadaan akun.
router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  const device = req.get('x-device-id');
  if (typeof username !== 'string' || typeof password !== 'string') {
    return reply(req, res, { status: 400, subject: 'anonymous', result: 'deny', reason: 'username/password tidak lengkap' });
  }
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  const okPass = user ? bcrypt.compareSync(password, user.password_hash)
    : bcrypt.compareSync(password, '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvali'); // jaga waktu respons
  if (!user || !okPass) {
    return reply(req, res, { status: 401, subject: username, result: 'deny', reason: 'kredensial tidak valid', body: { error: 'Kredensial tidak valid' } });
  }
  if (!isRegisteredDevice(user.id, device)) {
    return reply(req, res, { status: 403, subject: username, result: 'deny', reason: 'device tidak terdaftar untuk user ini', body: { error: 'Device tidak terdaftar' } });
  }
  const refresh = crypto.randomBytes(48).toString('hex');
  db.prepare('INSERT INTO refresh_tokens (token_hash, user_id, device_id, expires_at) VALUES (?,?,?,?)')
    .run(sha256(refresh), user.id, device, Date.now() + cfg.REFRESH_TOKEN_TTL_MS);
  reply(req, res, {
    status: 200, subject: username, result: 'allow', reason: 'login berhasil',
    body: { access_token: signAccess(user), refresh_token: refresh, token_type: 'Bearer', expires_in: 600 },
  });
});

function findRefresh(token) {
  if (typeof token !== 'string') return null;
  const row = db.prepare('SELECT * FROM refresh_tokens WHERE token_hash = ?').get(sha256(token));
  return row || null;
}

router.post('/refresh', (req, res) => {
  const row = findRefresh((req.body || {}).refresh_token);
  const device = req.get('x-device-id');
  if (!row) return reply(req, res, { status: 401, subject: 'anonymous', result: 'deny', reason: 'refresh token tidak dikenal' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id);
  const subject = user ? user.username : `user#${row.user_id}`;
  if (row.revoked) return reply(req, res, { status: 401, subject, result: 'deny', reason: 'refresh token sudah dicabut' });
  if (row.expires_at < Date.now()) return reply(req, res, { status: 401, subject, result: 'deny', reason: 'refresh token kedaluwarsa' });
  if (device && device !== row.device_id) return reply(req, res, { status: 403, subject, result: 'deny', reason: 'device tidak cocok dengan refresh token' });
  if (!user) return reply(req, res, { status: 401, subject, result: 'deny', reason: 'user tidak ditemukan' });
  reply(req, res, {
    status: 200, subject, result: 'allow', reason: 'refresh berhasil',
    body: { access_token: signAccess(user), token_type: 'Bearer', expires_in: 600 },
  });
});

router.post('/logout', (req, res) => {
  const row = findRefresh((req.body || {}).refresh_token);
  if (!row || row.revoked || row.expires_at < Date.now()) {
    return reply(req, res, { status: 401, subject: 'anonymous', result: 'deny', reason: 'refresh token tidak valid / sudah dicabut' });
  }
  db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE id = ?').run(row.id);
  const user = db.prepare('SELECT username FROM users WHERE id = ?').get(row.user_id);
  reply(req, res, { status: 200, subject: user ? user.username : `user#${row.user_id}`, result: 'allow', reason: 'logout, refresh token dicabut', body: { message: 'Logout berhasil' } });
});

router.post('/service', (req, res) => {
  const { client_id, client_secret } = req.body || {};
  const client = typeof client_id === 'string'
    ? db.prepare('SELECT * FROM service_clients WHERE client_id = ?').get(client_id) : null;
  if (!client || typeof client_secret !== 'string' || !bcrypt.compareSync(client_secret, client.secret_hash)) {
    return reply(req, res, { status: 401, subject: String(client_id || 'anonymous'), result: 'deny', reason: 'client id/secret tidak valid', body: { error: 'Kredensial service tidak valid' } });
  }
  reply(req, res, {
    status: 200, subject: client.client_id, result: 'allow', reason: 'token service diterbitkan',
    body: { access_token: signService(client.client_id), token_type: 'Bearer', expires_in: 300 },
  });
});

// Semua yang tidak dikenali di bawah /auth ditolak + diaudit.
router.use((req, res) => {
  reply(req, res, { status: 404, subject: 'anonymous', result: 'deny', reason: 'endpoint /auth tidak dikenal' });
});

module.exports = router;
