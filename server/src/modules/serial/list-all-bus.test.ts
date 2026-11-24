// Daftar serial untuk pengguna yang dapat membaca SEMUA BU: predikat `bu_id IN (...)` dan cabang riwayat dibuang agar
// urutan `created_at DESC` memakai indeks `serials_live_created` (diukur 1,4-3 dtk pada 200 ribu serial). Hasilnya
// WAJIB sama persis dengan jalur lama, dan hak baca tak boleh melonggar.
import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import type { Db } from '@server/core/db';
import { loadUserContext, type UserContext } from '@server/modules/access/context';
import { seedBusinessUnit, seedUser } from '@server-test/access-fixtures';
import { seedItem } from '@server-test/item-fixtures';
import { seedSerial, seedSerialWorld } from '@server-test/serial-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { moveBuStatements } from './bu-history';
import { listSerialRows, SERIAL_PER_BU_ARMS_MAX, type SerialListFilter } from './repo';
import { listSerials } from './service';

setDefaultTimeout(60_000);

let env: TestEnv;

const T = (n: number): string => `2026-11-1${n}T03:00:00.000Z`;

/** Serial uji: `at` = hari (0-9) di `created_at`; sengaja ada yang berstempel sama untuk menguji pemisah `id`. */
const SEEDS: { id: string; buId: string; at: number; status?: string }[] = [
  { id: 's01', buId: 'bu-a', at: 0 },
  { id: 's02', buId: 'bu-b', at: 1 },
  { id: 's03', buId: 'bu-c', at: 2 },
  { id: 's04', buId: 'bu-a', at: 2 },
  { id: 's05', buId: 'bu-b', at: 3, status: 'reported' },
  { id: 's06', buId: 'bu-a', at: 4 },
  { id: 's07', buId: 'bu-c', at: 4 },
  { id: 's08', buId: 'bu-b', at: 5 },
  { id: 's09', buId: 'bu-a', at: 5, status: 'reported' },
  { id: 's10', buId: 'bu-a', at: 6 },
  { id: 's11', buId: 'bu-c', at: 7 },
  { id: 's12', buId: 'bu-b', at: 8 },
  { id: 's13', buId: 'bu-a', at: 9 },
  { id: 's14', buId: 'bu-c', at: 9 },
];

const USERS = {
  /** Penugasan "Semua BU" (`buId: null`). */
  semua: 'semua@gmail.com',
  /** Tiap BU ditugaskan satu per satu (hasilnya sama dengan Semua BU saat ini). */
  satuSatu: 'satu-satu@gmail.com',
  /** Dua dari tiga BU (A, B). */
  dua: 'dua@gmail.com',
  /** Satu BU (A). */
  satu: 'satu@gmail.com',
} as const;

beforeEach(async () => {
  env = await createTestEnv();
  await seedSerialWorld(env); // bu-a, bu-b, role r-view, lokasi, item
  await seedBusinessUnit(env, { id: 'bu-c', code: 'C' });
  await seedItem(env, { id: 'i-c', brand: 'Merk', model: 'Cakra', businessUnitIds: ['bu-c'] });
  await seedUser(env, {
    id: 'u-semua',
    email: USERS.semua,
    buAssignments: [{ buId: null, roleIds: ['r-view'] }],
  });
  await seedUser(env, {
    id: 'u-satu-satu',
    email: USERS.satuSatu,
    buAssignments: [
      { buId: 'bu-a', roleIds: ['r-view'] },
      { buId: 'bu-b', roleIds: ['r-view'] },
      { buId: 'bu-c', roleIds: ['r-view'] },
    ],
  });
  await seedUser(env, {
    id: 'u-dua',
    email: USERS.dua,
    buAssignments: [
      { buId: 'bu-a', roleIds: ['r-view'] },
      { buId: 'bu-b', roleIds: ['r-view'] },
    ],
  });
  await seedUser(env, {
    id: 'u-satu',
    email: USERS.satu,
    buAssignments: [{ buId: 'bu-a', roleIds: ['r-view'] }],
  });
  for (const seed of SEEDS) {
    await seedSerial(env, {
      id: seed.id,
      serial: `SN-${seed.id.toUpperCase()}`,
      // s03 dicatat di A lalu dipindah ke C di bawah ini
      buId: seed.id === 's03' ? 'bu-a' : seed.buId,
      itemId: seed.buId === 'bu-c' ? 'i-c' : seed.buId === 'bu-b' ? 'i-b' : 'i-a1',
      createdAt: T(seed.at),
      ...(seed.status ? { status: seed.status } : {}),
    });
  }
  // s03 (BU C) pernah di BU A lalu pindah ke C: BU A tetap membacanya lewat riwayat.
  await env.DB.batch(
    moveBuStatements(env, {
      serialId: 's03',
      fromBuId: 'bu-a',
      toBuId: 'bu-c',
      now: '2026-11-13T00:00:00.000Z',
    }),
  );
});

