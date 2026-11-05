import type { Env } from '@server/core/env';
import { findActiveJob } from '@server/modules/jobs/repo';
import { enqueueJob, JOB_SYSTEM_ACTOR } from '@server/modules/jobs/service';

/**
 * Cron Trigger: HANYA menjadwalkan (memasukkan pesan ke antrean); pekerjaan beratnya dikerjakan consumer.
 * Tidak menumpuk: bila pembersihan sebelumnya belum selesai, tidak dibuat yang baru.
 */
export async function scheduled(_event: ScheduledController, env: Env): Promise<void> {
  if (await findActiveJob(env, 'cleanup_qr')) return;
  await enqueueJob(env, 'cleanup_qr', {}, JOB_SYSTEM_ACTOR);
}
