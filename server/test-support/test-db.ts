// Skema tes MariaDB: templat `qc_test_template` (diperbarui bila hash migrasi berubah), klon per proses/berkas tes
// `qc_test_<epoch detik>_<hex>`, pengosongan per tes, pembersihan skema yatim. Butuh `bun run db:tunnel`.
import { createDb, type Db } from '@server/core/db';
import { applyMigrations, hashMigrations, loadMigrations } from '@server/core/migrate';
import mysql from 'mysql2/promise';
import { newTestSchemaName, TEST_SCHEMA_PREFIX, testDbUrl } from './db-env';

export const TEMPLATE_SCHEMA = 'qc_test_template';
const TEMPLATE_LOCK = 'qc_test_template_lock';
const ORPHAN_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const ORPHAN_PATTERN = /^qc_test_(\d{9,})_[0-9a-f]+$/;

interface Current {
  name: string;
  db: Db;
  admin: Db;
  tables: string[];
}

const state = globalThis as typeof globalThis & {
  __qcTemplateReady?: Promise<void>;
  __qcTestSchema?: Promise<Current>;
  __qcTestSchemaName?: string;
};

/** Koneksi tanpa database terpilih (nama skema selalu berkualifikasi atau lewat `Db` terpisah). */
function adminDb(): Db {
  return createDb({ url: testDbUrl(), connectionLimit: 2 });
}

async function readTemplateHash(admin: Db): Promise<string | null> {
  try {
    const row = await admin
      .prepare(`SELECT hash FROM \`${TEMPLATE_SCHEMA}\`._template_meta LIMIT 1`)
      .first<{ hash: string }>();
    return row?.hash ?? null;
  } catch {
    return null; // skema/tabel belum ada
  }
}

async function refreshTemplate(): Promise<void> {
  const migrations = await loadMigrations();
  const hash = hashMigrations(migrations);
  const admin = adminDb();
  // Kunci antar-proses: dua proses tes serentak tidak boleh membangun templat bersamaan.
  const lock = await mysql.createConnection({ uri: testDbUrl() });
  try {
    await lock.query('SELECT GET_LOCK(?, 120)', [TEMPLATE_LOCK]);
    if ((await readTemplateHash(admin)) === hash) return;
    await admin.exec(
      `DROP DATABASE IF EXISTS \`${TEMPLATE_SCHEMA}\`; CREATE DATABASE \`${TEMPLATE_SCHEMA}\``,
    );
    const template = createDb({ url: testDbUrl(), database: TEMPLATE_SCHEMA, connectionLimit: 2 });
    try {
      await applyMigrations(template, migrations);
      await template.exec(
        `CREATE TABLE _template_meta (hash VARCHAR(64) NOT NULL) ENGINE=InnoDB; INSERT INTO _template_meta VALUES ('${hash}')`,
      );
    } finally {
      await template.close();
    }
  } finally {
    await lock.query('SELECT RELEASE_LOCK(?)', [TEMPLATE_LOCK]).catch(() => {});
    await lock.end().catch(() => {});
    await admin.close();
  }
}

/** Pastikan templat ada dan sesuai hash migrasi (sekali per proses). */
export function ensureTemplate(): Promise<void> {
  state.__qcTemplateReady ??= refreshTemplate().catch((error) => {
    state.__qcTemplateReady = undefined;
    throw error;
  });
  return state.__qcTemplateReady;
}

/** Hapus skema `qc_test_<ts>_*` yatim (milik proses mati) yang lebih tua dari 6 jam; kembalikan nama yang dihapus. */
export async function sweepOrphanSchemas(admin: Db, now = Date.now()): Promise<string[]> {
  const rows = await admin
    .prepare('SELECT schema_name AS s FROM information_schema.schemata WHERE schema_name LIKE ?')
    .bind('qc\\_test\\_%')
    .all<{ s: string }>();
  const dropped: string[] = [];
  for (const { s } of rows.results) {
    const match = ORPHAN_PATTERN.exec(s);
    if (!match) continue; // templat dan skema tanpa stempel waktu tidak disentuh
    if (now - Number(match[1]) * 1000 < ORPHAN_MAX_AGE_MS) continue;
    await admin.exec(`DROP DATABASE IF EXISTS \`${s}\``);
    dropped.push(s);
  }
  return dropped;
}