const userOf = async (email: string): Promise<UserContext> => {
  const user = await loadUserContext(env, email);
  if (!user) throw new Error(`pengguna ${email} tak dimuat`);
  return user;
};

/** Hasil acuan murni dari data uji (bukan dari SQL daftar): milik BU terbaca ATAU pernah di BU terbaca. */
const expectedIds = (
  readable: readonly string[],
  extra: (seed: (typeof SEEDS)[number]) => boolean = () => true,
): string[] => {
  const wasIn = (id: string): string[] => (id === 's03' ? ['bu-a', 'bu-c'] : []);
  return SEEDS.filter(
    (seed) =>
      extra(seed) &&
      (readable.includes(seed.buId) || wasIn(seed.id).some((bu) => readable.includes(bu))),
  )
    .sort((x, y) => (y.at - x.at !== 0 ? y.at - x.at : y.id < x.id ? -1 : 1))
    .map((seed) => seed.id);
};

/** Menelusuri seluruh halaman lewat kursor; memastikan tak ada duplikat. */
const walk = async (
  user: UserContext,
  limit: number,
  extra: Record<string, unknown> = {},
  using: TestEnv | { DB: Db } = env,
): Promise<string[]> => {
  const ids: string[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 50; guard++) {
    const page = await listSerials(using as TestEnv, user, {
      limit,
      ...(cursor ? { cursor } : {}),
      ...extra,
    });
    ids.push(...page.items.map((item) => item.id));
    if (page.nextCursor === null) break;
    cursor = page.nextCursor;
  }
  expect(new Set(ids).size).toBe(ids.length);
  return ids;
};

/** Env yang mencatat semua SQL (hanya `prepare`). */
const spyEnv = (): { env: TestEnv; sqls: string[] } => {
  const sqls: string[] = [];
  const db = new Proxy(env.DB, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target) as unknown;
      if (prop === 'prepare') {
        return (sql: string) => {
          sqls.push(sql);
          return target.prepare(sql);
        };
      }
      return typeof value === 'function'
        ? (value as (...a: unknown[]) => unknown).bind(target)
        : value;
    },
  });
  return { env: { ...env, DB: db } as TestEnv, sqls };
};

const listSqlsOf = (sqls: readonly string[]): string[] =>
  sqls.filter((sql) => sql.includes('FROM serials s JOIN business_units'));

describe('konteks akses memuat semua id BU', () => {
  test('allBuIds = seluruh baris business_units, termasuk BU terhapus', async () => {
    await env.DB.prepare("UPDATE business_units SET deleted_at = ? WHERE id = 'bu-c'")
      .bind(T(9))
      .run();
    const user = await userOf(USERS.semua);
    expect([...(user.allBuIds ?? [])].sort()).toEqual(['bu-a', 'bu-b', 'bu-c']);
    expect(user.deletedBuIds).toEqual(['bu-c']);
  });

  test('super admin: allBuIds ada dan semua BU terbaca', async () => {
    const admin = await loadUserContext(
      { ...env, ADMIN_EMAIL: 'admin@gmail.com' },
      'admin@gmail.com',
    );
    expect([...(admin?.allBuIds ?? [])].sort()).toEqual(['bu-a', 'bu-b', 'bu-c']);
  });
});

