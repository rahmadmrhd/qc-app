import { beforeEach, describe, expect, test } from 'bun:test';
import { app } from '@server/app';
import { signSessionToken } from '@server/core/session';
import { seedRole, seedUser } from '@server-test/access-fixtures';
import { seedBrand, seedItem } from '@server-test/item-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { REST_MIGRATED_IDS } from '@shared/api';

// Padanan REST dari kontrak RPC `brands.*`: kabel baru, logika modul sama.

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
  env.clock.set(Date.parse('2026-10-09T00:00:00.000Z'));
  await seedRole(env, { id: 'r-lihat', name: 'Lihat Item', permissions: { item: 'view' } });
  await seedRole(env, { id: 'r-edit', name: 'Edit Item', permissions: { item: 'edit' } });
  await seedUser(env, { id: 'u-lihat', email: 'lihat@gmail.com', roleIds: ['r-lihat'] });
  await seedUser(env, { id: 'u-edit', email: 'edit@gmail.com', roleIds: ['r-edit'] });
  await seedUser(env, { id: 'u-polos', email: 'polos@gmail.com' });
});

test('brands.* terdaftar di REST_MIGRATED_IDS dan /api/rpc menjawab NOT_FOUND untuknya', async () => {
  for (const id of ['brands.list', 'brands.save', 'brands.setStatus'] as const) {
    expect(REST_MIGRATED_IDS.has(id)).toBe(true);
    const response = await app.request(
      'https://qc.test/api/rpc',
      {
        method: 'POST',
        headers: {
          cookie: await cookieFor('admin@gmail.com'),
          'content-type': 'application/json',
          'x-requested-with': 'qc',
        },
        body: JSON.stringify({ method: id, payload: null }),
      },
      env,
    );
    expect(response.status).toBe(404);
    expect(((await json(response)).error as { code: string }).code).toBe('NOT_FOUND');
  }
});

describe('GET /brands', () => {
  test('daftar merk dengan jumlah item; butuh izin item:view', async () => {
    await seedBrand(env, 'Sony');
    await seedItem(env, { id: 'i1', brand: 'Sony', model: 'A1' });
    const response = await send('GET', '/brands', { email: 'lihat@gmail.com' });
    expect(response.status).toBe(200);
    expect((await response.json()) as unknown).toMatchObject([
      { id: 'brand-sony', name: 'Sony', status: 'active', itemCount: 1 },
    ]);
  });

  test('tanpa izin 403, tanpa sesi 401 (problem+json)', async () => {
    const forbidden = await send('GET', '/brands', { email: 'polos@gmail.com' });
    expect(forbidden.status).toBe(403);
    expect(forbidden.headers.get('content-type')).toContain('application/problem+json');
    expect(await json(forbidden)).toMatchObject({ code: 'FORBIDDEN' });
    const anon = await send('GET', '/brands', { email: null });
    expect(anon.status).toBe(401);
    expect(await json(anon)).toMatchObject({ code: 'UNAUTHENTICATED' });
  });
});

describe('POST /brands (buat)', () => {
  test('201 + Location + isi merk baru; nama dirapikan', async () => {
    const response = await send('POST', '/brands', { body: { name: '  Ubiquiti ' } });
    expect(response.status).toBe(201);
    const brand = await json(response);
    expect(brand).toMatchObject({ name: 'Ubiquiti', status: 'active', itemCount: 0 });
    expect(response.headers.get('location')).toBe(`/api/v1/brands/${brand.id as string}`);
    const row = await env.DB.prepare('SELECT name, `key` FROM brands WHERE id = ?')
      .bind(brand.id as string)
      .first<{ name: string; key: string }>();
    expect(row).toEqual({ name: 'Ubiquiti', key: 'ubiquiti' });
  });

  test('izin edit cukup; hanya lihat 403 dan tidak menulis apa pun', async () => {
    expect(
      (await send('POST', '/brands', { email: 'edit@gmail.com', body: { name: 'A' } })).status,
    ).toBe(201);
    const forbidden = await send('POST', '/brands', {
      email: 'lihat@gmail.com',
      body: { name: 'B' },
    });
    expect(forbidden.status).toBe(403);
    expect(
      (await env.DB.prepare('SELECT COUNT(*) AS n FROM brands').first<{ n: number }>())?.n,
    ).toBe(1);
  });

  test('nama kembar (ternormalisasi) -> 409 dengan fields.name; tidak ada baris baru', async () => {
    await send('POST', '/brands', { body: { name: 'Ubiquiti' } });
    for (const duplicate of ['ubiquiti', ' UBIQUITI ']) {
      const response = await send('POST', '/brands', { body: { name: duplicate } });
      expect(response.status).toBe(409);
      expect(await json(response)).toMatchObject({
        code: 'CONFLICT',
        fields: { name: 'Nama merk sudah dipakai' },
      });
    }
    expect(
      (await env.DB.prepare('SELECT COUNT(*) AS n FROM brands').first<{ n: number }>())?.n,
    ).toBe(1);
  });

  test('nama kosong atau tanpa huruf/angka -> 422 dengan fields.name', async () => {
    for (const name of ['', '--']) {
      const response = await send('POST', '/brands', { body: { name } });
      expect(response.status).toBe(422);
      expect(await json(response)).toMatchObject({
        code: 'VALIDATION',
        fields: { name: expect.any(String) },
      });
    }
  });

  test('id pada badan jalur buat ditolak (tidak mengubah lewat POST)', async () => {
    const id = await seedBrand(env, 'Sony');
    const response = await send('POST', '/brands', { body: { id, name: 'Lain' } });
    expect(response.status).toBe(422);
    expect(
      (
        await env.DB.prepare('SELECT name FROM brands WHERE id = ?')
          .bind(id)
          .first<{ name: string }>()
      )?.name,
    ).toBe('Sony');
  });
});

