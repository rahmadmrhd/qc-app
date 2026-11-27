import { beforeEach, describe, expect, test } from 'bun:test';
import { seedBusinessUnit } from '@server-test/access-fixtures';
import { brandIdOf, DEFAULT_TEST_BU_ID, seedBrand } from '@server-test/item-fixtures';
import { jsonOf, restClient } from '@server-test/rest-client';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { seedCountryLockFirmwares } from '../countrylock/seed';

// Kode firmware Country Lock per item (spek desktop §6.6, keputusan pemilik 2026-11-18): pilihan tetap per merk
// (daftar dinamis `cl_firmwares`, di sini diisi seed awal), hanya untuk item Country lock; tidak dikirim = tak diubah.

let env: TestEnv;
let rest: ReturnType<typeof restClient>;

const base = {
  brandId: brandIdOf('Ubiquiti'),
  businessUnitIds: [DEFAULT_TEST_BU_ID],
  model: 'AF-5XHD',
  isCountryLock: true,
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
  await seedBrand(env, 'Mikrotik');
  await seedBrand(env, 'Cambium');
  await seedCountryLockFirmwares(env);
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

describe('firmware item', () => {
  test('disimpan dan dibaca kembali; item baru tanpa firmware = kosong', async () => {
    const withCode = await create({ ...base, firmware: 'af5xhd' });
    expect(withCode.response.status).toBe(201);
    expect(withCode.json.firmware).toBe('af5xhd');
    const got = await jsonOf(await rest.get(`/items/${withCode.json.id as string}`));
    expect(got.firmware).toBe('af5xhd');

    const without = await create({ ...base, model: 'Lain' });
    expect(without.response.status).toBe(201);
    expect(without.json.firmware).toBe('');
  });

  test('kode milik merk lain, merk tanpa firmware, atau kode tak dikenal ditolak (422 pada field firmware)', async () => {
    for (const [brand, code] of [
      ['Ubiquiti', 'AC'], // kode Mikrotik
      ['Mikrotik', 'af5xhd'], // kode Ubiquiti
      ['Cambium', 'AC'], // merk tanpa firmware Country Lock
      ['Ubiquiti', 'ngawur'],
      ['Ubiquiti', 'AF5XHD'], // peka huruf besar/kecil
    ] as const) {
      const result = await create({ ...base, brandId: brandIdOf(brand), firmware: code });
      expect(result.response.status).toBe(422);
      expect(result.json).toMatchObject({
        code: 'VALIDATION',
        fields: { firmware: expect.any(String) },
      });
    }
  });

  test('firmware terisi pada item non-Country lock ditolak; kosong diterima', async () => {
    const bad = await create({ ...base, isCountryLock: false, firmware: 'af5xhd' });
    expect(bad.response.status).toBe(422);
    expect(bad.json).toMatchObject({ fields: { firmware: expect.any(String) } });
    const ok = await create({ ...base, isCountryLock: false, firmware: '' });
    expect(ok.response.status).toBe(201);
    expect(ok.json.firmware).toBe('');
  });

  test('bentuk salah: bukan teks atau terlalu panjang = 422', async () => {
    for (const firmware of [5, null, 'x'.repeat(41), 'a\nb']) {
      const result = await create({ ...base, firmware });
      expect(result.response.status).toBe(422);
      expect(result.json).toMatchObject({ fields: { firmware: expect.any(String) } });
    }
  });

  test('klien lama (tanpa field firmware): nilai tersimpan dipertahankan; dikosongkan bila tak berlaku lagi', async () => {
    const created = (await create({ ...base, firmware: 'af5xhd' })).json;
    // Tanpa field: tetap.
    const kept = await update(created, { ...base, detail: 'ubah detail' });
    expect(kept.response.status).toBe(200);
    expect(kept.json.firmware).toBe('af5xhd');
    // Pindah ke merk yang kodenya tak berlaku, tanpa field: dikosongkan (bukan galat).
    const moved = await update(kept.json, { ...base, brandId: brandIdOf('Mikrotik') });
    expect(moved.response.status).toBe(200);
    expect(moved.json.firmware).toBe('');
    // Kembali ke Ubiquiti dan isi lagi, lalu matikan Country lock tanpa field: dikosongkan.
    const refilled = await update(moved.json, { ...base, firmware: 'WA' });
    expect(refilled.json.firmware).toBe('WA');
    const off = await update(refilled.json, { ...base, isCountryLock: false });
    expect(off.response.status).toBe(200);
    expect(off.json.firmware).toBe('');
  });

  test('mengubah hanya firmware dihitung sebagai perubahan (updatedAt naik)', async () => {
    const created = (await create({ ...base, firmware: 'WA' })).json;
    const changed = await update(created, { ...base, firmware: 'XW' });
    expect(changed.response.status).toBe(200);
    expect(changed.json.firmware).toBe('XW');
    expect(changed.json.updatedAt).not.toBe(created.updatedAt);
  });
});
