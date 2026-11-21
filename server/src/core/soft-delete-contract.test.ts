// Migrasi 0030 (soft delete, tahap contract; keputusan pemilik 2026-11-20 butir 11): indeks unik LAMA dibuang dan hanya
// padanan `_live` (kunci + `deleted_at`) yang tersisa, kecuali `users_email` (tetap unik penuh). Diuji terhadap
// MariaDB nyata (butuh `bun run db:tunnel`). Penjaga serial (`serials_serial_live`) dibuat/dilengkapi oleh
// `ensureSerialUniqueIndex`, bukan migrasi.
import { afterEach, expect, setDefaultTimeout, test } from 'bun:test';
import { DbError } from '@server/core/db';
import type { Env } from '@server/core/env';
import { loadMigrations } from '@server/core/migrate';
import { ensureSerialUniqueIndex } from '@server/modules/serial/bu-history';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { baseIndexName } from './index-names';

setDefaultTimeout(120_000);

type Row = Record<string, unknown>;

/** Indeks lama yang dibuang migrasi 0030 beserta tabelnya. */
const DROPPED: [string, string][] = [
  ['roles_name_unique', 'roles'],
  ['locations_code_unique', 'locations'],
  ['locations_name_unique', 'locations'],
  ['business_units_code_unique', 'business_units'],
  ['business_units_name_unique', 'business_units'],
  ['brands_key', 'brands'],
  ['customers_key', 'customers'],
  ['items_key', 'items'],
  ['sticker_types_name_unique', 'sticker_types'],
  ['sticker_types_kind_unique', 'sticker_types'],
  ['stickers_type_name_unique', 'stickers'],
  ['qr_presets_bu_unique', 'qr_presets'],
  ['postel_numbers_key', 'postel_numbers'],
  ['postels_sticker', 'postels'],
  ['handovers_number', 'handovers'],
  ['serials_serial', 'serials'],
  ['serials_bu_serial', 'serials'],
];

/**
 * Satu kasus per indeks `_live`: `row(uid, deletedAt)` membangun baris yang kunci indeksnya TETAP sama antar baris dan
 * kolom unik lain (indeks tetangga di tabel yang sama) berbeda menurut `uid`.
 */
const CASES: { index: string; table: string; row: (uid: string, deletedAt: string) => Row }[] = [
  {
    index: 'roles_name_unique_live',
    table: 'roles',
    row: (uid, deleted_at) => ({ id: uid, name: 'Kunci', deleted_at }),
  },
  {
    index: 'locations_code_unique_live',
    table: 'locations',
    row: (uid, deleted_at) => ({ id: uid, code: 'KUNCI', name: `Lokasi ${uid}`, deleted_at }),
  },
  {
    index: 'locations_name_unique_live',
    table: 'locations',
    row: (uid, deleted_at) => ({ id: uid, code: `C-${uid}`, name: 'Kunci', deleted_at }),
  },
  {
    index: 'business_units_code_unique_live',
    table: 'business_units',
    row: (uid, deleted_at) => ({ id: uid, code: 'KUNCI', name: `BU ${uid}`, deleted_at }),
  },
  {
    index: 'business_units_name_unique_live',
    table: 'business_units',
    row: (uid, deleted_at) => ({ id: uid, code: `C-${uid}`, name: 'Kunci', deleted_at }),
  },
  {
    index: 'brands_key_live',
    table: 'brands',
    row: (uid, deleted_at) => ({ id: uid, name: 'M', key: 'kunci', deleted_at }),
  },
  {
    index: 'customers_key_live',
    table: 'customers',
    row: (uid, deleted_at) => ({ id: uid, name: 'C', key: 'kunci', deleted_at }),
  },
  {
    index: 'items_key_live',
    table: 'items',
    row: (uid, deleted_at) => ({ id: uid, model: 'X', key: 'kunci', deleted_at }),
  },
  {
    index: 'sticker_types_name_unique_live',
    table: 'sticker_types',
    row: (uid, deleted_at) => ({ id: uid, name: 'Kunci', deleted_at }),
  },
  {
    index: 'sticker_types_kind_unique_live',
    table: 'sticker_types',
    row: (uid, deleted_at) => ({
      id: uid,
      name: `Jenis ${uid}`,
      system_kind: 'manual_book',
      deleted_at,
    }),
  },
  {
    index: 'stickers_type_name_unique_live',
    table: 'stickers',
    row: (uid, deleted_at) => ({ id: uid, type_id: 't1', name: 'Kunci', deleted_at }),
  },
  {
    index: 'qr_presets_bu_unique_live',
    table: 'qr_presets',
    row: (uid, deleted_at) => ({ id: uid, bu_id: 'bu-kunci', deleted_at }),
  },
  {
    index: 'postel_numbers_key_live',
    table: 'postel_numbers',
    row: (uid, deleted_at) => ({
      id: uid,
      postel_id: 'p-induk',
      number: 'N',
      number_key: 'kunci',
      seq: Number(uid.slice(1)),
      deleted_at,
    }),
  },
  {
    index: 'postels_sticker_live',
    table: 'postels',
    row: (uid, deleted_at) => ({ id: uid, sticker_id: 's-kunci', deleted_at }),
  },
  {
    index: 'handovers_number_live',
    table: 'handovers',
    row: (uid, deleted_at) => ({ id: uid, number: 'ST-KUNCI', deleted_at }),
  },
  {
    index: 'serials_serial_live',
    table: 'serials',
    row: (uid, deleted_at) => ({
      id: uid,
      client_id: `c-${uid}`,
      bu_id: `bu-${uid}`,
      serial: 'KUNCI',
      item_id: 'i1',
      deleted_at,
    }),
  },
];