describe('PUT /brands/{id} (ganti nama)', () => {
  test('mengganti nama, menaikkan sync_rev, 200', async () => {
    const id = await seedBrand(env, 'Sony');
    const before = await env.DB.prepare('SELECT sync_rev FROM brands WHERE id = ?')
      .bind(id)
      .first<{ sync_rev: number }>();
    const response = await send('PUT', `/brands/${id}`, { body: { name: 'Sony Corp' } });
    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({ id, name: 'Sony Corp' });
    const after = await env.DB.prepare('SELECT name, `key`, sync_rev FROM brands WHERE id = ?')
      .bind(id)
      .first<{ name: string; key: string; sync_rev: number }>();
    expect(after).toMatchObject({ name: 'Sony Corp', key: 'sony corp' });
    expect(after?.sync_rev).toBeGreaterThan(before?.sync_rev ?? 0);
  });

  test('id badan berbeda dari jalur -> 422 dan tidak mengubah apa pun', async () => {
    const id = await seedBrand(env, 'Sony');
    await seedBrand(env, 'LG');
    const response = await send('PUT', `/brands/${id}`, { body: { id: 'brand-lg', name: 'X' } });
    expect(response.status).toBe(422);
    expect(
      (
        await env.DB.prepare('SELECT COUNT(*) AS n FROM brands WHERE name = ?')
          .bind('X')
          .first<{ n: number }>()
      )?.n,
    ).toBe(0);
  });

  test('nama milik merk lain -> 409; merk tidak ada -> 404', async () => {
    const id = await seedBrand(env, 'Sony');
    await seedBrand(env, 'LG');
    const clash = await send('PUT', `/brands/${id}`, { body: { name: 'lg' } });
    expect(clash.status).toBe(409);
    expect(await json(clash)).toMatchObject({ fields: { name: 'Nama merk sudah dipakai' } });
    const missing = await send('PUT', '/brands/tidak-ada', { body: { name: 'Baru' } });
    expect(missing.status).toBe(404);
    expect(await json(missing)).toMatchObject({ code: 'NOT_FOUND' });
  });

  test('tanpa header X-Requested-With -> 403 sebelum menyentuh data', async () => {
    const id = await seedBrand(env, 'Sony');
    const response = await app.request(
      `https://qc.test/api/v1/brands/${id}`,
      {
        method: 'PUT',
        headers: { cookie: await cookieFor('admin@gmail.com'), 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Peretas' }),
      },
      env,
    );
    expect(response.status).toBe(403);
    expect(await json(response)).toMatchObject({ code: 'FORBIDDEN' });
    expect(
      (
        await env.DB.prepare('SELECT name FROM brands WHERE id = ?')
          .bind(id)
          .first<{ name: string }>()
      )?.name,
    ).toBe('Sony');
  });
});

describe('PATCH /brands/{id} (status)', () => {
  test('menonaktifkan lalu mengaktifkan kembali; butuh izin item:manage', async () => {
    const id = await seedBrand(env, 'Sony');
    const off = await send('PATCH', `/brands/${id}`, { body: { status: 'inactive' } });
    expect(off.status).toBe(200);
    expect(await json(off)).toMatchObject({ id, status: 'inactive' });
    const on = await send('PATCH', `/brands/${id}`, { body: { status: 'active' } });
    expect(await json(on)).toMatchObject({ status: 'active' });
    // edit tidak cukup (manage): 403
    const forbidden = await send('PATCH', `/brands/${id}`, {
      email: 'edit@gmail.com',
      body: { status: 'inactive' },
    });
    expect(forbidden.status).toBe(403);
  });

  test('status tidak valid -> 422; toggle ganda ke status yang sama aman', async () => {
    const id = await seedBrand(env, 'Sony');
    const bad = await send('PATCH', `/brands/${id}`, { body: { status: 'x' } });
    expect(bad.status).toBe(422);
    expect(await json(bad)).toMatchObject({ fields: { status: 'Nilai tidak valid' } });
    expect((await send('PATCH', `/brands/${id}`, { body: { status: 'active' } })).status).toBe(200);
    expect((await send('PATCH', `/brands/${id}`, { body: { status: 'active' } })).status).toBe(200);
  });
});

test('merk yang dipakai item tidak dapat dihapus: tidak ada rute DELETE /brands/{id} (404 problem+json)', async () => {
  const id = await seedBrand(env, 'Sony');
  await seedItem(env, { id: 'i1', brand: 'Sony', model: 'A1' });
  const response = await send('DELETE', `/brands/${id}`);
  expect(response.status).toBe(404);
  expect(response.headers.get('content-type')).toContain('application/problem+json');
  expect(
    (
      await env.DB.prepare('SELECT COUNT(*) AS n FROM brands WHERE id = ?')
        .bind(id)
        .first<{ n: number }>()
    )?.n,
  ).toBe(1);
  const list = (await (await send('GET', '/brands')).json()) as Array<{ itemCount: number }>;
  expect(list[0]?.itemCount).toBe(1);
});
