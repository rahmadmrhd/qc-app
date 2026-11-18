import { CAS_FAIL_SQL, isGuardFailure } from '@server/core/cas';
import { DbError, type DbStatement, type Preparer } from '@server/core/db';
import type { Env } from '@server/core/env';
import { isAppError, staleError } from '@server/core/errors';
import { serialCaseNumber } from '@shared/serials';

/**
 * Kasus tidak lolos (`serial_cases`) dan nomor `LP/<kode BU>/YYMM-iiii` (keputusan pemilik 2026-11-18). Nomor dibagikan
 * penghitung CAS di tabel `counters` (kunci `lp:<kode BU>:YYMM`, per BU dan bulan WIB; pola nomor serah terima `ST-…`):
 * penjaga digabung ke pernyataan penyimpan, jadi dua kasus serentak tidak pernah mendapat nomor sama dan salah satunya
 * diulang oleh `runWithCaseNumber`. Nomor lama `LP-YYYYMMDD-NNN` tetap sah, tidak ikut urutan baru, dan tidak diubah.
 * Penulis tabel ini hanya berkas ini (INSERT dan UPDATE; tidak pernah DELETE).
 */

export interface CaseReservation {
  number: string;
  statements: DbStatement[];
}

/**
 * Memesan SATU nomor kasus untuk (`buCode`, `period`): `period` = `YYMM` bulan WIB hari dibuat (`caseNumberPeriod`).
 * `statements` (penjaga + simpan penghitung) WAJIB ikut `batch()` yang menulis kasusnya. Tanpa baris penghitung, urutan
 * dilanjutkan dari nomor tertinggi yang ada pada (BU, bulan) itu.
 */
export async function reserveCaseNumber(
  env: Env,
  buCode: string,
  period: string,
): Promise<CaseReservation> {
  const key = `lp:${buCode}:${period}`;
  const row = await env.DB.prepare('SELECT value FROM counters WHERE `key` = ?')
    .bind(key)
    .first<{ value: number }>();
  let base: number;
  let expected: number;
  if (row) {
    base = Number(row.value);
    expected = Number(row.value);
  } else {
    // Awalan 'LP/<BU>/YYMM-' diikuti urutan; '.' tepat setelah '-' (ASCII) menutup rentang awalan. Kode BU berpola
    // ^[A-Z0-9-]+$ dan diakhiri '/', jadi 'UM' dan 'UM-1' tidak pernah berbagi rentang.
    const prefix = `LP/${buCode}/${period}-`;
    const max = await env.DB.prepare(
      'SELECT MAX(CAST(SUBSTR(number, ?) AS UNSIGNED)) AS m FROM serial_cases WHERE number >= ? AND number < ?',
    )
      .bind(prefix.length + 1, prefix, `LP/${buCode}/${period}.`)
      .first<{ m: number | string | null }>();
    base = max?.m === null || max?.m === undefined ? 0 : Number(max.m);
    expected = -1;
  }
  return {
    number: serialCaseNumber(buCode, period, base + 1),
    // Penjaga + simpan dalam SATU pernyataan: nilai yang sudah berubah membatalkan batch (galat 1690); baris yang
    // belum ada disisipkan, dan penulis serentak yang menyisipkannya lebih dulu memicu cabang gagal atau PRIMARY.
    statements: [
      env.DB.prepare(
        `INSERT INTO counters (\`key\`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = CASE WHEN value = ? THEN VALUES(value) ELSE ${CAS_FAIL_SQL} END`,
      ).bind(key, base + 1, expected),
    ],
  };
}

export interface NewCase {
  id: string;
  number: string;
  serialId: string;
  buId: string;
  openedOn: string;
  now: string;
  actorEmail: string;
  /** Lokasi unit saat dilaporkan; dipakai sebagai lokasi QC asal sampai Kirim ke servis memperbaruinya. */
  originLocationId?: string;
}

export function insertCaseStmt(db: Preparer, c: NewCase): DbStatement {
  return db
    .prepare(
      'INSERT INTO serial_cases (id, number, serial_id, bu_id, opened_on, origin_location_id, created_at, created_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      c.id,
      c.number,
      c.serialId,
      c.buId,
      c.openedOn,
      c.originLocationId ?? '',
      c.now,
      c.actorEmail,
      c.now,
    );
}

/**
 * Mencatat lokasi QC asal laporan (lokasi unit saat Kirim ke servis); dipulihkan sebagai lokasi unit saat Terima di QC.
 * Dipasang ke `batch()` aksi kirim (kasus ada: dimuat dalam percobaan yang sama; serial yang sama terkunci CAS).
 */
