import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { getBridge, viaBridge } from '@server/core/bridge-client';
import type { Env } from '@server/core/env';
import { nowOf } from '@server/core/env';
import { appError } from '@server/core/errors';
import { redactSecrets } from '@server/core/redact';
import { getSetting, putSetting } from '@server/core/settings';
import type { JobHandler, StepOutcome } from '@server/modules/jobs/consumer';
import { findActiveJob } from '@server/modules/jobs/repo';
import { enqueueJob, JOB_SYSTEM_ACTOR } from '@server/modules/jobs/service';
import { ensureLocalDir, fileDigest, LOCAL_BACKUP_KEEP, pruneLocalDumps } from './dump';
import { backupName, parseBackupName, wibDate, wibHour } from './names';
import { selectBackupsToDelete } from './retention';
import { ensureBackupFolder, listAllEntries, uploadVerified } from './upload';
import { scheduleBackupVerifyJob } from './verify-schedule';
import { SETTING_BACKUP_LAST_SUCCESS_NAME } from './verify-state';

/** Jam WIB paling awal cadangan harian dijadwalkan. */
export const BACKUP_START_HOUR_WIB = 2;
/** Tanggal WIB (`YYYYMMDD`) cadangan terakhir yang BERHASIL (terunggah dan terverifikasi). */
export const SETTING_BACKUP_LAST_SUCCESS = 'BACKUP_LAST_SUCCESS_DATE';

/**
 * Apakah cadangan hari ini jatuh tempo (fungsi murni): sudah lewat 02:00 WIB dan belum ada yang berhasil pada
 * tanggal WIB hari ini. Detak penjadwal tidak selaras jam, jadi ini juga mengejar ketinggalan setelah mati lama
 * dan mencoba lagi (tiap detak) bila percobaan sebelumnya gagal; tak pernah dua kali sukses dalam sehari.
 */
export function isBackupDue(nowMs: number, lastSuccessDate: string): boolean {
  return wibHour(nowMs) >= BACKUP_START_HOUR_WIB && lastSuccessDate !== wibDate(nowMs);
}

/**
 * Menjadwalkan job cadangan bila jatuh tempo dan belum ada yang aktif. Tidak melakukan apa pun bila cadangan tidak
 * diaktifkan (`BACKUP_ENABLED`; dev dan tes). Mengembalikan id job baru atau `null`.
 */
export async function scheduleBackupJob(env: Env): Promise<string | null> {
  if (env.BACKUP_ENABLED !== true) return null;
  if (!isBackupDue(nowOf(env), await getSetting(env, SETTING_BACKUP_LAST_SUCCESS))) return null;
  if (await findActiveJob(env, 'db_backup')) return null;
  return enqueueJob(env, 'db_backup', {}, JOB_SYSTEM_ACTOR);
}

interface BackupState {
  /** Nama berkas (ditetapkan sekali saat langkah dump agar pengulangan memakai nama yang sama). */
  name?: string;
  md5?: string;
  sha256?: string;
  size?: number;
  driveId?: string;
  /** Berkas Drive cacat yang belum berhasil dibuang. */
  badDriveId?: string;
}

function requireBackupSetup(env: Env): { dir: string; dump: NonNullable<Env['BACKUP_DUMP']> } {
  if (!env.BACKUP_LOCAL_DIR || !env.BACKUP_DUMP) {
    throw appError('INTERNAL', 'Cadangan belum dikonfigurasi (folder lokal atau pembangkit dump)');
  }
  return { dir: env.BACKUP_LOCAL_DIR, dump: env.BACKUP_DUMP };
}

function need<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw appError('INTERNAL', `Keadaan job cadangan rusak: ${what}`);
  return value;
}

/** Langkah 0: dump basis data ke berkas lokal (gzip) lalu hitung MD5/SHA-256/ukuran. */
async function dumpStep(ctx: Parameters<JobHandler['run']>[0]): Promise<StepOutcome> {
  const { env } = ctx;
  const state = ctx.state as BackupState;
  const { dir, dump } = requireBackupSetup(env);
  await ensureLocalDir(dir);
  state.name ??= backupName(nowOf(env));
  const path = join(dir, state.name);
  const exists = await stat(path).then(
    (info) => info.isFile(),
    () => false,
  );
  if (!exists) await dump(path);
  const digest = await fileDigest(path);
  if (digest.size === 0) throw appError('INTERNAL', 'Dump cadangan kosong');
  state.md5 = digest.md5;
  state.sha256 = digest.sha256;
  state.size = digest.size;
  return { progress: 30 };
}

