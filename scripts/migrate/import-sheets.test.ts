import { afterAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Db } from '@server/core/db';
import { currentTestSchema, dropTestSchemas } from '@server-test/test-db';
import { createTestEnv } from '@server-test/test-env';
import {
  applyPlan,
  approvalFor,
  cleanDump,
  importWithApproval,
  mutate,
  stripDiscarded,
  withLegacyDetail,
} from './fixtures';
import {
  type DumpInput,
  prepareImport,
  renderSql,
  runImportCli,
  sqlLiteral,
} from './import-sheets';
import {
  DISCARDED_TARGET_TABLES,
  IMPORT_TABLES,
  INSERT_ORDER,
  INT32_COLUMNS,
  MAX_LENGTHS,
  tableDef,
  writtenColumns,
} from './schema-map';

// Tes memakai MariaDB sungguhan lewat tunnel (`bun run db:tunnel`): skema sementara per proses, dihapus di akhir.
setDefaultTimeout(30_000);
afterAll(async () => {
  await dropTestSchemas();
});

const KEPT = IMPORT_TABLES.map((table) => table.name);
const DISCARDED_KEYS = ['audit_log', 'brands', 'customers', 'files:item', 'handovers', 'items'];

async function count(db: Db, table: string): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM \`${table}\``)
    .first<{ n: number | string }>();
  return Number(row?.n ?? -1);
}

function codes(result: ReturnType<typeof prepareImport>): string[] {
  return result.report.errors.map((e) => `${e.table}:${e.row}:${e.column ?? ''}:${e.code}`);
}

