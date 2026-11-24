import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Db } from './db';

export interface Migration {
  name: string;
  sql: string;
}

// Migrator MariaDB: berkas `*.sql` bernomor di `server/migrations/` (urut nama), dibaca dari disk.
const MIGRATIONS_DIR = join(import.meta.dir, '..', '..', 'migrations');
// Huruf kecil saja: sama dengan pola di `deploy/deploy.sh` (pagar downgrade skema).
const MIGRATION_FILE_PATTERN = /^\d{4}_[a-z0-9_]+\.sql$/;

/** Baca migrasi dari disk, urut nama berkas. */
export async function loadMigrations(dir: string = MIGRATIONS_DIR): Promise<Migration[]> {
  const names = (await readdir(dir)).filter((name) => MIGRATION_FILE_PATTERN.test(name)).sort();
  return Promise.all(
    names.map(async (name) => ({ name, sql: await Bun.file(join(dir, name)).text() })),
  );
}

/** Sidik jari isi semua migrasi (nama + SQL); harness tes menyegarkan skema templat bila berubah. */
export function hashMigrations(migrations: readonly Migration[]): string {
  const hasher = new Bun.CryptoHasher('sha256');
  for (const migration of migrations) hasher.update(`${migration.name}\n${migration.sql}\n`);
  return hasher.digest('hex');
}

/**
 * Terapkan migrasi yang belum tercatat di `schema_migrations`, berurutan; kembalikan nama yang baru
 * diterapkan. DDL MariaDB tidak transaksional (implicit commit): berkas migrasi gagal di tengah dapat
 * meninggalkan sebagian tabel dan TIDAK dicatat; karena itu DDL baseline memakai `IF NOT EXISTS` agar
 * dapat diulang. SQL migrasi tepercaya (dijalankan lewat `Db.exec`, banyak pernyataan sekaligus).
 */
export async function applyMigrations(db: Db, migrations?: Migration[]): Promise<string[]> {
  const list = migrations ?? (await loadMigrations());
  await db
    .prepare(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name VARCHAR(255) NOT NULL, applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY (name)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin',
    )
    .run();
  const applied = await db.prepare('SELECT name FROM schema_migrations').all<{ name: string }>();
  const done = new Set(applied.results.map((row) => row.name));
  const newlyApplied: string[] = [];
  for (const migration of list) {
    if (done.has(migration.name)) continue;
    await db.exec(migration.sql);
    await db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').bind(migration.name).run();
    newlyApplied.push(migration.name);
  }
  return newlyApplied;
}
