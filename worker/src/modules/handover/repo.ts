import type { HandoverStatus, HandoverStoredStatus } from '@shared/handover';
import { deriveHandoverStatus } from '@shared/handover';
import type { CheckState } from '@shared/handover-checklist';
import type { HandoverCommentDto } from '@shared/rpc';
import { CAS_VERSION_BUMP_SET } from '@worker/core/cas';
import type { Env } from '@worker/core/env';
import { matchedChecks } from './checklist';

export type StoredComment = Omit<HandoverCommentDto, 'stale'>;

export interface HandoverRecord {
  id: string;
  number: string;
  locationId: string;
  customerId: string;
  /** Salinan nama customer saat task disimpan. */
  customerName: string;
  note: string;
  status: HandoverStoredStatus;
  /** Centang QC pada butir checklist (JSON di kolom). */
  checks: CheckState[];
  /** Penanda Selesai untuk task tanpa checklist (Mark done). */
  completedAt: string;
  completedBy: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  /** Penghitung versi untuk CAS; naik pada setiap perubahan isi/centang/status (bukan komentar). */
  version: number;
}

export interface HandoverRow {
  id: string;
  number: string;
  location_id: string;
  customer_id: string;
  customer_name: string;
  note: string;
  status: string;
  checks: string;
  completed_at: string;
  completed_by: string;
  created_at: string;
  created_by: string;
  updated_at: string;
  updated_by: string;
  version: number;
  /** Nama customer terkini (join), bila ada. */
  current_customer_name?: string | null;
}

export const HANDOVER_COLUMNS =
  'h.id, h.number, h.location_id, h.customer_id, h.customer_name, h.note, h.status, h.checks, h.completed_at, h.completed_by, h.created_at, h.created_by, h.updated_at, h.updated_by, h.version, c.name AS current_customer_name';
export const HANDOVER_FROM = 'handovers h LEFT JOIN customers c ON c.id = h.customer_id';

