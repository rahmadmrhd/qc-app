import { base64ByteLength, isImageMime } from '@shared/files';
import { SYNC_ACTOR, SYNC_LIMITS } from '@shared/sync';
import { getBridge, viaBridge } from '@worker/core/bridge-client';
import type { Env } from '@worker/core/env';
import { nowIso } from '@worker/core/env';
import { appError } from '@worker/core/errors';
import { cachedFileContent } from '@worker/core/file-cache';
import { getSetting, SETTING_DRIVE_FOLDER_ID } from '@worker/core/settings';
import { readObject } from '@worker/core/validate';
import type { FileRecord } from '@worker/modules/files/repo';
import { FILE_COLUMNS, insertFileStmt, toFile } from '@worker/modules/files/repo';

export interface SyncFileGetInput {
  driveId: string;
}

export interface DriveProbe {
  mime: string;
  size: number;
}

export function validateSyncFileGet(raw: unknown): SyncFileGetInput {
  const reader = readObject(raw);
  const driveId = reader.str('driveId', { required: true, max: 100 });
  reader.done();
  return { driveId };
}

export async function getSyncFile(
  env: Env,
  input: SyncFileGetInput,
): Promise<{ driveId: string; mime: string; base64: string }> {
  const folderId = await getSetting(env, SETTING_DRIVE_FOLDER_ID);
  const bridge = getBridge(env);
  const info = folderId ? await viaBridge(() => bridge.fileInfo(input.driveId, folderId)) : null;
  if (!info) throw appError('NOT_FOUND', 'Berkas tidak ditemukan');
  if (info.size > SYNC_LIMITS.fileBytes) {
    throw appError('VALIDATION', 'Berkas melebihi 8 MB', { driveId: 'Berkas melebihi 8 MB' });
  }
  const content = await cachedFileContent(env, folderId, input.driveId, async () => {
    const read = await viaBridge(() => bridge.readFile(input.driveId, folderId));
    return read ? { mime: read.mime, base64: read.base64 } : null;
  });
  if (!content) throw appError('NOT_FOUND', 'Berkas tidak ditemukan');
  if (base64ByteLength(content.base64) > SYNC_LIMITS.fileBytes) {
    throw appError('VALIDATION', 'Berkas melebihi 8 MB', { driveId: 'Berkas melebihi 8 MB' });
  }
  return { driveId: input.driveId, mime: content.mime, base64: content.base64 };
}

async function filesByDriveIds(env: Env, driveIds: readonly string[]): Promise<FileRecord[]> {
  if (driveIds.length === 0) return [];
  const rows = await env.DB.prepare(
    `SELECT ${FILE_COLUMNS} FROM files WHERE status = 'active' AND drive_id IN (${driveIds.map(() => '?').join(',')})`,
  )
    .bind(...driveIds)
    .all<Parameters<typeof toFile>[0]>();
  return rows.results.map(toFile);
}

/** Info Drive untuk id yang belum tercatat di tabel `files`; `null` = tak sah (di luar folder aplikasi). */
export async function probeDriveIds(
  env: Env,
  driveIds: readonly string[],
): Promise<Map<string, DriveProbe | null>> {
  const unique = [...new Set(driveIds)];
  // Tanpa id Drive tidak ada yang perlu diperiksa: lewati pembacaan folder dan tabel berkas (2 round trip).
  if (unique.length === 0) return new Map();
  const folderId = await getSetting(env, SETTING_DRIVE_FOLDER_ID);
  const known = new Set((await filesByDriveIds(env, unique)).map((file) => file.driveId));
  const bridge = getBridge(env);
  const probes = new Map<string, DriveProbe | null>();
  for (const driveId of unique) {
    if (known.has(driveId)) continue;
    probes.set(
      driveId,
      folderId ? await viaBridge(() => bridge.fileInfo(driveId, folderId)) : null,
    );
  }
  return probes;
}

/**
 * Rencana pendaftaran (TANPA menulis): tiap id Drive dipetakan ke baris `files` yang boleh dipakai pemilik
 * `ownerId` — baris tanpa pemilik atau milik `ownerId` dipakai ulang; bila berkas Drive itu sudah dimiliki
 * entitas lain, disiapkan baris BARU untuk berkas Drive yang sama. Id yang tak ada di folder aplikasi, bukan
 * gambar JPEG/PNG/WebP, atau > 8 MB dilaporkan di `missing`. `pending` ditulis lewat `commitDriveFilesStmts`.
 */
export async function planDriveFiles(
  env: Env,
  driveIds: readonly string[],
  probes: ReadonlyMap<string, DriveProbe | null>,
  ownerId: string,
): Promise<{ map: Map<string, string>; missing: string[]; pending: FileRecord[] }> {
  const unique = [...new Set(driveIds)];
  const rows = await filesByDriveIds(env, unique);
  const map = new Map<string, string>();
  const missing: string[] = [];
  const pending: FileRecord[] = [];
  for (const driveId of unique) {
    const usable = rows.find(
      (file) => file.driveId === driveId && (file.ownerType === '' || file.ownerId === ownerId),
    );
    if (usable) {
      map.set(driveId, usable.id);
      continue;
    }
    const sibling = rows.find((file) => file.driveId === driveId);
    const info: DriveProbe | null = sibling
      ? { mime: sibling.mime, size: sibling.size }
      : (probes.get(driveId) ?? null);
    if (!info || !isImageMime(info.mime) || info.size > SYNC_LIMITS.fileBytes) {
      missing.push(driveId);
      continue;
    }
    const id = crypto.randomUUID();
    pending.push({
      id,
      driveId,
      mime: info.mime,
      size: info.size,
      width: sibling?.width ?? 0,
      height: sibling?.height ?? 0,
      ownerType: '',
      ownerId: '',
      createdAt: nowIso(env),
      createdBy: SYNC_ACTOR,
      status: 'active',
    });
    map.set(driveId, id);
  }
  return { map, missing, pending };
}

/** Pernyataan penulisan baris yang direncanakan `planDriveFiles` (digabung ke `batch()` pemanggil). */
export function commitDriveFilesStmts(
  env: Env,
  pending: readonly FileRecord[],
): D1PreparedStatement[] {
  return pending.map((record) => insertFileStmt(env.DB, record));
}

/** Rencana + tulis sekaligus. */
export async function registerDriveFiles(
  env: Env,
  driveIds: readonly string[],
  probes: ReadonlyMap<string, DriveProbe | null>,
  ownerId: string,
): Promise<{ map: Map<string, string>; missing: string[] }> {
  const { map, missing, pending } = await planDriveFiles(env, driveIds, probes, ownerId);
  if (pending.length > 0) await env.DB.batch(commitDriveFilesStmts(env, pending));
  return { map, missing };
}
