import type { DbStatement, Preparer } from '@server/core/db';
import { auditTargetKind } from '@shared/audit';
import type { AuditCursorPageDto, AuditEntryDto } from '@shared/contract';
import type { Env } from './env';

export interface AuditInput {
  /** ISO 8601 UTC; bawaan = sekarang. */
  ts?: string;
  actor: string;
  action: string;
  target: string;
  /**
   * Id entitas yang diubah (menaut Log Audit ke View-nya, `AuditEntryDto.targetRef`); WAJIB untuk aksi berawalan
   * entitas ber-View (`auditTargetKind(action)`), dijaga `core/audit-target.test.ts`. Kosong untuk aksi tanpa entitas.
   */
  targetId?: string;
  /** Snapshot sebelum perubahan; null/tiada untuk aksi create. */
  before?: unknown;
  /** Snapshot sesudah perubahan; null/tiada untuk aksi delete. */
  after?: unknown;
}

/**
 * Pernyataan INSERT audit untuk digabung ke `batch()` tulisan yang sama, sehingga perubahan dan
 * jejak audit atomik (keduanya tersimpan atau keduanya batal).
 */
export function writeAudit(db: Preparer, entry: AuditInput): DbStatement {
  return db
    .prepare(
      'INSERT INTO audit_log (ts, actor, action, target, target_id, `before`, `after`) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      entry.ts ?? new Date().toISOString(),
      entry.actor,
      entry.action,
      entry.target,
      entry.targetId ?? '',
      JSON.stringify(entry.before ?? null),
      JSON.stringify(entry.after ?? null),
    );
}

/** Baris audit per pernyataan `INSERT` banyak-baris: 7 parameter per baris (16 baris = 112 parameter). */
const AUDIT_ROWS_PER_STATEMENT = 16;

/**
 * Seperti `writeAudit` untuk banyak entri sekaligus: satu `INSERT` banyak-baris per 16 entri (bukan satu
 * pernyataan per entri), urutan baris = urutan `entries` (id audit menaik mengikuti urutan itu). Hasil yang
 * tersimpan identik dengan `writeAudit` berulang; yang berkurang hanya jumlah pernyataan dalam `batch()`.
 */
export function writeAuditRows(db: Preparer, entries: readonly AuditInput[]): DbStatement[] {
  const statements: DbStatement[] = [];
  for (let from = 0; from < entries.length; from += AUDIT_ROWS_PER_STATEMENT) {
    const chunk = entries.slice(from, from + AUDIT_ROWS_PER_STATEMENT);
    const values = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(', ');
    const binds: unknown[] = [];
    for (const entry of chunk) {
      binds.push(
        entry.ts ?? new Date().toISOString(),
        entry.actor,
        entry.action,
        entry.target,
        entry.targetId ?? '',
        JSON.stringify(entry.before ?? null),
        JSON.stringify(entry.after ?? null),
      );
    }
    statements.push(
      db
        .prepare(
          `INSERT INTO audit_log (ts, actor, action, target, target_id, \`before\`, \`after\`) VALUES ${values}`,
        )
        .bind(...binds),
    );
  }
  return statements;
}

interface AuditRow {
  id: number;
  ts: string;
  actor: string;
  action: string;
  target: string;
  target_id: string;
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
  /** Salah satu dari aksi ini; menang atas `action` bila ada. */
  actions?: readonly string[];
  /** Kata kunci pada target atau pelaku (tanpa beda huruf besar); '' = semua. */
  query: string;
}

/**
 * Terbaru dahulu, berhalaman berbasis `(ts, id)` (indeks `audit_log_ts`). Kata kunci memakai `LOCATE` pada
 * `LOWER(...)` (pencarian substring literal, tanpa metakarakter LIKE). Hanya halaman ini yang di-parse JSON-nya.
 */
export async function listAudit(env: Env, params: ListAuditParams): Promise<AuditCursorPageDto> {
  const where: string[] = [];
  const binds: unknown[] = [];
  if (params.actions !== undefined) {
    where.push(`action IN (${params.actions.map(() => '?').join(', ')})`);
    binds.push(...params.actions);
  } else if (params.action !== '') {
    where.push('action = ?');
    binds.push(params.action);
  }
  const query = params.query.toLowerCase();
  if (query !== '') {
    where.push('(LOCATE(?, LOWER(target)) > 0 OR LOCATE(?, LOWER(actor)) > 0)');
    binds.push(query, query);
  }
  if (params.cursor) {
    where.push('(ts < ? OR (ts = ? AND id < ?))');
    binds.push(params.cursor.ts, params.cursor.ts, params.cursor.id);
  }
  const sql = `SELECT id, ts, actor, action, target, target_id, \`before\`, \`after\` FROM audit_log${
    where.length > 0 ? ` WHERE ${where.join(' AND ')}` : ''
  } ORDER BY ts DESC, id DESC LIMIT ?`;
  const result = await env.DB.prepare(sql)
    .bind(...binds, params.limit + 1)
    .all<AuditRow>();
  return toCursorPage(result.results, params.limit);
}

function toCursorPage(rows: readonly AuditRow[], limit: number): AuditCursorPageDto {
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    entries: page.map((row): AuditEntryDto => {
      const kind = row.target_id === '' ? undefined : auditTargetKind(row.action);
      return {
        id: String(row.id),
        ts: row.ts,
        actor: row.actor,
        action: row.action,
        target: row.target,
        before: parseSnapshot(row.before),
        after: parseSnapshot(row.after),
        ...(kind ? { targetRef: { kind, id: row.target_id } } : {}),
      };
    }),
    nextCursor: rows.length > limit && last ? encodeAuditCursor(last) : null,
  };
}

export interface ListAuditByTargetParams {
  /** `<ts>~<id>` dari halaman sebelumnya. */
  cursor?: { ts: string; id: number };
  limit: number;
}

/**
 * Riwayat satu target persis (mis. `postel:<id>`), terbaru dahulu, berhalaman berbasis `(ts, id)` lewat indeks
 * `audit_log_target_ts`. Hanya halaman ini yang di-parse JSON-nya.
 */
export async function listAuditByTarget(
  env: Env,
  target: string,
  params: ListAuditByTargetParams,
): Promise<AuditCursorPageDto> {
  const binds: unknown[] = [target];
  let cursorSql = '';
  if (params.cursor) {
    cursorSql = ' AND (ts < ? OR (ts = ? AND id < ?))';
    binds.push(params.cursor.ts, params.cursor.ts, params.cursor.id);
  }
  const result = await env.DB.prepare(
    `SELECT id, ts, actor, action, target, target_id, \`before\`, \`after\` FROM audit_log WHERE target = ?${cursorSql} ORDER BY ts DESC, id DESC LIMIT ?`,
  )
    .bind(...binds, params.limit + 1)
    .all<AuditRow>();
  return toCursorPage(result.results, params.limit);
}
