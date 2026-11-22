import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { app } from '@server/app';
import {
  collectLegacyIds,
  MAX_LEGACY_CANDIDATES,
  replaceLegacyIds,
  resetLegacyIdsState,
  translateLegacyIds,
} from '@server/core/legacy-ids';
import { signSessionToken } from '@server/core/session';
import { seedLocation, seedRole, seedUser } from '@server-test/access-fixtures';
import { seedBrand } from '@server-test/item-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';

// Lapisan terjemahan ID lama (sementara; spek ID ULID bagian 4a). Tabel peta di produksi dibuat skrip operator; tes membuatnya
// dengan bentuk yang sama.

const MAP_DDL = `CREATE TABLE IF NOT EXISTS id_ulid_map (
  old_id VARCHAR(100) NOT NULL,
  new_id VARCHAR(100) NOT NULL,
  source_table VARCHAR(64) NOT NULL,
  created_at VARCHAR(30) NOT NULL DEFAULT '',
  PRIMARY KEY (old_id),
  UNIQUE KEY id_ulid_map_new (new_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_nopad_bin`;

const OLD_USER = '11111111-1111-4111-8111-111111111111';
const OLD_LOCATION = '22222222-2222-4222-8222-222222222222';
const OLD_BRAND = '33333333-3333-4333-8333-333333333333';
const UNKNOWN = '44444444-4444-4444-8444-444444444444';
const CLIENT_ID = '55555555-5555-4555-8555-555555555555';

describe('collectLegacyIds / replaceLegacyIds (murni)', () => {
  test('mengumpulkan UUID persis dari objek, larik, dan bersarang; teks bebas dan huruf besar tak ikut', () => {
    const found = new Set<string>();
    collectLegacyIds(
      {
        id: OLD_BRAND,
        ids: [OLD_USER, 'bukan-uuid', 7, null],
        nested: { deep: [{ ref: OLD_LOCATION }] },
        note: `lihat /files/${OLD_USER} di sini`,
        upper: OLD_USER.toUpperCase(),
      },
      found,
    );
    expect([...found].sort()).toEqual([OLD_BRAND, OLD_USER, OLD_LOCATION].sort());
  });

  test('kunci clientId dilewati; objek bukan biasa (byte, Date) dilewati', () => {
    const input = {
      clientId: CLIENT_ID,
      rows: [{ clientId: CLIENT_ID, itemId: OLD_BRAND }],
      data: new Uint8Array([1, 2, 3]),
      when: new Date(0),
    };
    const found = new Set<string>();
    collectLegacyIds(input, found);
    expect([...found]).toEqual([OLD_BRAND]);
    const map = new Map([
      [CLIENT_ID, 'diganti-salah'],
      [OLD_BRAND, 'brand-baru'],
    ]);
    expect(replaceLegacyIds(input, map)).toBe(1);
    expect(input.clientId).toBe(CLIENT_ID);
    expect(input.rows[0]).toEqual({ clientId: CLIENT_ID, itemId: 'brand-baru' });
  });

  test('mengganti di tempat pada nilai langsung, larik, dan objek bersarang; jumlah benar', () => {
    const input = { a: OLD_USER, b: [OLD_USER, UNKNOWN, 'x'], c: { d: OLD_LOCATION } };
    const map = new Map([
      [OLD_USER, 'u-baru'],
      [OLD_LOCATION, 'l-baru'],
    ]);
    expect(replaceLegacyIds(input, map)).toBe(3);
    expect(input).toEqual({ a: 'u-baru', b: ['u-baru', UNKNOWN, 'x'], c: { d: 'l-baru' } });
  });

  test('kandidat dibatasi MAX_LEGACY_CANDIDATES dan struktur terlalu dalam dihentikan', () => {
    const many = Array.from({ length: MAX_LEGACY_CANDIDATES + 500 }, (_, i) => {
      const n = String(i).padStart(12, '0');
      return `aaaaaaaa-aaaa-4aaa-8aaa-${n}`;
    });
    const found = new Set<string>();
    collectLegacyIds(many, found);
    expect(found.size).toBe(MAX_LEGACY_CANDIDATES);
    let deep: unknown = OLD_USER;
    for (let i = 0; i < 40; i++) deep = { x: deep };
    const deepFound = new Set<string>();
    collectLegacyIds(deep, deepFound);
    expect(deepFound.size).toBe(0);
  });
});

