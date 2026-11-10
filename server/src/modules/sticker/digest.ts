import type { Env } from '@server/core/env';
import { nowOf } from '@server/core/env';
import { getSetting, putSetting } from '@server/core/settings';
import { wibDate, wibHour } from '@server/modules/backup/names';
import { readStickerAlert } from './settings';

/**
 * Email ringkasan harian stok stiker menipis (tahap 4a): satu surel per hari pada/setelah jam yang diatur (WIB),
 * hanya bila ada stiker yang menipis. Dipanggil penjadwal jam-an (`checkLowStockDigest`); tidak bergantung pada
 * sakelar cadangan. Penerima dari Konfigurasi Stiker (tabel `settings`), bukan `ALERT_TO`.
 */

/** Tanggal WIB (`YYYYMMDD`) ringkasan terakhir yang BERHASIL terkirim. */
export const SETTING_STICKER_DIGEST_LAST_DATE = 'STICKER_DIGEST_LAST_DATE';

export interface LowStockRow {
  name: string;
  typeName: string;
  total: number;
  minQty: number;
}

/**
 * Stiker menipis: aktif (bukan `inactive`/`deprecated`), minimum > 0, dan total stok SEMUA lokasi <= minimum. Definisi
 * sama dengan `isLowStock` (`shared/stickers.ts`).
 */
export async function lowStockRows(env: Env): Promise<LowStockRow[]> {
  const result = await env.DB.prepare(
    "SELECT s.name, t.name AS type_name, s.min_qty, COALESCE(SUM(k.qty), 0) AS total FROM stickers s JOIN sticker_types t ON t.id = s.type_id LEFT JOIN sticker_stock k ON k.sticker_id = s.id WHERE s.status = 'active' AND s.min_qty > 0 GROUP BY s.id, s.name, t.name, s.min_qty HAVING COALESCE(SUM(k.qty), 0) <= s.min_qty ORDER BY t.name, s.name",
  ).all<{ name: string; type_name: string; min_qty: number | string; total: number | string }>();
  return result.results.map((row) => ({
    name: row.name.trim(),
    typeName: row.type_name.trim(),
    total: Number(row.total) || 0,
    minQty: Number(row.min_qty) || 0,
  }));
}

export type DigestOutcome = 'sent' | 'skipped' | 'failed';

export async function checkLowStockDigest(env: Env): Promise<DigestOutcome> {
  const mailer = env.MAILER;
  if (!mailer) return 'skipped';
  const { alert } = await readStickerAlert(env);
  if (!alert.enabled || alert.recipients.length === 0) return 'skipped';
  const now = nowOf(env);
  if (wibHour(now) < alert.digestHour) return 'skipped';
  const today = wibDate(now);
  if ((await getSetting(env, SETTING_STICKER_DIGEST_LAST_DATE)) === today) return 'skipped';
  const rows = await lowStockRows(env);
  if (rows.length === 0) return 'skipped';
  const lines = rows.map(
    (row) => `- ${row.name} (${row.typeName}): stok ${row.total}, minimum ${row.minQty}`,
  );
  const link = env.APP_ORIGIN
    ? `\n\nLihat stok: ${env.APP_ORIGIN.replace(/\/+$/, '')}/sticker/stock`
    : '';
  try {
    await mailer.send({
      to: alert.recipients,
      subject: `Stok stiker menipis (${rows.length})`,
      text: `Stiker berikut stoknya menipis (total semua lokasi):\n\n${lines.join('\n')}${link}\n`,
    });
  } catch (error) {
    // Pesan galat dari `createSmtpMailer` sudah bebas SMTP_PASS. Tanggal tidak ditulis: dicoba lagi pada detak berikutnya.
    console.error(
      `peringatan: email stok stiker menipis gagal terkirim, dicoba lagi nanti: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 'failed';
  }
  await putSetting(env, SETTING_STICKER_DIGEST_LAST_DATE, today);
  return 'sent';
}
