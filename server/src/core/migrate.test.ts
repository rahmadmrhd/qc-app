// Tes migrator dan skema baseline MariaDB terhadap database nyata di VPS (butuh `bun run db:tunnel`).
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createDb, type Db, DbError } from '@server/core/db';
import { applyMigrations, loadMigrations } from '@server/core/migrate';
import { testDbUrl } from '@server-test/db-env';

const URL_NO_DB = testDbUrl();
const newSchemaName = () => `qc_test_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;

const EXPECTED_TABLES = [
  'audit_log',
  'brands',
  'counters',
  'customers',
  'files',
  'handover_comments',
  'handovers',
  'item_alias_keys',
  'items',
  'job_blobs',
  'jobs',
  'locations',
  'qr_defaults',
  'qr_designs',
  'qr_documents',
  'qr_presets',
  'rate_limits',
  'roles',
  'schema_migrations',
  'settings',
  'sync_state',
  'users',
];

let admin: Db;
const schemas: string[] = [];

async function freshDb(): Promise<Db> {
  const name = newSchemaName();
  schemas.push(name);
  await admin.exec(`CREATE DATABASE \`${name}\``);
  return createDb({ url: URL_NO_DB, database: name, connectionLimit: 3 });
}

async function tableNames(db: Db): Promise<string[]> {
  const res = await db
    .prepare(
      "SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE' ORDER BY table_name",
    )
    .all<{ t: string }>();
  return res.results.map((r) => r.t).sort();
}

beforeAll(() => {
  admin = createDb({ url: URL_NO_DB, connectionLimit: 2 });
});

afterAll(async () => {
  for (const name of schemas) await admin.exec(`DROP DATABASE IF EXISTS \`${name}\``);
  await admin.close();
}, 60_000);

describe('loadMigrations', () => {
  test('membaca berkas *.sql bernomor di server/migrations/mariadb, urut nama', async () => {
    const list = await loadMigrations();
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list[0]?.name).toBe('0001_baseline.sql');
    expect(list.map((m) => m.name)).toEqual([...list.map((m) => m.name)].sort());
    expect(list[0]?.sql).toContain('CREATE TABLE');
  });
});

describe('applyMigrations (migrator)', () => {
  test('menerapkan berurutan, mencatat, dan melewati yang sudah tercatat', async () => {
    const db = await freshDb();
    try {
      const migs = [
        { name: '0001_a.sql', sql: 'CREATE TABLE a (id INT PRIMARY KEY);' },
        {
          name: '0002_b.sql',
          sql: 'CREATE TABLE b (id INT PRIMARY KEY); INSERT INTO b VALUES (1);',
        },
      ];
      expect(await applyMigrations(db, migs)).toEqual(['0001_a.sql', '0002_b.sql']);
      expect(await applyMigrations(db, migs)).toEqual([]);
      const rows = await db
        .prepare('SELECT name FROM schema_migrations ORDER BY name')
        .all<{ name: string }>();
      expect(rows.results.map((r) => r.name)).toEqual(['0001_a.sql', '0002_b.sql']);
      const more = [...migs, { name: '0003_c.sql', sql: 'CREATE TABLE c (id INT PRIMARY KEY);' }];
      expect(await applyMigrations(db, more)).toEqual(['0003_c.sql']);
    } finally {
      await db.close();
    }
  }, 60_000);

  test('migrasi gagal tidak dicatat dan melempar galat', async () => {
    const db = await freshDb();
    try {
      await applyMigrations(db, [
        { name: '0001_ok.sql', sql: 'CREATE TABLE ok (id INT PRIMARY KEY);' },
      ]);
      const bad = applyMigrations(db, [
        { name: '0001_ok.sql', sql: 'CREATE TABLE ok (id INT PRIMARY KEY);' },
        { name: '0002_bad.sql', sql: 'CREATE TABLE bad (id INT PRIMARY KEY); SELEKT salah;' },
      ]);
      await expect(bad).rejects.toBeInstanceOf(DbError);
      const rows = await db.prepare('SELECT name FROM schema_migrations').all<{ name: string }>();
      expect(rows.results.map((r) => r.name)).toEqual(['0001_ok.sql']);
    } finally {
      await db.close();
    }
  }, 60_000);
});

