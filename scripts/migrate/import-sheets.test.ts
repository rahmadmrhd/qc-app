import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createTestEnv } from '@server-test/test-env';
import { cleanDump, grid, mutate } from './fixtures';
import { type DumpInput, prepareImport, runImportCli } from './import-sheets';
import { INSERT_ORDER, TABLES } from './schema-map';

const SHEET_TABLES = TABLES.map((table) => table.name);

async function runSql(sql: string) {
  const env = await createTestEnv();
  await env.DB.exec(sql);
  return env;
}

async function count(db: D1Database, table: string): Promise<number> {
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>();
  return row?.n ?? -1;
}

describe('dump bersih', () => {
  test('menghasilkan SQL yang bila dijalankan memberi jumlah baris sama dan board valid', async () => {
    const dump = cleanDump();
    const result = prepareImport(dump);
    expect(result.report.errors).toEqual([]);
    expect(result.report.ok).toBe(true);
    expect(result.sql).not.toBeNull();
    const env = await runSql(result.sql as string);
    for (const name of SHEET_TABLES) {
      const expected = (dump[name] as unknown[][]).length - 1;
      expect({ name, n: await count(env.DB, name) }).toEqual({ name, n: expected });
    }
    expect(await count(env.DB, 'handover_comments')).toBe(2);
    const board = await env.DB.prepare(
      'SELECT number, board_status, checked_count, total_count, version FROM handovers ORDER BY number',
    ).all<{
      number: string;
      board_status: string;
      checked_count: number;
      total_count: number;
      version: number;
    }>();
    expect(board.results).toEqual([
      {
        number: 'ST-20261001-001',
        board_status: 'in_progress',
        checked_count: 1,
        total_count: 3,
        version: 1,
      },
      {
        number: 'ST-20261001-002',
        board_status: 'cancelled',
        checked_count: 0,
        total_count: 1,
        version: 1,
      },
      {
        number: 'ST-20261002-003',
        board_status: 'done',
        checked_count: 2,
        total_count: 2,
        version: 1,
      },
      {
        number: 'ST-20261002-007',
        board_status: 'done',
        checked_count: 0,
        total_count: 0,
        version: 1,
      },
    ]);
  });

  test('komentar dipecah ke handover_comments dengan created_at dari "at"', async () => {
    const env = await runSql(prepareImport(cleanDump()).sql as string);
    const rows = await env.DB.prepare(
      'SELECT id, handover_id, author, created_at, quote, body, stale FROM handover_comments ORDER BY id',
    ).all();
    expect(rows.results).toEqual([
      {
        id: 'c1',
        handover_id: 'h1',
        author: 'wh@x.id',
        created_at: '2026-10-01T03:00:00.000Z',
        quote: 'Unit A',
        body: 'Cek ulang',
        stale: 0,
      },
      {
        id: 'c2',
        handover_id: 'h1',
        author: 'qc@x.id',
        created_at: '2026-10-02T04:30:00.000Z',
        quote: '',
        body: 'Umum',
        stale: 0,
      },
    ]);
    const handover = await env.DB.prepare("SELECT * FROM handovers WHERE id = 'h1'").first<
      Record<string, unknown>
    >();
    expect(handover && 'comments' in handover).toBe(false);
  });

  test('penghitung: sync_rev dari data tertinggi, nomor ST per tanggal, sync_state apa adanya', async () => {
    const result = prepareImport(cleanDump());
    expect(result.report.counters).toEqual({
      sync_rev: 9,
      'handover:20261001': 2,
      'handover:20261002': 7,
    });
    const env = await runSql(result.sql as string);
    const counters = await env.DB.prepare('SELECT key, value FROM counters ORDER BY key').all();
    expect(counters.results).toEqual([
      { key: 'handover:20261001', value: 2 },
      { key: 'handover:20261002', value: 7 },
      { key: 'sync_rev', value: 9 },
    ]);
    const state = await env.DB.prepare(
      'SELECT resource, seq FROM sync_state ORDER BY resource',
    ).all();
    expect(state.results).toEqual([
      { resource: 'brands', seq: 5 },
      { resource: 'items', seq: 9 },
    ]);
  });

  test('teks dengan kutip tunggal, baris baru, dan JSON tersimpan persis', async () => {
    const env = await runSql(prepareImport(cleanDump()).sql as string);
    const item = await env.DB.prepare(
      "SELECT detail_md, sync_rev, typeof(sync_rev) AS t FROM items WHERE id = 'i1'",
    ).first<{
      detail_md: string;
      sync_rev: number;
      t: string;
    }>();
    expect(item).toEqual({
      detail_md: '# Detail\n\nBaris "dua" dengan \'kutip\'',
      sync_rev: 7,
      t: 'integer',
    });
    const audit = await env.DB.prepare("SELECT after FROM audit_log WHERE target = 'u2'").first<{
      after: string;
    }>();
    expect(audit?.after).toBe('{"nama":"O\'Brien"}');
  });

  test('urutan baris audit_log menjadi urutan id', async () => {
    const env = await runSql(prepareImport(cleanDump()).sql as string);
    const rows = await env.DB.prepare('SELECT id, target FROM audit_log ORDER BY id').all<{
      id: number;
      target: string;
    }>();
    expect(rows.results.map((row) => row.target)).toEqual(['u1', 'u2', 'h1']);
  });

  test('--reset membuat SQL dapat dijalankan dua kali (gladi berulang)', async () => {
    const sql = prepareImport(cleanDump(), { reset: true }).sql as string;
    const env = await createTestEnv();
    await env.DB.exec(sql);
    await env.DB.exec(sql);
    expect(await count(env.DB, 'handovers')).toBe(4);
    expect(await count(env.DB, 'audit_log')).toBe(3);
    expect(await count(env.DB, 'handover_comments')).toBe(2);
    const ids = await env.DB.prepare('SELECT MIN(id) AS m FROM audit_log').first<{ m: number }>();
    expect(ids?.m).toBe(1);
  });

  test('dump boleh dibungkus {tables: ...} (keluaran sheets.dump)', () => {
    const wrapped: DumpInput = { tables: cleanDump() };
    expect(prepareImport(wrapped).report.ok).toBe(true);
  });
});

