import { batchWrite } from '@server/modules/access/repo';
import { type Db, DbError, type DbResult, type DbStatement } from './db';
import { appError } from './errors';

/**
 * Ekspresi SQL yang melempar galat MariaDB `ER_DATA_OUT_OF_RANGE` (1690, "BIGINT value is out of range") bila
 * dievaluasi (mode STRICT): seluruh `batch()` (transaksi) dibatalkan tanpa menulis apa pun. Dipakai sebagai cabang
 * gagal `CASE` pada penjaga CAS yang DIGABUNG ke pernyataan tulisnya (`CAS_UPDATED_AT_SET`, `CAS_VERSION_BUMP_SET`,
 * penghitung nomor): satu pernyataan lebih sedikit per batch daripada penjaga `SELECT` terpisah, dengan atomisitas
 * dan kode galat yang sama. `DbError.kind` = 'out_of_range'.
 */
export const CAS_FAIL_SQL = '(-9223372036854775807 - 2)';

/**
 * Penjaga CAS `updated_at` yang digabung ke `UPDATE` (klausa SET): `updated_at` baru ditetapkan hanya bila
 * baris masih bernilai `expected` (yang dilihat penulis); selain itu seluruh batch dibatalkan. Bind: `expected`,
 * lalu nilai baru. Item dan task tidak pernah dihapus, jadi `UPDATE` yang tak menemukan baris tidak terjadi.
 */
export const CAS_UPDATED_AT_SET = `updated_at = CASE WHEN updated_at = ? THEN ? ELSE ${CAS_FAIL_SQL} END`;

/** Penjaga CAS `version` yang digabung ke `UPDATE` (klausa SET): naik 1 bila masih `expected`. Bind: `expected`. */
export const CAS_VERSION_BUMP_SET = `version = CASE WHEN version = ? THEN version + 1 ELSE ${CAS_FAIL_SQL} END`;

export function isGuardFailure(error: unknown): boolean {
  return error instanceof DbError && error.kind === 'out_of_range';
}

/** `batchWrite` yang memetakan kegagalan penjaga CAS ke `CONFLICT(staleMessage)`. */
export async function batchGuarded(
  db: Db,
  statements: DbStatement[],
  conflicts: Record<string, { message: string; field: string }>,
  staleMessage: string,
): Promise<DbResult[]> {
  try {
    return await batchWrite(db, statements, conflicts);
  } catch (error) {
    if (isGuardFailure(error)) throw appError('CONFLICT', staleMessage);
    throw error;
  }
}

/**
 * Indeks UNIK yang diperebutkan penulis serentak dan aman diulang setelah memuat ulang keadaan: nama merk/customer
 * (kunci ternormalisasi), nomor serah terima, dan kunci penghitung (PRIMARY KEY `counters`; MariaDB tidak
 * menyebut tabel pada galat duplikat, jadi 'PRIMARY' dihitung; percobaan ulang dibatasi sehingga galat PK lain
 * berakhir CONFLICT).
 */
const RETRYABLE_UNIQUE_KEYS = new Set([
  'customers_key',
  'handovers_number',
  'brands_key',
  'PRIMARY',
]);

export function isRetryableWriteError(error: unknown): boolean {
  if (isGuardFailure(error)) return true;
  return (
    error instanceof DbError &&
    error.kind === 'duplicate' &&
    error.key !== undefined &&
    RETRYABLE_UNIQUE_KEYS.has(error.key)
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
