import { describe, expect, test } from 'bun:test';
import { signSessionToken } from '@server/core/session';
import { loadUserContext } from '@server/modules/access/context';
import { derivedColumns, parseChecks } from '@server/modules/handover/repo';
import { getRoutes } from '@server/routes';
import { callRoute } from '@server-test/call-route';
import { createTestEnv } from '@server-test/test-env';
import { applySeed, buildSeedStatements } from './seed-data';
import { assertSeedTarget, parseSeedArgs, resolveEmail } from './seed-dev';

const NOW = Date.parse('2026-10-25T03:00:00.000Z');

async function seeded(email = 'saya@example.test') {
  const env = await createTestEnv({ ADMIN_EMAIL: 'bukan-saya@example.test' });
  env.clock.set(NOW);
  await applySeed(env.DB, email, NOW);
  return env;
}

describe('seed data contoh', () => {
  test('pengguna admin sesuai email: izin penuh di semua lokasi; email dinormalkan', async () => {
    const env = await seeded('Saya@Example.Test');
    const ctx = await loadUserContext(env, 'saya@example.test');
    expect(ctx?.permissions.access).toBe('manage');
    expect(ctx?.permissions.handover).toBe('manage');
    expect(Object.keys(ctx?.locations ?? {}).sort()).toEqual(['loc-bdg', 'loc-jkt']);
    expect(await loadUserContext(env, 'wh@dev.test')).not.toBeNull();
    expect(await loadUserContext(env, 'qc@dev.test')).not.toBeNull();
  });

  test('dua BU contoh; admin dev bertugas di Semua BU dan semua item bertaut ke BU UM', async () => {
    const env = await seeded();
    const bus = await env.DB.prepare(
      'SELECT id, code, name FROM business_units ORDER BY code',
    ).all<{
      id: string;
      code: string;
      name: string;
    }>();
    expect(bus.results).toEqual([
      { id: 'bu-ent', code: 'ENT', name: 'Enterprise' },
      { id: 'bu-um', code: 'UM', name: 'Umum' },
    ]);
    const ctx = await loadUserContext(env, 'saya@example.test');
    expect(ctx?.permissions.item).toBe('manage');
    const links = await env.DB.prepare(
      'SELECT COUNT(*) AS n, COUNT(DISTINCT bu_id) AS b, MIN(bu_id) AS only FROM item_business_units',
    ).first<{ n: number; b: number; only: string }>();
    const items = await env.DB.prepare('SELECT COUNT(*) AS n FROM items').first<{ n: number }>();
    expect(Number(links?.n)).toBe(Number(items?.n));
    expect(Number(links?.b)).toBe(1);
    expect(links?.only).toBe('bu-um');
  });

  test('data realistis: merk, item, customer, task berbagai status, komentar', async () => {
    const env = await seeded();
    const count = async (table: string) =>
      (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())?.n;
    expect(await count('brands')).toBe(3);
    expect(await count('items')).toBeGreaterThanOrEqual(10);
    expect(await count('customers')).toBe(3);
    expect(await count('handovers')).toBe(6);
    expect(await count('handover_comments')).toBeGreaterThan(0);
    const statuses = await env.DB.prepare(
      'SELECT board_status, COUNT(*) AS n FROM handovers GROUP BY board_status',
    ).all<{ board_status: string; n: number }>();
    expect(new Set(statuses.results.map((r) => r.board_status))).toEqual(
      new Set(['new', 'in_progress', 'done', 'cancelled']),
    );
  });

  test('kolom turunan handover konsisten dengan isi; penghitung terisi', async () => {
    const env = await seeded();
    const rows = await env.DB.prepare('SELECT * FROM handovers').all<{
      note: string;
      checks: string;
      status: string;
      completed_at: string;
      checked_count: number;
      total_count: number;
      board_status: string;
    }>();
    for (const row of rows.results) {
      const d = derivedColumns({
        note: row.note,
        checks: parseChecks(row.checks),
        status: row.status === 'cancelled' ? 'cancelled' : 'open',
        completedAt: row.completed_at,
      });
      expect([row.checked_count, row.total_count, row.board_status]).toEqual([
        d.checkedCount,
        d.totalCount,
        d.boardStatus,
      ]);
    }
    const counter = await env.DB.prepare(
      "SELECT value FROM counters WHERE `key` = 'st:20261025'",
    ).first<{
      value: number;
    }>();
    expect(counter?.value).toBe(6);
  });

  test('dapat dijalankan ulang (idempoten) dan aplikasi dapat memakainya lewat REST', async () => {
    const env = await seeded();
    await applySeed(env.DB, 'saya@example.test', NOW);
    expect(
      (await env.DB.prepare('SELECT COUNT(*) AS n FROM handovers').first<{ n: number }>())?.n,
    ).toBe(6);
    const token = await signSessionToken(env, 'saya@example.test', NOW);
    const board = await callRoute(
      env,
      token,
      'handovers.board',
      { locationIds: ['loc-jkt'], status: 'new' },
      getRoutes(),
    );
    expect(board.ok).toBe(true);
    const items = await callRoute(env, token, 'items.list', null, getRoutes());
    expect(items.ok && (items.data as { items: unknown[] }).items.length).toBeGreaterThan(0);
    // alias dipakai pengecekan bentrok: nama lain item lain ditolak
    const dup = await callRoute(
      env,
      token,
      'items.save',
      {
        brand: 'Ubiquiti',
        model: 'Baru',
        isCountryLock: false,
        aliases: ['ER-X'],
        stickers: [],
        accessories: [],
        attachments: [],
        detail: '',
      },
      getRoutes(),
    );
    expect(dup.ok).toBe(false);
  });

  test('menerapkan migrasi pada database kosong tanpa galat FK/unik', async () => {
    const { DB: db } = await createTestEnv();
    await applySeed(db, 'a@b.test', NOW);
  });

  test('semua nilai diikat sebagai parameter (tidak ada nilai di teks SQL), termasuk email yang berisi kutip', async () => {
    const statements = buildSeedStatements("o'brien@example.test", NOW);
    for (const statement of statements) {
      expect(statement.sql).not.toContain("o'brien");
      expect((statement.sql.match(/[?]/g) ?? []).length).toBe(statement.values.length);
    }
    const env = await createTestEnv();
    await applySeed(env.DB, "o'brien@example.test", NOW);
    expect(await loadUserContext(env, "o'brien@example.test")).not.toBeNull();
  });

  test('gagal di tengah = tidak ada yang berubah (satu transaksi)', async () => {
    const env = await seeded();
    const before = (await env.DB.prepare('SELECT COUNT(*) AS n FROM brands').first<{ n: number }>())
      ?.n;
    // email panjang melebihi VARCHAR memicu galat di tengah batch; data sebelumnya harus utuh
    await expect(applySeed(env.DB, 'x'.repeat(400) + '@example.test', NOW)).rejects.toThrow();
    const after = (await env.DB.prepare('SELECT COUNT(*) AS n FROM brands').first<{ n: number }>())
      ?.n;
    expect(after).toBe(before);
  });
});

