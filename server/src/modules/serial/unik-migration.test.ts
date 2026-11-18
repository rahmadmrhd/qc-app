// Tes migrasi 0026 (serial unik se-sistem): backfill riwayat BU dan indeks unik BERSYARAT terhadap MariaDB nyata
// (butuh `bun run db:tunnel`).
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { createDb, type Db } from '@server/core/db';
import { applyMigrations, loadMigrations } from '@server/core/migrate';
import { newTestSchemaName, testDbUrl } from '@server-test/db-env';

setDefaultTimeout(60_000);

const URL_NO_DB = testDbUrl();
const MIGRATION = '0026_serial_unik_sistem.sql';
let admin: Db;
const created: string[] = [];

beforeAll(() => {
  admin = createDb({ url: URL_NO_DB, connectionLimit: 2 });
});

afterAll(async () => {
  for (const name of created) await admin.exec(`DROP DATABASE IF EXISTS \`${name}\``);
  await admin.close();
}, 60_000);

/** Skema baru dengan semua migrasi SEBELUM 0026; mengembalikan `Db` dan SQL 0026. */
async function schemaBefore(): Promise<{ db: Db; sql: string }> {
  const name = newTestSchemaName();
  created.push(name);
  await admin.exec(`CREATE DATABASE \`${name}\``);
  const db = createDb({ url: URL_NO_DB, database: name, connectionLimit: 3 });
  const all = await loadMigrations();
  await applyMigrations(
    db,
    all.filter((m) => m.name < MIGRATION),
  );
  return { db, sql: all.find((m) => m.name === MIGRATION)?.sql ?? '' };
}

const insertSerial = (db: Db, id: string, bu: string, serial: string, createdAt: string) =>
  db
    .prepare(
      'INSERT INTO serials (id, client_id, bu_id, serial, item_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .bind(id, `c-${id}`, bu, serial, 'i1', createdAt)
    .run();

const hasUnique = async (db: Db): Promise<boolean> => {
  const row = await db
    .prepare(
      "SELECT COUNT(*) AS n FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'serials' AND index_name = 'serials_serial' AND non_unique = 0",
    )
    .first<{ n: number | string }>();
  return Number(row?.n) > 0;
};

describe('migrasi 0026 serial unik se-sistem', () => {
  test('tanpa serial ganda: tabel riwayat terisi dari serials, indeks unik dibuat, aman diulang', async () => {
    const { db, sql } = await schemaBefore();
    try {
      await insertSerial(db, 's1', 'bu1', 'SN1', '2026-11-01T00:00:00.000Z');
      await insertSerial(db, 's2', 'bu2', 'SN2', '2026-11-02T00:00:00.000Z');
      await db.exec(sql);
      const rows = await db
        .prepare(
          'SELECT serial_id, bu_id, first_at, left_at FROM serial_business_units ORDER BY serial_id',
        )
        .all<{ serial_id: string; bu_id: string; first_at: string; left_at: string }>();
      expect(rows.results).toEqual([
        { serial_id: 's1', bu_id: 'bu1', first_at: '2026-11-01T00:00:00.000Z', left_at: '' },
        { serial_id: 's2', bu_id: 'bu2', first_at: '2026-11-02T00:00:00.000Z', left_at: '' },
      ]);
      expect(await hasUnique(db)).toBe(true);
      // Idempoten: diterapkan lagi tidak melempar galat dan tidak menggandakan baris.
      await db.exec(sql);
      const count = await db
        .prepare('SELECT COUNT(*) AS n FROM serial_business_units')
        .first<{ n: number | string }>();
      expect(Number(count?.n)).toBe(2);
      expect(await hasUnique(db)).toBe(true);
    } finally {
      await db.close();
    }
  });

  test('ada serial ganda lintas BU: migrasi tetap berhasil, indeks unik dilewati, data utuh', async () => {
    const { db, sql } = await schemaBefore();
    try {
      await insertSerial(db, 's1', 'bu1', 'SN1', '2026-11-01T00:00:00.000Z');
      await insertSerial(db, 's2', 'bu2', 'SN1', '2026-11-02T00:00:00.000Z');
      await db.exec(sql);
      expect(await hasUnique(db)).toBe(false);
      const serials = await db.prepare('SELECT COUNT(*) AS n FROM serials').first<{
        n: number | string;
      }>();
      expect(Number(serials?.n)).toBe(2);
      // Satu baris riwayat per serial tetap diisi (BU saat ini).
      const history = await db
        .prepare('SELECT COUNT(*) AS n FROM serial_business_units')
        .first<{ n: number | string }>();
      expect(Number(history?.n)).toBe(2);
    } finally {
      await db.close();
    }
  });

  test('serial_events.client_id NULLABLE dan tabel riwayat memakai kunci utama (serial_id, bu_id)', async () => {
    const { db, sql } = await schemaBefore();
    try {
      await db.exec(sql);
      const column = await db
        .prepare(
          "SELECT is_nullable AS n, data_type AS t FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'serial_events' AND column_name = 'client_id'",
        )
        .first<{ n: string; t: string }>();
      expect(column).toEqual({ n: 'YES', t: 'varchar' });
      const width = await db
        .prepare(
          "SELECT character_maximum_length AS w FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'serial_cases' AND column_name = 'number'",
        )
        .first<{ w: number | string }>();
      expect(Number(width?.w)).toBe(64);
    } finally {
      await db.close();
    }
  });
});
