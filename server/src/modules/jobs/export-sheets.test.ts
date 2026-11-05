import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { runPendingJobs } from '@server/jobs/runner';
import { seedRole, seedUser } from '@server-test/access-fixtures';
import { qrRpc } from '@server-test/qrcode-env';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { runJobStep } from './consumer';
import { validateExportSheets } from './export-sheets';
import { findJob } from './repo';
import { EXPORT_TABLES } from './sheets-export';

let env: TestEnv;
const realError = console.error;

beforeEach(async () => {
  env = await createTestEnv();
  env.clock.set(Date.parse('2026-10-16T03:00:00.000Z'));
  await seedRole(env, { id: 'r-admin', name: 'Admin', permissions: { access: 'manage' } });
  await seedRole(env, { id: 'r-view', name: 'Lihat akses', permissions: { access: 'view' } });
  await seedRole(env, {
    id: 'r-qm',
    name: 'QR manage',
    permissions: { qrcode: 'manage', item: 'manage' },
  });
  await seedUser(env, { id: 'u-admin', email: 'admin2@gmail.com', roleIds: ['r-admin'] });
  await seedUser(env, { id: 'u-view', email: 'akses@gmail.com', roleIds: ['r-view'] });
  await seedUser(env, { id: 'u-qm', email: 'qrm@gmail.com', roleIds: ['r-qm'] });
  console.error = () => undefined;
});
afterEach(() => {
  console.error = realError;
});

const call = (email: string, payload: unknown) => qrRpc(env, email, 'exports.sheets', payload);
async function drain(): Promise<void> {
  await runPendingJobs(env);
}
/** Job yang masih menunggu/berjalan (pengganti isi antrean pada era Queue). */
async function activeJobs() {
  const rows = await env.DB.prepare(
    "SELECT id, kind, step FROM jobs WHERE status IN ('queued', 'running')",
  ).all<{ id: string; kind: string; step: number }>();
  return rows.results;
}
async function audits(): Promise<Array<{ actor: string; action: string; after: string }>> {
  const rows = await env.DB.prepare(
    'SELECT actor, action, `after` AS after FROM audit_log ORDER BY id',
  ).all<{
    actor: string;
    action: string;
    after: string;
  }>();
  return rows.results;
}

