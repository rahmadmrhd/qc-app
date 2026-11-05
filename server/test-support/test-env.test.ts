// Tes harness MariaDB (butuh `bun run db:tunnel`).
import { afterAll, describe, expect, test } from 'bun:test';
import { createDb } from '@server/core/db';
import { newTestSchemaName, testDbUrl } from './db-env';
import { currentTestSchema, dropTestSchemas, sweepOrphanSchemas } from './test-db';
import { createTestEnv } from './test-env';

afterAll(async () => {
  await dropTestSchemas();
});

describe('createTestEnv', () => {
  test('dua panggilan berurutan terisolasi (data tes pertama tak terlihat)', async () => {
    const first = await createTestEnv();
    await first.DB.prepare("INSERT INTO settings (`key`, value) VALUES ('k1', 'v1')").run();
    expect(
      (await first.DB.prepare('SELECT COUNT(*) AS n FROM settings').first<{ n: number }>())?.n,
    ).toBe(1);
    const second = await createTestEnv();
    const row = await second.DB.prepare('SELECT COUNT(*) AS n FROM settings').first<{
      n: number;
    }>();
    expect(Number(row?.n)).toBe(0);
  });

  test('rata-rata createTestEnv <= 400 ms lewat tunnel', async () => {
    await createTestEnv(); // hangatkan pool
    const N = 10;
    const times: number[] = [];
    for (let i = 0; i < N; i++) {
      const t0 = performance.now();
      const env = await createTestEnv();
      times.push(performance.now() - t0);
      await env.DB.prepare("INSERT INTO settings (`key`, value) VALUES ('x', 'y')").run();
    }
    const avg = times.reduce((a, b) => a + b, 0) / N;
    console.log(
      `CREATE_TEST_ENV avg=${avg.toFixed(0)}ms min=${Math.min(...times).toFixed(0)}ms max=${Math.max(...times).toFixed(0)}ms (N=${N})`,
    );
    expect(avg).toBeLessThanOrEqual(400);
  }, 60_000);
});

describe('skema sementara', () => {
  test('dropTestSchemas menghapus skema tes dan skema baru dibuat lagi bila dibutuhkan', async () => {
    await createTestEnv();
    const name = currentTestSchema();
    expect(name).toMatch(/^qc_test_\d+_[0-9a-f]{8}$/);
    const admin = createDb({ url: testDbUrl() });
    try {
      const exists = async (schema: string) =>
        (
          await admin
            .prepare('SELECT COUNT(*) AS n FROM information_schema.schemata WHERE schema_name = ?')
            .bind(schema)
            .first<{ n: number }>()
        )?.n;
      expect(Number(await exists(name ?? ''))).toBe(1);
      await dropTestSchemas();
      expect(Number(await exists(name ?? ''))).toBe(0);
      expect(currentTestSchema()).toBeNull();
      const env = await createTestEnv();
      expect(
        (await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>())?.n,
      ).toBe(0);
    } finally {
      await admin.close();
    }
  }, 60_000);

  test('sweepOrphanSchemas membuang skema yatim lama (> 6 jam) dan menyisakan yang baru', async () => {
    const admin = createDb({ url: testDbUrl() });
    try {
      const old = `qc_test_${Math.floor(Date.now() / 1000) - 7 * 3600}_deadbeef`;
      const recent = newTestSchemaName();
      await admin.exec(`CREATE DATABASE \`${old}\`; CREATE DATABASE \`${recent}\``);
      const dropped = await sweepOrphanSchemas(admin);
      expect(dropped).toContain(old);
      expect(dropped).not.toContain(recent);
      const rows = await admin
        .prepare(
          'SELECT schema_name AS s FROM information_schema.schemata WHERE schema_name IN (?, ?)',
        )
        .bind(old, recent)
        .all<{ s: string }>();
      expect(rows.results.map((r) => r.s)).toEqual([recent]);
      await admin.exec(`DROP DATABASE \`${recent}\``);
    } finally {
      await admin.close();
    }
  }, 60_000);
});