const OLD = '2026-11-20T01:00:00.000Z';
const OTHER = '2026-11-20T02:00:00.000Z';

let env: TestEnv;
const insert = (table: string, row: Row) =>
  env.DB.prepare(
    `INSERT INTO ${table} (${Object.keys(row)
      .map((c) => `\`${c}\``)
      .join(', ')}) VALUES (${Object.keys(row)
      .map(() => '?')
      .join(', ')})`,
  )
    .bind(...(Object.values(row) as never[]))
    .run();

const indexNames = async (table: string): Promise<Set<string>> =>
  new Set(
    (
      await env.DB.prepare(
        'SELECT DISTINCT index_name AS name FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ?',
      )
        .bind(table)
        .all<{ name: string }>()
    ).results.map((r) => r.name),
  );

/** Memulihkan keadaan skema contract: kosongkan tabel yang dipakai dan lengkapi penjaga serial. */
afterEach(async () => {
  if (!env) return;
  // Anak lebih dulu (kunci asing: postel_numbers/postels -> postels/stickers).
  const tables = [...new Set(CASES.map((c) => c.table))];
  const order = ['postel_numbers', 'postels', 'stickers'];
  const sorted = [...order, ...tables.filter((t) => !order.includes(t))];
  for (const table of sorted) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  await env.DB.prepare('DELETE FROM users').run();
  await ensureSerialUniqueIndex(env as unknown as Env);
});

test('indeks lama dibuang dan semua padanan _live ada; users_email tetap unik penuh', async () => {
  env = await createTestEnv();
  for (const [name, table] of DROPPED) {
    expect((await indexNames(table)).has(name), `${table}.${name}`).toBe(false);
  }
  for (const c of CASES) {
    expect((await indexNames(c.table)).has(c.index), c.index).toBe(true);
  }
  const email = (await indexNames('users')).has('users_email');
  expect(email).toBe(true);
  expect((await indexNames('users')).has('users_email_live')).toBe(false);
});

for (const c of CASES) {
  test(`${c.index}: terhapus dan hidup berkunci sama berdampingan; dua hidup atau dua terhapus sewaktu yang sama ditolak`, async () => {
    env = await createTestEnv();
    // Induk untuk kunci asing / rujukan: stiker 's-kunci' (postels), postel 'p-induk' (postel_numbers).
    if (c.table === 'postels')
      await insert('stickers', { id: 's-kunci', type_id: 't1', name: 'S' });
    if (c.table === 'postel_numbers') await insert('postels', { id: 'p-induk' });
    // 1. terhapus + hidup berkunci sama: boleh.
    await insert(c.table, c.row('r1', OLD));
    await insert(c.table, c.row('r2', ''));
    // 2. dua hidup berkunci sama: ditolak lewat indeks `_live` (nama dasar = indeks lama).
    const live = await insert(c.table, c.row('r3', '')).catch((e) => e);
    expect(live, 'dua hidup').toBeInstanceOf(DbError);
    expect((live as DbError).kind).toBe('duplicate');
    expect(baseIndexName((live as DbError).key ?? '')).toBe(baseIndexName(c.index));
    // 3. dua terhapus pada deleted_at yang sama: ditolak; deleted_at berbeda: boleh.
    const same = await insert(c.table, c.row('r4', OLD)).catch((e) => e);
    expect(same, 'dua terhapus sewaktu').toBeInstanceOf(DbError);
    expect((same as DbError).kind).toBe('duplicate');
    await insert(c.table, c.row('r5', OTHER));
  });
}

test('pengguna: email terhapus tetap menolak akun baru berkunci sama (users_email penuh, keputusan 10)', async () => {
  env = await createTestEnv();
  const user = (id: string, deleted_at: string) =>
    insert('users', { id, email: 'a@x.id', deleted_at });
  await user('u1', OLD);
  const error = await user('u2', '').catch((e) => e);
  expect(error).toBeInstanceOf(DbError);
  expect((error as DbError).kind).toBe('duplicate');
  expect(baseIndexName((error as DbError).key ?? '')).toBe('users_email');
});

/** Memasang kembali indeks lama untuk mensimulasikan basis data pra-contract, lalu menjalankan `ensureSerialUniqueIndex`. */
async function legacyState(withLive: boolean) {
  await env.DB.prepare('DROP INDEX IF EXISTS serials_serial_live ON serials').run();
  await env.DB.prepare('CREATE UNIQUE INDEX serials_bu_serial ON serials (bu_id, serial)').run();
  await env.DB.prepare('CREATE UNIQUE INDEX serials_serial ON serials (serial)').run();
  if (withLive) {
    await env.DB.prepare(
      'CREATE UNIQUE INDEX serials_serial_live ON serials (serial, deleted_at)',
    ).run();
  }
}

const serialRow = (uid: string, bu: string, serial: string, deletedAt = '') => ({
  id: uid,
  client_id: `c-${uid}`,
  bu_id: bu,
  serial,
  item_id: 'i1',
  deleted_at: deletedAt,
});

test('ensureSerialUniqueIndex tanpa ganda: membuat serials_serial_live saja dan membuang serials_serial dan serials_bu_serial; idempoten', async () => {
  env = await createTestEnv();
  await legacyState(false);
  await insert('serials', serialRow('s1', 'bu1', 'SN1'));
  await insert('serials', serialRow('s2', 'bu1', 'SN2'));
  expect(await ensureSerialUniqueIndex(env as unknown as Env)).toBe('created');
  const names = await indexNames('serials');
  expect(names.has('serials_serial_live')).toBe(true);
  expect(names.has('serials_serial')).toBe(false);
  expect(names.has('serials_bu_serial')).toBe(false);
  expect(await ensureSerialUniqueIndex(env as unknown as Env)).toBe('exists');
});

test('ensureSerialUniqueIndex: serial terhapus dan serial hidup berkunci sama bukan ganda (dihitung menurut serial + deleted_at)', async () => {
  env = await createTestEnv();
  await legacyState(false);
  // Indeks lama mencegah baris kedua; lepas dulu seperti pada data hasil rilis soft delete di atas skema expand.
  await env.DB.prepare('DROP INDEX serials_serial ON serials').run();
  await env.DB.prepare('DROP INDEX serials_bu_serial ON serials').run();
  await insert('serials', serialRow('s1', 'bu1', 'SN1', OLD));
  await insert('serials', serialRow('s2', 'bu1', 'SN1'));
  expect(await ensureSerialUniqueIndex(env as unknown as Env)).toBe('created');
  expect((await indexNames('serials')).has('serials_serial_live')).toBe(true);
});

test('ensureSerialUniqueIndex dengan serial ganda lintas BU: duplicates, tak membuat dan tak membuang apa pun, start tidak gagal', async () => {
  env = await createTestEnv();
  await legacyState(false);
  await env.DB.prepare('DROP INDEX serials_serial ON serials').run();
  await insert('serials', serialRow('s1', 'bu1', 'SN1'));
  await insert('serials', serialRow('s2', 'bu2', 'SN1'));
  expect(await ensureSerialUniqueIndex(env as unknown as Env)).toBe('duplicates');
  const names = await indexNames('serials');
  expect(names.has('serials_serial_live')).toBe(false);
  // Penjaga per BU tetap ada sampai serial ganda disatukan.
  expect(names.has('serials_bu_serial')).toBe(true);
  // Data utuh.
  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM serials').first<{
    n: number | string;
  }>();
  expect(Number(count?.n)).toBe(2);
});

test('ensureSerialUniqueIndex: indeks _live sudah ada dan indeks lama tersisa = indeks lama dibuang (hasil exists)', async () => {
  env = await createTestEnv();
  await legacyState(true);
  expect(await ensureSerialUniqueIndex(env as unknown as Env)).toBe('exists');
  const names = await indexNames('serials');
  expect(names.has('serials_serial')).toBe(false);
  expect(names.has('serials_bu_serial')).toBe(false);
  expect(names.has('serials_serial_live')).toBe(true);
});

test('SQL 0030 idempoten: dijalankan ulang pada keadaan setengah jalan (sebagian indeks lama sudah dibuang) tetap berhasil', async () => {
  env = await createTestEnv();
  const sql = (await loadMigrations()).find((m) => m.name === '0030_soft_delete_contract.sql')?.sql;
  expect(sql).toBeDefined();
  // Keadaan setengah jalan: sebagian indeks lama masih ada, sisanya sudah dibuang (tabel kosong, jadi pemasangan aman).
  await env.DB.prepare('CREATE UNIQUE INDEX brands_key ON brands (`key`)').run();
  await env.DB.prepare('CREATE UNIQUE INDEX items_key ON items (`key`)').run();
  await env.DB.prepare('CREATE UNIQUE INDEX handovers_number ON handovers (number)').run();
  await env.DB.prepare('CREATE UNIQUE INDEX postels_sticker ON postels (sticker_id)').run();
  await env.DB.exec(sql as string);
  // Dijalankan lagi pada keadaan yang sudah bersih: tidak melempar dan hasilnya sama.
  await env.DB.exec(sql as string);
  for (const [name, table] of DROPPED.filter(([n]) => !n.startsWith('serials_'))) {
    expect((await indexNames(table)).has(name), `${table}.${name}`).toBe(false);
  }
  for (const c of CASES) {
    expect((await indexNames(c.table)).has(c.index), c.index).toBe(true);
  }
});
