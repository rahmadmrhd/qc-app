import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { loadUserContext } from '@server/modules/access/context';
import { seedBusinessUnit, seedLocation, seedRole, seedUser } from '@server-test/access-fixtures';
import { seedHandover, seedSerial } from '@server-test/dashboard-seed';
import { seedBrand, seedCustomer, seedItem } from '@server-test/item-fixtures';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import type { WidgetId } from '@shared/dashboard';
import type { PublicDashboardDto, PublicQueryInput } from '@shared/dashboard-public';
import type { CreateShareInput } from '@shared/dashboard-share';
import { loadPublicDashboard, validatePublicQuery } from './public-view';
import { loadShare, type ShareRow } from './share-repo';
import { createShare } from './share-service';

setDefaultTimeout(60_000);

let env: TestEnv;
const NOW = Date.parse('2026-11-23T05:00:00.000Z'); // 23 Nov 2026 12:00 WIB
const SHARER = 'sharer@gmail.com';

const ASSIGNMENTS = [
  { locationId: null, roleIds: ['r-dash', 'r-st'] },
  { locationId: 'loc-a', roleIds: ['r-hs'] },
];
const BU_ASSIGNMENTS = [
  { buId: 'bu-x', roleIds: ['r-sn'] },
  { buId: 'bu-y', roleIds: ['r-sn'] },
];

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(NOW);
  await seedLocation(env, { id: 'loc-a', code: 'A', name: 'Lokasi A' });
  await seedLocation(env, { id: 'loc-b', code: 'B', name: 'Lokasi B' });
  await seedBusinessUnit(env, { id: 'bu-x', code: 'X', name: 'BU Ex' });
  await seedBusinessUnit(env, { id: 'bu-y', code: 'Y', name: 'BU Ye' });
  await seedBusinessUnit(env, { id: 'bu-z', code: 'Z', name: 'BU Zet' });
  await seedRole(env, { id: 'r-dash', name: 'Dash', permissions: { dashboard: 'manage' } });
  await seedRole(env, { id: 'r-sn', name: 'SN', permissions: { serial: 'view' } });
  await seedRole(env, { id: 'r-hs', name: 'HS', permissions: { handover: 'view' } });
  await seedRole(env, { id: 'r-st', name: 'ST', permissions: { sticker: 'view' } });
  await seedUser(env, {
    id: 'u-sharer',
    email: SHARER,
    assignments: ASSIGNMENTS,
    buAssignments: BU_ASSIGNMENTS,
  });
  await seedSerial(env, { id: 's1', buId: 'bu-x', itemId: 'i-1' });
  await seedSerial(env, { id: 's2', buId: 'bu-y', itemId: 'i-1' });
  await seedSerial(env, { id: 's3', buId: 'bu-x', itemId: 'i-2', status: 'reported' });
  await seedSerial(env, { id: 's4', buId: 'bu-z', itemId: 'i-1' });
});

const RANGE = { mode: 'fixed', from: '2026-11-01', to: '2026-11-23' } as const;

function input(overrides: Partial<CreateShareInput> = {}): CreateShareInput {
  return {
    title: 'Ringkasan',
    filter: { from: '2026-11-01', to: '2026-11-23' },
    range: RANGE,
    widgets: [{ id: 'sn.recorded', filters: {} }],
    offers: [],
    expiresInDays: 30,
    ...overrides,
  };
}

async function share(overrides: Partial<CreateShareInput> = {}): Promise<ShareRow> {
  const user = await loadUserContext(env, SHARER);
  if (!user) throw new Error('pembagi tidak ditemukan');
  const dto = await createShare(env, user, input(overrides));
  const row = await loadShare(env.DB, dto.id);
  if (!row) throw new Error('baris tautan tidak ditemukan');
  return row;
}

const view = (row: ShareRow, viewer: PublicQueryInput = {}, nowMs = NOW) =>
  loadPublicDashboard(env, row, viewer, nowMs);

function numberOf(dto: PublicDashboardDto | null, id: WidgetId): number {
  const widget = dto?.widgets.find((entry) => entry.id === id);
  if (widget?.result.status !== 'ok' || widget.result.data.kind !== 'number') {
    throw new Error(`widget ${id} bukan angka yang berhasil`);
  }
  return widget.result.data.value;
}

