import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createApp } from '@server/app';
import { DbError } from '@server/core/db';
import { appError, staleError } from '@server/core/errors';
import type { RouteTable } from '@server/core/router';
import { signSessionToken } from '@server/core/session';
import { MAX_REQUEST_BODY_BYTES } from '@server/http/body';
import { listOperations } from '@server/http/rest';
import { seedLocation, seedRole, seedUser } from '@server-test/access-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { API_ROUTES } from '@shared/api';
import type { WorkerRpcMethod } from '@shared/rpc';

const IDS = Object.keys(API_ROUTES) as WorkerRpcMethod[];

let env: TestEnv;
let calls: Array<{ id: string; input: unknown }>;
const realConsoleError = console.error;
const realConsoleWarn = console.warn;
const realConsoleLog = console.log;

/** Rute tiruan: validasi dan handler sederhana yang merekam input; `overrides` mengganti id tertentu. */
function stubRoutes(overrides: Record<string, unknown> = {}): RouteTable {
  const table: Record<string, unknown> = {};
  for (const id of IDS) {
    table[id] = {
      validate: (raw: unknown) => raw,
      handler: (input: unknown) => {
        calls.push({ id, input });
        return { id: 'x1', updatedAt: 't1', echo: input };
      },
    };
  }
  return { ...table, ...overrides } as unknown as RouteTable;
}

function appWith(overrides: Record<string, unknown> = {}) {
  return createApp(stubRoutes(overrides));
}

async function sessionCookie(email = 'admin@gmail.com'): Promise<string> {
  return `qc_session=${await signSessionToken(env, email, env.clock.now())}`;
}

interface Call {
  method?: string;
  body?: unknown;
  rawBody?: string;
  headers?: Record<string, string>;
  email?: string | null;
  csrf?: boolean;
}

async function call(app: ReturnType<typeof appWith>, path: string, options: Call = {}) {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { ...options.headers };
  if (options.email !== null) headers.cookie = await sessionCookie(options.email);
  if (method !== 'GET' && options.csrf !== false) headers['x-requested-with'] = 'qc';
  const raw =
    options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
  if (raw !== undefined) headers['content-type'] = 'application/json';
  return app.request(`https://qc.test/api/v1${path}`, { method, headers, body: raw }, env);
}

async function problem(response: Response) {
  expect(response.headers.get('content-type')).toContain('application/problem+json');
  return (await response.json()) as Record<string, unknown>;
}

beforeEach(async () => {
  calls = [];
  env = await createTestEnv();
  console.error = () => undefined;
  console.warn = () => undefined;
  console.log = () => undefined;
});

afterEach(() => {
  console.error = realConsoleError;
  console.warn = realConsoleWarn;
  console.log = realConsoleLog;
});

