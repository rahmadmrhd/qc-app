import type { Env } from '@server/core/env';
import { nowOf } from '@server/core/env';
import { getSetting } from '@server/core/settings';
import { type AlertState, sendThrottled } from './alert';
import { parseBackupName } from './names';
import {
  readVerifyResult,
  SETTING_BACKUP_LAST_SUCCESS_NAME,
  VERIFY_MAX_ATTEMPTS,
  VERIFY_MISSING_AFTER_MS,
} from './verify-state';

/** Waktu peringatan terakhir yang terkirim (epoch ms, teks); satu kunci per jenis, dibatasi `ALERT_MIN_INTERVAL_MS`. */
export const SETTING_VERIFY_FAILED_ALERT_AT = 'BACKUP_VERIFY_FAILED_ALERT_LAST_AT';
export const SETTING_VERIFY_MISSING_ALERT_AT = 'BACKUP_VERIFY_MISSING_ALERT_LAST_AT';

export interface VerifyAlertOutcome {
  /** Verifikasi gagal atau tak dapat diselesaikan setelah semua percobaan. */
  failed: AlertState;
  /** Cadangan sudah lama berhasil tetapi belum ada hasil verifikasinya. */
  missing: AlertState;
}

let warnedUnconfigured = false;

function hoursText(ms: number): string {
  return `${Math.floor(ms / (60 * 60 * 1000))} jam`;
}

/**
 * Peringatan email verifikasi cadangan, dipanggil penjadwal jam-an DAN seketika setelah job verifikasi mencatat
 * hasilnya. Dua jenis, masing-masing paling banyak sekali per 12 jam (waktu terakhir yang BERHASIL terkirim):
 * - `failed`: hasil untuk cadangan terakhir `failed`, atau `error` dengan semua percobaan habis.
 * - `missing`: cadangan terakhir berhasil lebih dari 12 jam lalu tetapi tidak ada hasil (mis. `RESTORE_DATABASE_URL`
 *   belum diisi, job tak pernah berjalan, atau masih `error` menunggu percobaan ulang).
 * Hanya bila cadangan diaktifkan dan SMTP/penerima ada (seperti `checkBackupAlerts`). Gagal kirim tidak dilempar.
 */
export async function checkBackupVerifyAlerts(env: Env): Promise<VerifyAlertOutcome> {
  const outcome: VerifyAlertOutcome = { failed: 'skipped', missing: 'skipped' };
  if (env.BACKUP_ENABLED !== true) return outcome;
  if (env.MAILER === undefined || (env.ALERT_TO ?? []).length === 0) {
    if (!warnedUnconfigured) {
      warnedUnconfigured = true;
      console.warn(
        'peringatan verifikasi cadangan dinonaktifkan: SMTP_HOST/SMTP_FROM atau ALERT_TO belum dikonfigurasi di .env',
      );
    }
    return outcome;
  }
  const lastName = await getSetting(env, SETTING_BACKUP_LAST_SUCCESS_NAME);
  const parsed = lastName === '' ? null : parseBackupName(lastName);
  if (parsed === null) return { failed: 'ok', missing: 'ok' };
  const now = nowOf(env);
  const stored = await readVerifyResult(env);
  const current = stored !== null && stored.name === lastName ? stored : null;

  const finalBad =
    current !== null &&
    (current.status === 'failed' ||
      (current.status === 'error' && current.attempts >= VERIFY_MAX_ATTEMPTS));
  if (finalBad && current !== null) {
    const lines = [
      current.status === 'failed'
        ? `Uji pemulihan cadangan ${lastName} GAGAL: cadangan itu tidak terbukti dapat dipulihkan.`
        : `Uji pemulihan cadangan ${lastName} tidak dapat diselesaikan setelah ${current.attempts} percobaan.`,
      '',
      current.summary,
      ...(current.failures.length > 0
        ? ['', 'Rincian:', ...current.failures.map((line) => `- ${line}`)]
        : []),
      '',
      'Cadangan itu masih tersimpan (lokal dan Drive), tetapi belum terbukti utuh. Periksa log server (verifikasi cadangan), lalu jalankan uji manual: docker exec <kontainer-app> bun /app/scripts/verify-backup.ts (docs/setup-google.md S8).',
    ];
    outcome.failed = await sendThrottled(env, SETTING_VERIFY_FAILED_ALERT_AT, {
      subject: '[QC App] Peringatan: uji pemulihan cadangan database gagal',
      text: lines.join('\n'),
    });
  } else {
    outcome.failed = 'ok';
  }

  const missing = !finalBad && (current === null || current.status === 'error');
  if (missing && now - parsed.epochMs > VERIFY_MISSING_AFTER_MS) {
    const reason =
      env.BACKUP_VERIFY === undefined
        ? 'Uji pemulihan belum dikonfigurasi: RESTORE_DATABASE_URL di .env server kosong atau tidak valid.'
        : current === null
          ? 'Tidak ada hasil verifikasi untuk cadangan ini (job tidak berjalan atau belum selesai).'
          : `Percobaan terakhir belum berhasil: ${current.summary}`;
    outcome.missing = await sendThrottled(env, SETTING_VERIFY_MISSING_ALERT_AT, {
      subject: '[QC App] Peringatan: cadangan database belum diverifikasi',
      text: `Cadangan ${lastName} berhasil dibuat ${hoursText(now - parsed.epochMs)} lalu tetapi belum lolos uji pemulihan.\n\n${reason}\n\nSelama itu keutuhan cadangan belum terbukti. Lihat docs/setup-google.md S8 (verifikasi cadangan otomatis).`,
    });
  } else {
    outcome.missing = 'ok';
  }
  return outcome;
}
