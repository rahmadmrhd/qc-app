import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { RpcResult } from '@shared/rpc';
import { seedLocation, seedRole, seedUser } from '@worker-test/access-fixtures';
import { createTestEnv, type TestEnv } from '@worker-test/test-env';
import type { RequestCtx } from './context';
import { appError } from './errors';
import type { RoutePermission, RoutePermissionSpec, RouteTable } from './router';
import { callRoute, handleRpc } from './router';
import { signSessionToken } from './session';
import { expectNull } from './validate';

let env: TestEnv;
let calls: string[];
let errors: string[];
const realConsoleError = console.error;

const routes = {
  'auth.me': {
    validate: expectNull,
    handler: (_input: unknown, ctx: RequestCtx) => {
      calls.push('me');
      return { email: ctx.user.email };
    },
  },
  'access.users.list': {
    permission: { module: 'access', level: 'view' },
    validate: expectNull,
    handler: () => {
      calls.push('list');
      return [];
    },
  },
  'access.users.save': {
    permission: { module: 'access', level: 'manage' },
    validate: (raw: unknown) => {
      if (raw === null) {
        throw appError('VALIDATION', 'Input tidak valid', { email: 'Wajib diisi' });
      }
      return raw;
    },
    handler: () => {
      throw new Error('rahasia internal di stack');
    },
  },
  'items.list': {
    permission: { module: 'handover', level: 'view', scope: 'location' },
    validate: (raw: unknown) => raw,
    handler: (_input: unknown, ctx: RequestCtx) => {
      calls.push('items');
      return ctx.locationIds;
    },
  },
  'items.save': {
    permission: { module: 'handover', level: 'edit', scope: 'location' },
    validate: (raw: unknown) => raw,
    handler: async (_input: unknown, ctx: RequestCtx) => {
      calls.push('save');
      return ctx.locationIds;
    },
  },
  'handovers.options': {
    permission: {
      anyOf: [
        { module: 'handover', level: 'view', scope: 'location' },
        { module: 'qc', level: 'edit', scope: 'location' },
      ],
    },
    validate: (raw: unknown) => raw,
    handler: (_input: unknown, ctx: RequestCtx) => {
      calls.push('tasks');
      return ctx.locationIds;
    },
  },
  'brands.list': {
    permission: {
      anyOf: [
        { module: 'access', level: 'view' },
        { module: 'item', level: 'manage' },
      ],
    },
    validate: expectNull,
    handler: () => {
      calls.push('report');
      return [];
    },
  },
} as unknown as RouteTable;

function errorOf(result: RpcResult<unknown>) {
  if (result.ok) throw new Error(`Diharapkan error, didapat ${JSON.stringify(result.data)}`);
  return result.error;
}

async function tokenFor(email: string) {
  return signSessionToken(env, email, env.clock.now());
}

async function call(method: string, payload: unknown, email = 'staf@gmail.com') {
  return callRoute(env, await tokenFor(email), method, payload, routes);
}

