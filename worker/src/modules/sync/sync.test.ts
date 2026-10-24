import { beforeEach, describe, expect, test } from 'bun:test';
import { SYNC_ACTOR } from '@shared/sync';
import { signSessionToken } from '@worker/core/session';
import { CSRF_HEADER, CSRF_VALUE } from '@worker/http/security';
import { app } from '@worker/index';
import { seedBrand, seedItem } from '@worker-test/item-fixtures';
import { measureCpu } from '@worker-test/measure';
import { createTestEnv, type TestEnv } from '@worker-test/test-env';
import { getSyncFile, planDriveFiles, probeDriveIds, registerDriveFiles } from './files';
import { handleSync, syncRoute } from './handler';
import { syncRoutes } from './routes';
import { currentSyncRev } from './state';

const TOKEN = 't0k3n'.repeat(8);
const PNG = 'iVBORw0KGgoAAAANSUhEUg==';
let env: TestEnv;

beforeEach(async () => {
  env = await createTestEnv({ SYNC_API_TOKEN: TOKEN });
  env.clock.set(Date.parse('2026-10-15T03:00:00.000Z'));
});

const send = (body: unknown, routes = syncRoutes()) =>
  handleSync(env, typeof body === 'string' ? body : JSON.stringify(body), routes);
const ping = (token: unknown) => send({ v: 1, method: 'sync.ping', token, payload: null });

type Out = { ok: boolean; data?: any; error?: any };
async function call(method: string, payload: unknown): Promise<Out> {
  return (await send({ v: 1, method, token: TOKEN, payload })) as Out;
}

async function prime(resource: 'brands' | 'items', count: number): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO sync_state (resource, seq, updated_at) VALUES (?, ?, ?) ON CONFLICT (resource) DO UPDATE SET seq = excluded.seq',
  )
    .bind(resource, count, '2026-01-01T00:00:00.000Z')
    .run();
}

async function audits() {
  const rows = await env.DB.prepare('SELECT actor, action, target FROM audit_log ORDER BY id').all<{
    actor: string;
    action: string;
    target: string;
  }>();
  return rows.results;
}

async function brandsInDb() {
  const rows = await env.DB.prepare(
    'SELECT id, name, external_id, status, sync_rev FROM brands ORDER BY name',
  ).all<{ id: string; name: string; external_id: string; status: string; sync_rev: number }>();
  return rows.results;
}

