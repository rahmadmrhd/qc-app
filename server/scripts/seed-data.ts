import type { Db } from '@server/core/db';
import { derivedColumns } from '@server/modules/handover/repo';
import { aliasKeyList, aliasKeysOf } from '@server/modules/item/repo';
import { customerKey, dateKeyOf, handoverNumber } from '@shared/handover';
import type { CheckState } from '@shared/handover-checklist';
import { itemKey, normalizeKey } from '@shared/items';

/** Satu pernyataan seed berparameter (nilai selalu diikat, tidak pernah disisipkan ke teks SQL). */
export interface SeedStatement {
  sql: string;
  values: Array<string | number | null>;
}

function insert(table: string, row: Record<string, string | number | null>): SeedStatement {
  const columns = Object.keys(row);
  const names = columns.map((c) => '`' + c + '`').join(', ');
  const marks = columns.map(() => '?').join(', ');
  return {
    sql: `INSERT INTO ${table} (${names}) VALUES (${marks})`,
    values: columns.map((c) => row[c] ?? null),
  };
}

const raw = (sql: string): SeedStatement => ({ sql, values: [] });

const iso = (ms: number) => new Date(ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;

/**
 * Tabel yang dikosongkan (anak lebih dulu) sebelum data contoh dimasukkan. Tidak menyentuh `settings` dan
 * `schema_migrations`. Setiap tabel data baru WAJIB masuk daftar ini (kalau tidak, `db:seed` berulang meninggalkan
 * data yatim yang menunjuk ke baris yang sudah dihapus); `seed.test.ts` membandingkannya dengan skema.
 */
export const RESET_TABLES = [
  'item_sticker_marks',
  'item_sticker_photos',
  'sticker_guide_images',
  'sticker_stock_entries',
  'sticker_stock',
  'sticker_business_units',
  'postel_numbers',
  'postels',
  'manual_book_versions',
  'stickers',
  'sticker_types',
  'serial_proof_photos',
  'serial_events',
  'serial_stickers',
  'serial_cases',
  'serial_business_units',
  'serials',
  'qr_documents',
  'qr_designs',
  'qr_presets',
  'qr_defaults',
  'handover_comments',
  'handovers',
  'notification_pending_items',
  'notification_pending',
  'notification_prefs',
  'notifications',
  'push_subscriptions',
  'guide_progress',
  'dashboard_share_visits',
  'dashboard_shares',
  'dashboard_reports',
  'job_blobs',
  'item_alias_keys',
  'item_business_units',
  'items',
  'brand_default_business_units',
  'brands',
  'business_units',
  'customers',
  'files',
  'audit_log',
  'users',
  'roles',
  'locations',
  'counters',
  'jobs',
  'rate_limits',
];

/** Tabel yang sengaja TIDAK dikosongkan seed (pengaturan dan catatan migrasi). */
export const SEED_KEPT_TABLES = ['schema_migrations', 'settings'];

/**
 * Pernyataan data contoh realistis untuk MariaDB DEV: pengguna admin (`email`) + peran + lokasi + merk + customer + item +
 * dua BU contoh (item bertaut ke BU `UM`) + beberapa task serah terima (Baru, Dikerjakan, Selesai, Dibatalkan) dengan centang dan komentar. Mengosongkan
 * tabel data terlebih dulu sehingga aman dijalankan ulang. Kolom turunan handover dihitung oleh kode produksi.
 */
export function buildSeedStatements(email: string, nowMs: number): SeedStatement[] {
  const sql: SeedStatement[] = RESET_TABLES.map((table) => raw(`DELETE FROM ${table}`));

  const t0 = iso(nowMs - 3 * 24 * HOUR);
  const meta = { created_at: t0, updated_at: t0, updated_by: 'seed' };

  const roles = [
    {
      id: 'role-admin',
      name: 'Admin',
      description: 'Semua akses',
      permissions: {
        access: 'manage',
        item: 'manage',
        qrcode: 'manage',
        handover: 'manage',
        qc: 'edit',
        stock: 'view',
        sticker: 'manage',
        stickerstock: 'manage',
        countrylock: 'view',
        dashboard: 'manage',
      },
    },
    {
      id: 'role-wh',
      name: 'WH',
      description: 'Gudang: serah terima',
      permissions: { handover: 'manage', item: 'view' },
    },
    {
      id: 'role-qc',
      name: 'QC',
      description: 'Pengerjaan QC',
      permissions: { qc: 'edit', item: 'view' },
    },
  ];
  for (const role of roles) {
    sql.push(insert('roles', { ...role, permissions: JSON.stringify(role.permissions), ...meta }));
  }

  const locations = [
    { id: 'loc-jkt', code: 'JKT', name: 'Jakarta' },
    { id: 'loc-bdg', code: 'BDG', name: 'Bandung' },
  ];
  for (const location of locations) {
    sql.push(insert('locations', { ...location, status: 'active', ...meta }));
  }

  // Dua BU contoh; semua user contoh bertugas di "Semua BU" agar bisa mencoba fitur item.
  const businessUnits = [
    { id: 'bu-um', code: 'UM', name: 'Umum' },
    { id: 'bu-ent', code: 'ENT', name: 'Enterprise' },
  ];
  for (const bu of businessUnits) {
    sql.push(insert('business_units', { ...bu, status: 'active', ...meta }));
  }

  const everywhere = (roleId: string) => JSON.stringify([{ locationId: null, roleIds: [roleId] }]);
  const allBu = (roleId: string) => JSON.stringify([{ buId: null, roleIds: [roleId] }]);
  const users = [
    { id: 'user-admin', email, name: 'Admin Dev', role: 'role-admin' },
    { id: 'user-wh', email: 'wh@dev.test', name: 'Staf WH', role: 'role-wh' },
    { id: 'user-qc', email: 'qc@dev.test', name: 'Staf QC', role: 'role-qc' },
  ];
  for (const user of users) {
    sql.push(
      insert('users', {
        id: user.id,
        email: user.email.trim().toLowerCase(),
        name: user.name,
        status: 'active',
        role_ids: '',
        assignments: everywhere(user.role),
        bu_assignments: allBu(user.role),
        ...meta,
      }),
    );
  }

  const brands = ['Ubiquiti', 'Mikrotik', 'TP-Link'];
  for (const name of brands) {
    sql.push(
      insert('brands', {
        id: `brand-${normalizeKey(name).split(' ').join('-')}`,
        name,
        key: normalizeKey(name),
        status: 'active',
        ...meta,
      }),
    );
  }

  const items: Array<{
    brand: string;
    model: string;
    aliases?: string[];
    lock?: boolean;
    inactive?: boolean;
  }> = [
    { brand: 'Ubiquiti', model: 'UniFi U6 Pro', aliases: ['U6-Pro'] },
    { brand: 'Ubiquiti', model: 'EdgeRouter X', aliases: ['ER-X', 'ERX'] },
    { brand: 'Ubiquiti', model: 'UniFi Switch 24 PoE' },
    { brand: 'Ubiquiti', model: 'NanoStation Loco M5', inactive: true },
    { brand: 'Mikrotik', model: 'hAP ac2', aliases: ['hAP ac 2'] },
    { brand: 'Mikrotik', model: 'RB5009UG+S+IN' },
    { brand: 'Mikrotik', model: 'CRS326-24G-2S+RM', lock: true },
    { brand: 'TP-Link', model: 'Archer AX55', aliases: ['AX55'] },
    { brand: 'TP-Link', model: 'TL-SG1024D' },
    { brand: 'TP-Link', model: 'EAP245' },
  ];
  items.forEach((item, index) => {
    const aliases = item.aliases ?? [];
    sql.push(
      insert('items', {
        id: `item-${index + 1}`,
        brand_id: `brand-${normalizeKey(item.brand).split(' ').join('-')}`,
        model: item.model,
        key: itemKey(item.brand, item.model),
        is_country_lock: item.lock ? 'true' : 'false',
        aliases: JSON.stringify(aliases),
        alias_keys: aliasKeysOf(aliases),
        accessories: JSON.stringify([{ name: 'Adaptor daya', qty: 1 }]),
        attachments: '[]',
        detail_md: `## ${item.brand} ${item.model}\n\nPerangkat contoh untuk pengembangan lokal.`,
        status: item.inactive ? 'inactive' : 'active',
        ...meta,
      }),
    );
  });
  // Semua item contoh milik BU `UM` (BU `ENT` sengaja kosong untuk menguji pembatasan per BU).
  items.forEach((_item, index) => {
    sql.push(insert('item_business_units', { item_id: `item-${index + 1}`, bu_id: 'bu-um' }));
  });
  items.forEach((item, index) => {
    for (const key of aliasKeyList(item.aliases ?? [])) {
      sql.push(insert('item_alias_keys', { key, item_id: `item-${index + 1}` }));
    }
  });
  // Penghitung turunan `brands.item_count` (dijaga kode produksi pada penulisan item; migrasi 0009).
  sql.push(
    raw(
      'UPDATE brands SET item_count = (SELECT COUNT(*) FROM items WHERE items.brand_id = brands.id)',
    ),
  );

  const customers = ['PT Maju Jaya', 'CV Abadi Sentosa', 'Toko Sinar Elektronik'];
  for (const [index, name] of customers.entries()) {
    sql.push(
      insert('customers', {
        id: `cust-${index + 1}`,
        name,
        key: customerKey(name),
        status: 'active',
        ...meta,
      }),
    );
  }

  // Katalog stiker contoh (tahap 3a): enam jenis, beberapa stiker bertaut BU, dan stok per lokasi dengan riwayat.
  // Riwayat ditulis konsisten: qty_after = stok sesudah setiap catatan; stok sisa = jumlah baris stok.
  const stickerTypes = [
    { id: 'type-qc', name: 'QC', rule: 'bu' },
    { id: 'type-segel', name: 'Segel', rule: 'bu' },
    { id: 'type-country-lock', name: 'Country Lock', rule: 'none' },
    { id: 'type-warning-frekuensi', name: 'Warning Frekuensi', rule: 'none' },
    { id: 'type-warning-unifi', name: 'Warning Unifi', rule: 'none' },
    { id: 'type-manual-book', name: 'Manual Book', rule: 'none' },
  ];
  for (const type of stickerTypes) {
    sql.push(insert('sticker_types', { ...type, status: 'active', ...meta }));
  }

  const stickers: Array<{
    id: string;
    type: string;
    name: string;
    alias?: string;
    minQty: number;
    bus: string[];
    inactive?: boolean;
  }> = [
    {
      id: 'sticker-qc-hijau',
      type: 'type-qc',
      name: 'QC Spectrum/Teakwave',
      alias: 'Stiker Hijau',
      minQty: 100,
      bus: ['bu-um', 'bu-ent'],
    },
    {
      id: 'sticker-qc-putih',
      type: 'type-qc',
      name: 'QC Voltech',
      alias: 'Stiker Putih',
      minQty: 50,
      bus: ['bu-ent'],
    },
    { id: 'sticker-segel-um', type: 'type-segel', name: 'Segel Umum', minQty: 200, bus: ['bu-um'] },
    {
      id: 'sticker-segel-ent',
      type: 'type-segel',
      name: 'Segel Enterprise',
      minQty: 30,
      bus: ['bu-ent'],
    },
    {
      id: 'sticker-country-lock',
      type: 'type-country-lock',
      name: 'Country Lock',
      minQty: 20,
      bus: [],
    },
    {
      id: 'sticker-warning-frekuensi',
      type: 'type-warning-frekuensi',
      name: 'Warning Frekuensi',
      minQty: 0,
      bus: [],
    },
    {
      id: 'sticker-manual-book-lama',
      type: 'type-manual-book',
      name: 'Manual Book Lama',
      minQty: 0,
      bus: [],
      inactive: true,
    },
  ];
  for (const sticker of stickers) {
    sql.push(
      insert('stickers', {
        id: sticker.id,
        type_id: sticker.type,
        name: sticker.name,
        alias: sticker.alias ?? '',
        file_id: '',
        min_qty: sticker.minQty,
        status: sticker.inactive ? 'inactive' : 'active',
        ...meta,
      }),
    );
    for (const bu of sticker.bus) {
      sql.push(insert('sticker_business_units', { sticker_id: sticker.id, bu_id: bu }));
    }
  }

  // Riwayat stok contoh: [stiker, lokasi, kind, delta, qty_after, count_json, alasan, hari yang lalu].
  const stockHistory: Array<[string, string, string, number, number, string, string, number]> = [
    [
      'sticker-qc-hijau',
      'loc-jkt',
      'in',
      50,
      50,
      '{"rows":[{"sheets":5,"perSheet":10}],"loose":0}',
      '',
      10,
    ],
    ['sticker-qc-hijau', 'loc-jkt', 'out', -25, 25, '', 'Dipakai batch Spectrum', 4],
    ['sticker-qc-hijau', 'loc-bdg', 'in', 20, 20, '{"rows":[],"loose":20}', '', 9],
    ['sticker-qc-hijau', 'loc-bdg', 'out', -5, 15, '', 'Dipakai batch Teakwave', 2],
    [
      'sticker-qc-putih',
      'loc-jkt',
      'in',
      300,
      300,
      '{"rows":[{"sheets":10,"perSheet":30}],"loose":0}',
      '',
      8,
    ],
    [
      'sticker-segel-um',
      'loc-jkt',
      'in',
      500,
      500,
      '{"rows":[{"sheets":5,"perSheet":100}],"loose":0}',
      '',
      12,
    ],
    ['sticker-segel-um', 'loc-bdg', 'in', 200, 200, '{"rows":[],"loose":200}', '', 12],
    [
      'sticker-segel-ent',
      'loc-jkt',
      'opname',
      40,
      40,
      '{"rows":[{"sheets":2,"perSheet":20}],"loose":0}',
      'Stok opname awal',
      6,
    ],
    ['sticker-country-lock', 'loc-jkt', 'in', 60, 60, '{"rows":[],"loose":60}', '', 7],
    ['sticker-country-lock', 'loc-bdg', 'in', 10, 10, '{"rows":[],"loose":10}', '', 7],
    ['sticker-country-lock', 'loc-bdg', 'adjust', -2, 8, '', 'Rusak saat pengecekan', 1],
  ];
  const stockTotals = new Map<string, number>();
  for (const [
    sticker,
    location,
    kind,
    delta,
    qtyAfter,
    countJson,
    reason,
    daysAgo,
  ] of stockHistory) {
    const ts = iso(nowMs - daysAgo * 24 * HOUR);
    sql.push(
      insert('sticker_stock_entries', {
        sticker_id: sticker,
        location_id: location,
        kind,
        delta,
        qty_after: qtyAfter,
        count_json: countJson,
        reason,
        actor: 'qc@dev.test',
        ts,
      }),
    );
    stockTotals.set(`${sticker}|${location}`, qtyAfter);
  }
  for (const [key, qty] of stockTotals) {
    const [sticker, location] = key.split('|') as [string, string];
    sql.push(
      insert('sticker_stock', { sticker_id: sticker, location_id: location, qty, updated_at: t0 }),
    );
  }

  const dateKey = dateKeyOf(nowMs);
  const check = (text: string, by: string, at: number, occurrence = 0): CheckState => ({
    text,
    by,
    at: iso(at),
    occurrence,
  });
  const tasks: Array<{
    location: string;
    customer: number | null;
    note: string;
    checks?: CheckState[];
    cancelled?: boolean;
    completedAt?: string;
    ageHours: number;
    comments?: Array<{ quote: string; body: string; author: string }>;
  }> = [
    {
      location: 'loc-jkt',
      customer: 0,
      note: '- [ ] UniFi U6 Pro = 5 unit\n- [ ] Adaptor PoE = 5 pcs\n\nKirim sebelum Jumat.',
      ageHours: 2,
    },
    {
      location: 'loc-jkt',
      customer: 1,
      note: '- [ ] hAP ac2 = 10 unit\n- [ ] RB5009UG+S+IN = 2 unit\n- [ ] Kabel UTP 2 m = 20 pcs',
      checks: [check('hAP ac2 = 10 unit', 'qc@dev.test', nowMs - 3 * HOUR)],
      ageHours: 6,
      comments: [
        { quote: 'RB5009UG+S+IN', body: 'Mohon dicek versi firmware.', author: 'wh@dev.test' },
      ],
    },
    {
      location: 'loc-jkt',
      customer: 2,
      note: '- [ ] Archer AX55 = 3 unit\n- [ ] TL-SG1024D = 1 unit',
      checks: [
        check('Archer AX55 = 3 unit', 'qc@dev.test', nowMs - 20 * HOUR),
        check('TL-SG1024D = 1 unit', 'qc@dev.test', nowMs - 19 * HOUR),
      ],
      ageHours: 30,
    },
    {
      location: 'loc-jkt',
      customer: null,
      note: '- [ ] EAP245 = 4 unit\n\nPesanan dibatalkan customer.',
      cancelled: true,
      ageHours: 40,
    },
    {
      location: 'loc-jkt',
      customer: 0,
      note: 'Pengecekan visual tanpa daftar barang.',
      completedAt: iso(nowMs - 10 * HOUR),
      ageHours: 48,
    },
    {
      location: 'loc-bdg',
      customer: 1,
      note: '- [ ] CRS326-24G-2S+RM = 1 unit\n- [ ] Rack ear = 2 pcs',
      ageHours: 5,
    },
  ];
  tasks.forEach((task, index) => {
    const created = nowMs - task.ageHours * HOUR;
    const customerName = task.customer === null ? '' : (customers[task.customer] as string);
    const record = {
      note: task.note,
      checks: task.checks ?? [],
      status: task.cancelled ? ('cancelled' as const) : ('open' as const),
      completedAt: task.completedAt ?? '',
    };
    const derived = derivedColumns(record);
    const id = `task-${index + 1}`;
    sql.push(
      insert('handovers', {
        id,
        number: handoverNumber(dateKey, index + 1),
        location_id: task.location,
        customer_id: task.customer === null ? '' : `cust-${task.customer + 1}`,
        customer_name: customerName,
        note: record.note,
        status: record.status,
        checks: JSON.stringify(record.checks),
        completed_at: record.completedAt,
        completed_by: record.completedAt === '' ? '' : 'qc@dev.test',
        created_at: iso(created),
        created_by: 'wh@dev.test',
        updated_at: iso(created + HOUR / 2),
        updated_by: 'wh@dev.test',
        version: 1,
        checked_count: derived.checkedCount,
        total_count: derived.totalCount,
        board_status: derived.boardStatus,
      }),
    );
    for (const [ci, comment] of (task.comments ?? []).entries()) {
      sql.push(
        insert('handover_comments', {
          id: `${id}-c${ci + 1}`,
          handover_id: id,
          author: comment.author,
          created_at: iso(created + HOUR),
          quote: comment.quote,
          before: '',
          after: '',
          body: comment.body,
          stale: 0,
        }),
      );
    }
  });
  sql.push(insert('counters', { key: `st:${dateKey}`, value: tasks.length }));

  sql.push(
    insert('audit_log', {
      ts: t0,
      actor: 'seed',
      action: 'seed.dev',
      target: 'data contoh pengembangan',
      before: 'null',
      after: 'null',
    }),
  );
  return sql;
}

/** Menerapkan seed dalam SATU transaksi (hapus data lama lalu isi ulang): gagal di tengah = tidak ada yang berubah. */
export async function applySeed(db: Db, email: string, nowMs: number): Promise<void> {
  await db.batch(buildSeedStatements(email, nowMs).map((s) => db.prepare(s.sql).bind(...s.values)));
}