describe('gerbang pembuangan data uji (keputusan pemilik 2026-11-06)', () => {
  test('dump berisi data yang akan dibuang tanpa persetujuan: berhenti dengan galat jelas, tanpa SQL', () => {
    const result = prepareImport(cleanDump());
    expect(result.report.ok).toBe(false);
    expect(result.report.discardApproved).toBe(false);
    expect(result.sql).toBeNull();
    expect(result.plan).toBeNull();
    expect(
      result.report.errors
        .filter((e) => e.code === 'DATA_DIBUANG_BUTUH_PERSETUJUAN')
        .map((e) => e.table)
        .sort(),
    ).toEqual(DISCARDED_KEYS);
    const handovers = result.report.errors.find((e) => e.table === 'handovers');
    expect(handovers?.message).toContain('4 baris');
    expect(handovers?.message).toContain('wh@x.id');
  });

  test('ringkasan buangan memuat jumlah, rentang tanggal, pembuat, dan checksum', () => {
    const { discarded } = prepareImport(cleanDump()).report;
    expect(Object.keys(discarded).sort()).toEqual(DISCARDED_KEYS);
    expect(discarded.handovers).toMatchObject({
      rows: 4,
      createdFirst: '2026-10-01T03:00:00.000Z',
      updatedLast: '2026-10-02T04:30:00.000Z',
      creators: ['wh@x.id'],
    });
    expect(discarded.handovers?.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(discarded['files:item']?.rows).toBe(1);
    expect(discarded.items?.rows).toBe(1);
    expect(discarded.brands?.rows).toBe(2);
  });

  test('ringkasan buangan audit_log memuat rentang waktu (ts) dan jumlah per pelaku (actor), bukan kosong', () => {
    const dump = cleanDump();
    const sheet = dump.audit_log as unknown[][];
    sheet.push(['2026-09-01T00:00:00.000Z', 'wh@x.id', 'item.create', 'x', '', '']);
    sheet.push(['2026-12-31T00:00:00.000Z', 'wh@x.id', 'brand.update', 'y', '', '']);
    const summary = prepareImport(dump).report.discarded.audit_log;
    expect(summary).toMatchObject({
      rows: 3,
      createdFirst: '2026-09-01T00:00:00.000Z',
      updatedLast: '2026-12-31T00:00:00.000Z',
      creators: ['staf@x.id', 'wh@x.id'],
      creatorCounts: { 'wh@x.id': 2, 'staf@x.id': 1 },
    });
    const message = prepareImport(dump).report.errors.find((e) => e.table === 'audit_log')?.message;
    expect(message).toContain('wh@x.id (2)');
    expect(message).toContain('dibuat sejak 2026-09-01');
  });

  test('persetujuan yang cocok persis meloloskan impor', () => {
    const result = importWithApproval(cleanDump());
    expect(result.report.errors).toEqual([]);
    expect(result.report.ok).toBe(true);
    expect(result.report.discardApproved).toBe(true);
    expect(result.sql).not.toBeNull();
  });

  test('tanpa tabel yang berisi data buangan tidak perlu persetujuan', () => {
    const result = prepareImport(stripDiscarded(cleanDump()));
    expect(result.report.errors).toEqual([]);
    expect(result.report.discarded).toEqual({});
    expect(result.report.discardApproved).toBe(true);
  });

  test('dump berubah sesudah disetujui: PERSETUJUAN_TIDAK_COCOK (jumlah atau isi)', () => {
    const dump = cleanDump();
    const approval = approvalFor(dump);
    const edited = mutate(dump, 'handovers', 2, 'note', 'diubah setelah disetujui');
    expect(codes(prepareImport(edited, { discardApproval: approval }))).toEqual([
      'handovers:0::PERSETUJUAN_TIDAK_COCOK',
    ]);
    const grown = structuredClone(dump);
    (grown.customers as unknown[][]).push(['c9', 'Baru', 'baru', 'active', '', '', '']);
    expect(codes(prepareImport(grown, { discardApproval: approval }))).toEqual([
      'customers:0::PERSETUJUAN_TIDAK_COCOK',
    ]);
  });

  test('persetujuan tidak mencakup semua tabel, atau tanpa pemilik/tanggal absolut, ditolak', () => {
    const dump = cleanDump();
    const approval = approvalFor(dump);
    const partial = structuredClone(approval);
    delete partial.tables.items;
    expect(codes(prepareImport(dump, { discardApproval: partial }))).toEqual([
      'items:0::DATA_DIBUANG_BUTUH_PERSETUJUAN',
    ]);
    for (const bad of [
      { ...approval, approvedBy: ' ' },
      { ...approval, approvedOn: '' },
      { ...approval, approvedOn: 'kemarin' },
      { ...approval, approvedOn: '2026-13-45' },
    ]) {
      expect(codes(prepareImport(dump, { discardApproval: bad }))).toEqual([
        'discard-approval:0::PERSETUJUAN_TIDAK_LENGKAP',
      ]);
    }
  });

  test('isi tabel yang dibuang tidak divalidasi (JSON rusak, angka rusak, rujukan yatim tidak jadi galat)', () => {
    let dump = mutate(cleanDump(), 'handovers', 2, 'checks', '{rusak');
    dump = mutate(dump, 'handovers', 2, 'location_id', 'l-hilang');
    dump = mutate(dump, 'brands', 2, 'sync_rev', 'abc');
    dump = mutate(dump, 'items', 2, 'aliases', '{rusak');
    const result = importWithApproval(dump);
    expect(result.report.errors).toEqual([]);
  });

  test('tabel yang dibuang tidak ditulis: tidak ada INSERT ke handovers/items/brands/customers', () => {
    const sql = importWithApproval(cleanDump()).sql as string;
    for (const name of [
      'handovers',
      'handover_comments',
      'items',
      'item_alias_keys',
      'brands',
      'customers',
    ]) {
      expect(sql).not.toContain(`INSERT INTO \`${name}\``);
    }
  });
});

describe('lingkup final: audit dan berkas yang berkaitan (keputusan pemilik 2026-11-06)', () => {
  const auditRow = (action: string, target = 'x') => [
    '2026-10-03T00:00:00.000Z',
    'a@x.id',
    action,
    target,
    '',
    '',
  ];

  test('audit: keluarga user/role/location/qrcode diimpor; brand/item/customer/handover (termasuk *.sync.conflict) dibuang dan diringkas', () => {
    const dump = stripDiscarded(cleanDump());
    const sheet = dump.audit_log as unknown[][];
    for (const action of ['role.create', 'location.deactivate', 'qrcode.pdf_upload', 'user.update'])
      sheet.push(auditRow(action));
    for (const action of [
      'brand.create',
      'brand.sync.conflict',
      'item.update',
      'customer.rename',
      'handover.comment',
    ])
      sheet.push(auditRow(action));
    const result = prepareImport(dump);
    expect(result.report.errors.map((e) => e.code)).toEqual(['DATA_DIBUANG_BUTUH_PERSETUJUAN']);
    expect(result.report.discarded.audit_log?.rows).toBe(5);
    expect(result.report.tables.audit_log).toMatchObject({ imported: 6, discarded: 5 });
    const ok = importWithApproval(dump);
    expect(ok.report.ok).toBe(true);
    expect(ok.rows.audit_log?.map((row) => row.values.action)).toEqual([
      'user.save',
      'user.save',
      'role.create',
      'location.deactivate',
      'qrcode.pdf_upload',
      'user.update',
    ]);
    expect(ok.sql).not.toContain('brand.create');
    expect(ok.sql).not.toContain('handover.comment');
  });

  test('audit: aksi tak dikenal atau kosong menghentikan impor per baris; pemilik memutuskan lewat pengecualian', () => {
    const dump = stripDiscarded(cleanDump());
    const sheet = dump.audit_log as unknown[][];
    sheet.push(auditRow('export.sheets', 'Spreadsheet'));
    sheet.push(auditRow('', 'kosong'));
    sheet.push(auditRow('users.save'));
    const result = prepareImport(dump);
    expect(codes(result)).toEqual([
      'audit_log:4:action:AUDIT_AKSI_TAK_DIKENAL',
      'audit_log:5:action:AUDIT_AKSI_TAK_DIKENAL',
      'audit_log:6:action:AUDIT_AKSI_TAK_DIKENAL',
    ]);
    expect(result.sql).toBeNull();
    const excluded = prepareImport(dump, {
      exclude: [
        { table: 'audit_log', row: 4 },
        { table: 'audit_log', row: 5 },
        { table: 'audit_log', row: 6 },
      ],
    });
    expect(excluded.report.ok).toBe(true);
    expect(excluded.report.tables.audit_log).toMatchObject({ imported: 2, excluded: 3 });
  });

  test('audit buangan tanpa persetujuan: berhenti; dump berubah sesudah disetujui: tidak cocok', () => {
    const dump = cleanDump();
    expect(codes(prepareImport(dump)).filter((code) => code.startsWith('audit_log'))).toEqual([
      'audit_log:0::DATA_DIBUANG_BUTUH_PERSETUJUAN',
    ]);
    const approval = approvalFor(dump);
    const grown = structuredClone(dump);
    (grown.audit_log as unknown[][]).push(auditRow('item.create'));
    expect(codes(prepareImport(grown, { discardApproval: approval }))).toEqual([
      'audit_log:0::PERSETUJUAN_TIDAK_COCOK',
    ]);
  });

  test('berkas: hanya yang dirujuk tabel QR yang diimpor; yang tak dirujuk dibuang (dengan persetujuan), milik item dibuang', () => {
    const dump = cleanDump();
    (dump.files as unknown[][]).push(
      ['f9', 'drv9', 'image/png', '1', '1', '1', 'qrlogo', 'shared', '', ''],
      ['f8', 'drv8', 'image/png', '1', '1', '1', '', '', '', ''],
    );
    const result = prepareImport(dump);
    expect(result.report.discarded['files:tak-dirujuk']?.rows).toBe(2);
    expect(result.report.discarded['files:item']?.rows).toBe(1);
    expect(result.report.errors.map((e) => e.table)).toContain('files:tak-dirujuk');
    const ok = importWithApproval(dump);
    expect(ok.report.ok).toBe(true);
    expect(ok.rows.files?.map((row) => row.values.id)).toEqual(['f2', 'f3']);
    expect(ok.report.tables.files).toMatchObject({ imported: 2, discarded: 3 });
    expect(ok.sql).not.toContain("'f9'");
  });

  test('berkas dirujuk lewat logo desain, pustaka logo (daftar), logo bawaan default, dan logo bawaan preset', () => {
    let dump = stripDiscarded(cleanDump());
    for (const [table, column, value] of [
      ['qr_defaults', 'logo_file_ids', '["f2"]'],
      ['qr_defaults', 'default_logo_id', ''],
      ['qr_presets', 'default_logo_id', ''],
      ['qr_designs', 'logo_file_id', ''],
    ] as const)
      dump = mutate(dump, table, 2, column, value);
    // f2 (pustaka) tetap; f3 kini tak dirujuk -> dibuang
    expect(Object.keys(prepareImport(dump).report.discarded)).toEqual(['files:tak-dirujuk']);
    expect(importWithApproval(dump).rows.files?.map((row) => row.values.id)).toEqual(['f2']);
    for (const [table, column] of [
      ['qr_designs', 'logo_file_id'],
      ['qr_presets', 'default_logo_id'],
      ['qr_defaults', 'default_logo_id'],
    ] as const) {
      const only = mutate(dump, table, 2, column, 'f3');
      const kept = importWithApproval(only).rows.files?.map((row) => row.values.id);
      expect({ table, kept }).toEqual({ table, kept: ['f2', 'f3'] });
    }
  });

  test('rujukan QR ke berkas yang dibuang tetap yatim (galat), bukan diam-diam hilang', () => {
    const dump = mutate(cleanDump(), 'qr_presets', 2, 'default_logo_id', 'f1');
    expect(codes(importWithApproval(dump))).toEqual(['qr_presets:2:default_logo_id:RUJUKAN_YATIM']);
  });
});

describe('dump bersih dijalankan ke MariaDB', () => {
  test('jumlah baris sama; tabel buangan kosong; berkas milik item tidak ikut', async () => {
    const dump = cleanDump();
    const result = importWithApproval(dump);
    const env = await createTestEnv();
    await applyPlan(env.DB, result.plan as NonNullable<typeof result.plan>);
    const expected: Record<string, number> = {
      users: 2,
      roles: 1,
      locations: 2,
      audit_log: 2,
      files: 2,
      qr_designs: 1,
      qr_documents: 1,
      qr_defaults: 1,
      qr_presets: 1,
    };
    for (const name of KEPT) {
      expect({ name, n: await count(env.DB, name) }).toEqual({ name, n: expected[name] as number });
    }
    for (const name of DISCARDED_TARGET_TABLES) {
      expect({ name, n: await count(env.DB, name) }).toEqual({ name, n: 0 });
    }
    const files = await env.DB.prepare(
      'SELECT id, owner_type, status FROM files ORDER BY id',
    ).all();
    expect(files.results).toEqual([
      { id: 'f2', owner_type: 'qrlogo', status: 'active' },
      { id: 'f3', owner_type: '', status: 'active' },
    ]);
  });

  test('sync_state dan counters TIDAK diimpor (lingkup final pemilik 2026-11-06): sheet diabaikan tanpa peringatan, tabel target kosong', async () => {
    const result = importWithApproval(cleanDump());
    expect(result.report.warnings.map((w) => w.code)).not.toContain('SHEET_TAK_DIKENAL');
    expect(result.sql).not.toMatch(/INSERT INTO .(sync_state|counters)./);
    expect(result.rows.sync_state).toBeUndefined();
    expect(result.report.tables.sync_state).toBeUndefined();
    const env = await createTestEnv();
    await applyPlan(env.DB, result.plan as NonNullable<typeof result.plan>);
    expect(await count(env.DB, 'counters')).toBe(0);
    expect(await count(env.DB, 'sync_state')).toBe(0);
  });

  test('teks dengan kutip, backslash, kutip ganda JSON, emoji, CR/LF dan Ctrl-Z tersimpan persis (jalur berparameter)', async () => {
    const dump = cleanDump();
    const result = importWithApproval(dump);
    const env = await createTestEnv();
    await applyPlan(env.DB, result.plan as NonNullable<typeof result.plan>);
    const audit = await env.DB.prepare("SELECT `after` FROM audit_log WHERE target = 'u2'").first<{
      after: string;
    }>();
    expect(audit?.after).toBe(
      JSON.stringify({
        nama: 'O\'Brien \\ "x"',
        emoji: '\u{1F600}',
        baris: 'a\nb\r\nc',
        ctrlz: String.fromCharCode(26),
      }),
    );
  });

  test('berkas import.sql (literal ter-escape, satu transaksi) menghasilkan isi yang sama dengan jalur berparameter', async () => {
    const result = importWithApproval(cleanDump());
    const env = await createTestEnv();
    await applyPlan(env.DB, result.plan as NonNullable<typeof result.plan>);
    const viaParams = await env.DB.prepare(
      'SELECT id, target, `before`, `after` FROM audit_log ORDER BY id',
    ).all();
    const users = await env.DB.prepare('SELECT * FROM users ORDER BY id').all();

    const fresh = await createTestEnv();
    await fresh.DB.exec(result.sql as string);
    expect(
      (
        await fresh.DB.prepare(
          'SELECT id, target, `before`, `after` FROM audit_log ORDER BY id',
        ).all()
      ).results,
    ).toEqual(viaParams.results);
    expect((await fresh.DB.prepare('SELECT * FROM users ORDER BY id').all()).results).toEqual(
      users.results,
    );
  });

  test('galat di tengah berkas import.sql membatalkan SEMUA penulisan (atomik)', async () => {
    const result = importWithApproval(cleanDump());
    const broken = (result.sql as string).replace(
      'COMMIT;',
      "INSERT INTO `roles` (`id`, `name`) VALUES ('r1', 'ganda');\nCOMMIT;",
    );
    expect(broken).not.toBe(result.sql);
    const env = await createTestEnv();
    await expect(env.DB.exec(broken)).rejects.toThrow();
    for (const name of KEPT) expect({ name, n: await count(env.DB, name) }).toEqual({ name, n: 0 });
  });

  test('urutan baris audit_log menjadi urutan id', async () => {
    const env = await createTestEnv();
    await applyPlan(env.DB, importWithApproval(cleanDump()).plan as never);
    const rows = await env.DB.prepare('SELECT id, target FROM audit_log ORDER BY id').all<{
      id: number;
      target: string;
    }>();
    expect(rows.results.map((row) => row.target)).toEqual(['u1', 'u2']);
  });

  test('INSERT berparameter: hanya penampung ?, dipecah per 200 baris', () => {
    const dump = cleanDump();
    const sheet = dump.audit_log as string[][];
    for (let i = 0; i < 450; i++)
      sheet.push(['2026-10-03T00:00:00.000Z', 'a@x', 'qrcode.tes', `t${i}`, '', "x'\\"]);
    const plan = importWithApproval(dump).plan as NonNullable<
      ReturnType<typeof importWithApproval>['plan']
    >;
    const audit = plan.transaction.filter((s) => s.sql.startsWith('INSERT INTO `audit_log`'));
    expect(audit.map((s) => s.params.length / 6)).toEqual([200, 200, 52]);
    for (const statement of plan.transaction) {
      expect(statement.sql).not.toContain("'");
      expect(statement.sql.split('?').length - 1).toBe(statement.params.length);
    }
  });

  test('kolom key/before/after berbacktick di semua pernyataan', () => {
    const plan = importWithApproval(cleanDump()).plan as never as {
      transaction: { sql: string }[];
    };
    const sql = plan.transaction.map((s) => s.sql).join('\n');
    expect(sql).toContain('`before`, `after`');
    expect(sql).not.toMatch(/"before"|"after"/);
  });

  test('--reset: gladi berulang, tabel buangan yang sudah berisi di target dikosongkan, id audit mulai dari 1', async () => {
    const result = importWithApproval(cleanDump(), { reset: true });
    const plan = result.plan as NonNullable<typeof result.plan>;
    const env = await createTestEnv();
    // sisa gladi sebelumnya: data uji di target (anak dulu agar kunci asing terpenuhi)
    await env.DB.exec(`
      INSERT INTO brands (id, \`key\`) VALUES ('b1', 'acme');
      INSERT INTO customers (id, \`key\`) VALUES ('c1', 'cv');
      INSERT INTO items (id, \`key\`, brand_id) VALUES ('i1', 'model', 'b1');
      INSERT INTO item_alias_keys (\`key\`, item_id) VALUES ('mx', 'i1');
      INSERT INTO handovers (id, number) VALUES ('h1', 'ST-20261001-001');
      INSERT INTO handover_comments (id, handover_id) VALUES ('c1', 'h1');
      INSERT INTO files (id, owner_type, owner_id) VALUES ('fx', 'item', 'i1');
      INSERT INTO counters (\`key\`, value) VALUES ('st:20260101', 9);
      INSERT INTO sync_state (resource, seq) VALUES ('items', 9);
      INSERT INTO audit_log (ts) VALUES ('2026-01-01T00:00:00.000Z'), ('2026-01-02T00:00:00.000Z');
    `);
    await applyPlan(env.DB, plan);
    await applyPlan(env.DB, plan);
    for (const name of DISCARDED_TARGET_TABLES)
      expect({ name, n: await count(env.DB, name) }).toEqual({ name, n: 0 });
    expect(
      Number(
        (
          await env.DB.prepare("SELECT COUNT(*) AS n FROM files WHERE owner_type = 'item'").first<{
            n: number;
          }>()
        )?.n,
      ),
    ).toBe(0);
    expect(await count(env.DB, 'audit_log')).toBe(2);
    expect(await count(env.DB, 'files')).toBe(2);
    const min = await env.DB.prepare('SELECT MIN(id) AS m FROM audit_log').first<{ m: number }>();
    expect(Number(min?.m)).toBe(1);
    expect(result.sql).toContain('TRUNCATE TABLE `audit_log`;\nSTART TRANSACTION;');
  });

  test('tanpa --reset berkas tidak berisi DELETE/TRUNCATE', () => {
    const sql = importWithApproval(cleanDump()).sql as string;
    expect(sql).not.toMatch(/DELETE FROM|TRUNCATE/);
    expect(sql).toMatch(/^SET NAMES utf8mb4 COLLATE utf8mb4_nopad_bin;$/m);
    expect(sql).toContain('START TRANSACTION;');
    expect(sql.trimEnd().endsWith('COMMIT;')).toBe(true);
  });

  test('dump boleh dibungkus {tables: ...} (keluaran sheets.dump)', () => {
    const wrapped: DumpInput = { tables: stripDiscarded(cleanDump()) };
    expect(prepareImport(wrapped).report.ok).toBe(true);
  });
});

describe('literal SQL', () => {
  test('sqlLiteral meng-escape backslash, kutip, CR/LF, dan Ctrl-Z; angka apa adanya', () => {
    expect(sqlLiteral("a\\b'c\nd\re")).toBe("'a\\\\b\\'c\\nd\\re'");
    expect(sqlLiteral(`x${String.fromCharCode(26)}y`)).toBe("'x\\Zy'");
    expect(sqlLiteral(42)).toBe('42');
    expect(sqlLiteral('\u{1F600}')).toBe("'\u{1F600}'");
  });

  test('renderSql menolak jumlah parameter yang tak sama dengan penampung', () => {
    expect(() =>
      renderSql({ reset: false, before: [], transaction: [{ sql: 'SELECT ?, ?', params: [1] }] }),
    ).toThrow('penampung');
  });
});

describe('dump kotor menghentikan impor tanpa SQL', () => {
  const importOk = (dump: ReturnType<typeof cleanDump>) => importWithApproval(dump);

  test('id ganda dalam tabel, email ganda', () => {
    const dump = cleanDump();
    (dump.locations as unknown[][]).push([...((dump.locations as unknown[][])[1] as unknown[])]);
    const result = importOk(dump);
    expect(result.sql).toBeNull();
    expect(result.report.errors).toContainEqual(
      expect.objectContaining({ table: 'locations', row: 4, code: 'DUPLIKAT', column: 'id' }),
    );
    expect(codes(importOk(mutate(cleanDump(), 'users', 3, 'email', ' ADMIN@x.id ')))).toContain(
      'users:3:email:DUPLIKAT',
    );
  });

  test('rujukan yatim: lokasi/peran di users, dokumen/logo QR, logo yang milik item', () => {
    const cases: Array<[string, number, string, string, string]> = [
      [
        'users',
        3,
        'assignments',
        JSON.stringify([{ locationId: 'l-x', roleIds: ['r1'] }]),
        'users:assignments',
      ],
      [
        'users',
        3,
        'assignments',
        JSON.stringify([{ locationId: null, roleIds: ['r-x'] }]),
        'users:assignments',
      ],
      ['qr_designs', 2, 'document_id', 'd-x', 'qr_designs:document_id'],
      ['qr_designs', 2, 'logo_file_id', 'f-x', 'qr_designs:logo_file_id'],
      // f1 berkas milik item: ikut dibuang, jadi QR yang merujuknya yatim
      ['qr_designs', 2, 'logo_file_id', 'f1', 'qr_designs:logo_file_id'],
      ['qr_defaults', 2, 'logo_file_ids', '["f-x"]', 'qr_defaults:logo_file_ids'],
      ['qr_defaults', 2, 'default_logo_id', 'f-x', 'qr_defaults:default_logo_id'],
      ['qr_presets', 2, 'default_logo_id', 'f-x', 'qr_presets:default_logo_id'],
    ];
    for (const [table, row, column, value, expected] of cases) {
      const result = importOk(mutate(cleanDump(), table, row, column, value));
      expect({ expected, sql: result.sql }).toEqual({ expected, sql: null });
      expect(result.report.errors.map((e) => `${e.table}:${e.column}:${e.code}`)).toContain(
        `${expected.split(':')[0]}:${expected.split(':')[1]}:RUJUKAN_YATIM`,
      );
    }
  });

  test('peran lama (role_ids) yatim tanpa assignments', () => {
    let dump = mutate(cleanDump(), 'users', 2, 'assignments', '');
    dump = mutate(dump, 'users', 2, 'role_ids', '["r-hilang"]');
    expect(importOk(dump).report.errors.map((e) => e.code)).toContain('RUJUKAN_YATIM');
    const ok = mutate(
      mutate(cleanDump(), 'users', 2, 'assignments', ''),
      'users',
      2,
      'role_ids',
      '["r1"]',
    );
    expect(importOk(ok).report.ok).toBe(true);
  });

  test('angka bertulisan "12" menjadi 12; " 12 " dan "5.0" dilaporkan', () => {
    const result = importOk(mutate(cleanDump(), 'qr_documents', 2, 'size', '12'));
    expect(result.report.ok).toBe(true);
    expect(result.rows.qr_documents?.[0]?.values.size).toBe(12);
    expect(result.report.numericText).toBeGreaterThan(0);
    const messy = importOk(
      mutate(mutate(cleanDump(), 'qr_documents', 2, 'size', ' 12 '), 'files', 3, 'size', '5.0'),
    );
    expect(messy.report.ok).toBe(true);
    expect(
      messy.report.normalizations.map((n) => `${n.table}:${n.row}:${n.column}:${n.rule}`),
    ).toEqual(['files:3:size:angka-desimal-nol-ke-integer', 'qr_documents:2:size:pangkas-spasi']);
  });

  test('angka bukan bilangan bulat tak negatif atau melebihi INT 32-bit dihentikan', () => {
    for (const bad of ['abc', '-3', '1,5', '1e3', '12.5']) {
      const result = importOk(mutate(cleanDump(), 'qr_documents', 2, 'size', bad));
      expect({ bad, sql: result.sql }).toEqual({ bad, sql: null });
      expect(result.report.errors[0]?.code).toBe('BUKAN_INTEGER');
    }
    const wide = importOk(mutate(cleanDump(), 'files', 3, 'width', '2147483648'));
    expect(codes(wide)).toEqual(['files:3:width:NILAI_TERLALU_BESAR']);
    expect(importOk(mutate(cleanDump(), 'files', 3, 'width', '2147483647')).report.ok).toBe(true);
  });

  test('tanggal 2026/10/5 dinormalkan ke ISO UTC (WIB) dan dilaporkan', () => {
    const result = importOk(mutate(cleanDump(), 'locations', 2, 'created_at', '2026/10/5'));
    expect(result.report.ok).toBe(true);
    expect(result.report.normalizations).toEqual([
      {
        table: 'locations',
        row: 2,
        column: 'created_at',
        rule: 'tanggal-wib-ke-utc',
        from: '2026/10/5',
        to: '2026-10-04T17:00:00.000Z',
      },
    ]);
  });

  test('ISO dengan zona dan jam Sheets dinormalkan; tanggal tak terbaca atau ambigu dihentikan', () => {
    const iso = importOk(
      mutate(cleanDump(), 'roles', 2, 'created_at', '2026-10-05T10:00:00+07:00'),
    );
    expect(iso.report.normalizations[0]?.to).toBe('2026-10-05T03:00:00.000Z');
    const sheetStyle = importOk(
      mutate(cleanDump(), 'roles', 2, 'created_at', '2026-10-05 10:00:00'),
    );
    expect(sheetStyle.report.normalizations[0]?.to).toBe('2026-10-05T03:00:00.000Z');
    for (const bad of ['5/10/2026', 'kemarin', '2026-02-30', '2026-13-01', '45934']) {
      const result = importOk(mutate(cleanDump(), 'roles', 2, 'created_at', bad));
      expect({ bad, sql: result.sql }).toEqual({ bad, sql: null });
      expect(result.report.errors[0]).toMatchObject({
        table: 'roles',
        row: 2,
        code: 'TANGGAL_TAK_TERBACA',
        column: 'created_at',
      });
    }
    expect(importOk(mutate(cleanDump(), 'audit_log', 2, 'ts', '')).report.errors[0]?.code).toBe(
      'TANGGAL_TAK_TERBACA',
    );
  });

  test('JSON rusak, owner_type tak dikenal, NUL dan surrogate yatim menghentikan impor', () => {
    expect(
      importOk(mutate(cleanDump(), 'users', 2, 'assignments', '{rusak')).report.errors[0]?.code,
    ).toBe('JSON_TAK_VALID');
    expect(
      importOk(mutate(cleanDump(), 'qr_defaults', 2, 'logo_file_ids', '{"a":1}')).report.errors[0]
        ?.code,
    ).toBe('JSON_TAK_VALID');
    expect(
      importOk(mutate(cleanDump(), 'files', 3, 'owner_type', 'aneh')).report.errors[0]?.code,
    ).toBe('NILAI_TAK_VALID');
    expect(
      importOk(mutate(cleanDump(), 'users', 2, 'name', 'a\u0000b')).report.errors[0]?.code,
    ).toBe('NUL');
    expect(
      importOk(mutate(cleanDump(), 'users', 2, 'name', 'a\ud800b')).report.errors[0]?.code,
    ).toBe('TEKS_TAK_VALID');
  });

  test('nilai lebih panjang dari kolom MariaDB (karakter, bukan UTF-16) dilaporkan per baris', () => {
    expect(codes(importOk(mutate(cleanDump(), 'locations', 2, 'name', 'x'.repeat(256))))).toEqual([
      'locations:2:name:NILAI_TERLALU_PANJANG',
    ]);
    // 255 emoji = 255 karakter (510 unit UTF-16): lolos
    expect(
      importOk(mutate(cleanDump(), 'locations', 2, 'name', '\u{1F600}'.repeat(255))).report.ok,
    ).toBe(true);
    expect(
      codes(importOk(mutate(cleanDump(), 'audit_log', 2, 'action', `user.${'a'.repeat(60)}`))),
    ).toEqual(['audit_log:2:action:NILAI_TERLALU_PANJANG']);
    expect(codes(importOk(mutate(cleanDump(), 'qr_designs', 2, 'link', 'h'.repeat(2049))))).toEqual(
      ['qr_designs:2:link:NILAI_TERLALU_PANJANG'],
    );
    // LONGTEXT tidak dibatasi
    expect(
      importOk(mutate(cleanDump(), 'audit_log', 2, 'after', 'x'.repeat(300_000))).report.ok,
    ).toBe(true);
  });

  test('semua galat dilaporkan sekaligus per baris, bukan berhenti di yang pertama', () => {
    let dump = mutate(cleanDump(), 'qr_designs', 2, 'document_id', 'd-x');
    dump = mutate(dump, 'qr_documents', 2, 'size', 'abc');
    dump = mutate(dump, 'locations', 3, 'updated_at', 'kemarin');
    expect(codes(importOk(dump)).sort()).toEqual(
      [
        'locations:3:updated_at:TANGGAL_TAK_TERBACA',
        'qr_documents:2:size:BUKAN_INTEGER',
        'qr_designs:2:document_id:RUJUKAN_YATIM',
      ].sort(),
    );
  });

  test('nama peran, kode dan nama lokasi ganda (tanpa beda huruf) dihentikan', () => {
    const roles = cleanDump();
    (roles.roles as unknown[][]).push(['r2', ' ADMIN ', '', '{}', '', '', '']);
    expect(codes(importOk(roles))).toEqual(['roles:3:name:DUPLIKAT']);
    expect(codes(importOk(mutate(cleanDump(), 'locations', 3, 'code', 'A')))).toEqual([
      'locations:3:code:DUPLIKAT',
    ]);
    expect(codes(importOk(mutate(cleanDump(), 'locations', 3, 'name', 'gudang a')))).toEqual([
      'locations:3:name:DUPLIKAT',
    ]);
    // kode lokasi membedakan huruf besar/kecil (UNIQUE byte persis), nama tidak
    expect(importOk(mutate(cleanDump(), 'locations', 3, 'code', 'a')).report.ok).toBe(true);
  });
});

describe('penyaringan baris', () => {
  test('baris kosong dilewati, id kosong dikecualikan dengan laporan', () => {
    const dump = cleanDump();
    (dump.locations as unknown[][]).push(['', '', '', '', '', '', '']);
    (dump.locations as unknown[][]).push(['', 'C', 'Tanpa Id', 'active', '', '', '']);
    const result = importWithApproval(dump);
    expect(result.report.ok).toBe(true);
    expect(result.report.tables.locations).toMatchObject({
      sheetRows: 4,
      blank: 1,
      excluded: 1,
      imported: 2,
    });
    expect(result.report.excluded).toContainEqual(
      expect.objectContaining({ table: 'locations', row: 5, code: 'ID_KOSONG' }),
    );
  });

  test('keputusan pemilik: --exclude baris duplikat menyelesaikan impor', () => {
    const dump = cleanDump();
    (dump.locations as unknown[][]).push([...((dump.locations as unknown[][])[1] as unknown[])]);
    expect(importWithApproval(dump).report.ok).toBe(false);
    const result = importWithApproval(dump, { exclude: [{ table: 'locations', row: 4 }] });
    expect(result.report.ok).toBe(true);
    expect(result.report.tables.locations).toMatchObject({ imported: 2, excluded: 1 });
    expect(result.report.excluded).toContainEqual(
      expect.objectContaining({ code: 'DIKECUALIKAN_PEMILIK' }),
    );
  });

  test('sheet tak ada atau kolom hilang: peringatan, bukan galat; teks bebas tidak dipangkas', () => {
    const dump = cleanDump();
    delete dump.qr_presets;
    dump.users = [
      ['id', 'email', 'name'],
      ['u1', 'a@x.id', '  Admin  '],
    ];
    dump.qr_defaults = [['id'], ['default']];
    delete dump.sync_state;
    const result = importWithApproval(dump);
    expect(result.report.errors).toEqual([]);
    expect(result.sql).toContain("'  Admin  '");
    const warned = result.report.warnings.map((w) => w.code);
    expect(warned).toContain('SHEET_KOSONG');
    expect(warned).toContain('KOLOM_HILANG');
  });

  test('sheet tabel yang dibuang tidak ada: tanpa peringatan dan tanpa galat', () => {
    const result = prepareImport(stripDiscarded(cleanDump()));
    expect(result.report.warnings.filter((w) => ['handovers', 'items'].includes(w.table))).toEqual(
      [],
    );
  });
});

describe('skema', () => {
  test('pemetaan sama dengan skema MariaDB: kolom, kolom wajib, panjang VARCHAR, INT 32-bit', async () => {
    const env = await createTestEnv();
    const schema = currentTestSchema() as string;
    for (const def of IMPORT_TABLES) {
      const info = await env.DB.prepare(
        'SELECT column_name AS name, data_type AS type, character_maximum_length AS len, is_nullable AS nullable, column_default AS dflt, extra FROM information_schema.columns WHERE table_schema = ? AND table_name = ?',
      )
        .bind(schema, def.name)
        .all<{
          name: string;
          type: string;
          len: number | string | null;
          nullable: string;
          dflt: unknown;
          extra: string;
        }>();
      expect(info.results.length).toBeGreaterThan(0);
      const columns = new Map(info.results.map((column) => [column.name, column]));
      const written = new Set(writtenColumns(def));
      for (const name of written) {
        expect({ table: def.name, name, exists: columns.has(name) }).toEqual({
          table: def.name,
          name,
          exists: true,
        });
      }
      for (const column of info.results) {
        const generated = /GENERATED|auto_increment/i.test(column.extra);
        if (column.nullable === 'NO' && column.dflt === null && !generated) {
          expect({
            table: def.name,
            column: column.name,
            written: written.has(column.name),
          }).toEqual({
            table: def.name,
            column: column.name,
            written: true,
          });
        }
        const limit = MAX_LENGTHS[def.name]?.[column.name];
        if (!written.has(column.name)) continue;
        if (column.type === 'varchar') {
          expect({ table: def.name, column: column.name, limit }).toEqual({
            table: def.name,
            column: column.name,
            limit: Number(column.len),
          });
        } else {
          expect({ table: def.name, column: column.name, limit }).toEqual({
            table: def.name,
            column: column.name,
            limit: undefined,
          });
        }
      }
      for (const name of INT32_COLUMNS[def.name] ?? []) expect(columns.get(name)?.type).toBe('int');
      // kolom Sheets bertipe int yang bukan INT32 harus BIGINT (tanpa batas di sisi impor)
      for (const column of def.columns.filter((c) => c.kind === 'int')) {
        if (!(INT32_COLUMNS[def.name] ?? []).includes(column.name))
          expect(columns.get(column.name)?.type).toBe('bigint');
      }
    }
  });

  test('setiap tabel di skema punya keputusan: diimpor, dibuang, atau tabel runtime yang tak disentuh', async () => {
    const env = await createTestEnv();
    const schema = currentTestSchema() as string;
    const tables = await env.DB.prepare(
      "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = ? AND table_type = 'BASE TABLE'",
    )
      .bind(schema)
      .all<{ name: string }>();
    const runtime = ['job_blobs', 'jobs', 'rate_limits', 'schema_migrations', 'settings'];
    const decided = new Set<string>([...KEPT, ...DISCARDED_TARGET_TABLES, ...runtime]);
    expect(tables.results.map((t) => t.name).filter((name) => !decided.has(name))).toEqual([]);
    expect([...INSERT_ORDER].map(String).sort()).toEqual([...KEPT].sort());
    for (const name of DISCARDED_TARGET_TABLES)
      expect(tables.results.map((t) => t.name)).toContain(name);
    expect(tableDef('files').divert?.matches('item')).toBe(true);
    expect(tableDef('files').divert?.matches('qrlogo')).toBe(false);
  });
});

describe('CLI', () => {
  async function withDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'import-'));
    try {
      return await fn(dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  const exists = (file: string) =>
    stat(file).then(
      () => true,
      () => false,
    );

  test('data buangan tanpa persetujuan: kode 1, report.json (dengan templat persetujuan) ditulis, import.sql TIDAK ada (termasuk sisa proses lama)', async () => {
    await withDir(async (dir) => {
      const out = path.join(dir, 'import.sql');
      await writeFile(out, '-- sisa lama');
      await writeFile(path.join(dir, 'dump.json'), JSON.stringify({ tables: cleanDump() }));
      const code = await runImportCli([
        '--dump',
        path.join(dir, 'dump.json'),
        '--out',
        out,
        '--report',
        path.join(dir, 'report.json'),
      ]);
      expect(code).toBe(1);
      expect(await exists(out)).toBe(false);
      const report = JSON.parse(await readFile(path.join(dir, 'report.json'), 'utf8'));
      expect(report.ok).toBe(false);
      expect(report.errors[0].code).toBe('DATA_DIBUANG_BUTUH_PERSETUJUAN');
      expect(Object.keys(report.approvalTemplate.tables).sort()).toEqual(DISCARDED_KEYS);
      expect(report.approvalTemplate.approvedBy).toBe('');
    });
  });

  test('--discard-approval: import.sql ditulis dan dapat dijalankan ke MariaDB; tabel buangan kosong', async () => {
    await withDir(async (dir) => {
      const dump = cleanDump();
      await writeFile(path.join(dir, 'dump.json'), JSON.stringify({ tables: dump }));
      await writeFile(path.join(dir, 'approval.json'), JSON.stringify(approvalFor(dump)));
      const code = await runImportCli([
        '--dump',
        path.join(dir, 'dump.json'),
        '--out',
        path.join(dir, 'import.sql'),
        '--report',
        path.join(dir, 'report.json'),
        '--discard-approval',
        path.join(dir, 'approval.json'),
      ]);
      expect(code).toBe(0);
      const report = JSON.parse(await readFile(path.join(dir, 'report.json'), 'utf8'));
      expect(report.ok).toBe(true);
      expect(report.discardApproved).toBe(true);
      const env = await createTestEnv();
      await env.DB.exec(await readFile(path.join(dir, 'import.sql'), 'utf8'));
      expect(await count(env.DB, 'users')).toBe(2);
      expect(await count(env.DB, 'handovers')).toBe(0);
    });
  });

  test('persetujuan basi (dump berubah): kode 1', async () => {
    await withDir(async (dir) => {
      const dump = cleanDump();
      await writeFile(path.join(dir, 'approval.json'), JSON.stringify(approvalFor(dump)));
      await writeFile(
        path.join(dir, 'dump.json'),
        JSON.stringify(mutate(dump, 'items', 2, 'model', 'Berubah')),
      );
      const code = await runImportCli([
        '--dump',
        path.join(dir, 'dump.json'),
        '--out',
        path.join(dir, 'i.sql'),
        '--report',
        path.join(dir, 'r.json'),
        '--discard-approval',
        path.join(dir, 'approval.json'),
      ]);
      expect(code).toBe(1);
      const report = JSON.parse(await readFile(path.join(dir, 'r.json'), 'utf8'));
      expect(report.errors[0].code).toBe('PERSETUJUAN_TIDAK_COCOK');
    });
  });

  test('argumen kurang: kode 2; --exclude dan --reset dibaca', async () => {
    expect(await runImportCli([])).toBe(2);
    await withDir(async (dir) => {
      const dump = stripDiscarded(cleanDump());
      (dump.locations as unknown[][]).push([...((dump.locations as unknown[][])[1] as unknown[])]);
      await writeFile(path.join(dir, 'dump.json'), JSON.stringify(dump));
      await writeFile(path.join(dir, 'ex.json'), JSON.stringify([{ table: 'locations', row: 4 }]));
      const code = await runImportCli([
        '--dump',
        path.join(dir, 'dump.json'),
        '--out',
        path.join(dir, 'i.sql'),
        '--report',
        path.join(dir, 'r.json'),
        '--exclude',
        path.join(dir, 'ex.json'),
        '--reset',
      ]);
      expect(code).toBe(0);
      expect(await readFile(path.join(dir, 'i.sql'), 'utf8')).toContain(
        'TRUNCATE TABLE `audit_log`',
      );
    });
  });
});

describe('kolom legasi audit_log.detail', () => {
  test('header detail dengan semua sel kosong diabaikan: hasil identik dengan tanpa kolom itu, tanpa peringatan', () => {
    const base = importWithApproval(cleanDump());
    const legacy = importWithApproval(withLegacyDetail(cleanDump()));
    expect(legacy.report.errors).toEqual([]);
    expect(legacy.sql).toBe(base.sql);
    expect(legacy.report.warnings).toEqual(base.report.warnings);
    expect(legacy.report.tables).toEqual(base.report.tables);
    expect(legacy.report.discarded).toEqual(base.report.discarded);
  });

  test('detail terisi: galat per baris (nomor baris, tanpa isi sel) dan impor berhenti', () => {
    const secret = 'RAHASIA-ISI-DETAIL';
    const dump = withLegacyDetail(cleanDump(), { 2: secret, 3: `  ${secret}  ` });
    const result = prepareImport(dump, { discardApproval: approvalFor(dump) });
    expect(result.sql).toBeNull();
    const issues = result.report.errors.filter((e) => e.code === 'KOLOM_LEGASI_TERISI');
    expect(issues.map((e) => [e.table, e.row, e.column])).toEqual([
      ['audit_log', 2, 'detail'],
      ['audit_log', 3, 'detail'],
    ]);
    expect(JSON.stringify(result.report)).not.toContain(secret);
    expect(issues[0]?.message).toContain('excludes.json');
  });

  test('baris yang hanya berisi detail (kolom lain kosong) tetap dilaporkan, bukan dianggap kosong', () => {
    const dump = withLegacyDetail(cleanDump());
    const audit = dump.audit_log as string[][];
    audit.push(['', '', '', '', '', '', 'sisa']);
    const result = prepareImport(dump, { discardApproval: approvalFor(dump) });
    expect(result.report.errors.map((e) => [e.code, e.row])).toEqual([
      ['KOLOM_LEGASI_TERISI', audit.length],
    ]);
  });

  test('keputusan pemilik: baris dengan detail terisi dikecualikan lewat excludes.json', () => {
    const dump = withLegacyDetail(cleanDump(), { 2: 'sisa' });
    const result = prepareImport(dump, {
      discardApproval: approvalFor(dump),
      exclude: [{ table: 'audit_log', row: 2 }],
    });
    expect(result.report.errors).toEqual([]);
    expect(result.report.excluded.map((e) => [e.table, e.row])).toEqual([['audit_log', 2]]);
    expect(result.sql).not.toBeNull();
  });

  test('detail pada baris audit modul yang dibuang tidak menghalangi (barisnya dibuang seluruhnya)', () => {
    const dump = withLegacyDetail(cleanDump());
    const audit = dump.audit_log as string[][];
    const header = audit[0] as string[];
    const row = header.map(() => '');
    row[header.indexOf('ts')] = '2026-10-01T03:00:00.000Z';
    row[header.indexOf('action')] = 'item.create';
    row[header.indexOf('detail')] = 'lama';
    audit.push(row);
    const result = prepareImport(dump, { discardApproval: approvalFor(dump) });
    expect(result.report.errors).toEqual([]);
  });

  test('kolom tak dikenal lain di audit_log tetap diperingatkan; hanya kolom legasi yang disenyapkan', () => {
    const dump = withLegacyDetail(cleanDump());
    (dump.audit_log as string[][]).forEach((row, index) => {
      row.push(index === 0 ? 'aneh' : '');
    });
    const warned = importWithApproval(dump).report.warnings.filter(
      (w) => w.code === 'KOLOM_TAK_DIKENAL',
    );
    expect(warned.map((w) => w.column)).toEqual(['aneh']);
  });
});
