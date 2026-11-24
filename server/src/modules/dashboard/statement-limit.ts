import type { Preparer } from '@server/core/db';

/**
 * Batas waktu satu kueri widget di sisi database (keputusan pemilik 2026-11-23): kueri yang lewat dihentikan MariaDB
 * dengan galat 1969 (`ER_STATEMENT_TIMEOUT`), sehingga slot semafor tidak tertahan tanpa batas atas oleh kueri yang
 * menggantung. Lebih besar dari batas respons klien (`WIDGET_TIMEOUT_MS`, 15 dtk): klien menerima galat lebih dulu,
 * slot ditahan paling lama sampai batas ini.
 */
export const WIDGET_STATEMENT_TIMEOUT_SECONDS = 30;

/**
 * Pembungkus `Preparer` yang mengawali tiap kueri dengan `SET STATEMENT max_statement_time=<detik> FOR`. Batas hanya
 * berlaku untuk kueri itu sendiri (BUKAN `SET SESSION` pada koneksi pool bersama, yang akan bocor ke rute lain), dan
 * ini SATU-SATUNYA tempat awalan itu dibuat: widget tetap menulis SQL literalnya apa adanya.
 */
export function withStatementTimeout(db: Preparer, seconds: number): Preparer {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error('Batas waktu kueri harus bilangan positif');
  }
  // Angka sudah divalidasi; `String(number)` tak pernah memuat SQL.
  const prefix = `SET STATEMENT max_statement_time=${String(seconds)} FOR `;
  return { prepare: (sql) => db.prepare(`${prefix}${sql}`) };
}
