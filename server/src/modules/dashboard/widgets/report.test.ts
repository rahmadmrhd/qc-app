import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { seedBusinessUnit, seedLocation } from '@server-test/access-fixtures';
import { testScope } from '@server-test/dashboard-scope';
import { type SeedSerialRow, seedCase, seedSerial } from '@server-test/dashboard-seed';
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
import { REPORT_WIDGETS } from './report';

setDefaultTimeout(60_000);

let env: TestEnv;

const RANGE: DashboardRange = { from: '2026-11-10', to: '2026-11-16' };
const IDS: WidgetId[] = ['rp.open', 'rp.opened', 'rp.trend', 'rp.result', 'rp.oldest'];

const seed = (row: SeedSerialRow) => seedSerial(env, { buId: 'bu-x', ...row });

function scopeOf(overrides: Partial<ResolvedScope> = {}, range: DashboardRange = RANGE) {
  return testScope(range, { buIds: ['bu-x', 'bu-y'], ...overrides });
}

async function run(
  id: WidgetId,
  scope: ResolvedScope = scopeOf(),
  filters: Record<string, string[]> = {},
): Promise<WidgetData> {
  const impl = REPORT_WIDGETS.find((widget) => widget.id === id);
  if (!impl) throw new Error(`Widget ${id} belum terdaftar`);
  return impl.run({ env, db: env.DB, scope, filters });
}

/** Serial berstatus `reported` + laporan (terbuka bila `closedOn` kosong). */
async function reported(
  id: string,
  caseRow: { openedOn?: string; closedOn?: string; outcome?: string; buId?: string },
  serial: Partial<SeedSerialRow> = {},
): Promise<void> {
  await seed({ id: `s-${id}`, status: 'reported', buId: caseRow.buId, ...serial });
  await seedCase(env, {
    id: `c-${id}`,
    number: `LP-${id}`,
    serialId: `s-${id}`,
    buId: caseRow.buId ?? 'bu-x',
    openedOn: caseRow.openedOn,
    closedOn: caseRow.closedOn,
    outcome: caseRow.outcome,
  });
}

beforeEach(async () => {
  env = await createTestEnv();
  await seedLocation(env, { id: 'loc-a', code: 'A', name: 'Lokasi A' });
  await seedLocation(env, { id: 'loc-b', code: 'B', name: 'Lokasi B' });
  await seedBusinessUnit(env, { id: 'bu-x', code: 'X', name: 'BU X' });
  await seedBusinessUnit(env, { id: 'bu-y', code: 'Y', name: 'BU Y' });
});

test('REPORT_WIDGETS mencakup tepat lima widget grup Laporan', () => {
  expect(REPORT_WIDGETS.map((widget) => widget.id).sort()).toEqual([...IDS].sort());
});

describe('rp.open', () => {
  test('laporan terbuka tanpa rentang; tertutup dan milik serial terhapus tidak', async () => {
    await reported('1', { openedOn: '2025-01-01' });
    await reported('2', { openedOn: '2026-11-12' });
    await reported('3', { openedOn: '2026-11-12', closedOn: '2026-11-14', outcome: 'good' });
    await reported('4', { openedOn: '2026-11-12' }, { deletedAt: '2026-11-13T00:00:00.000Z' });
    expect(((await run('rp.open')) as NumberData).value).toBe(2);
  });

  test('BU di luar buIds tidak terhitung; buIds kosong = 0', async () => {
    await reported('1', { openedOn: '2026-11-12', buId: 'bu-y' });
    await reported('2', { openedOn: '2026-11-12', buId: 'bu-z' });
    expect(((await run('rp.open')) as NumberData).value).toBe(1);
    expect(((await run('rp.open', scopeOf({ buIds: [] }))) as NumberData).value).toBe(0);
  });

  test('lokasi memakai lokasi serial induk; null = semua, [] = tidak ada', async () => {
    await reported('1', { openedOn: '2026-11-12' }, { locationId: 'loc-a' });
    await reported('2', { openedOn: '2026-11-12' }, { locationId: 'loc-b' });
    expect(
      ((await run('rp.open', scopeOf({ serialLocationIds: ['loc-a'] }))) as NumberData).value,
    ).toBe(1);
    expect(((await run('rp.open', scopeOf({ serialLocationIds: null }))) as NumberData).value).toBe(
      2,
    );
    expect(((await run('rp.open', scopeOf({ serialLocationIds: [] }))) as NumberData).value).toBe(
      0,
    );
  });

  test('filter grup status closed menghasilkan nol untuk laporan terbuka', async () => {
    await reported('1', { openedOn: '2026-11-12' });
    expect(((await run('rp.open', scopeOf(), { status: ['closed'] })) as NumberData).value).toBe(0);
    expect(((await run('rp.open', scopeOf(), { status: ['open'] })) as NumberData).value).toBe(1);
  });
});