describe('bentuk keluaran', () => {
  test('judul, pembagi sebagai bagian lokal surel, nama BU cakupan beku, tanpa previous', async () => {
    const dto = await view(await share());
    expect(dto?.title).toBe('Ringkasan');
    expect(dto?.sharedBy).toBe('sharer');
    expect(dto?.scope.buNames).toEqual(['BU Ex', 'BU Ye']);
    expect(dto?.options.bu.map((option) => option.value)).toEqual(['bu-x', 'bu-y']);
    expect(dto?.range).toEqual({ from: '2026-11-01', to: '2026-11-23' });
    expect(numberOf(dto, 'sn.recorded')).toBe(3);
    const widget = dto?.widgets[0];
    expect(Object.keys(widget ?? {}).sort()).toEqual(['group', 'id', 'result']);
    expect(JSON.stringify(dto)).not.toContain('previous');
  });

  test('daftar dipotong 10 baris dan hanya kolom putih', async () => {
    await seedCustomer(env, { id: 'c1', name: 'PT Maju' });
    for (let index = 0; index < 12; index += 1) {
      await seedHandover(env, { id: `h${index}`, locationId: 'loc-a', customerId: 'c1' });
    }
    const dto = await view(await share({ widgets: [{ id: 'hs.oldest', filters: {} }] }));
    const result = dto?.widgets[0]?.result;
    if (result?.status !== 'ok' || result.data.kind !== 'list') throw new Error('bukan daftar');
    expect(result.data.rows.length).toBeLessThanOrEqual(10);
    expect(result.data.columns.map((column) => column.key)).toEqual([
      'number',
      'customer',
      'location',
      'age',
      'progress',
    ]);
    for (const row of result.data.rows) {
      expect(Object.keys(row).sort()).toEqual([
        'age',
        'customer',
        'location',
        'number',
        'progress',
      ]);
    }
  });
});

describe('Review Focus 1: pembagi yang diturunkan haknya', () => {
  test('tautan dicabut atau kedaluwarsa = null', async () => {
    const row = await share();
    expect(await view({ ...row, revoked_at: '2026-11-23T04:00:00.000Z' })).toBeNull();
    expect(await view(row, {}, Date.parse('2027-01-01T00:00:00.000Z'))).toBeNull();
  });

  test('pembagi nonaktif atau terhapus = null', async () => {
    const row = await share();
    await env.DB.prepare("UPDATE users SET status = 'inactive' WHERE email = ?").bind(SHARER).run();
    expect(await view(row)).toBeNull();
    await env.DB.prepare("UPDATE users SET status = 'active' WHERE email = ?").bind(SHARER).run();
    expect(await view(row)).not.toBeNull();
    await env.DB.prepare("UPDATE users SET deleted_at = ?, deleted_by = 'x' WHERE email = ?")
      .bind('2026-11-23T04:00:00.000Z', SHARER)
      .run();
    expect(await view(row)).toBeNull();
  });

  test('pembagi kehilangan dashboard: manage = null', async () => {
    const row = await share();
    await env.DB.prepare('UPDATE users SET assignments = ? WHERE email = ?')
      .bind(
        JSON.stringify([
          { locationId: null, roleIds: ['r-st'] },
          { locationId: 'loc-a', roleIds: ['r-hs'] },
        ]),
        SHARER,
      )
      .run();
    expect(await view(row)).toBeNull();
  });

  test('pembagi kehilangan izin sebuah widget: widget itu hilang, yang lain tetap', async () => {
    const row = await share({
      widgets: [
        { id: 'sn.recorded', filters: {} },
        { id: 'pt.condition', filters: {} },
      ],
    });
    expect((await view(row))?.widgets.map((widget) => widget.id)).toEqual([
      'sn.recorded',
      'pt.condition',
    ]);
    await env.DB.prepare('UPDATE users SET assignments = ? WHERE email = ?')
      .bind(
        JSON.stringify([
          { locationId: null, roleIds: ['r-dash'] },
          { locationId: 'loc-a', roleIds: ['r-hs'] },
        ]),
        SHARER,
      )
      .run();
    const after = await view(row);
    expect(after?.widgets.map((widget) => widget.id)).toEqual(['sn.recorded']);
    expect(numberOf(after, 'sn.recorded')).toBe(3);
  });

  test('pembagi kehilangan sebuah BU: angka dari BU itu hilang tanpa galat', async () => {
    const row = await share();
    expect(numberOf(await view(row), 'sn.recorded')).toBe(3);
    await env.DB.prepare('UPDATE users SET bu_assignments = ? WHERE email = ?')
      .bind(JSON.stringify([{ buId: 'bu-x', roleIds: ['r-sn'] }]), SHARER)
      .run();
    const after = await view(row);
    expect(numberOf(after, 'sn.recorded')).toBe(2);
    expect(after?.scope.buNames).toEqual(['BU Ex']);
  });

  test('BU yang ditambahkan ke pembagi sesudah tautan dibuat tidak ikut', async () => {
    const row = await share();
    await env.DB.prepare('UPDATE users SET bu_assignments = ? WHERE email = ?')
      .bind(JSON.stringify([...BU_ASSIGNMENTS, { buId: 'bu-z', roleIds: ['r-sn'] }]), SHARER)
      .run();
    expect(numberOf(await view(row), 'sn.recorded')).toBe(3);
  });
});

