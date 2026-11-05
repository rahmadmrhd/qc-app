// Tes adaptor Db terhadap MariaDB nyata di VPS lewat tunnel SSH (`bun run db:tunnel` harus hidup).
//
// Anggaran latensi (dasar harness tes T5): lihat tes "latensi" di bawah.
// Diukur 2026-11-05 dari Windows lewat tunnel SSH ke VPS: rata-rata ~20 ms per query sederhana (SELECT 1,
// 30 kali berurutan, satu koneksi hangat; dua kali jalan: 21,1 ms dan 20,1 ms). Anggaran T5: ~20 ms x jumlah round trip.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createDb, type Db, DbError, toDbError } from '@server/core/db';
import { testDbUrl } from '@server-test/db-env';

const URL_NO_DB = testDbUrl();
const SCHEMA = `qc_test_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;

let admin: Db; // tanpa database terpilih
let db: Db; // menunjuk SCHEMA

beforeAll(async () => {
  admin = createDb({ url: URL_NO_DB });
  await admin.exec(`CREATE DATABASE \`${SCHEMA}\``);
  db = createDb({ url: URL_NO_DB, database: SCHEMA });
  await db.exec(`
    CREATE TABLE t_kv (
      id INT PRIMARY KEY AUTO_INCREMENT,
      k VARCHAR(50) NOT NULL,
      v INT NOT NULL DEFAULT 0,
      UNIQUE KEY uq_k (k)
    );
    CREATE TABLE t_doc (id INT PRIMARY KEY, doc JSON, txt TEXT);
    CREATE TABLE t_text (s VARCHAR(20) PRIMARY KEY);
    CREATE TABLE t_big (id INT PRIMARY KEY, n BIGINT NOT NULL);
    INSERT INTO t_big VALUES (1, -9223372036854775807);
  `);
}, 30_000);

afterAll(async () => {
  await db?.close();
  if (admin) {
    await admin.exec(`DROP DATABASE IF EXISTS \`${SCHEMA}\``);
    await admin.close();
  }
}, 30_000);

describe('prepare/bind/first/all/run', () => {
  test('first mengembalikan baris atau null', async () => {
    await db.prepare('INSERT INTO t_kv (k, v) VALUES (?, ?)').bind('first-a', 7).run();
    const row = await db
      .prepare('SELECT k, v FROM t_kv WHERE k = ?')
      .bind('first-a')
      .first<{ k: string; v: number }>();
    expect(row).toEqual({ k: 'first-a', v: 7 });
    const none = await db.prepare('SELECT k FROM t_kv WHERE k = ?').bind('tidak-ada').first();
    expect(none).toBeNull();
  });

  test('all mengembalikan results dan run mengisi meta', async () => {
    const ins = await db
      .prepare('INSERT INTO t_kv (k, v) VALUES (?, ?), (?, ?)')
      .bind('m1', 1, 'm2', 2)
      .run();
    expect(ins.meta.changes).toBe(2);
    expect(ins.meta.lastRowId).toBeGreaterThan(0);
    const upd = await db.prepare("UPDATE t_kv SET v = v + 10 WHERE k LIKE 'm%'").run();
    expect(upd.meta.changes).toBe(2);
    const all = await db
      .prepare("SELECT k, v FROM t_kv WHERE k LIKE 'm%' ORDER BY k")
      .all<{ k: string; v: number }>();
    expect(all.results).toEqual([
      { k: 'm1', v: 11 },
      { k: 'm2', v: 12 },
    ]);
  });

  test('bind menolak objek/larik polos (JSON harus di-stringify)', () => {
    expect(() => db.prepare('SELECT ?').bind({ a: 1 })).toThrow();
    expect(() => db.prepare('SELECT ?').bind([1, 2])).toThrow();
  });

  test('kolam utama menolak banyak pernyataan sekaligus', async () => {
    await expect(db.prepare('SELECT 1; SELECT 2').all()).rejects.toBeInstanceOf(DbError);
  });
});

