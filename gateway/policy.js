// Policy Engine (PE) — memutuskan allow/deny berdasarkan Tabel 3 + atribut dari database.
// Setiap keputusan mengembalikan { allow, status, reason }.
const db = require('../shared/db');
const cfg = require('../shared/config');

const allow = (reason) => ({ allow: true, status: 200, reason });
const deny = (reason, status = 403) => ({ allow: false, status, reason });

// ---------- Konteks: jam akses ----------
function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
}

function currentMinutes(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: cfg.ACCESS_TZ, hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === 'hour').value) % 24;
  const m = Number(parts.find((p) => p.type === 'minute').value);
  return h * 60 + m;
}

function withinAccessHours(now = new Date()) {
  const start = toMinutes(cfg.ACCESS_START);
  const end = toMinutes(cfg.ACCESS_END);
  const cur = currentMinutes(now);
  if (start === end) return false;                 // dianggap selalu tutup
  if (start < end) return cur >= start && cur < end;
  return cur >= start || cur < end;                // rentang melewati tengah malam
}

// ---------- Atribut dari database ----------
const qUser = db.prepare('SELECT id, role, nim FROM users WHERE id = ?');
const qDevice = db.prepare('SELECT 1 FROM devices WHERE user_id = ? AND device_id = ?');
const qKelas = db.prepare('SELECT id, dosen_id FROM kelas WHERE id = ?');
const qNilai = db.prepare(
  'SELECT n.id, n.final, k.dosen_id FROM nilai n JOIN kelas k ON k.id = n.kelas_id WHERE n.id = ?'
);

function getUser(sub) { return qUser.get(Number(sub)); }
function isRegisteredDevice(userId, deviceId) {
  return !!deviceId && !!qDevice.get(userId, deviceId);
}

// ---------- Tabel kebijakan ----------
// Route table: dipakai gateway untuk mengenali endpoint sekaligus memilih rule.
const rules = [
  {
    method: 'GET', re: /^\/nilai\/?$/, roles: ['mahasiswa', 'dosen'], target: 'nilai',
    check({ user, query }) {
      if (user.role === 'mahasiswa') {
        if (query.nim && query.nim !== user.nim) return deny('mahasiswa hanya boleh melihat nilai miliknya sendiri');
        return allow('mahasiswa melihat nilai sendiri');
      }
      if (query.kelas_id !== undefined) {
        const k = qKelas.get(Number(query.kelas_id));
        if (!k) return deny('kelas tidak ditemukan', 404);
        if (k.dosen_id !== user.id) return deny('dosen bukan pengampu kelas ini');
      }
      return allow('dosen melihat nilai kelas yang diampu');
    },
  },
  {
    method: 'PUT', re: /^\/nilai\/(\d+)\/?$/, roles: ['dosen'], target: 'nilai',
    check({ user, params, now }) {
      const n = qNilai.get(Number(params[0]));
      if (!n) return deny('data nilai tidak ditemukan', 404);
      if (n.dosen_id !== user.id) return deny('dosen bukan pengampu kelas ini');
      if (n.final) return deny('nilai sudah final, tidak dapat diubah', 409);
      if (!withinAccessHours(now)) return deny(`di luar jam akses (${cfg.ACCESS_START}-${cfg.ACCESS_END} ${cfg.ACCESS_TZ})`);
      return allow('dosen mengubah nilai kelas yang diampu, belum final, dalam jam akses');
    },
  },
  {
    method: 'POST', re: /^\/kelas\/(\d+)\/finalisasi\/?$/, roles: ['dosen'], target: 'nilai',
    check({ user, params, now }) {
      const k = qKelas.get(Number(params[0]));
      if (!k) return deny('kelas tidak ditemukan', 404);
      if (k.dosen_id !== user.id) return deny('dosen bukan pengampu kelas ini');
      if (!withinAccessHours(now)) return deny(`di luar jam akses (${cfg.ACCESS_START}-${cfg.ACCESS_END} ${cfg.ACCESS_TZ})`);
      return allow('dosen memfinalisasi kelas yang diampu dalam jam akses');
    },
  },
  {
    method: 'GET', re: /^\/transkrip\/([^/]+)\/?$/, roles: ['mahasiswa', 'admin'], target: 'transkrip',
    check({ user, params }) {
      if (user.role === 'admin') return allow('admin melihat transkrip seluruh mahasiswa');
      if (params[0] !== user.nim) return deny('mahasiswa hanya boleh melihat transkrip NIM sendiri');
      return allow('mahasiswa melihat transkrip sendiri');
    },
  },
  {
    method: 'POST', re: /^\/transkrip\/sinkron\/?$/, roles: ['service'], target: 'transkrip',
    check() { return allow('token service melakukan sinkron transkrip'); },
  },
];

function matchRoute(method, path) {
  for (const r of rules) {
    if (r.method !== method) continue;
    const m = r.re.exec(path);
    if (m) return { rule: r, params: m.slice(1) };
  }
  return null;
}

// Keputusan akhir untuk request ber-token. `claims` sudah diverifikasi gateway.
function decide({ route, claims, query, now }) {
  const { rule, params } = route;
  if (!rule.roles.includes(claims.role)) {
    return deny(`role '${claims.role}' tidak diizinkan untuk endpoint ini`);
  }
  if (claims.role === 'service') return rule.check({ user: null, params, query, now });

  const user = getUser(claims.sub);
  if (!user) return deny('user pada token tidak ditemukan', 401);
  if (user.role !== claims.role) return deny('role pada token tidak sesuai database', 401);
  return rule.check({ user, params, query, now });
}

module.exports = { decide, matchRoute, withinAccessHours, isRegisteredDevice, getUser };