describe('Review Focus 5: dump kotor menghentikan impor tanpa SQL', () => {
  test('id ganda dalam tabel', () => {
    const dump = cleanDump();
    (dump.brands as unknown[][]).push([...((dump.brands as unknown[][])[1] as unknown[])]);
    const result = prepareImport(dump);
    expect(result.sql).toBeNull();
    expect(result.report.ok).toBe(false);
    expect(result.report.errors).toContainEqual(
      expect.objectContaining({ table: 'brands', row: 4, code: 'DUPLIKAT', column: 'id' }),
    );
  });

  test('email dan nomor ganda juga dihentikan', () => {
    const emailDup = mutate(cleanDump(), 'users', 3, 'email', ' ADMIN@x.id ');
    expect(
      prepareImport(emailDup).report.errors.map((e) => `${e.table}:${e.code}:${e.column}`),
    ).toContain('users:DUPLIKAT:email');
    const numberDup = mutate(cleanDump(), 'handovers', 3, 'number', 'ST-20261001-001');
    expect(
      prepareImport(numberDup).report.errors.map((e) => `${e.table}:${e.code}:${e.column}`),
    ).toContain('handovers:DUPLIKAT:number');
  });

  test('customer_id yatim', () => {
    const result = prepareImport(mutate(cleanDump(), 'handovers', 2, 'customer_id', 'c-hilang'));
    expect(result.sql).toBeNull();
    expect(result.report.errors).toEqual([
      expect.objectContaining({
        table: 'handovers',
        row: 2,
        code: 'RUJUKAN_YATIM',
        column: 'customer_id',
      }),
    ]);
  });

  test('rujukan yatim lain: brand_id, location_id, owner_id, lokasi/peran di users, dokumen/logo QR', () => {
    const cases: Array<[string, number, string, string, string]> = [
      ['items', 2, 'brand_id', 'b-x', 'items:brand_id'],
      ['handovers', 2, 'location_id', 'l-x', 'handovers:location_id'],
      ['handovers', 2, 'location_id', '', 'handovers:location_id'],
      ['files', 2, 'owner_id', 'i-x', 'files:owner_id'],
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
      ['qr_defaults', 2, 'logo_file_ids', '["f-x"]', 'qr_defaults:logo_file_ids'],
      ['qr_presets', 2, 'default_logo_id', 'f-x', 'qr_presets:default_logo_id'],
    ];
    for (const [table, row, column, value, expected] of cases) {
      const result = prepareImport(mutate(cleanDump(), table, row, column, value));
      expect({ expected, sql: result.sql }).toEqual({ expected, sql: null });
      expect(result.report.errors.map((e) => `${e.table}:${e.column}:${e.code}`)).toContain(
        `${expected.split(':')[0]}:${expected.split(':')[1]}:RUJUKAN_YATIM`,
      );
    }
  });

  test('peran lama (role_ids) yatim tanpa assignments', () => {
    let dump = mutate(cleanDump(), 'users', 2, 'assignments', '');
    dump = mutate(dump, 'users', 2, 'role_ids', '["r-hilang"]');
    expect(prepareImport(dump).report.errors.map((e) => e.code)).toContain('RUJUKAN_YATIM');
    const ok = mutate(
      mutate(cleanDump(), 'users', 2, 'assignments', ''),
      'users',
      2,
      'role_ids',
      '["r1"]',
    );
    expect(prepareImport(ok).report.ok).toBe(true);
  });

  test('sync_rev bertulisan "12" menjadi INTEGER 12; " 12 " dan "12.0" dilaporkan', async () => {
    const dump = mutate(cleanDump(), 'brands', 2, 'sync_rev', '12');
    const result = prepareImport(dump);
    expect(result.report.ok).toBe(true);
    const env = await runSql(result.sql as string);
    const row = await env.DB.prepare(
      "SELECT sync_rev, typeof(sync_rev) AS t FROM brands WHERE id = 'b1'",
    ).first();
    expect(row).toEqual({ sync_rev: 12, t: 'integer' });
    expect(result.report.counters.sync_rev).toBe(12);
    expect(result.report.numericText).toBeGreaterThan(0);

    const messy = prepareImport(
      mutate(mutate(cleanDump(), 'brands', 2, 'sync_rev', ' 12 '), 'brands', 3, 'sync_rev', '5.0'),
    );
    expect(messy.report.ok).toBe(true);
    expect(
      messy.report.normalizations.map((n) => `${n.table}:${n.row}:${n.column}:${n.rule}`),
    ).toEqual([
      'brands:2:sync_rev:pangkas-spasi',
      'brands:3:sync_rev:angka-desimal-nol-ke-integer',
    ]);
  });

  test('angka bukan bilangan bulat tak negatif dihentikan', () => {
    for (const bad of ['abc', '-3', '1,5', '1e3', '12.5']) {
      const result = prepareImport(mutate(cleanDump(), 'brands', 2, 'sync_rev', bad));
      expect({ bad, sql: result.sql }).toEqual({ bad, sql: null });
      expect(result.report.errors[0]?.code).toBe('BUKAN_INTEGER');
    }
  });

  test('tanggal 2026/10/5 dinormalkan ke ISO UTC (WIB) dan dilaporkan', async () => {
    const result = prepareImport(mutate(cleanDump(), 'locations', 2, 'created_at', '2026/10/5'));
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
    const env = await runSql(result.sql as string);
    const row = await env.DB.prepare("SELECT created_at FROM locations WHERE id = 'l1'").first<{
      created_at: string;
    }>();
    expect(row?.created_at).toBe('2026-10-04T17:00:00.000Z');
  });

  test('ISO dengan zona dan jam Sheets dinormalkan; tanggal tak terbaca atau ambigu dihentikan', () => {
    const iso = prepareImport(
      mutate(cleanDump(), 'roles', 2, 'created_at', '2026-10-05T10:00:00+07:00'),
    );
    expect(iso.report.normalizations[0]?.to).toBe('2026-10-05T03:00:00.000Z');
    const sheetStyle = prepareImport(
      mutate(cleanDump(), 'roles', 2, 'created_at', '2026-10-05 10:00:00'),
    );
    expect(sheetStyle.report.normalizations[0]?.to).toBe('2026-10-05T03:00:00.000Z');
    for (const bad of ['5/10/2026', 'kemarin', '2026-02-30', '2026-13-01', '45934']) {
      const result = prepareImport(mutate(cleanDump(), 'roles', 2, 'created_at', bad));
      expect({ bad, sql: result.sql }).toEqual({ bad, sql: null });
      expect(result.report.errors[0]).toMatchObject({
        table: 'roles',
        row: 2,
        code: 'TANGGAL_TAK_TERBACA',
        column: 'created_at',
      });
    }
    expect(
      prepareImport(mutate(cleanDump(), 'audit_log', 2, 'ts', '')).report.errors[0]?.code,
    ).toBe('TANGGAL_TAK_TERBACA');
  });

  test('tanggal centang dan komentar di dalam JSON ikut diperiksa', () => {
    const sheet = cleanDump().handovers as unknown[][];
    const header = sheet[0] as string[];
    const bad = mutate(
      cleanDump(),
      'handovers',
      2,
      'checks',
      JSON.stringify([{ text: 'Unit A', by: 'qc', at: 'kemarin', occurrence: 0 }]),
    );
    expect(prepareImport(bad).report.errors[0]).toMatchObject({
      table: 'handovers',
      row: 2,
      code: 'TANGGAL_TAK_TERBACA',
    });
    const fixed = mutate(
      cleanDump(),
      'handovers',
      2,
      'comments',
      JSON.stringify([{ id: 'c1', quote: '', body: 'x', author: 'a', at: '2026/10/3' }]),
    );
    const result = prepareImport(fixed);
    expect(result.report.ok).toBe(true);
    expect(result.report.normalizations.at(-1)).toMatchObject({
      column: 'comments.at',
      to: '2026-10-02T17:00:00.000Z',
    });
    expect(header.length).toBeGreaterThan(0);
  });

  test('id komentar ganda, JSON rusak, dan status di luar nilai menghentikan impor', () => {
    const dup = mutate(
      cleanDump(),
      'handovers',
      3,
      'comments',
      JSON.stringify([
        { id: 'c1', quote: '', body: 'dup', author: 'a', at: '2026-10-03T00:00:00.000Z' },
      ]),
    );
    expect(prepareImport(dup).report.errors[0]?.code).toBe('DUPLIKAT');
    expect(
      prepareImport(mutate(cleanDump(), 'handovers', 2, 'checks', '{rusak')).report.errors[0]?.code,
    ).toBe('JSON_TAK_VALID');
    expect(
      prepareImport(mutate(cleanDump(), 'handovers', 2, 'comments', '{"a":1}')).report.errors[0]
        ?.code,
    ).toBe('JSON_TAK_VALID');
    expect(
      prepareImport(mutate(cleanDump(), 'handovers', 2, 'status', 'selesai')).report.errors[0]
        ?.code,
    ).toBe('NILAI_TAK_VALID');
    expect(
      prepareImport(mutate(cleanDump(), 'files', 2, 'owner_type', 'aneh')).report.errors[0]?.code,
    ).toBe('NILAI_TAK_VALID');
    expect(
      prepareImport(mutate(cleanDump(), 'users', 2, 'assignments', '{rusak')).report.errors[0]
        ?.code,
    ).toBe('JSON_TAK_VALID');
  });

  test('semua galat dilaporkan sekaligus per baris, bukan berhenti di yang pertama', () => {
    let dump = mutate(cleanDump(), 'handovers', 2, 'customer_id', 'c-x');
    dump = mutate(dump, 'brands', 2, 'sync_rev', 'abc');
    dump = mutate(dump, 'locations', 3, 'updated_at', 'kemarin');
    const codes = prepareImport(dump).report.errors.map((e) => `${e.table}:${e.row}:${e.code}`);
    expect(codes.sort()).toEqual([
      'brands:2:BUKAN_INTEGER',
      'handovers:2:RUJUKAN_YATIM',
      'locations:3:TANGGAL_TAK_TERBACA',
    ]);
  });
});

