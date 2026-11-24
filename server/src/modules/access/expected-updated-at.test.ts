import { beforeEach, describe, expect, test } from 'bun:test';
import { jsonOf, restClient } from '@server-test/rest-client';
import { createTestEnv, type TestEnv } from '@server-test/test-env';

// `expectedUpdatedAt` opsional pada simpan Pengguna, Role, Lokasi, dan Business Unit (keputusan pemilik 2026-11-24):
// dikirim lewat `If-Match` (klien web) atau tak dikirim sama sekali (klien lama). Dua admin yang membuka versi yang sama
// tak boleh saling menimpa.

let env: TestEnv;
let rest: ReturnType<typeof restClient>;
let tick = 0;

beforeEach(async () => {
  env = await createTestEnv();
  tick = 0;
  env.clock.set(Date.parse('2026-11-24T00:00:00.000Z'));
  rest = restClient(env);
});

/** Memajukan jam supaya tiap penulisan menghasilkan `updatedAt` baru. */
const advance = () => env.clock.set(Date.parse('2026-11-24T00:00:00.000Z') + ++tick * 1000);

interface Model {
  label: string;
  path: string;
  create: Record<string, unknown>;
  /** Badan PUT untuk mengganti nama menjadi `name`. */
  update: (name: string, created: Record<string, unknown>) => Record<string, unknown>;
  nameOf: (record: Record<string, unknown>) => unknown;
}

const MODELS: Model[] = [
  {
    label: 'users',
    path: '/users',
    create: {
      email: 'baru@gmail.com',
      name: 'Awal',
      status: 'active',
      assignments: [],
      buAssignments: [],
    },
    update: (name, created) => ({
      email: created.email,
      name,
      status: 'active',
      assignments: [],
      buAssignments: [],
    }),
    nameOf: (record) => record.name,
  },
  {
    label: 'roles',
    path: '/roles',
    create: { name: 'Awal', description: '', permissions: {} },
    update: (name) => ({ name, description: '', permissions: {} }),
    nameOf: (record) => record.name,
  },
  {
    label: 'locations',
    path: '/locations',
    create: { code: 'LK1', name: 'Awal' },
    update: (name, created) => ({ code: created.code, name }),
    nameOf: (record) => record.name,
  },
  {
    label: 'business-units',
    path: '/business-units',
    create: { code: 'BU1', name: 'Awal' },
    update: (name, created) => ({ code: created.code, name }),
    nameOf: (record) => record.name,
  },
];

const ifMatch = (updatedAt: unknown) => ({ 'if-match': `"${String(updatedAt)}"` });

describe.each(MODELS)('expectedUpdatedAt: $label', (model) => {
  async function createRecord(): Promise<Record<string, unknown>> {
    const created = await rest.post(model.path, { body: model.create });
    expect(created.status).toBe(201);
    // Respons membawa ETag = updatedAt sehingga klien dapat memakainya sebagai versi.
    const record = await jsonOf(created);
    expect(created.headers.get('etag')).toBe(`"${String(record.updatedAt)}"`);
    return record;
  }

  test('tanpa If-Match: perilaku lama (klien lama tetap jalan)', async () => {
    const record = await createRecord();
    advance();
    const res = await rest.put(`${model.path}/${record.id as string}`, {
      body: model.update('Tanpa versi', record),
    });
    expect(res.status).toBe(200);
    expect(model.nameOf(await jsonOf(res))).toBe('Tanpa versi');
  });

  test('If-Match sama dengan versi tersimpan: berhasil dan versi baru dikembalikan', async () => {
    const record = await createRecord();
    advance();
    const res = await rest.put(`${model.path}/${record.id as string}`, {
      body: model.update('Cocok', record),
      headers: ifMatch(record.updatedAt),
    });
    expect(res.status).toBe(200);
    const saved = await jsonOf(res);
    expect(model.nameOf(saved)).toBe('Cocok');
    expect(saved.updatedAt).not.toBe(record.updatedAt);
  });

  test('If-Match basi: 412 (code CONFLICT), tak ada yang tertulis', async () => {
    const record = await createRecord();
    advance();
    expect(
      (
        await rest.put(`${model.path}/${record.id as string}`, {
          body: model.update('Admin A', record),
        })
      ).status,
    ).toBe(200);
    advance();
    const stale = await rest.put(`${model.path}/${record.id as string}`, {
      body: model.update('Admin B', record),
      headers: ifMatch(record.updatedAt),
    });
    expect(stale.status).toBe(412);
    expect(await jsonOf(stale)).toMatchObject({ code: 'CONFLICT' });
    const now = await jsonOf(await rest.get(`${model.path}/${record.id as string}`));
    expect(model.nameOf(now)).toBe('Admin A');
  });

  test('dua admin serentak dari versi yang sama: satu 200, satu 412, tak saling menimpa', async () => {
    const record = await createRecord();
    advance();
    const [a, b] = await Promise.all([
      rest.put(`${model.path}/${record.id as string}`, {
        body: model.update('Admin A', record),
        headers: ifMatch(record.updatedAt),
      }),
      rest.put(`${model.path}/${record.id as string}`, {
        body: model.update('Admin B', record),
        headers: ifMatch(record.updatedAt),
      }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 412]);
    const winner = a.status === 200 ? 'Admin A' : 'Admin B';
    const now = await jsonOf(await rest.get(`${model.path}/${record.id as string}`));
    expect(model.nameOf(now)).toBe(winner);
  });

  test('membuat (tanpa id) mengabaikan If-Match', async () => {
    const res = await rest.post(model.path, {
      body: model.create,
      headers: ifMatch('2020-01-01T00:00:00.000Z'),
    });
    expect(res.status).toBe(201);
  });
});