/** Kloning templat: `CREATE TABLE ... LIKE` per tabel, lalu kunci asing (LIKE tidak menyalinnya). */
async function cloneTemplate(admin: Db, schema: string): Promise<string[]> {
  const tables = (
    await admin
      .prepare(
        "SELECT table_name AS t FROM information_schema.tables WHERE table_schema = ? AND table_type = 'BASE TABLE' AND table_name <> '_template_meta' ORDER BY table_name",
      )
      .bind(TEMPLATE_SCHEMA)
      .all<{ t: string }>()
  ).results.map((r) => r.t);
  const fks = (
    await admin
      .prepare(
        'SELECT constraint_name AS c, table_name AS t, column_name AS col, referenced_table_name AS rt, referenced_column_name AS rcol FROM information_schema.key_column_usage WHERE table_schema = ? AND referenced_table_name IS NOT NULL ORDER BY constraint_name, ordinal_position',
      )
      .bind(TEMPLATE_SCHEMA)
      .all<{ c: string; t: string; col: string; rt: string; rcol: string }>()
  ).results;
  const grouped = new Map<string, { t: string; rt: string; cols: string[]; rcols: string[] }>();
  for (const fk of fks) {
    const entry = grouped.get(fk.c) ?? { t: fk.t, rt: fk.rt, cols: [], rcols: [] };
    entry.cols.push(`\`${fk.col}\``);
    entry.rcols.push(`\`${fk.rcol}\``);
    grouped.set(fk.c, entry);
  }
  const statements = [
    `CREATE DATABASE \`${schema}\``,
    ...tables.map(
      (t) => `CREATE TABLE \`${schema}\`.\`${t}\` LIKE \`${TEMPLATE_SCHEMA}\`.\`${t}\``,
    ),
    ...[...grouped].map(
      ([name, fk]) =>
        `ALTER TABLE \`${schema}\`.\`${fk.t}\` ADD CONSTRAINT \`${name}\` FOREIGN KEY (${fk.cols.join(', ')}) REFERENCES \`${schema}\`.\`${fk.rt}\` (${fk.rcols.join(', ')})`,
    ),
  ];
  await admin.exec(statements.join(';\n'));
  return tables;
}

async function createCurrent(): Promise<Current> {
  await ensureTemplate();
  const admin = adminDb();
  const name = newTestSchemaName();
  try {
    const tables = await cloneTemplate(admin, name);
    const db = createDb({ url: testDbUrl(), database: name, connectionLimit: 10 });
    state.__qcTestSchemaName = name;
    return { name, db, admin, tables };
  } catch (error) {
    await admin.close();
    throw error;
  }
}

/** Skema tes proses ini (dibuat sekali, dihapus lewat `dropTestSchemas`). */
export function acquireTestDb(): Promise<Current> {
  state.__qcTestSchema ??= createCurrent().catch((error) => {
    state.__qcTestSchema = undefined;
    throw error;
  });
  return state.__qcTestSchema;
}

/** Kosongkan semua tabel (satu `exec` multi-pernyataan). */
export async function resetTestDb(current: Current): Promise<void> {
  const statements = current.tables.map((t) => `TRUNCATE TABLE \`${t}\``);
  await current.db.exec(
    `SET FOREIGN_KEY_CHECKS=0;\n${statements.join(';\n')};\nSET FOREIGN_KEY_CHECKS=1`,
  );
}

/** Nama skema tes yang sedang dipakai (null bila belum ada). Hanya untuk tes harness. */
export function currentTestSchema(): string | null {
  return state.__qcTestSchemaName ?? null;
}

/** Hapus skema tes proses ini (panggil di `afterAll`); `createTestEnv` berikutnya membuat skema baru. */
export async function dropTestSchemas(): Promise<void> {
  const pending = state.__qcTestSchema;
  state.__qcTestSchema = undefined;
  state.__qcTestSchemaName = undefined;
  if (!pending) return;
  const current = await pending.catch(() => null);
  if (!current) return;
  await current.db.close().catch(() => {});
  try {
    await current.admin.exec(`DROP DATABASE IF EXISTS \`${current.name}\``);
  } finally {
    await current.admin.close().catch(() => {});
  }
}

export { TEST_SCHEMA_PREFIX };
