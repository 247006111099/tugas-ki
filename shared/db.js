const { DatabaseSync } = require('node:sqlite'); // SQLite bawaan Node.js (>= 22.13), tanpa kompilasi native
const fs = require('fs');
const path = require('path');
const { DB_PATH } = require('./config');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const raw = new DatabaseSync(DB_PATH);
raw.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');

// Pembungkus tipis agar API-nya: db.exec, db.prepare, db.transaction(fn)
const db = {
  exec: (sql) => raw.exec(sql),
  prepare: (sql) => raw.prepare(sql),
  transaction: (fn) => (...args) => {
    raw.exec('BEGIN');
    try {
      const r = fn(...args);
      raw.exec('COMMIT');
      return r;
    } catch (e) {
      raw.exec('ROLLBACK');
      throw e;
    }
  },
};

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  nama TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('mahasiswa','dosen','admin')),
  nim TEXT UNIQUE
);
CREATE TABLE IF NOT EXISTS devices (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  device_id TEXT NOT NULL,
  UNIQUE (user_id, device_id)
);
CREATE TABLE IF NOT EXISTS kelas (
  id INTEGER PRIMARY KEY,
  kode TEXT NOT NULL,
  nama TEXT NOT NULL,
  sks INTEGER NOT NULL DEFAULT 3,
  dosen_id INTEGER NOT NULL REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS nilai (
  id INTEGER PRIMARY KEY,
  kelas_id INTEGER NOT NULL REFERENCES kelas(id),
  nim TEXT NOT NULL,
  nilai REAL,
  final INTEGER NOT NULL DEFAULT 0,
  UNIQUE (kelas_id, nim)
);
CREATE TABLE IF NOT EXISTS transkrip (
  id INTEGER PRIMARY KEY,
  nim TEXT NOT NULL,
  kelas_id INTEGER NOT NULL,
  kode TEXT NOT NULL,
  nama TEXT NOT NULL,
  sks INTEGER NOT NULL,
  nilai REAL NOT NULL,
  huruf TEXT NOT NULL,
  synced_at TEXT NOT NULL,
  UNIQUE (nim, kelas_id)
);
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id INTEGER PRIMARY KEY,
  token_hash TEXT UNIQUE NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  device_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS service_clients (
  client_id TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  ts TEXT NOT NULL,
  subject TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  device TEXT,
  result TEXT NOT NULL CHECK (result IN ('allow','deny')),
  reason TEXT NOT NULL
);
`);

module.exports = db;
