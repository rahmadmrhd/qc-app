import { describe, expect, test } from 'bun:test';
import { createSqliteD1 } from './sqlite-d1';
import { createTestEnv } from './test-env';

async function setup() {
  const db = createSqliteD1();
  await db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, n INTEGER)');
  return db;
}

describe('createSqliteD1', () => {
  test('batch atomik: pernyataan kedua gagal membatalkan yang pertama', async () => {
    const db = await setup();
    await expect(
      db.batch([
        db.prepare('INSERT INTO t (name, n) VALUES (?, ?)').bind('a', 1),
        db.prepare('INSERT INTO t (name, n) VALUES (?, ?)').bind('a', 2),
      ]),
    ).rejects.toThrow();
    const count = await db.prepare('SELECT COUNT(*) AS c FROM t').first<{ c: number }>();
    expect(count?.c).toBe(0);
  });

  test('batch sukses mengembalikan hasil per pernyataan', async () => {
    const db = await setup();
    const results = await db.batch([
      db.prepare('INSERT INTO t (name, n) VALUES (?, ?)').bind('a', 1),
      db.prepare('SELECT name FROM t WHERE n = ?').bind(1),
    ]);
    expect(results).toHaveLength(2);
    expect(results[0]?.meta.changes).toBe(1);
    expect(results[1]?.results).toEqual([{ name: 'a' }]);
  });

  test('bind lebih dari 100 parameter melempar; tepat 100 boleh', async () => {
    const db = await setup();
    const hundred = Array.from({ length: 100 }, (_, i) => i);
    const placeholders = (n: number) => Array.from({ length: n }, () => '?').join(',');
    await db
      .prepare(`SELECT ${placeholders(100)}`)
      .bind(...hundred)
      .all();
    expect(() => db.prepare(`SELECT ${placeholders(101)}`).bind(...hundred, 1)).toThrow(/100/);
  });

  test('first() mengembalikan null bila kosong, dan kolom bila diminta', async () => {
    const db = await setup();
    expect(await db.prepare('SELECT * FROM t WHERE id = ?').bind(1).first()).toBeNull();
    await db.prepare('INSERT INTO t (name, n) VALUES (?, ?)').bind('a', 7).run();
    expect(await db.prepare('SELECT n FROM t').first<number>('n')).toBe(7);
    expect((await db.prepare('SELECT * FROM t').first()) as unknown).toEqual({
      id: 1,
      name: 'a',
      n: 7,
    });
  });

  test('RETURNING bekerja lewat first() dan all()', async () => {
    const db = await setup();
    await db.prepare('INSERT INTO t (name, n) VALUES (?, 0)').bind('c').run();
    const row = await db
      .prepare('UPDATE t SET n = n + 1 WHERE name = ? RETURNING n')
      .bind('c')
      .first<{ n: number }>();
    expect(row?.n).toBe(1);
    const all = await db.prepare('UPDATE t SET n = n + 1 RETURNING n').all<{ n: number }>();
    expect(all.results).toEqual([{ n: 2 }]);
  });

  test('run() melaporkan changes dan last_row_id', async () => {
    const db = await setup();
    const res = await db.prepare('INSERT INTO t (name, n) VALUES (?, ?)').bind('x', 1).run();
    expect(res.success).toBe(true);
    expect(res.meta.changes).toBe(1);
    expect(res.meta.last_row_id).toBe(1);
    const none = await db.prepare('UPDATE t SET n = 2 WHERE name = ?').bind('zzz').run();
    expect(none.meta.changes).toBe(0);
  });

  test('raw() mengembalikan baris sebagai larik, dengan nama kolom bila diminta', async () => {
    const db = await setup();
    await db.prepare('INSERT INTO t (name, n) VALUES (?, ?)').bind('x', 1).run();
    expect(await db.prepare('SELECT name, n FROM t').raw()).toEqual([['x', 1]]);
    expect(await db.prepare('SELECT name, n FROM t').raw({ columnNames: true })).toEqual([
      ['name', 'n'],
      ['x', 1],
    ]);
  });

  test('nilai undefined ditolak; boolean menjadi 0/1; null diterima', async () => {
    const db = await setup();
    expect(() => db.prepare('SELECT ?').bind(undefined)).toThrow();
    const row = await db.prepare('SELECT ? AS a, ? AS b').bind(true, null).first();
    expect(row).toEqual({ a: 1, b: null });
  });
});

describe('createTestEnv', () => {
  test('jam terkendali dan antrean/jembatan palsu', async () => {
    const env = await createTestEnv();
    env.clock.set(1_000);
    expect(env.NOW?.()).toBe(1_000);
    env.clock.advance(500);
    expect(env.NOW?.()).toBe(1_500);
    await env.JOBS.send({ jobId: 'j1' });
    expect(env.queued).toEqual([{ jobId: 'j1' }]);
    expect(env.BRIDGE).toBeDefined();
    await env.DB.prepare('SELECT 1').first();
  });

  test('overrides menimpa nilai bawaan', async () => {
    const env = await createTestEnv({ SESSION_SECRET: 'lain' });
    expect(env.SESSION_SECRET).toBe('lain');
  });
});