export function setCaseOriginStmt(
  db: Preparer,
  caseId: string,
  locationId: string,
  now: string,
): DbStatement {
  return db
    .prepare('UPDATE serial_cases SET origin_location_id = ?, updated_at = ? WHERE id = ?')
    .bind(locationId, now, caseId);
}

/**
 * Menutup kasus. Penjaga: kasus yang sudah tertutup (`closed_on` terisi) membatalkan seluruh batch (`CAS_FAIL_SQL`),
 * jadi penutupan ganda yang berebut tidak lolos diam-diam.
 */
export function closeCaseStmt(
  db: Preparer,
  caseId: string,
  outcome: 'good' | 'broken',
  closedOn: string,
  now: string,
): DbStatement {
  return db
    .prepare(
      `UPDATE serial_cases SET closed_on = CASE WHEN closed_on = '' THEN ? ELSE ${CAS_FAIL_SQL} END, outcome = ?, updated_at = ? WHERE id = ?`,
    )
    .bind(closedOn, outcome, now, caseId);
}

export interface SerialCaseRow {
  id: string;
  number: string;
  serial_id: string;
  bu_id: string;
  opened_on: string;
  closed_on: string;
  outcome: string;
  /** Lokasi QC asal (diisi saat Kirim ke servis); '' bila belum pernah dikirim. */
  origin_location_id: string;
  created_at: string;
  created_by: string;
}

const CASE_COLUMNS =
  'id, number, serial_id, bu_id, opened_on, closed_on, outcome, origin_location_id, created_at, created_by';

/** Semua kasus sebuah serial, terbaru dulu. */
export async function loadCases(db: Preparer, serialId: string): Promise<SerialCaseRow[]> {
  const rows = await db
    .prepare(
      `SELECT ${CASE_COLUMNS} FROM serial_cases WHERE serial_id = ? ORDER BY created_at DESC, number DESC`,
    )
    .bind(serialId)
    .all<SerialCaseRow>();
  return rows.results;
}

/** Satu kasus, atau `null`. */
export async function loadCase(db: Preparer, caseId: string): Promise<SerialCaseRow | null> {
  return db
    .prepare(`SELECT ${CASE_COLUMNS} FROM serial_cases WHERE id = ?`)
    .bind(caseId)
    .first<SerialCaseRow>();
}

/** Percobaan ulang bila penghitung nomor/serial diperebutkan (pola `CREATE_TASKS_ATTEMPTS` serah terima). */
export const CASE_NUMBER_ATTEMPTS = 10;

const CASE_RETRYABLE_KEYS = new Set(['PRIMARY', 'serial_cases_number']);

function isCaseContention(error: unknown): boolean {
  if (isGuardFailure(error)) return true;
  if (isAppError(error)) return error.stale === true;
  if (error instanceof DbError) {
    if (error.kind === 'deadlock') return true;
    return (
      error.kind === 'duplicate' && error.key !== undefined && CASE_RETRYABLE_KEYS.has(error.key)
    );
  }
  return false;
}

/**
 * Menjalankan `attempt` (muat keadaan, pesan nomor, `batch`) dan mengulangnya bila batch dibatalkan oleh penjaga
 * penghitung/CAS atau duplikat nomor. Penjaga serial dan penghitung LP sama-sama `CAS_FAIL_SQL`, jadi kegagalan tak
 * dapat dibedakan dari galatnya: BACA ULANG `updated_at` serial. Bila sama dengan `expectedUpdatedAt`, penyebabnya
 * penghitung (ulangi, maks. `CASE_NUMBER_ATTEMPTS`); bila berbeda, serial benar-benar berubah (stale, 412).
 * `expectedUpdatedAt = null` (serial baru): selalu ulangi. `attempt` boleh melempar galat mentah (`DbError` penjaga/
 * duplikat) atau `staleError`; galat lain diteruskan apa adanya.
 */
export async function runWithCaseNumber<T>(
  env: Env,
  serialId: string,
  expectedUpdatedAt: string | null,
  attempt: () => Promise<T>,
  staleMessage: string,
): Promise<T> {
  for (let i = 0; i < CASE_NUMBER_ATTEMPTS; i++) {
    try {
      return await attempt();
    } catch (error) {
      if (!isCaseContention(error)) throw error;
      if (expectedUpdatedAt !== null) {
        const current = await env.DB.prepare('SELECT updated_at FROM serials WHERE id = ?')
          .bind(serialId)
          .first<{ updated_at: string }>();
        if (!current || current.updated_at !== expectedUpdatedAt) throw staleError(staleMessage);
      }
    }
  }
  console.error(`Nomor kasus gagal dipesan setelah ${CASE_NUMBER_ATTEMPTS} percobaan`);
  throw staleError(staleMessage);
}
