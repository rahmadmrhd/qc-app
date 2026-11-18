import { CAS_UPDATED_AT_SET } from '@server/core/cas';
import type { DbStatement, Preparer } from '@server/core/db';
import type { UserContext } from '@server/modules/access/context';
import { canWriteBu, writableBuIds } from './access';

export interface NewSerial {
  id: string;
  clientId: string;
  buId: string;
  serial: string;
  itemId: string;
  testDate: string;
  sample: boolean;
  note: string;
  locationId: string;
  /** Status awal: `good`, atau `reported` bila langsung dilaporkan rusak (Lapor Rusak serial baru). */
  status: 'good' | 'reported';
  /** Laporan terbuka bila `reported`; `''` bila tidak ada. */
  openCaseId: string;
  now: string;
  actorEmail: string;
}

export interface NewEvent {
  id: string;
  serialId: string;
  /** Kasus pemilik kejadian; `''` = di luar kasus. */
  caseId: string;
  seq: number;
  type: string;
  occurredOn: string;
  now: string;
  actorId: string;
  actorName: string;
  actorTeam: 'qc' | 'service' | 'system';
  message: string;
  changes: unknown[];
  data: Record<string, unknown>;
}

/** Catatan serial yang sudah memakai `clientId` ini (kunci idempoten per baris). */
export async function findSerialByClientId(
  db: Preparer,
  clientId: string,
): Promise<{ id: string; buId: string; serial: string } | null> {
  const row = await db
    .prepare('SELECT id, bu_id, serial FROM serials WHERE client_id = ?')
    .bind(clientId)
    .first<{ id: string; bu_id: string; serial: string }>();
  return row ? { id: row.id.trim(), buId: row.bu_id.trim(), serial: row.serial } : null;
}

/** Nama lokasi dengan status apa pun (nonaktif tetap dikenali di riwayat), atau `null` bila tidak ada. */
export async function locationNameOf(db: Preparer, locationId: string): Promise<string | null> {
  const row = await db
    .prepare('SELECT name FROM locations WHERE id = ?')
    .bind(locationId)
    .first<{ name: string }>();
  return row ? row.name : null;
}

/**
 * Syarat item bagi serial di sebuah BU (spek 2026-11-18 butir N): BU serial TIDAK lagi dibatasi pada BU item. Item harus
 * aktif dan terlihat bagi user (minimal satu BU item berada dalam cakupan tulis `serial: edit` user), BU harus aktif, dan
 * user harus boleh menulis di BU itu. Nama item/BU tidak dibaca: pemanggil menjawab galat generik.
 */
export async function activeItemWritableForBu(
  db: Preparer,
  itemId: string,
  buId: string,
  user: UserContext,
): Promise<boolean> {
  if (!canWriteBu(user, buId)) return false;
  const scope = writableBuIds(user);
  if (scope.length === 0) return false;
  const row = await db
    .prepare(
      `SELECT 1 AS ok FROM items i WHERE i.id = ? AND i.status = 'active' AND EXISTS (SELECT 1 FROM item_business_units l WHERE l.item_id = i.id AND l.bu_id IN (${scope.map(() => '?').join(',')})) AND EXISTS (SELECT 1 FROM business_units b WHERE b.id = ? AND b.status = 'active')`,
    )
    .bind(itemId, ...scope, buId)
    .first<{ ok: number }>();
  return row !== null;
}

/** Nama lokasi aktif, atau `null` bila tidak ada atau nonaktif. */
export async function activeLocationName(db: Preparer, locationId: string): Promise<string | null> {
  const row = await db
    .prepare("SELECT name FROM locations WHERE id = ? AND status = 'active'")
    .bind(locationId)
    .first<{ name: string }>();
  return row ? row.name : null;
}

