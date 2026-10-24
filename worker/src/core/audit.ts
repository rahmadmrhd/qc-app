import type { AuditCursorPageDto, AuditEntryDto } from '@shared/rpc';
import type { Env } from './env';

export interface AuditInput {
  /** ISO 8601 UTC; bawaan = sekarang. */
  ts?: string;
  actor: string;
  action: string;
  target: string;
  /** Snapshot sebelum perubahan; null/tiada untuk aksi create. */
  before?: unknown;
  /** Snapshot sesudah perubahan; null/tiada untuk aksi delete. */
  after?: unknown;
}

/**
 * Pernyataan INSERT audit untuk digabung ke `batch()` tulisan yang sama, sehingga perubahan dan
 * jejak audit atomik (keduanya tersimpan atau keduanya batal).
 */
export function writeAudit(db: D1Database, entry: AuditInput): D1PreparedStatement {
  return db
    .prepare(
      'INSERT INTO audit_log (ts, actor, action, target, "before", "after") VALUES (?, ?, ?, ?, ?, ?)',
    )
    .bind(
      entry.ts ?? new Date().toISOString(),
      entry.actor,
      entry.action,
      entry.target,
      JSON.stringify(entry.before ?? null),
      JSON.stringify(entry.after ?? null),
    );
}

interface AuditRow {
  id: number;
  ts: string;
  actor: string;
  action: string;
  target: string;
  before: string;
  after: string;
}

function parseSnapshot(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function encodeAuditCursor(row: { ts: string; id: number }): string {
  return `${row.ts}~${row.id}`;
}

export interface ListAuditParams {
  /** `<ts>~<id>` dari halaman sebelumnya. */
  cursor?: { ts: string; id: number };
  limit: number;
  /** Aksi persis; '' = semua. */
  action: string;
  /** Kata kunci pada target atau pelaku (tanpa beda huruf besar); '' = semua. */
  query: string;
}

/**
 * Terbaru dahulu, berhalaman berbasis `(ts, id)` (indeks `audit_log_ts`). Kata kunci memakai `instr`
 * (bukan LIKE) agar tidak terkena batas pola 50 byte D1. Hanya halaman ini yang di-parse JSON-nya.
 */
export async function listAudit(env: Env, params: ListAuditParams): Promise<AuditCursorPageDto> {
  const where: string[] = [];
  const binds: unknown[] = [];
  if (params.action !== '') {
    where.push('action = ?');
    binds.push(params.action);
  }
  const query = params.query.toLowerCase();
  if (query !== '') {
    where.push('(instr(lower(target), ?) > 0 OR instr(lower(actor), ?) > 0)');
    binds.push(query, query);
  }
  if (params.cursor) {
    where.push('(ts < ? OR (ts = ? AND id < ?))');
    binds.push(params.cursor.ts, params.cursor.ts, params.cursor.id);
  }
  const sql = `SELECT id, ts, actor, action, target, "before" AS before, "after" AS after FROM audit_log${
    where.length > 0 ? ` WHERE ${where.join(' AND ')}` : ''
  } ORDER BY ts DESC, id DESC LIMIT ?`;
  const result = await env.DB.prepare(sql)
    .bind(...binds, params.limit + 1)
    .all<AuditRow>();
  const rows = result.results;
  const page = rows.slice(0, params.limit);
  const last = page[page.length - 1];
  return {
    entries: page.map(
      (row): AuditEntryDto => ({
        id: String(row.id),
        ts: row.ts,
        actor: row.actor,
        action: row.action,
        target: row.target,
        before: parseSnapshot(row.before),
        after: parseSnapshot(row.after),
      }),
    ),
    nextCursor: rows.length > params.limit && last ? encodeAuditCursor(last) : null,
  };
}
