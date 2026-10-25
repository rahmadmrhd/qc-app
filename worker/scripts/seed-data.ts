import { customerKey, dateKeyOf, handoverNumber } from '@shared/handover';
import type { CheckState } from '@shared/handover-checklist';
import { itemKey, normalizeKey } from '@shared/items';
import { derivedColumns } from '@worker/modules/handover/repo';
import { aliasKeysOf } from '@worker/modules/item/repo';

/** Literal SQL aman untuk nilai teks/angka/null (skrip dev saja; nilai berasal dari kode ini). */
function q(value: string | number | null): string {
  if (value === null) return 'NULL';
  if (typeof value === 'number') return String(value);
  return `'${value.split("'").join("''")}'`;
}

function insert(table: string, row: Record<string, string | number | null>): string {
  const columns = Object.keys(row);
  return `INSERT INTO ${table} (${columns.map((c) => (c === 'before' || c === 'after' ? `"${c}"` : c)).join(', ')}) VALUES (${columns.map((c) => q(row[c] ?? null)).join(', ')});`;
}

const iso = (ms: number) => new Date(ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;

/** Tabel yang dikosongkan (anak lebih dulu) sebelum data contoh dimasukkan. Tidak menyentuh `settings`. */
const RESET_TABLES = [
  'handover_comments',
  'handovers',
  'items',
  'brands',
  'customers',
  'files',
  'audit_log',
  'users',
  'roles',
  'locations',
  'counters',
  'sync_state',
  'jobs',
  'rate_limits',
];

/**
 * SQL data contoh realistis untuk D1 LOKAL: pengguna admin (`email`) + peran + lokasi + merk + customer + item +
 * beberapa task serah terima (Baru, Dikerjakan, Selesai, Dibatalkan) dengan centang dan komentar. Mengosongkan
 * tabel data terlebih dulu sehingga aman dijalankan ulang. Kolom turunan handover dihitung oleh kode produksi.
 */
export function buildSeedSql(email: string, nowMs: number): string {
  const sql: string[] = [`-- Data contoh pengembangan lokal (dibuat ${iso(nowMs)})`];
  for (const table of RESET_TABLES) sql.push(`DELETE FROM ${table};`);

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

  const everywhere = (roleId: string) => JSON.stringify([{ locationId: null, roleIds: [roleId] }]);
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
        ...meta,
      }),
    );
  }

  const brands = ['Ubiquiti', 'Mikrotik', 'TP-Link'];
  brands.forEach((name, index) => {
    sql.push(
      insert('brands', {
        id: `brand-${normalizeKey(name).split(' ').join('-')}`,
        external_id: '',
        name,
        key: normalizeKey(name),
        status: 'active',
        sync_rev: index + 1,
        ...meta,
      }),
    );
  });
  sql.push(insert('sync_state', { resource: 'brands', seq: brands.length, updated_at: t0 }));

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
        external_id: '',
        brand_id: `brand-${normalizeKey(item.brand).split(' ').join('-')}`,
        model: item.model,
        key: itemKey(item.brand, item.model),
        is_country_lock: item.lock ? 'true' : 'false',
        aliases: JSON.stringify(aliases),
        alias_keys: aliasKeysOf(aliases),
        stickers: JSON.stringify([{ name: 'Label SNI', note: 'Bagian belakang', fileId: null }]),
        accessories: JSON.stringify([{ name: 'Adaptor daya', qty: 1 }]),
        attachments: '[]',
        detail_md: `## ${item.brand} ${item.model}\n\nPerangkat contoh untuk pengembangan lokal.`,
        status: item.inactive ? 'inactive' : 'active',
        sync_rev: index + 1,
        ...meta,
      }),
    );
  });
  sql.push(insert('sync_state', { resource: 'items', seq: items.length, updated_at: t0 }));

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
  return `${sql.join('\n')}\n`;
}
