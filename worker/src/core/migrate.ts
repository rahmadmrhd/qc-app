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

export interface Migration {
  name: string;
  sql: string;
}

/** Daftar statis berurutan; deploy memakai `wrangler d1 migrations apply`, tes memakai ini. */
export const MIGRATIONS: Migration[] = [
  { name: '0001_init.sql', sql: init },
  { name: '0002_handover_comments_jobs.sql', sql: handoverCommentsJobs },
  { name: '0003_handover_board_status.sql', sql: boardStatus },
  { name: '0004_access_unique.sql', sql: accessUnique },
  { name: '0005_brand_customer_unique.sql', sql: brandCustomerUnique },
  { name: '0006_settings.sql', sql: settings },
  { name: '0007_items_unique_alias_keys.sql', sql: itemsUnique },
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
export async function applyMigrations(
  db: D1Database,
  migrations: Migration[] = MIGRATIONS,
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