/** Langkah 1: unggah ke Drive dan verifikasi MD5/ukuran; baru setelah itu cadangan hari ini dianggap berhasil. */
async function uploadStep(ctx: Parameters<JobHandler['run']>[0]): Promise<StepOutcome> {
  const { env } = ctx;
  const state = ctx.state as BackupState;
  const { dir } = requireBackupSetup(env);
  const name = need(state.name, 'nama');
  const folderId = await ensureBackupFolder(env);
  state.driveId = await uploadVerified(
    env,
    folderId,
    {
      name,
      path: join(dir, name),
      md5: need(state.md5, 'md5'),
      sha256: need(state.sha256, 'sha256'),
      size: need(state.size, 'ukuran'),
    },
    {
      async mark(driveId) {
        state.badDriveId = driveId;
        await ctx.save();
      },
      clear() {
        delete state.badDriveId;
      },
    },
  );
  // Tanggal dari NAMA berkas (saat dump dimulai), bukan jam unggah selesai: dump yang mulai 23:xx dan selesai lewat
  // tengah malam tidak boleh menandai hari berikutnya sebagai sudah dicadangkan.
  await putSetting(
    env,
    SETTING_BACKUP_LAST_SUCCESS,
    parseBackupName(name)?.date ?? wibDate(nowOf(env)),
  );
  // Nama berkas yang berhasil: dasar penjadwalan dan peringatan verifikasi (`verify-schedule.ts`, `verify-alert.ts`).
  await putSetting(env, SETTING_BACKUP_LAST_SUCCESS_NAME, name);
  return { progress: 70 };
}

/** Langkah 2: retensi di Drive dan di folder lokal. Kegagalan di sini dicatat saja (cadangan sudah aman). */
async function retentionStep(ctx: Parameters<JobHandler['run']>[0]): Promise<StepOutcome> {
  const { env } = ctx;
  const state = ctx.state as BackupState;
  const { dir } = requireBackupSetup(env);
  let deleted = 0;
  let retentionError = '';
  try {
    const folderId = await ensureBackupFolder(env);
    const bridge = getBridge(env);
    const doomed = selectBackupsToDelete(await listAllEntries(env, folderId)).filter(
      (entry) => entry.name !== state.name,
    );
    for (const entry of doomed) {
      await viaBridge(() => bridge.deleteFile(entry.id));
      deleted += 1;
    }
  } catch (error) {
    retentionError = redactSecrets(error instanceof Error ? error.message : String(error));
    console.error(`cadangan: retensi Drive gagal: ${retentionError}`);
  }
  try {
    await pruneLocalDumps(dir, LOCAL_BACKUP_KEEP);
  } catch (error) {
    console.error(`cadangan: pembersihan folder lokal gagal: ${String(error)}`);
  }
  // Uji pemulihan langsung sesudah cadangan (bukan pada jam tetap yang dapat mendahuluinya). Kegagalan menyisipkan job
  // tidak menggagalkan cadangan yang sudah aman; penjadwal jam-an mengejarnya.
  try {
    await scheduleBackupVerifyJob(env);
  } catch (error) {
    console.error(`cadangan: verifikasi gagal dijadwalkan: ${String(error)}`);
  }
  return {
    progress: 100,
    done: {
      result: JSON.stringify({
        name: state.name,
        driveId: state.driveId,
        size: state.size,
        deleted,
        ...(retentionError === '' ? {} : { retentionError }),
      }),
    },
  };
}

/**
 * Cadangan harian: dump (`mariadb-dump` -> gzip, satu berkas `qc-backup-YYYYMMDD-HHmm.sql.gz`), unggah resumable ke
 * folder cadangan dengan verifikasi MD5, lalu retensi (7 harian + 4 mingguan di Drive, 3 salinan lokal). Tiap
 * langkah idempoten. Dump lokal tidak dibuang bila unggahan gagal (job `failed` dapat diulang pada detak berikutnya).
 */
export const backupHandler: JobHandler = {
  async run(ctx): Promise<StepOutcome> {
    switch (ctx.job.step) {
      case 0:
        return dumpStep(ctx);
      case 1:
        return uploadStep(ctx);
      default:
        return retentionStep(ctx);
    }
  },
  async onFail(ctx) {
    const state = ctx.state as BackupState;
    if (state.badDriveId === undefined) return;
    await viaBridge(() => getBridge(ctx.env).deleteFile(state.badDriveId as string));
    delete state.badDriveId;
  },
};
