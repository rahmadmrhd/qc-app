import { expect, test } from 'bun:test';
import { captureAppErrorAsync } from '@server-test/errors';
import { createTestEnv } from '@server-test/test-env';
import { batchGuarded, CAS_UPDATED_AT_SET, CAS_VERSION_BUMP_SET, isGuardFailure } from './cas';

test('CAS updated_at digabung ke UPDATE: cocok = batch jalan; tidak cocok = seluruh batch batal dan CONFLICT', async () => {
  const env = await createTestEnv();
  await env.DB.prepare("INSERT INTO items (id, key, updated_at) VALUES ('i1', 'k', 't1')").run();
  const edit = (expected: string, next: string, model: string) => [
    env.DB.prepare(
      "INSERT INTO sync_state (resource, seq) VALUES ('x', 1) ON CONFLICT (resource) DO UPDATE SET seq = seq + 1",
    ),
    env.DB.prepare(`UPDATE items SET model = ?, ${CAS_UPDATED_AT_SET} WHERE id = 'i1'`).bind(
      model,
      expected,
      next,
    ),
  ];
  await batchGuarded(env.DB, edit('t1', 't2', 'a'), {}, 'basi');
  const row = () =>
    env.DB.prepare('SELECT model, updated_at AS at FROM items').first<{
      model: string;
      at: string;
    }>();
  expect(await row()).toEqual({ model: 'a', at: 't2' });
  // penulis dengan updated_at lama: CONFLICT, dan pernyataan sebelum UPDATE (sync_state) ikut dibatalkan
  const error = await captureAppErrorAsync(() =>
    batchGuarded(env.DB, edit('t1', 't3', 'b'), {}, 'basi'),
  );
  expect(error).toMatchObject({ code: 'CONFLICT', message: 'basi' });
  expect(await row()).toEqual({ model: 'a', at: 't2' });
  expect(
    (
      await env.DB.prepare("SELECT seq FROM sync_state WHERE resource = 'x'").first<{
        seq: number;
      }>()
    )?.seq,
  ).toBe(1);
});

test('CAS version digabung ke UPDATE: naik 1 bila cocok, batal dengan integer overflow bila basi', async () => {
  const env = await createTestEnv();
  await env.DB.prepare("INSERT INTO handovers (id, number, version) VALUES ('h1', 'n', 3)").run();
  const bump = (expected: number) =>
    env.DB.prepare(`UPDATE handovers SET note = 'x', ${CAS_VERSION_BUMP_SET} WHERE id = 'h1'`).bind(
      expected,
    );
  await env.DB.batch([bump(3)]);
  const version = async () =>
    (await env.DB.prepare('SELECT version FROM handovers').first<{ version: number }>())?.version;
  expect(await version()).toBe(4);
  const failure = await env.DB.batch([bump(3)]).catch((error: unknown) => error);
  expect(isGuardFailure(failure)).toBe(true);
  expect(await version()).toBe(4);
});
