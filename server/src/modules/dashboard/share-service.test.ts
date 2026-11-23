import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { loadUserContext, type UserContext } from '@server/modules/access/context';
import { seedBusinessUnit, seedLocation, seedRole, seedUser } from '@server-test/access-fixtures';
import { captureAppErrorAsync } from '@server-test/errors';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import type { CreateShareInput } from '@shared/dashboard-share';
import { SHARE_LIMITS } from '@shared/dashboard-share';
import { verifyShareToken } from './share-link';
import { insertShareStmt, loadShare, parseScope } from './share-repo';
import { createShare, freezeScope, shareUrl } from './share-service';

setDefaultTimeout(60_000);

let env: TestEnv;
const NOW = Date.parse('2026-11-23T05:00:00.000Z'); // 23 Nov 2026 12:00 WIB
const SHARER = 'sharer@gmail.com';

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(NOW);
  await seedLocation(env, { id: 'loc-a', code: 'A', name: 'Lokasi A' });
  await seedLocation(env, { id: 'loc-b', code: 'B', name: 'Lokasi B' });
  await seedBusinessUnit(env, { id: 'bu-x', code: 'X' });
  await seedBusinessUnit(env, { id: 'bu-y', code: 'Y' });
  await seedRole(env, { id: 'r-dash', name: 'Dash', permissions: { dashboard: 'manage' } });
  await seedRole(env, { id: 'r-sn', name: 'SN', permissions: { serial: 'view' } });
  await seedRole(env, { id: 'r-hs', name: 'HS', permissions: { handover: 'view' } });
  await seedUser(env, {
    id: 'u-sharer',
    email: SHARER,
    assignments: [
      { locationId: null, roleIds: ['r-dash'] },
      { locationId: 'loc-a', roleIds: ['r-hs'] },
    ],
    buAssignments: [{ buId: 'bu-x', roleIds: ['r-sn'] }],
  });
});

const userOf = async (email = SHARER): Promise<UserContext> => {
  const user = await loadUserContext(env, email);
  if (!user) throw new Error('pengguna tidak ditemukan');
  return user;
};

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

/** Galat yang dilempar fungsi sinkron (`freezeScope`). */
function thrown(run: () => unknown): { code?: string } {
  try {
    run();
  } catch (error) {
    return error as { code?: string };
  }
  return {};
}

describe('freezeScope', () => {
  test('Review Focus 3: filter BU kosong = himpunan eksplisit hak pembagi; BU baru kemudian tidak ikut', async () => {
    const stored = await createShare(env, await userOf(), input());
    const row = await loadShare(env.DB, stored.id);
    expect(parseScope(row?.scope ?? '')?.buIds).toEqual(['bu-x']);
    // pembagi kemudian mendapat BU Y: cakupan tersimpan tetap [X]
    await env.DB.prepare('UPDATE users SET bu_assignments = ? WHERE email = ?')
      .bind(
        JSON.stringify([
          { buId: 'bu-x', roleIds: ['r-sn'] },
          { buId: 'bu-y', roleIds: ['r-sn'] },
        ]),
        SHARER,
      )
      .run();
    const after = await loadShare(env.DB, stored.id);
    expect(parseScope(after?.scope ?? '')?.buIds).toEqual(['bu-x']);
    // sedangkan tautan baru mendapat keduanya
    const second = await createShare(env, await userOf(), input());
    const secondRow = await loadShare(env.DB, second.id);
    expect(parseScope(secondRow?.scope ?? '')?.buIds.sort()).toEqual(['bu-x', 'bu-y']);
  });

  test('BU pilihan pembagi diiris dengan hak (BU di luar hak dibuang)', async () => {
    const scope = freezeScope(
      await userOf(),
      input({ filter: { from: '2026-11-01', to: '2026-11-23', buIds: ['bu-x', 'bu-y'] } }),
      NOW,
    );
    expect(scope.buIds).toEqual(['bu-x']);
  });

  test('Lokasi tanpa filter aktif = lokasi hak modul berlokasi dari widget terpilih saja', async () => {
    const user = await userOf();
    const withHandover = freezeScope(
      user,
      input({ widgets: [{ id: 'hs.created', filters: {} }] }),
      NOW,
    );
    expect(withHandover.locationFiltered).toBe(false);
    expect(withHandover.locationIds).toEqual(['loc-a']);
    expect(freezeScope(user, input(), NOW).locationIds).toEqual([]);
  });

  test('Lokasi dengan filter aktif = lokasi pilihan; filter aktif tanpa pilihan = VALIDATION', async () => {
    const user = await userOf();
    const scope = freezeScope(
      user,
      input({
        locationFiltered: true,
        filter: { from: '2026-11-01', to: '2026-11-23', locationIds: ['loc-a', 'loc-b'] },
        widgets: [
          { id: 'hs.created', filters: {} },
          { id: 'sn.recorded', filters: {} },
        ],
      }),
      NOW,
    );
    expect(scope.locationFiltered).toBe(true);
    expect([...scope.locationIds].sort()).toEqual(['loc-a', 'loc-b']);
    expect(thrown(() => freezeScope(user, input({ locationFiltered: true }), NOW)).code).toBe(
      'VALIDATION',
    );
  });

  test('rentang bergulir disimpan sebagai days; offers hanya kunci relasi yang filternya dipilih', async () => {
    const user = await userOf();
    const scope = freezeScope(
      user,
      input({
        range: { mode: 'rolling', days: 7 },
        widgets: [{ id: 'sn.recorded', filters: { item: ['i-1'] } }],
        offers: ['item'],
      }),
      NOW,
    );
    expect(scope.range).toEqual({ mode: 'rolling', days: 7 });
    expect(scope.offers).toEqual(['item']);
    // ditawarkan tetapi tak dipilih pembagi
    expect(thrown(() => freezeScope(user, input({ offers: ['item'] }), NOW)).code).toBe(
      'VALIDATION',
    );
    // kunci relasi dari grup yang tak ada pada widget terpilih
    expect(
      thrown(() =>
        freezeScope(
          user,
          input({
            widgets: [{ id: 'sn.recorded', filters: { item: ['i-1'] } }],
            offers: ['customer'],
          }),
          NOW,
        ),
      ).code,
    ).toBe('VALIDATION');
  });

  test('widget di luar hak, rentang tak sah, hari kedaluwarsa, judul, dan jumlah widget = VALIDATION', async () => {
    const user = await userOf();
    const cases: CreateShareInput[] = [
      input({ widgets: [{ id: 'pt.condition', filters: {} }] }), // tanpa izin Postel
      input({ widgets: [] }),
      input({ range: { mode: 'fixed', from: '2026-11-23', to: '2026-11-01' } }),
      input({ range: { mode: 'rolling', days: 0 } }),
      input({ range: { mode: 'rolling', days: 367 } }),
      input({ expiresInDays: 0 }),
      input({ expiresInDays: 366 }),
      input({ expiresInDays: 1.5 }),
      input({ title: '' }),
      input({ title: '   ' }),
      input({ title: 'x'.repeat(SHARE_LIMITS.titleMax + 1) }),
      input({
        widgets: Array.from({ length: SHARE_LIMITS.widgetsMax + 1 }, () => ({
          id: 'sn.recorded' as const,
          filters: {},
        })),
      }),
    ];
    for (const [index, value] of cases.entries()) {
      expect([index, thrown(() => freezeScope(user, value, NOW)).code]).toEqual([
        index,
        'VALIDATION',
      ]);
    }
  });
});

