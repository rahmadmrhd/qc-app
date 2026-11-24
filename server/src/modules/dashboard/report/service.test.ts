import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { loadUserContext, type UserContext } from '@server/modules/access/context';
import { seedBusinessUnit, seedLocation, seedRole, seedUser } from '@server-test/access-fixtures';
import { captureAppErrorAsync } from '@server-test/errors';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import type { DashboardReportDto, SaveDashboardReportInput } from '@shared/dashboard-report';
import { REPORT_LIMITS } from '@shared/dashboard-report';
import { insertShareStmt, loadShare } from '../share-repo';
import { insertReportStmt, loadReport, parseReportScope, type ReportRow } from './repo';
import {
  getDashboardReport,
  listDashboardReports,
  OUTSIDE_RIGHTS_MESSAGE,
  removeDashboardReport,
  saveDashboardReport,
  setDashboardReportEnabled,
} from './service';
import { validateSaveReport } from './validate';

setDefaultTimeout(60_000);

let env: TestEnv;
const NOW = Date.parse('2026-11-23T05:00:00.000Z'); // Senin 23 Nov 2026 12:00 WIB
const OWNER = 'owner@gmail.com';
const OTHER = 'other@gmail.com'; // dashboard: manage (kelola semua)
const EDITOR = 'editor@gmail.com'; // dashboard: edit (hanya milik sendiri)
const ADMIN = 'admin@gmail.com';

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(NOW);
  await seedBusinessUnit(env, { id: 'bu-x', code: 'X' });
  await seedBusinessUnit(env, { id: 'bu-y', code: 'Y' });
  await seedRole(env, { id: 'r-dash', name: 'Dash', permissions: { dashboard: 'manage' } });
  await seedRole(env, { id: 'r-dash-edit', name: 'DashEdit', permissions: { dashboard: 'edit' } });
  await seedRole(env, { id: 'r-sn', name: 'SN', permissions: { serial: 'view' } });
  await seedUser(env, {
    id: 'u-owner',
    email: OWNER,
    assignments: [{ locationId: null, roleIds: ['r-dash'] }],
    buAssignments: [{ buId: 'bu-x', roleIds: ['r-sn'] }],
  });
  await seedUser(env, {
    id: 'u-other',
    email: OTHER,
    assignments: [{ locationId: null, roleIds: ['r-dash'] }],
    buAssignments: [{ buId: 'bu-x', roleIds: ['r-sn'] }],
  });
});

const seedEditor = () =>
  seedUser(env, {
    id: 'u-editor',
    email: EDITOR,
    assignments: [{ locationId: null, roleIds: ['r-dash-edit'] }],
    buAssignments: [{ buId: 'bu-x', roleIds: ['r-sn'] }],
  });

const userOf = async (email = OWNER): Promise<UserContext> => {
  const user = await loadUserContext(env, email);
  if (!user) throw new Error('pengguna tidak ditemukan');
  return user;
};

const WEEKLY = { frequency: 'weekly', hour: 8, weekday: 1, monthDay: 1 } as const;

function input(overrides: Partial<SaveDashboardReportInput> = {}): SaveDashboardReportInput {
  return {
    name: 'Ringkasan mingguan',
    schedule: WEEKLY,
    period: 'lastWeek',
    filter: { from: '', to: '' },
    widgets: [{ id: 'sn.recorded', filters: {} }],
    offers: [],
    recipients: ['Penerima@Contoh.id'],
    linkDays: 14,
    ...overrides,
  };
}

/** Galat sinkron dari `validateSaveReport` (bentuk dan aturan isi). */
function thrown(run: () => unknown): { code?: string; fields?: Record<string, string> } {
  try {
    run();
  } catch (error) {
    return error as { code?: string; fields?: Record<string, string> };
  }
  return {};
}

const widgets = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: (
      [
        'hs.created',
        'hs.active',
        'hs.status',
        'hs.trend',
        'hs.byLocation',
        'hs.byCustomer',
        'hs.avgDuration',
        'hs.oldest',
        'sn.recorded',
        'sn.status',
        'sn.trend',
        'sn.byItem',
        'sn.byBu',
      ] as const
    )[index] as 'hs.created',
    filters: {},
  }));