describe('translateLegacyIds (dengan basis data)', () => {
  let env: TestEnv;

  async function cookieFor(email: string) {
    return `qc_session=${await signSessionToken(env, email, env.clock.now())}`;
  }

  async function send(method: string, path: string, body?: unknown, email = 'admin@gmail.com') {
    const headers: Record<string, string> = { cookie: await cookieFor(email) };
    if (method !== 'GET') headers['x-requested-with'] = 'qc';
    if (body !== undefined) headers['content-type'] = 'application/json';
    return app.request(
      `https://qc.test/api/v1${path}`,
      { method, headers, body: body === undefined ? undefined : JSON.stringify(body) },
      env,
    );
  }

  /** Keadaan SESUDAH migrasi: baris ber-ID baru dan peta yang menunjuk ke sana. */
  async function seedMigrated() {
    await env.DB.exec(MAP_DDL);
    await seedRole(env, { id: 'r-lihat', name: 'Lihat Item', permissions: { item: 'view' } });
    await seedUser(env, { id: 'ulid-user-baru', email: 'lihat@gmail.com', roleIds: ['r-lihat'] });
    await seedLocation(env, { id: 'ulid-lokasi-baru', code: 'L1' });
    await seedBrand(env, 'Sony', { id: 'ulid-merk-baru' });
    await env.DB.prepare(
      "INSERT INTO id_ulid_map (old_id, new_id, source_table) VALUES (?, ?, 'users'), (?, ?, 'locations'), (?, ?, 'brands')",
    )
      .bind(
        OLD_USER,
        'ulid-user-baru',
        OLD_LOCATION,
        'ulid-lokasi-baru',
        OLD_BRAND,
        'ulid-merk-baru',
      )
      .run();
  }

  beforeEach(async () => {
    env = await createTestEnv();
    env.clock.set(Date.parse('2026-11-23T00:00:00.000Z'));
    resetLegacyIdsState(env.DB);
  });

  afterEach(async () => {
    // Skema tes dipakai semua berkas di proses ini: tabel peta tak boleh bocor ke tes lain.
    await env.DB.exec('DROP TABLE IF EXISTS id_ulid_map');
    resetLegacyIdsState(env.DB);
  });

  test('tabel peta tak ada: tanpa pekerjaan dan tanpa galat (keadaan sebelum migrasi)', async () => {
    await seedBrand(env, 'Sony', { id: OLD_BRAND });
    const input = { id: OLD_BRAND };
    expect(await translateLegacyIds(env, input)).toBe(0);
    expect(input.id).toBe(OLD_BRAND);
    // Rute sungguhan: ID lama masih berlaku apa adanya karena datanya memang belum ditulis ulang.
    const response = await send('GET', `/brands/${OLD_BRAND}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: OLD_BRAND });
  });

  test('sesudah migrasi: ID lama di jalur URL diterjemahkan sebelum handler (GET /brands/{id})', async () => {
    await seedMigrated();
    const response = await send('GET', `/brands/${OLD_BRAND}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: 'ulid-merk-baru', name: 'Sony' });
    // ID baru langsung tetap berfungsi.
    expect((await send('GET', '/brands/ulid-merk-baru')).status).toBe(200);
  });

  test('sesudah migrasi: ID lama di badan JSON (larik ids) diterjemahkan; clientId tak disentuh', async () => {
    await seedMigrated();
    const response = await send('POST', '/brands/batch/status', {
      ids: [OLD_BRAND],
      status: 'inactive',
    });
    expect(response.status).toBe(200);
    const row = await env.DB.prepare('SELECT status FROM brands WHERE id = ?')
      .bind('ulid-merk-baru')
      .first<{ status: string }>();
    expect(row?.status).toBe('inactive');
    const input = { clientId: OLD_USER, id: OLD_USER };
    expect(await translateLegacyIds(env, input)).toBe(1);
    expect(input).toEqual({ clientId: OLD_USER, id: 'ulid-user-baru' });
  });

  test('UUID yang tak ada di peta dibiarkan (jadi "tidak ditemukan" seperti ID asing)', async () => {
    await seedMigrated();
    const input = { id: UNKNOWN, ids: [OLD_BRAND, UNKNOWN] };
    expect(await translateLegacyIds(env, input)).toBe(1);
    expect(input).toEqual({ id: UNKNOWN, ids: ['ulid-merk-baru', UNKNOWN] });
    expect((await send('GET', `/brands/${UNKNOWN}`)).status).toBe(404);
  });

  test('izin tetap dinilai: akun tanpa izin 403 walau memakai ID lama', async () => {
    await seedMigrated();
    await seedUser(env, { id: 'u-polos', email: 'polos@gmail.com' });
    const response = await send('GET', `/brands/${OLD_BRAND}`, undefined, 'polos@gmail.com');
    expect(response.status).toBe(403);
  });

  test('arah mundur (setelah --revert): data kembali UUID, peta masih ada: lapisan MATI', async () => {
    await env.DB.exec(MAP_DDL);
    // Keadaan setelah --revert: baris memakai ID lama, peta masih menunjuk ke ID baru yang sudah tak ada.
    await seedRole(env, { id: 'r-lihat', name: 'Lihat Item', permissions: { item: 'view' } });
    await seedUser(env, { id: OLD_USER, email: 'lihat@gmail.com', roleIds: ['r-lihat'] });
    await seedBrand(env, 'Sony', { id: OLD_BRAND });
    await env.DB.prepare(
      "INSERT INTO id_ulid_map (old_id, new_id, source_table) VALUES (?, ?, 'users'), (?, ?, 'brands')",
    )
      .bind(OLD_USER, 'ulid-user-baru', OLD_BRAND, 'ulid-merk-baru')
      .run();
    const input = { id: OLD_BRAND };
    expect(await translateLegacyIds(env, input)).toBe(0);
    expect(input.id).toBe(OLD_BRAND);
    const response = await send('GET', `/brands/${OLD_BRAND}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: OLD_BRAND });
  });

  test('peta kosong atau tanpa sampel tabel stabil: mati (tidak menebak arah)', async () => {
    await env.DB.exec(MAP_DDL);
    await env.DB.prepare(
      "INSERT INTO id_ulid_map (old_id, new_id, source_table) VALUES (?, ?, 'brands')",
    )
      .bind(OLD_BRAND, 'ulid-merk-baru')
      .run();
    const input = { id: OLD_BRAND };
    expect(await translateLegacyIds(env, input)).toBe(0);
  });

  test('status di-cache 30 detik lalu dicek ulang (peta muncul sesudah start = aktif setelah masa berlaku)', async () => {
    const first = { id: OLD_BRAND };
    expect(await translateLegacyIds(env, first)).toBe(0); // tabel belum ada
    await seedMigrated();
    const cached = { id: OLD_BRAND };
    expect(await translateLegacyIds(env, cached)).toBe(0); // masih cache "mati"
    env.clock.advance(31_000);
    const refreshed = { id: OLD_BRAND };
    expect(await translateLegacyIds(env, refreshed)).toBe(1);
    expect(refreshed.id).toBe('ulid-merk-baru');
  });

  test('tanpa UUID di input tak ada kueri sama sekali (tabel peta pun tak diperiksa)', async () => {
    let queries = 0;
    const db = env.DB;
    const original = db.prepare.bind(db);
    db.prepare = ((sql: string) => {
      queries++;
      return original(sql);
    }) as typeof db.prepare;
    try {
      expect(await translateLegacyIds(env, { id: 'ulid-saja', n: 3, list: ['a'] })).toBe(0);
      expect(await translateLegacyIds(env, null)).toBe(0);
    } finally {
      db.prepare = original;
    }
    expect(queries).toBe(0);
  });
});
