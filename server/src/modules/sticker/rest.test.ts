import { beforeEach, describe, expect, test } from 'bun:test';
import { app } from '@server/app';
import { signSessionToken } from '@server/core/session';
import { seedRole, seedUser } from '@server-test/access-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';

// Kontrak REST `stickerTypes.*`.

let env: TestEnv;

async function cookieFor(email: string) {
  return `qc_session=${await signSessionToken(env, email, env.clock.now())}`;
}

async function send(
  method: string,
  path: string,
  options: { body?: unknown; email?: string | null; headers?: Record<string, string> } = {},
) {
  const headers: Record<string, string> = { ...options.headers };
  if (options.email !== null) headers.cookie = await cookieFor(options.email ?? 'admin@gmail.com');
  if (method !== 'GET') headers['x-requested-with'] = 'qc';
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  return app.request(
    `https://qc.test/api/v1${path}`,
    {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    },
    env,
  );
}

const json = async (response: Response) => (await response.json()) as Record<string, unknown>;

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-09T00:00:00.000Z'));
  await seedRole(env, { id: 'r-lihat', name: 'Lihat Stiker', permissions: { sticker: 'view' } });
  await seedRole(env, { id: 'r-edit', name: 'Edit Stiker', permissions: { sticker: 'edit' } });
  await seedUser(env, { id: 'u-lihat', email: 'lihat@gmail.com', roleIds: ['r-lihat'] });
  await seedUser(env, { id: 'u-edit', email: 'edit@gmail.com', roleIds: ['r-edit'] });
  await seedRole(env, { id: 'r-item-edit', name: 'Edit Item', permissions: { item: 'edit' } });
  await seedRole(env, { id: 'r-item-view', name: 'Lihat Item', permissions: { item: 'view' } });
  await seedUser(env, { id: 'u-item-edit', email: 'itemedit@gmail.com', roleIds: ['r-item-edit'] });
  await seedUser(env, { id: 'u-item-view', email: 'itemview@gmail.com', roleIds: ['r-item-view'] });
  await seedUser(env, { id: 'u-polos', email: 'polos@gmail.com' });
});

describe('GET /sticker-types', () => {
  test('daftar jenis; butuh sticker:view (403 tanpa izin, 401 tanpa sesi)', async () => {
    await send('POST', '/sticker-types', { body: { name: 'QC', rule: 'bu' } });
    const ok = await send('GET', '/sticker-types', { email: 'lihat@gmail.com' });
    expect(ok.status).toBe(200);
    expect((await ok.json()) as unknown).toMatchObject([
      { name: 'QC', rule: 'bu', status: 'active', stickerCount: 0 },
    ]);
    const forbidden = await send('GET', '/sticker-types', { email: 'polos@gmail.com' });
    expect(forbidden.status).toBe(403);
    expect(await json(forbidden)).toMatchObject({ code: 'FORBIDDEN' });
    const anon = await send('GET', '/sticker-types', { email: null });
    expect(anon.status).toBe(401);
  });
});

describe('izin baca katalog untuk editor item (3b-2)', () => {
  test('stickerTypes.list dan stickers.list: sticker:view ATAU item:edit; item:view saja dan tanpa izin 403; tulis tetap sticker:edit', async () => {
    for (const path of ['/sticker-types', '/stickers']) {
      for (const email of ['lihat@gmail.com', 'itemedit@gmail.com', 'edit@gmail.com']) {
        expect((await send('GET', path, { email })).status, `${path} ${email}`).toBe(200);
      }
      for (const email of ['itemview@gmail.com', 'polos@gmail.com']) {
        const response = await send('GET', path, { email });
        expect([path, email, response.status]).toEqual([path, email, 403]);
        expect(await json(response)).toMatchObject({ code: 'FORBIDDEN' });
      }
      expect((await send('GET', path, { email: null })).status).toBe(401);
    }
    // pemegang item:edit hanya membaca: menulis katalog tetap butuh sticker:edit
    const write = await send('POST', '/sticker-types', {
      email: 'itemedit@gmail.com',
      body: { name: 'QC', rule: 'bu' },
    });
    expect(write.status).toBe(403);
  });
});

