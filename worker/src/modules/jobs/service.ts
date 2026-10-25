import { hasLevel } from '@shared/permissions';
import type { GetJobInput, JobDto, JobKind } from '@shared/rpc';
import type { Env, JobMessage } from '@worker/core/env';
import { nowIso } from '@worker/core/env';
import { appError } from '@worker/core/errors';
import type { UserContext } from '@worker/modules/access/context';
import type { JobRecord } from './repo';
import { failJob, findJob, insertBlobStmt, insertJobStmt } from './repo';

export const JOB_SYSTEM_ACTOR = 'system';

export interface EnqueueOptions {
  /** Muatan besar (base64): satu baris `job_blobs` per entri; TIDAK ikut pesan antrean. */
  blobs?: Record<string, string>;
}

/**
 * Membuat job (baris `jobs` + muatan) lalu mengirim pesan `{ jobId, kind, step }`. Bila pengiriman gagal, job
 * ditandai gagal (tidak menggantung `queued`) dan galat UNAVAILABLE dilempar.
 */
export async function enqueueJob(
  env: Env,
  kind: JobKind,
  input: unknown,
  createdBy: string,
  options: EnqueueOptions = {},
): Promise<{ jobId: string }> {
  const now = nowIso(env);
  const job: JobRecord = {
    id: crypto.randomUUID(),
    kind,
    status: 'queued',
    progress: 0,
    result: '',
    error: '',
    createdBy,
    createdAt: now,
    updatedAt: now,
    input: JSON.stringify(input ?? {}),
    state: '',
    step: 0,
    leaseUntil: 0,
  };
  await env.DB.batch([
    insertJobStmt(env.DB, job),
    ...Object.entries(options.blobs ?? {}).map(([name, data]) =>
      insertBlobStmt(env.DB, job.id, name, data),
    ),
  ]);
  const message: JobMessage = { jobId: job.id, kind, step: 0 };
  try {
    await env.JOBS.send(message);
  } catch (error) {
    console.error(`enqueueJob ${kind}: pengiriman antrean gagal: ${String(error)}`);
    await failJob(env, job, 'Antrean pekerjaan tidak dapat dihubungi', {}, nowIso(env));
    throw appError(
      'UNAVAILABLE',
      'Antrean pekerjaan sedang tidak dapat dihubungi. Coba lagi sebentar lagi.',
    );
  }
  return { jobId: job.id };
}

export function toJobDto(job: JobRecord): JobDto {
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    progress: job.progress,
    ...(job.status === 'done' && job.result !== '' ? { result: job.result } : {}),
    ...(job.status === 'failed' ? { error: job.error } : {}),
  };
}

/** `jobs.get`: pembuat job, atau pengguna dengan izin modul `qrcode` (lihat), boleh memantau. */
export async function getJobDto(env: Env, input: GetJobInput, user: UserContext): Promise<JobDto> {
  const job = await findJob(env, input.id);
  if (!job) throw appError('NOT_FOUND', 'Pekerjaan tidak ditemukan');
  const allowed = job.createdBy === user.email || hasLevel(user.permissions.qrcode, 'view');
  // Pekerjaan orang lain disamarkan sebagai tidak ada (tidak membocorkan keberadaan).
  if (!allowed) throw appError('NOT_FOUND', 'Pekerjaan tidak ditemukan');
  return toJobDto(job);
}
