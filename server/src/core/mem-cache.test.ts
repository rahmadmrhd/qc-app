import { beforeEach, describe, expect, test } from 'bun:test';
import { dbStatsOf } from '@server/core/db';
import { loadUserContext } from '@server/modules/access/context';
import {
  insertLocationStmt,
  listLocationBriefs,
  updateUserStmt,
} from '@server/modules/access/repo';
import { insertBrandStmts, listBrands } from '@server/modules/brand/repo';
import { createBrandStmts, saveBrand } from '@server/modules/brand/service';
import { insertCustomerStmt, listCustomers } from '@server/modules/customer/repo';
import { seedLocation, seedRole, seedUser } from '@server-test/access-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import {
  CACHE_TTL_DEFAULT_MS,
  CACHE_TTL_MAX_MS,
  cached,
  cacheTtlMs,
  resetMemCache,
  settleCache,
  touchCache,
} from './mem-cache';

let env: TestEnv;

beforeEach(async () => {
  env = await createTestEnv({ CACHE_TTL_MS: '10000' });
});

describe('cacheTtlMs', () => {
  test('bawaan 10 dtk, dibatasi 15 dtk, 0 atau tak sah = mati', async () => {
    const make = async (value: string | undefined) =>
      cacheTtlMs({ ...(await createTestEnv()), CACHE_TTL_MS: value } as never);
    expect(await make(undefined)).toBe(CACHE_TTL_DEFAULT_MS);
    expect(await make('')).toBe(CACHE_TTL_DEFAULT_MS);
    expect(await make('3000')).toBe(3000);
    expect(await make('999999')).toBe(CACHE_TTL_MAX_MS);
    expect(await make('0')).toBe(0);
    expect(await make('-5')).toBe(0);
    expect(await make('abc')).toBe(0);
  });
});

describe('cached', () => {
  test('memuat sekali selama TTL lalu memuat ulang setelah kedaluwarsa', async () => {
    let loads = 0;
    const load = async () => ++loads;
    expect(await cached(env, 'brands:x', load)).toBe(1);
    env.clock.advance(9_999);
    expect(await cached(env, 'brands:x', load)).toBe(1);
    env.clock.advance(2);
    expect(await cached(env, 'brands:x', load)).toBe(2);
  });

  test('CACHE_TTL_MS=0 mematikan cache', async () => {
    const off = await createTestEnv({ CACHE_TTL_MS: '0' });
    let loads = 0;
    await cached(off, 'brands:x', async () => ++loads);
    await cached(off, 'brands:x', async () => ++loads);
    expect(loads).toBe(2);
  });

  test('touchCache membuang seluruh kelompok seketika; kelompok lain tidak terpengaruh', async () => {
    let a = 0;
    let b = 0;
    await cached(env, 'brands:all', async () => ++a);
    await cached(env, 'customers:all', async () => ++b);
    touchCache('brands');
    expect(await cached(env, 'brands:all', async () => ++a)).toBe(2);
    expect(await cached(env, 'customers:all', async () => ++b)).toBe(1);
  });

  test('penulisan (touch) selama memuat: nilai basi tidak disimpan', async () => {
    let n = 0;
    const slow = async () => {
      const value = ++n;
      touchCache('brands');
      return value;
    };
    expect(await cached(env, 'brands:all', slow)).toBe(1);
    // tidak tersimpan: pemuatan berikutnya memanggil load lagi
    expect(await cached(env, 'brands:all', async () => ++n)).toBe(2);
  });

  test('settleCache membuang lagi kelompok yang disentuh (isi yang terlanjur dimuat sesudah penyusunan)', async () => {
    let n = 0;
    touchCache('brands');
    expect(await cached(env, 'brands:all', async () => ++n)).toBe(1);
    expect(await cached(env, 'brands:all', async () => ++n)).toBe(1);
    settleCache();
    expect(await cached(env, 'brands:all', async () => ++n)).toBe(2);
  });

  test('resetMemCache dan createTestEnv tidak membiarkan cache bocor antar env', async () => {
    let n = 0;
    await cached(env, 'brands:all', async () => ++n);
    await createTestEnv({ CACHE_TTL_MS: '10000' });
    expect(await cached(env, 'brands:all', async () => ++n)).toBe(2);
    await cached(env, 'brands:all', async () => ++n);
    resetMemCache();
    expect(await cached(env, 'brands:all', async () => ++n)).toBe(3);
  });
});

describe('konteks akses', () => {
  beforeEach(async () => {
    await seedLocation(env, { id: 'l-a', code: 'A' });
    await seedRole(env, { id: 'r-view', name: 'Viewer', permissions: { access: 'view' } });
    await seedUser(env, { id: 'u1', email: 'viewer@gmail.com', roleIds: ['r-view'] });
  });

  test('pencabutan lewat isolate lain (SQL langsung) berlaku paling lambat TTL; tanpa kueri selama TTL', async () => {
    expect((await loadUserContext(env, 'viewer@gmail.com'))?.permissions.access).toBe('view');
    await env.DB.prepare("UPDATE users SET status = 'inactive' WHERE id = 'u1'").run();
    // masih di dalam TTL: konteks lama (inilah batas pencabutan yang diizinkan Spek 6)
    env.clock.advance(5_000);
    expect(await loadUserContext(env, 'viewer@gmail.com')).not.toBeNull();
    env.clock.advance(5_001);
    expect(await loadUserContext(env, 'viewer@gmail.com')).toBeNull();
  });

  test('penulisan lewat pernyataan repo (isolate yang sama) membuang cache seketika', async () => {
    expect(await loadUserContext(env, 'viewer@gmail.com')).not.toBeNull();
    await env.DB.batch([
      updateUserStmt(env.DB, {
        id: 'u1',
        email: 'viewer@gmail.com',
        name: 'V',
        status: 'inactive',
        assignments: [],
        createdAt: '',
        updatedAt: '',
        updatedBy: 'x',
      } as never),
    ]);
    expect(await loadUserContext(env, 'viewer@gmail.com')).toBeNull();
  });

  test('daftar lokasi: cache, lalu dibuang saat lokasi ditulis', async () => {
    expect((await listLocationBriefs(env)).map((l) => l.id)).toEqual(['l-a']);
    await env.DB.batch([
      insertLocationStmt(env.DB, {
        id: 'l-b',
        code: 'B',
        name: 'B',
        status: 'active',
        createdAt: '',
        updatedAt: '',
        updatedBy: 'x',
      } as never),
    ]);
    expect((await listLocationBriefs(env)).map((l) => l.id).sort()).toEqual(['l-a', 'l-b']);
  });
});

