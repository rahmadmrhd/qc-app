import { describe, expect, test } from 'bun:test';
import { createSqliteD1 } from '@worker-test/sqlite-d1';
import { applyMigrations, MIGRATIONS } from './migrate';

/** Kolom per tabel = TableSchema Sheets (gas/src/modules/*), disesuaikan Spek 7. */
const SHEET_COLUMNS: Record<string, string[]> = {
  users: [
    'id',
    'email',
    'name',
    'status',
    'role_ids',
    'created_at',
    'updated_at',
    'updated_by',
    'assignments',
  ],
  roles: ['id', 'name', 'description', 'permissions', 'created_at', 'updated_at', 'updated_by'],
  locations: ['id', 'code', 'name', 'status', 'created_at', 'updated_at', 'updated_by'],
  audit_log: ['id', 'ts', 'actor', 'action', 'target', 'before', 'after'],
  brands: [
    'id',
    'external_id',
    'name',
    'key',
    'status',
    'sync_rev',
    'created_at',
    'updated_at',
    'updated_by',
  ],
  customers: ['id', 'name', 'key', 'status', 'created_at', 'updated_at', 'updated_by'],
  files: [
    'id',
    'drive_id',
    'mime',
    'size',
    'width',
    'height',
    'owner_type',
    'owner_id',
    'created_at',
    'created_by',
    'status',
  ],
  handovers: [
    'id',
    'number',
    'location_id',
    'customer_id',
    'customer_name',
    'note',
    'status',
    'checks',
    'completed_at',
    'completed_by',
    'created_at',
    'created_by',
    'updated_at',
    'updated_by',
    'version',
    'checked_count',
    'total_count',
    'board_status',
  ],
  items: [
    'id',
    'external_id',
    'brand_id',
    'model',
    'key',
    'is_country_lock',
    'aliases',
    'stickers',
    'accessories',
    'attachments',
    'detail_md',
    'status',
    'sync_rev',
    'created_at',
    'updated_at',
    'updated_by',
  ],
  qr_designs: [
    'id',
    'title',
    'link_source',
    'link',
    'document_id',
    'subtitle',
    'footer',
    'logo_file_id',
    'layout',
    'style',
    'overflow',
    'exported_hash',
    'exported_at',
    'exported_by',
    'export_pdf_drive_id',
    'export_png_drive_id',
    'created_at',
    'created_by',
    'updated_at',
    'updated_by',
  ],
  qr_documents: [
    'id',
    'drive_id',
    'name',
    'size',
    'shared',
    'created_at',
    'created_by',
    'updated_at',
    'updated_by',
  ],
  qr_defaults: [
    'id',
    'title',
    'subtitle',
    'footer',
    'layout',
    'style',
    'logo_file_ids',
    'default_logo_id',
    'updated_at',
    'updated_by',
  ],
  qr_presets: [
    'id',
    'name',
    'title',
    'subtitle',
    'footer',
    'layout',
    'style',
    'default_logo_id',
    'created_at',
    'created_by',
    'updated_at',
    'updated_by',
  ],
  sync_state: ['resource', 'seq', 'updated_at'],
  handover_comments: [
    'id',
    'handover_id',
    'author',
    'created_at',
    'quote',
    'before',
    'after',
    'body',
    'stale',
  ],
  jobs: [
    'id',
    'kind',
    'status',
    'progress',
    'result',
    'error',
    'created_by',
    'created_at',
    'updated_at',
  ],
  counters: ['key', 'value'],
  rate_limits: ['key', 'count', 'window_start'],
};

async function migrated() {
  const db = createSqliteD1();
  await applyMigrations(db);
  return db;
}

async function planOf(db: D1Database, sql: string, ...params: unknown[]): Promise<string[]> {
  const res = await db
    .prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .bind(...params)
    .all<{ detail: string }>();
  return res.results.map((row) => row.detail);
}

