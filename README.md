# Sistem Nilai — Zero Trust Security

Tugas Praktikum Individu, Keamanan Informasi (KP70065004), Informatika Universitas Siliwangi.

API gateway sebagai **Policy Enforcement Point (PEP)** yang terpisah dari service, mengikuti NIST SP 800-207.
Stack: Node.js + Express, `http-proxy-middleware`, `jsonwebtoken`, SQLite bawaan Node (`node:sqlite`, tanpa kompilasi native).

```
Client ──(access token + X-Device-ID)──► API Gateway :3000 (PEP + PE/PA + audit)
                                            │ allow + X-Gateway-Secret
                          ┌─────────────────┴─────────────────┐
                    Service Nilai :3001              Service Transkrip :3002
                          └────────── SQLite (data/app.db) ───┘
   Finalisasi: Service Nilai ─► gateway /auth/service ─► gateway /transkrip/sinkron
```

## Cara menjalankan

**Tanpa Docker** (**Node.js 22.13 atau lebih baru**, mis. Node 22 LTS atau 24):
```bash
npm install
npm start          # seed otomatis jika DB kosong, lalu jalankan gateway + 2 service
bash demo.sh       # (terminal lain) skenario curl lengkap
npm test           # pengujian end-to-end (13 skenario, memakai DB sementara)
npm run audit      # tampilkan audit log terakhir
npm run seed       # reset database ke data awal
```

**Docker Compose:** `docker compose up --build`. Hanya port 3000 yang dipublikasikan; service 3001/3002
tidak terbuka ke host.

**Konfigurasi** (environment variable, default di `shared/config.js`):

| Variabel | Default | Keterangan |
|---|---|---|
| `ACCESS_START`, `ACCESS_END` | `07:00`, `21:00` | Jam akses ubah/finalisasi nilai (HH:MM, batas akhir eksklusif) |
| `ACCESS_TZ` | `Asia/Jakarta` | Zona waktu untuk jam akses |
| `JWT_SECRET`, `GATEWAY_SECRET` | nilai dev | **Ganti** di luar praktikum |
| `SERVICE_CLIENT_ID`, `SERVICE_CLIENT_SECRET` | `service-nilai`, `nilai-secret-rahasia` | Kredensial Service Nilai |

Contoh demo jam akses ditutup (Linux/macOS): `ACCESS_START=00:00 ACCESS_END=00:00 npm start`
(PowerShell: `$env:ACCESS_START="00:00"; $env:ACCESS_END="00:00"; npm start`).

## Akun dan device ID data awal

Password semua akun: `password123`

| Username | Role | NIM | Device ID | Catatan |
|---|---|---|---|---|
| `admin1` | admin | – | `DEV-ADMIN-01` | |
| `dosen1` | dosen | – | `DEV-DOSEN-01` | mengampu kelas 1 (Keamanan Informasi) |
| `dosen2` | dosen | – | `DEV-DOSEN-02` | mengampu kelas 2 (Pemrograman Web) |
| `mhs1` | mahasiswa | 217006001 | `DEV-MHS-01` | |
| `mhs2` | mahasiswa | 217006002 | `DEV-MHS-02` | |
| `mhs3` | mahasiswa | 217006003 | `DEV-MHS-03` | |

Service Nilai: client ID `service-nilai`, secret `nilai-secret-rahasia`.
ID nilai: 1–3 = kelas 1 (mhs1–3), 4–6 = kelas 2 (mhs1–3).

## Contoh curl

```bash
# login (device wajib terdaftar)
curl -s -X POST localhost:3000/auth/login -H 'Content-Type: application/json' \
  -H 'X-Device-ID: DEV-DOSEN-01' -d '{"username":"dosen1","password":"password123"}'

# ubah nilai (ganti $TOKEN)
curl -s -X PUT localhost:3000/nilai/1 -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" -H 'X-Device-ID: DEV-DOSEN-01' -d '{"nilai":92}'

# finalisasi kelas -> Service Nilai memanggil sinkron transkrip lewat gateway
curl -s -X POST localhost:3000/kelas/1/finalisasi \
  -H "Authorization: Bearer $TOKEN" -H 'X-Device-ID: DEV-DOSEN-01'
```

