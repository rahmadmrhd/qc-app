import { prepareDatabase, StartupError } from '@server/boot';
import { ConfigError, loadConfig } from '@server/config';
import type { Db } from '@server/core/db';
import { toDbError } from '@server/core/db';
import { backfillBuAssignments } from '@server/modules/access/bu-backfill';
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

// Migrasi lalu backfill hak lama ke penugasan BU (idempoten: hanya user ber-`bu_assignments` kosong). Gagal di salah
// satunya = gagal start (kode 1), seperti migrasi.
async function prepare(db: Db): Promise<string[]> {
  const applied = await prepareDatabase(db);
  try {
    const backfilled = await backfillBuAssignments(db);
    if (backfilled > 0) console.log({ evt: 'bu-backfill', users: backfilled });
  } catch (error) {
    throw new StartupError(
      'migrate',
      `Backfill penugasan BU gagal: ${toDbError(error).message}`,
      error,
    );
  }
  return applied;
}

// Runner job dan penjadwal baru berjalan SETELAH persiapan basis data (migrasi + backfill) selesai.
const app = createServer(config, { prepare });

// Gagal cepat dan jelas bila basis data tidak terjangkau (dev: terowongan `bun run db:tunnel` belum jalan) atau
// sebuah migrasi gagal. Migrasi yang belum diterapkan dijalankan SEBELUM port dibuka (image Docker tidak butuh
// langkah migrasi terpisah).
try {
  const applied = await app.ready;
  if (applied.length > 0) console.log({ evt: 'migrate', applied });
} catch (error) {
  console.error(error instanceof StartupError ? error.message : String(error));
  await app.stop();
  process.exit(1);
}

const server = Bun.serve(bunServeOptions(app, { host: config.host, port: config.port }));
console.log({
  evt: 'start',
  url: `http://${config.host}:${server.port}`,
  trustedProxy: config.trustedProxyText,
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
