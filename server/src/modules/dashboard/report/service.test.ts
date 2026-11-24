import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { loadUserContext, type UserContext } from '@server/modules/access/context';
import { seedBusinessUnit, seedLocation, seedRole, seedUser } from '@server-test/access-fixtures';
import { captureAppErrorAsync } from '@server-test/errors';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import type { SaveDashboardReportInput } from '@shared/dashboard-report';
import { REPORT_LIMITS } from '@shared/dashboard-report';
import { insertShareStmt, loadShare } from '../share-repo';
import { insertReportStmt, loadReport, parseReportScope, type ReportRow } from './repo';
import {
  getDashboardReport,
  listDashboardReports,
  removeDashboardReport,
  saveDashboardReport,
  setDashboardReportEnabled,
} from './service';
import { validateSaveReport } from './validate';

setDefaultTimeout(60_000);

let env: TestEnv;
const NOW = Date.parse('2026-11-23T05:00:00.000Z'); // Senin 23 Nov 2026 12:00 WIB
const OWNER = 'owner@gmail.com';
const OTHER = 'other@gmail.com';
const ADMIN = 'admin@gmail.com';

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(NOW);
  await seedBusinessUnit(env, { id: 'bu-x', code: 'X' });
  await seedBusinessUnit(env, { id: 'bu-y', code: 'Y' });
  await seedRole(env, { id: 'r-dash', name: 'Dash', permissions: { dashboard: 'manage' } });
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

describe('Review Focus 4: hak', () => {
  test('pemegang manage lain melihat metadata saja; mengubah, menjeda, dan menghapus = FORBIDDEN; super admin boleh', async () => {
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

    const other = await userOf(OTHER);
    const seen = await getDashboardReport(env, other, created.id);
    expect(seen.recipients).toEqual([]);
    expect(seen.recipientCount).toBe(1);
    expect(seen.canEdit).toBe(false);
    expect(seen.links).toBeUndefined();
    expect(seen.scope.buIds).toEqual([]);
    expect(seen.scope.widgets).toEqual([{ id: 'sn.recorded', filters: {} }]);
    const listed = (await listDashboardReports(env, other)).reports[0];
    expect(listed?.recipients).toEqual([]);
    expect(listed?.canEdit).toBe(false);

    const mine = await getDashboardReport(env, owner, created.id);
    expect(mine.recipients).toEqual(['penerima@contoh.id']);
    expect(mine.canEdit).toBe(true);
    expect(mine.links?.map((link) => link.id)).toEqual(['s-terbitan']);

    const forbidden = [
      () =>
        saveDashboardReport(
          env,
          other,
          input({ id: created.id, expectedUpdatedAt: created.updatedAt }),
        ),
      () => setDashboardReportEnabled(env, other, { id: created.id, enabled: false }),
      () => removeDashboardReport(env, other, created.id),
    ];
    for (const run of forbidden) {
      expect((await captureAppErrorAsync(run))?.code).toBe('FORBIDDEN');
    }

    const admin = await userOf(ADMIN);
    expect(admin.isSuperAdmin).toBe(true);
    const adminView = await getDashboardReport(env, admin, created.id);
    expect(adminView.recipients).toEqual(['penerima@contoh.id']);
    expect(adminView.links).toHaveLength(1);
    const paused = await setDashboardReportEnabled(env, admin, { id: created.id, enabled: false });
    expect(paused.enabled).toBe(false);
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
