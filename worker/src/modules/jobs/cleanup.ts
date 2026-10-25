import { getBridge } from '@worker/core/bridge-client';
import type { Env } from '@worker/core/env';
import { nowOf } from '@worker/core/env';
import { purgePendingFiles } from '@worker/modules/files/service';
import { cleanupQrDocuments } from '@worker/modules/qrcode/service';
import type { JobHandler, StepOutcome } from './consumer';

/** Batas per langkah (tiap item = beberapa subrequest; total harus < 50 per pemanggilan). */
export const CLEANUP_REVOKE_LIMIT = 4;
export const CLEANUP_PURGE_LIMIT = 4;
export const CLEANUP_ORPHAN_LIMIT = 2;
/** Maksimum langkah berlanjut dalam satu job pembersihan. */
export const CLEANUP_MAX_STEPS = 10;
/** Muatan ekspor kedaluwarsa dan riwayat job lama. */
export const JOB_BLOB_TTL_MS = 24 * 60 * 60 * 1000;
export const JOB_HISTORY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface FailedExportRow {
  id: string;
  state: string;
}

/** Berkas Drive ekspor yang gagal dibuang saat job gagal (`state.orphans`): coba buang lagi. */
async function trashExportOrphans(env: Env, limit: number): Promise<number> {
  const rows = await env.DB.prepare(
    "SELECT id, state FROM jobs WHERE kind = 'qr_export' AND status = 'failed' AND state LIKE '%\"orphans\":[\"%' LIMIT ?",
  )
    .bind(limit)
    .all<FailedExportRow>();
  let trashed = 0;
  for (const row of rows.results) {
    const state = JSON.parse(row.state) as { orphans?: string[] };
    const remaining: string[] = [];
    for (const driveId of state.orphans ?? []) {
      try {
        await getBridge(env).trashFile(driveId);
        trashed += 1;
      } catch (error) {
        console.error(`cleanup: berkas yatim ${driveId} belum dapat dibuang: ${String(error)}`);
        remaining.push(driveId);
      }
    }
    await env.DB.prepare('UPDATE jobs SET state = ? WHERE id = ?')
      .bind(JSON.stringify({ ...state, orphans: remaining }), row.id)
      .run();
  }
  return trashed;
}

/** Membuang muatan job yang sudah selesai/gagal atau kedaluwarsa dan riwayat job lama. */
async function purgeJobData(env: Env): Promise<void> {
  const now = nowOf(env);
  const blobCutoff = new Date(now - JOB_BLOB_TTL_MS).toISOString();
  const historyCutoff = new Date(now - JOB_HISTORY_TTL_MS).toISOString();
  await env.DB.batch([
    env.DB.prepare(
      "DELETE FROM job_blobs WHERE job_id IN (SELECT id FROM jobs WHERE status IN ('done', 'failed') OR updated_at < ?)",
    ).bind(blobCutoff),
    env.DB.prepare('DELETE FROM job_blobs WHERE job_id NOT IN (SELECT id FROM jobs)'),
    env.DB.prepare(
      "DELETE FROM jobs WHERE status IN ('done', 'failed') AND updated_at < ? AND state NOT LIKE '%\"orphans\":[\"%'",
    ).bind(historyCutoff),
  ]);
}

interface CleanupState {
  round?: number;
  revoked?: number;
  purged?: number;
  orphans?: number;
}

/**
 * Pembersihan terjadwal (cron -> antrean): mencabut berbagi PDF sumber QR yatim, membuang berkas Drive
 * `pending_delete` dan berkas ekspor yatim, serta menghapus muatan/riwayat job lama. Berlanjut ke langkah
 * berikutnya selama masih ada yang dikerjakan (potongan kecil per pesan).
 */
export const cleanupHandler: JobHandler = {
  async run(ctx): Promise<StepOutcome> {
    const state = ctx.state as CleanupState;
    const revoked = await cleanupQrDocuments(ctx.env, CLEANUP_REVOKE_LIMIT);
    const purged = await purgePendingFiles(ctx.env, CLEANUP_PURGE_LIMIT);
    const orphans = await trashExportOrphans(ctx.env, CLEANUP_ORPHAN_LIMIT);
    await purgeJobData(ctx.env);
    state.round = (state.round ?? 0) + 1;
    state.revoked = (state.revoked ?? 0) + revoked;
    state.purged = (state.purged ?? 0) + purged;
    state.orphans = (state.orphans ?? 0) + orphans;
    const more =
      revoked >= CLEANUP_REVOKE_LIMIT ||
      purged >= CLEANUP_PURGE_LIMIT ||
      orphans >= CLEANUP_ORPHAN_LIMIT;
    if (more && state.round < CLEANUP_MAX_STEPS) {
      return { progress: Math.floor((state.round / CLEANUP_MAX_STEPS) * 100) };
    }
    return {
      progress: 100,
      done: {
        result: JSON.stringify({
          revoked: state.revoked,
          purged: state.purged,
          orphans: state.orphans,
        }),
      },
    };
  },
};
