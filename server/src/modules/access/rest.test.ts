import { beforeEach, describe, expect, test } from 'bun:test';
import { writeAuditRows } from '@server/core/audit';
import { seedLocation, seedRole, seedUser } from '@server-test/access-fixtures';
import { jsonOf, restClient } from '@server-test/rest-client';
import { createTestEnv, type TestEnv } from '@server-test/test-env';

// Kontrak REST `access.*` (users, roles, locations, audit berkursor).

let env: TestEnv;
let rest: ReturnType<typeof restClient>;

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-10-09T00:00:00.000Z'));
  rest = restClient(env);
  await seedRole(env, { id: 'r-view', name: 'Lihat Akses', permissions: { access: 'view' } });
  await seedUser(env, { id: 'u-v', email: 'viewer@gmail.com', roleIds: ['r-view'] });
  await seedUser(env, { id: 'u-plain', email: 'plain@gmail.com' });
});

describe('izin rute access (terjemahan tes lama)', () => {
  test('view boleh membaca, hanya manage boleh menulis; audit berkursor; limit di luar batas ditolak', async () => {
    const read = await rest.get('/users', { email: 'viewer@gmail.com' });
    expect(read.status).toBe(200);
    const write = await rest.post('/locations', {
      email: 'viewer@gmail.com',
      body: { code: 'ZZ', name: 'Zed' },
    });
    expect(write.status).toBe(403);
    expect(await jsonOf(write)).toMatchObject({ code: 'FORBIDDEN' });
    const audit = await rest.get('/audit-logs?limit=2', { email: 'viewer@gmail.com' });
    expect(audit.status).toBe(200);
    expect(await jsonOf(audit)).toHaveProperty('nextCursor');
    const bad = await rest.get('/audit-logs?limit=500', { email: 'viewer@gmail.com' });
    expect(bad.status).toBe(422);
    expect(await jsonOf(bad)).toMatchObject({
      code: 'VALIDATION',
      fields: { limit: expect.any(String) },
    });
  });

  test('tanpa izin access sama sekali: semua rute 403; tanpa sesi 401', async () => {
    for (const path of ['/users', '/roles', '/locations', '/audit-logs']) {
      expect((await rest.get(path, { email: 'plain@gmail.com' })).status).toBe(403);
      expect((await rest.get(path, { email: null })).status).toBe(401);
    }
  });
});

describe('users', () => {
  test('POST buat 201 + Location, PUT ubah 200 (email tetap), PATCH status', async () => {
    const created = await rest.post('/users', {
      body: { email: 'baru@gmail.com', name: 'Baru', status: 'active', assignments: [] },
    });
    expect(created.status).toBe(201);
    const user = await jsonOf(created);
    expect(created.headers.get('location')).toBe(`/api/v1/users/${user.id as string}`);
    const updated = await rest.put(`/users/${user.id as string}`, {
      body: { email: 'baru@gmail.com', name: 'Baru 2', status: 'active', assignments: [] },
    });
    expect(updated.status).toBe(200);
    expect(await jsonOf(updated)).toMatchObject({ name: 'Baru 2' });
    const off = await rest.patch(`/users/${user.id as string}`, { body: { status: 'inactive' } });
    expect(await jsonOf(off)).toMatchObject({ status: 'inactive' });
  });

  test('email kembar 409; email diganti 422; status ganda aman; tidak bisa menonaktifkan diri sendiri', async () => {
    const dup = await rest.post('/users', {
      body: { email: 'plain@gmail.com', name: 'X', status: 'active', assignments: [] },
    });
    expect(dup.status).toBe(409);
    expect(await jsonOf(dup)).toMatchObject({ fields: { email: 'Email sudah terdaftar' } });
    const swap = await rest.put('/users/u-plain', {
      body: { email: 'lain@gmail.com', name: 'X', status: 'active', assignments: [] },
    });
    expect(swap.status).toBe(422);
    expect((await rest.patch('/users/u-plain', { body: { status: 'inactive' } })).status).toBe(200);
    expect((await rest.patch('/users/u-plain', { body: { status: 'inactive' } })).status).toBe(200);
    const self = await rest.patch('/users/u-v', {
      email: 'viewer@gmail.com',
      body: { status: 'inactive' },
    });
    expect([403, 409]).toContain(self.status);
    expect((await rest.patch('/users/tidak-ada', { body: { status: 'active' } })).status).toBe(404);
  });
});

describe('roles', () => {
  test('POST 201, PUT 200, DELETE 200 { id }; nama kembar 409', async () => {
    const created = await rest.post('/roles', {
      body: { name: 'Baru', description: '', permissions: { item: 'view' } },
    });
    expect(created.status).toBe(201);
    const role = await jsonOf(created);
    expect(created.headers.get('location')).toBe(`/api/v1/roles/${role.id as string}`);
    const dup = await rest.post('/roles', {
      body: { name: 'baru', description: '', permissions: {} },
    });
    expect(dup.status).toBe(409);
    const edited = await rest.put(`/roles/${role.id as string}`, {
      body: { name: 'Baru', description: 'ubah', permissions: { item: 'edit' } },
    });
    expect(await jsonOf(edited)).toMatchObject({ description: 'ubah' });
    const removed = await rest.del(`/roles/${role.id as string}`);
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ id: role.id as string });
  });

  test('DELETE role yang dipakai user -> 409 dan role tetap ada', async () => {
    const response = await rest.del('/roles/r-view');
    expect(response.status).toBe(409);
    expect(await jsonOf(response)).toMatchObject({
      code: 'CONFLICT',
      detail: 'Role masih dipakai oleh 1 user',
    });
    const list = (await (await rest.get('/roles')).json()) as Array<{ id: string }>;
    expect(list.some((role) => role.id === 'r-view')).toBe(true);
    expect((await rest.del('/roles/tidak-ada')).status).toBe(404);
  });
});