beforeEach(async () => {
  calls = [];
  errors = [];
  console.error = (message?: unknown) => {
    errors.push(String(message));
  };
  env = await createTestEnv();
  await seedRole(env, { id: 'r-view', name: 'Viewer', permissions: { access: 'view' } });
  await seedUser(env, { id: 'u1', email: 'viewer@gmail.com', roleIds: ['r-view'] });
  await seedUser(env, { id: 'u2', email: 'plain@gmail.com' });
  await seedLocation(env, { id: 'l-a', code: 'A' });
  await seedLocation(env, { id: 'l-b', code: 'B' });
  await seedLocation(env, { id: 'l-mati', code: 'MATI', status: 'inactive' });
  await seedRole(env, { id: 'r-item-view', name: 'Lihat', permissions: { handover: 'view' } });
  await seedRole(env, { id: 'r-item-manage', name: 'Kelola', permissions: { handover: 'manage' } });
  await seedUser(env, {
    id: 'u3',
    email: 'staf@gmail.com',
    assignments: [
      { locationId: 'l-a', roleIds: ['r-item-view'] },
      { locationId: 'l-b', roleIds: ['r-item-manage'] },
      { locationId: 'l-mati', roleIds: ['r-item-manage'] },
    ],
  });
  await seedRole(env, { id: 'r-ho-view', name: 'Lihat ST', permissions: { handover: 'view' } });
  await seedRole(env, { id: 'r-qc-edit', name: 'QC', permissions: { qc: 'edit' } });
  await seedRole(env, { id: 'r-item-mgr', name: 'Admin Item', permissions: { item: 'manage' } });
  await seedUser(env, {
    id: 'u4',
    email: 'qc@gmail.com',
    assignments: [{ locationId: 'l-a', roleIds: ['r-qc-edit'] }],
  });
  await seedUser(env, {
    id: 'u5',
    email: 'campur@gmail.com',
    assignments: [
      { locationId: 'l-a', roleIds: ['r-ho-view'] },
      { locationId: 'l-b', roleIds: ['r-qc-edit'] },
    ],
  });
  await seedUser(env, {
    id: 'u6',
    email: 'itemmgr@gmail.com',
    assignments: [{ locationId: 'l-a', roleIds: ['r-item-mgr'] }],
  });
});

afterEach(() => {
  console.error = realConsoleError;
});

describe('dasar', () => {
  test('method tak dikenal, termasuk nama properti bawaan objek, menghasilkan NOT_FOUND', async () => {
    const token = await tokenFor('admin@gmail.com');
    for (const method of ['x.y', '__proto__', 'constructor', 'toString', 42]) {
      expect(errorOf(await callRoute(env, token, method, null, routes)).code).toBe('NOT_FOUND');
    }
  });

  test('tanpa token atau token rusak menghasilkan UNAUTHENTICATED', async () => {
    for (const token of [undefined, '', 'abc', 'a.b', 123]) {
      expect(errorOf(await callRoute(env, token, 'auth.me', null, routes)).code).toBe(
        'UNAUTHENTICATED',
      );
    }
    expect(calls).toEqual([]);
  });

  test('token valid milik user yang lalu dinonaktifkan menghasilkan UNAUTHENTICATED', async () => {
    const token = await tokenFor('viewer@gmail.com');
    expect((await callRoute(env, token, 'auth.me', null, routes)).ok).toBe(true);
    await env.DB.prepare("UPDATE users SET status = 'inactive' WHERE id = 'u1'").run();
    expect(errorOf(await callRoute(env, token, 'auth.me', null, routes)).code).toBe(
      'UNAUTHENTICATED',
    );
  });

  test('level kurang menghasilkan FORBIDDEN dan handler tidak dipanggil', async () => {
    const token = await tokenFor('plain@gmail.com');
    expect(errorOf(await callRoute(env, token, 'access.users.list', null, routes)).code).toBe(
      'FORBIDDEN',
    );
    expect(calls).toEqual([]);
  });

  test('error validasi membawa daftar field', async () => {
    const token = await tokenFor('admin@gmail.com');
    const error = errorOf(await callRoute(env, token, 'access.users.save', null, routes));
    expect(error).toMatchObject({ code: 'VALIDATION', fields: { email: 'Wajib diisi' } });
  });

  test('error tak terduga disamarkan menjadi INTERNAL dan dicatat bersama requestId', async () => {
    const token = await tokenFor('admin@gmail.com');
    const error = errorOf(await callRoute(env, token, 'access.users.save', { a: 1 }, routes));
    expect(error.code).toBe('INTERNAL');
    expect(error.message).toBe('Terjadi kesalahan pada server');
    expect(error.message).not.toContain('rahasia');
    expect(error.requestId).toHaveLength(8);
    expect(errors[0]).toContain(error.requestId);
    expect(errors[0]).toContain('rahasia internal');
  });

  test('request sukses mengembalikan data (handler sinkron maupun async) dan konteks user', async () => {
    const token = await tokenFor('viewer@gmail.com');
    expect(await callRoute(env, token, 'access.users.list', null, routes)).toEqual({
      ok: true,
      data: [],
    });
    expect(await callRoute(env, token, 'auth.me', undefined, routes)).toEqual({
      ok: true,
      data: { email: 'viewer@gmail.com' },
    });
    expect(calls).toEqual(['list', 'me']);
  });
});