describe('skema baseline', () => {
  let db: Db;
  beforeAll(async () => {
    db = await freshDb();
    await applyMigrations(db);
  }, 60_000);
  afterAll(async () => {
    await db.close();
  });

  test('21 tabel aplikasi + schema_migrations; terapan dua kali tak mengubah apa pun', async () => {
    const before = await tableNames(db);
    expect(before).toEqual(EXPECTED_TABLES);
    expect(await applyMigrations(db)).toEqual([]);
    expect(await tableNames(db)).toEqual(before);
    const rows = await db.prepare('SELECT name FROM schema_migrations').all<{ name: string }>();
    expect(rows.results).toEqual([{ name: '0001_baseline.sql' }]);
  });

  test('semua tabel memakai InnoDB dan utf8mb4_nopad_bin', async () => {
    const res = await db
      .prepare(
        "SELECT table_name AS t, engine AS e, table_collation AS c FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'",
      )
      .all<{ t: string; e: string; c: string }>();
    for (const r of res.results) {
      expect([r.t, r.e, r.c]).toEqual([r.t, 'InnoDB', 'utf8mb4_nopad_bin']);
    }
  });

  test('semua indeks SQLite diterjemahkan (nama indeks per tabel)', async () => {
    const res = await db
      .prepare(
        'SELECT table_name AS t, index_name AS i FROM information_schema.statistics WHERE table_schema = DATABASE() GROUP BY table_name, index_name ORDER BY table_name, index_name',
      )
      .all<{ t: string; i: string }>();
    const got = res.results
      .map((r) => `${r.t}.${r.i}`)
      .filter((s) => !s.endsWith('.PRIMARY'))
      .sort();
    expect(got).toEqual(
      [
        'audit_log.audit_log_target_ts',
        'audit_log.audit_log_ts',
        'brands.brands_external_id',
        'brands.brands_key',
        'brands.brands_sync_rev',
        'customers.customers_key',
        'files.files_owner',
        'files.files_pending_delete',
        'handover_comments.handover_comments_handover',
        'handovers.handovers_board',
        'handovers.handovers_customer',
        'handovers.handovers_number',
        'items.items_brand',
        'items.items_external_id',
        'items.items_key',
        'items.items_status_updated',
        'items.items_sync_rev',
        'jobs.jobs_status_updated',
        'locations.locations_code_unique',
        'locations.locations_name_unique',
        'qr_designs.qr_designs_document',
        'roles.roles_name_unique',
        'users.users_email',
      ].sort(),
    );
    const pk = await db
      .prepare(
        "SELECT table_name AS t, GROUP_CONCAT(column_name ORDER BY seq_in_index) AS c FROM information_schema.statistics WHERE table_schema = DATABASE() AND index_name = 'PRIMARY' GROUP BY table_name ORDER BY table_name",
      )
      .all<{ t: string; c: string }>();
    const pks = Object.fromEntries(pk.results.map((r) => [r.t, r.c]));
    expect(pks.item_alias_keys).toBe('key');
    expect(pks.job_blobs).toBe('job_id,name');
    expect(pks.audit_log).toBe('id');
    expect(pks.handover_comments).toBe('id');
    expect(pks.counters).toBe('key');
    expect(pks.settings).toBe('key');
    expect(pks.sync_state).toBe('resource');
  });

  const UNIQUE_KEY_CASES: { table: string; insert: string; label: string }[] = [
    {
      table: 'brands',
      insert: 'INSERT INTO brands (id, `key`) VALUES (?, ?)',
      label: 'brands.key',
    },
    {
      table: 'customers',
      insert: 'INSERT INTO customers (id, `key`) VALUES (?, ?)',
      label: 'customers.key',
    },
    { table: 'items', insert: 'INSERT INTO items (id, `key`) VALUES (?, ?)', label: 'items.key' },
    {
      table: 'item_alias_keys',
      insert: 'INSERT INTO item_alias_keys (item_id, `key`) VALUES (?, ?)',
      label: 'item_alias_keys.key',
    },
    {
      table: 'handovers',
      insert: 'INSERT INTO handovers (id, number) VALUES (?, ?)',
      label: 'handovers.number',
    },
    { table: 'users', insert: 'INSERT INTO users (id, email) VALUES (?, ?)', label: 'users.email' },
  ];

  for (const c of UNIQUE_KEY_CASES) {
    test(`${c.label}: perbandingan byte persis (sony, "sony ", Sony, soné hidup berdampingan)`, async () => {
      const values = ['sony', 'sony ', 'Sony', 'soné'];
      for (const [i, v] of values.entries()) {
        await db.prepare(c.insert).bind(`${c.table}-${i}`, v).run();
      }
      const n = await db.prepare(`SELECT COUNT(*) AS n FROM ${c.table}`).first<{ n: number }>();
      expect(Number(n?.n)).toBe(4);
      const err = await db
        .prepare(c.insert)
        .bind(`${c.table}-dup`, 'sony')
        .run()
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(DbError);
      expect((err as DbError).kind).toBe('duplicate');
    });
  }

  test('roles.name dan locations: keunikan lower/trim seperti indeks ekspresi SQLite', async () => {
    await db.prepare('INSERT INTO roles (id, name) VALUES (?, ?)').bind('r1', 'Admin').run();
    const dup = await db
      .prepare('INSERT INTO roles (id, name) VALUES (?, ?)')
      .bind('r2', ' ADMIN ')
      .run()
      .catch((e: unknown) => e);
    expect((dup as DbError).kind).toBe('duplicate');
    expect((dup as DbError).key).toBe('roles_name_unique');

    await db
      .prepare('INSERT INTO locations (id, code, name) VALUES (?, ?, ?)')
      .bind('l1', 'JKT', 'Jakarta')
      .run();
    const dupCode = await db
      .prepare('INSERT INTO locations (id, code, name) VALUES (?, ?, ?)')
      .bind('l2', 'JKT', 'Lain')
      .run()
      .catch((e: unknown) => e);
    expect((dupCode as DbError).key).toBe('locations_code_unique');
    const dupName = await db
      .prepare('INSERT INTO locations (id, code, name) VALUES (?, ?, ?)')
      .bind('l3', 'BDG', 'JAKARTA')
      .run()
      .catch((e: unknown) => e);
    expect((dupName as DbError).key).toBe('locations_name_unique');
  });

  test('perbedaan terdokumentasi dari SQLite: LOWER Unicode (É dan é bentrok pada roles.name)', async () => {
    await db.prepare('INSERT INTO roles (id, name) VALUES (?, ?)').bind('r-e1', 'Équipe').run();
    const dup = await db
      .prepare('INSERT INTO roles (id, name) VALUES (?, ?)')
      .bind('r-e2', 'équipe')
      .run()
      .catch((e: unknown) => e);
    expect((dup as DbError).kind).toBe('duplicate');
  });

  test('emoji utuh di handover_comments.quote dan handovers.note', async () => {
    await db
      .prepare('INSERT INTO handovers (id, number, note) VALUES (?, ?, ?)')
      .bind('h-emoji', 'ST-20261105-001', 'catatan 😀 selesai')
      .run();
    const ins = await db
      .prepare('INSERT INTO handover_comments (handover_id, quote, body) VALUES (?, ?, ?)')
      .bind('h-emoji', 'kutipan 😀', 'isi')
      .run();
    expect(ins.meta.lastRowId).toBeGreaterThan(0);
    const h = await db
      .prepare('SELECT note FROM handovers WHERE id = ?')
      .bind('h-emoji')
      .first<{ note: string }>();
    expect(h?.note).toBe('catatan 😀 selesai');
    const c = await db
      .prepare('SELECT quote FROM handover_comments WHERE handover_id = ?')
      .bind('h-emoji')
      .first<{ quote: string }>();
    expect(c?.quote).toBe('kutipan 😀');
  });

  test('audit_log.id dan handover_comments.id naik otomatis (urutan)', async () => {
    const a = await db
      .prepare('INSERT INTO audit_log (ts, actor) VALUES (?, ?)')
      .bind('2026-11-05T00:00:00Z', 'x')
      .run();
    const b = await db
      .prepare('INSERT INTO audit_log (ts, actor) VALUES (?, ?)')
      .bind('2026-11-05T00:00:00Z', 'y')
      .run();
    expect(b.meta.lastRowId).toBeGreaterThan(a.meta.lastRowId);
  });

  test('CHECK status ditolak dan FK komentar ke handovers ditegakkan', async () => {
    const bad = await db
      .prepare('INSERT INTO handovers (id, number, status) VALUES (?, ?, ?)')
      .bind('h-bad', 'ST-X-1', 'weird')
      .run()
      .catch((e: unknown) => e);
    expect(bad).toBeInstanceOf(DbError);
    const orphan = await db
      .prepare('INSERT INTO handover_comments (handover_id, body) VALUES (?, ?)')
      .bind('tidak-ada', 'x')
      .run()
      .catch((e: unknown) => e);
    expect(orphan).toBeInstanceOf(DbError);
  });

  test('nilai bawaan: items.is_country_lock false, brands.item_count 0, handovers.board_status new', async () => {
    await db
      .prepare('INSERT INTO brands (id, `key`) VALUES (?, ?)')
      .bind('b-def', 'default-brand')
      .run();
    await db
      .prepare('INSERT INTO handovers (id, number) VALUES (?, ?)')
      .bind('h-def', 'ST-DEF-1')
      .run();
    await db
      .prepare('INSERT INTO items (id, `key`) VALUES (?, ?)')
      .bind('i-def', 'default-item')
      .run();
    const b = await db
      .prepare('SELECT item_count, sync_rev FROM brands WHERE id = ?')
      .bind('b-def')
      .first<{
        item_count: number;
        sync_rev: number;
      }>();
    expect([Number(b?.item_count), Number(b?.sync_rev)]).toEqual([0, 0]);
    const h = await db
      .prepare('SELECT board_status, status, checks FROM handovers WHERE id = ?')
      .bind('h-def')
      .first<{ board_status: string; status: string; checks: string }>();
    expect(h).toEqual({ board_status: 'new', status: 'open', checks: '[]' });
    const i = await db
      .prepare('SELECT is_country_lock FROM items WHERE id = ?')
      .bind('i-def')
      .first<{
        is_country_lock: string;
      }>();
    expect(i?.is_country_lock).toBe('false');
  });
});
