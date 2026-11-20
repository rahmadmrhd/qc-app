import { describe, expect, test } from 'bun:test';
import { captureAppErrorAsync } from '@server-test/errors';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { BATCH_MAX } from '@shared/batch';
import { batchGuarded } from './cas';
import { DbError } from './db';
import { nowIso } from './env';
import {
  baseIndexName,
  deletedWhere,
  liveWhere,
  mapLiveDuplicate,
  requireExistsStmt,
  restoreStmt,
  restoreWithChildren,
  SOFT_DELETE_TABLES,
  softDeleteStmt,
  softDeleteWithChildren,
  validateIdBatch,
  validateVersionedBatch,
} from './soft-delete';

async function addBrand(env: TestEnv, id: string, key: string): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO brands (id, name, `key`, status, created_at, updated_at, updated_by) VALUES (?, ?, ?, 'active', 't', 't', 'u')",
  )
    .bind(id, key, key)
    .run();
}

async function brandRow(env: TestEnv, id: string) {
  return env.DB.prepare('SELECT deleted_at AS at, deleted_by AS who FROM brands WHERE id = ?')
    .bind(id)
    .first<{ at: string; who: string }>();
}

const CONFLICTS = { brands_key: { field: 'name', message: 'Nama merk sudah dipakai' } };

describe('helper SQL', () => {
  test('liveWhere dan deletedWhere, dengan dan tanpa alias', () => {
    expect(liveWhere()).toBe("deleted_at = ''");
    expect(liveWhere('i')).toBe("i.deleted_at = ''");
    expect(deletedWhere()).toBe("deleted_at <> ''");
    expect(deletedWhere('i')).toBe("i.deleted_at <> ''");
  });

  test('SOFT_DELETE_TABLES berurutan tetap dan tanpa sticker_guide_images', () => {
    expect(SOFT_DELETE_TABLES).toHaveLength(15);
    expect(SOFT_DELETE_TABLES[0]).toBe('users');
    expect(SOFT_DELETE_TABLES as readonly string[]).not.toContain('sticker_guide_images');
  });

  test('baseIndexName membuang akhiran _live saja', () => {
    expect(baseIndexName('brands_key_live')).toBe('brands_key');
    expect(baseIndexName('brands_key')).toBe('brands_key');
    expect(baseIndexName('PRIMARY')).toBe('PRIMARY');
    expect(baseIndexName('qr_presets_bu_unique_live')).toBe('qr_presets_bu_unique');
  });

  test('nama tabel di luar daftar ditolak sebelum menjadi SQL', async () => {
    const env = await createTestEnv();
    expect(() => softDeleteStmt(env.DB, 'x; DROP TABLE items' as never, 'a', 'u', 't')).toThrow();
  });
});

