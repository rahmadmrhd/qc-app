import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { app } from '@server/app';
import { DbError } from '@server/core/db';
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
import { fromRequestParts } from '@shared/api';

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
  test('mengumpulkan UUID persis hanya di bawah kunci ber-ID (objek, larik, bersarang); teks bebas dan huruf besar tak ikut', () => {
    const found = new Set<string>();
    collectLegacyIds(
      {
        id: OLD_BRAND,
        ids: [OLD_USER, 'bukan-uuid', 7, null],
        nested: { deep: [{ locationId: OLD_LOCATION }] },
        note: `lihat /files/${OLD_USER} di sini`,
        upper: OLD_USER.toUpperCase(),
        // Teks bebas yang KEBETULAN persis UUID (mis. nomor serial/komentar): tidak boleh ikut (review 2026-11-23).
        serial: UNKNOWN,
        text: OLD_USER,
        name: OLD_BRAND,
        rows: [{ serial: OLD_LOCATION }],
        listOfText: [OLD_LOCATION],
      },
      found,
    );
    expect([...found].sort()).toEqual([OLD_BRAND, OLD_USER, OLD_LOCATION].sort());
  });

  test('pola kunci: id/ids/xxxId/xxxIds ikut; Idx/identifier/valid/uuid/value tidak', () => {
    const found = new Set<string>();
    collectLegacyIds(
      {
        id: '10000000-0000-4000-8000-000000000001',
        ids: ['10000000-0000-4000-8000-000000000002'],
        businessUnitIds: ['10000000-0000-4000-8000-000000000003'],
        proofPhotoIds: ['10000000-0000-4000-8000-000000000004'],
        jobId: '10000000-0000-4000-8000-000000000005',
        Id: '10000000-0000-4000-8000-000000000006',
        idx: '20000000-0000-4000-8000-000000000001',
        identifier: '20000000-0000-4000-8000-000000000002',
        valid: '20000000-0000-4000-8000-000000000003',
        uuid: '20000000-0000-4000-8000-000000000004',
        value: '20000000-0000-4000-8000-000000000005',
        idList: ['20000000-0000-4000-8000-000000000006'],
      },
      found,
    );
    expect([...found].every((v) => v.startsWith('1'))).toBe(true);
    expect(found.size).toBe(6);
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

  test('mengganti di tempat pada kunci ber-ID (nilai langsung, larik, bersarang); teks bebas utuh; jumlah benar', () => {
    const input = {
      userId: OLD_USER,
      ids: [OLD_USER, UNKNOWN, 'x'],
      c: { locationId: OLD_LOCATION },
      serial: OLD_USER,
      text: OLD_LOCATION,
      rows: [{ note: OLD_USER, itemId: OLD_LOCATION }],
    };
    const map = new Map([
      [OLD_USER, 'u-baru'],
      [OLD_LOCATION, 'l-baru'],
    ]);
    expect(replaceLegacyIds(input, map)).toBe(4);
    expect(input).toEqual({
      userId: 'u-baru',
      ids: ['u-baru', UNKNOWN, 'x'],
      c: { locationId: 'l-baru' },
      serial: OLD_USER,
      text: OLD_LOCATION,
      rows: [{ note: OLD_USER, itemId: 'l-baru' }],
    });
  });

  test('kandidat dibatasi MAX_LEGACY_CANDIDATES dan struktur terlalu dalam dihentikan', () => {
    const many = Array.from({ length: MAX_LEGACY_CANDIDATES + 500 }, (_, i) => {
      const n = String(i).padStart(12, '0');
      return `aaaaaaaa-aaaa-4aaa-8aaa-${n}`;
    });
    const found = new Set<string>();
    collectLegacyIds({ ids: many }, found);
    expect(found.size).toBe(MAX_LEGACY_CANDIDATES);
    let deep: unknown = OLD_USER;
    for (let i = 0; i < 40; i++) deep = { id: deep };
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
      // UUID di bawah kunci teks bebas bukan kandidat: tak ada kueri juga.
      expect(await translateLegacyIds(env, { serial: OLD_USER, text: OLD_BRAND })).toBe(0);
    } finally {
      db.prepare = original;
    }
    expect(queries).toBe(0);
  });

  test('teks bebas yang kebetulan persis UUID di peta TIDAK berubah (bukan oracle pemetaan; review keamanan)', async () => {
    await seedMigrated();
    const response = await send('POST', '/brands', { name: OLD_BRAND, businessUnitIds: [] });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ name: OLD_BRAND });
    const row = await env.DB.prepare('SELECT name FROM brands WHERE name = ?')
      .bind(OLD_BRAND)
      .first<{ name: string }>();
    expect(row?.name).toBe(OLD_BRAND);
    const input = { serial: OLD_USER, note: OLD_LOCATION, brandId: OLD_BRAND };
    expect(await translateLegacyIds(env, input)).toBe(1);
    expect(input).toEqual({ serial: OLD_USER, note: OLD_LOCATION, brandId: 'ulid-merk-baru' });
  });

  test('keadaan campuran (satu tabel probe baru, lainnya lama): MATI', async () => {
    await env.DB.exec(MAP_DDL);
    await seedRole(env, { id: 'r-lihat', name: 'Lihat Item', permissions: { item: 'view' } });
    await seedUser(env, { id: 'ulid-user-baru', email: 'lihat@gmail.com', roleIds: ['r-lihat'] });
    await seedLocation(env, { id: OLD_LOCATION, code: 'L1' }); // lokasi masih ber-ID lama
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
    const input = { id: OLD_BRAND };
    expect(await translateLegacyIds(env, input)).toBe(0);
    expect(input.id).toBe(OLD_BRAND);
  });

  test('galat DB selain "tabel tak ada" merambat (tidak ditelan), baik di probe maupun di pencarian', async () => {
    await seedMigrated();
    const db = env.DB;
    const original = db.prepare.bind(db);
    const failing = (needle: string) =>
      ((sql: string) => {
        if (sql.includes(needle)) {
          throw new DbError('Database tak terjangkau', { errno: 2013, kind: 'unavailable' });
        }
        return original(sql);
      }) as typeof db.prepare;
    try {
      // Probe gagal (status belum di-cache).
      db.prepare = failing('FROM id_ulid_map WHERE source_table');
      await expect(translateLegacyIds(env, { id: OLD_BRAND })).rejects.toBeInstanceOf(DbError);
      // Probe sukses, pencarian gagal.
      db.prepare = original;
      resetLegacyIdsState(db);
      db.prepare = failing('FROM id_ulid_map WHERE old_id IN');
      await expect(translateLegacyIds(env, { id: OLD_BRAND })).rejects.toBeInstanceOf(DbError);
    } finally {
      db.prepare = original;
    }
  });

  test('peta dibuang saat status masih di-cache aktif: tanpa pekerjaan lalu dicek ulang', async () => {
    await seedMigrated();
    const first = { id: OLD_BRAND };
    expect(await translateLegacyIds(env, first)).toBe(1); // aktif, di-cache
    await env.DB.exec('DROP TABLE id_ulid_map');
    const dropped = { id: OLD_USER }; // belum ada di cache terjemahan: pencarian kena 1146
    expect(await translateLegacyIds(env, dropped)).toBe(0);
    expect(dropped.id).toBe(OLD_USER);
    const again = { id: OLD_BRAND }; // status dihitung ulang: tabel tak ada
    expect(await translateLegacyIds(env, again)).toBe(0);
    expect(again.id).toBe(OLD_BRAND);
  });

  test('pencarian per 500 dan batas 2.000 kandidat lewat translateLegacyIds', async () => {
    await seedMigrated();
    const total = MAX_LEGACY_CANDIDATES + 100;
    const olds = Array.from(
      { length: total },
      (_, i) => `bbbbbbbb-bbbb-4bbb-8bbb-${String(i).padStart(12, '0')}`,
    );
    for (let i = 0; i < total; i += 700) {
      const slice = olds.slice(i, i + 700);
      const marks = slice.map(() => "(?, ?, 'bulk')").join(', ');
      await env.DB.prepare(`INSERT INTO id_ulid_map (old_id, new_id, source_table) VALUES ${marks}`)
        .bind(...slice.flatMap((old, k) => [old, `ulid-bulk-${i + k}`]))
        .run();
    }
    const input = { ids: [...olds] };
    expect(await translateLegacyIds(env, input)).toBe(MAX_LEGACY_CANDIDATES);
    expect(input.ids[0]).toBe('ulid-bulk-0');
    expect(input.ids[MAX_LEGACY_CANDIDATES - 1]).toBe(`ulid-bulk-${MAX_LEGACY_CANDIDATES - 1}`);
    expect(input.ids[MAX_LEGACY_CANDIDATES]).toBe(olds[MAX_LEGACY_CANDIDATES]); // kelebihan dibiarkan
    expect(input.ids[total - 1]).toBe(olds[total - 1]);
  });

  test('siklus aktif -> mati -> aktif membuang cache terjemahan (peta yang berubah terbaca)', async () => {
    await seedMigrated();
    const first = { id: OLD_BRAND };
    expect(await translateLegacyIds(env, first)).toBe(1);
    expect(first.id).toBe('ulid-merk-baru');
    // Mundur: sebagian baris kembali ber-ID lama (campuran) -> mati.
    await seedUser(env, { id: OLD_USER, email: 'lama@gmail.com' });
    env.clock.advance(31_000);
    const off = { id: OLD_BRAND };
    expect(await translateLegacyIds(env, off)).toBe(0);
    // Maju lagi dengan pemetaan yang berbeda untuk ID yang sama.
    await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(OLD_USER).run();
    await env.DB.prepare('UPDATE id_ulid_map SET new_id = ? WHERE old_id = ?')
      .bind('ulid-merk-lain', OLD_BRAND)
      .run();
    env.clock.advance(31_000);
    const on = { id: OLD_BRAND };
    expect(await translateLegacyIds(env, on)).toBe(1);
    expect(on.id).toBe('ulid-merk-lain');
  });

  test('parameter query berjenis daftar (items.list brandIds) lewat fromRequestParts diterjemahkan', async () => {
    await seedMigrated();
    const input = fromRequestParts('items.list', {
      params: {},
      query: { brandIds: `${OLD_BRAND},${UNKNOWN}` },
      body: undefined,
      raw: undefined,
      multipart: undefined,
      ifMatch: undefined,
      created: false,
    } as never) as { brandIds?: string[] };
    expect(input.brandIds).toEqual([OLD_BRAND, UNKNOWN]);
    expect(await translateLegacyIds(env, input)).toBe(1);
    expect(input.brandIds).toEqual(['ulid-merk-baru', UNKNOWN]);
  });

  test('log "legacy-id" mencatat jumlah penggantian (hanya jumlah, tanpa ID)', async () => {
    await seedMigrated();
    const spy = spyOn(console, 'log').mockImplementation(() => {});
    try {
      const response = await send('GET', `/brands/${OLD_BRAND}`);
      expect(response.status).toBe(200);
      const entries = spy.mock.calls.map((call) => call[0] as Record<string, unknown>);
      const logged = entries.find((entry) => entry?.evt === 'legacy-id');
      expect(logged).toMatchObject({ evt: 'legacy-id', method: 'brands.get', count: 1 });
      expect(JSON.stringify(logged)).not.toContain(OLD_BRAND);
      expect(JSON.stringify(logged)).not.toContain('ulid-merk-baru');
    } finally {
      spy.mockRestore();
    }
  });
});