describe('hasil sama persis dengan acuan (pagination berkursor lintas halaman)', () => {
  test.each([
    ['semua', USERS.semua, ['bu-a', 'bu-b', 'bu-c']],
    ['satuSatu', USERS.satuSatu, ['bu-a', 'bu-b', 'bu-c']],
    ['dua', USERS.dua, ['bu-a', 'bu-b']],
    ['satu', USERS.satu, ['bu-a']],
  ])('pengguna %s: semua halaman, tanpa duplikat atau terlewat', async (_name, email, readable) => {
    const user = await userOf(email);
    for (const limit of [1, 3, 5, 50]) {
      expect(await walk(user, limit)).toEqual(expectedIds(readable));
    }
  });

  test('filter status dan filter BU eksplisit tetap berlaku (pengguna Semua BU)', async () => {
    const user = await userOf(USERS.semua);
    expect(await walk(user, 2, { status: 'reported' })).toEqual(
      expectedIds(['bu-a', 'bu-b', 'bu-c'], (seed) => seed.status === 'reported'),
    );
    // filter BU = pernah di BU itu: s03 pernah di A
    expect(await walk(user, 2, { buId: 'bu-a' })).toEqual(expectedIds(['bu-a']));
    expect(await walk(user, 2, { buIds: ['bu-b', 'bu-c'] })).toEqual(expectedIds(['bu-b', 'bu-c']));
  });
});

describe('jalur kueri', () => {
  test('Semua BU: tanpa predikat bu_id IN dan tanpa cabang riwayat; satu kueri saja', async () => {
    for (const email of [USERS.semua, USERS.satuSatu]) {
      const { env: spied, sqls } = spyEnv();
      await listSerials(spied, await userOf(email), { limit: 5 });
      const lists = listSqlsOf(sqls);
      expect(lists.length).toBe(1);
      const sql = lists[0] ?? '';
      expect(sql).not.toContain('s.bu_id IN');
      expect(sql).not.toContain('s.bu_id NOT IN');
      expect(sql).not.toContain('UNION ALL');
      expect(sql).toContain("s.deleted_at = ''");
    }
  });

  test('sebagian BU: satu cabang `bu_id = ?` per BU terbaca + cabang riwayat, tanpa `bu_id IN`', async () => {
    for (const [email, buCount] of [
      [USERS.dua, 2],
      [USERS.satu, 1],
    ] as const) {
      const { env: spied, sqls } = spyEnv();
      await listSerials(spied, await userOf(email), { limit: 5 });
      const lists = listSqlsOf(sqls);
      expect(lists.length).toBe(1);
      const sql = lists[0] ?? '';
      expect((sql.match(/s\.bu_id = \?/g) ?? []).length).toBe(buCount);
      expect(sql).not.toContain('s.bu_id IN');
      expect(sql).toContain('s.bu_id NOT IN'); // cabang riwayat tetap ada
      expect(sql).toContain('serial_business_units');
      expect(sql).not.toMatch(/FORCE INDEX|IGNORE INDEX|USE INDEX/);
      // tiap cabang mengurutkan dan membatasi sendiri, lalu digabung dan dibatasi ulang
      expect((sql.match(/ORDER BY s\.created_at DESC, s\.id DESC LIMIT \?/g) ?? []).length).toBe(
        buCount + 1,
      );
    }
  });

  test('di atas ambang jumlah BU: jalur lama (satu predikat `bu_id IN`)', async () => {
    const extra = Array.from({ length: SERIAL_PER_BU_ARMS_MAX + 1 }, (_, n) => `bu-x${n}`);
    for (const id of extra) await seedBusinessUnit(env, { id, code: id.toUpperCase() });
    await seedUser(env, {
      id: 'u-banyak',
      email: 'banyak@gmail.com',
      buAssignments: extra.map((buId) => ({ buId, roleIds: ['r-view'] })),
    });
    const { env: spied, sqls } = spyEnv();
    await listSerials(spied, await userOf('banyak@gmail.com'), { limit: 5 });
    const sql = listSqlsOf(sqls).join('\n');
    expect(sql).toContain('s.bu_id IN');
    expect(sql).not.toContain('s.bu_id = ?');
  });

  test('konteks tanpa allBuIds tak dianggap Semua BU: tetap bercabang per BU terbaca', async () => {
    const { allBuIds: _drop, ...rest } = await userOf(USERS.semua);
    const { env: spied, sqls } = spyEnv();
    const ids = await walk(rest, 4, {}, spied);
    expect(ids).toEqual(expectedIds(['bu-a', 'bu-b', 'bu-c']));
    const sql = listSqlsOf(sqls).join('\n');
    expect(sql).toContain('s.bu_id = ?');
    expect(sql).toContain('s.bu_id NOT IN');
  });

  test('filter BU eksplisit pada pengguna Semua BU memakai predikat filter saja', async () => {
    const { env: spied, sqls } = spyEnv();
    await listSerials(spied, await userOf(USERS.semua), { limit: 5, buId: 'bu-a' });
    const sql = listSqlsOf(sqls).join('\n');
    expect(sql).toContain('s.bu_id IN');
    // dua cabang filter (saat ini di BU itu, atau pernah di BU itu), tanpa cabang BU terbaca
    expect((sql.match(/SELECT s\.id/g) ?? []).length).toBe(2);
  });
});

