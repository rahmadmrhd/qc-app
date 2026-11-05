import { beforeEach, describe, expect, test } from 'bun:test';
import type { DbStatement } from '@server/core/db';
import type { UserContext } from '@server/modules/access/context';
import { loadUserContext } from '@server/modules/access/context';
import { saveItem, setItemStatus } from '@server/modules/item/service';
import { currentSyncRev } from '@server/modules/sync/state';
import { captureAppErrorAsync } from '@server-test/errors';
import { brandIdOf, seedBrand, seedItem } from '@server-test/item-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { itemKey } from '@shared/items';
import { saveBrand, setBrandStatus } from './service';

// I6: tes perilaku ganti nama merk (multi-potongan, atomisitas, konkurensi) sebagai pengganti tes yang dihapus;
// I1: penjaga merk pada penulisan item; I2: perubahan status tidak menimpa nama/kunci.

let env: TestEnv;
let admin: UserContext;

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-10-09T00:00:00.000Z'));
  const ctx = await loadUserContext(env, 'admin@gmail.com');
  if (!ctx) throw new Error('admin hilang');
  admin = ctx;
});

const auditCount = async () =>
  (await env.DB.prepare('SELECT COUNT(*) AS n FROM audit_log').first<{ n: number }>())?.n;

const brandRow = async (id: string) =>
  env.DB.prepare('SELECT name, `key`, status FROM brands WHERE id = ?')
    .bind(id)
    .first<{ name: string; key: string; status: string }>();

const itemRow = async (id: string) =>
  env.DB.prepare('SELECT `key`, sync_rev FROM items WHERE id = ?')
    .bind(id)
    .first<{ key: string; sync_rev: number }>();

const ITEM_BASE = {
  isCountryLock: false,
  aliases: [] as string[],
  stickers: [],
  accessories: [],
  attachments: [] as string[],
  detail: '',
};

/** Menyisipkan `count` item merk `brand` sekaligus (id `i0001`..; kunci `<merk> m <n>`; revisi `startRev + n`). */
async function seedBulkItems(brand: string, count: number, startRev: number): Promise<void> {
  const brandId = brandIdOf(brand);
  const rows = Array.from({ length: count }, (_, index) => {
    const n = index + 1;
    return [
      `i${String(n).padStart(4, '0')}`,
      brandId,
      `M ${n}`,
      itemKey(brand, `M ${n}`),
      startRev + n,
    ];
  });
  const values =
    "(?, ?, ?, ?, 'active', ?, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 'seed')";
  for (let from = 0; from < rows.length; from += 100) {
    const chunk = rows.slice(from, from + 100);
    await env.DB.prepare(
      `INSERT INTO items (id, brand_id, model, \`key\`, status, sync_rev, created_at, updated_at, updated_by) VALUES ${chunk.map(() => values).join(',')}`,
    )
      .bind(...chunk.flat())
      .run();
  }
  await env.DB.prepare('UPDATE brands SET item_count = ? WHERE id = ?').bind(count, brandId).run();
}

/** Setiap item harus berkunci `itemKey(nama merk saat ini, tipe)`: invarian yang dijaga ganti nama merk. */
async function assertItemKeysMatchBrands(): Promise<void> {
  const rows = (
    await env.DB.prepare(
      'SELECT i.id, i.model, i.`key` AS k, b.name AS brand FROM items i JOIN brands b ON b.id = i.brand_id',
    ).all<{ id: string; model: string; k: string; brand: string }>()
  ).results;
  expect(rows.filter((row) => row.k !== itemKey(row.brand, row.model))).toEqual([]);
}

