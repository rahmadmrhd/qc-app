import { batchWrite } from '@server/modules/access/repo';
import { type Db, DbError, type DbResult, type DbStatement, type Preparer } from './db';
import { staleError } from './errors';
import { baseIndexName } from './index-names';

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

/**
 * Penjaga nama baris master (`brands`/`customers`) untuk perubahan STATUS: mengunci baris (`FOR UPDATE`) dan
 * membatalkan batch (`CAS_FAIL_SQL`) bila namanya bukan yang dibaca penulis. Dengan begitu audit dan DTO memakai nama
 * dari keadaan yang sama dengan yang dijaga; ganti nama yang menyela membuat `runCas` memuat ulang.
 */
export function nameGuardStmt(
  db: Preparer,
  table: 'brands' | 'customers',
  id: string,
  expectedName: string,
): DbStatement {
  return db
    .prepare(
      `SELECT CASE WHEN name = ? THEN 1 ELSE ${CAS_FAIL_SQL} END AS guard_ok FROM ${table} WHERE id = ? FOR UPDATE`,
    )
    .bind(expectedName, id);
}

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
    if (isGuardFailure(error)) throw staleError(staleMessage);
    throw error;
  }
}

/**
 * Indeks UNIK yang diperebutkan penulis serentak dan aman diulang setelah memuat ulang keadaan: nama merk/customer
 * (kunci ternormalisasi), nomor serah terima, kunci idempoten klien (`clientId` task/komentar Serah Terima), dan kunci penghitung (PRIMARY KEY `counters`; MariaDB tidak
 * menyebut tabel pada galat duplikat, jadi 'PRIMARY' dihitung; percobaan ulang dibatasi sehingga galat PK lain
 * berakhir CONFLICT).
 */
export const RETRYABLE_UNIQUE_KEYS = new Set([
  'customers_key',
  'handovers_number',
  'handovers_client_id',
  'handover_comments_client_id',
  'brands_key',
  'PRIMARY',
]);

export function isRetryableWriteError(error: unknown): boolean {
  if (isGuardFailure(error)) return true;
  // Deadlock (1213) / lock wait timeout (1205) yang lolos dari ulang sekali di `Db.batch`: muat ulang dan ulangi.
  if (error instanceof DbError && error.kind === 'deadlock') return true;
  return (
    error instanceof DbError &&
    error.kind === 'duplicate' &&
    error.key !== undefined &&
    RETRYABLE_UNIQUE_KEYS.has(baseIndexName(error.key))
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
  // Hanya errno/kind/key: pesan mentah galat duplikat memuat nilai (nama customer, nomor) yang tidak boleh masuk log.
  const detail =
    last instanceof DbError
      ? `errno=${last.errno} kind=${last.kind}${last.key === undefined ? '' : ` key=${last.key}`}`
      : 'galat non-DB';
  console.error(`CAS gagal setelah ${attempts} percobaan: ${detail}`);
  throw staleError(staleMessage);
}
