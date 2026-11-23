import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { seedLocation } from '@server-test/access-fixtures';
import { testScope } from '@server-test/dashboard-scope';
import { seedStock } from '@server-test/dashboard-seed';
import { seedSticker, seedStickerType } from '@server-test/sticker-fixtures';
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
import { STICKER_WIDGETS } from './sticker';

setDefaultTimeout(60_000);

let env: TestEnv;

const RANGE: DashboardRange = { from: '2026-11-10', to: '2026-11-16' };
const IDS: WidgetId[] = ['st.out', 'st.low', 'st.attention', 'st.movement', 'st.byType'];

function scopeOf(overrides: Partial<ResolvedScope> = {}, range: DashboardRange = RANGE) {
  return testScope(range, { stockLocationIds: ['loc-a', 'loc-b'], ...overrides });
}

async function run(
  id: WidgetId,
  scope: ResolvedScope = scopeOf(),
  filters: Record<string, string[]> = {},
): Promise<WidgetData> {
  const impl = STICKER_WIDGETS.find((widget) => widget.id === id);
  if (!impl) throw new Error(`Widget ${id} belum terdaftar`);
  return impl.run({ env, db: env.DB, scope, filters });
}

const value = async (id: WidgetId, scope?: ResolvedScope, filters?: Record<string, string[]>) =>
  ((await run(id, scope, filters)) as NumberData).value;

async function softDeleteSticker(id: string): Promise<void> {
  await env.DB.prepare("UPDATE stickers SET deleted_at = '2026-11-13T00:00:00.000Z' WHERE id = ?")
    .bind(id)
    .run();
}

beforeEach(async () => {
  env = await createTestEnv();
  await seedLocation(env, { id: 'loc-a', code: 'A', name: 'Lokasi A' });
  await seedLocation(env, { id: 'loc-b', code: 'B', name: 'Lokasi B' });
  await seedStickerType(env, { id: 't1', name: 'Jenis 1', rule: 'none' });
  await seedStickerType(env, { id: 't2', name: 'Jenis 2', rule: 'none' });
});

test('STICKER_WIDGETS mencakup tepat lima widget grup Stok Stiker', () => {
  expect(STICKER_WIDGETS.map((widget) => widget.id).sort()).toEqual([...IDS].sort());
});

