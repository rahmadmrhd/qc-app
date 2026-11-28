import type { DbStatement, Preparer } from '@server/core/db';
import { liveWhere } from '@server/core/soft-delete';
import { needsProofSql } from '@server/modules/serial/wh-flags';
import type { WarehouseDispatchRefDto, WarehouseSerialDto } from '@shared/contract';
import {
  SERIAL_CUSTODIES,
  SERIAL_STATUSES,
  type SerialCustody,
  type SerialStatus,
} from '@shared/serials';

export const placeholders = (count: number): string =>
  Array.from({ length: count }, () => '?').join(', ');

/** Maks. pengeluaran selesai yang ditampilkan per serial (DTO pengungkapan minimal). */
export const DISPATCH_REFS_MAX = 20;

export interface OrderRow {
  id: string;
  number: string;
  key: string;
  bu_id: string;
  customer_id: string;
  customer_name: string;
  last_dispatched_on: string;
  created_at: string;
  created_by: string;
  updated_at: string;
  updated_by: string;
}

const ORDER_COLUMNS =
  'o.id, o.number, o.`key`, o.bu_id, o.customer_id, o.customer_name, o.last_dispatched_on, o.created_at, o.created_by, o.updated_at, o.updated_by';

export const loadOrderRow = (db: Preparer, id: string): Promise<OrderRow | null> =>
  db
    .prepare(`SELECT ${ORDER_COLUMNS} FROM warehouse_orders o WHERE o.id = ?`)
    .bind(id)
    .first<OrderRow>();

export const loadOrderRowByKey = (db: Preparer, key: string): Promise<OrderRow | null> =>
  db
    .prepare(`SELECT ${ORDER_COLUMNS} FROM warehouse_orders o WHERE o.\`key\` = ?`)
    .bind(key)
    .first<OrderRow>();

export interface DispatchRow {
  id: string;
  /** Nomor riwayat `OUT|RS/<kode BU>/<YYMM>-<urutan>` (migrasi 0042). */
  number: string;
  order_id: string;
  client_id: string;
  item_id: string;
  dispatched_on: string;
  note: string;
  mode: string;
  /** `order`, `ready` (migrasi 0041), atau `note` (catatan saja, 2026-11-28). */
  kind: string;
  /** BU pencatatan; terisi pada `ready` dan Penjualan tanpa SO (pada Penjualan ber-SO BU ada di catatan SO). */
  bu_id: string;
  /** Customer pengeluaran; terisi hanya pada Penjualan tanpa SO (migrasi 0044). */
  customer_id: string;
  customer_name: string;
  status: string;
  header_hash: string;
  chunk_size: number | string;
  chunk_count: number | string;
  chunks_received: number | string;
  serial_total: number | string;
  created_count: number | string;
  created_at: string;
  created_by: string;
  completed_at: string;
  cancelled_at: string;
  /** Nomor kardus awal dan isi per kardus pengeluaran `note` (migrasi 0046); 0 pada jenis lain. */
  box_start: number | string;
  box_size: number | string;
}

const DISPATCH_COLUMNS =
  'd.id, d.number, d.order_id, d.client_id, d.item_id, d.dispatched_on, d.note, d.mode, d.kind, d.bu_id, d.customer_id, d.customer_name, d.status, d.header_hash, d.chunk_size, d.chunk_count, d.chunks_received, d.serial_total, d.created_count, d.created_at, d.created_by, d.completed_at, d.cancelled_at, d.box_start, d.box_size';

/**
 * Penjualan TANPA No SO: `kind` order dan `order_id` = id pengeluaran itu sendiri (tak ada baris `warehouse_orders`). Id
 * pengeluaran ULID unik, jadi tidak pernah bentrok dengan penanda '' pencatatan Ready pada kunci unik serial per SO.
 */
export const isBareSale = (row: { id: string; kind: string; order_id: string }): boolean =>
  row.kind.trim() === 'order' && row.order_id.trim() === row.id.trim();

/**
 * Pencatatan `note`: tanpa catatan SO (`order_id` = id pengeluaran itu sendiri, seperti Penjualan tanpa SO, sehingga kunci
 * unik `(order_id, serial_id)` hanya melarang serial ganda DI DALAM satu catatan), BU di baris pengeluaran.
 */
export const isNoteDispatch = (row: { kind: string }): boolean => row.kind.trim() === 'note';

export const loadDispatchRowByClientId = (
  db: Preparer,
  clientId: string,
): Promise<DispatchRow | null> =>
  db
    .prepare(`SELECT ${DISPATCH_COLUMNS} FROM warehouse_dispatches d WHERE d.client_id = ?`)
    .bind(clientId)
    .first<DispatchRow>();

export const loadDispatchRow = (db: Preparer, id: string): Promise<DispatchRow | null> =>
  db
    .prepare(`SELECT ${DISPATCH_COLUMNS} FROM warehouse_dispatches d WHERE d.id = ?`)
    .bind(id)
    .first<DispatchRow>();

