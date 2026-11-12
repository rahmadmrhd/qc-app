import type { Env } from '@server/core/env';
import { nowOf } from '@server/core/env';
import { getSetting } from '@server/core/settings';
import { wibDate, wibHour } from '@server/modules/backup/names';
import { readStickerAlert } from './settings';

/**
 * Email ringkasan stok stiker menipis (tahap 4a): paling banyak satu surel per hari pada/setelah jam yang diatur (WIB),
 * dan tiap `intervalDays` hari (bawaan 1 = tiap hari), hanya bila ada stiker yang menipis. Dipanggil penjadwal jam-an (`checkLowStockDigest`); tidak bergantung pada
 * sakelar cadangan. Penerima dari Konfigurasi Stiker (tabel `settings`), bukan `ALERT_TO`.
 */

/** Tanggal WIB (`YYYYMMDD`) ringkasan terakhir yang diklaim untuk dikirim (dikembalikan bila kirim gagal). */
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

/** Selisih hari kalender antara dua tanggal `YYYYMMDD`; NaN bila salah satunya tak terbaca. */
function daysBetweenCompact(from: string, to: string): number {
  const parse = (value: string) =>
    /^\d{8}$/.test(value)
      ? Date.UTC(
          Number(value.slice(0, 4)),
          Number(value.slice(4, 6)) - 1,
          Number(value.slice(6, 8)),
        )
      : Number.NaN;
  return Math.round((parse(to) - parse(from)) / 86_400_000);
}

/**
 * Mengklaim tanggal kirim secara atomik (CAS pada nilai lama) SEBELUM surel dikirim: beberapa proses atas DB yang
 * sama (dev di `qc_dev`, container yang tumpang-tindih saat deploy) tidak mengirim dobel. Hanya satu pemanggil yang
 * mendapat `true`. Baris belum ada = pemenang `INSERT IGNORE`.
 */
async function claimDigestDate(env: Env, previous: string, today: string): Promise<boolean> {
  const updated = await env.DB.prepare(
    'UPDATE settings SET value = ? WHERE `key` = ? AND value = ?',
  )
    .bind(today, SETTING_STICKER_DIGEST_LAST_DATE, previous)
    .run();
  if (updated.meta.changes > 0) return true;
  if (previous !== '') return false;
  const inserted = await env.DB.prepare('INSERT IGNORE INTO settings (`key`, value) VALUES (?, ?)')
    .bind(SETTING_STICKER_DIGEST_LAST_DATE, today)
    .run();
  return inserted.meta.changes > 0;
}

/** Mengembalikan klaim (hanya bila masih milik kita) agar detak berikutnya mengulang kirim. */
async function releaseDigestClaim(env: Env, previous: string, today: string): Promise<void> {
  await env.DB.prepare('UPDATE settings SET value = ? WHERE `key` = ? AND value = ?')
    .bind(previous, SETTING_STICKER_DIGEST_LAST_DATE, today)
    .run();
}

export async function checkLowStockDigest(env: Env): Promise<DigestOutcome> {
  const mailer = env.MAILER;
  if (!mailer) return 'skipped';
  const { alert } = await readStickerAlert(env);
  if (!alert.enabled || alert.recipients.length === 0) return 'skipped';
  const now = nowOf(env);
  if (wibHour(now) < alert.digestHour) return 'skipped';
  const today = wibDate(now);
  const previous = await getSetting(env, SETTING_STICKER_DIGEST_LAST_DATE);
  if (previous === today) return 'skipped';
  // Selang minimum antar ringkasan (1 = tiap hari); tanggal terakhir yang tak terbaca atau kosong = belum pernah kirim.
  const elapsed = previous === '' ? Number.POSITIVE_INFINITY : daysBetweenCompact(previous, today);
  if (Number.isFinite(elapsed) && elapsed < alert.intervalDays) return 'skipped';
  const rows = await lowStockRows(env);
  if (rows.length === 0) return 'skipped';
  if (!(await claimDigestDate(env, previous, today))) return 'skipped';
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
    // Pesan galat dari `createSmtpMailer` sudah bebas SMTP_PASS. Klaim dikembalikan: dicoba lagi pada detak berikutnya.
    await releaseDigestClaim(env, previous, today).catch((releaseError: unknown) => {
      // Klaim tertinggal: surel hari ini tidak akan dicoba lagi sampai besok; operator perlu tahu.
      console.error(
        `peringatan: klaim ringkasan stok stiker ${today} gagal dikembalikan setelah kirim gagal; surel hari ini dapat terlewat: ${releaseError instanceof Error ? releaseError.message : String(releaseError)}`,
      );
    });
    console.error(
      `peringatan: email stok stiker menipis gagal terkirim, dicoba lagi nanti: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 'failed';
  }
  return 'sent';
}