describe('Review Focus 2: filter penonton hanya mempersempit', () => {
  test('BU di luar cakupan beku = nol; irisan dengan BU beku sama dengan BU beku saja', async () => {
    const row = await share();
    expect(numberOf(await view(row, { buIds: ['bu-z'] }), 'sn.recorded')).toBe(0);
    expect(numberOf(await view(row, { buIds: ['bu-x'] }), 'sn.recorded')).toBe(2);
    expect(numberOf(await view(row, { buIds: ['bu-x', 'bu-z'] }), 'sn.recorded')).toBe(2);
    expect(numberOf(await view(row, { buIds: [] }), 'sn.recorded')).toBe(0);
  });

  test('tanggal dijepit ke rentang beku dan hari WIB penuh', async () => {
    const row = await share();
    const wide = await view(row, { from: '2026-10-01', to: '2026-12-31' });
    expect(wide?.range).toEqual({ from: '2026-11-01', to: '2026-11-23' });
    expect(numberOf(wide, 'sn.recorded')).toBe(3);
    const late = await view(row, { from: '2026-12-05' });
    expect(late?.range).toEqual({ from: '2026-11-23', to: '2026-11-23' });
    expect(numberOf(late, 'sn.recorded')).toBe(0);
    const day = await view(row, { from: '2026-11-10', to: '2026-11-10' });
    expect(numberOf(day, 'sn.recorded')).toBe(3);
    expect(numberOf(await view(row, { from: '2026-11-11', to: '2026-11-11' }), 'sn.recorded')).toBe(
      0,
    );
  });

  test('filter relasi: tak ditawarkan diabaikan; ditawarkan hanya di dalam pilihan pembagi', async () => {
    const closed = await share({
      widgets: [{ id: 'sn.recorded', filters: { item: ['i-1'] } }],
      offers: [],
    });
    const baseline = numberOf(await view(closed), 'sn.recorded');
    expect(baseline).toBe(2); // s1, s2 (s4 di BU Z tak ikut)
    const ignored = await view(closed, { groups: { serial: { item: ['i-2'] } } });
    expect(numberOf(ignored, 'sn.recorded')).toBe(baseline);

    const open = await share({
      widgets: [{ id: 'sn.recorded', filters: { item: ['i-1', 'i-2'] } }],
      offers: ['item'],
    });
    expect(numberOf(await view(open), 'sn.recorded')).toBe(3);
    expect(
      numberOf(await view(open, { groups: { serial: { item: ['i-2'] } } }), 'sn.recorded'),
    ).toBe(1);
    // nilai di luar pilihan pembagi diabaikan (hasil sama dengan tanpa filter)
    expect(
      numberOf(await view(open, { groups: { serial: { item: ['i-9'] } } }), 'sn.recorded'),
    ).toBe(3);
  });

  test('filter enum bebas bila tak dibekukan; diiris bila dibekukan', async () => {
    const free = await share();
    expect(
      numberOf(await view(free, { groups: { serial: { status: ['reported'] } } }), 'sn.recorded'),
    ).toBe(1);
    expect(
      numberOf(await view(free, { groups: { serial: { status: ['good'] } } }), 'sn.recorded'),
    ).toBe(2);
    const frozen = await share({ widgets: [{ id: 'sn.recorded', filters: { status: ['good'] } }] });
    expect(numberOf(await view(frozen), 'sn.recorded')).toBe(2);
    // meminta status di luar yang dibekukan tidak memperluas hasil
    expect(
      numberOf(await view(frozen, { groups: { serial: { status: ['reported'] } } }), 'sn.recorded'),
    ).toBe(2);
  });

  test('hasil selalu himpunan bagian dari hasil tanpa filter penonton', async () => {
    const row = await share({
      widgets: [
        { id: 'sn.recorded', filters: {} },
        { id: 'hs.created', filters: {} },
      ],
    });
    const base = await view(row);
    const viewers: PublicQueryInput[] = [
      { buIds: ['bu-x'] },
      { buIds: ['bu-z'] },
      { locationIds: ['loc-b'] },
      { from: '2026-11-10', to: '2026-11-10' },
      { groups: { serial: { status: ['reported'] }, handover: { status: ['done'] } } },
    ];
    for (const [index, viewer] of viewers.entries()) {
      const narrowed = await view(row, viewer);
      for (const id of ['sn.recorded', 'hs.created'] as const) {
        expect([index, id, numberOf(narrowed, id) <= numberOf(base, id)]).toEqual([
          index,
          id,
          true,
        ]);
      }
    }
  });
});

