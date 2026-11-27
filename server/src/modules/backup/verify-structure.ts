import type { Preparer } from '@server/core/db';

/**
 * Struktur skema (kolom dan indeks per tabel) dan daftar migrasi, dibaca dari `information_schema`. Dipakai verifikasi
 * cadangan untuk membandingkan skema hasil pemulihan dengan skema hidup pada hal yang STABIL antar deploy. Jumlah
 * baris sengaja tidak dibandingkan di sini (basis data hidup terus berubah sesudah dump).
 */
export interface SchemaStructure {
  /** Tanda tangan struktur per tabel (kolom berurutan + indeks), tabel dasar saja. */
  tables: Map<string, string>;
  /** Nama migrasi dari `schema_migrations` (kosong bila tabelnya tak ada). */
  migrations: string[];
}

interface ColumnRow {
  t: string;
  c: string;
  ty: string;
  n: string;
  d: string | null;
  g: string | null;
  co: string | null;
}

interface IndexRow {
  t: string;
  i: string;
  s: number | string;
  c: string | null;
  u: number | string;
}

const UNIT = '\u001f';
const SCHEMA_NAME = /^[A-Za-z0-9_$]{1,64}$/;

/** Membaca struktur satu skema (kolom, indeks, migrasi). `schema` sudah divalidasi pemanggil (hanya jadi parameter). */
export async function readStructure(db: Preparer, schema: string): Promise<SchemaStructure> {
  if (!SCHEMA_NAME.test(schema)) throw new Error('Nama skema tidak valid');
  const tableRows = await db
    .prepare(
      "SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME",
    )
    .bind(schema)
    .all<{ t: string }>();
  const columns = await db
    .prepare(
      'SELECT TABLE_NAME AS t, COLUMN_NAME AS c, COLUMN_TYPE AS ty, IS_NULLABLE AS n, COLUMN_DEFAULT AS d, GENERATION_EXPRESSION AS g, COLLATION_NAME AS co FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION',
    )
    .bind(schema)
    .all<ColumnRow>();
  const indexes = await db
    .prepare(
      'SELECT TABLE_NAME AS t, INDEX_NAME AS i, SEQ_IN_INDEX AS s, COLUMN_NAME AS c, NON_UNIQUE AS u FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX',
    )
    .bind(schema)
    .all<IndexRow>();

  const parts = new Map<string, string[]>();
  for (const { t } of tableRows.results) parts.set(t, []);
  for (const row of columns.results) {
    parts
      .get(row.t)
      ?.push(
        `c${UNIT}${row.c}${UNIT}${row.ty}${UNIT}${row.n}${UNIT}${row.d ?? '\u0000'}${UNIT}${row.g ?? ''}${UNIT}${row.co ?? ''}`,
      );
  }
  for (const row of indexes.results) {
    parts
      .get(row.t)
      ?.push(`i${UNIT}${row.i}${UNIT}${Number(row.s)}${UNIT}${row.c ?? ''}${UNIT}${Number(row.u)}`);
  }
  const tables = new Map<string, string>();
  for (const [name, list] of parts) tables.set(name, list.join('\n'));

  let migrations: string[] = [];
  if (tables.has('schema_migrations')) {
    // Berkualifikasi skema: koneksi pemulihan tak punya basis data bawaan.
    const rows = await db
      .prepare(`SELECT name FROM \`${schema}\`.schema_migrations ORDER BY name`)
      .all<{ name: string }>();
    migrations = rows.results.map((row) => row.name);
  }
  return { tables, migrations };
}

export interface StructureComparison {
  /** Migrasi hanya ada di salah satu sisi: skema hidup sudah berubah sejak dump (atau sebaliknya). */
  migrationsDiffer: boolean;
  migrationsOnlyLive: string[];
  migrationsOnlyRestored: string[];
  /** Tabel yang ada di skema hidup tetapi tidak di pemulihan, dan sebaliknya. */
  tablesOnlyLive: string[];
  tablesOnlyRestored: string[];
  /** Tabel yang ada di keduanya tetapi kolom/indeksnya berbeda. */
  tablesChanged: string[];
}

const onlyIn = (a: Iterable<string>, b: Set<string>) => [...a].filter((x) => !b.has(x)).sort();

/** Membandingkan struktur skema hidup (`live`) dengan hasil pemulihan (`restored`). Fungsi murni. */
export function compareStructure(
  live: SchemaStructure,
  restored: SchemaStructure,
): StructureComparison {
  const liveMigrations = new Set(live.migrations);
  const restoredMigrations = new Set(restored.migrations);
  const migrationsOnlyLive = onlyIn(liveMigrations, restoredMigrations);
  const migrationsOnlyRestored = onlyIn(restoredMigrations, liveMigrations);
  const liveTables = new Set(live.tables.keys());
  const restoredTables = new Set(restored.tables.keys());
  const tablesChanged = [...liveTables]
    .filter(
      (name) => restoredTables.has(name) && live.tables.get(name) !== restored.tables.get(name),
    )
    .sort();
  return {
    migrationsDiffer: migrationsOnlyLive.length > 0 || migrationsOnlyRestored.length > 0,
    migrationsOnlyLive,
    migrationsOnlyRestored,
    tablesOnlyLive: onlyIn(liveTables, restoredTables),
    tablesOnlyRestored: onlyIn(restoredTables, liveTables),
    tablesChanged,
  };
}
