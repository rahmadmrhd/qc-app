import { beforeEach, describe, expect, test } from 'bun:test';
import { seedRole, seedUser } from '@server-test/access-fixtures';
import { seedBrand, seedItem } from '@server-test/item-fixtures';
import { jsonOf, restClient } from '@server-test/rest-client';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { REST_MIGRATED_IDS } from '@shared/api';

let env: TestEnv;
let rest: ReturnType<typeof restClient>;

const baseInput = {
  brand: 'Ubiquiti',
  model: 'ES 24 250W',
  isCountryLock: false,
  aliases: [] as string[],
  stickers: [],
  accessories: [],
  attachments: [],
  detail: '',
};

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-10-09T00:00:00.000Z'));
  rest = restClient(env);
  await seedRole(env, { id: 'r-view', name: 'Lihat', permissions: { item: 'view' } });
  await seedRole(env, { id: 'r-edit', name: 'Ubah', permissions: { item: 'edit' } });
  await seedRole(env, { id: 'r-manage', name: 'Kelola', permissions: { item: 'manage' } });
  await seedUser(env, { id: 'u-v', email: 'lihat@gmail.com', roleIds: ['r-view'] });
  await seedUser(env, { id: 'u-e', email: 'ubah@gmail.com', roleIds: ['r-edit'] });
  await seedUser(env, { id: 'u-m', email: 'kelola@gmail.com', roleIds: ['r-manage'] });
  await seedUser(env, { id: 'u-n', email: 'tanpa@gmail.com' });
});

test('items.* terdaftar di REST_MIGRATED_IDS', () => {
  for (const id of ['items.list', 'items.get', 'items.save', 'items.setStatus'] as const) {
    expect(REST_MIGRATED_IDS.has(id)).toBe(true);
  }
});

describe('izin rute (terjemahan tes RPC lama)', () => {
  test('view membaca, edit menyimpan, hanya manage menonaktifkan; daftar tanpa detail', async () => {
    const saved = await rest.post('/items', { email: 'ubah@gmail.com', body: baseInput });
    expect(saved.status).toBe(201);
    const id = (await jsonOf(saved)).id as string;
    expect(saved.headers.get('location')).toBe(`/api/v1/items/${id}`);
    expect((await rest.post('/items', { email: 'lihat@gmail.com', body: baseInput })).status).toBe(
      403,
    );
    expect((await rest.post('/items', { email: 'tanpa@gmail.com', body: baseInput })).status).toBe(
      403,
    );
    expect((await rest.get('/items', { email: 'lihat@gmail.com' })).status).toBe(200);
    expect((await rest.get(`/items/${id}`, { email: 'lihat@gmail.com' })).status).toBe(200);
    expect((await rest.get('/items', { email: 'tanpa@gmail.com' })).status).toBe(403);
    const tooMany = await rest.get('/items?limit=999', { email: 'lihat@gmail.com' });
    expect(tooMany.status).toBe(422);
    expect(await jsonOf(tooMany)).toMatchObject({
      code: 'VALIDATION',
      fields: { limit: expect.any(String) },
    });
    const body = { status: 'inactive' };
    expect((await rest.patch(`/items/${id}`, { email: 'ubah@gmail.com', body })).status).toBe(403);
    env.clock.advance(1000);
    expect((await rest.patch(`/items/${id}`, { email: 'kelola@gmail.com', body })).status).toBe(
      200,
    );
    const list = await rest.get('/items', { email: 'lihat@gmail.com' });
    expect(JSON.stringify(await list.json()).includes('"detail"')).toBe(false);
  });
});