describe('argumen dan penjagaan target', () => {
  test('hanya --email yang diterima; argumen lain ditolak', () => {
    expect(parseSeedArgs([])).toEqual({});
    expect(parseSeedArgs(['--email=Saya@x.test'])).toEqual({ email: 'Saya@x.test' });
    for (const bad of ['--remote', '--database=qc_prod', '--aneh']) {
      expect(() => parseSeedArgs([bad])).toThrow(/tidak dikenal/);
    }
  });

  test('assertSeedTarget hanya menerima skema qc_dev', () => {
    expect(assertSeedTarget('mysql://u:p@127.0.0.1:33063/qc_dev')).toBe(
      'mysql://u:p@127.0.0.1:33063/qc_dev',
    );
    for (const bad of [
      'mysql://u:p@127.0.0.1:33063/qc_prod',
      'mysql://u:p@127.0.0.1:33063/qc_dev2',
      'mysql://u:p@127.0.0.1:33063/',
      'mysql://u:p@127.0.0.1:33063/qc_test_1_ab',
    ]) {
      expect(() => assertSeedTarget(bad)).toThrow(/hanya untuk skema qc_dev/);
    }
    expect(() => assertSeedTarget(undefined)).toThrow(/DATABASE_URL belum diatur/);
  });

  test('resolveEmail: argumen lebih dulu dari DEV_LOGIN_EMAIL; dinormalkan; kosong = galat', () => {
    expect(resolveEmail({ email: 'A@B.test' }, { DEV_LOGIN_EMAIL: 'x@y.test' })).toBe('a@b.test');
    expect(resolveEmail({}, { DEV_LOGIN_EMAIL: ' X@Y.test ' })).toBe('x@y.test');
    expect(() => resolveEmail({}, {})).toThrow(/DEV_LOGIN_EMAIL/);
  });
});