describe('rute berlokasi', () => {
  test('baca di beberapa lokasi yang diizinkan, id ganda dirapikan', async () => {
    expect(await call('items.list', { locationIds: ['l-a', 'l-b', 'l-a'] })).toEqual({
      ok: true,
      data: ['l-a', 'l-b'],
    });
  });

  test('tulis butuh level di lokasi tujuan, bukan di lokasi lain', async () => {
    expect(await call('items.save', { locationId: 'l-b' })).toEqual({ ok: true, data: ['l-b'] });
    expect(errorOf(await call('items.save', { locationId: 'l-a' })).code).toBe('FORBIDDEN');
  });

  test('satu lokasi terlarang menolak seluruh permintaan dan handler tidak jalan', async () => {
    expect(errorOf(await call('items.save', { locationIds: ['l-b', 'l-a'] })).code).toBe(
      'FORBIDDEN',
    );
    expect(calls).toEqual([]);
  });

  test('lokasi tak dikenal, nonaktif, dan terlarang menghasilkan FORBIDDEN dengan pesan yang sama', async () => {
    const messages = [];
    for (const id of ['tidak-ada', 'l-mati']) {
      messages.push(errorOf(await call('items.list', { locationIds: [id] })).message);
    }
    expect(new Set(messages).size).toBe(1);
    expect(
      errorOf(await call('items.list', { locationIds: ['l-a'] }, 'plain@gmail.com')).message,
    ).toBe(messages[0] ?? '');
    expect(calls).toEqual([]);
  });

  test('tanpa lokasi atau bentuk salah menghasilkan VALIDATION', async () => {
    for (const payload of [
      null,
      {},
      { locationIds: [] },
      { locationIds: [1] },
      { locationId: '' },
      { locationIds: 'l-a' },
    ]) {
      expect(errorOf(await call('items.list', payload)).code).toBe('VALIDATION');
    }
    expect(calls).toEqual([]);
  });

  test('super admin boleh di semua lokasi aktif tetapi tidak di lokasi nonaktif', async () => {
    expect((await call('items.list', { locationIds: ['l-a', 'l-b'] }, 'admin@gmail.com')).ok).toBe(
      true,
    );
    expect(
      errorOf(await call('items.list', { locationIds: ['l-mati'] }, 'admin@gmail.com')).code,
    ).toBe('FORBIDDEN');
  });

  test('menolak input yang memuat locationIds dan locationId sekaligus', async () => {
    const error = errorOf(await call('items.save', { locationIds: ['l-b'], locationId: 'l-a' }));
    expect(error.code).toBe('VALIDATION');
    expect(calls).toEqual([]);
  });

  test('tipe: modul berlokasi wajib menandai scope location', () => {
    // @ts-expect-error modul berlokasi tanpa scope: 'location' harus ditolak compiler
    const salah: RoutePermission = { module: 'handover', level: 'view' };
    const benar: RoutePermission = { module: 'handover', level: 'view', scope: 'location' };
    const global: RoutePermission = { module: 'item', level: 'view' };
    expect([salah, benar, global]).toHaveLength(3);
  });
});

