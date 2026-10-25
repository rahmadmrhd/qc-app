import { beforeEach, describe, expect, test } from 'bun:test';
import { createTestEnv, type TestEnv } from '@worker-test/test-env';
import { cleanDump, mutate } from './fixtures';
import { prepareImport } from './import-sheets';
import { type D1Reader, runVerifyCli, verifyImport, wranglerReader } from './verify-import';

let env: TestEnv;

function reader(): D1Reader {
  return {
    async query(sql) {
      const result = await env.DB.prepare(sql).all<Record<string, unknown>>();
      return result.results;
    },
  };
}

async function exec(sql: string): Promise<void> {
  await env.DB.exec(sql);
}

beforeEach(async () => {
  env = await createTestEnv();
  await exec(prepareImport(cleanDump()).sql as string);
});

function failing(report: Awaited<ReturnType<typeof verifyImport>>): string[] {
  return [...report.tables, ...report.orphans, ...report.counters]
    .filter((entry) => !entry.ok)
    .map((entry) => ('table' in entry ? entry.table : entry.name));
}

describe('verifyImport', () => {
  test('impor bersih lulus: baris, checksum, yatim, penghitung', async () => {
    const report = await verifyImport(cleanDump(), reader());
    expect(failing(report)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.tables.map((table) => table.table)).toContain('handover_comments');
    expect(report.tables.find((table) => table.table === 'handovers')).toMatchObject({
      expectedRows: 4,
      actualRows: 4,
    });
    expect(report.orphans.length).toBeGreaterThanOrEqual(10);
  });

  test('baris hilang -> jumlah dan checksum tabel itu gagal, tabel lain tetap lulus', async () => {
    await exec("DELETE FROM brands WHERE id = 'b2'");
    const report = await verifyImport(cleanDump(), reader());
    expect(report.ok).toBe(false);
    expect(failing(report)).toEqual(['brands']);
  });

  test('nilai kunci berubah (sync_rev) -> checksum gagal walau jumlah sama', async () => {
    await exec("UPDATE items SET sync_rev = 8 WHERE id = 'i1'");
    const report = await verifyImport(cleanDump(), reader());
    const items = report.tables.find((table) => table.table === 'items');
    expect(items).toMatchObject({ ok: false, expectedRows: 1, actualRows: 1 });
    expect(items?.actualChecksum).not.toBe(items?.expectedChecksum);
  });

  test('kolom turunan handover (checked_count) ikut diperiksa', async () => {
    await exec("UPDATE handovers SET checked_count = 0 WHERE id = 'h1'");
    expect(failing(await verifyImport(cleanDump(), reader()))).toEqual(['handovers']);
  });

  test('komentar hilang atau tertukar handover terdeteksi', async () => {
    await exec("DELETE FROM handover_comments WHERE id = 'c2'");
    expect(failing(await verifyImport(cleanDump(), reader()))).toEqual(['handover_comments']);
  });

  test('rujukan yatim di D1 terdeteksi', async () => {
    await exec("UPDATE handovers SET customer_id = 'c-hilang' WHERE id = 'h1'");
    const report = await verifyImport(cleanDump(), reader());
    expect(report.orphans.filter((check) => !check.ok).map((check) => check.name)).toEqual([
      'handovers.customer_id -> customers',
    ]);
    await exec(
      `UPDATE users SET assignments = '[{"locationId":"l-x","roleIds":["r-x"]}]' WHERE id = 'u2'`,
    );
    const second = await verifyImport(cleanDump(), reader());
    const names = second.orphans.filter((check) => !check.ok).map((check) => check.name);
    expect(names).toContain('users.assignments.roleIds -> roles');
    expect(names).toContain('users.assignments.locationId -> locations');
  });

  test('penghitung di bawah data gagal: sync_rev dan nomor ST harian', async () => {
    await exec("UPDATE counters SET value = 4 WHERE key = 'sync_rev'");
    await exec("DELETE FROM counters WHERE key = 'handover:20261002'");
    const report = await verifyImport(cleanDump(), reader());
    expect(
      report.counters
        .filter((check) => !check.ok)
        .map((check) => check.name)
        .sort(),
    ).toEqual([
      'counters.handover:20261002 >= data',
      'counters.sync_rev >= data',
      'counters.sync_rev >= max(sync_rev) di D1',
    ]);
    expect(report.ok).toBe(false);
    expect(report.counters.filter((check) => !check.ok)).toHaveLength(3);
  });

  test('counters.sync_rev harus >= max(sync_rev) yang ada di D1 walau data Sheets lebih kecil', async () => {
    await exec("UPDATE brands SET sync_rev = 50 WHERE id = 'b1'");
    const report = await verifyImport(cleanDump(), reader());
    const check = report.counters.find(
      (entry) => entry.name === 'counters.sync_rev >= max(sync_rev) di D1',
    );
    expect(check?.ok).toBe(false);
  });

  test('tabel kosong di D1 (impor belum jalan) gagal di semua tabel berisi', async () => {
    const empty = await createTestEnv();
    env = empty;
    const report = await verifyImport(cleanDump(), reader());
    expect(report.ok).toBe(false);
    expect(failing(report)).toContain('users');
    expect(failing(report)).toContain('counters.sync_rev >= max(sync_rev) di D1');
  });

  test('dump yang tidak lolos validasi impor tidak diverifikasi', async () => {
    const report = await verifyImport(
      mutate(cleanDump(), 'handovers', 2, 'customer_id', 'c-x'),
      reader(),
    );
    expect(report.ok).toBe(false);
    expect(report.tables).toEqual([]);
    expect(report.problems[0]).toContain('tidak lolos validasi');
  });

  test('tabel besar dibaca per halaman (> 1.000 baris) dengan hasil sama', async () => {
    const dump = cleanDump();
    const sheet = dump.audit_log as string[][];
    for (let i = 0; i < 1500; i++)
      sheet.push(['2026-10-03T00:00:00.000Z', 'a@x', 'tes', `t${i}`, '', '']);
    env = await createTestEnv();
    await exec(prepareImport(dump).sql as string);
    const report = await verifyImport(dump, reader());
    expect(report.tables.find((table) => table.table === 'audit_log')).toMatchObject({
      ok: true,
      expectedRows: 1503,
      actualRows: 1503,
    });
  });
});