describe('handler', () => {
  test('sync.ping dengan token benar mengembalikan versi, waktu server, dan sumber daya', async () => {
    expect(await ping(TOKEN)).toEqual({
      ok: true,
      data: {
        apiVersion: 1,
        serverTime: '2026-10-15T03:00:00.000Z',
        resources: ['brands', 'items'],
      },
    });
  });

  test('semua kegagalan sebelum autentikasi menghasilkan UNAUTHENTICATED yang sama', async () => {
    const failures = [
      await ping('salah'),
      await ping(undefined),
      await ping(123),
      await send('{bukan json'),
      await send(''),
      await send('[]'),
      await send('null'),
      await send({ v: 1, method: 'tidak.ada', token: 'salah', payload: null }),
      await send({ v: 99, method: 'sync.ping', token: 'salah' }),
      await handleSync(env, undefined, syncRoutes()),
      await handleSync(env, 'x'.repeat(5_000_001), syncRoutes()),
    ];
    for (const result of failures) {
      expect(result).toMatchObject({
        ok: false,
        error: { code: 'UNAUTHENTICATED', message: 'Token tidak valid' },
      });
    }
  });

  test('VALIDATION dan NOT_FOUND hanya muncul setelah token benar', async () => {
    expect(await send({ v: 2, method: 'sync.ping', token: TOKEN })).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION', fields: { v: 'Gunakan v 1' } },
    });
    expect(await send({ v: 1, method: 'sync.tidak.ada', token: TOKEN })).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
    expect(
      await send({ v: 1, method: 'sync.ping', token: TOKEN, payload: { x: 1 } }),
    ).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' },
    });
  });

  test('token belum dikonfigurasi atau terlalu pendek: semua permintaan ditolak', async () => {
    const empty = await createTestEnv({ SYNC_API_TOKEN: '' });
    expect(
      await handleSync(
        empty,
        JSON.stringify({ v: 1, method: 'sync.ping', token: 'apa saja' }),
        syncRoutes(),
      ),
    ).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
    const short = await createTestEnv({ SYNC_API_TOKEN: 'pendek' });
    expect(
      await handleSync(
        short,
        JSON.stringify({ v: 1, method: 'sync.ping', token: 'pendek' }),
        syncRoutes(),
      ),
    ).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
  });

  test('10 kegagalan memblokir semua permintaan, termasuk yang bertoken benar (tabel rate_limits)', async () => {
    for (let i = 0; i < 9; i++) await ping(`salah-${i}`);
    expect(await ping(TOKEN)).toMatchObject({ ok: true });
    await ping('salah-9');
    expect(await ping(TOKEN)).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
    const block = await env.DB.prepare(
      "SELECT count FROM rate_limits WHERE key = 'sync:blocked'",
    ).first();
    expect(block).not.toBeNull();
    // blokir berakhir setelah 10 menit
    env.clock.advance(10 * 60 * 1000 + 1);
    expect(await ping(TOKEN)).toMatchObject({ ok: true });
  });

  test('jendela 10 menit: kegagalan yang jarang tidak menumpuk; 10 dalam jendela memblokir', async () => {
    for (let i = 0; i < 12; i++) {
      await ping(`salah-${i}`);
      env.clock.advance(9 * 60 * 1000);
    }
    expect(await ping(TOKEN)).toMatchObject({ ok: true });
    for (let i = 0; i < 10; i++) await ping(`cepat-${i}`);
    expect(await ping(TOKEN)).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
  });

  test('token sinkron tidak berlaku untuk RPC web, dan token sesi tidak berlaku untuk jalur sinkron', async () => {
    const response = await app.request(
      '/api/rpc',
      {
        method: 'POST',
        headers: { cookie: `qc_session=${TOKEN}`, [CSRF_HEADER]: CSRF_VALUE },
        body: JSON.stringify({ method: 'auth.me' }),
      },
      env,
    );
    expect(response.status).toBe(401);
    expect(
      await ping(await signSessionToken(env, 'admin@gmail.com', env.clock.now())),
    ).toMatchObject({
      ok: false,
      error: { code: 'UNAUTHENTICATED' },
    });
  });

  test('galat tak terduga di handler menjadi INTERNAL tanpa membocorkan detail', async () => {
    const routes = {
      'sync.boom': syncRoute({
        validate: () => null,
        handler: () => {
          throw new Error('rahasia internal');
        },
      }),
    };
    const result = await send({ v: 1, method: 'sync.boom', token: TOKEN }, routes);
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'INTERNAL', message: 'Terjadi kesalahan pada server' },
    });
    expect(JSON.stringify(result)).not.toContain('rahasia');
  });

  test('handler menerima konteks dengan pelaku sync:desktop dan tanpa user', async () => {
    let seen: unknown;
    const routes = {
      'sync.ctx': syncRoute({
        validate: () => null,
        handler: (_input, ctx) => {
          seen = ctx;
          return 1;
        },
      }),
    };
    await send({ v: 1, method: 'sync.ctx', token: TOKEN }, routes);
    expect(seen).toMatchObject({ actor: SYNC_ACTOR });
    expect(Object.keys(seen as object).sort()).toEqual(['actor', 'env', 'requestId']);
  });

  test('nama method bawaan Object tidak dianggap rute', async () => {
    for (const method of ['constructor', '__proto__', 'toString']) {
      expect(await send({ v: 1, method, token: TOKEN })).toMatchObject({
        ok: false,
        error: { code: 'NOT_FOUND' },
      });
    }
  });

  test('POST /sync lewat Hono: HTTP 200 dengan amplop; badan tak terbaca -> UNAUTHENTICATED', async () => {
    const ok = await app.request(
      '/sync',
      { method: 'POST', body: JSON.stringify({ v: 1, method: 'sync.ping', token: TOKEN }) },
      env,
    );
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, data: { apiVersion: 1 } });
    const bad = await app.request('/sync', { method: 'POST', body: 'bukan json' }, env);
    expect(bad.status).toBe(200);
    expect(await bad.json()).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
  });

  test('item sync belum tersedia: galat jelas, bukan NOT_FOUND', async () => {
    const out = await call('sync.items.pull', null);
    expect(out).toMatchObject({ ok: false, error: { code: 'INTERNAL' } });
    expect(out.error.message).toContain('NOT_IMPLEMENTED');
  });
});