describe('penyaringan baris', () => {
  test('baris kosong dilewati, id kosong dikecualikan dengan laporan', () => {
    const dump = cleanDump();
    (dump.customers as unknown[][]).push(['', '', '', '', '', '', '']);
    (dump.customers as unknown[][]).push(['', 'Tanpa Id', 'tanpa id', 'active', '', '', '']);
    const result = prepareImport(dump);
    expect(result.report.ok).toBe(true);
    expect(result.report.tables.customers).toMatchObject({
      sheetRows: 3,
      blank: 1,
      excluded: 1,
      imported: 1,
    });
    expect(result.report.excluded).toContainEqual(
      expect.objectContaining({ table: 'customers', row: 4, code: 'ID_KOSONG' }),
    );
  });

  test('keputusan pemilik: --exclude baris duplikat menyelesaikan impor', () => {
    const dump = cleanDump();
    (dump.brands as unknown[][]).push([...((dump.brands as unknown[][])[1] as unknown[])]);
    expect(prepareImport(dump).report.ok).toBe(false);
    const result = prepareImport(dump, { exclude: [{ table: 'brands', row: 4 }] });
    expect(result.report.ok).toBe(true);
    expect(result.report.tables.brands).toMatchObject({ imported: 2, excluded: 1 });
    expect(result.report.excluded).toContainEqual(
      expect.objectContaining({ code: 'DIKECUALIKAN_PEMILIK' }),
    );
  });

  test('komentar/centang yang rusak diabaikan seperti aplikasi lama dan dilaporkan', () => {
    const dump = mutate(
      cleanDump(),
      'handovers',
      2,
      'comments',
      JSON.stringify([
        { id: 'ok', quote: '', body: 'a', author: 'a', at: '' },
        { quote: 'tanpa id' },
        5,
      ]),
    );
    const result = prepareImport(dump);
    expect(result.report.ok).toBe(true);
    expect(result.report.handoverComments).toBe(1);
    expect(result.report.excluded.filter((e) => e.code === 'KOMENTAR_TAK_VALID')).toHaveLength(2);
  });

  test('sheet tak ada atau kolom hilang: peringatan, bukan galat; teks bebas tidak dipangkas', () => {
    const dump = cleanDump();
    delete dump.qr_presets;
    dump.customers = [
      ['id', 'name'],
      ['c1', '  CV Abadi  '],
    ];
    const result = prepareImport(dump);
    expect(result.report.ok).toBe(true);
    expect(result.sql).toContain("'  CV Abadi  '");
    const codes = result.report.warnings.map((w) => w.code);
    expect(codes).toContain('SHEET_KOSONG');
    expect(codes).toContain('KOLOM_HILANG');
  });

  test('statement terlalu besar (> 100 KB) dihentikan', () => {
    const result = prepareImport(mutate(cleanDump(), 'items', 2, 'detail_md', 'x'.repeat(100_500)));
    expect(result.sql).toBeNull();
    expect(result.report.errors[0]?.code).toBe('PERNYATAAN_TERLALU_BESAR');
  });
});

