// Mengisi database dengan data awal. Pakai --if-empty agar tidak menimpa data yang ada.
const bcrypt = require('bcryptjs');
const db = require('../shared/db');
const cfg = require('../shared/config');

const ifEmpty = process.argv.includes('--if-empty');
if (ifEmpty && db.prepare('SELECT COUNT(*) c FROM users').get().c > 0) {
  console.log('Database sudah berisi data, seed dilewati.');
  process.exit(0);
}

const PASSWORD = 'password123';
const hash = bcrypt.hashSync(PASSWORD, 10);

const users = [
  // id, username, nama, role, nim, device
  [1, 'admin1', 'Admin Prodi', 'admin', null, 'DEV-ADMIN-01'],
  [2, 'dosen1', 'Dr. Dosen Satu', 'dosen', null, 'DEV-DOSEN-01'],
  [3, 'dosen2', 'Dr. Dosen Dua', 'dosen', null, 'DEV-DOSEN-02'],
  [4, 'mhs1', 'Mahasiswa Satu', 'mahasiswa', '217006001', 'DEV-MHS-01'],
  [5, 'mhs2', 'Mahasiswa Dua', 'mahasiswa', '217006002', 'DEV-MHS-02'],
  [6, 'mhs3', 'Mahasiswa Tiga', 'mahasiswa', '217006003', 'DEV-MHS-03'],
];

const kelas = [
  [1, 'KP70065004', 'Keamanan Informasi', 3, 2], // diampu dosen1
  [2, 'KP70065010', 'Pemrograman Web', 3, 3],    // diampu dosen2
];

const nilaiAwal = {
  1: { '217006001': 88, '217006002': 74, '217006003': 61 },
  2: { '217006001': 79, '217006002': 90, '217006003': 55 },
};

db.transaction(() => {
  for (const t of ['audit_log', 'refresh_tokens', 'transkrip', 'nilai', 'kelas', 'devices', 'service_clients', 'users']) {
    db.prepare(`DELETE FROM ${t}`).run();
  }
  const iu = db.prepare('INSERT INTO users (id, username, password_hash, nama, role, nim) VALUES (?,?,?,?,?,?)');
  const id = db.prepare('INSERT INTO devices (user_id, device_id) VALUES (?,?)');
  for (const [uid, un, nama, role, nim, dev] of users) {
    iu.run(uid, un, hash, nama, role, nim);
    id.run(uid, dev);
  }
  const ik = db.prepare('INSERT INTO kelas (id, kode, nama, sks, dosen_id) VALUES (?,?,?,?,?)');
  const inl = db.prepare('INSERT INTO nilai (kelas_id, nim, nilai, final) VALUES (?,?,?,0)');
  for (const k of kelas) ik.run(...k);
  for (const [kid, m] of Object.entries(nilaiAwal)) {
    for (const [nim, n] of Object.entries(m)) inl.run(Number(kid), nim, n);
  }
  db.prepare('INSERT INTO service_clients (client_id, secret_hash) VALUES (?,?)')
    .run(cfg.SERVICE_CLIENT_ID, bcrypt.hashSync(cfg.SERVICE_CLIENT_SECRET, 10));
})();

console.log('Seed selesai. Password semua user:', PASSWORD);
console.table(users.map(([, un, , role, nim, dev]) => ({ username: un, role, nim, device: dev })));
