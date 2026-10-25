import { describe, expect, test } from 'bun:test';
import { createTestEnv } from '@worker-test/test-env';
import { signSessionToken } from '../src/core/session';
import { app } from '../src/index';
import { buildCases } from './load-cpu-cases';
import {
  assertStagingTarget,
  auditCursorAfter,
  buildLoadSql,
  cpuByRoute,
  d1RemoteArgs,
  failingRoutes,
  LOAD_SIZES,
  parseTailStream,
  percentile,
  renderTable,
  STAGING,
  summarize,
} from './load-cpu-lib';

describe('statistik', () => {
  test('percentile nearest-rank', () => {
    const data = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(data, 50)).toBe(50);
    expect(percentile(data, 99)).toBe(99);
    expect(percentile(data, 100)).toBe(100);
    expect(percentile([7], 99)).toBe(7);
    expect(Number.isNaN(percentile([], 50))).toBe(true);
  });

  test('summarize dan failingRoutes: lewat anggaran, tak terukur, atau panggilan gagal', () => {
    const ok = summarize('a', [1, 2, 3, 2, 2], 5, 0);
    expect(ok).toMatchObject({ p50: 2, p99: 3, max: 3, measured: 5 });
    const slow = summarize('b', [2, 3, 9], 3, 0);
    const none = summarize('c', [], 3, 0);
    const failed = summarize('d', [1, 1], 2, 1);
    expect(failingRoutes([ok, slow, none, failed])).toEqual(['b', 'c', 'd']);
    expect(failingRoutes([summarize('e', [8, 8], 2, 0)])).toEqual([]);
    expect(renderTable([ok, slow])).toContain('| b | 3 | 3 | 3 | 9 | 9 | LEWAT |');
  });
});

describe('tail', () => {
  const event = (url: string, cpu: number, outcome = 'ok') =>
    JSON.stringify(
      {
        wallTime: cpu,
        cpuTime: cpu,
        outcome,
        event: { request: { url, method: 'POST', note: 'x}"{' } },
      },
      null,
      4,
    );

  test('memisahkan objek berformat berurutan dan mengabaikan teks lain', () => {
    const text = `Successfully created tail\n${event('https://h/api/rpc?r=a&i=0', 3)}\n${event('https://h/api/rpc?r=a&i=1', 5)}\nsampah\n${event('https://h/api/rpc?r=b&i=0', 2, 'exceededCpu')}`;
    const events = parseTailStream(text);
    expect(events.map((e) => e.cpuTime)).toEqual([3, 5, 2]);
    const byRoute = cpuByRoute(events);
    expect(byRoute.get('a')).toEqual([3, 5]);
    expect(byRoute.has('b')).toBe(false); // bukan outcome ok
  });
});

describe('penjaga staging', () => {
  test('menolak production, Worker app, D1 production, host lain, env lain', () => {
    expect(() =>
      assertStagingTarget({
        host: STAGING.host,
        workerName: 'app-staging',
        dbName: 'qc-app-staging',
        env: 'staging',
      }),
    ).not.toThrow();
    for (const bad of [
      { host: 'app.qc-225.workers.dev' },
      { workerName: 'app' },
      { dbName: 'qc-app-production' },
      { env: 'production' },
      { env: 'prod' },
      { host: 'app-staging.qc-225.workers.dev', dbName: 'cf7f9bb3-202d-4819-bc1f-c60581795933' },
    ]) {
      expect(() => assertStagingTarget(bad)).toThrow(/DITOLAK/);
    }
  });

  test('argumen wrangler remote selalu --env staging dan tidak memuat production', () => {
    for (const args of [d1RemoteArgs('execute', 'x.sql'), d1RemoteArgs('restore', '0000-abc')]) {
      expect(args).toContain('staging');
      expect(args.join(' ')).not.toContain('production');
    }
    expect(d1RemoteArgs('execute', 'x.sql')).toContain('--remote');
    expect(() => d1RemoteArgs('execute', 'qc-app-production.sql')).toThrow(/DITOLAK/);
  });
});

describe('data beban dan semua rute (terhadap D1 sqlite lokal)', () => {
  const NOW = Date.parse('2026-10-25T05:00:00.000Z');

  test('SQL beban berlaku, ukuran proyeksi benar, setiap rute menjawab ok dengan muatan terbesar', async () => {
    const env = await createTestEnv({
      ADMIN_EMAIL: 'bukan@example.test',
      SYNC_API_TOKEN: 't'.repeat(48),
    });
    env.clock.set(NOW);
    const sql = buildLoadSql(STAGING.loadEmail, NOW);
    // tiap pernyataan di bawah batas D1 100 KB
    for (const statement of sql.split(';\n')) expect(statement.length).toBeLessThan(100_000);
    await env.DB.exec(sql);
    const count = async (table: string) =>
      (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())?.n ?? 0;
    expect(await count('handovers')).toBe(LOAD_SIZES.tasks + 6);
    expect(await count('items')).toBe(LOAD_SIZES.items + 10);
    expect(await count('audit_log')).toBe(LOAD_SIZES.audit + 1);
    expect(await count('brands')).toBe(LOAD_SIZES.brands + 3);
    expect(await count('handover_comments')).toBeGreaterThan(1500);

    const token = await signSessionToken(env, STAGING.loadEmail, NOW);
    const headers = {
      cookie: `qc_session=${token}`,
      'x-requested-with': 'qc',
      'content-type': 'application/json',
    };
    const cases = buildCases({ nowMs: NOW, syncToken: env.SYNC_API_TOKEN });
    const timings: string[] = [];
    for (const loadCase of cases) {
      expect(loadCase.calls).toBeGreaterThanOrEqual(30);
      for (let i = 0; i < loadCase.calls; i++) {
        const request = loadCase.request(i);
        const url = `https://${STAGING.host}${request.path}?r=${encodeURIComponent(loadCase.name)}&i=${i}`;
        const started = performance.now();
        const response = await app.request(
          url,
          {
            method: request.method,
            headers: request.auth === 'cookie' ? headers : { 'content-type': 'application/json' },
            ...(request.body !== undefined ? { body: JSON.stringify(request.body) } : {}),
          },
          env,
        );
        const text = await response.text();
        let ok = response.status === 200;
        if (ok && request.path !== '/api/ping') {
          ok = (JSON.parse(text) as { ok?: boolean }).ok === true;
        }
        if (!ok) throw new Error(`${loadCase.name}#${i}: ${response.status} ${text.slice(0, 300)}`);
        if (i === loadCase.calls - 1)
          timings.push(`${loadCase.name}: ${(performance.now() - started).toFixed(1)} ms`);
      }
    }
    expect(timings.length).toBe(cases.length);
  }, 300_000);

  test('kursor audit mengarah ke baris yang ada', () => {
    const cursor = auditCursorAfter(NOW, 50);
    expect(cursor).toMatch(/^\d{4}-\d\d-\d\dT.+Z~\d+$/);
  });
});
