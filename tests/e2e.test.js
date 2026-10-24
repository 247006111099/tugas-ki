// Pengujian end-to-end: menjalankan seluruh sistem dengan DB sementara.
// Jalankan: npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const root = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zt-'));
const env = {
  ...process.env,
  DB_PATH: path.join(tmp, 'test.db'),
  GATEWAY_PORT: '3000', NILAI_PORT: '3001', TRANSKRIP_PORT: '3002',
  ACCESS_START: '00:00', ACCESS_END: '24:00', // selalu buka untuk pengujian
};
const G = 'http://localhost:3000';
const G_CLOSED = 'http://localhost:3010'; // gateway kedua: jam akses selalu tutup
const procs = [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(url) {
  for (let i = 0; i < 50; i++) {
    try { await fetch(url); return; } catch { await sleep(200); }
  }
  throw new Error(`timeout menunggu ${url}`);
}

before(async () => {
  spawnSync(process.execPath, ['scripts/seed.js'], { cwd: root, env, stdio: 'ignore' });
  const run = (file, e = env) => procs.push(spawn(process.execPath, [file], { cwd: root, env: e, stdio: 'ignore' }));
  run('services/transkrip/index.js');
  run('services/nilai/index.js');
  run('gateway/index.js');
  run('gateway/index.js', { ...env, GATEWAY_PORT: '3010', ACCESS_START: '00:00', ACCESS_END: '00:00' });
  await Promise.all([waitFor(G), waitFor(G_CLOSED), waitFor('http://localhost:3001'), waitFor('http://localhost:3002')]);
});
after(() => { procs.forEach((p) => p.kill()); fs.rmSync(tmp, { recursive: true, force: true }); });

async function call(method, url, { token, device, body, headers } = {}) {
  const r = await fetch(url, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(device ? { 'X-Device-ID': device } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await r.json(); } catch { /* kosong */ }
  return { status: r.status, data };
}

const devices = { admin1: 'DEV-ADMIN-01', dosen1: 'DEV-DOSEN-01', dosen2: 'DEV-DOSEN-02', mhs1: 'DEV-MHS-01', mhs2: 'DEV-MHS-02', mhs3: 'DEV-MHS-03' };
async function login(u, gw = G) {
  const r = await call('POST', `${gw}/auth/login`, { body: { username: u, password: 'password123' }, device: devices[u] });
  assert.equal(r.status, 200, `login ${u}`);
  return r.data;
}

test('login: kredensial salah & device tidak terdaftar ditolak', async () => {
  assert.equal((await call('POST', `${G}/auth/login`, { body: { username: 'mhs1', password: 'salah' }, device: 'DEV-MHS-01' })).status, 401);
  assert.equal((await call('POST', `${G}/auth/login`, { body: { username: 'mhs1', password: 'password123' }, device: 'DEV-ASING' })).status, 403);
  assert.equal((await call('POST', `${G}/auth/login`, { body: { username: 'mhs1', password: 'password123' } })).status, 403);
});

test('default deny, token wajib, token palsu ditolak', async () => {
  assert.equal((await call('GET', `${G}/nilai`)).status, 401);
  assert.equal((await call('GET', `${G}/nilai`, { token: 'abc.def.ghi', device: 'DEV-MHS-01' })).status, 401);
  assert.equal((await call('GET', `${G}/rahasia`)).status, 404);
});

test('device: token valid tetapi device milik user lain ditolak', async () => {
  const t = await login('mhs1');
  assert.equal((await call('GET', `${G}/nilai`, { token: t.access_token, device: 'DEV-MHS-02' })).status, 403);
  assert.equal((await call('GET', `${G}/nilai`, { token: t.access_token })).status, 403);
  assert.equal((await call('GET', `${G}/nilai`, { token: t.access_token, device: 'DEV-MHS-01' })).status, 200);
});

test('mahasiswa hanya melihat nilai & transkrip sendiri', async () => {
  const t = await login('mhs1');
  const own = await call('GET', `${G}/nilai`, { token: t.access_token, device: 'DEV-MHS-01' });
  assert.ok(own.data.data.length > 0 && own.data.data.every((r) => r.nim === '217006001'));
  assert.equal((await call('GET', `${G}/nilai?nim=217006002`, { token: t.access_token, device: 'DEV-MHS-01' })).status, 403);
  assert.equal((await call('GET', `${G}/transkrip/217006001`, { token: t.access_token, device: 'DEV-MHS-01' })).status, 200);
  assert.equal((await call('GET', `${G}/transkrip/217006002`, { token: t.access_token, device: 'DEV-MHS-01' })).status, 403);
  assert.equal((await call('PUT', `${G}/nilai/1`, { token: t.access_token, device: 'DEV-MHS-01', body: { nilai: 100 } })).status, 403);
});

test('dosen: hanya kelas yang diampu', async () => {
  const t = await login('dosen1');
  const h = { token: t.access_token, device: 'DEV-DOSEN-01' };
  const all = await call('GET', `${G}/nilai`, h);
  assert.ok(all.data.data.every((r) => r.kelas_id === 1));
  assert.equal((await call('GET', `${G}/nilai?kelas_id=2`, h)).status, 403);
  assert.equal((await call('PUT', `${G}/nilai/4`, { ...h, body: { nilai: 99 } })).status, 403); // nilai id 4 = kelas 2 (dosen2)
  assert.equal((await call('POST', `${G}/kelas/2/finalisasi`, h)).status, 403);
  assert.equal((await call('PUT', `${G}/nilai/1`, { ...h, body: { nilai: 91 } })).status, 200);
  assert.equal((await call('PUT', `${G}/nilai/1`, { ...h, body: { nilai: 191 } })).status, 400);
});

test('admin: transkrip semua NIM, tidak boleh akses nilai', async () => {
  const t = await login('admin1');
  const h = { token: t.access_token, device: 'DEV-ADMIN-01' };
  assert.equal((await call('GET', `${G}/transkrip/217006003`, h)).status, 200);
  assert.equal((await call('GET', `${G}/nilai`, h)).status, 403);
});

test('jam akses: PUT dan finalisasi ditolak di luar jam', async () => {
  const t = await login('dosen1', G_CLOSED);
  const h = { token: t.access_token, device: 'DEV-DOSEN-01' };
  const put = await call('PUT', `${G_CLOSED}/nilai/2`, { ...h, body: { nilai: 80 } });
  assert.equal(put.status, 403);
  assert.match(put.data.reason, /jam akses/);
  assert.equal((await call('POST', `${G_CLOSED}/kelas/1/finalisasi`, h)).status, 403);
  assert.equal((await call('GET', `${G_CLOSED}/nilai`, h)).status, 200); // baca tetap boleh
});

test('service tidak dapat diakses langsung & token wajib walau ada gateway secret', async () => {
  const direct = await call('GET', 'http://localhost:3001/nilai');
  assert.equal(direct.status, 403);
  const t = await login('mhs1');
  assert.equal((await call('GET', 'http://localhost:3002/transkrip/217006001', { token: t.access_token })).status, 403);
  const withSecret = await call('GET', 'http://localhost:3002/transkrip/217006001', { headers: { 'X-Gateway-Secret': 'dev-gateway-secret-ganti-di-produksi' } });
  assert.equal(withSecret.status, 401); // secret benar tapi tanpa token
  const forged = await call('GET', 'http://localhost:3002/transkrip/217006001', { token: 'x.y.z', headers: { 'X-Gateway-Secret': 'dev-gateway-secret-ganti-di-produksi' } });
  assert.equal(forged.status, 401);
});

test('request dengan header Expect: 100-continue (PowerShell 5.1) tetap lolos lewat gateway', async () => {
  const t = await login('dosen1');
  const http = require('node:http');
  const status = await new Promise((resolve, reject) => {
    const body = JSON.stringify({ nilai: 77 });
    const req = http.request(`${G}/nilai/3`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body),
        Authorization: `Bearer ${t.access_token}`, 'X-Device-ID': 'DEV-DOSEN-01', Expect: '100-continue',
      },
    }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject);
    req.end(body);
  });
  assert.equal(status, 200);
});

