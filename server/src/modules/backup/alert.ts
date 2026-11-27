import { getBridge, viaBridge } from '@server/core/bridge-client';
import type { Env } from '@server/core/env';
import { nowOf } from '@server/core/env';
import { getSetting, putSetting } from '@server/core/settings';
import { parseBackupName, wibDateEpoch } from './names';
import { SETTING_BACKUP_LAST_SUCCESS } from './service';
import { backupFolderIdOf, listAllEntries, recognizedBackups } from './upload';

/** Cadangan terbaru lebih tua dari ini = basi (peringatan). */
export const BACKUP_STALE_MS = 36 * 60 * 60 * 1000;
/** Peringatan yang sama tidak dikirim lagi sebelum selang ini lewat sejak yang terakhir BERHASIL terkirim. */
export const ALERT_MIN_INTERVAL_MS = 12 * 60 * 60 * 1000;
/** Waktu peringatan terakhir yang terkirim (epoch ms, teks) di tabel `settings`; satu kunci per jenis peringatan. */
export const SETTING_BACKUP_ALERT_AT = 'BACKUP_ALERT_LAST_AT';
export const SETTING_QUOTA_ALERT_AT = 'QUOTA_ALERT_LAST_AT';
/** Ambang kuota bawaan (persen) bila `Env` tak mengaturnya. */
export const DEFAULT_QUOTA_ALERT_PERCENT = 80;

export type AlertState = 'ok' | 'sent' | 'throttled' | 'failed' | 'skipped';

export interface AlertOutcome {
  backup: AlertState;
  quota: AlertState;
}

let warnedUnconfigured = false;

const GIB = 1024 ** 3;
const gib = (bytes: number) => (bytes / GIB).toFixed(2);

function describeAge(ms: number): string {
  const hours = Math.floor(ms / (60 * 60 * 1000));
  return hours >= 48 ? `${Math.floor(hours / 24)} hari` : `${hours} jam`;
}

