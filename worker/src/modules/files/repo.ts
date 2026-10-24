import type { Env } from '@worker/core/env';

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

export async function findActiveFiles(env: Env, ids: readonly string[]): Promise<FileRecord[]> {
  if (ids.length === 0) return [];
  const rows = await env.DB.prepare(
    `SELECT ${FILE_COLUMNS} FROM files WHERE status = 'active' AND id IN (${ids.map(() => '?').join(',')})`,
  )
    .bind(...ids)
    .all<FileRow>();
  return rows.results.map(toFile);
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
