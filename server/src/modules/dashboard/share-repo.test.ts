import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import type { ShareScope } from '@shared/dashboard-share';
import {
  countActiveShares,
  insertShareStmt,
  listShares,
  loadShare,
  parseScope,
  revokeShareStmt,
  type ShareRow,
} from './share-repo';

setDefaultTimeout(60_000);

let env: TestEnv;

beforeEach(async () => {
  env = await createTestEnv();
});

const NOW = '2026-11-23T05:00:00.000Z';

const SCOPE: ShareScope = {
  buIds: ['bu-a'],
  locationIds: ['loc-a'],
  locationFiltered: false,
  range: { mode: 'rolling', days: 30 },
  widgets: [{ id: 'hs.created', filters: { status: ['open'] } }],
  offers: ['customer'],
};

function row(overrides: Partial<ShareRow> = {}): ShareRow {
  return {
    id: 'share-1',
    title: 'Ringkasan',
    created_by: 'a@gmail.com',
    created_at: '2026-11-20T00:00:00.000Z',
    expires_at: '2026-12-20T00:00:00.000Z',
    revoked_at: '',
    revoked_by: '',
    scope: JSON.stringify(SCOPE),
    report_id: '',
    ...overrides,
  };
}

const insert = (value: ShareRow) => insertShareStmt(env.DB, value).run();

describe('insertShareStmt dan loadShare', () => {
  test('menyisip lalu memuat baris yang sama; id tak ada = null', async () => {
    const stmt = insertShareStmt(env.DB, row());
    await env.DB.batch([stmt]);
    expect(await loadShare(env.DB, 'share-1')).toEqual(row());
    expect(await loadShare(env.DB, 'tidak-ada')).toBeNull();
  });
});

describe('listShares', () => {
  test('terbaru dahulu; tautan terbitan laporan hanya bila diminta', async () => {
    await env.DB.batch([
      insertShareStmt(env.DB, row({ id: 's-lama', created_at: '2026-11-01T00:00:00.000Z' })),
      insertShareStmt(env.DB, row({ id: 's-baru', created_at: '2026-11-22T00:00:00.000Z' })),
      insertShareStmt(
        env.DB,
        row({ id: 's-laporan', created_at: '2026-11-23T00:00:00.000Z', report_id: 'rep-1' }),
      ),
    ]);
    expect((await listShares(env.DB, false)).map((r) => r.id)).toEqual(['s-baru', 's-lama']);
    expect((await listShares(env.DB, true)).map((r) => r.id)).toEqual([
      's-laporan',
      's-baru',
      's-lama',
    ]);
  });
});

describe('countActiveShares', () => {
  test('tak menghitung yang dicabut, kedaluwarsa, terbitan laporan, atau milik pembagi lain', async () => {
    await env.DB.batch([
      insertShareStmt(env.DB, row({ id: 'aktif-1' })),
      insertShareStmt(env.DB, row({ id: 'aktif-2' })),
      insertShareStmt(env.DB, row({ id: 'dicabut', revoked_at: '2026-11-21T00:00:00.000Z' })),
      insertShareStmt(env.DB, row({ id: 'lewat', expires_at: '2026-11-22T00:00:00.000Z' })),
      insertShareStmt(env.DB, row({ id: 'batas', expires_at: NOW })),
      insertShareStmt(env.DB, row({ id: 'laporan', report_id: 'rep-1' })),
      insertShareStmt(env.DB, row({ id: 'lain', created_by: 'b@gmail.com' })),
    ]);
    expect(await countActiveShares(env.DB, 'a@gmail.com', NOW)).toBe(2);
    expect(await countActiveShares(env.DB, 'b@gmail.com', NOW)).toBe(1);
    expect(await countActiveShares(env.DB, 'c@gmail.com', NOW)).toBe(0);
  });
});

describe('revokeShareStmt', () => {
  test('idempoten: cabut dua kali mempertahankan revoked_at dan revoked_by pertama', async () => {
    await insert(row());
    await revokeShareStmt(env.DB, 'share-1', 'a@gmail.com', '2026-11-23T01:00:00.000Z').run();
    await revokeShareStmt(env.DB, 'share-1', 'b@gmail.com', '2026-11-23T02:00:00.000Z').run();
    const loaded = await loadShare(env.DB, 'share-1');
    expect(loaded?.revoked_at).toBe('2026-11-23T01:00:00.000Z');
    expect(loaded?.revoked_by).toBe('a@gmail.com');
  });
});

describe('parseScope', () => {
  test('mengembalikan cakupan sah apa adanya', () => {
    expect(parseScope(JSON.stringify(SCOPE))).toEqual(SCOPE);
    const fixed: ShareScope = {
      ...SCOPE,
      locationFiltered: true,
      range: { mode: 'fixed', from: '2026-11-01', to: '2026-11-23' },
    };
    expect(parseScope(JSON.stringify(fixed))).toEqual(fixed);
  });

  test('null untuk JSON rusak, bentuk salah, atau widget tak dikenal', () => {
    expect(parseScope('{rusak')).toBeNull();
    expect(parseScope('')).toBeNull();
    expect(parseScope('null')).toBeNull();
    expect(parseScope('[]')).toBeNull();
    expect(
      parseScope(JSON.stringify({ ...SCOPE, widgets: [{ id: 'tidak.ada', filters: {} }] })),
    ).toBeNull();
    expect(parseScope(JSON.stringify({ ...SCOPE, buIds: 'bu-a' }))).toBeNull();
    expect(parseScope(JSON.stringify({ ...SCOPE, locationFiltered: 'ya' }))).toBeNull();
    expect(
      parseScope(JSON.stringify({ ...SCOPE, range: { mode: 'rolling', days: 0 } })),
    ).toBeNull();
    expect(
      parseScope(JSON.stringify({ ...SCOPE, range: { mode: 'fixed', from: 'x', to: 'y' } })),
    ).toBeNull();
    expect(
      parseScope(JSON.stringify({ ...SCOPE, widgets: [{ id: 'hs.created', filters: { a: 1 } }] })),
    ).toBeNull();
    expect(parseScope(JSON.stringify({ ...SCOPE, offers: ['rahasia'] }))).toBeNull();
  });
});
