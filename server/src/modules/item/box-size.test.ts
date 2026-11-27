import { beforeEach, describe, expect, test } from 'bun:test';
import { seedBusinessUnit } from '@server-test/access-fixtures';
import { brandIdOf, DEFAULT_TEST_BU_ID, seedBrand } from '@server-test/item-fixtures';
import { jsonOf, restClient } from '@server-test/rest-client';
import { createTestEnv, type TestEnv } from '@server-test/test-env';

// Pcs per kardus (Stok Ready Gudang): `boxSize` 0..1000, bilangan bulat; tidak dikirim = tak diubah.

let env: TestEnv;
let rest: ReturnType<typeof restClient>;

const base = {
  brandId: brandIdOf('Ubiquiti'),
  businessUnitIds: [DEFAULT_TEST_BU_ID],
  model: 'AF-5XHD',
  isCountryLock: false,
  aliases: [] as string[],
  stickerPhotos: [],
  accessories: [],
  attachments: [],
  detail: '',
};

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-27T00:00:00.000Z'));
  rest = restClient(env);
  await seedBusinessUnit(env, { id: DEFAULT_TEST_BU_ID, code: 'DEF', name: 'BU Bawaan Tes' });
  await seedBrand(env, 'Ubiquiti');
});

async function create(body: Record<string, unknown>) {
  const response = await rest.post('/items', { body });
  return { response, json: await jsonOf(response) };
}

async function update(created: Record<string, unknown>, body: Record<string, unknown>) {
  env.clock.advance(1000);
  const response = await rest.put(`/items/${created.id as string}`, {
    headers: { 'if-match': `"${created.updatedAt as string}"` },
    body,
  });
  return { response, json: await jsonOf(response) };
}

describe('item pcs per kardus', () => {
  test('simpan boxSize 12 lalu items.get mengembalikannya', async () => {
    const created = await create({ ...base, boxSize: 12 });
    expect(created.response.status).toBe(201);
    expect(created.json.boxSize).toBe(12);
    const got = await jsonOf(await rest.get(`/items/${created.json.id as string}`));
    expect(got.boxSize).toBe(12);
  });

  test('item baru tanpa field = 0', async () => {
    const created = await create(base);
    expect(created.json.boxSize).toBe(0);
  });

  test.each([-1, 1001, 1.5])('boxSize %p ditolak VALIDATION', async (boxSize) => {
    const created = await create({ ...base, boxSize });
    expect(created.response.status).toBe(422);
    expect(created.json.code).toBe('VALIDATION');
  });

  test('simpan ulang tanpa boxSize tidak mengubah nilainya', async () => {
    const created = await create({ ...base, boxSize: 12 });
    const next = await update(created.json, { ...base, detail: 'ubah' });
    expect(next.response.status).toBe(200);
    expect(next.json.boxSize).toBe(12);
  });
});
