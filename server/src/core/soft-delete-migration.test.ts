// Migrasi 0027 (soft delete, tahap expand): kolom deleted_at/deleted_by dan indeks unik `_live`; indeks lama dibuang oleh
// migrasi contract 0030 (soft-delete-contract.test.ts).
import { expect, test } from 'bun:test';
import { DbError } from '@server/core/db';
import { createTestEnv } from '@server-test/test-env';
import { SOFT_DELETE_TABLES } from './soft-delete';
import { CHILD_PARENTS } from './soft-delete-scan';

const TABLES = [
  'users',
  'roles',
  'locations',
  'business_units',
  'brands',
  'customers',
  'items',
  'sticker_types',
  'stickers',
  'qr_designs',
  'qr_presets',
  'postels',
  'postel_numbers',
  'serials',
  'handovers',
];

const LIVE_INDEXES: [string, string][] = [
  ['roles_name_unique_live', 'roles'],
  ['locations_code_unique_live', 'locations'],
  ['locations_name_unique_live', 'locations'],
  ['business_units_code_unique_live', 'business_units'],
  ['business_units_name_unique_live', 'business_units'],
  ['brands_key_live', 'brands'],
  ['customers_key_live', 'customers'],
  ['items_key_live', 'items'],
  ['sticker_types_name_unique_live', 'sticker_types'],
  ['sticker_types_kind_unique_live', 'sticker_types'],
  ['stickers_type_name_unique_live', 'stickers'],
  ['qr_presets_bu_unique_live', 'qr_presets'],
  ['postel_numbers_key_live', 'postel_numbers'],
  ['postels_sticker_live', 'postels'],
  ['handovers_number_live', 'handovers'],
];

interface ColumnRow {
  Type: string;
  Null: string;
  Default: string | null;
}
interface IndexRow {
  Key_name: string;
  Non_unique: number | string;
  Seq_in_index: number | string;
  Column_name: string;
}

test('tiap tabel model punya deleted_at VARCHAR(30) NOT NULL DEFAULT "" dan deleted_by', async () => {
  const env = await createTestEnv();
  for (const table of TABLES) {
    const at = await env.DB.prepare(
      `SHOW COLUMNS FROM ${table} LIKE 'deleted_at'`,
    ).first<ColumnRow>();
    expect(at, table).not.toBeNull();
    expect(String(at?.Type).toLowerCase(), table).toBe('varchar(30)');
    expect(at?.Null, table).toBe('NO');
    expect(at?.Default, table).toBe('');
    const by = await env.DB.prepare(
      `SHOW COLUMNS FROM ${table} LIKE 'deleted_by'`,
    ).first<ColumnRow>();
    expect(by, table).not.toBeNull();
    expect(String(by?.Type).toLowerCase(), table).toBe('varchar(254)');
  }
});

test('sticker_guide_images tidak ber-soft-delete', async () => {
  const env = await createTestEnv();
  const row = await env.DB.prepare(
    "SHOW COLUMNS FROM sticker_guide_images LIKE 'deleted_at'",
  ).first();
  expect(row).toBeNull();
});

test('indeks _live unik dan berakhir pada deleted_at', async () => {
  const env = await createTestEnv();
  for (const [name, table] of LIVE_INDEXES) {
    const rows = (
      await env.DB.prepare(`SHOW INDEX FROM ${table} WHERE Key_name = ?`).bind(name).all<IndexRow>()
    ).results;
    expect(rows.length, name).toBeGreaterThan(1);
    expect(Number(rows[0]?.Non_unique), name).toBe(0);
    const ordered = [...rows].sort((a, b) => Number(a.Seq_in_index) - Number(b.Seq_in_index));
    expect(ordered[ordered.length - 1]?.Column_name, name).toBe('deleted_at');
  }
});

test('users_email tetap unik penuh tanpa padanan _live', async () => {
  const env = await createTestEnv();
  const live = await env.DB.prepare(
    "SHOW INDEX FROM users WHERE Key_name = 'users_email_live'",
  ).all();
  expect(live.results).toHaveLength(0);
  const full = (
    await env.DB.prepare("SHOW INDEX FROM users WHERE Key_name = 'users_email'").all<IndexRow>()
  ).results;
  expect(full).toHaveLength(1);
  expect(Number(full[0]?.Non_unique)).toBe(0);
  expect(full[0]?.Column_name).toBe('email');
});

test('contract (0030): indeks lama brands_key sudah dibuang; kunci sama dengan deleted_at berbeda boleh berdampingan', async () => {
  const env = await createTestEnv();
  const insert = (id: string, deletedAt: string) =>
    env.DB.prepare(
      "INSERT INTO brands (id, name, `key`, status, created_at, updated_at, updated_by, deleted_at) VALUES (?, 'M', 'm', 'active', 't', 't', 'u', ?)",
    )
      .bind(id, deletedAt)
      .run();
  await insert('b1', '2026-01-01T00:00:00.000Z');
  await insert('b2', '');
  // Hanya dua baris hidup berkunci sama yang ditolak (rincian lengkap per indeks: soft-delete-contract.test.ts).
  let error: unknown;
  try {
    await insert('b3', '');
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(DbError);
  expect((error as DbError).kind).toBe('duplicate');
});

// Penjaga DUA ARAH: daftar tabel di kode (`SOFT_DELETE_TABLES`, `CHILD_PARENTS`) harus sama dengan skema. Tanpa ini,
// tabel baru ber-`deleted_at` atau anak FK baru dari model soft delete tak ikut dipindai `soft-delete-guard.test.ts`
// dan pembaca yang membocorkan record terhapus lolos diam-diam.
test('tabel ber-kolom deleted_at di skema = SOFT_DELETE_TABLES (tidak ada yang tertinggal atau berlebih)', async () => {
  const env = await createTestEnv();
  const rows = (
    await env.DB.prepare(
      "SELECT table_name AS name FROM information_schema.columns WHERE table_schema = DATABASE() AND column_name = 'deleted_at'",
    ).all<{ name: string }>()
  ).results;
  expect(rows.map((row) => row.name).sort()).toEqual([...SOFT_DELETE_TABLES].sort());
  expect(TABLES.slice().sort()).toEqual([...SOFT_DELETE_TABLES].sort());
});

test('tabel anak (kunci asing) dari model soft delete terdaftar di CHILD_PARENTS; tiap tabel CHILD_PARENTS ada di skema', async () => {
  const env = await createTestEnv();
  const soft = new Set<string>(SOFT_DELETE_TABLES);
  const fkRows = (
    await env.DB.prepare(
      'SELECT table_name AS child, referenced_table_name AS parent FROM information_schema.referential_constraints WHERE constraint_schema = DATABASE()',
    ).all<{ child: string; parent: string }>()
  ).results;
  const orphanChildren = fkRows
    .filter((row) => soft.has(row.parent) && !soft.has(row.child) && !(row.child in CHILD_PARENTS))
    .map((row) => `${row.child} -> ${row.parent}`);
  expect(orphanChildren).toEqual([]);
  const tables = (
    await env.DB.prepare(
      'SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE()',
    ).all<{ name: string }>()
  ).results.map((row) => row.name);
  expect(Object.keys(CHILD_PARENTS).filter((name) => !tables.includes(name))).toEqual([]);
});