describe('batch', () => {
  test('atomik: pernyataan kedua gagal, pertama tak tertulis', async () => {
    await db.prepare('INSERT INTO t_kv (k) VALUES (?)').bind('dup-base').run();
    const p = db.batch([
      db.prepare('INSERT INTO t_kv (k) VALUES (?)').bind('atomic-1'),
      db.prepare('INSERT INTO t_kv (k) VALUES (?)').bind('dup-base'),
    ]);
    await expect(p).rejects.toMatchObject({ kind: 'duplicate', errno: 1062 });
    expect(await db.prepare('SELECT 1 FROM t_kv WHERE k = ?').bind('atomic-1').first()).toBeNull();
  });

  test('hasil searah dengan pernyataan', async () => {
    const res = await db.batch([
      db.prepare('INSERT INTO t_kv (k, v) VALUES (?, ?)').bind('b1', 5),
      db.prepare('SELECT v FROM t_kv WHERE k = ?').bind('b1'),
    ]);
    expect(res).toHaveLength(2);
    expect(res[0]?.meta.changes).toBe(1);
    expect(res[1]?.results).toEqual([{ v: 5 }]);
  });

  test('mengulang sekali pada deadlock', async () => {
    await db.batch([
      db.prepare('INSERT INTO t_kv (k, v) VALUES (?, 0)').bind('dl-1'),
      db.prepare('INSERT INTO t_kv (k, v) VALUES (?, 0)').bind('dl-2'),
    ]);
    // A mengunci dl-1 lalu minta dl-2; B mengunci dl-2 lalu minta dl-1: deadlock nyata, salah satu korban diulang.
    const a = db.batch([
      db.prepare("UPDATE t_kv SET v = v + 1 WHERE k = 'dl-1'"),
      db.prepare('SELECT SLEEP(1)'),
      db.prepare("UPDATE t_kv SET v = v + 1 WHERE k = 'dl-2'"),
    ]);
    const b = db.batch([
      db.prepare("UPDATE t_kv SET v = v + 1 WHERE k = 'dl-2'"),
      db.prepare('SELECT SLEEP(0.5)'),
      db.prepare("UPDATE t_kv SET v = v + 1 WHERE k = 'dl-1'"),
    ]);
    await Promise.all([a, b]); // tanpa ulang, korban deadlock melempar DbError{kind:'deadlock'}
    const rows = await db
      .prepare("SELECT k, v FROM t_kv WHERE k LIKE 'dl-%' ORDER BY k")
      .all<{ k: string; v: number }>();
    expect(rows.results).toEqual([
      { k: 'dl-1', v: 2 },
      { k: 'dl-2', v: 2 },
    ]);
  }, 30_000);

  test('out_of_range membatalkan batch', async () => {
    const p = db.batch([
      db.prepare('INSERT INTO t_kv (k) VALUES (?)').bind('oor-1'),
      db.prepare('UPDATE t_big SET n = (-9223372036854775807 - 2) WHERE id = 1'),
    ]);
    await expect(p).rejects.toMatchObject({ kind: 'out_of_range', errno: 1690 });
    expect(await db.prepare('SELECT 1 FROM t_kv WHERE k = ?').bind('oor-1').first()).toBeNull();
  });
});

describe('data', () => {
  test('JSON dan emoji utuh bolak-balik', async () => {
    const doc = { nama: 'Tes 😀', arr: [1, 2, { x: 'é' }] };
    await db
      .prepare('INSERT INTO t_doc (id, doc, txt) VALUES (?, ?, ?)')
      .bind(1, JSON.stringify(doc), 'emoji 😀 utuh')
      .run();
    const row = await db
      .prepare('SELECT doc, txt FROM t_doc WHERE id = ?')
      .bind(1)
      .first<{ doc: string; txt: string }>();
    expect(JSON.parse(row?.doc ?? 'null')).toEqual(doc);
    expect(row?.txt).toBe('emoji 😀 utuh');
  });

  test('spasi ekor dibedakan (utf8mb4_nopad_bin)', async () => {
    await db.batch([
      db.prepare('INSERT INTO t_text (s) VALUES (?)').bind('a'),
      db.prepare('INSERT INTO t_text (s) VALUES (?)').bind('a '),
    ]);
    const n = await db.prepare('SELECT COUNT(*) AS n FROM t_text').first<{ n: number }>();
    expect(Number(n?.n)).toBe(2);
    const eq = await db.prepare("SELECT 'a ' = 'a' AS eq").first<{ eq: number }>();
    expect(Number(eq?.eq)).toBe(0); // koneksi memakai kolasi nopad_bin juga untuk literal
  });

  test('BIGINT besar tidak kehilangan presisi', async () => {
    const row = await db
      .prepare('SELECT n FROM t_big WHERE id = 1')
      .first<{ n: number | string }>();
    expect(String(row?.n)).toBe('-9223372036854775807');
  });
});

