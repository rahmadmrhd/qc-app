import { expect, test } from 'bun:test';
import { captureAppErrorAsync } from '@worker-test/errors';
import { createTestEnv } from '@worker-test/test-env';
import { batchGuarded, guardRow } from './cas';

test('penjaga CAS: cocok = batch jalan; tidak cocok = seluruh batch batal dan CONFLICT', async () => {
  const env = await createTestEnv();
  await env.DB.prepare("INSERT INTO items (id, key, updated_at) VALUES ('i1', 'k', 't1')").run();
  const bump = (v: string) => env.DB.prepare("UPDATE items SET model = ? WHERE id = 'i1'").bind(v);
  await batchGuarded(
    env.DB,
    [guardRow(env.DB, 'items', 'i1', 'updated_at', 't1'), bump('a')],
    {},
    'basi',
  );
  expect((await env.DB.prepare('SELECT model FROM items').first<{ model: string }>())?.model).toBe(
    'a',
  );
  const error = await captureAppErrorAsync(() =>
    batchGuarded(
      env.DB,
      [guardRow(env.DB, 'items', 'i1', 'updated_at', 'lama'), bump('b')],
      {},
      'basi',
    ),
  );
  expect(error).toMatchObject({ code: 'CONFLICT', message: 'basi' });
  expect((await env.DB.prepare('SELECT model FROM items').first<{ model: string }>())?.model).toBe(
    'a',
  );
  // angka (version)
  await env.DB.prepare("INSERT INTO handovers (id, number, version) VALUES ('h1', 'n', 3)").run();
  await env.DB.batch([guardRow(env.DB, 'handovers', 'h1', 'version', 3)]);
  await expect(env.DB.batch([guardRow(env.DB, 'handovers', 'h1', 'version', 2)])).rejects.toThrow();
});
