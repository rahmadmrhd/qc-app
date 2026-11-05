import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import init from '../../migrations/0001_init.sql' with { type: 'text' };
import handoverCommentsJobs from '../../migrations/0002_handover_comments_jobs.sql' with {
  type: 'text',
};
import boardStatus from '../../migrations/0003_handover_board_status.sql' with { type: 'text' };
import accessUnique from '../../migrations/0004_access_unique.sql' with { type: 'text' };
import brandCustomerUnique from '../../migrations/0005_brand_customer_unique.sql' with {
  type: 'text',
};
import settings from '../../migrations/0006_settings.sql' with { type: 'text' };
import itemsUnique from '../../migrations/0007_items_unique_alias_keys.sql' with { type: 'text' };
import jobsQueue from '../../migrations/0008_jobs_queue.sql' with { type: 'text' };
import itemAliasIndex from '../../migrations/0009_item_alias_index_brand_count.sql' with {
  type: 'text',
};
import type { Db } from './db';

export interface Migration {
  name: string;
  sql: string;
}

/** Daftar statis berurutan; deploy memakai `wrangler d1 migrations apply`, tes memakai ini. */
export const D1_MIGRATIONS: Migration[] = [
  { name: '0001_init.sql', sql: init },
  { name: '0002_handover_comments_jobs.sql', sql: handoverCommentsJobs },
  { name: '0003_handover_board_status.sql', sql: boardStatus },
  { name: '0004_access_unique.sql', sql: accessUnique },
  { name: '0005_brand_customer_unique.sql', sql: brandCustomerUnique },
  { name: '0006_settings.sql', sql: settings },
  { name: '0007_items_unique_alias_keys.sql', sql: itemsUnique },
  { name: '0008_jobs_queue.sql', sql: jobsQueue },
  { name: '0009_item_alias_index_brand_count.sql', sql: itemAliasIndex },
];

/** Pecah berkas SQL menjadi pernyataan (tanpa baris komentar `--`, dipisah `;` di akhir baris). */
export function splitStatements(sql: string): string[] {
  const body = sql
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  return body
    .split(/;[ \t]*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter((statement) => statement !== '');
}

/**
 * Terapkan migrasi yang belum tercatat, berurutan. Tiap migrasi + catatannya satu `batch`
 * (atomik). Tabel `d1_migrations` sama dengan milik Wrangler.
 */
export async function applyD1Migrations(
  db: D1Database,
  migrations: Migration[] = D1_MIGRATIONS,
): Promise<void> {
  await db
    .prepare(
      'CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)',
    )
    .run();
  const applied = await db.prepare('SELECT name FROM d1_migrations').all<{ name: string }>();
  const done = new Set(applied.results.map((row) => row.name));
  for (const migration of migrations) {
    if (done.has(migration.name)) continue;
    await db.batch([
      ...splitStatements(migration.sql).map((statement) => db.prepare(statement)),
      db.prepare('INSERT INTO d1_migrations (name) VALUES (?)').bind(migration.name),
    ]);
  }
}

// ---------------------------------------------------------------------------------------------
// Migrator MariaDB: berkas `*.sql` bernomor di `server/migrations/mariadb/` (urut nama), dibaca dari disk.
// (Transisi: migrasi D1 di atas dihapus pada T5 dan baseline dipindah ke `server/migrations/`.)
// ---------------------------------------------------------------------------------------------

const MARIADB_MIGRATIONS_DIR = join(import.meta.dir, '..', '..', 'migrations', 'mariadb');
const MIGRATION_FILE_PATTERN = /^\d{4}_[A-Za-z0-9_]+\.sql$/;

/** Baca migrasi MariaDB dari disk, urut nama berkas. */
export async function loadMigrations(dir: string = MARIADB_MIGRATIONS_DIR): Promise<Migration[]> {
  const names = (await readdir(dir)).filter((name) => MIGRATION_FILE_PATTERN.test(name)).sort();
  return Promise.all(
    names.map(async (name) => ({ name, sql: await Bun.file(join(dir, name)).text() })),
  );
}

/**
 * Terapkan migrasi MariaDB yang belum tercatat di `schema_migrations`, berurutan; kembalikan nama yang baru
 * diterapkan. DDL MariaDB tidak transaksional (implicit commit): berkas migrasi gagal di tengah dapat
 * meninggalkan sebagian tabel dan TIDAK dicatat; perbaiki manual/buang skema sebelum mengulang.
 * SQL migrasi tepercaya (dijalankan lewat `Db.exec`, banyak pernyataan sekaligus).
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
