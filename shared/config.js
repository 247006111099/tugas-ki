// Konfigurasi bersama. Semua nilai dapat di-override lewat environment variable.
const path = require('path');

module.exports = {
  GATEWAY_PORT: Number(process.env.GATEWAY_PORT || 3000),
  NILAI_PORT: Number(process.env.NILAI_PORT || 3001),
  TRANSKRIP_PORT: Number(process.env.TRANSKRIP_PORT || 3002),

  // Di Docker, ganti dengan nama service compose (lihat docker-compose.yml)
  GATEWAY_URL: process.env.GATEWAY_URL || 'http://localhost:3000',
  NILAI_URL: process.env.NILAI_URL || 'http://localhost:3001',
  TRANSKRIP_URL: process.env.TRANSKRIP_URL || 'http://localhost:3002',

  DB_PATH: process.env.DB_PATH || path.join(__dirname, '..', 'data', 'app.db'),

  // Secret: WAJIB diganti di luar lingkungan praktikum.
  JWT_SECRET: process.env.JWT_SECRET || 'dev-jwt-secret-ganti-di-produksi',
  GATEWAY_SECRET: process.env.GATEWAY_SECRET || 'dev-gateway-secret-ganti-di-produksi',
  SERVICE_CLIENT_ID: process.env.SERVICE_CLIENT_ID || 'service-nilai',
  SERVICE_CLIENT_SECRET: process.env.SERVICE_CLIENT_SECRET || 'nilai-secret-rahasia',

  JWT_ISSUER: 'zt-gateway',
  ACCESS_TOKEN_TTL: '10m',
  SERVICE_TOKEN_TTL: '5m',
  REFRESH_TOKEN_TTL_MS: 24 * 60 * 60 * 1000, // 1 hari

  // Jam akses untuk PUT /nilai/:id dan POST /kelas/:id/finalisasi.
  // Format HH:MM, batas akhir eksklusif. Contoh demo: ACCESS_START=00:00 ACCESS_END=00:00 (selalu tutup)
  ACCESS_START: process.env.ACCESS_START || '07:00',
  ACCESS_END: process.env.ACCESS_END || '21:00',
  ACCESS_TZ: process.env.ACCESS_TZ || 'Asia/Jakarta',
};
