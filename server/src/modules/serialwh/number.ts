import { CAS_FAIL_SQL } from '@server/core/cas';
import type { DbStatement } from '@server/core/db';
import type { Env } from '@server/core/env';
import {
  dispatchNumber,
  dispatchNumberPrefix,
  type WarehouseDispatchKind,
} from '@shared/serial-warehouse';

export interface DispatchNumberReservation {
  number: string;
  statements: DbStatement[];
}

/**
 * Memesan SATU nomor riwayat Gudang untuk (`kind`, `buCode`, `period`); `period` = `YYMM` bulan WIB hari dibuat.
 * Penghitung CAS di tabel `counters` (kunci `whd:<awalan>:<kode BU>:<YYMM>`), pola sama dengan nomor laporan Serial:
 * `statements` WAJIB ikut `batch()` yang menulis pengeluarannya; dua pengeluaran serentak tidak pernah mendapat nomor
 * sama (yang kalah memicu `CAS_FAIL_SQL` lalu `submitWarehouseChunk` mengulang evaluasi). Tanpa baris penghitung,
 * urutan dilanjutkan dari nomor tertinggi yang ada pada (awalan, BU, bulan) itu.
 */
export async function reserveDispatchNumber(
  env: Env,
  kind: WarehouseDispatchKind,
  buCode: string,
  period: string,
): Promise<DispatchNumberReservation> {
  const prefix = dispatchNumberPrefix(kind);
  const key = `whd:${prefix}:${buCode}:${period}`;
  const row = await env.DB.prepare('SELECT value FROM counters WHERE `key` = ?')
    .bind(key)
    .first<{ value: number | string }>();
  let base: number;
  let expected: number;
  if (row) {
    base = Number(row.value);
    expected = Number(row.value);
  } else {
    // '.' tepat setelah '-' (ASCII) menutup rentang awalan; kode BU diakhiri '/', jadi 'UM' dan 'UM-1' tak berbagi rentang.
    const start = `${prefix}/${buCode}/${period}-`;
    const max = await env.DB.prepare(
      'SELECT MAX(CAST(SUBSTR(number, ?) AS UNSIGNED)) AS m FROM warehouse_dispatches WHERE number >= ? AND number < ?',
    )
      .bind(start.length + 1, start, `${start.slice(0, -1)}.`)
      .first<{ m: number | string | null }>();
    base = max?.m === null || max?.m === undefined ? 0 : Number(max.m);
    expected = -1;
  }
  return {
    number: dispatchNumber(kind, buCode, period, base + 1),
    statements: [
      env.DB.prepare(
        `INSERT INTO counters (\`key\`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = CASE WHEN value = ? THEN VALUES(value) ELSE ${CAS_FAIL_SQL} END`,
      ).bind(key, base + 1, expected),
    ],
  };
}