test('POST /transkrip/sinkron: hanya token service', async () => {
  const body = { kelas: { id: 1, kode: 'X', nama: 'X', sks: 3 }, nilai: [{ nim: '217006001', nilai: 80 }] };
  const u = await login('dosen1');
  assert.equal((await call('POST', `${G}/transkrip/sinkron`, { token: u.access_token, device: 'DEV-DOSEN-01', body })).status, 403);
  assert.equal((await call('POST', `${G}/auth/service`, { body: { client_id: 'service-nilai', client_secret: 'salah' } })).status, 401);
  const s = await call('POST', `${G}/auth/service`, { body: { client_id: 'service-nilai', client_secret: 'nilai-secret-rahasia' } });
  assert.equal(s.status, 200);
  assert.equal((await call('POST', `${G}/transkrip/sinkron`, { token: s.data.access_token, body })).status, 201);
  // token service tidak boleh membaca transkrip
  assert.equal((await call('GET', `${G}/transkrip/217006001`, { token: s.data.access_token })).status, 403);
});

test('finalisasi -> nilai final, transkrip tersinkron, nilai tidak bisa diubah lagi', async () => {
  const t = await login('dosen2');
  const h = { token: t.access_token, device: 'DEV-DOSEN-02' };
  const fin = await call('POST', `${G}/kelas/2/finalisasi`, h);
  assert.equal(fin.status, 200, JSON.stringify(fin.data));
  assert.equal((await call('PUT', `${G}/nilai/4`, { ...h, body: { nilai: 50 } })).status, 409);
  assert.equal((await call('POST', `${G}/kelas/2/finalisasi`, h)).status, 409);
  const m = await login('mhs2');
  const tr = await call('GET', `${G}/transkrip/217006002`, { token: m.access_token, device: 'DEV-MHS-02' });
  assert.equal(tr.status, 200);
  assert.ok(tr.data.mata_kuliah.some((x) => x.kode === 'KP70065010' && x.nilai === 90));
});

test('refresh & logout mencabut refresh token', async () => {
  const t = await login('mhs3');
  const r1 = await call('POST', `${G}/auth/refresh`, { body: { refresh_token: t.refresh_token } });
  assert.equal(r1.status, 200);
  assert.equal((await call('GET', `${G}/nilai`, { token: r1.data.access_token, device: 'DEV-MHS-03' })).status, 200);
  assert.equal((await call('POST', `${G}/auth/logout`, { body: { refresh_token: t.refresh_token } })).status, 200);
  assert.equal((await call('POST', `${G}/auth/refresh`, { body: { refresh_token: t.refresh_token } })).status, 401);
  assert.equal((await call('POST', `${G}/auth/refresh`, { body: { refresh_token: 'ngawur' } })).status, 401);
});

test('audit log mencatat allow dan deny beserta alasan', async () => {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(env.DB_PATH, { readOnly: true });
  const rows = db.prepare('SELECT * FROM audit_log').all();
  assert.ok(rows.some((r) => r.result === 'allow'));
  assert.ok(rows.some((r) => r.result === 'deny' && /jam akses/.test(r.reason)));
  assert.ok(rows.every((r) => r.ts && r.subject && r.endpoint && r.reason));
  db.close();
});
