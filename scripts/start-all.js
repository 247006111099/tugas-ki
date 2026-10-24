// Menjalankan gateway + 2 service sekaligus (tanpa Docker). Seed otomatis jika DB kosong.
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const root = path.join(__dirname, '..');

spawnSync(process.execPath, [path.join(__dirname, 'seed.js'), '--if-empty'], { stdio: 'inherit', cwd: root });

const procs = [
  ['transkrip', 'services/transkrip/index.js'],
  ['nilai', 'services/nilai/index.js'],
  ['gateway', 'gateway/index.js'],
].map(([name, file]) => {
  const p = spawn(process.execPath, [file], { stdio: 'inherit', cwd: root });
  p.on('exit', (c) => { console.log(`[${name}] berhenti (kode ${c})`); });
  return p;
});
const stop = () => procs.forEach((p) => p.kill());
process.on('SIGINT', stop); process.on('SIGTERM', stop);