export function insertSerialStmt(db: Preparer, serial: NewSerial): DbStatement {
  return db
    .prepare(
      "INSERT INTO serials (id, client_id, bu_id, serial, item_id, test_date, sample, note, location_id, recorded_location_id, status, custody, open_case_id, created_at, created_by, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'qc', ?, ?, ?, ?, ?)",
    )
    .bind(
      serial.id,
      serial.clientId,
      serial.buId,
      serial.serial,
      serial.itemId,
      serial.testDate,
      serial.sample ? 1 : 0,
      serial.note,
      serial.locationId,
      serial.locationId,
      serial.status,
      serial.openCaseId,
      serial.now,
      serial.actorEmail,
      serial.now,
      serial.actorEmail,
    );
}

export function insertSerialStickerStmt(
  db: Preparer,
  serialId: string,
  stickerId: string,
  qty: number,
): DbStatement {
  return db
    .prepare('INSERT INTO serial_stickers (serial_id, sticker_id, qty) VALUES (?, ?, ?)')
    .bind(serialId, stickerId, qty);
}

export function insertEventStmt(db: Preparer, event: NewEvent): DbStatement {
  return db
    .prepare(
      'INSERT INTO serial_events (id, serial_id, case_id, seq, type, occurred_on, created_at, actor_id, actor_name, actor_team, message, changes_json, data_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      event.id,
      event.serialId,
      event.caseId,
      event.seq,
      event.type,
      event.occurredOn,
      event.now,
      event.actorId,
      event.actorName,
      event.actorTeam,
      event.message,
      JSON.stringify(event.changes),
      JSON.stringify(event.data),
    );
}

export interface SerialRow {
  id: string;
  client_id: string;
  bu_id: string;
  bu_code: string;
  serial: string;
  item_id: string;
  brand_name: string | null;
  model: string | null;
  test_date: string;
  sample: number | string;
  note: string;
  location_id: string;
  location_name: string | null;
  recorded_location_id: string;
  status: string;
  custody: string;
  open_case_id: string;
  transit_from_location_id: string;
  transit_to_location_id: string;
  transit_on: string;
  transit_from_name: string | null;
  transit_to_name: string | null;
  open_case_number: string | null;
  /** 1 bila serial punya foto bukti QC (sudah tersimpan, apa pun statusnya). */
  has_proof: number | string;
  /** Jumlah foto bukti QC `failed` pada serial ini. */
  proof_problem: number | string;
  created_at: string;
  created_by: string;
  updated_at: string;
  updated_by: string;
}

const SERIAL_COLUMNS =
  "s.id, s.client_id, s.bu_id, bu.code AS bu_code, s.serial, s.item_id, b.name AS brand_name, i.model, s.test_date, s.sample, s.note, s.location_id, l.name AS location_name, s.recorded_location_id, s.status, s.custody, s.open_case_id, s.transit_from_location_id, s.transit_to_location_id, s.transit_on, lf.name AS transit_from_name, lt.name AS transit_to_name, c.number AS open_case_number, EXISTS(SELECT 1 FROM serial_proof_photos pp WHERE pp.serial_id = s.id) AS has_proof, (SELECT COUNT(*) FROM serial_proof_photos pf WHERE pf.serial_id = s.id AND pf.state = 'failed') AS proof_problem, s.created_at, s.created_by, s.updated_at, s.updated_by";

const SERIAL_FROM =
  'FROM serials s JOIN business_units bu ON bu.id = s.bu_id LEFT JOIN items i ON i.id = s.item_id LEFT JOIN brands b ON b.id = i.brand_id LEFT JOIN locations l ON l.id = s.location_id LEFT JOIN locations lf ON lf.id = s.transit_from_location_id LEFT JOIN locations lt ON lt.id = s.transit_to_location_id LEFT JOIN serial_cases c ON c.id = s.open_case_id';

export async function loadSerialRow(db: Preparer, id: string): Promise<SerialRow | null> {
  return db
    .prepare(`SELECT ${SERIAL_COLUMNS} ${SERIAL_FROM} WHERE s.id = ?`)
    .bind(id)
    .first<SerialRow>();
}

export interface SerialBuHistoryRow {
  bu_id: string;
  bu_code: string;
  first_at: string;
  left_at: string;
}