/** Tidak ada pemindaian tabel penuh: tiap langkah memakai SEARCH atau indeks. */
function expectIndexed(plan: string[]) {
  for (const step of plan) {
    expect(step).toMatch(/SEARCH|USING (COVERING )?INDEX|USE TEMP B-TREE|SCALAR SUBQUERY/);
    expect(step).not.toMatch(/^SCAN (?!.*USING)/);
  }
}

describe('skema D1', () => {
  test('semua tabel dan kolom ada sesuai daftar', async () => {
    const db = await migrated();
    for (const [table, columns] of Object.entries(SHEET_COLUMNS)) {
      const info = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
      expect(info.results.map((c) => c.name).sort()).toEqual([...columns].sort());
    }
  });

  test('kolom comments Sheets tidak ada di handovers (dipindah ke handover_comments)', async () => {
    const db = await migrated();
    const info = await db.prepare('PRAGMA table_info(handovers)').all<{ name: string }>();
    expect(info.results.map((c) => c.name)).not.toContain('comments');
  });

  test('kolom angka bertipe INTEGER', async () => {
    const db = await migrated();
    const integers: Record<string, string[]> = {
      brands: ['sync_rev'],
      items: ['sync_rev'],
      handovers: ['version', 'checked_count', 'total_count'],
      files: ['size', 'width', 'height'],
      qr_documents: ['size'],
      sync_state: ['seq'],
    };
    for (const [table, columns] of Object.entries(integers)) {
      const info = await db
        .prepare(`PRAGMA table_info(${table})`)
        .all<{ name: string; type: string }>();
      for (const column of columns) {
        expect(info.results.find((c) => c.name === column)?.type).toBe('INTEGER');
      }
    }
  });
});

