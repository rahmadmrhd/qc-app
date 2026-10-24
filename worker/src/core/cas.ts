import { batchWrite } from '@worker/modules/access/repo';
import { appError } from './errors';

/**
 * Penjaga CAS (compare-and-swap) untuk `batch()`: pernyataan ini melempar galat SQLite
 * `integer overflow` bila baris `table.id` tidak (lagi) memiliki `column = expected`, sehingga SELURUH
 * batch dibatalkan (transaksi) tanpa menulis apa pun. Ditaruh sebagai pernyataan PERTAMA batch.
 * Tidak menulis baris (tidak memakan kuota tulis D1).
 */
export function guardRow(
  db: D1Database,
  table: 'items' | 'handovers',
  id: string,
  column: 'updated_at' | 'version',
  expected: string | number,
): D1PreparedStatement {
  return db
    .prepare(
      `SELECT CASE WHEN EXISTS (SELECT 1 FROM ${table} WHERE id = ? AND ${column} = ?) THEN 1 ELSE abs(-9223372036854775808) END`,
    )
    .bind(id, expected);
}

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
): Promise<void> {
  try {
    await batchWrite(db, statements, conflicts);
  } catch (error) {
    if (isGuardFailure(error)) throw appError('CONFLICT', staleMessage);
    throw error;
  }
}

/** Penjaga umum: batch dibatalkan (integer overflow) bila `conditionSql` tidak benar. */
export function guardCondition(
  db: D1Database,
  conditionSql: string,
  ...binds: unknown[]
): D1PreparedStatement {
  return db
    .prepare(`SELECT CASE WHEN (${conditionSql}) THEN 1 ELSE abs(-9223372036854775808) END`)
    .bind(...binds);
}

/** Kegagalan tulis yang aman diulang setelah memuat ulang keadaan: penjaga CAS atau rebutan kunci unik. */
export function isRetryableWriteError(error: unknown): boolean {
  if (isGuardFailure(error)) return true;
  return (
    error instanceof Error &&
    /UNIQUE constraint failed: (customers\.key|handovers\.number|brands\.key)/i.test(error.message)
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
