import type { Env } from '@server/core/env';
import { nowOf } from '@server/core/env';

/** Sesi unggah biner yang tak disentuh selama ini dibuang (sesi `open` yang ditinggalkan, juga `done`/`aborted` lama). */
export const UPLOAD_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Penyapu per jam (`schedulerTick`): membuang sesi unggah Country Lock yang `updated_at`-nya lebih tua dari 24 jam
 * beserta potongannya. Sesi dibuang LEBIH DULU lalu potongan yatim, sehingga sesi yang tersentuh di tengah penyapuan
 * tak pernah kehilangan potongan dengan sesinya tetap ada. Mengembalikan jumlah sesi yang dibuang.
 */
export async function sweepCountryLockUploads(env: Env): Promise<{ removed: number }> {
  const cutoff = new Date(nowOf(env) - UPLOAD_MAX_AGE_MS).toISOString();
  const results = await env.DB.batch([
    env.DB.prepare('DELETE FROM cl_uploads WHERE updated_at < ?').bind(cutoff),
    env.DB.prepare(
      'DELETE FROM cl_upload_chunks WHERE upload_id NOT IN (SELECT id FROM cl_uploads)',
    ),
  ]);
  return { removed: results[0]?.meta.changes ?? 0 };
}