describe('validasi', () => {
  test('13 widget, nama kosong atau > 120, penerima kosong atau > 20, jadwal dan linkDays tak sah = VALIDATION', () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ['widgets', { widgets: widgets(13) }],
      ['name', { name: '   ' }],
      ['name', { name: 'x'.repeat(121) }],
      ['recipients', { recipients: [] }],
      [
        'recipients',
        { recipients: Array.from({ length: 21 }, (_, index) => `a${index}@contoh.id`) },
      ],
      ['recipients', { recipients: ['A <a@x.id>'] }],
      ['recipients', { recipients: ['a@x.id, b@y.id'] }],
      ['recipients', { recipients: ['bukan-surel'] }],
      ['schedule', { schedule: { ...WEEKLY, hour: 24 } }],
      ['schedule', { schedule: { ...WEEKLY, monthDay: 29 } }],
      ['linkDays', { linkDays: 0 }],
      ['linkDays', { linkDays: 366 }],
      ['period', { period: 'kemarin-lusa' }],
    ];
    for (const [field, overrides] of cases) {
      const error = thrown(() => validateSaveReport({ ...input(), ...overrides }));
      expect([field, error.code, Object.keys(error.fields ?? {})]).toEqual([
        field,
        'VALIDATION',
        expect.arrayContaining([field]),
      ]);
    }
  });

  test('12 widget dan 20 penerima sah', () => {
    expect(() =>
      validateSaveReport({
        ...input(),
        widgets: widgets(12),
        recipients: Array.from({ length: 20 }, (_, index) => `a${index}@contoh.id`),
      }),
    ).not.toThrow();
  });

  test('penerima dinormalisasi huruf kecil, duplikat dibuang; nama dibersihkan dari karakter kontrol dan bidi', () => {
    const parsed = validateSaveReport({
      ...input(),
      recipients: ['A@x.id', 'a@X.ID', ' b@y.id '],
      name: 'La\u0001po‮ran',
    });
    expect(parsed.recipients).toEqual(['a@x.id', 'b@y.id']);
    // Karakter kontrol/bidi diganti spasi (perilaku `stripControlChars`), tidak pernah tersisa.
    expect(parsed.name).toBe('La po ran');
  });

  test('widget di luar hak pemilik = VALIDATION', async () => {
    const owner = await userOf();
    const denied = await captureAppErrorAsync(() =>
      saveDashboardReport(env, owner, input({ widgets: [{ id: 'pt.condition', filters: {} }] })),
    );
    expect(denied?.code).toBe('VALIDATION');
  });
});

describe('batas laporan per pemilik', () => {
  test('laporan ke-21 = CONFLICT', async () => {
    const owner = await userOf();
    const base: ReportRow = {
      id: '',
      name: 'Lama',
      owner: OWNER,
      enabled: 1,
      schedule: JSON.stringify(WEEKLY),
      period: 'lastWeek',
      scope: JSON.stringify({
        buIds: [],
        locationIds: [],
        locationFiltered: false,
        widgets: [],
        offers: [],
      }),
      recipients: JSON.stringify(['a@x.id']),
      link_days: 14,
      last_run_key: '',
      last_run_at: '',
      last_status: '',
      last_note: '',
      created_at: '2026-11-01T00:00:00.000Z',
      updated_at: '2026-11-01T00:00:00.000Z',
      version: 1,
    };
    for (let index = 0; index < REPORT_LIMITS.perOwner - 1; index += 1) {
      await insertReportStmt(env.DB, { ...base, id: `r${index}` }).run();
    }
    const twentieth = await saveDashboardReport(env, owner, input());
    expect(twentieth.owner).toBe(OWNER);
    const over = await captureAppErrorAsync(() => saveDashboardReport(env, owner, input()));
    expect(over?.code).toBe('CONFLICT');
    // pemilik lain tidak terpengaruh
    const other = await saveDashboardReport(env, await userOf(OTHER), input());
    expect(other.owner).toBe(OTHER);
  });
});

describe('Review Focus 3: laporan baru tidak langsung terkirim', () => {
  const rowOf = async (id: string) => (await loadReport(env.DB, id)) as ReportRow;

  test('mingguan Senin 08.00 dibuat Senin 10.00: kunci minggu itu; Senin 07.00: kosong', async () => {
    const owner = await userOf();
    env.clock.set(Date.parse('2026-11-23T03:00:00.000Z')); // Senin 10.00 WIB
    const late = await saveDashboardReport(env, owner, input());
    expect((await rowOf(late.id)).last_run_key).toBe('2026-W48');
    env.clock.set(Date.parse('2026-11-23T00:00:00.000Z')); // Senin 07.00 WIB
    const early = await saveDashboardReport(env, owner, input());
    expect((await rowOf(early.id)).last_run_key).toBe('');
  });

  test('dilanjutkan dari jeda setelah slot lewat: kunci diisi', async () => {
    const owner = await userOf();
    env.clock.set(Date.parse('2026-11-23T00:00:00.000Z')); // Senin 07.00 WIB
    const created = await saveDashboardReport(env, owner, input({ enabled: false }));
    expect((await rowOf(created.id)).last_run_key).toBe('');
    env.clock.set(Date.parse('2026-11-23T03:00:00.000Z')); // Senin 10.00 WIB
    const resumed = await setDashboardReportEnabled(env, owner, { id: created.id, enabled: true });
    expect(resumed.enabled).toBe(true);
    expect((await rowOf(created.id)).last_run_key).toBe('2026-W48');
  });

  test('mengubah jadwal menghitung ulang kunci; mengubah nama saja tidak', async () => {
    const owner = await userOf();
    env.clock.set(Date.parse('2026-11-23T00:00:00.000Z')); // Senin 07.00 WIB: kunci kosong
    const created = await saveDashboardReport(env, owner, input());
    expect((await rowOf(created.id)).last_run_key).toBe('');
    // Klaim berjalan oleh pengirim (disimulasikan): nama diubah tidak boleh menimpanya
    await env.DB.prepare('UPDATE dashboard_reports SET last_run_key = ? WHERE id = ?')
      .bind('2026-W48', created.id)
      .run();
    env.clock.set(Date.parse('2026-11-23T00:10:00.000Z'));
    const renamed = await saveDashboardReport(
      env,
      owner,
      input({ id: created.id, name: 'Nama baru', expectedUpdatedAt: created.updatedAt }),
    );
    expect(renamed.name).toBe('Nama baru');
    expect((await rowOf(created.id)).last_run_key).toBe('2026-W48');
    // jadwal diubah ke harian pukul 07.00 (slot belum lewat pada 07.10? sudah lewat): kunci hari ini
    env.clock.set(Date.parse('2026-11-23T00:20:00.000Z')); // 07.20 WIB
    await saveDashboardReport(
      env,
      owner,
      input({
        id: created.id,
        schedule: { frequency: 'daily', hour: 7, weekday: 1, monthDay: 1 },
        expectedUpdatedAt: renamed.updatedAt,
      }),
    );
    expect((await rowOf(created.id)).last_run_key).toBe('2026-11-23');
    // jadwal diubah ke jam yang belum lewat: kosong
    const current = await getDashboardReport(env, owner, created.id);
    await saveDashboardReport(
      env,
      owner,
      input({
        id: created.id,
        schedule: { frequency: 'daily', hour: 20, weekday: 1, monthDay: 1 },
        expectedUpdatedAt: current.updatedAt,
      }),
    );
    expect((await rowOf(created.id)).last_run_key).toBe('');
  });
});

