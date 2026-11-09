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
  options: { body?: unknown; email?: string | null } = {},
) {
  const headers: Record<string, string> = {};
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

  test('PUT mengubah nama; rule terkunci bila sudah ada stiker; id tak dikenal 404', async () => {
    const created = await json(
      await send('POST', '/sticker-types', { body: { name: 'QC', rule: 'bu' } }),
    );
    const id = created.id as string;
    const renamed = await send('PUT', `/sticker-types/${id}`, {
      body: { name: 'QC 2', rule: 'bu' },
    });
    expect(renamed.status).toBe(200);
    expect(await json(renamed)).toMatchObject({ id, name: 'QC 2' });
    await env.DB.prepare(
      "INSERT INTO stickers (id, type_id, name, status) VALUES ('s1', ?, 'Hijau', 'active')",
    )
      .bind(id)
      .run();
    const locked = await send('PUT', `/sticker-types/${id}`, {
      body: { name: 'QC 2', rule: 'none' },
    });
    expect(locked.status).toBe(422);
    expect(await json(locked)).toMatchObject({
      fields: { rule: 'Aturan jenis tidak dapat diubah karena sudah ada stiker' },
    });
    const missing = await send('PUT', '/sticker-types/tidak-ada', {
      body: { name: 'X', rule: 'bu' },
    });
    expect(missing.status).toBe(404);
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
