/**
 * Pemulihan cadangan dari Drive ke skema BARU (T31). CLI tipis di atas `server/src/modules/backup/restore.ts`.
 *
 * Dijalankan di dalam kontainer aplikasi (lingkungan, klien Google, dan `mariadb` sudah ada):
 *   docker exec [-e RESTORE_DATABASE_URL] <kontainer-app> bun /app/scripts/restore-backup.ts --target qc_restore_check --compare-with <skema-aplikasi> --drop-after
 * (kata sandi admin DB: `-e RESTORE_DATABASE_URL` TANPA nilai, diambil dari lingkungan pemanggil; lihat docs/setup-google.md S8)
 *
 * Verifikasi (MD5 Drive, SHA-256, gunzip penuh, baris penutup dump) selesai SEBELUM skema dibuat; hasil yang gagal
 * tidak mengimpor apa pun. Kode keluar: 0 berhasil (dan jumlah baris sama bila `--compare-with`), 1 gagal atau
 * jumlah baris beda, 2 salah pakai. Rincian: docs/setup-google.md (bagian Cadangan dan pemulihan).
 */
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig } from '../server/src/config';
import { createDb } from '../server/src/core/db';
import { getSetting } from '../server/src/core/settings';
import { parseDatabaseUrl } from '../server/src/modules/backup/dump';
import {
  createMariadbImporter,
  createRestoreDb,
  parseRestoreArgs,
  purgeStaleRestoreDirs,
  RESTORE_USAGE,
  RestoreError,
  resolveBackupFolderId,
  restoreBackup,
} from '../server/src/modules/backup/restore';
import { BACKUP_FOLDER_SETTING } from '../server/src/modules/backup/upload';
import { envFromConfig } from '../server/src/server';

async function main(): Promise<number> {
  const args = parseRestoreArgs(process.argv.slice(2));
  if (args === null) {
    console.error(RESTORE_USAGE);
    return 2;
  }
  const config = loadConfig(process.env);
  // Hak CREATE/DROP DATABASE: pengguna aplikasi biasanya hanya berhak atas skemanya sendiri.
  const adminUrl = process.env.RESTORE_DATABASE_URL?.trim() || config.databaseUrl;
  const db = createDb({ url: adminUrl, connectionLimit: 2 });
  // Hanya `Env` (klien Google bercache token) dari konfigurasi; tanpa penjadwal/penyaji.
  const env = envFromConfig(config, db);
  const workRoot = join(config.backupLocalDir, 'restore-tmp');
  try {
    // Sumber id folder: --folder-id, BACKUP_FOLDER_ID, lalu settings SKEMA APLIKASI (koneksi DATABASE_URL, bukan
    // URL admin yang berskema lain). Dibaca SEBELUM folder kerja dibuat.
    const folderId = await resolveBackupFolderId({
      ...(args.folderId === undefined ? {} : { flag: args.folderId }),
      configured: config.backupFolderId,
      readSetting: async () => {
        const appDb = createDb({ url: config.databaseUrl, connectionLimit: 1 });
        try {
          return await getSetting({ ...env, DB: appDb }, BACKUP_FOLDER_SETTING);
        } finally {
          await appDb.close();
        }
      },
    });
    await mkdir(workRoot, { recursive: true, mode: 0o700 });
    // Sisa proses yang terbunuh (berisi SQL seluruh basis data) dibuang saat mulai.
    await purgeStaleRestoreDirs(workRoot);
    const workDir = await mkdtemp(join(workRoot, 'job-'));
    try {
      const target = parseDatabaseUrl(adminUrl);
      const report = await restoreBackup(
        {
          bridge: env.BRIDGE as NonNullable<typeof env.BRIDGE>,
          folderId,
          workDir,
          db: createRestoreDb(db),
          importSql: createMariadbImporter(target),
          protectedSchemas: [parseDatabaseUrl(config.databaseUrl).database],
          announce: (backup) =>
            console.log(
              `Memulihkan cadangan ${backup.name} (tanggal ${backup.date}, ${backup.size} byte, id ${backup.driveId}) ke ${args.targetSchema}`,
            ),
        },
        args,
      );
      console.log(`Cadangan: ${report.name} (${report.size} byte, md5 ${report.md5})`);
      console.log(`Skema: ${report.schema}${report.dropped ? ' (sudah dihapus)' : ''}`);
      for (const row of report.tables) {
        const source =
          row.source === undefined
            ? ''
            : `  sumber=${row.source === null ? '(tidak ada)' : row.source}`;
        console.log(`  ${row.table}: ${row.restored}${source}`);
      }
      if (report.matched === undefined) return 0;
      console.log(report.matched ? 'Jumlah baris SAMA di semua tabel.' : 'Jumlah baris BERBEDA.');
      return report.matched ? 0 : 1;
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  } catch (error) {
    // RestoreError aman (tanpa rahasia); galat lain hanya pesannya (kata sandi tak pernah di pesan klien).
    console.error(
      error instanceof RestoreError
        ? error.message
        : `Pemulihan gagal: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  } finally {
    await db.close();
  }
}

process.exit(await main());
