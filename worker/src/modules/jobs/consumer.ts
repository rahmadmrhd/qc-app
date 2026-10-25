import type { JobKind } from '@shared/rpc';
import type { Env, JobMessage } from '@worker/core/env';
import { nowIso, nowOf } from '@worker/core/env';
import { isAppError } from '@worker/core/errors';
import { qrExportHandler } from '../qrcode/export';
import { cleanupHandler } from './cleanup';
import type { JobRecord } from './repo';
import { claimStep, completeStep, failJob, findJob, releaseLease, saveState } from './repo';
import { sheetsExportHandler } from './sheets-job';

/** Percobaan maksimum per langkah untuk galat sementara (jaringan, jembatan) sebelum job ditandai gagal. */
export const JOB_MAX_ATTEMPTS = 3;
/** Penguasaan langkah oleh satu pengolah; lewat dari ini pengolah lain boleh mengambil alih. */
export const JOB_LEASE_MS = 90_000;
const RETRY_DELAY_SECONDS = 20;

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
  }
}

export type MessageOutcome = { kind: 'ack' } | { kind: 'retry'; delaySeconds: number };

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
 * Memproses SATU pesan = SATU langkah job. Pesan hanya membangunkan job; kebenaran (langkah, status, keadaan)
 * ada di baris `jobs`. Pesan ganda / terkirim ulang (at-least-once) tidak menjalankan langkah dua kali karena
 * langkah dikuasai atomik (`claimStep`) dan diselesaikan dengan CAS pada `step`.
 */
export async function processJobMessage(
  env: Env,
  message: JobMessage,
  attempts: number,
): Promise<MessageOutcome> {
  const job = await findJob(env, message.jobId);
  if (!job || job.status === 'done' || job.status === 'failed') return { kind: 'ack' };
  if (!(await claimStep(env, job, nowOf(env), JOB_LEASE_MS, nowIso(env)))) return { kind: 'ack' };

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
      return { kind: 'retry', delaySeconds: RETRY_DELAY_SECONDS * attempts };
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
    return { kind: 'ack' };
  }
  const saved = await completeStep(
    env,
    job,
    { progress: outcome.progress, state, ...(outcome.done ? { done: outcome.done } : {}) },
    nowIso(env),
  );
  if (!saved || outcome.done) return { kind: 'ack' };
  try {
    await env.JOBS.send({ jobId: job.id, kind: job.kind, step: job.step + 1 });
  } catch (error) {
    // Langkah sudah tersimpan: pesan ini dikirim ulang dan langsung melanjutkan ke langkah berikutnya.
    console.error(`job ${job.id}: pesan lanjutan gagal dikirim: ${String(error)}`);
    return { kind: 'retry', delaySeconds: 5 };
  }
  return { kind: 'ack' };
}

/** `queue(batch, env)` Worker: tiap pesan = satu langkah; hasil `retry` memakai jeda bertahap. */
export async function handleQueue(batch: MessageBatch<JobMessage>, env: Env): Promise<void> {
  for (const message of batch.messages) {
    const outcome = await processJobMessage(env, message.body, message.attempts);
    if (outcome.kind === 'retry') message.retry({ delaySeconds: outcome.delaySeconds });
    else message.ack();
  }
}
