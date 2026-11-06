import { afterAll, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { testDbUrl } from '@server-test/db-env';
import { currentTestSchema, dropTestSchemas } from '@server-test/test-db';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import {
  applyPlan,
  approvalFor,
  cleanDump,
  importWithApproval,
  mutate,
  stripDiscarded,
} from './fixtures';
import {
  type DbReader,
  mariadbReader,
  runVerifyCli,
  VERIFY_DB_URL_ENV,
  verifyImport,
} from './verify-import';

setDefaultTimeout(30_000);
afterAll(async () => {
  await dropTestSchemas();
});

let env: TestEnv;

function reader(): DbReader {
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

async function importClean(dump = cleanDump()): Promise<void> {
  env = await createTestEnv();
  const result = importWithApproval(dump);
  await applyPlan(env.DB, result.plan as NonNullable<typeof result.plan>);
}

beforeEach(async () => {
  await importClean();
});

const approval = () => approvalFor(cleanDump());
const verify = (dump = cleanDump(), discardApproval = approvalFor(dump)) =>
  verifyImport(dump, reader(), { discardApproval });

function failing(report: Awaited<ReturnType<typeof verifyImport>>): string[] {
  return [...report.tables, ...report.orphans, ...report.counters, ...report.discarded]
    .filter((entry) => !entry.ok)
    .map((entry) => ('table' in entry ? entry.table : entry.name));
}

describe('verifyImport', () => {
  test('impor bersih lulus: baris, checksum isi penuh, yatim, buangan kosong, penghitung', async () => {
    const report = await verify();
    expect(failing(report)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.tables.map((table) => table.table)).toEqual([
      'users',
      'roles',
      'locations',
      'audit_log',
      'files',
      'qr_designs',
      'qr_documents',
      'qr_defaults',
      'qr_presets',
      'sync_state',
    ]);
    expect(report.tables.find((table) => table.table === 'files')).toMatchObject({
      expectedRows: 2,
      actualRows: 2,
    });
    expect(report.orphans).toHaveLength(7);
    expect(report.discarded).toHaveLength(7);
    expect(report.counters.map((c) => c.name)).toEqual([
      'counters.st:20261001 >= data',
      'counters.st:20261002 >= data',
    ]);
  });

  test('baris hilang -> jumlah dan checksum tabel itu gagal, tabel lain tetap lulus', async () => {
    await exec("DELETE FROM locations WHERE id = 'l2'");
    const report = await verify();
    expect(report.ok).toBe(false);
    expect(failing(report)).toEqual(['locations']);
  });

  test('isi kolom non-kunci berubah (mis. teks audit rusak oleh escaping) -> checksum gagal walau jumlah sama', async () => {
    await exec("UPDATE audit_log SET `after` = '{}' WHERE target = 'u2'");
    const audit = (await verify()).tables.find((table) => table.table === 'audit_log');
    expect(audit).toMatchObject({ ok: false, expectedRows: 3, actualRows: 3 });
    expect(audit?.actualChecksum).not.toBe(audit?.expectedChecksum);
    await exec("UPDATE qr_designs SET layout = 'x' WHERE id = 'q1'");
    expect(failing(await verify())).toEqual(['audit_log', 'qr_designs']);
  });

  test('sync_state yang berbeda dari dump gagal', async () => {
    await exec("UPDATE sync_state SET seq = 1 WHERE resource = 'items'");
    expect(failing(await verify())).toEqual(['sync_state']);
  });

  test('rujukan yatim di target terdeteksi', async () => {
    await exec(
      `UPDATE users SET assignments = '[{"locationId":"l-x","roleIds":["r-x"]}]' WHERE id = 'u2'`,
    );
    const names = (await verify()).orphans.filter((check) => !check.ok).map((check) => check.name);
    expect(names).toEqual([
      'users.assignments.roleIds -> roles',
      'users.assignments.locationId -> locations',
    ]);
    await importClean();
    await exec("UPDATE qr_designs SET document_id = 'd-x', logo_file_id = 'f-x' WHERE id = 'q1'");
    await exec("UPDATE qr_presets SET default_logo_id = 'f-x' WHERE id = 'p1'");
    await exec(`UPDATE qr_defaults SET logo_file_ids = '["f-x"]' WHERE id = 'default'`);
    const second = (await verify()).orphans.filter((check) => !check.ok).map((check) => check.name);
    expect(second).toEqual([
      'qr_designs.document_id -> qr_documents',
      'qr_designs.logo_file_id -> files',
      'qr_defaults.logo_file_ids -> files',
      'qr_presets.default_logo_id -> files',
    ]);
  });

  test('data uji tersisa di target (tabel buangan berisi, berkas milik item) gagal', async () => {
    await exec("INSERT INTO customers (id, `key`) VALUES ('c1', 'cv')");
    await exec("INSERT INTO files (id, owner_type, owner_id) VALUES ('fx', 'item', 'i1')");
    expect(
      (await verify()).discarded.filter((check) => !check.ok).map((check) => check.name),
    ).toEqual(['customers kosong di target', "files (owner_type = 'item') kosong di target"]);
    await exec("DELETE FROM customers; DELETE FROM files WHERE id = 'fx'");
    expect((await verify()).ok).toBe(true);
  });

  test('penghitung nomor ST di bawah data atau hilang gagal; di atas data lulus', async () => {
    await exec("UPDATE counters SET value = 5 WHERE `key` = 'st:20261002'");
    await exec("DELETE FROM counters WHERE `key` = 'st:20261001'");
    const report = await verify();
    expect(
      report.counters
        .filter((check) => !check.ok)
        .map((check) => check.name)
        .sort(),
    ).toEqual(['counters.st:20261001 >= data', 'counters.st:20261002 >= data']);
    expect(report.ok).toBe(false);
    await exec("UPDATE counters SET value = 50 WHERE `key` = 'st:20261002'");
    await exec("INSERT INTO counters (`key`, value) VALUES ('st:20261001', 2)");
    expect((await verify()).ok).toBe(true);
  });

  test('tabel kosong di target (impor belum jalan) gagal di semua tabel berisi', async () => {
    env = await createTestEnv();
    const report = await verify();
    expect(report.ok).toBe(false);
    expect(failing(report)).toContain('users');
    expect(failing(report)).toContain('counters.st:20261002 >= data');
  });

  test('dump yang tidak lolos validasi impor tidak diverifikasi', async () => {
    const report = await verify(mutate(cleanDump(), 'qr_designs', 2, 'document_id', 'd-x'));
    expect(report.ok).toBe(false);
    expect(report.tables).toEqual([]);
    expect(report.problems[0]).toContain('tidak lolos validasi');
  });

  test('dump berisi data buangan tanpa persetujuan pemilik gagal (BERHENTI), bukan dibuang diam-diam', async () => {
    const report = await verifyImport(cleanDump(), reader());
    expect(report.ok).toBe(false);
    expect(report.tables).toEqual([]);
    expect(report.problems[0]).toContain('DATA_DIBUANG_BUTUH_PERSETUJUAN');
    const stale = await verifyImport(
      mutate(cleanDump(), 'handovers', 2, 'note', 'berubah'),
      reader(),
      { discardApproval: approval() },
    );
    expect(stale.ok).toBe(false);
    expect(stale.problems[0]).toContain('PERSETUJUAN_TIDAK_COCOK');
  });

  test('dump tanpa data buangan tidak butuh persetujuan', async () => {
    const dump = stripDiscarded(cleanDump());
    await importClean(dump);
    const report = await verifyImport(dump, reader());
    expect(failing(report)).toEqual([]);
    expect(report.ok).toBe(true);
  });

  test('tabel besar dibaca per halaman (> 1.000 baris) dengan hasil sama', async () => {
    const dump = cleanDump();
    const sheet = dump.audit_log as string[][];
    for (let i = 0; i < 1500; i++)
      sheet.push(['2026-10-03T00:00:00.000Z', 'a@x', 'tes', `t${i}`, '', '']);
    await importClean(dump);
    const report = await verify(dump);
    expect(report.tables.find((table) => table.table === 'audit_log')).toMatchObject({
      ok: true,
      expectedRows: 1503,
      actualRows: 1503,
    });
  });
});

describe('CLI dan pembaca MariaDB', () => {
  test('mariadbReader membaca SELECT dan menolak pernyataan selain SELECT', async () => {
    const schemaUrl = `${testDbUrl()}${currentTestSchema()}`;
    const live = mariadbReader(schemaUrl);
    try {
      expect((await live.query('SELECT COUNT(*) AS n FROM users'))[0]?.n).toBe(2);
      await expect(live.query('DELETE FROM users')).rejects.toThrow('SELECT');
      await expect(live.query('UPDATE users SET name = 1')).rejects.toThrow('SELECT');
    } finally {
      await live.close?.();
    }
  });

  test('argumen/URL kurang -> 2 (kata sandi tidak pernah dari argumen)', async () => {
    expect(await runVerifyCli([])).toBe(2);
    const previous = process.env[VERIFY_DB_URL_ENV];
    delete process.env[VERIFY_DB_URL_ENV];
    try {
      expect(await runVerifyCli(['--dump', 'x.json'])).toBe(2);
    } finally {
      if (previous !== undefined) process.env[VERIFY_DB_URL_ENV] = previous;
    }
  });

  test('CLI penuh: lulus dengan persetujuan (kode 0), gagal tanpa persetujuan (kode 1), report.json ditulis', async () => {
    const previous = process.env[VERIFY_DB_URL_ENV];
    process.env[VERIFY_DB_URL_ENV] = `${testDbUrl()}${currentTestSchema()}`;
    const dir = await mkdtemp(path.join(os.tmpdir(), 'verify-'));
    try {
      const dump = cleanDump();
      await writeFile(path.join(dir, 'dump.json'), JSON.stringify({ tables: dump }));
      await writeFile(path.join(dir, 'approval.json'), JSON.stringify(approvalFor(dump)));
      const base = ['--dump', path.join(dir, 'dump.json'), '--report', path.join(dir, 'r.json')];
      expect(
        await runVerifyCli([...base, '--discard-approval', path.join(dir, 'approval.json')]),
      ).toBe(0);
      const report = JSON.parse(await Bun.file(path.join(dir, 'r.json')).text());
      expect(report.ok).toBe(true);
      expect(await runVerifyCli(base)).toBe(1);
    } finally {
      if (previous === undefined) delete process.env[VERIFY_DB_URL_ENV];
      else process.env[VERIFY_DB_URL_ENV] = previous;
      await rm(dir, { recursive: true, force: true });
    }
  });
});