describe('hak baca tidak melonggar', () => {
  test('BU baru: pengguna Semua BU langsung membacanya; yang ditugaskan satu per satu tidak', async () => {
    await seedBusinessUnit(env, { id: 'bu-d', code: 'D' });
    await seedSerial(env, {
      id: 's-d',
      serial: 'SN-D1',
      buId: 'bu-d',
      itemId: 'i-a1',
      createdAt: T(9),
    });
    const semua = await userOf(USERS.semua);
    expect(await walk(semua, 50)).toContain('s-d');
    // `satuSatu` (A, B, C) tidak mencakup BU D: konteksnya kini tidak membaca semua BU, jadi jalur lama menyaringnya
    const satuSatu = await userOf(USERS.satuSatu);
    expect(await walk(satuSatu, 50)).not.toContain('s-d');
    const { env: spied, sqls } = spyEnv();
    await listSerials(spied, satuSatu, { limit: 5 });
    expect(listSqlsOf(sqls).join('\n')).toContain('s.bu_id = ?');
  });

  test('BU terhapus tetap memberi hak: serialnya tetap terbaca pengguna Semua BU', async () => {
    await env.DB.prepare(
      "UPDATE business_units SET deleted_at = ?, deleted_by = 'x' WHERE id = 'bu-c'",
    )
      .bind(T(9))
      .run();
    const semua = await userOf(USERS.semua);
    const satuSatu = await userOf(USERS.satuSatu);
    const expected = expectedIds(['bu-a', 'bu-b', 'bu-c']);
    expect(await walk(semua, 4)).toEqual(expected);
    expect(await walk(satuSatu, 4)).toEqual(expected);
    // pengguna BU A saja tidak melihat serial BU C (kecuali s03 lewat riwayat)
    expect(await walk(await userOf(USERS.satu), 4)).toEqual(expectedIds(['bu-a']));
  });

  test('pengguna tanpa BU tidak melihat apa pun', async () => {
    await seedUser(env, { id: 'u-kosong', email: 'kosong@gmail.com', buAssignments: [] });
    const user = await userOf('kosong@gmail.com');
    expect(await walk(user, 5)).toEqual([]);
  });

  test('serial terhapus tidak muncul di daftar Semua BU', async () => {
    await env.DB.prepare("UPDATE serials SET deleted_at = ?, deleted_by = 'x' WHERE id = 's13'")
      .bind(T(9))
      .run();
    const ids = await walk(await userOf(USERS.semua), 5);
    expect(ids).not.toContain('s13');
    expect(ids.length).toBe(SEEDS.length - 1);
  });
});