describe('pemetaan galat (RFC 9457)', () => {
  test('CONFLICT biasa -> 409 dengan code CONFLICT dan fields', async () => {
    const app = appWith({
      'brands.save': {
        validate: (raw: unknown) => raw,
        handler: () => {
          throw appError('CONFLICT', 'Nama merk sudah dipakai', {
            name: 'Nama merk sudah dipakai',
          });
        },
      },
    });
    const response = await call(app, '/brands', { method: 'POST', body: { name: 'X' } });
    expect(response.status).toBe(409);
    const body = await problem(response);
    expect(body).toMatchObject({
      type: 'urn:qc:problem:conflict',
      status: 409,
      code: 'CONFLICT',
      detail: 'Nama merk sudah dipakai',
      fields: { name: 'Nama merk sudah dipakai' },
    });
    expect(typeof body.requestId).toBe('string');
  });

  const staleRoutes = {
    'items.save': {
      validate: (raw: unknown) => raw,
      handler: () => {
        throw staleError('Item sudah diubah orang lain');
      },
    },
    'brands.save': {
      validate: (raw: unknown) => raw,
      handler: () => {
        throw staleError('Merk diubah orang lain');
      },
    },
  };

  test('basi + rute berETag + If-Match -> 412, code tetap CONFLICT', async () => {
    const response = await call(appWith(staleRoutes), '/items/i1', {
      method: 'PUT',
      body: { brand: 'X' },
      headers: { 'if-match': '"t0"' },
    });
    expect(response.status).toBe(412);
    expect(await problem(response)).toMatchObject({ status: 412, code: 'CONFLICT' });
  });

  test('basi tanpa If-Match -> 409', async () => {
    const response = await call(appWith(staleRoutes), '/items/i1', {
      method: 'PUT',
      body: { brand: 'X' },
    });
    expect(response.status).toBe(409);
    expect(await problem(response)).toMatchObject({ status: 409, code: 'CONFLICT' });
  });

  test('basi pada rute tanpa ifMatch walau ada If-Match -> 409', async () => {
    const response = await call(appWith(staleRoutes), '/brands/b1', {
      method: 'PUT',
      body: { name: 'X' },
      headers: { 'if-match': '"t0"' },
    });
    expect(response.status).toBe(409);
  });

  test('If-Match "*" atau banyak nilai diabaikan sehingga basi tetap 409', async () => {
    for (const header of ['*', '"a", "b"']) {
      const response = await call(appWith(staleRoutes), '/items/i1', {
        method: 'PUT',
        body: { brand: 'X' },
        headers: { 'if-match': header },
      });
      expect(response.status).toBe(409);
    }
  });

  test('VALIDATION -> 422 dengan fields', async () => {
    const app = appWith({
      'brands.save': {
        validate: () => {
          throw appError('VALIDATION', 'Input tidak valid', { name: 'Wajib diisi' });
        },
        handler: () => null,
      },
    });
    const response = await call(app, '/brands', { method: 'POST', body: {} });
    expect(response.status).toBe(422);
    expect(await problem(response)).toMatchObject({
      code: 'VALIDATION',
      fields: { name: 'Wajib diisi' },
    });
  });

  test('galat parameter (angka bukan angka) -> 422 dengan field itu', async () => {
    const response = await call(appWith(), '/audit-logs?limit=abc');
    expect(response.status).toBe(422);
    expect(await problem(response)).toMatchObject({
      code: 'VALIDATION',
      fields: { limit: 'Harus berupa angka' },
    });
    expect(calls).toEqual([]);
  });

  test('id badan berbeda dari id jalur -> 422', async () => {
    const response = await call(appWith(), '/brands/b1', {
      method: 'PUT',
      body: { id: 'b2', name: 'X' },
    });
    expect(response.status).toBe(422);
    expect(await problem(response)).toMatchObject({
      code: 'VALIDATION',
      fields: { id: expect.any(String) },
    });
    expect(calls).toEqual([]);
  });

  test('badan bukan JSON -> 400, badan terlalu besar -> 413 (problem+json)', async () => {
    const app = appWith();
    const bad = await call(app, '/brands', { method: 'POST', rawBody: '{bukan json' });
    expect(bad.status).toBe(400);
    expect(await problem(bad)).toMatchObject({ code: 'VALIDATION', status: 400 });
    const huge = await call(app, '/brands', {
      method: 'POST',
      rawBody: `{"name":"${'a'.repeat(MAX_REQUEST_BODY_BYTES + 10)}"}`,
    });
    expect(huge.status).toBe(413);
    expect(await problem(huge)).toMatchObject({ code: 'VALIDATION', status: 413 });
    expect(calls).toEqual([]);
  });

  test('badan JSON berupa array -> 422 (bukan objek)', async () => {
    const response = await call(appWith(), '/brands/b1', { method: 'PUT', body: [1] });
    expect(response.status).toBe(422);
    expect(await problem(response)).toMatchObject({ fields: { body: expect.any(String) } });
  });

  test('metode tulis tanpa X-Requested-With: qc -> 403 problem+json; GET tidak butuh', async () => {
    const app = appWith();
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const response = await call(app, '/brands/b1', { method, body: {}, csrf: false });
      expect(response.status).toBe(403);
      expect(await problem(response)).toMatchObject({ code: 'FORBIDDEN' });
    }
    expect((await call(app, '/brands')).status).toBe(200);
    expect(calls).toHaveLength(1);
  });

  test('rute /api/v1 tak dikenal -> 404 problem+json, bukan HTML SPA', async () => {
    const app = appWith();
    for (const [method, path] of [
      ['GET', '/tidak-ada'],
      ['POST', '/tidak-ada/x'],
      ['GET', '/brands/b1/anak/lagi'],
      ['GET', ''],
    ] as const) {
      const response = await call(app, path, { method, body: method === 'POST' ? {} : undefined });
      expect(response.status).toBe(404);
      expect(await problem(response)).toMatchObject({ code: 'NOT_FOUND' });
    }
  });

  test('tanpa sesi -> 401 problem+json; tanpa izin -> 403; handler tak dipanggil', async () => {
    const app = appWith({
      'brands.list': {
        permission: { module: 'item', level: 'view' },
        validate: (raw: unknown) => raw,
        handler: () => {
          calls.push({ id: 'brands.list', input: null });
          return [];
        },
      },
    });
    const noSession = await call(app, '/brands', { email: null });
    expect(noSession.status).toBe(401);
    expect(await problem(noSession)).toMatchObject({ code: 'UNAUTHENTICATED' });
    await seedUser(env, { id: 'u-plain', email: 'plain@gmail.com' });
    const forbidden = await call(app, '/brands', { email: 'plain@gmail.com' });
    expect(forbidden.status).toBe(403);
    expect(await problem(forbidden)).toMatchObject({ code: 'FORBIDDEN' });
    expect(calls).toEqual([]);
  });

  test('INTERNAL menyamarkan pesan, menyertakan requestId, dan mencatat detail di log', async () => {
    const logged: string[] = [];
    console.error = (message?: unknown) => void logged.push(String(message));
    const app = appWith({
      'brands.list': {
        validate: (raw: unknown) => raw,
        handler: () => {
          throw new Error('rahasia internal: SELECT * FROM users');
        },
      },
    });
    const response = await call(app, '/brands');
    expect(response.status).toBe(500);
    const body = await problem(response);
    expect(body).toMatchObject({ code: 'INTERNAL', status: 500 });
    expect(JSON.stringify(body)).not.toContain('rahasia');
    expect(logged.join('\n')).toContain(String(body.requestId));
    expect(logged.join('\n')).toContain('rahasia internal');
  });

  test('tiap permintaan REST menulis satu log terstruktur (tanpa email atau payload)', async () => {
    const lines: unknown[] = [];
    console.log = (value?: unknown) => void lines.push(value);
    console.warn = (value?: unknown) => void lines.push(value);
    await seedUser(env, { id: 'u-plain', email: 'plain@gmail.com' });
    const app = appWith({
      'brands.save': {
        validate: (raw: unknown) => raw,
        handler: () => {
          throw appError('FORBIDDEN', 'Tidak boleh');
        },
      },
    });
    await call(app, '/brands', {
      method: 'POST',
      body: { rahasia: 'jangan-dicatat' },
      email: 'plain@gmail.com',
    });
    await call(app, '/brands', { email: null });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      evt: 'rest',
      method: 'brands.save',
      ok: false,
      code: 'FORBIDDEN',
    });
    expect(lines[1]).toMatchObject({ evt: 'rest', ok: false, code: 'UNAUTHENTICATED' });
    const text = JSON.stringify(lines);
    expect(text).not.toContain('jangan-dicatat');
    expect(text).not.toContain('@gmail.com');
    expect(lines[0]).toHaveProperty('requestId');
    expect(lines[0]).toHaveProperty('ms');
  });

  test('basis data tak terjangkau -> 503 UNAVAILABLE', async () => {
    const app = appWith({
      'brands.list': {
        validate: (raw: unknown) => raw,
        handler: () => {
          throw new DbError('koneksi putus', { errno: 2002, kind: 'unavailable' });
        },
      },
    });
    const response = await call(app, '/brands');
    expect(response.status).toBe(503);
    expect(await problem(response)).toMatchObject({ code: 'UNAVAILABLE' });
  });
});

