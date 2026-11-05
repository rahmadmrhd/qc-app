import { ConfigError, loadConfig } from '@server/config';
import { toDbError } from '@server/core/db';
import { bunServeOptions, createServer } from '@server/server';

// Titik masuk proses server: `bun run src/main.ts` (dev: `bun run dev:server`). Konfigurasi dari variabel
// lingkungan; Bun memuat `server/.env` bila dijalankan dari folder `server/`.
const SHUTDOWN_TIMEOUT_MS = 10_000;

let config: ReturnType<typeof loadConfig>;
try {
  config = loadConfig();
} catch (error) {
  console.error(error instanceof ConfigError ? error.message : String(error));
  console.error('Salin server/.env.example menjadi server/.env dan isi nilainya.');
  process.exit(1);
}

const app = createServer(config);

// Gagal cepat dan jelas bila basis data tidak terjangkau (dev: terowongan `bun run db:tunnel` belum jalan).
try {
  await app.env.DB.prepare('SELECT 1').first();
} catch (error) {
  console.error(`Basis data tidak terjangkau: ${toDbError(error).message}`);
  await app.stop();
  process.exit(1);
}

const server = Bun.serve(bunServeOptions(app, { host: config.host, port: config.port }));
console.log({
  evt: 'start',
  url: `http://${config.host}:${server.port}`,
  trustedProxy: config.trustedProxy,
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log({ evt: 'shutdown', signal });
  const force = setTimeout(() => {
    console.error('Shutdown melebihi batas waktu; keluar paksa.');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  try {
    await server.stop(); // berhenti menerima koneksi baru; menunggu permintaan berjalan
    await app.stop(); // runner/penjadwal selesai dulu, lalu pool basis data ditutup
    clearTimeout(force);
    process.exit(0);
  } catch (error) {
    console.error(`Shutdown gagal: ${String(error)}`);
    process.exit(1);
  }
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