/** Riwayat BU serial (urut `first_at`), berikut kode BU; baris dengan `left_at` kosong = BU saat ini. */
export async function loadBuHistory(db: Preparer, serialId: string): Promise<SerialBuHistoryRow[]> {
  const rows = await db
    .prepare(
      'SELECT h.bu_id, bu.code AS bu_code, h.first_at, h.left_at FROM serial_business_units h JOIN business_units bu ON bu.id = h.bu_id WHERE h.serial_id = ? ORDER BY h.first_at, h.bu_id',
    )
    .bind(serialId)
    .all<SerialBuHistoryRow>();
  return rows.results;
}

export interface SerialStickerRow {
  sticker_id: string;
  name: string | null;
  alias: string | null;
  qty: number | string;
  status: string | null;
}

export async function loadSerialStickers(
  db: Preparer,
  serialId: string,
): Promise<SerialStickerRow[]> {
  const rows = await db
    .prepare(
      'SELECT ss.sticker_id, st.name, st.alias, st.status, ss.qty FROM serial_stickers ss LEFT JOIN stickers st ON st.id = ss.sticker_id WHERE ss.serial_id = ? ORDER BY st.name, ss.sticker_id',
    )
    .bind(serialId)
    .all<SerialStickerRow>();
  return rows.results;
}

export interface SerialEventRow {
  id: string;
  case_id: string;
  seq: number | string;
  type: string;
  occurred_on: string;
  created_at: string;
  actor_name: string;
  actor_team: string;
  message: string;
  changes_json: string;
  data_json: string;
}

export const EVENTS_MAX = 500;

/**
 * Kejadian serial: maks. `EVENTS_MAX` yang TERBARU, terurut terbaru di atas (`seq` menurun). Dimuat satu baris lebih
 * banyak untuk mengetahui apakah ada yang terpotong.
 */
export async function loadSerialEvents(
  db: Preparer,
  serialId: string,
): Promise<{ events: SerialEventRow[]; truncated: boolean }> {
  const rows = await db
    .prepare(
      'SELECT id, case_id, seq, type, occurred_on, created_at, actor_name, actor_team, message, changes_json, data_json FROM serial_events WHERE serial_id = ? ORDER BY seq DESC LIMIT ?',
    )
    .bind(serialId, EVENTS_MAX + 1)
    .all<SerialEventRow>();
  return {
    events: rows.results.slice(0, EVENTS_MAX),
    truncated: rows.results.length > EVENTS_MAX,
  };
}

export interface SerialListFilter {
  /** BU yang boleh dibaca (tidak kosong). */
  buIds: readonly string[];
  /**
   * `history` (bawaan): serial terlihat bila BU saat ini ATAU salah satu BU di riwayatnya ada di `buIds` (baca).
   * `current`: hanya BU SAAT INI (pencarian yang dipakai untuk menulis, mis. Lapor Rusak).
   */
  buScope?: 'history' | 'current';
  /** Kandidat awalan serial ternormalisasi (atau). */
  prefixes?: readonly string[];
  /** Serial persis (ternormalisasi). */
  serials?: readonly string[];
  buId?: string;
  itemId?: string;
  locationId?: string;
  status?: string;
  custody?: string;
  from?: string;
  to?: string;
  createdBy?: string;
  cursor?: { createdAt: string; id: string };
  limit: number;
}

const placeholders = (count: number): string => Array.from({ length: count }, () => '?').join(', ');

/**
 * Daftar serial urut `created_at DESC, id DESC`; mengambil `limit + 1` baris untuk menentukan kursor berikutnya.
 *
 * Cakupan baca (`history`) = BU saat ini ATAU riwayat BU. Predikat `OR` atas keduanya tidak dapat memakai indeks
 * (diukur: 3-6 dtk pada 200 ribu serial), jadi daftar dipecah menjadi CABANG yang saling lepas, tiap cabang memakai
 * indeksnya sendiri dan dibatasi `LIMIT`, lalu digabung (`UNION ALL`) dan diurutkan ulang:
 *  - cur: BU saat ini ada di BU yang dapat dibaca (indeks `serials_bu_created`);
 *  - hist: BU saat ini di luar, tetapi serial pernah di BU yang dapat dibaca (baris `left_at` terisi pada
 *    `serial_business_units`, himpunan kecil; indeks `serial_bu_by_bu`).
 * Filter BU (pernah di BU itu) memecah lagi: eq (BU saat ini = BU itu) dan hist (BU itu pernah ditinggalkan).
 */