describe('simpan', () => {
  test('cakupan dibekukan: filter BU kosong = himpunan eksplisit hak pemilik', async () => {
    const owner = await userOf();
    const created = await saveDashboardReport(env, owner, input());
    const scope = parseReportScope((await loadReport(env.DB, created.id))?.scope ?? '');
    expect(scope?.buIds).toEqual(['bu-x']);
    expect(created.scope.buIds).toEqual(['bu-x']);
  });

  test('CAS: expectedUpdatedAt usang = galat usang; tanpa expectedUpdatedAt saat mengubah = VALIDATION', async () => {
    const owner = await userOf();
    const created = await saveDashboardReport(env, owner, input());
    env.clock.advance(1000);
    await saveDashboardReport(
      env,
      owner,
      input({ id: created.id, name: 'Satu', expectedUpdatedAt: created.updatedAt }),
    );
    const stale = (await captureAppErrorAsync(() =>
      saveDashboardReport(
        env,
        owner,
        input({ id: created.id, name: 'Dua', expectedUpdatedAt: created.updatedAt }),
      ),
    )) as { code?: string; stale?: boolean } | undefined;
    expect(stale?.code).toBe('CONFLICT');
    expect(stale?.stale).toBe(true);
    const missing = await captureAppErrorAsync(() =>
      saveDashboardReport(env, owner, input({ id: created.id })),
    );
    expect(missing?.code).toBe('VALIDATION');
  });

  test('id tak dikenal = NOT_FOUND', async () => {
    const owner = await userOf();
    const error = await captureAppErrorAsync(() =>
      saveDashboardReport(env, owner, input({ id: 'tidak-ada', expectedUpdatedAt: 'x' })),
    );
    expect(error?.code).toBe('NOT_FOUND');
  });
});