describe('indeks (EXPLAIN QUERY PLAN)', () => {
  test('board handovers per lokasi + status, urut updated_at', async () => {
    const db = await migrated();
    const plan = await planOf(
      db,
      'SELECT * FROM handovers WHERE location_id IN (?, ?) AND board_status = ? ORDER BY updated_at DESC LIMIT 21',
      'a',
      'b',
      'new',
    );
    expect(plan.join('\n')).toMatch(/SEARCH handovers USING INDEX handovers_board/);
    expectIndexed(plan);
    const single = await planOf(
      db,
      'SELECT * FROM handovers WHERE location_id = ? AND board_status = ? ORDER BY updated_at DESC LIMIT 21',
      'a',
      'new',
    );
    expect(single.join('\n')).not.toMatch(/TEMP B-TREE/);
  });

  test('audit_log per ts (halaman berkursor) dan per target', async () => {
    const db = await migrated();
    const page = await planOf(db, 'SELECT * FROM audit_log ORDER BY ts DESC, id DESC LIMIT 51');
    expect(page.join('\n')).toMatch(/audit_log_ts/);
    expect(page.join('\n')).not.toMatch(/TEMP B-TREE/);
    const cursor = await planOf(
      db,
      'SELECT * FROM audit_log WHERE ts < ? OR (ts = ? AND id < ?) ORDER BY ts DESC, id DESC LIMIT 51',
      'x',
      'x',
      1,
    );
    expectIndexed(cursor);
    const byTarget = await planOf(
      db,
      'SELECT * FROM audit_log WHERE target = ? ORDER BY ts DESC LIMIT 51',
      'user:1',
    );
    expect(byTarget.join('\n')).toMatch(/audit_log_target_ts/);
    expect(byTarget.join('\n')).not.toMatch(/TEMP B-TREE/);
  });

  test('items: kunci (sama dan awalan LIKE), status+updated_at, brand, sync_rev', async () => {
    const db = await migrated();
    expect((await planOf(db, 'SELECT * FROM items WHERE key = ?', 'a')).join()).toMatch(
      /items_key/,
    );
    expect((await planOf(db, 'SELECT * FROM items WHERE key LIKE ?', 'abc%')).join()).toMatch(
      /SEARCH items USING INDEX items_key/,
    );
    expect(
      (
        await planOf(
          db,
          'SELECT * FROM items WHERE status = ? ORDER BY updated_at DESC LIMIT 21',
          'active',
        )
      ).join(),
    ).toMatch(/items_status_updated/);
    expect((await planOf(db, 'SELECT * FROM items WHERE brand_id = ?', 'b')).join()).toMatch(
      /items_brand/,
    );
    expect(
      (
        await planOf(db, 'SELECT * FROM items WHERE sync_rev > ? ORDER BY sync_rev LIMIT 100', 1)
      ).join(),
    ).toMatch(/items_sync_rev/);
    expect((await planOf(db, 'SELECT * FROM items WHERE external_id = ?', '1')).join()).toMatch(
      /items_external_id/,
    );
  });

  test('brands, customers, users, files, komentar, QR', async () => {
    const db = await migrated();
    const cases: [string, unknown[], RegExp][] = [
      ['SELECT * FROM brands WHERE key = ?', ['a'], /brands_key/],
      ['SELECT * FROM brands WHERE sync_rev > ? ORDER BY sync_rev', [0], /brands_sync_rev/],
      ['SELECT * FROM brands WHERE external_id = ?', ['1'], /brands_external_id/],
      ['SELECT * FROM customers WHERE key LIKE ?', ['ab%'], /customers_key/],
      ['SELECT * FROM users WHERE email = ?', ['a@b.c'], /users_email/],
      ['SELECT * FROM files WHERE owner_type = ? AND owner_id = ?', ['item', '1'], /files_owner/],
      ["SELECT * FROM files WHERE status = 'pending_delete'", [], /files_pending_delete/],
      ['SELECT * FROM handovers WHERE number = ?', ['ST-1'], /handovers_number/],
      ['SELECT * FROM handovers WHERE customer_id = ?', ['c'], /handovers_customer/],
      [
        'SELECT * FROM handover_comments WHERE handover_id = ? ORDER BY created_at',
        ['h'],
        /handover_comments_handover/,
      ],
      ['SELECT * FROM qr_designs WHERE document_id = ?', ['d'], /qr_designs_document/],
      [
        'SELECT * FROM jobs WHERE status = ? ORDER BY updated_at',
        ['queued'],
        /jobs_status_updated/,
      ],
    ];
    for (const [sql, params, expected] of cases) {
      const plan = await planOf(db, sql, ...params);
      expect(plan.join('\n'), sql).toMatch(expected);
      expectIndexed(plan);
    }
  });

  test('kunci primer tabel penghitung dan pembatas tercari tanpa pemindaian', async () => {
    const db = await migrated();
    expectIndexed(await planOf(db, 'SELECT value FROM counters WHERE key = ?', 'k'));
    expectIndexed(await planOf(db, 'SELECT count FROM rate_limits WHERE key = ?', 'k'));
    expectIndexed(await planOf(db, 'SELECT seq FROM sync_state WHERE resource = ?', 'items'));
  });
});

