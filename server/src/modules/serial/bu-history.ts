import { CAS_FAIL_SQL } from '@server/core/cas';
import { DbError, type DbStatement, type Preparer } from '@server/core/db';
import type { Env } from '@server/core/env';

/**
 * Riwayat BU serial (spek serial unik se-sistem §4.1): `serials.bu_id` = BU SAAT INI; `serial_business_units` mencatat
 * semua BU yang pernah memegang serial (`left_at` kosong = BU saat ini). Kunci utama (serial_id, bu_id) menegakkan
 * "BU yang sudah ditinggalkan tidak boleh dimasuki lagi".
 */

/** Nama dasar indeks unik serial se-sistem (dipetakan di `SERIAL_CONFLICTS`); indeks `serials_serial` LAMA dibuang `ensureSerialUniqueIndex`. */
export const SERIAL_UNIQUE_INDEX = 'serials_serial';

/** Indeks unik per BU peninggalan (bu_id, serial); dibuang `ensureSerialUniqueIndex` setelah `serials_serial_live` ada. */
const LEGACY_BU_SERIAL_INDEX = 'serials_bu_serial';

/**
 * Padanan soft delete (`serial`, `deleted_at`): serial terhapus dan serial baru berkunci sama dapat hidup berdampingan.
 * Dipetakan ke konflik yang sama lewat `baseIndexName`. Satu-satunya penjaga keunikan serial setelah contract.
 */
export const SERIAL_LIVE_INDEX = 'serials_serial_live';

/**
 * Pengisi idempoten: satu baris "BU saat ini" untuk setiap serial yang belum punya baris untuk `bu_id`-nya. Dijalankan
 * tiap start server agar image lama yang menulis serial tanpa baris penghubung (rollback) pulih saat maju lagi.
 */
export async function backfillSerialBusinessUnits(env: Env): Promise<void> {
  await env.DB.prepare(
    "INSERT IGNORE INTO serial_business_units (serial_id, bu_id, first_at, left_at) SELECT s.id, s.bu_id, s.created_at, '' FROM serials s WHERE NOT EXISTS (SELECT 1 FROM serial_business_units b WHERE b.serial_id = s.id AND b.bu_id = s.bu_id)",
  ).run();
}

async function hasIndex(env: Env, name: string): Promise<boolean> {
  const present = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?',
  )
    .bind('serials', name)
    .first<{ n: number | string }>();
  return Number(present?.n ?? 0) > 0;
}

/**
 * Memasang penjaga keunikan serial se-sistem setelah migrasi contract soft delete (0030): indeks unik
 * `serials_serial_live (serial, deleted_at)`, lalu membuang indeks lama `serials_serial` (se-sistem) dan
 * `serials_bu_serial` (per BU) yang menjangkau baris terhapus juga. Idempoten, dipanggil tiap start setelah migrasi.
 *
 * - Indeks `_live` belum ada: serial ganda dihitung menurut (`serial`, `deleted_at`) (serial terhapus dan serial baru
 *   berkunci sama BOLEH berdampingan). Ada ganda lintas BU = `'duplicates'`: dicatat sebagai SATU peringatan (hanya
 *   jumlahnya, tanpa nilai serial), tak ada indeks yang dibuat atau dibuang, dan start TIDAK digagalkan; keunikan dijaga
 *   aplikasi (dan `serials_bu_serial` yang masih ada) sampai skrip penyatuan dijalankan. Tanpa ganda = dibuat (`'created'`).
 * - Indeks `_live` sudah ada: indeks lama yang masih tersisa dibuang SETELAH itu (bukan sebelumnya, agar serial tak pernah
 *   tanpa penjaga indeks sama sekali), hasil `'exists'`.
 *
 * Ini SATU-SATUNYA pembuat indeks (migrasi 0026 dan 0030 tidak membuatnya: pemeriksa dump pemulihan menolak PREPARE/SET
 * @var). Templat tes (`test-support/test-db.ts`) memanggilnya juga, supaya tes punya penjaga DB yang sama dengan produksi.
 */
export async function ensureSerialUniqueIndex(
  env: Env,
): Promise<'created' | 'exists' | 'duplicates'> {
  let result: 'created' | 'exists' = 'exists';
  if (!(await hasIndex(env, SERIAL_LIVE_INDEX))) {
    const dups = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM (SELECT 1 FROM serials GROUP BY serial, deleted_at HAVING COUNT(*) > 1) AS d',
    ).first<{ n: number | string }>();
    const duplicateCount = Number(dups?.n ?? 0);
    if (duplicateCount > 0) {
      console.warn(
        `Indeks unik ${SERIAL_LIVE_INDEX} belum dibuat: ada ${duplicateCount} kelompok Serial Number ganda (serial sama dengan deleted_at sama, lintas BU). Yang masih hidup disatukan dengan skrip penyatuan; ganda yang sama-sama TERHAPUS pada deleted_at yang sama juga menahan indeks dan tidak ditangani skrip (skrip mengabaikan serial terhapus): bedakan deleted_at salah satunya secara manual.`,
      );
      return 'duplicates';
    }
    try {
      await env.DB.prepare(
        `CREATE UNIQUE INDEX ${SERIAL_LIVE_INDEX} ON serials (serial, deleted_at)`,
      ).run();
    } catch (error) {
      // Serial ganda masuk di antara pemeriksaan dan pembuatan indeks: tetap tidak menggagalkan start.
      if (error instanceof DbError && error.kind === 'duplicate') {
        console.warn(`Indeks unik ${SERIAL_LIVE_INDEX} gagal dibuat: ada Serial Number ganda.`);
        return 'duplicates';
      }
      throw error;
    }
    result = 'created';
  }
  for (const legacy of [SERIAL_UNIQUE_INDEX, LEGACY_BU_SERIAL_INDEX]) {
    if (await hasIndex(env, legacy)) {
      await env.DB.prepare(`DROP INDEX ${legacy} ON serials`).run();
    }
  }
  return result;
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

/** `involvedBuIds` untuk banyak serial sekaligus (satu kueri): id serial -> BU yang pernah memegangnya (BU saat ini ikut). */
export async function involvedBuIdsMany(
  db: Preparer,
  serialIds: readonly string[],
): Promise<Map<string, string[]>> {
  const result = new Map<string, Set<string>>();
  if (serialIds.length === 0) return new Map();
  const marks = serialIds.map(() => '?').join(', ');
  const rows = await db
    .prepare(
      `SELECT serial_id AS id, bu_id FROM serial_business_units WHERE serial_id IN (${marks}) UNION SELECT id, bu_id FROM serials WHERE id IN (${marks})`,
    )
    .bind(...serialIds, ...serialIds)
    .all<{ id: string; bu_id: string }>();
  for (const row of rows.results) {
    const id = row.id.trim();
    const set = result.get(id) ?? new Set<string>();
    set.add(row.bu_id.trim());
    result.set(id, set);
  }
  return new Map([...result].map(([id, set]) => [id, [...set]]));
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
