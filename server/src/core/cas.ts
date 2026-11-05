import { batchWrite } from '@server/modules/access/repo';
import { appError } from './errors';

/**
 * Ekspresi SQL yang melempar galat SQLite `integer overflow` bila dievaluasi: seluruh `batch()` (transaksi)
 * dibatalkan tanpa menulis apa pun. Dipakai sebagai cabang gagal `CASE` pada penjaga CAS yang DIGABUNG ke
 * pernyataan tulisnya (`CAS_UPDATED_AT_SET`, `CAS_VERSION_BUMP_SET`, penghitung nomor): satu pernyataan
 * lebih sedikit per batch daripada penjaga `SELECT` terpisah, dengan atomisitas dan kode galat yang sama.
 */
export const CAS_FAIL_SQL = 'abs(-9223372036854775808)';

/**
 * Penjaga CAS `updated_at` yang digabung ke `UPDATE` (klausa SET): `updated_at` baru ditetapkan hanya bila
 * baris masih bernilai `expected` (yang dilihat penulis); selain itu seluruh batch dibatalkan. Bind: `expected`,
 * lalu nilai baru. Item dan task tidak pernah dihapus, jadi `UPDATE` yang tak menemukan baris tidak terjadi.
 */
export const CAS_UPDATED_AT_SET = `updated_at = CASE WHEN updated_at = ? THEN ? ELSE ${CAS_FAIL_SQL} END`;

/** Penjaga CAS `version` yang digabung ke `UPDATE` (klausa SET): naik 1 bila masih `expected`. Bind: `expected`. */
export const CAS_VERSION_BUMP_SET = `version = CASE WHEN version = ? THEN version + 1 ELSE ${CAS_FAIL_SQL} END`;

const GUARD_FAILED = /integer overflow/i;

export function isGuardFailure(error: unknown): boolean {
  return error instanceof Error && GUARD_FAILED.test(error.message);
}

/** `batchWrite` yang memetakan kegagalan penjaga CAS ke `CONFLICT(staleMessage)`. */
export async function batchGuarded(
  db: D1Database,
  statements: D1PreparedStatement[],
  conflicts: Record<string, { message: string; field: string }>,
  staleMessage: string,
): Promise<D1Result[]> {
  try {
    return await batchWrite(db, statements, conflicts);
  } catch (error) {
    if (isGuardFailure(error)) throw appError('CONFLICT', staleMessage);
    throw error;
  }
}

/** Kegagalan tulis yang aman diulang setelah memuat ulang keadaan: penjaga CAS atau rebutan kunci unik. */
export function isRetryableWriteError(error: unknown): boolean {
  if (isGuardFailure(error)) return true;
  return (
    error instanceof Error &&
    /UNIQUE constraint failed: (customers\.key|handovers\.number|brands\.key|counters\.key)/i.test(
      error.message,
    )
  );
}

/**
 * Menjalankan `attempt` (muat keadaan -> hitung -> `batch` dengan penjaga). Bila batch dibatalkan penjaga
 * CAS/kunci unik karena penulis lain, keadaan dimuat ulang dan `attempt` diulang (hingga `attempts` kali);
 * setelah itu CONFLICT.
 */
export async function runCas<T>(
  attempt: () => Promise<T>,
  staleMessage: string,
  attempts = 3,
): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await attempt();
    } catch (error) {
      if (!isRetryableWriteError(error)) throw error;
      last = error;
    }
  }
  console.error(`CAS gagal setelah ${attempts} percobaan: ${String(last)}`);
  throw appError('CONFLICT', staleMessage);
}