describe('createShare', () => {
  test('mengembalikan url berawalan APP_ORIGIN dengan token sah; expiresAt = sekarang + hari terpilih', async () => {
    const dto = await createShare(env, await userOf(), input({ expiresInDays: 7 }));
    expect(dto.url?.startsWith('https://qc.test/dashboard-publik/v1.')).toBe(true);
    const token = (dto.url ?? '').split('/dashboard-publik/')[1] ?? '';
    expect(await verifyShareToken(env.SESSION_SECRET, token, NOW)).toEqual({ shareId: dto.id });
    expect(dto.expiresAt).toBe(new Date(NOW + 7 * 86_400_000).toISOString());
    expect(dto.status).toBe('active');
    expect(dto.createdBy).toBe(SHARER);
    expect(dto.widgetCount).toBe(1);
    expect(dto.reportId).toBe('');
    expect(shareUrl(env, 'abc')).toBe('https://qc.test/dashboard-publik/abc');
  });

  test('audit tertulis dengan target dashboard_share:<id> dan tanpa token', async () => {
    const dto = await createShare(env, await userOf(), input());
    const rows = await env.DB.prepare(
      "SELECT actor, action, target, target_id, `after` FROM audit_log WHERE action = 'dashboard.share_create'",
    ).all<{ actor: string; action: string; target: string; target_id: string; after: string }>();
    expect(rows.results).toHaveLength(1);
    const audit = rows.results[0];
    expect(audit?.actor).toBe(SHARER);
    expect(audit?.target).toBe(`dashboard_share:${dto.id}`);
    expect(audit?.target_id).toBe(dto.id);
    const token = (dto.url ?? '').split('/dashboard-publik/')[1] ?? '';
    expect(JSON.stringify(audit)).not.toContain(token);
    expect(JSON.stringify(audit)).not.toContain('v1.');
  });

  test('batas 50 tautan aktif: ke-51 ditolak CONFLICT; dicabut, kedaluwarsa, dan terbitan laporan tidak dihitung', async () => {
    const user = await userOf();
    const scope = JSON.stringify(freezeScope(user, input(), NOW));
    const nowIso = new Date(NOW).toISOString();
    const base = {
      title: 'x',
      created_by: SHARER,
      created_at: nowIso,
      expires_at: '2026-12-23T00:00:00.000Z',
      revoked_at: '',
      revoked_by: '',
      scope,
      report_id: '',
    };
    const statements = [];
    for (let index = 0; index < SHARE_LIMITS.activePerSharer; index++) {
      statements.push(insertShareStmt(env.DB, { ...base, id: `aktif-${index}` }));
    }
    await env.DB.batch(statements);
    expect((await captureAppErrorAsync(() => createShare(env, user, input()))).code).toBe(
      'CONFLICT',
    );
    // cabut satu, kedaluwarsakan satu, jadikan satu terbitan laporan: tiga ruang kosong
    await env.DB.prepare("UPDATE dashboard_shares SET revoked_at = ? WHERE id = 'aktif-0'")
      .bind(nowIso)
      .run();
    await env.DB.prepare("UPDATE dashboard_shares SET expires_at = ? WHERE id = 'aktif-1'")
      .bind('2026-11-01T00:00:00.000Z')
      .run();
    await env.DB.prepare(
      "UPDATE dashboard_shares SET report_id = 'rep-1' WHERE id = 'aktif-2'",
    ).run();
    await createShare(env, user, input());
    await createShare(env, user, input());
    await createShare(env, user, input());
    expect((await captureAppErrorAsync(() => createShare(env, user, input()))).code).toBe(
      'CONFLICT',
    );
  });
});
