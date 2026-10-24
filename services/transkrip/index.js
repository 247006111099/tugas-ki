// Service Transkrip (port 3002) — data transkrip mahasiswa.
const express = require('express');
const db = require('../../shared/db');
const cfg = require('../../shared/config');
const { serviceGuard } = require('../../shared/serviceGuard');

const app = express();
app.disable('x-powered-by');
app.use(express.json());
app.use(serviceGuard);

const huruf = (n) => (n >= 85 ? 'A' : n >= 70 ? 'B' : n >= 55 ? 'C' : n >= 40 ? 'D' : 'E');
const bobot = { A: 4, B: 3, C: 2, D: 1, E: 0 };

// POST /transkrip/sinkron — hanya token service (user mana pun ditolak).
app.post('/transkrip/sinkron', (req, res) => {
  if (req.auth.role !== 'service' || req.auth.typ !== 'service') {
    return res.status(403).json({ error: 'Hanya token service yang diizinkan' });
  }
  const { kelas, nilai } = req.body || {};
  if (!kelas || !Number.isInteger(kelas.id) || !kelas.kode || !kelas.nama || !Array.isArray(nilai)) {
    return res.status(400).json({ error: 'Payload tidak valid' });
  }
  for (const n of nilai) {
    if (typeof n.nim !== 'string' || typeof n.nilai !== 'number' || n.nilai < 0 || n.nilai > 100) {
      return res.status(400).json({ error: 'Data nilai tidak valid' });
    }
  }
  const now = new Date().toISOString();
  const up = db.prepare(`
    INSERT INTO transkrip (nim, kelas_id, kode, nama, sks, nilai, huruf, synced_at)
    VALUES (@nim, @kelas_id, @kode, @nama, @sks, @nilai, @huruf, @synced_at)
    ON CONFLICT (nim, kelas_id) DO UPDATE SET nilai = excluded.nilai, huruf = excluded.huruf, synced_at = excluded.synced_at`);
  db.transaction(() => {
    for (const n of nilai) {
      up.run({ nim: n.nim, kelas_id: kelas.id, kode: kelas.kode, nama: kelas.nama, sks: kelas.sks || 3, nilai: n.nilai, huruf: huruf(n.nilai), synced_at: now });
    }
  })();
  res.status(201).json({ message: 'Transkrip disinkronkan', jumlah: nilai.length });
});

// GET /transkrip/:nim — mahasiswa: NIM sendiri; admin: semua.
app.get('/transkrip/:nim', (req, res) => {
  const { sub, role } = req.auth;
  const { nim } = req.params;
  if (role === 'mahasiswa') {
    const me = db.prepare("SELECT nim FROM users WHERE id = ? AND role = 'mahasiswa'").get(Number(sub));
    if (!me || me.nim !== nim) return res.status(403).json({ error: 'Bukan transkrip milik Anda' });
  } else if (role !== 'admin') {
    return res.status(403).json({ error: 'Role tidak diizinkan' });
  }
  const mhs = db.prepare("SELECT nama, nim FROM users WHERE nim = ? AND role = 'mahasiswa'").get(nim);
  if (!mhs) return res.status(404).json({ error: 'Mahasiswa tidak ditemukan' });
  const mk = db.prepare('SELECT kode, nama, sks, nilai, huruf, synced_at FROM transkrip WHERE nim = ? ORDER BY kode').all(nim);
  const sks = mk.reduce((a, r) => a + r.sks, 0);
  const ipk = sks ? Number((mk.reduce((a, r) => a + bobot[r.huruf] * r.sks, 0) / sks).toFixed(2)) : null;
  res.json({ nim: mhs.nim, nama: mhs.nama, total_sks: sks, ipk, mata_kuliah: mk });
});

app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.listen(cfg.TRANSKRIP_PORT, () => console.log(`Service Transkrip berjalan di port ${cfg.TRANSKRIP_PORT}`));
