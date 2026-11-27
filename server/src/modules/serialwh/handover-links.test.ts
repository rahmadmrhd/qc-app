import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { ENV } from '@server-test/handover-env';
import { restCall } from '@server-test/rest-call';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { addOrderLinksStmts, assertLinkableHandovers } from './handover-links';
import {
  linkOrder,
  SO_TIME,
  seedOrder,
  seedTask,
  seedWarehouseWorld,
  WH_USERS,
} from './handover-test-env';

setDefaultTimeout(60_000);

// Catatan: `setLinks` mengembalikan `loadOrderDto` (jalur A); tes di sini mengasumsikan A sudah ada.

let env: TestEnv;

// biome-ignore lint/suspicious/noExplicitAny: bentuk data respons beragam, diperiksa per tes
type Json = any;
const setLinks = (email: string, id: string, expectedUpdatedAt: string, handoverIds: string[]) =>
  restCall(env, email, 'serialWarehouse.setLinks', {
    id,
    expectedUpdatedAt,
    handoverIds,
  }) as Promise<Json>;

const linked = async (orderId: string): Promise<string[]> =>
  (
    await env.DB.prepare(
      'SELECT handover_id FROM warehouse_order_handovers WHERE order_id = ? ORDER BY handover_id',
    )
      .bind(orderId)
      .all<{ handover_id: string }>()
  ).results.map((row) => row.handover_id);

const userOf = async (email: string) => {
  const { loadUserContext } = await import('@server/modules/access/context');
  const user = await loadUserContext(env, email);
  if (!user) throw new Error('pengguna uji tidak ada');
  return user;
};

beforeEach(async () => {
  env = await createTestEnv();
  await seedWarehouseWorld(env);
  await seedOrder(env, { id: 'o1' });
});