describe('merk dan customer', () => {
  test('daftar merk di-cache; jalur fresh dan penulisan melihat data terbaru', async () => {
    expect(await listBrands(env)).toHaveLength(0);
    await env.DB.prepare(
      "INSERT INTO brands (id, name, key, status) VALUES ('b1', 'Acme', 'acme', 'active')",
    ).run();
    // isolate lain menulis: cache lama bertahan selama TTL, tetapi jalur fresh langsung ke D1
    expect(await listBrands(env)).toHaveLength(0);
    expect(await listBrands(env, { fresh: true })).toHaveLength(1);
    env.clock.advance(10_001);
    expect(await listBrands(env)).toHaveLength(1);
  });

  test('menyusun pernyataan tulis merk membuang cache (touch pada saat penyusunan)', async () => {
    expect(await listBrands(env)).toHaveLength(0);
    const brand = {
      id: 'b2',
      externalId: '',
      name: 'Zeta',
      key: 'zeta',
      status: 'active' as const,
      itemCount: 0,
      syncRev: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      updatedBy: 'x',
    };
    await env.DB.batch(insertBrandStmts(env.DB, brand));
    expect((await listBrands(env)).map((b) => b.id)).toEqual(['b2']);
    // createBrandStmts (jalur form/sinkron) memakai insertBrandStmts yang sama
    expect(
      createBrandStmts(env, { ...brand, id: 'b3', key: 'b3', name: 'B3' }, { email: 'x' }).length,
    ).toBeGreaterThan(0);
  });

  test('saveBrand membaca fresh (bukan cache) dan hasilnya langsung tampak di daftar', async () => {
    expect(await listBrands(env)).toHaveLength(0);
    await env.DB.prepare(
      "INSERT INTO brands (id, name, key, status) VALUES ('b1', 'Acme', 'acme', 'active')",
    ).run();
    // cache menganggap kosong, tetapi saveBrand memakai jalur fresh dan menolak nama ganda
    await expect(saveBrand(env, { name: 'ACME' }, { email: 'x' })).rejects.toThrow();
    await saveBrand(env, { name: 'Baru' }, { email: 'x' });
    expect((await listBrands(env)).map((b) => b.name).sort()).toEqual(['Acme', 'Baru']);
  });

  test('customer: cache dan jalur fresh', async () => {
    expect(await listCustomers(env)).toHaveLength(0);
    await env.DB.batch([
      insertCustomerStmt(env.DB, {
        id: 'c1',
        name: 'PT A',
        key: 'pt a',
        status: 'active',
        createdAt: '',
        updatedAt: '',
        updatedBy: 'x',
      }),
    ]);
    expect(await listCustomers(env)).toHaveLength(1);
  });
});

describe('pemuatan bersama (prime)', () => {
  test('load boleh mengisi kunci lain; terpakai tanpa memuat ulang', async () => {
    let otherLoads = 0;
    await cached(env, 'access:ctx:x', async (prime) => {
      prime('access:locations', ['dari-ctx']);
      return 1;
    });
    const locations = await cached(env, 'access:locations', async () => {
      otherLoads++;
      return ['dari-db'];
    });
    expect(locations).toEqual(['dari-ctx']);
    expect(otherLoads).toBe(0);
  });

  test('penulisan (touch) selama memuat: kunci utama dan kunci yang diisi sama-sama tidak disimpan', async () => {
    await cached(env, 'access:ctx:x', async (prime) => {
      prime('access:locations', ['basi']);
      touchCache('access');
      return 1;
    });
    let loads = 0;
    expect(
      await cached(env, 'access:locations', async () => {
        loads++;
        return ['segar'];
      }),
    ).toEqual(['segar']);
    expect(loads).toBe(1);
  });

  test('satu miss konteks akses = SATU round trip D1 dan juga mengisi daftar lokasi', async () => {
    await seedLocation(env, { id: 'l-a', code: 'A' });
    await seedLocation(env, { id: 'l-mati', code: 'MATI', status: 'inactive' });
    await seedRole(env, { id: 'r-view', name: 'Viewer', permissions: { access: 'view' } });
    await seedUser(env, { id: 'u1', email: 'viewer@gmail.com', roleIds: ['r-view'] });
    const stats = dbStatsOf(env.DB);
    const before = stats.trips;
    await loadUserContext(env, 'viewer@gmail.com');
    expect(stats.trips - before).toBe(1);
    const briefs = await listLocationBriefs(env);
    expect(stats.trips - before).toBe(1); // dari cache hasil prime
    expect(briefs.map((b) => [b.id, b.active])).toEqual([
      ['l-a', true],
      ['l-mati', false],
    ]);
  });
});
