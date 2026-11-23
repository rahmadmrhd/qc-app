import type { Env } from '@server/core/env';

export { seedPostel } from './postel-fixtures';

type Db = Pick<Env, 'DB'>;
const SEED_TIME = '2026-11-10T00:00:00.000Z';

export interface SeedHandoverRow {
  id: string;
  number?: string;
  locationId?: string;
  customerId?: string;
  customerName?: string;
  /** `new` | `in_progress` | `done` | `cancelled`; bawaan `new`. */
  boardStatus?: string;
  createdAt?: string;
  completedAt?: string;
  checkedCount?: number;
  totalCount?: number;
  deletedAt?: string;
}

/** Task Serah Terima langsung ke basis data (tanpa jalur layanan): hanya kolom yang dipakai dashboard yang bermakna. */
export async function seedHandover(env: Db, row: SeedHandoverRow): Promise<void> {
  const boardStatus = row.boardStatus ?? 'new';
  await env.DB.prepare(
    "INSERT INTO handovers (id, number, location_id, customer_id, customer_name, note, status, checks, completed_at, completed_by, created_at, created_by, updated_at, updated_by, checked_count, total_count, board_status, deleted_at, deleted_by) VALUES (?, ?, ?, ?, ?, '', ?, '[]', ?, '', ?, 'seed@gmail.com', ?, 'seed@gmail.com', ?, ?, ?, ?, ?)",
  )
    .bind(
      row.id,
      row.number ?? `ST-${row.id}`,
      row.locationId ?? 'loc-a',
      row.customerId ?? '',
      row.customerName ?? '',
      boardStatus === 'cancelled' ? 'cancelled' : 'open',
      row.completedAt ?? '',
      row.createdAt ?? SEED_TIME,
      row.completedAt || (row.createdAt ?? SEED_TIME),
      row.checkedCount ?? 0,
      row.totalCount ?? 0,
      boardStatus,
      row.deletedAt ?? '',
      row.deletedAt ? 'seed@gmail.com' : '',
    )
    .run();
}

export interface SeedSerialRow {
  id: string;
  serial?: string;
  buId?: string;
  itemId?: string;
  locationId?: string;
  status?: string;
  custody?: string;
  createdAt?: string;
  deletedAt?: string;
  transitFromLocationId?: string;
  transitToLocationId?: string;
  transitOn?: string;
}

/** Serial langsung ke basis data beserta baris riwayat BU saat ini (`serial_business_units`). */
export async function seedSerial(env: Db, row: SeedSerialRow): Promise<void> {
  const createdAt = row.createdAt ?? SEED_TIME;
  const buId = row.buId ?? 'bu-a';
  const location = row.locationId ?? 'loc-a';
  await env.DB.prepare(
    "INSERT INTO serials (id, client_id, bu_id, serial, item_id, test_date, location_id, recorded_location_id, status, custody, transit_from_location_id, transit_to_location_id, transit_on, created_at, created_by, updated_at, updated_by, deleted_at, deleted_by) VALUES (?, ?, ?, ?, ?, '2026-11-10', ?, ?, ?, ?, ?, ?, ?, ?, 'seed@gmail.com', ?, 'seed@gmail.com', ?, ?)",
  )
    .bind(
      row.id,
      `client-${row.id}`,
      buId,
      row.serial ?? `SN-${row.id}`,
      row.itemId ?? 'i-1',
      location,
      location,
      row.status ?? 'good',
      row.custody ?? 'qc',
      row.transitFromLocationId ?? '',
      row.transitToLocationId ?? '',
      row.transitOn ?? '',
      createdAt,
      createdAt,
      row.deletedAt ?? '',
      row.deletedAt ? 'seed@gmail.com' : '',
    )
    .run();
  await env.DB.prepare(
    "INSERT INTO serial_business_units (serial_id, bu_id, first_at, left_at) VALUES (?, ?, ?, '')",
  )
    .bind(row.id, buId, createdAt)
    .run();
}

export interface SeedCaseRow {
  id: string;
  number?: string;
  serialId: string;
  buId?: string;
  openedOn?: string;
  closedOn?: string;
  /** `''` (terbuka) | `broken` | `passed`. */
  outcome?: string;
}

/** Laporan rusak langsung ke basis data; laporan terbuka (`closedOn` kosong) ditautkan ke `serials.open_case_id`. */
export async function seedCase(env: Db, row: SeedCaseRow): Promise<void> {
  const openedOn = row.openedOn ?? '2026-11-10';
  await env.DB.prepare(
    "INSERT INTO serial_cases (id, number, serial_id, bu_id, opened_on, closed_on, outcome, created_at, created_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'seed@gmail.com', ?)",
  )
    .bind(
      row.id,
      row.number ?? `LP-${row.id}`,
      row.serialId,
      row.buId ?? 'bu-a',
      openedOn,
      row.closedOn ?? '',
      row.outcome ?? '',
      SEED_TIME,
      SEED_TIME,
    )
    .run();
  if (!row.closedOn) {
    await env.DB.prepare('UPDATE serials SET open_case_id = ? WHERE id = ?')
      .bind(row.id, row.serialId)
      .run();
  }
}

export interface SeedStockRow {
  stickerId: string;
  locationId: string;
  qty: number;
  /** Entri riwayat stok (`sticker_stock_entries`): `kind` `in` | `out` | `serial` | `adjust` | `opname`. */
  entries?: { kind: string; delta: number; ts: string }[];
}

/** Baris `sticker_stock` (stiker dan lokasi harus sudah ada) beserta entri riwayat opsional. */
export async function seedStock(env: Db, row: SeedStockRow): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO sticker_stock (sticker_id, location_id, qty, updated_at) VALUES (?, ?, ?, ?)',
  )
    .bind(row.stickerId, row.locationId, row.qty, SEED_TIME)
    .run();
  for (const entry of row.entries ?? []) {
    await env.DB.prepare(
      "INSERT INTO sticker_stock_entries (sticker_id, location_id, kind, delta, qty_after, reason, actor, ts) VALUES (?, ?, ?, ?, ?, '', 'seed@gmail.com', ?)",
    )
      .bind(row.stickerId, row.locationId, entry.kind, entry.delta, row.qty, entry.ts)
      .run();
  }
}
