import { isValidEmail } from '@server/core/email';
import type { Env } from '@server/core/env';
import { nowOf } from '@server/core/env';
import { sendableMailLists } from '@server/core/mail-lists';
import { getSetting } from '@server/core/settings';
import { wibDate, wibHour } from '@server/modules/backup/names';
import { mailListsCount } from '@shared/mail-lists';
import { formatStockQty, stockDigestSection } from '@shared/stickers';
import { readStickerAlert } from './settings';

/**
 * Email ringkasan stok stiker (tahap 4a; bagian "Habis" sejak keputusan pemilik 2026-11-13): paling banyak satu surel
 * per hari pada/setelah jam yang diatur (WIB), dan tiap `intervalDays` hari (bawaan 1 = tiap hari), hanya bila ada
 * stiker yang habis atau menipis. Dipanggil penjadwal jam-an (`checkLowStockDigest`); tidak bergantung pada
 * sakelar cadangan. Penerima dari Konfigurasi Stiker (tabel `settings`), bukan `ALERT_TO`.
 */

/** Tanggal WIB (`YYYYMMDD`) ringkasan terakhir yang diklaim untuk dikirim (dikembalikan bila kirim gagal). */
export const SETTING_STICKER_DIGEST_LAST_DATE = 'STICKER_DIGEST_LAST_DATE';

export interface DigestStockRow {
  name: string;
  typeName: string;
  total: number;
  minQty: number;
}

export interface StockDigestRows {
  /** Habis: stiker aktif dengan total semua lokasi <= 0, apa pun minimumnya (`isOutOfStock`). */
  out: DigestStockRow[];
  /** Menipis: aktif, minimum > 0, total <= minimum, dan belum habis (`stockDigestSection`). */
  low: DigestStockRow[];
}

/**
 * Isi ringkasan harian: stiker AKTIF (bukan `inactive`/`deprecated`) yang habis (total semua lokasi <= 0, juga
 * negatif, minimum berapa pun) atau menipis (minimum > 0 dan total <= minimum, belum habis). Pembagian bagian
 * memakai `stockDigestSection` (`shared/stickers.ts`), sama dengan definisi `isLowStock` untuk kolom menipis.
 */
export async function stockDigestRows(env: Env): Promise<StockDigestRows> {
  const result = await env.DB.prepare(
    "SELECT s.name, t.name AS type_name, s.min_qty, COALESCE(SUM(k.qty), 0) AS total FROM stickers s JOIN sticker_types t ON t.id = s.type_id LEFT JOIN sticker_stock k ON k.sticker_id = s.id WHERE s.status = 'active' AND s.deleted_at = '' AND t.deleted_at = '' GROUP BY s.id, s.name, t.name, s.min_qty HAVING COALESCE(SUM(k.qty), 0) <= 0 OR (s.min_qty > 0 AND COALESCE(SUM(k.qty), 0) <= s.min_qty) ORDER BY t.name, s.name",
  ).all<{ name: string; type_name: string; min_qty: number | string; total: number | string }>();
  const rows: StockDigestRows = { out: [], low: [] };
  for (const row of result.results) {
    const entry: DigestStockRow = {
      name: row.name.trim(),
      typeName: row.type_name.trim(),
      total: Number(row.total) || 0,
      minQty: Number(row.min_qty) || 0,
    };
    const section = stockDigestSection({
      status: 'active',
      minQty: entry.minQty,
      total: entry.total,
    });
    if (section === 'out') rows.out.push(entry);
    else if (section === 'low') rows.low.push(entry);
  }
  return rows;
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
  const lists = sendableMailLists(alert, isValidEmail);
  if (!alert.enabled || mailListsCount(lists) === 0) return 'skipped';
  const now = nowOf(env);
  if (wibHour(now) < alert.digestHour) return 'skipped';
  const today = wibDate(now);
  const previous = await getSetting(env, SETTING_STICKER_DIGEST_LAST_DATE);
  if (previous === today) return 'skipped';
  // Selang minimum antar ringkasan (1 = tiap hari); tanggal terakhir yang tak terbaca atau kosong = belum pernah kirim.
  const elapsed = previous === '' ? Number.POSITIVE_INFINITY : daysBetweenCompact(previous, today);
  if (Number.isFinite(elapsed) && elapsed < alert.intervalDays) return 'skipped';
  const { out, low } = await stockDigestRows(env);
  if (out.length === 0 && low.length === 0) return 'skipped';
  if (!(await claimDigestDate(env, previous, today))) return 'skipped';
  const sections: string[] = [];
  if (out.length > 0) {
    const lines = out.map(
      (row) => `- ${row.name} (${row.typeName}): stok ${formatStockQty(row.total)}`,
    );
    sections.push(`Habis (total semua lokasi 0 atau kurang):\n\n${lines.join('\n')}`);
  }
  if (low.length > 0) {
    const lines = low.map(
      (row) => `- ${row.name} (${row.typeName}): stok ${row.total}, minimum ${row.minQty}`,
    );
    sections.push(`Menipis (total semua lokasi):\n\n${lines.join('\n')}`);
  }
  const subject = `Stok stiker: ${[
    out.length > 0 ? `${out.length} habis` : null,
    low.length > 0 ? `${low.length} menipis` : null,
  ]
    .filter((part) => part !== null)
    .join(', ')}`;
  const link = env.APP_ORIGIN
    ? `\n\nLihat stok: ${env.APP_ORIGIN.replace(/\/+$/, '')}/sticker`
    : '';
  try {
    await mailer.send({
      to: lists.recipients,
      cc: lists.cc,
      bcc: lists.bcc,
      subject,
      text: `${sections.join('\n\n')}${link}\n`,
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
