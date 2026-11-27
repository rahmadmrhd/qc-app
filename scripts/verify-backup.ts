/**
 * Uji pemulihan cadangan database secara manual (verifikasi cadangan). CLI tipis di atas
 * `server/src/modules/backup/verify.ts`: logikanya SAMA dengan job otomatis `backup_verify`.
 *
 * Dijalankan di dalam kontainer aplikasi (`RESTORE_DATABASE_URL`, klien `mariadb`, dan folder cadangan lokal ada):
 *   docker exec <kontainer-app> bun /app/scripts/verify-backup.ts [--file qc-backup-YYYYMMDD-HHmm.sql.gz] [--record]
 *
 * Memulihkan berkas cadangan LOKAL (bawaan: yang terakhir berhasil, lalu yang terbaru) ke skema sementara berawalan
 * `qc_restore_verify_`, membandingkannya dengan isi dump dan skema hidup, lalu membuang skema sementara. Beban:
 * mengimpor seluruh basis data (menit dan memori/disk DB), jalankan di luar jam sibuk. `--record` menyimpan hasilnya
 * seperti job otomatis (menggeser peringatan "cadangan belum diverifikasi"). Kode keluar: 0 lolos, 1 gagal atau tak
 * dapat diselesaikan, 2 salah pakai atau verifikasi belum dikonfigurasi.
 */
import { loadConfig } from '../server/src/config';
import { createDb } from '../server/src/core/db';
import { getSetting } from '../server/src/core/settings';
import { runBackupVerification } from '../server/src/modules/backup/verify';
import {
  recordVerification,
  SETTING_BACKUP_LAST_SUCCESS_NAME,
} from '../server/src/modules/backup/verify-state';
import { envFromConfig } from '../server/src/server';

const USAGE = `Uji pemulihan cadangan database ke skema sementara.
  bun scripts/verify-backup.ts [--file <nama-berkas>] [--record]
    --file    nama berkas cadangan lokal (bawaan: cadangan terakhir yang berhasil, lalu yang terbaru)
    --record  simpan hasil seperti job otomatis (menggeser peringatan "cadangan belum diverifikasi")
  Butuh RESTORE_DATABASE_URL (pengguna terbatas qc_restore; docs/setup-google.md S8).`;

function parseArgs(argv: string[]): { file?: string; record: boolean } | null {
  let file: string | undefined;
  let record = false;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index] as string;
    if (arg === '--record') record = true;
    else if (arg === '--file') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) return null;
      file = value;
      index += 1;
    } else return null;
  }
  return { ...(file === undefined ? {} : { file }), record };
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) {
    console.error(USAGE);
    return 2;
  }
  const config = loadConfig(process.env);
  const db = createDb({ url: config.databaseUrl, connectionLimit: 2 });
  try {
    const env = envFromConfig(config, db);
    if (env.BACKUP_VERIFY === undefined) {
      console.error(
        'RESTORE_DATABASE_URL kosong atau tidak valid (di .env server isi QC_RESTORE_DB_PASSWORD, lalu docker compose up -d); verifikasi tidak dapat berjalan.',
      );
      return 2;
    }
    const lastName = await getSetting(env, SETTING_BACKUP_LAST_SUCCESS_NAME);
    const name = args.file ?? lastName;
    const ports = await env.BACKUP_VERIFY();
    let result: Awaited<ReturnType<typeof runBackupVerification>>;
    try {
      result = await runBackupVerification(env, ports, {
        localDir: config.backupLocalDir,
        ...(name === '' ? {} : { name }),
      });
    } finally {
      await ports.close().catch(() => {});
    }
    console.log(`Cadangan: ${result.name || '(tidak terpilih)'} (${result.bytes} byte)`);
    console.log(`Hasil: ${result.status.toUpperCase()} - ${result.summary}`);
    console.log(
      `Tabel: ${result.tables}, baris: ${result.rows}, durasi: ${Math.round(result.durationMs / 1000)} dtk`,
    );
    for (const line of result.failures) console.log(`  GAGAL: ${line}`);
    for (const line of result.notes) console.log(`  Catatan: ${line}`);
    if (args.record) {
      await recordVerification(env, result, lastName);
      console.log('Hasil dicatat.');
    }
    return result.status === 'ok' ? 0 : 1;
  } catch (error) {
    console.error(`Verifikasi gagal: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  } finally {
    await db.close();
  }
}

process.exit(await main());
