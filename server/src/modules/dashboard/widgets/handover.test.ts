import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { seedLocation } from '@server-test/access-fixtures';
import { testScope } from '@server-test/dashboard-scope';
import { seedHandover } from '@server-test/dashboard-seed';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import type {
  DashboardRange,
  ListData,
  NumberData,
  PartsData,
  SeriesData,
  WidgetData,
  WidgetId,
} from '@shared/dashboard';
import { widgetMeta } from '@shared/dashboard';
import type { ResolvedScope } from '../scope';
import { HANDOVER_WIDGETS } from './handover';

setDefaultTimeout(60_000);

let env: TestEnv;

const RANGE: DashboardRange = { from: '2026-11-10', to: '2026-11-16' };
const IN_RANGE = '2026-11-12T03:00:00.000Z';

function scopeOf(overrides: Partial<ResolvedScope> = {}, range: DashboardRange = RANGE) {
  return testScope(range, { handoverLocationIds: ['loc-a', 'loc-b'], ...overrides });
}

async function run(
  id: WidgetId,
  scope: ResolvedScope = scopeOf(),
  filters: Record<string, string[]> = {},
): Promise<WidgetData> {
  const impl = HANDOVER_WIDGETS.find((widget) => widget.id === id);
  if (!impl) throw new Error(`Widget ${id} belum terdaftar`);
  return impl.run({ db: env.DB, scope, filters });
}

beforeEach(async () => {
  env = await createTestEnv();
  await seedLocation(env, { id: 'loc-a', code: 'A', name: 'Lokasi A' });
  await seedLocation(env, { id: 'loc-b', code: 'B', name: 'Lokasi B' });
});

test('HANDOVER_WIDGETS mencakup tepat delapan widget grup serah terima', () => {
  const expected: WidgetId[] = [
    'hs.created',
    'hs.active',
    'hs.status',
    'hs.trend',
    'hs.byLocation',
    'hs.byCustomer',
    'hs.avgDuration',
    'hs.oldest',
  ];
  expect(HANDOVER_WIDGETS.map((widget) => widget.id).sort()).toEqual([...expected].sort());
});

describe('hs.created', () => {
  test('menghitung task dalam rentang (termasuk dibatalkan); luar rentang dan terhapus tidak', async () => {
    await seedHandover(env, { id: 'h1', createdAt: IN_RANGE });
    await seedHandover(env, { id: 'h2', createdAt: IN_RANGE, boardStatus: 'done' });
    await seedHandover(env, { id: 'h3', createdAt: IN_RANGE, boardStatus: 'cancelled' });
    await seedHandover(env, { id: 'h4', createdAt: '2026-11-20T03:00:00.000Z' });
    await seedHandover(env, {
      id: 'h5',
      createdAt: IN_RANGE,
      deletedAt: '2026-11-13T00:00:00.000Z',
    });
    // Periode sebelumnya (3-9 Nov): 2 task.
    await seedHandover(env, { id: 'p1', createdAt: '2026-11-04T03:00:00.000Z' });
    await seedHandover(env, { id: 'p2', createdAt: '2026-11-09T03:00:00.000Z' });
    const data = (await run('hs.created')) as NumberData;
    expect(data).toEqual({ kind: 'number', value: 3, previous: 2 });
  });

  test('00:30 WIB 18 Nov masuk hari 18 Nov, bukan 17 Nov', async () => {
    await seedHandover(env, { id: 'h1', createdAt: '2026-11-17T17:30:00.000Z' });
    const on18 = scopeOf({}, { from: '2026-11-18', to: '2026-11-18' });
    const on17 = scopeOf({}, { from: '2026-11-17', to: '2026-11-17' });
    expect(((await run('hs.created', on18)) as NumberData).value).toBe(1);
    expect(((await run('hs.created', on17)) as NumberData).value).toBe(0);
  });

  test('hanya lokasi dalam handoverLocationIds; daftar kosong = 0', async () => {
    await seedHandover(env, { id: 'h1', createdAt: IN_RANGE, locationId: 'loc-a' });
    await seedHandover(env, { id: 'h2', createdAt: IN_RANGE, locationId: 'loc-b' });
    await seedHandover(env, { id: 'h3', createdAt: IN_RANGE, locationId: 'loc-c' });
    expect(((await run('hs.created')) as NumberData).value).toBe(2);
    expect(
      ((await run('hs.created', scopeOf({ handoverLocationIds: ['loc-a'] }))) as NumberData).value,
    ).toBe(1);
    expect(
      ((await run('hs.created', scopeOf({ handoverLocationIds: [] }))) as NumberData).value,
    ).toBe(0);
  });
});

