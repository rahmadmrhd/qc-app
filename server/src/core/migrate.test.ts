// Tes migrator dan skema baseline MariaDB terhadap database nyata di VPS (butuh `bun run db:tunnel`).
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createDb, type Db, DbError } from '@server/core/db';
import { applyMigrations, loadMigrations } from '@server/core/migrate';
import { newTestSchemaName, testDbUrl } from '@server-test/db-env';

const URL_NO_DB = testDbUrl();
const newSchemaName = newTestSchemaName;

const EXPECTED_TABLES = [
  'audit_log',
  'brand_default_business_units',
  'brands',
  'business_units',
  'counters',
  'customers',
  'files',
  'guide_progress',
  'handover_comments',
  'handovers',
  'item_alias_keys',
  'item_business_units',
  'item_sticker_marks',
  'item_sticker_photos',
  'items',
  'job_blobs',
  'jobs',
  'locations',
  'manual_book_versions',
  'notification_pending',
  'notification_pending_items',
  'notification_prefs',
  'notifications',
  'postel_numbers',
  'postels',
  'push_subscriptions',
  'qr_defaults',
  'qr_designs',
  'qr_documents',
  'qr_presets',
  'rate_limits',
  'roles',
  'schema_migrations',
  'serial_cases',
  'serial_events',
  'serial_proof_photos',
  'serial_stickers',
  'serials',
  'settings',
  'sticker_business_units',
  'sticker_guide_images',
  'sticker_stock',
  'sticker_stock_entries',
  'sticker_types',
  'stickers',
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
  test('membaca berkas *.sql bernomor di server/migrations, urut nama', async () => {
    const list = await loadMigrations();
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list.slice(0, 7).map((m) => m.name)).toEqual([
      '0001_baseline.sql',
      '0002_hapus_sync_rev.sql',
      '0003_hapus_external_id.sql',
      '0004_business_units.sql',
      '0005_stiker.sql',
      '0006_pustaka_gambar_stiker.sql',
      '0007_instruksi_stiker_item.sql',
    ]);
    expect(list.map((m) => m.name)).toEqual([...list.map((m) => m.name)].sort());
    expect(list[0]?.sql).toContain('CREATE TABLE');
  });
});

describe('0010_postel_kunci_asing', () => {
  const INSERT_ITEM =
    "INSERT INTO items (id, brand_id, model, `key`, is_country_lock, aliases, alias_keys, stickers, accessories, attachments, detail_md, status, created_at, updated_at, updated_by, manual_book_design_id, postel_id) VALUES (?, 'b', ?, ?, 'false', '[]', '', '[]', '[]', '[]', '', 'active', 't', 't', 's', '', ?)";

  test("data 0009 dinormalkan sebelum kunci asing dipasang: '' dan penunjuk yatim jadi NULL, nomor yatim dibuang, data sah utuh", async () => {
    const db = await freshDb();
    try {
      const all = await loadMigrations();
      await applyMigrations(
        db,
        all.filter((m) => m.name < '0010'),
      );
      await db
        .prepare(
          "INSERT INTO postels (id, note, attachments, created_at, updated_at, updated_by) VALUES ('p1', '', '[]', 't', 't', 's')",
        )
        .run();
      await db.prepare(INSERT_ITEM).bind('i-kosong', 'A', 'a', '').run();
      await db.prepare(INSERT_ITEM).bind('i-sah', 'B', 'b', 'p1').run();
      await db.prepare(INSERT_ITEM).bind('i-yatim', 'C', 'c', 'hilang').run();
      for (const [id, postelId] of [
        ['n-sah', 'p1'],
        ['n-yatim', 'hilang'],
      ] as const) {
        await db
          .prepare(
            'INSERT INTO postel_numbers (id, postel_id, number, number_key, seq) VALUES (?, ?, ?, ?, 1)',
          )
          .bind(id, postelId, id, id)
          .run();
      }
      expect(
        await applyMigrations(
          db,
          all.filter((m) => m.name <= '0010_postel_kunci_asing.sql'),
        ),
      ).toEqual(['0010_postel_kunci_asing.sql']);
      const items = await db
        .prepare('SELECT id, postel_id FROM items ORDER BY id')
        .all<{ id: string; postel_id: string | null }>();
      expect(items.results).toEqual([
        { id: 'i-kosong', postel_id: null },
        { id: 'i-sah', postel_id: 'p1' },
        { id: 'i-yatim', postel_id: null },
      ]);
      const numbers = await db
        .prepare('SELECT id FROM postel_numbers ORDER BY id')
        .all<{ id: string }>();
      expect(numbers.results).toEqual([{ id: 'n-sah' }]);
      // kunci asing aktif: menautkan ke catatan yang tak ada ditolak, menghapus catatan melepas item dan nomornya
      const bad = db
        .prepare("UPDATE items SET postel_id = 'tidak-ada' WHERE id = 'i-kosong'")
        .run();
      await expect(bad).rejects.toBeInstanceOf(DbError);
      await db.prepare("DELETE FROM postels WHERE id = 'p1'").run();
      const left = await db
        .prepare("SELECT postel_id FROM items WHERE id = 'i-sah'")
        .first<{ postel_id: string | null }>();
      expect(left?.postel_id).toBeNull();
      expect((await db.prepare('SELECT id FROM postel_numbers').all()).results).toEqual([]);
    } finally {
      await db.close();
    }
  }, 120_000);
});

