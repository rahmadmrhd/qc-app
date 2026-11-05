import { describe, expect, test } from 'bun:test';
import { createTestEnv } from '@server-test/test-env';
import { signSessionToken } from '../src/core/session';
import { app } from '../src/index';
import { buildCases, estimateRunWrites } from './load-cpu-cases';
import {
  assertStagingTarget,
  auditCursorAfter,
  buildLoadSql,
  cpuByRoute,
  D1_DAILY_WRITE_QUOTA,
  d1RemoteArgs,
  estimateSqlWrites,
  failingRoutes,
  LOAD_SIZES,
  MIN_SAMPLES,
  parseTailStream,
  percentile,
  renderTable,
  STAGING,
  summarize,
} from './load-cpu-lib';

const NL = String.fromCharCode(10);

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
    expect(ok).toMatchObject({ p50: 2, p95: 3, p99: 3, max: 3, measured: 5 });
    const slow = summarize('b', [2, 3, 9], 3, 0);
    const none = summarize('c', [], 3, 0);
    const failed = summarize('d', [1, 1], 2, 1);
    expect(failingRoutes([ok, slow, none, failed], 8, 1)).toEqual(['b', 'c', 'd']);
    expect(failingRoutes([summarize('e', [8, 8], 2, 0)], 8, 1)).toEqual([]);
    expect(renderTable([ok, slow], 8, 1)).toContain('| b | 3 | 3 | 3 | 9 | 9 | 9 | LEWAT |');
  });

  test('gerbang memakai p95; p99 dan maks informatif; terukur < 90 dari 100 menggagalkan', () => {
    const base = Array.from({ length: 100 }, () => 2);
    const withSpikes = (count: number) => base.map((v, i) => (i >= 100 - count ? 30 : v));
    // sampai 5 lonjakan (derau isolate): p95 tetap rendah, lulus walau p99 dan maks tinggi
    const noisy = summarize('r', withSpikes(5), 100, 0);
    expect(noisy).toMatchObject({ p95: 2, p99: 30, max: 30, measured: 100 });
    expect(failingRoutes([noisy])).toEqual([]);
    // 6 lonjakan = p95 melewati anggaran
    expect(failingRoutes([summarize('r', withSpikes(6), 100, 0)])).toEqual(['r']);
    // 93 sampel terukur (beberapa peristiwa tail hilang) tetap sah: p95 dihitung dari yang terukur
    const lossy = summarize('t', base.slice(0, 93), 100, 0);
    expect(MIN_SAMPLES).toBe(90);
    expect(failingRoutes([lossy])).toEqual([]);
    expect(renderTable([lossy])).toContain('| t | 100 | 93 | 2 | 2 | 2 | 2 | ok |');
    // 89 sampel terukur = gagal, walau semua cepat
    const few = summarize('s', base.slice(0, 89), 100, 0);
    expect(failingRoutes([few])).toEqual(['s']);
    expect(renderTable([few])).toContain('SAMPEL KURANG');
    expect(renderTable([noisy])).toContain('| r | 100 | 100 | 2 | 2 | 30 | 30 | ok |');
  });

  test('perkiraan baris ditulis: SQL beban dan satu run penuh di bawah kuota harian D1', () => {
    expect(
      estimateSqlWrites('INSERT INTO items (a) VALUES (1), (2), (3);' + NL + 'SELECT 1;'),
    ).toBe(21);
    expect(
      estimateSqlWrites('DELETE FROM items;' + NL + 'INSERT INTO audit_log (a) VALUES (1);'),
    ).toBe(4);
    const cases = buildCases({ nowMs: 0, syncToken: 'x' });
    const total = estimateRunWrites(cases);
    expect(total).toBeGreaterThan(30_000);
    expect(total).toBeLessThanOrEqual(90_000);
    expect(total).toBeLessThan(D1_DAILY_WRITE_QUOTA);
    expect(estimateRunWrites(cases.filter((c) => c.writes === 0))).toBe(0);
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
      { host: 'app-staging.qc-225.workers.dev' }, // staging lama di akun produksi
      { host: STAGING.host, dbName: 'cf7f9bb3-202d-4819-bc1f-c60581795933' },
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
    const changes = async () =>
      (await env.DB.prepare('SELECT total_changes() AS n').first<{ n: number }>())?.n ?? 0;
    for (const loadCase of cases) {
      expect(loadCase.calls).toBeGreaterThanOrEqual(100);
      expect(loadCase.calls).toBeGreaterThanOrEqual(MIN_SAMPLES);
      for (let i = 0; i < loadCase.calls; i++) {
        const changesBefore = await changes();
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
        // Rute tulis HARUS benar-benar menulis pada tiap panggilan (bukan jalur idempoten yang tak menulis);
        // rute baca tidak menulis apa pun.
        const delta = (await changes()) - changesBefore;
        if (loadCase.writes > 0 && delta === 0)
          throw new Error(
            `${loadCase.name}#${i}: rute tulis tidak menulis apa pun (target tumpang tindih?)`,
          );
        if (loadCase.writes === 0 && delta !== 0)
          throw new Error(`${loadCase.name}#${i}: rute baca menulis ${delta} baris`);
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