describe('hs.active', () => {
  test('baru dan dikerjakan, tanpa rentang; selesai, dibatalkan, terhapus tidak', async () => {
    await seedHandover(env, { id: 'h1', createdAt: '2025-01-01T03:00:00.000Z' });
    await seedHandover(env, { id: 'h2', createdAt: IN_RANGE, boardStatus: 'in_progress' });
    await seedHandover(env, { id: 'h3', createdAt: IN_RANGE, boardStatus: 'done' });
    await seedHandover(env, { id: 'h4', createdAt: IN_RANGE, boardStatus: 'cancelled' });
    await seedHandover(env, {
      id: 'h5',
      createdAt: IN_RANGE,
      deletedAt: '2026-11-13T00:00:00.000Z',
    });
    expect(((await run('hs.active')) as NumberData).value).toBe(2);
    expect(
      ((await run('hs.active', scopeOf({ handoverLocationIds: [] }))) as NumberData).value,
    ).toBe(0);
  });
});

describe('hs.status', () => {
  beforeEach(async () => {
    await seedHandover(env, {
      id: 'h1',
      createdAt: IN_RANGE,
      customerId: 'c1',
      customerName: 'Satu',
    });
    await seedHandover(env, {
      id: 'h2',
      createdAt: IN_RANGE,
      boardStatus: 'done',
      customerId: 'c1',
      customerName: 'Satu',
    });
    await seedHandover(env, {
      id: 'h3',
      createdAt: IN_RANGE,
      boardStatus: 'done',
      customerId: 'c2',
      customerName: 'Dua',
    });
  });

  test('komposisi per status dengan label', async () => {
    const data = (await run('hs.status')) as PartsData;
    expect(data.kind).toBe('parts');
    expect(data.slices).toEqual([
      { key: 'new', label: 'Baru', value: 1 },
      { key: 'done', label: 'Selesai', value: 2 },
    ]);
  });

  test('mematuhi filter grup status dan customer', async () => {
    const byStatus = (await run('hs.status', scopeOf(), { status: ['done'] })) as PartsData;
    expect(byStatus.slices).toEqual([{ key: 'done', label: 'Selesai', value: 2 }]);
    const byCustomer = (await run('hs.status', scopeOf(), { customer: ['c1'] })) as PartsData;
    expect(byCustomer.slices.map((slice) => slice.key)).toEqual(['new', 'done']);
    expect(byCustomer.slices.reduce((sum, slice) => sum + slice.value, 0)).toBe(2);
    const both = (await run('hs.status', scopeOf(), {
      status: ['done'],
      customer: ['c2'],
    })) as PartsData;
    expect(both.slices).toEqual([{ key: 'done', label: 'Selesai', value: 1 }]);
  });
});

describe('hs.trend', () => {
  test('titik berurutan naik per hari; Dibuat memakai created_at, Selesai memakai completed_at', async () => {
    await seedHandover(env, { id: 'h1', createdAt: '2026-11-11T03:00:00.000Z' });
    await seedHandover(env, {
      id: 'h2',
      createdAt: '2026-11-11T04:00:00.000Z',
      boardStatus: 'done',
      completedAt: '2026-11-13T04:00:00.000Z',
    });
    const data = (await run('hs.trend')) as SeriesData;
    expect(data.kind).toBe('series');
    expect(data.bucket).toBe('day');
    expect(data.points.map((point) => point.key)).toEqual([
      '2026-11-10',
      '2026-11-11',
      '2026-11-12',
      '2026-11-13',
      '2026-11-14',
      '2026-11-15',
      '2026-11-16',
    ]);
    const created = data.series.find((series) => series.key === 'created');
    const completed = data.series.find((series) => series.key === 'completed');
    expect(created?.label).toBe('Dibuat');
    expect(completed?.label).toBe('Selesai');
    expect(created?.values).toEqual([0, 2, 0, 0, 0, 0, 0]);
    expect(completed?.values).toEqual([0, 0, 0, 1, 0, 0, 0]);
  });

  test('tanpa lokasi: deret nol dengan titik tetap lengkap', async () => {
    const data = (await run('hs.trend', scopeOf({ handoverLocationIds: [] }))) as SeriesData;
    expect(data.points.length).toBe(7);
    for (const series of data.series) expect(series.values).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });
});

