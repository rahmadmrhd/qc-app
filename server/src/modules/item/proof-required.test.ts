import { beforeEach, describe, expect, test } from 'bun:test';
import { seedBusinessUnit } from '@server-test/access-fixtures';
import { brandIdOf, DEFAULT_TEST_BU_ID, seedBrand } from '@server-test/item-fixtures';
import { jsonOf, restClient } from '@server-test/rest-client';
import { createTestEnv, type TestEnv } from '@server-test/test-env';

// Item wajib foto bukti (spek 2026-11-18 §3 A dan §6.1): `proofRequired` + `proofMin` (1..5); tidak dikirim = tak
// diubah (klien lama); `proofRequired: false` selalu menyimpan `proofMin` = 1.

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
  env.clock.set(Date.parse('2026-11-18T00:00:00.000Z'));
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

describe('item wajib foto', () => {
  test('create dengan proofRequired dan proofMin: dikembalikan dan dibaca kembali lewat items.get', async () => {
    const created = await create({ ...base, proofRequired: true, proofMin: 3 });
    expect(created.response.status).toBe(201);
    expect(created.json.proofRequired).toBe(true);
    expect(created.json.proofMin).toBe(3);
    const got = await jsonOf(await rest.get(`/items/${created.json.id as string}`));
    expect(got.proofRequired).toBe(true);
    expect(got.proofMin).toBe(3);
  });

  test('item baru tanpa field = tidak wajib, minimum 1', async () => {
    const created = await create(base);
    expect(created.response.status).toBe(201);
    expect(created.json.proofRequired).toBe(false);
    expect(created.json.proofMin).toBe(1);
  });

  test('proofMin di luar 1..5 atau bukan bilangan bulat = 422 pada field proofMin', async () => {
    for (const proofMin of [0, 6, -1, 1.5, '2', null]) {
      const result = await create({ ...base, proofRequired: true, proofMin });
      expect(result.response.status).toBe(422);
      expect(result.json).toMatchObject({
        code: 'VALIDATION',
        fields: { proofMin: expect.any(String) },
      });
    }
  });

  test('proofRequired bukan boolean = 422 pada field proofRequired', async () => {
    const result = await create({ ...base, proofRequired: 'ya' });
    expect(result.response.status).toBe(422);
    expect(result.json).toMatchObject({ fields: { proofRequired: expect.any(String) } });
  });

  test('proofRequired false menyimpan proofMin = 1 walau dikirim 4', async () => {
    const created = await create({ ...base, proofRequired: false, proofMin: 4 });
    expect(created.response.status).toBe(201);
    expect(created.json.proofRequired).toBe(false);
    expect(created.json.proofMin).toBe(1);
  });

  test('klien lama (tanpa field): nilai tersimpan dipertahankan pada PUT', async () => {
    const created = (await create({ ...base, proofRequired: true, proofMin: 2 })).json;
    const kept = await update(created, { ...base, detail: 'ubah detail' });
    expect(kept.response.status).toBe(200);
    expect(kept.json.proofRequired).toBe(true);
    expect(kept.json.proofMin).toBe(2);
    // Hanya proofRequired dikirim true tanpa proofMin: minimum tersimpan dipertahankan.
    const off = await update(kept.json, { ...base, proofRequired: false });
    expect(off.json.proofRequired).toBe(false);
    expect(off.json.proofMin).toBe(1);
    const back = await update(off.json, { ...base, proofRequired: true });
    expect(back.json.proofRequired).toBe(true);
    expect(back.json.proofMin).toBe(1);
  });

  test('mengubah hanya proofRequired/proofMin dihitung perubahan isi dan masuk audit item.update', async () => {
    const created = (await create({ ...base, proofRequired: false })).json;
    const changed = await update(created, { ...base, proofRequired: true, proofMin: 2 });
    expect(changed.response.status).toBe(200);
    expect(changed.json.updatedAt).not.toBe(created.updatedAt);
    const audit = await env.DB.prepare(
      "SELECT `before`, `after` FROM audit_log WHERE action = 'item.update'",
    ).first<{ before: string; after: string }>();
    const before = JSON.parse(audit?.before ?? '{}');
    const after = JSON.parse(audit?.after ?? '{}');
    expect(before).toMatchObject({ proofRequired: false, proofMin: 1 });
    expect(after).toMatchObject({ proofRequired: true, proofMin: 2 });
    const changedMin = await update(changed.json, { ...base, proofRequired: true, proofMin: 4 });
    expect(changedMin.response.status).toBe(200);
    expect(changedMin.json.proofMin).toBe(4);
  });

  test('CAS expectedUpdatedAt usang tetap 412', async () => {
    const created = (await create({ ...base, proofRequired: true, proofMin: 2 })).json;
    await update(created, { ...base, proofRequired: true, proofMin: 3 });
    const stale = await rest.put(`/items/${created.id as string}`, {
      headers: { 'if-match': `"${created.updatedAt as string}"` },
      body: { ...base, proofRequired: true, proofMin: 4, expectedUpdatedAt: created.updatedAt },
    });
    expect(stale.status).toBe(412);
  });
});