## Peta kebutuhan → kode (panduan video demo)

| Kebutuhan | Penanganan | Lokasi |
|---|---|---|
| Gateway sebagai PEP, satu-satunya pintu masuk, default deny | `enforce()`: kenali route → verifikasi token → device → keputusan PE → audit → teruskan | `gateway/index.js` |
| Policy Engine (allow/deny + alasan, atribut dari DB) | `decide()` dan tabel `rules` sesuai Tabel 3 | `gateway/policy.js` |
| Login, refresh, logout, token service (PA) | `/auth/login`, `/refresh`, `/logout`, `/service` | `gateway/auth.js` |
| 4.1 Access token JWT 10 menit (`sub`, `role`) | `signAccess()` | `gateway/auth.js` |
| 4.1 Refresh token 1 hari, disimpan (hash), dapat dicabut | tabel `refresh_tokens`, logout set `revoked=1` | `gateway/auth.js`, `shared/db.js` |
| 4.1 Token service 5 menit, `role: service` | `signService()` + `POST /auth/service` | `gateway/auth.js` |
| 4.1 Gateway secret | `proxyReq` menyisipkan `X-Gateway-Secret` | `gateway/index.js` |
| 4.1 Verifikasi ulang di service (secret + tanda tangan + masa berlaku) | `serviceGuard` | `shared/serviceGuard.js` |
| 4.2 Kebijakan akses berbasis kepemilikan data | `rule.check()` membaca `kelas`, `nilai`, `users` | `gateway/policy.js` |
| 4.2 Endpoint `/transkrip/sinkron` hanya token service | rule `roles: ['service']` + cek ulang di service | `gateway/policy.js`, `services/transkrip/index.js` |
| 4.3 Device terdaftar (`X-Device-ID`) | `isRegisteredDevice()` dipanggil di login dan setiap request user | `gateway/policy.js`, `gateway/index.js` |
| 4.3 Jam akses dapat dikonfigurasi | `withinAccessHours()`, env `ACCESS_START/END` | `gateway/policy.js`, `shared/config.js` |
| 4.4 Audit log (waktu, subjek, endpoint, device, hasil, alasan) | `audit()` → tabel `audit_log` + stdout | `gateway/audit.js` |
| Finalisasi → sinkron transkrip lewat gateway | `sinkronTranskrip()`; gagal sinkron membatalkan finalisasi | `services/nilai/index.js` |

## Keputusan desain

- **Defense in depth (assume breach):** gateway memutuskan kebijakan, tetapi service juga memeriksa ulang peran,
  kepemilikan kelas/NIM, dan status final dari token + database. Request dengan gateway secret tapi tanpa token valid
  tetap ditolak (401), dan request tanpa gateway secret ditolak (403).
- **Default deny:** route yang tidak ada di tabel kebijakan ditolak 404 dan tetap diaudit.
- **Refresh token** disimpan sebagai hash SHA-256 dan terikat ke device login. Jika `X-Device-ID` dikirim saat refresh
  dan tidak cocok, request ditolak.
- **Konsistensi finalisasi:** bila sinkron ke Service Transkrip gagal, status final dibatalkan (HTTP 502).
- **Pesan login generik** untuk kredensial salah (tidak membocorkan keberadaan akun).
- **Keterbatasan:** JWT memakai secret simetris (HS256) yang dibagi antara gateway dan service; untuk produksi
  pakai RS256 dengan public key di service. Tidak ada rate limiting dan TLS (di luar lingkup praktikum).

## Struktur

```
gateway/    index.js (PEP) · policy.js (PE) · auth.js (PA) · audit.js
services/   nilai/ (3001) · transkrip/ (3002)
shared/     config.js · db.js (skema) · serviceGuard.js
scripts/    seed.js · start-all.js · show-audit.js
tests/      e2e.test.js        demo.sh        docker-compose.yml
```
