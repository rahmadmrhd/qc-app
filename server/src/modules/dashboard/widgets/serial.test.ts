import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { seedBusinessUnit, seedLocation } from '@server-test/access-fixtures';
import { testScope } from '@server-test/dashboard-scope';
import { type SeedSerialRow, seedSerial } from '@server-test/dashboard-seed';
import { seedBrand, seedItem } from '@server-test/item-fixtures';
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
import { SERIAL_WIDGETS } from './serial';

setDefaultTimeout(60_000);

let env: TestEnv;

const RANGE: DashboardRange = { from: '2026-11-10', to: '2026-11-16' };
const IN_RANGE = '2026-11-12T03:00:00.000Z';
const IDS: WidgetId[] = [
  'sn.recorded',
  'sn.status',
  'sn.trend',
  'sn.byItem',
  'sn.byBu',
  'sn.custody',
  'sn.transit',
];

/** Serial uji: bawaan BU `bu-x` (dalam `buIds` bawaan `scopeOf`). */
const seed = (db: TestEnv, row: SeedSerialRow) => seedSerial(db, { buId: 'bu-x', ...row });

function scopeOf(overrides: Partial<ResolvedScope> = {}, range: DashboardRange = RANGE) {
  return testScope(range, { buIds: ['bu-x', 'bu-y'], ...overrides });
}

async function run(
  id: WidgetId,
  scope: ResolvedScope = scopeOf(),
  filters: Record<string, string[]> = {},
): Promise<WidgetData> {
  const impl = SERIAL_WIDGETS.find((widget) => widget.id === id);
  if (!impl) throw new Error(`Widget ${id} belum terdaftar`);
  return impl.run({ env, db: env.DB, scope, filters });
}

beforeEach(async () => {
  env = await createTestEnv();
  await seedLocation(env, { id: 'loc-a', code: 'A', name: 'Lokasi A' });
  await seedLocation(env, { id: 'loc-b', code: 'B', name: 'Lokasi B' });
  await seedBusinessUnit(env, { id: 'bu-x', code: 'X', name: 'BU X' });
  await seedBusinessUnit(env, { id: 'bu-y', code: 'Y', name: 'BU Y' });
  await seedBrand(env, 'Merk');
  await seedItem(env, { id: 'i-1', brand: 'Merk', model: 'Satu', businessUnitIds: ['bu-x'] });
  await seedItem(env, { id: 'i-2', brand: 'Merk', model: 'Dua', businessUnitIds: ['bu-x'] });
});

test('SERIAL_WIDGETS mencakup tepat tujuh widget grup Serial Number', () => {
  expect(SERIAL_WIDGETS.map((widget) => widget.id).sort()).toEqual([...IDS].sort());
});

describe('sn.recorded', () => {
  test('menghitung serial dicatat dalam rentang beserta periode sebelumnya', async () => {
    await seed(env, { id: 's1', createdAt: IN_RANGE });
    await seed(env, { id: 's2', createdAt: IN_RANGE, buId: 'bu-y' });
    await seed(env, { id: 's3', createdAt: '2026-11-20T03:00:00.000Z' });
    await seed(env, { id: 'p1', createdAt: '2026-11-04T03:00:00.000Z' });
    expect(await run('sn.recorded')).toEqual({ kind: 'number', value: 2, previous: 1 });
  });

  test('serial yang sudah pindah BU hanya terhitung di BU sekarang; terhapus tidak terhitung', async () => {
    await seed(env, { id: 's1', createdAt: IN_RANGE, buId: 'bu-y' });
    // Riwayat: dulu di BU X (sudah ditinggalkan).
    await env.DB.prepare(
      "INSERT INTO serial_business_units (serial_id, bu_id, first_at, left_at) VALUES ('s1', 'bu-x', '2026-11-01T00:00:00.000Z', '2026-11-05T00:00:00.000Z')",
    ).run();
    await seed(env, {
      id: 's2',
      createdAt: IN_RANGE,
      deletedAt: '2026-11-13T00:00:00.000Z',
    });
    expect(((await run('sn.recorded', scopeOf({ buIds: ['bu-x'] }))) as NumberData).value).toBe(0);
    expect(((await run('sn.recorded', scopeOf({ buIds: ['bu-y'] }))) as NumberData).value).toBe(1);
    expect(
      ((await run('sn.recorded', scopeOf({ buIds: ['bu-x', 'bu-y'] }))) as NumberData).value,
    ).toBe(1);
  });

  test('00:30 WIB 18 Nov masuk hari 18 Nov', async () => {
    await seed(env, { id: 's1', createdAt: '2026-11-17T17:30:00.000Z' });
    const on18 = scopeOf({}, { from: '2026-11-18', to: '2026-11-18' });
    const on17 = scopeOf({}, { from: '2026-11-17', to: '2026-11-17' });
    expect(((await run('sn.recorded', on18)) as NumberData).value).toBe(1);
    expect(((await run('sn.recorded', on17)) as NumberData).value).toBe(0);
  });

  test('filter lokasi: null = semua, daftar = hanya lokasi itu, [] = tidak ada', async () => {
    await seed(env, { id: 's1', createdAt: IN_RANGE, locationId: 'loc-a' });
    await seed(env, { id: 's2', createdAt: IN_RANGE, locationId: 'loc-b' });
    expect(
      ((await run('sn.recorded', scopeOf({ serialLocationIds: null }))) as NumberData).value,
    ).toBe(2);
    expect(
      ((await run('sn.recorded', scopeOf({ serialLocationIds: ['loc-a'] }))) as NumberData).value,
    ).toBe(1);
    expect(
      ((await run('sn.recorded', scopeOf({ serialLocationIds: [] }))) as NumberData).value,
    ).toBe(0);
  });
});

