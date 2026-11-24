/**
 * Penyapu kedaluwarsa tautan dashboard (keputusan pemilik 2026-11-24): menulis baris audit NYATA
 * `dashboard.share_expire` (bukan entri sintetis) untuk tiap tautan yang `expires_at`-nya sudah lewat dan yang belum
 * punya baris itu, sehingga log aktivitas tautan menampilkan dibuat, dicabut, dan kedaluwarsa. `ts` baris = `expires_at`
 * tautan (bukan waktu sapuan), aktor = `system` (`JOB_SYSTEM_ACTOR`). Dijalankan penjadwal jam-an.
 *
 * Idempoten dan aman berbalapan: baris tautan yang memenuhi syarat dikunci di awal `batch()` (sapuan lain menunggu
 * sampai COMMIT dan lalu melihat baris audit yang sudah ada), dan penyisipan hanya untuk tautan yang belum punya baris
 * `share_expire`. Tautan yang dicabut SEBELUM kedaluwarsa tidak disentuh (tak pernah kedaluwarsa); yang dicabut
 * sesudah `expires_at` tetap dicatat kedaluwarsa pada waktunya.
 */
import type { Env } from '@server/core/env';
import { nowOf } from '@server/core/env';
import { JOB_SYSTEM_ACTOR } from '@server/modules/jobs/service';

const DUE_SQL = "s.expires_at <= ? AND (s.revoked_at = '' OR s.revoked_at > s.expires_at)";

/** Menulis baris `share_expire` yang belum ada. Mengembalikan jumlah baris yang ditulis. */
export async function sweepExpiredShares(env: Env): Promise<number> {
  const now = new Date(nowOf(env)).toISOString();
  const [, inserted] = await env.DB.batch([
    env.DB.prepare(`UPDATE dashboard_shares s SET s.id = s.id WHERE ${DUE_SQL}`).bind(now),
    env.DB.prepare(
      `INSERT INTO audit_log (ts, actor, action, target, target_id, \`before\`, \`after\`)
       SELECT s.expires_at, ?, 'dashboard.share_expire', CONCAT('dashboard_share:', s.id), s.id, ?, ?
       FROM dashboard_shares s
       WHERE ${DUE_SQL}
         AND NOT EXISTS (
           SELECT 1 FROM audit_log a WHERE a.action = 'dashboard.share_expire' AND a.target_id = s.id
         )`,
    ).bind(
      JOB_SYSTEM_ACTOR,
      JSON.stringify({ status: 'active' }),
      JSON.stringify({ status: 'expired' }),
      now,
    ),
  ]);
  return inserted?.meta.changes ?? 0;
}