describe('hak: edit (milik sendiri) dan manage (semua)', () => {
  async function seedWithIssuedLink() {
    const owner = await userOf();
    const created = await saveDashboardReport(env, owner, input());
    await insertShareStmt(env.DB, {
      id: 's-terbitan',
      title: 'Terbitan',
      created_by: OWNER,
      created_at: '2026-11-23T00:00:00.000Z',
      expires_at: '2026-12-31T00:00:00.000Z',
      revoked_at: '',
      revoked_by: '',
      scope: '{}',
      report_id: created.id,
    }).run();
    return { owner, created };
  }

  test('pemegang edit lain: daftar kosong dan semua operasi atas baris orang = NOT_FOUND seragam', async () => {
    await seedEditor();
    const { created } = await seedWithIssuedLink();
    const editor = await userOf(EDITOR);
    expect((await listDashboardReports(env, editor)).reports).toEqual([]);
    const runs = [
      () => getDashboardReport(env, editor, created.id),
      () =>
        saveDashboardReport(
          env,
          editor,
          input({ id: created.id, expectedUpdatedAt: created.updatedAt }),
        ),
      () => setDashboardReportEnabled(env, editor, { id: created.id, enabled: false }),
      () => removeDashboardReport(env, editor, created.id),
    ];
    for (const run of runs) {
      const error = await captureAppErrorAsync(run);
      expect(error?.code).toBe('NOT_FOUND');
      expect(error?.message).toBe('Laporan tidak ditemukan');
    }
    expect(await loadReport(env.DB, created.id)).not.toBeNull();
  });

  test('manage dan super admin melihat penerima, cakupan, dan tautan terbitan; pemilik tidak berpindah', async () => {
    const { owner, created } = await seedWithIssuedLink();
    const mine = await getDashboardReport(env, owner, created.id);
    expect(mine.recipients).toEqual(['penerima@contoh.id']);
    expect(mine.canEdit).toBe(true);
    expect(mine.links?.map((link) => link.id)).toEqual(['s-terbitan']);

    const other = await userOf(OTHER);
    const seen = await getDashboardReport(env, other, created.id);
    expect(seen.recipients).toEqual(['penerima@contoh.id']);
    expect(seen.canEdit).toBe(true);
    expect(seen.links?.map((link) => link.id)).toEqual(['s-terbitan']);
    expect(seen.links?.[0]?.url).toStartWith('https://qc.test/dashboard-publik/');
    expect(seen.scope.buIds).toEqual(['bu-x']);
    const listed = (await listDashboardReports(env, other)).reports[0];
    expect(listed?.recipients).toEqual(['penerima@contoh.id']);

    env.clock.advance(1000);
    const edited = await saveDashboardReport(
      env,
      other,
      input({ id: created.id, expectedUpdatedAt: created.updatedAt, name: 'Diubah manage' }),
    );
    expect(edited.owner).toBe(OWNER);
    expect(edited.name).toBe('Diubah manage');

    const admin = await userOf(ADMIN);
    expect(admin.isSuperAdmin).toBe(true);
    const adminView = await getDashboardReport(env, admin, created.id);
    expect(adminView.recipients).toEqual(['penerima@contoh.id']);
    expect(adminView.links).toHaveLength(1);
    const paused = await setDashboardReportEnabled(env, admin, { id: created.id, enabled: false });
    expect(paused.enabled).toBe(false);
    await removeDashboardReport(env, other, created.id);
    expect(await loadReport(env.DB, created.id)).toBeNull();
  });

  test('pemegang edit membuat laporan miliknya sendiri dan hanya itu yang tampil di daftarnya', async () => {
    await seedEditor();
    const editor = await userOf(EDITOR);
    const created = await saveDashboardReport(env, editor, input());
    expect(created.owner).toBe(EDITOR);
    expect((await listDashboardReports(env, editor)).reports.map((r) => r.id)).toEqual([
      created.id,
    ]);
  });

  // Keputusan pemilik produk 2026-11-24 ("cegah pemotongan"): pelaku bukan pemilik tidak membekukan ulang cakupan
  // dengan haknya sendiri; cakupan yang tak diubah dipertahankan, yang diubah ke luar haknya ditolak.
  describe('pelaku bukan pemilik menyimpan laporan orang lain (cegah pemotongan)', () => {
    const OUTSIDE = OUTSIDE_RIGHTS_MESSAGE;

    async function ownerWithBoth(): Promise<DashboardReportDto> {
      await seedRole(env, { id: 'r-st', name: 'ST', permissions: { sticker: 'view' } });
      await env.DB.prepare('UPDATE users SET bu_assignments = ?, assignments = ? WHERE email = ?')
        .bind(
          JSON.stringify([
            { buId: 'bu-x', roleIds: ['r-sn'] },
            { buId: 'bu-y', roleIds: ['r-sn'] },
          ]),
          JSON.stringify([{ locationId: null, roleIds: ['r-dash', 'r-st'] }]),
          OWNER,
        )
        .run();
      const owner = await userOf();
      const created = await saveDashboardReport(
        env,
        owner,
        input({
          widgets: [
            { id: 'sn.recorded', filters: {} },
            { id: 'pt.condition', filters: {} },
          ],
        }),
      );
      expect([...created.scope.buIds].sort()).toEqual(['bu-x', 'bu-y']);
      env.clock.advance(1000);
      return created;
    }

    /** Masukan yang dikirim formulir: seluruh cakupan tersimpan dikirim kembali apa adanya. */
    const sameScope = (dto: DashboardReportDto): Partial<SaveDashboardReportInput> => ({
      id: dto.id,
      expectedUpdatedAt: dto.updatedAt,
      filter: { from: '', to: '', buIds: dto.scope.buIds },
      widgets: dto.scope.widgets,
      offers: dto.scope.offers,
      locationFiltered: dto.scope.locationFiltered,
    });

    test('hanya mengubah jadwal, penerima, dan nama: cakupan beku pemilik utuh (BU dan widget tak terpotong)', async () => {
      const created = await ownerWithBoth();
      const other = await userOf(OTHER); // BU x saja dan tanpa sticker view
      const saved = await saveDashboardReport(
        env,
        other,
        input({
          ...sameScope(created),
          name: 'Ganti nama saja',
          recipients: ['baru@contoh.id'],
          schedule: { frequency: 'daily', hour: 9, weekday: 1, monthDay: 1 },
        }),
      );
      expect(saved.name).toBe('Ganti nama saja');
      expect(saved.owner).toBe(OWNER);
      expect([...saved.scope.buIds].sort()).toEqual(['bu-x', 'bu-y']);
      expect(saved.scope.widgets.map((widget) => widget.id)).toEqual([
        'sn.recorded',
        'pt.condition',
      ]);
    });

    test('mengubah cakupan ke BU di luar haknya ditolak dengan pesan generik, tanpa nama atau jumlah', async () => {
      const created = await ownerWithBoth();
      const other = await userOf(OTHER);
      const error = await saveDashboardReport(
        env,
        other,
        input({ ...sameScope(created), filter: { from: '', to: '', buIds: ['bu-y'] } }),
      ).catch((caught: unknown) => caught as { code?: string; message?: string });
      expect(error).toMatchObject({ code: 'VALIDATION', message: OUTSIDE });
      expect(String((error as { message?: string }).message)).not.toContain('bu-y');
      const row = await loadReport(env.DB, created.id);
      expect(
        parseReportScope(row?.scope ?? '')
          ?.buIds.slice()
          .sort(),
      ).toEqual(['bu-x', 'bu-y']);
    });

    test('mengubah widget ke yang di luar haknya ditolak dengan pesan yang sama (konsisten dengan BU)', async () => {
      const created = await ownerWithBoth();
      const other = await userOf(OTHER);
      const error = await saveDashboardReport(
        env,
        other,
        input({
          ...sameScope(created),
          widgets: [
            { id: 'sn.recorded', filters: {} },
            { id: 'pt.condition', filters: {} },
            { id: 'pt.expiring', filters: {} },
          ],
        }),
      ).catch((caught: unknown) => caught as { code?: string; message?: string });
      expect(error).toMatchObject({ code: 'VALIDATION', message: OUTSIDE });
    });

    test('mengubah cakupan seluruhnya dalam haknya diterima dan dibekukan seperti biasa', async () => {
      const created = await ownerWithBoth();
      const other = await userOf(OTHER);
      const saved = await saveDashboardReport(
        env,
        other,
        input({
          ...sameScope(created),
          filter: { from: '', to: '', buIds: ['bu-x'] },
          widgets: [{ id: 'sn.recorded', filters: {} }],
        }),
      );
      expect(saved.scope.buIds).toEqual(['bu-x']);
      expect(saved.scope.widgets.map((widget) => widget.id)).toEqual(['sn.recorded']);
      expect(saved.owner).toBe(OWNER);
    });

    /** Pemilik berhak Serah Terima dan stok di loc-a dan loc-b; OTHER hanya di loc-a. */
    async function ownerWithLocations(
      widgetIds: ('hs.created' | 'st.out' | 'sn.recorded')[],
    ): Promise<DashboardReportDto> {
      await seedRole(env, { id: 'r-ho', name: 'HO', permissions: { handover: 'view' } });
      await seedRole(env, { id: 'r-ss', name: 'SS', permissions: { stickerstock: 'view' } });
      await seedLocation(env, { id: 'loc-a', code: 'LA' });
      await seedLocation(env, { id: 'loc-b', code: 'LB' });
      const assign = async (email: string, locations: string[]) => {
        await env.DB.prepare('UPDATE users SET assignments = ? WHERE email = ?')
          .bind(
            JSON.stringify([
              { locationId: null, roleIds: ['r-dash'] },
              ...locations.flatMap((locationId) => [
                { locationId, roleIds: ['r-ho'] },
                { locationId, roleIds: ['r-ss'] },
              ]),
            ]),
            email,
          )
          .run();
      };
      await assign(OWNER, ['loc-a', 'loc-b']);
      await assign(OTHER, ['loc-a']);
      const created = await saveDashboardReport(
        env,
        await userOf(),
        input({
          widgets: widgetIds.map((id) => ({ id, filters: {} })),
          filter: { from: '', to: '', locationIds: ['loc-a', 'loc-b'] },
        }),
      );
      env.clock.advance(1000);
      return created;
    }

    const asForm = (dto: DashboardReportDto): Partial<SaveDashboardReportInput> => ({
      ...sameScope(dto),
      filter: {
        from: '',
        to: '',
        buIds: dto.scope.buIds,
        ...(dto.scope.locationIds.length > 0 ? { locationIds: dto.scope.locationIds } : {}),
      },
    });

    test('lokasi Serah Terima di luar hak pelaku ditolak saat cakupan diubah', async () => {
      const created = await ownerWithLocations(['hs.created']);
      expect([...created.scope.locationIds].sort()).toEqual(['loc-a', 'loc-b']);
      const error = await saveDashboardReport(
        env,
        await userOf(OTHER),
        input({
          ...asForm(created),
          widgets: [{ id: 'hs.created', filters: { status: ['new'] } }],
        }),
      ).catch((caught: unknown) => caught as { code?: string; message?: string });
      expect(error).toMatchObject({ code: 'VALIDATION', message: OUTSIDE });
    });

    test('lokasi stok di luar hak pelaku ditolak saat cakupan diubah', async () => {
      const created = await ownerWithLocations(['st.out']);
      const error = await saveDashboardReport(
        env,
        await userOf(OTHER),
        input({
          ...asForm(created),
          widgets: [
            { id: 'st.out', filters: {} },
            { id: 'sn.recorded', filters: {} },
          ],
        }),
      ).catch((caught: unknown) => caught as { code?: string; message?: string });
      expect(error).toMatchObject({ code: 'VALIDATION', message: OUTSIDE });
    });

    test('tanpa perubahan, lokasi di luar hak pelaku tetap utuh', async () => {
      const created = await ownerWithLocations(['hs.created']);
      const saved = await saveDashboardReport(
        env,
        await userOf(OTHER),
        input({ ...asForm(created), name: 'Hanya nama' }),
      );
      expect([...saved.scope.locationIds].sort()).toEqual(['loc-a', 'loc-b']);
    });

    /** Kedua BU untuk `email`, agar perubahan cakupan yang terdeteksi diterima dan hasilnya terlihat. */
    const giveBothBus = (email: string) =>
      env.DB.prepare('UPDATE users SET bu_assignments = ? WHERE email = ?')
        .bind(
          JSON.stringify([
            { buId: 'bu-x', roleIds: ['r-sn'] },
            { buId: 'bu-y', roleIds: ['r-sn'] },
          ]),
          email,
        )
        .run();

    test('perubahan filter grup widget terdeteksi sebagai perubahan cakupan (dibekukan ulang)', async () => {
      const created = await ownerWithBoth();
      await giveBothBus(OTHER);
      const withFilter = [{ id: 'sn.recorded' as const, filters: { custody: ['qc'] } }];
      const saved = await saveDashboardReport(
        env,
        await userOf(OTHER),
        input({ ...sameScope(created), widgets: withFilter }),
      );
      expect(saved.scope.widgets).toEqual(withFilter);
    });

    test('perubahan locationFiltered terdeteksi sebagai perubahan cakupan (dibekukan ulang)', async () => {
      await seedLocation(env, { id: 'loc-a', code: 'LA' });
      await giveBothBus(OWNER);
      await giveBothBus(OTHER);
      const created = await saveDashboardReport(
        env,
        await userOf(),
        input({ filter: { from: '', to: '', locationIds: ['loc-a'] }, locationFiltered: true }),
      );
      expect(created.scope.locationFiltered).toBe(true);
      expect(created.scope.locationIds).toEqual(['loc-a']);
      env.clock.advance(1000);
      const saved = await saveDashboardReport(
        env,
        await userOf(OTHER),
        input({ ...asForm(created), locationFiltered: false }),
      );
      expect(saved.scope.locationFiltered).toBe(false);
      expect(saved.scope.locationIds).toEqual([]);
    });

    test('urutan dan duplikat daftar BU tidak dihitung perubahan cakupan (cakupan lama utuh)', async () => {
      const created = await ownerWithBoth();
      const saved = await saveDashboardReport(
        env,
        await userOf(OTHER), // hanya BU x: bila dianggap berubah, hasilnya ditolak
        input({
          ...sameScope(created),
          filter: { from: '', to: '', buIds: ['bu-y', 'bu-x', 'bu-y'] },
        }),
      );
      expect([...saved.scope.buIds].sort()).toEqual(['bu-x', 'bu-y']);
      expect(saved.scope.widgets.map((widget) => widget.id)).toEqual(
        created.scope.widgets.map((widget) => widget.id),
      );
    });

    /** Cakupan beku pemilik memuat lokasi yang kemudian dinonaktifkan. */
    async function reportWithInactiveLocation(): Promise<DashboardReportDto> {
      const created = await ownerWithLocations(['hs.created']);
      await env.DB.prepare("UPDATE locations SET status = 'inactive' WHERE id = 'loc-b'").run();
      return created;
    }

    test('super admin = perilaku lama: mengubah cakupan membuang lokasi nonaktif diam-diam, bukan menolak', async () => {
      const created = await reportWithInactiveLocation();
      const saved = await saveDashboardReport(
        env,
        await userOf(ADMIN),
        input({
          ...asForm(created),
          widgets: [
            { id: 'hs.created', filters: {} },
            { id: 'sn.recorded', filters: {} },
          ],
        }),
      );
      expect(saved.scope.locationIds).not.toContain('loc-b');
      expect(saved.scope.widgets.map((widget) => widget.id)).toEqual(['hs.created', 'sn.recorded']);
    });

    test('super admin menyimpan tanpa mengubah cakupan: dibekukan ulang seperti perilaku lama', async () => {
      const created = await reportWithInactiveLocation();
      const saved = await saveDashboardReport(
        env,
        await userOf(ADMIN),
        input({ ...asForm(created), name: 'Nama saja' }),
      );
      expect(saved.scope.locationIds).not.toContain('loc-b');
    });

    test('pembanding super admin: pelaku manage non-pemilik mempertahankan lokasi beku nonaktif bila cakupan tak diubah', async () => {
      const created = await reportWithInactiveLocation();
      const saved = await saveDashboardReport(
        env,
        await userOf(OTHER),
        input({ ...asForm(created), name: 'Nama saja' }),
      );
      expect([...saved.scope.locationIds].sort()).toEqual(['loc-a', 'loc-b']);
    });

    test('pembanding super admin: pelaku manage non-pemilik ditolak generik (bukan membuang diam-diam) bila cakupan diubah', async () => {
      const created = await reportWithInactiveLocation();
      const error = await saveDashboardReport(
        env,
        await userOf(OTHER),
        input({
          ...asForm(created),
          widgets: [
            { id: 'hs.created', filters: {} },
            { id: 'sn.recorded', filters: {} },
          ],
        }),
      ).catch((caught: unknown) => caught as { code?: string; message?: string });
      expect(error).toMatchObject({ code: 'VALIDATION', message: OUTSIDE });
      const row = await loadReport(env.DB, created.id);
      expect([...(parseReportScope(row?.scope ?? '')?.locationIds ?? [])].sort()).toEqual([
        'loc-a',
        'loc-b',
      ]);
    });

    test('pemilik sendiri dan super admin: perilaku lama (cakupan dibekukan menurut haknya)', async () => {
      const created = await ownerWithBoth();
      const owner = await userOf();
      const narrowed = await saveDashboardReport(
        env,
        owner,
        input({ ...sameScope(created), filter: { from: '', to: '', buIds: ['bu-x'] } }),
      );
      expect(narrowed.scope.buIds).toEqual(['bu-x']);
      env.clock.advance(1000);
      const admin = await userOf(ADMIN);
      const adminSaved = await saveDashboardReport(
        env,
        admin,
        input({ ...sameScope(narrowed), filter: { from: '', to: '', buIds: ['bu-x', 'bu-y'] } }),
      );
      expect([...adminSaved.scope.buIds].sort()).toEqual(['bu-x', 'bu-y']);
    });
  });
});

