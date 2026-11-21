import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { DbError } from '@server/core/db';
import { baseIndexName } from '@server/core/index-names';
import { seedSerial, seedSerialWorld } from '@server-test/serial-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import {
  backfillSerialBusinessUnits,
  ensureSerialUniqueIndex,
  involvedBuIds,
  moveBuStatements,
  readableSerialSql,
} from './bu-history';

setDefaultTimeout(60_000);

let env: TestEnv;

beforeEach(async () => {
  env = await createTestEnv();
  await seedSerialWorld(env);
});

// Skema uji dipakai bersama seluruh berkas di satu proses: apa pun yang dilakukan tes pada indeks unik dipulihkan.
afterEach(async () => {
  await env.DB.prepare('DELETE FROM serials').run();
  await ensureSerialUniqueIndex(env);
});

const rowsOf = (serialId: string) =>
  env.DB.prepare(
    'SELECT bu_id, first_at, left_at FROM serial_business_units WHERE serial_id = ? ORDER BY bu_id',
  )
    .bind(serialId)
    .all<{ bu_id: string; first_at: string; left_at: string }>()
    .then((r) => r.results);

const hasNamedIndex = (name: string) =>
  env.DB.prepare(
    "SELECT COUNT(*) AS n FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'serials' AND index_name = ?",
  )
    .bind(name)
    .first<{ n: number | string }>()
    .then((r) => Number(r?.n) > 0);

const hasIndex = () => hasNamedIndex('serials_serial_live');

/** Lepas kedua indeks unik serial (lama dan `_live`) agar serial ganda dapat disisipkan; `afterEach` memulihkannya. */
const dropSerialIndexes = async () => {
  await env.DB.prepare('DROP INDEX IF EXISTS serials_serial ON serials').run();
  await env.DB.prepare('DROP INDEX IF EXISTS serials_serial_live ON serials').run();
};

/** Sisipkan serial TANPA baris penghubung (seperti image lama). */
const rawSerial = (id: string, buId: string, serial: string) =>
  env.DB.prepare(
    "INSERT INTO serials (id, client_id, bu_id, serial, item_id, created_at) VALUES (?, ?, ?, ?, 'i-a1', '2026-11-12T00:00:00.000Z')",
  )
    .bind(id, `c-${id}`, buId, serial)
    .run();

describe('backfillSerialBusinessUnits', () => {
  test('mengisi baris BU saat ini untuk serial tanpa baris penghubung, idempoten, dan tak menyentuh yang sudah ada', async () => {
    await rawSerial('s1', 'bu-a', 'SN1');
    await rawSerial('s2', 'bu-b', 'SN2');
    await backfillSerialBusinessUnits(env);
    await backfillSerialBusinessUnits(env);
    expect(await rowsOf('s1')).toEqual([
      { bu_id: 'bu-a', first_at: '2026-11-12T00:00:00.000Z', left_at: '' },
    ]);
    expect(await rowsOf('s2')).toEqual([
      { bu_id: 'bu-b', first_at: '2026-11-12T00:00:00.000Z', left_at: '' },
    ]);
    // Serial yang sudah punya riwayat (A lalu B) tidak diubah.
    await seedSerial(env, { id: 's3', serial: 'SN3', buId: 'bu-a' });
    await env.DB.batch(
      moveBuStatements(env, { serialId: 's3', fromBuId: 'bu-a', toBuId: 'bu-b', now: 't1' }),
    );
    await backfillSerialBusinessUnits(env);
    expect((await rowsOf('s3')).map((r) => [r.bu_id, r.left_at])).toEqual([
      ['bu-a', 't1'],
      ['bu-b', ''],
    ]);
  });
});