describe('hs.byLocation dan hs.byCustomer', () => {
  test('per lokasi dengan nama lokasi', async () => {
    await seedHandover(env, { id: 'h1', createdAt: IN_RANGE, locationId: 'loc-a' });
    await seedHandover(env, { id: 'h2', createdAt: IN_RANGE, locationId: 'loc-a' });
    await seedHandover(env, { id: 'h3', createdAt: IN_RANGE, locationId: 'loc-b' });
    const data = (await run('hs.byLocation')) as PartsData;
    expect(data.slices).toEqual([
      { key: 'loc-a', label: 'Lokasi A', value: 2 },
      { key: 'loc-b', label: 'Lokasi B', value: 1 },
    ]);
  });

  test('10 customer teratas, urut jumlah menurun', async () => {
    for (let customer = 1; customer <= 12; customer += 1) {
      for (let count = 0; count < customer; count += 1) {
        await seedHandover(env, {
          id: `h-${customer}-${count}`,
          createdAt: IN_RANGE,
          customerId: `c${customer}`,
          customerName: `Customer ${customer}`,
        });
      }
    }
    const data = (await run('hs.byCustomer')) as PartsData;
    expect(data.slices.length).toBe(10);
    expect(data.slices[0]).toEqual({ key: 'c12', label: 'Customer 12', value: 12 });
    expect(data.slices[9]?.value).toBe(3);
  });
});

describe('hs.avgDuration', () => {
  test('rata-rata jam dari task selesai dalam rentang', async () => {
    await seedHandover(env, {
      id: 'h1',
      createdAt: '2026-11-11T01:00:00.000Z',
      completedAt: '2026-11-11T03:00:00.000Z',
      boardStatus: 'done',
    });
    await seedHandover(env, {
      id: 'h2',
      createdAt: '2026-11-12T01:00:00.000Z',
      completedAt: '2026-11-12T05:00:00.000Z',
      boardStatus: 'done',
    });
    // Selesai di luar rentang tidak ikut.
    await seedHandover(env, {
      id: 'h3',
      createdAt: '2026-11-01T01:00:00.000Z',
      completedAt: '2026-11-02T01:00:00.000Z',
      boardStatus: 'done',
    });
    expect(((await run('hs.avgDuration')) as NumberData).value).toBe(3);
  });

  test('tanpa task selesai = 0', async () => {
    expect(((await run('hs.avgDuration')) as NumberData).value).toBe(0);
  });
});

describe('hs.oldest', () => {
  test('10 task aktif terlama dengan total seluruh aktif; kolom persis sama dengan registry', async () => {
    for (let index = 1; index <= 12; index += 1) {
      await seedHandover(env, {
        id: `h${index}`,
        number: `ST-${String(index).padStart(3, '0')}`,
        // h1 paling lama.
        createdAt: `2026-11-${String(index).padStart(2, '0')}T03:00:00.000Z`,
        customerId: 'c1',
        customerName: 'Satu',
        locationId: 'loc-a',
        checkedCount: 2,
        totalCount: 5,
      });
    }
    await seedHandover(env, {
      id: 'sel',
      createdAt: '2026-10-01T03:00:00.000Z',
      boardStatus: 'done',
    });
    const data = (await run(
      'hs.oldest',
      scopeOf({}, { from: '2026-11-10', to: '2026-11-16' }),
    )) as ListData;
    expect(data.kind).toBe('list');
    expect(data.total).toBe(12);
    expect(data.rows.length).toBe(10);
    expect(data.rows[0]?.number).toBe('ST-001');
    expect(data.rows[9]?.number).toBe('ST-010');
    const columns = widgetMeta('hs.oldest').listColumns ?? [];
    expect(data.columns).toEqual([...columns]);
    for (const row of data.rows) {
      expect(Object.keys(row).sort()).toEqual(columns.map((column) => column.key).sort());
    }
    expect(data.rows[0]).toMatchObject({
      customer: 'Satu',
      location: 'Lokasi A',
      progress: '2/5',
      age: 15,
    });
  });

  test('tanpa lokasi: kosong', async () => {
    await seedHandover(env, { id: 'h1', createdAt: IN_RANGE });
    const data = (await run('hs.oldest', scopeOf({ handoverLocationIds: [] }))) as ListData;
    expect(data.rows).toEqual([]);
    expect(data.total).toBe(0);
  });

  test('mematuhi filter customer dan status', async () => {
    await seedHandover(env, {
      id: 'h1',
      createdAt: IN_RANGE,
      customerId: 'c1',
      customerName: 'Satu',
    });
    await seedHandover(env, {
      id: 'h2',
      createdAt: IN_RANGE,
      customerId: 'c2',
      customerName: 'Dua',
    });
    const data = (await run('hs.oldest', scopeOf(), { customer: ['c2'] })) as ListData;
    expect(data.rows.map((row) => row.customer)).toEqual(['Dua']);
    expect(data.total).toBe(1);
  });
});