/** SN pengeluaran urut `seq` (untuk clipboard). */
export async function loadDispatchSerialNumbers(
  db: Preparer,
  dispatchId: string,
): Promise<string[]> {
  const rows = await db
    .prepare('SELECT serial FROM warehouse_dispatch_serials WHERE dispatch_id = ? ORDER BY seq')
    .bind(dispatchId)
    .all<{ serial: string }>();
  return rows.results.map((row) => row.serial);
}

export function insertDispatchSerialStmt(
  db: Preparer,
  row: {
    dispatchId: string;
    orderId: string;
    serialId: string;
    serial: string;
    seq: number;
    createdNew: boolean;
  },
): DbStatement {
  return db
    .prepare(
      'INSERT INTO warehouse_dispatch_serials (dispatch_id, order_id, serial_id, serial, seq, created_new) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .bind(row.dispatchId, row.orderId, row.serialId, row.serial, row.seq, row.createdNew ? 1 : 0);
}

/** Baris serial minimal untuk daftar putih `WarehouseSerialDto` (tanpa catatan, pelaku, kejadian, foto). */
export interface WhSerialRow {
  id: string;
  serial: string;
  item_id: string;
  brand_name: string | null;
  model: string | null;
  bu_id: string;
  bu_code: string;
  bu_name: string;
  location_id: string;
  location_name: string | null;
  test_date: string;
  status: string;
  custody: string;
  wh_created: number | string;
  needs_proof: number | string;
  created_at: string;
}

export const WH_SERIAL_COLUMNS = `s.id, s.serial, s.item_id, b.name AS brand_name, i.model, s.bu_id, bu.code AS bu_code, bu.name AS bu_name, s.location_id, l.name AS location_name, s.test_date, s.status, s.custody, s.wh_created, ${needsProofSql('s')} AS needs_proof, s.created_at`;

/** Serial HIDUP (terhapus = tidak ada) beserta nama item/BU/lokasi (penampil rujukan: nama tetap tampil walau terhapus). */
export function selectWhSerials(db: Preparer, where: string, binds: readonly unknown[], tail = '') {
  return db
    .prepare(
      `SELECT ${WH_SERIAL_COLUMNS} FROM serials s JOIN business_units bu ON bu.id = s.bu_id LEFT JOIN items i ON i.id = s.item_id LEFT JOIN brands b ON b.id = i.brand_id LEFT JOIN locations l ON l.id = s.location_id WHERE ${liveWhere('s')}${where === '' ? '' : ` AND ${where}`} ${tail}`,
    )
    .bind(...binds)
    .all<WhSerialRow>();
}

const STATUS_SET: readonly string[] = SERIAL_STATUSES;
const CUSTODY_SET: readonly string[] = SERIAL_CUSTODIES;

/**
 * Pengeluaran SELESAI yang memuat serial-serial ini. `refs`: maks. `DISPATCH_REFS_MAX` terbaru per serial untuk BU
 * TERBACA (lengkap) dan, dengan kuota terpisah, untuk BU tak terbaca (hanya kode BU dan tanggal: tanpa id/nomor SO),
 * jadi rujukan BU sendiri tak tergeser rujukan BU lain. `recorded`: serial yang punya pengeluaran selesai di BU mana pun.
 */
export async function loadDispatchRefs(
  db: Preparer,
  serialIds: readonly string[],
  /** BU terbaca pemanggil (`serialwh: view`). */
  readableBuIds: ReadonlySet<string>,
): Promise<{ refs: Map<string, WarehouseDispatchRefDto[]>; recorded: Set<string> }> {
  const map = new Map<string, WarehouseDispatchRefDto[]>();
  const recorded = new Set<string>();
  if (serialIds.length === 0) return { refs: map, recorded };
  // `recorded` = pengeluaran selesai mode APA PUN (juga ready, yang tak punya SO dan tak masuk `refs`).
  const recordedRows = await db
    .prepare(
      `SELECT DISTINCT wds.serial_id FROM warehouse_dispatch_serials wds JOIN warehouse_dispatches d ON d.id = wds.dispatch_id WHERE d.status = 'done' AND wds.serial_id IN (${placeholders(serialIds.length)})`,
    )
    .bind(...serialIds)
    .all<{ serial_id: string }>();
  for (const row of recordedRows.results) recorded.add(row.serial_id.trim());
  // `refs` = Penjualan (ber-SO atau tanpa SO; Ready tak dihitung). Tanpa SO: `orderId`/`orderNumber` kosong, BU dari pengeluaran.
  const rows = await db
    .prepare(
      `SELECT wds.serial_id, o.id AS order_id, o.number, bu.id AS bu_id, bu.code AS bu_code, d.dispatched_on FROM warehouse_dispatch_serials wds JOIN warehouse_dispatches d ON d.id = wds.dispatch_id LEFT JOIN warehouse_orders o ON o.id = wds.order_id JOIN business_units bu ON bu.id = IF(d.bu_id <> '', d.bu_id, o.bu_id) WHERE d.kind = 'order' AND d.status = 'done' AND wds.serial_id IN (${placeholders(serialIds.length)}) ORDER BY d.dispatched_on DESC, d.created_at DESC`,
    )
    .bind(...serialIds)
    .all<{
      serial_id: string;
      order_id: string | null;
      number: string | null;
      bu_id: string;
      bu_code: string;
      dispatched_on: string;
    }>();
  const readableCount = new Map<string, number>();
  const hiddenCount = new Map<string, number>();
  for (const row of rows.results) {
    const serialId = row.serial_id.trim();
    const isReadable = readableBuIds.has(row.bu_id.trim());
    const counter = isReadable ? readableCount : hiddenCount;
    const used = counter.get(serialId) ?? 0;
    if (used >= DISPATCH_REFS_MAX) continue;
    counter.set(serialId, used + 1);
    const list = map.get(serialId) ?? [];
    list.push(
      isReadable
        ? {
            orderId: (row.order_id ?? '').trim(),
            orderNumber: row.number ?? '',
            buId: row.bu_id.trim(),
            buCode: row.bu_code.trim(),
            dispatchedOn: row.dispatched_on,
          }
        : { buCode: row.bu_code.trim(), dispatchedOn: row.dispatched_on },
    );
    map.set(serialId, list);
  }
  return { refs: map, recorded };
}

/** Serial-serial ini yang sudah tercatat selesai pada pengeluaran mode apa pun (pencegah mencatat ready ganda). */
export async function serialsRecordedDone(
  db: Preparer,
  serialIds: readonly string[],
): Promise<Set<string>> {
  if (serialIds.length === 0) return new Set();
  const rows = await db
    .prepare(
      `SELECT DISTINCT w.serial_id FROM warehouse_dispatch_serials w JOIN warehouse_dispatches d ON d.id = w.dispatch_id WHERE d.status = 'done' AND w.serial_id IN (${placeholders(serialIds.length)})`,
    )
    .bind(...serialIds)
    .all<{ serial_id: string }>();
  return new Set(rows.results.map((row) => row.serial_id.trim()));
}

/** Serial-serial ini yang masih ada pada pengeluaran `pending` mode apa pun (SO atau ready), belum selesai. */
export async function serialsInPendingDispatches(
  db: Preparer,
  serialIds: readonly string[],
): Promise<Set<string>> {
  if (serialIds.length === 0) return new Set();
  const rows = await db
    .prepare(
      `SELECT DISTINCT w.serial_id FROM warehouse_dispatch_serials w JOIN warehouse_dispatches d ON d.id = w.dispatch_id WHERE d.status = 'pending' AND w.serial_id IN (${placeholders(serialIds.length)})`,
    )
    .bind(...serialIds)
    .all<{ serial_id: string }>();
  return new Set(rows.results.map((row) => row.serial_id.trim()));
}

/** Serial-serial ini yang sudah ada pada SO itu (pengeluaran `pending` atau selesai). */
export async function serialsInOrder(
  db: Preparer,
  orderId: string,
  serialIds: readonly string[],
): Promise<Set<string>> {
  if (serialIds.length === 0) return new Set();
  const rows = await db
    .prepare(
      `SELECT serial_id FROM warehouse_dispatch_serials WHERE order_id = ? AND serial_id IN (${placeholders(serialIds.length)})`,
    )
    .bind(orderId, ...serialIds)
    .all<{ serial_id: string }>();
  return new Set(rows.results.map((row) => row.serial_id.trim()));
}

/** Daftar putih DTO pengungkapan minimal lintas BU (spek 5.9). */
export function toWarehouseSerial(
  row: WhSerialRow,
  dispatches: WarehouseDispatchRefDto[],
  inOrder?: boolean,
  showBuName = true,
  recorded = false,
): WarehouseSerialDto {
  const status = row.status.trim();
  const custody = row.custody.trim();
  return {
    id: row.id.trim(),
    serial: row.serial,
    itemId: row.item_id.trim(),
    itemLabel: `${row.brand_name ?? ''} ${(row.model ?? '').trim()}`.trim(),
    buId: row.bu_id.trim(),
    buCode: row.bu_code.trim(),
    ...(showBuName ? { buName: row.bu_name.trim() } : {}),
    locationId: row.location_id.trim(),
    locationName: row.location_name ?? '',
    testDate: row.test_date,
    status: (STATUS_SET.includes(status) ? status : 'good') as SerialStatus,
    custody: (CUSTODY_SET.includes(custody) ? custody : 'qc') as SerialCustody,
    whCreated: Number(row.wh_created) === 1,
    needsProof: Number(row.needs_proof) === 1,
    recorded,
    dispatches,
    ...(inOrder === undefined ? {} : { inOrder }),
  };
}
