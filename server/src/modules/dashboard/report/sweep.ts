/**
 * Penyapu tautan terbitan laporan terjadwal (spek dashboard 7a.1): menghapus baris `dashboard_shares` ber-`report_id`
 * yang sudah lewat `expires_at` lebih dari 30 hari, beserta data kunjungannya. Tautan yang baru kedaluwarsa tetap
 * ada (riwayat dan hitungan kunjungan masih tampil di halaman laporan). Juga membersihkan yatim kompensasi: baris yang
 * gagal dihapus saat pengiriman gagal akhirnya tersapu lewat jalur yang sama. Dijalankan penjadwal jam-an.
 */
import { type Env, nowOf } from '@server/core/env';

/** Lama sesudah kedaluwarsa sebelum tautan terbitan dihapus. */
export const REPORT_SHARE_RETAIN_MS = 30 * 24 * 60 * 60 * 1000;

/** Menghapus tautan terbitan yang sudah usang; mengembalikan jumlah baris tautan yang dihapus. */
export async function sweepReportShares(env: Env): Promise<number> {
  const cutoff = new Date(nowOf(env) - REPORT_SHARE_RETAIN_MS).toISOString();
  const [, deleted] = await env.DB.batch([
    env.DB.prepare(
      "DELETE v FROM dashboard_share_visits v INNER JOIN dashboard_shares s ON s.id = v.share_id WHERE s.report_id <> '' AND s.expires_at < ?",
    ).bind(cutoff),
    env.DB.prepare("DELETE FROM dashboard_shares WHERE report_id <> '' AND expires_at < ?").bind(
      cutoff,
    ),
  ]);
  return deleted?.meta.changes ?? 0;
}
