import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { newId } from '@server/core/id';
import { seedSerialWorld } from '@server-test/serial-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { newSerialStatements } from './new-serial';

setDefaultTimeout(60_000);

let env: TestEnv;

beforeEach(async () => {
  env = await createTestEnv();
  await seedSerialWorld(env);
  await env.DB.prepare(
    "INSERT INTO sticker_stock (sticker_id, location_id, qty, updated_at) VALUES ('s1', 'loc-sby', 10, '')",
  ).run();
});

describe('newSerialStatements', () => {
  test('menulis serial, stiker, kejadian recorded (data digabung eventData), dan memotong stok', async () => {
    const serialId = newId();
    const statements = await newSerialStatements(env, {
      serialId,
      eventId: newId(),
      clientId: crypto.randomUUID(),
      buId: 'bu-a',
      serial: 'NS-1',
      itemId: 'i-a1',
      testDate: '2026-11-12',
      locationId: 'loc-sby',
      locationName: 'Surabaya',
      note: 'catatan',
      sample: false,
      actor: { id: 'u-w', name: 'Pencatat', email: 'pencatat@gmail.com' },
      stickerPicks: [{ stickerId: 's1', qty: 2 }],
      stickerNames: new Map([['s1', 'Segel A']]),
      eventData: { source: 'warehouse', orderNumber: 'SO-9' },
      occurredOn: '2026-11-12',
      now: '2026-11-12T03:00:00.000Z',
    });
    await env.DB.batch(statements);
    const serial = await env.DB.prepare('SELECT status, custody, note FROM serials WHERE id = ?')
      .bind(serialId)
      .first<{ status: string; custody: string; note: string }>();
    expect(serial).toEqual({ status: 'good', custody: 'qc', note: 'catatan' });
    const picks = await env.DB.prepare(
      'SELECT sticker_id, qty FROM serial_stickers WHERE serial_id = ?',
    )
      .bind(serialId)
      .all<{ sticker_id: string; qty: number | string }>();
    expect(picks.results.map((r) => [r.sticker_id, Number(r.qty)])).toEqual([['s1', 2]]);
    const event = await env.DB.prepare(
      "SELECT seq, data_json FROM serial_events WHERE serial_id = ? AND type = 'recorded'",
    )
      .bind(serialId)
      .first<{ seq: number | string; data_json: string }>();
    expect(Number(event?.seq)).toBe(1);
    const data = JSON.parse(event?.data_json ?? '{}');
    expect(data).toMatchObject({
      locationId: 'loc-sby',
      locationName: 'Surabaya',
      source: 'warehouse',
      orderNumber: 'SO-9',
      stickers: [{ stickerId: 's1', name: 'Segel A', qty: 2 }],
    });
    const stock = await env.DB.prepare(
      "SELECT qty FROM sticker_stock WHERE sticker_id = 's1'",
    ).first<{
      qty: number | string;
    }>();
    expect(Number(stock?.qty)).toBe(8);
  });
});