function parseJsonArray(text: string | undefined): unknown[] {
  try {
    const value: unknown = JSON.parse(text ?? '');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function parseChecks(text: string | undefined): CheckState[] {
  const out: CheckState[] = [];
  for (const entry of parseJsonArray(text)) {
    const o = asObject(entry);
    if (!o || typeof o.text !== 'string') continue;
    const occurrence =
      typeof o.occurrence === 'number' && Number.isInteger(o.occurrence) && o.occurrence >= 0
        ? o.occurrence
        : 0;
    out.push({ text: o.text, by: str(o.by), at: str(o.at), occurrence });
  }
  return out;
}

export function toHandover(row: HandoverRow): HandoverRecord {
  return {
    id: row.id.trim(),
    number: row.number.trim(),
    locationId: row.location_id.trim(),
    customerId: row.customer_id.trim(),
    customerName: row.customer_name,
    note: row.note,
    status: row.status.trim() === 'cancelled' ? 'cancelled' : 'open',
    checks: parseChecks(row.checks),
    completedAt: row.completed_at,
    completedBy: row.completed_by,
    createdAt: row.created_at,
    createdBy: row.created_by,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
    version: Number(row.version) || 1,
  };
}

/** Kolom turunan yang WAJIB ikut ditulis di SETIAP penulisan `handovers`. */
export interface DerivedColumns {
  checkedCount: number;
  totalCount: number;
  boardStatus: HandoverStatus;
}

export function derivedColumns(
  handover: Pick<HandoverRecord, 'note' | 'checks' | 'status' | 'completedAt'>,
): DerivedColumns {
  const matched = matchedChecks(handover.note, handover.checks);
  const total = matched.length;
  const done = matched.filter((check) => check !== null).length;
  return {
    checkedCount: done,
    totalCount: total,
    boardStatus: deriveHandoverStatus(handover.status, {
      total,
      done,
      completed: handover.completedAt !== '',
    }),
  };
}

export interface LoadedHandover {
  record: HandoverRecord;
  /** Nama customer terkini menurut id (salinan pada task dipakai bila customer tidak ada). */
  customerName: string;
  /** Komentar task bila dimuat bersama barisnya (`findHandoverWithComments`); tanpa itu dimuat terpisah. */
  comments?: StoredComment[];
}

/** Statistik komentar task untuk batas jumlah/ukuran (dihitung SQL seperti penjaga di batch tulis). */
export interface CommentStats {
  n: number;
  s: number;
}

function loaded(row: HandoverRow): LoadedHandover {
  const record = toHandover(row);
  return { record, customerName: row.current_customer_name ?? record.customerName };
}

export async function findHandover(env: Env, id: string): Promise<LoadedHandover | null> {
  const row = await env.DB.prepare(
    `SELECT ${HANDOVER_COLUMNS} FROM ${HANDOVER_FROM} WHERE h.id = ?`,
  )
    .bind(id)
    .first<HandoverRow>();
  return row ? loaded(row) : null;
}

export async function findHandoversByIds(
  env: Env,
  ids: readonly string[],
): Promise<LoadedHandover[]> {
  if (ids.length === 0) return [];
  const rows = await env.DB.prepare(
    `SELECT ${HANDOVER_COLUMNS} FROM ${HANDOVER_FROM} WHERE h.id IN (${ids.map(() => '?').join(',')})`,
  )
    .bind(...ids)
    .all<HandoverRow>();
  return rows.results.map(loaded);
}

interface CommentRow {
  id: string;
  handover_id: string;
  author: string;
  created_at: string;
  quote: string;
  before: string;
  after: string;
  body: string;
}

const COMMENT_COLUMNS =
  'id, handover_id, author, created_at, quote, "before" AS before, "after" AS after, body';

function toStoredComment(row: CommentRow): StoredComment {
  return {
    id: row.id,
    quote: row.quote,
    before: row.before,
    after: row.after,
    body: row.body,
    author: row.author,
    at: row.created_at,
  };
}

/**
 * Task beserta komentarnya dalam SATU round trip D1 (`batch`); `statsSql` (opsional) menambah statistik
 * komentar sebagai pernyataan ketiga. Null bila task tidak ada.
 */
export async function findHandoverWithComments(
  env: Env,
  id: string,
  statsSql?: string,
): Promise<{ loaded: LoadedHandover; stats: CommentStats | null } | null> {
  const statements = [
    env.DB.prepare(`SELECT ${HANDOVER_COLUMNS} FROM ${HANDOVER_FROM} WHERE h.id = ?`).bind(id),
    env.DB.prepare(
      `SELECT ${COMMENT_COLUMNS} FROM handover_comments WHERE handover_id = ? ORDER BY created_at, rowid`,
    ).bind(id),
  ];
  if (statsSql !== undefined) statements.push(env.DB.prepare(statsSql).bind(id));
  const [handover, comments, stats] = await env.DB.batch(statements);
  const row = handover?.results[0] as HandoverRow | undefined;
  if (!row) return null;
  return {
    loaded: {
      ...loaded(row),
      comments: ((comments?.results ?? []) as CommentRow[]).map(toStoredComment),
    },
    stats: (stats?.results[0] as CommentStats | undefined) ?? null,
  };
}

/**
 * Komentar task (`alias`.id) sebagai larik JSON dari subkueri (urut waktu lalu `rowid`, indeks
 * `handover_comments_handover`); kolom tambahan pada kueri daftar sehingga komentar halaman tidak butuh round
 * trip sendiri. Bentuknya `StoredComment` (`at` = `created_at`). Pasang pada kueri LUAR atas halaman yang sudah
 * dibatasi `LIMIT`, supaya subkueri hanya berjalan untuk baris halaman (bukan semua baris yang cocok).
 */
export function commentsJsonSql(alias: string): string {
  return `(SELECT json_group_array(json(x)) FROM (SELECT json_object('id', c.id, 'quote', c.quote, 'before', c."before", 'after', c."after", 'body', c.body, 'author', c.author, 'at', c.created_at) AS x FROM handover_comments c WHERE c.handover_id = ${alias}.id ORDER BY c.created_at, c.rowid)) AS comments_json`;
}

export function parseStoredComments(text: string | null | undefined): StoredComment[] {
  if (text === undefined || text === null || text === '[]') return [];
  try {
    const value: unknown = JSON.parse(text);
    return Array.isArray(value) ? (value as StoredComment[]) : [];
  } catch {
    return [];
  }
}

/** Pernyataan komentar untuk sekumpulan task (dipecah <= 90 parameter per kueri; urut waktu lalu id). */
export function commentStatements(env: Env, handoverIds: readonly string[]): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [];
  for (let from = 0; from < handoverIds.length; from += 90) {
    const chunk = handoverIds.slice(from, from + 90);
    statements.push(
      env.DB.prepare(
        `SELECT ${COMMENT_COLUMNS} FROM handover_comments WHERE handover_id IN (${chunk.map(() => '?').join(',')}) ORDER BY created_at, rowid`,
      ).bind(...chunk),
    );
  }
  return statements;
}

/** Hasil `commentStatements` (urutan sama) menjadi komentar per task. */
export function commentsByHandover(
  results: ReadonlyArray<{ results: unknown[] }>,
): Map<string, StoredComment[]> {
  const out = new Map<string, StoredComment[]>();
  for (const result of results) {
    for (const row of result.results as CommentRow[]) {
      const list = out.get(row.handover_id) ?? [];
      list.push(toStoredComment(row));
      out.set(row.handover_id, list);
    }
  }
  return out;
}

/** Komentar untuk sekumpulan task (satu round trip, urut waktu lalu id). */
export async function listComments(
  env: Env,
  handoverIds: readonly string[],
): Promise<Map<string, StoredComment[]>> {
  const statements = commentStatements(env, handoverIds);
  return commentsByHandover(statements.length > 0 ? await env.DB.batch(statements) : []);
}

export function insertHandoverStmt(db: D1Database, handover: HandoverRecord): D1PreparedStatement {
  const d = derivedColumns(handover);
  return db
    .prepare(
      'INSERT INTO handovers (id, number, location_id, customer_id, customer_name, note, status, checks, completed_at, completed_by, created_at, created_by, updated_at, updated_by, version, checked_count, total_count, board_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      handover.id,
      handover.number,
      handover.locationId,
      handover.customerId,
      handover.customerName,
      handover.note,
      handover.status,
      JSON.stringify(handover.checks),
      handover.completedAt,
      handover.completedBy,
      handover.createdAt,
      handover.createdBy,
      handover.updatedAt,
      handover.updatedBy,
      handover.version,
      d.checkedCount,
      d.totalCount,
      d.boardStatus,
    );
}

/** Beberapa task baru dalam `INSERT` banyak-baris (18 parameter per baris, maks. 5 baris per pernyataan). */
export function insertHandoverStmts(
  db: D1Database,
  handovers: readonly HandoverRecord[],
): D1PreparedStatement[] {
  const perStatement = 5;
  const statements: D1PreparedStatement[] = [];
  for (let from = 0; from < handovers.length; from += perStatement) {
    const chunk = handovers.slice(from, from + perStatement);
    const binds: unknown[] = [];
    for (const handover of chunk) {
      const d = derivedColumns(handover);
      binds.push(
        handover.id,
        handover.number,
        handover.locationId,
        handover.customerId,
        handover.customerName,
        handover.note,
        handover.status,
        JSON.stringify(handover.checks),
        handover.completedAt,
        handover.completedBy,
        handover.createdAt,
        handover.createdBy,
        handover.updatedAt,
        handover.updatedBy,
        handover.version,
        d.checkedCount,
        d.totalCount,
        d.boardStatus,
      );
    }
    const row = '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
    statements.push(
      db
        .prepare(
          `INSERT INTO handovers (id, number, location_id, customer_id, customer_name, note, status, checks, completed_at, completed_by, created_at, created_by, updated_at, updated_by, version, checked_count, total_count, board_status) VALUES ${chunk.map(() => row).join(', ')}`,
        )
        .bind(...binds),
    );
  }
  return statements;
}

/**
 * UPDATE seluruh kolom isi + turunan. Penjaga CAS `version` ada di `UPDATE` ini (`CAS_VERSION_BUMP_SET`):
 * `expectedVersion` = versi yang dilihat penulis; basi = seluruh batch batal (`integer overflow`), tanpa
 * pernyataan penjaga terpisah. Sukses menaikkan `version` 1.
 */
export function updateHandoverStmt(
  db: D1Database,
  handover: HandoverRecord,
  expectedVersion: number,
): D1PreparedStatement {
  const d = derivedColumns(handover);
  return db
    .prepare(
      `UPDATE handovers SET customer_id = ?, customer_name = ?, note = ?, status = ?, checks = ?, completed_at = ?, completed_by = ?, updated_at = ?, updated_by = ?, ${CAS_VERSION_BUMP_SET}, checked_count = ?, total_count = ?, board_status = ? WHERE id = ?`,
    )
    .bind(
      handover.customerId,
      handover.customerName,
      handover.note,
      handover.status,
      JSON.stringify(handover.checks),
      handover.completedAt,
      handover.completedBy,
      handover.updatedAt,
      handover.updatedBy,
      expectedVersion,
      d.checkedCount,
      d.totalCount,
      d.boardStatus,
      handover.id,
    );
}