export async function listSerialRows(db: Preparer, filter: SerialListFilter): Promise<SerialRow[]> {
  const common: string[] = [];
  const commonBinds: unknown[] = [];
  if (filter.itemId !== undefined) {
    common.push('s.item_id = ?');
    commonBinds.push(filter.itemId);
  }
  if (filter.locationId !== undefined) {
    common.push('s.location_id = ?');
    commonBinds.push(filter.locationId);
  }
  if (filter.status !== undefined) {
    common.push('s.status = ?');
    commonBinds.push(filter.status);
  }
  if (filter.custody !== undefined) {
    common.push('s.custody = ?');
    commonBinds.push(filter.custody);
  }
  if (filter.from !== undefined) {
    common.push('s.test_date >= ?');
    commonBinds.push(filter.from);
  }
  if (filter.to !== undefined) {
    common.push('s.test_date <= ?');
    commonBinds.push(filter.to);
  }
  if (filter.createdBy !== undefined) {
    common.push('s.created_by = ?');
    commonBinds.push(filter.createdBy);
  }
  if (filter.prefixes !== undefined && filter.prefixes.length > 0) {
    // `LIKE 'awalan%'` (bukan `LEFT() = ?`) agar indeks `serials_bu_serial` dapat dipakai; metakarakter di-escape.
    common.push(`(${filter.prefixes.map(() => "s.serial LIKE ? ESCAPE '!'").join(' OR ')})`);
    for (const prefix of filter.prefixes) commonBinds.push(`${escapeLike(prefix)}%`);
  }
  if (filter.serials !== undefined) {
    if (filter.serials.length === 0) return [];
    common.push(`s.serial IN (${placeholders(filter.serials.length)})`);
    commonBinds.push(...filter.serials);
  }
  if (filter.cursor) {
    common.push('(s.created_at < ? OR (s.created_at = ? AND s.id < ?))');
    commonBinds.push(filter.cursor.createdAt, filter.cursor.createdAt, filter.cursor.id);
  }

  interface Part {
    sql: string;
    binds: unknown[];
  }
  const readable = placeholders(filter.buIds.length);
  const readableParts: Part[] =
    filter.buScope === 'current'
      ? [{ sql: `s.bu_id IN (${readable})`, binds: [...filter.buIds] }]
      : [
          { sql: `s.bu_id IN (${readable})`, binds: [...filter.buIds] },
          {
            sql: `s.bu_id NOT IN (${readable}) AND s.id IN (SELECT serial_id FROM serial_business_units WHERE bu_id IN (${readable}) AND left_at > '')`,
            binds: [...filter.buIds, ...filter.buIds],
          },
        ];
  const buId = filter.buId;
  const buParts: Part[] =
    buId === undefined
      ? [{ sql: '', binds: [] }]
      : filter.buScope === 'current'
        ? [{ sql: 's.bu_id = ?', binds: [buId] }]
        : [
            { sql: 's.bu_id = ?', binds: [buId] },
            {
              sql: "s.bu_id <> ? AND s.id IN (SELECT serial_id FROM serial_business_units WHERE bu_id = ? AND left_at > '')",
              binds: [buId, buId],
            },
          ];

  const limit = filter.limit + 1;
  const arms: { sql: string; binds: unknown[] }[] = [];
  for (const readablePart of readableParts) {
    for (const buPart of buParts) {
      const where = [readablePart.sql, ...(buPart.sql === '' ? [] : [buPart.sql]), ...common];
      arms.push({
        sql: `SELECT ${SERIAL_COLUMNS} ${SERIAL_FROM} WHERE ${where.join(' AND ')} ORDER BY s.created_at DESC, s.id DESC LIMIT ?`,
        binds: [...readablePart.binds, ...buPart.binds, ...commonBinds, limit],
      });
    }
  }
  const only = arms[0];
  if (arms.length === 1 && only) {
    const rows = await db
      .prepare(only.sql)
      .bind(...only.binds)
      .all<SerialRow>();
    return rows.results;
  }
  const rows = await db
    .prepare(
      `${arms.map((arm) => `(${arm.sql})`).join(' UNION ALL ')} ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .bind(...arms.flatMap((arm) => arm.binds), limit)
    .all<SerialRow>();
  return rows.results;
}

/** Meng-escape `%`, `_`, dan karakter escape `!` agar awalan dicocokkan apa adanya oleh `LIKE ... ESCAPE '!'`. */
export function escapeLike(value: string): string {
  return value.replace(/[!%_]/g, (char) => `!${char}`);
}

export type SerialColumn =
  | 'serial'
  | 'item_id'
  | 'test_date'
  | 'sample'
  | 'note'
  | 'location_id'
  | 'custody'
  | 'status'
  | 'open_case_id'
  | 'transit_from_location_id'
  | 'transit_to_location_id'
  | 'transit_on';

/**
 * Memperbarui catatan serial dengan penjaga CAS `updated_at` (stempel lain = `CAS_FAIL_SQL`, seluruh batch batal).
 * Pernyataan ini juga mengunci baris serial sehingga penulis kejadian serentak berjalan berurutan. Nama kolom hanya
 * dari daftar tetap `SerialColumn`; nilai selalu di-bind.
 */
export function updateSerialStmt(
  db: Preparer,
  args: {
    id: string;
    expectedUpdatedAt: string;
    now: string;
    actorEmail: string;
    set: Partial<Record<SerialColumn, string | number>>;
  },
): DbStatement {
  const columns = Object.keys(args.set) as SerialColumn[];
  const assignments = columns.map((column) => `${column} = ?`);
  return db
    .prepare(
      `UPDATE serials SET ${CAS_UPDATED_AT_SET}, updated_by = ?${assignments.length > 0 ? `, ${assignments.join(', ')}` : ''} WHERE id = ?`,
    )
    .bind(
      args.expectedUpdatedAt,
      args.now,
      args.actorEmail,
      ...columns.map((column) => args.set[column] as string | number),
      args.id,
    );
}

/** Kejadian berikutnya: `seq` = maksimum + 1 dihitung di dalam INSERT (aman karena baris serial sudah dikunci UPDATE). */
export function insertNextEventStmt(db: Preparer, event: Omit<NewEvent, 'seq'>): DbStatement {
  return db
    .prepare(
      'INSERT INTO serial_events (id, serial_id, case_id, seq, type, occurred_on, created_at, actor_id, actor_name, actor_team, message, changes_json, data_json) SELECT ?, ?, ?, COALESCE(MAX(seq), 0) + 1, ?, ?, ?, ?, ?, ?, ?, ?, ? FROM serial_events WHERE serial_id = ?',
    )
    .bind(
      event.id,
      event.serialId,
      event.caseId,
      event.type,
      event.occurredOn,
      event.now,
      event.actorId,
      event.actorName,
      event.actorTeam,
      event.message,
      JSON.stringify(event.changes),
      JSON.stringify(event.data),
      event.serialId,
    );
}

/** Menyetel jumlah stiker pada serial (baris dibuat bila belum ada). */
export function upsertSerialStickerStmt(
  db: Preparer,
  serialId: string,
  stickerId: string,
  qty: number,
): DbStatement {
  return db
    .prepare(
      'INSERT INTO serial_stickers (serial_id, sticker_id, qty) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE qty = ?',
    )
    .bind(serialId, stickerId, qty, qty);
}

/** Label "Merk Model" sebuah item, atau `null` bila item tidak ada. */
export async function itemLabelOf(db: Preparer, itemId: string): Promise<string | null> {
  const row = await db
    .prepare(
      'SELECT b.name AS brand_name, i.model FROM items i LEFT JOIN brands b ON b.id = i.brand_id WHERE i.id = ?',
    )
    .bind(itemId)
    .first<{ brand_name: string | null; model: string }>();
  return row ? `${row.brand_name ?? ''} ${row.model.trim()}`.trim() : null;
}