describe('semua widget Serial dengan buIds kosong', () => {
  test('hasilnya nol tanpa membaca data BU lain', async () => {
    await seed(env, {
      id: 's1',
      createdAt: IN_RANGE,
      custody: 'transit',
      transitToLocationId: 'loc-b',
      transitOn: '2026-11-11',
    });
    const scope = scopeOf({ buIds: [] });
    expect(await run('sn.recorded', scope)).toEqual({ kind: 'number', value: 0, previous: 0 });
    for (const id of ['sn.status', 'sn.byItem', 'sn.byBu', 'sn.custody'] as const) {
      expect(((await run(id, scope)) as PartsData).slices, id).toEqual([]);
    }
    const trend = (await run('sn.trend', scope)) as SeriesData;
    expect(trend.series.flatMap((series) => series.values).every((value) => value === 0)).toBe(
      true,
    );
    expect(((await run('sn.transit', scope)) as ListData).rows).toEqual([]);
    expect(((await run('sn.transit', scope)) as ListData).total).toBe(0);
  });
});

describe('sn.status dan sn.custody', () => {
  beforeEach(async () => {
    await seed(env, { id: 's1', createdAt: IN_RANGE });
    await seed(env, { id: 's2', createdAt: IN_RANGE, status: 'reported', itemId: 'i-2' });
    await seed(env, {
      id: 's3',
      createdAt: IN_RANGE,
      status: 'at_service',
      custody: 'transit',
      itemId: 'i-2',
    });
    await seed(env, { id: 's4', createdAt: IN_RANGE, status: 'at_service', custody: 'service' });
  });

  test('komposisi status dengan label dari shared/serials, urut menurut daftar status', async () => {
    const data = (await run('sn.status')) as PartsData;
    expect(data.slices).toEqual([
      { key: 'good', label: 'Lolos', value: 1 },
      { key: 'reported', label: 'Dilaporkan', value: 1 },
      { key: 'at_service', label: 'Di servis', value: 2 },
    ]);
  });

  test('mematuhi filter custody dan item', async () => {
    const byCustody = (await run('sn.status', scopeOf(), { custody: ['transit'] })) as PartsData;
    expect(byCustody.slices).toEqual([{ key: 'at_service', label: 'Di servis', value: 1 }]);
    const byItem = (await run('sn.status', scopeOf(), { item: ['i-2'] })) as PartsData;
    expect(byItem.slices.reduce((sum, slice) => sum + slice.value, 0)).toBe(2);
    const byStatus = (await run('sn.custody', scopeOf(), { status: ['at_service'] })) as PartsData;
    expect(byStatus.slices).toEqual([
      { key: 'transit', label: 'Dalam pengiriman', value: 1 },
      { key: 'service', label: 'Servis', value: 1 },
    ]);
  });

  test('sn.custody: label QC, Dalam pengiriman, Servis', async () => {
    const data = (await run('sn.custody')) as PartsData;
    expect(data.slices).toEqual([
      { key: 'qc', label: 'QC', value: 2 },
      { key: 'transit', label: 'Dalam pengiriman', value: 1 },
      { key: 'service', label: 'Servis', value: 1 },
    ]);
  });
});

