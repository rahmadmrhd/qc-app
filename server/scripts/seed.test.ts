import { describe, expect, test } from 'bun:test';
import { applyMigrations } from '@server/core/migrate';
import { callRoute } from '@server/core/router';
import { signSessionToken } from '@server/core/session';
import { loadUserContext } from '@server/modules/access/context';
import { derivedColumns, parseChecks } from '@server/modules/handover/repo';
import { getRoutes } from '@server/routes';
import { createSqliteD1 } from '@server-test/sqlite-d1';
import { createTestEnv } from '@server-test/test-env';
import { parseDevVars, renderDevVars } from './dev-vars';
import { buildSeedSql } from './seed-data';
import { parseSeedArgs, wranglerArgs } from './seed-dev';

const NOW = Date.parse('2026-10-25T03:00:00.000Z');

async function seeded(email = 'saya@example.test') {
  const env = await createTestEnv({ ADMIN_EMAIL: 'bukan-saya@example.test' });
  env.clock.set(NOW);
  await env.DB.exec(buildSeedSql(email, NOW));
  return env;
}

describe('buildSeedSql', () => {
  test('pengguna admin sesuai email: izin penuh di semua lokasi; email dinormalkan', async () => {
    const env = await seeded('Saya@Example.Test');
    const ctx = await loadUserContext(env, 'saya@example.test');
    expect(ctx?.permissions.access).toBe('manage');
    expect(ctx?.permissions.handover).toBe('manage');
    expect(Object.keys(ctx?.locations ?? {}).sort()).toEqual(['loc-bdg', 'loc-jkt']);
    expect(await loadUserContext(env, 'wh@dev.test')).not.toBeNull();
    expect(await loadUserContext(env, 'qc@dev.test')).not.toBeNull();
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

  test('kolom turunan handover konsisten dengan isi; penghitung dan sync_state terisi', async () => {
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
      "SELECT value FROM counters WHERE key = 'st:20261025'",
    ).first<{
      value: number;
    }>();
    expect(counter?.value).toBe(6);
    const sync = await env.DB.prepare(
      'SELECT resource, seq FROM sync_state ORDER BY resource',
    ).all();
    expect(sync.results).toHaveLength(2);
  });

  test('dapat dijalankan ulang (idempoten) dan aplikasi dapat memakainya lewat RPC', async () => {
    const env = await seeded();
    await env.DB.exec(buildSeedSql('saya@example.test', NOW));
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
    const db = createSqliteD1();
    await applyMigrations(db);
    await db.exec(buildSeedSql('a@b.test', NOW));
  });
});

describe('parseSeedArgs dan wranglerArgs', () => {
  test('menolak --remote dan bentuk setara; menolak argumen tak dikenal', () => {
    for (const bad of [
      ['--remote'],
      ['-r'],
      ['--preview'],
      ['--remote=true'],
      ['--email=a@b.c', '--remote'],
    ]) {
      expect(() => parseSeedArgs(bad)).toThrow(/LOKAL/);
    }
    expect(() => parseSeedArgs(['--aneh'])).toThrow(/tidak dikenal/);
  });

  test('menerima --local dan --email', () => {
    expect(parseSeedArgs([])).toEqual({});
    expect(parseSeedArgs(['--local', '--email=Saya@x.test'])).toEqual({ email: 'Saya@x.test' });
  });

  test('perintah wrangler selalu --local dan tidak pernah --remote', () => {
    for (const args of [wranglerArgs('migrate'), wranglerArgs('execute', 'x.sql')]) {
      expect(args).toContain('--local');
      expect(args).not.toContain('--remote');
      expect(args).not.toContain('-r');
    }
  });
});

describe('dev-vars', () => {
  test('parseDevVars: komentar, kutip, spasi', () => {
    expect(parseDevVars('# c\nA=1\n B = "dua" \nC=\n\nD=x=y')).toEqual({
      A: '1',
      B: 'dua',
      C: '',
      D: 'x=y',
    });
  });
  test('renderDevVars mengganti SESSION_SECRET saja', () => {
    expect(renderDevVars('X=1\nSESSION_SECRET=ganti\nY=2', 'rahasia')).toBe(
      'X=1\nSESSION_SECRET=rahasia\nY=2',
    );
  });
});
