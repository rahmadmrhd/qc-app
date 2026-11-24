import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { insertShareStmt, loadShare, type ShareRow } from '../share-repo';
import { REPORT_SHARE_RETAIN_MS, sweepReportShares } from './sweep';

setDefaultTimeout(60_000);

const NOW = Date.parse('2026-11-23T05:00:00.000Z');
let env: TestEnv;

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(NOW);
});

function share(id: string, reportId: string, expiresMs: number): ShareRow {
  return {
    id,
    title: 'T',
    created_by: 'owner@gmail.com',
    created_at: new Date(NOW - 90 * 86_400_000).toISOString(),
    expires_at: new Date(expiresMs).toISOString(),
    revoked_at: '',
    revoked_by: '',
    scope: '{}',
    report_id: reportId,
  };
}

async function visit(shareId: string): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO dashboard_share_visits (id, share_id, visited_at, country, device, ip_prefix) VALUES (?, ?, ?, '', '', '')",
  )
    .bind(`v-${shareId}`, shareId, new Date(NOW).toISOString())
    .run();
}

describe('sweepReportShares', () => {
  test('menghapus tautan terbitan yang lewat 30 hari beserta kunjungannya; yang lain tetap', async () => {
    await env.DB.batch([
      insertShareStmt(env.DB, share('old', 'r1', NOW - REPORT_SHARE_RETAIN_MS - 1000)),
      insertShareStmt(env.DB, share('recent', 'r1', NOW - REPORT_SHARE_RETAIN_MS + 60_000)),
      insertShareStmt(env.DB, share('active', 'r1', NOW + 86_400_000)),
      // Tautan biasa (bukan terbitan laporan) tak pernah disapu di sini, seberapa pun tuanya.
      insertShareStmt(env.DB, share('manual-old', '', NOW - 90 * 86_400_000)),
    ]);
    await visit('old');
    await visit('recent');

    expect(await sweepReportShares(env)).toBe(1);
    expect(await loadShare(env.DB, 'old')).toBeNull();
    expect(await loadShare(env.DB, 'recent')).not.toBeNull();
    expect(await loadShare(env.DB, 'active')).not.toBeNull();
    expect(await loadShare(env.DB, 'manual-old')).not.toBeNull();
    const visits = await env.DB.prepare(
      'SELECT share_id FROM dashboard_share_visits ORDER BY share_id',
    ).all<{
      share_id: string;
    }>();
    expect(visits.results.map((row) => row.share_id)).toEqual(['recent']);
  });

  test('idempoten: sapuan kedua tidak menghapus apa pun', async () => {
    await env.DB.batch([
      insertShareStmt(env.DB, share('old', 'r1', NOW - REPORT_SHARE_RETAIN_MS - 1000)),
    ]);
    expect(await sweepReportShares(env)).toBe(1);
    expect(await sweepReportShares(env)).toBe(0);
  });
});
