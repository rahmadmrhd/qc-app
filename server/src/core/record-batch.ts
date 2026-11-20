// Pola "perencana per record" untuk rute tunggal dan batch (rancangan redesain §6.9, soft delete §4.3): satu perencana
// per aksi (`planXStatus`, `planXRemove`, `planXRestore`) memuat keadaan satu record, memeriksa hak/syarat, lalu
// mengembalikan pernyataan tulis + DTO. Rute tunggal dan rute batch memakai perencana yang SAMA: tunggal = batch
// berisi satu id. Semua record satu permintaan ditulis dalam SATU `batch()` (atomik: satu gagal = tidak ada yang
// berubah), dan penjaga CAS/kunci yang menyela membuat `runCas` memuat ulang semuanya lalu merencanakan ulang.
//
// Menambah model baru: (1) tulis `load<X>ForAction` (muat record + periksa hak, NOT_FOUND bila di luar hak),
// (2) tulis `plan<X>Status/Remove/Restore` yang mengembalikan `RecordPlan<Dto>` atau `{ unchanged }`, (3) buat
// `xxxBatch = (env, ids, ...) => runRecordBatch(env, ids, plan, { conflicts, stale })` dan bungkus tunggalnya dengan
// `runSingleRecord`. Contoh lengkap: `server/src/modules/item/service.ts` dan `brand/service.ts`.

import { mapDuplicateError } from '@server/modules/access/repo';
import type { BatchResult } from '@shared/batch';
import { isGuardFailure, runCas } from './cas';
import { type Db, DbError, type DbStatement } from './db';

/** Rencana tulis satu record: pernyataan untuk `batch()` bersama dan DTO yang dikembalikan setelah komit. */
export interface RecordPlan<T> {
  stmts: DbStatement[];
  dto: T;
}

/** Hasil perencana: rencana tulis, atau `{ unchanged }` bila keadaan sudah sama (bukan galat, tanpa audit). */
export type PlanOutcome<T> = RecordPlan<T> | { unchanged: T };

export interface RecordBatchOptions<T = unknown> {
  /** Peta konflik nama indeks (lihat `mapDuplicateError`) untuk duplikat di dalam batch. */
  conflicts: Record<string, { message: string; field: string }>;
  /** Pesan `CONFLICT` basi bila penjaga gagal berulang kali. */
  stale: string;
  /**
   * Pemeriksaan LINTAS record atas hasil semua perencana yang akan menulis (DTO-nya, urut masukan), sebelum menulis:
   * perencana hanya melihat basis data, bukan record lain dalam permintaan yang sama (mis. kunci nama yang saling
   * bertabrakan antar record yang dipulihkan sekaligus). Melempar galat = seluruh permintaan batal.
   */
  verify?: (changed: T[]) => void;
  /**
   * Dipanggil di AWAL tiap percobaan (termasuk pengulangan `runCas`) sebelum perencana dijalankan: mengosongkan
   * muatan bersama yang dibaca perencana (mis. tabel akses yang dimuat sekali per percobaan, bukan sekali per id),
   * agar percobaan ulang merencanakan dari keadaan terkini.
   */
  prepare?: () => void;
}

/**
 * Menulis satu `batch()`. Kegagalan penjaga CAS/kunci dan deadlock dilempar apa adanya agar `runCas` memuat ulang dan
 * merencanakan ulang; duplikat indeks unik dipetakan ke `CONFLICT` lewat `conflicts`.
 */
async function writeAll(
  db: Db,
  stmts: DbStatement[],
  options: RecordBatchOptions<never>,
): Promise<void> {
  try {
    await db.batch(stmts);
  } catch (error) {
    if (isGuardFailure(error) || (error instanceof DbError && error.kind === 'deadlock'))
      throw error;
    throw mapDuplicateError(error, options.conflicts);
  }
}

/**
 * Merencanakan tiap id (urut masukan, tanpa ganda) lalu menulis semuanya dalam satu `batch()`. Galat perencana
 * (NOT_FOUND, FORBIDDEN, CONFLICT syarat) membatalkan seluruh permintaan sebelum menulis apa pun. Bila semua `unchanged`,
 * tidak ada tulis sama sekali. Hasil urut sesuai masukan.
 */
export async function runRecordBatch<T>(
  env: { DB: Db },
  ids: readonly string[],
  plan: (id: string) => Promise<PlanOutcome<T>>,
  options: RecordBatchOptions<T>,
): Promise<BatchResult<T>> {
  const unique = [...new Set(ids)];
  return runCas(async () => {
    options.prepare?.();
    // Paralel (latensi), tetapi galat pertama MENURUT URUTAN MASUKAN yang dilempar (deterministik).
    const settled = await Promise.allSettled(unique.map((id) => plan(id)));
    const outcomes: PlanOutcome<T>[] = [];
    for (const entry of settled) {
      if (entry.status === 'rejected') throw entry.reason;
      outcomes.push(entry.value);
    }
    options.verify?.(outcomes.flatMap((outcome) => ('stmts' in outcome ? [outcome.dto] : [])));
    // Urutan tulis menurut id (bukan urutan masukan): dua permintaan atas himpunan record yang sama mengunci baris
    // dalam urutan yang sama, sehingga deadlock berkurang (himpunan berbeda yang berbagi merk masih dapat saling
    // menunggu; deadlock itu diulang `runCas`). Hasil tetap urut masukan.
    const order = unique
      .map((id, index) => ({ id, index }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const stmts = order.flatMap(({ index }) => {
      const outcome = outcomes[index] as PlanOutcome<T>;
      return 'stmts' in outcome ? outcome.stmts : [];
    });
    if (stmts.length > 0) await writeAll(env.DB, stmts, options);
    return {
      items: outcomes.map((outcome) => ('unchanged' in outcome ? outcome.unchanged : outcome.dto)),
    };
  }, options.stale);
}

/** Rute tunggal = batch berisi satu id; mengembalikan DTO-nya. */
export async function runSingleRecord<T>(
  env: { DB: Db },
  id: string,
  plan: (id: string) => Promise<PlanOutcome<T>>,
  options: RecordBatchOptions<T>,
): Promise<T> {
  const { items } = await runRecordBatch(env, [id], plan, options);
  return items[0] as T;
}