describe('ensureSerialUniqueIndex', () => {
  test('tanpa serial ganda: sudah ada (dari templat) lalu dibuat ulang setelah dihapus, idempoten', async () => {
    expect(await ensureSerialUniqueIndex(env)).toBe('exists');
    await env.DB.prepare('DROP INDEX serials_serial_live ON serials').run();
    expect(await hasIndex()).toBe(false);
    expect(await ensureSerialUniqueIndex(env)).toBe('created');
    expect(await hasIndex()).toBe(true);
    expect(await ensureSerialUniqueIndex(env)).toBe('exists');
  });

  test('setelah contract hanya serials_serial_live yang ada; indeks lama (serials_serial, serials_bu_serial) tak dibuat dan dibuang bila tersisa', async () => {
    expect(await hasNamedIndex('serials_serial_live')).toBe(true);
    expect(await hasNamedIndex('serials_serial')).toBe(false);
    expect(await hasNamedIndex('serials_bu_serial')).toBe(false);
    await env.DB.prepare('CREATE UNIQUE INDEX serials_serial ON serials (serial)').run();
    expect(await ensureSerialUniqueIndex(env)).toBe('exists');
    expect(await hasNamedIndex('serials_serial')).toBe(false);
    await dropSerialIndexes();
    expect(await ensureSerialUniqueIndex(env)).toBe('created');
    expect(await hasNamedIndex('serials_serial_live')).toBe(true);
    expect(await hasNamedIndex('serials_serial')).toBe(false);
  });

  test('serial ganda lintas BU: duplicates tanpa galat dan tanpa mengubah data; dibuat setelah gandanya hilang', async () => {
    await dropSerialIndexes();
    await rawSerial('s1', 'bu-a', 'SN1');
    await rawSerial('s2', 'bu-b', 'SN1');
    await rawSerial('s3', 'bu-a', 'SN2');
    expect(await ensureSerialUniqueIndex(env)).toBe('duplicates');
    expect(await hasIndex()).toBe(false);
    expect(await hasNamedIndex('serials_serial_live')).toBe(false);
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM serials').first<{
      n: number | string;
    }>();
    expect(Number(count?.n)).toBe(3);
    await env.DB.prepare("DELETE FROM serials WHERE id = 's2'").run();
    expect(await ensureSerialUniqueIndex(env)).toBe('created');
  });

  test('indeks unik menolak serial ganda lintas BU dengan kunci serials_serial', async () => {
    await rawSerial('s1', 'bu-a', 'SN1');
    const error = await rawSerial('s2', 'bu-b', 'SN1').catch((e) => e);
    expect(error).toBeInstanceOf(DbError);
    expect((error as DbError).kind).toBe('duplicate');
    expect(baseIndexName((error as DbError).key ?? '')).toBe('serials_serial');
  });
});

