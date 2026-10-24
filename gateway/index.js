// API Gateway = Policy Enforcement Point (PEP). Satu-satunya pintu masuk.
const express = require('express');
const jwt = require('jsonwebtoken');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cfg = require('../shared/config');
const { audit } = require('./audit');
const { decide, matchRoute, isRegisteredDevice, getUser } = require('./policy');
const authRouter = require('./auth');

const app = express();
app.disable('x-powered-by');

// Windows PowerShell 5.1 mengirim 'Expect: 100-continue' pada POST/PUT. Jika ikut diteruskan,
// Node mengirim header ke service sebelum X-Gateway-Secret ditambahkan. Gateway sudah membalas
// 100 Continue ke client, jadi header ini tidak perlu diteruskan.
app.use((req, res, next) => { delete req.headers.expect; next(); });

// Body hanya di-parse untuk /auth/*; request lain diteruskan utuh ke service.
app.use('/auth', express.json(), authRouter, (err, req, res, next) => {
  // Penanganan body JSON rusak (error dari express.json)
  audit({ subject: 'anonymous', method: req.method, path: req.originalUrl, device: req.get('x-device-id'), result: 'deny', reason: 'body JSON tidak valid' });
  res.status(400).json({ error: 'Body JSON tidak valid' });
});

// ---------- PEP: periksa -> minta keputusan PE -> audit -> teruskan ----------
function enforce(req, res, next) {
  const method = req.method;
  const path = req.path;
  const device = req.get('x-device-id');
  const finish = (subject, d) => {
    audit({ subject, method, path, device, result: d.allow ? 'allow' : 'deny', reason: d.reason });
    if (d.allow) return next();
    return res.status(d.status).json({ error: 'Akses ditolak', reason: d.reason });
  };

  const route = matchRoute(method, path);
  if (!route) return finish('anonymous', { allow: false, status: 404, reason: 'endpoint tidak dikenal (default deny)' });

  // 1) Access token wajib dan harus valid (tanda tangan + masa berlaku)
  const m = /^Bearer (.+)$/.exec(req.get('authorization') || '');
  if (!m) return finish('anonymous', { allow: false, status: 401, reason: 'access token tidak ada' });
  let claims;
  try {
    claims = jwt.verify(m[1], cfg.JWT_SECRET, { algorithms: ['HS256'], issuer: cfg.JWT_ISSUER });
  } catch (e) {
    const why = e.name === 'TokenExpiredError' ? 'access token kedaluwarsa' : 'access token tidak valid';
    return finish('anonymous', { allow: false, status: 401, reason: why });
  }

  // 2) Device terdaftar (hanya untuk user; token service tidak membawa device)
  let subject = claims.sub;
  if (claims.role !== 'service') {
    const user = getUser(claims.sub);
    if (!user) return finish(`sub:${claims.sub}`, { allow: false, status: 401, reason: 'user pada token tidak ditemukan' });
    subject = `${user.role}:${claims.sub}`;
    if (!isRegisteredDevice(user.id, device)) {
      return finish(subject, { allow: false, status: 403, reason: 'device tidak terdaftar untuk user ini' });
    }
  } else {
    subject = `service:${claims.sub}`;
  }

  // 3) Keputusan Policy Engine
  const decision = decide({ route, claims, query: req.query, now: new Date() });
  return finish(subject, decision);
}
app.use(enforce);

// ---------- Forwarding ke service (hanya setelah allow) ----------
function proxyTo(target, prefixes) {
  return createProxyMiddleware({
    target,
    changeOrigin: true,
    pathFilter: (p) => prefixes.some((x) => p === x || p.startsWith(`${x}/`)),
    headers: { 'X-Gateway-Secret': cfg.GATEWAY_SECRET }, // menimpa kiriman client
    on: {
      error: (err, req, res) => {
        if (res.writeHead && !res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Service tidak dapat dihubungi' }));
        }
      },
    },
  });
}
app.use(proxyTo(cfg.NILAI_URL, ['/nilai', '/kelas']));
app.use(proxyTo(cfg.TRANSKRIP_URL, ['/transkrip']));

app.listen(cfg.GATEWAY_PORT, () => console.log(`API Gateway (PEP) berjalan di port ${cfg.GATEWAY_PORT}`));