describe('rp.opened', () => {
  test('opened_on tepat from dan to termasuk (inklusif); di luar tidak; previous = periode sebelumnya', async () => {
    await reported('1', { openedOn: '2026-11-10' });
    await reported('2', { openedOn: '2026-11-16' });
    await reported('3', { openedOn: '2026-11-17' });
    await reported('4', { openedOn: '2026-11-09' });
    await reported('5', { openedOn: '2026-11-03' });
    await reported('6', { openedOn: '2026-11-12' }, { deletedAt: '2026-11-13T00:00:00.000Z' });
    expect(await run('rp.opened')).toEqual({ kind: 'number', value: 2, previous: 2 });
  });
});

describe('rp.trend', () => {
  test('seri Dibuka per opened_on dan Ditutup per closed_on', async () => {
    await reported('1', { openedOn: '2026-11-11', closedOn: '2026-11-13', outcome: 'broken' });
    await reported('2', { openedOn: '2026-11-11' });
    await reported('3', { openedOn: '2026-11-05', closedOn: '2026-11-13', outcome: 'good' });
    const data = (await run('rp.trend')) as SeriesData;
    expect(data.points.length).toBe(7);
    expect(data.series).toEqual([
      { key: 'opened', label: 'Dibuka', values: [0, 2, 0, 0, 0, 0, 0] },
      { key: 'closed', label: 'Ditutup', values: [0, 0, 0, 2, 0, 0, 0] },
    ]);
  });
});

describe('rp.result', () => {
  test('hanya laporan yang closed_on-nya dalam rentang: Rusak vs Lolos', async () => {
    await reported('1', { openedOn: '2026-11-01', closedOn: '2026-11-11', outcome: 'broken' });
    await reported('2', { openedOn: '2026-11-01', closedOn: '2026-11-12', outcome: 'good' });
    await reported('3', { openedOn: '2026-11-01', closedOn: '2026-11-13', outcome: 'good' });
    await reported('4', { openedOn: '2026-11-01', closedOn: '2026-11-20', outcome: 'broken' });
    await reported('5', { openedOn: '2026-11-12' });
    const data = (await run('rp.result')) as PartsData;
    expect(data.slices).toEqual([
      { key: 'broken', label: 'Rusak', value: 1 },
      { key: 'good', label: 'Lolos', value: 2 },
    ]);
    const filtered = (await run('rp.result', scopeOf(), { result: ['good'] })) as PartsData;
    expect(filtered.slices).toEqual([{ key: 'good', label: 'Lolos', value: 2 }]);
  });
});

describe('rp.oldest', () => {
  test('10 laporan terbuka terlama terurut opened_on menaik, total, kolom persis registry', async () => {
    for (let index = 1; index <= 12; index += 1) {
      await reported(
        String(index),
        { openedOn: `2026-11-${String(index).padStart(2, '0')}` },
        { locationId: 'loc-a' },
      );
    }
    await reported('x', { openedOn: '2026-10-01', closedOn: '2026-10-02', outcome: 'good' });
    const data = (await run('rp.oldest')) as ListData;
    expect(data.total).toBe(12);
    expect(data.rows.length).toBe(10);
    expect(data.rows.map((row) => row.number)).toEqual(
      Array.from({ length: 10 }, (_, index) => `LP-${index + 1}`),
    );
    const columns = widgetMeta('rp.oldest').listColumns ?? [];
    expect(data.columns).toEqual([...columns]);
    expect(data.rows[0]).toEqual({
      number: 'LP-1',
      status: 'Dilaporkan',
      location: 'Lokasi A',
      days: 15,
    });
  });

  test('buIds kosong: kosong tanpa SQL', async () => {
    await reported('1', { openedOn: '2026-11-12' });
    const data = (await run('rp.oldest', scopeOf({ buIds: [] }))) as ListData;
    expect(data.rows).toEqual([]);
    expect(data.total).toBe(0);
  });
});