describe('rentang bergulir dan opsi', () => {
  test('rentang bergulir dihitung dari hari ini WIB pada saat dibuka', async () => {
    const row = await share({ range: { mode: 'rolling', days: 7 } });
    const now = await view(row);
    expect(now?.range).toEqual({ from: '2026-11-17', to: '2026-11-23' });
    expect(numberOf(now, 'sn.recorded')).toBe(0);
    const earlier = await view(row, {}, Date.parse('2026-11-14T05:00:00.000Z'));
    expect(earlier?.range).toEqual({ from: '2026-11-08', to: '2026-11-14' });
    expect(numberOf(earlier, 'sn.recorded')).toBe(3);
  });

  test('opsi memuat hanya nilai cakupan beku dan relasi yang ditawarkan', async () => {
    await seedBrand(env, 'PBE');
    await seedItem(env, { id: 'i-1', brand: 'PBE', model: 'M1', businessUnitIds: ['bu-x'] });
    await seedItem(env, { id: 'i-2', brand: 'PBE', model: 'M2', businessUnitIds: ['bu-x'] });
    await seedItem(env, { id: 'i-3', brand: 'PBE', model: 'M3', businessUnitIds: ['bu-x'] });
    const row = await share({
      widgets: [{ id: 'sn.recorded', filters: { item: ['i-1', 'i-2'] } }],
      offers: ['item'],
    });
    const dto = await view(row);
    expect(dto?.options.groups.item?.map((option) => option.value)).toEqual(['i-1', 'i-2']);
    expect(Object.keys(dto?.options.groups ?? {})).toEqual(['item']);
    const closed = await share({
      widgets: [{ id: 'sn.recorded', filters: { item: ['i-1'] } }],
    });
    expect(Object.keys((await view(closed))?.options.groups ?? {})).toEqual([]);
  });
});

