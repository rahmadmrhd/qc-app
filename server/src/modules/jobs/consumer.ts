import type { Env } from '@server/core/env';
import { nowIso, nowOf } from '@server/core/env';
import { isAppError } from '@server/core/errors';
import type { JobKind } from '@shared/contract';
import { backupHandler } from '../backup/service';
import { qrExportHandler } from '../qrcode/export';
import { serialAlertHandler } from '../serial/alert-job';
import { serialProofHandler } from '../serial/proof/job';
import { cleanupHandler } from './cleanup';
import type { JobRecord } from './repo';
import { claimStep, completeStep, failJob, findJob, releaseLease, saveState } from './repo';
import { sheetsExportHandler } from './sheets-job';

/** Percobaan maksimum per langkah untuk galat sementara (jaringan, jembatan) sebelum job ditandai gagal. */
export const JOB_MAX_ATTEMPTS = 3;
/** Penguasaan langkah oleh satu pengolah; lewat dari ini pengolah lain boleh mengambil alih. */
export const JOB_LEASE_MS = 90_000;
/** Jeda dasar sebelum langkah yang gagal sementara dicoba ulang; dikali nomor percobaan. */
export const JOB_RETRY_DELAY_SECONDS = 20;

export type JobState = Record<string, unknown>;

export interface StepContext {
  env: Env;
  job: JobRecord;
  /** Keadaan antar langkah (boleh diubah); simpan sebelum efek berikutnya lewat `save()`. */
  state: JobState;
  /** Menyimpan `state` segera (mis. sesudah membuat berkas Drive) agar pengulangan langkah idempoten. */
  save(): Promise<void>;
}

export interface StepOutcome {
  /** 0-99 selama berjalan. */
  progress: number;
  /** Ada = job selesai dengan hasil ini. */
  done?: { result: string };
}

export interface JobHandler {
  /** Menjalankan SATU langkah (`ctx.job.step`) dan harus idempoten terhadap pengulangan. */
  run(ctx: StepContext): Promise<StepOutcome>;
  /** Dipanggil sekali saat job ditandai gagal (pembersihan; boleh mengubah `ctx.state`). */
  onFail?(ctx: StepContext): Promise<void>;
}

function handlerOf(kind: JobKind): JobHandler {
  switch (kind) {
    case 'qr_export':
      return qrExportHandler;
    case 'sheets_export':
      return sheetsExportHandler;
    case 'cleanup_qr':
      return cleanupHandler;
    case 'db_backup':
      return backupHandler;
    case 'serial_alert':
      return serialAlertHandler;
    case 'serial_proof':
      return serialProofHandler;
  }
}

/**
 * Hasil satu langkah: `skipped` = tidak ada yang dikerjakan (job hilang/selesai atau langkah dipegang pengolah
 * lain); `advanced` = langkah tersimpan dan masih ada langkah berikutnya; `finished`/`failed` = job berakhir;
 * `retry` = galat sementara, lease dilepas dan pemanggil menunda sebelum mencoba lagi.
 */
export type StepResult =
  | { kind: 'skipped' }
  | { kind: 'advanced' }
  | { kind: 'finished' }
  | { kind: 'failed' }
  | { kind: 'retry'; delaySeconds: number };

function parseState(text: string): JobState {
  if (text === '') return {};
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as JobState)
      : {};
  } catch {
    return {};
  }
}

function isTransient(error: unknown): boolean {
  return !isAppError(error) || error.code === 'UNAVAILABLE';
}

/**
 * Menjalankan SATU langkah job. Kebenaran (langkah, status, keadaan) ada di baris `jobs`. Dua pemanggil
 * serentak tidak menjalankan langkah yang sama dua kali karena langkah dikuasai atomik (`claimStep`) dan
 * diselesaikan dengan CAS pada `step`. `attempts` = nomor percobaan langkah ini (dihitung pemanggil).
 */
export async function runJobStep(env: Env, jobId: string, attempts: number): Promise<StepResult> {
  const job = await findJob(env, jobId);
  if (!job || job.status === 'done' || job.status === 'failed') return { kind: 'skipped' };
  if (!(await claimStep(env, job, nowOf(env), JOB_LEASE_MS, nowIso(env)))) {
    return { kind: 'skipped' };
  }

  const handler = handlerOf(job.kind);
  const state = parseState(job.state);
  const ctx: StepContext = {
    env,
    job,
    state,
    save: () => saveState(env, job.id, state),
  };
  let outcome: StepOutcome;
  try {
    outcome = await handler.run(ctx);
  } catch (error) {
    if (isTransient(error) && attempts < JOB_MAX_ATTEMPTS) {
      console.error(
        `job ${job.id} (${job.kind}) langkah ${job.step} gagal sementara (percobaan ${attempts}): ${String(error)}`,
      );
      await releaseLease(env, job);
      return { kind: 'retry', delaySeconds: JOB_RETRY_DELAY_SECONDS * attempts };
    }
    const text = isAppError(error)
      ? error.message
      : 'Terjadi kesalahan pada server; coba ulangi dari awal';
    if (!isAppError(error)) console.error(`job ${job.id} gagal: ${String(error)}`);
    try {
      await handler.onFail?.(ctx);
    } catch (cleanupError) {
      console.error(`job ${job.id}: pembersihan setelah gagal juga gagal: ${String(cleanupError)}`);
    }
    await failJob(env, job, text, state, nowIso(env));
    return { kind: 'failed' };
  }
  const saved = await completeStep(
    env,
    job,
    { progress: outcome.progress, state, ...(outcome.done ? { done: outcome.done } : {}) },
    nowIso(env),
  );
  if (!saved) return { kind: 'skipped' };
  return outcome.done ? { kind: 'finished' } : { kind: 'advanced' };
}
