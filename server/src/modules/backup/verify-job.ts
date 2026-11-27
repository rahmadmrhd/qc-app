import { appError } from '@server/core/errors';
import { getSetting } from '@server/core/settings';
import type { JobHandler, StepOutcome } from '@server/modules/jobs/consumer';
import { runBackupVerification } from './verify';
import { checkBackupVerifyAlerts } from './verify-alert';
import { verifyEnabled } from './verify-schedule';
import { recordVerification, SETTING_BACKUP_LAST_SUCCESS_NAME } from './verify-state';

/**
 * Job `backup_verify` (satu langkah): uji pemulihan penuh cadangan terakhir ke skema sementara
 * (`runBackupVerification`), simpan hasilnya di `settings`, lalu periksa peringatan seketika.
 *
 * Hasil verifikasi yang buruk (`failed`/`error`) adalah HASIL, bukan kegagalan job: dicatat dan job selesai normal.
 * Kalau tidak, runner (`isTransient`) akan mengulang langkah yang sama sampai 3 kali = tiga impor penuh pada basis data
 * produksi yang memorinya terbatas. Percobaan ulang atas `error` diatur penjadwal (`isVerifyDue`: jeda dan batas).
 * Hanya galat tak terduga di luar verifikasi (mis. tabel `settings` tak dapat ditulis) yang menggagalkan job.
 *
 * Trade-off yang diterima: runner menjalankan satu job pada satu waktu, jadi impor berdurasi menit menahan `qr_export`
 * dan `serial_proof` selama itu (cadangan memakai jalur yang sama). Verifikasi berjalan tepat sesudah cadangan malam.
 */
export const backupVerifyHandler: JobHandler = {
  async run(ctx): Promise<StepOutcome> {
    const { env } = ctx;
    if (
      !verifyEnabled(env) ||
      env.BACKUP_VERIFY === undefined ||
      env.BACKUP_LOCAL_DIR === undefined
    ) {
      throw appError('INTERNAL', 'Verifikasi cadangan belum dikonfigurasi');
    }
    const lastName = await getSetting(env, SETTING_BACKUP_LAST_SUCCESS_NAME);
    const ports = await env.BACKUP_VERIFY();
    let result: Awaited<ReturnType<typeof runBackupVerification>>;
    try {
      result = await runBackupVerification(env, ports, {
        localDir: env.BACKUP_LOCAL_DIR,
        ...(lastName === '' ? {} : { name: lastName }),
      });
    } finally {
      await ports.close().catch(() => {});
    }
    const { name, attempts } = await recordVerification(env, result, lastName);
    const line = `verifikasi cadangan ${name}: ${result.status} (${Math.round(result.durationMs / 1000)} dtk, percobaan ${attempts}): ${result.summary}`;
    if (result.status === 'ok') console.log(line);
    else console.error(line);
    try {
      await checkBackupVerifyAlerts(env);
    } catch (error) {
      console.error(`verifikasi cadangan: peringatan gagal diperiksa: ${String(error)}`);
    }
    return {
      progress: 100,
      done: { result: JSON.stringify({ name, status: result.status, summary: result.summary }) },
    };
  },
};
