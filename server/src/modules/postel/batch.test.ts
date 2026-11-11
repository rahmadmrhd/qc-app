import { beforeEach, describe, expect, test } from 'bun:test';
import { seedBrand, seedItem } from '@server-test/item-fixtures';
import { seedPostel } from '@server-test/postel-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { claimItemsForPostelStmts } from './items';
import { runPostelBatch } from './service';

// `runPostelBatch` pada tingkat pernyataan: pemilahan penyebab kegagalan penjaga (versi usang, item direbut catatan lain,
// item dinonaktifkan di sela pemeriksaan dan batch). Jalur serentak sungguhan ada di `concurrency.test.ts`.

let env: TestEnv;
const SEEDED = '2026-11-11T00:00:00.000Z';

// biome-ignore lint/suspicious/noExplicitAny: galat uji
async function failureOf(promise: Promise<unknown>): Promise<any> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('seharusnya melempar');
}

async function ownerOf(itemId: string): Promise<string> {
  const row = await env.DB.prepare('SELECT postel_id FROM items WHERE id = ?')
    .bind(itemId)
    .first<{ postel_id: string }>();
  return row?.postel_id.trim() ?? '';
}

beforeEach(async () => {
  env = await createTestEnv();
  await seedBrand(env, 'PBE');
  await seedItem(env, { id: 'i1', brand: 'PBE', model: 'M5-400' });
  await seedItem(env, { id: 'i2', brand: 'PBE', model: 'M5-200' });
  await seedItem(env, { id: 'i-off', brand: 'PBE', model: 'OFF-1', status: 'inactive' });
  await seedPostel(env, {
    id: 'p-mine',
    itemIds: ['i1'],
    numbers: [{ number: 'MINE-1', expiresOn: '2027-01-01' }],
  });
  await seedPostel(env, {
    id: 'p-other',
    itemIds: ['i2'],
    numbers: [
      { number: 'OTHER-OLD', expiresOn: '2027-01-01' },
      { number: 'OTHER-NEW', expiresOn: '2027-06-01' },
    ],
  });
});

const claim = (ids: string[]) => claimItemsForPostelStmts(env.DB, 'p-mine', ids);

describe('runPostelBatch', () => {
  test('versi masih sama dan item direbut catatan lain: CONFLICT pada itemIds dengan nomor Aktif pemilik', async () => {
    const error = await failureOf(runPostelBatch(env, claim(['i2']), 'p-mine', ['i2'], SEEDED));
    expect(error.code).toBe('CONFLICT');
    expect(error.stale).toBeUndefined();
    expect(error.fields?.itemIds).toBe(
      'Item "PBE M5-200" sudah tergabung ke Postel "OTHER-NEW"; keluarkan dulu dari sana',
    );
    expect(await ownerOf('i2')).toBe('p-other');
  });

  test('versi sudah berubah: stale, walau item juga direbut catatan lain', async () => {
    await env.DB.prepare("UPDATE postels SET updated_at = '2026-11-11T05:00:00.000Z' WHERE id = ?")
      .bind('p-mine')
      .run();
    const error = await failureOf(runPostelBatch(env, claim(['i2']), 'p-mine', ['i2'], SEEDED));
    expect(error.code).toBe('CONFLICT');
    expect(error.stale).toBe(true);
    expect(error.fields).toBeUndefined();
  });

  test('catatan sudah dihapus: stale', async () => {
    await env.DB.prepare('DELETE FROM postels WHERE id = ?').bind('p-mine').run();
    const error = await failureOf(runPostelBatch(env, claim(['i2']), 'p-mine', ['i2'], SEEDED));
    expect(error.stale).toBe(true);
  });

  test('item nonaktif (dinonaktifkan di sela pemeriksaan dan batch), tak ada pemilik lain: VALIDATION generik', async () => {
    const error = await failureOf(
      runPostelBatch(env, claim(['i-off']), 'p-mine', ['i-off'], SEEDED),
    );
    expect(error.code).toBe('VALIDATION');
    expect(error.stale).toBeUndefined();
    expect(error.fields?.itemIds).toBe('Item tidak ditemukan');
    expect(await ownerOf('i-off')).toBe('');
  });

  test('klaim item nonaktif yang sudah milik catatan itu tetap berhasil, bersama item aktif bebas', async () => {
    await env.DB.prepare("UPDATE items SET postel_id = 'p-mine' WHERE id = 'i-off'").run();
    await runPostelBatch(env, claim(['i-off', 'i1']), 'p-mine', ['i-off', 'i1'], SEEDED);
    expect(await ownerOf('i-off')).toBe('p-mine');
    expect(await ownerOf('i1')).toBe('p-mine');
  });

  test('catatan baru (tanpa versi): kegagalan klaim dipilah tanpa pemeriksaan versi', async () => {
    const error = await failureOf(
      runPostelBatch(env, claimItemsForPostelStmts(env.DB, 'p-new', ['i2']), 'p-new', ['i2']),
    );
    expect(error.code).toBe('CONFLICT');
    expect(error.fields?.itemIds).toContain('OTHER-NEW');
  });
});