describe('review akhir: lokasi dan rentang', () => {
  const grantLocations = async (locationIds: string[]) => {
    await env.DB.prepare('UPDATE users SET assignments = ? WHERE email = ?')
      .bind(
        JSON.stringify([
          { locationId: null, roleIds: ['r-dash', 'r-st'] },
          ...locationIds.map((locationId) => ({ locationId, roleIds: ['r-hs'] })),
        ]),
        SHARER,
      )
      .run();
  };

  test('butir 4: lokasi yang haknya hilang tak tampil di kepala maupun pilihan filter', async () => {
    await grantLocations(['loc-a', 'loc-b']);
    const row = await share({ widgets: [{ id: 'hs.created', filters: {} }] });
    const before = await view(row);
    expect(before?.scope.locationNames).toEqual(['Lokasi A', 'Lokasi B']);
    await grantLocations(['loc-a']);
    const after = await view(row);
    expect(after?.scope.locationNames).toEqual(['Lokasi A']);
    expect(after?.options.location.map((option) => option.value)).toEqual(['loc-a']);
    expect(JSON.stringify(after)).not.toContain('Lokasi B');
  });

  test('butir 4: lokasi pilihan untuk saringan Serial tetap tampil (lokasi bukan hak di sana)', async () => {
    const row = await share({
      locationFiltered: true,
      filter: { from: '2026-11-01', to: '2026-11-23', locationIds: ['loc-b'] },
    });
    const dto = await view(row);
    expect(dto?.scope.locationNames).toEqual(['Lokasi B']);
  });

  test('butir 14: tautan Serial saja tanpa saringan lokasi mengabaikan locationIds penonton', async () => {
    const row = await share();
    const baseline = numberOf(await view(row), 'sn.recorded');
    expect(baseline).toBe(3);
    const withLocation = await view(row, { locationIds: ['loc-a'] });
    expect(numberOf(withLocation, 'sn.recorded')).toBe(baseline);
    expect(numberOf(await view(row, { locationIds: [] }), 'sn.recorded')).toBe(baseline);
  });

  test('butir 14: saringan lokasi yang dibekukan tetap dihormati dan dapat dipersempit penonton', async () => {
    await grantLocations(['loc-a', 'loc-b']);
    const row = await share({
      locationFiltered: true,
      filter: { from: '2026-11-01', to: '2026-11-23', locationIds: ['loc-a', 'loc-b'] },
    });
    const baseline = numberOf(await view(row), 'sn.recorded');
    // viewer menyempitkan ke lokasi yang tak punya serial: hasil tidak lebih besar dari baseline
    const narrowed = numberOf(await view(row, { locationIds: ['loc-b'] }), 'sn.recorded');
    expect(narrowed).toBeLessThanOrEqual(baseline);
  });

  test('butir 13: bounds = rentang beku pembagi walau penonton menyempitkan tanggal', async () => {
    const row = await share();
    const frozen = { from: '2026-11-01', to: '2026-11-23' };
    const plain = await view(row);
    expect(plain?.bounds).toEqual(frozen);
    const narrowed = await view(row, { from: '2026-11-10', to: '2026-11-10' });
    expect(narrowed?.range).toEqual({ from: '2026-11-10', to: '2026-11-10' });
    expect(narrowed?.bounds).toEqual(frozen);
    const rolling = await share({ range: { mode: 'rolling', days: 7 } });
    const dto = await view(rolling, { from: '2026-11-20', to: '2026-11-21' });
    expect(dto?.bounds).toEqual({ from: '2026-11-17', to: '2026-11-23' });
  });
});

describe('validatePublicQuery', () => {
  const code = (value: unknown) => {
    try {
      validatePublicQuery(value);
    } catch (error) {
      return (error as { code?: string }).code;
    }
    return 'OK';
  };

  test('kosong dan kunci tak dikenal diabaikan', () => {
    expect(validatePublicQuery(undefined)).toEqual({});
    expect(validatePublicQuery({})).toEqual({});
    expect(validatePublicQuery({ rahasia: 'x', groups: { bogus: { a: ['1'] } } })).toEqual({});
  });

  test('daftar, tanggal, dan enum divalidasi', () => {
    expect(code('bukan objek')).toBe('VALIDATION');
    expect(code({ buIds: 'x' })).toBe('VALIDATION');
    expect(code({ buIds: Array.from({ length: 21 }, (_, index) => `b${index}`) })).toBe(
      'VALIDATION',
    );
    expect(code({ buIds: Array.from({ length: 20 }, (_, index) => `b${index}`) })).toBe('OK');
    expect(code({ from: '2026-13-40' })).toBe('VALIDATION');
    expect(code({ from: '2026-11-10', to: '2026-11-01' })).toBe('VALIDATION');
    expect(code({ groups: { serial: { status: ['tidak-ada'] } } })).toBe('VALIDATION');
    expect(validatePublicQuery({ buIds: [], groups: { serial: { status: [] } } })).toEqual({
      buIds: [],
    });
  });
});
