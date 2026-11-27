import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { seedBusinessUnit, seedLocation } from '@server-test/access-fixtures';
import { testScope } from '@server-test/dashboard-scope';
import { type SeedSerialRow, seedSerial } from '@server-test/dashboard-seed';
import { seedBrand, seedItem } from '@server-test/item-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import type {
  DashboardRange,
  ListData,
  PartsData,
  SeriesData,
  WidgetData,
  WidgetId,
} from '@shared/dashboard';
import { widgetMeta } from '@shared/dashboard';
import type { ResolvedScope } from '../scope';
import { AVG_MINUTES_WORK_HOURS, averageMinutes, SERIAL_WIDGETS } from './serial';

setDefaultTimeout(60_000);

let env: TestEnv;

const RANGE: DashboardRange = { from: '2026-11-10', to: '2026-11-16' };
const IN_RANGE = '2026-11-12T03:00:00.000Z';
const IDS: WidgetId[] = [
  'sn.total',
  'sn.avgMinutes',
  'sn.trend',
  'sn.status',
  'sn.byBu',
  'sn.byBrand',
  'sn.byItem',
  'sn.latest',
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

const total = (data: WidgetData): number =>
  (data as PartsData).slices.reduce((sum, slice) => sum + slice.value, 0);

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

test('SERIAL_WIDGETS mencakup tepat delapan widget grup Serial Number', () => {
  expect(SERIAL_WIDGETS.map((widget) => widget.id).sort()).toEqual([...IDS].sort());
});

describe('sn.total dan sn.avgMinutes', () => {
  test('sn.total menghitung serial periode ini dan periode sebelumnya', async () => {
    await seed(env, { id: 's1', createdAt: IN_RANGE });
    await seed(env, { id: 's2', createdAt: IN_RANGE });
    await seed(env, { id: 's3', createdAt: '2026-11-05T03:00:00.000Z' });
    expect(await run('sn.total')).toMatchObject({ kind: 'number', value: 2, previous: 1 });
  });

  test('sn.avgMinutes = jam kerja x 60 x hari aktif / jumlah serial; tanpa serial = 0', async () => {
    expect(AVG_MINUTES_WORK_HOURS).toBe(4);
    expect(averageMinutes(0, 0)).toBe(0);
    expect(averageMinutes(5, 0)).toBe(0);
    expect(averageMinutes(240, 1)).toBe(1);
    expect(averageMinutes(7, 1)).toBe(34.3);
    expect(averageMinutes(10, 3)).toBe(72);
  });

  test('sn.avgMinutes menghitung hanya hari yang punya unit, dan memberi keterangan total hari', async () => {
    // Dua unit pada satu hari: 240 x 1 / 2 = 120 menit, 1 hari.
    await seed(env, { id: 's1', createdAt: IN_RANGE });
    await seed(env, { id: 's2', createdAt: IN_RANGE });
    expect(await run('sn.avgMinutes')).toMatchObject({
      kind: 'number',
      value: 120,
      note: '1 hari',
    });
    // Tambah satu unit di hari lain dalam rentang (3 unit, 2 hari): 240 x 2 / 3 = 160. Hari tanpa unit tak dihitung.
    await seed(env, { id: 's3', createdAt: '2026-11-14T03:00:00.000Z' });
    expect(await run('sn.avgMinutes')).toMatchObject({ value: 160, note: '2 hari' });
    // Pergantian hari memakai WIB: 17:30 UTC tanggal 14 = 00:30 WIB tanggal 15, jadi hari ketiga.
    await seed(env, { id: 's4', createdAt: '2026-11-14T17:30:00.000Z' });
    expect(await run('sn.avgMinutes')).toMatchObject({ value: 180, note: '3 hari' });
  });

  test('sn.avgMinutes tanpa serial atau tanpa cakupan = 0 dengan keterangan 0 hari', async () => {
    expect(await run('sn.avgMinutes')).toMatchObject({ value: 0, note: '0 hari' });
    await seed(env, { id: 's1', createdAt: IN_RANGE });
    expect(await run('sn.avgMinutes', scopeOf({ buIds: [] }))).toMatchObject({
      value: 0,
      note: '0 hari',
    });
  });
});

describe('cakupan: rentang, BU, lokasi (lewat sn.status)', () => {
  test('hanya serial dicatat dalam rentang', async () => {
    await seed(env, { id: 's1', createdAt: IN_RANGE });
    await seed(env, { id: 's2', createdAt: IN_RANGE, buId: 'bu-y' });
    await seed(env, { id: 's3', createdAt: '2026-11-20T03:00:00.000Z' });
    expect(total(await run('sn.status'))).toBe(2);
  });

  test('serial yang sudah pindah BU hanya terhitung di BU sekarang; terhapus tidak terhitung', async () => {
    await seed(env, { id: 's1', createdAt: IN_RANGE, buId: 'bu-y' });
    await env.DB.prepare(
      "INSERT INTO serial_business_units (serial_id, bu_id, first_at, left_at) VALUES ('s1', 'bu-x', '2026-11-01T00:00:00.000Z', '2026-11-05T00:00:00.000Z')",
    ).run();
    await seed(env, { id: 's2', createdAt: IN_RANGE, deletedAt: '2026-11-13T00:00:00.000Z' });
    expect(total(await run('sn.status', scopeOf({ buIds: ['bu-x'] })))).toBe(0);
    expect(total(await run('sn.status', scopeOf({ buIds: ['bu-y'] })))).toBe(1);
    expect(total(await run('sn.status', scopeOf({ buIds: ['bu-x', 'bu-y'] })))).toBe(1);
  });

  test('00:30 WIB 18 Nov masuk hari 18 Nov', async () => {
    await seed(env, { id: 's1', createdAt: '2026-11-17T17:30:00.000Z' });
    const on18 = scopeOf({}, { from: '2026-11-18', to: '2026-11-18' });
    const on17 = scopeOf({}, { from: '2026-11-17', to: '2026-11-17' });
    expect(total(await run('sn.status', on18))).toBe(1);
    expect(total(await run('sn.status', on17))).toBe(0);
  });

  test('filter lokasi: null = semua, daftar = hanya lokasi itu, [] = tidak ada', async () => {
    await seed(env, { id: 's1', createdAt: IN_RANGE, locationId: 'loc-a' });
    await seed(env, { id: 's2', createdAt: IN_RANGE, locationId: 'loc-b' });
    expect(total(await run('sn.status', scopeOf({ serialLocationIds: null })))).toBe(2);
    expect(total(await run('sn.status', scopeOf({ serialLocationIds: ['loc-a'] })))).toBe(1);
    expect(total(await run('sn.status', scopeOf({ serialLocationIds: [] })))).toBe(0);
  });
});

describe('semua widget Serial dengan buIds kosong', () => {
  test('hasilnya nol tanpa membaca data BU lain', async () => {
    await seed(env, { id: 's1', createdAt: IN_RANGE });
    const scope = scopeOf({ buIds: [] });
    for (const id of ['sn.status', 'sn.byBu', 'sn.byBrand', 'sn.byItem'] as const) {
      expect(((await run(id, scope)) as PartsData).slices, id).toEqual([]);
    }
    const trend = (await run('sn.trend', scope)) as SeriesData;
    expect(trend.series.flatMap((series) => series.values).every((value) => value === 0)).toBe(
      true,
    );
    const latest = (await run('sn.latest', scope)) as ListData;
    expect(latest.rows).toEqual([]);
    expect(latest.total).toBe(0);
  });
});

describe('sn.status', () => {
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
    expect(total(byItem)).toBe(2);
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

describe('brand: widget dan filter', () => {
  beforeEach(async () => {
    await seedBrand(env, 'Lain');
    await seedItem(env, { id: 'i-3', brand: 'Lain', model: 'Tiga', businessUnitIds: ['bu-x'] });
    await seed(env, { id: 's1', createdAt: IN_RANGE, itemId: 'i-1' });
    await seed(env, { id: 's2', createdAt: IN_RANGE, itemId: 'i-2' });
    await seed(env, { id: 's3', createdAt: IN_RANGE, itemId: 'i-3' });
  });

  test('sn.byBrand: jumlah serial per brand, terbanyak dulu', async () => {
    const data = (await run('sn.byBrand')) as PartsData;
    expect(data.slices.map((slice) => [slice.label, slice.value])).toEqual([
      ['Merk', 2],
      ['Lain', 1],
    ]);
  });

  test('filter brand menyaring semua widget grup Serial', async () => {
    const brandId = ((await run('sn.byBrand')) as PartsData).slices.find(
      (slice) => slice.label === 'Lain',
    )?.key;
    expect(brandId).toBeTruthy();
    const filters = { brand: [brandId as string] };
    expect(total(await run('sn.status', scopeOf(), filters))).toBe(1);
    expect(total(await run('sn.byBu', scopeOf(), filters))).toBe(1);
    expect(((await run('sn.byBrand', scopeOf(), filters)) as PartsData).slices.length).toBe(1);
    expect(((await run('sn.latest', scopeOf(), filters)) as ListData).total).toBe(1);
  });
});

describe('sn.latest', () => {
  test('dikelompokkan per item, tanggal catat (WIB), dan pencatat; terbaru dulu', async () => {
    await seed(env, {
      id: 's1',
      createdAt: '2026-11-11T03:00:00.000Z',
      itemId: 'i-1',
      createdBy: 'a@x.id',
    });
    await seed(env, {
      id: 's2',
      createdAt: '2026-11-11T04:00:00.000Z',
      itemId: 'i-1',
      createdBy: 'a@x.id',
    });
    await seed(env, {
      id: 's3',
      createdAt: '2026-11-11T05:00:00.000Z',
      itemId: 'i-1',
      createdBy: 'b@x.id',
    });
    await seed(env, {
      id: 's4',
      createdAt: '2026-11-12T03:00:00.000Z',
      itemId: 'i-2',
      createdBy: 'a@x.id',
    });
    const data = (await run('sn.latest')) as ListData;
    expect(data.total).toBe(3);
    expect(data.rows).toEqual([
      { id: 'i-2', date: '2026-11-12', item: 'Merk Dua', count: 1, by: 'a@x.id' },
      { id: 'i-1', date: '2026-11-11', item: 'Merk Satu', count: 1, by: 'b@x.id' },
      { id: 'i-1', date: '2026-11-11', item: 'Merk Satu', count: 2, by: 'a@x.id' },
    ]);
    expect(data.columns).toEqual([...(widgetMeta('sn.latest').listColumns ?? [])]);
  });

  test('maksimal 15 baris dengan total seluruh kelompok', async () => {
    for (let index = 1; index <= 17; index += 1) {
      await seed(env, {
        id: `l${index}`,
        createdAt: `2026-11-${String(10 + (index % 7)).padStart(2, '0')}T03:00:00.000Z`,
        itemId: index % 2 ? 'i-1' : 'i-2',
        createdBy: `u${index}@x.id`,
      });
    }
    const data = (await run('sn.latest')) as ListData;
    expect(data.rows.length).toBe(15);
    expect(data.total).toBe(17);
  });
});