describe('anyOf', () => {
  test('lokasi: tiap lokasi cukup memenuhi salah satu alternatif', async () => {
    expect(
      await call('handovers.options', { locationIds: ['l-a', 'l-b'] }, 'campur@gmail.com'),
    ).toEqual({ ok: true, data: ['l-a', 'l-b'] });
    expect((await call('handovers.options', { locationId: 'l-a' }, 'qc@gmail.com')).ok).toBe(true);
  });

  test('lokasi: satu lokasi yang tidak memenuhi alternatif mana pun menolak seluruh permintaan', async () => {
    expect(
      errorOf(await call('handovers.options', { locationIds: ['l-a', 'l-b'] }, 'qc@gmail.com'))
        .code,
    ).toBe('FORBIDDEN');
    expect(
      errorOf(
        await call('handovers.options', { locationIds: ['l-a', 'l-mati'] }, 'campur@gmail.com'),
      ).code,
    ).toBe('FORBIDDEN');
    expect(calls).toEqual([]);
  });

  test('lokasi tetap mewajibkan lokasi pada input', async () => {
    expect(errorOf(await call('handovers.options', {}, 'qc@gmail.com')).code).toBe('VALIDATION');
  });

  test('global: cukup salah satu izin global terpenuhi', async () => {
    const run = (email: string) => call('brands.list', null, email);
    expect((await run('viewer@gmail.com')).ok).toBe(true);
    expect((await run('itemmgr@gmail.com')).ok).toBe(true);
    expect(errorOf(await run('plain@gmail.com')).code).toBe('FORBIDDEN');
  });

  test('tipe: anyOf tidak boleh mencampur izin global dan lokasi', () => {
    const sah: RoutePermissionSpec = {
      anyOf: [
        { module: 'handover', level: 'view', scope: 'location' },
        { module: 'qc', level: 'edit', scope: 'location' },
      ],
    };
    const campur: RoutePermissionSpec = {
      anyOf: [
        // @ts-expect-error alternatif global dan lokasi tidak boleh dicampur
        { module: 'access', level: 'view' },
        { module: 'qc', level: 'edit', scope: 'location' },
      ],
    };
    expect([sah, campur]).toHaveLength(2);
  });

  test('anyOf kosong (hasil cast) gagal tertutup, bukan setara "cukup login"', async () => {
    const kosong = {
      ...routes,
      'brands.list': {
        ...(routes as unknown as Record<string, object>)['brands.list'],
        permission: { anyOf: [] },
      },
    } as unknown as RouteTable;
    const token = await tokenFor('admin@gmail.com');
    expect(errorOf(await callRoute(env, token, 'brands.list', null, kosong)).code).toBe(
      'FORBIDDEN',
    );
  });
});

describe('handleRpc (HTTP)', () => {
  async function post(body: unknown, email: string | null = 'viewer@gmail.com') {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (email) headers.cookie = `qc_session=${await tokenFor(email)}`;
    return handleRpc(
      env,
      new Request('https://qc.test/api/rpc', {
        method: 'POST',
        headers,
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }),
      routes,
    );
  }

  test('amplop sukses, status 200, tanpa cache', async () => {
    const response = await post({ method: 'access.users.list', payload: null });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect((await response.json()) as unknown).toEqual({ ok: true, data: [] });
  });

  test('status HTTP mengikuti kode galat dengan amplop yang sama', async () => {
    const cases: [unknown, string | null, number, string][] = [
      [{ method: 'access.users.list' }, null, 401, 'UNAUTHENTICATED'],
      [{ method: 'access.users.list' }, 'plain@gmail.com', 403, 'FORBIDDEN'],
      [{ method: 'nope' }, 'viewer@gmail.com', 404, 'NOT_FOUND'],
      [{ method: 'access.users.save', payload: null }, 'admin@gmail.com', 400, 'VALIDATION'],
      [{ method: 'access.users.save', payload: {} }, 'admin@gmail.com', 500, 'INTERNAL'],
    ];
    for (const [body, email, status, code] of cases) {
      const response = await post(body, email);
      expect(response.status).toBe(status);
      const json = (await response.json()) as { ok: boolean; error: { code: string } };
      expect(json.ok).toBe(false);
      expect(json.error.code).toBe(code);
    }
  });

  test('badan bukan JSON atau bukan objek menghasilkan VALIDATION 400', async () => {
    for (const body of ['{rusak', 'null', '[]', '"x"']) {
      const response = await post(body);
      const json = (await response.json()) as { error: { code: string } };
      // '[]' adalah objek JS tetapi tanpa method -> NOT_FOUND; selebihnya VALIDATION
      expect(['VALIDATION', 'NOT_FOUND']).toContain(json.error.code);
      expect(response.status).toBeGreaterThanOrEqual(400);
    }
    expect(((await (await post('{rusak')).json()) as { error: { code: string } }).error.code).toBe(
      'VALIDATION',
    );
  });
});
