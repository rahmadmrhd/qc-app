import { beforeEach, describe, expect, setDefaultTimeout, spyOn, test } from 'bun:test';
import { DbError } from '@server/core/db';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { runWidgets } from './engine';
import { createLimiter } from './limiter';
import type { WidgetCtx, WidgetImpl } from './registry';
import { resolveScope } from './scope';
import { WIDGET_STATEMENT_TIMEOUT_SECONDS, withStatementTimeout } from './statement-limit';

setDefaultTimeout(60_000);

/** MariaDB: ER_STATEMENT_TIMEOUT. */
const ER_STATEMENT_TIMEOUT = 1969;

let env: TestEnv;
beforeEach(async () => {
  env = await createTestEnv();
});

describe('withStatementTimeout (MariaDB nyata)', () => {
  test('batas bawaan 30 detik adalah satu konstanta bernama', () => {
    expect(WIDGET_STATEMENT_TIMEOUT_SECONDS).toBe(30);
  });

  test('kueri yang melewati batas dihentikan database dengan galat 1969 (DbError)', async () => {
    const limited = withStatementTimeout(env.DB, 0.3);
    const error = await limited
      .prepare('SELECT SLEEP(5) AS slept')
      .all()
      .then(
        () => null,
        (caught: unknown) => caught,
      );
    expect(error).toBeInstanceOf(DbError);
    expect((error as DbError).errno).toBe(ER_STATEMENT_TIMEOUT);
  });

  test('kueri biasa lewat batas tak terpengaruh, termasuk yang memakai parameter', async () => {
    const limited = withStatementTimeout(env.DB, 5);
    const row = await limited
      .prepare('SELECT ? + 1 AS next')
      .bind(41)
      .first<{ next: number | string }>();
    expect(Number(row?.next)).toBe(42);
  });

  test('batas tidak bocor ke kueri lain di koneksi yang sama setelah timeout', async () => {
    // Satu transaksi = satu koneksi: kueri berbatas gagal, kueri tanpa awalan sesudahnya melihat tanpa batas.
    const seen = await env.DB.transaction(async (tx) => {
      const failed = await withStatementTimeout(tx, 0.3)
        .prepare('SELECT SLEEP(5) AS slept')
        .all()
        .then(
          () => false,
          () => true,
        );
      const after = await tx
        .prepare('SELECT @@max_statement_time AS limit_seconds')
        .first<{ limit_seconds: number | string }>();
      return { failed, limit: Number(after?.limit_seconds) };
    });
    expect(seen.failed).toBe(true);
    expect(seen.limit).toBe(0);
  });

  test('menolak batas yang bukan bilangan positif', () => {
    expect(() => withStatementTimeout(env.DB, 0)).toThrow();
    expect(() => withStatementTimeout(env.DB, Number.NaN)).toThrow();
    expect(() => withStatementTimeout(env.DB, -1)).toThrow();
  });
});

describe('engine: batas kueri di database', () => {
  const scope = resolveScope(
    {
      email: 'u@gmail.com',
      name: 'U',
      userId: 'u1',
      isSuperAdmin: false,
      permissions: {} as never,
      locations: {},
      businessUnits: {},
      sharedAccount: false,
      deletedBuIds: [],
    },
    { from: '2026-11-17', to: '2026-11-23' },
    Date.UTC(2026, 10, 23, 5, 0, 0),
  );

  test('kueri widget yang melewati batas menjadi galat generik, tidak di-cache, slot terlepas, kueri biasa tetap jalan', async () => {
    const spy = spyOn(console, 'error').mockImplementation(() => {});
    try {
      const limiter = createLimiter(1);
      let slow = true;
      const impl: WidgetImpl = {
        id: 'hs.created',
        run: async (ctx: WidgetCtx) => {
          const row = await ctx.db
            .prepare(slow ? 'SELECT SLEEP(5) AS value' : 'SELECT 7 AS value')
            .first<{ value: number | string }>();
          return { kind: 'number', value: Number(row?.value) };
        },
      };
      const impls = new Map([['hs.created' as const, impl]]);
      const options = { statementTimeoutSeconds: 0.3, limiter };
      const first = await runWidgets(env, scope, [{ id: 'hs.created' }], impls, options);
      expect(first[0]).toEqual({
        id: 'hs.created',
        status: 'error',
        message: 'Widget tidak dapat dimuat',
      });
      expect(limiter.active).toBe(0);
      expect(limiter.waiting).toBe(0);
      // Galat tidak di-cache: permintaan yang sama dijalankan lagi dan kini berhasil.
      slow = false;
      const second = await runWidgets(env, scope, [{ id: 'hs.created' }], impls, options);
      expect(second[0]).toEqual({
        id: 'hs.created',
        status: 'ok',
        data: { kind: 'number', value: 7 },
      });
    } finally {
      spy.mockRestore();
    }
  });
});