describe('hapus dan pulihkan', () => {
  test('hapus mengisi deleted_at/deleted_by; hapus ulang tidak menimpa; pulihkan mengosongkan', async () => {
    const env = await createTestEnv();
    await addBrand(env, 'b1', 'a');
    await env.DB.batch([
      requireExistsStmt(env.DB, 'brands', 'b1'),
      softDeleteStmt(env.DB, 'brands', 'b1', 'admin@x.id', '2026-01-01T00:00:00.000Z'),
    ]);
    expect(await brandRow(env, 'b1')).toEqual({
      at: '2026-01-01T00:00:00.000Z',
      who: 'admin@x.id',
    });
    // hapus ulang: sukses (bukan galat), nilai pertama tetap
    await env.DB.batch([
      requireExistsStmt(env.DB, 'brands', 'b1'),
      softDeleteStmt(env.DB, 'brands', 'b1', 'lain@x.id', '2026-02-02T00:00:00.000Z'),
    ]);
    expect(await brandRow(env, 'b1')).toEqual({
      at: '2026-01-01T00:00:00.000Z',
      who: 'admin@x.id',
    });
    await restoreStmt(env.DB, 'brands', 'b1').run();
    expect(await brandRow(env, 'b1')).toEqual({ at: '', who: '' });
  });

  test('deleted_at memakai nowIso (jam terkendali)', async () => {
    const env = await createTestEnv();
    await addBrand(env, 'b1', 'a');
    await softDeleteStmt(env.DB, 'brands', 'b1', 'u@x.id', nowIso(env)).run();
    expect((await brandRow(env, 'b1'))?.at).toBe('2026-01-15T03:00:00.000Z');
  });

  test('dua record berkunci sama dihapus pada jam berbeda tidak bentrok', async () => {
    const env = await createTestEnv();
    await addBrand(env, 'b1', 'a');
    await softDeleteStmt(env.DB, 'brands', 'b1', 'u', nowIso(env)).run();
    // merk hidup baru dengan kunci sama: hanya boleh bila indeks lama brands_key tidak ada (setelah contract)
    await env.DB.prepare('ALTER TABLE brands DROP INDEX IF EXISTS brands_key').run();
    try {
      await addBrand(env, 'b2', 'a');
      env.clock.advance(1000);
      await softDeleteStmt(env.DB, 'brands', 'b2', 'u', nowIso(env)).run();
      const rows = await env.DB.prepare("SELECT id FROM brands WHERE `key` = 'a'").all();
      expect(rows.results).toHaveLength(2);
    } finally {
      await env.DB.prepare('DELETE FROM brands').run();
      await env.DB.prepare('CREATE UNIQUE INDEX IF NOT EXISTS brands_key ON brands (`key`)').run();
    }
  });

  test('pulihkan saat kunci dipakai record hidup = DbError duplicate dipetakan CONFLICT', async () => {
    const env = await createTestEnv();
    await addBrand(env, 'b1', 'a');
    await softDeleteStmt(env.DB, 'brands', 'b1', 'u', nowIso(env)).run();
    await env.DB.prepare('ALTER TABLE brands DROP INDEX IF EXISTS brands_key').run();
    try {
      await addBrand(env, 'b2', 'a');
      let caught: unknown;
      try {
        await env.DB.batch([restoreStmt(env.DB, 'brands', 'b1')]);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(DbError);
      expect((caught as DbError).kind).toBe('duplicate');
      expect((caught as DbError).key).toBe('brands_key_live');
      const mapped = mapLiveDuplicate(caught, CONFLICTS) as { code: string; message: string };
      expect(mapped).toMatchObject({ code: 'CONFLICT', message: 'Nama merk sudah dipakai' });
      expect((await brandRow(env, 'b1'))?.at).not.toBe('');
    } finally {
      await env.DB.prepare('DELETE FROM brands').run();
      await env.DB.prepare('CREATE UNIQUE INDEX IF NOT EXISTS brands_key ON brands (`key`)').run();
    }
  });

  test('requireExistsStmt: satu id asing membatalkan seluruh batch', async () => {
    const env = await createTestEnv();
    await addBrand(env, 'b1', 'a');
    const error = await captureAppErrorAsync(() =>
      batchGuarded(
        env.DB,
        [
          requireExistsStmt(env.DB, 'brands', 'nope'),
          softDeleteStmt(env.DB, 'brands', 'b1', 'u', nowIso(env)),
        ],
        {},
        'basi',
      ),
    );
    expect(error).toMatchObject({ code: 'CONFLICT', stale: true });
    expect((await brandRow(env, 'b1'))?.at).toBe('');
  });

  test('requireExistsStmt meloloskan baris yang sudah terhapus', async () => {
    const env = await createTestEnv();
    await addBrand(env, 'b1', 'a');
    await softDeleteStmt(env.DB, 'brands', 'b1', 'u', nowIso(env)).run();
    await env.DB.batch([requireExistsStmt(env.DB, 'brands', 'b1')]);
  });
});

describe('induk dengan anak', () => {
  async function addPostel(env: TestEnv) {
    await env.DB.prepare("INSERT INTO postels (id, updated_at) VALUES ('p1', 't')").run();
    await env.DB.prepare(
      "INSERT INTO postel_numbers (id, postel_id, number, number_key, seq) VALUES ('n1', 'p1', 'N-1', 'n-1', 1), ('n2', 'p1', 'N-2', 'n-2', 2)",
    ).run();
  }
  const CHILDREN = [{ table: 'postel_numbers', fk: 'postel_id' }] as const;
  const state = async (env: TestEnv) => ({
    parent: (
      await env.DB.prepare("SELECT deleted_at AS at FROM postels WHERE id = 'p1'").first<{
        at: string;
      }>()
    )?.at,
    children: (
      await env.DB.prepare('SELECT deleted_at AS at FROM postel_numbers ORDER BY id').all<{
        at: string;
      }>()
    ).results.map((r) => r.at),
  });

  test('hapus dan pulihkan induk beserta nomornya dalam satu batch', async () => {
    const env = await createTestEnv();
    await addPostel(env);
    const at = '2026-03-03T00:00:00.000Z';
    await env.DB.batch(softDeleteWithChildren(env.DB, 'postels', CHILDREN, 'p1', 'u', at));
    expect(await state(env)).toEqual({ parent: at, children: [at, at] });
    // hapus ulang tidak menyentuh apa pun
    await env.DB.batch(
      softDeleteWithChildren(env.DB, 'postels', CHILDREN, 'p1', 'u2', '2027-01-01T00:00:00.000Z'),
    );
    expect(await state(env)).toEqual({ parent: at, children: [at, at] });
    await env.DB.batch(restoreWithChildren(env.DB, 'postels', CHILDREN, 'p1'));
    expect(await state(env)).toEqual({ parent: '', children: ['', ''] });
  });

  test('nomor terhapus membebaskan kunci nomor untuk catatan lain', async () => {
    const env = await createTestEnv();
    await addPostel(env);
    await env.DB.batch(softDeleteWithChildren(env.DB, 'postels', CHILDREN, 'p1', 'u', nowIso(env)));
    await env.DB.prepare("INSERT INTO postels (id, updated_at) VALUES ('p2', 't')").run();
    await env.DB.prepare(
      'ALTER TABLE postel_numbers DROP INDEX IF EXISTS postel_numbers_key',
    ).run();
    try {
      await env.DB.prepare(
        "INSERT INTO postel_numbers (id, postel_id, number, number_key, seq) VALUES ('n9', 'p2', 'N-1', 'n-1', 1)",
      ).run();
    } finally {
      await env.DB.prepare('DELETE FROM postel_numbers').run();
      await env.DB.prepare(
        'CREATE UNIQUE INDEX IF NOT EXISTS postel_numbers_key ON postel_numbers (number_key)',
      ).run();
    }
  });
});

describe('validasi batch', () => {
  const code = (fn: () => unknown) => {
    try {
      fn();
    } catch (error) {
      return (error as { code?: string }).code;
    }
    return undefined;
  };

  test('validateIdBatch menerima 1..BATCH_MAX id unik', () => {
    expect(validateIdBatch({ ids: ['a'] })).toEqual({ ids: ['a'] });
    const max = Array.from({ length: BATCH_MAX }, (_, i) => `i${i}`);
    expect(validateIdBatch({ ids: max }).ids).toHaveLength(BATCH_MAX);
  });

  test('validateIdBatch menolak kosong, kelebihan, ganda, bukan teks, dan bukan objek', () => {
    expect(code(() => validateIdBatch({ ids: [] }))).toBe('VALIDATION');
    expect(
      code(() =>
        validateIdBatch({ ids: Array.from({ length: BATCH_MAX + 1 }, (_, i) => `i${i}`) }),
      ),
    ).toBe('VALIDATION');
    expect(code(() => validateIdBatch({ ids: ['a', 'a'] }))).toBe('VALIDATION');
    expect(code(() => validateIdBatch({ ids: [''] }))).toBe('VALIDATION');
    expect(code(() => validateIdBatch({ ids: [1] }))).toBe('VALIDATION');
    expect(code(() => validateIdBatch(null))).toBe('VALIDATION');
  });

  test('validateVersionedBatch memeriksa id unik dan updatedAt', () => {
    expect(validateVersionedBatch({ items: [{ id: 'a', updatedAt: 't' }] })).toEqual({
      items: [{ id: 'a', updatedAt: 't' }],
    });
    expect(code(() => validateVersionedBatch({ items: [] }))).toBe('VALIDATION');
    expect(
      code(() =>
        validateVersionedBatch({
          items: [
            { id: 'a', updatedAt: 't' },
            { id: 'a', updatedAt: 't' },
          ],
        }),
      ),
    ).toBe('VALIDATION');
    expect(code(() => validateVersionedBatch({ items: [{ id: 'a' }] }))).toBe('VALIDATION');
    expect(code(() => validateVersionedBatch({}))).toBe('VALIDATION');
  });
});