describe('sn.trend, sn.byItem, sn.byBu', () => {
  test('tren harian: titik naik berurutan, nilai per hari WIB', async () => {
    await seed(env, { id: 's1', createdAt: '2026-11-11T03:00:00.000Z' });
    await seed(env, { id: 's2', createdAt: '2026-11-11T05:00:00.000Z' });
    await seed(env, { id: 's3', createdAt: '2026-11-13T03:00:00.000Z' });
    const data = (await run('sn.trend')) as SeriesData;
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
    expect(data.series).toEqual([
      { key: 'recorded', label: 'Dicatat', values: [0, 2, 0, 1, 0, 0, 0] },
    ]);
  });

  test('sn.byItem: item teratas dengan nama merk dan tipe', async () => {
    await seed(env, { id: 's1', createdAt: IN_RANGE, itemId: 'i-1' });
    await seed(env, { id: 's2', createdAt: IN_RANGE, itemId: 'i-2' });
    await seed(env, { id: 's3', createdAt: IN_RANGE, itemId: 'i-2' });
    const data = (await run('sn.byItem')) as PartsData;
    expect(data.slices).toEqual([
      { key: 'i-2', label: 'Merk Dua', value: 2 },
      { key: 'i-1', label: 'Merk Satu', value: 1 },
    ]);
  });

  test('sn.byItem: paling banyak 10 item', async () => {
    for (let index = 1; index <= 12; index += 1) {
      await seedItem(env, {
        id: `ix-${index}`,
        brand: 'Merk',
        model: `Tipe ${index}`,
        businessUnitIds: ['bu-x'],
      });
      await seed(env, { id: `sx-${index}`, createdAt: IN_RANGE, itemId: `ix-${index}` });
    }
    expect(((await run('sn.byItem')) as PartsData).slices.length).toBe(10);
  });

  test('sn.byBu: hanya BU dalam buIds', async () => {
    await seedBusinessUnit(env, { id: 'bu-z', code: 'Z', name: 'BU Z' });
    await seed(env, { id: 's1', createdAt: IN_RANGE, buId: 'bu-x' });
    await seed(env, { id: 's2', createdAt: IN_RANGE, buId: 'bu-y' });
    await seed(env, { id: 's3', createdAt: IN_RANGE, buId: 'bu-y' });
    await seed(env, { id: 's4', createdAt: IN_RANGE, buId: 'bu-z' });
    const data = (await run('sn.byBu')) as PartsData;
    expect(data.slices).toEqual([
      { key: 'bu-y', label: 'BU Y', value: 2 },
      { key: 'bu-x', label: 'BU X', value: 1 },
    ]);
  });
});

describe('sn.transit', () => {
  test('hanya serial dalam pengiriman, tanpa rentang; kolom persis sama dengan registry', async () => {
    await seed(env, {
      id: 's1',
      serial: 'SN-LAMA',
      createdAt: '2026-01-01T03:00:00.000Z',
      custody: 'transit',
      locationId: 'loc-a',
      transitFromLocationId: 'loc-a',
      transitToLocationId: 'loc-b',
      transitOn: '2026-11-10',
      itemId: 'i-1',
    });
    await seed(env, {
      id: 's2',
      serial: 'SN-BARU',
      createdAt: IN_RANGE,
      custody: 'transit',
      locationId: 'loc-a',
      transitFromLocationId: 'loc-a',
      transitToLocationId: 'loc-b',
      transitOn: '2026-11-14',
    });
    await seed(env, { id: 's3', createdAt: IN_RANGE });
    await seed(env, {
      id: 's4',
      createdAt: IN_RANGE,
      custody: 'transit',
      transitToLocationId: 'loc-b',
      transitOn: '2026-11-12',
      deletedAt: '2026-11-13T00:00:00.000Z',
    });
    const data = (await run('sn.transit')) as ListData;
    expect(data.total).toBe(2);
    expect(data.rows.map((row) => row.serial)).toEqual(['SN-LAMA', 'SN-BARU']);
    expect(data.rows[0]).toEqual({
      serial: 'SN-LAMA',
      item: 'Merk Satu',
      route: 'Lokasi A → Lokasi B',
      days: 6,
    });
    expect(data.columns).toEqual([...(widgetMeta('sn.transit').listColumns ?? [])]);
  });

  test('filter lokasi mencocokkan lokasi asal ATAU tujuan', async () => {
    await seed(env, {
      id: 's1',
      createdAt: IN_RANGE,
      custody: 'transit',
      locationId: 'loc-b',
      transitFromLocationId: 'loc-b',
      transitToLocationId: 'loc-a',
      transitOn: '2026-11-12',
    });
    await seed(env, {
      id: 's2',
      createdAt: IN_RANGE,
      custody: 'transit',
      locationId: 'loc-b',
      transitFromLocationId: 'loc-b',
      transitToLocationId: 'loc-b',
      transitOn: '2026-11-12',
    });
    const toA = (await run('sn.transit', scopeOf({ serialLocationIds: ['loc-a'] }))) as ListData;
    expect(toA.total).toBe(1);
    const fromB = (await run('sn.transit', scopeOf({ serialLocationIds: ['loc-b'] }))) as ListData;
    expect(fromB.total).toBe(2);
    const none = (await run(
      'sn.transit',
      scopeOf({ serialLocationIds: ['loc-lain'] }),
    )) as ListData;
    expect(none.total).toBe(0);
  });

  test('maksimal 10 baris dengan total seluruhnya', async () => {
    for (let index = 1; index <= 12; index += 1) {
      await seed(env, {
        id: `t${index}`,
        createdAt: IN_RANGE,
        custody: 'transit',
        transitToLocationId: 'loc-b',
        transitOn: `2026-11-${String(index).padStart(2, '0')}`,
      });
    }
    const data = (await run('sn.transit')) as ListData;
    expect(data.rows.length).toBe(10);
    expect(data.total).toBe(12);
  });
});
