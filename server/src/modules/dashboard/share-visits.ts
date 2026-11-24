/**
 * Data kunjungan tautan dashboard publik (keputusan pemilik 2026-11-24). Yang disimpan hanya IP terpotong (/24 atau
 * /48), negara dua huruf, dan ringkasan perangkat dari daftar putih (`shared/dashboard-visit.ts`); IP asli dan
 * User-Agent mentah tidak pernah ditulis ke basis data maupun log.
 *
 * Kunjungan = GET halaman publik yang berhasil. Pemuatan ulang dari IP terpotong + perangkat yang sama dalam
 * `VISIT_LIMITS.dedupMs` sejak baris kunjungan terakhirnya dihitung SATU kunjungan (hanya `last_visit_at` yang
 * diperbarui). Seluruh pencatatan satu transaksi (`batch()`), dan baris tautan dikunci di awal sehingga GET serentak
 * diserialkan: hitungan dan dedup benar, `visit_count` naik lewat `visit_count + 1` (bukan baca-lalu-tulis).
 */
import type { DbStatement, Preparer } from '@server/core/db';
import type { Env } from '@server/core/env';
import { newId } from '@server/core/id';
import type { ShareVisitDto } from '@shared/dashboard-visit';
import { cleanCountry, describeDevice, truncateIp, VISIT_LIMITS } from '@shared/dashboard-visit';

/** Keterangan permintaan yang dipakai pencatatan; nilai mentah ini TIDAK pernah disimpan apa adanya. */
export interface VisitRequestInfo {
  /** IP klien hasil `clientIp` (hanya untuk dipotong). */
  ip: string;
  userAgent: string | null;
  /** Nilai `CF-IPCountry`; hanya diberikan bila peer proxy tepercaya. */
  country: string | null;
}

export interface VisitSummary {
  visitCount: number;
  firstVisitAt: string;
  lastVisitAt: string;
}

const RECENT_SQL =
  'NOT EXISTS (SELECT 1 FROM dashboard_share_visits WHERE share_id = ? AND ip_prefix = ? AND device = ? AND visited_at > ?)';

/** Pernyataan pencatatan satu kunjungan (urutan penting: kunci baris, hitung, sisipkan, `last_visit_at`, pangkas). */
export function recordVisitStmts(
  db: Preparer,
  shareId: string,
  info: VisitRequestInfo,
  nowMs: number,
): DbStatement[] {
  const now = new Date(nowMs).toISOString();
  const cutoff = new Date(nowMs - VISIT_LIMITS.dedupMs).toISOString();
  const ipPrefix = truncateIp(info.ip);
  const device = describeDevice(info.userAgent);
  const country = cleanCountry(info.country);
  const recent = [shareId, ipPrefix, device, cutoff] as const;
  return [
    // Kunci baris tautan sampai COMMIT: GET serentak ke tautan yang sama menunggu di sini sehingga pembacaan dedup
    // di bawah melihat baris yang sudah di-commit (snapshot baru dibuat setelah kunci didapat).
    db.prepare('UPDATE dashboard_shares SET id = id WHERE id = ?').bind(shareId),
    db
      .prepare(
        `UPDATE dashboard_shares SET visit_count = visit_count + 1, first_visit_at = IF(first_visit_at = '', ?, first_visit_at) WHERE id = ? AND ${RECENT_SQL}`,
      )
      .bind(now, shareId, ...recent),
    db
      .prepare(
        `INSERT INTO dashboard_share_visits (id, share_id, visited_at, country, device, ip_prefix) SELECT ?, ?, ?, ?, ?, ? FROM DUAL WHERE ${RECENT_SQL}`,
      )
      .bind(newId(), shareId, now, country, device, ipPrefix, ...recent),
    db.prepare('UPDATE dashboard_shares SET last_visit_at = ? WHERE id = ?').bind(now, shareId),
    // Pangkas ke baris terbaru (tabel turunan: MariaDB tak mengizinkan LIMIT langsung di dalam `IN (SELECT ...)`).
    db
      .prepare(
        `DELETE FROM dashboard_share_visits WHERE share_id = ? AND id IN (SELECT id FROM (SELECT id FROM dashboard_share_visits WHERE share_id = ? ORDER BY visited_at DESC, id DESC LIMIT 18446744073709551615 OFFSET ${VISIT_LIMITS.keep}) AS old_visits)`,
      )
      .bind(shareId, shareId),
  ];
}

/**
 * Mencatat kunjungan. TIDAK pernah melempar: kegagalan pencatatan tidak boleh menggagalkan halaman publik, dan log
 * hanya memuat pesan tetap (tanpa token, URL, atau IP).
 */
export async function recordShareVisit(
  env: Env,
  shareId: string,
  info: VisitRequestInfo,
  nowMs: number,
): Promise<boolean> {
  try {
    await env.DB.batch(recordVisitStmts(env.DB, shareId, info, nowMs));
    return true;
  } catch {
    console.error('Pencatatan kunjungan dashboard gagal');
    return false;
  }
}

export async function loadVisitSummary(db: Preparer, shareId: string): Promise<VisitSummary> {
  const row = await db
    .prepare('SELECT visit_count, first_visit_at, last_visit_at FROM dashboard_shares WHERE id = ?')
    .bind(shareId)
    .first<{ visit_count: number | string; first_visit_at: string; last_visit_at: string }>();
  return {
    visitCount: Number(row?.visit_count ?? 0),
    firstVisitAt: row?.first_visit_at ?? '',
    lastVisitAt: row?.last_visit_at ?? '',
  };
}

/** Kunjungan tersimpan, terbaru dahulu (maks. `VISIT_LIMITS.keep`). */
export async function listVisits(db: Preparer, shareId: string): Promise<ShareVisitDto[]> {
  const rows = await db
    .prepare(
      `SELECT visited_at, country, device, ip_prefix FROM dashboard_share_visits WHERE share_id = ? ORDER BY visited_at DESC, id DESC LIMIT ${VISIT_LIMITS.keep}`,
    )
    .bind(shareId)
    .all<{ visited_at: string; country: string; device: string; ip_prefix: string }>();
  return rows.results.map((row) => ({
    visitedAt: row.visited_at,
    country: row.country,
    device: row.device,
    ipPrefix: row.ip_prefix,
  }));
}