describe('skema', () => {
  test('kolom pemetaan sama dengan skema D1: semua kolom ada dan kolom wajib tercakup', async () => {
    const env = await createTestEnv();
    for (const def of TABLES) {
      const info = await env.DB.prepare(`PRAGMA table_info("${def.name}")`).all<{
        name: string;
        notnull: number;
        dflt_value: unknown;
        pk: number;
      }>();
      const d1Columns = new Set(info.results.map((column) => column.name));
      const written = new Set([
        ...def.columns.map((column) => column.name).filter((name) => name !== 'comments'),
        ...def.derivedColumns,
      ]);
      for (const name of written)
        expect({ table: def.name, name, exists: d1Columns.has(name) }).toEqual({
          table: def.name,
          name,
          exists: true,
        });
      for (const column of info.results) {
        const required =
          column.notnull === 1 &&
          column.dflt_value === null &&
          !(column.pk === 1 && column.name === 'id' && def.idColumn === null);
        if (required)
          expect({
            table: def.name,
            column: column.name,
            written: written.has(column.name),
          }).toEqual({ table: def.name, column: column.name, written: true });
      }
    }
    expect([...INSERT_ORDER].map(String).sort()).toEqual(
      [...SHEET_TABLES, 'handover_comments', 'counters'].sort(),
    );
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

  test('dump bersih: import.sql dan report.json ditulis, kode 0', async () => {
    await withDir(async (dir) => {
      await writeFile(path.join(dir, 'dump.json'), JSON.stringify({ tables: cleanDump() }));
      const code = await runImportCli([
        '--dump',
        path.join(dir, 'dump.json'),
        '--out',
        path.join(dir, 'import.sql'),
        '--report',
        path.join(dir, 'report.json'),
      ]);
      expect(code).toBe(0);
      expect(await exists(path.join(dir, 'import.sql'))).toBe(true);
      const report = JSON.parse(await readFile(path.join(dir, 'report.json'), 'utf8'));
      expect(report.ok).toBe(true);
    });
  });

  test('dump kotor: kode 1, report.json ditulis, import.sql TIDAK ada (termasuk sisa proses lama)', async () => {
    await withDir(async (dir) => {
      const out = path.join(dir, 'import.sql');
      await writeFile(out, '-- sisa lama');
      await writeFile(
        path.join(dir, 'dump.json'),
        JSON.stringify(mutate(cleanDump(), 'handovers', 2, 'customer_id', 'c-x')),
      );
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
      expect(report.errors[0].code).toBe('RUJUKAN_YATIM');
    });
  });

  test('argumen kurang: kode 2', async () => {
    expect(await runImportCli([])).toBe(2);
  });

  test('--exclude dibaca dari berkas', async () => {
    await withDir(async (dir) => {
      const dump = cleanDump();
      (dump.brands as unknown[][]).push([...((dump.brands as unknown[][])[1] as unknown[])]);
      await writeFile(path.join(dir, 'dump.json'), JSON.stringify(dump));
      await writeFile(path.join(dir, 'ex.json'), JSON.stringify([{ table: 'brands', row: 4 }]));
      const code = await runImportCli([
        '--dump',
        path.join(dir, 'dump.json'),
        '--out',
        path.join(dir, 'i.sql'),
        '--report',
        path.join(dir, 'r.json'),
        '--exclude',
        path.join(dir, 'ex.json'),
      ]);
      expect(code).toBe(0);
    });
  });
});

test('grid membangun header dari skema Sheets', () => {
  expect((grid('sync_state', [{ resource: 'items', seq: '1' }])[0] as string[]).join(',')).toBe(
    'resource,seq,updated_at',
  );
});

describe('alias_keys dan keunikan indeks UNIK (migrasi 0004/0005/0007)', () => {
  test('alias_keys dihitung dari aliases dan identik dengan aliasKeysOf Worker', async () => {
    const { aliasKeysOf: workerAliasKeys } = await import('@server/modules/item/repo');
    const { aliasKeysOf } = await import('./alias-keys');
    for (const aliases of [[], ['MX'], ['MX', 'Model Ex', 'mx', '  '], ['A/B', 'a b'], ['!!!']]) {
      expect(aliasKeysOf(aliases)).toBe(workerAliasKeys(aliases));
    }
    const result = prepareImport(cleanDump());
    const env = await runSql(result.sql as string);
    const row = await env.DB.prepare("SELECT alias_keys FROM items WHERE id = 'i1'").first<{
      alias_keys: string;
    }>();
    expect(row?.alias_keys).toBe('|mx|model ex|');
  });

  test('item_alias_keys diisi satu baris per kunci dan brands.item_count dihitung (migrasi 0009)', async () => {
    const result = prepareImport(cleanDump());
    expect(result.sql).toContain('INSERT INTO item_alias_keys');
    const env = await runSql(result.sql as string);
    const aliases = await env.DB.prepare(
      'SELECT key, item_id FROM item_alias_keys ORDER BY key',
    ).all<{
      key: string;
      item_id: string;
    }>();
    expect(aliases.results).toEqual([
      { key: 'model ex', item_id: 'i1' },
      { key: 'mx', item_id: 'i1' },
    ]);
    const counts = await env.DB.prepare(
      'SELECT b.id, b.item_count, (SELECT COUNT(*) FROM items i WHERE i.brand_id = b.id) AS n FROM brands b',
    ).all<{ id: string; item_count: number; n: number }>();
    expect(counts.results.length).toBeGreaterThan(0);
    for (const row of counts.results) expect(row.item_count).toBe(row.n);
    expect(counts.results.some((row) => row.item_count > 0)).toBe(true);
  });

  test('kunci nama lain yang sama pada dua item dihentikan (ALIAS_GANDA)', () => {
    let dump = cleanDump();
    (dump.items as unknown[][]).push([...((dump.items as unknown[][])[1] as unknown[])]);
    dump = mutate(dump, 'items', 3, 'id', 'i9');
    dump = mutate(dump, 'items', 3, 'model', 'Lain');
    dump = mutate(dump, 'items', 3, 'key', 'acme lain');
    const result = prepareImport(dump);
    expect(result.sql).toBeNull();
    expect(result.report.errors.some((e) => e.code === 'ALIAS_GANDA')).toBe(true);
  });

  test('item tanpa alias -> alias_keys kosong; aliases JSON rusak dihentikan', () => {
    const none = prepareImport(mutate(cleanDump(), 'items', 2, 'aliases', '[]'));
    expect(none.rows.items?.[0]?.values.alias_keys).toBe('');
    const bad = prepareImport(mutate(cleanDump(), 'items', 2, 'aliases', '{rusak'));
    expect(bad.sql).toBeNull();
    expect(bad.report.errors[0]).toMatchObject({
      table: 'items',
      code: 'JSON_TAK_VALID',
      column: 'aliases',
    });
  });

  test('kunci item/merk/customer ganda (tanpa beda huruf), nama peran dan kode/nama lokasi ganda dihentikan', () => {
    const cases: Array<[string, number, string, string]> = [
      ['brands', 3, 'key', 'ACME'],
      ['customers', 2, 'key', 'cv abadi'],
      ['roles', 2, 'name', 'x'],
      ['locations', 3, 'code', 'A'],
      ['locations', 3, 'name', 'gudang a'],
    ];
    for (const [table, row, column, value] of cases) {
      let dump = cleanDump();
      if (table === 'customers') {
        (dump.customers as unknown[][]).push(['c2', 'CV Lain', 'x', 'active', '', '', '']);
        dump = mutate(dump, 'customers', 3, 'key', 'CV ABADI');
      } else if (table === 'roles') {
        (dump.roles as unknown[][]).push(['r2', ' ADMIN ', '', '{}', '', '', '']);
      } else {
        dump = mutate(dump, table, row, column, value);
      }
      const result = prepareImport(dump);
      expect({ table, column, sql: result.sql }).toEqual({ table, column, sql: null });
      expect(result.report.errors.some((e) => e.table === table && e.code === 'DUPLIKAT')).toBe(
        true,
      );
    }
    const items = cleanDump();
    (items.items as unknown[][]).push([...((items.items as unknown[][])[1] as unknown[])]);
    (items.items as unknown[][])[2]![0] = 'i2';
    (items.items as unknown[][])[2]![4] = 'MODEL X';
    expect(
      prepareImport(items).report.errors.some((e) => e.table === 'items' && e.column === 'key'),
    ).toBe(true);
  });
});
