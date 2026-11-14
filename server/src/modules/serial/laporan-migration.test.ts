// Tes migrasi 0017 (alur laporan rusak): pemetaan data lama terhadap MariaDB nyata (butuh `bun run db:tunnel`).
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createDb, type Db } from '@server/core/db';
import { applyMigrations, loadMigrations } from '@server/core/migrate';
import { newTestSchemaName, testDbUrl } from '@server-test/db-env';

const URL_NO_DB = testDbUrl();
const MIGRATION = '0017_laporan_rusak.sql';
let admin: Db;
let db: Db;
let name = '';
let sql17 = '';

beforeAll(async () => {
  admin = createDb({ url: URL_NO_DB, connectionLimit: 2 });
  name = newTestSchemaName();
  await admin.exec(`CREATE DATABASE \`${name}\``);
  db = createDb({ url: URL_NO_DB, database: name, connectionLimit: 3 });
  const all = await loadMigrations();
  sql17 = all.find((m) => m.name === MIGRATION)?.sql ?? '';
  // Semua migrasi SEBELUM 0017: data bergaya 5b dibenihkan dulu, lalu 0017 diterapkan di atasnya.
  await applyMigrations(
    db,
    all.filter((m) => m.name < MIGRATION),
  );
  await seedLegacy();
}, 60_000);

afterAll(async () => {
  await db?.close();
  if (name !== '') await admin.exec(`DROP DATABASE IF EXISTS \`${name}\``);
  await admin?.close();
});

async function insertSerial(
  id: string,
  status: string,
  custody: string,
  location: string,
  transit?: { from: string; to: string },
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO serials (id, client_id, bu_id, serial, item_id, location_id, recorded_location_id, status, custody, transit_from_location_id, transit_to_location_id, transit_on) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      id,
      `c-${id}`,
      'bu1',
      `SN-${id}`,
      'item-1',
      location,
      location,
      status,
      custody,
      transit?.from ?? '',
      transit?.to ?? '',
      transit ? '2026-11-10' : '',
    )
    .run();
}

async function insertCase(id: string, number: string, serialId: string): Promise<void> {
  await db
    .prepare('INSERT INTO serial_cases (id, number, serial_id, bu_id) VALUES (?, ?, ?, ?)')
    .bind(id, number, serialId, 'bu1')
    .run();
}

async function insertEvent(
  id: string,
  serialId: string,
  caseId: string,
  seq: number,
  type: string,
  data: string,
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO serial_events (id, serial_id, case_id, seq, type, data_json) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .bind(id, serialId, caseId, seq, type, data)
    .run();
}

async function seedLegacy(): Promise<void> {
  await insertSerial('failed', 'failed', 'qc', 'loc-sby');
  await insertSerial('qcrep', 'qc_repair', 'qc', 'loc-sby');
  await insertSerial('atsvc', 'at_service', 'transit', 'loc-sby', {
    from: 'loc-sby',
    to: 'loc-svc',
  });
  await insertSerial('svcrep', 'service_repair', 'service', 'loc-svc');
  await insertSerial('recheck', 'recheck', 'qc', 'loc-sby');
  await insertSerial('broken', 'broken', 'service', 'loc-svc');
  await insertSerial('good', 'good', 'qc', 'loc-sby');
  // Sisa kirim antar lokasi: Lolos, masih dalam pengiriman Surabaya -> Jakarta.
  await insertSerial('between', 'good', 'transit', 'loc-sby', { from: 'loc-sby', to: 'loc-jkt' });
  // Pengiriman antar lokasi tanpa tujuan tercatat (data rusak): lokasi tetap.
  await insertSerial('nodest', 'good', 'transit', 'loc-sby');

  // Laporan yang pernah dikirim (kejadian send terawal menentukan asal) dan yang belum pernah dikirim.
  await insertCase('c-sent', 'LP-20261110-001', 'atsvc');
  await insertEvent(
    'e1',
    'atsvc',
    'c-sent',
    1,
    'report_failure',
    '{"caseNumber":"LP-20261110-001"}',
  );
  await insertEvent(
    'e2',
    'atsvc',
    'c-sent',
    2,
    'send',
    '{"leg":"to_service","fromLocationId":"loc-sby","toLocationId":"loc-svc"}',
  );
  await insertEvent(
    'e3',
    'atsvc',
    'c-sent',
    3,
    'send',
    '{"leg":"to_qc","fromLocationId":"loc-svc","toLocationId":"loc-sby"}',
  );
  await insertCase('c-unsent', 'LP-20261110-002', 'failed');
  await insertEvent('e4', 'failed', 'c-unsent', 1, 'report_failure', '{}');
  await insertCase('c-badjson', 'LP-20261110-003', 'qcrep');
  await insertEvent('e5', 'qcrep', 'c-badjson', 1, 'send', '');
}