describe('exports.sheets', () => {
  test('izin: hanya modul akses level kelola; lihat akses, qrcode kelola, dan tanpa izin ditolak', async () => {
    expect((await call('akses@gmail.com', {})).error.code).toBe('FORBIDDEN');
    expect((await call('qrm@gmail.com', {})).error.code).toBe('FORBIDDEN');
    expect((await call('nobody@gmail.com', {})).error.code).toBe('UNAUTHENTICATED');
    expect(await activeJobs()).toHaveLength(0);
    expect((await call('admin2@gmail.com', {})).ok).toBe(true);
  });

  test('bawaan semua tabel; mengantre satu job sheets_export; audit export.sheets; hasil lewat jobs.get', async () => {
    const out = await call('admin2@gmail.com', null);
    expect(out.ok).toBe(true);
    expect(Object.keys(out.data)).toEqual(['jobId']);
    expect(await activeJobs()).toEqual([{ id: out.data.jobId, kind: 'sheets_export', step: 0 }]);
    const job = await findJob(env, out.data.jobId);
    expect(JSON.parse(job?.input ?? '{}').tables).toEqual(EXPORT_TABLES.map((spec) => spec.table));
    const queued = await call('admin2@gmail.com', {});
    expect(queued.data.jobId).toBe(out.data.jobId);
    expect((await audits()).filter((a) => a.action === 'export.sheets')).toHaveLength(1);
    expect((await audits())[0]).toMatchObject({
      actor: 'admin2@gmail.com',
      action: 'export.sheets',
    });

    await env.DB.prepare(
      "INSERT INTO brands (id, name, `key`, sync_rev) VALUES ('b1', 'Acme', 'acme', 1)",
    ).run();
    await drain();
    const done = await call('admin2@gmail.com', {}).then(() =>
      qrRpc(env, 'admin2@gmail.com', 'jobs.get', { id: out.data.jobId }),
    );
    expect(done.data).toMatchObject({ status: 'done', progress: 100 });
    expect(JSON.parse(done.data.result).tables).toBe(EXPORT_TABLES.length);
    const sheets = new Set(env.BRIDGE.state.exports.map((chunk) => chunk.sheet));
    expect(sheets.size).toBe(EXPORT_TABLES.length);
    expect(
      env.BRIDGE.state.exports.find((chunk) => chunk.sheet === 'export_brands')?.rows[0]?.[0],
    ).toBe('b1');
  });

  test('tabel tertentu: hanya itu yang diekspor, urutan kanonis, duplikat dibuang', async () => {
    const out = await call('admin2@gmail.com', { tables: ['users', 'brands', 'users'] });
    expect(out.ok).toBe(true);
    await drain();
    const sheets = [...new Set(env.BRIDGE.state.exports.map((chunk) => chunk.sheet))];
    expect(sheets).toEqual(['export_users', 'export_brands']);
    expect(JSON.parse((await findJob(env, out.data.jobId))?.input ?? '{}').tables).toEqual([
      'users',
      'brands',
    ]);
  });

  test('validasi: tabel tak dikenal/terlarang, bukan daftar, kosong, bukan teks, payload bukan objek', async () => {
    for (const forbidden of [
      'rate_limits',
      'd1_migrations',
      'jobs',
      'job_blobs',
      'counters',
      'settings',
      'sessions',
      'tidak_ada',
      'users; DROP TABLE users',
    ]) {
      const out = await call('admin2@gmail.com', { tables: ['brands', forbidden] });
      expect({ forbidden, code: out.error?.code }).toEqual({ forbidden, code: 'VALIDATION' });
      expect(out.error.fields.tables).toContain('tidak boleh diekspor');
    }
    for (const bad of [
      { tables: 'users' },
      { tables: [] },
      { tables: [1] },
      { tables: [null] },
      'teks',
      5,
    ]) {
      expect((await call('admin2@gmail.com', bad)).error.code).toBe('VALIDATION');
    }
    expect(await activeJobs()).toHaveLength(0);
    expect(() => validateExportSheets({ tables: ['brands'] })).not.toThrow();
    expect(validateExportSheets(undefined)).toEqual({});
  });

  test('tidak ada dua ekspor serentak: daftar tabel sama -> jobId yang sama; berbeda -> CONFLICT; setelah selesai boleh baru', async () => {
    const first = await call('admin2@gmail.com', { tables: ['brands'] });
    const same = await call('admin2@gmail.com', { tables: ['brands'] });
    expect(same.data.jobId).toBe(first.data.jobId);
    const other = await call('admin2@gmail.com', { tables: ['users'] });
    expect(other.error.code).toBe('CONFLICT');
    const all = await call('admin2@gmail.com', {});
    expect(all.error.code).toBe('CONFLICT');
    expect(await activeJobs()).toHaveLength(1);
    await drain();
    const next = await call('admin2@gmail.com', { tables: ['users'] });
    expect(next.ok).toBe(true);
    expect(next.data.jobId).not.toBe(first.data.jobId);
    expect((await audits()).filter((a) => a.action === 'export.sheets')).toHaveLength(2);
  });

  test('job gagal (jembatan mati) dapat dilihat lewat jobs.get dengan pesan jelas dan boleh diekspor ulang', async () => {
    const first = await call('admin2@gmail.com', { tables: ['brands'] });
    env.BRIDGE.sheetsExport = async () => {
      throw new Error('jembatan mati');
    };
    await runJobStep(env, first.data.jobId, 3);
    const failed = await qrRpc(env, 'admin2@gmail.com', 'jobs.get', { id: first.data.jobId });
    expect(failed.data).toMatchObject({ status: 'failed' });
    expect(failed.data.error).toBeTruthy();
    expect(JSON.stringify(failed.data)).not.toContain('jembatan mati');
    const again = await call('admin2@gmail.com', { tables: ['brands'] });
    expect(again.ok).toBe(true);
    expect(again.data.jobId).not.toBe(first.data.jobId);
  });

  test('daftar tabel yang diizinkan tidak memuat tabel operasional/rahasia', () => {
    const names = EXPORT_TABLES.map((spec) => spec.table);
    for (const secret of [
      'rate_limits',
      'd1_migrations',
      'jobs',
      'job_blobs',
      'counters',
      'settings',
    ]) {
      expect(names).not.toContain(secret);
    }
  });
});