describe('galat', () => {
  test('INSERT duplikat: kind duplicate dengan nama indeks', async () => {
    await db.prepare('INSERT INTO t_kv (k) VALUES (?)').bind('uniq').run();
    const err = await db
      .prepare('INSERT INTO t_kv (k) VALUES (?)')
      .bind('uniq')
      .run()
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DbError);
    expect(err).toMatchObject({ kind: 'duplicate', errno: 1062, key: 'uq_k' });
  });

  test('toDbError memetakan errno', () => {
    expect(toDbError({ errno: 1213, message: 'Deadlock' }).kind).toBe('deadlock');
    expect(toDbError({ errno: 1205, message: 'Lock wait timeout' }).kind).toBe('deadlock');
    expect(toDbError({ errno: 1690, message: 'BIGINT value is out of range' }).kind).toBe(
      'out_of_range',
    );
    expect(
      toDbError({ errno: 1062, message: "Duplicate entry 'x' for key 'tbl.idx_x'" }),
    ).toMatchObject({
      kind: 'duplicate',
      key: 'idx_x',
    });
    expect(toDbError({ code: 'ECONNREFUSED', message: 'x' }).kind).toBe('unavailable');
    expect(toDbError({ code: 'ETIMEDOUT', message: 'x' }).kind).toBe('unavailable');
    expect(toDbError({ errno: 1064, message: 'syntax' }).kind).toBe('other');
    const same = new DbError('s', { errno: 1, kind: 'other' });
    expect(toDbError(same)).toBe(same);
  });

  test('tunnel mati: unavailable < 5 dtk dan menyebut db:tunnel', async () => {
    const dead = createDb({ url: 'mysql://qc_test:x@127.0.0.1:1/' });
    const t0 = performance.now();
    const err = await dead
      .prepare('SELECT 1')
      .first()
      .catch((e: unknown) => e);
    const ms = performance.now() - t0;
    await dead.close();
    expect(err).toBeInstanceOf(DbError);
    expect((err as DbError).kind).toBe('unavailable');
    expect((err as DbError).message).toContain('db:tunnel');
    expect(ms).toBeLessThan(5000);
  }, 15_000);
});

describe('database terpilih', () => {
  test('URL tanpa nama database: tanpa DB terpilih, nama berkualifikasi jalan', async () => {
    const cur = await admin.prepare('SELECT DATABASE() AS d').first<{ d: string | null }>();
    expect(cur?.d).toBeNull();
    const row = await admin
      .prepare(`SELECT COUNT(*) AS n FROM \`${SCHEMA}\`.t_text`)
      .first<{ n: number }>();
    expect(Number(row?.n)).toBeGreaterThanOrEqual(0);
  });

  test('URL dengan nama database atau opsi database', async () => {
    const cur = await db.prepare('SELECT DATABASE() AS d').first<{ d: string }>();
    expect(cur?.d).toBe(SCHEMA);
    const inline = createDb({ url: `${URL_NO_DB.replace(/\/?$/, '/')}${SCHEMA}` });
    try {
      const c2 = await inline.prepare('SELECT DATABASE() AS d').first<{ d: string }>();
      expect(c2?.d).toBe(SCHEMA);
    } finally {
      await inline.close();
    }
  });
});

describe('exec', () => {
  test('banyak pernyataan lewat koneksi khusus', async () => {
    await db.exec('CREATE TABLE t_exec (a INT); INSERT INTO t_exec VALUES (1), (2);');
    const n = await db.prepare('SELECT COUNT(*) AS n FROM t_exec').first<{ n: number }>();
    expect(Number(n?.n)).toBe(2);
  });
});

describe('latensi', () => {
  test('rata-rata satu query lewat tunnel', async () => {
    await db.prepare('SELECT 1').first(); // hangatkan koneksi
    const N = 30;
    const t0 = performance.now();
    for (let i = 0; i < N; i++) await db.prepare('SELECT 1 AS x').first();
    const avg = (performance.now() - t0) / N;
    console.log(`LATENCY avg=${avg.toFixed(1)}ms per query (N=${N}) lewat tunnel`);
    expect(avg).toBeLessThan(500);
  }, 60_000);
});

describe('testDbUrl', () => {
  test('kosong: galat menyebut db:tunnel', () => {
    expect(() => testDbUrl({ env: {}, file: 'tidak-ada.env' })).toThrow('db:tunnel');
  });

  test('membaca dari env', () => {
    expect(testDbUrl({ env: { QC_TEST_DB_URL: 'mysql://u:p@127.0.0.1:1/' } })).toBe(
      'mysql://u:p@127.0.0.1:1/',
    );
  });
});