describe('hapus dan audit', () => {
  test('menghapus laporan mencabut tautan terbitan dan menghapus baris; audit tanpa alamat penerima', async () => {
    const owner = await userOf();
    const created = await saveDashboardReport(env, owner, input());
    await insertShareStmt(env.DB, {
      id: 's-terbitan',
      title: 'Terbitan',
      created_by: OWNER,
      created_at: '2026-11-23T00:00:00.000Z',
      expires_at: '2026-12-31T00:00:00.000Z',
      revoked_at: '',
      revoked_by: '',
      scope: '{}',
      report_id: created.id,
    }).run();
    await insertShareStmt(env.DB, {
      id: 's-biasa',
      title: 'Biasa',
      created_by: OWNER,
      created_at: '2026-11-23T00:00:00.000Z',
      expires_at: '2026-12-31T00:00:00.000Z',
      revoked_at: '',
      revoked_by: '',
      scope: '{}',
      report_id: '',
    }).run();
    env.clock.advance(1000);
    await setDashboardReportEnabled(env, owner, { id: created.id, enabled: false });
    await setDashboardReportEnabled(env, owner, { id: created.id, enabled: true });
    await removeDashboardReport(env, owner, created.id);

    expect(await loadReport(env.DB, created.id)).toBeNull();
    expect((await loadShare(env.DB, 's-terbitan'))?.revoked_at).not.toBe('');
    expect((await loadShare(env.DB, 's-biasa'))?.revoked_at).toBe('');

    const audits = await env.DB.prepare(
      "SELECT action, target_id, `before`, `after` FROM audit_log WHERE action LIKE 'dashboard.report_%' ORDER BY id",
    ).all<{ action: string; target_id: string; before: string; after: string }>();
    expect(audits.results.map((row) => row.action)).toEqual([
      'dashboard.report_create',
      'dashboard.report_pause',
      'dashboard.report_resume',
      'dashboard.report_delete',
    ]);
    for (const row of audits.results) {
      expect(row.target_id).toBe(created.id);
      expect(`${row.before}${row.after}`).not.toContain('penerima@contoh.id');
      expect(`${row.before}${row.after}`).not.toContain('contoh.id');
    }
  });

  test('menghapus yang tak ada = NOT_FOUND; menjeda dua kali idempoten dan satu audit', async () => {
    const owner = await userOf();
    expect((await captureAppErrorAsync(() => removeDashboardReport(env, owner, 'x')))?.code).toBe(
      'NOT_FOUND',
    );
    const created = await saveDashboardReport(env, owner, input());
    await setDashboardReportEnabled(env, owner, { id: created.id, enabled: false });
    await setDashboardReportEnabled(env, owner, { id: created.id, enabled: false });
    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'dashboard.report_pause'",
    ).first<{ n: number | string }>();
    expect(Number(count?.n)).toBe(1);
  });

  test('perubahan penerima tercatat lewat tanda tanpa alamat', async () => {
    const owner = await userOf();
    const created = await saveDashboardReport(env, owner, input());
    env.clock.advance(1000);
    await saveDashboardReport(
      env,
      owner,
      input({
        id: created.id,
        recipients: ['lain@contoh.id'],
        expectedUpdatedAt: created.updatedAt,
      }),
    );
    const row = await env.DB.prepare(
      "SELECT `before`, `after` FROM audit_log WHERE action = 'dashboard.report_update'",
    ).first<{ before: string; after: string }>();
    const before = JSON.parse(row?.before ?? '{}') as { recipientsMark: string };
    const after = JSON.parse(row?.after ?? '{}') as { recipientsMark: string };
    expect(before.recipientsMark).not.toBe(after.recipientsMark);
    expect(`${row?.before}${row?.after}`).not.toContain('@');
  });
});

