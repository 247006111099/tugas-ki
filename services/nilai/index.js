// Service Nilai (port 3001) — data nilai & kelas.
const express = require('express');
const db = require('../../shared/db');
const cfg = require('../../shared/config');
const { serviceGuard } = require('../../shared/serviceGuard');

const app = express();
app.disable('x-powered-by');
app.use(express.json());
app.use(serviceGuard); // gateway secret + verifikasi ulang token

const forbidden = (res, msg) => res.status(403).json({ error: msg });
const qNim = db.prepare('SELECT nim FROM users WHERE id = ? AND role = ?');

const baseSelect = `
  SELECT n.id, n.kelas_id, k.kode, k.nama AS kelas, n.nim, n.nilai, n.final
  FROM nilai n JOIN kelas k ON k.id = n.kelas_id`;

// GET /nilai — mahasiswa: miliknya; dosen: kelas yang diampu.
app.get('/nilai', (req, res) => {
  const { sub, role } = req.auth;
  const { kelas_id, nim } = req.query;
  if (role === 'mahasiswa') {
    const me = qNim.get(Number(sub), 'mahasiswa');
    if (!me) return forbidden(res, 'Mahasiswa tidak ditemukan');
    if (nim && nim !== me.nim) return forbidden(res, 'Bukan nilai milik Anda');
    const rows = db.prepare(`${baseSelect} WHERE n.nim = ? ORDER BY n.kelas_id`).all(me.nim);
    return res.json({ data: rows });
  }
  if (role === 'dosen') {
    let sql = `${baseSelect} WHERE k.dosen_id = ?`;
    const args = [Number(sub)];
    if (kelas_id !== undefined) {
      const k = db.prepare('SELECT dosen_id FROM kelas WHERE id = ?').get(Number(kelas_id));
      if (!k) return res.status(404).json({ error: 'Kelas tidak ditemukan' });
      if (k.dosen_id !== Number(sub)) return forbidden(res, 'Bukan kelas yang Anda ampu');
      sql += ' AND n.kelas_id = ?';
      args.push(Number(kelas_id));
    }
    if (nim) { sql += ' AND n.nim = ?'; args.push(nim); }
    return res.json({ data: db.prepare(`${sql} ORDER BY n.kelas_id, n.nim`).all(...args) });
  }
  return forbidden(res, 'Role tidak diizinkan');
});

// PUT /nilai/:id — dosen pengampu, nilai belum final.
app.put('/nilai/:id', (req, res) => {
  const { sub, role } = req.auth;
  if (role !== 'dosen') return forbidden(res, 'Hanya dosen');
  const row = db.prepare(`${baseSelect} WHERE n.id = ?`).get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Data nilai tidak ditemukan' });
  const k = db.prepare('SELECT dosen_id FROM kelas WHERE id = ?').get(row.kelas_id);
  if (k.dosen_id !== Number(sub)) return forbidden(res, 'Bukan kelas yang Anda ampu');
  if (row.final) return res.status(409).json({ error: 'Nilai sudah final' });
  const v = req.body && req.body.nilai;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 100) {
    return res.status(400).json({ error: 'Field "nilai" harus angka 0-100' });
  }
  db.prepare('UPDATE nilai SET nilai = ? WHERE id = ?').run(v, row.id);
  res.json({ message: 'Nilai diperbarui', id: row.id, nilai: v });
});

// ---- Panggilan antar-service: selalu lewat gateway, memakai token service ----
async function getServiceToken() {
  const r = await fetch(`${cfg.GATEWAY_URL}/auth/service`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: cfg.SERVICE_CLIENT_ID, client_secret: cfg.SERVICE_CLIENT_SECRET }),
  });
  if (!r.ok) throw new Error(`gagal mengambil token service (${r.status})`);
  return (await r.json()).access_token;
}

async function sinkronTranskrip(payload) {
  const token = await getServiceToken();
  const r = await fetch(`${cfg.GATEWAY_URL}/transkrip/sinkron`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`sinkron transkrip gagal (${r.status})`);
  return r.json();
}

// POST /kelas/:id/finalisasi — dosen pengampu; lalu sinkron ke Service Transkrip.
app.post('/kelas/:id/finalisasi', async (req, res) => {
  const { sub, role } = req.auth;
  if (role !== 'dosen') return forbidden(res, 'Hanya dosen');
  const kelas = db.prepare('SELECT * FROM kelas WHERE id = ?').get(Number(req.params.id));
  if (!kelas) return res.status(404).json({ error: 'Kelas tidak ditemukan' });
  if (kelas.dosen_id !== Number(sub)) return forbidden(res, 'Bukan kelas yang Anda ampu');

  const rows = db.prepare('SELECT id, nim, nilai, final FROM nilai WHERE kelas_id = ?').all(kelas.id);
  if (rows.length === 0) return res.status(409).json({ error: 'Kelas belum memiliki data nilai' });
  if (rows.every((r) => r.final)) return res.status(409).json({ error: 'Kelas sudah difinalisasi' });
  if (rows.some((r) => r.nilai === null)) return res.status(409).json({ error: 'Masih ada nilai kosong' });

  db.prepare('UPDATE nilai SET final = 1 WHERE kelas_id = ?').run(kelas.id);
  try {
    const hasil = await sinkronTranskrip({
      kelas: { id: kelas.id, kode: kelas.kode, nama: kelas.nama, sks: kelas.sks },
      nilai: rows.map((r) => ({ nim: r.nim, nilai: r.nilai })),
    });
    res.json({ message: 'Kelas difinalisasi dan transkrip disinkronkan', sinkron: hasil });
  } catch (e) {
    // Gagal sinkron -> batalkan finalisasi agar data tetap konsisten.
    db.prepare('UPDATE nilai SET final = 0 WHERE kelas_id = ?').run(kelas.id);
    console.error('[nilai] finalisasi dibatalkan:', e.message);
    res.status(502).json({ error: 'Sinkron transkrip gagal, finalisasi dibatalkan', detail: e.message });
  }
});

app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.listen(cfg.NILAI_PORT, () => console.log(`Service Nilai berjalan di port ${cfg.NILAI_PORT}`));