describe('involvedBuIds dan moveBuStatements', () => {
  test('pindah A ke B: baris lama ditandai, baris baru dibuat, bu_id berganti, involvedBuIds memuat keduanya', async () => {
    await seedSerial(env, { id: 's1', serial: 'SN1', buId: 'bu-a' });
    expect(await involvedBuIds(env.DB, 's1')).toEqual(['bu-a']);
    await env.DB.batch(
      moveBuStatements(env, { serialId: 's1', fromBuId: 'bu-a', toBuId: 'bu-b', now: 't1' }),
    );
    const rows = await rowsOf('s1');
    expect(rows).toEqual([
      { bu_id: 'bu-a', first_at: '2026-11-12T00:00:00.000Z', left_at: 't1' },
      { bu_id: 'bu-b', first_at: 't1', left_at: '' },
    ]);
    const serial = await env.DB.prepare('SELECT bu_id FROM serials WHERE id = ?')
      .bind('s1')
      .first<{ bu_id: string }>();
    expect(serial?.bu_id).toBe('bu-b');
    expect([...(await involvedBuIds(env.DB, 's1'))].sort()).toEqual(['bu-a', 'bu-b']);
  });

  test('kembali ke BU yang pernah terlibat (A lalu B lalu A) gagal seluruhnya tanpa mengubah apa pun', async () => {
    await seedSerial(env, { id: 's1', serial: 'SN1', buId: 'bu-a' });
    await env.DB.batch(
      moveBuStatements(env, { serialId: 's1', fromBuId: 'bu-a', toBuId: 'bu-b', now: 't1' }),
    );
    const error = await env.DB.batch(
      moveBuStatements(env, { serialId: 's1', fromBuId: 'bu-b', toBuId: 'bu-a', now: 't2' }),
    ).catch((e) => e);
    expect(error).toBeInstanceOf(DbError);
    expect((error as DbError).kind).toBe('duplicate');
    expect((error as DbError).key).toBe('PRIMARY');
    expect((await rowsOf('s1')).map((r) => [r.bu_id, r.left_at])).toEqual([
      ['bu-a', 't1'],
      ['bu-b', ''],
    ]);
    const serial = await env.DB.prepare('SELECT bu_id FROM serials WHERE id = ?')
      .bind('s1')
      .first<{ bu_id: string }>();
    expect(serial?.bu_id).toBe('bu-b');
  });

  test('BU asal sudah bukan BU saat ini (penulis lain mendahului): batch dibatalkan penjaga', async () => {
    await seedSerial(env, { id: 's1', serial: 'SN1', buId: 'bu-a' });
    await env.DB.batch(
      moveBuStatements(env, { serialId: 's1', fromBuId: 'bu-a', toBuId: 'bu-b', now: 't1' }),
    );
    const error = await env.DB.batch(
      moveBuStatements(env, { serialId: 's1', fromBuId: 'bu-a', toBuId: 'bu-c', now: 't2' }),
    ).catch((e) => e);
    expect(error).toBeInstanceOf(DbError);
    expect((error as DbError).kind).toBe('out_of_range');
    expect((await rowsOf('s1')).map((r) => r.bu_id)).toEqual(['bu-a', 'bu-b']);
  });

  test('serial tanpa baris penghubung (image lama): baris BU asal dilengkapi saat pindah', async () => {
    await rawSerial('s1', 'bu-a', 'SN1');
    expect(await involvedBuIds(env.DB, 's1')).toEqual(['bu-a']);
    await env.DB.batch(
      moveBuStatements(env, { serialId: 's1', fromBuId: 'bu-a', toBuId: 'bu-b', now: 't1' }),
    );
    expect((await rowsOf('s1')).map((r) => [r.bu_id, r.left_at])).toEqual([
      ['bu-a', 't1'],
      ['bu-b', ''],
    ]);
  });
});

describe('readableSerialSql', () => {
  const visible = async (buIds: string[]) => {
    const where = readableSerialSql('s', buIds.length);
    const res = await env.DB.prepare(`SELECT s.id FROM serials s WHERE ${where} ORDER BY s.id`)
      .bind(...buIds, ...buIds)
      .all<{ id: string }>();
    return res.results.map((r) => r.id);
  };

  test('menemukan serial lewat bu_id saja, lewat baris penghubung saja (BU lama), dan BU lain tidak', async () => {
    await rawSerial('hanya-bu-id', 'bu-a', 'SN1'); // tanpa baris penghubung
    await seedSerial(env, { id: 'pindah', serial: 'SN2', buId: 'bu-a' });
    await env.DB.batch(
      moveBuStatements(env, { serialId: 'pindah', fromBuId: 'bu-a', toBuId: 'bu-b', now: 't1' }),
    );
    await seedSerial(env, { id: 'milik-b', serial: 'SN3', buId: 'bu-b' });
    expect(await visible(['bu-a'])).toEqual(['hanya-bu-id', 'pindah']);
    expect(await visible(['bu-b'])).toEqual(['milik-b', 'pindah']);
    expect(await visible(['bu-a', 'bu-b'])).toEqual(['hanya-bu-id', 'milik-b', 'pindah']);
    expect(await visible(['bu-c'])).toEqual([]);
  });

  test('daftar BU kosong = tidak ada yang terlihat dan SQL tanpa placeholder', () => {
    expect(readableSerialSql('s', 0)).toBe('(1 = 0)');
    expect(readableSerialSql('x', 2).match(/\?/g)).toHaveLength(4);
  });
});