describe('POST/PUT /sticker-types', () => {
  test('201 + Location; nama dirapikan; sticker:view saja ditolak FORBIDDEN', async () => {
    const forbidden = await send('POST', '/sticker-types', {
      email: 'lihat@gmail.com',
      body: { name: 'QC', rule: 'bu' },
    });
    expect(forbidden.status).toBe(403);
    expect(await json(forbidden)).toMatchObject({ code: 'FORBIDDEN' });
    const response = await send('POST', '/sticker-types', {
      email: 'edit@gmail.com',
      body: { name: '  QC ', rule: 'bu' },
    });
    expect(response.status).toBe(201);
    const type = await json(response);
    expect(type).toMatchObject({ name: 'QC', rule: 'bu', status: 'active', stickerCount: 0 });
    expect(response.headers.get('location')).toBe(`/api/v1/sticker-types/${type.id as string}`);
  });

  test('nama kembar 409 dengan pesan di field name; rule group 422', async () => {
    await send('POST', '/sticker-types', { body: { name: 'QC', rule: 'bu' } });
    const clash = await send('POST', '/sticker-types', { body: { name: 'qc ', rule: 'none' } });
    expect(clash.status).toBe(409);
    expect(await json(clash)).toMatchObject({ fields: { name: 'Nama jenis sudah dipakai' } });
    const bad = await send('POST', '/sticker-types', { body: { name: 'Lain', rule: 'group' } });
    expect(bad.status).toBe(422);
    expect(await json(bad)).toMatchObject({ code: 'VALIDATION' });
  });

  const ifMatch = (updatedAt: unknown) => ({ 'if-match': `"${updatedAt as string}"` });

  test('PUT mengubah nama dengan If-Match; ETag baru = updatedAt; rule terkunci bila sudah ada stiker; id tak dikenal 404', async () => {
    const created = await json(
      await send('POST', '/sticker-types', { body: { name: 'QC', rule: 'bu' } }),
    );
    const id = created.id as string;
    env.clock.advance(1000);
    const renamed = await send('PUT', `/sticker-types/${id}`, {
      headers: ifMatch(created.updatedAt),
      body: { name: 'QC 2', rule: 'bu' },
    });
    expect(renamed.status).toBe(200);
    const body = await json(renamed);
    expect(body).toMatchObject({ id, name: 'QC 2' });
    expect(renamed.headers.get('etag')).toBe(`"${body.updatedAt as string}"`);
    await env.DB.prepare(
      "INSERT INTO stickers (id, type_id, name, status) VALUES ('s1', ?, 'Hijau', 'active')",
    )
      .bind(id)
      .run();
    const locked = await send('PUT', `/sticker-types/${id}`, {
      headers: ifMatch(body.updatedAt),
      body: { name: 'QC 2', rule: 'none' },
    });
    expect(locked.status).toBe(422);
    expect(await json(locked)).toMatchObject({
      fields: { rule: 'Aturan jenis tidak dapat diubah karena sudah ada stiker' },
    });
    const missing = await send('PUT', '/sticker-types/tidak-ada', {
      headers: ifMatch('2026-11-09T00:00:00.000Z'),
      body: { name: 'X', rule: 'bu' },
    });
    expect(missing.status).toBe(404);
  });

  test('PUT tanpa If-Match 422 (versi wajib saat mengubah); If-Match basi 412 dan tak menulis apa pun', async () => {
    const created = await json(
      await send('POST', '/sticker-types', { body: { name: 'QC', rule: 'bu' } }),
    );
    const id = created.id as string;
    const noHeader = await send('PUT', `/sticker-types/${id}`, {
      body: { name: 'Tanpa Versi', rule: 'bu' },
    });
    expect(noHeader.status).toBe(422);
    expect(await json(noHeader)).toMatchObject({
      fields: { expectedUpdatedAt: expect.any(String) },
    });
    env.clock.advance(1000);
    const first = await send('PUT', `/sticker-types/${id}`, {
      headers: ifMatch(created.updatedAt),
      body: { name: 'Pertama', rule: 'bu' },
    });
    expect(first.status).toBe(200);
    const stale = await send('PUT', `/sticker-types/${id}`, {
      headers: ifMatch(created.updatedAt),
      body: { name: 'Basi', rule: 'bu' },
    });
    expect(stale.status).toBe(412);
    expect(await json(stale)).toMatchObject({ code: 'CONFLICT' });
    const row = await env.DB.prepare('SELECT name FROM sticker_types WHERE id = ?')
      .bind(id)
      .first<{ name: string }>();
    expect(row?.name).toBe('Pertama');
  });
});

describe('PATCH /sticker-types/{id} (status)', () => {
  test('nonaktifkan lalu aktifkan; butuh sticker:manage (edit = 403)', async () => {
    const created = await json(
      await send('POST', '/sticker-types', { body: { name: 'QC', rule: 'bu' } }),
    );
    const id = created.id as string;
    const forbidden = await send('PATCH', `/sticker-types/${id}`, {
      email: 'edit@gmail.com',
      body: { status: 'inactive' },
    });
    expect(forbidden.status).toBe(403);
    const off = await send('PATCH', `/sticker-types/${id}`, { body: { status: 'inactive' } });
    expect(off.status).toBe(200);
    expect(await json(off)).toMatchObject({ id, status: 'inactive' });
    const on = await send('PATCH', `/sticker-types/${id}`, { body: { status: 'active' } });
    expect(await json(on)).toMatchObject({ status: 'active' });
    const bad = await send('PATCH', `/sticker-types/${id}`, { body: { status: 'x' } });
    expect(bad.status).toBe(422);
  });
});