describe('locations', () => {
  test('POST 201, PUT 200 (kode tetap), PATCH status ganda aman, kode kembar 409', async () => {
    const created = await rest.post('/locations', { body: { code: 'ZZ', name: 'Zed' } });
    expect(created.status).toBe(201);
    const location = await jsonOf(created);
    expect(created.headers.get('location')).toBe(`/api/v1/locations/${location.id as string}`);
    expect((await rest.post('/locations', { body: { code: 'ZZ', name: 'Lain' } })).status).toBe(
      409,
    );
    const renamed = await rest.put(`/locations/${location.id as string}`, {
      body: { code: 'ZZ', name: 'Zed 2' },
    });
    expect(await jsonOf(renamed)).toMatchObject({ name: 'Zed 2' });
    for (let i = 0; i < 2; i++) {
      const off = await rest.patch(`/locations/${location.id as string}`, {
        body: { status: 'inactive' },
      });
      expect(off.status).toBe(200);
      expect(await jsonOf(off)).toMatchObject({ status: 'inactive' });
    }
    await seedLocation(env, { id: 'l-x', code: 'XX' });
    const list = (await (await rest.get('/locations')).json()) as Array<{ code: string }>;
    expect(list.map((entry) => entry.code)).toEqual(expect.arrayContaining(['XX', 'ZZ']));
  });
});

describe('GET /audit-logs (kursor)', () => {
  const stamp = (n: number) => new Date(Date.UTC(2026, 9, 1, 0, 0, n)).toISOString();
  const addRows = async (rows: Array<{ ts: string; target: string }>) => {
    await env.DB.batch(
      writeAuditRows(
        env.DB,
        rows.map((row) => ({
          ts: row.ts,
          actor: 'admin@gmail.com',
          action: 'user.update',
          target: row.target,
          before: null,
          after: null,
        })),
      ),
    );
  };
  const page = async (query: string) => {
    const response = await rest.get(`/audit-logs?${query}`);
    expect(response.status).toBe(200);
    return (await response.json()) as {
      entries: Array<{ target: string }>;
      nextCursor: string | null;
    };
  };

  test('kursor tidak melewatkan atau menggandakan entri saat entri baru masuk di tengah penelusuran', async () => {
    await addRows([1, 2, 3, 4, 5, 6].map((n) => ({ ts: stamp(n), target: `t${n}` })));
    const first = await page('limit=2');
    expect(first.entries.map((entry) => entry.target)).toEqual(['t6', 't5']);
    expect(first.nextCursor).not.toBeNull();
    // dua entri BARU (lebih baru) ditulis di tengah penelusuran
    await addRows([7, 8].map((n) => ({ ts: stamp(n), target: `t${n}` })));
    const second = await page(`limit=2&cursor=${encodeURIComponent(first.nextCursor as string)}`);
    expect(second.entries.map((entry) => entry.target)).toEqual(['t4', 't3']);
    const third = await page(`limit=2&cursor=${encodeURIComponent(second.nextCursor as string)}`);
    expect(third.entries.map((entry) => entry.target)).toEqual(['t2', 't1']);
    expect(third.nextCursor).toBeNull();
  });

  test('entri dengan ts sama dilewati tepat sekali (pengurutan id menjadi pemisah)', async () => {
    await addRows([1, 2, 3, 4, 5].map((n) => ({ ts: stamp(1), target: `s${n}` })));
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 10; guard++) {
      const result: Awaited<ReturnType<typeof page>> = await page(
        `limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      );
      seen.push(...result.entries.map((entry) => entry.target));
      cursor = result.nextCursor;
      if (!cursor) break;
    }
    expect([...seen].sort()).toEqual(['s1', 's2', 's3', 's4', 's5']);
    expect(new Set(seen).size).toBe(5);
  });

  test('filter action/query lewat query string; kursor rusak 422', async () => {
    await addRows([
      { ts: stamp(1), target: 'cari-ini' },
      { ts: stamp(2), target: 'lain' },
    ]);
    const found = await page('query=cari');
    expect(found.entries.map((entry) => entry.target)).toEqual(['cari-ini']);
    const none = await page('action=role.delete');
    expect(none.entries).toEqual([]);
    const bad = await rest.get('/audit-logs?cursor=bukan-kursor');
    expect(bad.status).toBe(422);
    expect(await jsonOf(bad)).toMatchObject({ fields: { cursor: 'Kursor tidak valid' } });
  });
});
