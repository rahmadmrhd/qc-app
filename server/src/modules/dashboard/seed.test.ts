import { beforeEach, expect, setDefaultTimeout, test } from 'bun:test';
import { seedBusinessUnit, seedLocation } from '@server-test/access-fixtures';
import {
  seedCase,
  seedHandover,
  seedPostel,
  seedSerial,
  seedStock,
} from '@server-test/dashboard-seed';
import { seedItem } from '@server-test/item-fixtures';
import { seedSticker, seedStickerType } from '@server-test/sticker-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';

setDefaultTimeout(60_000);

let env: TestEnv;

beforeEach(async () => {
  env = await createTestEnv();
});

const count = async (table: string): Promise<number> => {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{
    n: number | string;
  }>();
  return Number(row?.n ?? 0);
};

test('penyisip uji dashboard menulis baris yang diharapkan dengan bawaan seluruh kolom opsional', async () => {
  await seedLocation(env, { id: 'loc-a', code: 'A' });
  await seedBusinessUnit(env, { id: 'bu-a', code: 'A' });
  await seedItem(env, { id: 'i-1', brand: 'Brand', model: 'Tipe', businessUnitIds: ['bu-a'] });
  await seedHandover(env, { id: 'h1' });
  await seedHandover(env, {
    id: 'h2',
    boardStatus: 'cancelled',
    deletedAt: '2026-11-11T00:00:00.000Z',
  });
  await seedSerial(env, { id: 's1' });
  await seedCase(env, { id: 'c1', serialId: 's1' });
  await seedStickerType(env, { id: 't1' });
  await seedSticker(env, { id: 'k1', typeId: 't1' });
  await seedStock(env, {
    stickerId: 'k1',
    locationId: 'loc-a',
    qty: 3,
    entries: [{ kind: 'in', delta: 3, ts: '2026-11-11T00:00:00.000Z' }],
  });
  await seedPostel(env, { id: 'p1', numbers: [{ number: 'N-1', expiresOn: '2027-01-01' }] });

  expect(await count('handovers')).toBe(2);
  expect(await count('serials')).toBe(1);
  expect(await count('serial_business_units')).toBe(1);
  expect(await count('serial_cases')).toBe(1);
  expect(await count('sticker_stock')).toBe(1);
  expect(await count('sticker_stock_entries')).toBe(1);
  expect(await count('postel_numbers')).toBe(1);
  const open = await env.DB.prepare('SELECT open_case_id FROM serials WHERE id = ?')
    .bind('s1')
    .first<{ open_case_id: string }>();
  expect(open?.open_case_id).toBe('c1');
});