/** DB yang menahan penulisan pertama yang cocok `match` sampai `release()`; `atWrite` selesai saat penulisan itu tiba. */
function gatedEnv(match: RegExp) {
  let reached!: () => void;
  const atWrite = new Promise<void>((resolve) => {
    reached = resolve;
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let fired = false;
  const delayed = {
    ...env,
    DB: {
      ...env.DB,
      batch: async (statements: Parameters<typeof env.DB.batch>[0]) => {
        const hit = statements.some((s) => match.test((s as unknown as { sql: string }).sql));
        if (!fired && hit) {
          fired = true;
          reached();
          await gate;
        }
        return env.DB.batch(statements);
      },
    },
  } as TestEnv;
  return { delayed, atWrite, release };
}

const ITEM_WRITE = /^\s*(INSERT INTO items|UPDATE items)/;

describe('ganti nama merk: perilaku (pengganti tes yang dihapus)', () => {
  test('205 item (dua potongan UPDATE): semua kunci baru, revisi berurutan lintas potongan, hitungan tetap', async () => {
    await seedBrand(env, 'Lama');
    await seedBulkItems('Lama', 205, 1000);
    await env.DB.prepare(
      "INSERT INTO sync_state (resource, seq, updated_at) VALUES ('items', 1205, '')",
    ).run();
    const saved = await saveBrand(env, { id: 'brand-lama', name: 'Baru' }, admin);
    expect(saved.itemCount).toBe(205);
    const rows = (
      await env.DB.prepare('SELECT id, `key`, sync_rev FROM items ORDER BY id').all<{
        id: string;
        key: string;
        sync_rev: number;
      }>()
    ).results;
    expect(rows).toHaveLength(205);
    expect(rows.every((row, i) => row.key === `baru m ${i + 1}`)).toBe(true);
    // revisi 1206..1410 menurut urutan id, tanpa celah di batas potongan (item ke-200/201)
    expect(rows.map((row) => Number(row.sync_rev))).toEqual(
      Array.from({ length: 205 }, (_, i) => 1206 + i),
    );
    expect(await currentSyncRev(env.DB, 'items')).toBe(1410);
  }, 90_000);

  test('bentrok items_key pada item di potongan ke-2: CONFLICT dan tidak ada perubahan sebagian', async () => {
    await seedBrand(env, 'Lama');
    await seedBrand(env, 'Lain');
    await seedBulkItems('Lama', 205, 1000);
    // item merk lain yang kuncinya persis kunci baru item ke-204 (potongan ke-2)
    await seedItem(env, { id: 'x1', brand: 'Lain', model: 'M 204', key: 'baru m 204', syncRev: 7 });
    await env.DB.prepare(
      "INSERT INTO sync_state (resource, seq, updated_at) VALUES ('items', 1205, '')",
    ).run();
    const before = await auditCount();
    const error = await captureAppErrorAsync(() =>
      saveBrand(env, { id: 'brand-lama', name: 'Baru' }, admin),
    );
    expect(error.code).toBe('CONFLICT');
    expect(error.fields).toEqual({ name: 'Nama baru membuat merk dan tipe dua item bentrok' });
    expect((await brandRow('brand-lama'))?.name).toBe('Lama');
    const keys = (
      await env.DB.prepare('SELECT `key`, sync_rev FROM items WHERE brand_id = ? ORDER BY id')
        .bind('brand-lama')
        .all<{ key: string; sync_rev: number }>()
    ).results;
    expect(keys.every((row, i) => row.key === `lama m ${i + 1}`)).toBe(true);
    expect(keys.map((row) => Number(row.sync_rev))).toEqual(
      Array.from({ length: 205 }, (_, i) => 1001 + i),
    );
    expect(await currentSyncRev(env.DB, 'items')).toBe(1205);
    expect(await auditCount()).toBe(before);
  }, 90_000);

  test('(I1) simpan item baru merk yang sedang diganti namanya: kunci konsisten dengan nama merk', async () => {
    await seedBrand(env, 'Lama');
    await seedItem(env, { id: 'i1', brand: 'Lama', model: 'Satu' });
    const { delayed, atWrite, release } = gatedEnv(ITEM_WRITE);
    // penulis item sudah menghitung kunci `lama dua`, lalu rename selesai sebelum batch-nya jalan
    const pending = saveItem(delayed, { ...ITEM_BASE, brand: 'Lama', model: 'Dua' }, admin);
    await atWrite;
    await saveBrand(env, { id: 'brand-lama', name: 'Baru' }, admin);
    release();
    await pending;
    await assertItemKeysMatchBrands();
    expect((await itemRow('i1'))?.key).toBe('baru satu');
  }, 60_000);

  test('(I1) ubah item yang sudah ada saat merknya diganti nama: kunci baru tidak ditimpa kunci lama', async () => {
    await seedBrand(env, 'Lama');
    await seedItem(env, { id: 'i1', brand: 'Lama', model: 'Satu' });
    const { delayed, atWrite, release } = gatedEnv(ITEM_WRITE);
    const view = await env.DB.prepare('SELECT updated_at FROM items WHERE id = ?')
      .bind('i1')
      .first<{ updated_at: string }>();
    const pending = saveItem(
      delayed,
      {
        ...ITEM_BASE,
        id: 'i1',
        expectedUpdatedAt: view?.updated_at as string,
        brand: 'Lama',
        model: 'Satu',
        detail: 'diubah',
      },
      admin,
    );
    await atWrite;
    await saveBrand(env, { id: 'brand-lama', name: 'Baru' }, admin);
    release();
    await pending.catch(() => undefined);
    await assertItemKeysMatchBrands();
  }, 60_000);

  test('(I1) setItemStatus saat merknya diganti nama: kunci baru tidak ditimpa', async () => {
    await seedBrand(env, 'Lama');
    await seedItem(env, { id: 'i1', brand: 'Lama', model: 'Satu' });
    const { delayed, atWrite, release } = gatedEnv(ITEM_WRITE);
    const pending = setItemStatus(delayed, { id: 'i1', status: 'inactive' }, admin);
    await atWrite;
    await saveBrand(env, { id: 'brand-lama', name: 'Baru' }, admin);
    release();
    await pending;
    await assertItemKeysMatchBrands();
    expect((await itemRow('i1'))?.key).toBe('baru satu');
  }, 60_000);

  test('(I1) rename dan simpan item merk yang sama serentak (Promise.all, 5 putaran): kunci selalu konsisten', async () => {
    for (let round = 0; round < 5; round++) {
      const old = `Merk${round}`;
      await seedBrand(env, old);
      await seedItem(env, { id: `s${round}`, brand: old, model: 'Awal' });
      await Promise.allSettled([
        saveBrand(env, { id: brandIdOf(old), name: `Baru${round}` }, admin),
        saveItem(env, { ...ITEM_BASE, brand: old, model: `Tambah ${round}` }, admin),
        saveItem(env, { ...ITEM_BASE, brand: old, model: `Tambah B${round}` }, admin),
      ]);
      await assertItemKeysMatchBrands();
    }
  }, 120_000);
});

describe('status merk tidak menimpa nama/kunci (I2)', () => {
  test('ganti nama selesai di antara baca dan tulis status: nama dan kunci baru bertahan, status berubah', async () => {
    await seedBrand(env, 'Lama');
    const { delayed, atWrite, release } = gatedEnv(/^\s*(INSERT INTO audit_log|UPDATE brands)/);
    const pending = setBrandStatus(delayed, { id: 'brand-lama', status: 'inactive' }, admin);
    await atWrite;
    await saveBrand(env, { id: 'brand-lama', name: 'Baru' }, admin);
    release();
    const dto = await pending;
    expect(dto.status).toBe('inactive');
    expect(await brandRow('brand-lama')).toEqual({ name: 'Baru', key: 'baru', status: 'inactive' });
  }, 60_000);

  test('status dan ganti nama serentak (5 putaran): akhirnya nama baru dan status baru', async () => {
    for (let round = 0; round < 5; round++) {
      const id = brandIdOf(`Lama${round}`);
      await seedBrand(env, `Lama${round}`);
      await Promise.all([
        setBrandStatus(env, { id, status: 'inactive' }, admin),
        saveBrand(env, { id, name: `Baru${round}` }, admin),
      ]);
      expect(await brandRow(id)).toEqual({
        name: `Baru${round}`,
        key: `baru${round}`,
        status: 'inactive',
      });
    }
  }, 60_000);
});

/**
 * Menahan eksekusi PERTAMA kueri baca yang cocok `match` SESUDAH hasilnya diperoleh: `atRead` selesai saat itu
 * dan kueri baru kembali setelah `release()`. Dipakai untuk menyelipkan ganti nama merk di antara dua pembacaan
 * (bukan di antara baca dan tulis).
 */
function gatedAfterRead(match: RegExp) {
  let reached!: () => void;
  const atRead = new Promise<void>((resolve) => {
    reached = resolve;
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let fired = false;
  const wrap = (statement: DbStatement): DbStatement =>
    new Proxy(statement, {
      get(target, property) {
        const value = Reflect.get(target, property) as unknown;
        if (property === 'bind') {
          return (...values: unknown[]) => wrap(target.bind(...values));
        }
        if (property === 'first' || property === 'all') {
          return async () => {
            const result = await (value as () => Promise<unknown>).call(target);
            if (!fired) {
              fired = true;
              reached();
              await gate;
            }
            return result;
          };
        }
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  const delayed = {
    ...env,
    DB: {
      ...env.DB,
      prepare: (sql: string) => {
        const statement = env.DB.prepare(sql);
        return match.test(sql) ? wrap(statement) : statement;
      },
    },
  } as TestEnv;
  return { delayed, atRead, release };
}

const ITEM_READ = /FROM items[^;]*WHERE (i\.)?id = \?/;

describe('(N1) setItemStatus: ganti nama merk di antara dua pembacaan', () => {
  test('rename commit setelah item dibaca: kunci baru bertahan, status tetap berubah, audit memakai nama baru', async () => {
    await seedBrand(env, 'Lama');
    await seedItem(env, { id: 'i1', brand: 'Lama', model: 'Satu' });
    const { delayed, atRead, release } = gatedAfterRead(ITEM_READ);
    const pending = setItemStatus(delayed, { id: 'i1', status: 'inactive' }, admin);
    await atRead;
    await saveBrand(env, { id: 'brand-lama', name: 'Baru' }, admin);
    release();
    const dto = await pending;
    expect(dto.status).toBe('inactive');
    expect(dto.brand).toBe('Baru');
    await assertItemKeysMatchBrands();
    const row = await env.DB.prepare('SELECT `key`, status FROM items WHERE id = ?')
      .bind('i1')
      .first<{ key: string; status: string }>();
    expect(row).toEqual({ key: 'baru satu', status: 'inactive' });
  }, 60_000);
});
