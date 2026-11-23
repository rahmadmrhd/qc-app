import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { testScope } from '@server-test/dashboard-scope';
import { seedBrand, seedItem } from '@server-test/item-fixtures';
import { seedPostel } from '@server-test/postel-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import type { DashboardRange, ListData, PartsData, WidgetData, WidgetId } from '@shared/dashboard';
import { widgetMeta } from '@shared/dashboard';
import type { ResolvedScope } from '../scope';
import { POSTEL_WIDGETS } from './postel';

setDefaultTimeout(60_000);

let env: TestEnv;

const RANGE: DashboardRange = { from: '2026-11-10', to: '2026-11-16' };
const IDS: WidgetId[] = ['pt.condition', 'pt.expiring'];
const DELETED = '2026-11-13T00:00:00.000Z';

// Hari ini (WIB) 2026-11-23; ambang "segera habis" bawaan = 90 hari.
const scopeOf = (): ResolvedScope => testScope(RANGE, { today: '2026-11-23' });

async function run(
  id: WidgetId,
  filters: Record<string, string[]> = {},
  scope: ResolvedScope = scopeOf(),
): Promise<WidgetData> {
  const impl = POSTEL_WIDGETS.find((widget) => widget.id === id);
  if (!impl) throw new Error(`Widget ${id} belum terdaftar`);
  return impl.run({ env, db: env.DB, scope, filters });
}

beforeEach(async () => {
  env = await createTestEnv();
  await seedBrand(env, 'Merk');
});

async function seedAll(): Promise<void> {
  // p1: nomor Aktif (seq 2) berlaku; nomor Lama (seq 1) sudah lewat tetapi tak menentukan kondisi.
  await seedItem(env, { id: 'i1', brand: 'Merk', model: 'M1', postelId: 'p1' });
  await seedPostel(env, {
    id: 'p1',
    numbers: [
      { number: 'N1-lama', expiresOn: '2026-01-01', seq: 1 },
      { number: 'N1', expiresOn: '2027-06-01', seq: 2 },
    ],
  });
  // p2: segera habis (30 hari).
  await seedItem(env, { id: 'i2', brand: 'Merk', model: 'M2', postelId: 'p2' });
  await seedPostel(env, { id: 'p2', numbers: [{ number: 'N2', expiresOn: '2026-12-23' }] });
  // p3: kedaluwarsa; item terhapus tidak ikut nama.
  await seedItem(env, { id: 'i3', brand: 'Merk', model: 'M3', postelId: 'p3' });
  await seedItem(env, { id: 'i9', brand: 'Merk', model: 'M9', postelId: 'p3' });
  await env.DB.prepare('UPDATE items SET deleted_at = ? WHERE id = ?').bind(DELETED, 'i9').run();
  await seedPostel(env, { id: 'p3', numbers: [{ number: 'N3', expiresOn: '2026-11-01' }] });
  // p4: catatan terhapus.
  await seedPostel(env, { id: 'p4', numbers: [{ number: 'N4', expiresOn: '2026-11-01' }] });
  await env.DB.prepare('UPDATE postels SET deleted_at = ? WHERE id = ?').bind(DELETED, 'p4').run();
  // p5: nomor seq terbesar terhapus, jadi nomor hidup seq 1 yang Aktif (segera habis, 8 hari).
  await seedItem(env, { id: 'i5', brand: 'Merk', model: 'M5', postelId: 'p5' });
  await seedPostel(env, {
    id: 'p5',
    numbers: [
      { id: 'p5-n1', number: 'N5', expiresOn: '2026-12-01', seq: 1 },
      { id: 'p5-n2', number: 'N5-hapus', expiresOn: '2030-01-01', seq: 2 },
    ],
  });
  await env.DB.prepare('UPDATE postel_numbers SET deleted_at = ? WHERE id = ?')
    .bind(DELETED, 'p5-n2')
    .run();
}

test('POSTEL_WIDGETS mencakup tepat dua widget grup Postel', () => {
  expect(POSTEL_WIDGETS.map((widget) => widget.id).sort()).toEqual([...IDS].sort());
});

describe('pt.condition', () => {
  test('kondisi dari nomor Aktif (seq terbesar yang hidup); catatan dan nomor terhapus tak dihitung', async () => {
    await seedAll();
    const data = (await run('pt.condition')) as PartsData;
    expect(data.slices).toEqual([
      { key: 'valid', label: 'Berlaku', value: 1 },
      { key: 'soon', label: 'Segera habis', value: 2 },
      { key: 'expired', label: 'Kedaluwarsa', value: 1 },
    ]);
  });

  test('filter grup condition', async () => {
    await seedAll();
    const data = (await run('pt.condition', { condition: ['expired'] })) as PartsData;
    expect(data.slices).toEqual([{ key: 'expired', label: 'Kedaluwarsa', value: 1 }]);
  });

  test('tanpa Postel: tanpa irisan', async () => {
    expect(((await run('pt.condition')) as PartsData).slices).toEqual([]);
  });
});

describe('pt.expiring', () => {
  test('hanya Segera habis dan Kedaluwarsa, terurut tanggal habis; Berlaku tidak ikut', async () => {
    await seedAll();
    const data = (await run('pt.expiring')) as ListData;
    expect(data.columns).toEqual([...(widgetMeta('pt.expiring').listColumns ?? [])]);
    expect(data.total).toBe(3);
    expect(data.rows).toEqual([
      { name: 'M3', number: 'N3', expires: '2026-11-01', days: -22 },
      { name: 'M5', number: 'N5', expires: '2026-12-01', days: 8 },
      { name: 'M2', number: 'N2', expires: '2026-12-23', days: 30 },
    ]);
  });

  test('filter grup condition menyempitkan daftar', async () => {
    await seedAll();
    const data = (await run('pt.expiring', { condition: ['soon'] })) as ListData;
    expect(data.rows.map((row) => row.number)).toEqual(['N5', 'N2']);
    expect(data.total).toBe(2);
  });

  test('maksimal 10 baris, total tetap seluruhnya', async () => {
    for (let index = 1; index <= 12; index += 1) {
      await seedPostel(env, {
        id: `x${index}`,
        numbers: [{ number: `NX${index}`, expiresOn: `2026-11-${String(index).padStart(2, '0')}` }],
      });
    }
    const data = (await run('pt.expiring')) as ListData;
    expect(data.rows.length).toBe(10);
    expect(data.total).toBe(12);
  });
});
