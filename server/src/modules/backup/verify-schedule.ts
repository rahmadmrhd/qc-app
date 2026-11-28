import type { Env } from '@server/core/env';
import { nowOf } from '@server/core/env';
import { getSetting } from '@server/core/settings';
import { findActiveJob } from '@server/modules/jobs/repo';
import { enqueueJob, JOB_SYSTEM_ACTOR } from '@server/modules/jobs/service';
import { isVerifyDue, readVerifyResult, SETTING_BACKUP_LAST_SUCCESS_NAME } from './verify-state';

/**
 * Verifikasi hanya berjalan bila cadangan terjadwal hidup (`BACKUP_ENABLED`: produksi dengan Google), folder lokal
 * ada, dan kredensial pemulihan terkonfigurasi (`RESTORE_DATABASE_URL` -> `Env.BACKUP_VERIFY`). Dev dan tes tidak
 * pernah memulihkan apa pun kecuali menyuntik `BACKUP_VERIFY` sendiri.
 */
export function verifyEnabled(env: Env): boolean {
  return (
    env.BACKUP_ENABLED === true &&
    env.BACKUP_VERIFY !== undefined &&
    env.BACKUP_LOCAL_DIR !== undefined &&
    env.BACKUP_LOCAL_DIR !== ''
  );
}

/**
 * Menyisipkan job `backup_verify` bila cadangan terakhir perlu diverifikasi (`isVerifyDue`) dan belum ada job
 * verifikasi yang aktif. Dua pemanggil: akhir job `db_backup` (verifikasi langsung SETELAH cadangan, bukan pada jam
 * tetap yang dapat mendahuluinya) dan penjadwal jam-an (mengejar ketinggalan setelah mati/restart, dan percobaan ulang
 * setelah `error`). Mengembalikan id job baru atau `null`.
 */
export async function scheduleBackupVerifyJob(env: Env): Promise<string | null> {
  if (!verifyEnabled(env)) return null;
  const lastName = await getSetting(env, SETTING_BACKUP_LAST_SUCCESS_NAME);
  if (!isVerifyDue(nowOf(env), lastName, await readVerifyResult(env))) return null;
  if (await findActiveJob(env, 'backup_verify')) return null;
  return enqueueJob(env, 'backup_verify', {}, JOB_SYSTEM_ACTOR);
}
