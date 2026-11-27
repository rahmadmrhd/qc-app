import { createDb } from '@server/core/db';
import { type DumpTarget, parseMysqlUrl } from './dump';
import { createMariadbImporter } from './restore';
import { VERIFY_IMPORT_TIMEOUT_MS, type VerifyPorts } from './verify';

/**
 * Pabrik koneksi pemulihan untuk `Env.BACKUP_VERIFY` dari `RESTORE_DATABASE_URL` (pengguna terbatas `qc_restore`:
 * hak hanya pada skema `qc_restore_%` dan SELECT pada skema aplikasi; tanpa nama basis data di URL). URL kosong atau
 * tak valid = verifikasi dinonaktifkan dengan satu baris log, TIDAK menggagalkan start (pola SMTP). Koneksi baru dibuat
 * per verifikasi dan ditutup sesudahnya agar tak ada koneksi menganggur sepanjang hari.
 */
export function createVerifyPortsFactory(
  restoreUrl: string,
): (() => Promise<VerifyPorts>) | undefined {
  if (restoreUrl.trim() === '') return undefined;
  let target: DumpTarget;
  try {
    target = parseMysqlUrl(restoreUrl.trim(), {
      name: 'RESTORE_DATABASE_URL',
      requireDatabase: false,
    });
  } catch (error) {
    console.warn(
      `verifikasi cadangan dinonaktifkan: ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
  const url = restoreUrl.trim();
  return async () => {
    const db = createDb({ url, connectionLimit: 2 });
    return {
      db,
      importSql: createMariadbImporter(target, { timeoutMs: VERIFY_IMPORT_TIMEOUT_MS }),
      close: () => db.close(),
    };
  };
}
