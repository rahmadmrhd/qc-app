import { type Db, toDbError } from '@server/core/db';
import { applyMigrations, loadMigrations, type Migration } from '@server/core/migrate';

/** Galat persiapan start: `connect` = MariaDB tak terjangkau, `migrate` = sebuah migrasi gagal. `main.ts` keluar kode 1. */
export class StartupError extends Error {
  readonly stage: 'connect' | 'migrate';

  constructor(stage: 'connect' | 'migrate', message: string, cause: unknown) {
    super(message, { cause });
    this.name = 'StartupError';
    this.stage = stage;
  }
}

/**
 * Persiapan basis data sebelum server mendengarkan: cek koneksi (`SELECT 1`), lalu terapkan migrasi yang belum
 * tercatat, satu per satu supaya galat menyebut migrasi yang gagal. Gagal cepat: proses tidak boleh melayani
 * permintaan di atas skema yang setengah jadi. Mengembalikan nama migrasi yang baru diterapkan.
 *
 * DDL MariaDB tidak transaksional dan migrasi ditulis idempoten (`IF NOT EXISTS`), jadi migrasi yang gagal di
 * tengah aman diulang pada start berikutnya. Satu kontainer `qc-app` per lingkungan: tidak ada dua proses yang
 * memigrasi skema yang sama serentak.
 */
export async function prepareDatabase(db: Db, migrations?: Migration[]): Promise<string[]> {
  try {
    await db.prepare('SELECT 1').first();
  } catch (error) {
    throw new StartupError(
      'connect',
      `Basis data tidak terjangkau: ${toDbError(error).message}`,
      error,
    );
  }
  const list = migrations ?? (await loadMigrations());
  const applied: string[] = [];
  for (const migration of list) {
    try {
      applied.push(...(await applyMigrations(db, [migration])));
    } catch (error) {
      throw new StartupError(
        'migrate',
        `Migrasi ${migration.name} gagal: ${toDbError(error).message}`,
        error,
      );
    }
  }
  return applied;
}