describe('daftar', () => {
  test('smtpConfigured mengikuti MAILER; limit = 20', async () => {
    const owner = await userOf();
    const without = await listDashboardReports(env, owner);
    expect(without.smtpConfigured).toBe(false);
    expect(without.limit).toBe(20);
    env.MAILER = { send: async () => {} };
    expect((await listDashboardReports(env, owner)).smtpConfigured).toBe(true);
  });

  test('nextRunAt kosong bila dijeda', async () => {
    const owner = await userOf();
    const created = await saveDashboardReport(env, owner, input());
    expect(created.nextRunAt).not.toBe('');
    const paused = await setDashboardReportEnabled(env, owner, { id: created.id, enabled: false });
    expect(paused.nextRunAt).toBe('');
  });
});

describe('simpan ulang dengan masukan seperti formulir tidak mengubah cakupan efektif', () => {
  async function grantHandoverAt(...locationIds: string[]): Promise<void> {
    await seedRole(env, { id: 'r-ho', name: 'HO', permissions: { handover: 'view' } });
    for (const id of locationIds) await seedLocation(env, { id, code: id.toUpperCase() });
    await env.DB.prepare('UPDATE users SET assignments = ? WHERE email = ?')
      .bind(
        JSON.stringify([
          { locationId: null, roleIds: ['r-dash'] },
          ...locationIds.map((locationId) => ({ locationId, roleIds: ['r-ho'] })),
        ]),
        OWNER,
      )
      .run();
  }

  /** Masukan yang dikirim formulir ubah: himpunan beku dianggap pilihan, `locationFiltered` dari data tersimpan. */
  const resubmit = (dto: Awaited<ReturnType<typeof saveDashboardReport>>) =>
    input({
      id: dto.id,
      expectedUpdatedAt: dto.updatedAt,
      name: 'Nama baru',
      filter: {
        from: '',
        to: '',
        ...(dto.scope.buIds.length > 0 ? { buIds: dto.scope.buIds } : {}),
        ...(dto.scope.locationIds.length > 0 ? { locationIds: dto.scope.locationIds } : {}),
      },
      locationFiltered: dto.scope.locationFiltered,
      widgets: dto.scope.widgets,
      offers: dto.scope.offers,
    });

  test('Serah Terima + Serial tanpa pilihan lokasi: scope sama persis, Serial tetap tak tersaring', async () => {
    await grantHandoverAt('loc-a', 'loc-b');
    const owner = await userOf();
    const created = await saveDashboardReport(
      env,
      owner,
      input({
        widgets: [
          { id: 'hs.created', filters: {} },
          { id: 'sn.recorded', filters: {} },
        ],
      }),
    );
    expect(created.scope.locationFiltered).toBe(false);
    expect([...created.scope.locationIds].sort()).toEqual(['loc-a', 'loc-b']);
    const again = await saveDashboardReport(env, await userOf(), resubmit(created));
    expect(again.scope).toEqual(created.scope);
    const row = await loadReport(env.DB, created.id);
    expect(parseReportScope(row?.scope ?? '')?.locationFiltered).toBe(false);
  });

  test('locationFiltered true: scope sama persis', async () => {
    await grantHandoverAt('loc-a', 'loc-b');
    const owner = await userOf();
    const created = await saveDashboardReport(
      env,
      owner,
      input({
        filter: { from: '', to: '', locationIds: ['loc-a'] },
        locationFiltered: true,
        widgets: [
          { id: 'hs.created', filters: {} },
          { id: 'sn.recorded', filters: {} },
        ],
      }),
    );
    expect(created.scope.locationFiltered).toBe(true);
    expect(created.scope.locationIds).toEqual(['loc-a']);
    const again = await saveDashboardReport(env, await userOf(), resubmit(created));
    expect(again.scope).toEqual(created.scope);
  });
});

