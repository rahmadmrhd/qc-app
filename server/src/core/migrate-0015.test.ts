// Tes migrasi 0015 (kasus tidak lolos Serial Number 5b) terhadap MariaDB nyata di VPS (butuh `bun run db:tunnel`).
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createDb, type Db, DbError } from '@server/core/db';
import { applyMigrations, loadMigrations } from '@server/core/migrate';
import { newTestSchemaName, testDbUrl } from '@server-test/db-env';

const URL_NO_DB = testDbUrl();
let admin: Db;
let db: Db;
let name = '';

beforeAll(async () => {
  admin = createDb({ url: URL_NO_DB, connectionLimit: 2 });
  name = newTestSchemaName();
  await admin.exec(`CREATE DATABASE \`${name}\``);
  db = createDb({ url: URL_NO_DB, database: name, connectionLimit: 3 });
  const all = await loadMigrations();
  // Semua migrasi sebelum 0015 dulu: INSERT gaya 5a dibuktikan kompatibel SEBELUM kolom/tabel 0015 ada, lalu 0015 diterapkan di atasnya.
  await applyMigrations(
    db,
    all.filter((m) => m.name < '0015_serial_cases.sql'),
  );
}, 60_000);

afterAll(async () => {
  await db?.close();
  if (name !== '') await admin.exec(`DROP DATABASE IF EXISTS \`${name}\``);
  await admin?.close();
});

const insertSerial = (id: string, serial: string) =>
  db
    .prepare('INSERT INTO serials (id, client_id, bu_id, serial, item_id) VALUES (?, ?, ?, ?, ?)')
    .bind(id, `c-${id}`, 'bu1', serial, 'item-1')
    .run();

const insertCase = (id: string, number: string) =>
  db
    .prepare('INSERT INTO serial_cases (id, number, serial_id, bu_id) VALUES (?, ?, ?, ?)')
    .bind(id, number, 's1', 'bu1')
    .run();

describe('migrasi 0015 serial_cases', () => {
  test('baris serials gaya 5a (sebelum 0015) tetap ada dan mendapat transit_on kosong', async () => {
    await insertSerial('s1', 'SN1');
    const all = await loadMigrations();
    // Hanya sampai 0015: migrasi yang lebih baru (0016 dst.) bukan urusan tes ini dan tak boleh mengubah hasilnya.
    expect(
      await applyMigrations(
        db,
        all.filter((m) => m.name <= '0015_serial_cases.sql'),
      ),
    ).toEqual(['0015_serial_cases.sql']);
    const row = await db
      .prepare("SELECT transit_on FROM serials WHERE id = 's1'")
      .first<{ transit_on: string }>();
    expect(row?.transit_on).toBe('');
  });

  test('INSERT serials gaya 5a (tanpa transit_on) tetap berhasil sesudah 0015', async () => {
    await insertSerial('s2', 'SN2');
    const row = await db
      .prepare("SELECT transit_on, open_case_id FROM serials WHERE id = 's2'")
      .first<{ transit_on: string; open_case_id: string }>();
    expect(row).toEqual({ transit_on: '', open_case_id: '' });
  });

  test('tabel serial_cases ada dengan bawaan kosong; nomor unik (key serial_cases_number)', async () => {
    await insertCase('c1', 'LP-20261120-001');
    const row = await db
      .prepare("SELECT closed_on, outcome, damage FROM serial_cases WHERE id = 'c1'")
      .first<{ closed_on: string; outcome: string; damage: string }>();
    expect(row).toEqual({ closed_on: '', outcome: '', damage: '' });
    const error = await insertCase('c2', 'LP-20261120-001').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DbError);
    expect((error as DbError).kind).toBe('duplicate');
    expect((error as DbError).key).toBe('serial_cases_number');
  });

  test('indeks baru ada', async () => {
    const rows = await db
      .prepare(
        "SELECT DISTINCT index_name AS i FROM information_schema.statistics WHERE table_schema = DATABASE() AND index_name IN ('serials_custody', 'serial_events_case', 'serial_cases_serial', 'serial_cases_bu_opened') ORDER BY index_name",
      )
      .all<{ i: string }>();
    expect(rows.results.map((r) => r.i).sort()).toEqual([
      'serial_cases_bu_opened',
      'serial_cases_serial',
      'serial_events_case',
      'serials_custody',
    ]);
  });

  test('menjalankan migrasi dua kali tidak gagal', async () => {
    const migration = (await loadMigrations()).find((m) => m.name === '0015_serial_cases.sql');
    if (!migration) throw new Error('0015 tidak ditemukan');
    await db.exec(migration.sql);
    await db.exec(migration.sql);
  });
});