describe('batasan', () => {
  test('handovers.number unik menolak duplikat', async () => {
    const db = await migrated();
    const insert = (id: string) =>
      db
        .prepare('INSERT INTO handovers (id, number) VALUES (?, ?)')
        .bind(id, 'ST-20261025-001')
        .run();
    await insert('a');
    await expect(insert('b')).rejects.toThrow(/UNIQUE/);
  });

  test('users.email unik', async () => {
    const db = await migrated();
    const insert = (id: string) =>
      db.prepare('INSERT INTO users (id, email) VALUES (?, ?)').bind(id, 'a@b.c').run();
    await insert('1');
    await expect(insert('2')).rejects.toThrow(/UNIQUE/);
  });

  test('status handover dan file dibatasi CHECK', async () => {
    const db = await migrated();
    await expect(
      db.prepare("INSERT INTO handovers (id, number, status) VALUES ('x', 'n', 'weird')").run(),
    ).rejects.toThrow(/CHECK/);
    await expect(
      db.prepare("INSERT INTO files (id, status) VALUES ('x', 'weird')").run(),
    ).rejects.toThrow(/CHECK/);
  });

  test('komentar menolak handover yang tidak ada (foreign key)', async () => {
    const db = await migrated();
    await expect(
      db.prepare("INSERT INTO handover_comments (id, handover_id) VALUES ('c', 'none')").run(),
    ).rejects.toThrow(/FOREIGN KEY/);
  });

  test('kolom before/after dapat dipakai tanpa kutip dan lewat RETURNING', async () => {
    const db = await migrated();
    const row = await db
      .prepare(
        "INSERT INTO audit_log (ts, actor, action, target, before, after) VALUES ('t', 'a', 'x', 'y', '{}', '{\"a\":1}') RETURNING id, before, after",
      )
      .first<{ id: number; before: string; after: string }>();
    expect(row).toEqual({ id: 1, before: '{}', after: '{"a":1}' });
  });
});

describe('applyMigrations', () => {
  test('idempoten dan mencatat versi', async () => {
    const db = createSqliteD1();
    await applyMigrations(db);
    await applyMigrations(db);
    const rows = await db.prepare('SELECT name FROM d1_migrations ORDER BY id').all<{
      name: string;
    }>();
    expect(rows.results.map((r) => r.name)).toEqual([
      '0001_init.sql',
      '0002_handover_comments_jobs.sql',
      '0003_handover_board_status.sql',
    ]);
  });

  test('migrasi yang gagal tidak meninggalkan sisa dan tidak dicatat', async () => {
    const db = createSqliteD1();
    await applyMigrations(db, [{ name: '0001_ok.sql', sql: 'CREATE TABLE a (id TEXT);' }]);
    await expect(
      applyMigrations(db, [
        { name: '0001_ok.sql', sql: 'CREATE TABLE a (id TEXT);' },
        { name: '0002_bad.sql', sql: 'CREATE TABLE b (id TEXT);\nCREATE TABLE a (id TEXT);' },
      ]),
    ).rejects.toThrow();
    const names = await db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'b'")
      .all();
    expect(names.results).toHaveLength(0);
    const rows = await db.prepare('SELECT name FROM d1_migrations').all();
    expect(rows.results).toHaveLength(1);
  });
});

describe('0003 board_status', () => {
  test('migrasi mengisi ulang baris lama sesuai deriveHandoverStatus', async () => {
    const db = createSqliteD1();
    await applyMigrations(db, MIGRATIONS.slice(0, 2));
    const rows: [string, string, string, number, number, string][] = [
      ['a', 'ST-1', 'open', 0, 0, ''],
      ['b', 'ST-2', 'open', 1, 3, ''],
      ['c', 'ST-3', 'open', 3, 3, ''],
      ['d', 'ST-4', 'open', 0, 0, '2026-01-01T00:00:00.000Z'],
      ['e', 'ST-5', 'cancelled', 3, 3, ''],
    ];
    for (const [id, number, status, checked, total, completedAt] of rows) {
      await db
        .prepare(
          'INSERT INTO handovers (id, number, status, checked_count, total_count, completed_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .bind(id, number, status, checked, total, completedAt)
        .run();
    }
    await applyMigrations(db);
    const out = await db
      .prepare('SELECT id, board_status FROM handovers ORDER BY id')
      .all<{ id: string; board_status: string }>();
    expect(out.results.map((r) => r.board_status)).toEqual([
      'new',
      'in_progress',
      'done',
      'done',
      'cancelled',
    ]);
  });

  test('board_status dibatasi CHECK', async () => {
    const db = await migrated();
    await expect(
      db
        .prepare("INSERT INTO handovers (id, number, board_status) VALUES ('x', 'n', 'open')")
        .run(),
    ).rejects.toThrow(/CHECK/);
  });
});