describe('tautan SO-task', () => {
  test('addOrderLinksStmts menautkan task dan idempoten', async () => {
    await seedTask(env, { id: 't1' });
    const user = await userOf(WH_USERS.wh);
    await assertLinkableHandovers(env, user, ['t1']);
    await env.DB.batch(addOrderLinksStmts(env, 'o1', ['t1', 't1'], 'x@gmail.com', SO_TIME));
    await env.DB.batch(addOrderLinksStmts(env, 'o1', ['t1'], 'x@gmail.com', SO_TIME));
    expect(await linked('o1')).toEqual(['t1']);
  });

  test('assertLinkableHandovers menolak task terhapus dan task di lokasi tak terbaca', async () => {
    await seedTask(env, { id: 't-gone', deleted: true });
    await seedTask(env, { id: 't-b', locationId: ENV.locB });
    const user = await userOf(WH_USERS.wh);
    await expect(assertLinkableHandovers(env, user, ['t-gone'])).rejects.toThrow(
      'Task tidak ditemukan',
    );
    await expect(assertLinkableHandovers(env, user, ['t-b'])).rejects.toThrow(
      'Task tidak ditemukan',
    );
  });

  test('setLinks mengganti tautan terbaca dan mempertahankan yang tak terbaca', async () => {
    await seedTask(env, { id: 't-a1' });
    await seedTask(env, { id: 't-a2' });
    await seedTask(env, { id: 't-b', locationId: ENV.locB });
    await linkOrder(env, 'o1', 't-a1');
    await linkOrder(env, 'o1', 't-b');
    const res = await setLinks(WH_USERS.wh, 'o1', SO_TIME, ['t-a2']);
    expect(res.ok).toBe(true);
    expect(await linked('o1')).toEqual(['t-a2', 't-b']);
  });

  test('setLinks dengan id baru tak terbaca atau terhapus = NOT_FOUND', async () => {
    await seedTask(env, { id: 't-b', locationId: ENV.locB });
    await seedTask(env, { id: 't-gone', deleted: true });
    for (const id of ['t-b', 't-gone', 'tidak-ada']) {
      const res = await setLinks(WH_USERS.wh, 'o1', SO_TIME, [id]);
      expect(res.ok).toBe(false);
      expect(res.error.code).toBe('NOT_FOUND');
    }
    expect(await linked('o1')).toEqual([]);
  });

  test('versi basi = 412 (CONFLICT) dan tak menulis', async () => {
    await seedTask(env, { id: 't-a1' });
    const res = await setLinks(WH_USERS.wh, 'o1', '2020-01-01T00:00:00.000Z', ['t-a1']);
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe('CONFLICT');
    expect(await linked('o1')).toEqual([]);
  });

  test('BU tanpa hak edit atau hanya view = NOT_FOUND / 403', async () => {
    await seedTask(env, { id: 't-a1' });
    const other = await setLinks(WH_USERS.otherBu, 'o1', SO_TIME, ['t-a1']);
    expect(other.ok).toBe(false);
    expect(other.error.code).toBe('NOT_FOUND');
    const view = await setLinks(WH_USERS.viewer, 'o1', SO_TIME, ['t-a1']);
    expect(view.ok).toBe(false);
  });

  test('lebih dari 20 tautan ditolak', async () => {
    const idsToLink: string[] = [];
    for (let i = 0; i < 21; i++) idsToLink.push(`t-${i}`);
    const res = await setLinks(WH_USERS.wh, 'o1', SO_TIME, idsToLink);
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe('VALIDATION');
  });

  test('submit ke SO lama menegakkan batas 20 tautan per SO (yang ada + yang baru)', async () => {
    const ids = Array.from({ length: 21 }, (_, i) => `t${i + 1}`);
    for (const id of ids) await seedTask(env, { id });
    for (const id of ids.slice(0, 20)) await linkOrder(env, 'o1', id);
    const send = (handoverIds: string[], serial: string) =>
      restCall(env, WH_USERS.wh, 'serialWarehouse.submit', {
        clientId: crypto.randomUUID(),
        chunkIndex: 0,
        header: {
          dispatchedOn: '2026-01-05',
          orderNumber: 'SO-o1',
          buId: 'bu-a',
          customerName: 'PT Maju',
          itemId: 'i-ax300',
          note: '',
          handoverIds,
          total: 1,
          chunkSize: 200,
        },
        rows: [
          {
            kind: 'new',
            clientId: crypto.randomUUID(),
            serial,
            locationId: ENV.locA,
            testDate: '2026-01-05',
          },
        ],
      }) as Promise<Json>;
    const over = await send(['t21'], 'CAP-1');
    expect(over.ok).toBe(false);
    expect(over.error.message).toContain('Maksimal 20');
    const known = await send(['t1'], 'CAP-2');
    expect(JSON.stringify(known.error ?? null)).toBe('null');
    expect(await linked('o1')).toHaveLength(20);
  });

  test('menulis audit serialwh.links_update bertarget id SO', async () => {
    await seedTask(env, { id: 't-a1' });
    await setLinks(WH_USERS.wh, 'o1', SO_TIME, ['t-a1']);
    const row = await env.DB.prepare(
      "SELECT action, target_id FROM audit_log WHERE action = 'serialwh.links_update'",
    ).first<{ action: string; target_id: string }>();
    expect(row?.target_id).toBe('o1');
  });

  test('getOrder menampilkan task tak terbaca hanya dengan nomor dan status', async () => {
    await seedTask(env, { id: 't-b', locationId: ENV.locB, customerName: 'Rahasia' });
    await linkOrder(env, 'o1', 't-b');
    const { loadOrderHandovers } = await import('./handover-links');
    const rows = await loadOrderHandovers(env, await userOf(WH_USERS.wh), 'o1');
    expect(rows).toEqual([
      {
        id: 't-b',
        number: 'ST-t-b',
        status: 'new',
        customerName: '',
        createdAt: '',
        readable: false,
      },
    ]);
    const qc = await loadOrderHandovers(env, await userOf(WH_USERS.qc), 'o1');
    expect(qc[0]?.readable).toBe(true);
    expect(qc[0]?.customerName).toBe('Rahasia');
  });
});
