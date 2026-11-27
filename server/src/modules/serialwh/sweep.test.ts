import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { restCall } from '@server-test/rest-call';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { seedWarehouseWorld, WH_USERS } from '@server-test/warehouse-fixtures';
import { sweepStaleDispatches } from './sweep';

setDefaultTimeout(60_000);

let env: TestEnv;

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-11-12T03:00:00.000Z'));
  await seedWarehouseWorld(env);
});

async function startPending(number: string, serial: string): Promise<void> {
  const out = (await restCall(env, WH_USERS.edit, 'serialWarehouse.submit', {
    clientId: crypto.randomUUID(),
    chunkIndex: 0,
    header: {
      dispatchedOn: '2026-11-12',
      orderNumber: number,
      buId: 'bu-a',
      customerName: 'PT Maju',
      itemId: 'i-a1',
      note: '',
      handoverIds: [],
      total: 2,
      chunkSize: 1,
    },
    rows: [
      {
        kind: 'new',
        clientId: crypto.randomUUID(),
        serial,
        locationId: 'loc-sby',
        testDate: '2026-11-12',
      },
    ],
  })) as { ok: boolean };
  expect(out.ok).toBe(true);
}

const statuses = async () =>
  (
    await env.DB.prepare('SELECT status FROM warehouse_dispatches ORDER BY created_at').all<{
      status: string;
    }>()
  ).results.map((r) => r.status);

describe('penyapu pengeluaran basi', () => {
  test('pending lebih dari 7 hari dibatalkan: keanggotaan hilang, serial baru tetap, audit tercatat', async () => {
    await startPending('SO-OLD', 'OLD-1');
    env.clock.set(Date.parse('2026-11-19T03:01:00.000Z'));
    expect(await sweepStaleDispatches(env)).toBe(1);
    expect(await statuses()).toEqual(['cancelled']);
    const members = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM warehouse_dispatch_serials',
    ).first<{ n: number | string }>();
    expect(Number(members?.n)).toBe(0);
    const serial = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM serials WHERE serial = 'OLD-1'",
    ).first<{ n: number | string }>();
    expect(Number(serial?.n)).toBe(1);
    const audit = await env.DB.prepare(
      "SELECT actor, target_id FROM audit_log WHERE action = 'serialwh.dispatch_cancel'",
    ).first<{ actor: string; target_id: string }>();
    expect(audit?.actor).toBe('system');
    expect(audit?.target_id).not.toBe('');
  });

  test('pengeluaran 6 hari tetap pending', async () => {
    await startPending('SO-NEW', 'NEW-1');
    env.clock.set(Date.parse('2026-11-18T03:00:00.000Z'));
    expect(await sweepStaleDispatches(env)).toBe(0);
    expect(await statuses()).toEqual(['pending']);
  });
});