describe('brands', () => {
  const push = (brands: unknown[], extra: Record<string, unknown> = {}) =>
    call('sync.brands.push', { brands, ...extra });
  const results = async (brands: unknown[], extra: Record<string, unknown> = {}) => {
    const out = await push(brands, extra);
    if (!out.ok) throw new Error(JSON.stringify(out.error));
    return out.data.results as Array<Record<string, any>>;
  };

  test('pull: halaman berurutan menurut rev, tepat sekali, kursor = rev terakhir; sinceRev menyaring', async () => {
    for (let i = 1; i <= 5; i++) {
      await seedBrand(env, `Merk ${i}`, { syncRev: i * 10, externalId: i === 2 ? '77' : '' });
    }
    await seedBrand(env, 'Lama', { syncRev: 0 });
    const seen: string[] = [];
    let since = 0;
    for (let guard = 0; guard < 10; guard++) {
      const page = await call('sync.brands.pull', { sinceRev: since, limit: 2 });
      expect(page.ok).toBe(true);
      seen.push(...page.data.brands.map((b: { name: string }) => b.name));
      since = page.data.nextRev;
      if (!page.data.hasMore) break;
    }
    expect(seen).toEqual(['Merk 1', 'Merk 2', 'Merk 3', 'Merk 4', 'Merk 5']);
    expect(since).toBe(50);
    const one = await call('sync.brands.pull', { sinceRev: 10, limit: 1 });
    expect(one.data.brands[0]).toEqual({
      uid: 'brand-merk-2',
      id: '77',
      name: 'Merk 2',
      active: true,
      rev: 20,
    });
    expect((await call('sync.brands.pull', { sinceRev: 50 })).data).toEqual({
      brands: [],
      nextRev: 50,
      hasMore: false,
    });
    expect((await call('sync.brands.pull', null)).data.brands).toHaveLength(5);
  });

  test('pull: payload tidak sah -> VALIDATION', async () => {
    for (const payload of [
      { sinceRev: -1 },
      { sinceRev: 1.5 },
      { limit: 0 },
      { limit: 501 },
      { include: ['detail'] },
      'x',
    ]) {
      expect(await call('sync.brands.pull', payload)).toMatchObject({
        ok: false,
        error: { code: 'VALIDATION' },
      });
    }
  });

  test('push merk baru: created, dipetakan ke id MySQL, audit atas nama sync:desktop; diulang -> unchanged', async () => {
    const [first] = await results([{ id: '3', name: 'Ubiquiti' }]);
    expect(first).toMatchObject({ index: 0, status: 'created', rev: 1 });
    expect(typeof first?.uid).toBe('string');
    expect(await brandsInDb()).toEqual([
      { id: first?.uid, name: 'Ubiquiti', external_id: '3', status: 'active', sync_rev: 1 },
    ]);
    expect((await audits()).at(-1)).toEqual({
      actor: SYNC_ACTOR,
      action: 'brand.create',
      target: 'Ubiquiti',
    });
    const count = (await audits()).length;
    const [again] = await results([{ id: '3', name: 'Ubiquiti' }]);
    expect(again).toMatchObject({ status: 'unchanged', uid: first?.uid, rev: 1 });
    expect(await audits()).toHaveLength(count);
  });

  test('push mencocokkan uid, lalu id MySQL, lalu nama; pemetaan saja -> updated tanpa kenaikan rev', async () => {
    await seedBrand(env, 'Ubiquiti', { syncRev: 5 });
    const [mapped] = await results([{ id: '3', name: 'ubiquiti' }]);
    expect(mapped).toMatchObject({ status: 'updated', uid: 'brand-ubiquiti', rev: 5 });
    expect((await brandsInDb())[0]).toMatchObject({
      name: 'Ubiquiti',
      external_id: '3',
      sync_rev: 5,
    });
    expect((await results([{ id: '3', name: 'Ubiquiti' }]))[0]).toMatchObject({
      status: 'unchanged',
    });
    expect((await results([{ uid: 'brand-ubiquiti', active: true }]))[0]?.status).toBe('unchanged');
  });

  test('ganti nama lewat push: rev naik, kunci dan rev item merk itu ikut berubah, audit brand.update', async () => {
    await prime('brands', 5);
    await prime('items', 8);
    await seedBrand(env, 'Ubiquity', { syncRev: 5 });
    await seedItem(env, { id: 'i1', brand: 'Ubiquity', model: 'ES 24', syncRev: 8 });
    const [renamed] = await results([{ uid: 'brand-ubiquity', name: 'Ubiquiti', baseRev: 5 }]);
    expect(renamed?.status).toBe('updated');
    expect((renamed?.rev ?? 0) > 5).toBe(true);
    const item = await env.DB.prepare("SELECT key, sync_rev FROM items WHERE id = 'i1'").first<{
      key: string;
      sync_rev: number;
    }>();
    expect(item?.key).toBe('ubiquiti es 24');
    expect((item?.sync_rev ?? 0) > 8).toBe(true);
    expect((await audits()).at(-1)).toMatchObject({ actor: SYNC_ACTOR, action: 'brand.update' });
  });

  test('konflik: baseRev basi + nilai berbeda -> conflict tanpa perubahan; baseRev terkini, overwrite, atau nilai sama berhasil', async () => {
    await prime('brands', 5);
    await seedBrand(env, 'A', { syncRev: 5 });
    const [stale] = await results([{ uid: 'brand-a', name: 'B', baseRev: 3 }]);
    expect(stale).toMatchObject({
      status: 'conflict',
      uid: 'brand-a',
      rev: 5,
      current: { uid: 'brand-a', name: 'A', active: true, rev: 5 },
    });
    expect((await brandsInDb())[0]?.name).toBe('A');
    expect((await audits()).at(-1)).toMatchObject({
      actor: SYNC_ACTOR,
      action: 'brand.sync.conflict',
    });
    expect((await results([{ uid: 'brand-a', name: 'B' }]))[0]?.status).toBe('conflict');
    expect(
      (await results([{ uid: 'brand-a', name: 'B', baseRev: 3 }], { overwrite: true }))[0]?.status,
    ).toBe('updated');
    expect((await brandsInDb())[0]?.name).toBe('B');
    const rev = (await brandsInDb())[0]?.sync_rev;
    expect((await results([{ uid: 'brand-a', name: 'C', baseRev: rev }]))[0]?.status).toBe(
      'updated',
    );
    expect((await results([{ uid: 'brand-a', name: 'C', baseRev: 1 }]))[0]?.status).toBe(
      'unchanged',
    );
  });

  test('nonaktifkan lewat active:false; pull menampilkan active:false', async () => {
    await prime('brands', 1);
    await seedBrand(env, 'A', { syncRev: 1 });
    expect((await results([{ uid: 'brand-a', active: false, baseRev: 1 }]))[0]?.status).toBe(
      'updated',
    );
    expect((await brandsInDb())[0]?.status).toBe('inactive');
    expect((await call('sync.brands.pull', {})).data.brands[0]).toMatchObject({ active: false });
  });

  test('entri tidak sah menghasilkan invalid per field tanpa membatalkan entri lain; urutan hasil = urutan permintaan', async () => {
    const out = await results([
      { name: 'Valid 1' },
      { name: '' },
      { id: { x: 1 }, name: 'Y' },
      { uid: 'tidak-ada', name: 'Z' },
      { name: '!!!' },
      { active: true },
      'bukan objek',
      { name: 'Valid 2', id: 12 },
    ]);
    expect(out.map((r) => r.status)).toEqual([
      'created',
      'invalid',
      'invalid',
      'invalid',
      'invalid',
      'invalid',
      'invalid',
      'created',
    ]);
    expect(out.map((r) => r.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(out[1]?.fields).toEqual({ name: 'Wajib diisi' });
    expect(out[3]?.fields).toEqual({ uid: 'Merk tidak ditemukan' });
    expect(out[5]?.fields).toEqual({ name: 'Wajib diisi untuk merk baru' });
    const rows = await brandsInDb();
    expect(rows.map((b) => b.name)).toEqual(['Valid 1', 'Valid 2']);
    expect(rows.find((b) => b.name === 'Valid 2')?.external_id).toBe('12');
  });

  test('uid dan id yang mengarah ke merk berbeda, atau merk sudah terpetakan ke id lain -> conflict', async () => {
    await seedBrand(env, 'A', { externalId: '1', syncRev: 1 });
    await seedBrand(env, 'B', { externalId: '2', syncRev: 2 });
    expect((await results([{ uid: 'brand-a', id: '2' }]))[0]?.status).toBe('conflict');
    expect((await results([{ uid: 'brand-a', id: '9' }]))[0]?.status).toBe('conflict');
    expect((await brandsInDb()).map((b) => b.external_id)).toEqual(['1', '2']);
  });

  test('ganti nama ke nama merk lain -> invalid (CONFLICT server dipetakan ke field name)', async () => {
    await seedBrand(env, 'A', { syncRev: 1 });
    await seedBrand(env, 'B', { syncRev: 2 });
    const [out] = await results([{ uid: 'brand-a', name: 'B', baseRev: 1 }]);
    expect(out).toMatchObject({ status: 'invalid', fields: { name: 'Nama merk sudah dipakai' } });
  });

  test('batas jumlah entri dan bentuk payload', async () => {
    const many = Array.from({ length: 51 }, (_, i) => ({ name: `M${i}` }));
    expect(await push(many)).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION', fields: { brands: 'Maksimal 50 merk' } },
    });
    expect(await push([])).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    expect(await call('sync.brands.push', { brands: 'x' })).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' },
    });
    expect(
      await call('sync.brands.push', { brands: [{ name: 'A' }], overwrite: 'ya' }),
    ).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' },
    });
    expect(await call('sync.brands.push', null)).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' },
    });
  });

  test('field tidak dikenal ditolak per field', async () => {
    const [out] = await results([{ id: '1', name: 'Ubiquiti', nama: 'salah' }]);
    expect(out).toMatchObject({ status: 'invalid', fields: { nama: 'Field tidak dikenal' } });
  });

  test('kursor hasil impor tetap valid: sync_state diimpor apa adanya dan revisi baru melampauinya', async () => {
    await prime('brands', 40);
    await seedBrand(env, 'Lama', { syncRev: 40 });
    expect(await currentSyncRev(env.DB, 'brands')).toBe(40);
    const [created] = await results([{ name: 'Baru' }]);
    expect(created?.rev).toBe(41);
    // Desktop yang berkursor di 40 menarik hanya yang baru.
    const page = await call('sync.brands.pull', { sinceRev: 40 });
    expect(page.data.brands.map((b: { name: string }) => b.name)).toEqual(['Baru']);
    expect(page.data.nextRev).toBe(41);
  });
});