describe('st.out dan st.low', () => {
  test('stiker tanpa baris stok di lokasi A tidak dihitung habis di A', async () => {
    await seedSticker(env, { id: 's1', typeId: 't1', minQty: 10 });
    await seedSticker(env, { id: 's2', typeId: 't1', minQty: 10 });
    await seedStock(env, { stickerId: 's1', locationId: 'loc-a', qty: 0 });
    await seedStock(env, { stickerId: 's2', locationId: 'loc-b', qty: 0 });
    expect(await value('st.out', scopeOf({ stockLocationIds: ['loc-a'] }))).toBe(1);
    expect(await value('st.out', scopeOf({ stockLocationIds: ['loc-b'] }))).toBe(1);
    expect(await value('st.out')).toBe(2);
  });

  test('stiker nonaktif, usang, dan terhapus tidak dihitung', async () => {
    await seedSticker(env, { id: 's1', typeId: 't1' });
    await seedSticker(env, { id: 's2', typeId: 't1', status: 'inactive' });
    await seedSticker(env, { id: 's3', typeId: 't1', status: 'deprecated' });
    await seedSticker(env, { id: 's4', typeId: 't1' });
    for (const id of ['s1', 's2', 's3', 's4'])
      await seedStock(env, { stickerId: id, locationId: 'loc-a', qty: 0 });
    await softDeleteSticker('s4');
    expect(await value('st.out')).toBe(1);
  });

  test('menipis dihitung per pasangan stiker x lokasi; cakupan lokasi menyaring', async () => {
    await seedSticker(env, { id: 's1', typeId: 't1', minQty: 10 });
    await seedStock(env, { stickerId: 's1', locationId: 'loc-a', qty: 8 });
    await seedStock(env, { stickerId: 's1', locationId: 'loc-b', qty: 50 });
    expect(await value('st.low')).toBe(1);
    expect(await value('st.low', scopeOf({ stockLocationIds: ['loc-b'] }))).toBe(0);
    const attention = (await run(
      'st.attention',
      scopeOf({ stockLocationIds: ['loc-b'] }),
    )) as ListData;
    expect(attention.rows).toEqual([]);
    expect(attention.total).toBe(0);
  });

  test('qty 0 dan negatif = habis; minimum 0 tak pernah menipis; batas minimum termasuk', async () => {
    await seedSticker(env, { id: 's1', typeId: 't1', minQty: 0 });
    await seedSticker(env, { id: 's2', typeId: 't1', minQty: 0 });
    await seedSticker(env, { id: 's3', typeId: 't1', minQty: 10 });
    await seedSticker(env, { id: 's4', typeId: 't1', minQty: 10 });
    await seedStock(env, { stickerId: 's1', locationId: 'loc-a', qty: 0 });
    await seedStock(env, { stickerId: 's2', locationId: 'loc-a', qty: -4 });
    await seedStock(env, { stickerId: 's3', locationId: 'loc-a', qty: 10 });
    await seedStock(env, { stickerId: 's4', locationId: 'loc-a', qty: 11 });
    expect(await value('st.out')).toBe(2);
    expect(await value('st.low')).toBe(1);
  });

  test('stockLocationIds kosong: nol tanpa SQL', async () => {
    await seedSticker(env, { id: 's1', typeId: 't1', minQty: 10 });
    await seedStock(env, { stickerId: 's1', locationId: 'loc-a', qty: 0 });
    const empty = scopeOf({ stockLocationIds: [] });
    expect(await value('st.out', empty)).toBe(0);
    expect(await value('st.low', empty)).toBe(0);
    expect(((await run('st.attention', empty)) as ListData).rows).toEqual([]);
    expect(((await run('st.byType', empty)) as PartsData).slices).toEqual([]);
  });

  test('filter grup sticker dan stickerType', async () => {
    await seedSticker(env, { id: 's1', typeId: 't1' });
    await seedSticker(env, { id: 's2', typeId: 't2' });
    await seedStock(env, { stickerId: 's1', locationId: 'loc-a', qty: 0 });
    await seedStock(env, { stickerId: 's2', locationId: 'loc-a', qty: 0 });
    expect(await value('st.out', scopeOf(), { stickerType: ['t2'] })).toBe(1);
    expect(await value('st.out', scopeOf(), { sticker: ['s1'] })).toBe(1);
    expect(await value('st.out', scopeOf(), { sticker: ['s1'], stickerType: ['t2'] })).toBe(0);
  });
});

describe('st.attention', () => {
  test('habis dahulu (paling kosong lebih dulu), lalu menipis; kolom persis registry', async () => {
    await seedSticker(env, { id: 'sa', typeId: 't1', name: 'Stiker A', minQty: 10 });
    await seedSticker(env, { id: 'sb', typeId: 't2', name: 'Stiker B' });
    await seedSticker(env, { id: 'sc', typeId: 't1', name: 'Stiker C' });
    await seedSticker(env, { id: 'sd', typeId: 't1', name: 'Stiker D', minQty: 10 });
    await seedStock(env, { stickerId: 'sa', locationId: 'loc-a', qty: 5 });
    await seedStock(env, { stickerId: 'sb', locationId: 'loc-a', qty: 0 });
    await seedStock(env, { stickerId: 'sc', locationId: 'loc-a', qty: -3 });
    await seedStock(env, { stickerId: 'sd', locationId: 'loc-a', qty: 20 });
    const data = (await run('st.attention')) as ListData;
    expect(data.columns).toEqual([...(widgetMeta('st.attention').listColumns ?? [])]);
    expect(data.total).toBe(3);
    expect(data.rows).toEqual([
      { sticker: 'Stiker C', type: 'Jenis 1', location: 'Lokasi A', stock: -3, min: 0 },
      { sticker: 'Stiker B', type: 'Jenis 2', location: 'Lokasi A', stock: 0, min: 0 },
      { sticker: 'Stiker A', type: 'Jenis 1', location: 'Lokasi A', stock: 5, min: 10 },
    ]);
  });

  test('maksimal 10 baris, total tetap seluruhnya', async () => {
    for (let index = 1; index <= 12; index += 1) {
      await seedSticker(env, {
        id: `s${index}`,
        typeId: 't1',
        name: `S${String(index).padStart(2, '0')}`,
      });
      await seedStock(env, { stickerId: `s${index}`, locationId: 'loc-a', qty: 0 });
    }
    const data = (await run('st.attention')) as ListData;
    expect(data.rows.length).toBe(10);
    expect(data.total).toBe(12);
  });
});