describe('perakitan permintaan dan respons', () => {
  test('GET tunggal memberi ETag; If-None-Match sama -> 304 tanpa badan; berbeda -> 200', async () => {
    const app = appWith();
    const first = await call(app, '/items/i1');
    expect(first.status).toBe(200);
    expect(first.headers.get('etag')).toBe('"t1"');
    const same = await call(app, '/items/i1', { headers: { 'if-none-match': '"t1"' } });
    expect(same.status).toBe(304);
    expect(await same.text()).toBe('');
    expect(same.headers.get('etag')).toBe('"t1"');
    const other = await call(app, '/items/i1', { headers: { 'if-none-match': '"zzz"' } });
    expect(other.status).toBe(200);
    // handler tetap jalan pada 304 (hemat badan, bukan hemat CPU)
    expect(calls).toHaveLength(3);
  });

  test('If-Match dibaca ke field expectedUpdatedAt tanpa kutip; jalur dan badan menjadi input datar', async () => {
    const response = await call(appWith(), '/items/i1', {
      method: 'PUT',
      body: { brand: 'Sony', model: 'X' },
      headers: { 'if-match': '"2026-10-09T00:00:00.000Z"' },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('etag')).toBe('"t1"');
    expect(calls[0]?.input).toEqual({
      id: 'i1',
      brand: 'Sony',
      model: 'X',
      expectedUpdatedAt: '2026-10-09T00:00:00.000Z',
    });
  });

  test('create (POST) -> 201 + Location dari id keluaran, tanpa id pada input', async () => {
    const response = await call(appWith(), '/brands', { method: 'POST', body: { name: 'Sony' } });
    expect(response.status).toBe(201);
    expect(response.headers.get('location')).toBe('/api/v1/brands/x1');
    expect(calls[0]?.input).toEqual({ name: 'Sony' });
  });

  test('POST create dengan id pada badan ditolak (tidak boleh mengubah lewat jalur buat)', async () => {
    const response = await call(appWith(), '/brands', {
      method: 'POST',
      body: { id: 'b1', name: 'Sony' },
    });
    expect(response.status).toBe(422);
    expect(calls).toEqual([]);
  });

  test('status per rute: 202 untuk eksport, 201 untuk batch, 200 untuk PUT dan PATCH', async () => {
    const app = appWith();
    expect((await call(app, '/exports/sheets', { method: 'POST', body: {} })).status).toBe(202);
    expect(
      (
        await call(app, '/handovers/batch', {
          method: 'POST',
          body: { locationId: 'l1', tasks: [] },
        })
      ).status,
    ).toBe(201);
    expect((await call(app, '/brands/b1', { method: 'PUT', body: { name: 'X' } })).status).toBe(
      200,
    );
    expect(
      (await call(app, '/brands/b1', { method: 'PATCH', body: { status: 'inactive' } })).status,
    ).toBe(200);
  });

  test('DELETE memberi 200 dengan isi keluaran handler', async () => {
    const app = appWith({
      'access.roles.delete': {
        validate: (raw: unknown) => raw,
        handler: (input: { id: string }) => ({ id: input.id }),
      },
    });
    const response = await call(app, '/roles/r1', { method: 'DELETE' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: 'r1' });
  });

  test('query list dan angka diparse ke input datar (board)', async () => {
    await call(appWith(), '/handovers?locationIds=l1,l2&status=done&limit=3');
    expect(calls[0]).toEqual({
      id: 'handovers.board',
      input: { locationIds: ['l1', 'l2'], status: 'done', limit: 3 },
    });
  });

  test('rute statis tidak tertelan rute berparameter: /handovers/options dan /handovers/batch', async () => {
    const app = appWith();
    await call(app, '/handovers/options?locationIds=l1');
    await call(app, '/handovers/batch', { method: 'POST', body: { locationId: 'l1', tasks: [] } });
    await call(app, '/handovers/h1?locationIds=l1');
    expect(calls.map((entry) => entry.id)).toEqual([
      'handovers.options',
      'handovers.saveBatch',
      'handovers.get',
    ]);
  });

  test('parameter jalur di-decode sebelum masuk input', async () => {
    await call(appWith(), '/brands/a%2Fb%20c', { method: 'PATCH', body: { status: 'active' } });
    expect(calls[0]?.input).toMatchObject({ id: 'a/b c' });
  });

  test('id biner (badan mentah, multipart, unduhan) didaftarkan oleh kernel seperti id lain', () => {
    const registered = listOperations().map((operation) => operation.id);
    for (const id of [
      'files.upload',
      'files.get',
      'qrcodes.uploadPdf',
      'qrcodes.export',
      'qrcodes.file',
    ] as const) {
      expect(registered).toContain(id);
    }
  });

  test('SEMUA id tabel terdaftar tanpa himpunan migrasi (jalur ubah dan create)', () => {
    const registered = listOperations();
    const creates = IDS.filter((id) => API_ROUTES[id].create).length;
    expect(registered).toHaveLength(IDS.length + creates);
    for (const id of IDS) expect(registered.map((operation) => operation.id)).toContain(id);
  });

  test('/api/rpc sudah dihapus: 404 (tidak ada rute RPC)', async () => {
    const response = await appWith().request(
      'https://qc.test/api/rpc',
      {
        method: 'POST',
        headers: { cookie: await sessionCookie(), 'x-requested-with': 'qc' },
        body: JSON.stringify({ method: 'brands.list', payload: null }),
      },
      env,
    );
    expect(response.status).toBe(404);
  });
});

describe('OpenAPI', () => {
  test('tanpa sesi -> 401 problem+json', async () => {
    const response = await appWith().request('https://qc.test/api/openapi.json', {}, env);
    expect(response.status).toBe(401);
    expect(await problem(response)).toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  test('dengan sesi memuat SEMUA jalur tabel, operationId = id, tanpa cache', async () => {
    const response = await appWith().request(
      'https://qc.test/api/openapi.json',
      { headers: { cookie: await sessionCookie() } },
      env,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const doc = (await response.json()) as {
      openapi: string;
      paths: Record<
        string,
        Record<string, { operationId: string; parameters: Array<{ name: string; in: string }> }>
      >;
    };
    expect(doc.openapi).toBe('3.1.0');
    const operations = Object.values(doc.paths).flatMap((item) => Object.values(item));
    const creates = IDS.filter((id) => API_ROUTES[id].create).length;
    expect(operations).toHaveLength(IDS.length + creates);
    const ids = new Set(operations.map((operation) => operation.operationId));
    for (const id of IDS) expect(ids.has(id)).toBe(true);
    for (const id of IDS) {
      const def = API_ROUTES[id];
      expect(doc.paths[def.path]?.[def.verb.toLowerCase()]?.operationId).toBe(id);
    }
    const save = doc.paths['/items/{id}']?.put;
    expect(save?.parameters.some((p) => p.name === 'If-Match' && p.in === 'header')).toBe(true);
    expect(doc.paths['/audit-logs']?.get?.parameters.map((p) => p.name)).toEqual([
      'cursor',
      'limit',
      'action',
      'query',
    ]);
  });
});

describe('kerangka: izin lokasi dan sesi lewat runRoute', () => {
  test('rute berlokasi memakai locationIds dari query dan menolak lokasi tanpa akses', async () => {
    await seedLocation(env, { id: 'l-a', code: 'A' });
    await seedLocation(env, { id: 'l-b', code: 'B' });
    await seedRole(env, { id: 'r-v', name: 'V', permissions: { handover: 'view' } });
    await seedUser(env, {
      id: 'u-loc',
      email: 'loc@gmail.com',
      assignments: [{ locationId: 'l-a', roleIds: ['r-v'] }],
    });
    const app = appWith({
      'handovers.options': {
        permission: { module: 'handover', level: 'view', scope: 'location' },
        validate: (raw: unknown) => raw,
        handler: (_input: unknown, ctx: { locationIds: string[] }) => ({ ids: ctx.locationIds }),
      },
    });
    const ok = await call(app, '/handovers/options?locationIds=l-a', { email: 'loc@gmail.com' });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ids: ['l-a'] });
    const denied = await call(app, '/handovers/options?locationIds=l-a,l-b', {
      email: 'loc@gmail.com',
    });
    expect(denied.status).toBe(403);
  });
});