describe('ETag dan If-Match (updatedAt)', () => {
  test('GET /items/{id}: ETag = updatedAt; If-None-Match sama -> 304', async () => {
    const created = await jsonOf(await rest.post('/items', { body: baseInput }));
    const id = created.id as string;
    const response = await rest.get(`/items/${id}`);
    expect(response.status).toBe(200);
    const item = await jsonOf(response);
    expect(response.headers.get('etag')).toBe(`"${item.updatedAt as string}"`);
    const cached = await rest.get(`/items/${id}`, {
      headers: { 'if-none-match': response.headers.get('etag') as string },
    });
    expect(cached.status).toBe(304);
    expect(await cached.text()).toBe('');
  });

  test('POST/PUT/PATCH memberi ETag; PUT dengan If-Match yang cocok -> 200 dan ETag baru', async () => {
    const createdResponse = await rest.post('/items', { body: baseInput });
    const created = await jsonOf(createdResponse);
    expect(createdResponse.headers.get('etag')).toBe(`"${created.updatedAt as string}"`);
    env.clock.advance(1000);
    const updated = await rest.put(`/items/${created.id as string}`, {
      headers: { 'if-match': `"${created.updatedAt as string}"` },
      body: { ...baseInput, detail: 'perubahan A' },
    });
    expect(updated.status).toBe(200);
    const after = await jsonOf(updated);
    expect(after.updatedAt).not.toBe(created.updatedAt);
    expect(updated.headers.get('etag')).toBe(`"${after.updatedAt as string}"`);
  });

  test('dua penyimpan dari versi yang sama: satu 200, satu 412 (code CONFLICT) tanpa membocorkan isi baris', async () => {
    const created = await jsonOf(await rest.post('/items', { body: baseInput }));
    const id = created.id as string;
    const ifMatch = { 'if-match': `"${created.updatedAt as string}"` };
    env.clock.advance(1000);
    const first = await rest.put(`/items/${id}`, {
      headers: ifMatch,
      body: { ...baseInput, detail: 'RAHASIA-PENULIS-PERTAMA' },
    });
    expect(first.status).toBe(200);
    env.clock.advance(1000);
    const second = await rest.put(`/items/${id}`, {
      headers: ifMatch,
      body: { ...baseInput, detail: 'penulis kedua' },
    });
    expect(second.status).toBe(412);
    expect(second.headers.get('content-type')).toContain('application/problem+json');
    const problem = await jsonOf(second);
    expect(problem).toMatchObject({ code: 'CONFLICT', status: 412 });
    expect(JSON.stringify(problem)).not.toContain('RAHASIA-PENULIS-PERTAMA');
    const stored = await jsonOf(await rest.get(`/items/${id}`));
    expect(stored.detail).toBe('RAHASIA-PENULIS-PERTAMA');
  });

  test('If-Match basi pada PUT tanpa pembanding lain tetap 412; tanpa If-Match tidak diperiksa (409 hanya untuk konflik nyata)', async () => {
    const created = await jsonOf(await rest.post('/items', { body: baseInput }));
    const id = created.id as string;
    const stale = await rest.put(`/items/${id}`, {
      headers: { 'if-match': '"2020-01-01T00:00:00.000Z"' },
      body: baseInput,
    });
    expect(stale.status).toBe(412);
    env.clock.advance(1000);
    expect((await rest.put(`/items/${id}`, { body: { ...baseInput, detail: 'x' } })).status).toBe(
      200,
    );
  });

  test('konflik nyata (merk+tipe kembar) tetap 409 walau If-Match ada', async () => {
    await rest.post('/items', { body: baseInput });
    const other = await jsonOf(
      await rest.post('/items', { body: { ...baseInput, model: 'ES 48' } }),
    );
    const clash = await rest.put(`/items/${other.id as string}`, {
      headers: { 'if-match': `"${other.updatedAt as string}"` },
      body: baseInput,
    });
    expect(clash.status).toBe(409);
    expect(await jsonOf(clash)).toMatchObject({ code: 'CONFLICT', status: 409 });
  });

  test('id badan berbeda dari id jalur -> 422; PUT item yang tidak ada -> 404', async () => {
    const created = await jsonOf(await rest.post('/items', { body: baseInput }));
    const mismatch = await rest.put(`/items/${created.id as string}`, {
      body: { ...baseInput, id: 'lain' },
    });
    expect(mismatch.status).toBe(422);
    expect((await rest.put('/items/tidak-ada', { body: baseInput })).status).toBe(404);
  });
});

describe('GET /items (kursor dan query)', () => {
  beforeEach(async () => {
    await seedBrand(env, 'Mikrotik');
    await seedBrand(env, 'Ubiquiti');
    for (let n = 1; n <= 5; n++) {
      await seedItem(env, {
        id: `i${n}`,
        brand: n % 2 ? 'Mikrotik' : 'Ubiquiti',
        model: `Model ${n}`,
      });
    }
  });

  test('kursor menelusuri semua item tepat sekali', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 10; guard++) {
      const response = await rest.get(
        `/items?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      );
      expect(response.status).toBe(200);
      const page = (await response.json()) as {
        items: Array<{ id: string }>;
        nextCursor: string | null;
      };
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    expect([...seen].sort()).toEqual(['i1', 'i2', 'i3', 'i4', 'i5']);
  });

  test('query dan status disaring server; kursor bersama query tetap konsisten', async () => {
    const found = (await (await rest.get('/items?query=mikrotik&limit=2')).json()) as {
      items: Array<{ brand: string }>;
      nextCursor: string | null;
    };
    expect(found.items).toHaveLength(2);
    expect(found.items.every((item) => item.brand === 'Mikrotik')).toBe(true);
    expect(found.nextCursor).not.toBeNull();
    const rest2 = (await (
      await rest.get(
        `/items?query=mikrotik&limit=2&cursor=${encodeURIComponent(found.nextCursor as string)}`,
      )
    ).json()) as { items: Array<{ id: string }>; nextCursor: string | null };
    expect(rest2.items).toHaveLength(1);
    expect(rest2.nextCursor).toBeNull();
    await env.DB.prepare("UPDATE items SET status = 'inactive' WHERE id = 'i1'").run();
    const inactive = (await (await rest.get('/items?status=inactive')).json()) as {
      items: Array<{ id: string }>;
    };
    expect(inactive.items.map((item) => item.id)).toEqual(['i1']);
    expect((await rest.get('/items?status=x')).status).toBe(422);
  });
});
