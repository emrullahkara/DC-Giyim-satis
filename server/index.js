import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb } from './db.js';
import { createApp } from './app.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB_FILE = process.env.DB_FILE || path.join(ROOT, 'data', 'dcgiyim.db');
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

initDb(DB_FILE);
const app = createApp();
const server = app.listen(PORT, HOST, () => {
  console.log(`DC Giyim Satış çalışıyor → http://localhost:${PORT}  (veritabanı: ${DB_FILE})`);
});

const shutdown = () => server.close(() => process.exit(0));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