describe('batas simpan BU dan lokasi lebih longgar dari filter biasa', () => {
  const BU_COUNT = 25;
  const buIdsOf = (count: number) => Array.from({ length: count }, (_, index) => `bu-n${index}`);

  async function seedManyBus(): Promise<void> {
    for (const id of buIdsOf(BU_COUNT)) await seedBusinessUnit(env, { id, code: id.toUpperCase() });
  }
  const assignBus = (count: number) =>
    env.DB.prepare('UPDATE users SET bu_assignments = ? WHERE email = ?')
      .bind(JSON.stringify(buIdsOf(count).map((buId) => ({ buId, roleIds: ['r-sn'] }))), OWNER)
      .run();

  test('25 BU beku disimpan utuh; hak berkurang 3 = 22 tersimpan; simpan ulang tanpa perubahan = cakupan sama', async () => {
    await seedManyBus();
    await assignBus(BU_COUNT);
    const created = await saveDashboardReport(
      env,
      await userOf(),
      input({ filter: { from: '', to: '', buIds: buIdsOf(BU_COUNT) } }),
    );
    expect([...created.scope.buIds].sort()).toEqual([...buIdsOf(BU_COUNT)].sort());

    // Pemilik kehilangan tiga BU terakhir; formulir mengirim himpunan beku apa adanya.
    await assignBus(BU_COUNT - 3);
    const resubmit = (dto: typeof created) =>
      input({
        id: dto.id,
        expectedUpdatedAt: dto.updatedAt,
        filter: { from: '', to: '', buIds: dto.scope.buIds },
        widgets: dto.scope.widgets,
        offers: dto.scope.offers,
      });
    const reduced = await saveDashboardReport(env, await userOf(), resubmit(created));
    expect([...reduced.scope.buIds].sort()).toEqual([...buIdsOf(BU_COUNT - 3)].sort());

    const again = await saveDashboardReport(env, await userOf(), resubmit(reduced));
    expect(again.scope).toEqual(reduced.scope);
  });

  test('200 nilai sah, 201 ditolak VALIDATION (validator dan layanan), daftar bukan teks ditolak', async () => {
    const many = (count: number) => Array.from({ length: count }, (_, index) => `id-${index}`);
    const wire = (filter: Record<string, unknown>) => ({
      ...input(),
      filter: { from: '', to: '', ...filter },
    });
    expect(thrown(() => validateSaveReport(wire({ buIds: many(200) }))).code).toBeUndefined();
    expect(thrown(() => validateSaveReport(wire({ locationIds: many(200) }))).code).toBeUndefined();
    const bu = thrown(() => validateSaveReport(wire({ buIds: many(201) })));
    expect(bu.code).toBe('VALIDATION');
    expect(bu.fields?.['filter.buIds']).toBe('Maksimal 200 nilai');
    const location = thrown(() => validateSaveReport(wire({ locationIds: many(201) })));
    expect(location.code).toBe('VALIDATION');
    expect(location.fields?.['filter.locationIds']).toBe('Maksimal 200 nilai');

    // Layanan yang dipanggil langsung (tanpa validator rute) juga menolak.
    const owner = await userOf();
    const error = await captureAppErrorAsync(() =>
      saveDashboardReport(env, owner, input({ filter: { from: '', to: '', buIds: many(201) } })),
    );
    expect(error.code).toBe('VALIDATION');
  });
});
