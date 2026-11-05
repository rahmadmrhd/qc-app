import type { Db, DbStatement } from '@server/core/db';
import type { Env } from '@server/core/env';
import type { JobKind, JobStatus } from '@shared/rpc';

export interface JobRecord {
  id: string;
  kind: JobKind;
  status: JobStatus;
  progress: number;
  result: string;
  error: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  /** JSON masukan job (kecil). */
  input: string;
  /** JSON keadaan antar langkah (id berkas Drive yang dibuat, kursor, dst.). */
  state: string;
  /** Langkah berikutnya yang harus dijalankan (kebenaran; `step` pada pesan hanya informatif). */
  step: number;
  /** Epoch ms; langkah sedang dipegang satu pengolah sampai waktu ini. */
  leaseUntil: number;
}

interface JobRow {
  id: string;
  kind: string;
  status: string;
  progress: number;
  result: string;
  error: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  input: string;
  state: string;
  step: number;
  lease_until: number;
}

export const JOB_COLUMNS =
  'id, kind, status, progress, result, error, created_by, created_at, updated_at, input, state, step, lease_until';

export function toJob(row: JobRow): JobRecord {
  return {
    id: row.id,
    kind: row.kind as JobKind,
    status: row.status as JobStatus,
    progress: Number(row.progress) || 0,
    result: row.result,
    error: row.error,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    input: row.input,
    state: row.state,
    step: Number(row.step) || 0,
    leaseUntil: Number(row.lease_until) || 0,
  };
}

export async function findJob(env: Env, id: string): Promise<JobRecord | null> {
  const row = await env.DB.prepare(`SELECT ${JOB_COLUMNS} FROM jobs WHERE id = ?`)
    .bind(id)
    .first<JobRow>();
  return row ? toJob(row) : null;
}

export function insertJobStmt(db: Db, job: JobRecord): DbStatement {
  return db
    .prepare(`INSERT INTO jobs (${JOB_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      job.id,
      job.kind,
      job.status,
      job.progress,
      job.result,
      job.error,
      job.createdBy,
      job.createdAt,
      job.updatedAt,
      job.input,
      job.state,
      job.step,
      job.leaseUntil,
    );
}

export function insertBlobStmt(db: Db, jobId: string, name: string, data: string): DbStatement {
  return db
    .prepare('INSERT INTO job_blobs (job_id, name, data) VALUES (?, ?, ?)')
    .bind(jobId, name, data);
}

export async function readBlob(env: Env, jobId: string, name: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT data FROM job_blobs WHERE job_id = ? AND name = ?')
    .bind(jobId, name)
    .first<{ data: string }>();
  return row ? row.data : null;
}

export async function deleteBlobs(env: Env, jobId: string): Promise<void> {
  await env.DB.prepare('DELETE FROM job_blobs WHERE job_id = ?').bind(jobId).run();
}

/** Job aktif (queued/running) jenis `kind` yang `JSON_VALUE(input, path) = value`; untuk dedup pemicu. */
export async function findActiveJob(
  env: Env,
  kind: JobKind,
  where?: { path: string; value: string },
): Promise<JobRecord | null> {
  const sql = `SELECT ${JOB_COLUMNS} FROM jobs WHERE kind = ? AND status IN ('queued', 'running')${
    where ? ' AND JSON_VALUE(input, ?) = ?' : ''
  } ORDER BY created_at DESC LIMIT 1`;
  const binds: unknown[] = where ? [kind, where.path, where.value] : [kind];
  const row = await env.DB.prepare(sql)
    .bind(...binds)
    .first<JobRow>();
  return row ? toJob(row) : null;
}

/**
 * Menguasai langkah `step` job (atomik): hanya bila job belum selesai, langkahnya masih `step`, dan tidak ada
 * pengolah lain yang memegang (lease habis). Mengembalikan true bila berhasil.
 */
export async function claimStep(
  env: Env,
  job: JobRecord,
  now: number,
  leaseMs: number,
  nowIso: string,
): Promise<boolean> {
  const result = await env.DB.prepare(
    "UPDATE jobs SET status = 'running', lease_until = ?, updated_at = ? WHERE id = ? AND step = ? AND status IN ('queued', 'running') AND lease_until <= ?",
  )
    .bind(now + leaseMs, nowIso, job.id, job.step, now)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

/**
 * Id job yang siap dijalankan runner: belum selesai dan tidak sedang dipegang pengolah (lease habis atau 0; job
 * yang ditunda karena galat sementara baru muncul setelah jedanya lewat), urut menurut waktu dibuat.
 */
export async function listRunnableJobIds(env: Env, now: number, limit: number): Promise<string[]> {
  const rows = await env.DB.prepare(
    "SELECT id FROM jobs WHERE status IN ('queued', 'running') AND lease_until <= ? ORDER BY created_at, id LIMIT ?",
  )
    .bind(now, limit)
    .all<{ id: string }>();
  return rows.results.map((row) => row.id);
}

/** Menunda job sampai `until` (epoch ms): lease dipakai sebagai jeda sebelum langkah dicoba ulang. */
export async function delayLease(env: Env, jobId: string, until: number): Promise<void> {
  await env.DB.prepare(
    "UPDATE jobs SET lease_until = ? WHERE id = ? AND status IN ('queued', 'running')",
  )
    .bind(until, jobId)
    .run();
}

export async function releaseLease(env: Env, job: JobRecord): Promise<void> {
  await env.DB.prepare('UPDATE jobs SET lease_until = 0 WHERE id = ? AND step = ?')
    .bind(job.id, job.step)
    .run();
}

export async function saveState(env: Env, jobId: string, state: unknown): Promise<void> {
  await env.DB.prepare('UPDATE jobs SET state = ? WHERE id = ?')
    .bind(JSON.stringify(state), jobId)
    .run();
}

/** Menyelesaikan langkah (CAS pada `step`): maju satu langkah atau selesai. true bila tersimpan. */
export async function completeStep(
  env: Env,
  job: JobRecord,
  patch: { progress: number; state: unknown; done?: { result: string } },
  nowIso: string,
): Promise<boolean> {
  const result = await env.DB.prepare(
    "UPDATE jobs SET step = step + 1, lease_until = 0, progress = ?, state = ?, status = ?, result = ?, updated_at = ? WHERE id = ? AND step = ? AND status IN ('queued', 'running')",
  )
    .bind(
      patch.done ? 100 : Math.min(99, Math.max(0, Math.floor(patch.progress))),
      JSON.stringify(patch.state),
      patch.done ? 'done' : 'running',
      patch.done ? patch.done.result : '',
      nowIso,
      job.id,
      job.step,
    )
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

export async function failJob(
  env: Env,
  job: JobRecord,
  error: string,
  state: unknown,
  nowIso: string,
): Promise<void> {
  await env.DB.prepare(
    "UPDATE jobs SET status = 'failed', error = ?, state = ?, lease_until = 0, updated_at = ? WHERE id = ? AND status IN ('queued', 'running')",
  )
    .bind(error.slice(0, 500), JSON.stringify(state), nowIso, job.id)
    .run();
}