describe('files', () => {
  async function folderWithBridge(): Promise<string> {
    await env.DB.prepare(
      "INSERT INTO settings (key, value) VALUES ('DRIVE_FOLDER_ID', 'F1')",
    ).run();
    env.BRIDGE.state.folders.add('F1');
    return 'F1';
  }
  const driveFile = (folder: string, name: string, mime: string, base64: string) =>
    env.BRIDGE.createFile(folder, name, mime, base64);

  test('sync.file.get mengembalikan isi berkas di folder aplikasi', async () => {
    const folder = await folderWithBridge();
    const driveId = await driveFile(folder, 'a.png', 'image/png', PNG);
    expect(await call('sync.file.get', { driveId })).toEqual({
      ok: true,
      data: { driveId, mime: 'image/png', base64: PNG },
    });
  });

  test('id di luar folder, tak dikenal, atau tanpa DRIVE_FOLDER_ID -> NOT_FOUND', async () => {
    const folder = await folderWithBridge();
    env.BRIDGE.state.folders.add('LAIN');
    const outside = await driveFile('LAIN', 'b.png', 'image/png', PNG);
    expect(await call('sync.file.get', { driveId: outside })).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
    expect(await call('sync.file.get', { driveId: 'tidak-ada' })).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
    const inside = await driveFile(folder, 'c.png', 'image/png', PNG);
    await env.DB.prepare("DELETE FROM settings WHERE key = 'DRIVE_FOLDER_ID'").run();
    expect(await call('sync.file.get', { driveId: inside })).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
  });

  test('payload tidak sah -> VALIDATION; berkas > 8 MB -> VALIDATION', async () => {
    const folder = await folderWithBridge();
    expect(await call('sync.file.get', {})).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION', fields: { driveId: 'Wajib diisi' } },
    });
    expect(await call('sync.file.get', null)).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' },
    });
    const big = await driveFile(folder, 'big.png', 'image/png', 'A'.repeat(11_000_000));
    expect(await call('sync.file.get', { driveId: big })).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION', fields: { driveId: 'Berkas melebihi 8 MB' } },
    });
    expect(typeof getSyncFile).toBe('function');
  });

  test('registerDriveFiles: berkas di folder didaftarkan sekali; id tak sah missing; idempoten', async () => {
    const folder = await folderWithBridge();
    env.BRIDGE.state.folders.add('LAIN');
    const good = await driveFile(folder, 'a.png', 'image/png', PNG);
    const outside = await driveFile('LAIN', 'b.png', 'image/png', PNG);
    const text = await driveFile(folder, 't.txt', 'text/plain', PNG);
    const ids = [good, outside, text, 'tidak-ada', good];
    const first = await registerDriveFiles(env, ids, await probeDriveIds(env, ids), 'owner-1');
    expect(first.missing.sort()).toEqual([outside, text, 'tidak-ada'].sort());
    expect(first.map.size).toBe(1);
    const rows = await env.DB.prepare(
      'SELECT drive_id, mime, size, owner_type, created_by, status FROM files',
    ).all();
    expect(rows.results).toEqual([
      {
        drive_id: good,
        mime: 'image/png',
        size: 16,
        owner_type: '',
        created_by: SYNC_ACTOR,
        status: 'active',
      },
    ]);
    const second = await registerDriveFiles(
      env,
      [good],
      await probeDriveIds(env, [good]),
      'owner-1',
    );
    expect(second.map.get(good)).toBe(first.map.get(good));
    expect(
      (await env.DB.prepare('SELECT COUNT(*) AS n FROM files').first<{ n: number }>())?.n,
    ).toBe(1);
  });

  test('berkas yang sudah dimiliki entitas lain -> baris baru untuk berkas Drive yang sama', async () => {
    const folder = await folderWithBridge();
    const drive = await driveFile(folder, 'a.png', 'image/png', PNG);
    await registerDriveFiles(env, [drive], await probeDriveIds(env, [drive]), 'item-1');
    await env.DB.prepare("UPDATE files SET owner_type = 'item', owner_id = 'item-1'").run();
    const plan = await planDriveFiles(env, [drive], await probeDriveIds(env, [drive]), 'item-2');
    expect(plan.pending).toHaveLength(1);
    expect(plan.pending[0]).toMatchObject({ driveId: drive, ownerType: '' });
    const again = await planDriveFiles(env, [drive], await probeDriveIds(env, [drive]), 'item-1');
    expect(again.pending).toHaveLength(0);
  });
});

describe('CPU kasar (P6)', () => {
  test('pull merk 500 baris dan ping tetap murah; autentikasi sah = satu kueri D1', async () => {
    const statements: D1PreparedStatement[] = [];
    for (let i = 0; i < 500; i++) {
      statements.push(
        env.DB.prepare(
          "INSERT INTO brands (id, name, key, status, sync_rev) VALUES (?, ?, ?, 'active', ?)",
        ).bind(`b${i}`, `Merk ${i}`, `merk ${i}`, i + 1),
      );
    }
    for (let i = 0; i < statements.length; i += 50) await env.DB.batch(statements.slice(i, i + 50));
    const pull = await measureCpu(() => call('sync.brands.pull', { limit: 500 }));
    expect(pull.result.data.brands).toHaveLength(500);
    expect(pull.ms).toBeLessThan(15);
    const ping = await measureCpu(() => send({ v: 1, method: 'sync.ping', token: TOKEN }));
    expect(ping.ms).toBeLessThan(5);
  });
});