describe('repo: allBus sama persis dengan jalur lama bila BU terbaca = semua BU', () => {
  const ALL = ['bu-a', 'bu-b', 'bu-c'];
  const filters = async (): Promise<SerialListFilter[]> => {
    const page = await listSerialRows(env.DB, { buIds: ALL, limit: 5 });
    const mid = page[2];
    return [
      { buIds: ALL, limit: 4 },
      { buIds: ALL, limit: 50 },
      { buIds: ALL, limit: 4, statuses: ['reported'] },
      { buIds: ALL, limit: 4, filterBuIds: ['bu-a'] },
      { buIds: ALL, limit: 4, filterBuIds: ['bu-b', 'bu-c'] },
      { buIds: ALL, limit: 4, prefixes: ['SN-S0'] },
      { buIds: ALL, limit: 4, serials: ['SN-S03', 'SN-S10', 'SN-ZZZ'] },
      ...(mid ? [{ buIds: ALL, limit: 4, cursor: { createdAt: mid.created_at, id: mid.id } }] : []),
    ];
  };

  test('urutan, isi halaman, dan jumlah baris identik', async () => {
    for (const filter of await filters()) {
      const old = await listSerialRows(env.DB, filter);
      const next = await listSerialRows(env.DB, { ...filter, allBus: true });
      expect(next.map((row) => row.id)).toEqual(old.map((row) => row.id));
      expect(old.length).toBeGreaterThan(0);
    }
  });

  test('daftar Terhapus (deleted) juga identik', async () => {
    await env.DB.prepare(
      "UPDATE serials SET deleted_at = ?, deleted_by = 'x' WHERE id IN ('s02','s06','s11')",
    )
      .bind(T(9))
      .run();
    const deleted = { sql: "s.deleted_by <> ''", binds: [] as string[] };
    const old = await listSerialRows(env.DB, { buIds: ALL, limit: 10, deleted });
    const next = await listSerialRows(env.DB, { buIds: ALL, limit: 10, deleted, allBus: true });
    expect(next.map((row) => row.id)).toEqual(old.map((row) => row.id));
    expect(old.length).toBe(3);
  });
});

