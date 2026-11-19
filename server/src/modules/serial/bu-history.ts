import { CAS_FAIL_SQL } from '@server/core/cas';
import { DbError, type DbStatement, type Preparer } from '@server/core/db';
import type { Env } from '@server/core/env';

/**
 * Riwayat BU serial (spek serial unik se-sistem §4.1): `serials.bu_id` = BU SAAT INI; `serial_business_units` mencatat
 * semua BU yang pernah memegang serial (`left_at` kosong = BU saat ini). Kunci utama (serial_id, bu_id) menegakkan
 * "BU yang sudah ditinggalkan tidak boleh dimasuki lagi".
 */

/** Nama indeks unik serial se-sistem (dipetakan di `SERIAL_CONFLICTS`). */
export const SERIAL_UNIQUE_INDEX = 'serials_serial';

/**
 * Pengisi idempoten: satu baris "BU saat ini" untuk setiap serial yang belum punya baris untuk `bu_id`-nya. Dijalankan
 * tiap start server agar image lama yang menulis serial tanpa baris penghubung (rollback) pulih saat maju lagi.
 */
export async function backfillSerialBusinessUnits(env: Env): Promise<void> {
  await env.DB.prepare(
    "INSERT IGNORE INTO serial_business_units (serial_id, bu_id, first_at, left_at) SELECT s.id, s.bu_id, s.created_at, '' FROM serials s WHERE NOT EXISTS (SELECT 1 FROM serial_business_units b WHERE b.serial_id = s.id AND b.bu_id = s.bu_id)",
  ).run();
}

/**
 * Membuat indeks unik `serials_serial` bila belum ada dan tidak ada serial ganda (idempoten, dipanggil tiap start
 * setelah migrasi). Ada serial ganda lintas BU = `'duplicates'`: dicatat sebagai peringatan (hanya jumlahnya, tanpa
 * nilai serial) dan start TIDAK digagalkan; keunikan dijaga aplikasi sampai skrip penyatuan dijalankan.
 *
 * Ini SATU-SATUNYA pembuat indeks (migrasi 0026 tidak membuatnya: pemeriksa dump pemulihan menolak PREPARE/SET @var).
 * Templat tes (`test-support/test-db.ts`) memanggilnya juga, supaya tes punya penjaga DB yang sama dengan produksi.
 */
export async function ensureSerialUniqueIndex(
  env: Env,
): Promise<'created' | 'exists' | 'duplicates'> {
  const present = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?',
  )
    .bind('serials', SERIAL_UNIQUE_INDEX)
    .first<{ n: number | string }>();
  if (Number(present?.n ?? 0) > 0) return 'exists';
  const dups = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM (SELECT 1 FROM serials GROUP BY serial HAVING COUNT(*) > 1) AS d',
  ).first<{ n: number | string }>();
  const duplicateCount = Number(dups?.n ?? 0);
  if (duplicateCount > 0) {
    console.warn(
      `Indeks unik ${SERIAL_UNIQUE_INDEX} belum dibuat: ada ${duplicateCount} Serial Number ganda lintas BU. Jalankan skrip penyatuan.`,
    );
    return 'duplicates';
  }
  try {
    await env.DB.prepare(`CREATE UNIQUE INDEX ${SERIAL_UNIQUE_INDEX} ON serials (serial)`).run();
  } catch (error) {
    // Serial ganda masuk di antara pemeriksaan dan pembuatan indeks: tetap tidak menggagalkan start.
    if (error instanceof DbError && error.kind === 'duplicate') {
      console.warn(`Indeks unik ${SERIAL_UNIQUE_INDEX} gagal dibuat: ada Serial Number ganda.`);
      return 'duplicates';
    }
    throw error;
  }
  return 'created';
}

/** Semua BU yang pernah memegang serial (termasuk BU saat ini, juga bila baris penghubungnya belum terisi). */
export async function involvedBuIds(db: Preparer, serialId: string): Promise<string[]> {
  const rows = await db
    .prepare(
      'SELECT bu_id FROM serial_business_units WHERE serial_id = ? UNION SELECT bu_id FROM serials WHERE id = ?',
    )
    .bind(serialId, serialId)
    .all<{ bu_id: string }>();
  return rows.results.map((row) => row.bu_id.trim());
}

/**
 * Pernyataan pemindahan BU untuk `batch()` yang sama dengan kejadian cek ulang:
 *  1. memastikan baris BU asal ada (serial tanpa baris penghubung karena image lama),
 *  2. menandai BU asal ditinggalkan (`left_at`),
 *  3. menyisipkan baris BU tujuan: kunci utama ganda = BU itu pernah terlibat, `batch()` gagal dengan `DbError`
 *     `duplicate` (key `PRIMARY`; `runCas` mengulang dan pemanggil menilai ulang, BU itu kini terlarang),
 *  4. mengganti `serials.bu_id`, dijaga: bukan lagi `fromBuId` = seluruh batch dibatalkan (`CAS_FAIL_SQL`).
 */
export function moveBuStatements(
  env: Env,
  input: { serialId: string; fromBuId: string; toBuId: string; now: string },
): DbStatement[] {
  const { serialId, fromBuId, toBuId, now } = input;
  return [
    env.DB.prepare(
      "INSERT IGNORE INTO serial_business_units (serial_id, bu_id, first_at, left_at) SELECT id, bu_id, created_at, '' FROM serials WHERE id = ? AND bu_id = ?",
    ).bind(serialId, fromBuId),
    env.DB.prepare(
      "UPDATE serial_business_units SET left_at = ? WHERE serial_id = ? AND bu_id = ? AND left_at = ''",
    ).bind(now, serialId, fromBuId),
    env.DB.prepare(
      "INSERT INTO serial_business_units (serial_id, bu_id, first_at, left_at) VALUES (?, ?, ?, '')",
    ).bind(serialId, toBuId, now),
    env.DB.prepare(
      `UPDATE serials SET bu_id = CASE WHEN bu_id = ? THEN ? ELSE ${CAS_FAIL_SQL} END WHERE id = ?`,
    ).bind(fromBuId, toBuId, serialId),
  ];
}

/**
 * Fragmen WHERE visibilitas baca (spek §5.3): serial terlihat bila BU saat ini ATAU salah satu BU di riwayatnya ada di
 * daftar yang dapat dibaca. Bentuk dua jalan menoleransi baris penghubung yang belum terisi. Pemanggil mengikat daftar
 * BU DUA KALI berturut-turut (pertama untuk `bu_id`, kedua untuk subkueri). `buCount` 0 = tidak ada yang terlihat
 * (`1 = 0`, tanpa bind).
 */
export function readableSerialSql(alias: string, buCount: number): string {
  if (buCount <= 0) return '(1 = 0)';
  const marks = Array.from({ length: buCount }, () => '?').join(', ');
  return `(${alias}.bu_id IN (${marks}) OR ${alias}.id IN (SELECT serial_id FROM serial_business_units WHERE bu_id IN (${marks})))`;
}