describe('CLI dan pembaca wrangler', () => {
  test('wranglerReader menolak pernyataan selain SELECT', async () => {
    await expect(wranglerReader('db', ['--local']).query('DELETE FROM users')).rejects.toThrow(
      'SELECT',
    );
  });

  test('argumen kurang -> 2; --remote tanpa CLOUDFLARE_ACCOUNT_ID -> 2', async () => {
    expect(await runVerifyCli([])).toBe(2);
    const previous = Bun.env.CLOUDFLARE_ACCOUNT_ID;
    delete Bun.env.CLOUDFLARE_ACCOUNT_ID;
    try {
      expect(await runVerifyCli(['--dump', 'x.json', '--d1', 'db'])).toBe(2);
    } finally {
      if (previous !== undefined) Bun.env.CLOUDFLARE_ACCOUNT_ID = previous;
    }
  });
});

describe('konsistensi alias_keys', () => {
  test('alias_keys lulus pada impor bersih dan gagal bila tidak sama dengan aliases', async () => {
    const clean = await verifyImport(cleanDump(), reader());
    expect(clean.consistency).toEqual([
      expect.objectContaining({ name: 'items.alias_keys konsisten dengan aliases', ok: true }),
    ]);
    await exec("UPDATE items SET alias_keys = '|salah|' WHERE id = 'i1'");
    const tampered = await verifyImport(cleanDump(), reader());
    expect(tampered.ok).toBe(false);
    expect(tampered.consistency[0]).toMatchObject({ ok: false });
    expect(tampered.consistency[0]?.detail).toContain('i1');
    // checksum items juga memuat alias_keys
    expect(tampered.tables.find((table) => table.table === 'items')?.ok).toBe(false);
  });

  test('aliases diubah tanpa memperbarui alias_keys terdeteksi', async () => {
    await exec(`UPDATE items SET aliases = '["Baru"]' WHERE id = 'i1'`);
    expect((await verifyImport(cleanDump(), reader())).consistency[0]?.ok).toBe(false);
  });
});
