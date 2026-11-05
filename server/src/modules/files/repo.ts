import type { Env } from '@server/core/env';

export type FileStatus = 'active' | 'pending_delete';

export interface FileRecord {
  id: string;
  driveId: string;
  mime: string;
  size: number;
  width: number;
  height: number;
  ownerType: string;
  ownerId: string;
  createdAt: string;
  createdBy: string;
  status: FileStatus;
}

interface FileRow {
  id: string;
  drive_id: string;
  mime: string;
  size: number;
  width: number;
  height: number;
  owner_type: string;
  owner_id: string;
  created_at: string;
  created_by: string;
  status: string;
}

export const FILE_COLUMNS =
  'id, drive_id, mime, size, width, height, owner_type, owner_id, created_at, created_by, status';

export function toFile(row: FileRow): FileRecord {
  return {
    id: row.id.trim(),
    driveId: row.drive_id.trim(),
    mime: row.mime.trim(),
    size: Number(row.size) || 0,
    width: Number(row.width) || 0,
    height: Number(row.height) || 0,
    ownerType: row.owner_type.trim(),
    ownerId: row.owner_id.trim(),
    createdAt: row.created_at,
    createdBy: row.created_by,
    status: row.status === 'pending_delete' ? 'pending_delete' : 'active',
  };
}

/** Berkas aktif menurut id; berkas `pending_delete` dianggap sudah tidak ada. */
export async function findActiveFile(env: Env, id: string): Promise<FileRecord | null> {
  const row = await env.DB.prepare(
    `SELECT ${FILE_COLUMNS} FROM files WHERE id = ? AND status = 'active'`,
  )
    .bind(id)
    .first<FileRow>();
  return row && row.drive_id.trim() !== '' ? toFile(row) : null;
}

/** Kueri berkas aktif menurut id (dipecah <= 90 parameter per kueri; batas D1 100). */
export function activeFilesStatements(env: Env, ids: readonly string[]): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [];
  for (let from = 0; from < ids.length; from += 90) {
    const chunk = ids.slice(from, from + 90);
    statements.push(
      env.DB.prepare(
        `SELECT ${FILE_COLUMNS} FROM files WHERE status = 'active' AND id IN (${chunk.map(() => '?').join(',')})`,
      ).bind(...chunk),
    );
  }
  return statements;
}

/** Hasil `activeFilesStatements` (urutan sama) menjadi berkas. */
export function activeFilesFromResults(
  results: ReadonlyArray<{ results: unknown[] }>,
): FileRecord[] {
  return results.flatMap((result) => (result.results as FileRow[]).map(toFile));
}

export async function findActiveFiles(env: Env, ids: readonly string[]): Promise<FileRecord[]> {
  const out: FileRecord[] = [];
  // Batas D1: 100 parameter terikat per kueri.
  for (let from = 0; from < ids.length; from += 90) {
    const chunk = ids.slice(from, from + 90);
    const rows = await env.DB.prepare(
      `SELECT ${FILE_COLUMNS} FROM files WHERE status = 'active' AND id IN (${chunk.map(() => '?').join(',')})`,
    )
      .bind(...chunk)
      .all<FileRow>();
    out.push(...rows.results.map(toFile));
  }
  return out;
}

export async function countUnattached(env: Env, createdBy: string): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM files WHERE created_by = ? AND owner_type = '' AND status = 'active'",
  )
    .bind(createdBy)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export function insertFileStmt(db: D1Database, file: FileRecord): D1PreparedStatement {
  return db
    .prepare(`INSERT INTO files (${FILE_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      file.id,
      file.driveId,
      file.mime,
      file.size,
      file.width,
      file.height,
      file.ownerType,
      file.ownerId,
      file.createdAt,
      file.createdBy,
      file.status,
    );
}