const statuses = () =>
  db
    .prepare(
      'SELECT id, status, custody, location_id, transit_from_location_id, transit_to_location_id, transit_on FROM serials ORDER BY id',
    )
    .all<{
      id: string;
      status: string;
      custody: string;
      location_id: string;
      transit_from_location_id: string;
      transit_to_location_id: string;
      transit_on: string;
    }>()
    .then((r) => r.results);

const origins = () =>
  db
    .prepare('SELECT id, origin_location_id FROM serial_cases ORDER BY id')
    .all<{ id: string; origin_location_id: string }>()
    .then((r) => r.results);

describe('migrasi 0017 laporan rusak', () => {
  test('diterapkan oleh migrator dan memetakan status serta kustodi lama', async () => {
    const all = await loadMigrations();
    expect(
      await applyMigrations(
        db,
        all.filter((m) => m.name <= MIGRATION),
      ),
    ).toEqual([MIGRATION]);
    const by = Object.fromEntries((await statuses()).map((row) => [row.id, row]));
    expect(by.failed?.status).toBe('reported');
    expect(by.qcrep?.status).toBe('reported');
    // Status lain tidak berubah (termasuk kustodi dan lokasi).
    expect(by.atsvc).toMatchObject({
      status: 'at_service',
      custody: 'transit',
      location_id: 'loc-sby',
    });
    expect(by.atsvc?.transit_to_location_id).toBe('loc-svc');
    expect(by.svcrep).toMatchObject({ status: 'service_repair', custody: 'service' });
    expect(by.recheck).toMatchObject({ status: 'recheck', custody: 'qc' });
    expect(by.broken).toMatchObject({ status: 'broken', custody: 'service' });
    expect(by.good).toMatchObject({ status: 'good', custody: 'qc', location_id: 'loc-sby' });
    // Lolos + transit: kustodi QC di lokasi tujuan, kolom transit kosong.
    expect(by.between).toMatchObject({
      status: 'good',
      custody: 'qc',
      location_id: 'loc-jkt',
      transit_from_location_id: '',
      transit_to_location_id: '',
      transit_on: '',
    });
    // Tanpa tujuan tercatat: lokasi tetap.
    expect(by.nodest).toMatchObject({ custody: 'qc', location_id: 'loc-sby' });
  });

  test('lokasi QC asal diisi dari kejadian kirim terawal; tanpa kejadian kirim tetap kosong', async () => {
    const by = Object.fromEntries((await origins()).map((row) => [row.id, row.origin_location_id]));
    expect(by['c-sent']).toBe('loc-sby');
    expect(by['c-unsent']).toBe('');
    expect(by['c-badjson']).toBe('');
  });

  test('diulang dua kali memberi hasil identik', async () => {
    const statusesBefore = await statuses();
    const originsBefore = await origins();
    await db.exec(sql17);
    await db.exec(sql17);
    expect(await statuses()).toEqual(statusesBefore);
    expect(await origins()).toEqual(originsBefore);
  });

  test('kejadian lama tidak diubah (jumlah dan isi)', async () => {
    const rows = await db
      .prepare('SELECT id, type FROM serial_events ORDER BY id')
      .all<{ id: string; type: string }>();
    expect(rows.results.map((row) => `${row.id}:${row.type}`)).toEqual([
      'e1:report_failure',
      'e2:send',
      'e3:send',
      'e4:report_failure',
      'e5:send',
    ]);
  });

  test('kolom origin_location_id bawaan kosong untuk laporan baru (INSERT tanpa kolom itu)', async () => {
    await insertCase('c-new', 'LP-20261111-001', 'good');
    const row = await db
      .prepare("SELECT origin_location_id FROM serial_cases WHERE id = 'c-new'")
      .first<{ origin_location_id: string }>();
    expect(row?.origin_location_id).toBe('');
  });
});