describe('repo: cabang per BU (perBuArms) sama persis dengan jalur lama dan dengan acuan', () => {
  const SETS: string[][] = [
    ['bu-a'],
    ['bu-c'],
    ['bu-a', 'bu-b'],
    ['bu-b', 'bu-c'],
    ['bu-a', 'bu-c'],
  ];

  /** Menelusuri semua halaman lewat repo (kursor dari baris terakhir halaman), tanpa duplikat. */
  const walkRepo = async (
    base: SerialListFilter,
    limit: number,
    perBuArms: boolean,
  ): Promise<string[]> => {
    const ids: string[] = [];
    let cursor: SerialListFilter['cursor'];
    for (let guard = 0; guard < 50; guard++) {
      const rows = await listSerialRows(env.DB, {
        ...base,
        limit,
        ...(perBuArms ? { perBuArms: true } : {}),
        ...(cursor ? { cursor } : {}),
      });
      const page = rows.slice(0, limit);
      ids.push(...page.map((row) => row.id));
      const last = page[page.length - 1];
      if (rows.length <= limit || !last) break;
      cursor = { createdAt: last.created_at, id: last.id };
    }
    expect(new Set(ids).size).toBe(ids.length);
    return ids;
  };

  test('semua halaman (limit 1/3/5/50) = acuan murni = jalur lama, untuk 1 dan 2 BU', async () => {
    for (const buIds of SETS) {
      const expected = expectedIds(buIds);
      for (const limit of [1, 3, 5, 50]) {
        expect(await walkRepo({ buIds, limit }, limit, true)).toEqual(expected);
        expect(await walkRepo({ buIds, limit }, limit, false)).toEqual(expected);
      }
    }
  });

  test('filter status, filter BU, awalan, serials, item, dan kursor identik dengan jalur lama', async () => {
    for (const buIds of SETS) {
      const page = await listSerialRows(env.DB, { buIds, limit: 5 });
      const mid = page[2];
      const filters: SerialListFilter[] = [
        { buIds, limit: 4, statuses: ['reported'] },
        { buIds, limit: 4, filterBuIds: ['bu-a'] },
        { buIds, limit: 4, filterBuIds: ['bu-b', 'bu-c'] },
        { buIds, limit: 4, filterBuIds: ['bu-c'] },
        { buIds, limit: 4, prefixes: ['SN-S0'] },
        { buIds, limit: 4, serials: ['SN-S03', 'SN-S10', 'SN-ZZZ'] },
        { buIds, limit: 4, itemIds: ['i-a1'] },
        ...(mid ? [{ buIds, limit: 4, cursor: { createdAt: mid.created_at, id: mid.id } }] : []),
      ];
      for (const filter of filters) {
        const old = await listSerialRows(env.DB, filter);
        const next = await listSerialRows(env.DB, { ...filter, perBuArms: true });
        expect(next.map((row) => row.id)).toEqual(old.map((row) => row.id));
      }
    }
  });

  test('serial yang pindah BU dan stempel waktu kembar tak terlewat, ganda, atau salah urut', async () => {
    // s03 (kini C, pernah A) dan s04 (A) berstempel sama; s06 (A) dan s07 (C) juga
    const forA = await walkRepo({ buIds: ['bu-a'], limit: 1 }, 1, true);
    expect(forA).toContain('s03'); // lewat riwayat
    expect(forA).toContain('s04');
    const both = await walkRepo({ buIds: ['bu-a', 'bu-c'], limit: 3 }, 3, true);
    expect(both).toEqual(expectedIds(['bu-a', 'bu-c']));
  });

  test('daftar Terhapus identik dengan jalur lama', async () => {
    await env.DB.prepare(
      "UPDATE serials SET deleted_at = ?, deleted_by = 'x' WHERE id IN ('s01','s04','s05','s11')",
    )
      .bind(T(9))
      .run();
    const deleted = { sql: "s.deleted_by <> ''", binds: [] as string[] };
    for (const buIds of SETS) {
      const old = await listSerialRows(env.DB, { buIds, limit: 10, deleted });
      const next = await listSerialRows(env.DB, { buIds, limit: 10, deleted, perBuArms: true });
      expect(next.map((row) => row.id)).toEqual(old.map((row) => row.id));
    }
  });

  test('BU kecil dan BU besar bersama: kecil tak tenggelam, besar tak menggandakan', async () => {
    await seedBusinessUnit(env, { id: 'bu-kecil', code: 'KCL' });
    await seedBusinessUnit(env, { id: 'bu-besar', code: 'BSR' });
    for (let n = 0; n < 30; n++) {
      await seedSerial(env, {
        id: `big${String(n).padStart(2, '0')}`,
        serial: `SN-BIG${n}`,
        buId: 'bu-besar',
        itemId: 'i-a1',
        createdAt: `2026-11-1${n % 10}T0${n % 6}:00:00.000Z`,
      });
    }
    await seedSerial(env, {
      id: 'kcl1',
      serial: 'SN-KCL1',
      buId: 'bu-kecil',
      itemId: 'i-a1',
      createdAt: '2026-11-05T05:00:00.000Z',
    });
    const buIds = ['bu-besar', 'bu-kecil'];
    const old = await walkRepo({ buIds, limit: 7 }, 7, false);
    const next = await walkRepo({ buIds, limit: 7 }, 7, true);
    expect(next).toEqual(old);
    expect(next.length).toBe(31);
    expect(next).toContain('kcl1');
  });
});
