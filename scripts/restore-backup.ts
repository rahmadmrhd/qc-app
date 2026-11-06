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
import { parseDatabaseUrl } from '../server/src/modules/backup/dump';
import {
  createMariadbImporter,
  createRestoreDb,
  parseRestoreArgs,
  RESTORE_USAGE,
  RestoreError,
  restoreBackup,
} from '../server/src/modules/backup/restore';
import { backupFolderIdOf } from '../server/src/modules/backup/upload';
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
    await mkdir(workRoot, { recursive: true });
    const workDir = await mkdtemp(join(workRoot, 'job-'));
    try {
      const folderId = await backupFolderIdOf(env);
      if (folderId === '') {
        console.error(
          'Folder cadangan belum dikonfigurasi (BACKUP_FOLDER_ID) dan belum pernah dibuat.',
        );
        return 1;
      }
      const target = parseDatabaseUrl(adminUrl);
      const report = await restoreBackup(
        {
          bridge: env.BRIDGE as NonNullable<typeof env.BRIDGE>,
          folderId,
          workDir,
          db: createRestoreDb(db),
          importSql: createMariadbImporter(target),
          protectedSchemas: [parseDatabaseUrl(config.databaseUrl).database],
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