/** Mengirim satu peringatan bila selang minimum sejak yang terakhir terkirim sudah lewat; kegagalan kirim tidak dilempar. */
export async function sendThrottled(
  env: Env,
  settingKey: string,
  message: { subject: string; text: string },
): Promise<AlertState> {
  const now = nowOf(env);
  const last = Number(await getSetting(env, settingKey)) || 0;
  if (now - last < ALERT_MIN_INTERVAL_MS) return 'throttled';
  try {
    await (env.MAILER as NonNullable<Env['MAILER']>).send({
      to: env.ALERT_TO ?? [],
      subject: message.subject,
      text: message.text,
    });
  } catch (error) {
    // Pesan galat dari `createSmtpMailer` sudah bebas SMTP_PASS. Dicoba lagi pada pemeriksaan jam-an berikutnya.
    console.error(
      `peringatan: email "${message.subject}" gagal terkirim, dicoba lagi nanti: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 'failed';
  }
  await putSetting(env, settingKey, String(now));
  return 'sent';
}

/**
 * Cadangan terbaru menurut daftar folder Drive. Bila Drive tak dapat dibaca (kunci dicabut/dirotasi, folder tak lagi
 * dibagikan: justru saat cadangan paling mungkin berhenti), dipakai catatan `BACKUP_LAST_SUCCESS_DATE` dari
 * `service.ts` (tanggal WIB cadangan terakhir yang terverifikasi, ditaksir pukul 02:00) agar peringatan tidak diam.
 */
async function newestBackup(
  env: Env,
): Promise<{ ms: number | null; name?: string; driveError?: string }> {
  const folderId = await backupFolderIdOf(env);
  if (folderId === '') return { ms: null };
  try {
    const newest = recognizedBackups(await listAllEntries(env, folderId))[0];
    if (newest === undefined) return { ms: null };
    return { ms: parseBackupName(newest.name)?.epochMs ?? null, name: newest.name };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(
      `peringatan: daftar folder cadangan Drive gagal dibaca, memakai catatan lokal: ${reason}`,
    );
    const lastDate = await getSetting(env, SETTING_BACKUP_LAST_SUCCESS);
    return {
      ms: /^\d{8}$/.test(lastDate) ? wibDateEpoch(lastDate) : null,
      driveError: reason,
    };
  }
}

async function checkBackup(env: Env): Promise<AlertState> {
  const now = nowOf(env);
  const newest = await newestBackup(env);
  if (newest.ms !== null && now - newest.ms <= BACKUP_STALE_MS) return 'ok';
  let detail: string;
  if (newest.driveError !== undefined) {
    detail =
      newest.ms === null
        ? 'Folder cadangan Drive tidak dapat diperiksa dan tidak ada catatan cadangan berhasil.'
        : `Folder cadangan Drive tidak dapat diperiksa; cadangan terakhir yang tercatat berhasil sekitar ${describeAge(now - newest.ms)} lalu.`;
    detail += ` Penyebab: ${newest.driveError}`;
  } else if (newest.ms === null || newest.name === undefined) {
    detail = 'Belum ada satu pun cadangan di folder cadangan Drive.';
  } else {
    detail = `Cadangan terbaru: ${newest.name} (${describeAge(now - newest.ms)} lalu).`;
  }
  return sendThrottled(env, SETTING_BACKUP_ALERT_AT, {
    subject: '[QC App] Peringatan: cadangan database basi',
    text: `${detail}\n\nCadangan harian seharusnya berjalan tiap malam (02:00 WIB). Periksa log server (job db_backup), akses service account ke folder cadangan (kunci dicabut atau folder tak lagi dibagikan), dan ruang Drive.`,
  });
}

async function checkQuota(env: Env): Promise<AlertState> {
  let quota: Awaited<ReturnType<ReturnType<typeof getBridge>['storageQuota']>>;
  try {
    quota = await viaBridge(() => getBridge(env).storageQuota());
  } catch (error) {
    // Kuota yang gagal diperiksa tidak melempar (peringatan cadangan di atas sudah menangani Drive yang tak terjangkau).
    console.error(
      `peringatan: kuota Drive gagal diperiksa: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 'skipped';
  }
  if (quota.limit === null || quota.limit <= 0) return 'ok';
  const threshold = env.QUOTA_ALERT_PERCENT ?? DEFAULT_QUOTA_ALERT_PERCENT;
  const percent = (quota.usage / quota.limit) * 100;
  if (percent <= threshold) return 'ok';
  return sendThrottled(env, SETTING_QUOTA_ALERT_AT, {
    subject: '[QC App] Peringatan: kuota Google Drive hampir penuh',
    text: `Pemakaian Drive service account ${gib(quota.usage)} GB dari ${gib(quota.limit)} GB (${percent.toFixed(1)}%), melewati ambang ${threshold}%.\n\nKuota dipakai bersama gambar item, PDF QR, ekspor, dan cadangan. Hapus berkas yang tak dipakai atau kurangi retensi sebelum penuh.`,
  });
}

/**
 * Pemeriksaan jam-an: peringatan email bila cadangan terbaru > 36 jam (atau belum ada) dan bila pemakaian kuota Drive
 * melewati ambang. Tiap jenis dibatasi satu email per 12 jam (waktu terakhir YANG TERKIRIM di `settings`). Tidak
 * melakukan apa pun bila cadangan tidak diaktifkan atau SMTP/penerima belum dikonfigurasi (dicatat sekali). Gagal kirim
 * email tidak dilempar (dicatat, dicoba lagi pada pemeriksaan berikutnya). Drive yang tak terbaca tidak membuat
 * peringatan diam: usia dihitung dari catatan lokal cadangan terakhir yang berhasil; kuota yang gagal diperiksa dilewati.
 */
export async function checkBackupAlerts(env: Env): Promise<AlertOutcome> {
  const outcome: AlertOutcome = { backup: 'skipped', quota: 'skipped' };
  if (env.BACKUP_ENABLED !== true) return outcome;
  if (env.MAILER === undefined || (env.ALERT_TO ?? []).length === 0) {
    if (!warnedUnconfigured) {
      warnedUnconfigured = true;
      console.warn(
        'peringatan cadangan dinonaktifkan: SMTP_HOST/SMTP_FROM atau ALERT_TO belum dikonfigurasi (atau tidak valid) di .env',
      );
    }
    return outcome;
  }
  const failures: unknown[] = [];
  try {
    outcome.backup = await checkBackup(env);
  } catch (error) {
    failures.push(error);
  }
  try {
    outcome.quota = await checkQuota(env);
  } catch (error) {
    failures.push(error);
  }
  if (failures.length > 0) throw failures[0];
  return outcome;
}