describe('st.movement', () => {
  test('Masuk = in; Keluar = out dan entri serial (absolut); adjust/opname diabaikan; lokasi di luar cakupan tidak', async () => {
    await seedSticker(env, { id: 's1', typeId: 't1' });
    await seedStock(env, {
      stickerId: 's1',
      locationId: 'loc-a',
      qty: 100,
      entries: [
        { kind: 'in', delta: 10, ts: '2026-11-12T03:00:00.000Z' },
        { kind: 'out', delta: -3, ts: '2026-11-13T03:00:00.000Z' },
        { kind: 'serial', delta: -2, ts: '2026-11-13T05:00:00.000Z', serialId: 'sn1' },
        { kind: 'adjust', delta: 100, ts: '2026-11-12T03:00:00.000Z' },
        { kind: 'opname', delta: 50, ts: '2026-11-12T04:00:00.000Z' },
        { kind: 'in', delta: 7, ts: '2026-11-20T03:00:00.000Z' },
      ],
    });
    await seedStock(env, {
      stickerId: 's1',
      locationId: 'loc-b',
      qty: 100,
      entries: [{ kind: 'in', delta: 99, ts: '2026-11-12T03:00:00.000Z' }],
    });
    const data = (await run('st.movement', scopeOf({ stockLocationIds: ['loc-a'] }))) as SeriesData;
    expect(data.points.length).toBe(7);
    expect(data.series).toEqual([
      { key: 'in', label: 'Masuk', values: [0, 0, 10, 0, 0, 0, 0] },
      { key: 'out', label: 'Keluar', values: [0, 0, 0, 5, 0, 0, 0] },
    ]);
  });

  test('batas hari WIB: 17:30 UTC jatuh pada hari berikutnya', async () => {
    await seedSticker(env, { id: 's1', typeId: 't1' });
    await seedStock(env, {
      stickerId: 's1',
      locationId: 'loc-a',
      qty: 10,
      entries: [
        { kind: 'in', delta: 4, ts: '2026-11-17T17:30:00.000Z' },
        { kind: 'in', delta: 1, ts: '2026-11-17T16:59:00.000Z' },
      ],
    });
    const data = (await run(
      'st.movement',
      scopeOf({}, { from: '2026-11-17', to: '2026-11-18' }),
    )) as SeriesData;
    expect(data.series[0]?.values).toEqual([1, 4]);
  });

  test('stockLocationIds kosong: seri nol; stiker terhapus tidak dihitung', async () => {
    await seedSticker(env, { id: 's1', typeId: 't1' });
    await seedStock(env, {
      stickerId: 's1',
      locationId: 'loc-a',
      qty: 10,
      entries: [{ kind: 'in', delta: 4, ts: '2026-11-12T03:00:00.000Z' }],
    });
    const empty = (await run('st.movement', scopeOf({ stockLocationIds: [] }))) as SeriesData;
    expect(empty.series.map((series) => series.values.every((v) => v === 0))).toEqual([true, true]);
    await softDeleteSticker('s1');
    const deleted = (await run('st.movement')) as SeriesData;
    expect(deleted.series[0]?.values.every((v) => v === 0)).toBe(true);
  });
});

describe('st.byType', () => {
  test('total qty per jenis pada lokasi cakupan; nonaktif tidak dihitung; urut terbesar dahulu', async () => {
    await seedSticker(env, { id: 's1', typeId: 't1' });
    await seedSticker(env, { id: 's2', typeId: 't1' });
    await seedSticker(env, { id: 's3', typeId: 't2' });
    await seedSticker(env, { id: 's4', typeId: 't2', status: 'inactive' });
    await seedStock(env, { stickerId: 's1', locationId: 'loc-a', qty: 8 });
    await seedStock(env, { stickerId: 's2', locationId: 'loc-a', qty: 12 });
    await seedStock(env, { stickerId: 's3', locationId: 'loc-a', qty: 5 });
    await seedStock(env, { stickerId: 's3', locationId: 'loc-b', qty: 100 });
    await seedStock(env, { stickerId: 's4', locationId: 'loc-a', qty: 999 });
    const data = (await run('st.byType', scopeOf({ stockLocationIds: ['loc-a'] }))) as PartsData;
    expect(data.slices).toEqual([
      { key: 't1', label: 'Jenis 1', value: 20 },
      { key: 't2', label: 'Jenis 2', value: 5 },
    ]);
    const both = (await run('st.byType')) as PartsData;
    expect(both.slices.map((slice) => slice.value)).toEqual([105, 20]);
  });
});