describe('0011_postel_stiker_per_catatan', () => {
  const INSERT_STICKER =
    "INSERT INTO stickers (id, type_id, name, created_at, updated_at, updated_by) VALUES (?, ?, ?, 't', 't', 's')";
  const INSERT_TYPE =
    "INSERT INTO sticker_types (id, name, rule, system_kind, created_at, updated_at, updated_by) VALUES (?, ?, 'group', ?, 't', 't', 's')";

  test('stiker Manual Book yang ada diberi awalan (idempoten); kolom sticker_id NULL, unik, dan kunci asing RESTRICT', async () => {
    const db = await freshDb();
    try {
      const all = await loadMigrations();
      await applyMigrations(
        db,
        all.filter((m) => m.name < '0011'),
      );
      await db.prepare(INSERT_TYPE).bind('t-mb', 'Manual Book', 'manual_book').run();
      await db.prepare(INSERT_TYPE).bind('t-pos', 'Postel', 'postel').run();
      await db.prepare(INSERT_STICKER).bind('s-mb', 't-mb', 'PBE M5-400 v1').run();
      await db.prepare(INSERT_STICKER).bind('s-pos', 't-pos', 'Postel').run();
      await db
        .prepare(
          "INSERT INTO postels (id, note, attachments, created_at, updated_at, updated_by) VALUES ('p1', '', '[]', 't', 't', 's')",
        )
        .run();
      // Hanya sampai 0011: migrasi sesudahnya (mis. 0012 serial) punya tesnya sendiri dan tak boleh ikut di sini.
      expect(
        await applyMigrations(
          db,
          all.filter((m) => m.name <= '0011_postel_stiker_per_catatan.sql'),
        ),
      ).toEqual(['0011_postel_stiker_per_catatan.sql']);
      const names = await db
        .prepare('SELECT id, name FROM stickers ORDER BY id')
        .all<{ id: string; name: string }>();
      expect(names.results).toEqual([
        { id: 's-mb', name: 'Manual Book - PBE M5-400 v1' },
        { id: 's-pos', name: 'Postel' },
      ]);
      const postel = await db
        .prepare("SELECT sticker_id FROM postels WHERE id = 'p1'")
        .first<{ sticker_id: string | null }>();
      expect(postel?.sticker_id).toBeNull();
      // kunci asing: stiker harus ada; satu stiker hanya milik satu catatan; stiker milik catatan tak dapat dihapus
      await expect(
        db.prepare("UPDATE postels SET sticker_id = 'tidak-ada' WHERE id = 'p1'").run(),
      ).rejects.toBeInstanceOf(DbError);
      await db.prepare("UPDATE postels SET sticker_id = 's-pos' WHERE id = 'p1'").run();
      await db
        .prepare(
          "INSERT INTO postels (id, note, attachments, created_at, updated_at, updated_by) VALUES ('p2', '', '[]', 't', 't', 's')",
        )
        .run();
      await expect(
        db.prepare("UPDATE postels SET sticker_id = 's-pos' WHERE id = 'p2'").run(),
      ).rejects.toBeInstanceOf(DbError);
      await expect(
        db.prepare("DELETE FROM stickers WHERE id = 's-pos'").run(),
      ).rejects.toBeInstanceOf(DbError);
      // menghapus catatan tidak menyentuh stikernya
      await db.prepare("DELETE FROM postels WHERE id = 'p1'").run();
      expect(
        (await db.prepare("SELECT id FROM stickers WHERE id = 's-pos'").all()).results,
      ).toHaveLength(1);
    } finally {
      await db.close();
    }
  }, 120_000);
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

  test('45 tabel aplikasi + schema_migrations; terapan dua kali tak mengubah apa pun', async () => {
    const before = await tableNames(db);
    expect(before).toEqual(EXPECTED_TABLES);
    expect(await applyMigrations(db)).toEqual([]);
    // DDL semua migrasi idempoten: dijalankan ulang berurutan tanpa catatan tidak melempar galat dan tak mengubah tabel
    // (baseline membuat ulang `sync_state`, lalu 0002 menghapusnya lagi).
    for (const migration of await loadMigrations()) await db.exec(migration.sql);
    expect(await tableNames(db)).toEqual(before);
    const rows = await db
      .prepare('SELECT name FROM schema_migrations ORDER BY name')
      .all<{ name: string }>();
    expect(rows.results).toEqual([
      { name: '0001_baseline.sql' },
      { name: '0002_hapus_sync_rev.sql' },
      { name: '0003_hapus_external_id.sql' },
      { name: '0004_business_units.sql' },
      { name: '0005_stiker.sql' },
      { name: '0006_pustaka_gambar_stiker.sql' },
      { name: '0007_instruksi_stiker_item.sql' },
      { name: '0008_manual_book_4a.sql' },
      { name: '0009_postel_4b.sql' },
      { name: '0010_postel_kunci_asing.sql' },
      { name: '0011_postel_stiker_per_catatan.sql' },
      { name: '0012_serial_number.sql' },
      { name: '0013_notifikasi.sql' },
      { name: '0014_push_notifikasi.sql' },
      { name: '0015_serial_cases.sql' },
      { name: '0016_panduan_interaktif.sql' },
      { name: '0017_laporan_rusak.sql' },
      { name: '0018_client_id_serah_terima.sql' },
      { name: '0019_bukti_foto_qc.sql' },
      { name: '0020_notifikasi_serial.sql' },
      { name: '0021_indeks_notifikasi_serial.sql' },
      { name: '0022_push_perangkat_senyap.sql' },
      { name: '0023_firmware_item.sql' },
    ]);
  });

  test('stok stiker boleh negatif (CHECK dicabut) dan entri stok punya kolom serial', async () => {
    await db
      .prepare(
        "INSERT INTO sticker_stock (sticker_id, location_id, qty, updated_at) VALUES ('s-neg', 'l-neg', -3, '')",
      )
      .run();
    const row = await db
      .prepare("SELECT qty FROM sticker_stock WHERE sticker_id = 's-neg' AND location_id = 'l-neg'")
      .first<{ qty: number | string }>();
    expect(Number(row?.qty)).toBe(-3);
    const columns = await db
      .prepare(
        "SELECT column_name AS c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'sticker_stock_entries' AND column_name IN ('serial_id', 'serial_event_id') ORDER BY column_name",
      )
      .all<{ c: string }>();
    expect(columns.results.map((r) => r.c)).toEqual(['serial_event_id', 'serial_id']);
  });

  test('serials: serial unik per (BU, serial) dan client_id unik', async () => {
    const insert = (id: string, clientId: string, bu: string, serial: string) =>
      db
        .prepare(
          'INSERT INTO serials (id, client_id, bu_id, serial, item_id) VALUES (?, ?, ?, ?, ?)',
        )
        .bind(id, clientId, bu, serial, 'item-1')
        .run();
    await insert('a', 'ca', 'bu1', 'SN1');
    await insert('b', 'cb', 'bu2', 'SN1');
    await expect(insert('c', 'cc', 'bu1', 'SN1')).rejects.toBeInstanceOf(DbError);
    await expect(insert('d', 'ca', 'bu3', 'SN9')).rejects.toBeInstanceOf(DbError);
  });

  test('users.bu_assignments ada, bertipe teks panjang, bawaan kosong', async () => {
    const column = await db
      .prepare(
        "SELECT data_type AS t, is_nullable AS n, column_default AS d FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'bu_assignments'",
      )
      .first<{ t: string; n: string; d: string | null }>();
    expect(column?.t).toBe('longtext');
    expect(column?.n).toBe('NO');
    expect(column?.d).toBe("''");
  });

  test('users.shared_account ada, bertipe tinyint, tidak null, bawaan 0', async () => {
    const column = await db
      .prepare(
        "SELECT data_type AS t, is_nullable AS n, column_default AS d FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'shared_account'",
      )
      .first<{ t: string; n: string; d: string | null }>();
    expect(column?.t).toBe('tinyint');
    expect(column?.n).toBe('NO');
    expect(column?.d).toBe('0');
  });

  test('guide_progress: kunci utama (recipient, guide_id), tanpa kunci asing', async () => {
    expect(await tableNames(db)).toContain('guide_progress');
    const pk = await db
      .prepare(
        "SELECT GROUP_CONCAT(column_name ORDER BY seq_in_index) AS c FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'guide_progress' AND index_name = 'PRIMARY'",
      )
      .first<{ c: string }>();
    expect(pk?.c).toBe('recipient,guide_id');
    const fks = await db
      .prepare(
        "SELECT COUNT(*) AS n FROM information_schema.table_constraints WHERE table_schema = DATABASE() AND table_name = 'guide_progress' AND constraint_type = 'FOREIGN KEY'",
      )
      .first<{ n: number }>();
    expect(Number(fks?.n)).toBe(0);
  });

  test('id MySQL dihapus: tanpa kolom external_id di brands/items', async () => {
    const columns = await db
      .prepare(
        "SELECT table_name AS t FROM information_schema.columns WHERE table_schema = DATABASE() AND column_name = 'external_id'",
      )
      .all<{ t: string }>();
    expect(columns.results).toEqual([]);
  });

  test('revisi sinkron dihapus: tanpa kolom sync_rev di brands/items dan tanpa tabel sync_state', async () => {
    const columns = await db
      .prepare(
        "SELECT table_name AS t FROM information_schema.columns WHERE table_schema = DATABASE() AND column_name = 'sync_rev'",
      )
      .all<{ t: string }>();
    expect(columns.results).toEqual([]);
    expect(await tableNames(db)).not.toContain('sync_state');
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
        'brand_default_business_units.brand_default_business_units_bu',
        'brands.brands_key',
        'business_units.business_units_code_unique',
        'business_units.business_units_name_unique',
        'customers.customers_key',
        'files.files_owner',
        'files.files_pending_delete',
        'handover_comments.handover_comments_client_id',
        'handover_comments.handover_comments_handover',
        'handover_comments.handover_comments_seq',
        'handovers.handovers_board',
        'handovers.handovers_client_id',
        'handovers.handovers_customer',
        'handovers.handovers_number',
        'item_business_units.item_business_units_bu',
        'item_sticker_marks.item_sticker_marks_sticker',
        'item_sticker_marks.item_sticker_marks_type',
        'item_sticker_photos.item_sticker_photos_guide',
        'items.items_brand',
        'items.items_key',
        'items.items_manual_book',
        'items.items_postel',
        'items.items_status_updated',
        'jobs.jobs_status_updated',
        'locations.locations_code_unique',
        'locations.locations_name_unique',
        'manual_book_versions.manual_book_versions_design_version',
        'notification_pending.notification_pending_release',
        'notifications.notifications_created',
        'notifications.notifications_proof',
        'notifications.notifications_push',
        'notifications.notifications_recipient',
        'notifications.notifications_serial',
        'postel_numbers.postel_numbers_expiry',
        'postel_numbers.postel_numbers_key',
        'postel_numbers.postel_numbers_seq',
        'postels.postels_sticker',
        'push_subscriptions.push_subscriptions_recipient',
        'qr_designs.qr_designs_document',
        'qr_presets.qr_presets_bu_unique',
        'roles.roles_name_unique',
        'serial_cases.serial_cases_bu_created',
        'serial_cases.serial_cases_bu_opened',
        'serial_cases.serial_cases_number',
        'serial_cases.serial_cases_serial',
        'serial_events.serial_events_case',
        'serial_events.serial_events_seq',
        'serial_proof_photos.serial_proof_photos_event',
        'serial_proof_photos.serial_proof_photos_owner',
        'serial_proof_photos.serial_proof_photos_serial',
        'serial_proof_photos.serial_proof_photos_state',
        'serial_stickers.serial_stickers_sticker',
        'serials.serials_bu_created',
        'serials.serials_bu_serial',
        'serials.serials_client_id',
        'serials.serials_custody',
        'serials.serials_item',
        'serials.serials_location',
        'serials.serials_status',
        'sticker_business_units.sticker_business_units_bu',
        'sticker_guide_images.sticker_guide_images_name',
        'sticker_stock_entries.sticker_stock_entries_location_ts',
        'sticker_stock_entries.sticker_stock_entries_sticker_ts',
        'sticker_types.sticker_types_kind_unique',
        'sticker_types.sticker_types_name_unique',
        'stickers.stickers_type',
        'stickers.stickers_type_name_unique',
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
    expect(pks.item_business_units).toBe('item_id,bu_id');
    expect(pks.brand_default_business_units).toBe('brand_id,bu_id');
    expect(pks.business_units).toBe('id');
    expect(pks.sticker_business_units).toBe('sticker_id,bu_id');
    expect(pks.sticker_guide_images).toBe('id');
    expect(pks.sticker_stock).toBe('sticker_id,location_id');
    expect(pks.sticker_stock_entries).toBe('id');
    expect(pks.settings).toBe('key');
    expect(pks.notifications).toBe('id');
    expect(pks.notification_pending).toBe('handover_id,actor_email');
    expect(pks.notification_pending_items).toBe('handover_id,actor_email,item_key');
    expect(pks.push_subscriptions).toBe('endpoint_hash,recipient');
    expect(pks.notification_prefs).toBe('recipient');
    expect(pks.guide_progress).toBe('recipient,guide_id');
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
      .prepare('INSERT INTO handover_comments (id, handover_id, quote, body) VALUES (?, ?, ?, ?)')
      .bind('c-emoji', 'h-emoji', 'kutipan 😀', 'isi')
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

  test('audit_log.id dan handover_comments.seq naik otomatis (urutan)', async () => {
    const a = await db
      .prepare('INSERT INTO audit_log (ts, actor) VALUES (?, ?)')
      .bind('2026-11-05T00:00:00Z', 'x')
      .run();
    const b = await db
      .prepare('INSERT INTO audit_log (ts, actor) VALUES (?, ?)')
      .bind('2026-11-05T00:00:00Z', 'y')
      .run();
    expect(b.meta.lastRowId).toBeGreaterThan(a.meta.lastRowId);
    await db
      .prepare('INSERT INTO handovers (id, number) VALUES (?, ?)')
      .bind('h-seq', 'ST-SEQ-1')
      .run();
    for (const id of ['c-seq-1', 'c-seq-2', 'c-seq-0']) {
      await db
        .prepare('INSERT INTO handover_comments (id, handover_id, body) VALUES (?, ?, ?)')
        .bind(id, 'h-seq', id)
        .run();
    }
    const rows = await db
      .prepare('SELECT id FROM handover_comments WHERE handover_id = ? ORDER BY seq')
      .bind('h-seq')
      .all<{ id: string }>();
    expect(rows.results.map((r) => r.id)).toEqual(['c-seq-1', 'c-seq-2', 'c-seq-0']);
  });

  test('CHECK status ditolak dan FK komentar ke handovers ditegakkan', async () => {
    const bad = await db
      .prepare('INSERT INTO handovers (id, number, status) VALUES (?, ?, ?)')
      .bind('h-bad', 'ST-X-1', 'weird')
      .run()
      .catch((e: unknown) => e);
    expect(bad).toBeInstanceOf(DbError);
    const orphan = await db
      .prepare('INSERT INTO handover_comments (id, handover_id, body) VALUES (?, ?, ?)')
      .bind('c-orphan', 'tidak-ada', 'x')
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
      .prepare('SELECT item_count FROM brands WHERE id = ?')
      .bind('b-def')
      .first<{ item_count: number }>();
    expect(Number(b?.item_count)).toBe(0);
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
